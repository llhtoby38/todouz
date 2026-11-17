// views.jsx — TodaySection, WeekStrip, EpicsGrid, CalendarMonth.
// Editorial-modern visual style. Single page, vertical scroll.

const { useState: vUseState, useMemo: vUseMemo, useRef: vUseRef, useEffect: vUseEffect, useCallback: vUseCallback } = React;

// ─── tag grouping ────────────────────────────────────────────────────
// Tags cluster into families so the filter chips read as a small form
// instead of an unsorted cloud. Order inside a family is semantic where it
// matters (effort/time ladders), alphabetical otherwise. Unknown tags land
// in "other".
const TAG_FAMILIES = [
  { label: 'meal',    order: ['breakfast', 'main', 'side', 'soup', 'dessert', 'snack', 'drink'] },
  { label: 'cuisine', order: ['japanese', 'chinese', 'korean', 'thai', 'vietnamese', 'malaysian', 'asian', 'italian', 'french', 'spanish', 'middle-eastern', 'western', 'fusion'] },
  { label: 'food',    order: ['protein', 'carbs', 'vegi', 'sweets'] },
  { label: 'effort',  order: ['no-effort', 'effort-low', 'effort-medium', 'effort-high'] },
  { label: 'time',    order: ['time-5m', 'time-15m', 'time-30m', 'time-1h', 'time-2h+'] },
  { label: 'stock',   order: ['in-stock', 'low-stock', 'out-of-stock'] },
  { label: 'storage', order: ['pantry', 'fridge', 'freezer', 'spice-rack'] },
];
function groupTags(tags) {
  const remaining = new Set(tags);
  const groups = [];
  for (const fam of TAG_FAMILIES) {
    const present = fam.order.filter(t => remaining.has(t));
    if (present.length) {
      groups.push({ label: fam.label, tags: present });
      for (const t of present) remaining.delete(t);
    }
  }
  if (remaining.size) groups.push({ label: 'other', tags: [...remaining].sort() });
  return groups;
}

// Tag filtering as one dropdown per family (meal / cuisine / effort / …).
// A wall of 30+ chips was unreadable — this collapses to a row of small
// menu buttons that show how many of their tags are active.
function TagChips({ tags, active, onToggle, onClear, compact }) {
  const isMobile = useIsMobile();
  const groups = groupTags(tags);
  const [openGroup, setOpenGroup] = vUseState(null);
  // A left-anchored menu runs off the right edge of a phone screen, so anchor
  // to whichever side keeps it on-screen, decided from the trigger's position.
  const [alignRight, setAlignRight] = vUseState(false);
  vUseEffect(() => {
    if (!openGroup) return;
    const onDoc = () => setOpenGroup(null);
    window.addEventListener('click', onDoc);
    return () => window.removeEventListener('click', onDoc);
  }, [openGroup]);
  if (!groups.length) return null;
  const fs = isMobile ? 13 : (compact ? 11 : 12);

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
      {groups.map(g => {
        const activeInGroup = g.tags.filter(t => active.includes(t));
        const isOpen = openGroup === g.label;
        return (
          <div key={g.label} style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
            <button
              onClick={e => {
                const r = e.currentTarget.getBoundingClientRect();
                setAlignRight(r.left > window.innerWidth / 2);
                setOpenGroup(o => (o === g.label ? null : g.label));
              }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: isMobile ? '7px 13px' : (compact ? '3px 9px' : '4px 11px'),
                minHeight: isMobile ? 34 : 0,
                fontFamily: T.fontBody, fontSize: fs,
                color: activeInGroup.length ? '#fff' : T.textMuted,
                background: activeInGroup.length ? T.accent : T.surface,
                border: `1px solid ${activeInGroup.length ? T.accent : T.border}`,
                borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              {g.label}
              {activeInGroup.length > 0 && (
                <span style={{
                  fontFamily: T.fontMono, fontSize: fs - 1, fontWeight: 700,
                  background: 'rgba(255,255,255,0.25)', borderRadius: 999, padding: '0 5px',
                }}>{activeInGroup.length}</span>
              )}
              <span style={{ fontSize: 9, opacity: 0.75 }}>▾</span>
            </button>
            {isOpen && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 5px)', zIndex: 40,
                ...(alignRight ? { right: 0 } : { left: 0 }),
                minWidth: 160, maxWidth: 'min(280px, calc(100vw - 24px))',
                maxHeight: 260, overflowY: 'auto',
                background: T.surface, border: `1px solid ${T.border}`,
                borderRadius: 10, boxShadow: T.shadowLg, padding: 4,
              }}>
                {g.tags.map(t => {
                  const on = active.includes(t);
                  return (
                    <button
                      key={t}
                      onClick={() => onToggle(t)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                        padding: isMobile ? '10px 12px' : '8px 10px',
                        minHeight: isMobile ? 36 : 0,
                        background: 'transparent', border: 'none',
                        borderRadius: 6, cursor: 'pointer', textAlign: 'left',
                        fontFamily: T.fontMono, fontSize: isMobile ? 13 : 12,
                        color: on ? T.accent : T.text, fontWeight: on ? 600 : 400,
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = T.surfaceHover; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      <span style={{
                        width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                        border: `1px solid ${on ? T.accent : T.borderStrong}`,
                        background: on ? T.accent : 'transparent',
                        color: '#fff', display: 'inline-flex',
                        alignItems: 'center', justifyContent: 'center',
                      }}>{on && <Icon kind="check" size={10} />}</span>
                      {t}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {active.length > 0 && (
        <button onClick={onClear} style={{
          padding: compact ? '3px 8px' : '4px 10px', fontFamily: T.fontBody, fontSize: fs,
          color: T.textMuted, background: 'transparent',
          border: 'none', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 2,
        }}>clear all</button>
      )}
    </div>
  );
}

// ─── FilterMenu ──────────────────────────────────────────────────────
// One "Filters" button that opens a nested dropdown, replacing the old wall
// of window pills + filter chips + per-family tag menus. Every section is
// optional (rendered only when its prop is supplied) so the same component
// serves the Today/Items by-date view (due-date + priority + no-timeblocks +
// tags grouped by list) and each list column (tags-only, scoped to that list).
const DUE_MODES = [
  { k: 'any', label: 'Any due date' },
  { k: 'w1',  label: 'Next 7 days' },
  { k: 'w2',  label: 'Next 2 weeks' },
  { k: 'm1',  label: 'Next month' },
];
const PRIORITIES = ['high', 'medium', 'low'];

function FilterMenu({ due, missing, priority, assignee, tagLists, activeTags, onToggleTag, onClearAll, compact, align = 'left', label = 'Filters', showListHeaders = false, iconOnly = false }) {
  const isMobile = useIsMobile();
  const [open, setOpen] = vUseState(false);
  // Anchor rect of the trigger button, captured on open, so a phone dropdown can
  // be positioned as a viewport-clamped fixed panel instead of overflowing off
  // the edge (a right-anchored menu on a narrow column ran past the screen).
  const [anchor, setAnchor] = vUseState(null);
  // Which list groups are expanded in the tags section. Lists carrying an
  // active tag start expanded so a set filter is never hidden behind a collapse.
  const [openLists, setOpenLists] = vUseState({});
  vUseEffect(() => {
    if (!open) return;
    const onDoc = () => setOpen(false);
    window.addEventListener('click', onDoc);
    return () => window.removeEventListener('click', onDoc);
  }, [open]);

  // Per-list menus render families directly (you're already inside that list).
  // The Today menu groups tags under their list header ("Kitchen › meal/…").
  const flat = !showListHeaders;
  const soleList = (tagLists || []).length === 1;
  const count =
    (due && due.mode !== 'any' ? 1 : 0) +
    (due && due.includeLater ? 1 : 0) +
    (due && due.includeNoDue ? 1 : 0) +
    (missing && missing.value ? 1 : 0) +
    (priority ? priority.active.length : 0) +
    (assignee ? assignee.active.length : 0) +
    ((activeTags || []).length);

  const secLabel = { fontSize: 10, fontFamily: T.fontMono, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '0.12em', margin: '2px 0 4px' };
  const divider = <div style={{ height: 1, background: T.border, margin: '8px 0' }} />;
  const check = (on) => (
    <span style={{
      width: 15, height: 15, borderRadius: 3, flexShrink: 0,
      border: `1px solid ${on ? T.accent : T.borderStrong}`, background: on ? T.accent : 'transparent',
      color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    }}>{on && <Icon kind="check" size={10} />}</span>
  );
  const radio = (on) => (
    <span style={{
      width: 15, height: 15, borderRadius: 999, flexShrink: 0,
      border: `1px solid ${on ? T.accent : T.borderStrong}`,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    }}>{on && <span style={{ width: 7, height: 7, borderRadius: 999, background: T.accent }} />}</span>
  );
  const rowStyle = {
    display: 'flex', alignItems: 'center', gap: 9, width: '100%',
    padding: isMobile ? '9px 8px' : '6px 8px', minHeight: isMobile ? 36 : 0,
    background: 'transparent', border: 'none', borderRadius: 6, cursor: 'pointer',
    textAlign: 'left', fontFamily: T.fontBody, fontSize: isMobile ? 13 : 12.5, color: T.text,
  };
  const row = (kind, on, text, onClick, key) => (
    <button key={key} onClick={onClick} style={rowStyle}
      onMouseEnter={e => { e.currentTarget.style.background = T.surfaceHover; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
      {kind === 'radio' ? radio(on) : check(on)}
      <span style={{ fontFamily: kind === 'tag' ? T.fontMono : T.fontBody, color: on ? T.accent : T.text, fontWeight: on ? 600 : 400 }}>{text}</span>
    </button>
  );

  return (
    <div style={{ position: 'relative', display: 'inline-block' }} onClick={e => e.stopPropagation()}>
      <button
        onClick={(e) => { setAnchor(e.currentTarget.getBoundingClientRect()); setOpen(o => !o); }}
        title={iconOnly ? 'filters' : undefined}
        aria-label="filters"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: iconOnly ? 3 : 6,
          padding: iconOnly ? (isMobile ? '6px 8px' : '4px 7px') : (isMobile ? '7px 13px' : (compact ? '3px 10px' : '5px 12px')),
          minHeight: isMobile ? (iconOnly ? 32 : 34) : 0,
          fontFamily: T.fontBody, fontSize: isMobile ? 13 : (compact ? 11 : 12),
          color: count ? '#fff' : T.textMuted,
          background: count ? T.accent : T.surface,
          border: `1px solid ${count ? T.accent : T.border}`,
          borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap',
        }}
      >
        <Icon kind="filter" size={compact ? 12 : 13} />
        {!iconOnly && label}
        {count > 0 && (
          <span style={{ fontFamily: T.fontMono, fontSize: (isMobile ? 12 : 11), fontWeight: 700, background: 'rgba(255,255,255,0.25)', borderRadius: 999, padding: '0 6px' }}>{count}</span>
        )}
        {!iconOnly && <span style={{ fontSize: 9, opacity: 0.75 }}>▾</span>}
      </button>
      {open && (
        <div style={(() => {
          const base = {
            zIndex: 60, maxHeight: 'min(60vh, 460px)', overflowY: 'auto',
            background: T.surface, border: `1px solid ${T.border}`,
            borderRadius: 12, boxShadow: T.shadowLg, padding: 8,
          };
          // Phone: a fixed panel pinned under the button and clamped to the
          // viewport, so it can't run off the edge (columns are narrow and a
          // right-anchored absolute panel spilled past the screen).
          if (isMobile && anchor) {
            const vw = window.innerWidth;
            const w = Math.min(300, vw - 24);
            const left = Math.max(12, Math.min(anchor.left, vw - w - 12));
            return { ...base, position: 'fixed', top: anchor.bottom + 6, left, width: w };
          }
          return { ...base, position: 'absolute', top: 'calc(100% + 6px)', width: 280, ...(align === 'right' ? { right: 0 } : { left: 0 }) };
        })()}>
          {/* DUE DATE */}
          {due && (
            <>
              <div style={secLabel}>Due date</div>
              {DUE_MODES.map(m => row('radio', due.mode === m.k, m.label, () => due.setMode(m.k), 'due-' + m.k))}
              {due.mode !== 'any' && (
                <div style={{ paddingLeft: 6 }}>
                  {row('check', due.includeLater, 'Include items due later', () => due.setIncludeLater(!due.includeLater), 'later')}
                  {row('check', due.includeNoDue, 'Include no-due items', () => due.setIncludeNoDue(!due.includeNoDue), 'nodue')}
                </div>
              )}
              {(missing || priority || (tagLists && tagLists.length)) && divider}
            </>
          )}
          {/* NO TIMEBLOCKS */}
          {missing && (
            <>
              {row('check', missing.value, 'Only missing a session', () => missing.setValue(!missing.value), 'missing')}
              {(priority || (tagLists && tagLists.length)) && divider}
            </>
          )}
          {/* PRIORITY */}
          {priority && (
            <>
              <div style={secLabel}>Priority</div>
              {PRIORITIES.map(p => row('check', priority.active.includes(p), p, () => priority.toggle(p), 'prio-' + p))}
              {(assignee || (tagLists && tagLists.length)) ? divider : null}
            </>
          )}
          {/* ASSIGNEE */}
          {assignee && assignee.users && assignee.users.length > 0 && (
            <>
              <div style={secLabel}>Assignee</div>
              {assignee.users.map(u => row('check', assignee.active.includes(u), u, () => assignee.toggle(u), 'asg-' + u))}
              {(tagLists && tagLists.length) ? divider : null}
            </>
          )}
          {/* TAGS */}
          {tagLists && tagLists.length > 0 && (
            <>
              <div style={secLabel}>Tags</div>
              {tagLists.map(grp => {
                const listActive = grp.families.reduce((n, f) => n + f.tags.filter(t => activeTags.includes(t)).length, 0);
                // Flat (per-list) → always open. Grouped (Today) → open when it's
                // the only list, when the user expanded it, or when it has a hit.
                const expanded = flat || (soleList && !flat) || openLists[grp.list] || listActive > 0;
                return (
                  <div key={grp.list} style={{ marginBottom: 2 }}>
                    {!flat && (
                      <button
                        onClick={() => setOpenLists(o => ({ ...o, [grp.list]: !expanded }))}
                        style={{ ...rowStyle, fontWeight: 600 }}
                        onMouseEnter={e => { e.currentTarget.style.background = T.surfaceHover; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                      >
                        <span style={{ display: 'inline-block', width: 12, transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.12s', color: T.textFaint }}>▸</span>
                        <span style={{ flex: 1, textTransform: 'capitalize' }}>{grp.list}</span>
                        {listActive > 0 && <span style={{ fontFamily: T.fontMono, fontSize: 11, fontWeight: 700, color: '#fff', background: T.accent, borderRadius: 999, padding: '0 6px' }}>{listActive}</span>}
                      </button>
                    )}
                    {expanded && grp.families.map(fam => (
                      <div key={fam.label} style={{ paddingLeft: flat ? 0 : 16, marginBottom: 2 }}>
                        <div style={{ fontSize: 10, fontFamily: T.fontMono, color: T.textFaint, letterSpacing: '0.08em', margin: '4px 0 2px 8px' }}>{fam.label}</div>
                        {fam.tags.map(t => row('tag', activeTags.includes(t), t, () => onToggleTag(t), 'tag-' + t))}
                      </div>
                    ))}
                  </div>
                );
              })}
            </>
          )}
          {count > 0 && (
            <>
              {divider}
              <button onClick={onClearAll} style={{ ...rowStyle, justifyContent: 'center', color: T.textMuted, fontWeight: 500 }}>Clear all filters</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Title → URL-safe short slug. Strips punctuation, collapses runs of dashes,
// trims edge dashes. Matches the backend's /^[a-z0-9][a-z0-9-]*$/ contract.
function slugify(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// ─── Icon set (Lucide-style inline SVGs) ────────────────────────────
// Single component, kind-switched. Inherits currentColor so callers can tint via CSS color.
function Icon({ kind, size = 14 }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', style: { flexShrink: 0 } };
  switch (kind) {
    case 'nav-today': // sun
      return (<svg {...common}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>);
    case 'nav-feed': // stacked cards
      return (<svg {...common}><rect x="4" y="7" width="16" height="14" rx="3"/><path d="M7 4h10"/><path d="M10 12l4 2-4 2z"/></svg>);
    case 'nav-list': // list
      return (<svg {...common}><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></svg>);
    case 'nav-brain': // spark / memory
      return (<svg {...common}><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>);
    case 'nav-board': // columns
      return (<svg {...common}><rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="17" y="4" width="4" height="7" rx="1.5"/></svg>);
    case 'work': // clock — a working session / time-block
      return (<svg {...common}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>);
    case 'deadline': // flag — due today
      return (<svg {...common}><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>);
    case 'recurring': // refresh — recurring
      return (<svg {...common}><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>);
    case 'event': // calendar — external event
      return (<svg {...common}><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>);
    case 'check':
      return (<svg {...common}><polyline points="20 6 9 17 4 12"/></svg>);
    case 'filter': // funnel — filter controls
      return (<svg {...common}><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>);
    case 'issue': // checkable task — a to-do item
      return (<svg {...common}><rect x="3" y="3" width="18" height="18" rx="3"/><polyline points="8 12 11 15 16 9"/></svg>);
    case 'x':
      return (<svg {...common}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>);
    // ─── nav / chrome glyphs ───────────────────────────────────────────
    // Same Lucide grammar as above (24px box, currentColor stroke) so the
    // nav reads as one family instead of a pile of vendor emoji.
    case 'today': // calendar with a marked day
      return (<svg {...common}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><rect x="7" y="13" width="4" height="4" rx="1" fill="currentColor" stroke="none"/></svg>);
    case 'plan': // calendar with rows — the week/month planner
      return (<svg {...common}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="14" x2="16" y2="14"/><line x1="8" y1="18" x2="13" y2="18"/></svg>);
    case 'list': // issues
      return (<svg {...common}><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>);
    case 'chat':
      return (<svg {...common}><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>);
    case 'plus':
      return (<svg {...common}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>);
    case 'archive':
      return (<svg {...common}><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5" rx="1"/><line x1="10" y1="12" x2="14" y2="12"/></svg>);
    case 'settings':
      return (<svg {...common}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>);
    case 'logout':
      return (<svg {...common}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>);
    case 'more': // horizontal ellipsis — overflow menu
      return (<svg {...common}><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/><circle cx="5" cy="12" r="1.5" fill="currentColor"/></svg>);
    case 'refresh': // circular arrow — reload data
      return (<svg {...common}><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>);
    case 'shared': // two people — visible to everyone
      return (<svg {...common}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>);
    case 'private': // lock — visible only to you
      return (<svg {...common}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>);
    case 'projects': // board columns — the Projects kanban
      return (<svg {...common}><rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="10" rx="1"/><rect x="17" y="4" width="4" height="13" rx="1"/></svg>);
    case 'select': // empty square — select mode off
      return (<svg {...common}><rect x="3" y="3" width="18" height="18" rx="3"/></svg>);
    case 'select-on': // ticked square — select mode on
      return (<svg {...common}><rect x="3" y="3" width="18" height="18" rx="3"/><polyline points="8 12 11 15 16 9"/></svg>);
    case 'send': // arrow up — chat send
      return (<svg {...common}><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>);
    case 'attach': // paperclip
      return (<svg {...common}><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>);
    case 'drag': // grip dots — draggable handle
      return (<svg {...common}><circle cx="9" cy="6" r="1.5" fill="currentColor"/><circle cx="15" cy="6" r="1.5" fill="currentColor"/><circle cx="9" cy="12" r="1.5" fill="currentColor"/><circle cx="15" cy="12" r="1.5" fill="currentColor"/><circle cx="9" cy="18" r="1.5" fill="currentColor"/><circle cx="15" cy="18" r="1.5" fill="currentColor"/></svg>);
    case 'minimize':
      return (<svg {...common}><line x1="5" y1="12" x2="19" y2="12"/></svg>);
    case 'expand':
      return (<svg {...common}><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>);
    default:
      return null;
  }
}

// ─── unifyDay(day) ──────────────────────────────────────────────────
// Merges a day's `due_today`, `recurring_today`, `timeblocks_today`, and `events_today`
// into a single deduped + sorted list of rows. Each row represents ONE thing the user
// has to think about — either an issue (with optional timeblocks + status badges) or
// a freestanding timeblock or a freestanding event.
//
// Output row shapes:
//   { kind: 'issue', issue, timeblocks: [...], isDeadline, isRecurring, primaryStart }
//   { kind: 'block', timeblock, primaryStart }      // timeblock not linked to any issue
//   { kind: 'event', event, primaryStart }          // external commitment
//
// Sorted: items with a start time first (chronological), then untimed (deadline → recurring).
function unifyDay(day) {
  if (!day) return [];
  const due = day.due_today || [];
  const recurring = day.recurring_today || [];
  // Drop completed timeblocks — once a session is done it shouldn't keep cluttering
  // Today. The block lives on in archives but is hidden from active dashboards.
  const blocks = (day.timeblocks_today || day.timeblocks || []).filter(b => !b.completed);
  // Calendar surfaces show ONLY sessions (timeblocks) + due dates. Free-form events
  // are intentionally excluded — they belong in epics/issues as deadline-bearing items.
  const events = [];

  // Bucket issues by id; merge state from due/recurring/timeblock origins.
  const buckets = new Map();
  const keyFor = (it) => `${it.epic_slug}:${it.id}`;

  for (const it of due) {
    const k = keyFor(it);
    buckets.set(k, { issue: it, timeblocks: [], isDeadline: true, isRecurring: !!it.recurring });
  }
  for (const it of recurring) {
    const k = keyFor(it);
    if (!buckets.has(k)) buckets.set(k, { issue: it, timeblocks: [], isDeadline: false, isRecurring: true });
    else buckets.get(k).isRecurring = true;
  }

  const freeBlocks = [];
  for (const tb of blocks) {
    if (tb.issue_id && tb.epic_slug) {
      const k = `${tb.epic_slug}:${tb.issue_id}`;
      if (buckets.has(k)) {
        buckets.get(k).timeblocks.push(tb);
      } else {
        // Working-session for an issue that's neither due today nor recurring today.
        // Synthesise a minimal issue row from the timeblock's title.
        buckets.set(k, {
          issue: { id: tb.issue_id, epic_slug: tb.epic_slug, title: tb.title, agent: '', priority: 'medium' },
          timeblocks: [tb], isDeadline: false, isRecurring: false,
        });
      }
    } else {
      freeBlocks.push(tb);
    }
  }

  // Drop events that duplicate an issue's deadline. Heuristic: event tag matches
  // the issue's epic short-name OR appears in the event title (e.g. "ml-course — module 4 quiz").
  const epicShorts = new Set(Array.from(buckets.values()).map(b => (b.issue.epic_slug || '').split('/')[1]?.toLowerCase()).filter(Boolean));
  const eventsClean = events.filter(e => {
    const tag = (e.category || '').toLowerCase();
    if (tag && epicShorts.has(tag)) return false;
    const title = (e.title || '').toLowerCase();
    for (const short of epicShorts) {
      if (short && title.includes(short)) return false;
    }
    return true;
  });

  // Build rows
  const rows = [];
  for (const b of buckets.values()) {
    const sortedTbs = b.timeblocks.slice().sort((a, b) => a.start.localeCompare(b.start));
    rows.push({
      kind: 'issue',
      issue: b.issue,
      timeblocks: sortedTbs,
      isDeadline: b.isDeadline,
      isRecurring: b.isRecurring,
      primaryStart: sortedTbs[0]?.start || null,
    });
  }
  for (const tb of freeBlocks) rows.push({ kind: 'block', timeblock: tb, primaryStart: tb.start });
  for (const e of eventsClean) rows.push({ kind: 'event', event: e, primaryStart: e.time || null });

  rows.sort((a, b) => {
    if (a.primaryStart && b.primaryStart) return a.primaryStart.localeCompare(b.primaryStart);
    if (a.primaryStart) return -1;
    if (b.primaryStart) return 1;
    // Both untimed: deadlines come before recurring
    const score = r => (r.kind !== 'issue' ? 3 : r.isDeadline ? 0 : r.isRecurring ? 1 : 2);
    return score(a) - score(b);
  });
  return rows;
}

// ─── shared mini components ──────────────────────────────────────────
function CategoryChip({ category }) {
  const c = categoryColor(category);
  return (
    <span style={{
      fontFamily: T.fontBody, fontSize: 11, fontWeight: 500,
      letterSpacing: '0.02em',
      color: c, padding: '2px 8px',
      background: withAlpha(c, 0.08),
      borderRadius: 999,
    }}>{category}</span>
  );
}

function EpicTag({ epicSlug }) {
  if (!epicSlug) return null;
  const c = epicColor(epicSlug, epicSlug.split('/')[0]);
  const short = epicSlug.split('/')[1];
  return (
    <span style={{
      fontFamily: T.fontMono, fontSize: 11, fontWeight: 500,
      color: c, letterSpacing: '0.02em',
    }}>{short}</span>
  );
}

function PriorityDot({ priority }) {
  const c = priority === 'high' ? T.overdue : priority === 'low' ? T.textFaint : T.warning;
  return (
    <span style={{
      display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
      background: c, flexShrink: 0,
    }} title={priority} />
  );
}

// "YYYY-MM-DD [HH:MM]" formatter — used everywhere we print an issue due. Falls back to
// empty string for null inputs so callers can `formatDue(it.due, it.due_time) || '—'`.
function formatDue(date, time) {
  if (!date) return '';
  return time ? `${date} ${time}` : date;
}

// Filled green checkmark badge that replaces the PriorityDot when an issue is completed —
// makes "done" unmistakable at a glance on every row component.
function DoneCheck() {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 16, height: 16, borderRadius: 4, background: T.done, color: '#fff',
      fontSize: 11, fontWeight: 700, flexShrink: 0,
    }} title="completed">✓</span>
  );
}

// Small chip rendered before sub-issue titles to make the parent context clear.
// Shows "↑ Parent title" — clickable would be nice but it sits inside a clickable row
// so we keep it visually-only and let the user open the parent from the issue drawer.
function ParentTrace({ parent_id, parent_title }) {
  const isMobile = useIsMobile();
  if (!parent_id || !parent_title) return null;
  return (
    // flexShrink: 0 with a 220px cap meant a long parent name was sliced
    // mid-word at the card edge on a phone instead of eliding. Let it shrink.
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      maxWidth: isMobile ? 180 : 220, overflow: 'hidden',
      flexShrink: isMobile ? 1 : 0, minWidth: 0,
    }} title={`Sub-issue of ${parent_id} — ${parent_title}`}>
      <span style={{ color: T.textFaint, fontFamily: T.fontMono, fontSize: 10 }}>↳</span>
      <span style={{
        fontSize: 11, color: T.textMuted, fontStyle: 'italic',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{parent_title}</span>
    </span>
  );
}

function IssueRow({ issue, onClick, dim }) {
  const c = epicColor(issue.epic_slug, issue.epic_slug?.split('/')[0]);
  // `dim` is a manual override; `done` reflects the issue's actual completion state.
  const done = !!issue.is_completed;
  const fade = dim || done;
  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 14px', marginBottom: 4,
        background: done ? T.surface2 : T.surface,
        border: `1px solid ${T.border}`,
        borderLeft: `3px solid ${done ? T.done : c}`,
        borderRadius: 6,
        cursor: 'pointer',
        transition: 'background 0.12s ease, transform 0.12s ease',
        opacity: fade ? 0.55 : 1,
      }}
      onMouseEnter={e => { e.currentTarget.style.background = T.surfaceHover; }}
      onMouseLeave={e => { e.currentTarget.style.background = done ? T.surface2 : T.surface; }}
    >
      {done ? <DoneCheck /> : <PriorityDot priority={issue.priority} />}
      <EpicTag epicSlug={issue.epic_slug} />
      <ParentTrace parent_id={issue.parent_issue_id} parent_title={issue.parent_title} />
      <span style={{
        flex: 1, fontSize: 14, color: T.text,
        textDecoration: fade ? 'line-through' : 'none',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{issue.title}</span>
      {issue.recurring && (
        <span style={{ fontSize: 12, color: T.textFaint }} title="recurring">↻</span>
      )}
      {issue.total_subtask_count > 0 && (
        <span style={{ fontSize: 11, color: T.textMuted, fontFamily: T.fontMono, fontVariantNumeric: 'tabular-nums' }}>
          {issue.total_subtask_count - issue.open_subtask_count}/{issue.total_subtask_count}
        </span>
      )}
      {issue.due && (
        <span style={{ fontSize: 12, color: T.textMuted, fontVariantNumeric: 'tabular-nums', fontFamily: T.fontMono }}>
          {issue.due === fmtISO(new Date())
            ? (issue.due_time ? `today ${issue.due_time}` : 'today')
            : formatDue(issue.due, issue.due_time)}
        </span>
      )}
    </div>
  );
}

function TimeblockRow({ block, onClick, onDelete, onComplete, enableQuickActions, onRefresh }) {
  const isMobile = useIsMobile();
  const c = block.epic_slug ? epicColor(block.epic_slug, block.epic_slug.split('/')[0]) : T.textMuted;
  const stop = (e) => { e.stopPropagation(); };
  const [editingDate, setEditingDate] = vUseState(false);
  const [dateDraft, setDateDraft] = vUseState(block.date || '');

  const saveDate = async (val) => {
    if (!val || val === block.date) return;
    try {
      await api('update_timeblock', { id: block.id, patch: { date: val } });
      onRefresh && onRefresh();
    } catch (e) { alert('save failed: ' + (e?.message || e)); }
  };

  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '8px 14px', marginBottom: 4,
        background: block.completed ? T.surface2 : T.surface,
        border: `1px solid ${T.border}`,
        borderLeft: `3px dashed ${c}`,
        borderRadius: 6,
        cursor: onClick ? 'pointer' : 'default',
        opacity: block.completed ? 0.6 : 1,
      }}
    >
      <span style={{
        fontFamily: T.fontMono, fontSize: 12, color: c,
        minWidth: 96, flexShrink: 0, fontVariantNumeric: 'tabular-nums',
      }}>
        {block.start}–{block.end}
      </span>
      <span style={{
        flex: 1, fontSize: 13, color: T.text,
        textDecoration: block.completed ? 'line-through' : 'none',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{block.title}</span>
      {block.epic_slug && !editingDate && (
        <span style={{
          fontFamily: T.fontMono, fontSize: 11, color: c,
          flexShrink: 0,
        }}>
          {block.epic_slug.split('/')[1]}{block.issue_id ? ` · ${block.issue_id}` : ''}
        </span>
      )}
      {editingDate && (
        <input
          type="date" autoFocus value={dateDraft}
          onClick={stop}
          onChange={e => setDateDraft(e.target.value)}
          onBlur={async () => { await saveDate(dateDraft); setEditingDate(false); }}
          onKeyDown={e => {
            if (e.key === 'Enter') e.currentTarget.blur();
            else if (e.key === 'Escape') { setDateDraft(block.date); setEditingDate(false); }
          }}
          style={{
            background: T.surface2, border: `1px solid ${T.borderStrong}`, borderRadius: 4,
            padding: '3px 6px', fontFamily: T.fontMono, fontSize: 12, color: T.text, outline: 'none',
          }}
        />
      )}
      {enableQuickActions && !editingDate && (
        <button onClick={(e) => { stop(e); setEditingDate(true); }} title="reschedule" style={iconBtn(T.textMuted)}><Icon kind="event" size={isMobile ? 16 : 13} /></button>
      )}
      {onComplete && !block.completed && (
        <button onClick={(e) => { stop(e); onComplete(); }} title="mark done" style={iconBtn(T.done)}>✓</button>
      )}
      {onDelete && (
        <button onClick={(e) => { stop(e); if (confirm(`Delete "${block.title}"?`)) onDelete(); }} title="delete" style={iconBtn(T.overdue)}>✕</button>
      )}
    </div>
  );
}

const iconBtn = (color) => ({
  background: 'transparent', border: 'none', cursor: 'pointer',
  color, fontSize: 13, fontWeight: 600, padding: '2px 6px', lineHeight: 1,
  flexShrink: 0, borderRadius: 4,
});

// ─── DayItemRow ─────────────────────────────────────────────────────
// Single-row renderer for any unified day item. Used by Today section + DayPopover.
// Branching based on kind: issue (with optional timeblocks/badges), free block, event.
//
// `enableQuickActions` (only true inside DayPopover) reveals a hover toolbar with
// a date-edit chip + delete button so the user can move/remove items from the
// calendar surface without having to open the IssueDrawer.
function DayItemRow({ row, onSelectIssue, onTbAction, onSelectBlock, onRefresh, enableQuickActions }) {
  if (row.kind === 'block') {
    // Free timeblock (no issue link). Same QuickActions component is shared.
    return <TimeblockRow
      block={row.timeblock}
      onClick={() => onSelectBlock && onSelectBlock(row.timeblock)}
      onComplete={onTbAction(row.timeblock.id, 'complete')}
      onDelete={onTbAction(row.timeblock.id, 'delete')}
      enableQuickActions={enableQuickActions}
      onRefresh={onRefresh}
    />;
  }
  if (row.kind === 'event') {
    return <EventRow event={row.event} enableQuickActions={enableQuickActions} onRefresh={onRefresh} />;
  }
  // kind === 'issue'
  return <IssueDayRow row={row} onSelectIssue={onSelectIssue} onTbAction={onTbAction} onRefresh={onRefresh} enableQuickActions={enableQuickActions} />;
}

// Issue row with optional inline due-date editor + delete confirm.
function IssueDayRow({ row, onSelectIssue, onTbAction, onRefresh, enableQuickActions }) {
  const isMobile = useIsMobile();
  const it = row.issue;
  const c = epicColor(it.epic_slug, it.epic_slug.split('/')[0]);
  const done = !!it.is_completed;
  const hasTimeblock = row.timeblocks.length > 0;
  const iconKind = hasTimeblock ? 'work' : row.isDeadline ? 'deadline' : row.isRecurring ? 'recurring' : 'work';
  const [hover, setHover] = vUseState(false);
  const [editingDate, setEditingDate] = vUseState(false);
  const [dateDraft, setDateDraft] = vUseState(it.due || '');

  const saveDate = async (val) => {
    try {
      await api('update_issue', { id: it.id, epic: it.epic_slug, patch: { due: val || null } });
      onRefresh && onRefresh();
    } catch (e) { alert('save failed: ' + (e?.message || e)); }
  };
  const doDelete = async (e) => {
    e.stopPropagation();
    if (!confirm(`Delete issue "${it.title}"? This is permanent.`)) return;
    try {
      await api('delete_issue', { id: it.id, epic: it.epic_slug, cascade: true });
      onRefresh && onRefresh();
    } catch (err) { alert('delete failed: ' + (err?.message || err)); }
  };

  const baseBg = done ? T.surface2 : T.surface;
  return (
    <div
      onClick={() => !editingDate && onSelectIssue({ id: it.id, epic_slug: it.epic_slug })}
      onMouseEnter={e => { setHover(true); e.currentTarget.style.background = T.surfaceHover; }}
      onMouseLeave={e => { setHover(false); e.currentTarget.style.background = baseBg; }}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectIssue({ id: it.id, epic_slug: it.epic_slug }); } }}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 14px', marginBottom: 4,
        background: baseBg,
        border: `1px solid ${T.border}`,
        borderLeft: `3px solid ${done ? T.done : c}`,
        borderRadius: 6,
        cursor: editingDate ? 'default' : 'pointer',
        transition: 'background 0.12s ease',
        opacity: done ? 0.55 : 1,
      }}
    >
      {done ? <DoneCheck /> : (
        <span style={{ display: 'inline-flex', color: c, flexShrink: 0 }}>
          <Icon kind={iconKind} size={14} />
        </span>
      )}
      {/* Time removed from the day view (ISS-008) — the clock icon already marks
          a scheduled session; the exact slot lives in Plan + the item drawer. */}
      <EpicTag epicSlug={it.epic_slug} />
      <ParentTrace parent_id={it.parent_issue_id} parent_title={it.parent_title} />
      <span style={{
        flex: 1, fontSize: 14, color: T.text,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        textDecoration: done ? 'line-through' : 'none',
      }}>{it.title}</span>
      {row.isDeadline && !editingDate && (
        <Badge color={T.overdue} bg={withAlpha('#b91c1c', 0.08)} title="due today">DUE</Badge>
      )}
      {row.isRecurring && !hasTimeblock && !editingDate && (
        <span style={{ color: T.textFaint, display: 'inline-flex' }} title="recurring"><Icon kind="recurring" size={12} /></span>
      )}
      {it.total_subtask_count > 0 && !editingDate && (
        <span style={{ fontSize: 11, color: T.textMuted, fontFamily: T.fontMono, fontVariantNumeric: 'tabular-nums' }}>
          {it.total_subtask_count - it.open_subtask_count}/{it.total_subtask_count}
        </span>
      )}
      {enableQuickActions && editingDate && (
        <input
          type="date" autoFocus value={dateDraft}
          onClick={e => e.stopPropagation()}
          onChange={e => setDateDraft(e.target.value)}
          onBlur={async () => {
            if (dateDraft !== (it.due || '')) await saveDate(dateDraft);
            setEditingDate(false);
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') e.currentTarget.blur();
            else if (e.key === 'Escape') { setDateDraft(it.due || ''); setEditingDate(false); }
          }}
          style={{
            background: T.surface2, border: `1px solid ${T.borderStrong}`, borderRadius: 4,
            padding: '3px 6px', fontFamily: T.fontMono, fontSize: 12, color: T.text, outline: 'none',
          }}
        />
      )}
      {/* touch has no hover — these would be dead controls on a phone */}
      {enableQuickActions && (hover || isMobile) && !editingDate && (
        <span style={{ display: 'inline-flex', gap: 4, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          <button
            onClick={() => { setDateDraft(it.due || fmtISO(new Date())); setEditingDate(true); }}
            title="change due date"
            style={quickBtnStyle(T.textMuted, isMobile)}
          ><Icon kind="event" size={isMobile ? 16 : 13} /></button>
          <button onClick={doDelete} title="delete issue" style={quickBtnStyle(T.overdue, isMobile)}><Icon kind="x" size={isMobile ? 16 : 13} /></button>
        </span>
      )}
    </div>
  );
}

function quickBtnStyle(color, isMobile) {
  return {
    background: 'transparent', border: 'none', cursor: 'pointer',
    color, fontSize: 13, lineHeight: 1, borderRadius: 4,
    padding: isMobile ? '6px 8px' : '2px 5px',
    minWidth: isMobile ? 32 : 0, minHeight: isMobile ? 32 : 0,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  };
}

function Badge({ children, color, bg, title }) {
  return (
    <span title={title} style={{
      fontSize: 10, fontWeight: 600, letterSpacing: '0.06em',
      color, background: bg,
      padding: '2px 7px', borderRadius: 999,
      flexShrink: 0,
    }}>{children}</span>
  );
}

function EventRow({ event, enableQuickActions, onRefresh }) {
  const isMobile = useIsMobile();
  const c = categoryColor(event.category);
  const [hover, setHover] = vUseState(false);
  const [editingDate, setEditingDate] = vUseState(false);
  const [dateDraft, setDateDraft] = vUseState(event.date || '');

  const saveDate = async (val) => {
    try {
      await api('update_event', { id: event.id, patch: { date: val } });
      onRefresh && onRefresh();
    } catch (e) { alert('save failed: ' + (e?.message || e)); }
  };
  const doDelete = async () => {
    if (!confirm(`Delete event "${event.title}"?`)) return;
    try {
      await api('delete_event', { id: event.id });
      onRefresh && onRefresh();
    } catch (e) { alert('delete failed: ' + (e?.message || e)); }
  };

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '8px 14px', marginBottom: 3,
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: 6,
      }}>
      <span style={{ display: 'inline-flex', color: c, flexShrink: 0 }}>
        <Icon kind="event" size={14} />
      </span>
      {event.time && (
        <span style={{
          fontFamily: T.fontMono, fontSize: 12, color: c, flexShrink: 0,
          fontVariantNumeric: 'tabular-nums',
        }}>{event.time}</span>
      )}
      <span style={{
        flex: 1, fontSize: 13, color: T.textMuted,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{event.title}</span>
      <span style={{ fontFamily: T.fontMono, fontSize: 11, color: c, flexShrink: 0 }}>
        {event.category || 'event'}
      </span>
      {enableQuickActions && editingDate && (
        <input
          type="date" autoFocus value={dateDraft}
          onChange={e => setDateDraft(e.target.value)}
          onBlur={async () => {
            if (dateDraft && dateDraft !== event.date) await saveDate(dateDraft);
            setEditingDate(false);
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') e.currentTarget.blur();
            else if (e.key === 'Escape') { setDateDraft(event.date || ''); setEditingDate(false); }
          }}
          style={{
            background: T.surface2, border: `1px solid ${T.borderStrong}`, borderRadius: 4,
            padding: '3px 6px', fontFamily: T.fontMono, fontSize: 12, color: T.text, outline: 'none',
          }}
        />
      )}
      {/* touch has no hover — these would be dead controls on a phone */}
      {enableQuickActions && (hover || isMobile) && !editingDate && (
        <span style={{ display: 'inline-flex', gap: 4, flexShrink: 0 }}>
          <button onClick={() => setEditingDate(true)} title="change date" style={quickBtnStyle(T.textMuted, isMobile)}><Icon kind="event" size={isMobile ? 16 : 13} /></button>
          <button onClick={doDelete} title="delete event" style={quickBtnStyle(T.overdue, isMobile)}><Icon kind="x" size={isMobile ? 16 : 13} /></button>
        </span>
      )}
    </div>
  );
}

// ─── TODAY ───────────────────────────────────────────────────────────
function TodaySection({ data, viewDate, onResetView, onSelectIssue, onRefresh, onSelectBlock, onAdd }) {
  const isMobile = useIsMobile();
  // When the user clicks a day in WeekStrip / CalendarMonth, viewDate is set to that ISO date.
  // We fetch list_today for it on demand. If null (or === today), we use the preloaded data.today.
  //
  // CRITICAL: all hooks (useState / useEffect / useMemo) must be declared at the top in a
  // fixed order — no early returns between them. Previously an early `return loading…` between
  // useEffect and useMemo violated Rules of Hooks and crashed the whole React tree to a blank
  // screen the moment the user clicked a non-today date.
  const [pinnedDay, setPinnedDay] = vUseState(null);
  const [loading, setLoading] = vUseState(false);
  const [overdueBlocks, setOverdueBlocks] = vUseState([]);
  const [showOverdue, setShowOverdue] = vUseState(false);
  const isToday = !viewDate || viewDate === data.todayISO;

  vUseEffect(() => {
    if (isToday) { setPinnedDay(null); return; }
    let alive = true;
    setLoading(true);
    api('list_today', { date: viewDate })
      .then(d => { if (alive) { setPinnedDay(d); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [viewDate, isToday, data.today]); // data.today re-run triggers re-fetch after edits

  // Pull every uncompleted timeblock with date < today so the user can see
  // sessions they didn't get to — and drag them onto a future day to reschedule.
  // Re-runs on each parent refetch (data.today is the cheapest tick to watch).
  vUseEffect(() => {
    if (!isToday) return;
    let alive = true;
    const from = fmtISO(new Date(data.todayDate.getTime() - 60 * 86400000));   // 60d back is plenty
    const to = fmtISO(new Date(data.todayDate.getTime() - 86400000));          // yesterday
    api('list_timeblocks', { from_date: from, to_date: to })
      .then(r => {
        if (!alive) return;
        // auto_complete sessions (classes, pilates) count as done once past —
        // they never pile up as "unfinished".
        const open = (r.blocks || []).filter(b => !b.completed && !b.auto_complete);
        setOverdueBlocks(open);
      })
      .catch(() => { if (alive) setOverdueBlocks([]); });
    return () => { alive = false; };
  }, [isToday, data.today, data.todayISO]);

  // (Up Next section removed — it duplicated the WeekStrip and added noise.)

  // Build the active day after all hooks are declared. Guarded with a fallback so we never
  // crash on null — render the "loading…" body instead.
  const t = isToday ? data.today : pinnedDay;
  const hasT = !!t;
  // The actual overdue items behind the "N overdue" badge — tapping the badge
  // reveals them inline (they were otherwise only findable far down the Items list).
  const overdueIssues = (data.overdue && data.overdue.issues) || [];
  const hasContent = hasT && (
    ((t.timeblocks_today || []).some(b => !b.completed)) ||
    (t.due_today || []).length + (t.recurring_today || []).length + (t.events_today || []).length > 0
  );

  const heading = isToday ? 'Today' : (() => {
    const d = parseISODate(viewDate);
    return d ? fmtLong(d) : viewDate;
  })();
  const subtitle = isToday ? fmtLong(data.todayDate) : diffDayLabel(viewDate, data.todayISO);

  const tbAction = (id, action) => async () => {
    try {
      if (action === 'delete') await api('delete_timeblock', { id });
      if (action === 'complete') await api('complete_timeblock', { id });
      onRefresh && onRefresh();
      if (!isToday) {
        const d = await api('list_today', { date: viewDate });
        setPinnedDay(d);
      }
    } catch {}
  };

  return (
    <section style={sectionFrame()}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 14 }}>
        <h2 style={{ fontSize: 24, fontWeight: 600, fontFamily: T.fontDisplay, fontVariationSettings: '"opsz" 144' }}>
          {heading}
        </h2>
        <div style={{ fontSize: 13, color: T.textMuted, fontVariantNumeric: 'tabular-nums' }}>{subtitle}</div>
        <div style={{ flex: 1 }} />
        {!isToday && (
          <button onClick={onResetView} style={{
            fontSize: 12, color: T.text, fontWeight: 500,
            padding: '4px 12px', background: T.surface2,
            border: `1px solid ${T.border}`, borderRadius: 999, cursor: 'pointer',
          }} title="back to today">← Today</button>
        )}
        {isToday && overdueIssues.length > 0 && (
          <button onClick={() => setShowOverdue(v => !v)} title="show overdue items" style={{
            fontSize: 11, fontWeight: 600,
            color: T.overdue, background: withAlpha('#b91c1c', 0.08),
            border: 'none', padding: '3px 10px', borderRadius: 999, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 5,
          }}>
            {overdueIssues.length} overdue
            <span style={{ fontSize: 8, display: 'inline-block', transform: showOverdue ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▾</span>
          </button>
        )}
      </div>

      {/* Pinned items — kept at the very top of Today regardless of due date, for
          recurring-ish things (a shopping list) you don't want to keep re-dating. */}
      {isToday && (data.pinned || []).length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ ...SECTION_LABEL, marginTop: 0, marginBottom: 6, color: T.accent }}>
            📌 Pinned
            <span style={{ marginLeft: 8, color: T.textFaint, fontWeight: 500, letterSpacing: 0, fontFamily: T.fontMono, textTransform: 'none' }}>· {data.pinned.length}</span>
          </div>
          {data.pinned.map(it => (
            <IssueRow key={'pin:' + it.epic_slug + ':' + it.id} issue={it} onClick={() => onSelectIssue && onSelectIssue({ id: it.id, epic_slug: it.epic_slug })} />
          ))}
        </div>
      )}

      {/* The overdue items themselves, revealed by tapping the badge above. */}
      {isToday && showOverdue && overdueIssues.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ ...SECTION_LABEL, marginTop: 0, marginBottom: 6, color: T.overdue }}>
            Overdue items
            <span style={{ marginLeft: 8, color: T.textFaint, fontWeight: 500, letterSpacing: 0, fontFamily: T.fontMono, textTransform: 'none' }}>· {overdueIssues.length}</span>
          </div>
          {overdueIssues.map(it => (
            <OverdueRow key={it.id + ':' + it.epic_slug} issue={it} onClick={() => onSelectIssue && onSelectIssue(it)} />
          ))}
        </div>
      )}

      {(!hasT || loading) && !hasContent && (
        <div style={{ fontSize: 13, color: T.textFaint, fontStyle: 'italic', padding: '8px 0' }}>loading…</div>
      )}

      {/* Overdue sessions — uncompleted timeblocks dated before today. Surfacing
          them here means a day left unfinished doesn't silently disappear; the
          user can drag any row onto a future day to reschedule via the existing
          onDropOnDay({kind:'block'}) plumbing. Only renders in the "Today" view. */}
      {isToday && overdueBlocks.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ ...SECTION_LABEL, marginTop: 0, marginBottom: 6, color: T.overdue }}>
            Unfinished sessions
            <span style={{ marginLeft: 8, color: T.textFaint, fontWeight: 500, letterSpacing: 0, fontFamily: T.fontMono, textTransform: 'none' }}>
              · {overdueBlocks.length}
            </span>
            <span style={{ marginLeft: 8, fontSize: 11, color: T.textFaint, fontFamily: T.fontBody, fontWeight: 400, letterSpacing: 0, textTransform: 'none', fontStyle: 'italic' }}>
              drag onto any day to reschedule
            </span>
          </div>
          {overdueBlocks.map(b => (
            <OverdueBlockRow
              key={b.id}
              block={b}
              todayD={data.todayDate}
              onClick={() => onSelectBlock && onSelectBlock(b)}
              onComplete={tbAction(b.id, 'complete')}
              onDelete={tbAction(b.id, 'delete')}
            />
          ))}
        </div>
      )}

      {hasT && (() => {
        const allRows = unifyDay(t);
        const { schedule, due } = partitionDayRows(allRows);
        const targetDate = viewDate || data.todayISO;
        const sectionBtn = (label, onClick) => (
          <button
            onClick={onClick}
            title={label}
            style={{
              marginLeft: 'auto',
              fontFamily: T.fontBody, fontSize: isMobile ? 13 : 11, fontWeight: 500,
              color: T.text, background: T.surface2,
              border: `1px solid ${T.border}`, borderRadius: 999,
              padding: isMobile ? '7px 14px' : '3px 10px', minHeight: isMobile ? 34 : 0,
              cursor: 'pointer', letterSpacing: 0, textTransform: 'none',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = T.accent; e.currentTarget.style.color = T.accent; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.text; }}
          >{label}</button>
        );
        return (
          <div>
            {/* Schedule — always rendered so the "+ add session" affordance is
                always reachable. Empty state is a faint inline note. */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ ...SECTION_LABEL, marginTop: 0, marginBottom: 6, display: 'flex', alignItems: 'center' }}>
                <span>
                  Schedule
                  <span style={{ marginLeft: 8, color: T.textFaint, fontWeight: 500, letterSpacing: 0, fontFamily: T.fontMono, textTransform: 'none' }}>
                    · {schedule.length}
                  </span>
                </span>
                {onAdd && sectionBtn('+ session', () => onAdd('timeblock', { date: targetDate }))}
              </div>
              {schedule.length > 0 ? schedule.map((row, i) => (
                <DayItemRow
                  key={'sch:' + (row.kind === 'issue' ? row.issue.id : row.timeblock?.id || row.event?.id) + ':' + i}
                  row={row}
                  onSelectIssue={onSelectIssue}
                  onTbAction={tbAction}
                  onSelectBlock={onSelectBlock}
                />
              )) : (
                <div style={{ fontSize: 12, color: T.textFaint, fontStyle: 'italic', padding: '4px 0' }}>
                  No sessions scheduled — hit <em>+ session</em> to add one.
                </div>
              )}
            </div>
            {/* Due — also always rendered (used to hide when empty). Lets the
                user create an issue due on this day in one click. */}
            <div>
              <div style={{ ...SECTION_LABEL, marginTop: 0, marginBottom: 6, display: 'flex', alignItems: 'center' }}>
                <span>
                  Due {isToday ? 'today' : 'this day'}
                  <span style={{ marginLeft: 8, color: T.textFaint, fontWeight: 500, letterSpacing: 0, fontFamily: T.fontMono, textTransform: 'none' }}>
                    · {due.length}
                  </span>
                </span>
                {onAdd && sectionBtn('+ item', () => onAdd('issue', { date: targetDate }))}
              </div>
              {due.length > 0 ? due.map((row, i) => (
                <DayItemRow
                  key={'due:' + row.issue.id + ':' + i}
                  row={row}
                  onSelectIssue={onSelectIssue}
                  onTbAction={tbAction}
                  onSelectBlock={onSelectBlock}
                />
              )) : (
                <div style={{ fontSize: 12, color: T.textFaint, fontStyle: 'italic', padding: '4px 0' }}>
                  Nothing due {isToday ? 'today' : 'this day'} — hit <em>+ item</em> to add one.
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </section>
  );
}

// Split a day's unified rows into:
//   • schedule = anything with a scheduled time (free timeblocks + issues that have at
//     least one timeblock for the day + recurring instances)
//   • due      = issues whose deadline lands on the day but have no time slot
// Each item appears in exactly one section.
function partitionDayRows(rows) {
  const schedule = [];
  const due = [];
  for (const row of rows) {
    if (row.kind === 'block') { schedule.push(row); continue; }
    if (row.kind === 'event') { schedule.push(row); continue; }
    // kind === 'issue'
    const hasTime = (row.timeblocks && row.timeblocks.length > 0) || !!row.primaryStart;
    if (hasTime) schedule.push(row);
    else if (row.isDeadline) due.push(row);
    else schedule.push(row); // recurring without start time — keep in schedule by convention
  }
  return { schedule, due };
}

function sectionFrame() {
  return {
    background: T.surface,
    border: `1px solid ${T.border}`,
    borderRadius: 12,
    padding: '20px 22px 18px',
    boxShadow: T.shadow,
  };
}
// Friendly relative label for the section subtitle when we're not on today.
function diffDayLabel(isoTarget, isoToday) {
  if (!isoTarget) return '';
  const t = parseISODate(isoTarget);
  const c = parseISODate(isoToday);
  if (!t || !c) return '';
  const d = diffDays(t, c);
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d === -1) return 'yesterday';
  if (d > 0) return `in ${d} days`;
  return `${Math.abs(d)} days ago`;
}

// ─── WEEK STRIP ──────────────────────────────────────────────────────
// 7-day rolling window with ←/→ arrows to navigate any week (past or future).
// Default window starts at today. Backend supports list_upcoming({from_date})
// so the same 42-day fetch can be re-rooted on demand for past weeks.
function WeekStrip({ data, viewDate, onSelectIssue, onSelectDay, onSelectBlock, onAddForDay, onDropOnDay, headerExtras }) {
  const isMobile = useIsMobile();
  // weekStart: the ISO date of the leftmost day in the strip. null = "use today".
  const [weekStart, setWeekStart] = vUseState(null);
  const [extDays, setExtDays] = vUseState(null);  // days_list when navigated to past/distant future
  const [loading, setLoading] = vUseState(false);

  const todayISO = data.todayISO;
  const todayD = data.todayDate;
  const effectiveStart = weekStart || todayISO;

  // When the user navigates to a date outside the preloaded 42-day window starting from
  // today, we fetch list_upcoming({from_date}) ourselves.
  vUseEffect(() => {
    if (!weekStart || weekStart === todayISO) { setExtDays(null); return; }
    const startD = parseISODate(weekStart);
    if (!startD) { setExtDays(null); return; }
    const startMs = startOfDay(startD).getTime();
    const todayMs = startOfDay(todayD).getTime();
    const dayOffset = Math.round((startMs - todayMs) / 86400000);
    // If start falls within data.upcoming's 42-day window starting today, we can slice locally.
    if (dayOffset >= 0 && dayOffset + 7 <= 42 && data.upcoming?.days_list) {
      setExtDays(null);  // signal: use sliced data.upcoming
      return;
    }
    let alive = true;
    setLoading(true);
    api('list_upcoming', { days: 7, from_date: weekStart })
      .then(r => { if (alive) { setExtDays(r.days_list || []); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [weekStart, todayISO, data.upcoming]);

  // Build the visible 7-day slice. Prefer the external fetch when present; otherwise
  // slice the preloaded upcoming window based on the offset from today.
  let days = [];
  if (extDays) {
    days = extDays;
  } else if (data.upcoming?.days_list) {
    const startD = parseISODate(effectiveStart);
    const dayOffset = startD ? Math.round((startOfDay(startD).getTime() - startOfDay(todayD).getTime()) / 86400000) : 0;
    days = (data.upcoming.days_list || []).slice(Math.max(0, dayOffset), Math.max(0, dayOffset) + 7);
    if (days.length === 0) days = (data.upcoming.days_list || []).slice(0, 7);  // fallback safety
  }
  if (!days.length) return null;

  const shiftWeek = (deltaDays) => {
    const base = parseISODate(effectiveStart) || todayD;
    const next = new Date(base.getTime() + deltaDays * 86400000);
    setWeekStart(fmtISO(next));
  };
  const resetToToday = () => setWeekStart(null);

  // Friendly window label, e.g. "Next 7 days" / "Mon 11 May → Sun 17 May"
  const firstDate = parseISODate(days[0]?.date);
  const lastDate = parseISODate(days[days.length - 1]?.date);
  const includesToday = days.some(d => d.date === todayISO);
  let windowLabel = 'Next 7 days';
  if (!includesToday && firstDate && lastDate) {
    const f = `${dayName(firstDate)} ${firstDate.getDate()} ${monthAbbrev(firstDate)}`;
    const l = `${dayName(lastDate)} ${lastDate.getDate()} ${monthAbbrev(lastDate)}`;
    windowLabel = `${f} → ${l}`;
  }

  return (
    <section style={{ width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10, marginTop: 24 }}>
        <div style={{ ...SECTION_LABEL, margin: 0 }}>{windowLabel}</div>
        {loading && <span style={{ fontSize: 11, color: T.textFaint, fontStyle: 'italic' }}>loading…</span>}
        <div style={{ flex: 1 }} />
        {headerExtras}
        {!includesToday && (
          <button onClick={resetToToday} title="back to current week" style={{
            background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 999,
            padding: '3px 10px', fontFamily: T.fontBody, fontSize: 11, fontWeight: 500,
            color: T.text, cursor: 'pointer',
          }}>Today</button>
        )}
        <button onClick={() => shiftWeek(-7)} title="previous week" style={weekArrowStyle(isMobile)}>‹</button>
        <button onClick={() => shiftWeek(7)} title="next week" style={weekArrowStyle(isMobile)}>›</button>
      </div>
      {/* Mobile: one day per ROW (full width, auto height) — every session is
          readable without swiping. Desktop keeps the 7-column strip. */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: window.matchMedia('(max-width: 768px)').matches ? '1fr' : `repeat(${days.length}, minmax(0, 1fr))`,
        gap: window.matchMedia('(max-width: 768px)').matches ? 6 : 8,
        width: '100%',
      }}>
        {days.map(d => (
          <DayCard
            key={d.date}
            day={d}
            isToday={d.date === todayISO}
            isSelected={viewDate && d.date === viewDate && d.date !== todayISO}
            onSelectIssue={onSelectIssue}
            onSelectDay={onSelectDay}
            onSelectBlock={onSelectBlock}
            onAddForDay={onAddForDay}
            onDropOnDay={onDropOnDay}
          />
        ))}
      </div>
      {/* Deadlines lane — sits under the strip so the user can see every due date
          for the visible window side-by-side with the scheduled blocks above.
          Without this, due-only items (no timeblock yet) are invisible in the
          per-day cells, which made it hard to plan a week. */}
      {/* Deadlines now render inside each day bubble on mobile — the lane would
          just repeat them. Desktop keeps it: its day cells are too narrow. */}
      {!isMobile && <DeadlinesSection days={days} todayISO={todayISO} onSelectIssue={onSelectIssue} />}
    </section>
  );
}

// Lists every issue whose due date falls inside the currently-visible WeekStrip window.
// Sub-issues show with their parent breadcrumb. Sorted by due date, then priority, then id.
// Renders nothing when the window has no deadlines.
function DeadlinesSection({ days, todayISO, onSelectIssue }) {
  const items = vUseMemo(() => {
    const out = [];
    const seen = new Set();
    for (const day of (days || [])) {
      for (const it of (day.items || [])) {
        if (it.recurring) continue;                 // recurring lives on the timeblock now
        if (it.is_completed) continue;              // archived issues stay hidden
        if (!it.due || it.due !== day.date) continue;
        const k = `${it.epic_slug}:${it.id}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(it);
      }
    }
    const PRIO = { high: 0, medium: 1, low: 2 };
    out.sort((a, b) => {
      if (a.due !== b.due) return a.due.localeCompare(b.due);
      const pa = PRIO[a.priority] ?? 1, pb = PRIO[b.priority] ?? 1;
      if (pa !== pb) return pa - pb;
      return a.id.localeCompare(b.id);
    });
    return out;
  }, [days]);

  if (items.length === 0) return null;

  return (
    <section style={{ marginTop: 18 }}>
      <div style={{ ...SECTION_LABEL, marginTop: 0, marginBottom: 8 }}>
        Deadlines
        <span style={{ marginLeft: 8, color: T.textFaint, fontFamily: T.fontMono, fontWeight: 500, letterSpacing: 0, textTransform: 'none' }}>
          · {items.length}
        </span>
      </div>
      <div>
        {items.map(it => (
          <DeadlineRow
            key={`${it.epic_slug}:${it.id}`}
            issue={it}
            isToday={it.due === todayISO}
            onClick={() => onSelectIssue({ id: it.id, epic_slug: it.epic_slug })}
          />
        ))}
      </div>
    </section>
  );
}

function DeadlineRow({ issue, isToday, onClick }) {
  const c = epicColor(issue.epic_slug, issue.epic_slug.split('/')[0]);
  // Compact relative-day label so the eye can spot "today" / "Wed" at a glance.
  const d = parseISODate(issue.due);
  const dayLabel = d ? `${dayName(d)} ${d.getDate()}` : issue.due;
  const startDrag = (e) => {
    try {
      e.dataTransfer.setData('application/x-todouz', JSON.stringify({
        kind: 'issue', id: issue.id, epic_slug: issue.epic_slug, currentDate: issue.due,
      }));
      e.dataTransfer.effectAllowed = 'move';
    } catch {}
  };
  return (
    <div
      draggable
      onDragStart={startDrag}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      title="drag to a day to reschedule · click to open"
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 12px', marginBottom: 4,
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderLeft: `3px solid ${c}`,
        borderRadius: 6, cursor: 'grab',
        transition: 'background 0.12s ease',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = T.surfaceHover; }}
      onMouseLeave={e => { e.currentTarget.style.background = T.surface; }}
    >
      <span style={{
        fontFamily: T.fontMono, fontSize: 11, fontWeight: 600,
        color: isToday ? T.overdue : T.textMuted,
        minWidth: 56, flexShrink: 0,
      }}>{isToday ? 'TODAY' : dayLabel}</span>
      <PriorityDot priority={issue.priority} />
      <EpicTag epicSlug={issue.epic_slug} />
      <ParentTrace parent_id={issue.parent_issue_id} parent_title={issue.parent_title} />
      <span style={{
        flex: 1, fontSize: 13, color: T.text,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{issue.title}</span>
      <span style={{ fontSize: 11, color: T.textMuted, fontFamily: T.fontMono, fontVariantNumeric: 'tabular-nums' }}>
        {formatDue(issue.due, issue.due_time)}
      </span>
    </div>
  );
}

// One overdue/unfinished timeblock. Draggable so the user can drop it on any
// day card to reschedule. Click → open TimeblockDrawer; ✓ marks it complete,
// ✕ deletes it.
function OverdueBlockRow({ block, todayD, onClick, onComplete, onDelete }) {
  const isMobile = useIsMobile();
  const c = block.epic_slug ? epicColor(block.epic_slug, block.epic_slug.split('/')[0]) : T.textMuted;
  const d = parseISODate(block.date);
  const daysOld = d ? Math.round((startOfDay(todayD).getTime() - startOfDay(d).getTime()) / 86400000) : 0;
  const stamp = d ? `${dayName(d)} ${d.getDate()} ${monthAbbrev(d)}` : block.date;
  const startDrag = (e) => {
    try {
      e.dataTransfer.setData('application/x-todouz', JSON.stringify({
        kind: 'block', id: block.id, currentDate: block.date,
      }));
      e.dataTransfer.effectAllowed = 'move';
    } catch {}
  };
  return (
    <div
      draggable
      onDragStart={startDrag}
      onClick={onClick}
      role="button"
      title="drag to a day to reschedule · click to open"
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 12px', marginBottom: 4,
        background: T.surface,
        border: `1px solid ${withAlpha('#b91c1c', 0.25)}`,
        borderLeft: `3px solid ${c}`,
        borderRadius: 6, cursor: 'grab',
        transition: 'background 0.12s ease',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = T.surfaceHover; }}
      onMouseLeave={e => { e.currentTarget.style.background = T.surface; }}
    >
      <span style={{
        fontFamily: T.fontMono, fontSize: 11, fontWeight: 600,
        color: T.overdue, minWidth: 96, flexShrink: 0,
      }} title={`${daysOld} day${daysOld === 1 ? '' : 's'} ago`}>
        {stamp} {daysOld > 0 && <span style={{ fontWeight: 500 }}>·{daysOld}d</span>}
      </span>
      {/* Time removed from the day view (ISS-008) — the day + overdue count stay;
          reschedule by dragging to a day, or open it to see/change the slot. */}
      <EpicTag epicSlug={block.epic_slug} />
      <span style={{
        flex: 1, fontSize: 13, color: T.text,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{block.title}</span>
      <button
        onClick={e => { e.stopPropagation(); onComplete && onComplete(); }}
        title="mark complete"
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 6px',
          color: T.done, fontSize: 14, lineHeight: 1, borderRadius: 4,
        }}
      >✓</button>
      <button
        onClick={e => { e.stopPropagation(); if (confirm('Delete this timeblock?')) onDelete && onDelete(); }}
        title="delete"
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 6px',
          color: T.overdue, fontSize: 14, lineHeight: 1, borderRadius: 4,
        }}
      >✕</button>
    </div>
  );
}

function weekArrowStyle(isMobile) {
  return {
    background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6,
    width: isMobile ? 36 : 26, height: isMobile ? 36 : 26, padding: 0,
    fontFamily: T.fontDisplay, fontSize: isMobile ? 20 : 16, color: T.text,
    cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    lineHeight: 1,
  };
}
function monthAbbrev(d) {
  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
}

function DayCard({ day, isToday, isSelected, onSelectIssue, onSelectDay, onSelectBlock, onAddForDay, onDropOnDay }) {
  const isWeekend = day.weekday === 'Sat' || day.weekday === 'Sun';
  // Translate week-strip day shape ({items, events, timeblocks}) to the unified
  // input format expected by unifyDay (which knows due_today vs recurring_today).
  const dueOrRecurring = (day.items || []).map(it => ({ ...it }));
  const due = dueOrRecurring.filter(it => !it.recurring);
  const recurring = dueOrRecurring.filter(it => it.recurring);
  const allRows = unifyDay({
    due_today: due,
    recurring_today: recurring,
    timeblocks_today: day.timeblocks || [],
    events_today: day.events || [],
  });
  const isMobile = useIsMobile();
  // Desktop cells are one narrow column of seven, so they stay focused on what's
  // happening at a time-of-day and deadlines live in the lane underneath. On a
  // phone each day is a full-width row with room to spare, and pushing deadlines
  // to a list below the week meant you couldn't see what was actually due on a
  // given day — so they belong in the bubble.
  const rows = isMobile
    ? allRows
    : allRows.filter(r => r.kind === 'block' || (r.kind === 'issue' && r.timeblocks && r.timeblocks.length > 0));
  const visible = isMobile ? rows : rows.slice(0, 4);
  const more = rows.length - visible.length;
  const [dragOver, setDragOver] = vUseState(false);
  const [hover, setHover] = vUseState(false);

  // Whole-card navigation: any click that didn't land on an interactive child (button / row)
  // navigates the Today section to this day. We use `closest` to detect interactive ancestors.
  const cardClick = (e) => {
    if (!onSelectDay) return;
    if (e.target.closest('button, [data-rowclick="1"]')) return;
    onSelectDay(day.date);
  };

  return (
    <div
      onClick={cardClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onDragOver={(e) => { if (onDropOnDay) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        setDragOver(false);
        if (!onDropOnDay) return;
        e.preventDefault();
        try {
          const payload = JSON.parse(e.dataTransfer.getData('application/x-todouz') || '{}');
          if (payload && payload.kind) onDropOnDay(day.date, payload);
        } catch {}
      }}
      style={{
        background: dragOver ? withAlpha('#c2410c', 0.18)
                  : isSelected ? withAlpha('#c2410c', 0.10)
                  : isToday ? T.surface
                  : (isWeekend ? T.surface2 : T.surface),
        border: `1px solid ${dragOver ? T.accent : isSelected ? T.accent : isToday ? T.text : T.border}`,
        borderRadius: 8,
        padding: isMobile ? '8px 10px' : 8,
        minHeight: isMobile ? 0 : 110,
        display: 'flex',
        flexDirection: isMobile ? 'row' : 'column',
        alignItems: isMobile ? 'flex-start' : 'stretch',
        gap: isMobile ? 10 : 0,
        minWidth: 0, overflow: 'hidden',
        boxShadow: (isToday || isSelected) ? T.shadowSm : 'none',
        cursor: onSelectDay ? 'pointer' : 'default',
        position: 'relative',
      }}
    >
      {/* Date rail: a left-hand column on mobile, a header line on desktop. */}
      <div style={{
        display: 'flex',
        alignItems: isMobile ? 'center' : 'baseline',
        gap: 6,
        marginBottom: isMobile ? 0 : 6,
        flexDirection: isMobile ? 'column' : 'row',
        width: isMobile ? 42 : 'auto',
        flexShrink: 0,
      }}>
        <div style={{
          fontFamily: T.fontDisplay, fontSize: 16, fontWeight: 600,
          color: isToday ? T.accent : T.text,
        }}>{day.weekday}</div>
        <div style={{
          fontSize: isMobile ? 15 : 12,
          fontWeight: isMobile ? 600 : 400,
          color: isToday ? T.accent : T.textFaint,
          fontFamily: T.fontMono,
          fontVariantNumeric: 'tabular-nums',
        }}>{day.date.slice(8)}</div>
        <span style={{ flex: isMobile ? 0 : 1 }} />
        {(hover || isMobile) && onAddForDay && !isMobile && (
          <button
            onClick={(e) => { e.stopPropagation(); onAddForDay(day.date); }}
            title="add something to this day"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: T.textMuted, fontSize: 14, padding: '0 2px', lineHeight: 1,
            }}
          >+</button>
        )}
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, alignSelf: 'stretch' }}>
        {isMobile && rows.length === 0 && (
          <div style={{ fontSize: 12, color: T.textFaint, fontStyle: 'italic', padding: '3px 0' }}>nothing scheduled</div>
        )}
        {visible.map((row, i) => <CompactDayRow key={i} row={row} onSelectIssue={onSelectIssue} onSelectBlock={onSelectBlock} />)}
        {more > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); onSelectDay && onSelectDay(day.date); }}
            style={{
              fontSize: 10, color: T.accent, padding: '2px 6px',
              background: 'transparent', border: 'none', textAlign: 'left',
              cursor: 'pointer', fontWeight: 500,
            }}
          >+{more} more →</button>
        )}
      </div>
    </div>
  );
}

// Compact one-line row used in WeekStrip + CalendarMonth cells. Same icon vocabulary as
// DayItemRow, just smaller. Rows are also drag sources — drop them on another DayCard /
// calendar cell to reschedule (timeblock → change date, issue → change due date).
function CompactDayRow({ row, onSelectIssue, onSelectBlock }) {
  // Build a drag payload identifying what's being moved. The drop handler resolves
  // it back to the right MCP call (update_timeblock for blocks, update_issue for issues).
  let payload = null;
  if (row.kind === 'block') payload = { kind: 'block', id: row.timeblock.id, currentDate: row.timeblock.date };
  else if (row.kind === 'issue' && row.timeblocks.length > 0) payload = { kind: 'block', id: row.timeblocks[0].id, currentDate: row.timeblocks[0].date };
  else if (row.kind === 'issue') payload = { kind: 'issue', id: row.issue.id, epic_slug: row.issue.epic_slug, currentDate: row.issue.due };

  const dragProps = payload ? {
    draggable: true,
    onDragStart: (e) => {
      e.stopPropagation();
      try { e.dataTransfer.setData('application/x-todouz', JSON.stringify(payload)); } catch {}
      e.dataTransfer.effectAllowed = 'move';
    },
  } : {};

  if (row.kind === 'block') {
    const tb = row.timeblock;
    const c = tb.epic_slug ? epicColor(tb.epic_slug, tb.epic_slug.split('/')[0]) : T.textMuted;
    return (
      <div
        data-rowclick="1"
        {...dragProps}
        onClick={(e) => {
          e.stopPropagation();
          if (tb.issue_id) onSelectIssue({ id: tb.issue_id, epic_slug: tb.epic_slug });
          else if (onSelectBlock) onSelectBlock(tb);
        }}
        title={`${tb.start}–${tb.end} · ${tb.title}  (drag to reschedule)`}
        style={{
          fontSize: 11, color: T.text,
          cursor: 'grab',
          padding: '3px 6px', borderRadius: 3,
          background: T.surface2,
          borderLeft: `2px dashed ${c}`,
          display: 'flex', alignItems: 'center', gap: 4,
          overflow: 'hidden', whiteSpace: 'nowrap',
          opacity: tb.completed ? 0.5 : 1,
          textDecoration: tb.completed ? 'line-through' : 'none',
        }}
      >
        <span style={{ color: c, display: 'inline-flex', flexShrink: 0 }}><Icon kind="work" size={10} /></span>
        <span style={{ fontFamily: T.fontMono, fontWeight: 500, color: c, flexShrink: 0 }}>{tb.start}</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{tb.title}</span>
      </div>
    );
  }
  if (row.kind === 'event') {
    const e = row.event;
    const c = categoryColor(e.category);
    return (
      <div data-rowclick="1" title={e.title} style={{
        fontSize: 10, color: T.textMuted, fontStyle: 'italic',
        padding: '2px 6px',
        display: 'flex', alignItems: 'center', gap: 4,
        overflow: 'hidden', whiteSpace: 'nowrap',
      }}>
        <span style={{ color: c, display: 'inline-flex', flexShrink: 0 }}><Icon kind="event" size={10} /></span>
        {e.time && <span style={{ fontFamily: T.fontMono, color: c, flexShrink: 0 }}>{e.time}</span>}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.title}</span>
      </div>
    );
  }
  // kind === 'issue'
  const it = row.issue;
  const c = epicColor(it.epic_slug, it.epic_slug.split('/')[0]);
  const hasTb = row.timeblocks.length > 0;
  const iconKind = hasTb ? 'work' : row.isDeadline ? 'deadline' : row.isRecurring ? 'recurring' : 'work';
  return (
    <div
      data-rowclick="1"
      {...dragProps}
      onClick={(e) => { e.stopPropagation(); onSelectIssue({ id: it.id, epic_slug: it.epic_slug }); }}
      title={`${it.title}  (drag to reschedule)`}
      style={{
        fontSize: 11, color: T.text, cursor: 'grab',
        padding: '3px 6px', borderRadius: 3,
        background: T.surface,
        borderLeft: `2px ${hasTb ? 'dashed' : 'solid'} ${c}`,
        border: `1px solid ${T.border}`,
        borderLeftWidth: 2,
        display: 'flex', alignItems: 'center', gap: 4,
        overflow: 'hidden', whiteSpace: 'nowrap',
      }}
    >
      <span style={{ color: c, display: 'inline-flex', flexShrink: 0 }}><Icon kind={iconKind} size={10} /></span>
      {hasTb && (
        <span style={{ fontFamily: T.fontMono, fontWeight: 500, color: c, flexShrink: 0 }}>{row.timeblocks[0].start}</span>
      )}
      {!hasTb && (
        <span style={{ fontFamily: T.fontMono, fontWeight: 500, color: c, flexShrink: 0 }}>{it.epic_slug.split('/')[1]}</span>
      )}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.title}</span>
    </div>
  );
}

// ─── EPICS GRID ──────────────────────────────────────────────────────
function EpicsGrid({ data, onSelectIssue, onSelectEpic, onRefresh }) {
  if (!data.epics) return null;
  const byCat = vUseMemo(() => {
    const m = {};
    for (const e of data.epics.epics) (m[e.category] = m[e.category] || []).push(e);
    return m;
  }, [data.epics]);
  const order = ['work', 'projects', 'learning', 'health', 'home', 'personal'];
  const cats = order.filter(c => byCat[c]);

  return (
    <section>
      <div style={SECTION_LABEL}>Epics</div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 14,
      }}>
        {cats.map(cat => (
          <div key={cat} style={{
            background: T.surface,
            border: `1px solid ${T.border}`,
            borderRadius: 10,
            padding: '14px 14px 10px',
            boxShadow: T.shadow,
          }}>
            <div style={{
              display: 'flex', alignItems: 'baseline', gap: 8,
              paddingBottom: 8, marginBottom: 10,
              borderBottom: `1px solid ${T.border}`,
            }}>
              <h3 style={{
                fontFamily: T.fontDisplay, fontSize: 17, fontWeight: 600, color: T.text,
                margin: 0,
              }}>{cat}</h3>
              <span style={{ fontSize: 11, color: T.textFaint, fontFamily: T.fontMono }}>{byCat[cat].length}</span>
            </div>
            {byCat[cat].map(epic => (
              <EpicCard key={epic.slug} epic={epic} onSelectIssue={onSelectIssue} onSelectEpic={onSelectEpic} onRefresh={onRefresh} />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

// `bare` renders the folder's items with no folder header/chrome — used for a
// list's default "inbox" folder so its items read as loose items sitting
// directly under the list, at the same level as folders.
function EpicCard({ epic, filterTags, filterPriorities, filterAssignees, onSelectIssue, onSelectEpic, onRefresh, draggable, dataTick, bare }) {
  const [open, setOpen] = vUseState(!!bare);   // bare cards are always expanded
  const [issues, setIssues] = vUseState(null);
  const [adding, setAdding] = vUseState(false);
  const [draft, setDraft] = vUseState('');
  const [addingFolder, setAddingFolder] = vUseState(false);   // create a folder-type child (nested folder)
  const [folderDraft, setFolderDraft] = vUseState('');
  const [issueDragOver, setIssueDragOver] = vUseState(false);
  // Inline rename of the folder title (double-click / double-tap the heading).
  const [renaming, setRenaming] = vUseState(false);
  const [renameDraft, setRenameDraft] = vUseState(epic.title || '');
  // Delay-and-cancel pattern: single tap toggles the peek, a second tap within
  // the window renames. Manual double-tap detection (lastTapRef) so it works on
  // touch, where the native dblclick often never fires.
  const clickTimerRef = vUseRef(null);
  const lastTapRef = vUseRef(0);

  // We fetch both issues + timeblocks so each issue row can show "🕐 N" — the count
  // of scheduled work sessions linked to it. This makes the issue↔timeblock link
  // visible at a glance without having to open the IssueDrawer.
  const [tbByIssue, setTbByIssue] = vUseState({});
  const fetchIssues = vUseCallback(async () => {
    try {
      // Fetch open + completed in one shot so we can render completed items at the
      // bottom of the peek with strikethrough/check — the user sees their work being
      // marked off rather than items silently vanishing on complete.
      const [r, tb] = await Promise.all([
        api('list_issues', { epic: epic.slug, status: 'all' }),
        api('list_timeblocks', { from_date: fmtISO(startOfDay(new Date())), to_date: fmtISO(new Date(Date.now() + 90 * 86400000)), epic_slug: epic.slug }),
      ]);
      setIssues(r.issues || []);
      const m = {};
      for (const b of (tb.blocks || [])) {
        if (b.issue_id && !b.completed) (m[b.issue_id] = m[b.issue_id] || []).push(b);
      }
      setTbByIssue(m);
    } catch { setIssues([]); setTbByIssue({}); }
  }, [epic.slug]);

  // Re-fetch whenever the dashboard data version moves. open_issue_count used to
  // stand in for "something changed", but it only moves on create/complete — edits
  // to tags, title, priority or due date left this peek showing stale rows.
  vUseEffect(() => {
    if (open) fetchIssues();
  }, [open, dataTick, epic.open_issue_count, epic.next_due, fetchIssues]);

  const toggle = async () => {
    if (!open) await fetchIssues();
    setOpen(o => !o);
  };

  // Tag chips in the category bubble act as "show me the matches" — auto-expand
  // collapsed cards while a filter is active so results are actually visible.
  vUseEffect(() => {
    const active = (filterTags && filterTags.length) || (filterPriorities && filterPriorities.length) || (filterAssignees && filterAssignees.length);
    if (active && !open) {
      fetchIssues().then(() => setOpen(true));
    }
  }, [filterTags && filterTags.join(','), filterPriorities && filterPriorities.join(','), filterAssignees && filterAssignees.join(',')]);

  const submitAdd = async () => {
    const title = draft.trim();
    if (!title) { setAdding(false); return; }
    try {
      const r = await api('create_issue', { epic: epic.slug, title, priority: 'medium' });
      // api() resolves on 2xx responses regardless of body — server returns
      // { error } in-band, so we have to inspect that explicitly.
      if (r?.error) { alert(r.error); return; }
      setDraft('');
      setAdding(false);
      await fetchIssues();
      onRefresh && onRefresh();
      // Open the new issue's drawer so the user can fill in description / due /
      // priority without having to cram everything into the inline pill.
      if (r?.id && onSelectIssue) onSelectIssue({ id: r.id, epic_slug: r.epic_slug || epic.slug });
    } catch (e) {
      alert('create failed: ' + (e?.message || e));
    }
  };

  // Create a folder-type child inside this folder (a nested folder). Stays put —
  // no drawer hand-off — so you can keep adding sub-folders quickly.
  const submitAddFolder = async () => {
    const title = folderDraft.trim();
    if (!title) { setAddingFolder(false); return; }
    try {
      const r = await api('create_issue', { epic: epic.slug, title, type: 'folder' });
      if (r?.error) { alert(r.error); return; }
      setFolderDraft('');
      setAddingFolder(false);
      await fetchIssues();
      onRefresh && onRefresh();
    } catch (e) {
      alert('create folder failed: ' + (e?.message || e));
    }
  };

  const startRename = () => { setRenameDraft(epic.title || ''); setRenaming(true); };
  const submitRename = async () => {
    const next = renameDraft.trim();
    setRenaming(false);
    if (!next || next === epic.title) return;
    try {
      const r = await api('update_epic', { slug: epic.slug, patch: { title: next } });
      if (r?.error) { alert(r.error); return; }
      onRefresh && onRefresh();
    } catch (e) { alert('rename failed: ' + (e?.message || e)); }
  };
  const onHeaderClick = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {           // double tap → rename
      lastTapRef.current = 0;
      if (clickTimerRef.current) { clearTimeout(clickTimerRef.current); clickTimerRef.current = null; }
      startRename();
      return;
    }
    lastTapRef.current = now;
    if (clickTimerRef.current) return;
    clickTimerRef.current = setTimeout(() => { clickTimerRef.current = null; toggle(); }, 280);
  };
  const onHeaderDouble = () => {                     // desktop native dblclick
    if (clickTimerRef.current) { clearTimeout(clickTimerRef.current); clickTimerRef.current = null; }
    lastTapRef.current = 0;
    startRename();
  };
  const deleteFolder = async (e) => {
    e.stopPropagation();
    if (!confirm(`Delete the folder "${epic.title}"? This is permanent.`)) return;
    try {
      const r = await api('delete_epic', { slug: epic.slug });
      if (r?.error) { alert(r.error); return; }
      onRefresh && onRefresh();
    } catch (err) { alert('delete failed: ' + (err?.message || err)); }
  };

  // Render the full open tree by default: top-level issues with their open
  // sub-issues nested (indented) beneath, arbitrary depth via _depth. Completed
  // items collapse to the "N done" section at the bottom regardless of depth.
  const { openIssues, doneIssues } = vUseMemo(() => {
    if (!issues) return { openIssues: null, doneIssues: null };
    const childMap = new Map();
    const childCount = new Map();
    for (const it of issues) {
      if (it.parent_issue_id) {
        childCount.set(it.parent_issue_id, (childCount.get(it.parent_issue_id) || 0) + 1);
        if (!childMap.has(it.parent_issue_id)) childMap.set(it.parent_issue_id, []);
        childMap.get(it.parent_issue_id).push(it);
      }
    }
    // Tag filter (from the category bubble's chips): an issue stays visible if
    // it matches OR any descendant matches — so folders/parents remain as
    // context around their matching children.
    const want = filterTags || [];
    const wantP = filterPriorities || [];
    const wantA = filterAssignees || [];
    const anyFilter = want.length || wantP.length || wantA.length;
    const matches = (it) =>
      (!want.length || want.every(t => (it.tags || []).includes(t))) &&
      (!wantP.length || wantP.includes(it.priority || 'medium')) &&
      (!wantA.length || (() => { const a = Array.isArray(it.assign_to) ? it.assign_to : (it.assign_to ? [it.assign_to] : []); return wantA.some(u => a.includes(u)); })());
    const hasMatchingDesc = (it) => {
      for (const k of (childMap.get(it.id) || [])) {
        if (matches(k) || hasMatchingDesc(k)) return true;
      }
      return false;
    };
    const flat = [];
    // Track the chain of ancestor FOLDER ids so a collapsed folder can hide its
    // whole subtree (folders act as collapsible containers, not flat nesting).
    const walk = (it, depth, ancestors) => {
      if (it.is_completed) return;                          // done handled separately
      if (anyFilter && !matches(it) && !hasMatchingDesc(it)) return;
      flat.push({ ...it, _depth: depth, _child_count: childCount.get(it.id) || 0, _ancestors: ancestors });
      const kids = (childMap.get(it.id) || []).filter(k => !k.template_id);
      kids.sort((a, b) => (a.id || '').localeCompare(b.id || ''));
      const nextAnc = (it.type === 'folder') ? [...ancestors, it.id] : ancestors;
      for (const k of kids) walk(k, depth + 1, nextAnc);
    };
    const top = issues.filter(it => !it.parent_issue_id && !it.template_id);
    for (const it of top.filter(it => !it.is_completed)) walk(it, 0, []);
    return {
      openIssues: flat,
      doneIssues: issues.filter(it => it.is_completed && !it.template_id),
    };
  }, [issues, filterTags, filterPriorities, filterAssignees]);
  const [showDone, setShowDone] = vUseState(false);
  // Folder-type rows collapse by default (empty set = all collapsed). Expanding
  // a folder reveals its children. A tag filter forces everything open so
  // matches aren't hidden behind a collapsed folder.
  const [expandedFolders, setExpandedFolders] = vUseState(() => new Set());
  const toggleFolder = vUseCallback((id) => {
    setExpandedFolders(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);
  const filtering = !!((filterTags && filterTags.length) || (filterPriorities && filterPriorities.length) || (filterAssignees && filterAssignees.length));
  const rowVisible = (it) => filtering || (it._ancestors || []).every(a => expandedFolders.has(a));

  const c = epicColor(epic.slug, epic.category);

  // Drag-and-drop: the header is the drag source (drag the whole epic), and the
  // header itself is also a drop target for dragged issues — drop an issue row
  // onto an epic header to call move_issue and re-home it. We deliberately
  // attach handlers to the header (not the wrapping div) so DnD doesn't get
  // confused by nested drag handles when the inline-issue list is expanded.
  const startEpicDrag = (e) => {
    if (!draggable) return;
    try {
      e.dataTransfer.setData('application/x-todouz', JSON.stringify({ kind: 'epic', slug: epic.slug }));
      e.dataTransfer.effectAllowed = 'move';
    } catch {}
  };
  const onIssueDragOver = (e) => {
    if (!e.dataTransfer.types.includes('application/x-todouz')) return;
    e.preventDefault();
    e.stopPropagation();              // don't bubble to the CategoryColumn behind us
    setIssueDragOver(true);
  };
  const onIssueDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIssueDragOver(false);
    let payload;
    try { payload = JSON.parse(e.dataTransfer.getData('application/x-todouz') || '{}'); } catch { return; }
    if (!payload) return;
    if (payload.kind === 'issue') {
      if (!payload.id || !payload.epic_slug) return;
      if (payload.epic_slug === epic.slug) return;       // dropped on its own home
      try {
        await api('move_issue', { id: payload.id, epic: payload.epic_slug, target_epic: epic.slug });
        await fetchIssues();
        onRefresh && onRefresh();
      } catch (err) { alert(err.message || 'move failed'); }
    }
    // Epic-on-epic drops aren't meaningful (categories are the move target) — ignored.
  };
  // Drop an item ONTO a folder row → make it a child of that folder
  // (parent_issue_id). If the item lives in a different list, move it here first
  // (move_issue reassigns the id), then re-parent.
  const reparentToFolder = async (folderIt, payload) => {
    if (!payload || payload.kind !== 'issue' || !payload.id || !payload.epic_slug) return;
    if (payload.id === folderIt.id && payload.epic_slug === folderIt.epic_slug) return;   // onto itself
    // No cycles: refuse if the drop target sits inside the dragged item's own subtree.
    const byId = new Map((issues || []).map(x => [x.id, x]));
    for (let cur = folderIt, hops = 0; cur && hops < 100; hops++) {
      if (cur.id === payload.id && cur.epic_slug === payload.epic_slug) return;
      cur = cur.parent_issue_id ? byId.get(cur.parent_issue_id) : null;
    }
    try {
      let id = payload.id, ep = payload.epic_slug;
      if (ep !== folderIt.epic_slug) {
        const moved = await api('move_issue', { id, epic: ep, target_epic: folderIt.epic_slug });
        if (moved && moved.id) { id = moved.id; ep = moved.epic_slug || folderIt.epic_slug; }
      }
      await api('update_issue', { id, epic: ep, patch: { parent_issue_id: folderIt.id } });
      await fetchIssues();
      onRefresh && onRefresh();
    } catch (err) { alert(err.message || 'move into folder failed'); }
  };

  if (bare) {
    // Loose items: no header, always open, no inline quick-add (the list-level
    // "+ add item" owns adds). Just the item rows + a collapsed done section.
    return (
      <div style={{ marginBottom: openIssues && openIssues.length ? 4 : 0 }}>
        {openIssues && openIssues.filter(rowVisible).map(it => (
          <EpicIssueRow key={it.id} it={it} c={c} tbByIssue={tbByIssue} onSelectIssue={onSelectIssue} isExpanded={expandedFolders.has(it.id)} onToggleFolder={toggleFolder} onDropOnFolder={reparentToFolder} />
        ))}
        {doneIssues && doneIssues.length > 0 && (
          <div style={{ marginTop: 4 }}>
            <button
              onClick={() => setShowDone(v => !v)}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px 6px', fontFamily: T.fontBody, fontSize: 11, color: T.textMuted, fontWeight: 500 }}
            >{showDone ? '▾' : '▸'} {doneIssues.length} done</button>
            {showDone && doneIssues.map(it => (
              <EpicIssueRow key={it.id} it={it} c={c} tbByIssue={tbByIssue} onSelectIssue={onSelectIssue} done />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 6 }}>
      <div
        onClick={onHeaderClick}
        onDoubleClick={onHeaderDouble}
        draggable={!!draggable}
        onDragStart={startEpicDrag}
        onDragOver={onIssueDragOver}
        onDragLeave={() => setIssueDragOver(false)}
        onDrop={onIssueDrop}
        role="button"
        title={draggable ? "tap to peek · double-tap to rename · drag to move" : "tap to peek · double-tap to rename"}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '7px 10px',
          background: issueDragOver ? withAlpha(c, 0.12) : 'transparent',
          border: `1px solid ${issueDragOver ? c : T.border}`,
          borderLeft: `3px solid ${c}`,
          borderRadius: 6,
          cursor: draggable ? 'grab' : 'pointer',
          transition: 'background 0.12s, border-color 0.12s',
          userSelect: 'none', // suppress text-selection on rapid clicks
        }}
        onMouseEnter={e => { if (!issueDragOver) e.currentTarget.style.background = T.surfaceHover; }}
        onMouseLeave={e => { if (!issueDragOver) e.currentTarget.style.background = 'transparent'; }}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            // also cancel any pending header-click toggle so the chevron stays "instant"
            if (clickTimerRef.current) { clearTimeout(clickTimerRef.current); clickTimerRef.current = null; }
            toggle();
          }}
          title={open ? 'collapse' : 'peek at open items'}
          style={{
            color: T.textFaint, fontSize: 12, width: 18, height: 18,
            background: 'transparent', border: 'none', cursor: 'pointer',
            padding: 0, lineHeight: 1, borderRadius: 3,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = withAlpha(c, 0.10); }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >{open ? '▾' : '▸'}</button>
        {renaming ? (
          <input
            autoFocus
            value={renameDraft}
            onClick={e => e.stopPropagation()}
            onChange={e => setRenameDraft(e.target.value)}
            onKeyDown={e => {
              e.stopPropagation();
              if (e.key === 'Enter') { e.preventDefault(); submitRename(); }
              if (e.key === 'Escape') { setRenaming(false); setRenameDraft(epic.title || ''); }
            }}
            onBlur={submitRename}
            style={{
              flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, color: T.text,
              background: T.surface2, border: `1px solid ${c}`, borderRadius: 4,
              padding: '3px 6px', outline: 'none',
            }}
          />
        ) : (
          <span style={{
            flex: 1, fontSize: 13, color: T.text, fontWeight: 500,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{epic.title}</span>
        )}
        {epic.recurring && <span style={{ fontSize: 11, color: T.textFaint }} title="recurring">↻</span>}
        {/* While renaming, an ✎ on the right opens the full folder details page. */}
        {renaming && onSelectEpic && (
          <button
            onMouseDown={e => e.preventDefault()}   /* keep the input from blurring before the click lands */
            onClick={(e) => { e.stopPropagation(); setRenaming(false); onSelectEpic(epic); }}
            title="open folder details"
            aria-label="open folder details"
            style={{
              background: 'transparent', border: `1px solid ${T.border}`, cursor: 'pointer',
              color: T.textMuted, fontSize: 12, lineHeight: 1, padding: '4px 8px', borderRadius: 6,
              minHeight: 28, flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4,
            }}
            onMouseEnter={e => { e.currentTarget.style.color = T.accent; e.currentTarget.style.borderColor = T.accent; }}
            onMouseLeave={e => { e.currentTarget.style.color = T.textMuted; e.currentTarget.style.borderColor = T.border; }}
          >✎ edit</button>
        )}
        {epic.open_issue_count > 0 ? (
          <span style={{ fontSize: 11, color: c, fontWeight: 600, fontFamily: T.fontMono }}>{epic.open_issue_count}</span>
        ) : !renaming ? (
          <button
            onClick={deleteFolder}
            title="delete empty folder"
            aria-label="delete empty folder"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: T.textFaint, fontSize: 13, lineHeight: 1, padding: 2, borderRadius: 4,
              minWidth: 24, minHeight: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = T.overdue; }}
            onMouseLeave={e => { e.currentTarget.style.color = T.textFaint; }}
          >✕</button>
        ) : null}
      </div>
      {open && (
        <div style={{ paddingLeft: 10, paddingTop: 6 }}>
          {/* Quick controls: expand/collapse every folder at once so nested items
              aren't hidden, and one-tap into the full folder-details drawer. */}
          {(() => {
            const folderIds = (openIssues || []).filter(it => it.type === 'folder').map(it => it.id);
            const anyCollapsed = folderIds.some(id => !expandedFolders.has(id));
            if (!folderIds.length && !onSelectEpic) return null;
            const btn = { background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 999, padding: '3px 9px', fontSize: 11, color: T.textMuted, cursor: 'pointer', fontFamily: T.fontBody, display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: 24 };
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                {folderIds.length > 0 && (
                  <button onClick={(e) => { e.stopPropagation(); setExpandedFolders(anyCollapsed ? new Set(folderIds) : new Set()); }}
                    style={btn} title={anyCollapsed ? 'reveal every folder’s items' : 'collapse all folders'}>
                    {anyCollapsed ? '⊞ Expand all' : '⊟ Collapse all'}
                  </button>
                )}
                {onSelectEpic && (
                  <button onClick={(e) => { e.stopPropagation(); onSelectEpic(epic); }} style={btn} title="open the full folder details">⤢ Open folder</button>
                )}
              </div>
            );
          })()}
          {openIssues == null && <div style={{ fontSize: 11, color: T.textFaint }}>loading…</div>}
          {openIssues && openIssues.length === 0 && (!doneIssues || doneIssues.length === 0) && !adding && (
            <div style={{ fontSize: 11, color: T.textFaint, fontStyle: 'italic', padding: '4px 0' }}>no items yet</div>
          )}
          {openIssues && openIssues.filter(rowVisible).map(it => (
            <EpicIssueRow key={it.id} it={it} c={c} tbByIssue={tbByIssue} onSelectIssue={onSelectIssue} isExpanded={expandedFolders.has(it.id)} onToggleFolder={toggleFolder} onDropOnFolder={reparentToFolder} />
          ))}
          {/* Manual quick-add: keeps the AI flow optional. Brain-dump issues here,
              then ask an agent to expand/categorise/schedule them later. */}
          {adding ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); submitAdd(); }
                if (e.key === 'Escape') { setAdding(false); setDraft(''); }
              }}
              onBlur={() => { if (!draft.trim()) setAdding(false); }}
              placeholder="new item title… enter to add · esc to cancel"
              style={{
                width: '100%', fontSize: 12, color: T.text,
                padding: '6px 10px', marginTop: 2,
                background: T.surface, border: `1px solid ${c}`, borderLeft: `2px solid ${c}`,
                borderRadius: 4, fontFamily: T.fontBody, outline: 'none', boxSizing: 'border-box',
              }}
            />
          ) : addingFolder ? (
            <input
              autoFocus
              value={folderDraft}
              onChange={(e) => setFolderDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); submitAddFolder(); }
                if (e.key === 'Escape') { setAddingFolder(false); setFolderDraft(''); }
              }}
              onBlur={() => { if (!folderDraft.trim()) setAddingFolder(false); }}
              placeholder="new folder name… enter to add · esc to cancel"
              style={{
                width: '100%', fontSize: 12, color: T.text,
                padding: '6px 10px', marginTop: 2,
                background: T.surface2, border: `1px dashed ${c}`,
                borderRadius: 6, fontFamily: T.fontBody, outline: 'none', boxSizing: 'border-box',
              }}
            />
          ) : (
            <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
              <button
                onClick={() => setAdding(true)}
                style={{
                  flex: 1, fontSize: 11, color: T.textFaint, padding: '5px 10px',
                  background: 'transparent', border: `1px dashed ${T.border}`, borderRadius: 4,
                  cursor: 'pointer', textAlign: 'center', fontFamily: T.fontBody,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = T.text; e.currentTarget.style.borderColor = c; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = T.textFaint; e.currentTarget.style.borderColor = T.border; }}
              >+ add item</button>
              <button
                onClick={() => setAddingFolder(true)}
                title="add a folder inside this folder"
                style={{
                  flex: 1, fontSize: 11, color: T.textFaint, padding: '5px 10px',
                  background: 'transparent', border: `1px dashed ${T.border}`, borderRadius: 999,
                  cursor: 'pointer', textAlign: 'center', fontFamily: T.fontBody,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = T.text; e.currentTarget.style.borderColor = c; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = T.textFaint; e.currentTarget.style.borderColor = T.border; }}
              >+ add folder</button>
            </div>
          )}
          {/* Completed issues — collapsed by default so the peek stays focused on open work.
              Click the count to expand; rows render with strikethrough + ✓ to make the "done"
              state unmistakable. */}
          {doneIssues && doneIssues.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <button
                onClick={() => setShowDone(v => !v)}
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  padding: '4px 6px', fontFamily: T.fontBody, fontSize: 11,
                  color: T.textMuted, fontWeight: 500,
                }}
              >{showDone ? '▾' : '▸'} {doneIssues.length} done</button>
              {showDone && doneIssues.map(it => (
                <EpicIssueRow key={it.id} it={it} c={c} tbByIssue={tbByIssue} onSelectIssue={onSelectIssue} done />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Single row in the EpicCard expanded peek. `done` switches to the strikethrough +
// ✓ treatment so the user clearly sees completed items.
function EpicIssueRow({ it, c, tbByIssue, onSelectIssue, done, isExpanded, onToggleFolder, onDropOnFolder }) {
  const [folderDragOver, setFolderDragOver] = vUseState(false);
  // Drag source for cross-epic issue moves. Completed issues stay non-draggable
  // — moving an item that already lives in completion.json gets messy.
  const startIssueDrag = (e) => {
    try {
      e.dataTransfer.setData('application/x-todouz', JSON.stringify({
        kind: 'issue', id: it.id, epic_slug: it.epic_slug,
      }));
      e.dataTransfer.effectAllowed = 'move';
    } catch {}
    e.stopPropagation();              // don't start an epic-drag at the same time
  };
  // Nesting: _depth indents the row under its parent. The ↳ glyph marks
  // sub-issues so the hierarchy reads even when scrolled past the parent.
  // Types change the chrome:
  //   folder → grouping header (no priority dot, no plans nag, subtle bg)
  //   item   → real row but never nagged about missing timeblocks
  const depth = it._depth || 0;
  const kind = it.type || 'issue';
  const isFolder = kind === 'folder';
  const isItem = kind === 'item';
  // A folder is a collapsible container: clicking it expands/collapses its
  // items rather than opening a drawer. Everything else opens on click.
  const onRowClick = () => {
    if (isFolder && !done && onToggleFolder) onToggleFolder(it.id);
    else onSelectIssue(it);
  };
  return (
    <div
      onClick={onRowClick}
      draggable={!done && !isFolder}
      onDragStart={startIssueDrag}
      {...(!done && onDropOnFolder ? {
        onDragOver: (e) => { if (e.dataTransfer.types.includes('application/x-todouz')) { e.preventDefault(); e.stopPropagation(); setFolderDragOver(true); } },
        onDragLeave: () => setFolderDragOver(false),
        onDrop: (e) => {
          e.preventDefault(); e.stopPropagation(); setFolderDragOver(false);
          let payload; try { payload = JSON.parse(e.dataTransfer.getData('application/x-todouz') || '{}'); } catch { return; }
          onDropOnFolder(it, payload);
        },
      } : {})}
      title={isFolder
        ? `${isExpanded ? 'collapse folder' : 'expand folder'}${onDropOnFolder ? ' · drop an item here to file it inside' : ''}`
        : (done ? '' : 'drag onto another item to nest it inside — or onto a folder to file it')}
      style={{
        fontSize: 12, color: T.text, cursor: (done || isFolder) ? 'pointer' : 'grab',
        padding: '5px 10px', marginBottom: 2,
        marginLeft: depth * 14,
        background: folderDragOver ? withAlpha(c, 0.16) : (done ? T.surface2 : (isFolder ? T.surface2 : T.surface)),
        border: `1px solid ${folderDragOver ? c : T.border}`,
        borderLeft: isFolder ? `1px solid ${folderDragOver ? c : T.border}` : `2px solid ${done ? T.done : c}`,
        borderRadius: 4,
        display: 'flex', alignItems: 'center', gap: 8,
        opacity: done ? 0.55 : 1,
        fontWeight: isFolder ? 600 : 400,
        outline: folderDragOver ? `2px solid ${c}` : 'none', outlineOffset: '-2px',
      }}
      onMouseEnter={e => { if (!folderDragOver) e.currentTarget.style.background = T.surfaceHover; }}
      onMouseLeave={e => { if (!folderDragOver) e.currentTarget.style.background = done ? T.surface2 : (isFolder ? T.surface2 : T.surface); }}
    >
      {depth > 0 && !isFolder && <span style={{ color: T.textFaint, fontSize: 10, flexShrink: 0 }}>↳</span>}
      {done ? (
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 14, height: 14, borderRadius: 3, background: T.done, color: '#fff',
          fontSize: 10, fontWeight: 700, flexShrink: 0,
        }}>✓</span>
      ) : isFolder ? (
        <span style={{ color: T.textFaint, fontSize: 11, width: 12, flexShrink: 0, display: 'inline-flex', justifyContent: 'center' }}>{isExpanded ? '▾' : '▸'}</span>
      ) : <PriorityDot priority={it.priority} />}
      <span style={{
        flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        textDecoration: done ? 'line-through' : 'none',
      }}>{it.title}</span>
      {!done && it._child_count > 0 && (
        <span style={{
          fontSize: 10, fontFamily: T.fontMono, color: c,
          padding: '1px 6px', background: withAlpha(c, 0.10), borderRadius: 999,
        }} title={isFolder ? `${it._child_count} item${it._child_count === 1 ? '' : 's'} in this folder` : `${it._child_count} item${it._child_count === 1 ? '' : 's'} nested below`}>
          {isFolder ? it._child_count : `+${it._child_count}`}
        </span>
      )}
      {!done && !isFolder && !isItem && (() => {
        const tbCount = (tbByIssue[it.id] || []).length;
        if (tbCount) return (
          <span style={{
            fontSize: 10, fontFamily: T.fontMono, color: c, fontWeight: 600,
            padding: '1px 6px', background: withAlpha(c, 0.10), borderRadius: 999,
            display: 'inline-flex', alignItems: 'center', gap: 3,
          }} title={`${tbCount} scheduled work session${tbCount === 1 ? '' : 's'}`}>
            <Icon kind="work" size={11} /> {tbCount}
          </span>
        );
        // Only nag about missing sessions when there's a due date to plan around —
        // reference items (recipes, stock) have no due date and never need a plan.
        if (it.due) return (
          <span style={{
            fontSize: 9, color: T.warning, fontFamily: T.fontMono, flexShrink: 0,
            padding: '1px 5px', background: withAlpha(T.warning, 0.12), borderRadius: 999,
          }} title="no sessions planned yet">no plan</span>
        );
        return null;
      })()}
      {it.due && (
        <span style={{ fontSize: 11, color: T.textMuted, fontFamily: T.fontMono }}>{formatDue(it.due, it.due_time)}</span>
      )}
    </div>
  );
}

// ─── OVERDUE SECTION ─────────────────────────────────────────────────
// Renders below EpicsGrid. Lists open issues with due dates in the past so
// items from prior days don't silently disappear off the dashboard.
function OverdueSection({ data, onSelectIssue }) {
  if (!data.overdue || !data.overdue.issues || data.overdue.issues.length === 0) return null;
  const [showAll, setShowAll] = vUseState(false);
  const all = data.overdue.issues;
  const VISIBLE = 8;
  const visible = showAll ? all : all.slice(0, VISIBLE);
  const more = all.length - visible.length;
  return (
    <section style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
        <h2 style={{
          fontFamily: T.fontDisplay, fontSize: 18, fontWeight: 600, margin: 0,
          color: T.overdue, letterSpacing: '-0.015em',
        }}>Overdue</h2>
        <span style={{ fontFamily: T.fontMono, fontSize: 12, color: T.textFaint }}>{all.length}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: T.textFaint, fontStyle: 'italic' }}>
          past-due open issues — not auto-cleared
        </span>
      </div>
      <div>
        {visible.map(it => <OverdueRow key={it.id + ':' + it.epic_slug} issue={it} onClick={() => onSelectIssue(it)} />)}
        {more > 0 && (
          <button
            onClick={() => setShowAll(true)}
            style={{
              background: 'transparent', border: 'none',
              fontSize: 12, color: T.accent, cursor: 'pointer',
              padding: '6px 0', fontWeight: 500,
            }}
          >+ show {more} more</button>
        )}
        {showAll && all.length > VISIBLE && (
          <button
            onClick={() => setShowAll(false)}
            style={{
              background: 'transparent', border: 'none',
              fontSize: 12, color: T.textFaint, cursor: 'pointer',
              padding: '6px 0',
            }}
          >collapse</button>
        )}
      </div>
    </section>
  );
}

function OverdueRow({ issue, onClick }) {
  const c = epicColor(issue.epic_slug, issue.epic_slug.split('/')[0]);
  const days = issue.days_overdue;
  // Severity colour ramp — recent (≤2d) muted, mid (3–7d) amber, ancient (>7d) hard red
  const severity = days <= 2 ? T.warning : days <= 7 ? T.warning : T.overdue;
  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 12px', marginBottom: 4,
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderLeft: `3px solid ${severity}`,
        borderRadius: 6,
        cursor: 'pointer',
        transition: 'background 0.12s ease',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = T.surfaceHover; }}
      onMouseLeave={e => { e.currentTarget.style.background = T.surface; }}
    >
      <span style={{
        fontSize: 10, fontWeight: 600, color: severity,
        background: withAlpha(severity === T.overdue ? '#b91c1c' : '#b45309', 0.10),
        padding: '2px 8px', borderRadius: 999,
        fontFamily: T.fontMono, fontVariantNumeric: 'tabular-nums',
        flexShrink: 0,
      }}>{days}d</span>
      <PriorityDot priority={issue.priority} />
      <EpicTag epicSlug={issue.epic_slug} />
      <ParentTrace parent_id={issue.parent_issue_id} parent_title={issue.parent_title} />
      <span style={{
        flex: 1, fontSize: 13, color: T.text,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{issue.title}</span>
      <span style={{ fontSize: 11, color: T.textMuted, fontFamily: T.fontMono }}>due {formatDue(issue.due, issue.due_time)}</span>
    </div>
  );
}

// ─── CALENDAR MONTH ──────────────────────────────────────────────────
// Editorial style: thin separators, day numbers in display font, today
// gets a small filled circle, items as tiny coloured dots-with-text.
// Shared calendar header. On a phone the title takes its own row (long month
// names like "September 2026" used to push the ‹ › nav off the screen) and the
// Day/Month/Year toggle sits centred on a second row; desktop keeps one row.
function CalHeader({ titleMain, titleSub, switcher, nav, isMobile }) {
  // One row. Titles are kept short (e.g. "29 Jul") so the toggle + nav fit
  // beside them; the controls only wrap to a second row if a title ever leaves
  // no room, so the calendar keeps its vertical space in the common case.
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      marginTop: isMobile ? 14 : 24, marginBottom: 12,
    }}>
      <h2 style={{ fontFamily: T.fontDisplay, fontSize: isMobile ? 20 : 24, fontWeight: 600, margin: 0, letterSpacing: '-0.02em', whiteSpace: 'nowrap' }}>{titleMain}</h2>
      {titleSub != null && <span style={{ fontFamily: T.fontMono, fontSize: 13, color: T.textFaint }}>{titleSub}</span>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
        {switcher}
        <div style={{ display: 'inline-flex', gap: 4 }}>{nav}</div>
      </div>
    </div>
  );
}

function CalendarMonth({ data, viewDate, onSelectIssue, onSelectDay, onSelectBlock, onAddForDay, onDropOnDay, headerExtras }) {
  if (!data.upcoming) return null;
  const isMobile = useIsMobile();
  // Apple-Calendar behaviour on phones: the grid stays airy (number + dots),
  // and the tapped day's detail shows inline below the grid (no dimmed modal).
  const [selDay, setSelDay] = vUseState(data.todayISO);
  const today = data.todayDate;
  // monthOffset = 0 → current month, -1 → prev month, +1 → next month. Kept
  // in state so the prev/next arrows can navigate without losing position.
  const [monthOffset, setMonthOffset] = vUseState(0);
  const visibleMonthDate = vUseMemo(
    () => new Date(today.getFullYear(), today.getMonth() + monthOffset, 1),
    [today, monthOffset]
  );
  const year = visibleMonthDate.getFullYear();
  const month = visibleMonthDate.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const startDow = first.getDay();
  const daysInMonth = last.getDate();
  const todayISO = data.todayISO;
  const isCurrentMonth = monthOffset === 0;

  // Pull all days for the visible month. For the CURRENT month we can lean on
  // data.upcoming for today + future and only fetch the past portion ourselves.
  // For non-current months (prev/next/...) we always have to fetch the whole
  // span since data.upcoming starts at today.
  const [monthDays, setMonthDays] = vUseState(null);
  vUseEffect(() => {
    let alive = true;
    const fromISO = fmtISO(first);
    if (isCurrentMonth) {
      // Only need the past slice (first-of-month → yesterday). today + future
      // comes from data.upcoming and merges in the memo below.
      const t = parseISODate(todayISO);
      const lastPast = new Date(t.getTime() - 86400000);
      const dayCount = Math.round((startOfDay(lastPast).getTime() - startOfDay(first).getTime()) / 86400000) + 1;
      if (dayCount <= 0) { setMonthDays([]); return; }
      api('list_upcoming', { days: dayCount, from_date: fromISO })
        .then(r => { if (alive) setMonthDays(r.days_list || []); })
        .catch(() => { if (alive) setMonthDays([]); });
    } else {
      // Whole month — list_upcoming accepts past or future from_date.
      api('list_upcoming', { days: daysInMonth, from_date: fromISO })
        .then(r => { if (alive) setMonthDays(r.days_list || []); })
        .catch(() => { if (alive) setMonthDays([]); });
    }
    return () => { alive = false; };
  }, [year, month, daysInMonth, isCurrentMonth, todayISO, data.upcoming]);

  const dayItems = vUseMemo(() => {
    const m = {};
    // Fetched days come first (may be the past portion of current month, or the
    // entirety of a non-current month). For the current month we then overlay
    // data.upcoming so today + future stays canonical.
    for (const day of (monthDays || [])) {
      const due = (day.items || []).filter(it => !it.recurring);
      const recurring = (day.items || []).filter(it => it.recurring);
      m[day.date] = unifyDay({
        due_today: due, recurring_today: recurring,
        timeblocks_today: day.timeblocks || [],
        events_today: [],
      });
    }
    if (isCurrentMonth) {
      for (const day of data.upcoming.days_list || []) {
        const due = (day.items || []).filter(it => !it.recurring);
        const recurring = (day.items || []).filter(it => it.recurring);
        m[day.date] = unifyDay({
          due_today: due, recurring_today: recurring,
          timeblocks_today: day.timeblocks || [],
          // events excluded — calendar shows sessions + due dates only.
          events_today: [],
        });
      }
    }
    return m;
  }, [data.upcoming, monthDays, isCurrentMonth]);

  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(year, month, d);
    cells.push({ day: d, date: fmtISO(dt), dow: dt.getDay(), isToday: dt.getTime() === today.getTime() });
  }

  const monthName = ['January','February','March','April','May','June','July','August','September','October','November','December'][month];

  return (
    <section style={{ marginBottom: 32 }}>
      <CalHeader
        isMobile={isMobile}
        titleMain={isMobile ? CAL_MON[month] : monthName}
        titleSub={year}
        switcher={headerExtras}
        nav={<>
          {!isCurrentMonth && (
            <button onClick={() => setMonthOffset(0)} title="back to current month" style={{
              background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 999,
              padding: '5px 12px', fontFamily: T.fontBody, fontSize: 12, fontWeight: 500,
              color: T.text, cursor: 'pointer',
            }}>Today</button>
          )}
          <button onClick={() => setMonthOffset(o => o - 1)} title="previous month" style={weekArrowStyle(isMobile)}>‹</button>
          <button onClick={() => setMonthOffset(o => o + 1)} title="next month" style={weekArrowStyle(isMobile)}>›</button>
        </>}
      />

      <div style={{
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: 10,
        padding: 0,
        overflow: 'hidden',
      }}>
        {/* weekday header */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: `1px solid ${T.border}` }}>
          {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d, i) => (
            <div key={d} style={{
              textAlign: 'left', padding: '10px 12px',
              fontSize: 11, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase',
              color: T.textFaint,
              borderLeft: i === 0 ? 'none' : `1px solid ${T.border}`,
            }}>{d}</div>
          ))}
        </div>
        {/* cell grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
          {cells.map((c, i) => {
            if (!c) return (
              <div key={'b' + i} style={{
                // Match the real cells' height (was a fixed 96 → the leading blank
                // cells made the first week row taller than the rest on mobile).
                minHeight: isMobile ? 56 : 96,
                borderTop: i >= 7 ? `1px solid ${T.border}` : 'none',
                borderLeft: (i % 7) === 0 ? 'none' : `1px solid ${T.border}`,
                background: T.surface2,
              }} />
            );
            return (
              <CalendarCell
                key={c.date}
                cell={c}
                idx={i}
                rows={dayItems[c.date] || []}
                viewDate={viewDate}
                isMobile={isMobile}
                onSelectIssue={onSelectIssue}
                onSelectBlock={onSelectBlock}
                onSelectDay={isMobile ? (d) => { setSelDay(d); onSelectDay && onSelectDay(d); } : onSelectDay}
                onAddForDay={onAddForDay}
                onDropOnDay={onDropOnDay}
              />
            );
          })}
        </div>
      </div>
      {/* Selected-day detail lives INLINE below the grid on mobile (no dimmed
          modal). Shrinking the calendar (equal row heights) leaves room for it;
          the list scrolls on its own so the calendar stays put. */}
      {isMobile && (() => {
        const firstISO = fmtISO(first), lastISO = fmtISO(last);
        const activeDay = (selDay >= firstISO && selDay <= lastISO) ? selDay : (isCurrentMonth ? todayISO : firstISO);
        const rows = dayItems[activeDay] || [];
        const ad = parseISODate(activeDay);
        return (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
              <h3 style={{ fontFamily: T.fontDisplay, fontSize: 18, fontWeight: 600, margin: 0 }}>{ad ? fmtLong(ad) : activeDay}</h3>
              <span style={{ fontSize: 12, color: T.textFaint, fontFamily: T.fontMono }}>{rows.length} item{rows.length === 1 ? '' : 's'}</span>
            </div>
            <div style={{ maxHeight: '34vh', overflowY: 'auto', overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {rows.length === 0 ? (
                <div style={{ fontSize: 13, color: T.textFaint, fontStyle: 'italic', padding: '8px 2px' }}>
                  Nothing on this day yet — use ＋ in the top bar to add to it.
                </div>
              ) : (
                rows.map((row, i) => (
                  <DayItemRow key={i} row={row} onSelectIssue={onSelectIssue} onSelectBlock={onSelectBlock} onTbAction={() => async () => {}} />
                ))
              )}
            </div>
          </div>
        );
      })()}
    </section>
  );
}

// Single calendar-month cell, extracted so we can hold per-cell drag-over state.
function CalendarCell({ cell, idx, rows, viewDate, isMobile, onSelectIssue, onSelectBlock, onSelectDay, onAddForDay, onDropOnDay }) {
  const [hover, setHover] = vUseState(false);
  const [dragOver, setDragOver] = vUseState(false);
  const c = cell;
  const visible = rows.slice(0, 3);
  const more = rows.length - visible.length;
  const isWeekend = c.dow === 0 || c.dow === 6;
  const isSelected = viewDate && viewDate === c.date && !c.isToday;

  const cellClick = (e) => {
    if (!onSelectDay) return;
    if (e.target.closest('button, [data-rowclick="1"]')) return;
    onSelectDay(c.date);
  };

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={cellClick}
      onDragOver={(e) => { if (onDropOnDay) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        setDragOver(false);
        if (!onDropOnDay) return;
        e.preventDefault();
        try {
          const payload = JSON.parse(e.dataTransfer.getData('application/x-todouz') || '{}');
          if (payload && payload.kind) onDropOnDay(c.date, payload);
        } catch {}
      }}
      style={{
        minHeight: isMobile ? 56 : 96,
        padding: isMobile ? '6px 2px' : '8px 10px',
        background: dragOver ? withAlpha('#c2410c', 0.18)
                   : isSelected ? withAlpha('#c2410c', 0.10)
                   : (isWeekend ? T.surface2 : T.surface),
        borderTop: idx >= 7 ? `1px solid ${T.border}` : 'none',
        borderLeft: (idx % 7) === 0 ? 'none' : `1px solid ${T.border}`,
        display: 'flex', flexDirection: 'column', gap: 3,
        alignItems: isMobile ? 'center' : 'stretch',
        minWidth: 0, overflow: 'hidden',
        cursor: onSelectDay ? 'pointer' : 'default',
        outline: (isSelected || dragOver) ? `2px solid ${T.accent}` : 'none',
        outlineOffset: '-2px',
        position: 'relative',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, justifyContent: isMobile ? 'center' : 'flex-start', width: '100%' }}>
        {c.isToday ? (
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 22, height: 22, borderRadius: '50%',
            background: T.text, color: '#fff',
            fontFamily: T.fontDisplay, fontSize: 13, fontWeight: 600,
          }}>{c.day}</span>
        ) : (
          <span style={{
            fontFamily: T.fontDisplay, fontSize: 14, fontWeight: 500,
            color: isSelected ? T.accent : T.text,
            paddingLeft: 4,
          }}>{c.day}</span>
        )}
        {!isMobile && <span style={{ flex: 1 }} />}
        {!isMobile && hover && onAddForDay && (
          <button
            onClick={(e) => { e.stopPropagation(); onAddForDay(c.date); }}
            title="add to this day"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: T.textMuted, fontSize: 14, padding: '0 2px', lineHeight: 1,
            }}
          >+</button>
        )}
      </div>
      {isMobile ? (
        // Up to 3 dots, coloured by epic — the month grid stays scannable and
        // the day sheet carries the detail.
        <div style={{ display: 'flex', gap: 3, justifyContent: 'center', minHeight: 6 }}>
          {rows.slice(0, 3).map((row, i) => {
            const slug = row.kind === 'block' ? row.timeblock?.epic_slug : row.issue?.epic_slug;
            const col = slug ? epicColor(slug, slug.split('/')[0]) : T.textFaint;
            return <span key={i} style={{ width: 5, height: 5, borderRadius: '50%', background: col }} />;
          })}
          {rows.length > 3 && (
            <span style={{ fontSize: 8, color: T.textFaint, lineHeight: '5px' }}>+{rows.length - 3}</span>
          )}
        </div>
      ) : (
        <>
          {visible.map((row, i) => <CompactDayRow key={c.date + ':' + i} row={row} onSelectIssue={onSelectIssue} onSelectBlock={onSelectBlock} />)}
          {more > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); if (onSelectDay) onSelectDay(c.date); }}
              style={{
                fontSize: 10, color: T.accent, padding: '2px 6px',
                background: 'transparent', border: 'none', textAlign: 'left',
                cursor: 'pointer', fontWeight: 500,
              }}
            >+{more} more →</button>
          )}
        </>
      )}
    </div>
  );
}

// ─── PlanSection ─────────────────────────────────────────────────────
// Single home for the WeekStrip + CalendarMonth views. Toggle pill flips between
// the two; user's last pick is remembered in localStorage so reloads land back
// on whichever view they were using.
// ─── Apple-style calendar: Day / Week / Month / Year ──────────────────
const CAL_MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const HOUR_PX = 48;                                  // vertical px per hour in the time grid
function parseHM(s) { const m = /^(\d{1,2}):(\d{2})/.exec(String(s || '')); return m ? (+m[1]) * 60 + (+m[2]) : null; }
function fmtHM(min) { const h = Math.floor(min / 60) % 24, m = ((min % 60) + 60) % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }
function fmt12(min) { let h = Math.floor(min / 60), m = min % 60; const ap = h < 12 ? 'AM' : 'PM'; h = h % 12; if (h === 0) h = 12; return m ? `${h}:${String(m).padStart(2, '0')} ${ap}` : `${h} ${ap}`; }
function weekDaysOf(d) { const s = startOfDay(new Date(d)); s.setDate(s.getDate() - s.getDay()); return Array.from({ length: 7 }, (_, i) => fmtISO(new Date(s.getFullYear(), s.getMonth(), s.getDate() + i))); }

// The hours × days grid used by the merged Day view. Sessions render as
// positioned blocks at their real times; tapping an empty slot selects it
// (highlight) so the top-bar + adds an item/session there.
//
// `perView` = how many day-columns fit in the visible width. When more days
// than that are passed (mobile: 14 days, perView 2), the grid scrolls
// horizontally — the hour gutter and day headers stay pinned (sticky) so you
// can swipe sideways to reach later days, Apple-Calendar style.
function TimeGridView({ days, blocksByDate, onSelectBlock, onSelectSlot, onMoveBlock, selectedSlot, todayISO, perView }) {
  const scrollRef = vUseRef(null);
  const [contW, setContW] = vUseState(0);
  const [dragOverCol, setDragOverCol] = vUseState(null);   // day column a block is being dragged over
  const BLOCK_MIME = 'application/x-todouz-block';
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  vUseEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = Math.max(0, 7 * HOUR_PX - 24); }, [days.join(',')]);
  // Measure the scroll container so fixed column widths add up to exactly
  // `perView` visible columns (can't do that with % inside a scroller).
  vUseEffect(() => {
    const measure = () => { if (scrollRef.current) setContW(scrollRef.current.clientWidth); };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  const GUTTER = 46;
  const pv = perView || days.length;
  const scrollCols = days.length > pv;                 // more days than fit → horizontal scroll
  const measuredW = contW || (window.innerWidth - 32);  // pre-measure fallback for first paint
  const colW = scrollCols ? Math.max(132, Math.round((measuredW - GUTTER) / pv)) : null;
  const colStyle = colW ? { width: colW, flexShrink: 0 } : { flex: 1, minWidth: 0 };
  const bodyW = colW ? GUTTER + colW * days.length : '100%';
  // Tap → a default 1-hour selection; the bottom handle then drags to extend it.
  // A drag ending on a column would otherwise fire this synthesized click too and
  // re-anchor the window at the release point ("the window shifts down"); we
  // swallow any click within 350ms of a drag ending.
  const lastDragEndRef = vUseRef(0);
  const colTap = (date) => (e) => {
    if (Date.now() - lastDragEndRef.current < 350) return;
    const rect = e.currentTarget.getBoundingClientRect();
    let min = Math.round(((e.clientY - rect.top) / HOUR_PX) * 60 / 30) * 30;
    min = Math.max(0, Math.min(23 * 60, min));
    onSelectSlot && onSelectSlot(date, fmtHM(min), fmtHM(min + 60));
  };
  // Drag the selection's bottom handle down to extend the end time (snap 15m).
  const dragRef = vUseRef(null);
  const onDragMove = (e) => {
    const d = dragRef.current; if (!d) return;
    e.preventDefault();
    let endMin = Math.round(((e.clientY - d.colTop) / HOUR_PX) * 60 / 15) * 15;
    endMin = Math.max(d.startMin + 15, Math.min(24 * 60, endMin));
    onSelectSlot && onSelectSlot(d.date, fmtHM(d.startMin), fmtHM(endMin));
  };
  const onDragEnd = () => {
    if (dragRef.current) { lastDragEndRef.current = Date.now(); dragRef.current = null; }
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
  };
  const onHandleDown = (date, startMin) => (e) => {
    e.stopPropagation(); e.preventDefault();
    const col = e.currentTarget.closest('[data-col]');
    if (!col) return;
    // Capture the pointer so every move/up lands on the handle even if the
    // finger drifts off it — no lost events, no stray click on the column.
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    dragRef.current = { date, startMin, colTop: col.getBoundingClientRect().top };
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
  };
  const dayHeader = (dISO) => {
    const d = parseISODate(dISO), isTd = dISO === todayISO;
    return (
      <div key={dISO} style={{ ...colStyle, textAlign: 'center', padding: '7px 2px', borderLeft: `1px solid ${T.border}`, boxSizing: 'border-box' }}>
        <div style={{ fontSize: 10, fontFamily: T.fontMono, color: isTd ? T.accent : T.textFaint, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{dayName(d)}</div>
        <div style={{ fontSize: 15, fontWeight: isTd ? 700 : 500, color: isTd ? '#fff' : T.text, fontFamily: T.fontDisplay, width: 25, height: 25, lineHeight: '25px', borderRadius: 999, margin: '2px auto 0', background: isTd ? T.accent : 'transparent' }}>{d.getDate()}</div>
      </div>
    );
  };
  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: 12, overflow: 'hidden', background: T.surface }}>
      {/* Vertical scroll stays free; the horizontal axis snaps to day columns so
          you always rest on exactly `perView` full days — never mid-way through a
          third. overscrollBehavior:none kills the rubber-band bounce (which read
          as "wobbly" when both axes scrolled freely). */}
      <div ref={scrollRef} style={{
        maxHeight: '62vh', overflow: 'auto', WebkitOverflowScrolling: 'touch',
        overscrollBehavior: 'none',
        scrollSnapType: scrollCols ? 'x mandatory' : undefined,
        scrollPaddingLeft: scrollCols ? GUTTER : undefined,
      }}>
        <div style={{ width: bodyW, position: 'relative' }}>
          {/* Sticky day-header row (stays put while you scroll the hours down). */}
          <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 20, background: T.surface, borderBottom: `1px solid ${T.border}` }}>
            <div style={{ width: GUTTER, flexShrink: 0, position: 'sticky', left: 0, zIndex: 2, background: T.surface }} />
            {days.map(dayHeader)}
          </div>
          <div style={{ display: 'flex', height: 24 * HOUR_PX }}>
            {/* Sticky hour gutter (stays put while you scroll days sideways). */}
            <div style={{ width: GUTTER, flexShrink: 0, position: 'sticky', left: 0, zIndex: 10, background: T.surface }}>
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} style={{ position: 'absolute', top: h * HOUR_PX - 6, right: 6, fontSize: 9, fontFamily: T.fontMono, color: T.textFaint }}>{h ? fmt12(h * 60) : ''}</div>
              ))}
            </div>
            {days.map(dISO => {
              const blocks = blocksByDate[dISO] || [];
              const isTd = dISO === todayISO;
              const sel = (selectedSlot && selectedSlot.date === dISO) ? parseHM(selectedSlot.time) : null;
              const selEnd = (sel != null) ? (selectedSlot.endTime ? parseHM(selectedSlot.endTime) : sel + 60) : null;
              const selH = (sel != null) ? Math.max(HOUR_PX / 2, ((selEnd || sel + 60) - sel) / 60 * HOUR_PX) : 0;
              const dragOver = dragOverCol === dISO;
              return (
                <div key={dISO} data-col={dISO} onClick={colTap(dISO)}
                  onDragOver={onMoveBlock ? (ev) => { if ([...(ev.dataTransfer.types || [])].includes(BLOCK_MIME)) { ev.preventDefault(); ev.dataTransfer.dropEffect = 'move'; if (dragOverCol !== dISO) setDragOverCol(dISO); } } : undefined}
                  onDragLeave={onMoveBlock ? (ev) => { if (ev.currentTarget === ev.target) setDragOverCol(c => c === dISO ? null : c); } : undefined}
                  onDrop={onMoveBlock ? (ev) => {
                    ev.preventDefault(); setDragOverCol(null); lastDragEndRef.current = Date.now();
                    let p; try { p = JSON.parse(ev.dataTransfer.getData(BLOCK_MIME) || '{}'); } catch { return; }
                    if (p && p.id && p.date !== dISO) onMoveBlock(p, dISO);
                  } : undefined}
                  style={{ ...colStyle, position: 'relative', borderLeft: `1px solid ${T.border}`, cursor: 'pointer', boxSizing: 'border-box', scrollSnapAlign: scrollCols ? 'start' : undefined, background: dragOver ? withAlpha(T.accent, 0.07) : undefined, boxShadow: dragOver ? `inset 0 0 0 2px ${withAlpha(T.accent, 0.5)}` : undefined }}>
                  {Array.from({ length: 24 }, (_, h) => (<div key={h} style={{ position: 'absolute', left: 0, right: 0, top: h * HOUR_PX, height: 1, background: T.border, opacity: 0.5 }} />))}
                  {sel != null && (
                    <div style={{ position: 'absolute', left: 2, right: 2, top: (sel / 60) * HOUR_PX, height: selH - 2, background: withAlpha(T.accent, 0.18), border: `1px dashed ${T.accent}`, borderRadius: 6, zIndex: 5 }}>
                      <span style={{ fontSize: 9, color: T.accent, padding: '2px 4px', display: 'block', pointerEvents: 'none' }}>{fmt12(sel)}{selEnd ? `–${fmt12(selEnd)}` : ''}</span>
                      {/* drag this handle down to extend the range */}
                      <span
                        onPointerDown={onHandleDown(dISO, sel)}
                        title="drag to extend"
                        style={{ position: 'absolute', left: 0, right: 0, bottom: -8, height: 18, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', cursor: 'ns-resize', touchAction: 'none', zIndex: 6 }}
                      ><span style={{ width: 26, height: 4, borderRadius: 999, background: T.accent }} /></span>
                    </div>
                  )}
                  {isTd && (<div style={{ position: 'absolute', left: 0, right: 0, top: (nowMin / 60) * HOUR_PX, height: 2, background: T.overdue, zIndex: 4 }}><span style={{ position: 'absolute', left: -3, top: -3, width: 7, height: 7, borderRadius: 999, background: T.overdue }} /></div>)}
                  {blocks.map((b, i) => {
                    const s = parseHM(b.start); if (s == null) return null;
                    const e = parseHM(b.end);
                    const top = (s / 60) * HOUR_PX, h = Math.max(20, ((e != null ? e : s + 60) - s) / 60 * HOUR_PX);
                    const col = epicColor(b.epic_slug, (b.epic_slug || '').split('/')[0]);
                    const canDrag = !!onMoveBlock && !b.completed;
                    return (
                      <div key={i} onClick={(ev) => { ev.stopPropagation(); if (Date.now() - lastDragEndRef.current < 350) return; onSelectBlock && onSelectBlock(b); }}
                        draggable={canDrag}
                        onDragStart={canDrag ? (ev) => {
                          ev.stopPropagation();
                          try { ev.dataTransfer.setData(BLOCK_MIME, JSON.stringify({ id: b.id, date: dISO, start: b.start, end: b.end, title: b.title })); ev.dataTransfer.effectAllowed = 'move'; } catch {}
                        } : undefined}
                        onDragEnd={canDrag ? () => { lastDragEndRef.current = Date.now(); setDragOverCol(null); } : undefined}
                        title={`${b.start}–${b.end} · ${b.title}${canDrag ? ' · drag to another day to move it' : ''}`}
                        style={{ position: 'absolute', left: 2, right: 2, top, height: h - 2, background: withAlpha(col, 0.16), borderLeft: `3px solid ${col}`, borderRadius: 6, padding: '2px 5px', overflow: 'hidden', zIndex: 2, opacity: b.completed ? 0.5 : 1, cursor: canDrag ? 'grab' : 'pointer' }}>
                        {/* No time label: the block is already positioned at its
                            start time against the hour gutter, so a "12:30" row
                            was redundant and stole a line from short blocks. The
                            title now gets the full height; the exact time is in
                            the hover tooltip (title attr) and the drawer. Wrap
                            long titles so more shows than one ellipsised line. */}
                        <div style={{ fontSize: 10.5, lineHeight: 1.15, color: T.text, overflow: 'hidden', whiteSpace: 'normal', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{b.title}</div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══ Unified date/time selection ═══════════════════════════════════════
// SchedulePicker is the ONE "open the schedule to pick" surface: the app's
// Day / Month / Year calendar in a modal so you choose against your real load.
// Day view = the hour grid (tap a slot → time); Month/Year navigate + pick a day.
// The footer carries the chosen date + native time inputs to fine-tune. Returns
// { date, start, end }. withTime=false → date only; range=true → start AND end.
function SchedulePicker({ withTime = true, range = false, initialDate, initialStart, initialEnd, onPick, onCancel }) {
  const isMobile = useIsMobile();
  const todayISO = fmtISO(startOfDay(new Date()));
  const [anchor, setAnchor] = vUseState(() => parseISODate(initialDate || todayISO));
  const anchorISO = fmtISO(anchor);
  const [pmode, setPmode] = vUseState(withTime ? 'days' : 'month');
  const [date, setDate] = vUseState(initialDate || null);
  const [start, setStart] = vUseState(initialStart || null);
  const [end, setEnd] = vUseState(initialEnd || null);

  const perView = isMobile ? 1 : 4;
  const days = vUseMemo(() => { const b = new Date(anchor); return Array.from({ length: 7 }, (_, i) => fmtISO(new Date(b.getFullYear(), b.getMonth(), b.getDate() + i))); }, [anchorISO]);
  const [blocks, setBlocks] = vUseState({});
  const [dayLoad, setDayLoad] = vUseState({});
  const [yearDots, setYearDots] = vUseState(() => new Set());

  vUseEffect(() => {
    let alive = true;
    if (pmode === 'days') {
      api('list_upcoming', { days: 7, from_date: days[0] }).then(r => { if (!alive) return; const m = {}; for (const dd of (r.days_list || [])) m[dd.date] = dd.timeblocks || []; setBlocks(m); }).catch(() => { if (alive) setBlocks({}); });
    } else if (pmode === 'month') {
      const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      api('list_upcoming', { days: 42, from_date: fmtISO(first) }).then(r => { if (!alive) return; const m = {}; for (const dd of (r.days_list || [])) { const tb = dd.timeblocks || []; if (tb.length) m[dd.date] = { count: tb.length, hrs: tb.reduce((s, b) => s + Math.max(0, (parseHM(b.end) - parseHM(b.start))) / 60, 0) }; } setDayLoad(m); }).catch(() => {});
    } else {
      api('list_upcoming', { days: 366, from_date: `${anchor.getFullYear()}-01-01` }).then(r => { if (!alive) return; const s = new Set(); for (const dd of (r.days_list || [])) if ((dd.timeblocks || []).length || (dd.items || []).length) s.add(dd.date); setYearDots(s); }).catch(() => {});
    }
    return () => { alive = false; };
  }, [pmode, anchorISO]);
  vUseEffect(() => { const onKey = (e) => { if (e.key === 'Escape') onCancel(); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [onCancel]);

  const pickDay = (iso) => { setDate(iso); setAnchor(parseISODate(iso)); if (withTime) setPmode('days'); };
  const onSlot = (d, s, e) => { setDate(d); setStart(s); setEnd(e); };
  const selectedSlot = (withTime && date && start) ? { date, time: start, endTime: end || fmtHM(parseHM(start) + 60) } : null;
  const canUse = withTime ? !!(date && start) : !!date;
  const doUse = () => { if (!canUse) return; onPick({ date, start: withTime ? start : null, end: withTime ? (end || fmtHM(parseHM(start) + 60)) : null }); };
  const shift = (dir) => { const d = new Date(anchor); if (pmode === 'days') d.setDate(d.getDate() + dir * 7); else if (pmode === 'month') d.setMonth(d.getMonth() + dir); else d.setFullYear(d.getFullYear() + dir); setAnchor(d); };
  const title = pmode === 'year' ? String(anchor.getFullYear()) : pmode === 'month' ? `${CAL_MON[anchor.getMonth()]} ${anchor.getFullYear()}` : (() => { const f = parseISODate(days[0]), l = parseISODate(days[6]); return isMobile ? `${f.getDate()} ${CAL_MON[f.getMonth()]}` : `${f.getDate()} ${CAL_MON[f.getMonth()]} – ${l.getDate()} ${CAL_MON[l.getMonth()]}`; })();

  const navBtn = { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, minWidth: 28, height: 28, cursor: 'pointer', color: T.text, fontFamily: T.fontBody, fontSize: 13, padding: '0 8px' };
  const miniTime = { background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 8, padding: '6px 8px', fontFamily: T.fontMono, fontSize: 15, color: T.text, outline: 'none', minWidth: 0 };
  const switcher = (
    <div style={{ display: 'inline-flex', gap: 0, background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 999, padding: 2 }}>
      {CAL_MODES.map(o => (
        <button key={o.k} type="button" onClick={() => setPmode(o.k)} style={{ padding: isMobile ? '6px 10px' : '3px 10px', fontFamily: T.fontBody, fontSize: isMobile ? 12 : 11, fontWeight: 500, color: pmode === o.k ? T.text : T.textMuted, background: pmode === o.k ? T.surface : 'transparent', border: 'none', borderRadius: 999, cursor: 'pointer', boxShadow: pmode === o.k ? T.shadowSm : 'none' }}>{o.label}</button>
      ))}
    </div>
  );
  const monthGrid = () => {
    const y = anchor.getFullYear(), mo = anchor.getMonth();
    const first = new Date(y, mo, 1), startDow = first.getDay(), dim = new Date(y, mo + 1, 0).getDate();
    const cells = []; for (let i = 0; i < startDow; i++) cells.push(null); for (let d = 1; d <= dim; d++) cells.push(d);
    return (
      <div style={{ paddingBottom: 4 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4, marginBottom: 6 }}>
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((w, i) => <div key={i} style={{ fontSize: 10, color: T.textFaint, fontFamily: T.fontMono, textAlign: 'center' }}>{w}</div>)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4 }}>
          {cells.map((d, i) => {
            if (d == null) return <div key={'e' + i} />;
            const iso = fmtISO(new Date(y, mo, d)), load = dayLoad[iso], isTd = iso === todayISO, isSel = iso === date;
            const tint = load ? (load.hrs < 3 ? T.done : load.hrs <= 5 ? T.warning : T.overdue) : null;
            return (
              <button key={iso} type="button" onClick={() => pickDay(iso)} title={load ? `${load.count} block${load.count > 1 ? 's' : ''} · ${load.hrs.toFixed(1)}h` : 'nothing scheduled'}
                style={{ minHeight: isMobile ? 44 : 54, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '6px 2px', borderRadius: 8, cursor: 'pointer', background: isSel ? withAlpha(T.accent, 0.16) : T.surface, border: `1px solid ${isSel ? T.accent : T.border}` }}>
                <span style={{ fontSize: 13, fontWeight: isSel ? 700 : 500, fontFamily: T.fontMono, color: isTd ? T.accent : T.text }}>{d}</span>
                {load && <span style={{ fontSize: 9, fontFamily: T.fontMono, color: tint }}>{load.count}b·{load.hrs.toFixed(1)}h</span>}
              </button>
            );
          })}
        </div>
      </div>
    );
  };
  const card = isMobile
    ? { position: 'fixed', left: 0, right: 0, bottom: 0, width: '100%', boxSizing: 'border-box', background: T.surface, borderTop: `1px solid ${T.border}`, borderRadius: '16px 16px 0 0', boxShadow: T.shadowLg, zIndex: 341, display: 'flex', flexDirection: 'column', maxHeight: '94dvh' }
    : { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 'min(760px,94vw)', background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, boxShadow: T.shadowLg, zIndex: 341, display: 'flex', flexDirection: 'column', maxHeight: '90vh' };
  const dLabel = date ? (() => { const p = parseISODate(date); return `${dayName(p)} ${p.getDate()} ${CAL_MON[p.getMonth()]}`; })() : null;
  return (
    <>
      <div onClick={onCancel} style={{ position: 'fixed', inset: 0, background: 'rgba(26,23,20,0.45)', zIndex: 340 }} />
      <div style={card} onClick={e => e.stopPropagation()}>
        <div style={{ flexShrink: 0, padding: isMobile ? '12px 14px 6px' : '14px 18px 8px' }}>
          {isMobile && <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}><div style={{ width: 40, height: 4, borderRadius: 2, background: T.borderStrong }} /></div>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ color: T.overdue, fontSize: 16 }}>📅</span>
            <h3 style={{ fontFamily: T.fontDisplay, fontSize: 17, fontWeight: 600, margin: 0 }}>{withTime ? 'Pick a time' : 'Pick a day'}</h3>
            <span style={{ flex: 1 }} />
            {switcher}
            <button type="button" onClick={onCancel} aria-label="close" style={{ background: 'transparent', border: 'none', fontSize: 20, color: T.textMuted, cursor: 'pointer', lineHeight: 1, minWidth: 30, minHeight: 30 }}>✕</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <button type="button" onClick={() => shift(-1)} style={navBtn}>‹</button>
            <button type="button" onClick={() => setAnchor(startOfDay(new Date()))} style={navBtn}>Today</button>
            <button type="button" onClick={() => shift(1)} style={navBtn}>›</button>
            <span style={{ fontFamily: T.fontDisplay, fontSize: 15, fontWeight: 600, marginLeft: 6 }}>{title}</span>
          </div>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: isMobile ? '0 12px' : '0 16px', minHeight: 0 }}>
          {pmode === 'days' && <TimeGridView days={days} perView={perView} blocksByDate={blocks} onSelectSlot={onSlot} selectedSlot={selectedSlot} todayISO={todayISO} />}
          {pmode === 'month' && monthGrid()}
          {pmode === 'year' && <YearView year={anchor.getFullYear()} todayISO={todayISO} daysWithItems={yearDots} onPickDay={(iso) => { setAnchor(parseISODate(iso)); if (withTime) setPmode('days'); else { setPmode('month'); setDate(iso); } }} />}
        </div>
        <div style={{ flexShrink: 0, borderTop: `1px solid ${T.border}`, padding: isMobile ? '10px 14px calc(10px + env(safe-area-inset-bottom,0px))' : '12px 16px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 13 }}>
            <span style={{ color: date ? T.text : T.textFaint, fontWeight: 500 }}>{dLabel || (withTime ? 'tap a slot' : 'pick a day')}</span>
            {withTime && date && <>
              <input type="time" value={start || ''} onChange={e => setStart(e.target.value)} style={miniTime} />
              {range && <><span style={{ color: T.textMuted }}>→</span><input type="time" value={end || ''} onChange={e => setEnd(e.target.value)} style={miniTime} /></>}
            </>}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" onClick={onCancel} style={{ flex: 1, padding: '11px 16px', minHeight: 46, background: 'transparent', color: T.textMuted, border: `1px solid ${T.border}`, borderRadius: 10, fontFamily: T.fontBody, fontSize: 15, cursor: 'pointer' }}>Cancel</button>
            <button type="button" onClick={doUse} disabled={!canUse} style={{ flex: 2, padding: '11px 16px', minHeight: 46, background: canUse ? T.accent : T.surface2, color: canUse ? '#fff' : T.textFaint, border: 'none', borderRadius: 10, fontFamily: T.fontBody, fontSize: 15, fontWeight: 600, cursor: canUse ? 'pointer' : 'default' }}>{canUse ? `Use ${dLabel}${withTime && start ? `, ${fmt12(parseHM(start))}` : ''}` : (withTime ? 'Tap a slot' : 'Pick a day')}</button>
          </div>
        </div>
      </div>
    </>
  );
}

// The ONE date/time field: native input(s) to type + a red 📅 button that opens
// the SchedulePicker. mode: 'date' (day only) | 'datetime' (day + optional time) |
// 'session' (day + start + end). onChange gets a partial patch to merge in.
function DateTimeField({ mode = 'datetime', date, time, start, end, onChange, inputStyle, timeStyle, isMobile }) {
  const [picking, setPicking] = vUseState(false);
  const iStyle = inputStyle || { background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 8, padding: '9px 12px', minHeight: 40, fontFamily: T.fontMono, fontSize: 16, color: T.text, outline: 'none', minWidth: 0 };
  const tStyle = timeStyle || iStyle;
  const withTime = mode !== 'date';
  const range = mode === 'session';
  const redBtn = { flexShrink: 0, background: withAlpha(T.overdue, 0.08), border: `1px solid ${withAlpha(T.overdue, 0.4)}`, color: T.overdue, borderRadius: 8, minHeight: 40, minWidth: 40, padding: '0 10px', cursor: 'pointer', fontSize: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' };
  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="date" value={date || ''} onChange={e => onChange({ date: e.target.value })} style={iStyle} />
        {mode === 'datetime' && <input type="time" value={time || ''} onChange={e => onChange({ time: e.target.value })} style={tStyle} />}
        {mode === 'session' && <>
          <input type="time" value={start || ''} onChange={e => onChange({ start: e.target.value })} style={tStyle} />
          <span style={{ color: T.textMuted }}>→</span>
          <input type="time" value={end || ''} onChange={e => onChange({ end: e.target.value })} style={tStyle} />
        </>}
        <button type="button" onClick={() => setPicking(true)} style={redBtn} title="open the schedule to pick" aria-label="pick on the schedule">📅</button>
      </div>
      {picking && <SchedulePicker withTime={withTime} range={range}
        initialDate={date || undefined} initialStart={(mode === 'session' ? start : time) || undefined} initialEnd={end || undefined}
        onCancel={() => setPicking(false)}
        onPick={({ date: d, start: s, end: e }) => {
          setPicking(false);
          if (mode === 'date') onChange({ date: d });
          else if (mode === 'datetime') onChange({ date: d, time: s });
          else onChange({ date: d, start: s, end: e });
        }} />}
    </>
  );
}

// 12 mini-months for a year. Tapping a day jumps to Day view for that date.
function YearView({ year, todayISO, daysWithItems, onPickDay }) {
  const isMobile = useIsMobile();
  return (
    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: isMobile ? 12 : 18 }}>
      {CAL_MON.map((mon, m) => {
        const first = new Date(year, m, 1), startDow = first.getDay(), dim = new Date(year, m + 1, 0).getDate();
        const cells = []; for (let i = 0; i < startDow; i++) cells.push(null);
        for (let d = 1; d <= dim; d++) cells.push(d);
        return (
          <div key={m}>
            <div style={{ fontFamily: T.fontDisplay, fontSize: 14, fontWeight: 600, color: T.accent, marginBottom: 4 }}>{mon}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1 }}>
              {['S','M','T','W','T','F','S'].map((w, i) => <div key={'h' + i} style={{ fontSize: 8, textAlign: 'center', color: T.textFaint, fontFamily: T.fontMono }}>{w}</div>)}
              {cells.map((d, i) => {
                if (d == null) return <div key={'e' + i} />;
                const dISO = fmtISO(new Date(year, m, d)), isTd = dISO === todayISO, has = daysWithItems.has(dISO);
                return (
                  <button key={i} onClick={() => onPickDay(dISO)} style={{
                    fontSize: 10, textAlign: 'center', padding: '3px 0', border: 'none', cursor: 'pointer',
                    fontFamily: T.fontMono, borderRadius: 999,
                    background: isTd ? T.accent : 'transparent', color: isTd ? '#fff' : (has ? T.text : T.textMuted),
                    fontWeight: (isTd || has) ? 700 : 400,
                  }}>{d}</button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CalendarView(props) {
  const { data, onSelectBlock, onSelectDay, onSelectSlot, selectedSlot } = props;
  const isMobile = useIsMobile();
  const today = data.todayDate, todayISO = data.todayISO;
  const [mode, setMode] = vUseState(() => { try { const m = localStorage.getItem('todouz.calMode'); return (m === 'day' || m === 'week') ? 'days' : (m || 'month'); } catch { return 'month'; } });
  const setModeP = (m) => { setMode(m); try { localStorage.setItem('todouz.calMode', m); } catch {} };
  const [anchor, setAnchor] = vUseState(() => new Date(today));   // drives days/year
  const anchorISO = fmtISO(anchor);
  const week = vUseMemo(() => weekDaysOf(anchor), [anchorISO]);
  // The merged "Day" view shows 2 columns at a time on a phone and lets you
  // swipe sideways through a 14-day window; desktop shows 7 days at once.
  const DAY_PERVIEW = isMobile ? 2 : 7;
  const dayWindow = vUseMemo(() => {
    const n = isMobile ? 14 : 7;
    // Start the window at the anchor (today by default) so TODAY is the leftmost
    // column — a rolling 7-day view, not a fixed Sun–Sat week. Paging by ‹ › and
    // the "Today" button reset the anchor, so today snaps back to the far left.
    const base = new Date(anchor);
    return Array.from({ length: n }, (_, i) => fmtISO(new Date(base.getFullYear(), base.getMonth(), base.getDate() + i)));
  }, [anchorISO, isMobile]);
  // All hooks are declared up here — before any early return — so hook order
  // stays identical across day/week/month/year (Rules of Hooks).
  const [gridBlocks, setGridBlocks] = vUseState({});
  const [yearDots, setYearDots] = vUseState(() => new Set());
  const rangeKey = mode === 'year' ? `y${anchor.getFullYear()}` : `${dayWindow[0]}:${dayWindow.length}`;
  vUseEffect(() => {
    if (mode === 'month') return;                 // month has its own data path
    let alive = true;
    if (mode === 'year') {
      api('list_upcoming', { days: 366, from_date: `${anchor.getFullYear()}-01-01` })
        .then(r => { if (!alive) return; const s = new Set(); for (const dd of (r.days_list || [])) if ((dd.items || []).length || (dd.timeblocks || []).length) s.add(dd.date); setYearDots(s); })
        .catch(() => { if (alive) setYearDots(new Set()); });
    } else {
      api('list_upcoming', { days: dayWindow.length, from_date: dayWindow[0] })
        .then(r => { if (!alive) return; const m = {}; for (const dd of (r.days_list || [])) m[dd.date] = dd.timeblocks || []; setGridBlocks(m); })
        .catch(() => { if (alive) setGridBlocks({}); });
    }
    return () => { alive = false; };
  }, [mode, rangeKey, data.tick]);

  // Drag a session block onto another day column → reschedule it to that date
  // (same time of day). Optimistically re-bucket it so it jumps instantly, then
  // persist via update_timeblock and refetch to reconcile.
  const moveBlock = async (payload, newDate) => {
    if (!payload || !payload.id || payload.date === newDate) return;
    setGridBlocks(prev => {
      const moved = (prev[payload.date] || []).find(b => b.id === payload.id);
      const next = { ...prev, [payload.date]: (prev[payload.date] || []).filter(b => b.id !== payload.id) };
      next[newDate] = [...(next[newDate] || []), moved ? { ...moved } : { id: payload.id, start: payload.start, end: payload.end, title: payload.title }];
      return next;
    });
    try { await api('update_timeblock', { id: payload.id, patch: { date: newDate } }); } catch {}
    if (data.refetch) data.refetch();
  };

  const switcher = (
    <div style={{ display: 'inline-flex', gap: 0, background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 999, padding: 2 }}>
      {CAL_MODES.map(o => (
        <button key={o.k} onClick={() => setModeP(o.k)} style={{
          padding: isMobile ? '7px 11px' : '3px 10px', minHeight: isMobile ? 32 : 0,
          fontFamily: T.fontBody, fontSize: isMobile ? 12 : 11, fontWeight: 500,
          color: mode === o.k ? T.text : T.textMuted, background: mode === o.k ? T.surface : 'transparent',
          border: 'none', borderRadius: 999, cursor: 'pointer', boxShadow: mode === o.k ? T.shadowSm : 'none',
        }}>{o.label}</button>
      ))}
    </div>
  );

  // Month keeps its own self-contained grid + nav + tap-sheet.
  if (mode === 'month') return <CalendarMonth {...props} headerExtras={switcher} />;

  const shift = (dir) => {
    const d = new Date(anchor);
    if (mode === 'days') d.setDate(d.getDate() + dir * DAY_PERVIEW);   // page by what's visible
    else d.setFullYear(d.getFullYear() + dir);   // year
    setAnchor(d);
  };
  const dwFirst = parseISODate(dayWindow[0]), dwLast = parseISODate(dayWindow[dayWindow.length - 1]);
  const title = mode === 'days'
    ? (isMobile ? `${dwFirst.getDate()} ${CAL_MON[dwFirst.getMonth()]}`
        : `${dwFirst.getDate()} ${CAL_MON[dwFirst.getMonth()]} – ${dwLast.getDate()} ${CAL_MON[dwLast.getMonth()]} ${dwLast.getFullYear()}`)
    : String(anchor.getFullYear());
  const navBtn = (label, onClick, key) => (
    <button key={key} onClick={onClick} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, minWidth: 30, height: 30, cursor: 'pointer', color: T.text, fontFamily: T.fontBody, fontSize: 13, padding: '0 8px' }}>{label}</button>
  );

  return (
    <section style={{ marginBottom: 32 }}>
      <CalHeader
        isMobile={isMobile}
        titleMain={title}
        titleSub={null}
        switcher={switcher}
        nav={<>
          {navBtn('‹', () => shift(-1), 'p')}
          {navBtn('Today', () => setAnchor(new Date(today)), 't')}
          {navBtn('›', () => shift(1), 'n')}
        </>}
      />
      {mode === 'year'
        ? <YearView year={anchor.getFullYear()} todayISO={todayISO} daysWithItems={yearDots} onPickDay={(dISO) => { setAnchor(parseISODate(dISO)); setModeP('days'); onSelectDay && onSelectDay(dISO); }} />
        : <TimeGridView days={dayWindow} perView={DAY_PERVIEW} blocksByDate={gridBlocks} onSelectBlock={onSelectBlock} onSelectSlot={onSelectSlot} onMoveBlock={moveBlock} selectedSlot={selectedSlot} todayISO={todayISO} />}
      {mode === 'days' && (
        <div style={{ fontSize: 11, color: T.textFaint, fontStyle: 'italic', marginTop: 8, textAlign: 'center' }}>
          Tap a time to select it, then use ＋ in the top bar to add an item or session there.{isMobile ? ' Swipe sideways for more days.' : ''}
        </div>
      )}
    </section>
  );
}
// Day + Week merged into one "Day" mode (2 days at a time on a phone, whole
// week on desktop — see CalendarView.dayWindow).
const CAL_MODES = [{ k: 'days', label: 'Day' }, { k: 'month', label: 'Month' }, { k: 'year', label: 'Year' }];

function PlanSection(props) {
  // The Today tab keeps the agenda-style "Next 7 days" strip; the Plan tab and
  // desktop get the full Day/Week/Month/Year calendar.
  if (props.forceMode === 'week') return <WeekStrip {...props} />;
  return <CalendarView {...props} />;
}

// ─── IssuesSection ───────────────────────────────────────────────────
// Combined Deadlines + Overdue + Epics, with a search bar and a By-due-date /
// By-epic toggle. By-due-date is a flat list sorted by due asc (overdue first,
// no-due last) with a "⚠ no blocks" warning on issues missing timeblocks.
// Warning chip palette — withAlpha() requires a real hex, and T.warning is a CSS
// variable ('var(--warning)') so we keep a literal here to drive the soft chip wash.
const WARNING_HEX = '#b45309';
// Short-slug of the per-list default folder that holds loose items (items added
// directly under a list rather than into a named folder). Rendered bare.
const LOOSE_SLUG = 'inbox';

// Window options: how far ahead we surface upcoming issues by default.
// Each maps to a day-count from today; 'all' = no upper bound.
const WINDOW_OPTIONS = [
  { k: 'w1', label: 'Next 7 days',  days: 7 },
  { k: 'w2', label: 'Next 2 weeks', days: 14 },
  { k: 'm1', label: 'Next month',   days: 30 },
  { k: 'all', label: 'All',         days: null },
];
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

function IssuesSection({ data, onSelectIssue, onSelectEpic, onRefresh, forceMode }) {
  const isMobile = useIsMobile();
  // Persisted user prefs so the section remembers your last setup across reloads.
  const [modeState, setMode] = vUseState(() => {
    try { return localStorage.getItem('todouz.issuesMode') || 'date'; } catch { return 'date'; }
  });
  // forceMode: the mobile tabs own the split now — by-due-date lives on Today,
  // by-epic on Issues — so each view has exactly one home and the in-section
  // toggle would just be a second, contradictory control.
  const mode = forceMode || modeState;
  // Filters default to OFF: dueMode 'any' shows every open item, and the user
  // narrows from the single Filters dropdown. (Was a persisted 7-day window +
  // a row of chips.) dueMode is remembered; the rest are transient lenses.
  const [dueMode, setDueMode] = vUseState(() => {
    try { return localStorage.getItem('todouz.dueMode') || 'any'; } catch { return 'any'; }
  });
  const [includeLater, setIncludeLater] = vUseState(() => {
    try { return localStorage.getItem('todouz.includeLater') === '1'; } catch { return false; }
  });
  const [includeNoDue, setIncludeNoDue] = vUseState(() => {
    try { return localStorage.getItem('todouz.includeNoDue') === '1'; } catch { return false; }
  });
  const [onlyMissingTb, setOnlyMissingTb] = vUseState(false);
  // Multi-select priority filter (OR within priorities). Transient.
  const [activePriorities, setActivePriorities] = vUseState([]);
  // Multi-select tag filter (AND semantics). Not persisted — tags are a
  // transient lens, unlike the due window which is a standing preference.
  const [activeTags, setActiveTags] = vUseState([]);
  // Multi-select assignee filter (OR). The user list comes from the auth config.
  const [activeAssignees, setActiveAssignees] = vUseState([]);
  const [allUsers, setAllUsers] = vUseState([]);
  vUseEffect(() => {
    fetch('/api/category-visibility').then(r => r.json()).then(j => setAllUsers(j.users || [])).catch(() => {});
  }, []);
  const [pageSize, setPageSize] = vUseState(() => {
    try {
      const n = parseInt(localStorage.getItem('todouz.issuesPageSize') || '', 10);
      return PAGE_SIZE_OPTIONS.includes(n) ? n : 25;
    } catch { return 25; }
  });
  const [pageIdx, setPageIdx] = vUseState(0);
  const [search, setSearch] = vUseState('');
  const [allIssues, setAllIssues] = vUseState(null);
  const [blocksByIssue, setBlocksByIssue] = vUseState({});

  const persist = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  const setModeP = (m) => { setMode(m); persist('todouz.issuesMode', m); };
  const setDueModeP = (m) => { setDueMode(m); persist('todouz.dueMode', m); setPageIdx(0); };
  const setIncludeLaterP = (b) => { setIncludeLater(b); persist('todouz.includeLater', b ? '1' : '0'); setPageIdx(0); };
  const setIncludeNoDueP = (b) => { setIncludeNoDue(b); persist('todouz.includeNoDue', b ? '1' : '0'); setPageIdx(0); };
  const togglePriority = (p) => { setActivePriorities(cur => cur.includes(p) ? cur.filter(x => x !== p) : [...cur, p]); setPageIdx(0); };
  const toggleAssignee = (u) => { setActiveAssignees(cur => cur.includes(u) ? cur.filter(x => x !== u) : [...cur, u]); setPageIdx(0); };
  const clearAllFilters = () => {
    setDueModeP('any'); setIncludeLaterP(false); setIncludeNoDueP(false);
    setOnlyMissingTb(false); setActivePriorities([]); setActiveTags([]); setActiveAssignees([]); setPageIdx(0);
  };
  const setPageSizeP = (n) => { setPageSize(n); persist('todouz.issuesPageSize', String(n)); setPageIdx(0); };

  // Pull every open issue + every upcoming block (next 6 months) once. Both come
  // from cheap list endpoints, and we refetch whenever the parent's data ticks.
  // Keyed on the data version rather than counts: a retag/rename/reprioritise
  // changes no count, so the old key never moved and this list kept serving
  // pre-edit tags to the filter.
  const refetchKey = `${data.tick || 0}:${data.todayISO}`;
  vUseEffect(() => {
    let alive = true;
    (async () => {
      try {
        const today = data.todayDate || new Date();
        const horizon = new Date(today.getTime() + 365 * 86400000);
        const [iss, tb] = await Promise.all([
          api('list_issues', { status: 'open' }),
          api('list_timeblocks', { from_date: fmtISO(startOfDay(today)), to_date: fmtISO(horizon) }),
        ]);
        if (!alive) return;
        const m = {};
        for (const b of (tb.blocks || [])) {
          if (!b.issue_id || !b.epic_slug) continue;
          const k = `${b.epic_slug}:${b.issue_id}`;
          (m[k] = m[k] || []).push(b);
        }
        setAllIssues(iss.issues || []);
        setBlocksByIssue(m);
      } catch { setAllIssues([]); setBlocksByIssue({}); }
    })();
    return () => { alive = false; };
  }, [refetchKey]);

  // Compute the visible set. Each active filter narrows independently (AND):
  //   text search → tags → priority → due-date range → "only missing a session".
  // With no filters (dueMode 'any', nothing else set) every open item shows.
  const todayISO = data.todayISO;
  const visible = vUseMemo(() => {
    const q = search.trim().toLowerCase();
    const today = data.todayDate || new Date();
    const DUE_DAYS = { w1: 7, w2: 14, m1: 30 };
    const days = DUE_DAYS[dueMode];
    const horizonISO = days == null ? null : fmtISO(new Date(startOfDay(today).getTime() + days * 86400000));

    // Folders are grouping nodes — never listed as work in the by-date view.
    let list = (allIssues || []).filter(it => !it.template_id && (it.type || 'issue') !== 'folder');
    if (q) {
      // Support multi-token AND search: "fast protein main" only keeps items
      // whose combined haystack contains all three tokens. Whitespace-splits
      // the query. Empty tokens (double-spaces) are ignored.
      const tokens = q.split(/\s+/).filter(Boolean);
      list = list.filter(it => {
        const hay = (
          (it.title || '') + ' ' +
          (it.epic_slug || '') + ' ' +
          (it.id || '') + ' ' +
          (it.parent_title || '') + ' ' +
          (it.description_snippet || '')
        ).toLowerCase();
        return tokens.every(tok => hay.includes(tok));
      });
    }
    // Tag filter (AND).
    if (activeTags.length) {
      list = list.filter(it => {
        const itTags = it.tags || [];
        return activeTags.every(t => itTags.includes(t));
      });
    }
    // Priority filter (OR within the picked priorities).
    if (activePriorities.length) {
      list = list.filter(it => activePriorities.includes(it.priority || 'medium'));
    }
    // Assignee filter (OR) — keep items assigned to any of the picked people.
    if (activeAssignees.length) {
      list = list.filter(it => {
        const a = Array.isArray(it.assign_to) ? it.assign_to : (it.assign_to ? [it.assign_to] : []);
        return activeAssignees.some(u => a.includes(u));
      });
    }
    // Due-date range. Only gates when a concrete range is picked; 'any' shows
    // everything (incl. no-due + later) so "no filters" means "no hiding".
    if (dueMode !== 'any') {
      list = list.filter(it => {
        if (!it.due) return includeNoDue;                    // explicit toggle for no-due
        if (it.due < todayISO) return true;                   // overdue always visible
        if (horizonISO == null) return true;
        if (it.due <= horizonISO) return true;                // inside the window
        return includeLater;                                  // beyond → only if toggled on
      });
    }
    if (onlyMissingTb) {
      // Only items with a due date can be "missing a session" — no-due reference
      // items never need one, so they're not surfaced by this filter.
      list = list.filter(it => it.due && !(blocksByIssue[`${it.epic_slug}:${it.id}`] || []).length);
    }
    // Sort once here so pagination slices the chronologically-correct list.
    // Order: due asc (overdue first → today → upcoming), no-due last; tie-break by priority then id.
    const PRIO = { high: 0, medium: 1, low: 2 };
    list.sort((a, b) => {
      if (!a.due && !b.due) {
        const pa = PRIO[a.priority] ?? 1, pb = PRIO[b.priority] ?? 1;
        if (pa !== pb) return pa - pb;
        return (a.id || '').localeCompare(b.id || '');
      }
      if (!a.due) return 1;
      if (!b.due) return -1;
      if (a.due !== b.due) return a.due.localeCompare(b.due);
      const pa = PRIO[a.priority] ?? 1, pb = PRIO[b.priority] ?? 1;
      if (pa !== pb) return pa - pb;
      return (a.id || '').localeCompare(b.id || '');
    });
    return list;
  }, [allIssues, blocksByIssue, search, dueMode, includeLater, includeNoDue, onlyMissingTb, activePriorities, activeAssignees, activeTags, todayISO]);

  // Universe of tags across all open issues (not just the visible page) so the
  // filter row is stable while you toggle. Sorted by frequency then alpha.
  const allTags = vUseMemo(() => {
    const freq = new Map();
    for (const it of (allIssues || [])) {
      if (it.template_id) continue;
      for (const t of (it.tags || [])) freq.set(t, (freq.get(t) || 0) + 1);
    }
    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([t]) => t);
  }, [allIssues]);

  // Tags grouped by the list (top-level category) they appear in, then by
  // family inside each list — feeds the Filters dropdown's nested Tags section
  // (e.g. "Kitchen › meal/cuisine/…", "Learning › ml-course/…").
  const tagLists = vUseMemo(() => {
    const byList = new Map();     // list -> Set(tag)
    for (const it of (allIssues || [])) {
      if (it.template_id) continue;
      const list = (it.epic_slug || '').split('/')[0] || 'other';
      for (const t of (it.tags || [])) {
        if (!byList.has(list)) byList.set(list, new Set());
        byList.get(list).add(t);
      }
    }
    return [...byList.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([list, tags]) => ({ list, families: groupTags([...tags]) }));
  }, [allIssues]);

  // Clamp the active page if the visible set shrinks beneath the current offset.
  const totalPages = Math.max(1, Math.ceil(visible.length / pageSize));
  const safePageIdx = Math.min(pageIdx, totalPages - 1);
  const pageStart = safePageIdx * pageSize;
  const pageItems = visible.slice(pageStart, pageStart + pageSize);

  // Single source for both view-mode toggle pills and the window/page selector pills.
  // Sizing splits by pointer type: a 20px-tall pill is fine for a mouse and
  // hopeless for a thumb, so touch gets ~34px of height and a readable 13px.
  const pill = (active, label, onClick, key) => (
    <button
      key={key}
      onClick={onClick}
      style={{
        padding: isMobile ? '8px 14px' : '3px 10px', minHeight: isMobile ? 34 : 0,
        fontFamily: T.fontBody, fontSize: isMobile ? 13 : 11, fontWeight: 500,
        color: active ? T.text : T.textMuted,
        background: active ? T.surface : 'transparent',
        border: 'none', borderRadius: 999, cursor: 'pointer',
        boxShadow: active ? T.shadow : 'none',
      }}
    >{label}</button>
  );
  // Standalone chip (used for multi-select filters). Tinted accent when active.
  const chip = (active, label, onClick, opts = {}) => {
    const accent = opts.accent || T.accent;
    return (
      <button
        onClick={onClick}
        style={{
          padding: isMobile ? '7px 13px' : '3px 10px', minHeight: isMobile ? 34 : 0,
          fontFamily: T.fontBody, fontSize: isMobile ? 13 : 11, fontWeight: 500,
          color: active ? '#fff' : T.textMuted,
          background: active ? accent : T.surface,
          border: `1px solid ${active ? accent : T.border}`,
          borderRadius: 999, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 4,
        }}
        title={opts.title || ''}
      >
        {opts.icon && <span style={{ fontSize: 11 }}>{opts.icon}</span>}
        {label}
      </button>
    );
  };

  return (
    <section style={{ marginTop: 24 }}>
      {/* Row 1: section label + count + search + view-mode toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ ...SECTION_LABEL, margin: 0 }}>Items</div>
        <span style={{ fontSize: 11, color: T.textFaint, fontFamily: T.fontMono }}>
          {visible.length}{(visible.length !== (allIssues || []).length) ? ` / ${(allIssues || []).length}` : ''}
        </span>
        <div style={{ flex: 1, minWidth: 180, display: 'flex', justifyContent: 'flex-end' }}>
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPageIdx(0); }}
            placeholder="search items…"
            style={{
              width: '100%', maxWidth: 320,
              padding: '5px 10px',
              background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6,
              fontFamily: T.fontBody, fontSize: 12, color: T.text, outline: 'none',
            }}
          />
        </div>
        {!forceMode && (
          <div style={{ display: 'inline-flex', gap: 0, background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 999, padding: 2 }}>
            {pill(mode === 'date', 'By due date', () => setModeP('date'), 'mdate')}
            {pill(mode === 'epic', 'By folder', () => setModeP('epic'), 'mepic')}
          </div>
        )}
      </div>

      {/* Row 2 — a single Filters dropdown (by-date mode only; the by-folder
          view carries its own per-list Filters button inside each column).
          Collapses the old window pills + Later/No-due/No-timeblock chips +
          per-family tag menus into one nested menu. */}
      {mode === 'date' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <FilterMenu
            showListHeaders
            due={{ mode: dueMode, setMode: setDueModeP, includeLater, setIncludeLater: setIncludeLaterP, includeNoDue, setIncludeNoDue: setIncludeNoDueP }}
            missing={{ value: onlyMissingTb, setValue: (v) => { setOnlyMissingTb(v); setPageIdx(0); } }}
            priority={{ active: activePriorities, toggle: togglePriority }}
            assignee={{ active: activeAssignees, toggle: toggleAssignee, users: allUsers }}
            tagLists={tagLists}
            activeTags={activeTags}
            onToggleTag={(t) => { setActiveTags(cur => cur.includes(t) ? cur.filter(x => x !== t) : [...cur, t]); setPageIdx(0); }}
            onClearAll={clearAllFilters}
          />
        </div>
      )}

      {allIssues == null && (
        <div style={{ fontSize: 12, color: T.textFaint, fontStyle: 'italic' }}>loading…</div>
      )}
      {allIssues != null && mode === 'date' && (
        <>
          <IssuesByDate
            issues={pageItems}
            blocksByIssue={blocksByIssue}
            todayISO={data.todayISO}
            onSelectIssue={onSelectIssue}
          />
          <PaginationBar
            total={visible.length}
            pageSize={pageSize}
            pageIdx={safePageIdx}
            totalPages={totalPages}
            onPageSize={setPageSizeP}
            onPage={setPageIdx}
          />
        </>
      )}
      {/* By-folder hides overdue in among the folders, so surface a dedicated
          Overdue section at the top (past-due open items, most-overdue first). */}
      {mode === 'epic' && <OverdueSection data={data} onSelectIssue={onSelectIssue} />}
      {allIssues != null && mode === 'epic' && (
        <IssuesByEpic
          data={data}
          search={search}
          allIssues={allIssues}
          filteredIds={new Set(visible.map(it => `${it.epic_slug}:${it.id}`))}
          onSelectIssue={onSelectIssue}
          onSelectEpic={onSelectEpic}
          onRefresh={onRefresh}
        />
      )}
    </section>
  );
}

// Footer bar — page-size selector + Showing X–Y of Z + prev/next nav.
// Renders compactly when only one page exists so the section doesn't feel
// padded out for short lists.
function PaginationBar({ total, pageSize, pageIdx, totalPages, onPageSize, onPage }) {
  const isMobile = useIsMobile();
  if (total === 0) return null;
  const from = total === 0 ? 0 : pageIdx * pageSize + 1;
  const to = Math.min(total, (pageIdx + 1) * pageSize);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, marginTop: 10,
      padding: '6px 4px', flexWrap: 'wrap',
    }}>
      <span style={{ fontSize: 11, fontFamily: T.fontMono, color: T.textMuted }}>
        Showing {from}–{to} of {total}
      </span>
      <div style={{ flex: 1 }} />
      <span style={{ fontSize: 10, fontFamily: T.fontMono, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '0.12em' }}>Per page</span>
      <div style={{ display: 'inline-flex', gap: 0, background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 999, padding: 2 }}>
        {PAGE_SIZE_OPTIONS.map(n => (
          <button
            key={n}
            onClick={() => onPageSize(n)}
            style={{
              padding: isMobile ? '8px 14px' : '3px 10px', minHeight: isMobile ? 34 : 0,
              fontFamily: T.fontBody, fontSize: isMobile ? 13 : 11, fontWeight: 500,
              color: pageSize === n ? T.text : T.textMuted,
              background: pageSize === n ? T.surface : 'transparent',
              border: 'none', borderRadius: 999, cursor: 'pointer',
              boxShadow: pageSize === n ? T.shadow : 'none',
            }}
          >{n}</button>
        ))}
      </div>
      {totalPages > 1 && (
        <>
          <button onClick={() => onPage(Math.max(0, pageIdx - 1))} disabled={pageIdx === 0} style={pageBtnStyle(pageIdx === 0, isMobile)}>‹</button>
          <span style={{ fontSize: 11, fontFamily: T.fontMono, color: T.textMuted, minWidth: 50, textAlign: 'center' }}>
            {pageIdx + 1} / {totalPages}
          </span>
          <button onClick={() => onPage(Math.min(totalPages - 1, pageIdx + 1))} disabled={pageIdx >= totalPages - 1} style={pageBtnStyle(pageIdx >= totalPages - 1, isMobile)}>›</button>
        </>
      )}
    </div>
  );
}
function pageBtnStyle(disabled, isMobile) {
  return {
    background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6,
    width: isMobile ? 36 : 26, height: isMobile ? 36 : 26, padding: 0,
    fontFamily: T.fontDisplay, fontSize: isMobile ? 20 : 16, color: disabled ? T.textFaint : T.text,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    lineHeight: 1,
  };
}

// Flat list of issues with lightweight bucket headers (Overdue / Today / etc.).
// Assumes the parent already sorted the list — sorting before pagination ensures
// the chronological order doesn't fragment across pages.
function IssuesByDate({ issues, blocksByIssue, todayISO, onSelectIssue }) {
  if (!issues.length) {
    return <div style={{ fontSize: 12, color: T.textFaint, fontStyle: 'italic' }}>no items match</div>;
  }

  // Insert lightweight section headers so the eye groups Overdue / Today / Upcoming / Someday.
  const groups = [];
  let cur = null;
  for (const it of issues) {
    const g = bucketFor(it.due, todayISO);
    if (!cur || cur.key !== g) { cur = { key: g, items: [] }; groups.push(cur); }
    cur.items.push(it);
  }

  return (
    <div>
      {groups.map(g => (
        <div key={g.key} style={{ marginBottom: 14 }}>
          <div style={{
            fontFamily: T.fontMono, fontSize: 10, color: T.textFaint,
            textTransform: 'uppercase', letterSpacing: '0.12em',
            margin: '0 0 6px 2px',
          }}>{bucketLabel(g.key)} · {g.items.length}</div>
          {g.items.map(it => (
            <IssueByDateRow
              key={`${it.epic_slug}:${it.id}`}
              issue={it}
              todayISO={todayISO}
              hasBlocks={(blocksByIssue[`${it.epic_slug}:${it.id}`] || []).length > 0}
              blockCount={(blocksByIssue[`${it.epic_slug}:${it.id}`] || []).length}
              onClick={() => onSelectIssue({ id: it.id, epic_slug: it.epic_slug })}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function bucketFor(due, todayISO) {
  if (!due) return 'someday';
  if (due < todayISO) return 'overdue';
  if (due === todayISO) return 'today';
  // within 7 days?
  const t = parseISODate(todayISO);
  const d = parseISODate(due);
  if (t && d && (d.getTime() - t.getTime()) <= 7 * 86400000) return 'thisweek';
  return 'later';
}
function bucketLabel(k) {
  return ({ overdue: 'Overdue', today: 'Today', thisweek: 'Next 7 days', later: 'Later', someday: 'No due date' })[k] || k;
}

function IssueByDateRow({ issue, todayISO, hasBlocks, blockCount, onClick }) {
  const isMobile = useIsMobile();
  const c = epicColor(issue.epic_slug, issue.epic_slug?.split('/')[0]);
  const overdue = issue.due && issue.due < todayISO;
  const isToday = issue.due === todayISO;
  const d = issue.due ? parseISODate(issue.due) : null;
  const dayLabel = d ? `${dayName(d)} ${d.getDate()} ${monthAbbrev(d)}` : 'no due';
  const startDrag = (e) => {
    try {
      e.dataTransfer.setData('application/x-todouz', JSON.stringify({
        kind: 'issue', id: issue.id, epic_slug: issue.epic_slug, currentDate: issue.due,
      }));
      e.dataTransfer.effectAllowed = 'move';
    } catch {}
  };
  return (
    <div
      draggable
      onDragStart={startDrag}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      title={isMobile ? 'tap to open' : 'drag to a day to set/move due date · click to open'}
      style={{
        display: 'flex',
        alignItems: isMobile ? 'stretch' : 'center',
        flexDirection: isMobile ? 'column' : 'row',
        gap: isMobile ? 6 : 10,
        padding: isMobile ? '10px 12px' : '8px 12px', marginBottom: 4,
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderLeft: `3px solid ${c}`,
        borderRadius: 6, cursor: isMobile ? 'pointer' : 'grab',
        transition: 'background 0.12s ease',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = T.surfaceHover; }}
      onMouseLeave={e => { e.currentTarget.style.background = T.surface; }}
    >
      {/* Phone: the heading leads and gets the full width, wrapping to two lines
          rather than being elided to nothing. Everything else drops to a meta
          line underneath. Desktop keeps the single dense row. */}
      {isMobile && (
        <span style={{
          fontSize: 15, fontWeight: 500, color: T.text, lineHeight: 1.35,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>{issue.title}</span>
      )}
      <span style={{
        display: isMobile ? 'flex' : 'contents',
        alignItems: 'center', gap: 8, flexWrap: 'wrap',
      }}>
      <span style={{
        fontFamily: T.fontMono, fontSize: 11, fontWeight: 600,
        color: overdue ? T.overdue : isToday ? T.overdue : T.textMuted,
        minWidth: isMobile ? 0 : 84, flexShrink: 0,
      }}>{isToday ? 'TODAY' : overdue ? `${dayLabel} ⚠` : dayLabel}</span>
      <PriorityDot priority={issue.priority} />
      <EpicTag epicSlug={issue.epic_slug} />
      <ParentTrace parent_id={issue.parent_issue_id} parent_title={issue.parent_title} />
      {!isMobile && (
        <span style={{
          flex: 1, fontSize: 13, color: T.text,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{issue.title}</span>
      )}
      {hasBlocks ? (
        <span style={{
          fontSize: 10, fontFamily: T.fontMono, color: c, fontWeight: 600,
          padding: '1px 6px', background: withAlpha(c, 0.10), borderRadius: 999,
          display: 'inline-flex', alignItems: 'center', gap: 3,
        }} title={`${blockCount} scheduled work session${blockCount === 1 ? '' : 's'}`}>
          <Icon kind="work" size={11} /> {blockCount}
        </span>
      ) : ((issue.type || 'issue') === 'issue' && issue.due) ? (
        <span
          style={{
            fontSize: 10, fontFamily: T.fontMono, color: WARNING_HEX, fontWeight: 600,
            padding: '1px 5px', background: withAlpha(WARNING_HEX, 0.12), borderRadius: 999,
            border: `1px solid ${withAlpha(WARNING_HEX, 0.45)}`,
            whiteSpace: 'nowrap', flexShrink: 0,
          }}
          title="no sessions planned for this yet — add a timeblock"
        >no plan</span>
      ) : null}
      {/* the day label on the left already says when — only the time adds anything */}
      {issue.due_time && (
        <span style={{ fontSize: 11, color: T.textMuted, fontFamily: T.fontMono, fontVariantNumeric: 'tabular-nums' }}>
          {issue.due_time}
        </span>
      )}
      </span>
    </div>
  );
}

// Category order preference. The user's drag-reorder is saved to localStorage
// and wins; categories not covered fall back to this default list, then alpha.
const CATEGORY_ORDER = ['work', 'projects', 'learning', 'health', 'home', 'personal'];
function orderedCategories(cats, savedOrder = []) {
  const rank = new Map();
  let i = 0;
  for (const c of savedOrder) if (cats.includes(c)) rank.set(c, i++);
  for (const c of CATEGORY_ORDER) if (cats.includes(c) && !rank.has(c)) rank.set(c, i++);
  for (const c of [...cats].sort()) if (!rank.has(c)) rank.set(c, i++);
  return [...cats].sort((a, b) => rank.get(a) - rank.get(b));
}

// By-epic mode is the EpicsGrid, but with: search filtering, the user's preferred
// category order, an inline "+ epic" footer per column, and HTML5 drag-and-drop
// so epics can be moved between categories and issues can be moved between epics.
function IssuesByEpic({ data, search, allIssues, filteredIds, onSelectIssue, onSelectEpic, onRefresh }) {
  const q = search.trim();
  const epics = (data.epics?.epics || []);

  // Empty categories (no epics yet) still deserve a column — they exist as
  // folders on disk and are creatable from the +New modal. Merge them in.
  const [diskCats, setDiskCats] = vUseState([]);
  vUseEffect(() => {
    let alive = true;
    api('list_categories').then(r => { if (alive) setDiskCats(r.categories || []); }).catch(() => {});
    return () => { alive = false; };
  }, [data.epics]);

  // Per-user category visibility: which categories are shared vs private-to-owner.
  // { map: {cat: {shared, owner}}, user }. The toggle lives in each column header.
  const [vis, setVis] = vUseState({ map: {}, user: null });
  const loadVis = vUseCallback(() => {
    // GET (read) — api() always POSTs, and the POST route expects a category.
    fetch('/api/category-visibility')
      .then(r => r.json())
      .then(r => setVis({ map: r.visibility || {}, user: r.user || null }))
      .catch(() => {});
  }, []);
  vUseEffect(() => { loadVis(); }, [loadVis]);
  const toggleVisibility = vUseCallback(async (cat, nextShared) => {
    // optimistic: reflect the new state immediately, reconcile from the server
    setVis(v => ({ ...v, map: { ...v.map, [cat]: nextShared ? { shared: true } : { shared: false, owner: v.user } } }));
    try { await api('category-visibility', { category: cat, shared: nextShared }); }
    catch (e) { alert('could not change visibility: ' + (e?.message || e)); }
    loadVis();
  }, [loadVis]);

  // Per-category "on the Projects board" flag — same store/pattern as visibility.
  // Opt-in per list: a category shows on the Projects tab only once toggled on.
  const [proj, setProj] = vUseState({});
  const loadProj = vUseCallback(() => {
    fetch('/api/category-projects').then(r => r.json()).then(r => setProj(r.projects || {})).catch(() => {});
  }, []);
  vUseEffect(() => { loadProj(); }, [loadProj]);
  const toggleProjects = vUseCallback(async (cat, next) => {
    setProj(p => { const n = { ...p }; if (next) n[cat] = { in_projects: true }; else delete n[cat]; return n; });
    try { await api('category-projects', { category: cat, included: next }); }
    catch (e) { alert('could not update Projects: ' + (e?.message || e)); }
    loadProj();
  }, [loadProj]);
  const visibleEpics = q
    ? epics.filter(e => {
        for (const id of filteredIds) if (id.startsWith(e.slug + ':')) return true;
        return false;
      })
    : epics;
  const byCat = vUseMemo(() => {
    const m = {};
    for (const e of visibleEpics) (m[e.category] = m[e.category] || []).push(e);
    return m;
  }, [visibleEpics]);

  // Category order. localStorage is only a paint-now cache — the server copy is
  // the real one, because localStorage is per-browser and an order set on the
  // desktop could never reach the phone.
  const [savedOrder, setSavedOrder] = vUseState(() => {
    try { return JSON.parse(localStorage.getItem('todouz.categoryOrder') || '[]'); } catch { return []; }
  });
  vUseEffect(() => {
    let alive = true;
    fetch('/api/ui-prefs')
      .then(r => r.json())
      .then(j => {
        if (!alive) return;
        const o = j?.prefs?.categoryOrder;
        if (Array.isArray(o) && o.length) {
          setSavedOrder(o);
          try { localStorage.setItem('todouz.categoryOrder', JSON.stringify(o)); } catch {}
        }
      })
      .catch(() => {});   // offline / logged out → keep the cached order
    return () => { alive = false; };
  }, []);
  const persistOrder = (next) => {
    setSavedOrder(next);
    try { localStorage.setItem('todouz.categoryOrder', JSON.stringify(next)); } catch {}
    api('ui-prefs', { categoryOrder: next }).catch(() => {});
  };

  // Always show every existing category column (even if it's currently empty after
  // a search filter) so the user can still drop epics into it. We discover the
  // full category set from data.epics, not the filtered visibleEpics.
  const allCats = vUseMemo(() => {
    const s = new Set();
    for (const e of epics) s.add(e.category);
    for (const c of diskCats) s.add(c);
    return orderedCategories([...s], savedOrder);
  }, [epics, diskCats, savedOrder]);

  const reorder = (movedCat, targetCat) => {
    if (movedCat === targetCat) return;
    const next = allCats.filter(c => c !== movedCat);
    const idx = next.indexOf(targetCat);
    next.splice(idx === -1 ? next.length : idx, 0, movedCat);
    persistOrder(next);
  };

  // Touch can't use HTML5 drag-and-drop at all (iOS Safari never fires it), and
  // a drag gesture inside a vertically-scrolling list of full-width cards fights
  // the scroll. Phones get explicit move controls instead.
  const moveCat = (cat, delta) => {
    const i = allCats.indexOf(cat);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= allCats.length) return;
    const next = allCats.slice();
    [next[i], next[j]] = [next[j], next[i]];
    persistOrder(next);
  };

  if (!allCats.length) {
    return <div style={{ fontSize: 12, color: T.textFaint, fontStyle: 'italic' }}>no folders yet</div>;
  }
  // Flexbox (not grid) so each column can carry its own draggable width and a
  // maximized column can take the full row without breaking siblings.
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-start' }}>
      {allCats.map(cat => (
        <CategoryColumn
          key={cat}
          cat={cat}
          dataTick={data?.tick || 0}
          visEntry={vis.map[cat]}
          onToggleVisibility={toggleVisibility}
          projEntry={proj[cat]}
          onToggleProjects={toggleProjects}
          epics={byCat[cat] || []}
          catIssues={(allIssues || []).filter(it => (it.epic_slug || '').startsWith(cat + '/'))}
          onSelectIssue={onSelectIssue}
          onSelectEpic={onSelectEpic}
          onRefresh={onRefresh}
          onReorder={reorder}
          onMove={moveCat}
          catIndex={allCats.indexOf(cat)}
          catCount={allCats.length}
        />
      ))}
    </div>
  );
}

// One category card. Accepts dragged epics (moves them to this category),
// dragged categories (reorders columns), and hosts an inline "+ epic" bubble.
// The card is resizable: drag the right edge for width, ⤢ toggles full-row.
function catMoveBtnStyle(disabled) {
  return {
    background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6,
    minWidth: 32, minHeight: 32, padding: 0,
    fontSize: 15, lineHeight: 1,
    color: disabled ? T.textFaint : T.text,
    opacity: disabled ? 0.4 : 1,
    cursor: disabled ? 'default' : 'pointer',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  };
}

function CategoryColumn({ cat, epics, catIssues, onSelectIssue, onSelectEpic, onRefresh, onReorder, dataTick, onMove, catIndex, catCount, visEntry, onToggleVisibility, projEntry, onToggleProjects }) {
  const isMobile = useIsMobile();
  // A category with no entry, or shared:true, is visible to everyone. Only a
  // shared:false entry is private — and the server only ever sends us private
  // categories we own, so a visible private one is always ours to re-share.
  const isShared = !visEntry || visEntry.shared !== false;
  const [dragOver, setDragOver] = vUseState(false);
  const [adding, setAdding] = vUseState(false);
  const [draft, setDraft] = vUseState('');
  // List-level "+ add item": loose items live in a per-list default "inbox"
  // folder but render at the list level (bare, no folder chrome).
  const [addingItem, setAddingItem] = vUseState(false);
  const [itemDraft, setItemDraft] = vUseState('');
  // Per-category tag filter — chips live inside this bubble and only narrow
  // what THIS category's epic peeks render.
  const [catTags, setCatTags] = vUseState([]);
  const tagUniverse = vUseMemo(() => {
    const freq = new Map();
    for (const it of (catIssues || [])) {
      if (it.template_id) continue;
      for (const t of (it.tags || [])) freq.set(t, (freq.get(t) || 0) + 1);
    }
    return [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
  }, [catIssues]);
  // Rename-category flow: there's no category entity — renaming means moving
  // every epic in it via update_epic({category}). Empty categories can't be
  // renamed (nothing to move); create the new name from +New instead.
  const [renaming, setRenaming] = vUseState(false);
  const [renameDraft, setRenameDraft] = vUseState(cat);
  const submitRename = async () => {
    const next = renameDraft.trim().toLowerCase().replace(/\s+/g, '-');
    setRenaming(false);
    if (!next || next === cat) return;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(next)) { alert('list must be lowercase letters/digits/dashes'); return; }
    if (!epics.length) { alert('this list has no folders to move — create the new list from + New instead'); return; }
    try {
      for (const e of epics) {
        const r = await api('update_epic', { slug: e.slug, patch: { category: next } });
        if (r?.error) throw new Error(r.error);
      }
      onRefresh && onRefresh();
    } catch (err) { alert('rename failed: ' + (err?.message || err)); }
  };
  // Double-tap the list heading to rename (manual detection for touch).
  const listTapRef = vUseRef(0);
  const startListRename = () => { setRenameDraft(cat); setRenaming(true); };
  const onListTap = () => {
    const now = Date.now();
    if (now - listTapRef.current < 300) { listTapRef.current = 0; startListRename(); }
    else listTapRef.current = now;
  };
  // Per-list priority + assignee filters (used by the always-on Filters button
  // so lists without tags still have something to filter).
  const [catPriorities, setCatPriorities] = vUseState([]);
  const toggleCatPriority = (p) => setCatPriorities(cur => cur.includes(p) ? cur.filter(x => x !== p) : [...cur, p]);
  const [catAssignees, setCatAssignees] = vUseState([]);
  const toggleCatAssignee = (u) => setCatAssignees(cur => cur.includes(u) ? cur.filter(x => x !== u) : [...cur, u]);
  const [catUsers, setCatUsers] = vUseState([]);
  vUseEffect(() => {
    fetch('/api/category-visibility').then(r => r.json()).then(j => setCatUsers(j.users || [])).catch(() => {});
  }, []);

  // Per-category width, persisted. `maximized` overrides width with 100%.
  const [colWidth, setColWidth] = vUseState(() => {
    try {
      const n = parseInt(localStorage.getItem(`todouz.catWidth.${cat}`) || '', 10);
      return Number.isFinite(n) && n >= 260 ? n : 320;
    } catch { return 320; }
  });
  const [maximized, setMaximized] = vUseState(() => {
    try { return localStorage.getItem(`todouz.catMax.${cat}`) === '1'; } catch { return false; }
  });
  const resizingRef = vUseRef(null);   // { startX, startW } while dragging the edge
  vUseEffect(() => {
    const onMove = (e) => {
      const r = resizingRef.current;
      if (!r) return;
      const next = Math.max(260, Math.min(window.innerWidth - 80, r.startW + (e.clientX - r.startX)));
      setColWidth(next);
    };
    const onUp = () => {
      if (!resizingRef.current) return;
      resizingRef.current = null;
      document.body.style.userSelect = '';
      setColWidth(w => { try { localStorage.setItem(`todouz.catWidth.${cat}`, String(w)); } catch {} return w; });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [cat]);
  const toggleMax = () => {
    setMaximized(m => {
      const next = !m;
      try { localStorage.setItem(`todouz.catMax.${cat}`, next ? '1' : '0'); } catch {}
      return next;
    });
  };

  const onDragOver = (e) => {
    // Accept payloads from this dashboard. We don't preview the action mid-drag —
    // a coloured border is enough to communicate "this is a drop target".
    if (!e.dataTransfer.types.includes('application/x-todouz')) return;
    e.preventDefault();
    setDragOver(true);
  };
  const onDrop = async (e) => {
    e.preventDefault();
    setDragOver(false);
    let payload;
    try { payload = JSON.parse(e.dataTransfer.getData('application/x-todouz') || '{}'); } catch { return; }
    if (!payload || !payload.kind) return;
    if (payload.kind === 'category') {
      // Column reorder: dropped category slots in before this one.
      if (payload.cat && onReorder) onReorder(payload.cat, cat);
      return;
    }
    if (payload.kind === 'epic') {
      if (!payload.slug) return;
      const [oldCat] = payload.slug.split('/');
      if (oldCat === cat) return;
      try {
        await api('update_epic', { slug: payload.slug, patch: { category: cat } });
        onRefresh && onRefresh();
      } catch (err) { alert(err.message || 'move failed'); }
    }
    // Issue drops are handled by the EpicCard target — column-level drop on an
    // issue payload is intentionally ignored so the user must aim at a specific
    // epic, not just the column background.
  };

  const submitAdd = async () => {
    const title = draft.trim();
    if (!title) { setAdding(false); return; }
    // create_epic requires a separate slug param — derive one from the title so the
    // inline path stays just "type a name, press Enter". Bumps a suffix on collision.
    const baseSlug = slugify(title) || 'epic';
    let candidateSlug = baseSlug;
    try {
      let r = await api('create_epic', { category: cat, slug: candidateSlug, title });
      // The server returns 200 with { error } on duplicate slugs — retry up to 5×
      // with -2, -3, etc. before giving up.
      let attempt = 1;
      while (r?.error && /already exists/i.test(r.error) && attempt < 6) {
        attempt += 1;
        candidateSlug = `${baseSlug}-${attempt}`;
        r = await api('create_epic', { category: cat, slug: candidateSlug, title });
      }
      if (r?.error) { alert(r.error); return; }
      setDraft('');
      setAdding(false);
      onRefresh && onRefresh();
      // Don't auto-open the folder's detail drawer — the folder just appears in
      // the list, and the drawer is reachable via the ✎ that shows while
      // renaming it. (Auto-opening felt like an intrusive "old side menu".)
    } catch (err) {
      alert('create failed: ' + (err?.message || err));
    }
  };

  const submitAddItem = async () => {
    const title = itemDraft.trim();
    if (!title) { setAddingItem(false); return; }
    try {
      // Ensure the list's default folder exists (idempotent — the server
      // returns { error: 'already exists' } on a repeat, which we ignore).
      await api('create_epic', { category: cat, slug: LOOSE_SLUG, title: 'Loose items' });
      const r = await api('create_issue', { epic: `${cat}/${LOOSE_SLUG}`, title, priority: 'medium' });
      if (r?.error) { alert(r.error); return; }
      setItemDraft('');
      setAddingItem(false);
      onRefresh && onRefresh();
      if (r?.id && onSelectIssue) onSelectIssue({ id: r.id, epic_slug: r.epic_slug || `${cat}/${LOOSE_SLUG}` });
    } catch (err) {
      alert('add item failed: ' + (err?.message || err));
    }
  };

  // Split the list's default "inbox" folder out so it renders bare (loose items
  // at the list level) instead of as a folder card.
  const looseEpic = epics.find(e => (e.slug.split('/')[1] || '') === LOOSE_SLUG);
  const realEpics = epics.filter(e => e !== looseEpic);

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      style={{
        position: 'relative',
        // Phones: every category is full-width (stacked); the drag-width only
        // applies on desktop where columns sit side by side.
        width: (maximized || isMobile) ? '100%' : colWidth,
        flexShrink: 0,
        background: T.surface,
        border: `1px solid ${dragOver ? T.accent : T.border}`,
        outline: dragOver ? `2px dashed ${T.accent}` : 'none',
        outlineOffset: -4,
        borderRadius: 10,
        padding: '14px 14px 10px',
        boxShadow: T.shadow,
        transition: 'border-color 0.12s',
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        paddingBottom: 8, marginBottom: 10,
        borderBottom: `1px solid ${T.border}`,
      }}>
        {/* Desktop keeps a drag grip on the left; on a phone reordering lives in
            the right-hand action group (↑ ↓), next to filters + privacy. */}
        {!isMobile && (
          <span
            draggable
            onDragStart={(e) => {
              try {
                e.dataTransfer.setData('application/x-todouz', JSON.stringify({ kind: 'category', cat }));
                e.dataTransfer.effectAllowed = 'move';
              } catch {}
            }}
            title="drag to reorder lists"
            style={{ cursor: 'grab', color: T.textFaint, fontSize: 13, lineHeight: 1, userSelect: 'none', flexShrink: 0 }}
          >⠿</span>
        )}
        {renaming ? (
          <input
            autoFocus
            value={renameDraft}
            onChange={e => setRenameDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); submitRename(); }
              if (e.key === 'Escape') { setRenaming(false); setRenameDraft(cat); }
            }}
            onBlur={submitRename}
            style={{
              flex: 1, minWidth: 0,
              fontFamily: T.fontDisplay, fontSize: 16, fontWeight: 600, color: T.text,
              background: T.surface2, border: `1px solid ${T.accent}`, borderRadius: 6,
              padding: '2px 8px', outline: 'none',
            }}
          />
        ) : (
          <h3
            onClick={onListTap}
            onDoubleClick={startListRename}
            title="double-tap to rename this list"
            style={{
              flex: 1, minWidth: 0, cursor: 'pointer',
              fontFamily: T.fontDisplay, fontSize: 17, fontWeight: 600, color: T.text, margin: 0,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >{cat}</h3>
        )}
        <span style={{ fontSize: 11, color: T.textFaint, fontFamily: T.fontMono, flexShrink: 0 }}>{realEpics.length}</span>
        {/* Up/down reorder — moved to the right group on mobile. */}
        {isMobile && (
          <span style={{ display: 'inline-flex', gap: 2, flexShrink: 0 }}>
            <button onClick={() => onMove && onMove(cat, -1)} disabled={catIndex === 0} title="move list up" aria-label="move list up" style={catMoveBtnStyle(catIndex === 0)}>↑</button>
            <button onClick={() => onMove && onMove(cat, 1)} disabled={catIndex === catCount - 1} title="move list down" aria-label="move list down" style={catMoveBtnStyle(catIndex === catCount - 1)}>↓</button>
          </span>
        )}
        {/* Filters — always available, icon-only. Priority is universal, so even
            a list with no tags still has something to filter. */}
        <FilterMenu
          compact
          iconOnly
          align="right"
          priority={{ active: catPriorities, toggle: toggleCatPriority }}
          assignee={{ active: catAssignees, toggle: toggleCatAssignee, users: catUsers }}
          tagLists={tagUniverse.length > 0 ? [{ list: cat, families: groupTags(tagUniverse) }] : []}
          activeTags={catTags}
          onToggleTag={(t) => setCatTags(cur => cur.includes(t) ? cur.filter(x => x !== t) : [...cur, t])}
          onClearAll={() => { setCatTags([]); setCatPriorities([]); setCatAssignees([]); }}
        />
        {/* Visibility toggle: shared (both users) ⇄ private (only you). */}
        {onToggleVisibility && (
          <button
            onClick={() => onToggleVisibility(cat, !isShared)}
            title={isShared
              ? 'Shared — visible to everyone. Tap to make private to you.'
              : 'Private — only you can see this. Tap to share with everyone.'}
            aria-label={isShared ? 'shared, tap to make private' : 'private, tap to share'}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent',
              border: 'none', cursor: 'pointer', borderRadius: 6,
              color: isShared ? T.textMuted : T.accent,
              padding: 2, minWidth: isMobile ? 32 : 0, minHeight: isMobile ? 32 : 0, flexShrink: 0,
            }}
            onMouseEnter={e => { if (isShared) e.currentTarget.style.color = T.accent; }}
            onMouseLeave={e => { if (isShared) e.currentTarget.style.color = T.textMuted; }}
          ><Icon kind={isShared ? 'shared' : 'private'} size={isMobile ? 16 : 13} /></button>
        )}
        {/* Projects toggle: include this list on the Projects board (opt-in). */}
        {onToggleProjects && (
          <button
            onClick={() => onToggleProjects(cat, !(projEntry && projEntry.in_projects))}
            title={projEntry && projEntry.in_projects
              ? 'On the Projects board — tap to remove.'
              : 'Not on the Projects board — tap to add.'}
            aria-label={projEntry && projEntry.in_projects ? 'on projects board, tap to remove' : 'add to projects board'}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: 'none', cursor: 'pointer', borderRadius: 6,
              color: (projEntry && projEntry.in_projects) ? T.accent : T.textFaint,
              padding: 2, minWidth: isMobile ? 32 : 0, minHeight: isMobile ? 32 : 0, flexShrink: 0,
            }}
          ><Icon kind="projects" size={isMobile ? 16 : 13} /></button>
        )}
        {/* Rename ✎ + expand ⤢ live on desktop only; on mobile the heading is
            double-tap-to-rename and full-width already. */}
        {!isMobile && (
          <button
            onClick={() => { setRenameDraft(cat); setRenaming(true); }}
            title="rename this list (moves every folder in it)"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: T.textMuted, fontSize: 12, padding: 2, lineHeight: 1, flexShrink: 0,
            }}
            onMouseEnter={e => { e.currentTarget.style.color = T.accent; }}
            onMouseLeave={e => { e.currentTarget.style.color = T.textMuted; }}
          >✎</button>
        )}
        {!isMobile && (
          <button
            onClick={toggleMax}
            title={maximized ? 'restore width' : 'expand to full width'}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: T.textMuted, fontSize: 13, padding: 2, lineHeight: 1, flexShrink: 0,
            }}
            onMouseEnter={e => { e.currentTarget.style.color = T.accent; }}
            onMouseLeave={e => { e.currentTarget.style.color = T.textMuted; }}
          >{maximized ? '⤡' : '⤢'}</button>
        )}
      </div>
      {/* Right-edge width handle (hidden while maximized — width is moot). */}
      {!maximized && (
        <div
          onMouseDown={(e) => {
            e.preventDefault();
            resizingRef.current = { startX: e.clientX, startW: colWidth };
            document.body.style.userSelect = 'none';
          }}
          title="drag to resize"
          style={{ position: 'absolute', top: 0, bottom: 0, right: -3, width: 6, cursor: 'col-resize', zIndex: 3 }}
          onMouseEnter={(e) => { e.currentTarget.style.background = withAlpha('#c2410c', 0.18); }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        />
      )}
      {realEpics.length === 0 && !looseEpic && (
        <div style={{ fontSize: 11, color: T.textFaint, fontStyle: 'italic', padding: '4px 0 6px' }}>
          add a folder or a loose item ↓
        </div>
      )}
      {/* Loose items — the list's default folder, rendered bare so its items
          sit directly under the list, above the named folders. */}
      {looseEpic && (
        <EpicCard
          key={looseEpic.slug}
          epic={looseEpic}
          dataTick={dataTick}
          filterTags={catTags}
          filterPriorities={catPriorities}
          filterAssignees={catAssignees}
          onSelectIssue={onSelectIssue}
          onSelectEpic={onSelectEpic}
          onRefresh={onRefresh}
          bare
        />
      )}
      {realEpics.map(epic => (
        <EpicCard
          key={epic.slug}
          epic={epic}
          dataTick={dataTick}
          filterTags={catTags}
          filterPriorities={catPriorities}
          filterAssignees={catAssignees}
          onSelectIssue={onSelectIssue}
          onSelectEpic={onSelectEpic}
          onRefresh={onRefresh}
          draggable
        />
      ))}
      {/* One row: "+ add item" and "+ add folder" share it half-and-half. When
          one is active its input expands to the full width for comfortable typing. */}
      <div style={{ marginTop: 8 }}>
        {addingItem ? (
          <input
            autoFocus
            value={itemDraft}
            onChange={e => setItemDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); submitAddItem(); }
              if (e.key === 'Escape') { setAddingItem(false); setItemDraft(''); }
            }}
            onBlur={() => { if (!itemDraft.trim()) setAddingItem(false); }}
            placeholder="new item title… enter to add · esc to cancel"
            style={{
              width: '100%', fontSize: 12, color: T.text, padding: '7px 10px',
              background: T.surface, border: `1px dashed ${T.accent}`, borderRadius: 8,
              fontFamily: T.fontBody, outline: 'none', boxSizing: 'border-box',
            }}
          />
        ) : adding ? (
          <input
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); submitAdd(); }
              if (e.key === 'Escape') { setAdding(false); setDraft(''); }
            }}
            onBlur={() => { if (!draft.trim()) setAdding(false); }}
            placeholder="new folder title… enter to add · esc to cancel"
            style={{
              width: '100%', fontSize: 12, color: T.text, padding: '7px 10px',
              background: T.surface, border: `1px dashed ${T.accent}`, borderRadius: 999,
              fontFamily: T.fontBody, outline: 'none', boxSizing: 'border-box',
            }}
          />
        ) : (
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => setAddingItem(true)}
              style={{
                flex: 1, fontSize: 11, color: T.textFaint, padding: isMobile ? '9px 12px' : '7px 12px',
                minHeight: isMobile ? 38 : 0,
                background: 'transparent', border: `1px dashed ${T.border}`, borderRadius: 8,
                cursor: 'pointer', fontFamily: T.fontBody, textAlign: 'center',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = T.text; e.currentTarget.style.borderColor = T.accent; }}
              onMouseLeave={e => { e.currentTarget.style.color = T.textFaint; e.currentTarget.style.borderColor = T.border; }}
              title={`add a loose item to "${cat}"`}
            >+ add item</button>
            <button
              onClick={() => setAdding(true)}
              style={{
                flex: 1, fontSize: 11, color: T.textFaint, padding: isMobile ? '9px 12px' : '7px 12px',
                minHeight: isMobile ? 38 : 0,
                background: 'transparent', border: `1px dashed ${T.border}`, borderRadius: 999,
                cursor: 'pointer', fontFamily: T.fontBody, textAlign: 'center',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = T.text; e.currentTarget.style.borderColor = T.accent; }}
              onMouseLeave={e => { e.currentTarget.style.color = T.textFaint; e.currentTarget.style.borderColor = T.border; }}
              title={`add a new folder to "${cat}"`}
            >+ add folder</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Projects (Kanban) ───────────────────────────────────────────────
// A separate tab. Only lists opted-in via the per-list Projects toggle appear.
// Columns group the open items by Project (each folder = a column), Due bucket,
// or Priority. Natural-language quick-add + drag map to existing tools
// (create_issue / move_issue / update_issue) — no new item field. Cards reuse
// the existing item drawer + select mode.
function ProjectsSection({ data, onSelectIssue, selectMode, isSelected }) {
  const isMobile = useIsMobile();
  const [flags, setFlags] = vUseState(null);   // { cat: { in_projects } }
  const [epics, setEpics] = vUseState([]);     // [{ slug, title, category }]
  const [items, setItems] = vUseState(null);   // open issues
  const [group, setGroup] = vUseState(() => { try { return localStorage.getItem('todouz.projGroup') || 'project'; } catch { return 'project'; } });
  const [catFilter, setCatFilter] = vUseState('all');
  const [epicFilter, setEpicFilter] = vUseState('all');   // a specific epic within the chosen category
  const [dropKey, setDropKey] = vUseState(null);
  const [showDone, setShowDone] = vUseState(false);   // include completed items (the archive, inline)
  const [doneItems, setDoneItems] = vUseState([]);
  const setGroupP = (g) => { setGroup(g); try { localStorage.setItem('todouz.projGroup', g); } catch {} };
  // Picking a category resets any epic drill-down under the old one.
  const pickCat = (c) => { setCatFilter(c); setEpicFilter('all'); };

  const refetchKey = `${data.tick || 0}:${data.todayISO}`;
  vUseEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [fl, ep, iss] = await Promise.all([
          fetch('/api/category-projects').then(r => r.json()).catch(() => ({ projects: {} })),
          api('list_epics'),
          api('list_issues', { status: 'open' }),
        ]);
        if (!alive) return;
        setFlags(fl.projects || {}); setEpics(ep.epics || []); setItems(iss.issues || []);
      } catch { setFlags({}); setEpics([]); setItems([]); }
    })();
    return () => { alive = false; };
  }, [refetchKey]);

  // Completed items are fetched lazily, only when "include done" is on — so the
  // board stays fast by default but you can fold the archive in per folder.
  vUseEffect(() => {
    if (!showDone) { setDoneItems([]); return; }
    let alive = true;
    api('list_issues', { status: 'completed' }).then(r => { if (alive) setDoneItems(r.issues || []); }).catch(() => { if (alive) setDoneItems([]); });
    return () => { alive = false; };
  }, [showDone, refetchKey]);

  const includedCats = vUseMemo(() => Object.keys(flags || {}).filter(c => flags[c] && flags[c].in_projects), [flags]);
  const catOf = (it) => (it.epic_slug || '').split('/')[0];
  const shortOf = (slug) => (slug || '').split('/')[1] || slug;
  const todayISO = data.todayISO;
  const weekISO = fmtISO(new Date(startOfDay(data.todayDate || new Date()).getTime() + 7 * 86400000));

  const allItems = vUseMemo(() => showDone ? [...(items || []), ...doneItems] : (items || []), [items, doneItems, showDone]);
  const scoped = vUseMemo(() => allItems.filter(it =>
    !it.template_id && (it.type || 'issue') !== 'folder' &&
    includedCats.includes(catOf(it)) &&
    (catFilter === 'all' || catOf(it) === catFilter) &&
    (epicFilter === 'all' || it.epic_slug === epicFilter)
  ), [allItems, includedCats, catFilter, epicFilter, todayISO]);

  const projCols = vUseMemo(() => (epics || [])
    .filter(e => includedCats.includes(e.category) && (catFilter === 'all' || e.category === catFilter) && (epicFilter === 'all' || e.slug === epicFilter))
    .sort((a, b) => a.category.localeCompare(b.category) || (a.title || '').localeCompare(b.title || ''))
    .map(e => ({ key: e.slug, label: e.title || shortOf(e.slug), color: categoryColor(e.category) })),
    [epics, includedCats, catFilter, epicFilter]);

  // Epics inside the currently-selected category, for the epic drill-down chips.
  const catEpics = vUseMemo(() => (catFilter === 'all') ? [] : (epics || [])
    .filter(e => e.category === catFilter && includedCats.includes(e.category))
    .sort((a, b) => (a.title || '').localeCompare(b.title || ''))
    .map(e => ({ slug: e.slug, label: e.title || shortOf(e.slug) })),
    [epics, includedCats, catFilter]);

  // Recurring things (weekly tutorials/lectures) get their own column so they
  // don't pile up in Someday — added to both the Due and Priority boards.
  const RECUR_COL = { key: 'recurring', label: 'Recurring', color: '#0e7490' };
  const DUE_COLS = [
    { key: 'over', label: 'Overdue', color: '#b91c1c' },
    { key: 'today', label: 'Today', color: '#c2410c' },
    { key: 'week', label: 'This week', color: '#b45309' },
    { key: 'later', label: 'Later', color: '#5a534b' },
    { key: 'none', label: 'Someday', color: '#9c9489' },
    RECUR_COL,
  ];
  const PRI_COLS = [
    { key: 'high', label: 'High', color: '#b91c1c' },
    { key: 'medium', label: 'Medium', color: '#b45309' },
    { key: 'low', label: 'Low', color: '#9c9489' },
    RECUR_COL,
  ];
  const dueBucket = (it) => { if (!it.due) return 'none'; if (it.due < todayISO) return 'over'; if (it.due === todayISO) return 'today'; if (it.due <= weekISO) return 'week'; return 'later'; };
  const cols = group === 'project' ? projCols : group === 'due' ? DUE_COLS : PRI_COLS;
  // In Due/Priority, recurring items live in the Recurring column regardless of due/priority.
  const keyOf = (it) => group === 'project' ? it.epic_slug : (it.recurring ? 'recurring' : (group === 'due' ? dueBucket(it) : (it.priority || 'medium')));

  const byCol = vUseMemo(() => {
    const m = {}; for (const c of cols) m[c.key] = [];
    for (const it of scoped) { const k = keyOf(it); (m[k] = m[k] || []).push(it); }
    const byDue = (a, b) => {
      const ca = a.is_completed ? 1 : 0, cb = b.is_completed ? 1 : 0;
      if (ca !== cb) return ca - cb;   // completed items sink to the bottom of the column
      return (!a.due && !b.due) ? 0 : (!a.due ? 1 : (!b.due ? -1 : a.due.localeCompare(b.due)));
    };
    for (const k in m) m[k].sort(byDue);
    return m;
  }, [scoped, cols, group, todayISO, weekISO]);

  const patchLocal = (id, fromEpic, fn) => setItems(prev => (prev || []).map(x => (x.id === id && x.epic_slug === fromEpic) ? fn({ ...x }) : x));
  const reload = () => { api('list_issues', { status: 'open' }).then(r => setItems(r.issues || [])).catch(() => {}); if (data.refetch) data.refetch(); };
  // Reopen a completed item straight from the board (replaces digging through the archive view).
  const reopen = async (it) => {
    setDoneItems(prev => prev.filter(x => !(x.id === it.id && x.epic_slug === it.epic_slug)));
    try { await api('update_issue', { id: it.id, epic: it.epic_slug, patch: { status: 'open' } }); } catch {}
    reload();
  };
  const dueForBucket = (k) => {
    const t = startOfDay(data.todayDate || new Date());
    if (k === 'today') return todayISO;
    if (k === 'week') return fmtISO(new Date(t.getTime() + 3 * 86400000));
    if (k === 'later') return fmtISO(new Date(t.getTime() + 14 * 86400000));
    if (k === 'none') return '';
    return null;
  };
  const onDropCard = async (it, colKey) => {
    if (it.is_completed) return;   // completed cards aren't draggable
    if (group === 'project') {
      if (colKey === it.epic_slug) return;
      patchLocal(it.id, it.epic_slug, x => { x.epic_slug = colKey; return x; });
      try { await api('move_issue', { id: it.id, epic: it.epic_slug, target_epic: colKey }); } catch {}
      reload();
    } else if (colKey === 'recurring') {
      if (it.recurring) return;
      patchLocal(it.id, it.epic_slug, x => { x.recurring = true; return x; });
      try { await api('update_issue', { id: it.id, epic: it.epic_slug, patch: { recurring: true } }); } catch {}
      reload();
    } else if (group === 'due') {
      const d = dueForBucket(colKey); if (d === null) return;
      const patch = it.recurring ? { due: d, recurring: false } : { due: d };
      patchLocal(it.id, it.epic_slug, x => { x.due = d || null; if (it.recurring) x.recurring = false; return x; });
      try { await api('update_issue', { id: it.id, epic: it.epic_slug, patch }); } catch {}
      reload();
    } else {
      const patch = it.recurring ? { priority: colKey, recurring: false } : { priority: colKey };
      patchLocal(it.id, it.epic_slug, x => { x.priority = colKey; if (it.recurring) x.recurring = false; return x; });
      try { await api('update_issue', { id: it.id, epic: it.epic_slug, patch }); } catch {}
      reload();
    }
  };

  const WD = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const parseQuick = (raw) => {
    let s = ' ' + raw + ' ';
    const tags = []; let m;
    const tagRe = /\s#([a-z0-9][a-z0-9-]*)/gi; while ((m = tagRe.exec(s))) tags.push(m[1].toLowerCase());
    s = s.replace(/\s#[a-z0-9][a-z0-9-]*/gi, ' ');
    let priority = null;
    const pr = s.match(/\s!(high|h|med|medium|m|low|l)\b/i);
    if (pr) { const p = pr[1].toLowerCase(); priority = p[0] === 'h' ? 'high' : p[0] === 'l' ? 'low' : 'medium'; s = s.replace(pr[0], ' '); }
    let due = null;
    const t = startOfDay(data.todayDate || new Date());
    const iso = s.match(/\s(\d{4}-\d{2}-\d{2})\b/);
    if (iso) { due = iso[1]; s = s.replace(iso[0], ' '); }
    else if (/\btoday\b/i.test(s)) { due = todayISO; s = s.replace(/\btoday\b/i, ' '); }
    else if (/\b(tomorrow|tmr)\b/i.test(s)) { due = fmtISO(new Date(t.getTime() + 86400000)); s = s.replace(/\b(tomorrow|tmr)\b/i, ' '); }
    else { const wm = s.match(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/i); if (wm) { const target = WD.indexOf(wm[1].slice(0, 3).toLowerCase()); let add = (target - t.getDay() + 7) % 7; if (add === 0) add = 7; due = fmtISO(new Date(t.getTime() + add * 86400000)); s = s.replace(wm[0], ' '); } }
    return { title: s.replace(/\s+/g, ' ').trim(), due, priority, tags };
  };
  const quickAdd = async (epicSlug, raw, opts = {}) => {
    if (!epicSlug) return;
    const p = parseQuick(raw); if (!p.title) return;
    const args = { epic: epicSlug, title: p.title };
    if (p.tags.length) args.tags = p.tags;
    if (p.due) args.due = p.due; else if (opts.fallbackDue) args.due = opts.fallbackDue;
    if (p.priority) args.priority = p.priority; else if (opts.priority) args.priority = opts.priority;
    if (opts.recurring) args.recurring = true;
    try { await api('create_issue', args); } catch {}
    reload();
  };

  const tagStyle = { fontSize: 10.5, padding: '1px 7px', borderRadius: 999, background: T.surface2, color: T.textMuted, border: `1px solid ${T.border}` };
  const catColor = (it) => categoryColor(catOf(it));
  const dueChip = (it) => {
    if (!it.due) return null;
    const b = dueBucket(it);
    const col = b === 'over' ? T.overdue : b === 'today' ? T.accent : T.warning;
    const label = b === 'over' ? 'overdue' : b === 'today' ? 'today' : it.due.slice(5);
    return <span style={{ fontSize: 11, color: col, fontWeight: (b === 'over' || b === 'today') ? 500 : 400 }}>◷ {label}</span>;
  };
  const priDot = (p) => <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: p === 'high' ? T.overdue : p === 'low' ? T.textFaint : T.warning }} />;
  const subBar = (it) => {
    const total = it.total_subtask_count || 0; if (!total) return null;
    const done = total - (it.open_subtask_count || 0);
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: T.textFaint }}>
        <span style={{ width: 30, height: 4, borderRadius: 2, background: T.border, overflow: 'hidden' }}>
          <span style={{ display: 'block', height: '100%', width: `${Math.round(done / total * 100)}%`, background: T.done }} />
        </span>{done}/{total}
      </span>
    );
  };
  const Card = (it) => {
    const ref = { kind: 'issue', id: it.id, epic_slug: it.epic_slug, title: it.title };
    const sel = selectMode && isSelected && isSelected(ref);
    const done = !!it.is_completed;
    return (
      <div key={`${it.epic_slug}:${it.id}`} draggable={!isMobile && !done}
        onClick={() => onSelectIssue && onSelectIssue(ref)}
        onDragStart={e => { e.dataTransfer.setData('text', `${it.epic_slug}||${it.id}`); e.dataTransfer.effectAllowed = 'move'; }}
        style={{ background: done ? T.surface2 : T.surface, border: `1px solid ${sel ? T.accent : T.border}`, borderLeft: `3px solid ${done ? T.border : catColor(it)}`, borderRadius: 10, padding: '9px 11px', cursor: isMobile ? 'pointer' : (done ? 'pointer' : 'grab'), boxShadow: done ? 'none' : T.shadowSm, opacity: done ? 0.72 : 1 }}>
        {group !== 'project' && <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.03em', color: done ? T.textFaint : catColor(it), marginBottom: 3 }}>{shortOf(it.epic_slug)}</div>}
        <div style={{ fontSize: 13.5, lineHeight: 1.35, color: done ? T.textMuted : T.text, textDecoration: done ? 'line-through' : 'none' }}>{it.title}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          {done ? (
            <button onClick={e => { e.stopPropagation(); reopen(it); }} title="reopen this item"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'transparent', border: `1px solid ${T.border}`, color: T.textMuted, borderRadius: 999, padding: '2px 9px', fontSize: 11, cursor: 'pointer' }}>↩ reopen</button>
          ) : <>{priDot(it.priority || 'medium')}{dueChip(it)}{subBar(it)}</>}
          {it.recurring && <span title="recurring" style={{ fontSize: 11, color: RECUR_COL.color, fontWeight: 600 }}>♻</span>}
          {(it.tags || []).slice(0, 1).map(t => <span key={t} style={tagStyle}>{t}</span>)}
        </div>
      </div>
    );
  };
  const colEl = (c) => {
    const list = byCol[c.key] || [];
    const isDrop = dropKey === c.key;
    return (
      <div key={c.key}
        onDragOver={e => { if (!isMobile) { e.preventDefault(); if (dropKey !== c.key) setDropKey(c.key); } }}
        onDragLeave={() => { if (dropKey === c.key) setDropKey(null); }}
        onDrop={e => { e.preventDefault(); setDropKey(null); const parts = String(e.dataTransfer.getData('text')).split('||'); const it = (items || []).find(x => x.id === parts[1] && x.epic_slug === parts[0]); if (it) onDropCard(it, c.key); }}
        style={{ flex: `0 0 ${isMobile ? '80vw' : '284px'}`, background: T.surface2, border: `1px solid ${isDrop ? T.accent : T.border}`, outline: isDrop ? `2px dashed ${T.accent}` : 'none', outlineOffset: -2, borderRadius: 14, padding: 10, maxHeight: isMobile ? 'none' : 'calc(100vh - 250px)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '2px 4px 8px' }}>
          <span style={{ width: 9, height: 9, borderRadius: 3, background: c.color, flexShrink: 0 }} />
          <span style={{ fontWeight: 600, fontSize: 13.5, color: T.text }}>{c.label}</span>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: T.textFaint, background: T.surface, borderRadius: 999, padding: '1px 8px' }}>{list.length}</span>
        </div>
        {projCols.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: T.surface, border: `1px dashed ${T.borderStrong}`, borderRadius: 9, padding: '7px 9px', marginBottom: 8, flexWrap: 'wrap' }}>
            <span style={{ color: T.accent }}>＋</span>
            <input placeholder={group === 'project' ? `add to ${c.label}…` : (c.key === 'recurring' ? 'add recurring…' : 'add task…')}
              onKeyDown={e => {
                if (e.key !== 'Enter' || !e.target.value.trim()) return;
                const raw = e.target.value.trim();
                const tgt = group === 'project' ? c.key : ((document.getElementById(`padd-${c.key}`) || {}).value || (epicFilter !== 'all' ? epicFilter : (projCols[0] || {}).key));
                const opts = {};
                if (group === 'due') { const d = dueForBucket(c.key); if (d) opts.fallbackDue = d; }
                if (group === 'priority') opts.priority = c.key;
                if (c.key === 'recurring') opts.recurring = true;
                quickAdd(tgt, raw, opts);
                e.target.value = '';
              }}
              style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontFamily: T.fontBody, fontSize: 13, color: T.text, minWidth: 80 }} />
            {group !== 'project' && (
              <select id={`padd-${c.key}`} defaultValue={epicFilter !== 'all' ? epicFilter : (projCols[0] || {}).key} title="add to folder"
                style={{ border: `1px solid ${T.border}`, borderRadius: 7, padding: '4px 6px', fontFamily: T.fontBody, fontSize: 11, color: T.textMuted, background: T.surface2, maxWidth: 120 }}>
                {projCols.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            )}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, overflowY: isMobile ? 'visible' : 'auto' }}>
          {list.length ? list.map(Card) : <div style={{ color: T.textFaint, fontSize: 12.5, padding: '8px 4px' }}>—</div>}
        </div>
      </div>
    );
  };

  const loading = flags === null || items === null;
  const includedEmpty = flags !== null && includedCats.length === 0;

  return (
    <div>
      <h2 style={{ fontFamily: T.fontDisplay, fontSize: isMobile ? 22 : 26, margin: '2px 0 12px', color: T.text }}>Projects</h2>
      {loading ? (
        <div style={{ padding: '40px 12px', textAlign: 'center', color: T.textFaint, fontSize: 13 }}>loading…</div>
      ) : includedEmpty ? (
        <div style={{ padding: '48px 16px', textAlign: 'center' }}>
          <div style={{ display: 'inline-flex', color: T.textFaint, marginBottom: 10 }}><Icon kind="projects" size={26} /></div>
          <div style={{ fontSize: 15, color: T.textMuted, marginBottom: 6 }}>No lists on the Projects board yet.</div>
          <div style={{ fontSize: 13, color: T.textFaint }}>Open <b style={{ color: T.textMuted }}>Items</b> and tap the columns icon on a list's header to add it here.</div>
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 600 }}>Group by</span>
            <div style={{ display: 'flex', gap: 2, background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 999, padding: 3 }}>
              {[['project', 'Project'], ['due', 'Due'], ['priority', 'Priority']].map(gl => (
                <button key={gl[0]} onClick={() => setGroupP(gl[0])} style={{ padding: '5px 13px', borderRadius: 999, border: 'none', cursor: 'pointer', fontFamily: T.fontBody, fontSize: 12.5, fontWeight: group === gl[0] ? 600 : 500, background: group === gl[0] ? T.surface : 'transparent', color: group === gl[0] ? T.text : T.textMuted, boxShadow: group === gl[0] ? T.shadowSm : 'none' }}>{gl[1]}</button>
              ))}
            </div>
            {/* Fold the archive into the board — completed items show greyed, in their
                own folder/column, each with a one-tap reopen. */}
            <button onClick={() => setShowDone(v => !v)} title="show completed items inline"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 999, fontFamily: T.fontBody, fontSize: 12.5, cursor: 'pointer', whiteSpace: 'nowrap', background: showDone ? withAlpha(T.done, 0.14) : T.surface, color: showDone ? T.done : T.textMuted, border: `1px solid ${showDone ? 'transparent' : T.border}` }}>
              <span>{showDone ? '☑' : '☐'}</span> Include done
            </button>
            {includedCats.length > 1 && ['all', ...includedCats].map(c => {
              const active = catFilter === c; const col = c === 'all' ? T.accent : categoryColor(c);
              return <button key={c} onClick={() => pickCat(c)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 999, fontFamily: T.fontBody, fontSize: 12.5, cursor: 'pointer', whiteSpace: 'nowrap', background: active ? withAlpha(col, 0.12) : T.surface, color: active ? col : T.textMuted, border: `1px solid ${active ? 'transparent' : T.border}` }}>{c !== 'all' && <span style={{ width: 8, height: 8, borderRadius: 3, background: col }} />}{c === 'all' ? 'All' : c}</button>;
            })}
          </div>

          {/* Epic drill-down: once a category is picked, narrow to a single folder within it. */}
          {catEpics.length > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 600 }}>Folder</span>
              {[{ slug: 'all', label: `All ${catFilter}` }, ...catEpics].map(e => {
                const active = epicFilter === e.slug; const col = categoryColor(catFilter);
                return <button key={e.slug} onClick={() => setEpicFilter(e.slug)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, fontFamily: T.fontBody, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', background: active ? withAlpha(col, 0.14) : T.surface, color: active ? col : T.textMuted, border: `1px solid ${active ? 'transparent' : T.border}` }}>{e.label}</button>;
              })}
            </div>
          )}

          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', overflowX: 'auto', paddingBottom: 8 }}>
            {cols.length ? cols.map(colEl) : <div style={{ color: T.textFaint, fontSize: 13, padding: '20px 4px' }}>No folders in these lists yet — add one from Items.</div>}
          </div>
          <div style={{ fontSize: 12, color: T.textFaint, margin: '10px 4px 0' }}>
            {isMobile ? 'Tap a card to open it and change its project, due date, or priority.'
              : group === 'project' ? 'Drag a card onto another project to move it there. Use "add to…" in a column to capture into it.'
              : group === 'due' ? 'Drag a card between columns to reschedule it (or into Recurring). Add from any column, picking its folder.'
              : 'Drag a card between columns to change its priority (or into Recurring). Add from any column, picking its folder.'}
          </div>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { TodaySection, WeekStrip, EpicsGrid, CalendarMonth, OverdueSection, OverdueRow, IssueRow, Icon, unifyDay, DayItemRow, CompactDayRow, PlanSection, IssuesSection, ProjectsSection, SchedulePicker, DateTimeField });
