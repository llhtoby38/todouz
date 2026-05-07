#!/usr/bin/env node
// todouz HTTP server.
// - Serves the dashboard SPA at /dashboard/
// - Wraps every tool from tools.mjs at /api/<tool_name>
// - /api/chat — NDJSON stream from @anthropic-ai/claude-agent-sdk's query()
//
// Auth: re-uses the local Claude CLI's OAuth token in macOS Keychain.
// No Anthropic API key, no per-message billing.

import express from 'express';
import cors from 'cors';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';

import { TOOLS, handleCall, safeReplacer } from './tools.mjs';
import { TODOUZ_ROOT, DATA_ROOT } from './store.mjs';

const execFileP = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const SERVER_DIR = dirname(__filename);
const PORT = Number(process.env.PORT || 8765);
const DEFAULT_MODEL = process.env.TODOUZ_MODEL || 'claude-haiku-4-5-20251001';
const MCP_SERVER_PATH = join(SERVER_DIR, 'index.mjs');
const ALLOWED_TOOLS = TOOLS.map(t => `mcp__todouz__${t.name}`);

// Crash-resilience. Unhandled EPIPE / ECONNRESET on a socket-write (typically
// during chat streaming when the client disconnects or an image upload races)
// would otherwise kill the process. Log and continue.
process.on('uncaughtException', (err) => {
  const code = err && (err.code || '');
  console.error('[uncaughtException]', code, err && err.message ? err.message : err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

const app = express();
app.use(cors());
// Bumped 20 → 50 MB so larger screenshots / clipboard images fit comfortably.
app.use(express.json({ limit: '50mb' }));

// ─── auth detection ───────────────────────────────────────────────────
let _cliAuthCache = { value: null, when: 0 };
async function detectCliAuth() {
  const now = Date.now();
  if (_cliAuthCache.value !== null && now - _cliAuthCache.when < 60_000) return _cliAuthCache.value;
  let authed = false;
  try {
    if (process.platform === 'darwin') {
      await execFileP('security', ['find-generic-password', '-s', 'Claude Code-credentials'], { stdio: 'pipe' });
      authed = true;
    } else {
      authed = existsSync(join(homedir(), '.claude', 'sessions')) && existsSync(join(homedir(), '.claude', 'history.jsonl'));
    }
  } catch { authed = false; }
  _cliAuthCache = { value: authed, when: now };
  return authed;
}

// ─── /api/healthz ─────────────────────────────────────────────────────
app.get('/api/healthz', async (_req, res) => {
  const cliAuthed = await detectCliAuth();
  res.json({
    ok: true,
    name: 'todouz',
    tools: TOOLS.length,
    auth: { mode: 'oauth-subscription', cliAuthed, ready: cliAuthed },
    model: DEFAULT_MODEL,
    dataRoot: DATA_ROOT,
  });
});

// ─── REST wrappers — one per tool ─────────────────────────────────────
// Pattern: GET /api/<tool> for read tools (args via query), POST /api/<tool> for writes.
// We accept both POST + GET on every tool for simplicity; the body/query are merged.
for (const tool of TOOLS) {
  const handler = async (req, res) => {
    const args = { ...(req.query || {}), ...(req.body || {}) };
    // Coerce numeric query params (Express gives them as strings)
    for (const [k, v] of Object.entries(args)) {
      if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) args[k] = Number(v);
      if (v === 'true') args[k] = true;
      if (v === 'false') args[k] = false;
    }
    try {
      const result = await handleCall(tool.name, args);
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  };
  app.get(`/api/${tool.name}`, handler);
  app.post(`/api/${tool.name}`, handler);
}

// ─── /api/raw-md (for dashboard preview of epic.md and issues.md) ────
app.get('/api/raw-md', async (req, res) => {
  const path = String(req.query.path || '');
  if (!/^[a-z0-9_\-/.]+\.md$/i.test(path)) return res.status(400).json({ error: 'invalid path' });
  if (path.includes('..')) return res.status(400).json({ error: 'invalid path' });
  try {
    const content = await readFile(join(DATA_ROOT, path), 'utf8');
    res.json({ path, content });
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

// ─── /api/chat — NDJSON streaming ────────────────────────────────────
const IN_FLIGHT_CHATS = new Map(); // sessionId → AbortController

app.post('/api/chat', async (req, res) => {
  const { message, history = [], task = null, attachments = [], agent = 'scheduler', resumeSession, model = DEFAULT_MODEL } = req.body || {};
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'message is required' });
  if (!/^[a-z0-9-]+$/.test(agent)) return res.status(400).json({ error: 'invalid agent name' });

  const agentDirRel = `agents/${agent}`;
  const agentDirAbs = join(DATA_ROOT, agentDirRel);
  let agentSystemPrompt = '';
  try { agentSystemPrompt = await readFile(join(agentDirAbs, 'system-prompt.md'), 'utf8'); } catch {}
  const cwdForAgent = existsSync(agentDirAbs) ? agentDirAbs : DATA_ROOT;

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const sendEvent = (obj) => { res.write(JSON.stringify(obj) + '\n'); };

  // Pre-load context for the model
  let context;
  try {
    context = {
      today: await handleCall('list_today'),
      upcoming: await handleCall('list_upcoming', { days: 7 }),
      profile: (await handleCall('get_profile'))?.content?.slice(0, 2000) || '',
    };
  } catch (e) { context = { error: String(e?.message || e) }; }

  // Build prompt content
  const hasImageAtt = (attachments || []).some(a => a?.kind === 'image' && a.data);
  const inlinedDocs = (attachments || [])
    .filter(a => a?.kind === 'document' && a.content)
    .map(a => `\n\n--- attached file: ${a.name || 'untitled'} ---\n${a.content}\n--- end ${a.name || ''} ---`)
    .join('');
  const contextTag = task ? buildCardTag(task) : '';
  const messageWithDocs = (contextTag ? contextTag + '\n\n' : '') + message + inlinedDocs;

  const historyTranscript = history.map(h => h.role === 'user' ? `User: ${h.content}` : `Assistant: ${h.content}`).join('\n\n');
  let promptForQuery;
  if (hasImageAtt) {
    const userContent = [];
    if (historyTranscript) userContent.push({ type: 'text', text: historyTranscript + '\n\n' });
    userContent.push({ type: 'text', text: messageWithDocs });
    for (const a of attachments) {
      if (a?.kind !== 'image' || !a.data) continue;
      userContent.push({ type: 'image', source: { type: 'base64', media_type: a.mediaType || 'image/png', data: a.data } });
    }
    promptForQuery = (async function* () { yield { type: 'user', message: { role: 'user', content: userContent } }; })();
  } else {
    promptForQuery = (historyTranscript ? historyTranscript + '\n\n' : '') + `User: ${messageWithDocs}`;
  }

  const baseSystem = buildBaseSystemPrompt(context);
  const filesChanged = new Set();
  let toolCalls = 0;
  let sessionIdSeen = null;
  const abortController = new AbortController();
  // Don't abort on browser disconnect — let the SDK finish so JSONL persists.
  res.on('error', () => {});

  // Make sure ANTHROPIC_API_KEY isn't set so the SDK uses the keychain OAuth token.
  const priorApiKey = process.env.ANTHROPIC_API_KEY;
  if (priorApiKey) delete process.env.ANTHROPIC_API_KEY;

  try {
    const iterator = query({
      prompt: promptForQuery,
      options: {
        cwd: cwdForAgent,
        model,
        permissionMode: 'bypassPermissions',
        appendSystemPrompt: (agentSystemPrompt ? agentSystemPrompt + '\n\n---\n\n' : '') + baseSystem,
        allowedTools: ALLOWED_TOOLS,
        abortController,
        mcpServers: {
          todouz: { type: 'stdio', command: 'node', args: [MCP_SERVER_PATH] },
        },
        ...(resumeSession ? { resume: resumeSession } : {}),
      },
    });

    for await (const event of iterator) {
      if (event.type === 'system' && event.subtype === 'init') {
        sessionIdSeen = event.session_id;
        IN_FLIGHT_CHATS.set(sessionIdSeen, abortController);
        sendEvent({ type: 'system', model: event.model, sessionId: event.session_id, agent });
        continue;
      }
      if (event.type === 'assistant') {
        for (const block of event.message?.content || []) {
          if (block.type === 'text' && block.text) {
            sendEvent({ type: 'text', text: block.text });
          } else if (block.type === 'tool_use') {
            const niceName = block.name.replace(/^mcp__todouz__/, '');
            sendEvent({ type: 'tool_use', name: niceName, input: block.input });
          }
        }
        continue;
      }
      if (event.type === 'user') {
        for (const block of event.message?.content || []) {
          if (block.type !== 'tool_result') continue;
          toolCalls++;
          const text = Array.isArray(block.content)
            ? block.content.map(c => c.text || '').join('')
            : (block.content || '');
          let parsed; try { parsed = JSON.parse(text); } catch { parsed = { text }; }
          if (parsed?.file) filesChanged.add(parsed.file);
          sendEvent({ type: 'tool_result', ok: !block.is_error && !parsed?.error, name: parsed?.toolName || 'tool', result: parsed });
        }
        continue;
      }
      if (event.type === 'result') {
        if (sessionIdSeen) {
          try { await persistSessionMetadata(agent, sessionIdSeen, message, task); }
          catch (err) { sendEvent({ type: 'warning', text: `session metadata write failed: ${err.message}` }); }
        }
        sendEvent({
          type: 'done',
          stopReason: event.subtype,
          toolCalls,
          filesChanged: [...filesChanged],
          numTurns: event.num_turns,
          billing: 'subscription',
          sessionId: sessionIdSeen,
          agent,
        });
        return res.end();
      }
    }
    sendEvent({ type: 'done', stopReason: 'eof', toolCalls, filesChanged: [...filesChanged] });
    res.end();
  } catch (e) {
    const msg = String(e?.message || e);
    try { sendEvent({ type: 'error', error: msg }); } catch {}
    try { res.end(); } catch {}
  } finally {
    if (sessionIdSeen) IN_FLIGHT_CHATS.delete(sessionIdSeen);
    if (priorApiKey) process.env.ANTHROPIC_API_KEY = priorApiKey;
  }
});

app.post('/api/chat/abort', (req, res) => {
  const sessionId = String(req.body?.sessionId || '');
  const ctrl = sessionId ? IN_FLIGHT_CHATS.get(sessionId) : null;
  if (!ctrl) return res.status(404).json({ error: 'no in-flight chat' });
  try { ctrl.abort(); IN_FLIGHT_CHATS.delete(sessionId); } catch {}
  res.json({ ok: true });
});

// ─── /api/sessions/:sid/messages — replay a saved JSONL transcript ───
app.get('/api/sessions/:sid/messages', async (req, res) => {
  const sid = String(req.params.sid);
  if (!/^[a-f0-9-]{36}$/i.test(sid)) return res.status(400).json({ error: 'invalid session id' });
  const projectsDir = join(homedir(), '.claude', 'projects');
  let projects;
  try { projects = await readdir(projectsDir); } catch (e) { return res.status(500).json({ error: e.message }); }
  for (const p of projects) {
    const candidate = join(projectsDir, p, `${sid}.jsonl`);
    try {
      const txt = await readFile(candidate, 'utf8');
      return res.json({ sessionId: sid, messages: parseSessionJsonl(txt) });
    } catch (e) { if (e.code !== 'ENOENT') continue; }
  }
  res.status(404).json({ error: `session ${sid} not found` });
});

function parseSessionJsonl(text) {
  const out = [];
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue;
    let j; try { j = JSON.parse(raw); } catch { continue; }
    const role = j?.message?.role;
    const content = j?.message?.content;
    if (role === 'user' && Array.isArray(content)) {
      const userText = content.filter(b => b.type === 'text').map(b => b.text || '').join('\n')
        .replace(/^\[CARD CONTEXT[^\]]*\][\s\S]*?\[END CARD CONTEXT[^\]]*\]\s*/m, '')
        .replace(/^User:\s*/, '');
      if (userText.trim()) out.push({ role: 'user', text: userText.trim() });
      for (const b of content) {
        if (b.type === 'tool_result') {
          const t = Array.isArray(b.content) ? b.content.map(c => c.text || '').join('') : (b.content || '');
          let parsed; try { parsed = JSON.parse(t); } catch { parsed = { text: t }; }
          out.push({ role: 'assistant', parts: [{ type: 'tool_result', name: 'tool', ok: !b.is_error && !parsed?.error, result: parsed }] });
        }
      }
    } else if (role === 'assistant' && Array.isArray(content)) {
      const parts = [];
      for (const b of content) {
        if (b.type === 'text' && b.text) parts.push({ type: 'text', text: b.text });
        else if (b.type === 'tool_use') parts.push({ type: 'tool_use', name: (b.name || '').replace(/^mcp__todouz__/, ''), input: b.input });
      }
      if (parts.length) out.push({ role: 'assistant', parts });
    }
  }
  return out;
}

// ─── helpers ──────────────────────────────────────────────────────────

function buildCardTag(task) {
  // task = { id, kind, title, due, epic_slug, agent, ... } from the issue/event the user clicked.
  const kind = (task.kind || 'item').toUpperCase();
  const epic = task.epic_slug ? ` · epic=${task.epic_slug}` : '';
  const date = task.due ? ` · due=${task.due}` : '';
  const id = task.id ? `id: ${task.id}\n` : '';
  return `[CARD CONTEXT — ${kind}${epic}${date}]\n${id}${task.title || task.text || ''}\n[END CARD CONTEXT — your reply is about THIS card unless I explicitly switch topic]`;
}

function buildBaseSystemPrompt(ctx) {
  return `You are an agent in todouz — the user's personal task manager. Today's situation:

\`\`\`json
${JSON.stringify(ctx?.today || {}, null, 2)}
\`\`\`

The next 7 days:

\`\`\`json
${JSON.stringify(ctx?.upcoming || {}, null, 2)}
\`\`\`

User profile (excerpt — may be empty if not yet populated):

${ctx?.profile || '(no profile loaded)'}

OPERATING RULES:
- Always-act-first. If an action is implied, call the right tool BEFORE replying.
- Use create_issue / update_issue / complete_issue / add_subtask / toggle_subtask / append_to_epic / add_event for state changes.
- "Capture from user" messages (wrapped in [CAPTURE FROM USER]) are work to act on, not questions. Extract every action verb and call the right tool. Don't ask clarifying questions unless genuinely ambiguous.
- End with a 1–2 line summary of what changed. Don't restate what's still on the list.
- Energy-based framing wins. Don't moralise.`;
}

async function persistSessionMetadata(agent, sessionId, firstMsg, task) {
  const path = join(DATA_ROOT, 'state', 'session-links.json');
  await mkdir(dirname(path), { recursive: true });
  let links = {};
  try { links = JSON.parse(await readFile(path, 'utf8')); } catch {}
  const existing = links[sessionId] || {};
  links[sessionId] = {
    agent,
    issue_ids: task?.id ? Array.from(new Set([...(existing.issue_ids || []), task.id])) : (existing.issue_ids || []),
    first_message_excerpt: existing.first_message_excerpt || firstMsg.slice(0, 240),
    last_updated: new Date().toISOString(),
    turn_count: (existing.turn_count || 0) + 1,
  };
  await writeFile(path, JSON.stringify(links, null, 2) + '\n');
}

// ─── static dashboard ────────────────────────────────────────────────
app.use('/dashboard', express.static(join(TODOUZ_ROOT, 'dashboard')));
app.use('/data', express.static(join(TODOUZ_ROOT, 'data')));
app.get('/', (_req, res) => res.redirect('/dashboard/'));

// ─── start ───────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`todouz http server on http://localhost:${PORT}`);
  console.log(`  dashboard: http://localhost:${PORT}/dashboard/`);
  console.log(`  data root: ${DATA_ROOT}`);
  console.log(`  default model: ${DEFAULT_MODEL}`);
});

// Per-socket error guards. Without these, an EPIPE on a half-closed socket can
// surface as an unhandled 'error' event on the socket instance even if we have
// a process-level uncaughtException handler.
server.on('clientError', (_err, socket) => {
  try { socket.destroy(); } catch {}
});
server.on('connection', (socket) => {
  socket.on('error', () => { /* swallow */ });
});
