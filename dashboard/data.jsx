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
  studies:           '#1e3a8a',
  'side-project':    '#6b21a8',
  body:              '#15803d',
  kitchen:           '#a16207',
  'future-planning': '#9f1239',
  personal:          '#475569',
};

// Subject-specific accents (only override the category default when a subject has its own identity).
const TAG_COLOR_OVERRIDES = {
  swen90017: '#1e40af',
  swen90010: '#0e7490',
  comp90090: '#7c3aed',
  engr90026: '#b45309',
  gym:       '#15803d',
  travel:    '#9f1239',
};

function categoryColor(c) { return CATEGORY_COLOR[c] || '#475569'; }
function epicColor(epicSlug, category) {
  if (!epicSlug) return categoryColor(category);
  const short = epicSlug.split('/')[1] || '';
  return TAG_COLOR_OVERRIDES[short.toLowerCase()] || categoryColor(category);
}

// Add transparency to a hex colour. Used for subtle background washes per category.
function withAlpha(hex, alpha) {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return hex;
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return `#${m[1]}${m[2]}${m[3]}${a}`;
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
const api = async (tool, args = {}) => {
  const r = await fetch(`/api/${tool}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(`${tool}: ${r.status}`);
  return r.json();
};

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
  });

  const fetchAll = useCallback(async () => {
    try {
      const [today, upcoming, epics, events] = await Promise.all([
        api('list_today'),
        api('list_upcoming', { days: 7 }),
        api('list_epics'),
        api('list_events', { from_date: fmtISO(startOfDay(new Date())), to_date: fmtISO(new Date(Date.now() + 60 * 86400000)) }),
      ]);
      setState(s => ({ ...s, loading: false, today, upcoming, epics, events, error: null }));
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

  return { ...state, refetch: fetchAll };
}

// Expose to other dashboard modules
Object.assign(window, {
  useDashboardData, api,
  startOfDay, fmtISO, parseISODate, diffDays, dayName, fmtLong,
  categoryColor, epicColor, withAlpha, CATEGORY_COLOR, TAG_COLOR_OVERRIDES,
  T, SECTION_LABEL,
});
