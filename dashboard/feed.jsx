// feed.jsx — the Feed tab: a shorts-style spark feed.
//
// Posts are made by AI sessions connected to todouz: the scheduled routines on
// the server (daily focus brief, spark feed, weekly review, Brain gardening) and
// any other session through feed_post. The user reacts (spark, useful, meh, reply,
// save to Brain, dig deeper) and those reactions steer what gets generated next.
//
// Each card leads with a cover: the cited article's preview image for news, or
// generated art in the post kind's colours. A post can carry a `visual` (a big
// stat, a comparison, bars, a quote or steps) drawn as a graphic, and brief and
// review cards turn their items into tiles with one-tap Done / Drop / Date.
// The feed checks for new posts on its own and offers them without jumping.

const { useState: fUseState, useEffect: fUseEffect, useRef: fUseRef, useCallback: fUseCallback } = React;

const FEED_KIND_META = {
  brief:     { label: "Today's focus",   icon: '☀️', color: '#c2410c', grad: ['#f59e0b', '#c2410c'] },
  triage:    { label: 'Review',          icon: '🧹', color: '#b45309', grad: ['#d97706', '#78350f'] },
  news:      { label: 'News',            icon: '📰', color: '#2563eb', grad: ['#3b82f6', '#1e3a8a'] },
  insight:   { label: 'Insight',         icon: '💡', color: '#7c3aed', grad: ['#8b5cf6', '#4c1d95'] },
  resurface: { label: 'From your brain', icon: '🌳', color: '#15803d', grad: ['#22c55e', '#14532d'] },
  question:  { label: 'Question',        icon: '❓', color: '#db2777', grad: ['#ec4899', '#831843'] },
  deep:      { label: 'Deep dive',       icon: '🔎', color: '#0e7490', grad: ['#06b6d4', '#164e63'] },
  share:     { label: 'You shared',      icon: '📥', color: '#0f766e', grad: ['#14b8a6', '#134e4a'] },
  note:      { label: 'Note',            icon: '📝', color: '#6b7280', grad: ['#9ca3af', '#374151'] },
  book:      { label: 'Book insight',    icon: '📚', color: '#9a3412', grad: ['#f97316', '#7c2d12'] },
  hook:      { label: 'Say this',        icon: '🎤', color: '#be185d', grad: ['#f472b6', '#831843'] },
  drill:     { label: '60-second drill', icon: '🎙', color: '#047857', grad: ['#10b981', '#064e3b'] },
  lesson:    { label: 'Lesson',          icon: '🎓', color: '#4338ca', grad: ['#6366f1', '#312e81'] },
};

// A drill's practice bar: a 2-minute timer and "Did it", which logs practice
// for the growth routine to adapt to (easier when they skip, harder when they keep going).
function FeedDrillBar({ p, onDone, isMobile }) {
  const [left, setLeft] = fUseState(null);   // seconds left, null = not running
  fUseEffect(() => {
    if (left == null || left <= 0) return;
    const t = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  const today = new Date().toISOString().slice(0, 10);
  const done = (p.reactions.practised || []).filter(x => x.slice(0, 10) === today).length;
  const total = (p.reactions.practised || []).length;
  const mm = left == null ? '2:00' : `${Math.floor(Math.max(0, left) / 60)}:${String(Math.max(0, left) % 60).padStart(2, '0')}`;
  const green = '#047857';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '4px 0 14px', padding: '10px 12px', borderRadius: 14, background: withAlpha(green, 0.07), border: `1px solid ${withAlpha(green, 0.3)}` }}>
      <span style={{ fontFamily: T.fontDisplay, fontSize: 26, fontWeight: 700, color: left === 0 ? T.overdue : green, minWidth: 64, fontVariantNumeric: 'tabular-nums' }}>{left === 0 ? "Time" : mm}</span>
      <button onClick={() => setLeft(left == null || left === 0 ? 120 : null)} style={{ fontFamily: T.fontBody, fontSize: 13, fontWeight: 600, padding: '7px 12px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${withAlpha(green, 0.5)}`, background: T.surface, color: green }}>
        {left == null || left === 0 ? '▶ Start timer' : '■ Stop'}</button>
      <button onClick={() => { setLeft(null); onDone(); }} style={{ fontFamily: T.fontBody, fontSize: 13, fontWeight: 700, padding: '7px 14px', borderRadius: 999, cursor: 'pointer', border: 'none', background: green, color: '#fff' }}>
        ✓ Did it{done ? ` (${done} today)` : ''}</button>
      {total > 0 && <span style={{ fontSize: 12, color: T.textMuted }}>{total} time{total === 1 ? '' : 's'} so far</span>}
    </div>
  );
}
const ENERGY_META = { high: { label: 'High energy', color: '#dc2626', level: 3 }, medium: { label: 'Medium energy', color: '#d97706', level: 2 }, low: { label: 'Low energy', color: '#16a34a', level: 1 } };
const ACTION_META = { done: { label: 'Done', color: '#16a34a' }, drop: { label: 'Drop', color: '#dc2626' }, date: { label: 'Date', color: '#d97706' } };
const FEED_POLL_MS = 45000;
// Infinite scroll: posts load a page at a time, and the next page is fetched
// while a couple of cards are still ahead of you, so the feed never stops.
const FEED_PAGE = 12;
const FEED_WINDOW_DAYS = 365;

const isoDaysFromNow = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return fmtISO(d); };
const nextMonday = () => { const d = new Date(); const add = ((8 - d.getDay()) % 7) || 7; d.setDate(d.getDate() + add); return fmtISO(d); };
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
// [[slug]] in a post body → a #brain= link the app routes to the note.
const feedLinkify = (body) => String(body || '').replace(/\[\[([^\]|#\n]+)(?:\|([^\]\n]+))?\]\]/g, (m, t, label) => `[${(label || t).trim()}](#brain=${encodeURIComponent(t.trim())})`);
// A brief's "Today's three" is drawn as tiles, so drop that section from the prose.
const stripTodaysThree = (body) => String(body || '').replace(/\*\*Today'?s three\*\*[\s\S]*?(?=\n\*\*|$)/i, '').trim();

// ─── time ────────────────────────────────────────────────────────────
const FEED_WD = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const FEED_MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDaysISO = (base, n) => fmtISO(new Date(base.getFullYear(), base.getMonth(), base.getDate() + n));
const hmToMin = (hm) => { const m = /^(\d{1,2}):(\d{2})/.exec(hm || ''); return m ? (+m[1]) * 60 + (+m[2]) : null; };
const spanLabel = (mins) => { mins = Math.round(Math.abs(mins)); if (mins < 60) return `${mins}m`; const h = Math.floor(mins / 60), m = mins % 60; return m && h < 10 ? `${h}h ${m}m` : `${h}h`; };
const shortDate = (iso) => { const d = parseISODate(iso); return d ? d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) : iso; };

// When a post was written, said the way a person would: "12m ago", "Today 06:31",
// "Yesterday 07:00", "Mon 12 Oct".
function whenWritten(iso, now = new Date()) {
  if (!iso) return '';
  const t = new Date(iso), mins = (now - t) / 60000;
  if (mins < 60) return mins < 1 ? 'just now' : `${Math.floor(mins)}m ago`;
  const days = Math.round((dayStart(now) - dayStart(t)) / 86400000);
  const hm = t.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  if (days === 0) return `Today ${hm}`;
  if (days === 1) return `Yesterday ${hm}`;
  return t.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

// Live due status for an item, relative to right now.
function dueStatus(due, dueTime, now = new Date()) {
  if (!due) return { label: 'no date', tone: 'muted' };
  const todayISO = fmtISO(now);
  if (due < todayISO) {
    const days = Math.round((dayStart(now) - parseISODate(due)) / 86400000);
    return { label: `overdue ${days}d`, tone: 'overdue' };
  }
  if (due === todayISO) {
    const tm = hmToMin(dueTime);
    if (tm == null) return { label: 'due today', tone: 'today' };
    const diff = tm - (now.getHours() * 60 + now.getMinutes());
    return diff < 0 ? { label: `due ${dueTime}, ${spanLabel(diff)} ago`, tone: 'overdue' } : { label: `due ${dueTime} · in ${spanLabel(diff)}`, tone: 'today' };
  }
  if (due === addDaysISO(dayStart(now), 1)) return { label: `tomorrow${dueTime ? ' ' + dueTime : ''}`, tone: 'soon' };
  return { label: `${shortDate(due)}${dueTime ? ' ' + dueTime : ''}`, tone: 'later' };
}
const TONE_COLOR = { overdue: '#dc2626', today: '#d97706', soon: '#2563eb', later: '#6b7280', muted: '#9ca3af' };

// Plain-English plan entry: "rehearse pitch today 6pm !high", "call linkt tmr 11am",
// "thesis draft fri", "book dentist in 3 days", "submit form 20 oct". Returns the
// cleaned title plus whatever date, time and priority it found.
function parsePlan(raw, now = new Date()) {
  let s = ` ${raw} `;
  const take = (re) => { const m = s.match(re); if (m) s = s.replace(m[0], ' '); return m; };
  const base = dayStart(now);
  let priority = null, due = null, time = null, m;
  if ((m = take(/\s!(high|h|med|medium|m|low|l)\b/i))) { const c = m[1][0].toLowerCase(); priority = c === 'h' ? 'high' : c === 'l' ? 'low' : 'medium'; }
  // time first, so "6pm" is not mistaken for a date
  if ((m = take(/\s(?:at\s+|@)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i))) { let h = (+m[1]) % 12; if (/pm/i.test(m[3])) h += 12; time = `${String(h).padStart(2, '0')}:${m[2] || '00'}`; }
  else if ((m = take(/\s(?:at\s+|@)?([01]?\d|2[0-3]):([0-5]\d)\b/))) time = `${m[1].padStart(2, '0')}:${m[2]}`;
  else if ((m = take(/\s(?:at\s+)?noon\b/i))) time = '12:00';
  const monRe = FEED_MON.join('|');
  if ((m = take(/\s(\d{4}-\d{2}-\d{2})\b/))) due = m[1];
  else if ((m = take(/\s(today|this\s+(?:morning|afternoon|evening))\b/i))) due = addDaysISO(base, 0);
  else if ((m = take(/\stonight\b/i))) { due = addDaysISO(base, 0); if (!time) time = '19:00'; }
  else if ((m = take(/\s(tomorrow|tmrw?)\b/i))) due = addDaysISO(base, 1);
  else if ((m = take(/\sin\s+(\d{1,2})\s+(days?|weeks?)\b/i))) due = addDaysISO(base, (+m[1]) * (/week/i.test(m[2]) ? 7 : 1));
  else if ((m = take(/\snext\s+week\b/i))) due = addDaysISO(base, ((8 - base.getDay()) % 7) || 7);
  else if ((m = take(new RegExp(`\\s(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monRe})[a-z]*\\b`, 'i'))) || (m = take(new RegExp(`\\s(${monRe})[a-z]*\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i')))) {
    const dayN = /^\d/.test(m[1]) ? +m[1] : +m[2];
    const mon = FEED_MON.indexOf((/^\d/.test(m[1]) ? m[2] : m[1]).slice(0, 3).toLowerCase());
    let d = new Date(base.getFullYear(), mon, dayN);
    if (d < base) d = new Date(base.getFullYear() + 1, mon, dayN);
    due = fmtISO(d);
  } else if ((m = take(/\s(?:next\s+|on\s+|this\s+)?(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/i))) {
    let add = (FEED_WD.indexOf(m[1].slice(0, 3).toLowerCase()) - base.getDay() + 7) % 7;
    if (add === 0) add = 7;
    due = addDaysISO(base, add);
  }
  if (time && !due) due = addDaysISO(base, 0);
  const title = s.replace(/\s+/g, ' ').trim().replace(/\s+(at|on|by|due)$/i, '');
  return { title, due, due_time: time, priority };
}

// Deterministic generated cover: the kind's gradient, soft blobs and a set of
// concentric rings (a soft brand motif), seeded by the post id so each
// card has its own art and it never changes between renders.
function FeedCoverArt({ seed, grad }) {
  let h = 2166136261;
  for (const ch of String(seed)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  const rnd = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000; };
  const gid = `fg-${String(seed).replace(/[^a-z0-9]/gi, '')}`;
  const cx = 240 + rnd() * 140, cy = 30 + rnd() * 150;
  const blobs = Array.from({ length: 5 }, () => ({ x: rnd() * 400, y: rnd() * 240, r: 18 + rnd() * 70, o: 0.05 + rnd() * 0.09 }));
  const wave = (yy, amp) => `M0 ${yy} C 100 ${yy - amp}, 160 ${yy + amp}, 260 ${yy} S 380 ${yy - amp}, 400 ${yy} L400 240 L0 240 Z`;
  return (
    <svg viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={grad[0]} /><stop offset="1" stopColor={grad[1]} /></linearGradient>
      </defs>
      <rect width="400" height="240" fill={`url(#${gid})`} />
      {blobs.map((b, i) => <circle key={i} cx={b.x} cy={b.y} r={b.r} fill="#fff" fillOpacity={b.o} />)}
      {[0, 1, 2, 3, 4].map(i => <circle key={`r${i}`} cx={cx} cy={cy} r={26 + i * 24} fill="none" stroke="#fff" strokeOpacity={0.24 - i * 0.04} strokeWidth="1.5" />)}
      <path d={wave(185 + rnd() * 20, 18 + rnd() * 16)} fill="#000" fillOpacity="0.12" />
    </svg>
  );
}

// An energy meter: three bars, filled to the level.
function EnergyMeter({ energy }) {
  const m = ENERGY_META[energy]; if (!m) return null;
  return (
    <span title={m.label} style={{ display: 'inline-flex', alignItems: 'flex-end', gap: 2, height: 14 }}>
      {[1, 2, 3].map(i => <span key={i} style={{ width: 4, height: 4 + i * 3, borderRadius: 1, background: i <= m.level ? m.color : withAlpha(m.color, 0.18) }} />)}
    </span>
  );
}

function ProgressRing({ done, total, color = '#16a34a', size = 44 }) {
  const r = (size - 6) / 2, c = 2 * Math.PI * r, frac = total ? done / total : 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label={`${done} of ${total} handled`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={withAlpha(color, 0.15)} strokeWidth="5" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round"
        strokeDasharray={`${c * frac} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dasharray 0.4s ease' }} />
      <text x="50%" y="53%" textAnchor="middle" dominantBaseline="middle" style={{ font: `700 12px ${T.fontBody}`, fill: T.text }}>{done}/{total}</text>
    </svg>
  );
}

// The infographic a post can carry.
function FeedVisual({ v, color }) {
  if (!v) return null;
  const box = { borderRadius: 16, padding: '16px 18px', margin: '4px 0 14px', background: withAlpha(color, 0.07), border: `1px solid ${withAlpha(color, 0.2)}` };
  const big = { fontFamily: T.fontDisplay, fontWeight: 700, color, lineHeight: 1 };
  if (v.type === 'stat') return (
    <div style={{ ...box, display: 'flex', alignItems: 'center', gap: 16 }}>
      <div style={{ ...big, fontSize: 52, letterSpacing: '-0.02em' }}>{v.value}</div>
      <div style={{ minWidth: 0 }}>
        {v.label && <div style={{ fontSize: 15, fontWeight: 600, color: T.text, lineHeight: 1.3 }}>{v.label}</div>}
        {v.sub && <div style={{ fontSize: 12.5, color: T.textMuted, marginTop: 3, lineHeight: 1.4 }}>{v.sub}</div>}
      </div>
    </div>
  );
  if (v.type === 'compare') return (
    <div style={box}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 10, textAlign: 'center' }}>
        <div><div style={{ ...big, fontSize: 40, color: T.textMuted }}>{v.left.value}</div><div style={{ fontSize: 12.5, color: T.textMuted, marginTop: 6 }}>{v.left.label}</div></div>
        <div style={{ fontSize: 26, color }}>→</div>
        <div><div style={{ ...big, fontSize: 40 }}>{v.right.value}</div><div style={{ fontSize: 12.5, color: T.text, marginTop: 6, fontWeight: 600 }}>{v.right.label}</div></div>
      </div>
      {v.caption && <div style={{ fontSize: 12.5, color: T.textMuted, marginTop: 10, textAlign: 'center' }}>{v.caption}</div>}
    </div>
  );
  if (v.type === 'bars') {
    const max = Math.max(...v.data.map(d => Math.abs(d.value)), 1);
    return (
      <div style={box}>
        {v.title && <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 10 }}>{v.title}</div>}
        {v.data.map((d, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(70px, 34%) 1fr auto', alignItems: 'center', gap: 8, marginBottom: 7 }}>
            <span style={{ fontSize: 12.5, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</span>
            <span style={{ height: 12, borderRadius: 6, background: withAlpha(color, 0.12), overflow: 'hidden' }}>
              <span style={{ display: 'block', height: '100%', width: `${Math.max(3, Math.abs(d.value) / max * 100)}%`, borderRadius: 6, background: color, opacity: 0.55 + 0.45 * (Math.abs(d.value) / max) }} />
            </span>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: T.text, fontFamily: T.fontMono }}>{d.value}{v.unit || ''}</span>
          </div>
        ))}
      </div>
    );
  }
  if (v.type === 'quote') return (
    <div style={{ ...box, position: 'relative', paddingLeft: 46 }}>
      <span style={{ position: 'absolute', left: 14, top: 2, fontFamily: T.fontDisplay, fontSize: 56, color, opacity: 0.5, lineHeight: 1 }}>“</span>
      <div style={{ fontFamily: T.fontDisplay, fontSize: 19, lineHeight: 1.4, color: T.text }}>{v.text}</div>
      {v.by && <div style={{ fontSize: 12.5, color: T.textMuted, marginTop: 8 }}>{v.by}</div>}
    </div>
  );
  if (v.type === 'steps') return (
    <div style={box}>
      {v.title && <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 10 }}>{v.title}</div>}
      {v.items.map((s, i) => (
        <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: i < v.items.length - 1 ? 8 : 0 }}>
          <span style={{ flexShrink: 0, width: 24, height: 24, borderRadius: '50%', background: color, color: '#fff', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
          <span style={{ fontSize: 14, color: T.text, lineHeight: 1.45, paddingTop: 2 }}>{s}</span>
        </div>
      ))}
    </div>
  );
  if (v.type === 'image') return (
    <div style={{ margin: '4px 0 14px' }}><img src={v.url} alt={v.alt || ''} loading="lazy" style={{ width: '100%', borderRadius: 16, display: 'block' }} onError={e => { e.currentTarget.style.display = 'none'; }} /></div>
  );
  return null;
}

function FeedSection({ data, onSelectIssue, onSelectBlock, onAdd, onExit }) {
  const isMobile = useIsMobile();
  const [filter, setFilter] = fUseState('all');
  const [posts, setPosts] = fUseState(null);
  const [counts, setCounts] = fUseState({ total: 0, unseen: 0 });
  const [routines, setRoutines] = fUseState(null);
  const [toast, setToast] = fUseState('');
  const [replyFor, setReplyFor] = fUseState(null);
  const [lessonReveal, setLessonReveal] = fUseState({});
  const [lessonDone, setLessonDone] = fUseState({});
  fUseEffect(() => { (async () => { try { const r = await api('journey_status', {}); if (r && r.done_ids) setLessonDone(Object.fromEntries(r.done_ids.map(id => [`lesson:${id}`, true]))); } catch {} })(); }, []);
  const [replyText, setReplyText] = fUseState('');
  // post id → when the user sent a reply that Claude is now answering on the server.
  const [waiting, setWaiting] = fUseState({});
  const [busyItem, setBusyItem] = fUseState(null);
  const [refreshing, setRefreshing] = fUseState(false);
  const [newCount, setNewCount] = fUseState(0);       // posts that arrived while you were scrolled down
  const [badImg, setBadImg] = fUseState({});          // covers that failed to load → generated art
  // Time-awareness: a clock that ticks every 30s so every "in 2h", "NOW" and
  // "overdue" on screen stays true while the feed is open.
  const [now, setNow] = fUseState(() => new Date());
  fUseEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []);
  // A feed left open past midnight must not keep showing yesterday as "today".
  fUseEffect(() => {
    if (data && data.todayISO && data.todayISO !== fmtISO(now) && data.refetch) data.refetch();
  }, [now, data && data.todayISO]);   // eslint-disable-line
  // Live state of open items, so a brief's suggestions show where things stand
  // now (closed since, due in 2h, overdue 3d), not when the brief was written.
  const [openMap, setOpenMap] = fUseState(null);
  const loadOpen = fUseCallback(async () => {
    try {
      const r = await api('list_issues', { status: 'open' });
      if (r && r.issues) setOpenMap(Object.fromEntries(r.issues.map(i => [`${i.epic_slug}/${i.id}`, i])));
    } catch {}
  }, []);
  // The Now card: quick add, today's timeline, due today, overdue.
  const [qaText, setQaText] = fUseState('');
  const [qaEpic, setQaEpic] = fUseState(() => { try { return localStorage.getItem('todouz.feed.addEpic') || ''; } catch { return ''; } });
  const [qaBusy, setQaBusy] = fUseState(false);
  // item key → { label, item, from } for things just acted on from the Now card. Kept
  // across data refetches so a finished item stays on screen, struck through with
  // Undo, instead of vanishing the moment the server drops it from the list.
  const [handled, setHandled] = fUseState({});
  const [showAllOverdue, setShowAllOverdue] = fUseState(false);
  const [pickFor, setPickFor] = fUseState(null);      // item key whose date picker is open
  const scrollerRef = fUseRef(null);
  const seenTimers = fUseRef({});
  const toastTimer = fUseRef(null);
  const headRef = fUseRef(null);                      // { total, newestId } of the feed as last loaded
  const [hasMore, setHasMore] = fUseState(false);     // older posts left to page in
  const [loadingMore, setLoadingMore] = fUseState(false);
  // What happens at the very end: 'refilling' (making instant posts), 'generating'
  // (a spark-feed run is writing fresh ones), 'done' (nothing more right now).
  const [endState, setEndState] = fUseState(null);    // { phase, why, next_at }
  const postsRef = fUseRef(null); postsRef.current = posts;
  const hasMoreRef = fUseRef(false); hasMoreRef.current = hasMore;
  const moreBusy = fUseRef(false);
  const lastTopUp = fUseRef({ at: 0, empty: false });
  const flash = (m) => { setToast(m); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 2600); };

  // The cheap "has anything new arrived?" signature: how many posts, and the newest id.
  const fetchHead = async () => {
    const r = await api('feed_list', { since_days: FEED_WINDOW_DAYS, limit: 1 });
    return r && !r.error ? { total: r.counts?.total || 0, newestId: r.posts?.[0]?.id || null } : null;
  };

  const load = fUseCallback(async () => {
    try {
      // The server orders the feed (today's brief, then unseen, then the rest,
      // newest first in each) so later pages carry on exactly where this one ends.
      // A deep-linked post that is further down comes first.
      const r = await api('feed_list', { filter, order: 'feed', since_days: FEED_WINDOW_DAYS, limit: FEED_PAGE, first: window.__feedPending || undefined });
      if (r && !r.error) {
        setPosts(r.posts || []);
        setHasMore(!!r.has_more);
        setEndState(null);
        if (filter === 'all') { setCounts(r.counts || { total: 0, unseen: 0 }); headRef.current = { total: r.counts?.total || 0, newestId: r.newest_id || null }; }
        else headRef.current = await fetchHead();
        setNewCount(0);
      } else setPosts([]);
    } catch { setPosts([]); }
    loadOpen();
  }, [filter, loadOpen]);
  fUseEffect(() => { setPosts(null); load(); }, [load]);
  // A new day: yesterday's brief and task cards expire (the server leaves them
  // out), so reload the feed when the clock passes midnight or you come back to it.
  const dayRef = fUseRef(fmtISO(new Date()));
  fUseEffect(() => {
    const d = fmtISO(now);
    if (d !== dayRef.current) { dayRef.current = d; load(); }
  }, [now]);   // eslint-disable-line
  // The dashboard data (today, overdue) refetches after edits elsewhere; keep the
  // live item states in step with it.
  fUseEffect(() => { loadOpen(); }, [data && data.tick]);   // eslint-disable-line

  const loadRoutines = fUseCallback(async () => {
    try { const r = await fetch('/api/routines').then(x => x.json()); if (r.ok) setRoutines(r); } catch {}
  }, []);
  fUseEffect(() => { loadRoutines(); }, [loadRoutines]);

  const refresh = async () => {
    setRefreshing(true);
    try { await Promise.all([load(), loadRoutines()]); } finally { setTimeout(() => setRefreshing(false), 400); }
  };

  // Auto-refresh: look for new posts every 45s while the tab is visible, and
  // straight away when you come back to the app. At the top of the feed new
  // posts slide in; further down a "new posts" pill appears instead of the
  // feed jumping under you.
  const checkForNew = fUseCallback(async () => {
    if (document.visibilityState !== 'visible' || !headRef.current) return;
    const head = await fetchHead();
    if (!head) return;
    const prev = headRef.current;
    if (head.newestId === prev.newestId && head.total === prev.total) return;
    const atTop = (scrollerRef.current?.scrollTop || 0) < 40;
    if (atTop) { await load(); return; }
    // Scrolled to the end of everything (e.g. waiting on fresh posts): they arrive
    // below you, where you are heading, instead of behind a pill at the top.
    if (!hasMoreRef.current && postsRef.current) {
      const r = await api('feed_list', { filter, order: 'feed', since_days: FEED_WINDOW_DAYS, limit: FEED_PAGE, exclude: postsRef.current.map(p => p.id) });
      if (r && !r.error) {
        // Nothing we haven't got (e.g. the end-of-feed top-up already pulled it in).
        headRef.current = head;
        if ((r.posts || []).length) { appendPosts(r.posts); setHasMore(!!r.has_more); setEndState(st => (st?.phase === 'generating' ? st : null)); }
        return;
      }
    }
    setNewCount(Math.max(1, head.total - prev.total));
  }, [load, filter]);   // eslint-disable-line
  fUseEffect(() => {
    const t = setInterval(checkForNew, FEED_POLL_MS);
    // Coming back to the app: new posts, routine status, and today's schedule, due and overdue lists.
    const onVis = () => { if (document.visibilityState === 'visible') { setNow(new Date()); checkForNew(); loadRoutines(); if (data && data.refetch) data.refetch(); } };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', onVis); };
  }, [checkForNew, loadRoutines, data && data.refetch]);   // eslint-disable-line
  // While a routine runs, check every 8s so its posts appear as they land.
  fUseEffect(() => {
    if (!routines?.status?.running && !(routines?.status?.queue || []).length) return;
    const t = setInterval(() => { loadRoutines(); checkForNew(); }, 8000);
    return () => clearInterval(t);
  }, [routines, loadRoutines, checkForNew]);

  // The next page: the posts after the ones on screen, in feed order. Appending
  // below the fold never moves what you are looking at.
  const appendPosts = (more) => {
    if (!more || !more.length) return;
    setPosts(prev => {
      const have = new Set((prev || []).map(p => p.id));
      return [...(prev || []), ...more.filter(p => !have.has(p.id))];
    });
  };
  const fetchNextPage = async () => {
    const r = await api('feed_list', { filter, order: 'feed', since_days: FEED_WINDOW_DAYS, limit: FEED_PAGE, exclude: (postsRef.current || []).map(p => p.id) });
    if (!r || r.error) return null;
    appendPosts(r.posts || []);
    setHasMore(!!r.has_more);
    return r;
  };
  const loadMore = async () => {
    if (moreBusy.current || !postsRef.current) return;
    moreBusy.current = true; setLoadingMore(true);
    try { await fetchNextPage(); } finally { moreBusy.current = false; setLoadingMore(false); }
  };
  // Out of posts: ask the server for more. It makes a few instantly (a Brain note
  // worth seeing again, a "still on your list?" card) and, when its throttle
  // allows, starts a spark-feed run whose posts slide in here as they land.
  const topUp = async ({ force = false } = {}) => {
    if (filter !== 'all' || moreBusy.current) return;
    const last = lastTopUp.current;
    // Don't hammer it: a few seconds apart, and after an empty answer wait 3 min unless asked.
    if (!force && (Date.now() - last.at < 4000 || (last.empty && Date.now() - last.at < 180000))) return;
    moreBusy.current = true; lastTopUp.current = { at: Date.now(), empty: false };
    setEndState({ phase: 'refilling' });
    try {
      const r = await fetch('/api/feed/more', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(x => x.json()).catch(() => null);
      const page = await fetchNextPage();
      const got = (page?.posts || []).length;
      headRef.current = await fetchHead() || headRef.current;
      lastTopUp.current = { at: Date.now(), empty: !got && !r?.generating };
      setEndState({ phase: r?.generating ? 'generating' : (got ? null : 'done'), why: r?.why || null, next_at: r?.next_at || null });
      if (r?.generating) loadRoutines();
    } finally { moreBusy.current = false; }
  };
  // Once you scroll into the feed, slide the page so the feed fills the screen.
  const aligning = fUseRef(0);
  const fillScreen = (el) => {
    if (isMobile || !el || el.scrollTop <= 0 || Date.now() - aligning.current < 600) return;
    const top = el.getBoundingClientRect().top;
    if (top > 6) { aligning.current = Date.now(); window.scrollTo({ top: window.scrollY + top - (isMobile ? 4 : 6), behavior: 'smooth' }); }
  };
  // Called as you scroll: within ~2.5 screens of the end, fetch what comes next.
  const nearEnd = (el) => {
    if (!el || posts == null) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight > el.clientHeight * 2.5) return;
    if (hasMoreRef.current) loadMore();
    else if (posts.length && el.scrollTop > 0) topUp();
  };
  // A first page that doesn't fill the screen pages straight on.
  fUseEffect(() => { if (hasMore && scrollerRef.current) nearEnd(scrollerRef.current); }, [posts, hasMore]);   // eslint-disable-line
  // When the run writing fresh posts finishes, settle the end-of-feed card.
  fUseEffect(() => {
    if (endState?.phase !== 'generating' || !routines?.status) return;
    if (routines.status.running || (routines.status.queue || []).length) return;
    (async () => { const page = await fetchNextPage(); setEndState((page?.posts || []).length ? null : { phase: 'done', why: 'ran recently' }); })();
  }, [routines]);   // eslint-disable-line

  // Jump (not smooth-scroll) to the top: gliding past several snap points is slow.
  const showNew = async () => { await load(); scrollerRef.current && scrollerRef.current.scrollTo({ top: 0 }); };

  // #feed=<id> deep link (e.g. tapping the morning push): scroll to that post.
  fUseEffect(() => {
    const go = (id) => {
      if (!id || !posts) return;
      const el = scrollerRef.current && scrollerRef.current.querySelector(`[data-post="${id}"]`);
      if (el) { el.scrollIntoView({ block: 'start' }); window.__feedPending = null; }
    };
    go(window.__feedPending);
    const onOpen = (e) => go(e.detail);
    window.addEventListener('todouz-feed-open', onOpen);
    return () => window.removeEventListener('todouz-feed-open', onOpen);
  }, [posts]);

  const patchPost = (id, fn) => setPosts(prev => (prev || []).map(p => (p.id === id ? fn({ ...p, reactions: { ...p.reactions } }) : p)));

  const react = async (p, reaction, extra = {}) => {
    const r = await api('feed_react', { id: p.id, reaction, source: 'dashboard', ...extra });
    if (r && r.ok) patchPost(p.id, x => { x.reactions = r.reactions; return x; });
    else if (r && r.error) flash(r.error);
    return r;
  };

  // Mark a post seen once it has been mostly on screen for a moment.
  fUseEffect(() => {
    const root = scrollerRef.current;
    if (!root || !posts || !posts.length || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        const id = en.target.getAttribute('data-post');
        if (en.isIntersecting && en.intersectionRatio >= 0.6) {
          if (!seenTimers.current[id]) seenTimers.current[id] = setTimeout(() => {
            const p = (posts || []).find(x => x.id === id);
            if (p && !p.reactions.seen_at) react(p, 'seen');
          }, 1200);
        } else { clearTimeout(seenTimers.current[id]); delete seenTimers.current[id]; }
      }
    }, { root, threshold: [0.6] });
    root.querySelectorAll('[data-post]').forEach(el => io.observe(el));
    return () => { io.disconnect(); Object.values(seenTimers.current).forEach(clearTimeout); seenTimers.current = {}; };
  }, [posts]);   // eslint-disable-line

  // j/k or arrows step between cards on a keyboard; r refreshes.
  fUseEffect(() => {
    const onKey = (e) => {
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const root = scrollerRef.current; if (!root) return;
      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); root.scrollBy({ top: root.clientHeight, behavior: 'smooth' }); }
      if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); root.scrollBy({ top: -root.clientHeight, behavior: 'smooth' }); }
      if (e.key === 'r') { e.preventDefault(); refresh(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);   // eslint-disable-line

  const runRoutine = async (name, extra = {}) => {
    const r = await fetch('/api/routines/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, ...extra }) }).then(x => x.json()).catch(() => null);
    if (!r || r.error) { flash(r?.error || 'Could not start the routine'); return; }
    flash(r.already ? `Already ${r.already}…` : 'Started. New posts will appear here on their own.');
    loadRoutines();
  };

  const digDeeper = async (p) => {
    await react(p, 'deeper');
    await runRoutine('deep-dive', { post_id: p.id });
  };

  // A reply goes to Claude on the server straight away (the feed-reply routine,
  // on the server's own Claude login): it answers in the thread, and can change
  // the feed's standing preferences, post new cards, or answer a question.
  const sendReply = async (p, preset) => {
    const t = String(preset ?? replyText).trim(); if (!t) return;
    const r = await react(p, 'reply', { text: t });
    if (!r || !r.ok) return;
    setReplyText('');
    const q = await fetch('/api/routines/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'feed-reply', post_id: p.id }) }).then(x => x.json()).catch(() => null);
    if (!q || q.error) { flash(q?.error ? `Saved, but Claude could not start: ${q.error}` : 'Saved. The next feed run reads it.'); return; }
    setWaiting(w => ({ ...w, [p.id]: Date.now() }));
    loadRoutines();
  };
  // While Claude is answering, pick up its reply (the "seen" reaction is a no-op
  // that returns the post's current reactions). Gives up after 8 minutes.
  fUseEffect(() => {
    const ids = Object.keys(waiting); if (!ids.length) return;
    const t = setInterval(async () => {
      for (const id of ids) {
        const r = await api('feed_react', { id, reaction: 'seen', source: 'dashboard' }).catch(() => null);
        const reps = r?.reactions?.replies || [];
        const answered = reps.length && reps[reps.length - 1].from === 'claude';
        if (r && r.ok) patchPost(id, x => { x.reactions = r.reactions; return x; });
        if (answered || Date.now() - waiting[id] > 8 * 60000) {
          setWaiting(w => { const n = { ...w }; delete n[id]; return n; });
          if (!answered) flash('Claude is taking a while. The answer will show on the post when it lands.');
          else checkForNew();
        }
      }
    }, 5000);
    return () => clearInterval(t);
  }, [waiting]);   // eslint-disable-line
  const REPLY_PRESETS = ['More like this', 'Less like this', 'Too generic, cite the source', 'Turn this into a 60-second drill', 'Go deeper on this'];

  // One-tap actions on the items a brief or review suggests.
  const itemKey = (it) => `${it.epic_slug}/${it.id}`;
  const openItem = (it) => onSelectIssue && onSelectIssue({ kind: 'issue', id: it.id, epic_slug: it.epic_slug, title: it.title });
  // The actual change to an item. Returns a short label of what happened, or null.
  const actItem = async (it, action, date) => {
    let label = action, r;
    if (action === 'done') r = await api('complete_issue', { id: it.id, epic: it.epic_slug, summary: 'Closed from the feed: confirmed finished.' });
    else if (action === 'drop') r = await api('complete_issue', { id: it.id, epic: it.epic_slug, summary: 'Dropped from the feed: no longer relevant.' }), label = 'dropped';
    else if (action === 'date') r = await api('update_issue', { id: it.id, epic: it.epic_slug, patch: { due: date } }), label = `due ${date}`;
    else if (action === 'undo') r = await api('update_issue', { id: it.id, epic: it.epic_slug, patch: { status: 'open' } }), label = 'clear';
    if (r && r.error) { flash(r.error); return null; }
    if (action !== 'undo') flash(action === 'date' ? `Moved to ${shortDate(date)}` : action === 'done' ? 'Marked done' : 'Dropped');
    return label;
  };
  const doItem = async (p, it, action, date) => {
    setBusyItem(itemKey(it) + action);
    try {
      const label = await actItem(it, action, date);
      if (!label) return;
      await react(p, 'item_action', { item: itemKey(it), text: label });
      loadOpen();
      if (data && data.refetch) data.refetch();
    } finally { setBusyItem(null); }
  };
  // Same actions from the Now card: no post to record against, the row just updates.
  const nowAct = async (it, action, date, from) => {
    const k = itemKey(it);
    setBusyItem(k + action); setPickFor(null);
    try {
      const label = await actItem(it, action, date);
      if (!label) return;
      setHandled(h => { const n = { ...h }; if (action === 'undo') delete n[k]; else n[k] = { label, item: it, from: from || (h[k] && h[k].from) }; return n; });
      loadOpen();
      if (data && data.refetch) data.refetch();
    } finally { setBusyItem(null); }
  };

  // Quick add from the Now card.
  const epics = ((data && data.epics && data.epics.epics) || []).filter(e => !String(e.slug).startsWith('archive/'));
  const addEpic = epics.find(e => e.slug === qaEpic) ? qaEpic : ((epics.find(e => e.slug === 'personal/inbox') || epics[0] || {}).slug || '');
  const qaParsed = qaText.trim() ? parsePlan(qaText, now) : null;
  const quickAdd = async () => {
    if (!qaParsed || !qaParsed.title || !addEpic) return;
    setQaBusy(true);
    try {
      const args = { epic: addEpic, title: qaParsed.title };
      if (qaParsed.due) args.due = qaParsed.due;
      if (qaParsed.due_time) args.due_time = qaParsed.due_time;
      if (qaParsed.priority) args.priority = qaParsed.priority;
      const r = await api('create_issue', args);
      if (r && r.error) { flash(r.error); return; }
      try { localStorage.setItem('todouz.feed.addEpic', addEpic); } catch {}
      setQaText('');
      flash(`Added "${qaParsed.title}"${qaParsed.due ? ` · ${dueStatus(qaParsed.due, qaParsed.due_time, now).label}` : ''}`);
      if (data && data.refetch) data.refetch();
    } finally { setQaBusy(false); }
  };

  // Move every overdue item still on screen to next Monday, after a confirm.
  const snoozeAllOverdue = async (list) => {
    const mon = nextMonday();
    if (!window.confirm(`Move all ${list.length} overdue items to ${shortDate(mon)}? You can still change each one later.`)) return;
    setBusyItem('bulk');
    try {
      for (const it of list) await api('update_issue', { id: it.id, epic: it.epic_slug, patch: { due: mon } });
      flash(`Moved ${list.length} items to ${shortDate(mon)}`);
      setHandled(h => ({ ...h, ...Object.fromEntries(list.map(it => [itemKey(it), { label: `due ${mon}`, item: it, from: 'overdue' }])) }));
      loadOpen();
      if (data && data.refetch) data.refetch();
    } finally { setBusyItem(null); }
  };

  const completeBlock = async (b) => {
    const r = await api('complete_timeblock', { id: b.id });
    if (r && r.error) { flash(r.error); return; }
    flash('Session done');
    if (data && data.refetch) data.refetch();
  };

  // ─── pieces ───
  const chip = (active, color = T.accent) => ({ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 999, cursor: 'pointer', fontFamily: T.fontBody, fontSize: 12.5, whiteSpace: 'nowrap', background: active ? withAlpha(color, 0.13) : T.surface, color: active ? color : T.textMuted, border: `1px solid ${active ? 'transparent' : T.border}` });
  const smallBtn = { background: T.surface, color: T.text, border: `1px solid ${T.border}`, borderRadius: 8, padding: '4px 10px', fontFamily: T.fontBody, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' };
  const running = routines?.status?.running;
  const queued = routines?.status?.queue || [];

  const railBtn = ({ key, on, icon, label, onClick, color }) => (
    <button key={key} onClick={onClick} title={label}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: isMobile ? 1 : 2, background: 'transparent', border: 'none', cursor: 'pointer', padding: isMobile ? '3px 2px' : '4px 0', color: on ? color : T.textMuted, fontFamily: T.fontBody, minWidth: isMobile ? 44 : undefined }}>
      <span style={{ width: isMobile ? 32 : 44, height: isMobile ? 32 : 44, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: isMobile ? 16 : 20,
        background: on ? withAlpha(color, 0.15) : T.surface2, border: `1px solid ${on ? withAlpha(color, 0.5) : T.border}`, filter: on ? 'none' : 'grayscale(0.35)', transition: 'transform 0.12s', transform: on ? 'scale(1.06)' : 'none' }}>{icon}</span>
      <span style={{ fontSize: 10.5, fontWeight: on ? 700 : 500 }}>{label}</span>
    </button>
  );

  // Cover: the article's image (with a dark scrim) or the generated art, with
  // the title set over it like a shorts thumbnail.
  const hero = (p, meta) => {
    const img = p.image && !badImg[p.id];
    const domains = [...new Set((p.sources || []).map(s => hostOf(s.url)).filter(Boolean))].slice(0, 3);
    const chipRow = (dark) => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: dark ? '#fff' : meta.color, background: dark ? 'rgba(0,0,0,0.28)' : withAlpha(meta.color, 0.1), backdropFilter: dark ? 'blur(6px)' : undefined, WebkitBackdropFilter: dark ? 'blur(6px)' : undefined, borderRadius: 999, padding: '4px 11px' }}>{meta.icon} {p.kind === 'lesson' && p.lesson && p.lesson.day ? `Day ${p.lesson.day} of ${p.lesson.of}` : meta.label}</span>
        {!p.reactions.seen_at && <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em', color: '#fff', background: '#ef4444', borderRadius: 999, padding: '3px 8px' }}>NEW</span>}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: dark ? 'rgba(255,255,255,0.85)' : T.textFaint, fontFamily: T.fontMono, textShadow: dark ? '0 1px 4px rgba(0,0,0,0.5)' : 'none' }}>{whenWritten(p.created, now)}</span>
      </div>
    );
    const domainRow = (dark) => domains.length > 0 && (
      <div style={{ display: 'flex', gap: 6, marginTop: 9, flexWrap: 'wrap' }}>
        {domains.map(d => (
          <span key={d} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: dark ? '#fff' : T.textMuted, background: dark ? 'rgba(255,255,255,0.18)' : T.surface2, borderRadius: 999, padding: '2px 8px 2px 4px' }}>
            <img src={`https://${d}/favicon.ico`} alt="" width="14" height="14" style={{ borderRadius: 3, background: '#fff' }} onError={e => { e.currentTarget.style.display = 'none'; }} />{d}
          </span>
        ))}
      </div>
    );
    const isCover = img && (p.book || /covers\.openlibrary\.org/.test(p.image));
    // A book: its real cover, sharp on the left over a blurred copy of itself.
    if (isCover) return (
      <div style={{ position: 'relative', flexShrink: 0, height: isMobile ? 'clamp(170px, 26dvh, 230px)' : 'clamp(180px, 28vh, 260px)', overflow: 'hidden', background: '#1c1917' }}>
        <img src={p.image} alt="" aria-hidden="true" referrerPolicy="no-referrer" style={{ position: 'absolute', inset: -30, width: 'calc(100% + 60px)', height: 'calc(100% + 60px)', objectFit: 'cover', filter: 'blur(26px) saturate(1.2)', opacity: 0.7 }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, rgba(0,0,0,0.55), rgba(0,0,0,0.25))' }} />
        <div style={{ position: 'absolute', top: 12, left: 14, right: 14 }}>{chipRow(true)}</div>
        <div style={{ position: 'absolute', left: isMobile ? 16 : 22, right: isMobile ? 16 : 22, bottom: isMobile ? 14 : 18, top: 50, display: 'flex', gap: isMobile ? 14 : 20, alignItems: 'flex-end' }}>
          <img src={p.image} alt={p.book ? `Cover of ${p.book.title}` : ''} loading="lazy" referrerPolicy="no-referrer" onError={() => setBadImg(b => ({ ...b, [p.id]: true }))}
            style={{ height: '100%', maxHeight: 190, aspectRatio: '2 / 3', objectFit: 'cover', borderRadius: 6, boxShadow: '0 10px 30px rgba(0,0,0,0.45)', flexShrink: 0 }} />
          <div style={{ minWidth: 0, flex: 1 }}>
            {p.book && <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.8)', marginBottom: 6 }}>{p.book.title}{p.book.author ? ` · ${p.book.author}` : ''}</div>}
            <h2 style={{ fontFamily: T.fontDisplay, fontSize: isMobile ? 20 : 26, lineHeight: 1.15, fontWeight: 700, margin: 0, color: '#fff', textShadow: '0 2px 14px rgba(0,0,0,0.45)',
              display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.title}</h2>
          </div>
        </div>
      </div>
    );
    // No picture: a calm, light header instead of generated art.
    if (!img) return (
      <div style={{ flexShrink: 0, padding: isMobile ? '14px 16px 14px' : '18px 24px 16px', background: `linear-gradient(180deg, ${withAlpha(meta.color, 0.09)}, ${withAlpha(meta.color, 0.02)})`, borderBottom: `1px solid ${withAlpha(meta.color, 0.14)}` }}>
        {chipRow(false)}
        <h2 style={{ fontFamily: T.fontDisplay, fontSize: isMobile ? 22 : 28, lineHeight: 1.18, fontWeight: 700, margin: '12px 0 0', color: T.text,
          display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.title}</h2>
        {domainRow(false)}
      </div>
    );
    return (
      // The cover scales with the screen, so short screens keep most of the card for reading.
      <div style={{ position: 'relative', flexShrink: 0, height: isMobile ? 'clamp(140px, 24dvh, 210px)' : 'clamp(150px, 26vh, 250px)', overflow: 'hidden', background: meta.grad[1] }}>
        <img src={p.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBadImg(b => ({ ...b, [p.id]: true }))}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.86) 8%, rgba(0,0,0,0.35) 55%, rgba(0,0,0,0.12))' }} />
        <div style={{ position: 'absolute', top: 12, left: 14, right: 14 }}>{chipRow(true)}</div>
        <div style={{ position: 'absolute', left: isMobile ? 16 : 22, right: isMobile ? 16 : 22, bottom: isMobile ? 14 : 18 }}>
          <h2 style={{ fontFamily: T.fontDisplay, fontSize: isMobile ? 21 : 27, lineHeight: 1.15, fontWeight: 700, margin: 0, color: '#fff', textShadow: '0 2px 14px rgba(0,0,0,0.45)',
            display: '-webkit-box', WebkitLineClamp: isMobile ? 4 : 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.title}</h2>
          {domainRow(true)}
        </div>
      </div>
    );
  };

  // A focus item as a tile: number, title, energy meter, next step.
  // Where an item stands right now: its live due status, or closed since the post was written.
  const liveOf = (it) => {
    const live = openMap ? openMap[itemKey(it)] : undefined;
    return { closed: !!openMap && !live, st: live ? dueStatus(live.due, live.due_time, now) : null };
  };
  const liveChip = (lv) => lv.closed
    ? <span style={{ fontSize: 11, fontWeight: 700, color: '#16a34a' }}>✓ already closed</span>
    : lv.st ? <span style={{ fontSize: 11, fontWeight: 700, color: TONE_COLOR[lv.st.tone] }}>{lv.st.label}</span> : null;

  const focusTile = (p, it, n) => {
    const lv = liveOf(it);
    const acted = (p.reactions.item_actions || {})[itemKey(it)] || (lv.closed ? 'closed' : null);
    const en = ENERGY_META[it.energy];
    const col = en ? en.color : T.accent;
    return (
      <div key={itemKey(it)} onClick={() => openItem(it)} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', cursor: 'pointer', padding: '12px 14px', borderRadius: 14,
        background: `linear-gradient(135deg, ${withAlpha(col, 0.12)}, ${withAlpha(col, 0.03)})`, border: `1px solid ${withAlpha(col, 0.3)}`, opacity: acted ? 0.6 : 1 }}>
        <span style={{ flexShrink: 0, width: 34, height: 34, borderRadius: 10, background: col, color: '#fff', fontFamily: T.fontDisplay, fontWeight: 700, fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{acted ? '✓' : n}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14.5, fontWeight: 700, color: T.text, lineHeight: 1.3, flex: 1, minWidth: 0 }}>{it.title || it.id}</span>
            <EnergyMeter energy={it.energy} />
          </div>
          <div style={{ marginTop: 3 }}>{liveChip(lv)}</div>
          {it.next_step && <div style={{ fontSize: 13, color: T.textMuted, marginTop: 4, lineHeight: 1.45 }}>→ {it.next_step}</div>}
          {en && <div style={{ fontSize: 10.5, color: col, fontWeight: 700, marginTop: 5, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{en.label}</div>}
        </div>
      </div>
    );
  };

  // A suggested done / drop / date item with its one-tap actions.
  const deckRow = (p, it) => {
    const lv = liveOf(it);
    const acted = (p.reactions.item_actions || {})[itemKey(it)] || (lv.closed ? 'already closed' : null);
    const am = ACTION_META[it.action] || ACTION_META.date;
    const busy = (a) => busyItem === itemKey(it) + a;
    return (
      <div key={itemKey(it)} style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '9px 11px', borderRadius: 12, background: acted ? T.surface2 : T.surface, border: `1px solid ${T.border}`, borderLeft: `4px solid ${acted ? T.border : am.color}`, opacity: acted ? 0.7 : 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span onClick={() => openItem(it)} style={{ fontSize: 13.5, fontWeight: 600, color: T.text, cursor: 'pointer', flex: 1, minWidth: 0, textDecoration: acted === 'done' || acted === 'dropped' ? 'line-through' : 'none' }}>{it.title || it.id}</span>
          {!lv.closed && liveChip(lv)}
          <span style={{ fontSize: 10.5, color: T.textFaint, fontFamily: T.fontMono }}>{it.epic_slug.split('/')[1]}</span>
        </div>
        {it.why && <div style={{ fontSize: 12, color: T.textMuted, lineHeight: 1.4 }}>{it.why}</div>}
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
          {acted ? (
            <>
              <span style={{ fontSize: 12, color: T.done, fontWeight: 700 }}>✓ {acted}</span>
              {(acted === 'done' || acted === 'dropped') && <button onClick={() => doItem(p, it, 'undo')} style={{ ...smallBtn, padding: '2px 8px' }}>Undo</button>}
            </>
          ) : (
            <>
              <button disabled={busy('done')} onClick={() => doItem(p, it, 'done')} style={{ ...smallBtn, ...(it.action === 'done' ? { background: ACTION_META.done.color, color: '#fff', border: 'none' } : {}) }}>✓ Done</button>
              <button disabled={busy('drop')} onClick={() => doItem(p, it, 'drop')} style={{ ...smallBtn, ...(it.action === 'drop' ? { background: ACTION_META.drop.color, color: '#fff', border: 'none' } : {}) }}>Drop</button>
              <button disabled={busy('date')} onClick={() => doItem(p, it, 'date', isoDaysFromNow(1))} style={{ ...smallBtn, ...(it.action === 'date' ? { borderColor: ACTION_META.date.color, color: ACTION_META.date.color } : {}) }}>Tomorrow</button>
              <button disabled={busy('date')} onClick={() => doItem(p, it, 'date', nextMonday())} style={smallBtn}>Next week</button>
            </>
          )}
        </div>
      </div>
    );
  };

  // Brief and review cards: focus tiles, then "clear the decks" with a ring and
  // a bar showing the mix of suggestions.
  const itemsBlock = (p) => {
    const focus = p.items.filter(it => it.action === 'focus').slice(0, 3);
    const deck = p.items.filter(it => it.action !== 'focus');
    const acted = deck.filter(it => (p.reactions.item_actions || {})[itemKey(it)] || liveOf(it).closed).length;
    const mix = ['done', 'drop', 'date'].map(a => ({ a, n: deck.filter(it => it.action === a).length })).filter(x => x.n);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, margin: '2px 0 14px' }}>
        {focus.length > 0 && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: T.textFaint, marginBottom: 8 }}>{p.kind === 'brief' ? "Today's three" : 'Next week is about'}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{focus.map((it, i) => focusTile(p, it, i + 1))}</div>
          </div>
        )}
        {deck.length > 0 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
              <ProgressRing done={acted} total={deck.length} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>Clear the decks</div>
                <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', margin: '6px 0 4px', background: T.surface2 }}>
                  {mix.map(x => <span key={x.a} style={{ width: `${x.n / deck.length * 100}%`, background: ACTION_META[x.a].color }} />)}
                </div>
                <div style={{ fontSize: 11.5, color: T.textMuted, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {mix.map(x => <span key={x.a}><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: ACTION_META[x.a].color, marginRight: 4 }} />{x.n} to {ACTION_META[x.a].label.toLowerCase()}</span>)}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{deck.map(it => deckRow(p, it))}</div>
          </div>
        )}
      </div>
    );
  };

  // ─── the Now card: live, not generated ───
  // One row for an item on the Now card: live due status plus one-tap actions.
  const nowRow = (it, { overdue = false } = {}) => {
    const k = itemKey(it);
    const from = overdue ? 'overdue' : 'due';
    const done = handled[k] && handled[k].label;
    // After a move, show the new date's status, not the old overdue one.
    const st = done && String(done).startsWith('due ') ? dueStatus(String(done).slice(4), it.due_time, now) : dueStatus(it.due, it.due_time, now);
    const busy = (a) => busyItem === k + a;
    return (
      <div key={k} style={{ padding: '8px 10px', borderRadius: 12, background: done ? T.surface2 : T.surface, border: `1px solid ${T.border}`, borderLeft: `4px solid ${done ? T.border : TONE_COLOR[st.tone]}`, opacity: done ? 0.7 : 1 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span onClick={() => openItem(it)} style={{ fontSize: 13.5, fontWeight: 600, color: T.text, cursor: 'pointer', flex: 1, minWidth: 0, textDecoration: done === 'done' || done === 'dropped' ? 'line-through' : 'none' }}>{it.title}</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: TONE_COLOR[st.tone], whiteSpace: 'nowrap' }}>{st.label}</span>
        </div>
        <div style={{ fontSize: 10.5, color: T.textFaint, fontFamily: T.fontMono, margin: '2px 0 6px' }}>{(it.epic_slug || '').split('/')[1]}</div>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
          {done ? (
            <>
              <span style={{ fontSize: 12, color: T.done, fontWeight: 700 }}>✓ {String(done).startsWith('due ') ? `moved to ${shortDate(String(done).slice(4))}` : done}</span>
              {(done === 'done' || done === 'dropped') && <button onClick={() => nowAct(it, 'undo', undefined, from)} style={{ ...smallBtn, padding: '2px 8px' }}>Undo</button>}
            </>
          ) : (
            <>
              <button disabled={busy('done')} onClick={() => nowAct(it, 'done', undefined, from)} style={{ ...smallBtn, background: '#16a34a', color: '#fff', border: 'none' }}>✓ Done</button>
              {overdue && <button disabled={busy('date')} onClick={() => nowAct(it, 'date', fmtISO(now), from)} style={smallBtn}>Today</button>}
              <button disabled={busy('date')} onClick={() => nowAct(it, 'date', addDaysISO(dayStart(now), 1), from)} style={smallBtn}>Tomorrow</button>
              <button disabled={busy('date')} onClick={() => nowAct(it, 'date', nextMonday(), from)} style={smallBtn}>Next week</button>
              {pickFor === k
                ? <input type="date" autoFocus min={fmtISO(now)} onChange={e => e.target.value && nowAct(it, 'date', e.target.value, from)} onBlur={() => setPickFor(null)}
                    style={{ ...smallBtn, padding: '3px 6px', fontFamily: T.fontMono }} />
                : <button onClick={() => setPickFor(k)} style={smallBtn} title="Pick a date">📅</button>}
              <button disabled={busy('drop')} onClick={() => nowAct(it, 'drop', undefined, from)} style={{ ...smallBtn, color: '#dc2626' }}>Drop</button>
            </>
          )}
        </div>
      </div>
    );
  };

  const nowCard = () => {
    const t = (data && data.today) || {};
    const todayISO = fmtISO(now);
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const hour = now.getHours();
    const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const grad = hour < 12 ? ['#f59e0b', '#ea580c'] : hour < 17 ? ['#0ea5e9', '#1d4ed8'] : ['#6366f1', '#312e81'];
    const blocks = (t.timeblocks_today || []).slice().sort((a, b) => String(a.start).localeCompare(String(b.start)));
    const events = (t.events_today || []).map(e => ({ ...e, start: e.time || e.start, isEvent: true }));
    const timeline = [...blocks, ...events].filter(b => b.start).sort((a, b) => String(a.start).localeCompare(String(b.start)));
    const left = timeline.filter(b => !b.completed && (hmToMin(b.end) ?? hmToMin(b.start)) > nowMin).length;
    const keep = (list, from) => {
      const seen = new Set(list.map(itemKey));
      const extra = Object.values(handled).filter(h => h && h.from === from && !seen.has(itemKey(h.item))).map(h => h.item);
      return [...list, ...extra];
    };
    const dueToday = keep(t.due_today || [], 'due').sort((a, b) => String(a.due_time || '99').localeCompare(String(b.due_time || '99')));
    const overdueAll = keep((data && data.overdue && data.overdue.issues) || [], 'overdue').sort((a, b) => String(a.due).localeCompare(String(b.due)));
    const overdueOpen = overdueAll.filter(it => !handled[itemKey(it)]);
    const overdueShown = showAllOverdue ? overdueAll : overdueAll.slice(0, 6);
    const oldest = overdueOpen[0] ? Math.round((dayStart(now) - parseISODate(overdueOpen[0].due)) / 86400000) : 0;
    const serverStale = t.date && t.date !== todayISO;
    const nextSlot = (() => { const m = Math.ceil((nowMin + 1) / 30) * 30; return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; })();
    let nowLineDrawn = false;
    const sectionHead = (label, extra) => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '16px 0 8px' }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: T.textFaint }}>{label}</span>
        <span style={{ flex: 1, height: 1, background: T.border }} />
        {extra}
      </div>
    );
    return (
      <section key="now" data-post="now" style={{ height: '100%', scrollSnapAlign: 'start', scrollSnapStop: 'always', boxSizing: 'border-box', padding: isMobile ? '6px 0' : '10px 0', display: 'flex' }}>
        <div style={{ flex: 1, minWidth: 0, height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', background: T.surface, border: `1px solid ${T.border}`, borderRadius: 20, overflow: 'hidden', boxShadow: T.shadowSm }}>
          <div style={{ position: 'relative', flexShrink: 0, padding: isMobile ? '16px 16px 14px' : '20px 24px 16px', color: '#fff', overflow: 'hidden' }}>
            <FeedCoverArt seed={`now-${todayISO}`} grad={grad} />
            <div style={{ position: 'relative' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: T.fontDisplay, fontSize: isMobile ? 40 : 48, fontWeight: 700, lineHeight: 1, letterSpacing: '-0.02em' }}>{now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
                <span style={{ fontSize: 15, fontWeight: 600, opacity: 0.95 }}>{greet} · {now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                {[[`${left}`, `session${left === 1 ? '' : 's'} left`], [`${dueToday.filter(i => !handled[itemKey(i)]).length}`, 'due today'], [`${overdueOpen.length}`, 'overdue']].map(([n, l]) => (
                  <span key={l} style={{ background: 'rgba(255,255,255,0.2)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', borderRadius: 999, padding: '4px 11px', fontSize: 12.5 }}><b style={{ fontSize: 14 }}>{n}</b> {l}</span>
                ))}
              </div>
            </div>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: isMobile ? '12px 14px 20px' : '16px 22px 24px' }}>
            {/* Quick add */}
            <div style={{ background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 14, padding: 10 }}>
              <div style={{ display: 'flex', gap: 6 }}>
                <input value={qaText} onChange={e => setQaText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') quickAdd(); }}
                  placeholder='Add a plan item… "rehearse pitch today 6pm !high"'
                  style={{ flex: 1, minWidth: 0, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: '9px 11px', fontFamily: T.fontBody, fontSize: 14, color: T.text, outline: 'none' }} />
                <button disabled={qaBusy || !qaParsed || !qaParsed.title} onClick={quickAdd}
                  style={{ ...smallBtn, background: T.accent, color: '#fff', border: 'none', padding: '6px 14px', fontSize: 13, opacity: qaParsed && qaParsed.title ? 1 : 0.5 }}>Add</button>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 7 }}>
                {qaParsed && qaParsed.title ? (
                  <>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: qaParsed.due ? TONE_COLOR[dueStatus(qaParsed.due, qaParsed.due_time, now).tone] : T.textFaint }}>📅 {qaParsed.due ? dueStatus(qaParsed.due, qaParsed.due_time, now).label.replace(/^due /, '') : 'no date'}</span>
                    {qaParsed.priority && <span style={{ fontSize: 11.5, fontWeight: 700, color: qaParsed.priority === 'high' ? '#dc2626' : T.textMuted }}>⚡ {qaParsed.priority}</span>}
                  </>
                ) : <span style={{ fontSize: 11.5, color: T.textFaint }}>Dates and times are understood: today, tmr, fri, 20 oct, in 3 days, 6pm, 14:30, !high</span>}
                <span style={{ flex: 1 }} />
                <select value={addEpic} onChange={e => setQaEpic(e.target.value)} title="Folder"
                  style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: '3px 6px', fontFamily: T.fontBody, fontSize: 11.5, color: T.textMuted, background: T.surface, maxWidth: 170 }}>
                  {epics.map(e => <option key={e.slug} value={e.slug}>{e.slug.split('/')[0]} / {e.title || e.slug.split('/')[1]}</option>)}
                </select>
                {onAdd && <button onClick={() => onAdd('timeblock', { date: todayISO, time: nextSlot })} style={smallBtn} title="Plan a session">＋ Session</button>}
              </div>
            </div>
            {serverStale && <div style={{ marginTop: 8, fontSize: 11.5, color: '#b45309' }}>The server's "today" is {shortDate(t.date)}; the lists below may be a day off until it updates.</div>}

            {/* Today's timeline */}
            {sectionHead(`Today · ${timeline.length} on the schedule`)}
            {timeline.length === 0 ? (
              <div style={{ fontSize: 13, color: T.textFaint }}>Nothing scheduled today. {onAdd && <span onClick={() => onAdd('timeblock', { date: todayISO, time: nextSlot })} style={{ color: T.accent, cursor: 'pointer' }}>Plan a session</span>}</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {timeline.map((b, i) => {
                  const s = hmToMin(b.start), e = hmToMin(b.end) ?? (s + 30);
                  const state = b.completed ? 'done' : e <= nowMin ? 'past' : s <= nowMin ? 'now' : 'next';
                  const showLine = !nowLineDrawn && s > nowMin;
                  if (showLine) nowLineDrawn = true;
                  const col = state === 'now' ? '#dc2626' : state === 'next' ? T.accent : state === 'done' ? '#16a34a' : T.textFaint;
                  return (
                    <React.Fragment key={b.id || i}>
                      {showLine && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '2px 0' }}>
                          <span style={{ fontSize: 10.5, fontWeight: 800, color: '#dc2626', fontFamily: T.fontMono, width: 46 }}>{now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
                          <span style={{ flex: 1, height: 2, background: '#dc2626', borderRadius: 1 }} />
                        </div>
                      )}
                      <div onClick={() => !b.isEvent && onSelectBlock && onSelectBlock(b)} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '7px 8px', borderRadius: 10, cursor: b.isEvent ? 'default' : 'pointer',
                        background: state === 'now' ? withAlpha('#dc2626', 0.07) : 'transparent', opacity: state === 'past' || state === 'done' ? 0.6 : 1 }}>
                        <span style={{ fontSize: 12, fontFamily: T.fontMono, color: T.textMuted, width: 46, flexShrink: 0 }}>{b.start}</span>
                        <span style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0, background: state === 'now' || state === 'done' ? col : 'transparent', border: `2px solid ${col}`, animation: state === 'now' ? 'feedPulse 1.6s ease-in-out infinite' : 'none' }} />
                        <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: state === 'now' ? 700 : 500, color: T.text, textDecoration: state === 'done' ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: isMobile ? 'normal' : 'nowrap', lineHeight: 1.3 }}>{b.title}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: col, whiteSpace: 'nowrap' }}>
                          {state === 'now' ? `NOW · ends in ${spanLabel(e - nowMin)}` : state === 'next' ? `in ${spanLabel(s - nowMin)}` : state === 'done' ? 'done' : `${b.end || ''}`}
                        </span>
                        {!b.isEvent && !b.completed && (state === 'past' || state === 'now') && (
                          <button onClick={ev => { ev.stopPropagation(); completeBlock(b); }} title="Mark this session done" style={{ ...smallBtn, padding: '2px 8px' }}>✓</button>
                        )}
                      </div>
                    </React.Fragment>
                  );
                })}
              </div>
            )}

            {/* Due today */}
            {dueToday.length > 0 && (<>
              {sectionHead(`Due today · ${dueToday.length}`)}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{dueToday.map(it => nowRow(it))}</div>
            </>)}

            {/* Overdue */}
            {sectionHead(overdueAll.length ? `Overdue · ${overdueOpen.length}${oldest ? `, oldest ${oldest}d` : ''}` : 'Overdue',
              overdueOpen.length > 1 && <button disabled={busyItem === 'bulk'} onClick={() => snoozeAllOverdue(overdueOpen)} style={{ ...smallBtn, fontSize: 11 }}>Move all to {shortDate(nextMonday())}</button>)}
            {overdueAll.length === 0 ? (
              <div style={{ fontSize: 13, color: '#16a34a', fontWeight: 600 }}>Nothing overdue. Clear decks.</div>
            ) : (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{overdueShown.map(it => nowRow(it, { overdue: true }))}</div>
                {overdueAll.length > overdueShown.length && (
                  <button onClick={() => setShowAllOverdue(true)} style={{ ...smallBtn, marginTop: 8, width: '100%', padding: '7px' }}>Show all {overdueAll.length} overdue</button>
                )}
              </>
            )}
          </div>
        </div>
      </section>
    );
  };

  // ─── the end of the feed ───
  // A placeholder card while the next page loads, so scrolling never hits a wall.
  const skeleton = (title, sub, key) => (
    <section key={key} data-feed-end={key} style={{ height: '100%', scrollSnapAlign: 'start', boxSizing: 'border-box', padding: isMobile ? '6px 0' : '10px 0' }}>
      <div style={{ height: '100%', boxSizing: 'border-box', background: T.surface, border: `1px solid ${T.border}`, borderRadius: 20, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ height: '38%', minHeight: 140, background: `linear-gradient(110deg, ${T.surface2} 30%, ${withAlpha(T.accent, 0.10)} 50%, ${T.surface2} 70%)`, backgroundSize: '220% 100%', animation: 'feedShimmer 1.4s linear infinite' }} />
        <div style={{ padding: isMobile ? '18px 16px' : '22px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 700, color: T.text }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: T.accent, animation: 'feedPulse 1.2s ease-in-out infinite' }} />{title}
          </div>
          {sub && <div style={{ fontSize: 13, color: T.textMuted, lineHeight: 1.5 }}>{sub}</div>}
          {[88, 72, 80].map((w, i) => <div key={i} style={{ height: 12, width: `${w}%`, borderRadius: 6, background: T.surface2, animation: 'todouz-pulse 1.6s ease-in-out infinite' }} />)}
        </div>
      </div>
    </section>
  );
  const feedEnd = () => {
    if (hasMore || loadingMore) return skeleton('Loading more…', null, 'more');
    if (filter !== 'all') return <div key="end" style={{ padding: '18px 0 26px', textAlign: 'center', fontSize: 12.5, color: T.textFaint }}>That's everything here.</div>;
    const phase = endState?.phase;
    if (phase === 'refilling') return skeleton('Finding more for you…', 'Pulling from your Brain and your backlog.', 'refill');
    if (phase === 'generating') return skeleton('Writing fresh posts for you…', 'Claude is reading the news in your fields and your notes. New posts slide in here as they land, usually within a few minutes.', 'gen');
    const later = endState?.next_at ? new Date(endState.next_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
    const why = endState?.why === 'ran recently' ? `Fresh posts were made recently${later ? `; more after ${later}` : ''}.`
      : endState?.why === 'daily limit' ? "That's today's share of fresh posts; more tomorrow morning."
      : endState?.why === 'last run failed' ? "The last run of fresh posts failed; it'll try again in a while."
      : 'Keep scrolling for more from your Brain and your backlog.';
    return (
      <section key="end" data-feed-end="end" style={{ height: '60%', minHeight: 260, scrollSnapAlign: 'start', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 10, padding: 24, color: T.textMuted }}>
        <div style={{ fontSize: 34 }}>🌱</div>
        <div style={{ fontFamily: T.fontDisplay, fontSize: 19, color: T.text, fontWeight: 600 }}>You're all caught up</div>
        <div style={{ fontSize: 13, maxWidth: 400, lineHeight: 1.55 }}>{why}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button onClick={() => topUp({ force: true })} style={{ ...smallBtn, padding: '8px 14px' }}>🔁 Show me more</button>
          <button onClick={async () => { await runRoutine('spark-feed'); setEndState({ phase: 'generating' }); }} style={{ ...smallBtn, padding: '8px 14px', background: T.accent, color: '#fff', border: 'none' }}>✨ Fresh posts now</button>
        </div>
      </section>
    );
  };

  // The practice recorder on a drill or lesson: a measured take is saved on the
  // card as a session; "Did it" without recording still counts as practice.
  const practiceFor = (p, color) => typeof FeedPractice === 'function' ? (
    <FeedPractice p={p} color={color}
      onSaved={async (take) => {
        const r = take ? await react(p, 'session', { text: JSON.stringify(take) }) : await react(p, 'practised');
        if (r && r.ok && !take) flash('Logged. Nice work.');
      }}
      onCoach={async () => { await runRoutine('speech-coach', { post_id: p.id }); flash('Your coach is listening back. Feedback lands as a reply card in a minute or two.'); }} />
  ) : null;

  // A journey lesson: cheat sheet, the exercise with the recorder, a recall
  // question to answer before revealing, and Complete to unlock tomorrow's.
  const lessonBlock = (p) => {
    const L = p.lesson, c = '#4338ca';
    const revealed = !!lessonReveal[p.id];
    const doneKey = `lesson:${L.id}`;
    const completed = !!lessonDone[doneKey];
    return (
      <div style={{ marginTop: 14, display: 'grid', gap: 12 }}>
        {L.source && (
          <div style={{ fontSize: 12.5, color: T.textMuted }}>From <b style={{ color: T.text }}>{L.source.title}</b>{L.source.author ? ` by ${L.source.author}` : ''}{L.source.url && <> · <a href={L.source.url} target="_blank" rel="noopener noreferrer" style={{ color: c }}>open ↗</a></>}</div>
        )}
        {L.cheat.length > 0 && (
          <div style={{ border: `1px solid ${withAlpha(c, 0.25)}`, borderRadius: 14, padding: '10px 14px', background: withAlpha(c, 0.04) }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: c, marginBottom: 6 }}>Cheat sheet</div>
            {L.cheat.map((x, i) => <div key={i} style={{ fontSize: 13.5, lineHeight: 1.5, color: T.text, padding: '3px 0', display: 'flex', gap: 8 }}><span style={{ color: c, fontWeight: 800 }}>{i + 1}</span><span>{x}</span></div>)}
          </div>
        )}
        {L.exercise && (
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: c, marginBottom: 4 }}>Try it · 60 seconds</div>
            <div style={{ fontSize: 14, lineHeight: 1.5, color: T.text, marginBottom: 8 }}>{L.exercise}</div>
            {practiceFor(p, c)}
          </div>
        )}
        {L.question && (
          <div style={{ border: `1px solid ${T.border}`, borderRadius: 14, padding: '10px 14px' }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: c, marginBottom: 4 }}>Recall</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{L.question}</div>
            {revealed ? <div style={{ fontSize: 13.5, color: T.textMuted, marginTop: 6, lineHeight: 1.5 }}>{L.answer}</div>
              : <button onClick={() => setLessonReveal(m => ({ ...m, [p.id]: true }))} style={{ ...smallBtn, marginTop: 8 }}>Say it out loud, then reveal</button>}
          </div>
        )}
        <button disabled={completed} onClick={async () => {
          const r = await api('journey_complete', { journey: L.journey, lesson_id: L.id });
          if (r && !r.error) { setLessonDone(m => ({ ...m, [doneKey]: true })); flash(r.finished ? 'Journey complete. Brilliant work.' : `Day ${L.day} done. Day ${L.day + 1} unlocks tomorrow.`); }
          else if (r && r.error) flash(r.error);
        }} style={{ fontFamily: T.fontBody, fontSize: 14, fontWeight: 700, padding: '11px 16px', borderRadius: 14, border: 'none', cursor: completed ? 'default' : 'pointer', background: completed ? withAlpha('#16a34a', 0.12) : c, color: completed ? '#16a34a' : '#fff' }}>
          {completed ? '✓ Lesson complete · next one tomorrow' : 'Complete lesson'}
        </button>
      </div>
    );
  };

  const card = (p) => {
    // A brief is about the day it was written; a weekly review is good for a week.
    const writtenDay = p.created ? fmtISO(new Date(p.created)) : '';
    const stale = (p.kind === 'brief' && writtenDay !== fmtISO(now)) || (p.kind === 'triage' && now - new Date(p.created) > 7 * 86400000);
    const baseMeta = FEED_KIND_META[p.kind] || FEED_KIND_META.note;
    const meta = stale && p.kind === 'brief' ? { ...baseMeta, label: `Brief · ${shortDate(writtenDay)}` } : baseMeta;
    const parent = p.reply_to && (posts || []).find(x => x.id === p.reply_to);
    const hasFocus = (p.items || []).some(it => it.action === 'focus');
    const body = (p.kind === 'brief' && hasFocus) ? stripTodaysThree(p.body) : p.body;
    const actions = [
      railBtn({ key: 'spark', on: p.reactions.spark, icon: '🔥', label: 'Spark', color: '#c2410c', onClick: () => react(p, 'spark') }),
      railBtn({ key: 'useful', on: p.reactions.useful, icon: '👍', label: 'Useful', color: '#2563eb', onClick: () => react(p, 'useful') }),
      railBtn({ key: 'meh', on: p.reactions.meh, icon: '👎', label: 'Meh', color: '#6b7280', onClick: () => react(p, 'meh') }),
      railBtn({ key: 'save', on: !!p.reactions.saved_slug, icon: '💾', label: 'Save', color: '#15803d', onClick: async () => { const r = await react(p, 'save'); if (r && r.ok) flash('Saved to your Brain Inbox'); } }),
      railBtn({ key: 'reply', on: replyFor === p.id, icon: '💬', label: 'Reply', color: '#7c3aed', onClick: () => { setReplyFor(replyFor === p.id ? null : p.id); setReplyText(''); } }),
      railBtn({ key: 'deeper', on: !!p.reactions.deeper, icon: '🔎', label: 'Deeper', color: '#0e7490', onClick: () => digDeeper(p) }),
    ];
    return (
      <section key={p.id} data-post={p.id} style={{ height: '100%', scrollSnapAlign: 'start', scrollSnapStop: 'always', boxSizing: 'border-box', padding: isMobile ? '3px 0 5px' : '10px 0', display: 'flex', gap: isMobile ? 0 : 14 }}>
        <div style={{ flex: 1, minWidth: 0, height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', background: T.surface, border: `1px solid ${T.border}`, borderRadius: 20, overflow: 'hidden', boxShadow: T.shadowSm }}>
          {hero(p, meta)}
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: isMobile ? '14px 18px 18px' : '18px 24px 24px' }}>
            {stale && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', background: withAlpha('#d97706', 0.08), border: `1px solid ${withAlpha('#d97706', 0.3)}`, borderRadius: 10, padding: '7px 10px', marginBottom: 10, fontSize: 12.5, color: T.text }}>
                <span>🕰 Written {shortDate(writtenDay)}. The items below show where they stand now.</span>
                {p.kind === 'brief' && <button onClick={() => runRoutine('daily-brief')} style={{ ...smallBtn, padding: '2px 9px' }}>☀️ Brief me for today</button>}
              </div>
            )}
            {parent && <div onClick={() => { const el = scrollerRef.current.querySelector(`[data-post="${parent.id}"]`); el && el.scrollIntoView({ behavior: 'smooth' }); }}
              style={{ fontSize: 12, color: T.textMuted, marginBottom: 8, cursor: 'pointer' }}>↩ Deeper on: <u>{parent.title}</u></div>}
            {p.hook && (p.kind === 'book' || p.kind === 'hook') ? (
              <div style={{ marginBottom: 12, padding: '10px 14px', borderLeft: `3px solid ${meta.color}`, background: withAlpha(meta.color, 0.06), borderRadius: '0 12px 12px 0' }}>
                <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: meta.color, marginBottom: 4 }}>🗣 Say it like this</div>
                <div style={{ fontSize: 16, color: T.text, fontWeight: 600, lineHeight: 1.45 }}>“{p.hook.replace(/^["“]|["”]$/g, '')}”</div>
              </div>
            ) : p.hook && <div style={{ fontSize: 15.5, color: T.text, fontWeight: 600, marginBottom: 10, lineHeight: 1.45 }}>{p.hook}</div>}
            {p.kind === 'drill' && practiceFor(p, '#047857')}
            <FeedVisual v={p.visual} color={meta.color} />
            {(p.items || []).length > 0 && itemsBlock(p)}
            {body && <div style={{ fontSize: 14.5, lineHeight: 1.6, color: T.text }}><Md text={feedLinkify(body)} /></div>}
            {p.kind === 'lesson' && p.lesson && lessonBlock(p)}
            {p.sources && p.sources.length > 0 && (
              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {p.sources.map((s, i) => (
                  <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 12, background: T.surface2, border: `1px solid ${T.border}`, textDecoration: 'none', color: T.text }}>
                    <img src={`https://${hostOf(s.url)}/favicon.ico`} alt="" width="18" height="18" style={{ borderRadius: 4, flexShrink: 0 }} onError={e => { e.currentTarget.style.visibility = 'hidden'; }} />
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: 'block', fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title || s.url}</span>
                      <span style={{ display: 'block', fontSize: 11, color: T.textFaint }}>{hostOf(s.url)}</span>
                    </span>
                    <span style={{ color: meta.color, fontSize: 15 }}>↗</span>
                  </a>
                ))}
              </div>
            )}
            {/* What this post does to your Brain: the linker's typed links, with why. */}
            {(p.brain_links || []).length > 0 && typeof BRAIN_REL_META !== 'undefined' && (
              <div style={{ marginTop: 14, border: `1px solid ${T.border}`, borderRadius: 14, overflow: 'hidden' }}>
                <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: T.textFaint, padding: '8px 12px 2px' }}>🧠 What this does to your Brain</div>
                {p.brain_links.map(c => {
                  const m = BRAIN_REL_META[c.type] || BRAIN_REL_META.supports;
                  return (
                    <a key={c.id} href={`#brain=${encodeURIComponent(c.other.ref)}`} style={{ display: 'block', textDecoration: 'none', padding: '7px 12px 9px', borderTop: `1px solid ${withAlpha(T.border, 0.6)}` }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: m.color, background: withAlpha(m.color, 0.1), borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap' }}>{m.icon} {c.verb}</span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.other.title}</span>
                      </div>
                      <div style={{ fontSize: 12.5, color: T.textMuted, lineHeight: 1.45, marginTop: 3 }}>{c.insight}</div>
                    </a>
                  );
                })}
              </div>
            )}
            {((p.notes || []).length > 0 || (p.tags || []).length > 0) && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
                {(p.notes || []).map(n => <a key={n} href={`#brain=${encodeURIComponent(n)}`} style={{ ...chip(false, '#15803d'), textDecoration: 'none' }}>🧠 {n}</a>)}
                {(p.tags || []).map(t => <span key={t} style={{ ...chip(false), cursor: 'default' }}>#{t}</span>)}
              </div>
            )}
            {(p.reactions.replies || []).length > 0 && (
              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {p.reactions.replies.map((r, i) => {
                  const mine = r.from !== 'claude';
                  return (
                    <div key={i} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '86%', fontSize: 13.5, lineHeight: 1.45, color: mine ? '#fff' : T.text,
                      background: mine ? '#7c3aed' : T.surface2, border: mine ? 'none' : `1px solid ${T.border}`, borderRadius: mine ? '14px 14px 4px 14px' : '14px 14px 14px 4px', padding: '7px 11px', whiteSpace: 'pre-wrap' }}>
                      {!mine && <div style={{ fontSize: 10.5, fontWeight: 700, color: '#7c3aed', marginBottom: 2 }}>Claude</div>}
                      {r.text}
                    </div>
                  );
                })}
              </div>
            )}
            {waiting[p.id] && (
              <div style={{ marginTop: 6, alignSelf: 'flex-start', fontSize: 12.5, color: '#7c3aed', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#7c3aed', animation: 'feedPulse 1.2s ease-in-out infinite' }} /> Claude is on it…
              </div>
            )}
            {replyFor === p.id && (
              <div style={{ marginTop: 10, background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 14, padding: 8 }}>
                <div style={{ display: 'flex', gap: 5, overflowX: 'auto', paddingBottom: 6 }}>
                  {REPLY_PRESETS.map(t => <button key={t} onClick={() => sendReply(p, t)} style={{ ...chip(false, '#7c3aed'), whiteSpace: 'nowrap', flexShrink: 0 }}>{t}</button>)}
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
                  <textarea autoFocus rows={2} value={replyText} onChange={e => setReplyText(e.target.value)}
                    placeholder="Tell Claude what to change or ask…"
                    onFocus={e => { const el = e.currentTarget; setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250); }}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(p); } if (e.key === 'Escape') setReplyFor(null); }}
                    style={{ flex: 1, minWidth: 0, resize: 'none', background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: '8px 10px', fontFamily: T.fontBody, fontSize: 16, lineHeight: 1.35, color: T.text, outline: 'none' }} />
                  <button onClick={() => sendReply(p)} disabled={!replyText.trim()} style={{ ...smallBtn, background: '#7c3aed', color: '#fff', border: 'none', padding: '9px 14px', opacity: replyText.trim() ? 1 : 0.5 }}>Send</button>
                </div>
                <div style={{ fontSize: 11, color: T.textFaint, marginTop: 5 }}>Claude answers here, and can change what your feed shows from now on.</div>
              </div>
            )}
            {p.reactions.deeper && !p.reactions.deeper.done_at && <div style={{ marginTop: 10, fontSize: 12.5, color: '#0e7490' }}>🔎 Digging deeper… the follow-up will appear in the feed.</div>}
            {p.reactions.saved_slug && <div style={{ marginTop: 10, fontSize: 12.5 }}><a href={`#brain=${encodeURIComponent(p.reactions.saved_slug)}`} style={{ color: '#15803d' }}>💾 Saved to your Brain Inbox</a></div>}
            <div style={{ marginTop: 12, fontSize: 10.5, color: T.textFaint, fontFamily: T.fontMono }}>by {p.source}</div>
          </div>
          {/* Phones: the reactions sit in a bar along the bottom of the card, so the post gets the full width. */}
          {isMobile && <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'space-around', borderTop: `1px solid ${T.border}`, padding: '2px 4px', background: T.surface }}>{actions}</div>}
        </div>
        {!isMobile && <div style={{ width: 56, flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 8, paddingBottom: 6 }}>{actions}</div>}
      </section>
    );
  };

  const filters = [['all', 'All'], ['unseen', `Unseen${counts.unseen ? ` ${counts.unseen}` : ''}`], ['growth', '🎯 Growth'], ['sparked', '🔥 Sparked'], ['saved', '💾 Saved'], ['deeper', '🔎 Waiting']];

  return (
    // Phones: the feed is its own full-screen layer (inside the notch and home
    // bar), with a back button, instead of sliding the page under the status bar.
    <div style={isMobile ? { position: 'fixed', inset: 0, zIndex: 60, background: T.bg, display: 'flex', flexDirection: 'column', boxSizing: 'border-box',
        padding: 'calc(6px + env(safe-area-inset-top, 0px)) 8px calc(4px + env(safe-area-inset-bottom, 0px))' }
      : { maxWidth: 900, margin: '0 auto', position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: isMobile ? 'nowrap' : 'wrap', marginBottom: isMobile ? 6 : 8, padding: isMobile ? '0 4px' : 0 }}>
        {isMobile && onExit && (
          <button onClick={onExit} aria-label="Leave the feed" title="Back to Today"
            style={{ ...smallBtn, height: 34, padding: '0 12px 0 8px', borderRadius: 999, display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 14, fontWeight: 600 }}>
            <span style={{ fontSize: 20, lineHeight: 1, marginTop: -2 }}>‹</span> Today
          </button>
        )}
        {!isMobile && <h2 style={{ fontFamily: T.fontDisplay, fontSize: 26, margin: 0, color: T.text }}>Feed</h2>}
        <button onClick={refresh} title="Refresh (r)" aria-label="Refresh the feed"
          style={{ ...smallBtn, width: 32, height: 32, padding: 0, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>
          <span style={{ display: 'inline-block', transition: 'transform 0.6s ease', transform: refreshing ? 'rotate(360deg)' : 'none' }}>↻</span>
        </button>
        <span style={{ flex: 1 }} />
        {(running || queued.length > 0) ? (
          <span style={{ fontSize: 12, color: T.accent, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: T.accent, animation: 'feedPulse 1.2s ease-in-out infinite' }} />
            {running ? `Making posts (${running.name})` : ''}{queued.length ? ` · ${queued.length} queued` : ''}
          </span>
        ) : (
          <>
            <button onClick={() => window.dispatchEvent(new CustomEvent('todouz-share-open'))} style={smallBtn} title="Share a reel, video, post or link for the Brain to file" aria-label="Share a link">{isMobile ? '📥' : '📥 Share'}</button>
            <button onClick={() => runRoutine('daily-brief')} style={smallBtn} title="Write today's focus brief now">{isMobile ? '☀️ Brief' : '☀️ Brief me'}</button>
            <button onClick={() => runRoutine('spark-feed')} style={smallBtn} title="Generate new posts now">{isMobile ? '✨ New' : '✨ New posts'}</button>
            <button onClick={() => runRoutine('growth-feed')} style={smallBtn} title="Book ideas, conversation hooks and a speaking drill for today">{isMobile ? '🎯' : '🎯 Grow'}</button>
          </>
        )}
      </div>
      <style>{'@keyframes feedPulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.35; transform: scale(0.75); } } @keyframes feedShimmer { from { background-position: 120% 0; } to { background-position: -120% 0; } }'}</style>
      {(routines?.routines || []).some(r => r.last_status === 'error' && /login|authenticat|oauth/i.test(r.last_error || '')) && (
        <div style={{ background: withAlpha(T.overdue, 0.07), border: `1px solid ${withAlpha(T.overdue, 0.35)}`, borderRadius: 12, padding: '10px 12px', marginBottom: 8, fontSize: 13, lineHeight: 1.5, color: T.text }}>
          <b>Routines can't run: the server's Claude login has expired.</b> Run <code>claude setup-token</code> on a machine signed in to your Max account, set the token as <code>CLAUDE_CODE_OAUTH_TOKEN</code> on the todouz app in Dokploy and redeploy. Or switch Settings → AI agent to an Anthropic API key.
        </div>
      )}
      <div style={{ display: 'flex', gap: 5, overflowX: 'auto', paddingBottom: isMobile ? 4 : 6, marginBottom: isMobile ? 2 : 4, padding: isMobile ? '0 4px 4px' : undefined, flexShrink: 0, scrollbarWidth: 'none' }}>
        {filters.map(([k, l]) => <button key={k} onClick={() => setFilter(k)} style={chip(filter === k)}>{l}</button>)}
      </div>
      <div style={{ position: 'relative', ...(isMobile ? { flex: 1, minHeight: 0 } : {}) }}>
        {newCount > 0 && (
          <button onClick={showNew} style={{ position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)', zIndex: 5, background: T.accent, color: '#fff', border: 'none', borderRadius: 999,
            padding: '8px 16px', fontFamily: T.fontBody, fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: T.shadowLg }}>
            ↑ {newCount} new post{newCount > 1 ? 's' : ''}
          </button>
        )}
        {/* Full-screen height. Scrolling into the feed slides the page so the feed
            fills the screen (header and toolbar scroll away); scrolling up past the
            first card brings them back. */}
        <div ref={scrollerRef} onScroll={e => { nearEnd(e.currentTarget); fillScreen(e.currentTarget); }}
          style={{ height: isMobile ? '100%' : 'calc(100vh - 12px)', minHeight: isMobile ? 0 : 420, overflowY: 'auto', scrollSnapType: 'y mandatory', overscrollBehavior: isMobile ? 'contain' : 'auto' }}>
          {filter === 'all' && nowCard()}
          {posts == null ? (
            <div style={{ padding: 30, color: T.textFaint, fontSize: 13 }}>loading…</div>
          ) : posts.length === 0 ? (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 12, padding: 24, color: T.textMuted }}>
              <div style={{ fontSize: 36 }}>✨</div>
              <div style={{ fontFamily: T.fontDisplay, fontSize: 20, color: T.text, fontWeight: 600 }}>{filter === 'all' ? 'Nothing in your feed yet' : 'Nothing here'}</div>
              {filter === 'all' && <>
                <div style={{ fontSize: 13.5, maxWidth: 420, lineHeight: 1.55 }}>Your brief arrives every morning at 06:30 and new posts at 07:00, made from your Brain, your items and the news in your fields. Start one now:</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => runRoutine('daily-brief')} style={{ ...smallBtn, padding: '8px 14px' }}>☀️ Brief me now</button>
                  <button onClick={() => runRoutine('spark-feed')} style={{ ...smallBtn, padding: '8px 14px', background: T.accent, color: '#fff', border: 'none' }}>✨ Generate posts</button>
                </div>
              </>}
            </div>
          ) : <>{posts.map(p => card(p))}{feedEnd()}</>}
        </div>
      </div>
      {!isMobile && posts && posts.length > 1 && <div style={{ fontSize: 11, color: T.textFaint, textAlign: 'center', marginTop: 6 }}>j / k or ↑ ↓ to move · r to refresh · new posts appear on their own</div>}
      {toast && <div style={{ position: 'fixed', left: '50%', bottom: isMobile ? 'calc(84px + env(safe-area-inset-bottom, 0px))' : 28, transform: 'translateX(-50%)', background: T.text, color: '#fff', padding: '9px 16px', borderRadius: 999, fontSize: 13, boxShadow: T.shadowLg, zIndex: 300, maxWidth: '90vw' }}>{toast}</div>}
    </div>
  );
}

// ─── Share to todouz ────────────────────────────────────────────────
// Opened by the phone's share sheet (manifest share_target → /dashboard/?share_url=…)
// or the feed's "📥 Share" button. Saving is instant; the share-digest routine
// then reads the post, verifies any tools it recommends, files them against the
// right projects and posts a "You shared" card to the feed.
const SHARE_MODE_META = [
  { id: 'auto',  icon: '🧠', label: 'Auto',  blurb: 'Let the Brain decide' },
  { id: 'tools', icon: '🧰', label: 'Tools', blurb: 'Find the tools it recommends, check them, file them under my projects' },
  { id: 'learn', icon: '📚', label: 'Learn', blurb: 'Distil the idea into a Brain note' },
  { id: 'save',  icon: '📌', label: 'Keep',  blurb: 'Just keep it, with a short summary' },
];
const SHARE_PLATFORM_ICON = { instagram: '📸', youtube: '▶️', facebook: '👥', threads: '🧵', x: '𝕏', linkedin: '💼', tiktok: '🎵', reddit: '👽', github: '🐙', web: '🔗', text: '📝' };

function ShareSheet({ initial = {}, onClose }) {
  const firstUrl = (...xs) => { for (const x of xs) { const m = /https?:\/\/[^\s<>"']+/i.exec(String(x || '')); if (m) return m[0]; } return ''; };
  const [link, fSetLink] = fUseState(() => firstUrl(initial.url, initial.text, initial.title) || initial.text || '');
  const [note, setNote] = fUseState('');
  const [mode, setMode] = fUseState('auto');
  const [busy, setBusy] = fUseState(false);
  const [msg, setMsg] = fUseState(null);
  const [recent, setRecent] = fUseState(null);
  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  const { inset: kbInset, availH } = useKeyboardInset();
  // What the sharing app sent besides the link (often the caption), minus the link itself.
  const extra = [initial.title, initial.text].map(t => String(t || '').replace(/https?:\/\/[^\s<>"']+/gi, '').trim()).filter(Boolean).join('\n');

  const loadRecent = fUseCallback(async () => {
    try { const r = await fetch('/api/share_list?status=all&limit=8').then(x => x.json()); setRecent(r.shares || []); } catch { setRecent([]); }
  }, []);
  fUseEffect(() => { loadRecent(); }, [loadRecent]);
  fUseEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const post = async (path, body) => {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  };
  const save = async (e) => {
    e && e.preventDefault();
    if (!link.trim() && !note.trim()) { setMsg({ err: true, text: 'Paste a link first.' }); return; }
    setBusy(true); setMsg(null);
    try {
      await post('/api/share', { url: link.trim(), text: extra || undefined, note: note.trim() || undefined, mode });
      setMsg({ text: 'Saved. The Brain is on it; a "You shared" card will land in your feed.' });
      setNote(''); fSetLink('');
      loadRecent();
      setTimeout(onClose, 1600);
    } catch (err) { setMsg({ err: true, text: err.message }); }
    setBusy(false);
  };
  const retry = async (s) => {
    try { await post('/api/share/retry', { id: s.id, note: note.trim() || undefined }); setNote(''); setMsg({ text: 'Trying again.' }); loadRecent(); }
    catch (err) { setMsg({ err: true, text: err.message }); }
  };

  const sheetStyle = isMobile ? {
    position: 'fixed', left: 0, right: 0, bottom: kbInset, boxSizing: 'border-box', background: T.surface,
    borderTop: `1px solid ${T.border}`, borderRadius: '16px 16px 0 0', boxShadow: T.shadowLg, zIndex: 221,
    display: 'flex', flexDirection: 'column', maxHeight: kbInset ? Math.max(300, availH - 8) : '86dvh', overflow: 'hidden',
  } : {
    position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 'min(520px, 92vw)',
    background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, boxShadow: T.shadowLg, zIndex: 221,
    display: 'flex', flexDirection: 'column', maxHeight: 'min(88vh, 680px)', overflow: 'hidden',
  };
  const pad = isMobile ? '0 16px' : '0 22px';
  const statusChip = (s) => {
    const c = s.status === 'done' ? T.done : s.status === 'failed' ? T.overdue : T.accent;
    const label = s.status === 'done' ? 'Filed' : s.status === 'failed' ? 'Stuck' : 'Working…';
    return <span style={{ fontSize: 11, fontWeight: 700, color: c, background: withAlpha(c, 0.1), borderRadius: 999, padding: '2px 8px', flexShrink: 0 }}>{label}</span>;
  };

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(26,23,20,0.32)', zIndex: 220 }} />
      <form onSubmit={save} style={sheetStyle} onClick={e => e.stopPropagation()}>
        <div style={{ padding: isMobile ? '14px 16px 8px' : '20px 22px 10px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>📥</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: T.fontDisplay, fontSize: 19, fontWeight: 600, color: T.text }}>Share to todouz</div>
            <div style={{ fontSize: 12.5, color: T.textMuted }}>A reel, video, post or article. The Brain reads it and files what's useful.</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: 22, color: T.textFaint, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ padding: pad, overflowY: 'auto', flex: 1 }}>
          <label style={modalLabel()}>Link</label>
          <input value={link} onChange={e => fSetLink(e.target.value)} placeholder="https://www.instagram.com/reel/…" inputMode="url" autoFocus={!link} style={modalInput()} />
          {extra && <div style={{ fontSize: 12, color: T.textMuted, marginTop: 6, whiteSpace: 'pre-wrap', maxHeight: 60, overflow: 'hidden' }}>{extra}</div>}
          <label style={{ ...modalLabel(), marginTop: 14 }}>What should the Brain do?</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
            {SHARE_MODE_META.map(m => (
              <button type="button" key={m.id} onClick={() => setMode(m.id)} title={m.blurb} style={{
                padding: '9px 4px', borderRadius: 10, cursor: 'pointer', fontFamily: T.fontBody, fontSize: 13, fontWeight: 600,
                background: mode === m.id ? withAlpha(T.accent, 0.1) : T.surface2, color: mode === m.id ? T.accent : T.text,
                border: `1px solid ${mode === m.id ? withAlpha(T.accent, 0.5) : T.border}`,
              }}><div style={{ fontSize: 18 }}>{m.icon}</div>{m.label}</button>
            ))}
          </div>
          <div style={{ fontSize: 12, color: T.textMuted, marginTop: 6 }}>{SHARE_MODE_META.find(m => m.id === mode).blurb}</div>
          <label style={{ ...modalLabel(), marginTop: 14 }}>Note (optional)</label>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="e.g. the second skill they mention, for todouz" style={{ ...modalInput(), fontFamily: T.fontBody, resize: 'vertical' }} />
          {msg && <div style={{ fontSize: 13, marginTop: 10, color: msg.err ? T.overdue : T.done }}>{msg.text}</div>}
          {recent && recent.length > 0 && (
            <div style={{ marginTop: 18, marginBottom: 12 }}>
              <div style={modalLabel()}>Recent shares</div>
              {recent.map(s => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderTop: `1px solid ${T.border}`, fontSize: 13 }}>
                  <span style={{ width: 20, textAlign: 'center' }}>{SHARE_PLATFORM_ICON[s.platform] || '🔗'}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: T.text }}>{s.meta?.title || s.title || s.url || s.note}</span>
                    {s.result?.summary && <span style={{ display: 'block', fontSize: 11.5, color: T.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.result.summary}</span>}
                  </span>
                  {s.status === 'done' && s.result?.post_id && <a href={`#feed=${s.result.post_id}`} onClick={onClose} style={{ fontSize: 12, color: T.accent }}>Open</a>}
                  {s.status === 'failed' && <button type="button" onClick={() => retry(s)} title="Try again, with the note above if you wrote one" style={{ fontSize: 12, color: T.accent, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Retry</button>}
                  {statusChip(s)}
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ padding: isMobile ? '0 16px' : '0 22px 6px' }}><FormFooter primary="Save" busy={busy} onCancel={onClose} /></div>
      </form>
    </>
  );
}

Object.assign(window, { FeedSection, ShareSheet });
