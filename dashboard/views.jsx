// views.jsx — TodaySection, WeekStrip, EpicsGrid, CalendarMonth.
// Editorial-modern visual style. Single page, vertical scroll.

const { useState: vUseState, useMemo: vUseMemo } = React;

// ─── Icon set (Lucide-style inline SVGs) ────────────────────────────
// Single component, kind-switched. Inherits currentColor so callers can tint via CSS color.
function Icon({ kind, size = 14 }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', style: { flexShrink: 0 } };
  switch (kind) {
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
    case 'x':
      return (<svg {...common}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>);
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
  const blocks = day.timeblocks_today || day.timeblocks || [];
  const events = day.events_today || day.events || [];

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
  // the issue's epic short-name OR appears in the event title (e.g. "swen90017 — 2nd Team Progress").
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

function IssueRow({ issue, onClick, dim }) {
  const c = epicColor(issue.epic_slug, issue.epic_slug?.split('/')[0]);
  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 14px', marginBottom: 4,
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderLeft: `3px solid ${c}`,
        borderRadius: 6,
        cursor: 'pointer',
        transition: 'background 0.12s ease, transform 0.12s ease',
        opacity: dim ? 0.55 : 1,
      }}
      onMouseEnter={e => { e.currentTarget.style.background = T.surfaceHover; }}
      onMouseLeave={e => { e.currentTarget.style.background = T.surface; }}
    >
      <PriorityDot priority={issue.priority} />
      <EpicTag epicSlug={issue.epic_slug} />
      <span style={{
        flex: 1, fontSize: 14, color: T.text,
        textDecoration: dim ? 'line-through' : 'none',
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
          {issue.due === fmtISO(new Date()) ? 'today' : issue.due}
        </span>
      )}
    </div>
  );
}

function TimeblockRow({ block, onClick, onDelete, onComplete }) {
  const c = block.epic_slug ? epicColor(block.epic_slug, block.epic_slug.split('/')[0]) : T.textMuted;
  const stop = (e) => { e.stopPropagation(); };
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
      {block.epic_slug && (
        <span style={{
          fontFamily: T.fontMono, fontSize: 11, color: c,
          flexShrink: 0,
        }}>
          {block.epic_slug.split('/')[1]}{block.issue_id ? ` · ${block.issue_id}` : ''}
        </span>
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
// Single-row renderer for any unified day item. Used by Today section.
// Branching based on kind: issue (with optional timeblocks/badges), free block, event.
function DayItemRow({ row, onSelectIssue, onTbAction, onSelectBlock }) {
  if (row.kind === 'block') {
    // Free timeblock (no issue link) — clickable to open the TimeblockPopover so the user
    // can see details + delete or relink. Issue-linked timeblocks are subsumed into 'issue' rows above.
    return <TimeblockRow
      block={row.timeblock}
      onClick={() => onSelectBlock && onSelectBlock(row.timeblock)}
      onComplete={onTbAction(row.timeblock.id, 'complete')}
      onDelete={onTbAction(row.timeblock.id, 'delete')}
    />;
  }
  if (row.kind === 'event') {
    return <EventRow event={row.event} />;
  }
  // kind === 'issue'
  const it = row.issue;
  const c = epicColor(it.epic_slug, it.epic_slug.split('/')[0]);
  const hasTimeblock = row.timeblocks.length > 0;
  const iconKind = hasTimeblock ? 'work' : row.isDeadline ? 'deadline' : row.isRecurring ? 'recurring' : 'work';
  return (
    <div
      onClick={() => onSelectIssue({ id: it.id, epic_slug: it.epic_slug })}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectIssue({ id: it.id, epic_slug: it.epic_slug }); } }}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 14px', marginBottom: 4,
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderLeft: `3px solid ${c}`,
        borderRadius: 6,
        cursor: 'pointer',
        transition: 'background 0.12s ease',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = T.surfaceHover; }}
      onMouseLeave={e => { e.currentTarget.style.background = T.surface; }}
    >
      <span style={{ display: 'inline-flex', color: c, flexShrink: 0 }}>
        <Icon kind={iconKind} size={14} />
      </span>
      {hasTimeblock && (
        <span style={{
          fontFamily: T.fontMono, fontSize: 12, color: c, flexShrink: 0,
          fontVariantNumeric: 'tabular-nums',
        }}>
          {row.timeblocks[0].start}–{row.timeblocks[0].end}
          {row.timeblocks.length > 1 && (
            <span style={{ color: T.textFaint, marginLeft: 6 }}>+{row.timeblocks.length - 1}</span>
          )}
        </span>
      )}
      <EpicTag epicSlug={it.epic_slug} />
      <span style={{
        flex: 1, fontSize: 14, color: T.text,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{it.title}</span>
      {row.isDeadline && (
        <Badge color={T.overdue} bg={withAlpha('#b91c1c', 0.08)} title="due today">DUE</Badge>
      )}
      {row.isRecurring && !hasTimeblock && (
        <span style={{ color: T.textFaint, display: 'inline-flex' }} title="recurring"><Icon kind="recurring" size={12} /></span>
      )}
      {it.total_subtask_count > 0 && (
        <span style={{ fontSize: 11, color: T.textMuted, fontFamily: T.fontMono, fontVariantNumeric: 'tabular-nums' }}>
          {it.total_subtask_count - it.open_subtask_count}/{it.total_subtask_count}
        </span>
      )}
    </div>
  );
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

function EventRow({ event }) {
  const c = categoryColor(event.category);
  return (
    <div style={{
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
    </div>
  );
}

// ─── TODAY ───────────────────────────────────────────────────────────
function TodaySection({ data, onSelectIssue, onRefresh, onSelectBlock }) {
  const tbAction = (id, action) => async () => {
    try {
      if (action === 'delete') await api('delete_timeblock', { id });
      if (action === 'complete') await api('complete_timeblock', { id });
      onRefresh && onRefresh();
    } catch {}
  };

  if (!data.today) return null;
  const t = data.today;
  const hasContent =
    (t.timeblocks_today && t.timeblocks_today.length > 0) ||
    t.due_today.length + t.recurring_today.length + t.events_today.length > 0;

  const upNext = vUseMemo(() => {
    if (!data.upcoming) return [];
    const items = [];
    for (const day of (data.upcoming.days_list || []).slice(1)) {
      for (const it of day.items) items.push({ ...it, due: it.due || day.date });
      if (items.length >= 3) break;
    }
    return items.slice(0, 3);
  }, [data.upcoming]);

  return (
    <section style={{
      background: T.surface,
      border: `1px solid ${T.border}`,
      borderRadius: 12,
      padding: '20px 22px 18px',
      boxShadow: T.shadow,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 14 }}>
        <h2 style={{ fontSize: 24, fontWeight: 600, fontFamily: T.fontDisplay, fontVariationSettings: '"opsz" 144' }}>Today</h2>
        <div style={{ fontSize: 13, color: T.textMuted, fontVariantNumeric: 'tabular-nums' }}>
          {fmtLong(data.todayDate)}
        </div>
        <div style={{ flex: 1 }} />
        {t.overdue_count > 0 && (
          <div style={{
            fontSize: 11, fontWeight: 600,
            color: T.overdue, background: withAlpha('#b91c1c', 0.08),
            padding: '3px 10px', borderRadius: 999,
          }}>{t.overdue_count} overdue</div>
        )}
      </div>

      {!hasContent && (
        <div style={{ fontSize: 14, color: T.textFaint, fontStyle: 'italic', padding: '8px 0' }}>
          Nothing locked in for today. Pick from <em>Up next</em> or open an epic.
        </div>
      )}

      {/* Single unified list — one row per underlying issue, plus standalone blocks/events */}
      {hasContent && (
        <div>
          {unifyDay(t).map((row, i) => (
            <DayItemRow
              key={(row.kind === 'issue' ? row.issue.id : row.kind === 'block' ? row.timeblock.id : row.event.id) + ':' + i}
              row={row}
              onSelectIssue={onSelectIssue}
              onTbAction={tbAction}
              onSelectBlock={onSelectBlock}
            />
          ))}
        </div>
      )}

      {upNext.length > 0 && (
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${T.border}` }}>
          <div style={{ ...SECTION_LABEL, marginTop: 0 }}>Up next</div>
          {upNext.map(it => <IssueRow key={'un' + it.id} issue={it} onClick={() => onSelectIssue(it)} />)}
        </div>
      )}
    </section>
  );
}

// ─── WEEK STRIP ──────────────────────────────────────────────────────
function WeekStrip({ data, onSelectIssue, onSelectDay, onSelectBlock }) {
  if (!data.upcoming) return null;
  const days = data.upcoming.days_list || [];
  return (
    <section style={{ width: '100%' }}>
      <div style={SECTION_LABEL}>This week</div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
        gap: 8,
        width: '100%',
      }}>
        {days.map(d => <DayCard key={d.date} day={d} isToday={d.date === data.todayISO} onSelectIssue={onSelectIssue} onSelectDay={onSelectDay} onSelectBlock={onSelectBlock} />)}
      </div>
    </section>
  );
}

function DayCard({ day, isToday, onSelectIssue, onSelectDay, onSelectBlock }) {
  const isWeekend = day.weekday === 'Sat' || day.weekday === 'Sun';
  // Translate week-strip day shape ({items, events, timeblocks}) to the unified
  // input format expected by unifyDay (which knows due_today vs recurring_today).
  // We don't have that distinction at week-strip level, so we approximate:
  // - items where it.due === day.date → deadline; with recurring=true → recurring
  const dueOrRecurring = (day.items || []).map(it => ({ ...it }));
  const due = dueOrRecurring.filter(it => !it.recurring);
  const recurring = dueOrRecurring.filter(it => it.recurring);
  const rows = unifyDay({
    due_today: due,
    recurring_today: recurring,
    timeblocks_today: day.timeblocks || [],
    events_today: day.events || [],
  });
  const visible = rows.slice(0, 4);
  const more = rows.length - visible.length;
  return (
    <div style={{
      background: isToday ? T.surface : (isWeekend ? T.surface2 : T.surface),
      border: `1px solid ${isToday ? T.text : T.border}`,
      borderRadius: 8,
      padding: 8,
      minHeight: 110,
      display: 'flex', flexDirection: 'column',
      minWidth: 0, overflow: 'hidden',
      boxShadow: isToday ? T.shadowSm : 'none',
    }}>
      <div
        onClick={() => onSelectDay && onSelectDay(day.date)}
        role={onSelectDay ? 'button' : undefined}
        style={{
          display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 6,
          cursor: onSelectDay ? 'pointer' : 'default',
        }}
        title={onSelectDay ? 'view all items for this day' : ''}
      >
        <div style={{
          fontFamily: T.fontDisplay, fontSize: 16, fontWeight: 600,
          color: isToday ? T.accent : T.text,
        }}>{day.weekday}</div>
        <div style={{
          fontSize: 12, color: T.textFaint, fontFamily: T.fontMono,
          fontVariantNumeric: 'tabular-nums',
        }}>{day.date.slice(8)}</div>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
        {visible.map((row, i) => <CompactDayRow key={i} row={row} onSelectIssue={onSelectIssue} onSelectBlock={onSelectBlock} />)}
        {more > 0 && (
          <button
            onClick={() => onSelectDay && onSelectDay(day.date)}
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

// Compact one-line row used in WeekStrip day cards. Same icon vocabulary as DayItemRow,
// just smaller. For issues with timeblocks shows "HH:MM <icon> epic title".
function CompactDayRow({ row, onSelectIssue, onSelectBlock }) {
  if (row.kind === 'block') {
    const tb = row.timeblock;
    const c = tb.epic_slug ? epicColor(tb.epic_slug, tb.epic_slug.split('/')[0]) : T.textMuted;
    return (
      <div
        onClick={(e) => {
          e.stopPropagation();
          if (tb.issue_id) onSelectIssue({ id: tb.issue_id, epic_slug: tb.epic_slug });
          else if (onSelectBlock) onSelectBlock(tb);
        }}
        title={`${tb.start}–${tb.end} · ${tb.title}`}
        style={{
          fontSize: 11, color: T.text,
          cursor: 'pointer',
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
      <div title={e.title} style={{
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
      onClick={(e) => { e.stopPropagation(); onSelectIssue({ id: it.id, epic_slug: it.epic_slug }); }}
      title={it.title}
      style={{
        fontSize: 11, color: T.text, cursor: 'pointer',
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
function EpicsGrid({ data, onSelectIssue, onSelectEpic }) {
  if (!data.epics) return null;
  const byCat = vUseMemo(() => {
    const m = {};
    for (const e of data.epics.epics) (m[e.category] = m[e.category] || []).push(e);
    return m;
  }, [data.epics]);
  const order = ['studies', 'side-project', 'body', 'kitchen', 'future-planning', 'personal'];
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
              <EpicCard key={epic.slug} epic={epic} onSelectIssue={onSelectIssue} onSelectEpic={onSelectEpic} />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function EpicCard({ epic, onSelectIssue, onSelectEpic }) {
  const [open, setOpen] = vUseState(false);
  const [issues, setIssues] = vUseState(null);

  // Always re-fetch on expand. Caching previously made the inline list go stale
  // when issues were completed elsewhere (e.g. via TODAY card or another agent).
  const toggle = async () => {
    if (!open) {
      try {
        const r = await api('list_issues', { epic: epic.slug, status: 'open' });
        setIssues(r.issues || []);
      } catch { setIssues([]); }
    }
    setOpen(o => !o);
  };

  // Show only top-level issues (no parent + not recurring instance) — sub-issues
  // appear inside the parent's drawer. Track child counts so the user knows depth at a glance.
  const visibleIssues = vUseMemo(() => {
    if (!issues) return null;
    const childCount = new Map();
    for (const it of issues) {
      if (it.parent_issue_id) {
        childCount.set(it.parent_issue_id, (childCount.get(it.parent_issue_id) || 0) + 1);
      }
    }
    return issues
      .filter(it => !it.parent_issue_id && !it.template_id)
      .map(it => ({ ...it, _child_count: childCount.get(it.id) || 0 }));
  }, [issues]);

  const c = epicColor(epic.slug, epic.category);
  return (
    <div style={{ marginBottom: 6 }}>
      <div
        onClick={() => onSelectEpic && onSelectEpic(epic)}
        role="button"
        title="click to open epic · use ▸ to peek at issues inline"
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '7px 10px',
          background: 'transparent',
          border: `1px solid ${T.border}`,
          borderLeft: `3px solid ${c}`,
          borderRadius: 6,
          cursor: 'pointer',
          transition: 'background 0.12s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = T.surfaceHover; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
      >
        <button
          onClick={(e) => { e.stopPropagation(); toggle(); }}
          title={open ? 'collapse' : 'peek at open issues'}
          style={{
            color: T.textFaint, fontSize: 12, width: 18, height: 18,
            background: 'transparent', border: 'none', cursor: 'pointer',
            padding: 0, lineHeight: 1, borderRadius: 3,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = withAlpha(c, 0.10); }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >{open ? '▾' : '▸'}</button>
        <span style={{
          flex: 1, fontSize: 13, color: T.text, fontWeight: 500,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{epic.title}</span>
        {epic.recurring && <span style={{ fontSize: 11, color: T.textFaint }} title="recurring">↻</span>}
        {epic.open_issue_count > 0 && (
          <span style={{ fontSize: 11, color: c, fontWeight: 600, fontFamily: T.fontMono }}>{epic.open_issue_count}</span>
        )}
      </div>
      {open && (
        <div style={{ paddingLeft: 10, paddingTop: 6 }}>
          {visibleIssues == null && <div style={{ fontSize: 11, color: T.textFaint }}>loading…</div>}
          {visibleIssues && visibleIssues.length === 0 && (
            <div style={{ fontSize: 11, color: T.textFaint, fontStyle: 'italic', padding: '4px 0' }}>no open issues</div>
          )}
          {visibleIssues && visibleIssues.map(it => (
            <div
              key={it.id}
              onClick={() => onSelectIssue(it)}
              style={{
                fontSize: 12, color: T.text, cursor: 'pointer',
                padding: '5px 10px', marginBottom: 2,
                background: T.surface,
                border: `1px solid ${T.border}`,
                borderLeft: `2px solid ${c}`,
                borderRadius: 4,
                display: 'flex', alignItems: 'center', gap: 8,
              }}
              onMouseEnter={e => { e.currentTarget.style.background = T.surfaceHover; }}
              onMouseLeave={e => { e.currentTarget.style.background = T.surface; }}
            >
              <PriorityDot priority={it.priority} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.title}</span>
              {it._child_count > 0 && (
                <span style={{
                  fontSize: 10, fontFamily: T.fontMono, color: c,
                  padding: '1px 6px', background: withAlpha(c, 0.10), borderRadius: 999,
                }} title={`${it._child_count} sub-issue${it._child_count === 1 ? '' : 's'}`}>
                  +{it._child_count}
                </span>
              )}
              {it.due && (
                <span style={{ fontSize: 11, color: T.textMuted, fontFamily: T.fontMono }}>{it.due}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── CALENDAR MONTH ──────────────────────────────────────────────────
// Editorial style: thin separators, day numbers in display font, today
// gets a small filled circle, items as tiny coloured dots-with-text.
function CalendarMonth({ data, onSelectIssue, onSelectDay, onSelectBlock }) {
  if (!data.upcoming) return null;
  const today = data.todayDate;
  const year = today.getFullYear();
  const month = today.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const startDow = first.getDay();
  const daysInMonth = last.getDate();

  const dayItems = vUseMemo(() => {
    const m = {};
    for (const day of data.upcoming.days_list || []) {
      const due = (day.items || []).filter(it => !it.recurring);
      const recurring = (day.items || []).filter(it => it.recurring);
      m[day.date] = unifyDay({
        due_today: due, recurring_today: recurring,
        timeblocks_today: day.timeblocks || [], events_today: day.events || [],
      });
    }
    // Add far-future events (beyond the 7-day upcoming horizon) to cells that don't have a unified row yet.
    for (const e of data.events?.events || []) {
      if (m[e.date]) continue;
      m[e.date] = unifyDay({ due_today: [], recurring_today: [], timeblocks_today: [], events_today: [e] });
    }
    return m;
  }, [data.upcoming, data.events]);

  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(year, month, d);
    cells.push({ day: d, date: fmtISO(dt), dow: dt.getDay(), isToday: dt.getTime() === today.getTime() });
  }

  const monthName = ['January','February','March','April','May','June','July','August','September','October','November','December'][month];

  return (
    <section style={{ marginBottom: 32 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 24, marginBottom: 12 }}>
        <h2 style={{
          fontFamily: T.fontDisplay, fontSize: 22, fontWeight: 600, margin: 0,
          letterSpacing: '-0.02em',
        }}>{monthName}</h2>
        <span style={{ fontFamily: T.fontMono, fontSize: 13, color: T.textFaint }}>{year}</span>
      </div>

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
                minHeight: 96,
                borderTop: i >= 7 ? `1px solid ${T.border}` : 'none',
                borderLeft: (i % 7) === 0 ? 'none' : `1px solid ${T.border}`,
                background: T.surface2,
              }} />
            );
            const rows = dayItems[c.date] || [];
            const visible = rows.slice(0, 3);
            const more = rows.length - visible.length;
            const isWeekend = c.dow === 0 || c.dow === 6;
            return (
              <div key={c.date} style={{
                minHeight: 96, padding: '8px 10px',
                background: isWeekend ? T.surface2 : T.surface,
                borderTop: i >= 7 ? `1px solid ${T.border}` : 'none',
                borderLeft: (i % 7) === 0 ? 'none' : `1px solid ${T.border}`,
                display: 'flex', flexDirection: 'column', gap: 3,
                minWidth: 0, overflow: 'hidden',
                cursor: rows.length > 0 && onSelectDay ? 'pointer' : 'default',
              }}
              onClick={(e) => {
                // Only trigger day-popover if the click landed on the cell itself, not a CompactDayRow
                if (e.target === e.currentTarget && onSelectDay) onSelectDay(c.date);
              }}>
                <div
                  onClick={(e) => { e.stopPropagation(); if (onSelectDay) onSelectDay(c.date); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2,
                    cursor: onSelectDay ? 'pointer' : 'default',
                  }}
                  title="view all items for this day"
                >
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
                      color: T.text,
                      paddingLeft: 4,
                    }}>{c.day}</span>
                  )}
                </div>
                {visible.map((row, idx) => <CompactDayRow key={c.date + ':' + idx} row={row} onSelectIssue={onSelectIssue} onSelectBlock={onSelectBlock} />)}
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
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

Object.assign(window, { TodaySection, WeekStrip, EpicsGrid, CalendarMonth, IssueRow, Icon, unifyDay, DayItemRow, CompactDayRow });
