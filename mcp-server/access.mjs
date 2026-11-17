// access.mjs — who is calling, and what they may see or change.
//
// Every request runs inside runAs(ctx, fn). ctx = { user, role } where role is
// 'admin' or 'member'. Code deep inside the tools reads it with currentCtx()
// instead of threading a parameter through ~60 functions. No ctx (null) means
// the machine operator: the stdio MCP on the box itself, boot-time jobs, a
// local dev run with auth off. That caller sees everything.
//
// The rules (they apply to admins too; admin only unlocks admin endpoints):
//   - A category is shared, or private to one owner (data/state/visibility.json).
//     A category with no entry belongs to LEGACY_OWNER, so nothing is public by accident.
//   - Rows that live in a category (issues, epics, events, sessions blocks) follow it.
//   - Rows with no category carry an `owner` (events, timeblocks, brain notes, feed
//     posts, shares, chat sessions). Legacy rows without one belong to LEGACY_OWNER.
//   - A brain note can be marked shared to make it visible to every user.

import { AsyncLocalStorage } from 'node:async_hooks';
import { readJSON, writeJSON } from './store.mjs';

// Everything that existed before multi-user support belongs to this user.
export const LEGACY_OWNER = (process.env.TODOUZ_LEGACY_OWNER || 'owner').toLowerCase();

const als = new AsyncLocalStorage();
export function runAs(ctx, fn) { return als.run(ctx || null, fn); }
export function currentCtx() { return als.getStore() || null; }
export const isAdmin = (ctx) => !ctx || ctx.role === 'admin';

// The stdio MCP process inherits its caller from the parent (in-app chat, routines).
export function ctxFromEnv() {
  const user = process.env.TODOUZ_ACT_AS;
  if (!user) return null;
  return { user: String(user).toLowerCase(), role: process.env.TODOUZ_ACT_ROLE === 'admin' ? 'admin' : 'member' };
}
export function envForCtx(ctx) {
  return ctx ? { TODOUZ_ACT_AS: ctx.user, TODOUZ_ACT_ROLE: ctx.role } : {};
}

// ─── category visibility ─────────────────────────────────────────────
export const VISIBILITY_REL = 'state/visibility.json';
export async function readVisibility() { return await readJSON(VISIBILITY_REL, {}) || {}; }
export async function writeVisibility(v) { await writeJSON(VISIBILITY_REL, v); }

export function categoryOwner(cat, vis) {
  const e = vis[cat];
  if (!e) return LEGACY_OWNER;
  return e.shared ? null : (e.owner || LEGACY_OWNER);
}
export function categoryVisibleTo(cat, user, vis) {
  if (!user || !cat) return true;
  const e = vis[cat];
  if (e && e.shared) return true;
  return categoryOwner(cat, vis) === user;
}

// Make a freshly created category private to its creator.
export async function claimCategory(cat, ctx = currentCtx()) {
  if (!ctx || !cat) return;
  const vis = await readVisibility();
  if (vis[cat]) return;
  vis[cat] = { shared: false, owner: ctx.user };
  await writeVisibility(vis);
}

// ─── rows ────────────────────────────────────────────────────────────
export function catOfRow(row) {
  if (!row || typeof row !== 'object') return null;
  if (typeof row.category === 'string' && row.category) return row.category;
  if (typeof row.epic_slug === 'string' && row.epic_slug.includes('/')) return row.epic_slug.split('/')[0];
  if (typeof row.epic === 'string' && row.epic.includes('/')) return row.epic.split('/')[0];
  if (typeof row.slug === 'string' && row.slug.includes('/') && (row.short || row.open_issue_count != null || row.category)) return row.slug.split('/')[0];
  return null;
}
export function ownerOf(row) { return (row && row.owner) ? String(row.owner) : LEGACY_OWNER; }

// Can ctx see this row? Rows that are neither in a category nor owned
// (day buckets, counters, plain values) are structural and always pass.
export function rowVisible(row, ctx, vis) {
  if (!ctx || !row || typeof row !== 'object') return true;
  const cat = catOfRow(row);
  if (cat) return categoryVisibleTo(cat, ctx.user, vis);
  if ('owner' in row) return row.shared === true || ownerOf(row) === ctx.user;
  return true;
}

// Walk a tool result and drop every row ctx may not see. Keeps `count`
// fields honest for the arrays it trims.
export function filterDeep(value, ctx, vis) {
  if (!ctx || value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.filter(v => rowVisible(v, ctx, vis)).map(v => filterDeep(v, ctx, vis));
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = filterDeep(v, ctx, vis);
  for (const [k, v] of Object.entries(value)) {
    if (Array.isArray(v) && Array.isArray(out[k]) && out[k].length !== v.length && typeof value.count === 'number' && value.count === v.length) {
      out.count = out[k].length;
    }
  }
  return out;
}

// ─── tool guard ──────────────────────────────────────────────────────
// Tools a member may never call: they touch the whole install.
const ADMIN_TOOLS = new Set(['reindex_database', 'write_skill', 'workspace_read', 'share_resolve']);

const slugCat = (s) => (typeof s === 'string' && s.includes('/')) ? s.split('/')[0] : null;

// Every category a call would read from or write to, taken from its arguments.
function categoriesInArgs(name, args) {
  const cats = new Set();
  const add = (c) => { if (c) cats.add(String(c)); };
  for (const k of ['epic_slug', 'epic', 'target_epic', 'parent_epic']) add(slugCat(args[k]));
  if (typeof args.slug === 'string' && !name.startsWith('brain_')) add(slugCat(args.slug));
  if (typeof args.category === 'string' && !name.startsWith('brain_') && !name.startsWith('feed_')) add(args.category);
  if (['delete_category'].includes(name)) add(args.name);
  const p = args.patch && typeof args.patch === 'object' ? args.patch : null;
  if (p) { add(p.category); add(slugCat(p.epic_slug)); }
  return [...cats];
}

// Rows addressed only by id: look them up so ownership can be checked.
async function rowForId(name, args) {
  if (/^(update|delete)_event$/.test(name)) {
    const ev = ((await readJSON('state/events.json', { events: [] })).events || []).find(e => e.id === args.id);
    return ev || null;
  }
  if (/^(update|complete|delete)_timeblock$/.test(name)) {
    const b = ((await readJSON('state/timeblocks.json', { blocks: [] })).blocks || []).find(x => x.id === args.id);
    return b || null;
  }
  if (/^(update|delete|link)_session$/.test(name)) {
    const links = await readJSON('state/session-links.json', {});
    const s = links[args.session_id];
    return s ? { owner: s.owner || LEGACY_OWNER } : null;
  }
  return null;
}

// Returns an error object when ctx may not make this call, else null.
export async function guardCall(name, args, ctx) {
  if (!ctx) return null;
  if (ADMIN_TOOLS.has(name) && ctx.role !== 'admin') return { error: `${name} is restricted to admins` };
  const vis = await readVisibility();
  for (const cat of categoriesInArgs(name, args)) {
    const e = vis[cat];
    // Creating into a brand-new category is fine: it becomes the caller's.
    const isNew = !e && /^(create_category|create_epic)$/.test(name) && !(await categoryExists(cat));
    if (isNew) continue;
    if (!categoryVisibleTo(cat, ctx.user, vis)) return { error: 'not found' };
    // Only the owner (or an admin) may delete a whole category or remove a shared one.
    if (name === 'delete_category' && e?.shared && ctx.role !== 'admin') return { error: 'only an admin can delete a shared category' };
  }
  const row = await rowForId(name, args);
  if (row && !rowVisible(row, ctx, vis)) return { error: 'not found' };
  return null;
}

async function categoryExists(cat) {
  const { exists } = await import('./store.mjs');
  return await exists(`epics/${cat}`);
}

export async function filterResult(name, result, ctx) {
  if (!ctx || !result || typeof result !== 'object' || result.error) return result;
  const vis = await readVisibility();
  if (name === 'list_categories' && Array.isArray(result.categories)) {
    return { ...result, categories: result.categories.filter(c => categoryVisibleTo(c, ctx.user, vis)) };
  }
  // A single row read by id that turns out to be someone else's → not found.
  if (!Array.isArray(result) && !rowVisible(result, ctx, vis)) return { error: 'not found' };
  return filterDeep(result, ctx, vis);
}

// Boot-time repair: give legacy uncategorised events and unlinked timeblocks an
// owner so they stay private to the person who made them, and de-duplicate event ids.
// Returns whether events.json changed, so the caller can re-mirror the index.
export async function stampLegacyOwners() {
  let eventsChanged = false;
  const ev = await readJSON('state/events.json', null);
  if (ev && Array.isArray(ev.events)) {
    let n = 0;
    for (const e of ev.events) if (!e.category && !e.owner) { e.owner = LEGACY_OWNER; n++; }
    // Older builds numbered events by count, so a deletion could reuse an id.
    // Give every repeat after the first a fresh id so each row is addressable.
    const used = new Set();
    let next = ev.events.length + 1;
    for (const e of ev.events) {
      if (!used.has(e.id)) { used.add(e.id); continue; }
      while (used.has(`evt-${String(next).padStart(3, '0')}`) || ev.events.some(x => x.id === `evt-${String(next).padStart(3, '0')}`)) next++;
      e.id = `evt-${String(next).padStart(3, '0')}`;
      used.add(e.id); n++;
    }
    if (n) { await writeJSON('state/events.json', ev); eventsChanged = true; }
  }
  const tb = await readJSON('state/timeblocks.json', null);
  if (tb && Array.isArray(tb.blocks)) {
    let n = 0;
    for (const b of tb.blocks) if (!b.epic_slug && !b.owner) { b.owner = LEGACY_OWNER; n++; }
    if (n) await writeJSON('state/timeblocks.json', tb);
  }
  return { eventsChanged };
}
