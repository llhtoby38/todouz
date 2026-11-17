// brain.jsx — the Brain tab: todouz's second brain.
//
// Durable, atomic, linked notes (concepts, people, decisions, learnings,
// preferences, sources) that every AI session reads and builds out through the
// brain_* tools. Folders/lists already cover PARA's Projects + Areas, so notes
// link TO them rather than duplicating them. Raw captures land in the Inbox and
// get distilled (seed → growing → evergreen). Every change is stamped with the
// session that made it and can be reverted from the note's History.

const { useState: bUseState, useEffect: bUseEffect, useMemo: bUseMemo, useCallback: bUseCallback, useRef: bUseRef } = React;

const BRAIN_TYPE_META = {
  core:       { label: 'Core',       color: '#7c3aed' },
  inbox:      { label: 'Inbox',      color: '#c2410c' },
  concept:    { label: 'Concept',    color: '#2563eb' },
  person:     { label: 'Person',     color: '#db2777' },
  decision:   { label: 'Decision',   color: '#b45309' },
  learning:   { label: 'Learning',   color: '#0e7490' },
  preference: { label: 'Preference', color: '#15803d' },
  source:     { label: 'Source',     color: '#5a534b' },
  goal:       { label: 'Goal',       color: '#be185d' },
  note:       { label: 'Note',       color: '#6b7280' },
};
const BRAIN_DISTILL_TYPES = ['goal', 'concept', 'person', 'decision', 'learning', 'preference', 'source', 'note'];
const BRAIN_STATUS_META = {
  seed:      { label: 'Seed',      icon: '🌱', hint: 'raw — just captured' },
  growing:   { label: 'Growing',   icon: '🌿', hint: 'being worked on' },
  evergreen: { label: 'Evergreen', icon: '🌳', hint: 'distilled & trusted' },
  archived:  { label: 'Archived',  icon: '🗄', hint: 'no longer relevant' },
};

function brainAgo(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime(); if (isNaN(t)) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
const brainSlugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
// The rich editor's markdown serialiser escapes brackets/underscores, which
// would turn [[slug]] into \[\[slug\]\]. Undo that on save so links survive.
const brainFixWiki = (md) => String(md || '').replace(/\\\[\\\[([^\]\n]+?)\\\]\\\]/g, (m, inner) => '[[' + inner.replace(/\\([_*\[\]\\])/g, '$1') + ']]');
// [[target|label]] → a #brain= link the app routes to the note.
function brainLinkify(body, outlinks) {
  const map = new Map((outlinks || []).map(o => [o.target, o.slug]));
  return String(body || '').replace(/\[\[([^\]|#\n]+)(?:\|([^\]\n]+))?\]\]/g, (m, target, label) => {
    const t = target.trim();
    const slug = map.get(t) || brainSlugify(t);
    return `[${(label || t).replace(/[[\]]/g, '')}](#brain=${encodeURIComponent(slug)})`;
  });
}

function BrainTypeBadge({ type, small }) {
  const m = BRAIN_TYPE_META[type] || BRAIN_TYPE_META.note;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: small ? 10 : 11, fontWeight: 600, letterSpacing: '0.02em',
      color: m.color, background: withAlpha(m.color, 0.1), borderRadius: 999, padding: small ? '1px 7px' : '2px 9px', whiteSpace: 'nowrap' }}>{m.label}</span>
  );
}

// ─── links the Brain makes by itself (see mcp-server/brain-links.mjs) ───
// Tension first: those are the ones worth thinking about.
const BRAIN_REL_META = {
  contradicts: { label: 'Contradicts', icon: '✕', color: '#dc2626', dash: '5 4' },
  limits:      { label: 'Limits',      icon: '⊣', color: '#d97706', dash: '2 3' },
  tradeoff:    { label: 'Trade-off',   icon: '⇄', color: '#9333ea', dash: '7 3 2 3' },
  supports:    { label: 'Supports',    icon: '✓', color: '#16a34a', dash: null },
  extends:     { label: 'Extends',     icon: '→', color: '#2563eb', dash: null },
  applies_to:  { label: 'Applies to',  icon: '◎', color: '#0891b2', dash: null },
};

// A small deterministic force layout: same notes and links → same picture.
// Linked notes settle into clusters; notes with no links yet sit on an outer
// ring instead of being flung to the edges.
function brainForceLayout(nodes, edges, { w = 900, h = 560, iters = 420 } = {}) {
  const n = nodes.length;
  const idx = new Map(nodes.map((nd, i) => [nd.slug, i]));
  const deg = new Array(n).fill(0);
  const E = edges.map(e => [idx.get(e.from), idx.get(e.to)]).filter(([a, b]) => a != null && b != null && a !== b);
  for (const [a, b] of E) { deg[a]++; deg[b]++; }
  const linked = nodes.map((_, i) => i).filter(i => deg[i] > 0).sort((a, b) => deg[b] - deg[a]);
  const pos = new Array(n);
  linked.forEach((i, k) => { const r = 30 * Math.sqrt(k + 1), t = k * 2.39996; pos[i] = { x: Math.cos(t) * r, y: Math.sin(t) * r * (h / w), vx: 0, vy: 0 }; });
  const k = Math.sqrt((w * h) / Math.max(1, linked.length)) * 0.75;
  for (let it = 0; it < iters; it++) {
    const temp = 1 - it / iters;
    for (const i of linked) { pos[i].vx = 0; pos[i].vy = 0; }
    for (let x = 0; x < linked.length; x++) for (let y = x + 1; y < linked.length; y++) {
      const i = linked[x], j = linked[y];
      const dx = pos[i].x - pos[j].x, dy = pos[i].y - pos[j].y; const d2 = dx * dx + dy * dy || 0.01;
      const f = (k * k) / d2; pos[i].vx += dx * f; pos[i].vy += dy * f; pos[j].vx -= dx * f; pos[j].vy -= dy * f;
    }
    for (const [a, b] of E) {
      const dx = pos[a].x - pos[b].x, dy = pos[a].y - pos[b].y; const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const f = d / k; pos[a].vx -= dx * f; pos[a].vy -= dy * f; pos[b].vx += dx * f; pos[b].vy += dy * f;
    }
    for (const i of linked) {
      // Pull to the middle that grows with distance, so separate clusters stay in frame.
      const r = Math.hypot(pos[i].x, pos[i].y * (w / h)), g = 0.02 + 0.6 * r / k / 10;
      pos[i].vx -= pos[i].x * g; pos[i].vy -= pos[i].y * g * (w / h);
      const v = Math.sqrt(pos[i].vx ** 2 + pos[i].vy ** 2) || 1; const step = Math.min(v, 40 * temp + 1);
      pos[i].x += (pos[i].vx / v) * step; pos[i].y += (pos[i].vy / v) * step;
    }
  }
  // The ring for unlinked notes hugs the cluster.
  let rx = 0, ry = 0;
  for (const i of linked) { rx = Math.max(rx, Math.abs(pos[i].x)); ry = Math.max(ry, Math.abs(pos[i].y)); }
  rx = Math.max(rx, w * 0.3) + 70; ry = Math.max(ry, h * 0.3) + 55;
  const lonely = nodes.map((_, i) => i).filter(i => deg[i] === 0);
  lonely.forEach((i, q) => { const t = -Math.PI / 2 + (q / Math.max(1, lonely.length)) * Math.PI * 2; pos[i] = { x: Math.cos(t) * rx, y: Math.sin(t) * ry }; });
  return { pos, deg, E };
}

// The whole Brain as a constellation: notes coloured by type, links by relation.
function BrainMap({ graph, onOpen, height = 440 }) {
  const [hover, setHover] = bUseState(null);
  const [only, setOnly] = bUseState(null);           // show one relation type
  const W = 900, H = 560;
  const lay = bUseMemo(() => (graph && graph.nodes.length ? brainForceLayout(graph.nodes, graph.edges, { w: W, h: H }) : null), [graph]);
  if (!graph || !lay) return null;
  const { pos, deg } = lay;
  const xs = pos.map(p => p.x), ys = pos.map(p => p.y);
  const pad = 60, minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad, minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
  const idx = new Map(graph.nodes.map((nd, i) => [nd.slug, i]));
  const edges = graph.edges.filter(e => idx.has(e.from) && idx.has(e.to) && (!only || e.type === only));
  const near = hover != null ? new Set(edges.filter(e => e.from === hover || e.to === hover).flatMap(e => [e.from, e.to])) : null;
  const counts = Object.fromEntries(Object.keys(BRAIN_REL_META).map(t => [t, graph.edges.filter(e => e.type === t).length]));
  const vbW = maxX - minX, vbH = maxY - minY;
  const scale = vbW / 900;   // keep labels a readable size whatever the spread
  return (
    <div>
      <div style={{ position: 'relative', background: `radial-gradient(ellipse at 50% 45%, ${withAlpha(T.accent, 0.07)}, transparent 70%), ${T.surface}`, border: `1px solid ${T.border}`, borderRadius: 16, overflow: 'hidden' }}>
        <svg viewBox={`${minX} ${minY} ${vbW} ${vbH}`} style={{ width: '100%', height, display: 'block' }} onMouseLeave={() => setHover(null)}>
          {edges.map(e => {
            const a = pos[idx.get(e.from)], b = pos[idx.get(e.to)], m = BRAIN_REL_META[e.type];
            const on = hover == null || e.from === hover || e.to === hover;
            return <line key={e.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={m.color} strokeWidth={(on && hover ? 2.6 : 1.6) * scale} strokeDasharray={m.dash ? m.dash.split(' ').map(x => x * scale).join(' ') : undefined}
              opacity={on ? (hover ? 0.95 : 0.55) : 0.08}><title>{`${e.from} ${m.label.toLowerCase()} ${e.to}: ${e.insight}`}</title></line>;
          })}
          {graph.nodes.map((nd, i) => {
            const p = pos[i], col = (BRAIN_TYPE_META[nd.type] || BRAIN_TYPE_META.note).color;
            const r = (5 + 2.2 * Math.sqrt(deg[i])) * scale;
            const dim = near && !near.has(nd.slug) && hover !== nd.slug;
            const showLabel = hover === nd.slug || (near && near.has(nd.slug)) || (!near && deg[i] >= 3);
            return (
              <g key={nd.slug} style={{ cursor: 'pointer' }} opacity={dim ? 0.2 : 1} onMouseEnter={() => setHover(nd.slug)} onClick={() => onOpen(nd.slug)}>
                <circle cx={p.x} cy={p.y} r={r + 5 * scale} fill={col} opacity={0.12} />
                <circle cx={p.x} cy={p.y} r={r} fill={deg[i] ? col : T.surface} stroke={col} strokeWidth={1.6 * scale} />
                {showLabel && <text x={p.x} y={p.y - r - 6 * scale} textAnchor="middle" fontSize={12 * scale} fontFamily="inherit" fontWeight={hover === nd.slug ? 700 : 500}
                  fill={T.text} stroke={T.surface} strokeWidth={3.5 * scale} paintOrder="stroke">{nd.title.length > 38 ? nd.title.slice(0, 36) + '…' : nd.title}</text>}
                <title>{nd.title}</title>
              </g>
            );
          })}
        </svg>
        <div style={{ position: 'absolute', left: 12, bottom: 10, fontSize: 11, color: T.textFaint }}>hover a star · click to open · hollow = not linked yet</div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
        {Object.entries(BRAIN_REL_META).map(([t, m]) => (
          <button key={t} onClick={() => setOnly(only === t ? null : t)} disabled={!counts[t]}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, fontFamily: T.fontBody, fontSize: 12, cursor: counts[t] ? 'pointer' : 'default',
              background: only === t ? withAlpha(m.color, 0.14) : T.surface, color: counts[t] ? m.color : T.textFaint, border: `1px solid ${only === t ? m.color : T.border}`, opacity: counts[t] ? 1 : 0.5 }}>
            <svg width="18" height="6"><line x1="0" y1="3" x2="18" y2="3" stroke={m.color} strokeWidth="2" strokeDasharray={m.dash || undefined} /></svg>
            {m.label} <span style={{ opacity: 0.7 }}>{counts[t]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// One note and its connections, as a small hub: the note in the middle, each
// connected note around it on a spoke coloured by how they relate.
function BrainNeighbourhood({ note, connections, onOpen }) {
  const seen = new Map();
  for (const c of connections) if (!seen.has(c.other.key)) seen.set(c.other.key, c);
  const items = [...seen.values()].slice(0, 10);
  if (!items.length) return null;
  const W = 640, H = 230, cx = W / 2, cy = H / 2, rx = 235, ry = 78;
  const short = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block', margin: '4px 0 10px' }}>
      {items.map((c, i) => {
        const t = -Math.PI / 2 + (i / items.length) * Math.PI * 2;
        const x = cx + Math.cos(t) * rx, y = cy + Math.sin(t) * ry, m = BRAIN_REL_META[c.type];
        const mx = (cx + x) / 2, my = (cy + y) / 2;
        return (
          <g key={c.id} style={{ cursor: 'pointer' }} onClick={() => onOpen(c)}>
            <line x1={cx} y1={cy} x2={x} y2={y} stroke={m.color} strokeWidth="2" strokeDasharray={m.dash || undefined} opacity="0.75" />
            <circle cx={mx} cy={my} r="9" fill={T.surface} stroke={m.color} strokeWidth="1.5" />
            <text x={mx} y={my + 4} textAnchor="middle" fontSize="10" fill={m.color} fontWeight="700">{m.icon}</text>
            <circle cx={x} cy={y} r="6" fill={c.other.kind === 'post' ? T.surface : m.color} stroke={m.color} strokeWidth="1.5" />
            <text x={x} y={y + (Math.sin(t) > 0.2 ? 20 : -11)} textAnchor="middle" fontSize="11.5" fill={T.text} stroke={T.surface} strokeWidth="3" paintOrder="stroke">
              {c.other.kind === 'post' ? '📰 ' : ''}{short(c.other.title, 30)}
            </text>
          </g>
        );
      })}
      <circle cx={cx} cy={cy} r="15" fill={T.accent} opacity="0.15" />
      <circle cx={cx} cy={cy} r="9" fill={T.accent} />
      <text x={cx} y={cy + 30} textAnchor="middle" fontSize="12" fontWeight="700" fill={T.text} stroke={T.surface} strokeWidth="3" paintOrder="stroke">{short(note.title, 40)}</text>
    </svg>
  );
}

async function brainUploadImage(file) {
  if (typeof maybeConvertHeic === 'function') file = await maybeConvertHeic(file);
  const qs = new URLSearchParams({ filename: file.name || `pasted-${Date.now()}.png`, mime: file.type || 'image/png' });
  const r = await fetch(`/api/attachments/upload?${qs.toString()}`, { method: 'POST', headers: { 'Content-Type': file.type || 'image/png' }, body: file });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const meta = await r.json();
  return { url: meta.url || `/api/attachments/${meta.id}` };
}

function BrainSection({ data, onSelectIssue, onSelectEpic }) {
  const isMobile = useIsMobile();
  const [query, setQuery] = bUseState('');
  const [typeFilter, setTypeFilter] = bUseState('all');
  const [statusFilter, setStatusFilter] = bUseState('');
  const [tagFilter, setTagFilter] = bUseState('');
  const [list, setList] = bUseState(null);       // { notes, facets }
  const [selected, setSelected] = bUseState(null);
  const [note, setNote] = bUseState(null);
  const [noteLoading, setNoteLoading] = bUseState(false);
  const [editing, setEditing] = bUseState(false);
  const [editingTitle, setEditingTitle] = bUseState(false);
  const [titleDraft, setTitleDraft] = bUseState('');
  const [capture, setCapture] = bUseState('');
  const [newTitle, setNewTitle] = bUseState(null);  // null = closed; string = composing a new note
  const [toast, setToast] = bUseState('');
  const [history, setHistory] = bUseState(null);
  const [showHistory, setShowHistory] = bUseState(false);
  const [epics, setEpics] = bUseState(null);
  const [linking, setLinking] = bUseState(false);
  const [tagDraft, setTagDraft] = bUseState('');
  const [graph, setGraph] = bUseState(null);        // { nodes, edges, tensions, disagreements, … }
  const [linker, setLinker] = bUseState(null);      // background linker status
  const [evOpen, setEvOpen] = bUseState({});        // link id → evidence shown
  const [mobileMap, setMobileMap] = bUseState(false);
  const toastTimer = bUseRef(null);

  const flash = (m) => { setToast(m); if (toastTimer.current) clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 2200); };

  const fetchList = bUseCallback(async () => {
    try {
      const args = { limit: 400 };
      if (query.trim()) args.query = query.trim();
      if (typeFilter !== 'all') args.type = typeFilter;
      if (statusFilter) args.status = statusFilter;
      if (tagFilter) args.tag = tagFilter;
      const r = await api('brain_search', args);
      setList(r && !r.error ? r : { notes: [], facets: { type: {}, status: {}, tags: {} } });
    } catch { setList({ notes: [], facets: { type: {}, status: {}, tags: {} } }); }
  }, [query, typeFilter, statusFilter, tagFilter]);

  bUseEffect(() => { const t = setTimeout(fetchList, query ? 180 : 0); return () => clearTimeout(t); }, [fetchList]);

  const loadNote = bUseCallback(async (slug) => {
    if (!slug) { setNote(null); return; }
    setNoteLoading(true);
    try { const r = await api('brain_read', { slug }); setNote(r && !r.error ? r : null); }
    catch { setNote(null); }
    finally { setNoteLoading(false); }
  }, []);

  const open = bUseCallback((slug) => {
    setSelected(slug); setEditing(false); setEditingTitle(false); setShowHistory(false); setHistory(null); setLinking(false);
    loadNote(slug);
  }, [loadNote]);

  // Deep links (#brain=<slug>) — the app switches to this tab and hands the slug
  // over via window.__brainPending + an event (works whether we're mounted yet or not).
  bUseEffect(() => {
    if (window.__brainPending) { open(window.__brainPending); window.__brainPending = null; }
    const onOpen = (e) => { if (e.detail) { open(e.detail); window.__brainPending = null; } };
    window.addEventListener('todouz-brain-open', onOpen);
    return () => window.removeEventListener('todouz-brain-open', onOpen);
  }, [open]);

  const refreshAll = async (slug = selected) => { await fetchList(); if (slug) await loadNote(slug); };

  // The Brain's own links: the map and what it is noticing (shown when no note is open).
  const loadGraph = bUseCallback(async () => {
    try { const r = await api('brain_links', { graph: true }); if (r && !r.error) setGraph(r); } catch {}
    try { const r = await fetch('/api/brain/linker').then(x => x.json()); if (r && r.ok) setLinker(r); } catch {}
  }, []);
  bUseEffect(() => { if (!selected) loadGraph(); }, [selected, loadGraph]);
  // While the linker is still working through notes, pick up new links as they land.
  bUseEffect(() => {
    if (selected || !linker || !linker.pending) return;
    const t = setInterval(loadGraph, 20000);
    return () => clearInterval(t);
  }, [selected, linker, loadGraph]);
  const openConnection = (c) => {
    if (c.other.kind === 'note') open(c.other.ref);
    else window.location.hash = `feed=${c.other.ref}`;
  };
  const dismissLink = async (c) => {
    const r = await api('brain_link_dismiss', { id: c.id });
    if (r && r.error) { flash(r.error); return; }
    flash('Link removed. It won\'t come back.');
    if (note) loadNote(note.slug);
  };

  const save = async (patch, msg) => {
    if (!note) return;
    const r = await api('brain_write', { slug: note.slug, source: 'dashboard', ...patch });
    if (r && r.error) { flash(r.error); return; }
    if (msg) flash(msg);
    await refreshAll(note.slug);
  };

  const doCapture = async () => {
    const t = capture.trim(); if (!t) return;
    setCapture('');
    const r = await api('brain_capture', { text: t, source: 'dashboard' });
    if (r && r.error) { flash(r.error); return; }
    flash('Captured to Inbox');
    fetchList();
  };

  const doCreate = async () => {
    const t = (newTitle || '').trim(); if (!t) { setNewTitle(null); return; }
    const r = await api('brain_write', { title: t, type: 'note', status: 'seed', body: '', source: 'dashboard' });
    setNewTitle(null);
    if (r && r.error) { flash(r.error); return; }
    await fetchList();
    open(r.slug);
    setEditing(true);
  };

  const doDelete = async () => {
    if (!note || note.core) return;
    if (!window.confirm(`Delete "${note.title}"? It moves to trash and its history is kept.`)) return;
    const r = await api('brain_delete', { slug: note.slug, source: 'dashboard' });
    if (r && r.error) { flash(r.error); return; }
    flash('Deleted'); setSelected(null); setNote(null); fetchList();
  };

  const loadHistory = async () => {
    if (!note) return;
    const r = await api('brain_history', { slug: note.slug });
    setHistory(r && r.versions ? r.versions : []);
  };
  const doRevert = async (v) => {
    if (!window.confirm(`Restore this note to how it was before the ${v.action} by ${v.source} (${brainAgo(v.at)})?`)) return;
    const r = await api('brain_revert', { slug: note.slug, version: v.version, source: 'dashboard' });
    if (r && r.error) { flash(r.error); return; }
    flash('Restored'); await refreshAll(note.slug); loadHistory();
  };

  const ensureEpics = async () => {
    if (epics) return;
    try { const r = await api('list_epics'); setEpics((r.epics || []).sort((a, b) => a.slug.localeCompare(b.slug))); } catch { setEpics([]); }
  };

  // Clicking a #brain= link inside a rendered note body opens that note here.
  const onBodyClick = (e) => {
    const a = e.target && e.target.closest && e.target.closest('a[href*="#brain="]');
    if (!a) return;
    e.preventDefault(); e.stopPropagation();
    const m = /#brain=([^&\s"']+)/.exec(a.getAttribute('href') || '');
    if (m) { let s; try { s = decodeURIComponent(m[1]); } catch { s = m[1]; } open(s); }
  };

  const facets = (list && list.facets) || { type: {}, status: {}, tags: {} };
  const inboxCount = facets.type.inbox || 0;
  const typeChips = ['all', 'inbox', 'core', ...BRAIN_DISTILL_TYPES].filter(t => t === 'all' || t === 'inbox' || facets.type[t]);

  // ─── styles ───
  const inputS = { width: '100%', boxSizing: 'border-box', background: T.surface, border: `1px solid ${T.border}`, borderRadius: 9, padding: '9px 11px', fontFamily: T.fontBody, fontSize: 14, color: T.text, outline: 'none' };
  const chipS = (active, color = T.accent) => ({ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 999, fontFamily: T.fontBody, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap',
    background: active ? withAlpha(color, 0.13) : T.surface, color: active ? color : T.textMuted, border: `1px solid ${active ? 'transparent' : T.border}` });
  const sectionS = { fontFamily: T.fontBody, fontSize: 11, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: T.textFaint, margin: '20px 0 8px' };
  const ghostBtn = { background: T.surface, color: T.text, border: `1px solid ${T.border}`, borderRadius: 8, padding: '6px 12px', fontFamily: T.fontBody, fontSize: 12.5, cursor: 'pointer' };

  // ─── list pane ───
  const listPane = (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <div style={{ flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 2 }}>
          <h2 onClick={() => { setSelected(null); setNote(null); }} title="Back to the overview" style={{ fontFamily: T.fontDisplay, fontSize: isMobile ? 22 : 26, margin: 0, color: T.text, cursor: 'pointer' }}>Brain</h2>
          <span style={{ flex: 1 }} />
          {isMobile && <button onClick={() => setMobileMap(true)} style={ghostBtn}>Overview</button>}
          <button onClick={() => setNewTitle(newTitle == null ? '' : null)} style={{ ...ghostBtn, background: T.accent, color: '#fff', border: 'none' }}>+ Note</button>
        </div>
        <div style={{ fontSize: 12.5, color: T.textFaint, marginBottom: 12 }}>Your second brain — shared memory every AI session reads and builds out.</div>
        {newTitle != null && (
          <input autoFocus value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="New note title… ⏎"
            onKeyDown={e => { if (e.key === 'Enter') doCreate(); if (e.key === 'Escape') setNewTitle(null); }}
            style={{ ...inputS, marginBottom: 8, borderColor: T.accent }} />
        )}
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <input value={capture} onChange={e => setCapture(e.target.value)} placeholder="Capture a thought → Inbox"
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doCapture(); } }}
            style={{ ...inputS, background: withAlpha(T.accent, 0.04), border: `1px dashed ${T.borderStrong}` }} />
          <button onClick={doCapture} disabled={!capture.trim()} style={{ ...ghostBtn, flexShrink: 0, opacity: capture.trim() ? 1 : 0.5 }}>Capture</button>
        </div>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search notes…" style={{ ...inputS, marginBottom: 8 }} />
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
          {typeChips.map(t => {
            const meta = BRAIN_TYPE_META[t];
            const n = t === 'all' ? null : (facets.type[t] || 0);
            return (
              <button key={t} onClick={() => setTypeFilter(t)} style={chipS(typeFilter === t, meta ? meta.color : T.accent)}>
                {t === 'all' ? 'All' : meta.label}{n != null && <span style={{ opacity: 0.7 }}>{n}</span>}
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: '5px 8px', fontFamily: T.fontBody, fontSize: 12, color: T.textMuted, background: T.surface }}>
            <option value="">Any maturity</option>
            {Object.entries(BRAIN_STATUS_META).map(([k, m]) => <option key={k} value={k}>{m.icon} {m.label}</option>)}
          </select>
          {tagFilter && <button onClick={() => setTagFilter('')} style={chipS(true)}>#{tagFilter} ✕</button>}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: isMobile ? 'visible' : 'auto', display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 8 }}>
        {list == null ? (
          <div style={{ color: T.textFaint, fontSize: 13, padding: 12 }}>loading…</div>
        ) : list.notes.length === 0 ? (
          <div style={{ color: T.textFaint, fontSize: 13, padding: '16px 6px', lineHeight: 1.55 }}>
            {query || typeFilter !== 'all' || statusFilter || tagFilter
              ? 'No notes match.'
              : <>Nothing here yet. Capture a thought above, start a note, or point an AI session at the brain — see <b style={{ color: T.textMuted }}>Settings → Connect an AI session</b>.</>}
          </div>
        ) : list.notes.map(n => {
          const active = n.slug === selected;
          const edge = active ? T.accent : T.border;
          return (
            // Border set via style/width/color (not `border` + `borderLeft`): React
            // re-applies a changed shorthand on update, which would wipe the edge.
            <button key={n.slug} onClick={() => open(n.slug)} style={{ textAlign: 'left', cursor: 'pointer', width: '100%', boxSizing: 'border-box',
              background: active ? withAlpha(T.accent, 0.07) : T.surface,
              borderStyle: 'solid', borderWidth: '1px 1px 1px 3px',
              borderColor: `${edge} ${edge} ${edge} ${(BRAIN_TYPE_META[n.type] || BRAIN_TYPE_META.note).color}`, borderRadius: 10, padding: '9px 11px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span title={(BRAIN_STATUS_META[n.status] || {}).label} style={{ fontSize: 12 }}>{n.core ? '📌' : (BRAIN_STATUS_META[n.status] || {}).icon}</span>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: T.text, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title}</span>
                <BrainTypeBadge type={n.type} small />
              </div>
              {n.snippet && <div style={{ fontSize: 12, color: T.textMuted, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.snippet}</div>}
              {!n.core && <div style={{ fontSize: 10.5, color: T.textFaint, marginTop: 4, fontFamily: T.fontMono }}>{brainAgo(n.updated)}{n.source ? ` · ${n.source}` : ''}</div>}
            </button>
          );
        })}
      </div>
    </div>
  );

  // ─── note pane ───
  const dirCard = (icon, title, sub, items, render) => items && items.length > 0 && (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: '12px 14px' }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: T.text }}>{icon} {title}</div>
      <div style={{ fontSize: 11.5, color: T.textFaint, margin: '2px 0 8px' }}>{sub}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{items.map(render)}</div>
    </div>
  );
  const noteBtn = (slug, title) => (
    <button onClick={() => open(slug)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', color: T.text, fontWeight: 600, textAlign: 'left' }}>{title}</button>
  );
  const allNotes = (list && list.notes) || [];
  const coreNotes = allNotes.filter(n => n.core);
  const recentNotes = allNotes.filter(n => !n.core).slice().sort((x, y) => String(y.updated || '').localeCompare(String(x.updated || ''))).slice(0, 6);
  const ctxCard = (n, hint) => (
    <button key={n.slug} onClick={() => open(n.slug)} style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit', background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: T.text, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title}</span>
        {hint && <span style={{ fontSize: 11, color: T.textFaint }}>{hint}</span>}
      </div>
      <div style={{ fontSize: 13, color: T.textMuted, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{n.snippet || 'Empty so far. Open it and write a few lines, or ask your agent to fill it in.'}</div>
    </button>
  );
  const notePane = !selected ? (
    <div style={{ padding: isMobile ? '6px 0' : '4px 0', maxWidth: 880 }}>
      <h2 style={{ fontFamily: T.fontDisplay, fontSize: isMobile ? 22 : 28, margin: '0 0 6px', color: T.text }}>What your AI knows about you</h2>
      <div style={{ fontSize: 13.5, color: T.textMuted, marginBottom: 18, lineHeight: 1.55, maxWidth: 680 }}>
        Every AI you connect to todouz reads this before it answers, so no chat starts from zero. Keep your profile and goals current; decisions, learnings and preferences pile up here as you and your agents work.
      </div>
      {coreNotes.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, minmax(0, 1fr))', gap: 12, marginBottom: 22 }}>
          {coreNotes.map(n => ctxCard(n, 'read first'))}
        </div>
      )}
      <div style={{ ...SECTION_LABEL, marginTop: 0 }}>Recently learned</div>
      {recentNotes.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, minmax(0, 1fr))', gap: 10, marginBottom: 22 }}>
          {recentNotes.map(n => (
            <button key={n.slug} onClick={() => open(n.slug)} style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit', background: T.surface, border: `1px solid ${T.border}`, borderLeft: `3px solid ${(BRAIN_TYPE_META[n.type] || BRAIN_TYPE_META.note).color}`, borderRadius: 10, padding: '10px 12px', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: T.text, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title}</span>
                <BrainTypeBadge type={n.type} small />
              </div>
              <div style={{ fontSize: 11, color: T.textFaint, marginTop: 4, fontFamily: T.fontMono }}>{brainAgo(n.updated)}{n.source ? ` · ${n.source}` : ''}</div>
            </button>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 13, color: T.textFaint, marginBottom: 22 }}>Nothing yet. Capture a thought on the left, or tell your agent "remember that…".</div>
      )}
      <div style={{ ...SECTION_LABEL, marginTop: 0 }}>Connect another AI</div>
      <div style={{ background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 12, padding: '12px 14px', fontSize: 13, color: T.textMuted, lineHeight: 1.55, marginBottom: 22 }}>
        Claude Code, Claude Desktop or Cursor can read and write this Brain over MCP. In a terminal: <code style={{ fontFamily: T.fontMono, fontSize: 12, background: T.surface, padding: '2px 6px', borderRadius: 6, border: `1px solid ${T.border}` }}>claude mcp add todouz node /path/to/todouz/mcp-server/index.mjs</code>. Settings has the full setup and an API key for anything else.
      </div>
      {graph && graph.totals && graph.totals.links > 0 && (
        <details>
          <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600, color: T.textMuted, marginBottom: 10 }}>How your notes connect · {graph.totals.links} links</summary>
          <BrainMap graph={graph} onOpen={open} height={isMobile ? 300 : 380} />
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, minmax(0, 1fr))', gap: 10, marginTop: 14 }}>
            {dirCard('⚡', 'Notes that disagree', 'Worth settling: when does each one hold?', graph.disagreements, x => (
              <div key={x.id} style={{ fontSize: 12.5, lineHeight: 1.45, color: T.textMuted }}>
                {noteBtn(x.a_slug, x.a)} <span style={{ color: BRAIN_REL_META.contradicts.color, fontWeight: 700 }}>✕</span> {noteBtn(x.b_slug, x.b)}
                <div style={{ marginTop: 2 }}>{x.insight}</div>
              </div>
            ))}
            {dirCard('📈', 'Building evidence', 'Three or more notes or posts back these up', graph.evidence_building, x => (
              <div key={x.slug} style={{ fontSize: 12.5, color: T.textMuted }}>{noteBtn(x.slug, x.title)} <span style={{ marginLeft: 6 }}>{x.evidence} sources</span></div>
            ))}
          </div>
        </details>
      )}
    </div>
  ) : (noteLoading && !note) ? (
    <div style={{ color: T.textFaint, fontSize: 13, padding: 20 }}>loading…</div>
  ) : !note ? (
    <div style={{ color: T.textFaint, fontSize: 13, padding: 20 }}>That note couldn't be found — it may have been deleted.</div>
  ) : (
    <div style={{ minWidth: 0 }}>
      {isMobile && <button onClick={() => { setSelected(null); setNote(null); }} style={{ ...ghostBtn, marginBottom: 10 }}>← All notes</button>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        {note.core ? <BrainTypeBadge type="core" /> : (
          <select value={note.type} onChange={e => save({ type: e.target.value }, 'Type updated')}
            style={{ border: `1px solid ${T.border}`, borderRadius: 999, padding: '3px 8px', fontFamily: T.fontBody, fontSize: 12, fontWeight: 600, color: (BRAIN_TYPE_META[note.type] || BRAIN_TYPE_META.note).color, background: withAlpha((BRAIN_TYPE_META[note.type] || BRAIN_TYPE_META.note).color, 0.08), cursor: 'pointer' }}>
            {['inbox', ...BRAIN_DISTILL_TYPES].map(t => <option key={t} value={t}>{BRAIN_TYPE_META[t].label}</option>)}
          </select>
        )}
        {!note.core && (
          <div style={{ display: 'inline-flex', gap: 2, background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 999, padding: 2 }}>
            {Object.entries(BRAIN_STATUS_META).map(([k, m]) => (
              <button key={k} title={m.hint} onClick={() => note.status !== k && save({ status: k }, `${m.icon} ${m.label}`)}
                style={{ border: 'none', borderRadius: 999, padding: '3px 9px', cursor: 'pointer', fontFamily: T.fontBody, fontSize: 11.5,
                  background: note.status === k ? T.surface : 'transparent', color: note.status === k ? T.text : T.textMuted, fontWeight: note.status === k ? 600 : 500, boxShadow: note.status === k ? T.shadowSm : 'none' }}>
                {m.icon}{isMobile ? '' : ` ${m.label}`}
              </button>
            ))}
          </div>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: T.textFaint, fontFamily: T.fontMono }}>{note.slug}</span>
      </div>

      {editingTitle && !note.core ? (
        <input autoFocus value={titleDraft} onChange={e => setTitleDraft(e.target.value)}
          onKeyDown={async e => { if (e.key === 'Enter' && titleDraft.trim()) { setEditingTitle(false); await save({ title: titleDraft.trim() }); } if (e.key === 'Escape') setEditingTitle(false); }}
          onBlur={async () => { setEditingTitle(false); if (titleDraft.trim() && titleDraft.trim() !== note.title) await save({ title: titleDraft.trim() }); }}
          style={{ ...inputS, fontFamily: T.fontDisplay, fontSize: 22, fontWeight: 600, padding: '4px 8px', marginBottom: 4 }} />
      ) : (
        <h2 onDoubleClick={() => { if (!note.core) { setTitleDraft(note.title); setEditingTitle(true); } }} title={note.core ? '' : 'double-click to rename'}
          style={{ fontFamily: T.fontDisplay, fontSize: isMobile ? 22 : 26, fontWeight: 600, lineHeight: 1.2, margin: '2px 0 4px', color: T.text }}>{note.title}</h2>
      )}
      <div style={{ fontSize: 12, color: T.textFaint, marginBottom: 10 }}>
        {note.core ? 'Pinned core note — the profile every AI session starts from.' : <>
          Updated {brainAgo(note.updated)}{note.source ? <> by <b style={{ color: T.textMuted }}>{note.source}</b></> : ''}
          {note.created ? ` · created ${brainAgo(note.created)}` : ''}
        </>}
      </div>

      {/* Inbox → distill into a typed note */}
      {note.type === 'inbox' && !editing && (
        <div style={{ background: withAlpha(BRAIN_TYPE_META.inbox.color, 0.06), border: `1px dashed ${withAlpha(BRAIN_TYPE_META.inbox.color, 0.5)}`, borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
          <div style={{ fontSize: 12.5, color: T.text, marginBottom: 8 }}><b>Distill this capture</b> — what kind of idea is it?</div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {BRAIN_DISTILL_TYPES.map(t => (
              <button key={t} onClick={() => save({ type: t, status: 'seed' }, `Filed as ${BRAIN_TYPE_META[t].label}`)} style={chipS(false, BRAIN_TYPE_META[t].color)}>{BRAIN_TYPE_META[t].label}</button>
            ))}
          </div>
        </div>
      )}

      {/* Tags + linked folders/items */}
      {!note.core && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          {note.tags.map(t => (
            <span key={t} style={{ ...chipS(false), cursor: 'default', gap: 4 }}>
              <span onClick={() => setTagFilter(t)} style={{ cursor: 'pointer' }}>#{t}</span>
              <span onClick={() => save({ tags: note.tags.filter(x => x !== t) })} style={{ cursor: 'pointer', opacity: 0.6 }}>✕</span>
            </span>
          ))}
          <input value={tagDraft} onChange={e => setTagDraft(e.target.value)} placeholder="+ tag"
            onKeyDown={async e => { if (e.key === 'Enter' && tagDraft.trim()) { const t = tagDraft.trim(); setTagDraft(''); await save({ tags: [...note.tags, t] }); } }}
            style={{ border: `1px dashed ${T.border}`, borderRadius: 999, padding: '4px 10px', fontFamily: T.fontBody, fontSize: 12, width: 80, background: 'transparent', color: T.text, outline: 'none' }} />
          <span style={{ width: 8 }} />
          {(note.projects_resolved || []).map(p => (
            <span key={p.ref} style={{ ...chipS(false, T.text), cursor: 'default', gap: 6 }}>
              <span onClick={() => {
                if (p.kind === 'issue') onSelectIssue && onSelectIssue({ kind: 'issue', id: p.id, epic_slug: p.epic_slug, title: p.title });
                else if (p.kind === 'epic') onSelectEpic && onSelectEpic({ slug: p.epic_slug, title: p.title });
              }} style={{ cursor: p.kind === 'missing' ? 'default' : 'pointer', textDecoration: p.kind === 'missing' ? 'line-through' : 'none' }}>
                📁 {p.title}
              </span>
              <span onClick={() => save({ projects: note.projects.filter(x => x !== p.ref) })} style={{ cursor: 'pointer', opacity: 0.6 }}>✕</span>
            </span>
          ))}
          {linking ? (
            <select autoFocus defaultValue="" onBlur={() => setLinking(false)}
              onChange={async e => { const v = e.target.value; setLinking(false); if (v) await save({ projects: [...note.projects, v] }, 'Linked'); }}
              style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: '4px 8px', fontFamily: T.fontBody, fontSize: 12, color: T.text, background: T.surface, maxWidth: 220 }}>
              <option value="">{epics ? 'Link a folder…' : 'loading…'}</option>
              {(epics || []).filter(e => !note.projects.includes(e.slug)).map(e => <option key={e.slug} value={e.slug}>{e.slug}</option>)}
            </select>
          ) : (
            <button onClick={() => { ensureEpics(); setLinking(true); }} style={{ ...chipS(false), border: `1px dashed ${T.border}` }}>+ link folder</button>
          )}
        </div>
      )}

      {/* Body */}
      {editing ? (
        <RichEditor
          key={note.slug}
          initialMarkdown={note.body || ''}
          isMobile={isMobile}
          uploadImage={brainUploadImage}
          onSave={async (md) => { setEditing(false); await save({ body: brainFixWiki(md) }, 'Saved'); }}
          onCancel={() => setEditing(false)}
          onRaw={() => {}}
        />
      ) : (
        <div onClick={onBodyClick} onDoubleClick={() => setEditing(true)} title="double-click to edit"
          style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: '6px 16px', minHeight: 120 }}>
          {note.body && note.body.trim()
            ? <Md text={brainLinkify(note.body, note.outlinks)} />
            : <div onClick={() => setEditing(true)} style={{ fontSize: 13, color: T.textFaint, fontStyle: 'italic', padding: '12px 0', cursor: 'text' }}>Empty — click to write. Link other notes with [[note-name]].</div>}
        </div>
      )}
      {!editing && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <button onClick={() => setEditing(true)} style={{ ...ghostBtn, background: T.text, color: '#fff', border: 'none' }}>Edit</button>
          {!note.core && <button onClick={doDelete} style={{ ...ghostBtn, color: T.overdue }}>Delete</button>}
          <span style={{ flex: 1 }} />
          <button onClick={() => { try { navigator.clipboard.writeText(note.app_url); flash('Link copied'); } catch {} }} style={ghostBtn}>Copy link</button>
        </div>
      )}

      {/* Connections the Brain made by itself */}
      {(note.connections || []).length > 0 && (<>
        <div style={sectionS}>Connections <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>· made by your Brain</span></div>
        <BrainNeighbourhood note={note} connections={note.connections} onOpen={openConnection} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {note.connections.map(c => {
            const m = BRAIN_REL_META[c.type];
            return (
              <div key={c.id} style={{ background: T.surface, borderStyle: 'solid', borderWidth: '1px 1px 1px 3px', borderColor: `${T.border} ${T.border} ${T.border} ${m.color}`, borderRadius: 10, padding: '9px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: m.color, background: withAlpha(m.color, 0.1), borderRadius: 999, padding: '2px 9px', whiteSpace: 'nowrap' }}>{m.icon} {c.verb}</span>
                  <button onClick={() => openConnection(c)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', fontSize: 13.5, fontWeight: 600, color: T.text, textAlign: 'left', flex: 1, minWidth: 0 }}>
                    {c.other.kind === 'post' ? '📰 ' : ''}{c.other.title}
                  </button>
                  <button title="This link is wrong: remove it" onClick={() => dismissLink(c)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textFaint, fontSize: 13, padding: '0 2px' }}>✕</button>
                </div>
                <div style={{ fontSize: 13, color: T.textMuted, lineHeight: 1.5, marginTop: 4 }}>{c.insight}</div>
                {(c.this_quote || c.other_quote) && (
                  <button onClick={() => setEvOpen(o => ({ ...o, [c.id]: !o[c.id] }))} style={{ background: 'none', border: 'none', padding: 0, marginTop: 4, cursor: 'pointer', fontSize: 11.5, color: T.textFaint, fontFamily: T.fontBody }}>
                    {evOpen[c.id] ? '▾' : '▸'} evidence
                  </button>
                )}
                {evOpen[c.id] && (
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 8, marginTop: 6 }}>
                    {[['This note', c.this_quote], [c.other.title, c.other_quote]].map(([who, q], i) => q && (
                      <div key={i} style={{ fontSize: 12, color: T.textMuted, background: T.surface2, borderRadius: 8, padding: '7px 9px', lineHeight: 1.45 }}>
                        <div style={{ fontSize: 10.5, fontWeight: 700, color: T.textFaint, marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{who}</div>“{q}”
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </>)}

      {/* Links */}
      {(note.backlinks || []).length > 0 && (<>
        <div style={sectionS}>Linked from</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {note.backlinks.map(b => <button key={b.slug} onClick={() => open(b.slug)} style={chipS(false, (BRAIN_TYPE_META[b.type] || BRAIN_TYPE_META.note).color)}>↩ {b.title}</button>)}
        </div>
      </>)}
      {(note.outlinks || []).some(o => !o.slug) && (<>
        <div style={sectionS}>Links to notes that don't exist yet</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {note.outlinks.filter(o => !o.slug).map(o => (
            <button key={o.target} onClick={async () => {
              const r = await api('brain_write', { title: o.target, type: 'note', status: 'seed', body: '', source: 'dashboard' });
              if (r && !r.error) { await refreshAll(note.slug); open(r.slug); setEditing(true); }
            }} style={{ ...chipS(false), border: `1px dashed ${T.border}` }}>+ create “{o.target}”</button>
          ))}
        </div>
      </>)}

      {/* History / provenance */}
      <div style={sectionS}>
        <button onClick={() => { const v = !showHistory; setShowHistory(v); if (v) loadHistory(); }}
          style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', letterSpacing: 'inherit', textTransform: 'inherit', color: 'inherit' }}>
          {showHistory ? '▾' : '▸'} History {note.history_count ? `(${note.history_count})` : ''}
        </button>
      </div>
      {showHistory && (
        history == null ? <div style={{ fontSize: 12, color: T.textFaint }}>loading…</div>
        : history.length === 0 ? <div style={{ fontSize: 12, color: T.textFaint }}>No recorded changes yet.</div>
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {history.map(v => (
              <div key={v.version} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '6px 10px', background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8 }}>
                <span style={{ fontFamily: T.fontMono, color: T.textFaint, minWidth: 70 }}>{brainAgo(v.at)}</span>
                <span style={{ color: T.text }}><b>{v.source}</b> · {v.action}</span>
                <span style={{ flex: 1 }} />
                {v.has_snapshot && <button onClick={() => doRevert(v)} style={{ ...ghostBtn, padding: '3px 9px', fontSize: 11.5 }}>Restore before this</button>}
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );

  return (
    <div style={{ position: 'relative' }}>
      {isMobile ? (
        selected ? notePane : mobileMap ? <div><button onClick={() => setMobileMap(false)} style={{ ...ghostBtn, marginBottom: 10 }}>← All notes</button>{notePane}</div> : <div>{listPane}</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '340px minmax(0, 1fr)', gap: 22, height: 'calc(100vh - 150px)', minHeight: 480 }}>
          <div style={{ minHeight: 0, borderRight: `1px solid ${T.border}`, paddingRight: 16 }}>{listPane}</div>
          <div style={{ minHeight: 0, overflowY: 'auto', paddingRight: 6, paddingBottom: 40 }}>{notePane}</div>
        </div>
      )}
      {toast && (
        <div style={{ position: 'fixed', left: '50%', bottom: 28, transform: 'translateX(-50%)', background: T.text, color: '#fff', padding: '9px 16px', borderRadius: 999, fontSize: 13, boxShadow: T.shadowLg, zIndex: 300 }}>{toast}</div>
      )}
    </div>
  );
}

Object.assign(window, { BrainSection });
