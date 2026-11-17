// sources.mjs — read-only connectors to outside workspaces, so routines and the
// agent can pull context (e.g. a team's task board and documents) into the daily
// brief and the Brain without anyone pasting files.
//
// A workspace is any HTTP service that answers POST <url>/<op> with JSON and a
// bearer key. Add your own entry to WORKSPACES below.
//
// Read-only on purpose: only list/read/search operations are forwarded, so a
// todouz agent can never change the outside workspace. Keys live server-side in
// data/state/connected-sources.json (set from Settings) or in the environment
// (TODOUZ_WORKSPACE_KEY / TODOUZ_WORKSPACE_URL), and are never returned to a browser.

import { readJSON, writeJSON } from './store.mjs';

const REL = 'state/connected-sources.json';
export const WORKSPACES = {
  team: {
    label: 'Team workspace',
    defaultUrl: '',
    envKey: 'TODOUZ_WORKSPACE_KEY', envUrl: 'TODOUZ_WORKSPACE_URL',
    readOps: ['list_tree', 'list_documents', 'get_document', 'search_documents', 'list_tasks', 'get_task', 'list_revisions'],
  },
};

export async function readSourcesConfig() {
  const raw = (await readJSON(REL, {})) || {};
  const out = {};
  for (const [name, def] of Object.entries(WORKSPACES)) {
    const c = raw[name] || {};
    out[name] = {
      url: String(c.url || process.env[def.envUrl] || def.defaultUrl).replace(/\/+$/, ''),
      key: String(c.key || process.env[def.envKey] || ''),
      key_from_env: !c.key && !!process.env[def.envKey],
    };
  }
  return out;
}

export async function writeSourceConfig(name, { url, key }) {
  if (!WORKSPACES[name]) throw new Error(`unknown workspace: ${name}`);
  const raw = (await readJSON(REL, {})) || {};
  const cur = raw[name] || {};
  if (typeof url === 'string') cur.url = url.trim() || undefined;
  if (key !== undefined) cur.key = (typeof key === 'string' && key.trim()) ? key.trim() : undefined;   // "" clears
  raw[name] = cur;
  await writeJSON(REL, raw);
}

// Public status for the Settings sheet: never includes the key.
export async function sourcesStatus() {
  const cfg = await readSourcesConfig();
  return Object.fromEntries(Object.entries(WORKSPACES).map(([name, def]) => [name, {
    label: def.label, url: cfg[name].url, connected: !!cfg[name].key, key_from_env: cfg[name].key_from_env, read_ops: def.readOps,
  }]));
}

async function workspaceRead({ workspace = 'team', op, args = {} } = {}) {
  const def = WORKSPACES[workspace];
  if (!def) return { error: `unknown workspace "${workspace}". Known: ${Object.keys(WORKSPACES).join(', ')}` };
  if (!def.readOps.includes(op)) return { error: `"${op}" is not allowed. This connector is read-only: ${def.readOps.join(', ')}` };
  const cfg = (await readSourcesConfig())[workspace];
  if (!cfg.key || !cfg.url) return { error: `${def.label} is not connected. Add its key in todouz Settings → Connected sources.` };
  let body = args;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const r = await fetch(`${cfg.url}/${op}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
    body: JSON.stringify(body || {}),
  });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { return { error: `${def.label} answered ${r.status} with a non-JSON body` }; }
  // Keep large documents from flooding an agent's context.
  if (data && typeof data.markdown === 'string' && data.markdown.length > 40000) {
    data.markdown = data.markdown.slice(0, 40000) + '\n\n…(truncated; use search_documents to find a specific part)';
  }
  return data;
}

export const SOURCE_TOOLS = [
  {
    name: 'workspace_read',
    description: 'Read-only access to a connected outside workspace. workspace "team" = the team workspace configured in Settings (documents, a task board, revisions). op: list_tree, list_documents, get_document {path}, search_documents {q}, list_tasks {status?, assignee?}, get_task {id}, list_revisions {path}. Writing is not possible through this tool.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string', enum: Object.keys(WORKSPACES) },
        op: { type: 'string', enum: [...new Set(Object.values(WORKSPACES).flatMap(w => w.readOps))] },
        args: { type: 'object', description: 'Arguments for the op, e.g. {"path": "README.md"} or {"q": "pilot"} or {"status": "doing"}.' },
      },
      required: ['op'], additionalProperties: false,
    },
  },
];

export async function handleSourceCall(name, args = {}) {
  if (name === 'workspace_read') return await workspaceRead(args);
  return undefined;
}
