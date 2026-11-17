#!/usr/bin/env node
// todouz HTTP server.
// - Serves the dashboard SPA at /dashboard/
// - Wraps every tool from tools.mjs at /api/<tool_name>
// - /api/chat — NDJSON stream from @anthropic-ai/claude-agent-sdk's query()
//
// Auth: re-uses the local Claude CLI's OAuth token in macOS Keychain.
// No Anthropic API key, no per-message billing.

import './tz.mjs';   // first: pin local time to the user's timezone before any date is computed
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
import { createRequire } from 'node:module';

import { TOOLS, handleCall, safeReplacer, linkAttachment, unlinkAttachment, collectReminders } from './tools.mjs';
import { initPush, vapidPublicKey, addSubscription, removeSubscription, sendToAll, subscriptionCount, startReminderScheduler } from './push.mjs';
import { TODOUZ_ROOT, DATA_ROOT } from './store.mjs';
import { startRoutineScheduler, listRoutines, getRoutine, saveRoutine, deleteRoutine, enqueueRoutine, listRuns, routineStatus } from './routines.mjs';
import { refillFeed } from './feed-refill.mjs';
import { runLinkPass, pendingItems } from './brain-links.mjs';
import { sourcesStatus, writeSourceConfig, WORKSPACES } from './sources.mjs';
import { createShare, retryShare, pendingShareCount } from './shares.mjs';
import { reindexAll, syncEventsFromDisk, getStats as getDbStats, DB_FILE } from './db.mjs';
import { saveAttachmentFromStream, saveAttachmentBytes, getAttachmentMeta, attachmentStream, deleteAttachment, isValidId } from './attachments.mjs';

const execFileP = promisify(execFile);

// ─── agent SDK native CLI ─────────────────────────────────────────────
// The SDK probes `claude-agent-sdk-linux-<arch>-musl` BEFORE the glibc
// package and uses whatever resolves — which breaks on glibc images where the
// musl package is present-but-unusable. Resolve it ourselves, checking the
// file actually EXISTS, and hand the SDK an explicit path. CLAUDE_CODE_PATH
// overrides everything if you ever want to point at a system install.
const _req = createRequire(import.meta.url);
function resolveClaudeBinary() {
  if (process.env.CLAUDE_CODE_PATH && existsSync(process.env.CLAUDE_CODE_PATH)) {
    return process.env.CLAUDE_CODE_PATH;
  }
  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude';
  // glibc before musl — the opposite of the SDK's own order.
  const candidates = process.platform === 'linux'
    ? [`linux-${process.arch}`, `linux-${process.arch}-musl`]
    : [`${process.platform}-${process.arch}`];
  for (const c of candidates) {
    try {
      const p = _req.resolve(`@anthropic-ai/claude-agent-sdk-${c}/${exe}`);
      if (existsSync(p)) return p;
    } catch {}
  }
  return null;
}
const CLAUDE_BIN = resolveClaudeBinary();

// The CLI refuses --dangerously-skip-permissions (permissionMode
// 'bypassPermissions') when running as root — which containers do by default:
//   "--dangerously-skip-permissions cannot be used with root/sudo privileges"
// We don't actually need it: `allowedTools` already whitelists every todouz
// MCP tool explicitly, so 'default' mode runs them without prompting while
// refusing anything we didn't list. Least privilege, and it boots as root.
const IS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;
const PERMISSION_MODE = IS_ROOT ? 'default' : 'bypassPermissions';
const __filename = fileURLToPath(import.meta.url);
const SERVER_DIR = dirname(__filename);
const PORT = Number(process.env.PORT || 8765);
const DEFAULT_MODEL = process.env.TODOUZ_MODEL || 'claude-sonnet-5';
const MCP_SERVER_PATH = join(SERVER_DIR, 'index.mjs');
const ALLOWED_TOOLS = TOOLS.map(t => `mcp__todouz__${t.name}`);
const BUILTIN_AGENT_TOOLS = ['Bash', 'BashOutput', 'KillShell', 'Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Glob', 'Grep', 'LS', 'Task', 'WebFetch', 'WebSearch'];

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

// ─── accounts, sessions, API keys (auth.mjs) + access control (access.mjs) ─
// Users live in data/state/users.json (scrypt-hashed passwords, roles, personal
// API keys). TODOUZ_USERS only seeds users that don't exist yet. Every request
// is identified as { user, role } and runs inside runAs(), so every tool call
// below it is checked against what that user may see and change.
//
// Ways in:
//   - session cookie from /login (HttpOnly, SameSite=Lax, Secure behind https)
//   - Authorization: Bearer tdz_…  — a personal API key (acts as that user)
//   - Authorization: Bearer $TODOUZ_API_KEY — the install's admin key, acting as
//     LEGACY_OWNER with the admin role (kept so existing integrations still work)
// With no users at all (local dev) auth is off and the caller is the operator.
import { timingSafeEqual } from 'node:crypto';
import * as auth from './auth.mjs';
import { runAs, envForCtx, LEGACY_OWNER, readVisibility, writeVisibility, categoryVisibleTo, catOfRow, stampLegacyOwners } from './access.mjs';

const ADMIN_API_KEY = process.env.TODOUZ_API_KEY || null;
const SIGNUP_OPEN = process.env.TODOUZ_SIGNUP === 'open';
await auth.bootstrapUsers();
// Production never runs open: with no users it locks until TODOUZ_USERS is set.
const AUTH_ENABLED = (await auth.hasUsers()) || process.env.NODE_ENV === 'production';
if ((await stampLegacyOwners()).eventsChanged) await syncEventsFromDisk();

function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
const clientIp = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '';
const isHttps = (req) => req.headers['x-forwarded-proto'] === 'https' || req.secure;

// → { user, role, via } | { invalid: true } | null
async function identify(req) {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
  if (m) {
    if (ADMIN_API_KEY && safeEq(m[1], ADMIN_API_KEY)) return { user: LEGACY_OWNER, role: 'admin', via: 'admin-key' };
    const k = await auth.verifyKey(m[1]);
    return k ? { ...k, via: 'key' } : { invalid: true };
  }
  const s = await auth.verifySession(getCookie(req, 'todouz_session'));
  return s ? { ...s, via: 'session' } : null;
}
const isAdminReq = (req) => !AUTH_ENABLED || req.todouzRole === 'admin';
function requireAdmin(req, res) {
  if (isAdminReq(req)) return true;
  res.status(403).json({ error: 'admins only' });
  return false;
}
function setSessionCookie(req, res, token) {
  const secure = isHttps(req) ? '; Secure' : '';
  res.setHeader('Set-Cookie', `todouz_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${auth.SESSION_MAX_AGE_S}${secure}`);
}

// Baseline hardening headers for every response.
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

const LOGIN_PAGE = `<!doctype html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"/>
<title>todouz — sign in</title>
<link rel="manifest" href="/dashboard/manifest.webmanifest"/>
<meta name="theme-color" content="#faf8f4"/>
<meta name="mobile-web-app-capable" content="yes"/>
<meta name="apple-mobile-web-app-capable" content="yes"/>
<meta name="apple-mobile-web-app-status-bar-style" content="default"/>
<meta name="apple-mobile-web-app-title" content="todouz"/>
<link rel="apple-touch-icon" href="/dashboard/apple-touch-icon.png"/>
<link rel="icon" type="image/png" sizes="32x32" href="/dashboard/favicon-32.png"/>
<style>
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:#faf8f4; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; color:#1a1714; }
  .card { background:#fff; border:1px solid rgba(26,23,20,0.08); border-radius:14px;
          box-shadow:0 8px 24px rgba(26,23,20,0.08); padding:36px 32px; width:min(360px, 88vw); }
  h1 { font-size:26px; margin:0 0 4px; letter-spacing:-0.02em; }
  p { margin:0 0 20px; color:#5a534b; font-size:13px; }
  label { display:block; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.1em; color:#5a534b; margin-bottom:6px; }
  input { width:100%; box-sizing:border-box; padding:11px 12px; margin-bottom:14px; font-size:16px;
          border:1px solid rgba(26,23,20,0.16); border-radius:8px; outline:none; background:#faf8f4; }
  input:focus { border-color:#c2410c; }
  button { width:100%; padding:12px; background:#c2410c; color:#fff; font-size:14px; font-weight:600;
           border:none; border-radius:8px; cursor:pointer; }
  button:disabled { opacity:0.6; cursor:default; }
  .err { color:#b91c1c; font-size:13px; margin-bottom:12px; display:none; }
  .switch { margin-top:16px; font-size:13px; text-align:center; color:#5a534b; }
  .switch a { color:#c2410c; cursor:pointer; text-decoration:underline; }
</style></head><body>
<div class="card">
  <h1>todouz</h1>
  <p id="sub">sign in to your life OS</p>
  <div class="err" id="err"></div>
  <form id="f">
    <label>Username</label><input id="u" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required />
    <label>Password</label><input id="p" type="password" autocomplete="current-password" required />
    <button type="submit" id="go">Sign in</button>
  </form>
  __SIGNUP__
</div>
<script>
let mode = 'login';
const $ = (id) => document.getElementById(id);
function setMode(m) {
  mode = m;
  $('go').textContent = m === 'login' ? 'Sign in' : 'Create account';
  $('sub').textContent = m === 'login' ? 'sign in to your life OS' : 'create your account (password: 10+ characters)';
  $('p').autocomplete = m === 'login' ? 'current-password' : 'new-password';
  const s = $('swap'); if (s) s.textContent = m === 'login' ? 'Create an account' : 'I already have an account';
  $('err').style.display = 'none';
}
const sw = $('swap'); if (sw) sw.addEventListener('click', () => setMode(mode === 'login' ? 'signup' : 'login'));
$('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('go').disabled = true;
  try {
    const r = await fetch(mode === 'login' ? '/api/login' : '/api/signup', { method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ username: $('u').value.trim().toLowerCase(), password: $('p').value }) });
    if (r.ok) { location.href = '/dashboard/'; return; }
    const j = await r.json().catch(() => ({}));
    $('err').textContent = j.error || 'something went wrong'; $('err').style.display = 'block';
  } finally { $('go').disabled = false; }
});
</script></body></html>`;
const loginPage = () => LOGIN_PAGE.replace('__SIGNUP__', SIGNUP_OPEN ? '<div class="switch"><a id="swap">Create an account</a></div>' : '');

app.get('/login', (_req, res) => { res.type('html').send(loginPage()); });

app.post('/api/login', async (req, res) => {
  if (!AUTH_ENABLED) return res.json({ ok: true, note: 'auth disabled' });
  const { username, password } = req.body || {};
  const r = await auth.login(username, password, clientIp(req));
  if (r.error) return res.status(r.status || 401).json({ error: r.error });
  setSessionCookie(req, res, r.token);
  res.json({ ok: true, user: r.user.username, role: r.user.role });
});

app.post('/api/signup', async (req, res) => {
  if (!SIGNUP_OPEN) return res.status(403).json({ error: 'sign-up is closed — ask an admin for an account' });
  const { username, password } = req.body || {};
  const c = await auth.createUser({ username, password, role: 'member' });
  if (c.error) return res.status(400).json({ error: c.error });
  const r = await auth.login(username, password, clientIp(req));
  if (r.error) return res.status(r.status || 401).json({ error: r.error });
  setSessionCookie(req, res, r.token);
  res.json({ ok: true, user: r.user.username, role: r.user.role });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', `todouz_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isHttps(req) ? '; Secure' : ''}`);
  res.json({ ok: true });
});

// Gate everything else when auth is enabled, and run the rest of the request as
// the caller. The PWA install assets must load without auth — the browser fetches
// the manifest and icons from the (public) login page. They carry no user data.
const PWA_PUBLIC = /^\/dashboard\/(manifest\.webmanifest|sw\.js|apple-touch-icon\.png|icon-\d+\.png|favicon-\d+\.png|logo\.png)$/;
app.use(async (req, res, next) => {
  if (!AUTH_ENABLED) return next();
  if (req.path === '/login' || req.path === '/api/login' || req.path === '/api/signup' || req.path === '/api/healthz') return next();
  if (PWA_PUBLIC.test(req.path)) return next();
  let who = null;
  try { who = await identify(req); } catch { who = null; }
  if (who && !who.invalid) {
    req.todouzUser = who.user;
    req.todouzRole = who.role;
    req.todouzVia = who.via;
    req.todouzCtx = { user: who.user, role: who.role };
    return runAs(req.todouzCtx, next);
  }
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: who?.invalid ? 'invalid API key' : 'not authenticated' });
  return res.redirect('/login');
});

// ─── your account ────────────────────────────────────────────────────
app.get('/api/me', async (req, res) => {
  if (!AUTH_ENABLED) return res.json({ ok: true, auth_enabled: false, user: null, role: 'admin' });
  const u = await auth.getUser(req.todouzUser);
  res.json({ ok: true, auth_enabled: true, signup_open: SIGNUP_OPEN, via: req.todouzVia, ...(u ? auth.publicUser(u) : { username: req.todouzUser, role: req.todouzRole, keys: [] }), user: req.todouzUser });
});
// Account changes need a real sign-in, not an API key: a leaked key must not be
// able to mint more keys or lock the owner out.
function requireSession(req, res) {
  if (!AUTH_ENABLED) { res.status(400).json({ error: 'accounts are off on this install (no users configured)' }); return false; }
  if (req.todouzVia !== 'session') { res.status(403).json({ error: 'sign in to the dashboard to change your account' }); return false; }
  return true;
}
app.post('/api/me/password', async (req, res) => {
  if (!requireSession(req, res)) return;
  const { current, next: nextPw } = req.body || {};
  const r = await auth.changeOwnPassword(req.todouzUser, current, nextPw);
  if (r.error) return res.status(400).json(r);
  // The old cookie was just revoked with every other session; issue a fresh one here.
  const l = await auth.login(req.todouzUser, nextPw, clientIp(req));
  if (l.token) setSessionCookie(req, res, l.token);
  res.json({ ok: true });
});
app.post('/api/me/logout-all', async (req, res) => {
  if (!requireSession(req, res)) return;
  const r = await auth.signOutEverywhere(req.todouzUser);
  res.setHeader('Set-Cookie', `todouz_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isHttps(req) ? '; Secure' : ''}`);
  res.json(r);
});
app.post('/api/me/keys', async (req, res) => {
  if (!requireSession(req, res)) return;
  const r = await auth.createKey(req.todouzUser, (req.body || {}).name);
  res.status(r.error ? 400 : 200).json(r);
});
app.delete('/api/me/keys/:id', async (req, res) => {
  if (!requireSession(req, res)) return;
  const r = await auth.revokeKey(req.todouzUser, String(req.params.id));
  res.status(r.error ? 404 : 200).json(r);
});

// ─── user management (admins) ────────────────────────────────────────
app.get('/api/admin/users', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json({ ok: true, users: await auth.listUsers(), signup_open: SIGNUP_OPEN });
});
app.post('/api/admin/users', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { username, password, role } = req.body || {};
  const r = await auth.createUser({ username, password, role });
  res.status(r.error ? 400 : 200).json(r);
});
app.patch('/api/admin/users/:username', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { role, disabled, password } = req.body || {};
  const r = await auth.updateUser(String(req.params.username), { role, disabled, password });
  res.status(r.error ? 400 : 200).json(r);
});
app.delete('/api/admin/users/:username', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  if (String(req.params.username).toLowerCase() === req.todouzUser) return res.status(400).json({ error: 'you cannot delete your own account' });
  const r = await auth.deleteUser(String(req.params.username));
  res.status(r.error ? 400 : 200).json(r);
});

// ─── attachments (files + notes linked to items) ──────────────────────
// Behind the auth gate above. Bytes live under data/attachments/ (see
// attachments.mjs); an item's `attachments` frontmatter holds the linked ids.
function parseIssueRef(ref) {
  // "<cat>/<short>/<ISS-id>" → { epic: "<cat>/<short>", id: "ISS-id" }
  const parts = String(ref || '').split('/');
  if (parts.length < 3) return null;
  const id = parts.pop();
  return { epic: parts.join('/'), id };
}

// Attachments belong to whoever uploaded them (legacy files: LEGACY_OWNER).
function canUseAttachment(req, meta) {
  if (!AUTH_ENABLED) return true;
  return (meta.owner || LEGACY_OWNER) === req.todouzUser;
}

// Upload: the raw file is the request body (Content-Type = the file's type, so
// express.json never touches it); filename/mime/issue come in on the query.
app.post('/api/attachments/upload', async (req, res) => {
  try {
    const filename = req.query.filename ? decodeURIComponent(req.query.filename) : 'file';
    const mime = req.query.mime || req.headers['content-type'] || 'application/octet-stream';
    if (req.query.issue) {
      const ref = parseIssueRef(req.query.issue);
      if (ref && (await handleCall('get_issue', { id: ref.id, epic: ref.epic }))?.error) return res.status(404).json({ error: 'not found' });
    }
    const meta = await saveAttachmentFromStream(req, { filename, mime, owner: req.todouzUser || LEGACY_OWNER });
    if (req.query.issue) {
      const ref = parseIssueRef(req.query.issue);
      if (ref) await linkAttachment(ref.epic, ref.id, meta.id);
    }
    res.json(meta);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Metadata for a set of ids: /api/attachments?ids=a,b,c
app.get('/api/attachments', async (req, res) => {
  const ids = String(req.query.ids || '').split(',').map(s => s.trim()).filter(Boolean);
  const attachments = [];
  for (const id of ids) { const m = await getAttachmentMeta(id); if (m && canUseAttachment(req, m)) attachments.push(m); }
  res.json({ attachments });
});

// Download / inline view. ?download=1 forces a save dialog.
app.get('/api/attachments/:id', async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ error: 'bad id' });
  const meta = await getAttachmentMeta(id);
  if (!meta || !canUseAttachment(req, meta)) return res.status(404).json({ error: 'not found' });
  res.setHeader('Content-Type', meta.mime || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');   // don't let a .txt sniff into HTML
  const disp = req.query.download ? 'attachment' : 'inline';
  res.setHeader('Content-Disposition', `${disp}; filename*=UTF-8''${encodeURIComponent(meta.filename)}`);
  attachmentStream(id).on('error', () => { if (!res.headersSent) res.status(404).end(); }).pipe(res);
});

// Delete the bytes and unlink from the item (pass ?issue=<cat>/<short>/<id>).
app.delete('/api/attachments/:id', async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ error: 'bad id' });
  const meta = await getAttachmentMeta(id);
  if (!meta || !canUseAttachment(req, meta)) return res.status(404).json({ error: 'not found' });
  if (req.query.issue) {
    const ref = parseIssueRef(req.query.issue);
    if (ref) await unlinkAttachment(ref.epic, ref.id, id);
  }
  await deleteAttachment(id);
  res.json({ ok: true });
});

// ─── settings (surfaced in the dashboard Settings sheet) ──────────────
// Behind the auth gate, so only a logged-in session (or the bearer key) sees
// the API key. base_url is derived from the request so it's correct on prod
// (your own domain) and locally alike.
app.get('/api/settings', (req, res) => {
  const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
  const base = `${proto}://${req.headers.host}`;
  res.json({
    base_url: base,
    // The install-wide admin key is for admins only; everyone else connects AI
    // sessions with a personal key from /api/me/keys.
    api_key: isAdminReq(req) ? (ADMIN_API_KEY || null) : null,
    auth_enabled: AUTH_ENABLED,
    user: req.todouzUser || null,
    role: req.todouzRole || (AUTH_ENABLED ? null : 'admin'),
    tool_names: TOOLS.map(t => t.name),
  });
});

// ─── admin data sync (bearer TODOUZ_API_KEY) ──────────────────────────
// Everything under data/ is text (markdown + json), so the bundle is a flat
// { "relative/path": "content" } map. index.db* is rebuildable and skipped.
// attachments/ holds binary files (PDFs, images) that can't ride in a utf8 text
// bundle — they live in the mounted volume and are excluded from the sync/wipe.
const SYNC_SKIP = /(^|\/)(index\.db(-shm|-wal)?|\.DS_Store)$|\.pre-merge-backup$|\.deprecated$|^attachments(\/|$)/;
async function walkDataFiles(dirRel = '') {
  const { readdir: rd } = await import('node:fs/promises');
  const out = [];
  const abs = join(DATA_ROOT, dirRel);
  let entries = [];
  try { entries = await rd(abs, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const rel = dirRel ? `${dirRel}/${e.name}` : e.name;
    if (SYNC_SKIP.test(rel)) continue;
    if (e.isDirectory()) out.push(...await walkDataFiles(rel));
    else out.push(rel);
  }
  return out;
}

app.get('/api/admin/export-data', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const files = await walkDataFiles();
    const bundle = {};
    for (const f of files) bundle[f] = await readFile(join(DATA_ROOT, f), 'utf8');
    res.json({ ok: true, exported_at: new Date().toISOString(), file_count: files.length, files: bundle });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

app.post('/api/admin/import-data', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { files, wipe = false } = req.body || {};
  if (!files || typeof files !== 'object') return res.status(400).json({ error: 'body must be { files: { "path": "content", … }, wipe? }' });
  try {
    if (wipe) {
      // Remove existing markdown/json data (but never the rebuildable index —
      // it gets rebuilt below anyway).
      const existing = await walkDataFiles();
      const { rm } = await import('node:fs/promises');
      for (const f of existing) await rm(join(DATA_ROOT, f), { force: true });
    }
    let written = 0;
    for (const [rel, content] of Object.entries(files)) {
      if (rel.includes('..') || rel.startsWith('/')) continue;      // path traversal guard
      if (SYNC_SKIP.test(rel)) continue;
      const absPath = join(DATA_ROOT, rel);
      await mkdir(dirname(absPath), { recursive: true });
      await writeFile(absPath, String(content), 'utf8');
      written++;
    }
    auth.reloadUsers();
    await stampLegacyOwners();
    const r = await reindexAll();
    res.json({ ok: true, written, wiped: !!wipe, reindexed: r.ok, counts: r.counts });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

// ─── UI preferences (per user, server-side) ───────────────────────────
// Category order used to live in localStorage, which is per-browser — so an
// order set on the desktop could never reach the phone. It belongs on the
// server, keyed by user so the user reordering doesn't rearrange another member's board.
// Deliberately NOT an MCP tool: this is chrome, not something the agent acts on.
const UI_PREFS_REL = 'state/ui-prefs.json';
const uiPrefsUser = (req) => req.todouzUser || 'default';

async function readUiPrefs() {
  try { return JSON.parse(await readFile(join(DATA_ROOT, UI_PREFS_REL), 'utf8')); }
  catch { return {}; }
}

app.get('/api/ui-prefs', async (req, res) => {
  try {
    const all = await readUiPrefs();
    res.json({ ok: true, user: uiPrefsUser(req), prefs: all[uiPrefsUser(req)] || {} });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

app.post('/api/ui-prefs', async (req, res) => {
  try {
    const patch = req.body || {};
    // Whitelist: this file is user-writable, so only known keys with the right
    // shape get through — no arbitrary blobs accumulating in the data dir.
    const clean = {};
    if (Array.isArray(patch.categoryOrder)) {
      clean.categoryOrder = patch.categoryOrder.filter(c => typeof c === 'string').slice(0, 100);
    }
    if (!Object.keys(clean).length) return res.status(400).json({ error: 'nothing to save' });
    const u = uiPrefsUser(req);
    const all = await readUiPrefs();
    all[u] = { ...(all[u] || {}), ...clean };
    await mkdir(dirname(join(DATA_ROOT, UI_PREFS_REL)), { recursive: true });
    await writeFile(join(DATA_ROOT, UI_PREFS_REL), JSON.stringify(all, null, 2) + '\n', 'utf8');
    res.json({ ok: true, user: u, prefs: all[u] });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

// ─── agent config (which model/provider the "Ask agent" chat uses) ────
// mode 'local'     → the Claude Code session baked into the container (your
//                    subscription's OAuth token). No key needed.
// mode 'anthropic' → the SAME Claude Agent SDK + todouz tools, but billed to a
//                    user-supplied Anthropic API key (set for the query only).
// The API key is secret: stored here, NEVER returned to the browser (the GET
// reports only whether one is on file). Each mode has a default model with an
// optional override.
const AGENT_CONFIG_REL = 'state/agent-config.json';
const AGENT_MODES = ['local', 'anthropic'];
const DEFAULT_AGENT_MODELS = { local: DEFAULT_MODEL, anthropic: DEFAULT_MODEL };

async function readAgentConfig() {
  let raw = {};
  try { raw = JSON.parse(await readFile(join(DATA_ROOT, AGENT_CONFIG_REL), 'utf8')); } catch {}
  const mode = AGENT_MODES.includes(raw.mode) ? raw.mode : 'local';
  const models = { ...DEFAULT_AGENT_MODELS, ...(raw.models && typeof raw.models === 'object' ? raw.models : {}) };
  return { mode, models, anthropic_key: typeof raw.anthropic_key === 'string' ? raw.anthropic_key : '' };
}
async function writeAgentConfig(cfg) {
  await mkdir(dirname(join(DATA_ROOT, AGENT_CONFIG_REL)), { recursive: true });
  await writeFile(join(DATA_ROOT, AGENT_CONFIG_REL), JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}

app.get('/api/agent-config', async (_req, res) => {
  try {
    const cfg = await readAgentConfig();
    res.json({
      ok: true,
      mode: cfg.mode,
      models: cfg.models,
      defaults: DEFAULT_AGENT_MODELS,
      modes: AGENT_MODES,
      anthropic_key_set: !!cfg.anthropic_key,   // presence only — never the value
    });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

app.post('/api/agent-config', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const b = req.body || {};
    const cur = await readAgentConfig();
    const next = { mode: cur.mode, models: { ...cur.models }, anthropic_key: cur.anthropic_key };
    if (typeof b.mode === 'string') {
      if (!AGENT_MODES.includes(b.mode)) return res.status(400).json({ error: 'invalid mode' });
      next.mode = b.mode;
    }
    if (b.models && typeof b.models === 'object') {
      for (const m of AGENT_MODES) {
        if (typeof b.models[m] === 'string') {
          const v = b.models[m].trim().slice(0, 80);
          next.models[m] = v || DEFAULT_AGENT_MODELS[m];
        }
      }
    }
    // anthropic_key: a non-empty string SETS it; explicit "" / null CLEARS it;
    // omitting the field leaves it unchanged (flip modes without re-typing).
    if ('anthropic_key' in b) {
      next.anthropic_key = (typeof b.anthropic_key === 'string' && b.anthropic_key.trim()) ? b.anthropic_key.trim() : '';
    }
    if (next.mode === 'anthropic' && !next.anthropic_key) {
      return res.status(400).json({ error: 'Add an Anthropic API key before switching to API-key mode.' });
    }
    await writeAgentConfig(next);
    res.json({ ok: true, mode: next.mode, models: next.models, anthropic_key_set: !!next.anthropic_key });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

// ─── category visibility (per-user, server-side) ──────────────────────
// A shared household deployment (two people) reads one data dir, so by
// default everyone sees every category. This lets a category be made PRIVATE
// to its owner: kitchen stays shared, the rest can be hidden from the other
// person. Enforced on the dashboard read endpoints below (list_* / get_issue /
// get_epic), keyed by the logged-in user. NOT enforced inside the in-app agent
// — it reads all data server-side — so this is honest visibility, not hard
// multi-tenant isolation. Deliberately a plain route, not an MCP tool.
//
// Shape: { "<category>": { shared: bool, owner: "<user>" } }
//   missing entry or shared:true → visible to everyone (default open)
//   shared:false                 → visible only to `owner`
app.get('/api/category-visibility', async (req, res) => {
  try {
    // Only the entries this user can see — the names of someone else's private lists are theirs too.
    const vis = await readVisibility();
    const mine = Object.fromEntries(Object.entries(vis).filter(([cat]) => categoryVisibleTo(cat, req.todouzUser, vis)));
    res.json({ ok: true, user: req.todouzUser || null, users: (await auth.listUsers()).filter(u => !u.disabled).map(u => u.username), visibility: req.todouzUser ? mine : vis });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

app.post('/api/category-visibility', async (req, res) => {
  try {
    const user = req.todouzUser || null;
    const category = String((req.body || {}).category || '').trim();
    const shared = !!(req.body || {}).shared;
    if (!category) return res.status(400).json({ error: 'category required' });
    const vis = await readVisibility();
    const cur = vis[category];
    // Only the owner of a private list (or anyone, for a shared one they can see) may flip it.
    if (user && !categoryVisibleTo(category, user, vis)) return res.status(404).json({ error: 'not found' });
    if (user && cur?.shared && !shared && req.todouzRole !== 'admin') {
      return res.status(403).json({ error: 'only an admin can make a shared category private' });
    }
    // Making it private stamps you as owner; sharing clears the restriction.
    vis[category] = shared ? { shared: true } : { shared: false, owner: user || cur?.owner || LEGACY_OWNER };
    await writeVisibility(vis);
    res.json({ ok: true, category, visibility: vis[category] });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

// ─── which categories appear on the Projects board ───────────────────
// A display flag, not access control. A category is on the Projects board
// iff its entry here is { in_projects: true }. Missing entry = not on the
// board — Projects is opt-in per list (unlike visibility, which is open by
// default). Same JSON-store pattern as visibility above.
const PROJECTS_REL = 'state/projects.json';
async function readProjectsFlags() {
  try { return JSON.parse(await readFile(join(DATA_ROOT, PROJECTS_REL), 'utf8')); }
  catch { return {}; }
}
async function writeProjectsFlags(v) {
  await mkdir(dirname(join(DATA_ROOT, PROJECTS_REL)), { recursive: true });
  await writeFile(join(DATA_ROOT, PROJECTS_REL), JSON.stringify(v, null, 2) + '\n', 'utf8');
}
app.get('/api/category-projects', async (_req, res) => {
  try { res.json({ ok: true, projects: await readProjectsFlags() }); }
  catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});
app.post('/api/category-projects', async (req, res) => {
  try {
    const category = String((req.body || {}).category || '').trim();
    const included = !!(req.body || {}).included;
    if (!category) return res.status(400).json({ error: 'category required' });
    if (req.todouzUser && !categoryVisibleTo(category, req.todouzUser, await readVisibility())) return res.status(404).json({ error: 'not found' });
    const flags = await readProjectsFlags();
    if (included) flags[category] = { in_projects: true };
    else delete flags[category];
    await writeProjectsFlags(flags);
    res.json({ ok: true, category, in_projects: included });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

// ─── web push (reminders) ─────────────────────────────────────────────
// The browser fetches the VAPID public key, subscribes via the service worker,
// and POSTs the subscription here. The reminder scheduler (started below) pushes
// to every stored subscription when a session/item reminder comes due.
app.get('/api/push/vapid', (_req, res) => {
  const key = vapidPublicKey();
  if (!key) return res.status(503).json({ error: 'push not initialised yet' });
  res.json({ publicKey: key });
});
app.post('/api/push/subscribe', async (req, res) => {
  try {
    const sub = (req.body || {}).subscription || req.body;
    const r = await addSubscription(sub, req.todouzUser || null);
    res.status(r.error ? 400 : 200).json(r);
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});
app.post('/api/push/unsubscribe', async (req, res) => {
  try {
    const endpoint = (req.body || {}).endpoint || ((req.body || {}).subscription || {}).endpoint;
    if (!endpoint) return res.status(400).json({ error: 'endpoint required' });
    res.json(await removeSubscription(endpoint));
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});
app.post('/api/push/test', async (req, res) => {
  try {
    const me = req.todouzUser || LEGACY_OWNER;
    const r = await sendToAll({ title: '🔔 todouz reminders on', body: 'This is a test — reminders will arrive like this.', url: `${(process.env.TODOUZ_PUBLIC_URL || '')}/dashboard/` }, { only: (u) => u === me });
    res.json(r);
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});
app.get('/api/push/status', async (_req, res) => {
  try { res.json({ enabled: !!vapidPublicKey(), subscriptions: await subscriptionCount() }); }
  catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

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
      // Linux: a signed-in CLI always has .credentials.json; sessions/ +
      // history.jsonl only appear after the CLI has actually been used, so
      // they're a fallback signal, not a requirement.
      const dot = join(homedir(), '.claude');
      authed = existsSync(join(dot, '.credentials.json'))
        || (existsSync(join(dot, 'sessions')) && existsSync(join(dot, 'history.jsonl')));
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
    agent_binary: CLAUDE_BIN,
    permission_mode: PERMISSION_MODE,
    running_as_root: IS_ROOT,
    login_required: AUTH_ENABLED,
    model: DEFAULT_MODEL,
    dataRoot: DATA_ROOT,
  });
});

// ─── REST wrappers — one per tool ─────────────────────────────────────
// Pattern: GET /api/<tool> for read tools (args via query), POST /api/<tool> for writes.
// We accept both POST + GET on every tool for simplicity; the body/query are merged.
// Reads may be GET (handy from curl); anything that changes data must be POST,
// so a link clicked on another site can never trigger a write with your cookie.
const READ_TOOL = /^(list_|get_|read_)|^brain_(context|search|read|history|links)$|^feed_(list|taste)$|^share_list$|^workspace_read$/;
for (const tool of TOOLS) {
  const handler = async (req, res) => {
    if (req.method === 'GET' && !READ_TOOL.test(tool.name)) return res.status(405).json({ error: `${tool.name} changes data: use POST` });
    const args = { ...(req.query || {}), ...(req.body || {}) };
    // Coerce numeric query params (Express gives them as strings)
    for (const [k, v] of Object.entries(args)) {
      if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) args[k] = Number(v);
      if (v === 'true') args[k] = true;
      if (v === 'false') args[k] = false;
    }
    // Second-brain provenance: when the caller doesn't name itself, record who
    // wrote it — the logged-in dashboard user by name, a bearer-key caller as "api".
    if (/^(brain|feed)_/.test(tool.name) && (!args.source || args.source === 'dashboard')) {
      args.source = req.todouzUser || (args.source === 'dashboard' ? 'dashboard' : 'api');
    }
    try {
      const result = await handleCall(tool.name, args);
      // New or changed knowledge: let the Brain link it shortly.
      if (/^(brain_(write|capture|revert)|feed_post)$/.test(tool.name) && result && !result.error) kickLinker();
      // Access control already ran inside handleCall (runAs set by the auth gate).
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
  const m = /^epics\/([a-z0-9-]+)\//.exec(path);
  if (AUTH_ENABLED) {
    if (m) {
      if (!categoryVisibleTo(m[1], req.todouzUser, await readVisibility())) return res.status(404).json({ error: 'not found' });
    } else if (!isAdminReq(req)) {
      return res.status(404).json({ error: 'not found' });
    }
  }
  try {
    const content = await readFile(join(DATA_ROOT, path), 'utf8');
    res.json({ path, content });
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

// ─── headless one-shot generation (no chat session, no MCP tools) ─────
// A pure text→text call to the agent model, used by "Generate HTML" and the
// HTML editor's "let AI apply my change" flow. No mcpServers/tools so it can't
// touch data — it just returns text.
async function runOneShot(prompt) {
  const prior = process.env.ANTHROPIC_API_KEY;
  if (prior) delete process.env.ANTHROPIC_API_KEY;
  let out = '';
  try {
    const it = query({
      prompt,
      options: {
        cwd: DATA_ROOT,
        model: DEFAULT_MODEL,
        permissionMode: PERMISSION_MODE,
        maxTurns: 1,
        ...(CLAUDE_BIN ? { pathToClaudeCodeExecutable: CLAUDE_BIN } : {}),
      },
    });
    for await (const e of it) {
      if (e.type === 'assistant') for (const b of (e.message?.content || [])) if (b.type === 'text' && b.text) out += b.text;
    }
  } finally { if (prior) process.env.ANTHROPIC_API_KEY = prior; }
  return out;
}
function extractHtml(text) {
  let t = String(text || '').trim();
  const fence = t.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  return t;
}

// Generate (or refresh) the HTML render for an item from its markdown source.
app.post('/api/generate-html', async (req, res) => {
  try {
    const { epic, id } = req.body || {};
    if (!epic || !id) return res.status(400).json({ error: 'epic and id are required' });
    const issue = await handleCall('get_issue', { id, epic });
    if (issue.error) return res.status(404).json({ error: issue.error });
    const md = (issue.description || '').trim();
    if (!md) return res.status(400).json({ error: 'this item has no markdown to generate from' });
    const prompt = `Convert the following markdown note into ONE self-contained, visually polished HTML document.
Rules:
- Output ONLY the HTML — no commentary, no markdown code fences.
- A complete <!doctype html> document with an inline <style> (clean, readable typography on a white background; sensible max-width; styled tables/headings/callouts).
- Faithfully preserve ALL the content and structure of the markdown — do not add or drop information.
- Where the content implies data or relationships that a visual would clarify (comparisons, timelines, quantities), you MAY add a simple chart via inline <svg> or a charting library loaded with <script src> from a CDN.
- Document title: ${JSON.stringify(issue.title || 'Note')}.

MARKDOWN SOURCE:
${md}`;
    const html = extractHtml(await runOneShot(prompt));
    if (!html || !html.includes('<')) return res.status(502).json({ error: 'the model did not return usable HTML' });
    const saved = await handleCall('set_render_html', { epic, id, html });
    if (saved.error) return res.status(500).json({ error: saved.error });
    res.json({ ok: true, bytes: html.length });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

// Ask the AI to apply an edit to the HTML render (used by the HTML editor when a
// manual edit is too fiddly / fails). Body: { epic, id, instruction, html? }.
app.post('/api/edit-html', async (req, res) => {
  try {
    const { epic, id, instruction, html } = req.body || {};
    if (!epic || !id || !instruction) return res.status(400).json({ error: 'epic, id and instruction are required' });
    const issue = await handleCall('get_issue', { id, epic });
    if (issue.error) return res.status(404).json({ error: issue.error });
    const current = (html != null ? String(html) : (issue.description_html || '')).trim();
    if (!current) return res.status(400).json({ error: 'no HTML render to edit' });
    const prompt = `You are editing an existing self-contained HTML note. Apply the requested change and return the FULL updated document.
Rules:
- Output ONLY the HTML — no commentary, no code fences.
- Keep it a complete self-contained <!doctype html> document; preserve everything not mentioned by the change.

REQUESTED CHANGE:
${instruction}

CURRENT HTML:
${current}`;
    const out = extractHtml(await runOneShot(prompt));
    if (!out || !out.includes('<')) return res.status(502).json({ error: 'the model did not return usable HTML' });
    const saved = await handleCall('set_render_html', { epic, id, html: out });
    if (saved.error) return res.status(500).json({ error: saved.error });
    res.json({ ok: true, bytes: out.length });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

// The CLI's auth failures are cryptic ("401 … OAuth access token has expired").
// Turn them into something a person can act on, keeping the original at the end.
const AGENT_AUTH_HELP = "The server's Claude login has expired or is missing. Fix it once with a long-lived token: run `claude setup-token` on a machine signed in to your Max account and set the result as CLAUDE_CODE_OAUTH_TOKEN on the todouz app in Dokploy, then redeploy. Or switch Settings → AI agent to an Anthropic API key.";
function friendlyAgentError(msg) {
  const s = String(msg || '');
  if (/oauth|authenticat|401|not logged in|invalid api key|login/i.test(s)) return `${AGENT_AUTH_HELP} (${s.slice(0, 200)})`;
  return s;
}

// ─── headless agent runs (routines) ──────────────────────────────────
// The same Claude Agent SDK + todouz tools as the chat, run unattended. Uses the
// agent mode from Settings: by default the container's own Claude Code session
// (the user's Max subscription), or an Anthropic API key. Web search is only granted
// to routines that ask for it.
async function runAgentHeadless({ prompt, system, allowWeb = false, maxTurns = 40, env = {} }) {
  const agentCfg = await readAgentConfig();
  const model = agentCfg.models?.[agentCfg.mode] || DEFAULT_MODEL;
  const priorApiKey = process.env.ANTHROPIC_API_KEY;
  if (agentCfg.mode === 'anthropic' && agentCfg.anthropic_key) process.env.ANTHROPIC_API_KEY = agentCfg.anthropic_key;
  else if (process.env.ANTHROPIC_API_KEY) delete process.env.ANTHROPIC_API_KEY;
  const stderrLines = [];
  let text = '', toolCalls = 0, result = null;
  try {
    const it = query({
      prompt,
      options: {
        cwd: DATA_ROOT, model, permissionMode: PERMISSION_MODE, appendSystemPrompt: system, maxTurns,
        ...(CLAUDE_BIN ? { pathToClaudeCodeExecutable: CLAUDE_BIN } : {}),
        stderr: (line) => { const s = String(line || '').trimEnd(); if (s) { stderrLines.push(s); if (stderrLines.length > 30) stderrLines.shift(); } },
        allowedTools: [...ALLOWED_TOOLS, ...(allowWeb ? ['WebSearch', 'WebFetch'] : [])],
        // Routines are the install owner's: their tools run as LEGACY_OWNER, so a
        // routine never reads or writes another user's private data.
        mcpServers: { todouz: { type: 'stdio', command: 'node', args: [MCP_SERVER_PATH], env: { ...process.env, ...envForCtx({ user: LEGACY_OWNER, role: 'admin' }), ...env } } },
      },
    });
    for await (const ev of it) {
      if (ev.type === 'assistant') for (const b of ev.message?.content || []) {
        if (b.type === 'text' && b.text) text = b.text;
        if (b.type === 'tool_use') toolCalls++;
      }
      if (ev.type === 'result') result = ev;
    }
    const ok = result?.subtype === 'success';
    return { ok, text, toolCalls, turns: result?.num_turns ?? null, error: ok ? null : friendlyAgentError(result?.subtype || 'no result') };
  } catch (e) {
    return { ok: false, text, toolCalls, error: friendlyAgentError(`${String(e?.message || e)}${stderrLines.length ? ` · ${stderrLines.slice(-4).join(' | ')}` : ''}`) };
  } finally {
    if (priorApiKey !== undefined) process.env.ANTHROPIC_API_KEY = priorApiKey;
    else delete process.env.ANTHROPIC_API_KEY;
  }
}

// One model call, no tools: a short judgement returned as text (the Brain linker
// uses it). Same Claude login / API-key mode as everything else.
async function runModelOnce({ system, prompt }) {
  const agentCfg = await readAgentConfig();
  const model = process.env.TODOUZ_LINKER_MODEL || agentCfg.models?.[agentCfg.mode] || DEFAULT_MODEL;
  const priorApiKey = process.env.ANTHROPIC_API_KEY;
  if (agentCfg.mode === 'anthropic' && agentCfg.anthropic_key) process.env.ANTHROPIC_API_KEY = agentCfg.anthropic_key;
  else if (process.env.ANTHROPIC_API_KEY) delete process.env.ANTHROPIC_API_KEY;
  let text = '', result = null;
  try {
    const it = query({
      prompt,
      options: {
        cwd: DATA_ROOT, model, systemPrompt: system, maxTurns: 2, tools: [], settingSources: [],
        // No MCP at all: not the account's claude.ai connectors (one of which has a
        // schema the API rejects), not any config file. This call only needs text.
        mcpServers: {}, strictMcpConfig: true, env: { ...process.env, ENABLE_CLAUDEAI_MCP_SERVERS: 'false' },
        ...(CLAUDE_BIN ? { pathToClaudeCodeExecutable: CLAUDE_BIN } : {}),
      },
    });
    for await (const ev of it) {
      if (ev.type === 'assistant') for (const b of ev.message?.content || []) if (b.type === 'text' && b.text) text += b.text;
      if (ev.type === 'result') result = ev;
    }
    const ok = !!text && (result?.subtype === 'success' || result?.subtype === 'error_max_turns');
    return { ok, text, error: ok ? null : friendlyAgentError(result?.subtype || 'no result') };
  } catch (e) {
    return { ok: false, text, error: friendlyAgentError(String(e?.message || e)) };
  } finally {
    if (priorApiKey !== undefined) process.env.ANTHROPIC_API_KEY = priorApiKey;
    else delete process.env.ANTHROPIC_API_KEY;
  }
}

// ─── Brain linker ─────────────────────────────────────────────────────
// Links new and changed notes (and recent feed posts) to related notes by
// itself, a few at a time. Runs every 3 min, soon after a write through the
// API, and keeps draining a backlog; after a failure (e.g. an expired login)
// it waits 30 min. TODOUZ_LINKER=off turns it off (dev).
const linker = { busy: false, timer: null, last: null, pausedUntil: 0 };
async function linkerTick() {
  if (linker.busy || (process.env.TODOUZ_LINKER ?? 'off') === 'off' || Date.now() < linker.pausedUntil) return;
  linker.busy = true;
  try {
    const r = await runLinkPass({ runModel: runModelOnce, max: 6 });
    linker.last = { ...r, at: new Date().toISOString() };
    if (r.processed) console.log(`[linker] linked ${r.processed} item(s), ${r.links_made} link(s); ${r.remaining} left`);
    if (r.errors.length) { console.error('[linker]', r.errors[0]); linker.pausedUntil = Date.now() + 30 * 60000; }
    else if (r.remaining > 0) kickLinker(15000);
  } catch (e) {
    linker.last = { ok: false, error: String(e?.message || e), at: new Date().toISOString() };
    console.error('[linker]', e?.message || e);
  } finally { linker.busy = false; }
}
function kickLinker(delay = 20000) { clearTimeout(linker.timer); linker.timer = setTimeout(linkerTick, delay); }
app.get('/api/brain/linker', async (_req, res) => {
  try { const { pend } = await pendingItems(); res.json({ ok: true, enabled: (process.env.TODOUZ_LINKER ?? 'off') !== 'off', running: linker.busy, pending: pend.length, last: linker.last, paused_until: linker.pausedUntil > Date.now() ? new Date(linker.pausedUntil).toISOString() : null }); }
  catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});
// Routines, outside-workspace connectors and the linker's manual run act on the
// whole install with the owner's model budget: admins only.
app.use(['/api/routines', '/api/sources', '/api/brain/linker/run'], (req, res, next) => {
  if (!requireAdmin(req, res)) return;
  next();
});

app.post('/api/brain/linker/run', async (_req, res) => {
  linker.pausedUntil = 0;
  if ((process.env.TODOUZ_LINKER ?? 'off') === 'off') return res.json({ ok: false, error: 'linker is off (set TODOUZ_LINKER=on)' });
  kickLinker(0);
  res.json({ ok: true, started: true });
});

// After a run: the daily brief and the weekly triage are worth a push notification.
async function afterRoutineRun(run) {
  const post = (run.posts || []).find(p => ['brief', 'triage', 'share'].includes(p.kind));
  if (!post) return;
  const base = (process.env.TODOUZ_PUBLIC_URL || '').replace(/\/+$/, '');
  const shared = run.posts.filter(p => p.kind === 'share').length;
  await sendToAll({
    title: post.kind === 'brief' ? "☀️ Today's focus" : post.kind === 'triage' ? '🧹 Weekly review' : `📥 ${shared > 1 ? `${shared} shared posts` : 'Your shared post'} filed`,
    body: post.title,
    url: `${base}/dashboard/#feed=${post.id}`,
  }).catch(() => {});
}

app.get('/api/routines', async (_req, res) => {
  try { res.json({ ok: true, routines: await listRoutines(), status: routineStatus(), tz: process.env.TODOUZ_TZ || Intl.DateTimeFormat().resolvedOptions().timeZone }); }
  catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});
app.get('/api/routines/runs', async (req, res) => {
  try { res.json({ ok: true, runs: await listRuns({ name: req.query.name, limit: req.query.limit }) }); }
  catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});
app.get('/api/routines/:name', async (req, res) => {
  const r = await getRoutine(req.params.name);
  if (!r) return res.status(404).json({ error: `no routine ${req.params.name}` });
  res.json({ ok: true, routine: r });
});
app.post('/api/routines/save', async (req, res) => {
  try { const r = await saveRoutine(req.body || {}); res.status(r.error ? 400 : 200).json(r); }
  catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});
app.post('/api/routines/delete', async (req, res) => {
  try { const r = await deleteRoutine(String(req.body?.name || '')); res.status(r.error ? 404 : 200).json(r); }
  catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});
app.post('/api/routines/run', async (req, res) => {
  const name = String(req.body?.name || '');
  if (!await getRoutine(name)) return res.status(404).json({ error: `no routine ${name}` });
  const args = {};
  if (req.body?.post_id) args.post_id = String(req.body.post_id);
  if (Array.isArray(req.body?.slugs)) {
    const slugs = [...new Set(req.body.slugs.map(String).filter(x => /^[a-z0-9][a-z0-9-]{0,79}$/.test(x)))].slice(0, 5);
    if (slugs.length) {
      args.slugs = slugs;
      args.question = String(req.body.question || '').replace(/\s+/g, ' ').trim().slice(0, 600);
      args.mode = req.body.mode === 'connect' ? 'connect' : 'deeper';
    }
  }
  res.json(enqueueRoutine(name, { trigger: 'manual', args }));
});

// The reader hit the end of the feed: add instant posts from the Brain and the
// backlog, and start a (throttled) spark-feed run for fresh ones.
app.post('/api/feed/more', async (req, res) => {
  // Generating fresh posts runs the owner's spark-feed routine; others just get a refill.
  try { res.json(await refillFeed({ generate: isAdminReq(req) && req.todouzUser === LEGACY_OWNER && req.body?.generate !== false })); }
  catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

// Share to todouz: a post shared from another app (the PWA share target or the
// "Share a link" sheet). Saved at once with its public preview, then the
// share-digest routine files it; listing goes through /api/share_list.
async function digestShares() {
  if (!await getRoutine('share-digest')) return { generating: false, why: 'no share-digest routine' };
  const q = enqueueRoutine('share-digest', { trigger: 'share', args: { requeue: true } });
  return { generating: !q.error, ...q };
}
app.post('/api/share', async (req, res) => {
  try {
    const b = req.body || {};
    const r = await createShare({ url: b.url, title: b.title, text: b.text, note: b.note, mode: b.mode, source: req.todouzUser || b.source || 'dashboard' });
    if (r.error) return res.status(400).json(r);
    res.json({ ...r, digest: await digestShares() });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});
app.post('/api/share/retry', async (req, res) => {
  try {
    const r = await retryShare({ id: String(req.body?.id || ''), note: req.body?.note, mode: req.body?.mode });
    if (r.error) return res.status(404).json(r);
    res.json({ ...r, digest: await digestShares() });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

// Connected sources (read-only outside workspaces). Keys are write-only from here.
app.get('/api/sources', async (_req, res) => {
  try { res.json({ ok: true, sources: await sourcesStatus() }); }
  catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});
app.post('/api/sources', async (req, res) => {
  const name = String(req.body?.name || '');
  if (!WORKSPACES[name]) return res.status(400).json({ error: `unknown source ${name}` });
  try {
    await writeSourceConfig(name, { url: req.body?.url, key: req.body?.key });
    res.json({ ok: true, sources: await sourcesStatus() });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

// ─── /api/chat — NDJSON streaming ────────────────────────────────────
const IN_FLIGHT_CHATS = new Map(); // sessionId → AbortController

app.post('/api/chat', async (req, res) => {
  const { message, history = [], task = null, attachments = [], agent = 'scheduler', resumeSession, model = DEFAULT_MODEL } = req.body || {};
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'message is required' });
  if (!/^[a-z0-9-]+$/.test(agent)) return res.status(400).json({ error: 'invalid agent name' });
  if (resumeSession && !(await ownsChatSession(req, String(resumeSession)))) return res.status(404).json({ error: 'session not found' });

  // Skills-based prompting: ONE agent, many domain playbooks. Instead of the old
  // per-agent system-prompt.md files, we inject the skill INDEX (name +
  // when_to_use per skill) and instruct the agent to read_skill the relevant
  // one before acting in that domain. The `agent` param is kept only for
  // session metadata / backwards compat with older dashboard builds.
  let skillIndex = [];
  try { skillIndex = (await handleCall('list_skills'))?.skills || []; } catch {}
  const cwdForAgent = DATA_ROOT;

  // Which model/provider does this chat use? Settings-driven (falls back to the
  // request's model, then the server default). Both modes run the same Claude
  // Agent SDK + todouz tools; 'anthropic' just bills to the user's API key.
  const agentCfg = await readAgentConfig();
  const activeModel = agentCfg.models?.[agentCfg.mode] || model || DEFAULT_MODEL;

  res.setHeader('Content-Type', 'application/x-ndjson');
  // no-transform stops intermediary proxies from buffering/altering the stream;
  // X-Accel-Buffering:no disables nginx-style response buffering. Together with
  // flushHeaders() + setNoDelay() below they make each NDJSON line reach the
  // browser the instant it's written, instead of arriving in one lump at the end
  // (which is why the chat previously "needed a refresh" behind the prod proxy).
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  try { res.flushHeaders(); } catch {}          // open the stream immediately
  try { req.socket.setNoDelay(true); } catch {} // disable Nagle so small events flush at once
  const sendEvent = (obj) => { try { res.write(JSON.stringify(obj) + '\n'); } catch {} };
  // Heartbeat: a blank line every 15s keeps the connection warm through idle
  // gaps (long tool runs) so proxies don't buffer or time it out. Blank lines
  // are skipped by the client's NDJSON parser, so they're invisible.
  const keepAlive = setInterval(() => { try { res.write('\n'); } catch {} }, 15000);

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
  const hasImageAtt = (attachments || []).some(a => (a?.kind === 'image' && a.data) || (a?.kind === 'pdf' && a.data));
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
    const nMedia = (attachments || []).filter(a => (a?.kind === 'image' || a?.kind === 'pdf') && a.data).length;
    // Pre-save each pasted IMAGE as a todouz attachment so the agent can EMBED it
    // into an item with attach_image { attachment_id } — the base64 lives only
    // inline in this message and the model can't re-emit it into a tool call.
    const savedImgs = [];
    for (const a of (attachments || [])) {
      if (a?.kind === 'image' && a.data) {
        try {
          const meta = await saveAttachmentBytes(Buffer.from(a.data, 'base64'), { filename: a.name || `pasted-${Date.now()}.png`, mime: a.mediaType || 'image/png', kind: 'file' });
          savedImgs.push({ id: meta.id, name: meta.filename });
        } catch { /* embedding is best-effort; the image is still readable inline */ }
      }
    }
    const embedNote = savedImgs.length
      ? ` To EMBED an image into an item's body, call attach_image { epic, id, attachment_id, caption } with the matching id below (do NOT re-encode it): ${savedImgs.map((s, i) => `image ${i + 1} → attachment_id "${s.id}"`).join('; ')}. See the screenshots-and-evidence skill.`
      : '';
    const mediaNote = nMedia
      ? `[ATTACHED FILES: ${nMedia} file(s) (images and/or PDFs) are included INLINE in THIS message and are directly readable by you here. Read their content straight from this message. They are NOT todouz attachments — do NOT call get_issue / list_epic_files / read_epic_file or any attachment tool to look for them.${embedNote}]\n\n`
      : '';
    userContent.push({ type: 'text', text: mediaNote + messageWithDocs });
    for (const a of attachments) {
      if (a?.kind === 'image' && a.data) {
        userContent.push({ type: 'image', source: { type: 'base64', media_type: a.mediaType || 'image/png', data: a.data } });
      } else if (a?.kind === 'pdf' && a.data) {
        // Claude reads PDFs natively via a base64 document block.
        userContent.push({ type: 'document', title: a.name || 'document.pdf', source: { type: 'base64', media_type: 'application/pdf', data: a.data } });
      }
    }
    promptForQuery = (async function* () { yield { type: 'user', message: { role: 'user', content: userContent } }; })();
  } else {
    promptForQuery = (historyTranscript ? historyTranscript + '\n\n' : '') + `User: ${messageWithDocs}`;
  }

  const baseSystem = personalizePrompt(buildBaseSystemPrompt(context, skillIndex), req.todouzUser || LEGACY_OWNER);
  // The CLI's stderr is the only place its real failure reason shows up.
  const stderrLines = [];
  const filesChanged = new Set();
  let toolCalls = 0;
  let sessionIdSeen = null;
  const abortController = new AbortController();
  // Don't abort on browser disconnect — let the SDK finish so JSONL persists.
  res.on('error', () => {});

  // Provider selection is via ANTHROPIC_API_KEY on the spawned CLI:
  //  - 'anthropic' mode → set it to the user's key (bills the API).
  //  - 'local' mode     → unset it so the SDK uses the container's OAuth session.
  // process.env is process-global, so this is safe for a personal (near-single-
  // user) instance; the value is restored in `finally`. The key is never logged.
  const priorApiKey = process.env.ANTHROPIC_API_KEY;
  if (agentCfg.mode === 'anthropic' && agentCfg.anthropic_key) {
    process.env.ANTHROPIC_API_KEY = agentCfg.anthropic_key;
  } else if (process.env.ANTHROPIC_API_KEY) {
    delete process.env.ANTHROPIC_API_KEY;
  }

  try {
    const iterator = query({
      prompt: promptForQuery,
      options: {
        cwd: cwdForAgent,
        model: activeModel,
        permissionMode: PERMISSION_MODE,
        appendSystemPrompt: baseSystem,
        ...(CLAUDE_BIN ? { pathToClaudeCodeExecutable: CLAUDE_BIN } : {}),
        stderr: (line) => {
          const s = String(line || '').trimEnd();
          if (!s) return;
          stderrLines.push(s);
          if (stderrLines.length > 40) stderrLines.shift();
          console.error('[claude-cli]', s);
        },
        allowedTools: ALLOWED_TOOLS,
        // With accounts on, the agent works only through todouz tools (which
        // enforce the caller's access). Its file/shell tools could read anyone's data.
        ...(AUTH_ENABLED ? { disallowedTools: BUILTIN_AGENT_TOOLS } : {}),
        abortController,
        mcpServers: {
          todouz: { type: 'stdio', command: 'node', args: [MCP_SERVER_PATH], env: { ...process.env, ...envForCtx(req.todouzCtx) } },
        },
        ...(resumeSession ? { resume: resumeSession } : {}),
      },
    });

    for await (const event of iterator) {
      if (event.type === 'system' && event.subtype === 'init') {
        sessionIdSeen = event.session_id;
        IN_FLIGHT_CHATS.set(sessionIdSeen, abortController);
        sendEvent({ type: 'system', model: event.model, sessionId: event.session_id, agent, mode: agentCfg.mode });
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
          try { await persistSessionMetadata(agent, sessionIdSeen, message, task, req.todouzUser); }
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
    const msg = friendlyAgentError(String(e?.message || e));
    const tail = stderrLines.slice(-8).join('\n');
    try { sendEvent({ type: 'error', error: msg, stderr: tail || undefined }); } catch {}
    try { res.end(); } catch {}
  } finally {
    clearInterval(keepAlive);
    if (sessionIdSeen) IN_FLIGHT_CHATS.delete(sessionIdSeen);
    // Restore the env exactly as it was (we may have set OR cleared it above).
    if (priorApiKey !== undefined) process.env.ANTHROPIC_API_KEY = priorApiKey;
    else delete process.env.ANTHROPIC_API_KEY;
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
  if (!(await ownsChatSession(req, sid))) return res.status(404).json({ error: `session ${sid} not found` });
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

// The base prompt was written for the install owner. For anyone else, address
// them by name and drop the owner's personal notes (their own live in the Brain).
function personalizePrompt(text, who) {
  if (who === LEGACY_OWNER) return text;
  const Name = who.charAt(0).toUpperCase() + who.slice(1);
  return text
    .replace(/the user's/g, `${Name}'s`);
}

function buildBaseSystemPrompt(ctx, skillIndex = []) {
  const skillsBlock = skillIndex.length
    ? `DOMAIN SKILLS — playbooks for recognised domains. When the user's request matches a skill's trigger, call read_skill({name}) and FOLLOW its rules before acting:

${skillIndex.map(s => `- ${s.name}: ${s.description}${s.when_to_use ? ` — USE WHEN: ${s.when_to_use}` : ''}`).join('\n')}

If the user teaches you a new repeatable workflow, persist it with write_skill so future sessions know it.`
    : `DOMAIN SKILLS: none defined yet. If the user teaches you a repeatable workflow, persist it with write_skill.`;

  return `You are THE agent in the user's todouz — their personal life OS. One agent, many domain skills. Today's situation:

\`\`\`json
${JSON.stringify(ctx?.today || {}, null, 2)}
\`\`\`

The next 7 days:

\`\`\`json
${JSON.stringify(ctx?.upcoming || {}, null, 2)}
\`\`\`

The user's profile (excerpt):

${ctx?.profile || '(no profile loaded)'}

${skillsBlock}

OPERATING RULES:
- INLINE ATTACHMENTS. Images and PDFs the user attaches to a chat message are provided INLINE in that message and are directly readable by you — read them straight from the message. They are NOT todouz attachments; never hunt for them with get_issue / list_epic_files / read_epic_file. When asked to "make notes from the attached slides/PDF", read the inline file and write the notes with write_note (which sets the item's description as rich HTML).
- EMBEDDING IMAGES / SCREENSHOTS INTO AN ITEM. When the user wants an image to actually appear inside an item (evidence, a screenshot, a photo), use attach_image. Each pasted image is pre-saved and its attachment_id is given to you in the [ATTACHED FILES …] note — call attach_image { epic, id, attachment_id, caption } to embed it; do NOT re-encode the image or write a "[screenshot here]" placeholder. For structured evidence (a screenshot per task/test), follow the screenshots-and-evidence skill: build one clean body with real headings/tables and each image under the thing it proves.
- Always-act-first. If an action is implied, call the right tool BEFORE replying.
- Use create_issue / update_issue / complete_issue / add_subtask / toggle_subtask / append_to_epic / add_event for state changes.
- TAG everything you create. Every create_issue / create_subissue gets a tags array: domain tags (meal type, food category for recipes; subject for uni work) plus an effort tag (effort-low / effort-medium / effort-high) and a time estimate tag (time-15m / time-30m / time-1h / time-2h+) for anything actionable.
- ALWAYS GIVE ACTIONABLE ITEMS A DUE DATE. Every actionable create_issue / create_subissue should carry a \`due\` — undated items pile up in "Someday" and get lost. If the user gives no explicit date, infer a sensible one from context (the class/assignment deadline for uni work, this week for near-term tasks, tomorrow for a quick follow-up) and say the date you assumed so it can be corrected. Leave \`due\` empty ONLY for genuine reference/someday material (notes, reading lists, idea captures). For things that repeat on a cadence (weekly tutorials, lectures, standing meetings) set \`recurring: true\` instead of dating each occurrence — they live in the Recurring column, not Someday.
- ESTIMATE + BOOK time. When you create an actionable issue with a due date, estimate how long it needs; if it needs more than ~30 focused minutes, offer (or when asked, immediately book) a timeblock via add_timeblock on a sensible free slot before the due date.
- "Capture from user" messages (wrapped in [CAPTURE FROM USER]) are work to act on, not questions. Extract every action verb and call the right tool. Don't ask clarifying questions unless genuinely ambiguous.
- [TODOUZ SELECTION] blocks are things the user hand-picked in the dashboard's select mode. Lines look like "- issue <epic_slug>/<ISS-id> — title", "- epic <slug>", "- date YYYY-MM-DD", "- timeblock <tb-id>", "- subtask <epic_slug>/<ISS-id> — <item text>". Treat them as THE subject of the user's instruction — e.g. selected recipes + a date + "make a shopping list" means: run the shopping-list skill for those recipes on that date.
- A "- subtask" line is one checklist item inside that issue. The text after the em dash is the exact item text — pass it verbatim as subtask_text/match_text to toggle_subtask, update_subtask or delete_subtask (they match on text within the issue). Selected shopping-list items + "add these to home stock" means: add each item to the home-stock epic, then tick it off the shopping list.
- End with a 1–2 line summary of what changed. Don't restate what's still on the list.
- WORKLOG. When you act on an issue, document it back IN the issue, not just in chat: keep a "## Work log" section in its description (append, don't overwrite), and when you complete it ALWAYS pass a 'summary' to complete_issue so a dated recap is saved under the item. Read the issue-worklog skill for the create/edit/delete formatting rules.
- SECOND BRAIN. todouz has a shared long-term memory (the Brain tab) that every AI session reads and builds out. For anything beyond a quick task action, call brain_context { topic } first so you start from what's already known. When you learn something durable — a decision and why, a preference about how the user likes things done, a person, a learning, a reusable insight — save it: brain_search first to update an existing note (mode:"append") instead of duplicating; otherwise brain_write one atomic note (type + status "seed"), linking related notes with [[slug]] and folders/items via projects. Raw or uncertain material → brain_capture. Always pass source: "todouz-agent". Tasks still belong in items, not the brain. The Brain links its notes by itself (supports / contradicts / limits / extends / tradeoff / applies_to): brain_read shows a note's connections and brain_links its tensions and disagreements. When the notes behind an answer disagree, say under what conditions each holds rather than quietly picking one; never write links by hand.
- SPARK FEED. The user reads a shorts-style feed (the Feed tab). When they ask for something to read, news, ideas or a summary they can come back to, or you find something worth their attention, publish it with feed_post (short body, a hook title, sources with URLs for anything factual, related Brain notes; source "todouz-agent") instead of only answering in chat. Check feed_taste to see what resonates with them.
- Be kind and practical. Prefer a small next step over a lecture.`;
}

// A chat session belongs to whoever started it (sessions from before accounts: LEGACY_OWNER).
async function ownsChatSession(req, sid) {
  if (!AUTH_ENABLED) return true;
  let links = {};
  try { links = JSON.parse(await readFile(join(DATA_ROOT, 'state', 'session-links.json'), 'utf8')); } catch {}
  const s = links[sid];
  return !!s && (s.owner || LEGACY_OWNER) === req.todouzUser;
}

async function persistSessionMetadata(agent, sessionId, firstMsg, task, owner) {
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
    owner: existing.owner || owner || LEGACY_OWNER,
  };
  await writeFile(path, JSON.stringify(links, null, 2) + '\n');
}

// ─── static dashboard ────────────────────────────────────────────────
// Force no-cache so the browser always picks up the latest .jsx files. Without
// this, Chrome aggressively serves stale dashboard bundles from memory cache —
// which previously bit us when an older server (agentHome) had run on this port
// and Chrome kept showing that UI even after we switched to todouz. The
// no-cache headers go through express.static's setHeaders hook so they win
// over the library's default `Cache-Control: public, max-age=0`.
app.use('/dashboard', express.static(join(TODOUZ_ROOT, 'dashboard'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  },
}));
app.get('/', (_req, res) => res.redirect('/dashboard/'));

// ─── start ───────────────────────────────────────────────────────────
// With no accounts (auth off) only this machine may connect. Set HOST=0.0.0.0
// to expose it anyway, e.g. inside Docker; with accounts on it listens on all interfaces.
const HOST = process.env.HOST || (AUTH_ENABLED ? '0.0.0.0' : '127.0.0.1');
const server = app.listen(PORT, HOST, async () => {
  console.log(`todouz http server listening on ${HOST}:${PORT} (local: http://localhost:${PORT})`);
  if (!AUTH_ENABLED) console.log('  auth: OFF (no accounts yet) — local access only. Set TODOUZ_USERS to add logins.');
  console.log(`  dashboard: http://localhost:${PORT}/dashboard/`);
  console.log(`  data root: ${DATA_ROOT}`);
  console.log(`  default model: ${DEFAULT_MODEL}`);
  console.log(`  agent binary: ${CLAUDE_BIN || '(none found — in-app chat will fail)'}`);
  console.log(`  permissions: ${PERMISSION_MODE}${IS_ROOT ? ' (running as root)' : ''}`);
  // Rebuild the SQLite read-index from markdown on every boot. Markdown is the
  // source of truth — the DB is a fast queryable mirror. If markdown changed
  // while the server was down (e.g. user edited a file by hand), this catches it.
  try {
    const r = await reindexAll();
    if (r.ok) {
      console.log(`  index.db: rebuilt — ${r.counts.epics} epics, ${r.counts.issues} issues, ${r.counts.events} events, ${r.counts.timeblocks} timeblocks, ${r.counts.sessions} sessions`);
      console.log(`  index.db path: ${DB_FILE}`);
    } else {
      console.error(`  index.db: reindex failed — ${r.error}`);
    }
  } catch (e) {
    console.error('  index.db: reindex threw —', e?.message || e);
  }
  // Web push + reminder scheduler. VAPID keys are auto-generated/persisted, so
  // there's nothing to configure. The scheduler ticks every 30s.
  try {
    await initPush();
    startReminderScheduler(collectReminders, { intervalMs: 30000 });
    console.log('  push: VAPID ready, reminder scheduler running (tz ' + (process.env.TODOUZ_TZ || Intl.DateTimeFormat().resolvedOptions().timeZone) + ')');
  } catch (e) {
    console.error('  push: init failed —', e?.message || e);
  }
  // Routines: scheduled agent runs (daily brief, spark feed, weekly review…).
  // Background AI is opt-in: TODOUZ_ROUTINES=on (and TODOUZ_LINKER / TODOUZ_REFILL_AI=on)
  // so a fresh install never spends your Claude subscription on its own.
  try {
    if ((process.env.TODOUZ_ROUTINES ?? 'off') === 'off') {
      console.log('  routines: scheduler OFF (set TODOUZ_ROUTINES=on to run them on schedule); manual runs still work');
      await startRoutineScheduler({ runAgent: runAgentHeadless, afterRun: afterRoutineRun, autoRun: false });
    } else {
      await startRoutineScheduler({ runAgent: runAgentHeadless, afterRun: afterRoutineRun });
      console.log('  routines: scheduler running (checks every minute)');
      // Shares that arrived while the server was down (or whose run died) still get filed.
      if (await pendingShareCount()) await digestShares();
    }
  } catch (e) {
    console.error('  routines: failed to start —', e?.message || e);
  }
  if ((process.env.TODOUZ_LINKER ?? 'off') === 'off') console.log('  brain linker: OFF (set TODOUZ_LINKER=on to link notes automatically)');
  else { setInterval(linkerTick, 3 * 60000); kickLinker(30000); console.log('  brain linker: on (every 3 min)'); }
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
