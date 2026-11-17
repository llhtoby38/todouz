// brain-links.mjs — the Brain links itself. Every note (and every news / deep /
// insight post in the feed) is compared with the notes most likely to relate to
// it, and a model decides HOW they relate, one of six typed relations:
//
//   supports     A strengthens B's claim
//   contradicts  A argues against B
//   limits       A says where B stops being true
//   extends      A takes B to a new question or method
//   tradeoff     A and B pull against each other; you have to choose or balance
//   applies_to   A is a concrete place to use B (or the other way round)
//
// Adapted from the relation vocabulary in Adam Chan's creative-second-brain
// (ideas only): a link must say what putting the two together helps the user think,
// carry a short verbatim quote from each side as evidence, and "same topic" is
// never enough to link. Quotes are checked against the text; a link with no
// verifiable evidence on either side is dropped. Nobody has to approve a link;
// a dismissed link is remembered and never proposed again.
//
// Storage: data/brain/.links.json (written only by the HTTP server's linker).
// The MCP process reads it for brain_read / brain_links.

import { createHash, randomBytes } from 'node:crypto';
import { read, write, exists, listFiles, readJSON, writeJSON } from './store.mjs';
import { currentCtx, LEGACY_OWNER } from './access.mjs';
import { parseFrontmatter } from './parsers.mjs';

export const RELATION_TYPES = ['supports', 'contradicts', 'limits', 'extends', 'tradeoff', 'applies_to'];
const FILE = 'brain/.links.json';
const DAY = 86400000;
const CANDIDATES = 6;                 // notes shown to the model per item
const MAX_LINKS_PER_ITEM = 4;
const POST_KINDS = ['news', 'deep', 'insight', 'share', 'note'];
const POST_WINDOW_DAYS = 30;

// ─── store ───────────────────────────────────────────────────────────
export async function loadLinks() {
  const d = (await readJSON(FILE, null)) || {};
  return { links: d.links || [], state: d.state || {}, rejected: d.rejected || [] };
}
async function saveLinks(d) { await writeJSON(FILE, { version: 1, ...d }); }
const pairKey = (a, b) => [a, b].sort().join('|');

// ─── text ────────────────────────────────────────────────────────────
function plain(md) {
  return String(md || '')
    .replace(/```[\s\S]*?```/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g, (m, a, b) => b || a)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/^\s{0,3}(#{1,6}|[-*+]|\d+\.|>)\s+/gm, '')
    .replace(/(\*\*|__|~~|`)/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
const norm = (s) => String(s || '').toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const hashOf = (s) => createHash('sha1').update(s).digest('hex').slice(0, 16);

const STOP = new Set('the a an and or but if then of to in on for with at by from as is are was were be been being it its this that these those into over under about than more most less very can could should would will just also not no yes you your our we they them their there here what when where which who how why all any each some such only own same so too out up down off again once do does did done have has had having i me my he she his her him'.split(' '));
function tokens(text) {
  const out = [];
  const s = String(text || '').toLowerCase();
  for (const w of s.match(/[a-z][a-z0-9'-]{2,}/g) || []) { const t = w.replace(/'s$/, '').replace(/s$/, ''); if (!STOP.has(w) && t.length > 2) out.push(t); }
  const cjk = s.match(/[㐀-鿿]+/g) || [];
  for (const run of cjk) for (let i = 0; i < run.length - 1; i++) out.push(run.slice(i, i + 2));
  return out;
}

// ─── items: notes + recent feed posts ────────────────────────────────
async function loadNotes() {
  const out = [];
  for (const f of (await listFiles('brain')).filter(f => f.endsWith('.md'))) {
    try {
      const { frontmatter: fm, body } = parseFrontmatter(await read(`brain/${f}`));
      if (fm.status === 'archived') continue;
      const slug = f.slice(0, -3);
      const title = String(fm.title || slug);
      const tags = Array.isArray(fm.tags) ? fm.tags : String(fm.tags || '').split(',').map(x => x.trim()).filter(Boolean);
      const wiki = (String(body).match(/\[\[([^\]|#\n]+)/g) || []).map(x => x.slice(2).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''));
      out.push({ key: `note:${slug}`, slug, kind: 'note', title, type: fm.type || 'note', tags, created: fm.created || null,
        owner: String(fm.owner || LEGACY_OWNER), shared: fm.shared === true || fm.shared === 'true',
        notes: wiki, text: plain(body), hash: hashOf(`${title}\n${tags.join(',')}\n${body}`) });
    } catch {}
  }
  return out;
}
async function loadRecentPosts() {
  const out = [];
  const cutoff = Date.now() - POST_WINDOW_DAYS * DAY;
  for (const f of (await listFiles('feed')).filter(f => f.endsWith('.json'))) {
    try {
      const p = JSON.parse(await read(`feed/${f}`));
      if (!POST_KINDS.includes(p.kind) || new Date(p.created).getTime() < cutoff) continue;
      if (p.source === 'feed-refill') continue;      // made FROM the Brain; linking it back is circular
      const text = plain([p.hook, p.body].filter(Boolean).join('\n\n'));
      out.push({ key: `post:${p.id}`, id: p.id, kind: 'post', title: p.title, tags: p.tags || [], created: p.created, owner: String(p.owner || LEGACY_OWNER),
        notes: p.notes || [], text, hash: hashOf(`${p.title}\n${text}`) });
    } catch {}
  }
  return out;
}

// Can the current caller see this note/post key? (No caller = operator → yes.)
async function postOwners() {
  const out = [];
  for (const f of (await listFiles('feed')).filter(f => f.endsWith('.json'))) {
    try { const p = JSON.parse(await read(`feed/${f}`)); out.push({ key: `post:${p.id}`, owner: String(p.owner || LEGACY_OWNER) }); } catch {}
  }
  return out;
}
function makeCanSee(notes, posts = []) {
  const ctx = currentCtx();
  if (!ctx) return () => true;
  const own = new Map([...notes, ...posts].map(n => [n.key, n]));
  return (key) => { const n = own.get(key); return !!n && (n.owner === ctx.user || n.shared === true); };
}

// BM25-lite over the notes: which notes is this item most likely to relate to?
function rankCandidates(item, notes) {
  // Only within one person's notes: a link's insight quotes both sides, so a
  // cross-owner link would leak one person's private note to the other.
  const docs = notes.filter(n => n.key !== item.key && n.owner === item.owner).map(n => ({ n, toks: tokens(`${n.title} ${n.title} ${n.title} ${n.tags.join(' ')} ${n.tags.join(' ')} ${n.text.slice(0, 4000)}`) }));
  if (!docs.length) return [];
  const df = new Map();
  for (const d of docs) for (const t of new Set(d.toks)) df.set(t, (df.get(t) || 0) + 1);
  const N = docs.length, avg = docs.reduce((s, d) => s + d.toks.length, 0) / N || 1;
  const q = [...new Set(tokens(`${item.title} ${item.title} ${item.tags.join(' ')} ${item.text.slice(0, 3000)}`))];
  const k1 = 1.2, b = 0.75;
  const scored = docs.map(({ n, toks }) => {
    const tf = new Map(); for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    let s = 0;
    for (const t of q) {
      const f = tf.get(t); if (!f) continue;
      const idf = Math.log(1 + (N - df.get(t) + 0.5) / (df.get(t) + 0.5));
      s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * toks.length / avg));
    }
    return { n, s };
  }).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
  // Notes the item already names ([[wikilinks]] / a post's notes) always get a look.
  const named = new Set(item.notes || []);
  const pinned = notes.filter(n => n.key !== item.key && named.has(n.slug));
  const out = [...pinned];
  for (const { n } of scored) { if (out.length >= CANDIDATES) break; if (!out.includes(n)) out.push(n); }
  return out.slice(0, CANDIDATES);
}

// ─── the model's judgement ───────────────────────────────────────────
const SYSTEM = `You link ideas in the user's second brain. You are given one TARGET and a few CANDIDATE notes. For each candidate, decide whether the two have a real reasoning relationship, and if so which one, seen from the TARGET:
- supports: the target strengthens or gives evidence for the candidate's claim
- contradicts: the target argues against the candidate, or they cannot both be right as stated
- limits: the target says where or when the candidate stops being true
- extends: the target takes the candidate to a new question, method or domain
- tradeoff: the two pull against each other and the user has to choose or balance them
- applies_to: the target is a concrete situation to use the candidate in, or the other way round

Rules:
- Sharing a topic, a word or a project is NOT a relationship. Skip the candidate unless putting the two side by side changes or sharpens what the user would think or do.
- insight: one sentence in plain British English saying what putting the two together helps the user think or decide. Specific, no em dashes, no hype. Do not just restate either note. Name the ideas themselves; never write "the target" or "the candidate" (the user never sees those words).
- from_quote: a short phrase copied word for word from the TARGET (under 25 words). to_quote: a short phrase copied word for word from that CANDIDATE. Copy exactly; do not paraphrase.
- confidence: "high" or "medium". If it would be "low", leave the link out.
- At most ${MAX_LINKS_PER_ITEM} links. Returning no links is fine and common.
Reply with JSON only: {"links":[{"to":"<candidate slug>","type":"<relation>","insight":"...","from_quote":"...","to_quote":"...","confidence":"high|medium"}]}`;

const clip = (s, n) => (s.length > n ? s.slice(0, n) + ' …' : s);
function promptFor(item, cands) {
  const target = `TARGET (${item.kind === 'note' ? `note "${item.slug}"` : 'feed post'})\nTitle: ${item.title}\n${clip(item.text, 2800)}`;
  const list = cands.map(c => `--- CANDIDATE slug: ${c.slug}\nTitle: ${c.title}\n${clip(c.text, 1300)}`).join('\n\n');
  return `${target}\n\n${list}\n\nReturn the JSON now.`;
}
function parseJSON(text) {
  const s = String(text || ''); const i = s.indexOf('{'), j = s.lastIndexOf('}');
  if (i < 0 || j <= i) return null;
  try { return JSON.parse(s.slice(i, j + 1)); } catch { return null; }
}
// Evidence must really be in the text (whitespace, case and punctuation forgiven).
const quoteIn = (quote, text) => { const q = norm(quote); return q.length >= 8 && norm(text).includes(q); };

// Link one item. runModel({system, prompt}) → { ok, text, error }.
async function linkItem(item, notes, d, runModel) {
  // Pairs another item already judged from its side, or that the user dismissed, are skipped.
  const judged = new Set(d.links.filter(l => l.to === item.key).map(l => l.from));
  const rejected = new Set(d.rejected);
  const cands = rankCandidates(item, notes).filter(c => !judged.has(c.key) && !rejected.has(pairKey(item.key, c.key)));
  const made = [];
  if (cands.length) {
    const r = await runModel({ system: SYSTEM, prompt: promptFor(item, cands) });
    if (!r.ok) return { ok: false, error: r.error };
    const out = parseJSON(r.text);
    if (!out || !Array.isArray(out.links)) return { ok: false, error: 'model did not return JSON' };
    const bySlug = new Map(cands.map(c => [c.slug, c]));
    for (const l of out.links.slice(0, MAX_LINKS_PER_ITEM)) {
      const c = bySlug.get(String(l.to || '').trim());
      if (!c || !RELATION_TYPES.includes(l.type) || !String(l.insight || '').trim()) continue;
      if (!['high', 'medium'].includes(l.confidence)) continue;
      const fromOk = quoteIn(l.from_quote, `${item.title} ${item.text}`), toOk = quoteIn(l.to_quote, `${c.title} ${c.text}`);
      if (!fromOk && !toOk) continue;                  // no evidence we can find on either side
      made.push({
        id: `lk-${randomBytes(4).toString('hex')}`, from: item.key, to: c.key, type: l.type,
        insight: String(l.insight).trim().slice(0, 400),
        from_quote: fromOk ? String(l.from_quote).trim().slice(0, 240) : null,
        to_quote: toOk ? String(l.to_quote).trim().slice(0, 240) : null,
        confidence: l.confidence, created: new Date().toISOString(),
      });
    }
  }
  // The item's own outgoing links are replaced with this fresh judgement.
  d.links = [...d.links.filter(l => l.from !== item.key), ...made];
  d.state[item.key] = { hash: item.hash, at: new Date().toISOString(), candidates: cands.length, links: made.length };
  return { ok: true, links: made.length };
}

// What still needs (re)linking: new or changed notes, then recent posts not yet seen.
export async function pendingItems() {
  const d = await loadLinks();
  const notes = await loadNotes();
  const posts = await loadRecentPosts();
  const pend = [...notes, ...posts].filter(it => d.state[it.key]?.hash !== it.hash);
  // Notes before posts (linking ideas to each other matters most), newest first,
  // so fresh notes link quickly even while an old backlog drains.
  pend.sort((a, b) => (a.kind === 'post') - (b.kind === 'post') || String(b.created || '').localeCompare(String(a.created || '')));
  return { d, notes, pend };
}

// One linker pass: up to `max` items, one model call each, saved after every item.
export async function runLinkPass({ runModel, max = 6 } = {}) {
  const { d, notes, pend } = await pendingItems();
  const live = new Set([...notes.map(n => n.key)]);
  // Drop links to notes that were deleted or archived.
  const before = d.links.length;
  d.links = d.links.filter(l => (l.from.startsWith('post:') || live.has(l.from)) && live.has(l.to));
  let done = 0, made = 0, errors = [];
  for (const item of pend.slice(0, max)) {
    const r = await linkItem(item, notes, d, runModel);
    if (!r.ok) { errors.push(`${item.key}: ${r.error}`); break; }   // e.g. auth expired: stop, retry next pass
    done++; made += r.links;
    await saveLinks(d);
  }
  if (!done && d.links.length !== before) await saveLinks(d);
  return { ok: !errors.length, processed: done, links_made: made, remaining: Math.max(0, pend.length - done), errors };
}

// ─── reading links ───────────────────────────────────────────────────
// The other end's title, for display.
async function titleOf(key, cache) {
  if (cache.has(key)) return cache.get(key);
  let t = null;
  try {
    if (key.startsWith('note:')) {
      const slug = key.slice(5);
      if (await exists(`brain/${slug}.md`)) { const { frontmatter: fm } = parseFrontmatter(await read(`brain/${slug}.md`)); t = String(fm.title || slug); }
    } else if (key.startsWith('post:')) {
      const id = key.slice(5);
      if (await exists(`feed/${id}.json`)) t = JSON.parse(await read(`feed/${id}.json`)).title;
    }
  } catch {}
  cache.set(key, t); return t;
}
const VERB = {
  supports: ['supports', 'is supported by'], contradicts: ['contradicts', 'is contradicted by'], limits: ['limits', 'is limited by'],
  extends: ['extends', 'is extended by'], tradeoff: ['trades off against', 'trades off against'], applies_to: ['applies to', 'is applied in'],
};

// Every link touching a note or post, phrased from its point of view.
export async function connectionsOf(key, d = null) {
  d = d || await loadLinks();
  const canSee = makeCanSee(await loadNotes(), await postOwners());
  const cache = new Map();
  const out = [];
  for (const l of d.links) {
    if (l.from !== key && l.to !== key) continue;
    if (!canSee(l.from) || !canSee(l.to)) continue;
    const outgoing = l.from === key;
    const other = outgoing ? l.to : l.from;
    const title = await titleOf(other, cache);
    if (!title) continue;
    out.push({
      id: l.id, type: l.type, direction: outgoing ? 'out' : 'in', verb: VERB[l.type][outgoing ? 0 : 1],
      other: { key: other, kind: other.split(':')[0], ref: other.slice(other.indexOf(':') + 1), title },
      insight: l.insight,
      this_quote: outgoing ? l.from_quote : l.to_quote, other_quote: outgoing ? l.to_quote : l.from_quote,
      confidence: l.confidence, created: l.created,
    });
  }
  const order = ['contradicts', 'limits', 'tradeoff', 'supports', 'extends', 'applies_to'];
  return out.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
}

// Knowledge direction signals (no AI): where the Brain is pulling, growing and thin.
export async function directions({ top = 5 } = {}) {
  const d = await loadLinks();
  const allNotes = await loadNotes();
  const canSee = makeCanSee(allNotes, await postOwners());
  const notes = allNotes.filter(n => canSee(n.key));
  d.links = d.links.filter(l => canSee(l.from) && canSee(l.to));
  const byKey = new Map(notes.map(n => [n.key, n]));
  const stat = new Map(notes.map(n => [n.key, { key: n.key, slug: n.slug, title: n.title, supports: 0, extends: 0, contradicts: 0, limits: 0, tradeoff: 0, applies_to: 0, evidence: new Set(), recent: 0, total: 0 }]));
  const weekAgo = Date.now() - 7 * DAY;
  for (const l of d.links) {
    for (const [self, other] of [[l.to, l.from], [l.from, l.to]]) {
      const s = stat.get(self); if (!s) continue;
      s[l.type]++; s.total++;
      if (l.created && new Date(l.created).getTime() > weekAgo) s.recent++;
      // Evidence building: other items that back this note up (as the target of supports/extends).
      if (self === l.to && (l.type === 'supports' || l.type === 'extends')) s.evidence.add(other);
    }
  }
  const all = [...stat.values()];
  const pick = (f, sortBy) => all.filter(f).sort(sortBy).slice(0, top).map(s => ({ slug: s.slug, title: s.title,
    supports: s.supports, contradicts: s.contradicts, limits: s.limits, extends: s.extends, tradeoff: s.tradeoff, evidence: s.evidence.size, recent: s.recent, links: s.total }));
  const processed = (k) => !!d.state[k];
  const created = (k) => { const c = byKey.get(k)?.created; return c ? new Date(c).getTime() : 0; };
  return {
    tensions: pick(s => (s.contradicts + s.limits + s.tradeoff) >= 1 && (s.supports + s.extends) >= 1,
      (a, b) => (b.contradicts + b.limits + b.tradeoff + b.supports + b.extends) - (a.contradicts + a.limits + a.tradeoff + a.supports + a.extends)),
    disagreements: d.links.filter(l => l.type === 'contradicts' && l.from.startsWith('note:') && l.to.startsWith('note:'))
      .slice(-top).reverse().map(l => ({ id: l.id, a: byKey.get(l.from)?.title, a_slug: l.from.slice(5), b: byKey.get(l.to)?.title, b_slug: l.to.slice(5), insight: l.insight }))
      .filter(x => x.a && x.b),
    evidence_building: pick(s => s.evidence.size >= 3, (a, b) => b.evidence.size - a.evidence.size),
    growing: pick(s => s.recent >= 2, (a, b) => b.recent - a.recent),
    lonely: pick(s => s.total === 0 && processed(s.key) && created(s.key) > Date.now() - 30 * DAY, (a, b) => created(b.key) - created(a.key)),
    totals: { links: d.links.length, notes: notes.length, linked_notes: all.filter(s => s.total > 0).length, by_type: Object.fromEntries(RELATION_TYPES.map(t => [t, d.links.filter(l => l.type === t).length])) },
  };
}

// the user (or an agent) says a link is wrong: remove it and never propose that pair again.
export async function dismissLink(id) {
  const d = await loadLinks();
  const l = d.links.find(x => x.id === id);
  if (!l) return { error: `link not found: ${id}` };
  const canSee = makeCanSee(await loadNotes(), await postOwners());
  if (!canSee(l.from) || !canSee(l.to)) return { error: `link not found: ${id}` };
  d.links = d.links.filter(x => x.id !== id);
  d.rejected = [...new Set([...d.rejected, pairKey(l.from, l.to)])];
  await saveLinks(d);
  return { ok: true, id };
}
