// drawers.jsx — IssueDrawer (per-issue detail) + AgentsDrawer (universal chat surface).
// Both slide in from the right, overlay the page, dismiss on esc / click-outside.

const { useState: dUseState, useEffect: dUseEffect, useRef: dUseRef } = React;

// ─── IssueDrawer ──────────────────────────────────────────────────────
function IssueDrawer({ issueRef, onClose, onChanged, onOpenAgents, onSelectIssue, parentRef }) {
  const [full, setFull] = dUseState(null);
  const [loading, setLoading] = dUseState(true);
  const [busy, setBusy] = dUseState(false);
  const [quick, setQuick] = dUseState('');
  const [editingDesc, setEditingDesc] = dUseState(false);
  const [descDraft, setDescDraft] = dUseState('');
  const [editingTitle, setEditingTitle] = dUseState(false);
  const [titleDraft, setTitleDraft] = dUseState('');
  const [showAddSubissue, setShowAddSubissue] = dUseState(false);
  const [subissueDraft, setSubissueDraft] = dUseState('');

  const [blocks, setBlocks] = dUseState([]);
  dUseEffect(() => {
    setLoading(true); setFull(null); setBlocks([]);
    setEditingDesc(false); setEditingTitle(false); setShowAddSubissue(false);
    Promise.all([
      api('get_issue', { id: issueRef.id, epic: issueRef.epic_slug }),
      api('list_timeblocks', { issue_id: issueRef.id }),
    ]).then(([f, tb]) => {
      setFull(f); setBlocks(tb.blocks || []); setLoading(false);
    }).catch(e => { setFull({ error: String(e) }); setLoading(false); });
  }, [issueRef?.id]);

  dUseEffect(() => {
    const onKey = e => { if (e.key === 'Escape') { const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return; onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const refresh = async () => {
    try {
      const [j, tb] = await Promise.all([
        api('get_issue', { id: issueRef.id, epic: issueRef.epic_slug }),
        api('list_timeblocks', { issue_id: issueRef.id }),
      ]);
      setFull(j);
      setBlocks(tb.blocks || []);
      onChanged && onChanged();
    } catch {}
  };

  const completeBtn = async () => {
    if (!full || busy) return;
    setBusy(true);
    try {
      await api('complete_issue', { id: full.id, epic: full.epic_slug, log_note: quick.trim() || undefined });
      await refresh();
      setQuick('');
    } finally { setBusy(false); }
  };

  const reopenBtn = async () => {
    if (!full || busy) return;
    setBusy(true);
    try {
      await api('update_issue', { id: full.id, epic: full.epic_slug, patch: { status: 'open' } });
      await refresh();
    } finally { setBusy(false); }
  };

  const toggleSub = async (text) => {
    setBusy(true);
    try {
      await api('toggle_subtask', { id: full.id, epic: full.epic_slug, subtask_text: text });
      await refresh();
    } finally { setBusy(false); }
  };

  const addSub = async (text) => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api('add_subtask', { id: full.id, epic: full.epic_slug, text: text.trim() });
      await refresh();
    } finally { setBusy(false); }
  };

  const handoff = (seed) => {
    onOpenAgents && onOpenAgents({
      agent: full.fields?.agent || 'scheduler',
      seed: seed || null,
      cardContext: { id: full.id, kind: 'issue', title: full.title, due: full.fields?.due, epic_slug: full.epic_slug },
    });
  };

  if (!issueRef) return null;
  const c = full ? epicColor(full.epic_slug, full.epic_slug?.split('/')[0]) : T.textMuted;

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(26,23,20,0.32)', zIndex: 200 }} />
      <aside style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 'min(560px, 92vw)',
        background: T.surface, borderLeft: `1px solid ${T.border}`,
        boxShadow: T.shadowLg,
        zIndex: 201,
        display: 'flex', flexDirection: 'column',
        animation: 'slidein 0.2s ease-out',
      }}>
        <style>{`@keyframes slidein { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>
        <header style={{
          padding: '18px 22px 14px', borderBottom: `1px solid ${T.border}`,
          display: 'flex', alignItems: 'flex-start', gap: 10,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Breadcrumb to parent issue when this is a sub-issue */}
            {full?.parent_issue_id && onSelectIssue && (
              <button onClick={() => onSelectIssue({ id: full.parent_issue_id, epic_slug: full.epic_slug })} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 6,
                fontFamily: T.fontBody, fontSize: 12, color: T.textMuted,
              }}>← <span style={{ fontFamily: T.fontMono }}>{full.parent_issue_id}</span></button>
            )}
            {parentRef && onSelectIssue && (
              <button onClick={() => onSelectIssue(parentRef)} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 6,
                fontFamily: T.fontBody, fontSize: 12, color: T.textMuted,
              }}>← back to {parentRef.title || parentRef.id}</button>
            )}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
              <span style={{
                fontFamily: T.fontMono, fontSize: 11, fontWeight: 500, color: c,
                padding: '2px 8px', background: withAlpha(c, 0.08), borderRadius: 999,
              }}>{full?.epic_slug?.split('/')[1] || '…'}</span>
              <span style={{ fontFamily: T.fontMono, fontSize: 11, color: T.textFaint }}>{full?.id || ''}</span>
              {full?.fields?.recurring && <span style={{ fontSize: 12, color: T.textFaint }} title="recurring">↻ recurring</span>}
              {full?.is_completed && (
                <span style={{
                  fontSize: 10, fontWeight: 600, color: '#fff',
                  background: T.done, padding: '2px 8px', borderRadius: 999, letterSpacing: '0.04em',
                }}>DONE</span>
              )}
            </div>
            {editingTitle ? (
              <input
                value={titleDraft}
                onChange={e => setTitleDraft(e.target.value)}
                onKeyDown={async e => {
                  if (e.key === 'Enter') {
                    await api('update_issue', { id: full.id, epic: full.epic_slug, patch: { title: titleDraft.trim() } });
                    setEditingTitle(false); refresh();
                  } else if (e.key === 'Escape') { setEditingTitle(false); }
                }}
                onBlur={async () => {
                  if (titleDraft.trim() && titleDraft.trim() !== full.title) {
                    await api('update_issue', { id: full.id, epic: full.epic_slug, patch: { title: titleDraft.trim() } });
                    refresh();
                  }
                  setEditingTitle(false);
                }}
                autoFocus
                style={{
                  width: '100%', boxSizing: 'border-box',
                  fontFamily: T.fontDisplay, fontSize: 22, fontWeight: 600, lineHeight: 1.2,
                  background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 6, padding: '4px 8px',
                  color: T.text, outline: 'none',
                }}
              />
            ) : (
              <h2 onDoubleClick={() => { if (full) { setTitleDraft(full.title); setEditingTitle(true); } }} style={{
                fontFamily: T.fontDisplay, fontSize: 22, fontWeight: 600, lineHeight: 1.2,
                letterSpacing: '-0.015em', margin: 0,
                cursor: 'default',
                userSelect: 'text',
              }} title="double-click to edit">
                {full?.title || (loading ? 'loading…' : 'not found')}
              </h2>
            )}
            {full?.fields?.due && (
              <div style={{ fontSize: 13, color: T.textMuted, marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
                Due {full.fields.due} · {(() => { const d = parseISODate(full.fields.due); if (!d) return ''; const days = diffDays(d, new Date()); return days === 0 ? 'today' : days < 0 ? `${Math.abs(days)}d overdue` : `in ${days}d`; })()}
              </div>
            )}
          </div>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', fontSize: 18,
            color: T.textMuted, cursor: 'pointer', padding: 4, lineHeight: 1,
            borderRadius: 4,
          }} aria-label="close">✕</button>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {full && (
            <Field label="Description">
              {editingDesc ? (
                <>
                  <textarea
                    value={descDraft}
                    onChange={e => setDescDraft(e.target.value)}
                    autoFocus
                    onKeyDown={async e => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        await api('update_issue', { id: full.id, epic: full.epic_slug, patch: { description: descDraft } });
                        setEditingDesc(false); refresh();
                      } else if (e.key === 'Escape') { setEditingDesc(false); }
                    }}
                    rows={Math.min(20, Math.max(6, descDraft.split('\n').length + 1))}
                    style={{
                      width: '100%', boxSizing: 'border-box',
                      background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 8,
                      padding: 12, fontFamily: T.fontMono, fontSize: 13, color: T.text,
                      outline: 'none', resize: 'vertical', lineHeight: 1.5,
                    }}
                  />
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <button onClick={async () => {
                      await api('update_issue', { id: full.id, epic: full.epic_slug, patch: { description: descDraft } });
                      setEditingDesc(false); refresh();
                    }} style={primaryBtn(true)}>Save</button>
                    <button onClick={() => setEditingDesc(false)} style={secondaryBtn()}>Cancel</button>
                    <span style={{ flex: 1 }} />
                    <span style={{ fontSize: 11, color: T.textFaint, alignSelf: 'center' }}><kbd>⌘↵</kbd> save · <kbd>esc</kbd> cancel</span>
                  </div>
                </>
              ) : (
                <div
                  onDoubleClick={() => { setDescDraft(full.description || ''); setEditingDesc(true); }}
                  onClick={(e) => {
                    // Single-click on the placeholder still starts editing — selecting empty space is meaningless.
                    if (!full.description) { setDescDraft(''); setEditingDesc(true); }
                  }}
                  style={{ minHeight: 24, userSelect: 'text', cursor: full.description ? 'default' : 'text' }}
                  title="double-click to edit"
                >
                  {full.description ? (
                    <Md text={full.description} />
                  ) : (
                    <div style={{ fontSize: 13, color: T.textFaint, fontStyle: 'italic' }}>+ add description (markdown supported)</div>
                  )}
                </div>
              )}
            </Field>
          )}

          {full?.subtasks && (
            <Field label={`Sub-tasks${full.subtasks.length ? ` (${full.subtasks.filter(s => !s.done).length} open)` : ''}`}>
              {full.subtasks.length === 0 && <div style={{ fontSize: 12, color: T.textFaint, fontStyle: 'italic' }}>none yet</div>}
              {full.subtasks.map((s, i) => (
                <div key={i} onClick={() => !busy && toggleSub(s.text)} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  padding: '6px 0', cursor: busy ? 'wait' : 'pointer',
                  opacity: s.done ? 0.5 : 1,
                }}>
                  <div style={{
                    width: 16, height: 16, marginTop: 1, flexShrink: 0,
                    border: `1.5px solid ${s.done ? T.done : T.borderStrong}`,
                    background: s.done ? T.done : 'transparent',
                    borderRadius: 4,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontSize: 11, fontWeight: 700,
                  }}>{s.done && '✓'}</div>
                  <div style={{ flex: 1, fontSize: 14, color: T.text, textDecoration: s.done ? 'line-through' : 'none', lineHeight: 1.45 }}>
                    {s.text}{s.due && <span style={{ fontStyle: 'italic', color: T.textFaint, marginLeft: 6, fontSize: 12 }}>· due {s.due}</span>}
                  </div>
                </div>
              ))}
              <SubtaskAdder onAdd={addSub} disabled={busy} />
            </Field>
          )}

          {full && (
            <Field label={`Sub-issues${full.children?.length ? ` (${full.children.filter(c => !c.is_completed).length} open)` : ''}`}>
              {(!full.children || full.children.length === 0) && !showAddSubissue && (
                <div style={{ fontSize: 12, color: T.textFaint, fontStyle: 'italic', marginBottom: 6 }}>none yet</div>
              )}
              {full.children && full.children.map(child => {
                const cc = epicColor(child.epic_slug, child.epic_slug.split('/')[0]);
                return (
                  <div
                    key={child.id}
                    onClick={() => onSelectIssue && onSelectIssue({ id: child.id, epic_slug: child.epic_slug })}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 10px', marginBottom: 4,
                      background: T.surface,
                      border: `1px solid ${T.border}`,
                      borderLeft: `3px solid ${cc}`,
                      borderRadius: 6, cursor: 'pointer',
                      opacity: child.is_completed ? 0.55 : 1,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = T.surfaceHover; }}
                    onMouseLeave={e => { e.currentTarget.style.background = T.surface; }}
                  >
                    <span style={{ fontFamily: T.fontMono, fontSize: 11, color: T.textFaint, flexShrink: 0 }}>{child.id}</span>
                    <span style={{
                      flex: 1, fontSize: 13, color: T.text,
                      textDecoration: child.is_completed ? 'line-through' : 'none',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{child.title}</span>
                    {child.due && <span style={{ fontSize: 11, color: T.textMuted, fontFamily: T.fontMono }}>{child.due}</span>}
                    {child.total_subtask_count > 0 && (
                      <span style={{ fontSize: 11, color: T.textMuted, fontFamily: T.fontMono }}>
                        {child.total_subtask_count - child.open_subtask_count}/{child.total_subtask_count}
                      </span>
                    )}
                    <span style={{ color: T.textFaint }}>→</span>
                  </div>
                );
              })}
              {showAddSubissue ? (
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <input
                    value={subissueDraft}
                    onChange={e => setSubissueDraft(e.target.value)}
                    autoFocus
                    onKeyDown={async e => {
                      if (e.key === 'Enter' && subissueDraft.trim()) {
                        const r = await api('create_subissue', { parent_issue_id: full.id, parent_epic: full.epic_slug, title: subissueDraft.trim() });
                        if (r?.ok) { setSubissueDraft(''); setShowAddSubissue(false); refresh(); }
                      } else if (e.key === 'Escape') { setShowAddSubissue(false); setSubissueDraft(''); }
                    }}
                    placeholder="sub-issue title… enter to add"
                    style={{
                      flex: 1, background: T.surface2, border: `1px solid ${T.border}`,
                      borderRadius: 6, padding: '6px 10px', fontFamily: T.fontBody, fontSize: 13, color: T.text,
                      outline: 'none',
                    }}
                  />
                  <button onClick={() => { setShowAddSubissue(false); setSubissueDraft(''); }} style={secondaryBtn()}>Cancel</button>
                </div>
              ) : (
                <button onClick={() => setShowAddSubissue(true)} style={{
                  background: 'transparent', border: `1px dashed ${T.border}`,
                  padding: '6px 10px', fontFamily: T.fontBody, fontSize: 12, color: T.textMuted,
                  borderRadius: 6, cursor: 'pointer', marginTop: 4,
                  width: '100%',
                }}>+ add sub-issue</button>
              )}
            </Field>
          )}

          {full?.default_itinerary?.length > 0 && (
            <Field label="Default itinerary (recurring template)">
              {full.default_itinerary.map((s, i) => (
                <div key={i} style={{ fontSize: 13, color: T.textMuted, padding: '3px 0' }}>· {s.text}</div>
              ))}
            </Field>
          )}

          {full?.log?.length > 0 && (
            <Field label="Log">
              {full.log.slice().reverse().map((l, i) => (
                <div key={i} style={{ fontSize: 13, color: T.text, padding: '6px 0', borderBottom: `1px solid ${T.border}` }}>
                  <span style={{ fontFamily: T.fontMono, fontSize: 11, color: T.textFaint, marginRight: 8 }}>{l.date}</span>{l.note}
                </div>
              ))}
            </Field>
          )}

          {blocks.length > 0 && (
            <Field label={`Planned blocks (${blocks.filter(b => !b.completed).length} open)`}>
              {blocks.map(b => (
                <div key={b.id} style={{
                  fontSize: 13, color: T.text, padding: '6px 0',
                  display: 'flex', gap: 10, alignItems: 'center',
                  opacity: b.completed ? 0.55 : 1,
                  borderBottom: `1px solid ${T.border}`,
                }}>
                  <span style={{
                    fontFamily: T.fontMono, fontSize: 12, color: T.textMuted,
                    minWidth: 144, flexShrink: 0, fontVariantNumeric: 'tabular-nums',
                  }}>{b.date} · {b.start}–{b.end}</span>
                  <span style={{
                    flex: 1, textDecoration: b.completed ? 'line-through' : 'none',
                    overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>{b.title}</span>
                  {!b.completed && (
                    <button
                      onClick={async () => { await api('complete_timeblock', { id: b.id }); refresh(); }}
                      style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: T.done, fontSize: 13, fontWeight: 600, padding: '0 6px' }}
                      title="mark done"
                    >✓</button>
                  )}
                  <button
                    onClick={async () => { if (confirm(`Delete "${b.title}"?`)) { await api('delete_timeblock', { id: b.id }); refresh(); } }}
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: T.overdue, fontSize: 13, fontWeight: 600, padding: '0 6px' }}
                    title="delete"
                  >✕</button>
                </div>
              ))}
            </Field>
          )}

          {full?.linked_files?.length > 0 && (
            <Field label="Linked files">
              {full.linked_files.map((lf, i) => (
                <div key={i} style={{ fontSize: 12, color: T.text }}>
                  <a href={lf.path} target="_blank" rel="noreferrer">📎 {lf.label}</a>
                </div>
              ))}
            </Field>
          )}

          <Field label={`Discuss with ${full?.fields?.agent || 'scheduler'}`}>
            <textarea
              value={quick}
              onChange={e => setQuick(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handoff(quick.trim()); } }}
              rows={3}
              placeholder="message about this issue · cmd+enter to open chat"
              style={{
                width: '100%', boxSizing: 'border-box',
                background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8,
                padding: 12, fontFamily: T.fontBody, fontSize: 14, color: T.text,
                outline: 'none', resize: 'vertical', minHeight: 70, lineHeight: 1.5,
              }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <button onClick={() => handoff(quick.trim())} disabled={!quick.trim()} style={primaryBtn(!!quick.trim())}>
                Send to chat
              </button>
              <button onClick={() => handoff(null)} style={secondaryBtn()}>
                Open chat for this issue
              </button>
            </div>
          </Field>
        </div>

        <footer style={{
          padding: '14px 22px', borderTop: `1px solid ${T.border}`,
          background: T.surface, display: 'flex', gap: 10, alignItems: 'center',
        }}>
          {full && !full.is_completed && (
            <button onClick={completeBtn} disabled={busy} style={{
              background: T.done, color: '#fff', border: 'none',
              padding: '9px 18px', fontFamily: T.fontBody, fontSize: 13, fontWeight: 500,
              cursor: busy ? 'wait' : 'pointer', borderRadius: 8,
            }}>{busy ? '…' : (full.fields?.recurring ? 'Mark today done' : 'Mark complete')}</button>
          )}
          {full && full.is_completed && (
            <button onClick={reopenBtn} disabled={busy} style={{
              background: 'transparent', color: T.textMuted, border: `1px solid ${T.border}`,
              padding: '9px 18px', fontFamily: T.fontBody, fontSize: 13, fontWeight: 500,
              cursor: busy ? 'wait' : 'pointer', borderRadius: 8,
            }}>Reopen</button>
          )}
          {full && (
            <button
              onClick={async () => {
                if (!confirm(`Delete "${full.title}" and all its sub-issues? This is permanent.`)) return;
                await api('delete_issue', { id: full.id, epic: full.epic_slug, cascade: true });
                onChanged && onChanged();
                onClose();
              }}
              disabled={busy}
              style={{
                background: 'transparent', color: T.overdue, border: `1px solid ${T.border}`,
                padding: '9px 14px', fontFamily: T.fontBody, fontSize: 13, fontWeight: 500,
                cursor: busy ? 'wait' : 'pointer', borderRadius: 8,
              }}
            >Delete</button>
          )}
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: T.textFaint }}><kbd>esc</kbd> close</span>
        </footer>
      </aside>
    </>
  );
}

// Reusable button styles
function primaryBtn(enabled = true) {
  return {
    background: enabled ? T.text : T.borderStrong,
    color: '#fff', border: 'none',
    padding: '8px 16px', fontFamily: T.fontBody, fontSize: 13, fontWeight: 500,
    borderRadius: 8, cursor: enabled ? 'pointer' : 'not-allowed',
  };
}
function secondaryBtn() {
  return {
    background: 'transparent', color: T.textMuted,
    border: `1px solid ${T.border}`,
    padding: '8px 16px', fontFamily: T.fontBody, fontSize: 13, fontWeight: 500,
    borderRadius: 8, cursor: 'pointer',
  };
}

function Field({ label, children }) {
  return (
    <div>
      <div style={{
        fontFamily: T.fontBody, fontSize: 11, fontWeight: 600,
        letterSpacing: '0.12em', textTransform: 'uppercase',
        color: T.textFaint, marginBottom: 8,
      }}>{label}</div>
      {children}
    </div>
  );
}

function SubtaskAdder({ onAdd, disabled }) {
  const [v, setV] = dUseState('');
  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
      <input
        value={v}
        onChange={e => setV(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { onAdd(v); setV(''); } }}
        placeholder="add a sub-task… enter to add"
        disabled={disabled}
        style={{
          flex: 1, background: T.surface2, border: `1px solid ${T.border}`,
          borderRadius: 6, padding: '6px 10px', fontFamily: T.fontBody, fontSize: 13, color: T.text,
          outline: 'none',
        }}
      />
    </div>
  );
}

// ─── AgentsDrawer ─────────────────────────────────────────────────────
// Universal chat surface. Persists "last session per agent" in localStorage so
// closing + reopening the drawer brings back the conversation.
const LAST_SESSION_KEY = (agent) => `todouz.lastSession.${agent}`;
const DRAWER_WIDTH_KEY = 'todouz.agentsDrawer.width';
const DEFAULT_DRAWER_WIDTH = 1000;

function AgentsDrawer({ launch, onClose, onFiles }) {
  const [agents, setAgents] = dUseState([]);
  const [selected, setSelected] = dUseState(launch?.agent || 'scheduler');
  const [seed, setSeed] = dUseState(launch?.seed || null);
  const [cardContext, setCardContext] = dUseState(launch?.cardContext || null);
  const [resumeSessionId, setResumeSessionId] = dUseState(null);
  const [sessions, setSessions] = dUseState([]);
  const [chatKey, setChatKey] = dUseState(0); // bump to force ChatPanel remount on "+ new"
  const [width, setWidth] = dUseState(() => {
    const saved = parseInt(localStorage.getItem(DRAWER_WIDTH_KEY) || '', 10);
    return Number.isFinite(saved) && saved >= 600 ? saved : DEFAULT_DRAWER_WIDTH;
  });
  const dragRef = dUseRef(null);

  // Drag-to-resize the drawer from its left edge. Save width to localStorage so the size sticks.
  dUseEffect(() => {
    const onMove = (e) => {
      if (!dragRef.current) return;
      const next = Math.max(600, Math.min(window.innerWidth - 80, window.innerWidth - e.clientX));
      setWidth(next);
    };
    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.style.userSelect = '';
      try { localStorage.setItem(DRAWER_WIDTH_KEY, String(width)); } catch {}
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [width]);
  const startDrag = (e) => {
    e.preventDefault();
    dragRef.current = true;
    document.body.style.userSelect = 'none';
  };

  // Load agents once
  dUseEffect(() => { api('list_agents').then(j => setAgents(j.agents || [])); }, []);

  // When launch target changes, retarget
  dUseEffect(() => {
    setSelected(launch?.agent || 'scheduler');
    setSeed(launch?.seed || null);
    setCardContext(launch?.cardContext || null);
  }, [launch?.agent, launch?.seed, launch?.cardContext]);

  // Whenever the selected agent changes, refresh its session list AND auto-resume the most recent.
  // If a seedMessage was supplied (user just sent something from a card), don't auto-resume —
  // we want a fresh thread for that handoff. Otherwise restore the last conversation.
  dUseEffect(() => {
    let alive = true;
    api('list_sessions', { agent: selected, limit: 12 }).then(j => {
      if (!alive) return;
      setSessions(j.sessions || []);
    });
    if (seed) { setResumeSessionId(null); return; }
    const last = localStorage.getItem(LAST_SESSION_KEY(selected));
    if (last) setResumeSessionId(last);
    else setResumeSessionId(null);
    return () => { alive = false; };
  }, [selected, seed]);

  // Esc to close (when not in an input)
  dUseEffect(() => {
    const onKey = e => {
      if (e.key !== 'Escape') return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onSessionStarted = (sid) => {
    if (!sid) return;
    localStorage.setItem(LAST_SESSION_KEY(selected), sid);
    // Refresh session list so the new one shows up
    api('list_sessions', { agent: selected, limit: 12 }).then(j => setSessions(j.sessions || []));
  };

  const startNewChat = () => {
    setResumeSessionId(null);
    setSeed(null);
    localStorage.removeItem(LAST_SESSION_KEY(selected));
    setChatKey(k => k + 1);
  };

  const pickSession = (sid) => {
    setResumeSessionId(sid);
    setSeed(null);
    localStorage.setItem(LAST_SESSION_KEY(selected), sid);
    setChatKey(k => k + 1);
  };

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(26,23,20,0.32)', zIndex: 200 }} />
      <aside style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: `min(${width}px, 96vw)`,
        background: T.surface, boxShadow: T.shadowLg,
        borderLeft: `1px solid ${T.border}`,
        zIndex: 201, display: 'flex', flexDirection: 'row',
        animation: 'slidein 0.2s ease-out',
      }}>
        {/* drag handle on left edge */}
        <div
          onMouseDown={startDrag}
          title="drag to resize"
          style={{
            position: 'absolute', left: -3, top: 0, bottom: 0, width: 6,
            cursor: 'ew-resize', zIndex: 202,
            background: 'transparent',
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(196,89,60,0.3)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
        />
        {/* Left rail: agents (top) + sessions for this agent (bottom) */}
        <div style={{
          width: 256, flexShrink: 0,
          background: T.surface2,
          borderRight: `1px solid ${T.border}`,
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ padding: '18px 18px 8px' }}>
            <h2 style={{ fontFamily: T.fontDisplay, fontSize: 18, fontWeight: 600, margin: 0 }}>Agents</h2>
            <div style={{ fontSize: 11, color: T.textFaint, fontFamily: T.fontMono, marginTop: 2 }}>{agents.length} available</div>
          </div>
          <div style={{ padding: '4px 8px', maxHeight: 280, overflowY: 'auto' }}>
            {agents.map(a => (
              <button
                key={a.name}
                onClick={() => setSelected(a.name)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '8px 10px', marginBottom: 2,
                  background: selected === a.name ? T.surface : 'transparent',
                  border: 'none',
                  borderLeft: selected === a.name ? `3px solid ${T.accent}` : '3px solid transparent',
                  cursor: 'pointer', borderRadius: 6,
                  transition: 'background 0.12s',
                }}
                onMouseEnter={e => { if (selected !== a.name) e.currentTarget.style.background = T.surfaceHover; }}
                onMouseLeave={e => { if (selected !== a.name) e.currentTarget.style.background = 'transparent'; }}
              >
                <div style={{
                  fontFamily: T.fontDisplay, fontSize: 15, fontWeight: 600,
                  color: T.text, letterSpacing: '-0.01em',
                }}>{a.name}</div>
                <div style={{
                  fontSize: 11, color: T.textMuted,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  marginTop: 1,
                }}>{a.role_excerpt || a.category || '—'}</div>
              </button>
            ))}
          </div>
          <div style={{
            padding: '12px 18px 6px', marginTop: 6,
            borderTop: `1px solid ${T.border}`,
            display: 'flex', alignItems: 'baseline', gap: 6,
          }}>
            <div style={{
              fontSize: 11, fontWeight: 600, letterSpacing: '0.12em',
              textTransform: 'uppercase', color: T.textFaint,
            }}>Sessions</div>
            <span style={{ flex: 1 }} />
            <button onClick={startNewChat} style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontFamily: T.fontBody, fontSize: 11, fontWeight: 500,
              color: T.accent,
            }}>+ new</button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px 14px' }}>
            {sessions.length === 0 && (
              <div style={{ fontSize: 11, color: T.textFaint, fontStyle: 'italic', padding: '6px 10px' }}>no past sessions yet</div>
            )}
            {sessions.map(s => (
              <SessionRow
                key={s.session_id}
                session={s}
                selected={resumeSessionId === s.session_id}
                onPick={() => pickSession(s.session_id)}
                onRenamed={(t) => {
                  // optimistic local update + server-confirm
                  setSessions(prev => prev.map(x => x.session_id === s.session_id ? { ...x, title: t || undefined } : x));
                  api('update_session', { session_id: s.session_id, patch: { title: t || null } });
                }}
                onDeleted={() => {
                  api('delete_session', { session_id: s.session_id }).then(() => {
                    setSessions(prev => prev.filter(x => x.session_id !== s.session_id));
                    // If user deleted the currently-resumed one, drop the localStorage pointer + clear chat
                    if (resumeSessionId === s.session_id) {
                      try { localStorage.removeItem(LAST_SESSION_KEY(selected)); } catch {}
                      setResumeSessionId(null);
                      setChatKey(k => k + 1);
                    }
                  });
                }}
              />
            ))}
          </div>
        </div>
        {/* Right: chat */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <header style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '16px 22px', borderBottom: `1px solid ${T.border}`,
            background: T.surface,
          }}>
            <h2 style={{
              fontFamily: T.fontDisplay, fontSize: 22, margin: 0, fontWeight: 600,
              color: T.text, letterSpacing: '-0.015em',
            }}>{selected}</h2>
            {cardContext && (
              <span style={{
                fontFamily: T.fontMono, fontSize: 11, fontWeight: 500, color: T.accent,
                padding: '2px 10px', background: T.accentSoft, borderRadius: 999,
              }}>card: {cardContext.id}</span>
            )}
            {resumeSessionId && (
              <span style={{
                fontFamily: T.fontMono, fontSize: 11, fontWeight: 500, color: T.done,
                padding: '2px 10px', background: withAlpha('#15803d', 0.10), borderRadius: 999,
              }}>resuming · {resumeSessionId.slice(0, 8)}</span>
            )}
            <span style={{ flex: 1 }} />
            <button onClick={onClose} style={{
              background: 'transparent', border: 'none', fontSize: 18,
              color: T.textMuted, cursor: 'pointer', padding: 4, lineHeight: 1,
              borderRadius: 4,
            }}>✕</button>
          </header>
          <div style={{ flex: 1, overflow: 'auto', padding: 14 }}>
            <ChatPanel
              key={`${selected}:${chatKey}:${resumeSessionId || 'new'}`}
              agent={selected}
              seedMessage={seed}
              cardContext={cardContext}
              resumeSessionId={resumeSessionId}
              onSeedConsumed={() => setSeed(null)}
              onSessionStarted={onSessionStarted}
              onFiles={onFiles}
            />
          </div>
        </div>
      </aside>
    </>
  );
}

// Session list row with rename + delete affordances. Hover reveals the icons; clicking
// the row body picks the session, clicking pencil/trash stops propagation and acts on the row.
function SessionRow({ session: s, selected, onPick, onRenamed, onDeleted }) {
  const [hover, setHover] = dUseState(false);
  const [editing, setEditing] = dUseState(false);
  const [draft, setDraft] = dUseState('');
  const display = s.title || s.first_message_excerpt || s.session_id.slice(0, 8);
  const stop = (e) => { e.stopPropagation(); };
  return (
    <div
      onClick={editing ? null : onPick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'block', width: '100%',
        padding: '8px 10px', marginBottom: 3,
        background: selected ? T.surface : (hover ? T.surfaceHover : 'transparent'),
        border: `1px solid ${selected ? T.border : 'transparent'}`,
        cursor: editing ? 'default' : 'pointer', borderRadius: 6,
        position: 'relative',
      }}
      title={s.first_message_excerpt && s.first_message_excerpt !== display ? s.first_message_excerpt : undefined}
    >
      {editing ? (
        <input
          value={draft}
          autoFocus
          onChange={e => setDraft(e.target.value)}
          onClick={stop}
          onKeyDown={e => {
            stop(e);
            if (e.key === 'Enter') { onRenamed(draft.trim()); setEditing(false); }
            else if (e.key === 'Escape') { setEditing(false); }
          }}
          onBlur={() => { onRenamed(draft.trim()); setEditing(false); }}
          style={{
            width: '100%', boxSizing: 'border-box',
            background: T.surface, border: `1px solid ${T.border}`, borderRadius: 4,
            padding: '4px 6px', fontFamily: T.fontBody, fontSize: 12, color: T.text, outline: 'none',
            fontWeight: 500,
          }}
        />
      ) : (
        <div style={{
          fontSize: 12, color: T.text, overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500,
          paddingRight: hover ? 36 : 0,
        }}>{display}</div>
      )}
      <div style={{
        fontSize: 10, color: T.textFaint, marginTop: 2,
        fontFamily: T.fontMono, fontVariantNumeric: 'tabular-nums',
      }}>
        {fmtRelative(s.last_updated)} · {s.turn_count || 1} turn{s.turn_count === 1 ? '' : 's'}
      </div>
      {hover && !editing && (
        <div style={{
          position: 'absolute', top: 6, right: 6,
          display: 'flex', gap: 2,
        }}>
          <button
            onClick={(e) => { stop(e); setDraft(s.title || ''); setEditing(true); }}
            title="rename"
            style={{
              background: T.surface, border: `1px solid ${T.border}`,
              fontSize: 11, padding: '2px 6px', cursor: 'pointer',
              color: T.textMuted, borderRadius: 4, lineHeight: 1,
            }}
          >✎</button>
          <button
            onClick={(e) => { stop(e); if (confirm(`Delete this session? "${display}"`)) onDeleted(); }}
            title="delete"
            style={{
              background: T.surface, border: `1px solid ${T.border}`,
              fontSize: 11, padding: '2px 6px', cursor: 'pointer',
              color: T.overdue, borderRadius: 4, lineHeight: 1,
            }}
          >✕</button>
        </div>
      )}
    </div>
  );
}

function fmtRelative(iso) {
  if (!iso) return 'never';
  const t = new Date(iso).getTime(); if (!Number.isFinite(t)) return '';
  const dh = (Date.now() - t) / 3600000;
  if (dh < 1) return `${Math.max(1, Math.round(dh * 60))}m ago`;
  if (dh < 24) return `${Math.round(dh)}h ago`;
  return `${Math.round(dh / 24)}d ago`;
}

// ─── ChatPanel ───────────────────────────────────────────────────────
function ChatPanel({ agent, seedMessage, cardContext, resumeSessionId, onSeedConsumed, onSessionStarted, onFiles }) {
  const [messages, setMessages] = dUseState([]);
  const [input, setInput] = dUseState('');
  const [busy, setBusy] = dUseState(false);
  const [hydrating, setHydrating] = dUseState(false);
  // Multimodal: images (base64) + text-document attachments. Sent on /api/chat as the
  // same shape the prototype used; the server inlines docs and attaches images.
  const [attachments, setAttachments] = dUseState([]); // [{kind:'image'|'document'|'unsupported', name, mediaType?, data?, dataUrl?, content?, size?}]
  const [dragging, setDragging] = dUseState(false);
  const [linkPickerOpen, setLinkPickerOpen] = dUseState(false);
  const [contextFiles, setContextFiles] = dUseState([]);
  const fileInputRef = dUseRef(null);
  const dragCounter = dUseRef(0);
  const sessionIdRef = dUseRef(resumeSessionId || null);
  const seedFiredRef = dUseRef(false);
  const scrollerRef = dUseRef(null);

  // Hydrate the chat from a saved session's JSONL when resumeSessionId is provided.
  // The component is keyed on session id at the parent so a remount happens cleanly per session.
  dUseEffect(() => {
    if (!resumeSessionId) return;
    let alive = true;
    setHydrating(true);
    fetch(`/api/sessions/${resumeSessionId}/messages`)
      .then(r => r.ok ? r.json() : { messages: [] })
      .then(j => {
        if (!alive) return;
        setMessages(j.messages || []);
        sessionIdRef.current = resumeSessionId;
        setHydrating(false);
      })
      .catch(() => { if (alive) { setMessages([]); setHydrating(false); } });
    return () => { alive = false; };
  }, [resumeSessionId]);

  dUseEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [messages, busy]);

  // Lazy-load list of files under data/ for the link picker
  dUseEffect(() => {
    if (linkPickerOpen && contextFiles.length === 0) {
      // Re-use list_epics + simple known docs to populate. We expose a simple list of docs
      // via a fetch to /api/get_profile + epic.md scan; for MVP just hand-roll a small set.
      fetch('/api/list_epics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        .then(r => r.json())
        .then(j => {
          const out = [{ label: 'profile.md', path: 'personal/profile.md' }];
          for (const e of (j.epics || [])) {
            out.push({ label: `${e.slug}/epic.md`, path: `epics/${e.slug}/epic.md` });
            out.push({ label: `${e.slug}/issues.md`, path: `epics/${e.slug}/issues.md` });
          }
          setContextFiles(out);
        });
    }
  }, [linkPickerOpen]);

  // ─── attachment helpers ─────────────────────────────────────────────
  const addAtt = (a) => setAttachments(prev => [...prev, a]);
  const removeAtt = (i) => setAttachments(prev => prev.filter((_, j) => j !== i));

  const handleFiles = (fileList) => {
    for (const f of Array.from(fileList)) {
      if (f.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = String(reader.result || '');
          const data = dataUrl.split(',')[1] || '';
          addAtt({ kind: 'image', name: f.name, mediaType: f.type, data, dataUrl, size: f.size });
        };
        reader.readAsDataURL(f);
      } else if (f.size < 200 * 1024 && (/\.(md|txt|json|csv|log|tsv|xml|yaml|yml|js|jsx|ts|tsx|py|go|rb|sh|html|css)$/i.test(f.name) || f.type.startsWith('text/'))) {
        const reader = new FileReader();
        reader.onload = () => addAtt({ kind: 'document', name: f.name, content: String(reader.result || ''), size: f.size });
        reader.readAsText(f);
      } else {
        addAtt({ kind: 'unsupported', name: f.name, size: f.size, reason: 'binary or > 200kb' });
      }
    }
  };

  const onPaste = (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    let handled = false;
    for (const it of items) {
      if (it.kind === 'file') {
        const f = it.getAsFile();
        if (f) { handleFiles([f]); handled = true; }
      }
    }
    if (handled) e.preventDefault();
  };

  const onDragEnter = (e) => { e.preventDefault(); dragCounter.current++; if (e.dataTransfer?.types?.includes('Files')) setDragging(true); };
  const onDragLeave = (e) => { e.preventDefault(); dragCounter.current--; if (dragCounter.current <= 0) setDragging(false); };
  const onDragOver = (e) => e.preventDefault();
  const onDrop = (e) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragging(false);
    if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files);
  };

  const linkContextFile = async (path) => {
    setLinkPickerOpen(false);
    try {
      const r = await fetch(`/api/raw-md?path=${encodeURIComponent(path)}`);
      const j = await r.json();
      if (j.content) addAtt({ kind: 'document', name: path, content: j.content, size: j.content.length });
    } catch {}
  };

  const send = async (overrideText) => {
    const text = String(overrideText != null ? overrideText : input).trim();
    if ((!text && attachments.length === 0) || busy) return;
    const att = attachments.slice();
    setMessages(prev => [...prev, { role: 'user', text, attachments: att }, { role: 'assistant', parts: [], inFlight: true }]);
    setInput('');
    setAttachments([]);
    setBusy(true);
    try {
      const payloadAtts = att
        .filter(a => a.kind === 'image' || a.kind === 'document')
        .map(a => a.kind === 'image'
          ? { kind: 'image', name: a.name, mediaType: a.mediaType, data: a.data }
          : { kind: 'document', name: a.name, content: a.content });
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text || '(see attachments)',
          agent,
          history: sessionIdRef.current ? [] : messages.filter(m => m.role === 'user' || (m.role === 'assistant' && m.parts)).map(m => m.role === 'user' ? { role: 'user', content: m.text } : { role: 'assistant', content: (m.parts || []).filter(p => p.type === 'text').map(p => p.text).join('\n') }),
          task: cardContext,
          attachments: payloadAtts,
          ...(sessionIdRef.current ? { resumeSession: sessionIdRef.current } : {}),
        }),
      });
      if (!resp.ok || !resp.body) {
        appendToLast(setMessages, { type: 'error', text: `${resp.status}: ${resp.statusText}` });
        setBusy(false);
        return;
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          let evt; try { evt = JSON.parse(line); } catch { continue; }
          if (evt.type === 'system' && evt.sessionId) {
            sessionIdRef.current = evt.sessionId;
            onSessionStarted && onSessionStarted(evt.sessionId);
          }
          appendToLast(setMessages, evt);
          if (evt.type === 'done' && Array.isArray(evt.filesChanged) && evt.filesChanged.length) {
            onFiles && onFiles();
          }
        }
      }
    } catch (e) {
      appendToLast(setMessages, { type: 'error', text: String(e?.message || e) });
    } finally {
      setBusy(false);
    }
  };

  // Auto-fire seed on mount once
  dUseEffect(() => {
    if (!seedMessage || seedFiredRef.current) return;
    const t = setTimeout(() => {
      if (seedFiredRef.current) return;
      seedFiredRef.current = true;
      send(seedMessage);
      onSeedConsumed && onSeedConsumed();
    }, 80);
    return () => clearTimeout(t);
    // eslint-disable-next-line
  }, [seedMessage]);

  return (
    <div
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}
    >
      {dragging && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 5,
          background: T.accentSoft, border: `2px dashed ${T.accent}`,
          borderRadius: 8, pointerEvents: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: T.fontDisplay, fontSize: 20, color: T.accent, fontWeight: 600,
        }}>drop to attach</div>
      )}
      <div ref={scrollerRef} style={{ flex: 1, overflowY: 'auto', paddingBottom: 8 }}>
        {hydrating && (
          <div style={{ fontSize: 12, color: T.textFaint, fontStyle: 'italic', padding: 14 }}>· loading saved transcript…</div>
        )}
        {!hydrating && messages.length === 0 && (
          <div style={{ fontSize: 13, color: T.textMuted, padding: 14, lineHeight: 1.55 }}>
            New chat with <strong style={{ color: T.text }}>{agent}</strong>. The agent has the full toolset (read, create, update, complete, append). Drop images / files anywhere. Past sessions are on the left — click to resume.
          </div>
        )}
        {messages.map((m, i) => <Message key={i} m={m} />)}
        {busy && <div style={{ fontSize: 12, color: T.textFaint, fontStyle: 'italic', padding: '6px 14px' }}>· thinking…</div>}
      </div>
      {attachments.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '8px 0' }}>
          {attachments.map((a, i) => <AttachmentChip key={i} att={a} onRemove={() => removeAtt(i)} />)}
        </div>
      )}
      <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 12 }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center' }}>
          <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }}
            onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }} />
          <button onClick={() => fileInputRef.current?.click()} disabled={busy} style={chipBtn}>Attach</button>
          <div style={{ position: 'relative' }}>
            <button onClick={() => setLinkPickerOpen(o => !o)} disabled={busy} style={chipBtn}>Link file</button>
            {linkPickerOpen && (
              <div style={{
                position: 'absolute', bottom: '100%', left: 0, marginBottom: 6,
                background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8,
                boxShadow: T.shadowLg,
                minWidth: 320, maxHeight: 280, overflowY: 'auto', zIndex: 10,
              }}>
                {contextFiles.length === 0 && <div style={{ padding: 10, fontSize: 12, color: T.textFaint }}>loading…</div>}
                {contextFiles.map(f => (
                  <button key={f.path} onClick={() => linkContextFile(f.path)} style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '8px 12px', background: 'transparent', border: 'none',
                    fontFamily: T.fontMono, fontSize: 12, color: T.text,
                    cursor: 'pointer',
                  }}
                    onMouseEnter={(e) => e.currentTarget.style.background = T.surfaceHover}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >{f.label}</button>
                ))}
              </div>
            )}
          </div>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: T.textFaint, alignSelf: 'center' }}>
            <kbd>⌘V</kbd> paste · drop anywhere
          </span>
        </div>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onPaste={onPaste}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.metaKey) { e.preventDefault(); send(); } if (e.key === 'Enter' && e.metaKey) { e.preventDefault(); send(); } }}
          placeholder={`message ${agent}… enter to send, shift+enter for newline`}
          rows={3}
          disabled={busy}
          style={{
            width: '100%', boxSizing: 'border-box',
            background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8,
            padding: 14, fontFamily: T.fontBody, fontSize: 14, color: T.text,
            outline: 'none', resize: 'vertical', minHeight: 70, lineHeight: 1.5,
          }}
        />
      </div>
    </div>
  );
}

const chipBtn = {
  background: T.surface, border: `1px solid ${T.border}`,
  padding: '5px 12px', fontFamily: T.fontBody, fontSize: 12, fontWeight: 500, color: T.textMuted,
  cursor: 'pointer', borderRadius: 6,
};

function AttachmentChip({ att, onRemove }) {
  const isImage = att.kind === 'image';
  const isDoc = att.kind === 'document';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '4px 10px', borderRadius: 6,
      background: T.surface,
      border: `1px solid ${T.border}`,
      fontSize: 12, color: T.text,
    }}>
      {isImage && <img src={att.dataUrl} alt={att.name} style={{ width: 24, height: 24, objectFit: 'cover', borderRadius: 4 }} />}
      <span style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {!isImage && (isDoc ? '📄 ' : '⚠ ')}{att.name}
      </span>
      <button onClick={onRemove} style={{
        background: 'transparent', border: 'none', color: T.textFaint,
        cursor: 'pointer', padding: 0, fontSize: 13, lineHeight: 1,
      }}>✕</button>
    </div>
  );
}

function appendToLast(setMessages, evt) {
  setMessages(prev => {
    const next = [...prev];
    let last = next[next.length - 1];
    if (!last || last.role !== 'assistant') { next.push({ role: 'assistant', parts: [] }); last = next[next.length - 1]; }
    if (evt.type === 'text') last.parts.push({ type: 'text', text: evt.text });
    else if (evt.type === 'tool_use') last.parts.push({ type: 'tool_use', name: evt.name, input: evt.input });
    else if (evt.type === 'tool_result') last.parts.push({ type: 'tool_result', name: evt.name, ok: evt.ok, result: evt.result });
    else if (evt.type === 'error') last.parts.push({ type: 'error', text: evt.error || evt.text });
    else if (evt.type === 'done') { last.inFlight = false; last.parts.push({ type: 'done' }); }
    return next;
  });
}

// Render markdown via the `marked` UMD on window. Falls back to plain pre-wrap if it's not loaded.
function renderMarkdown(text) {
  try {
    if (window.marked && typeof window.marked.parse === 'function') {
      // gfm + breaks so newlines render naturally; trust agent output (it's our own pipeline)
      return window.marked.parse(text || '', { gfm: true, breaks: true });
    }
  } catch {}
  return null;
}

function Md({ text }) {
  const html = renderMarkdown(text);
  if (html != null) return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
  return <div style={{ fontSize: 13, color: T.text, whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>{text}</div>;
}

function Message({ m }) {
  if (m.role === 'user') {
    return (
      <div style={{
        padding: '12px 14px', background: T.surface2, borderRadius: 10,
        marginBottom: 10, border: `1px solid ${T.border}`,
      }}>
        <div style={{
          fontSize: 11, fontWeight: 600, letterSpacing: '0.12em',
          color: T.textFaint, textTransform: 'uppercase', marginBottom: 6,
        }}>You</div>
        <Md text={m.text} />
      </div>
    );
  }
  return (
    <div style={{
      padding: '12px 14px', background: T.surface, borderRadius: 10,
      marginBottom: 10, border: `1px solid ${T.border}`,
    }}>
      <div style={{
        fontSize: 11, fontWeight: 600, letterSpacing: '0.12em',
        color: T.accent, textTransform: 'uppercase', marginBottom: 6,
      }}>Agent</div>
      {(m.parts || []).map((p, i) => {
        if (p.type === 'text') return <Md key={i} text={p.text} />;
        if (p.type === 'tool_use') return (
          <div key={i} style={{
            fontSize: 12, color: T.textMuted, fontFamily: T.fontMono, padding: '3px 0',
          }}>
            <span style={{ color: T.textFaint }}>↳</span> <span style={{ fontWeight: 500, color: T.text }}>{p.name}</span>
            <span style={{ color: T.textFaint }}>({Object.keys(p.input || {}).slice(0, 2).join(', ')}…)</span>
          </div>
        );
        if (p.type === 'tool_result') return (
          <div key={i} style={{
            fontSize: 12, color: p.ok ? T.done : T.overdue,
            fontFamily: T.fontMono, padding: '3px 0',
          }}>
            {p.ok ? '✓' : '✕'} <span style={{ color: T.textMuted }}>{summariseResult(p.result)}</span>
          </div>
        );
        if (p.type === 'error') return (
          <div key={i} style={{ fontSize: 12, color: T.overdue, padding: '4px 0' }}>error: {p.text}</div>
        );
        return null;
      })}
    </div>
  );
}

function summariseResult(r) {
  if (!r) return '';
  if (r.error) return `error: ${r.error}`;
  if (r.id) return `${r.id}${r.epic_slug ? ` @ ${r.epic_slug}` : ''}`;
  if (r.count != null) return `${r.count} item${r.count === 1 ? '' : 's'}`;
  if (r.epics) return `${r.epics.length} epics`;
  if (r.issues) return `${r.issues.length} issues`;
  if (r.ok) return 'ok';
  return JSON.stringify(r).slice(0, 80);
}

// ─── DayPopover ───────────────────────────────────────────────────────
// Modal listing every unified row for a given date. Used by clicking on a
// calendar/week-strip cell or the "+N more" hint.
function DayPopover({ date, onClose, onSelectIssue, onTbAction }) {
  const [day, setDay] = dUseState(null);
  dUseEffect(() => {
    let alive = true;
    api('list_today', { date }).then(d => { if (alive) setDay(d); });
    return () => { alive = false; };
  }, [date]);

  dUseEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rows = day ? window.unifyDay(day) : [];
  const dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const d = parseISODate(date);
  const longLabel = d ? `${dayName[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}` : date;

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(26,23,20,0.32)', zIndex: 210 }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 'min(640px, 92vw)', maxHeight: '80vh',
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: 12, boxShadow: T.shadowLg,
        zIndex: 211,
        display: 'flex', flexDirection: 'column',
        animation: 'popin 0.16s ease-out',
      }}>
        <style>{`@keyframes popin { from { opacity: 0; transform: translate(-50%, -48%); } to { opacity: 1; transform: translate(-50%, -50%); } }`}</style>
        <header style={{
          display: 'flex', alignItems: 'baseline', gap: 12,
          padding: '16px 20px', borderBottom: `1px solid ${T.border}`,
        }}>
          <h2 style={{
            fontFamily: T.fontDisplay, fontSize: 22, fontWeight: 600, margin: 0,
            letterSpacing: '-0.015em',
          }}>{longLabel}</h2>
          <span style={{ flex: 1 }} />
          {day && (
            <span style={{ fontSize: 12, color: T.textFaint, fontFamily: T.fontMono }}>
              {rows.length} item{rows.length === 1 ? '' : 's'}
            </span>
          )}
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', fontSize: 18,
            color: T.textMuted, cursor: 'pointer', padding: 4, lineHeight: 1, borderRadius: 4,
          }} aria-label="close">✕</button>
        </header>
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {!day && <div style={{ fontSize: 12, color: T.textFaint, fontStyle: 'italic' }}>loading…</div>}
          {day && rows.length === 0 && (
            <div style={{ fontSize: 13, color: T.textFaint, fontStyle: 'italic', padding: '8px 0' }}>
              Nothing scheduled for this day.
            </div>
          )}
          {day && rows.map((row, i) => (
            <window.DayItemRow key={i} row={row} onSelectIssue={(ref) => { onClose(); onSelectIssue(ref); }} onTbAction={onTbAction} />
          ))}
        </div>
      </div>
    </>
  );
}

// ─── TimeblockPopover ────────────────────────────────────────────────
// Small modal for free timeblocks (no issue link). Shows details + delete.
function TimeblockPopover({ block, onClose, onChanged }) {
  dUseEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const c = block.epic_slug ? epicColor(block.epic_slug, block.epic_slug.split('/')[0]) : T.textMuted;

  const doComplete = async () => { await api('complete_timeblock', { id: block.id }); onChanged && onChanged(); onClose(); };
  const doDelete = async () => { if (confirm(`Delete "${block.title}"?`)) { await api('delete_timeblock', { id: block.id }); onChanged && onChanged(); onClose(); } };

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(26,23,20,0.32)', zIndex: 210 }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 'min(440px, 92vw)',
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderLeft: `4px dashed ${c}`,
        borderRadius: 10, boxShadow: T.shadowLg,
        zIndex: 211,
        padding: 22,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ display: 'inline-flex', color: c }}><window.Icon kind="work" size={16} /></span>
          <span style={{
            fontFamily: T.fontMono, fontSize: 13, color: c, fontVariantNumeric: 'tabular-nums',
          }}>{block.date} · {block.start}–{block.end}</span>
          <span style={{ flex: 1 }} />
          {block.epic_slug && (
            <span style={{ fontFamily: T.fontMono, fontSize: 11, color: c }}>
              {block.epic_slug.split('/')[1]}
            </span>
          )}
        </div>
        <h2 style={{
          fontFamily: T.fontDisplay, fontSize: 20, fontWeight: 600, margin: '6px 0 10px',
          letterSpacing: '-0.015em',
        }}>{block.title}</h2>
        {block.note && (
          <div style={{ fontSize: 13, color: T.textMuted, lineHeight: 1.55, marginBottom: 14 }}>{block.note}</div>
        )}
        {!block.issue_id && (
          <div style={{
            fontSize: 11, color: T.warning,
            padding: '6px 10px', background: withAlpha('#b45309', 0.08),
            borderRadius: 6, marginBottom: 14,
          }}>
            Not linked to any issue. Ask the scheduler to relink it, or delete and re-add.
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          {!block.completed && (
            <button onClick={doComplete} style={{
              background: T.done, color: '#fff', border: 'none',
              padding: '8px 16px', fontFamily: T.fontBody, fontSize: 13, fontWeight: 500,
              cursor: 'pointer', borderRadius: 8,
            }}>Mark done</button>
          )}
          <button onClick={doDelete} style={{
            background: 'transparent', color: T.overdue,
            border: `1px solid ${T.border}`,
            padding: '8px 16px', fontFamily: T.fontBody, fontSize: 13, fontWeight: 500,
            cursor: 'pointer', borderRadius: 8,
          }}>Delete</button>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} style={{
            background: 'transparent', color: T.textMuted,
            border: `1px solid ${T.border}`,
            padding: '8px 16px', fontFamily: T.fontBody, fontSize: 13, fontWeight: 500,
            cursor: 'pointer', borderRadius: 8,
          }}>Close</button>
        </div>
      </div>
    </>
  );
}

// ─── EpicDrawer ───────────────────────────────────────────────────────
// Full epic detail: edit title / body, list all issues (open + completed),
// browse arbitrary files in the epic folder, delete or archive issues.
function EpicDrawer({ slug, onClose, onSelectIssue, onChanged, onDeleted }) {
  const [epic, setEpic] = dUseState(null);
  const [files, setFiles] = dUseState([]);
  const [busy, setBusy] = dUseState(false);
  const [editingBody, setEditingBody] = dUseState(false);
  const [bodyDraft, setBodyDraft] = dUseState('');
  const [editingTitle, setEditingTitle] = dUseState(false);
  const [titleDraft, setTitleDraft] = dUseState('');
  const [showCompleted, setShowCompleted] = dUseState(false);
  const [showAddIssue, setShowAddIssue] = dUseState(false);
  const [issueDraft, setIssueDraft] = dUseState('');
  const [completedIssues, setCompletedIssues] = dUseState([]);

  const refresh = async () => {
    try {
      const [e, fs, comp] = await Promise.all([
        api('get_epic', { slug }),
        api('list_epic_files', { epic: slug }),
        api('list_completed', { epic: slug, days_back: 365, limit: 200 }),
      ]);
      setEpic(e);
      setFiles(fs.files || []);
      setCompletedIssues(comp.issues || []);
    } catch {}
  };
  dUseEffect(() => { refresh(); }, [slug]);

  dUseEffect(() => {
    const onKey = e => { if (e.key === 'Escape') { const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return; onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const c = epic ? epicColor(epic.slug, epic.category) : T.textMuted;

  // Top-level issues only — sub-issues drill in via the IssueDrawer.
  const openTop = (epic?.issues || []).filter(it => !it.is_completed && !it.fields?.parent_issue_id && !it.fields?.template_id);
  // Child counts so we can show "+N sub-issues" on each top-level row.
  const childCount = new Map();
  for (const it of (epic?.issues || [])) {
    const pid = it.fields?.parent_issue_id;
    if (pid) childCount.set(pid, (childCount.get(pid) || 0) + 1);
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(26,23,20,0.32)', zIndex: 200 }} />
      <aside style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 'min(680px, 92vw)',
        background: T.surface, borderLeft: `1px solid ${T.border}`,
        boxShadow: T.shadowLg,
        zIndex: 201, display: 'flex', flexDirection: 'column',
        animation: 'slidein 0.2s ease-out',
      }}>
        <header style={{ padding: '18px 22px 14px', borderBottom: `1px solid ${T.border}` }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                <span style={{
                  fontFamily: T.fontMono, fontSize: 11, color: c,
                  padding: '2px 8px', background: withAlpha(c, 0.08), borderRadius: 999,
                }}>{epic?.category || '…'}</span>
                <span style={{ fontFamily: T.fontMono, fontSize: 11, color: T.textFaint }}>{epic?.slug || ''}</span>
              </div>
              {editingTitle ? (
                <input
                  value={titleDraft}
                  autoFocus
                  onChange={e => setTitleDraft(e.target.value)}
                  onKeyDown={async e => {
                    if (e.key === 'Enter') {
                      const t = titleDraft.trim();
                      if (t && t !== epic.title) {
                        await api('update_epic', { slug, patch: { title: t } });
                        refresh(); onChanged && onChanged();
                      }
                      setEditingTitle(false);
                    } else if (e.key === 'Escape') { setEditingTitle(false); }
                  }}
                  onBlur={async () => {
                    const t = titleDraft.trim();
                    if (t && t !== epic.title) {
                      await api('update_epic', { slug, patch: { title: t } });
                      refresh(); onChanged && onChanged();
                    }
                    setEditingTitle(false);
                  }}
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    fontFamily: T.fontDisplay, fontSize: 22, fontWeight: 600, lineHeight: 1.2,
                    background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 6,
                    padding: '4px 8px', color: T.text, outline: 'none',
                  }}
                />
              ) : (
                <h2
                  onDoubleClick={() => { if (epic) { setTitleDraft(epic.title); setEditingTitle(true); } }}
                  style={{
                    fontFamily: T.fontDisplay, fontSize: 22, fontWeight: 600,
                    letterSpacing: '-0.015em', margin: 0,
                    cursor: 'default', userSelect: 'text',
                  }}
                  title="double-click to rename"
                >{epic?.title || 'loading…'}</h2>
              )}
              <div style={{ fontSize: 12, color: T.textMuted, marginTop: 6 }}>
                Owner: <span style={{ fontFamily: T.fontMono }}>{epic?.agent_owner || '—'}</span>
                {' · '}{openTop.length} open issue{openTop.length === 1 ? '' : 's'}
              </div>
            </div>
            <button onClick={onClose} style={{
              background: 'transparent', border: 'none', fontSize: 18, color: T.textMuted,
              cursor: 'pointer', padding: 4, lineHeight: 1, borderRadius: 4,
            }}>✕</button>
          </div>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Long-form context */}
          <Field label="Context (epic.md)">
            {editingBody ? (
              <>
                <textarea
                  value={bodyDraft}
                  onChange={e => setBodyDraft(e.target.value)}
                  autoFocus
                  rows={Math.min(30, Math.max(10, bodyDraft.split('\n').length + 2))}
                  onKeyDown={async e => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      await api('update_epic', { slug, patch: { body: bodyDraft } });
                      setEditingBody(false); refresh(); onChanged && onChanged();
                    } else if (e.key === 'Escape') { setEditingBody(false); }
                  }}
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 8,
                    padding: 12, fontFamily: T.fontMono, fontSize: 13, color: T.text,
                    outline: 'none', resize: 'vertical', lineHeight: 1.5,
                  }}
                />
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <button onClick={async () => {
                    await api('update_epic', { slug, patch: { body: bodyDraft } });
                    setEditingBody(false); refresh(); onChanged && onChanged();
                  }} style={primaryBtn(true)}>Save</button>
                  <button onClick={() => setEditingBody(false)} style={secondaryBtn()}>Cancel</button>
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: 11, color: T.textFaint, alignSelf: 'center' }}><kbd>⌘↵</kbd> save</span>
                </div>
              </>
            ) : (
              <div
                onDoubleClick={() => { setBodyDraft(epic?.body || ''); setEditingBody(true); }}
                onClick={() => { if (!epic?.body) { setBodyDraft(''); setEditingBody(true); } }}
                style={{ minHeight: 24, userSelect: 'text', cursor: epic?.body ? 'default' : 'text' }}
                title="double-click to edit"
              >
                {epic?.body ? <Md text={epic.body} /> : <span style={{ fontSize: 13, color: T.textFaint, fontStyle: 'italic' }}>+ add context (markdown supported)</span>}
              </div>
            )}
          </Field>

          {/* Open issues */}
          <Field label={`Open issues (${openTop.length})`}>
            {openTop.length === 0 && !showAddIssue && (
              <div style={{ fontSize: 12, color: T.textFaint, fontStyle: 'italic', marginBottom: 6 }}>none open</div>
            )}
            {openTop.map(it => (
              <div
                key={it.id}
                onClick={() => onSelectIssue && onSelectIssue({ id: it.id, epic_slug: slug })}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 10px', marginBottom: 4,
                  background: T.surface, border: `1px solid ${T.border}`,
                  borderLeft: `3px solid ${c}`, borderRadius: 6,
                  cursor: 'pointer',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = T.surfaceHover; }}
                onMouseLeave={e => { e.currentTarget.style.background = T.surface; }}
              >
                <span style={{ fontFamily: T.fontMono, fontSize: 11, color: T.textFaint, flexShrink: 0 }}>{it.id}</span>
                <span style={{ flex: 1, fontSize: 13, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.title}</span>
                {childCount.get(it.id) > 0 && (
                  <span style={{
                    fontSize: 10, fontFamily: T.fontMono, color: c,
                    padding: '1px 6px', background: withAlpha(c, 0.10), borderRadius: 999,
                  }} title={`${childCount.get(it.id)} sub-issue${childCount.get(it.id) === 1 ? '' : 's'}`}>
                    +{childCount.get(it.id)}
                  </span>
                )}
                {it.fields?.due && <span style={{ fontSize: 11, color: T.textMuted, fontFamily: T.fontMono }}>{it.fields.due}</span>}
                <span style={{ color: T.textFaint }}>→</span>
              </div>
            ))}
            {showAddIssue ? (
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <input
                  value={issueDraft}
                  onChange={e => setIssueDraft(e.target.value)}
                  autoFocus
                  onKeyDown={async e => {
                    if (e.key === 'Enter' && issueDraft.trim()) {
                      await api('create_issue', { epic: slug, title: issueDraft.trim() });
                      setIssueDraft(''); setShowAddIssue(false); refresh(); onChanged && onChanged();
                    } else if (e.key === 'Escape') { setShowAddIssue(false); setIssueDraft(''); }
                  }}
                  placeholder="new issue title… enter to create"
                  style={{
                    flex: 1, background: T.surface2, border: `1px solid ${T.border}`,
                    borderRadius: 6, padding: '6px 10px', fontFamily: T.fontBody, fontSize: 13, color: T.text,
                    outline: 'none',
                  }}
                />
                <button onClick={() => { setShowAddIssue(false); setIssueDraft(''); }} style={secondaryBtn()}>Cancel</button>
              </div>
            ) : (
              <button onClick={() => setShowAddIssue(true)} style={{
                background: 'transparent', border: `1px dashed ${T.border}`,
                padding: '6px 10px', fontFamily: T.fontBody, fontSize: 12, color: T.textMuted,
                borderRadius: 6, cursor: 'pointer', marginTop: 4, width: '100%',
              }}>+ add issue</button>
            )}
          </Field>

          {/* Completed in this epic */}
          {completedIssues.length > 0 && (
            <Field label={`Archive (${completedIssues.length})`}>
              <button onClick={() => setShowCompleted(s => !s)} style={{
                background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
                fontFamily: T.fontBody, fontSize: 12, color: T.accent, marginBottom: 6,
              }}>{showCompleted ? '▾ hide' : '▸ show'}</button>
              {showCompleted && completedIssues.map(it => (
                <div
                  key={it.id}
                  onClick={() => onSelectIssue && onSelectIssue({ id: it.id, epic_slug: slug })}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '6px 10px', marginBottom: 3,
                    background: T.surface2, border: `1px solid ${T.border}`,
                    borderRadius: 6, cursor: 'pointer', opacity: 0.7,
                  }}
                >
                  <span style={{ fontFamily: T.fontMono, fontSize: 11, color: T.textFaint }}>{it.id}</span>
                  <span style={{ flex: 1, fontSize: 12, color: T.text, textDecoration: 'line-through', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.title}</span>
                  {it.completed_at && <span style={{ fontSize: 10, color: T.textFaint, fontFamily: T.fontMono }}>{it.completed_at.slice(0, 10)}</span>}
                </div>
              ))}
            </Field>
          )}

          {/* Files */}
          <Field label={`Files (${files.length})`}>
            {files.length === 0 && (
              <div style={{ fontSize: 12, color: T.textFaint, fontStyle: 'italic', marginBottom: 6 }}>
                none yet — agents can create notes/drafts/refs here via <code>write_epic_file</code>
              </div>
            )}
            {files.map(f => (
              <div key={f} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 10px', marginBottom: 3,
                background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 6,
              }}>
                <span style={{ fontFamily: T.fontMono, fontSize: 12, color: T.text, flex: 1 }}>📄 {f}</span>
                <button onClick={async () => {
                  if (confirm(`Delete ${f}?`)) {
                    await api('delete_epic_file', { epic: slug, filename: f });
                    refresh();
                  }
                }} style={{ background: 'transparent', border: 'none', color: T.overdue, cursor: 'pointer', fontSize: 12, padding: '0 6px' }}>✕</button>
              </div>
            ))}
          </Field>
        </div>
        <footer style={{
          padding: '14px 22px', borderTop: `1px solid ${T.border}`,
          background: T.surface, display: 'flex', gap: 10, alignItems: 'center',
        }}>
          <button
            onClick={async () => {
              if (!epic) return;
              const cnt = (epic.issues || []).length;
              const phrase = `delete ${epic.title}`;
              const typed = prompt(
                `This permanently deletes the epic "${epic.title}" and all ${cnt} of its issues, sub-issues, and files.\n\nType: ${phrase}\n\nto confirm:`,
                ''
              );
              if (typed !== phrase) return;
              setBusy(true);
              try {
                await api('delete_epic', { slug });
                onChanged && onChanged();
                onDeleted && onDeleted(slug);
                onClose();
              } finally { setBusy(false); }
            }}
            disabled={busy}
            style={{
              background: 'transparent', color: T.overdue,
              border: `1px solid ${T.border}`,
              padding: '9px 16px', fontFamily: T.fontBody, fontSize: 13, fontWeight: 500,
              cursor: busy ? 'wait' : 'pointer', borderRadius: 8,
            }}
          >Delete epic</button>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: T.textFaint }}>
            <kbd>esc</kbd> close · double-click title to rename
          </span>
        </footer>
      </aside>
    </>
  );
}

// ─── ArchiveDrawer ────────────────────────────────────────────────────
// Search + browse all completed issues across every epic.
function ArchiveDrawer({ onClose, onSelectIssue }) {
  const [issues, setIssues] = dUseState([]);
  const [query, setQuery] = dUseState('');
  const [daysBack, setDaysBack] = dUseState(90);

  dUseEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      api('list_completed', { days_back: daysBack, query: query.trim() || undefined, limit: 200 })
        .then(j => { if (alive) setIssues(j.issues || []); });
    }, 200);
    return () => { alive = false; clearTimeout(t); };
  }, [query, daysBack]);

  dUseEffect(() => {
    const onKey = e => { if (e.key === 'Escape') { const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return; onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(26,23,20,0.32)', zIndex: 200 }} />
      <aside style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 'min(640px, 92vw)',
        background: T.surface, borderLeft: `1px solid ${T.border}`, boxShadow: T.shadowLg,
        zIndex: 201, display: 'flex', flexDirection: 'column',
        animation: 'slidein 0.2s ease-out',
      }}>
        <header style={{ padding: '18px 22px 14px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <h2 style={{ fontFamily: T.fontDisplay, fontSize: 22, fontWeight: 600, margin: 0 }}>Archive</h2>
          <span style={{ fontFamily: T.fontMono, fontSize: 12, color: T.textFaint }}>{issues.length} done</span>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', fontSize: 18, color: T.textMuted,
            cursor: 'pointer', padding: 4, lineHeight: 1,
          }}>✕</button>
        </header>
        <div style={{ padding: '12px 22px', borderBottom: `1px solid ${T.border}`, display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="search archived issues…"
            autoFocus
            style={{
              flex: 1, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6,
              padding: '8px 12px', fontFamily: T.fontBody, fontSize: 13, color: T.text, outline: 'none',
            }}
          />
          <select
            value={daysBack}
            onChange={e => setDaysBack(parseInt(e.target.value, 10))}
            style={{
              background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6,
              padding: '8px 12px', fontFamily: T.fontBody, fontSize: 12, color: T.text, outline: 'none',
            }}
          >
            <option value={30}>last 30 days</option>
            <option value={90}>last 90 days</option>
            <option value={365}>last year</option>
            <option value={3650}>all time</option>
          </select>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 22px' }}>
          {issues.length === 0 && (
            <div style={{ fontSize: 13, color: T.textFaint, fontStyle: 'italic', padding: '8px 0' }}>
              {query ? 'no matches.' : 'nothing archived yet.'}
            </div>
          )}
          {issues.map(it => {
            const cc = epicColor(it.epic_slug, it.epic_slug.split('/')[0]);
            return (
              <div
                key={it.id}
                onClick={() => { onClose(); onSelectIssue({ id: it.id, epic_slug: it.epic_slug }); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 12px', marginBottom: 4,
                  background: T.surface, border: `1px solid ${T.border}`,
                  borderLeft: `3px solid ${cc}`, borderRadius: 6, cursor: 'pointer',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = T.surfaceHover; }}
                onMouseLeave={e => { e.currentTarget.style.background = T.surface; }}
              >
                <span style={{ fontFamily: T.fontMono, fontSize: 11, color: cc }}>{it.epic_slug.split('/')[1]}</span>
                <span style={{ fontFamily: T.fontMono, fontSize: 11, color: T.textFaint }}>{it.id}</span>
                <span style={{ flex: 1, fontSize: 13, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.title}</span>
                {it.completed_at && <span style={{ fontSize: 11, color: T.textMuted, fontFamily: T.fontMono, fontVariantNumeric: 'tabular-nums' }}>{it.completed_at.slice(0, 10)}</span>}
              </div>
            );
          })}
        </div>
      </aside>
    </>
  );
}

Object.assign(window, { IssueDrawer, AgentsDrawer, DayPopover, TimeblockPopover, EpicDrawer, ArchiveDrawer });
