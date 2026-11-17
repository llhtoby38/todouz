// brain.mjs — the "second brain": durable, atomic, linked knowledge notes that
// any AI session (the in-app agent, Claude Code on a laptop, claude.ai, ChatGPT
// via the HTTP API) can read and build out over time.
//
// Design (Building a Second Brain + evergreen notes, adapted to todouz):
//   - todouz already holds PARA's Projects (folders) and Areas (lists). The brain
//     is the missing Resources layer: concepts, people, decisions, learnings,
//     preferences, sources. Notes LINK to folders/items via `projects:` instead
//     of duplicating them.
//   - One idea per note, `[[wikilinks]]` between notes, and a maturity status
//     (seed → growing → evergreen) that is the "Distill" step.
//   - Raw captures land as type `inbox` to be distilled later.
//   - Every write is stamped with `source` (which session wrote it) and the
//     previous version is kept in a per-note history, so anything an agent
//     writes can be reviewed and reverted.
//
// Storage: data/brain/<slug>.md (frontmatter + markdown body), history in
// data/brain/.history/<slug>.jsonl, soft-deletes in data/brain/.trash/.
// profile.md + roadmap.md stay where they are (data/personal/) and appear here
// as pinned read/write "core" notes, so everything that reads them keeps working.
//
// Ownership: every note has an `owner` (legacy notes without one belong to
// LEGACY_OWNER) and is private to them unless `shared: true`. Each user has their
// own core profile/roadmap: the legacy owner's stay in data/personal/, everyone
// else's live in data/personal/users/<user>/. "profile" always means the caller's.

import { read, write, exists, listFiles, ensureDir, removeFile } from './store.mjs';
import { parseFrontmatter, parseEpic, parseIssues } from './parsers.mjs';
import { connectionsOf, directions, dismissLink, loadLinks, RELATION_TYPES } from './brain-links.mjs';
import { currentCtx, LEGACY_OWNER } from './access.mjs';

const DIR = 'brain';
const HIST = `${DIR}/.history`;
const TRASH = `${DIR}/.trash`;
const APP_BASE = (process.env.TODOUZ_PUBLIC_URL || `http://localhost:${process.env.PORT || 8765}`).replace(/\/+$/, '');

export const BRAIN_TYPES = ['note', 'concept', 'person', 'decision', 'learning', 'preference', 'source', 'goal', 'inbox'];
export const BRAIN_STATUSES = ['seed', 'growing', 'evergreen', 'archived'];
const CORE = {
  profile: { title: 'Profile' },
  roadmap: { title: 'Roadmap' },
};

// Where a user's core note lives on disk.
export function profileRelFor(user, which = 'profile') {
  const u = String(user || LEGACY_OWNER).toLowerCase();
  if (u === LEGACY_OWNER) return `personal/${which}.md`;
  if (!/^[a-z][a-z0-9_-]{1,31}$/.test(u)) throw new Error('bad user');
  return `personal/users/${u}/${which}.md`;
}
const me = () => currentCtx()?.user || LEGACY_OWNER;
const coreRel = (slug) => profileRelFor(me(), slug);
// History of core notes is per user too (profile.jsonl stays the legacy owner's).
const histKey = (slug) => (CORE[slug] && me() !== LEGACY_OWNER) ? `${slug}--${me()}` : slug;
const ownerOfNote = (n) => n.owner || LEGACY_OWNER;
function canSeeNote(n) {
  const ctx = currentCtx();
  return !ctx || n.core || n.shared === true || ownerOfNote(n) === ctx.user;
}
function canEditNote(n) {
  const ctx = currentCtx();
  return !ctx || n.core || ownerOfNote(n) === ctx.user;
}

const nowISO = () => new Date().toISOString();
const appUrl = (slug) => `${APP_BASE}/dashboard/#brain=${encodeURIComponent(slug)}`;

export function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '') || 'note';
}
const arr = (v) => (Array.isArray(v) ? v : (v == null || v === '' ? [] : String(v).split(','))).map(x => String(x).trim()).filter(Boolean);
const normTags = (v) => [...new Set(arr(v).map(t => t.toLowerCase().replace(/\s+/g, '-')))];
const firstHeading = (body) => { const m = /^#\s+(.+)$/m.exec(body || ''); return m ? m[1].trim() : null; };

// ─── read / serialise ────────────────────────────────────────────────
function parseNote(slug, md) {
  const { frontmatter: fm, body } = parseFrontmatter(md || '');
  return {
    slug,
    title: String(fm.title || firstHeading(body) || slug),
    type: BRAIN_TYPES.includes(fm.type) ? fm.type : 'note',
    status: BRAIN_STATUSES.includes(fm.status) ? fm.status : 'seed',
    tags: normTags(fm.tags),
    projects: arr(fm.projects),
    created: fm.created ? String(fm.created) : null,
    updated: fm.updated ? String(fm.updated) : null,
    source: fm.source ? String(fm.source) : null,
    owner: String(fm.owner || LEGACY_OWNER),
    shared: fm.shared === true || fm.shared === 'true',
    body: String(body || '').replace(/^\n+/, ''),
    core: false,
  };
}

function serializeNote(n) {
  const q = (s) => '"' + String(s ?? '').replace(/"/g, "'").replace(/\r?\n/g, ' ') + '"';
  const list = (a) => '[' + a.map(x => String(x).replace(/[,[\]]/g, ' ').trim()).filter(Boolean).join(', ') + ']';
  return [
    '---',
    `title: ${q(n.title)}`,
    `type: ${n.type}`,
    `status: ${n.status}`,
    `tags: ${list(n.tags)}`,
    `projects: ${list(n.projects)}`,
    `created: ${n.created}`,
    `updated: ${n.updated}`,
    `source: ${q(n.source || 'unknown')}`,
    `owner: ${n.owner || LEGACY_OWNER}`,
    `shared: ${n.shared ? 'true' : 'false'}`,
    '---',
    '',
    String(n.body || '').trimEnd(),
    '',
  ].join('\n');
}

async function readCore(slug) {
  const c = CORE[slug];
  const md = await read(coreRel(slug));
  return {
    slug, title: firstHeading(md) || c.title, type: 'core', status: 'evergreen',
    tags: [], projects: [], created: null, updated: null, source: me(), owner: me(), shared: false,
    body: md, core: true,
  };
}

// Any note on disk, whoever owns it. Internal: callers must check canSeeNote.
async function readNoteAny(slug) {
  if (CORE[slug]) return await readCore(slug);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return null;
  if (!await exists(`${DIR}/${slug}.md`)) return null;
  return parseNote(slug, await read(`${DIR}/${slug}.md`));
}
async function readNote(slug) {
  const n = await readNoteAny(slug);
  return n && canSeeNote(n) ? n : null;
}

async function loadAll({ includeCore = true } = {}) {
  const files = (await listFiles(DIR)).filter(f => f.endsWith('.md'));
  const notes = [];
  for (const f of files) {
    const slug = f.slice(0, -3);
    if (CORE[slug]) continue;
    try { const n = parseNote(slug, await read(`${DIR}/${f}`)); if (canSeeNote(n)) notes.push(n); } catch {}
  }
  if (includeCore) for (const s of Object.keys(CORE)) notes.push(await readCore(s));
  return notes;
}

// ─── links ───────────────────────────────────────────────────────────
const WIKI_RE = /\[\[([^\]|#\n]+)(?:[|#][^\]\n]*)?\]\]/g;
function wikiTargets(body) {
  const out = []; let m;
  WIKI_RE.lastIndex = 0;
  while ((m = WIKI_RE.exec(body || ''))) out.push(m[1].trim());
  return out;
}
function makeResolver(notes) {
  const bySlug = new Map(notes.map(n => [n.slug, n]));
  const byTitle = new Map(notes.map(n => [n.title.toLowerCase(), n]));
  return (target) => bySlug.get(target) || bySlug.get(slugify(target)) || byTitle.get(String(target).toLowerCase()) || null;
}

async function resolveProject(ref) {
  const parts = String(ref).split('/');
  if (parts.length < 2) return { ref, kind: 'missing', title: ref };
  const [cat, short, id] = parts;
  const epicSlug = `${cat}/${short}`;
  const epicMd = await read(`epics/${cat}/${short}/epic.md`);
  if (!epicMd) return { ref, kind: 'missing', title: ref };
  if (!id) {
    const fm = parseEpic(epicMd).frontmatter || {};
    return { ref, kind: 'epic', epic_slug: epicSlug, title: fm.title || short };
  }
  const issue = parseIssues(await read(`epics/${cat}/${short}/issues.md`)).issues.find(i => i.id === id);
  return issue ? { ref, kind: 'issue', epic_slug: epicSlug, id, title: issue.title } : { ref, kind: 'missing', title: ref };
}

// ─── history (provenance + revert) ───────────────────────────────────
async function readHistory(slug) {
  const txt = await read(`${HIST}/${histKey(slug)}.jsonl`);
  return txt.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
async function appendHistory(slug, entry) {
  const prev = await read(`${HIST}/${histKey(slug)}.jsonl`);
  await write(`${HIST}/${histKey(slug)}.jsonl`, prev + JSON.stringify(entry) + '\n');
}
async function rawOf(slug) { return CORE[slug] ? await read(coreRel(slug)) : await read(`${DIR}/${slug}.md`); }
async function writeRaw(slug, md) { await write(CORE[slug] ? coreRel(slug) : `${DIR}/${slug}.md`, md); }

// ─── summaries / search ──────────────────────────────────────────────
// Markdown → plain text for list snippets (no **, #, [[ ]], link URLs, etc.).
function plainText(md) {
  return String(md || '')
    .replace(/^---[\s\S]*?---\n/, '')
    .replace(/^\s*#\s+.*\n/, '')                                   // leading title heading
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')                          // images
    .replace(/\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g, (m, a, b) => b || a)  // wikilinks
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')                        // links
    .replace(/^\s{0,3}(#{1,6}|[-*+]|\d+\.|>)\s+/gm, '')             // headings, bullets, quotes
    .replace(/(\*\*|__|~~|`)/g, '').replace(/(^|\s)[*_](\S)/g, '$1$2').replace(/(\S)[*_](?=\s|$|[.,;:!?])/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
function snippetOf(body, term) {
  const b = plainText(body);
  if (!term) return b.slice(0, 160);
  const i = b.toLowerCase().indexOf(term);
  if (i < 0) return b.slice(0, 160);
  const start = Math.max(0, i - 70);
  return (start > 0 ? '…' : '') + b.slice(start, i + 110) + (i + 110 < b.length ? '…' : '');
}
const summary = (n, extra = {}) => ({
  slug: n.slug, title: n.title, type: n.type, status: n.status, tags: n.tags, projects: n.projects,
  updated: n.updated, created: n.created, source: n.source, core: n.core, owner: n.owner, shared: !!n.shared, ...extra,
});

async function brainSearch({ query = '', type, tag, status, project, limit = 50, include_archived = false } = {}) {
  const all = await loadAll();
  const q = String(query || '').toLowerCase().trim();
  const terms = q.split(/\s+/).filter(Boolean);
  // Facets over the unfiltered set so the UI can show counts.
  const facets = { type: {}, status: {}, tags: {} };
  for (const n of all) {
    facets.type[n.type] = (facets.type[n.type] || 0) + 1;
    facets.status[n.status] = (facets.status[n.status] || 0) + 1;
    for (const t of n.tags) facets.tags[t] = (facets.tags[t] || 0) + 1;
  }
  let rows = all.filter(n =>
    (!type || n.type === type) &&
    (!tag || n.tags.includes(String(tag).toLowerCase())) &&
    (status ? n.status === status : (include_archived || n.status !== 'archived')) &&
    (!project || n.projects.some(p => p === project || p.startsWith(String(project) + '/'))));
  if (terms.length) {
    rows = rows.map(n => {
      const title = n.title.toLowerCase(), body = n.body.toLowerCase(), tags = n.tags.join(' '), projs = n.projects.join(' ').toLowerCase();
      let score = 0;
      for (const t of terms) {
        let s = 0;
        if (title.includes(t)) s += 6;
        if (tags.includes(t)) s += 4;
        if (projs.includes(t)) s += 2;
        let i = -1, c = 0; while ((i = body.indexOf(t, i + 1)) >= 0 && c < 5) c++;
        s += c;
        if (!s) return null;   // every term must match somewhere (AND)
        score += s;
      }
      if (n.status === 'evergreen' || n.core) score += 1;
      return { n, score };
    }).filter(Boolean).sort((a, b) => b.score - a.score).map(({ n, score }) => summary(n, { score, snippet: snippetOf(n.body, terms[0]) }));
  } else {
    rows = rows.sort((a, b) => (b.core - a.core) || String(b.updated || '').localeCompare(String(a.updated || '')))
      .map(n => summary(n, { snippet: snippetOf(n.body) }));
  }
  return { count: rows.length, notes: rows.slice(0, Math.max(1, Math.min(500, Number(limit) || 50))), facets };
}

async function brainRead({ slug } = {}) {
  slug = String(slug || '');
  const note = await readNote(slug);
  if (!note) return { error: `brain note not found: ${slug}` };
  const all = await loadAll();
  const resolve = makeResolver(all);
  const outlinks = [...new Set(wikiTargets(note.body))].map(t => { const r = resolve(t); return { target: t, slug: r?.slug || null, title: r?.title || t }; });
  const backlinks = all.filter(n => n.slug !== slug && wikiTargets(n.body).some(t => resolve(t)?.slug === slug))
    .map(n => ({ slug: n.slug, title: n.title, type: n.type }));
  const projects = [];
  for (const p of note.projects) projects.push(await resolveProject(p));
  const history = await readHistory(slug);
  // Typed links the Brain made by itself (supports / contradicts / limits / extends / tradeoff / applies_to).
  const connections = note.core ? [] : await connectionsOf(`note:${slug}`).catch(() => []);
  return { ...note, outlinks, backlinks, connections, projects_resolved: projects, history_count: history.length, app_url: appUrl(slug) };
}

async function uniqueSlug(base) {
  let s = slugify(base), i = 2;
  while (CORE[s] || await exists(`${DIR}/${s}.md`)) s = `${slugify(base).slice(0, 55)}-${i++}`;
  return s;
}

async function brainWrite(args = {}) {
  // Inside a scheduled routine (env set by the runner) the routine is the true author.
  const source = String(process.env.TODOUZ_ROUTINE || args.source || 'mcp').slice(0, 80);
  const mode = args.mode === 'append' ? 'append' : 'replace';
  let slug = args.slug != null && args.slug !== '' ? String(args.slug) : null;
  let existing = slug ? await readNote(slug) : null;
  if (slug && !existing && !CORE[slug]) slug = slugify(slug);
  if (slug && !existing) existing = await readNote(slug);
  // Someone else's private note with this slug: never touch it — this becomes a new note.
  if (slug && !existing && await readNoteAny(slug)) slug = await uniqueSlug(slug);
  if (existing && !canEditNote(existing)) return { error: `"${existing.slug}" is shared by ${existing.owner}; only they can change it. Write your own note and link it with [[${existing.slug}]].` };
  const body = args.body != null ? String(args.body) : null;
  const stamp = nowISO();

  // Core notes (profile / roadmap): body only, written back verbatim.
  if (existing && existing.core) {
    if (body == null) return { error: 'core notes only accept a body' };
    const prev = await rawOf(slug);
    const next = mode === 'append' ? prev.trimEnd() + '\n\n' + body.trim() + '\n' : body;
    await appendHistory(slug, { at: stamp, source, action: mode === 'append' ? 'append' : 'update', prev });
    await writeRaw(slug, next);
    return { ok: true, slug, created: false, core: true, app_url: appUrl(slug) };
  }

  if (!existing) {
    const title = String(args.title || '').trim() || (body ? body.trim().split('\n')[0].replace(/^#+\s*/, '').slice(0, 60) : '');
    if (!title) return { error: 'title (or a body to derive one from) is required to create a note' };
    if (!slug) slug = await uniqueSlug(title);
    const note = {
      slug, title,
      type: BRAIN_TYPES.includes(args.type) ? args.type : 'note',
      status: BRAIN_STATUSES.includes(args.status) ? args.status : 'seed',
      tags: normTags(args.tags), projects: arr(args.projects),
      created: stamp, updated: stamp, source, body: body || '',
      owner: me(), shared: args.shared === true || args.shared === 'true',
    };
    await ensureDir(DIR);
    await writeRaw(slug, serializeNote(note));
    await appendHistory(slug, { at: stamp, source, action: 'create', prev: null });
    return { ok: true, slug, created: true, note: summary(note), app_url: appUrl(slug) };
  }

  const prev = await rawOf(slug);
  const note = { ...existing };
  if (args.title != null && String(args.title).trim()) note.title = String(args.title).trim();
  if (BRAIN_TYPES.includes(args.type)) note.type = args.type;
  if (BRAIN_STATUSES.includes(args.status)) note.status = args.status;
  if (args.tags != null) note.tags = mode === 'append' ? normTags([...note.tags, ...arr(args.tags)]) : normTags(args.tags);
  if (args.projects != null) note.projects = mode === 'append' ? [...new Set([...note.projects, ...arr(args.projects)])] : arr(args.projects);
  if (body != null) note.body = mode === 'append' ? (note.body.trimEnd() + '\n\n' + body.trim()) : body;
  if (args.shared != null) note.shared = args.shared === true || args.shared === 'true';
  note.updated = stamp;
  note.source = source;
  await appendHistory(slug, { at: stamp, source, action: mode === 'append' ? 'append' : 'update', prev });
  await writeRaw(slug, serializeNote(note));
  return { ok: true, slug, created: false, note: summary(note), app_url: appUrl(slug) };
}

async function brainCapture({ text, title, source, tags, projects } = {}) {
  const t = String(text || '').trim();
  if (!t) return { error: 'text is required' };
  return await brainWrite({
    title: title || t.split('\n')[0].replace(/^#+\s*/, '').slice(0, 60),
    body: t, type: 'inbox', status: 'seed', tags, projects, source: source || 'mcp',
  });
}

async function brainHistory({ slug } = {}) {
  slug = String(slug || '');
  if (!await readNote(slug)) return { error: `brain note not found: ${slug}` };
  const h = await readHistory(slug);
  return {
    slug,
    versions: h.map((e, i) => ({ version: i, at: e.at, source: e.source, action: e.action, has_snapshot: e.prev != null }))
      .reverse(),
  };
}

// Restore the content as it was BEFORE history entry `version` was applied.
async function brainRevert({ slug, version, source } = {}) {
  slug = String(slug || '');
  const n = await readNote(slug);
  if (!n) return { error: `brain note not found: ${slug}` };
  if (!canEditNote(n)) return { error: `only ${n.owner} can revert "${slug}"` };
  const h = await readHistory(slug);
  const e = h[Number(version)];
  if (!e) return { error: `no history version ${version} for ${slug}` };
  if (e.prev == null) return { error: 'that version created the note — delete it instead of reverting' };
  const cur = await rawOf(slug);
  await appendHistory(slug, { at: nowISO(), source: String(source || 'mcp'), action: `revert:${version}`, prev: cur });
  await writeRaw(slug, e.prev);
  return { ok: true, slug, restored_from: e.at };
}

// Soft delete: the file moves to .trash and the history is kept.
async function brainDelete({ slug, source } = {}) {
  slug = String(slug || '');
  if (CORE[slug]) return { error: 'core notes cannot be deleted' };
  const note = await readNote(slug);
  if (!note) return { error: `brain note not found: ${slug}` };
  if (!canEditNote(note)) return { error: `only ${note.owner} can delete "${slug}"` };
  const cur = await rawOf(slug);
  await write(`${TRASH}/${slug}-${Date.now()}.md`, cur);
  await appendHistory(slug, { at: nowISO(), source: String(source || 'mcp'), action: 'delete', prev: cur });
  await removeFile(`${DIR}/${slug}.md`);
  return { ok: true, slug, trashed: true };
}

// A compact, size-bounded pack a fresh AI session reads FIRST so it starts out
// knowing the user: core identity, standing preferences, the notes most relevant to
// the topic, and how to write back.
async function brainContext({ topic = '', limit = 8, max_chars = 9000 } = {}) {
  const all = await loadAll();
  const live = all.filter(n => n.status !== 'archived');
  const clip = (s, n) => { s = String(s || '').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };
  const profile = live.find(n => n.slug === 'profile');
  const roadmap = live.find(n => n.slug === 'roadmap');
  const prefs = live.filter(n => n.type === 'preference').map(n => ({ slug: n.slug, title: n.title, text: clip(n.body, 300) }));
  let relevant;
  if (String(topic).trim()) {
    relevant = (await brainSearch({ query: topic, limit })).notes.filter(n => !n.core);
  } else {
    relevant = live.filter(n => !n.core && n.type !== 'inbox' && n.type !== 'preference')
      .sort((a, b) => ((b.status === 'evergreen') - (a.status === 'evergreen')) || String(b.updated || '').localeCompare(String(a.updated || '')))
      .slice(0, limit).map(n => summary(n, { snippet: snippetOf(n.body) }));
  }
  const pack = {
    about: `${me()}'s todouz second brain (user "${me()}"). Treat it as durable memory shared across all of ${me()}'s AI sessions. Only notes this user owns or that are shared are included.`,
    core: {
      profile: profile ? clip(profile.body, 2500) : null,
      roadmap: roadmap ? clip(roadmap.body, 1200) : null,
    },
    preferences: prefs,
    relevant: relevant.map(n => ({ slug: n.slug, title: n.title, type: n.type, status: n.status, snippet: n.snippet })),
    index: live.filter(n => !n.core).slice(0, 200).map(n => `${n.slug} — ${n.title} (${n.type})`),
    inbox_count: live.filter(n => n.type === 'inbox').length,
    // Where the user's own notes disagree: weigh these before answering on those topics.
    disagreements: (await directions({ top: 6 }).catch(() => ({ disagreements: [] }))).disagreements.map(x => `${x.a} ⟷ ${x.b}: ${x.insight}`),
    how_to_write_back: [
      'brain_search / brain_read before writing, to update an existing note instead of duplicating it.',
      'One idea per note. Link related notes with [[slug]] and link folders/items via projects: ["category/folder" or "category/folder/ISS-001"].',
      'Durable facts, decisions, preferences and learnings → brain_write (type + status seed). Unsure or raw material → brain_capture (goes to the Inbox).',
      'Always pass source: a short name for your session (e.g. "claude-code-laptop", "claude-ai", "chatgpt").',
      'Prefer mode:"append" to add an observation to an existing note rather than overwriting it.',
    ],
  };
  // Keep under max_chars by trimming the least important parts first.
  const size = () => JSON.stringify(pack).length;
  while (size() > max_chars && pack.index.length > 20) pack.index = pack.index.slice(0, Math.floor(pack.index.length * 0.7));
  while (size() > max_chars && pack.relevant.length > 3) pack.relevant.pop();
  if (size() > max_chars && pack.core.profile) pack.core.profile = clip(pack.core.profile, 1200);
  return pack;
}

// The whole Brain as a graph: notes plus the typed links between them.
async function brainGraph() {
  const notes = (await loadAll({ includeCore: false })).filter(n => n.status !== 'archived');
  const live = new Set(notes.map(n => n.slug));
  const d = await loadLinks();
  const edges = d.links.filter(l => l.from.startsWith('note:') && l.to.startsWith('note:') && live.has(l.from.slice(5)) && live.has(l.to.slice(5)))
    .map(l => ({ id: l.id, from: l.from.slice(5), to: l.to.slice(5), type: l.type, insight: l.insight }));
  return { nodes: notes.map(n => ({ slug: n.slug, title: n.title, type: n.type, status: n.status, tags: n.tags || [], updated: n.updated || n.created || null })), edges, ...(await directions({ top: 5 })) };
}

// ─── tool catalogue + dispatcher ─────────────────────────────────────
const SOURCE = { type: 'string', description: 'A short name for the session YOU are running in (the app or machine you are in). Recorded as provenance. Scheduled routines are stamped automatically.' };
export const BRAIN_TOOLS = [
  {
    name: 'brain_context',
    description: 'Second brain: call this FIRST in a new session. Returns a compact context pack — the calling user\'s core profile + roadmap, standing preferences, the notes most relevant to `topic`, an index of all notes, and how to write back.',
    inputSchema: { type: 'object', properties: { topic: { type: 'string', description: 'What this session is about (optional).' }, limit: { type: 'number' }, max_chars: { type: 'number' } }, additionalProperties: false },
  },
  {
    name: 'brain_search',
    description: 'Search the second brain (title > tags > body; all terms must match). Empty query lists notes by most recently updated. Filters: type, tag, status, project (a "category/folder" slug). Returns summaries + snippets + facet counts.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' }, type: { type: 'string', enum: [...BRAIN_TYPES, 'core'] }, tag: { type: 'string' },
        status: { type: 'string', enum: BRAIN_STATUSES }, project: { type: 'string' }, limit: { type: 'number' }, include_archived: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'brain_read',
    description: 'Read one second-brain note in full, with its backlinks, outgoing [[wikilinks]], linked todouz folders/items and history count. Slugs "profile" and "roadmap" are the pinned core notes.',
    inputSchema: { type: 'object', properties: { slug: { type: 'string' } }, required: ['slug'], additionalProperties: false },
  },
  {
    name: 'brain_write',
    description: 'Create or update a second-brain note. Omit slug to create (slug derived from title). Keep notes atomic (one idea), link related notes with [[slug]] in the body, and link todouz folders/items via projects (["category/folder"] or ["category/folder/ISS-001"]). mode "append" adds body text / tags / projects to an existing note instead of replacing. Every write is recorded with its source and is revertible.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string' }, title: { type: 'string' }, body: { type: 'string', description: 'Markdown.' },
        type: { type: 'string', enum: BRAIN_TYPES }, status: { type: 'string', enum: BRAIN_STATUSES },
        tags: { type: 'array', items: { type: 'string' } }, projects: { type: 'array', items: { type: 'string' } },
        mode: { type: 'string', enum: ['replace', 'append'] }, source: SOURCE,
        shared: { type: 'boolean', description: 'Make the note visible to every user of this todouz (default false: private to you). Only the owner can change a note.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'brain_capture',
    description: 'Quick-capture raw material (a thought, quote, link, observation) into the second brain Inbox to be distilled later. Use when something is worth keeping but you are not sure where it belongs.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' }, title: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, projects: { type: 'array', items: { type: 'string' } }, source: SOURCE },
      required: ['text'], additionalProperties: false,
    },
  },
  {
    name: 'brain_links',
    description: `The Brain links its notes by itself, with typed relations (${RELATION_TYPES.join(', ')}), each with a one-line insight and a quote from each side as evidence. Pass slug for one note's connections; omit it for the knowledge directions: tensions (notes both supported and challenged), disagreements (notes that contradict each other), evidence building, growing, and lonely new notes with no links yet. When notes disagree, say under what conditions each side holds instead of picking one silently.`,
    inputSchema: { type: 'object', properties: { slug: { type: 'string' }, top: { type: 'number' }, graph: { type: 'boolean', description: 'Return every note and link as a graph (plus the directions).' } }, additionalProperties: false },
  },
  {
    name: 'brain_link_dismiss',
    description: 'Remove an automatic link between two notes that is wrong. The pair is never linked again.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'The link id (lk-…) from brain_read connections or brain_links.' } }, required: ['id'], additionalProperties: false },
  },
  {
    name: 'brain_history',
    description: 'List the change history of a second-brain note (who/which session changed it, when, and how). Newest first.',
    inputSchema: { type: 'object', properties: { slug: { type: 'string' } }, required: ['slug'], additionalProperties: false },
  },
  {
    name: 'brain_revert',
    description: 'Restore a second-brain note to how it was BEFORE the given history version was applied (version numbers come from brain_history).',
    inputSchema: { type: 'object', properties: { slug: { type: 'string' }, version: { type: 'number' }, source: SOURCE }, required: ['slug', 'version'], additionalProperties: false },
  },
  {
    name: 'brain_delete',
    description: 'Soft-delete a second-brain note (moved to trash, history kept). Prefer status "archived" for notes that are just no longer relevant.',
    inputSchema: { type: 'object', properties: { slug: { type: 'string' }, source: SOURCE }, required: ['slug'], additionalProperties: false },
  },
];

export async function handleBrainCall(name, args = {}) {
  switch (name) {
    case 'brain_context': return await brainContext(args);
    case 'brain_search':  return await brainSearch(args);
    case 'brain_read':    return await brainRead(args);
    case 'brain_write':   return await brainWrite(args);
    case 'brain_capture': return await brainCapture(args);
    case 'brain_links':
      if (args.slug) {
        if (!await readNote(String(args.slug))) return { error: `brain note not found: ${args.slug}` };
        return { slug: args.slug, connections: await connectionsOf(`note:${args.slug}`) };
      }
      if (args.graph) return await brainGraph();
      return await directions({ top: Number(args.top) || 5 });
    case 'brain_link_dismiss': return await dismissLink(String(args.id || ''));
    case 'brain_history': return await brainHistory(args);
    case 'brain_revert':  return await brainRevert(args);
    case 'brain_delete':  return await brainDelete(args);
    default: return undefined;
  }
}
