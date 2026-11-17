// feed.mjs — the spark feed: short, swipeable posts that AI sessions generate for
// the user to read (news in their fields, connections between their notes, resurfaced
// ideas, questions, and the daily focus brief), plus their reactions to them.
//
// The feed is meant to evolve: reactions (spark, useful, meh, replies, "dig
// deeper") are summarised by feed_taste, and every generator reads that first,
// so what they engages with shapes what gets made next. Any AI session connected
// to todouz can post (MCP or POST /api/feed_post), not just the scheduled routines.
//
// Storage: one JSON file per post in data/feed/<id>.json. Separate files mean the
// HTTP server and the agent's MCP process never overwrite each other's writes.

import { randomBytes } from 'node:crypto';
import { read, write, exists, listFiles, removeFile } from './store.mjs';
import { currentCtx, LEGACY_OWNER } from './access.mjs';
import { handleBrainCall } from './brain.mjs';
import { loadLinks, connectionsOf } from './brain-links.mjs';

const DIR = 'feed';
// Set by the routine runner on the todouz MCP process of a scheduled run.
const RUN_ROUTINE = process.env.TODOUZ_ROUTINE || null;
const RUN_ID = process.env.TODOUZ_RUN_ID || null;
export const FEED_KINDS = ['brief', 'news', 'insight', 'resurface', 'question', 'triage', 'deep', 'share', 'note', 'book', 'hook', 'drill', 'lesson'];
// Growth cards the user keeps (spark, save or practise) come back on a widening
// schedule, Readwise style, so the hooks and quotes actually stick.
export const REVIEW_KINDS = ['book', 'hook', 'drill', 'lesson', 'insight', 'quote'];
const REVIEW_GAPS_DAYS = [1, 3, 7, 21, 60];
const ITEM_ACTIONS = ['focus', 'done', 'drop', 'date'];
const nowISO = () => new Date().toISOString();
const arr = (v) => (Array.isArray(v) ? v : (v == null || v === '' ? [] : [v]));
const clip = (s, n) => { s = String(s || '').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };

function newId() {
  const d = new Date();
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  return `${ymd}-${randomBytes(4).toString('hex')}`;
}
const validId = (id) => /^\d{8}-[a-f0-9]{8}$/.test(String(id || ''));

function emptyReactions() {
  return { spark: false, useful: false, meh: false, saved_slug: null, replies: [], deeper: null, seen_at: null, item_actions: {}, practised: [], sessions: [], reviews: { count: 0, last: null } };
}

async function readPost(id) {
  if (!validId(id) || !await exists(`${DIR}/${id}.json`)) return null;
  try {
    const p = JSON.parse(await read(`${DIR}/${id}.json`));
    p.reactions = { ...emptyReactions(), ...(p.reactions || {}) };
    // Each user has their own feed; a post someone else owns doesn't exist for you.
    p.owner = p.owner || LEGACY_OWNER;
    const ctx = currentCtx();
    if (ctx && p.owner !== ctx.user) return null;
    return p;
  }
  catch { return null; }
}
async function writePost(p) { await write(`${DIR}/${p.id}.json`, JSON.stringify(p, null, 2) + '\n'); }

async function loadPosts({ sinceDays = 60 } = {}) {
  const cutoff = Date.now() - sinceDays * 86400000;
  const files = (await listFiles(DIR)).filter(f => f.endsWith('.json'));
  const out = [];
  for (const f of files) {
    const p = await readPost(f.slice(0, -5));
    if (p && new Date(p.created).getTime() >= cutoff) out.push(p);
  }
  return out.sort((a, b) => String(b.created).localeCompare(String(a.created)));
}

function normItems(items) {
  return arr(items).map(it => ({
    epic_slug: String(it?.epic_slug || it?.epic || '').trim(),
    id: String(it?.id || '').trim(),
    title: clip(it?.title, 160),
    action: ITEM_ACTIONS.includes(it?.action) ? it.action : 'focus',
    energy: ['high', 'medium', 'low'].includes(it?.energy) ? it.energy : null,
    why: clip(it?.why, 240) || null,
    next_step: clip(it?.next_step, 200) || null,
  })).filter(it => it.epic_slug && it.id).slice(0, 20);
}

// A post's optional infographic. The feed renders it as a graphic instead of
// prose, so a number, comparison or sequence that carries the point is seen,
// not read. Anything malformed is dropped rather than rendered half-broken.
export const VISUAL_TYPES = ['stat', 'compare', 'bars', 'quote', 'steps', 'image'];
const httpsUrl = (u) => { try { const x = new URL(String(u)); return x.protocol === 'https:' ? x.toString() : null; } catch { return null; } };
function normVisual(v) {
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return null; } }
  if (!v || typeof v !== 'object' || !VISUAL_TYPES.includes(v.type)) return null;
  const s = (x, n) => clip(x, n) || null;
  switch (v.type) {
    case 'stat': return s(v.value, 24) ? { type: 'stat', value: s(v.value, 24), label: s(v.label, 120), sub: s(v.sub, 160) } : null;
    case 'compare': {
      const side = (x) => (x && s(x.value, 24) ? { value: s(x.value, 24), label: s(x.label, 80) } : null);
      const left = side(v.left), right = side(v.right);
      return left && right ? { type: 'compare', left, right, caption: s(v.caption, 160) } : null;
    }
    case 'bars': {
      const data = arr(v.data).map(d => ({ label: s(d?.label, 60), value: Number(d?.value) }))
        .filter(d => d.label && Number.isFinite(d.value)).slice(0, 8);
      return data.length >= 2 ? { type: 'bars', title: s(v.title, 100), unit: s(v.unit, 12), data } : null;
    }
    case 'quote': return s(v.text, 280) ? { type: 'quote', text: s(v.text, 280), by: s(v.by, 80) } : null;
    case 'steps': {
      const items = arr(v.items).map(x => clip(x, 120)).filter(Boolean).slice(0, 6);
      return items.length >= 2 ? { type: 'steps', title: s(v.title, 100), items } : null;
    }
    case 'image': { const url = httpsUrl(v.url); return url ? { type: 'image', url, alt: s(v.alt, 160) } : null; }
    default: return null;
  }
}

function normLesson(l) {
  if (!l || typeof l !== 'object') return null;
  const src = l.source && typeof l.source === 'object' ? { title: clip(l.source.title, 160), author: clip(l.source.author, 120), url: httpsUrl(l.source.url) } : null;
  return {
    journey: clip(l.journey, 40) || 'speaking', id: clip(l.id, 80), day: Number(l.day) || null, of: Number(l.of) || null,
    cheat: arr(l.cheat).map(x => clip(x, 160)).filter(Boolean).slice(0, 8),
    exercise: clip(l.exercise, 400) || null, question: clip(l.question, 200) || null, answer: clip(l.answer, 400) || null, source: src,
  };
}

export function youtubeThumb(url) {
  try {
    const u = new URL(url);
    const id = /(^|\.)youtu\.be$/.test(u.hostname) ? u.pathname.slice(1) : /(^|\.)youtube\.com$/.test(u.hostname) ? (u.searchParams.get('v') || (u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{6,})/) || [])[1]) : null;
    return id && /^[\w-]{6,20}$/.test(id) ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
  } catch { return null; }
}

// A book's cover from Open Library (search by title and author, then the
// cover id). Best effort with a short timeout; no cover just means no image.
export async function bookCover(title, author) {
  if (!title) return null;
  try {
    const q = new URLSearchParams({ title, limit: '3', fields: 'cover_i,title,author_name' });
    if (author) q.set('author', String(author).split(/,| and | with /)[0]);
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(`https://openlibrary.org/search.json?${q}`, { signal: ctrl.signal, headers: { 'User-Agent': 'todouz-feed/1.0' } });
    clearTimeout(timer);
    if (!r.ok) return null;
    const d = await r.json();
    const hit = (d.docs || []).find(x => x.cover_i);
    return hit ? `https://covers.openlibrary.org/b/id/${hit.cover_i}-L.jpg` : null;
  } catch { return null; }
}

// The article's own preview image (og:image / twitter:image), so a news card
// looks like the story it points at. Best effort: a short timeout, only the
// <head> is read, https only, and any failure just means the generated cover.
export async function fetchPreviewImage(url) {
  if (!httpsUrl(url)) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; todouz-feed/1.0)', Accept: 'text/html' } });
    if (!r.ok || !/html/i.test(r.headers.get('content-type') || '')) { clearTimeout(timer); return null; }
    const reader = r.body.getReader(); const dec = new TextDecoder(); let html = '';
    while (html.length < 400000) {
      const { done, value } = await reader.read();
      if (done) break;
      html += dec.decode(value, { stream: true });
      if (/<\/head>/i.test(html)) break;
    }
    clearTimeout(timer);
    try { await reader.cancel(); } catch {}
    const tag = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["'][^>]*>/i);
    const content = tag && tag[0].match(/content=["']([^"']+)["']/i);
    if (!content) return null;
    return httpsUrl(new URL(content[1].replace(/&amp;/g, '&'), r.url || url).toString());
  } catch { return null; }
}

// ─── tools ───────────────────────────────────────────────────────────
async function feedPost(args = {}) {
  const kind = FEED_KINDS.includes(args.kind) ? args.kind : 'note';
  const title = clip(args.title, 160);
  if (!title) return { error: 'title is required' };
  const post = {
    id: newId(),
    kind,
    title,
    hook: clip(args.hook, 200) || null,
    body: String(args.body || '').slice(0, 8000),
    sources: arr(args.sources).map(s => (typeof s === 'string' ? { title: s, url: s } : { title: clip(s?.title || s?.url, 160), url: String(s?.url || '').slice(0, 600) }))
      .filter(s => /^https?:\/\//.test(s.url)).slice(0, 8),
    notes: arr(args.notes).map(String).filter(Boolean).slice(0, 12),
    items: normItems(args.items),
    visual: normVisual(args.visual),
    image: httpsUrl(args.image) || null,
    tags: [...new Set(arr(args.tags).map(t => String(t).toLowerCase().trim().replace(/\s+/g, '-')).filter(Boolean))].slice(0, 8),
    reply_to: validId(args.reply_to) ? args.reply_to : null,
    lesson: normLesson(args.lesson),
    book: args.book && clip(args.book.title, 160) ? { title: clip(args.book.title, 160), author: clip(args.book.author, 120) || null } : null,
    created: nowISO(),
    // Inside a scheduled routine the run's identity comes from the environment and
    // wins over whatever the model passed, so provenance is always true.
    source: String(RUN_ROUTINE || args.source || 'mcp').slice(0, 80),
    routine: RUN_ROUTINE || (args.routine ? String(args.routine).slice(0, 60) : null),
    run_id: RUN_ID || (args.run_id ? String(args.run_id).slice(0, 60) : null),
    reactions: emptyReactions(),
    owner: currentCtx()?.user || LEGACY_OWNER,
  };
  // A book gets its real cover from Open Library.
  if (!post.image && post.book) post.image = await bookCover(post.book.title, post.book.author);
  // A YouTube source gives its thumbnail directly, without fetching the page.
  if (!post.image) for (const src of post.sources) { const yt = youtubeThumb(src.url); if (yt) { post.image = yt; break; } }
  // Other cards get the cover image of the page they cite (a talk's thumbnail, an article's photo).
  if (!post.image && ['news', 'deep', 'share', 'book', 'hook', 'drill', 'lesson', 'insight'].includes(kind) && post.sources.length) {
    for (const s of post.sources.slice(0, 2)) { post.image = await fetchPreviewImage(s.url); if (post.image) break; }
  }
  await writePost(post);
  // A deep-dive answers an earlier post's "dig deeper" request: link them.
  if (post.reply_to) {
    const parent = await readPost(post.reply_to);
    if (parent) {
      parent.reactions.deeper = { ...(parent.reactions.deeper || { requested_at: post.created }), done_at: post.created, post_id: post.id };
      await writePost(parent);
    }
  }
  return { ok: true, id: post.id, kind, title };
}

// The order the feed is read in: today's newest brief first, then unseen posts,
// then the rest; newest first within each. Done here, not in the browser, so
// paging through it page by page never skips or repeats a post.
const localDay = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function feedOrder(posts) {
  const today = localDay(Date.now());
  const list = [...posts];
  const bi = list.findIndex(p => p.kind === 'brief' && p.created && localDay(p.created) === today);
  const brief = bi >= 0 ? list.splice(bi, 1) : [];
  list.sort((a, b) => (!!a.reactions.seen_at - !!b.reactions.seen_at) || String(b.created).localeCompare(String(a.created)));
  return [...brief, ...list];
}

// Task posts are about one day: a daily brief, a weekly review, a "still on your
// list?" card. Once their day is over they drop out of the feed (All and Unseen),
// so on Monday you see Monday's overview, not Saturday's and Sunday's. They are
// not deleted: Sparked, Saved and Waiting still show them, and the reactions on
// them still teach the feed.
const DAY_BOUND_KINDS = ['brief', 'triage'];
export const isExpired = (p, today = localDay(Date.now())) =>
  DAY_BOUND_KINDS.includes(p.kind) && !!p.created && localDay(p.created) < today;

// order "feed" + exclude (the ids already on screen) pages through the feed:
// each call returns the next `limit` posts the reader has not got yet, and
// has_more says whether any are left. first puts one post at the top (a deep link).
async function feedList({ kind, filter = 'all', since_days = 30, limit = 60, order, exclude, first, include_expired = false } = {}) {
  let posts = await loadPosts({ sinceDays: Math.min(365, Number(since_days) || 30) });
  if (kind) posts = posts.filter(p => p.kind === kind);
  if ((filter === 'all' || filter === 'unseen') && !include_expired) { const today = localDay(Date.now()); posts = posts.filter(p => !isExpired(p, today)); }
  if (filter === 'unseen') posts = posts.filter(p => !p.reactions.seen_at);
  const muted = new Set((await readFeedPrefs()).mute_tags.map(x => x.text));
  if (muted.size) posts = posts.filter(p => p.reactions.spark || p.reactions.saved_slug || !(p.tags || []).some(t => muted.has(String(t).toLowerCase())));
  if (filter === 'sparked') posts = posts.filter(p => p.reactions.spark);
  if (filter === 'saved') posts = posts.filter(p => p.reactions.saved_slug);
  if (filter === 'deeper') posts = posts.filter(p => p.reactions.deeper && !p.reactions.deeper.done_at);
  if (filter === 'growth') posts = posts.filter(p => ['book', 'hook', 'drill', 'lesson'].includes(p.kind) || (p.tags || []).includes('review'));
  const counts = { total: posts.length, unseen: posts.filter(p => !p.reactions.seen_at).length };
  const newest_id = posts[0]?.id || null;   // loadPosts is newest first
  if (order === 'feed') posts = feedOrder(posts);
  const skip = new Set(arr(exclude).map(String));
  let rest = skip.size ? posts.filter(p => !skip.has(p.id)) : posts;
  if (first && !skip.has(String(first))) {
    const i = rest.findIndex(p => p.id === first);
    const hit = i >= 0 ? rest.splice(i, 1)[0] : await readPost(first);
    if (hit) rest = [hit, ...rest];
  }
  const n = Math.max(1, Math.min(300, Number(limit) || 60));
  const page = rest.slice(0, n);
  // What each post does to the Brain: "supports your note X", "contradicts Y".
  try {
    const d = await loadLinks();
    if (d.links.length) for (const p of page) p.brain_links = (await connectionsOf(`post:${p.id}`, d)).filter(c => c.direction === 'out').slice(0, 3);
  } catch {}
  return { count: posts.length, counts, newest_id, has_more: rest.length > n, posts: page };
}

async function feedReact(args = {}) {
  const p = await readPost(args.id);
  if (!p) return { error: `post not found: ${args.id}` };
  const r = p.reactions;
  const on = args.value === undefined ? undefined : !!args.value && args.value !== 'false';
  switch (args.reaction) {
    case 'spark': r.spark = on ?? !r.spark; if (r.spark) r.meh = false; break;
    case 'useful': r.useful = on ?? !r.useful; if (r.useful) r.meh = false; break;
    case 'meh': r.meh = on ?? !r.meh; if (r.meh) { r.spark = false; r.useful = false; } break;
    case 'seen': if (!r.seen_at) r.seen_at = nowISO(); break;
    case 'reply': {
      const text = clip(args.text, 2000);
      if (!text) return { error: 'text is required for a reply' };
      r.replies = [...(r.replies || []), { at: nowISO(), text, from: 'user' }].slice(-20);
      break;
    }
    // Claude answering the user's reply (the feed-reply routine), shown as a thread.
    case 'answer': {
      const text = clip(args.text, 2000);
      if (!text) return { error: 'text is required for an answer' };
      r.replies = [...(r.replies || []), { at: nowISO(), text, from: 'claude' }].slice(-20);
      break;
    }
    case 'deeper':
      if (!r.deeper || r.deeper.done_at) r.deeper = { requested_at: nowISO(), done_at: null, post_id: null };
      break;
    case 'save': {
      if (r.saved_slug) break;
      const src = p.sources.length ? '\n\nSources:\n' + p.sources.map(s => `- [${s.title}](${s.url})`).join('\n') : '';
      const links = p.notes.length ? '\n\nRelated: ' + p.notes.map(n => `[[${n}]]`).join(', ') : '';
      const res = await handleBrainCall('brain_capture', {
        title: p.title,
        text: `${p.hook ? p.hook + '\n\n' : ''}${p.body}${src}${links}\n\n_Saved from the feed (${p.kind}, ${p.created.slice(0, 10)})._`,
        tags: p.tags, source: String(args.source || 'feed'),
      });
      if (res?.error) return res;
      r.saved_slug = res.slug;
      break;
    }
    case 'practised': {
      // "Did it" on a drill (or any card): log a practice; value false undoes today's.
      const today = nowISO().slice(0, 10);
      const list = [...(r.practised || [])];
      if (on === false) { const i = list.map(x => x.slice(0, 10)).lastIndexOf(today); if (i >= 0) list.splice(i, 1); }
      else list.push(nowISO());
      r.practised = list.slice(-50);
      break;
    }
    case 'session': {
      // A recorded practice take from the dashboard's recorder: its measured
      // numbers and transcript. It also counts as practice.
      let m; try { m = typeof args.text === 'string' ? JSON.parse(args.text) : null; } catch { m = null; }
      if (!m || typeof m !== 'object') return { error: 'session needs text: a JSON object of the take' };
      const num = (x, lo, hi) => { const n = Number(x); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n * 10) / 10)) : null; };
      const take = {
        at: nowISO(), seconds: num(m.seconds, 0, 600), words: num(m.words, 0, 5000), wpm: num(m.wpm, 0, 400),
        fillers: num(m.fillers, 0, 500), filler_words: arr(m.filler_words).map(x => clip(x, 20)).slice(0, 20),
        pauses: num(m.pauses, 0, 500), long_pauses: num(m.long_pauses, 0, 500), volume_variety: num(m.volume_variety, 0, 100),
        score: num(m.score, 0, 100), transcript: clip(m.transcript, 4000),
      };
      r.sessions = [...(r.sessions || []), take].slice(-12);
      r.practised = [...(r.practised || []), take.at].slice(-50);
      break;
    }
    case 'reviewed': {
      const rv = r.reviews || { count: 0, last: null };
      r.reviews = { count: (rv.count || 0) + 1, last: nowISO() };
      break;
    }
    case 'item_action': {
      const key = String(args.item || '');
      if (!key.includes('/')) return { error: 'item must be "<epic_slug>/<ISS-id>"' };
      const next = { ...(r.item_actions || {}) };
      if (args.text === 'clear') delete next[key];   // undo
      else next[key] = String(args.text || args.action || 'done').slice(0, 40);
      r.item_actions = next;
      break;
    }
    default: return { error: 'reaction must be one of spark, useful, meh, seen, reply, deeper, save, item_action, practised, session, reviewed' };
  }
  await writePost(p);
  return { ok: true, id: p.id, reactions: r };
}

// Kept growth cards whose next review is due: gaps of 1, 3, 7, 21 and 60 days
// after the card (or its last review). Most overdue first.
export function dueReviews(posts, now = Date.now()) {
  const out = [];
  for (const p of posts) {
    const r = p.reactions || {};
    const kept = r.spark || r.useful || r.saved_slug || (r.practised || []).length;
    const isGrowth = REVIEW_KINDS.includes(p.kind) || p.visual?.type === 'quote';
    if (!kept || r.meh || !isGrowth || (p.tags || []).includes('review')) continue;
    const n = r.reviews?.count || 0;
    if (n >= REVIEW_GAPS_DAYS.length) continue;
    const from = new Date(r.reviews?.last || p.created).getTime();
    const due = from + REVIEW_GAPS_DAYS[n] * 86400000;
    if (due <= now) out.push({ post: p, review: n + 1, of: REVIEW_GAPS_DAYS.length, overdue_days: Math.floor((now - due) / 86400000) });
  }
  return out.sort((a, b) => b.overdue_days - a.overdue_days);
}

// ─── explicit preferences ────────────────────────────────────────────
// What the user has told the feed directly (usually through a reply): more of,
// less of, standing rules, and muted tags. Every generator follows these, and
// posts with a muted tag are hidden from the feed.
const PREFS = 'state/feed-prefs.json';
const PREF_LISTS = ['more', 'less', 'rules', 'mute_tags'];
export async function readFeedPrefs() {
  let raw = {};
  try { raw = JSON.parse(await read(PREFS)) || {}; } catch {}
  const out = {};
  for (const k of PREF_LISTS) out[k] = Array.isArray(raw[k]) ? raw[k] : [];
  return out;
}
async function feedPrefs({ action = 'list', list, text, post_id } = {}) {
  const prefs = await readFeedPrefs();
  if (action === 'list') return { ok: true, prefs };
  if (!PREF_LISTS.includes(list)) return { error: `list must be one of ${PREF_LISTS.join(', ')}` };
  let t = clip(text, 300);
  if (list === 'mute_tags') t = t.toLowerCase().replace(/^#/, '').replace(/\s+/g, '-');
  if (!t) return { error: 'text is required' };
  const key = (x) => String(x.text).toLowerCase();
  if (action === 'remove') prefs[list] = prefs[list].filter(x => key(x) !== t.toLowerCase());
  else if (action === 'add') {
    if (!prefs[list].some(x => key(x) === t.toLowerCase())) prefs[list] = [...prefs[list], { text: t, at: nowISO(), ...(validId(post_id) ? { post_id } : {}) }].slice(-40);
  } else return { error: 'action must be list, add or remove' };
  await write(PREFS, JSON.stringify(prefs, null, 2) + '\n');
  return { ok: true, prefs };
}

// What the feed has learned about the user's taste. Generators call this FIRST.
async function feedTaste({ since_days = 60 } = {}) {
  const posts = await loadPosts({ sinceDays: Math.min(365, Number(since_days) || 60) });
  const kinds = {}, tags = {};
  for (const p of posts) {
    const k = kinds[p.kind] = kinds[p.kind] || { shown: 0, seen: 0, spark: 0, useful: 0, meh: 0 };
    k.shown++; if (p.reactions.seen_at) k.seen++; if (p.reactions.spark) k.spark++; if (p.reactions.useful) k.useful++; if (p.reactions.meh) k.meh++;
    const score = (p.reactions.spark ? 2 : 0) + (p.reactions.useful ? 1 : 0) + (p.reactions.saved_slug ? 1 : 0) - (p.reactions.meh ? 2 : 0);
    for (const t of p.tags) tags[t] = (tags[t] || 0) + score;
  }
  const ranked = Object.entries(tags).sort((a, b) => b[1] - a[1]);
  const brief = (p) => ({ id: p.id, kind: p.kind, title: p.title, tags: p.tags });
  // Goals and the reading list steer every generator, not only past likes.
  const notesOf = async (q) => ((await handleBrainCall('brain_search', { query: '', limit: 60, ...q }))?.notes || []).filter(n => n.status !== 'archived');
  const goals = (await notesOf({ type: 'goal' }).catch(() => [])).map(n => ({ slug: n.slug, title: n.title, summary: clip(n.summary || n.snippet, 300) }));
  const books = (await notesOf({ tag: 'book' }).catch(() => [])).map(n => ({ slug: n.slug, title: n.title, status: n.status }));
  const since14 = Date.now() - 14 * 86400000;
  const practice = posts.flatMap(p => (p.reactions.practised || []).map(at => ({ at, id: p.id, title: p.title, kind: p.kind })))
    .filter(x => new Date(x.at).getTime() >= since14).sort((a, b) => b.at.localeCompare(a.at));
  return {
    window_days: Number(since_days) || 60,
    posts_considered: posts.length,
    by_kind: kinds,
    liked_tags: ranked.filter(([, s]) => s > 0).slice(0, 12).map(([t, s]) => ({ tag: t, score: s })),
    disliked_tags: ranked.filter(([, s]) => s < 0).slice(-10).reverse().map(([t, s]) => ({ tag: t, score: s })),
    sparked: posts.filter(p => p.reactions.spark).slice(0, 12).map(brief),
    meh: posts.filter(p => p.reactions.meh).slice(0, 12).map(brief),
    replies: posts.filter(p => (p.reactions.replies || []).length).slice(0, 10)
      .map(p => ({ id: p.id, title: p.title, replies: p.reactions.replies.slice(-3).map(x => x.text) })),
    deeper_requests: posts.filter(p => p.reactions.deeper && !p.reactions.deeper.done_at)
      .map(p => ({ id: p.id, kind: p.kind, title: p.title, hook: p.hook, body: clip(p.body, 600), sources: p.sources, notes: p.notes, tags: p.tags })),
    preferences: await readFeedPrefs(),
    goals,
    reading_list: books,
    practice_14d: { count: practice.length, recent: practice.slice(0, 8) },
    due_reviews: dueReviews(posts).slice(0, 5).map(d => ({ id: d.post.id, kind: d.post.kind, title: d.post.title, review: d.review, of: d.of })),
    recent_titles: posts.filter(p => Date.now() - new Date(p.created).getTime() < 14 * 86400000).map(p => p.title).slice(0, 80),
    guidance: [
      'Fulfil deeper_requests first: research each one properly and post a kind "deep" post with reply_to set to its id.',
      'Lean into liked_tags and the kinds with the best spark/useful rate; make fewer posts like the ones marked meh.',
      'preferences are the user\'s own explicit instructions to the feed: follow every rule, make more of "more", avoid "less", and never post on a muted tag. They outrank liked_tags.',
      'Read the replies: they are the user talking back to the feed.',
      'Do not repeat anything in recent_titles.',
      'Serve the goals: every post should move at least one goal forward or be clearly worth their time. Books on the reading list with status growing are being read now.',
    ],
  };
}

// Backfill cover images on news/deep posts made before images existed (or whose
// fetch failed at post time). Idempotent: posts that already have one are skipped.
async function feedEnrich({ id, since_days = 60 } = {}) {
  const posts = id ? [await readPost(id)].filter(Boolean) : await loadPosts({ sinceDays: Number(since_days) || 60 });
  let checked = 0, added = 0;
  for (const p of posts) {
    if (p.image || !['news', 'deep'].includes(p.kind) || !p.sources.length) continue;
    checked++;
    for (const s of p.sources.slice(0, 2)) { p.image = await fetchPreviewImage(s.url); if (p.image) break; }
    if (p.image) { added++; await writePost(p); }
  }
  return { ok: true, checked, images_added: added };
}

async function feedDelete({ id } = {}) {
  if (!await readPost(id)) return { error: `post not found: ${id}` };
  await removeFile(`${DIR}/${id}.json`);
  return { ok: true, id };
}

// ─── tool catalogue + dispatcher ─────────────────────────────────────
const SOURCE = { type: 'string', description: 'A short name for the session YOU are running in (the app or machine you are in). Recorded as provenance. Scheduled routines are stamped automatically.' };
export const FEED_TOOLS = [
  {
    name: 'feed_taste',
    description: 'Spark feed: call FIRST before generating posts. Summarises how the user reacted to recent posts (liked/disliked tags, sparked and meh posts, their replies), the "dig deeper" requests still waiting, and recent titles to avoid repeating.',
    inputSchema: { type: 'object', properties: { since_days: { type: 'number' } }, additionalProperties: false },
  },
  {
    name: 'feed_post',
    description: 'Publish a short post to the user\'s spark feed (read like a shorts feed). kind: brief (daily focus), news (something new in their fields, ALWAYS with sources), insight (a connection between their notes/items), resurface (an older Brain note worth seeing again), question (a prompt to think about), triage (items to decide on), deep (a deeper follow-up; set reply_to), share (what came of a post the user shared in), note, book (one idea from a book: hook = a line they could say in a conversation, body = three takeaways, visual quote = the best line from the book with by = author), hook (a conversation opener, story or question for a real situation coming up, said in their own voice), drill (a 2-minute speaking exercise with a clear prompt, a structure and a timer; they taps Did it). Keep body under ~150 words of markdown; title is the hook. Link Brain notes by slug in notes, todouz items in items [{epic_slug, id, title, action: focus|done|drop|date, energy: high|medium|low, why, next_step}]. Make it visual: when a number, comparison, ranking, quote or short sequence carries the point, add visual, one of {type:"stat", value:"48%", label, sub} · {type:"compare", left:{value, label}, right:{value, label}, caption} · {type:"bars", title, unit, data:[{label, value}]} · {type:"quote", text, by} · {type:"steps", title, items:[…]} · {type:"image", url (https), alt}. News and deep posts get the cited article\'s preview image automatically; pass image (https) to set one yourself.',
    inputSchema: {
      type: 'object',
      properties: { book: { type: 'object', description: 'For a book card: {title, author}. The real cover is fetched from Open Library.', properties: { title: { type: 'string' }, author: { type: 'string' } } }, lesson: { type: 'object', description: 'Journey lessons only (set by the server).' },
        kind: { type: 'string', enum: FEED_KINDS }, title: { type: 'string' }, hook: { type: 'string' }, body: { type: 'string' },
        sources: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, url: { type: 'string' } } } },
        notes: { type: 'array', items: { type: 'string' } },
        items: { type: 'array', items: { type: 'object' } },
        tags: { type: 'array', items: { type: 'string' } },
        visual: { type: 'object', description: 'Optional infographic; see the tool description for the shapes.' },
        image: { type: 'string', description: 'Optional https cover image URL.' },
        reply_to: { type: 'string' }, routine: { type: 'string' }, run_id: { type: 'string' }, source: SOURCE,
      },
      required: ['kind', 'title'], additionalProperties: false,
    },
  },
  {
    name: 'feed_list',
    description: 'List recent spark-feed posts with their reactions. filter: all | unseen | sparked | saved | deeper (waiting dig-deeper requests) | growth (book, hook and drill cards and their reviews). To page through the feed as the user reads it, pass order "feed" and exclude (the ids you already have); has_more says whether more are left. Briefs and triage posts from earlier days are left out of all/unseen unless include_expired is true.',
    inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: FEED_KINDS }, filter: { type: 'string', enum: ['all', 'unseen', 'sparked', 'saved', 'deeper', 'growth'] }, since_days: { type: 'number' }, limit: { type: 'number' }, order: { type: 'string', enum: ['newest', 'feed'] }, exclude: { type: 'array', items: { type: 'string' } }, first: { type: 'string' }, include_expired: { type: 'boolean' } }, additionalProperties: false },
  },
  {
    name: 'feed_react',
    description: 'Record a reaction on a feed post: spark (this sparks something), useful, meh (less like this), seen, reply (text, from the user), answer (text: Claude\'s answer to their latest reply, shown in the post thread), deeper (ask for a deeper follow-up), save (copy into the Brain Inbox), item_action (item "<epic>/<ISS-id>", text = what was done), practised (the user did a drill; value false undoes today\'s), session (text = JSON of a recorded practice take: seconds, words, wpm, fillers, filler_words, pauses, long_pauses, volume_variety, score, transcript), reviewed (a spaced review of this post was just shown).',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, reaction: { type: 'string' }, value: { type: 'boolean' }, text: { type: 'string' }, item: { type: 'string' }, source: SOURCE }, required: ['id', 'reaction'], additionalProperties: false },
  },
  {
    name: 'feed_prefs',
    description: 'the user\'s explicit feed preferences, which steer every generator. action "list" returns them; "add" or "remove" changes one entry in a list: "more" (things they want more of), "less" (things they want less of), "rules" (standing instructions about style or content, e.g. "no generic openers; open with the source"), "mute_tags" (a tag whose posts are hidden). Keep each entry one short, specific sentence. Pass post_id when a reply prompted it.',
    inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['list', 'add', 'remove'] }, list: { type: 'string', enum: PREF_LISTS }, text: { type: 'string' }, post_id: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'feed_enrich',
    description: 'Backfill cover images (the cited article\'s preview image) onto news and deep posts that do not have one. Pass id for one post, or nothing for all recent ones.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, since_days: { type: 'number' } }, additionalProperties: false },
  },
  {
    name: 'feed_delete',
    description: 'Delete a spark-feed post.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
  },
];

export async function handleFeedCall(name, args = {}) {
  switch (name) {
    case 'feed_taste':  return await feedTaste(args);
    case 'feed_post':   return await feedPost(args);
    case 'feed_list':   return await feedList(args);
    case 'feed_react':  return await feedReact(args);
    case 'feed_enrich': return await feedEnrich(args);
    case 'feed_prefs':  return await feedPrefs(args);
    case 'feed_delete': return await feedDelete(args);
    default: return undefined;
  }
}
