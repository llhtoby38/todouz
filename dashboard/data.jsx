// data.jsx — top-level data hook + shared helpers (dates, fetch).
// Reads from the same /api/* endpoints that any external Claude session would.

const { useState, useEffect, useMemo, useCallback, useRef } = React;

// ─── date helpers ─────────────────────────────────────────────────────
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function fmtISO(d) {
  if (!d) return '';
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
function parseISODate(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3])) : null;
}
function diffDays(a, b) {
  return Math.round((startOfDay(a) - startOfDay(b)) / 86400000);
}
function dayName(d) { return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]; }
function fmtLong(d) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${dayName(d)} ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

// ─── theme tokens ────────────────────────────────────────────────────
// Single source of truth for visual constants. CSS vars are defined in index.html;
// these mirror them as JS strings so inline styles can use them too. Keep both in sync.
const T = {
  bg:           'var(--bg)',
  surface:      'var(--surface)',
  surface2:     'var(--surface-2)',
  surfaceHover: 'var(--surface-hover)',
  text:         'var(--text)',
  textMuted:    'var(--text-muted)',
  textFaint:    'var(--text-faint)',
  border:       'var(--border)',
  borderStrong: 'var(--border-strong)',
  accent:       'var(--accent)',
  accentSoft:   'var(--accent-soft)',
  done:         'var(--done)',
  overdue:      'var(--overdue)',
  warning:      'var(--warning)',
  fontDisplay:  'var(--font-display)',
  fontBody:     'var(--font-body)',
  fontMono:     'var(--font-mono)',
  shadowSm:     'var(--shadow-sm)',
  shadow:       'var(--shadow)',
  shadowLg:     'var(--shadow-lg)',
};

// Category palette — concrete hex strings since we mix opacity programmatically.
const CATEGORY_COLOR = {
  work:      '#1e3a8a',
  projects:  '#6b21a8',
  learning:  '#0e7490',
  health:    '#15803d',
  home:      '#a16207',
  personal:  '#475569',
};

// Per-folder accents beyond the category default. Prefer setting `color:` in a
// folder's epic.md frontmatter (or the colour picker); this map is a code-level fallback.
const TAG_COLOR_OVERRIDES = {};

function categoryColor(c) { return CATEGORY_COLOR[c] || '#475569'; }

// User-set per-folder colours (epic.md frontmatter `color`), keyed by epic slug.
// Populated from list_epics so a custom colour wins over the category default on
// the calendar/plan blocks and list accents everywhere epicColor() is used.
const EPIC_COLORS = {};
function registerEpicColors(epics) {
  for (const e of (epics || [])) {
    if (!e || !e.slug) continue;
    if (e.color) EPIC_COLORS[e.slug] = e.color; else delete EPIC_COLORS[e.slug];
  }
}
function epicColor(epicSlug, category) {
  if (!epicSlug) return categoryColor(category);
  if (EPIC_COLORS[epicSlug]) return EPIC_COLORS[epicSlug];
  const short = epicSlug.split('/')[1] || '';
  return TAG_COLOR_OVERRIDES[short.toLowerCase()] || categoryColor(category);
}
// A curated palette for the folder colour picker — distinct, warm-theme-friendly.
const FOLDER_PALETTE = [
  '#1e3a8a', '#0e7490', '#0f766e', '#15803d', '#4d7c0f',
  '#a16207', '#b45309', '#c2410c', '#b91c1c', '#9f1239',
  '#a21caf', '#6b21a8', '#4338ca', '#475569', '#334155',
];

// Add transparency to a hex colour. Used for subtle background washes per category.
function withAlpha(color, alpha) {
  const m = String(color).replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (m) {
    const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
    return `#${m[1]}${m[2]}${m[3]}${a}`;
  }
  // CSS vars ("var(--accent)") / named colours can't be sliced — mix toward
  // transparent so the alpha still applies. Without this the regex missed and
  // we returned the SOLID colour (accent tints rendered fully saturated).
  return `color-mix(in srgb, ${color} ${Math.round(alpha * 100)}%, transparent)`;
}

// Section header style (the "TODAY" / "THIS WEEK" / etc. small-caps overlines).
const SECTION_LABEL = {
  fontFamily: T.fontBody,
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: T.textFaint,
  marginBottom: 10,
  marginTop: 24,
};

// ─── fetch wrappers ──────────────────────────────────────────────────
// ─── offline layer ────────────────────────────────────────────────────
// Every data call funnels through api(). Online it behaves as before AND caches
// read results. Offline (fetch rejects / navigator.offline) reads return the
// last cached result, and writes are queued + optimistically applied locally,
// then replayed on reconnect (last-write-wins). See sw.js for the app shell.
const OFFLINE = { online: (typeof navigator !== 'undefined') ? navigator.onLine : true, pending: 0, syncing: false };
const isReadTool = (t) => /^(list_|get_|read_|search|brain_(search|read|context|history|links)$)/.test(t);
function lsGet(k) { try { const v = localStorage.getItem(k); return v == null ? undefined : JSON.parse(v); } catch { return undefined; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return String(h); }
const rcKey = (tool, args) => `tz.rc.${tool}.${hashStr(JSON.stringify(args || {}))}`;
const QKEY = 'tz.queue';
function getQueue() { return lsGet(QKEY) || []; }
function setQueue(q) { lsSet(QKEY, q); OFFLINE.pending = q.length; emitOffline(); }
function emitOffline() { try { window.dispatchEvent(new CustomEvent('tz-offline', { detail: { ...OFFLINE } })); } catch {} }
function looksOffline(e) {
  return (typeof navigator !== 'undefined' && !navigator.onLine) || /Failed to fetch|NetworkError|Load failed|ERR_INTERNET/i.test(String(e && e.message));
}
// Optimistically reflect a queued write in the cached reads the UI re-reads —
// scoped to the shopping-list flow (tick / add / complete an item).
function applyOptimistic(tool, args) {
  if (!['toggle_subtask', 'add_subtask', 'complete_issue', 'reopen_issue'].includes(tool)) return;
  const key = rcKey('get_issue', { id: args.id, epic: args.epic });
  const g = lsGet(key);
  if (!g) return;
  if (tool === 'toggle_subtask') {
    const st = (g.subtasks || []).find((s) => s.text === args.subtask_text);
    if (st) st.done = (args.done != null) ? !!args.done : !st.done;
  } else if (tool === 'add_subtask') {
    g.subtasks = g.subtasks || []; g.subtasks.push({ text: args.text, done: false });
  } else if (tool === 'complete_issue') { g.is_completed = true; if (g.fields) g.fields.status = 'completed'; }
  else if (tool === 'reopen_issue') { g.is_completed = false; if (g.fields) g.fields.status = 'open'; }
  lsSet(key, g);
}
async function syncQueue() {
  if (OFFLINE.syncing) return;
  let q = getQueue();
  if (!q.length) return;
  OFFLINE.syncing = true; emitOffline();
  try {
    while (q.length) {
      const op = q[0];
      let r;
      try {
        r = await fetch(`/api/${op.tool}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(op.args) });
      } catch (e) { break; }               // network died again — keep the rest queued
      if (!r.ok && (r.status >= 500 || r.status === 0)) break;   // transient server issue → retry later
      q.shift(); setQueue(q);              // 2xx OR a hard 4xx (item gone) → drop the op (last-write-wins / best effort)
      q = getQueue();
    }
  } finally {
    OFFLINE.syncing = false; emitOffline();
    try { window.dispatchEvent(new CustomEvent('tz-synced')); } catch {}
  }
}
if (typeof window !== 'undefined') {
  OFFLINE.pending = getQueue().length;
  window.addEventListener('online', () => { OFFLINE.online = true; emitOffline(); syncQueue(); });
  window.addEventListener('offline', () => { OFFLINE.online = false; emitOffline(); });
  if (navigator.onLine) setTimeout(syncQueue, 1500);   // flush anything left from a previous offline session
}

const api = async (tool, args = {}) => {
  const write = !isReadTool(tool);
  try {
    const r = await fetch(`/api/${tool}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    if (!r.ok) throw new Error(`${tool}: ${r.status}`);
    const data = await r.json();
    if (!write) lsSet(rcKey(tool, args), data);
    if (!OFFLINE.online) { OFFLINE.online = true; emitOffline(); syncQueue(); }
    return data;
  } catch (e) {
    if (looksOffline(e)) {
      if (OFFLINE.online) { OFFLINE.online = false; emitOffline(); }
      if (write) {
        const q = getQueue(); q.push({ tool, args, ts: Date.now() }); setQueue(q);
        applyOptimistic(tool, args);
        return { ok: true, _offline: true };
      }
      const cached = lsGet(rcKey(tool, args));
      if (cached !== undefined) return cached;
    }
    throw e;
  }
};

function useOfflineStatus() {
  const [s, setS] = useState({ online: OFFLINE.online, pending: OFFLINE.pending, syncing: OFFLINE.syncing });
  useEffect(() => {
    const on = () => setS({ online: OFFLINE.online, pending: OFFLINE.pending, syncing: OFFLINE.syncing });
    window.addEventListener('tz-offline', on);
    return () => window.removeEventListener('tz-offline', on);
  }, []);
  return s;
}

// Small header chip: green (online) · amber (online, changes queued) · red (offline).
function OfflineIndicator() {
  const { online, pending, syncing } = useOfflineStatus();
  const color = !online ? '#c4593c' : (pending ? '#a16207' : '#15803d');
  const dot = syncing ? '⟳' : (online ? '●' : '⚡');
  const title = syncing ? `Syncing ${pending} change${pending === 1 ? '' : 's'}…`
    : online ? (pending ? `Online · ${pending} change${pending === 1 ? '' : 's'} to sync` : 'Online')
    : `Offline${pending ? ` · ${pending} change${pending === 1 ? '' : 's'} queued` : ' — changes will sync when reconnected'}`;
  return (
    <span title={title} aria-label={title} style={{
      display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 12,
      color, fontFamily: T.fontMono, userSelect: 'none',
    }}>
      <span style={{ fontSize: 10 }}>{dot}</span>
      {pending > 0 && <span style={{ fontSize: 10, fontWeight: 700 }}>{pending}</span>}
    </span>
  );
}

// ─── master data hook ─────────────────────────────────────────────────
function useDashboardData() {
  const today = startOfDay(new Date());
  const todayISO = fmtISO(today);

  const [state, setState] = useState({
    loading: true,
    today: null,
    upcoming: null,
    epics: null,
    events: null,
    error: null,
    todayDate: today,
    todayISO,
    // Monotonic version, bumped on every completed fetch. Components that keep
    // their own slice of the data (IssuesSection, EpicCard) key their refetch
    // off this. They used to key off counts — epic count, open_issue_count —
    // which silently miss any edit that doesn't change a count, so retagging an
    // issue left every filter reading the pre-edit tags.
    tick: 0,
  });

  const fetchAll = useCallback(async () => {
    try {
      // Recompute "today" on every fetch — previously it was captured once in
      // useState initial and never moved, so a dashboard left open across
      // midnight kept the prior day's value (and hid items "before today").
      const nowDate = startOfDay(new Date());
      const nowISO = fmtISO(nowDate);
      // 42 days = 6 weeks → covers the entire CalendarMonth grid + WeekStrip + Up-next
      // in a single fetch. WeekStrip slices the first 7. Previously days:7 left every
      // calendar cell past day 7 blank even when items existed for those dates.
      const [today, upcoming, epics, events, overdue, pinned] = await Promise.all([
        api('list_today'),
        api('list_upcoming', { days: 42 }),
        api('list_epics'),
        api('list_events', { from_date: nowISO, to_date: fmtISO(new Date(nowDate.getTime() + 60 * 86400000)) }),
        api('list_overdue', { limit: 50 }),
        api('list_issues', { status: 'open', pinned: true }),
      ]);
      registerEpicColors(epics.epics || []);   // per-folder colour overrides → epicColor()
      setState(s => ({ ...s, loading: false, today, upcoming, epics, events, overdue, pinned: pinned.issues || [], error: null, todayDate: nowDate, todayISO: nowISO, tick: s.tick + 1 }));
    } catch (e) {
      setState(s => ({ ...s, loading: false, error: String(e?.message || e) }));
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Refetch on tab focus — useful when an external Claude session has written to data files.
  useEffect(() => {
    const onFocus = () => fetchAll();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [fetchAll]);

  // After the offline write-queue drains on reconnect, pull the canonical state.
  useEffect(() => {
    const onSynced = () => fetchAll();
    window.addEventListener('tz-synced', onSynced);
    return () => window.removeEventListener('tz-synced', onSynced);
  }, [fetchAll]);

  // Auto-refresh once an hour so a dashboard left open across midnight rolls
  // over to the new day without needing a manual reload or tab-focus event.
  useEffect(() => {
    const t = setInterval(fetchAll, 60 * 60 * 1000);
    return () => clearInterval(t);
  }, [fetchAll]);

  return { ...state, refetch: fetchAll };
}

// ─── responsive helper ────────────────────────────────────────────────
// Live matchMedia hook — components branch on it for the phone layout.
// 768px covers phones + small tablets in portrait.
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 768px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const onChange = (e) => setIsMobile(e.matches);
    mq.addEventListener ? mq.addEventListener('change', onChange) : mq.addListener(onChange);
    return () => { mq.removeEventListener ? mq.removeEventListener('change', onChange) : mq.removeListener(onChange); };
  }, []);
  return isMobile;
}

// Drawers cover the whole viewport on a phone, which buried the top nav — with
// an issue open there was no way to reach chat, +New or Select without closing
// it first. They now start below the header instead. Measured rather than
// hardcoded: header height moves with the mobile/desktop branch and settles
// again once the webfont lands.
function useHeaderOffset() {
  const isMobile = useIsMobile();
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    if (!isMobile) { setOffset(0); return; }
    const measure = () => {
      const el = document.querySelector('header');
      setOffset(el ? Math.round(el.getBoundingClientRect().height) : 0);
    };
    measure();
    const t = setTimeout(measure, 400);        // re-measure after fonts settle
    window.addEventListener('resize', measure);
    if (document.fonts?.ready) document.fonts.ready.then(measure).catch(() => {});
    return () => { clearTimeout(t); window.removeEventListener('resize', measure); };
  }, [isMobile]);
  return offset;
}

// ─── selection serialisation ──────────────────────────────────────────
// One place that knows how to describe a picked thing to the agent. Shared by
// the clipboard's Copy button and the chat composer's context attachments, so
// the two can't drift apart.
function selectionLine(s) {
  if (s.kind === 'issue') return `- issue ${s.epic_slug}/${s.id}${s.label ? ` — ${s.label}` : ''}`;
  if (s.kind === 'epic') return `- epic ${s.slug}${s.label ? ` — ${s.label}` : ''}`;
  if (s.kind === 'date') return `- date ${s.date}`;
  if (s.kind === 'slot') return `- time slot ${s.date} ${s.time}${s.endTime ? `–${s.endTime}` : ''}`;
  if (s.kind === 'block') return `- timeblock ${s.id}${s.label ? ` — ${s.label}` : ''}`;
  if (s.kind === 'subtask') return `- subtask ${s.epic_slug}/${s.id} — ${s.text}${s.done ? ' (done)' : ''}`;
  return `- ${s.kind} ${JSON.stringify(s)}`;
}
function serializeSelection(items) {
  const list = (items || []).filter(Boolean);
  if (!list.length) return '';
  return `[TODOUZ SELECTION]\n${list.map(selectionLine).join('\n')}\n[END TODOUZ SELECTION]`;
}
// Short human label for an attachment chip — the item's own identity, never its
// parent's (a checklist item's label is the issue it lives in).
function selectionChipLabel(s) {
  if (!s) return '';
  if (s.kind === 'subtask') return s.text || '';
  if (s.kind === 'date') return s.date || '';
  if (s.kind === 'slot') return `${s.time || ''}${s.endTime ? `–${s.endTime}` : ''}`;
  return s.label || s.id || s.slug || '';
}

// Expose to other dashboard modules
Object.assign(window, {
  useDashboardData, api, useIsMobile, useHeaderOffset,
  selectionLine, serializeSelection, selectionChipLabel,
  startOfDay, fmtISO, parseISODate, diffDays, dayName, fmtLong,
  categoryColor, epicColor, withAlpha, CATEGORY_COLOR, TAG_COLOR_OVERRIDES,
  registerEpicColors, EPIC_COLORS, FOLDER_PALETTE,
  T, SECTION_LABEL,
});
