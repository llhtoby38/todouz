// feed-refill.mjs — keeps the spark feed from running dry. When the user scrolls to
// the end, the dashboard asks for more and gets it two ways:
//
//  1. Straight away, posts built from their own data with no model call:
//     a Brain note worth seeing again (oldest-unseen first, Readwise style), and
//     a "still on your list?" card of undated or long-overdue items to keep,
//     date or drop. Nothing is shown again within REPEAT_DAYS.
//  2. In the background, a spark-feed routine run for fresh posts, throttled so
//     an endless scroll cannot burn through the Claude subscription.
//
// Refill state lives in state/feed-refill.json.

import { readJSON, writeJSON } from './store.mjs';
import { handleBrainCall } from './brain.mjs';
import { handleFeedCall, dueReviews } from './feed.mjs';
import { handleCall } from './tools.mjs';
import { listRoutines, enqueueRoutine } from './routines.mjs';
import { loadLinks } from './brain-links.mjs';

const STATE = 'state/feed-refill.json';
const REPEAT_DAYS = 10;                 // never resurface the same note/item sooner
const AI_GAP_MIN = 45;                  // at least this long between scroll-triggered runs
const AI_PER_DAY = 6;                   // and at most this many a day
const AI_ERROR_BACKOFF_MIN = 120;       // a run that just failed (e.g. expired login) is not retried sooner
const DAY = 86400000;

const localDay = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const ago = (iso) => {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / DAY);
  if (!Number.isFinite(days) || days < 1) return 'today';
  if (days < 14) return `${days} day${days === 1 ? '' : 's'} ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
};
const shortDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });

// The opening of a note, cut at a paragraph or sentence so the card reads cleanly.
function excerpt(md, n = 650) {
  const s = String(md || '').replace(/^#\s+.*\n+/, '').trim();
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const at = Math.max(cut.lastIndexOf('\n\n'), cut.lastIndexOf('. '));
  return (at > n * 0.5 ? cut.slice(0, at + 1) : cut).trim() + ' …';
}

async function loadState() {
  const st = (await readJSON(STATE, {})) || {};
  const cutoff = Date.now() - 60 * DAY;
  const prune = (m) => Object.fromEntries(Object.entries(m || {}).filter(([, t]) => new Date(t).getTime() > cutoff));
  return { notes: prune(st.notes), items: prune(st.items), links: prune(st.links), ai_runs: (st.ai_runs || []).filter(t => new Date(t).getTime() > Date.now() - 2 * DAY) };
}
const recent = (iso) => iso && Date.now() - new Date(iso).getTime() < REPEAT_DAYS * DAY;

// One Brain note worth seeing again.
async function resurfaceNote(st, recentNotes) {
  const r = await handleBrainCall('brain_search', { query: '', limit: 1000 });
  const pool = (r?.notes || []).filter(n => !n.core && n.status !== 'archived' && !recent(st.notes[n.slug]) && !recentNotes.has(n.slug));
  if (!pool.length) return null;
  // Never-resurfaced first, then the longest since it was last shown; least recently edited breaks ties.
  pool.sort((a, b) => String(st.notes[a.slug] || '').localeCompare(String(st.notes[b.slug] || ''))
    || String(a.updated || a.created || '').localeCompare(String(b.updated || b.created || '')));
  const n = await handleBrainCall('brain_read', { slug: pool[0].slug });
  if (!n || n.error) return null;
  const age = ago(n.updated || n.created);
  const res = await handleFeedCall('feed_post', {
    kind: 'resurface', title: n.title,
    hook: `From your Brain${age ? ` · last touched ${age}` : ''}. Still true? Worth a next step?`,
    body: excerpt(n.body), notes: [n.slug], tags: (n.tags || []).slice(0, 6), source: 'feed-refill',
  });
  if (!res?.ok) return null;
  st.notes[n.slug] = new Date().toISOString();
  return res;
}

// "Still on your list?": three open items that have no date or went stale, to keep, date or drop.
async function staleItems(st) {
  const r = await handleCall('list_issues', { status: 'open' });
  const stale = localDay(Date.now() - 7 * DAY);
  const pool = (r?.issues || []).filter(i => !i.recurring && !i.template_id && !i.instance_date && !i.pinned
    && (!i.due || i.due < stale) && !recent(st.items[`${i.epic_slug}/${i.id}`]));
  if (!pool.length) return null;
  // Long-overdue first (oldest due date), then undated ones.
  pool.sort((a, b) => (!a.due - !b.due) || String(a.due || '').localeCompare(String(b.due || '')) || String(a.created || '').localeCompare(String(b.created || '')));
  const pick = pool.slice(0, 3);
  const undated = pick.filter(i => !i.due).length;
  const res = await handleFeedCall('feed_post', {
    kind: 'triage',
    title: 'Still on your list?',
    hook: undated === pick.length ? `${pick.length} things with no date. Give each one a day, finish it, or let it go.`
      : `${pick.length} things that went quiet. Give each one a day, finish it, or let it go.`,
    body: '',
    items: pick.map(i => ({
      epic_slug: i.epic_slug, id: i.id, title: i.title, action: 'date',
      why: i.due ? `Overdue since ${shortDate(i.due)}` : 'No due date yet',
    })),
    visual: { type: 'stat', value: String(pool.length), label: pool.length === 1 ? 'item without a plan' : 'items without a plan', sub: 'undated, or overdue for over a week' },
    tags: ['triage', 'backlog'], source: 'feed-refill',
  });
  if (!res?.ok) return null;
  for (const i of pick) st.items[`${i.epic_slug}/${i.id}`] = new Date().toISOString();
  return res;
}

// "Your notes pull against each other": two notes the linker found in tension
// (contradicts, limits or tradeoff), with each side's own words. The question
// is when each one holds, not which one wins.
async function tensionCard(st) {
  const d = await loadLinks();
  const pool = d.links.filter(l => ['contradicts', 'limits', 'tradeoff'].includes(l.type) && l.from.startsWith('note:') && l.to.startsWith('note:') && !recent(st.links[l.id]))
    .sort((a, b) => ['contradicts', 'tradeoff', 'limits'].indexOf(a.type) - ['contradicts', 'tradeoff', 'limits'].indexOf(b.type) || String(b.created).localeCompare(String(a.created)));
  for (const l of pool) {
    const [a, b] = await Promise.all([l.from.slice(5), l.to.slice(5)].map(slug => handleBrainCall('brain_read', { slug })));
    if (!a || a.error || !b || b.error) continue;
    const verb = { contradicts: 'contradicts', limits: 'puts a limit on', tradeoff: 'trades off against' }[l.type];
    const side = (n, q) => `**${n.title}**${q ? `\n> ${q}` : ''}`;
    const res = await handleFeedCall('feed_post', {
      kind: 'insight',
      title: l.type === 'contradicts' ? 'Two of your notes disagree' : l.type === 'tradeoff' ? 'Two of your notes pull against each other' : 'One of your notes limits another',
      hook: l.insight,
      body: `${side(a, l.from_quote)}\n\n*${verb}*\n\n${side(b, l.to_quote)}\n\nWhen does each one hold? A line in either note settling it is worth more than picking a winner.`,
      notes: [a.slug, b.slug], tags: ['tension', l.type], source: 'feed-refill',
    });
    if (!res?.ok) return null;
    st.links[l.id] = new Date().toISOString();
    return res;
  }
  return null;
}

// A kept book idea, hook, drill or quote whose spaced review is due, shown
// again with a nudge to use it. The original post is marked reviewed.
async function reviewCard() {
  const all = await handleFeedCall('feed_list', { since_days: 365, limit: 500, include_expired: true });
  const due = dueReviews(all?.posts || [])[0];
  if (!due) return null;
  const p = due.post;
  const nudge = p.kind === 'drill' ? 'Run it once more today, a little faster.' : p.kind === 'hook' ? 'Use it in a conversation this week.' : 'Say it in your own words before you scroll on.';
  const res = await handleFeedCall('feed_post', {
    kind: 'resurface', title: p.title,
    hook: `Review ${due.review} of ${due.of}. ${nudge}`,
    body: p.body, visual: p.visual || undefined, notes: p.notes || [], sources: p.sources || [],
    tags: [...new Set([...(p.tags || []).slice(0, 6), 'review'])], source: 'feed-refill',
  });
  if (!res?.ok) return null;
  await handleFeedCall('feed_react', { id: p.id, reaction: 'reviewed', source: 'feed-refill' });
  return res;
}

// Start a spark-feed run for fresh posts, if the throttle allows one.
async function maybeGenerate(st) {
  if ((process.env.TODOUZ_REFILL_AI ?? 'off') === 'off') return { generating: false, why: 'off' };
  const sf = (await listRoutines()).find(r => r.name === 'spark-feed');
  if (!sf) return { generating: false, why: 'no spark-feed routine' };
  if (sf.running || sf.queued) return { generating: true, why: 'already running' };
  const last = sf.last_run ? new Date(sf.last_run).getTime() : 0;
  if (sf.last_status === 'error' && Date.now() - last < AI_ERROR_BACKOFF_MIN * 60000) return { generating: false, why: 'last run failed' };
  if (Date.now() - last < AI_GAP_MIN * 60000) return { generating: false, why: 'ran recently', next_at: new Date(last + AI_GAP_MIN * 60000).toISOString() };
  const today = localDay(Date.now());
  if (st.ai_runs.filter(t => localDay(new Date(t).getTime()) === today).length >= AI_PER_DAY) return { generating: false, why: 'daily limit' };
  const q = enqueueRoutine('spark-feed', { trigger: 'scroll' });
  if (!q?.ok) return { generating: false, why: q?.error || 'could not start' };
  if (q.queued) st.ai_runs.push(new Date().toISOString());
  return { generating: true, why: q.already ? `already ${q.already}` : 'started' };
}

// Called when the reader reaches the end of the feed. Two tabs hitting the end
// at once share one refill instead of making two sets of cards.
let inflight = null;
export function refillFeed(opts = {}) {
  if (!inflight) inflight = doRefill(opts).finally(() => { inflight = null; });
  return inflight;
}
async function doRefill({ generate = true } = {}) {
  const st = await loadState();
  // Notes an agent already resurfaced lately count too.
  const lately = await handleFeedCall('feed_list', { since_days: REPEAT_DAYS, limit: 300 });
  const recentNotes = new Set((lately?.posts || []).filter(p => p.kind === 'resurface').flatMap(p => p.notes || []));
  const made = [];
  for (const fn of [() => reviewCard(), () => resurfaceNote(st, recentNotes), () => tensionCard(st), () => staleItems(st), () => reviewCard(), () => resurfaceNote(st, recentNotes)]) {
    try { const r = await fn(); if (r) made.push({ id: r.id, kind: r.kind, title: r.title }); }
    catch (e) { console.error('[feed-refill]', e?.message || e); }
  }
  const ai = generate ? await maybeGenerate(st) : { generating: false, why: 'not asked' };
  await writeJSON(STATE, st);
  return { ok: true, made, ...ai };
}
