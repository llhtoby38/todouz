// app.jsx — single-page shell. No tabs. Vertical scroll. Two overlays (IssueDrawer + AgentsDrawer).

const { useState: aUseState, useEffect: aUseEffect, useCallback: aUseCallback, useMemo: aUseMemo, useRef: aUseRef } = React;

function App() {
  const data = useDashboardData();
  const isMobile = useIsMobile();
  // The issue drawer is a NAVIGATION STACK, not a single ref: opening a
  // sub-issue from inside an issue pushes onto the stack, and closing pops ONE
  // level so you land back on the parent issue (instead of the whole drawer
  // closing). Deep-links (#issue=<epic>/<id>) push too, so tapping an item link
  // inside an action-item table opens it over the current issue.
  const [issueStack, setIssueStack] = aUseState([]);
  const selectedIssue = issueStack.length ? issueStack[issueStack.length - 1] : null;
  const parentIssue = issueStack.length > 1 ? issueStack[issueStack.length - 2] : null;
  const [agentsLaunch, setAgentsLaunch] = aUseState(null);
  // viewDate controls which day the top "Today" section is showing. null = real today.
  // Clicking a day in WeekStrip / CalendarMonth sets this; we no longer open a popover.
  const [viewDate, setViewDate] = aUseState(null);
  // viewTime is set when a time slot is tapped in the Day/Week calendar, so the
  // top-bar + prefills that time too. null = no specific time (whole-day).
  // viewEndTime is the end of a dragged selection range (null = default +1h).
  const [viewTime, setViewTime] = aUseState(null);
  const [viewEndTime, setViewEndTime] = aUseState(null);
  const [popoverBlock, setPopoverBlock] = aUseState(null);
  const [openEpicSlug, setOpenEpicSlug] = aUseState(null);
  const [archiveOpen, setArchiveOpen] = aUseState(false);
  const [settingsOpen, setSettingsOpen] = aUseState(false);
  // Single unified "new item" modal — replaces the old +Epic / +Event split.
  // When opened with `prefill = { date }` the modal preselects "Timeblock"
  // on that date for the per-day quick-add UX.
  const [newItem, setNewItem] = aUseState(null); // null | { kind?, prefill? }
  // Mobile: the page becomes a tabbed app (bottom nav). One section at a time —
  // no endless scroll. Desktop keeps the single-scroll layout.
  const [mobileTab, setMobileTab] = aUseState('today');

  // ─── select mode ─────────────────────────────────────────────────────
  // While active, clicks that would normally open a drawer instead toggle the
  // clicked thing in/out of the selection clipboard. All click paths already
  // funnel through the central handlers below (onSelectIssue → setSelectedIssue,
  // onSelectEpic, onSelectDay, onSelectBlock), so the guards live here — no
  // per-row plumbing needed.
  const [selectMode, setSelectMode] = aUseState(false);
  const [selection, setSelection] = aUseState([]);   // [{kind, ...ref, label}]

  const selKey = (s) => `${s.kind}:${s.epic_slug || ''}:${s.id || s.slug || s.date || ''}:${s.text || ''}`;
  const toggleSelection = aUseCallback((item) => {
    setSelection(cur => {
      const k = selKey(item);
      return cur.some(s => selKey(s) === k) ? cur.filter(s => selKey(s) !== k) : [...cur, item];
    });
  }, []);
  const exitSelectMode = aUseCallback(() => { setSelectMode(false); setSelection([]); }, []);

  // Clipboard text for Copy. The chat path no longer stringifies into the
  // composer — it hands the raw items over as attachment chips instead.
  const selectionText = aUseCallback(() => serializeSelection(selection), [selection]);

  const openAgents = aUseCallback((opts = {}) => {
    setAgentsLaunch({ agent: opts.agent || 'scheduler', seed: opts.seed || null, cardContext: opts.cardContext || null, prefillInput: opts.prefillInput || null, contextItems: opts.contextItems || null });
  }, []);

  // ─── issue drawer navigation stack ───────────────────────────────────
  // openIssue: drill into a sub-issue (push) OR jump back up to an ancestor
  // that's already open (truncate). openIssueFresh: start a brand-new stack
  // (used when a DIFFERENT surface — epic/archive/calendar — opens an issue).
  const openIssue = aUseCallback((ref) => {
    if (!ref || !ref.id) return;
    setIssueStack(stack => {
      const idx = stack.findIndex(x => x.id === ref.id && x.epic_slug === ref.epic_slug);
      if (idx >= 0) return stack.slice(0, idx + 1);   // already open → pop back up to it
      return [...stack, ref];                          // new → push on top
    });
  }, []);
  const openIssueFresh = aUseCallback((ref) => { setIssueStack(ref && ref.id ? [ref] : []); }, []);
  const closeIssueTop = aUseCallback(() => { setIssueStack(stack => stack.slice(0, -1)); }, []);
  const closeAllIssues = aUseCallback(() => setIssueStack([]), []);

  // Central click handlers — guarded by select mode.
  const handleSelectIssue = aUseCallback((ref) => {
    if (!ref) { closeAllIssues(); return; }
    if (selectMode) {
      toggleSelection({ kind: 'issue', id: ref.id, epic_slug: ref.epic_slug, label: ref.title || null });
      return;
    }
    openIssue(ref);
  }, [selectMode, toggleSelection, openIssue, closeAllIssues]);
  const handleSelectEpic = aUseCallback((epic) => {
    if (!epic) { setOpenEpicSlug(null); return; }
    if (selectMode) {
      toggleSelection({ kind: 'epic', slug: epic.slug, label: epic.title || null });
      return;
    }
    setOpenEpicSlug(epic.slug);
  }, [selectMode, toggleSelection]);
  const handleSelectDay = aUseCallback((date) => {
    if (selectMode) { toggleSelection({ kind: 'date', date }); return; }
    setViewDate(date); setViewTime(null); setViewEndTime(null);
  }, [selectMode, toggleSelection]);
  // A time slot tapped (or dragged) in the Day/Week calendar. In select mode it
  // joins the clipboard as a "slot" chip; otherwise it sets the add-context so
  // the top-bar + adds an item/session across that range.
  const handleSelectSlot = aUseCallback((date, time, endTime) => {
    if (selectMode) {
      toggleSelection({ kind: 'slot', id: `${date}T${time}`, date, time, endTime: endTime || null, label: `${date} ${time}${endTime ? `–${endTime}` : ''}` });
      return;
    }
    setViewDate(date); setViewTime(time); setViewEndTime(endTime || null);
  }, [selectMode, toggleSelection]);
  // "+ New" from the selection tray: carry a picked time slot (date/start/end)
  // and the first picked issue (as a session link) into the create wizard.
  const onNewFromSelection = () => {
    const slot = selection.find(s => s.kind === 'slot');
    const iss = selection.find(s => s.kind === 'issue');
    const prefill = {};
    if (slot) { prefill.date = slot.date; prefill.time = slot.time; if (slot.endTime) prefill.endTime = slot.endTime; }
    if (iss) prefill.linkIssue = { id: iss.id, epic_slug: iss.epic_slug, title: iss.label || iss.id };
    exitSelectMode();
    setNewItem({ prefill });
  };
  const handleSelectBlock = aUseCallback((block) => {
    if (!block) { setPopoverBlock(null); return; }
    if (selectMode) {
      toggleSelection({ kind: 'block', id: block.id, label: block.title || null });
      return;
    }
    setPopoverBlock(block);
  }, [selectMode, toggleSelection]);

  // Hotkeys: space → open agents drawer, esc → close.
  // Suppressed whenever focus is in any kind of editable surface so typing isn't hijacked.
  aUseEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      const isEditable =
        t && (
          t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable ||
          (typeof t.closest === 'function' && t.closest('input, textarea, select, [contenteditable="true"]'))
        );
      if (isEditable) {
        if (e.key === 'Escape') t.blur && t.blur();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === ' ') {
        e.preventDefault();
        openAgents();
      } else if (e.key === 'Escape') {
        // The IssueDrawer has its own Escape handler that pops ONE level of the
        // stack, so don't clear the whole stack here — just the other overlays.
        setAgentsLaunch(null);
        exitSelectMode();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openAgents, exitSelectMode]);

  // ─── deep-links to issues ────────────────────────────────────────────
  // A link of the form #issue=<epic_slug>/<id> opens that exact item in the
  // drawer. Agents write these in action-item tables (via each item's app_url)
  // so tapping a row jumps straight to its page. In-app taps open it OVER the
  // current issue (push, so closing returns you here); a fresh page load with
  // the hash opens it as the root.
  aUseEffect(() => {
    const parse = (str) => {
      const m = /#issue=([^&\s"']+)/.exec(str || '');
      if (!m) return null;
      let raw; try { raw = decodeURIComponent(m[1]); } catch { raw = m[1]; }
      const slash = raw.lastIndexOf('/');
      if (slash < 1) return null;
      return { epic_slug: raw.slice(0, slash), id: raw.slice(slash + 1) };
    };
    const fromHash = () => {
      const ref = parse(window.location.hash);
      if (!ref) return;
      // Clear the hash so the SAME link works when tapped again (hashchange only
      // fires on a change) — no reload, no extra history entry.
      try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch {}
      openIssue(ref);
    };
    const onDocClick = (e) => {
      const a = e.target && e.target.closest && e.target.closest('a[href*="#issue="]');
      if (!a) return;
      const ref = parse(a.getAttribute('href'));
      if (!ref) return;
      e.preventDefault();
      openIssue(ref);
    };
    fromHash();                                    // handle a deep-link present on load
    window.addEventListener('hashchange', fromHash);
    document.addEventListener('click', onDocClick);
    return () => { window.removeEventListener('hashchange', fromHash); document.removeEventListener('click', onDocClick); };
  }, [openIssue]);

  // ─── share to todouz ─────────────────────────────────────────────────
  // The phone's share sheet opens /dashboard/?share_url=…&share_text=…
  // (manifest share_target); the feed's "📥 Share" button fires an event.
  const [shareInit, setShareInit] = aUseState(null);
  aUseEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.has('share_url') || q.has('share_text') || q.has('share_title')) {
      setShareInit({ url: q.get('share_url') || '', text: q.get('share_text') || '', title: q.get('share_title') || '' });
      setMobileTab('feed');
      try { history.replaceState(null, '', window.location.pathname + window.location.hash); } catch {}
    }
    const open = () => setShareInit({});
    window.addEventListener('todouz-share-open', open);
    return () => window.removeEventListener('todouz-share-open', open);
  }, []);

  // ─── deep-links to the feed (#feed or #feed=<post-id>) ───────────────
  // The morning push opens #feed=<brief-id>; the Feed tab scrolls to that post.
  aUseEffect(() => {
    const fromHash = () => {
      const m = /#feed(?:=([^&\s"']+))?(?:$|&)/.exec(window.location.hash || '');
      if (!m) return;
      try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch {}
      window.__feedPending = m[1] || null;
      setMobileTab('feed');
      if (m[1]) window.dispatchEvent(new CustomEvent('todouz-feed-open', { detail: m[1] }));
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, []);

  // ─── deep-links to second-brain notes (#brain=<slug>) ────────────────
  // Same pattern as #issue=: switch to the Brain tab and hand it the slug (via a
  // pending global + an event, so it works whether the tab is mounted yet or not).
  aUseEffect(() => {
    const parse = (str) => { const m = /#brain=([^&\s"']+)/.exec(str || ''); if (!m) return null; try { return decodeURIComponent(m[1]); } catch { return m[1]; } };
    const go = (slug) => { window.__brainPending = slug; setMobileTab('brain'); window.dispatchEvent(new CustomEvent('todouz-brain-open', { detail: slug })); };
    const fromHash = () => {
      const s = parse(window.location.hash); if (!s) return;
      try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch {}
      go(s);
    };
    const onDocClick = (e) => {
      const a = e.target && e.target.closest && e.target.closest('a[href*="#brain="]');
      if (!a) return;
      const s = parse(a.getAttribute('href')); if (!s) return;
      e.preventDefault(); go(s);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    document.addEventListener('click', onDocClick);
    return () => { window.removeEventListener('hashchange', fromHash); document.removeEventListener('click', onDocClick); };
  }, []);

  // Per-day add: open the unified modal preselecting "Timeblock" on that day.
  const onAddForDay = (date) => setNewItem({ kind: 'timeblock', prefill: { date } });

  // Drop handler: payload describes what was dragged ({kind: 'block'|'issue', id, epic_slug?, currentDate}).
  // We rebase its date via update_timeblock or update_issue (patch.due), then refetch.
  const onDropOnDay = async (newDate, payload) => {
    if (!payload || !newDate) return;
    if (payload.currentDate === newDate) return;
    try {
      if (payload.kind === 'block') {
        await api('update_timeblock', { id: payload.id, patch: { date: newDate } });
      } else if (payload.kind === 'issue') {
        await api('update_issue', { id: payload.id, epic: payload.epic_slug, patch: { due: newDate } });
      }
      data.refetch();
    } catch (e) {
      alert('move failed: ' + (e?.message || e));
    }
  };

  if (data.loading) {
    return (
      <div style={{
        minHeight: '100dvh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 20, background: T.bg,
      }}>
        <img
          src="/dashboard/logo.png"
          alt="loading"
          width={76} height={76}
          style={{
            display: 'block', borderRadius: 18, boxShadow: T.shadow,
            animation: 'todouz-logo-spin 1.15s cubic-bezier(0.66, 0, 0.34, 1) infinite',
          }}
        />
        <div style={{
          fontFamily: T.fontDisplay, fontSize: 15, fontWeight: 500, color: T.textFaint,
          letterSpacing: '0.03em', animation: 'todouz-pulse 1.5s ease-in-out infinite',
        }}>loading your life OS…</div>
      </div>
    );
  }
  if (data.error) {
    return (
      <div style={{ padding: 40, color: '#c4593c' }}>
        <h2>error</h2>
        <pre style={{ background: 'rgba(0,0,0,0.05)', padding: 12, fontSize: 12 }}>{data.error}</pre>
        <p>Make sure the server is running: <code>npm run start</code> in <code>todouz/</code>.</p>
      </div>
    );
  }

  // overflow-x: clip (NOT hidden) — hidden creates a scroll container that
  // silently kills the header's position:sticky. clip just crops.
  return (
    <div style={{ minHeight: '100vh', overflowX: 'clip' }}>
      <Header
        todayDate={data.todayDate}
        onAsk={() => openAgents()}
        onArchive={() => setArchiveOpen(true)}
        onNew={() => setNewItem({ prefill: { ...(viewDate ? { date: viewDate } : {}), ...(viewTime ? { time: viewTime } : {}), ...(viewEndTime ? { endTime: viewEndTime } : {}) } })}
        selectMode={selectMode}
        onToggleSelect={() => { selectMode ? exitSelectMode() : setSelectMode(true); }}
        onSettings={() => setSettingsOpen(true)}
        onRefresh={() => data.refetch()}
        sticky={mobileTab !== 'feed'}
        tabs={DESKTOP_TABS}
        activeTab={['projects', 'brain', 'feed'].includes(mobileTab) ? mobileTab : 'overview'}
        onTab={(id) => { setMobileTab(id === 'overview' ? 'today' : id); window.scrollTo({ top: 0 }); }}
      />
      <main style={{ maxWidth: 1400, margin: '0 auto', padding: isMobile ? '12px 12px calc(96px + env(safe-area-inset-bottom, 0px))' : '28px 28px 72px', minWidth: 0 }}>
        {/* Section switcher — one view at a time on phones so there's no
            endless scroll. Desktop still renders all three stacked. */}
        {/* Section switcher. Mobile: one view at a time (Today/Plan/Items/
            Projects). Desktop: the three original sections still stack under
            "Overview"; "Projects" swaps in the full-width board. Additive — the
            existing views are untouched. */}
        {isMobile && mobileTab !== 'feed' && (
          <nav aria-label="Primary" style={{
            position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 55,
            display: 'flex', justifyContent: 'space-around',
            padding: '6px 6px calc(6px + env(safe-area-inset-bottom, 0px))',
            background: 'rgba(250, 248, 244, 0.94)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
            borderTop: `1px solid ${T.border}`,
          }}>
            {MOBILE_TABS.map(t => {
              const on = mobileTab === t.id;
              return (
                <button key={t.id} onClick={() => { setMobileTab(t.id); window.scrollTo({ top: 0 }); }} aria-current={on ? 'page' : undefined}
                  style={{
                    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                    padding: '6px 0 4px', minHeight: 48, background: 'transparent', border: 'none', cursor: 'pointer',
                    color: on ? T.accent : T.textMuted, fontFamily: T.fontBody, fontSize: 11, fontWeight: on ? 700 : 500,
                  }}>
                  <Icon kind={t.icon} size={22} />
                  {t.label}
                </button>
              );
            })}
          </nav>
        )}
        {mobileTab !== 'projects' && mobileTab !== 'brain' && mobileTab !== 'feed' && (!isMobile || mobileTab === 'today') && <TodaySection
          data={data}
          viewDate={viewDate}
          onResetView={() => setViewDate(null)}
          onSelectIssue={handleSelectIssue}
          onRefresh={() => data.refetch()}
          onSelectBlock={handleSelectBlock}
          onAdd={(kind, prefill) => setNewItem({ kind, prefill })}
        />}
        {/* Mobile: Today = agenda + Next-7-days strip; Plan = the Day/Week/
            Month/Year calendar; Items = the by-folder list. */}
        {mobileTab !== 'projects' && mobileTab !== 'brain' && mobileTab !== 'feed' && (!isMobile || mobileTab === 'today' || mobileTab === 'plan') && <PlanSection
          data={data}
          viewDate={viewDate}
          forceMode={isMobile ? (mobileTab === 'today' ? 'week' : 'calendar') : undefined}
          onSelectIssue={handleSelectIssue}
          onSelectDay={handleSelectDay}
          onSelectSlot={handleSelectSlot}
          selectedSlot={viewDate ? { date: viewDate, time: viewTime, endTime: viewEndTime } : null}
          onSelectBlock={handleSelectBlock}
          onAddForDay={onAddForDay}
          onDropOnDay={onDropOnDay}
        />}
        {mobileTab !== 'projects' && mobileTab !== 'brain' && mobileTab !== 'feed' && (!isMobile || mobileTab === 'today' || mobileTab === 'issues') && <IssuesSection
          data={data}
          forceMode={isMobile ? (mobileTab === 'today' ? 'date' : 'epic') : undefined}
          onSelectIssue={handleSelectIssue}
          onSelectEpic={handleSelectEpic}
          onRefresh={() => data.refetch()}
        />}
        {mobileTab === 'projects' && <ProjectsSection
          data={data}
          onSelectIssue={handleSelectIssue}
          selectMode={selectMode}
          isSelected={(item) => selection.some(x => selKey(x) === selKey(item))}
        />}
        {mobileTab === 'brain' && <BrainSection
          data={data}
          onSelectIssue={handleSelectIssue}
          onSelectEpic={handleSelectEpic}
        />}
        {mobileTab === 'feed' && <FeedSection
          data={data}
          onExit={() => { setMobileTab('today'); window.scrollTo({ top: 0 }); }}
          onSelectIssue={handleSelectIssue}
          onSelectBlock={handleSelectBlock}
          onAdd={(kind, prefill) => setNewItem({ kind, prefill })}
        />}
      </main>
      {selectMode && (
        <SelectionTray
          selection={selection}
          onRemove={(item) => toggleSelection(item)}
          onClear={() => setSelection([])}
          onExit={exitSelectMode}
          onNewFromSelection={onNewFromSelection}
          onCopy={async () => {
            try { await navigator.clipboard.writeText(selectionText()); } catch {}
          }}
          onOpenChat={() => {
            // Hand the picked items to chat as attachments, not as a wall of
            // pasted text in the box the user is trying to type in.
            const items = selection.slice();
            exitSelectMode();
            openAgents({ contextItems: items });
          }}
          onMove={async (targetSlug) => {
            // Re-home every selected item into the chosen folder.
            const items = selection.filter(s => s.kind === 'issue' && s.id && s.epic_slug);
            let failed = 0;
            for (const s of items) {
              if (s.epic_slug === targetSlug) continue;
              try {
                const r = await api('move_issue', { id: s.id, epic: s.epic_slug, target_epic: targetSlug });
                if (r?.error) failed++;
              } catch { failed++; }
            }
            if (failed) alert(`${failed} item${failed === 1 ? '' : 's'} could not be moved.`);
            setSelection([]);
            exitSelectMode();
            data.refetch();
          }}
        />
      )}
      {selectedIssue && (
        <IssueDrawer
          // key per issue so navigating parent↔sub-issue remounts with a clean
          // fetch + fresh state (draft cache, scroll) rather than reusing stale.
          key={`${selectedIssue.epic_slug || ''}/${selectedIssue.id}`}
          issueRef={selectedIssue}
          parentRef={parentIssue}
          // Close pops ONE level: from a sub-issue you return to its parent; from
          // the root issue the drawer closes.
          onClose={closeIssueTop}
          onChanged={() => data.refetch()}
          // Jump straight from this item into a new agent chat, with the item
          // handed to the agent as task context (an attachment chip + task ref).
          onOpenChat={(issue) => { closeAllIssues(); openAgents({ cardContext: issue }); }}
          // handleSelectIssue (not openIssue) so sub-issue rows respect select
          // mode; when navigating it pushes onto the stack.
          onSelectIssue={handleSelectIssue}
          selectMode={selectMode}
          isSelected={(item) => selection.some(x => selKey(x) === selKey(item))}
          onToggleSelect={toggleSelection}
        />
      )}
      {openEpicSlug && (
        <EpicDrawer
          slug={openEpicSlug}
          onClose={() => setOpenEpicSlug(null)}
          onSelectIssue={(ref) => { setOpenEpicSlug(null); openIssueFresh(ref); }}
          onChanged={() => data.refetch()}
        />
      )}
      {archiveOpen && (
        <ArchiveDrawer
          onClose={() => setArchiveOpen(false)}
          onSelectIssue={(ref) => { openIssueFresh(ref); }}
        />
      )}
      {settingsOpen && <SettingsDrawer onClose={() => setSettingsOpen(false)} isMobile={isMobile} />}
      {shareInit && <ShareSheet initial={shareInit} onClose={() => setShareInit(null)} />}
      {agentsLaunch && (
        <AgentsDrawer
          launch={agentsLaunch}
          onClose={() => setAgentsLaunch(null)}
          onFiles={() => data.refetch()}
        />
      )}
      {popoverBlock && (
        <TimeblockDrawer
          blockId={typeof popoverBlock === 'string' ? popoverBlock : popoverBlock.id}
          onClose={() => setPopoverBlock(null)}
          onChanged={() => data.refetch()}
          onOpenIssue={(ref) => { setPopoverBlock(null); openIssueFresh(ref); }}
        />
      )}
      {newItem && (
        <NewItemModal
          initial={newItem}
          onClose={() => setNewItem(null)}
          onCreated={(result) => {
            setNewItem(null);
            data.refetch();
            if (result?.openEpicSlug) setOpenEpicSlug(result.openEpicSlug);
            if (result?.openIssue) openIssueFresh(result.openIssue);
          }}
        />
      )}
    </div>
  );
}

// Floating clipboard tray shown while select mode is active. Lists what's been
// clicked so far; Copy puts the [TODOUZ SELECTION] block on the OS clipboard
// (paste it to any MCP-connected agent), Open chat prefills the in-app agent.
function SelectionTray({ selection, onRemove, onClear, onExit, onCopy, onOpenChat, onMove, onNewFromSelection }) {
  const [copied, setCopied] = aUseState(false);
  const [minimized, setMinimized] = aUseState(false);
  const [moveOpen, setMoveOpen] = aUseState(false);
  const [epicList, setEpicList] = aUseState([]);
  const isMobile = useIsMobile();
  // How many picked things are items that can be re-homed into a folder.
  const movable = selection.filter(s => s.kind === 'issue').length;
  const toggleMove = () => {
    setMoveOpen(o => !o);
    if (!epicList.length) {
      api('list_epics')
        .then(r => setEpicList((r.epics || []).map(e => e.slug).filter(s => !s.startsWith('archive/')).sort()))
        .catch(() => {});
    }
  };
  // Free-floating position. null = the default docked spot (bottom-centre,
  // above the mobile nav). Once dragged, we switch to absolute left/top.
  const [pos, setPos] = aUseState(null);
  const dragRef = aUseRef(null);
  const boxRef = aUseRef(null);

  // Pointer events (not mouse) so this works with touch on the phone, which is
  // the whole point — the tray covers content and needs to be shovable.
  const onPointerDown = (e) => {
    const box = boxRef.current;
    if (!box) return;
    const r = box.getBoundingClientRect();
    dragRef.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height, moved: false };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
  };
  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    d.moved = true;
    // Clamp so it can never be dragged fully off-screen.
    const left = Math.max(6, Math.min(window.innerWidth - d.w - 6, e.clientX - d.dx));
    const top = Math.max(6, Math.min(window.innerHeight - d.h - 6, e.clientY - d.dy));
    setPos({ left, top });
  };
  const onPointerUp = (e) => {
    dragRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
  };

  const placement = pos
    ? { left: pos.left, top: pos.top }
    : { left: '50%', bottom: 18, transform: 'translateX(-50%)' };

  // Minimized: a compact pill — still draggable, still shows the count, one tap
  // to expand. Gives the screen back without losing the selection.
  if (minimized) {
    return (
      <div
        ref={boxRef}
        style={{
          position: 'fixed', zIndex: 300, ...placement,
          display: 'flex', alignItems: 'center', gap: 8,
          background: T.surface, border: `1px solid ${T.borderStrong}`,
          borderRadius: 999, boxShadow: T.shadowLg, padding: '6px 10px',
          touchAction: 'none',
        }}
      >
        <span
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
          title="drag to move"
          style={{ cursor: 'grab', color: T.textFaint, display: 'inline-flex' }}
        ><Icon kind="drag" size={14} /></span>
        <span style={{ fontSize: 12, fontFamily: T.fontMono, color: T.accent, fontWeight: 600 }}>
          {selection.length} selected
        </span>
        <button onClick={() => setMinimized(false)} title="expand" style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: T.textMuted, display: 'inline-flex', padding: 2,
        }}><Icon kind="expand" size={14} /></button>
        <button onClick={onExit} title="exit select mode" style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: T.textMuted, display: 'inline-flex', padding: 2,
        }}><Icon kind="x" size={14} /></button>
      </div>
    );
  }

  return (
    <div
      ref={boxRef}
      style={{
        position: 'fixed', zIndex: 300, ...placement,
        maxWidth: 'min(860px, 94vw)',
        background: T.surface, border: `1px solid ${T.borderStrong}`,
        borderRadius: 12, boxShadow: T.shadowLg,
        padding: '10px 14px',
        display: 'flex', flexDirection: 'column', gap: 8,
        touchAction: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* Grab handle — drag the tray anywhere it isn't in the way. */}
        <span
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
          title="drag to move"
          style={{ cursor: 'grab', color: T.textFaint, display: 'inline-flex', marginLeft: -4 }}
        ><Icon kind="drag" size={15} /></span>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: T.accent }}>
          Select mode
        </span>
        {!isMobile && (
          <span style={{ fontSize: 11, color: T.textFaint }}>
            click issues / epics / days to add · esc to exit
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, fontFamily: T.fontMono, color: T.textMuted }}>{selection.length} selected</span>
        <button onClick={() => setMinimized(true)} title="minimize" style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: T.textMuted, display: 'inline-flex', padding: 2,
        }}><Icon kind="minimize" size={15} /></button>
      </div>
      {selection.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 96, overflowY: 'auto' }}>
          {selection.map((s, i) => (
            <span key={i} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 11, fontFamily: T.fontMono,
              background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 999,
              padding: '2px 8px',
            }}>
              <span style={{ color: T.textFaint }}>{s.kind}</span>
              {/* A checklist item's own text is what identifies it — s.label is
                  its parent issue, so leading with that made every item picked
                  from one list render as the same chip. */}
              <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.text || s.label || s.id || s.slug || s.date}
              </span>
              <button onClick={() => onRemove(s)} style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: T.textMuted, fontSize: 11, padding: 0, lineHeight: 1,
              }}>✕</button>
            </span>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {onNewFromSelection && (
          <button
            onClick={onNewFromSelection}
            disabled={!selection.length}
            title="open the create menu with the picked time / issue carried over"
            style={{
              background: selection.length ? T.accent : T.surface2,
              color: selection.length ? '#fff' : T.textFaint,
              border: 'none', borderRadius: 6, padding: '7px 14px',
              fontFamily: T.fontBody, fontSize: 12, fontWeight: 600,
              cursor: selection.length ? 'pointer' : 'default',
            }}
          >＋ New</button>
        )}
        <button
          onClick={onOpenChat}
          disabled={!selection.length}
          style={{
            background: selection.length ? T.text : T.surface2,
            color: selection.length ? '#fff' : T.textFaint,
            border: 'none', borderRadius: 6, padding: '7px 14px',
            fontFamily: T.fontBody, fontSize: 12, fontWeight: 500,
            cursor: selection.length ? 'pointer' : 'default',
          }}
        >{isMobile ? 'Open chat' : 'Open chat with selection'}</button>
        <button
          onClick={async () => { await onCopy(); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
          disabled={!selection.length}
          style={{
            background: 'transparent', color: selection.length ? T.text : T.textFaint,
            border: `1px solid ${T.border}`, borderRadius: 6, padding: '7px 14px',
            fontFamily: T.fontBody, fontSize: 12, fontWeight: 500,
            cursor: selection.length ? 'pointer' : 'default',
          }}
        >{copied ? '✓ copied' : 'Copy'}</button>
        {onMove && (
          <div style={{ position: 'relative' }}>
            <button
              onClick={toggleMove}
              disabled={!movable}
              title={movable ? 'move the selected items into a folder' : 'select items first'}
              style={{
                background: 'transparent', color: movable ? T.text : T.textFaint,
                border: `1px solid ${T.border}`, borderRadius: 6, padding: '7px 14px',
                fontFamily: T.fontBody, fontSize: 12, fontWeight: 500,
                cursor: movable ? 'pointer' : 'default',
              }}
            >{isMobile ? `Move${movable ? ` ${movable}` : ''}` : `Move ${movable || ''} to folder…`}</button>
            {moveOpen && movable > 0 && (
              <div style={{
                position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, zIndex: 5,
                width: 'min(320px, 80vw)', maxHeight: 260, overflowY: 'auto',
                background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10,
                boxShadow: T.shadowLg, padding: 4,
              }}>
                <div style={{ fontSize: 10, fontFamily: T.fontMono, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '0.1em', padding: '6px 8px 4px' }}>
                  Move {movable} item{movable === 1 ? '' : 's'} to…
                </div>
                {epicList.length === 0 && <div style={{ fontSize: 12, color: T.textFaint, padding: '6px 8px' }}>loading folders…</div>}
                {epicList.map(slug => (
                  <button
                    key={slug}
                    onClick={() => { setMoveOpen(false); onMove(slug); }}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      background: 'transparent', border: 'none', borderRadius: 6, cursor: 'pointer',
                      padding: '9px 10px', minHeight: 40,
                      fontFamily: T.fontMono, fontSize: 12, color: T.text,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = T.surfaceHover; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                  >{slug}</button>
                ))}
              </div>
            )}
          </div>
        )}
        <span style={{ flex: 1 }} />
        <button onClick={onClear} style={{
          background: 'transparent', border: 'none', color: T.textMuted,
          fontFamily: T.fontBody, fontSize: 12, cursor: 'pointer',
          textDecoration: 'underline', textUnderlineOffset: 2,
        }}>clear</button>
        <button onClick={onExit} style={{
          background: 'transparent', border: `1px solid ${T.border}`, borderRadius: 6,
          color: T.text, fontFamily: T.fontBody, fontSize: 12, padding: '7px 12px', cursor: 'pointer',
        }}>Done</button>
      </div>
    </div>
  );
}

// Desktop primary navigation, shown inside the top bar. Phones keep the
// pill switcher under the header (more tabs, one view at a time).
const DESKTOP_TABS = [
  { id: 'overview', label: 'Today' },
  { id: 'feed', label: 'Feed' },
  { id: 'projects', label: 'Board' },
  { id: 'brain', label: 'Brain' },
];
// Phones: a bottom tab bar, one view at a time.
const MOBILE_TABS = [
  { id: 'today', label: 'Today', icon: 'nav-today' },
  { id: 'feed', label: 'Feed', icon: 'nav-feed' },
  { id: 'plan', label: 'Plan', icon: 'event' },
  { id: 'issues', label: 'Lists', icon: 'nav-list' },
  { id: 'brain', label: 'Brain', icon: 'nav-brain' },
];

function Header({ todayDate, onAsk, onArchive, onNew, onSettings, selectMode, onToggleSelect, onRefresh, sticky = true, tabs, activeTab, onTab }) {
  const [refreshing, setRefreshing] = aUseState(false);
  const doRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try { await onRefresh?.(); } finally { setTimeout(() => setRefreshing(false), 500); }
  };
  const isMobile = useIsMobile();
  // Show the logout entry only when the server actually enforces logins.
  const [loginRequired, setLoginRequired] = aUseState(false);
  const [menuOpen, setMenuOpen] = aUseState(false);
  aUseEffect(() => {
    fetch('/api/healthz').then(r => r.json()).then(j => setLoginRequired(!!j.login_required)).catch(() => {});
  }, []);
  // Close the overflow menu on any outside click.
  aUseEffect(() => {
    if (!menuOpen) return;
    const onDoc = () => setMenuOpen(false);
    window.addEventListener('click', onDoc);
    return () => window.removeEventListener('click', onDoc);
  }, [menuOpen]);

  // Icon-first nav buttons: icon + label on desktop, icon-only on mobile.
  const navBtn = (icon, label, onClick, opts = {}) => (
    <button
      onClick={onClick}
      title={opts.title || label}
      style={{
        background: opts.primary ? T.accent : (opts.dark ? T.text : (opts.active ? T.accent : 'transparent')),
        color: (opts.primary || opts.dark || opts.active) ? '#fff' : T.textMuted,
        border: (opts.primary || opts.dark) ? 'none' : `1px solid ${opts.active ? T.accent : T.border}`,
        padding: isMobile ? '8px 10px' : '7px 12px',
        fontFamily: T.fontBody, fontSize: 13, fontWeight: opts.primary ? 600 : 500,
        borderRadius: 6, cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', gap: 6,
        lineHeight: 1,
      }}
    >
      <Icon kind={icon} size={16} />
      {!isMobile && <span>{label}</span>}
    </button>
  );

  const logout = async () => {
    try { await fetch('/api/logout', { method: 'POST' }); } catch {}
    window.location.href = '/login';
  };

  const menuItem = (icon, label, onClick) => (
    <button
      onClick={() => { setMenuOpen(false); onClick(); }}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
        padding: '11px 14px', background: 'transparent', border: 'none',
        cursor: 'pointer', textAlign: 'left',
        fontFamily: T.fontBody, fontSize: 14, color: T.text,
      }}
      onMouseEnter={e => { e.currentTarget.style.background = T.surfaceHover; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{ color: T.textMuted, display: 'inline-flex' }}><Icon kind={icon} size={16} /></span>
      {label}
    </button>
  );

  return (
    <header style={{
      // Not sticky on the Feed: the feed takes the whole screen and the header scrolls away.
      position: sticky ? 'sticky' : 'relative', top: 0, zIndex: 50,
      background: 'rgba(250, 248, 244, 0.88)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      borderBottom: `1px solid ${T.border}`,
      padding: isMobile ? '10px 14px' : '14px 28px',
      display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 14,
    }}>
      <img
        src="/dashboard/logo.png"
        alt="todouz — back to top"
        title="back to top"
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        width={isMobile ? 30 : 36}
        height={isMobile ? 30 : 36}
        style={{ display: 'block', flexShrink: 0, borderRadius: isMobile ? 7 : 9, cursor: 'pointer' }}
      />
      {!isMobile && (
        <span style={{ fontFamily: T.fontDisplay, fontSize: 21, fontWeight: 600, letterSpacing: '-0.01em', color: T.text, marginRight: 10 }}>todouz</span>
      )}
      {!isMobile && tabs && (
        <nav aria-label="Primary" style={{ display: 'flex', alignItems: 'center', gap: 2, alignSelf: 'stretch' }}>
          {tabs.map(t => {
            const on = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => onTab?.(t.id)}
                aria-current={on ? 'page' : undefined}
                style={{
                  position: 'relative', alignSelf: 'stretch',
                  padding: '0 14px', background: 'transparent', border: 'none',
                  color: on ? T.text : T.textMuted,
                  fontFamily: T.fontBody, fontSize: 14, fontWeight: on ? 650 : 500,
                  cursor: 'pointer', borderRadius: 8,
                }}
                onMouseEnter={e => { if (!on) e.currentTarget.style.color = T.text; }}
                onMouseLeave={e => { if (!on) e.currentTarget.style.color = T.textMuted; }}
              >
                {t.label}
                <span style={{
                  position: 'absolute', left: 14, right: 14, bottom: -15, height: 2, borderRadius: 2,
                  background: on ? T.accent : 'transparent',
                }} />
              </button>
            );
          })}
        </nav>
      )}
      <div style={{ flex: 1 }} />
      <OfflineIndicator />
      <button
        onClick={doRefresh}
        title="Refresh — reload the latest data"
        aria-label="refresh"
        style={{
          background: 'transparent', border: `1px solid ${T.border}`,
          color: T.textMuted, padding: isMobile ? '8px 10px' : '7px 12px',
          borderRadius: 6, cursor: 'pointer', display: 'inline-flex', alignItems: 'center',
          lineHeight: 1,
        }}
      >
        <span style={{ display: 'inline-flex', animation: refreshing ? 'todouz-spin 0.5s linear' : 'none' }}>
          <Icon kind="refresh" size={16} />
        </span>
      </button>
      {navBtn('chat', 'Ask agent', onAsk, { dark: true, title: 'Ask agent (space)' })}
      {navBtn('plus', 'New', onNew, { primary: true, title: 'Create a folder, item, session or list' })}
      {/* Select stays top-level — it's the one chrome action used constantly. */}
      {navBtn(selectMode ? 'select-on' : 'select', selectMode ? 'Selecting…' : 'Select', onToggleSelect, {
        active: selectMode,
        title: 'select items, checklist items, folders or days into a clipboard you can copy or send to chat',
      })}
      {/* Everything else lives behind ⋯ so the bar stays quiet on a phone. */}
      <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
        {navBtn('more', 'More', () => setMenuOpen(o => !o), { title: 'more' })}
        {menuOpen && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 6px)', right: 0,
            minWidth: 176, background: T.surface,
            border: `1px solid ${T.border}`, borderRadius: 10,
            boxShadow: T.shadowLg, overflow: 'hidden', zIndex: 60,
            display: 'flex', flexDirection: 'column',
          }}>
            {menuItem('archive', 'Archive', onArchive)}
            {menuItem('settings', 'Settings', onSettings)}
            {loginRequired && menuItem('logout', 'Log out', logout)}
          </div>
        )}
      </div>
    </header>
  );
}

// ─── SettingsDrawer ───────────────────────────────────────────────────
// Surfaces the two ways to reach todouz's data from outside the app:
//  1. the HTTP API with the bearer key — a ready-to-paste brief you can drop
//     into any AI chat so it can manage your data via curl;
//  2. the local MCP server config for Claude Desktop / Code.
// VAPID public key (base64url) → Uint8Array for pushManager.subscribe.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// Reminder lead-time presets shared by the session + item editors. null = none.
const REMINDER_OPTS = [
  { v: '', label: 'No reminder' },
  { v: '5', label: '5 min before' },
  { v: '10', label: '10 min before' },
  { v: '30', label: '30 min before' },
  { v: '60', label: '1 hour before' },
  { v: '120', label: '2 hours before' },
  { v: '1440', label: '1 day before' },
];

// ─── account + user management (Settings) ─────────────────────────────
const jsonPost = async (url, body, method = 'POST') => {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  let j = {}; try { j = await r.json(); } catch {}
  return r.ok ? j : { ...j, error: j.error || `HTTP ${r.status}` };
};
const setInput = { flex: 1, minWidth: 0, background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 8, padding: '8px 10px', fontSize: 13, color: T.text, outline: 'none' };
const setBtn = (primary) => ({ background: primary ? T.accent : T.surface, color: primary ? '#fff' : T.text, border: primary ? 'none' : `1px solid ${T.border}`, borderRadius: 8, padding: '7px 12px', fontSize: 13, cursor: 'pointer', flexShrink: 0 });

// Your account: password, personal API keys (each acts as you, with your access).
function AccountSection({ me, onMe, onFreshKey, sectionLabel }) {
  const [cur, setCur] = aUseState(''); const [next, setNext] = aUseState('');
  const [keyName, setKeyName] = aUseState('');
  const [msg, setMsg] = aUseState('');
  if (!me) return null;
  if (!me.auth_enabled) return (
    <>
      <div style={sectionLabel}>Account</div>
      <div style={{ fontSize: 13, color: T.textMuted }}>Accounts are off on this install (no users configured), so everyone has full access. Set <code>TODOUZ_USERS</code> to turn on sign-in.</div>
      <div style={{ height: 1, background: T.border, margin: '18px 0' }} />
    </>
  );
  const changePw = async () => {
    setMsg('');
    const r = await jsonPost('/api/me/password', { current: cur, next });
    if (r.error) setMsg(r.error); else { setCur(''); setNext(''); setMsg('Password changed. Other devices are signed out.'); }
  };
  const newKey = async () => {
    setMsg('');
    const r = await jsonPost('/api/me/keys', { name: keyName.trim() || 'AI session' });
    if (r.error) return setMsg(r.error);
    setKeyName(''); onFreshKey(r.key); onMe();
  };
  const revoke = async (id) => {
    if (!confirm('Revoke this key? Anything using it stops working.')) return;
    const r = await jsonPost(`/api/me/keys/${id}`, {}, 'DELETE');
    if (r.error) setMsg(r.error); else onMe();
  };
  const signOutAll = async () => {
    if (!confirm('Sign out of todouz on every device, including this one?')) return;
    await jsonPost('/api/me/logout-all', {});
    location.href = '/login';
  };
  const viaKey = me.via !== 'session';
  return (
    <>
      <div style={sectionLabel}>Account</div>
      <div style={{ fontSize: 13, color: T.text, marginBottom: 10 }}>
        Signed in as <b>{me.username}</b> <span style={{ color: T.textFaint }}>· {me.role}</span>
      </div>
      {viaKey ? <div style={{ fontSize: 12, color: T.textMuted }}>Sign in with your password to change your account.</div> : (
        <>
          <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 4 }}>Change password (10+ characters)</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <input type="password" value={cur} onChange={e => setCur(e.target.value)} placeholder="current password" autoComplete="current-password" style={setInput} />
            <input type="password" value={next} onChange={e => setNext(e.target.value)} placeholder="new password" autoComplete="new-password" style={setInput} />
            <button disabled={!cur || next.length < 10} onClick={changePw} style={{ ...setBtn(true), opacity: (!cur || next.length < 10) ? 0.5 : 1 }}>Change</button>
          </div>

          <div style={{ fontSize: 12, color: T.textMuted, margin: '14px 0 4px' }}>Your API keys — give one to each AI session or script. A key acts as you and sees only what you can see.</div>
          {(me.keys || []).length === 0 && <div style={{ fontSize: 12, color: T.textFaint, fontStyle: 'italic', marginBottom: 6 }}>No keys yet.</div>}
          {(me.keys || []).map(k => (
            <div key={k.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: `1px solid ${T.border}`, fontSize: 13 }}>
              <b style={{ color: T.text }}>{k.name}</b>
              <code style={{ fontFamily: T.fontMono, fontSize: 11.5, color: T.textFaint }}>{k.prefix}…</code>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 11, color: T.textFaint }}>{k.last_used ? `used ${new Date(k.last_used).toLocaleDateString()}` : 'never used'}</span>
              <button onClick={() => revoke(k.id)} style={{ background: 'transparent', border: 'none', color: T.overdue, fontSize: 12, cursor: 'pointer' }}>Revoke</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <input value={keyName} onChange={e => setKeyName(e.target.value)} placeholder="name, e.g. claude-code-laptop" style={setInput} />
            <button onClick={newKey} style={setBtn(true)}>New key</button>
          </div>
          <button onClick={signOutAll} style={{ marginTop: 12, background: 'transparent', border: 'none', color: T.textMuted, fontSize: 12, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>Sign out everywhere</button>
        </>
      )}
      {msg && <div style={{ fontSize: 12, color: T.textMuted, marginTop: 8 }}>{msg}</div>}
      <div style={{ height: 1, background: T.border, margin: '18px 0' }} />
    </>
  );
}

// Admins: create people, reset passwords, change roles, disable or remove accounts.
function UsersSection({ me, sectionLabel }) {
  const [users, setUsers] = aUseState(null);
  const [draft, setDraft] = aUseState({ username: '', password: '', role: 'member' });
  const [msg, setMsg] = aUseState('');
  const load = async () => { const r = await (await fetch('/api/admin/users')).json().catch(() => ({})); if (r.ok) setUsers(r); };
  aUseEffect(() => { load(); }, []);
  if (!users) return null;
  const act = async (fn, ok) => { setMsg(''); const r = await fn(); if (r.error) setMsg(r.error); else { if (ok) setMsg(ok); load(); } };
  const create = () => act(() => jsonPost('/api/admin/users', draft), `Created ${draft.username}. Share the password with them privately; they can change it in Settings.`)
    .then(() => setDraft({ username: '', password: '', role: 'member' }));
  const reset = (u) => { const pw = prompt(`New password for ${u} (10+ characters):`); if (pw) act(() => jsonPost(`/api/admin/users/${u}`, { password: pw }, 'PATCH'), `Password reset for ${u}; their other sessions are signed out.`); };
  return (
    <>
      <div style={sectionLabel}>People</div>
      <div style={{ fontSize: 13, color: T.textMuted, marginBottom: 8 }}>
        Everyone has their own lists, calendar, Brain and feed. Only lists marked shared are visible to others. {users.signup_open ? 'Sign-up is open.' : 'Sign-up is closed (set TODOUZ_SIGNUP=open to allow it).'}
      </div>
      {users.users.map(u => (
        <div key={u.username} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: `1px solid ${T.border}`, fontSize: 13, flexWrap: 'wrap', opacity: u.disabled ? 0.55 : 1 }}>
          <b style={{ color: T.text }}>{u.username}</b>
          <select value={u.role} disabled={u.username === me.username} onChange={e => act(() => jsonPost(`/api/admin/users/${u.username}`, { role: e.target.value }, 'PATCH'))}
            style={{ fontSize: 12, background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 6, padding: '2px 4px', color: T.text }}>
            <option value="member">member</option><option value="admin">admin</option>
          </select>
          {u.disabled && <span style={{ fontSize: 11, color: T.overdue }}>disabled</span>}
          <span style={{ flex: 1 }} />
          <button onClick={() => reset(u.username)} style={{ background: 'transparent', border: 'none', color: T.textMuted, fontSize: 12, cursor: 'pointer' }}>Reset password</button>
          {u.username !== me.username && <>
            <button onClick={() => act(() => jsonPost(`/api/admin/users/${u.username}`, { disabled: !u.disabled }, 'PATCH'))} style={{ background: 'transparent', border: 'none', color: T.textMuted, fontSize: 12, cursor: 'pointer' }}>{u.disabled ? 'Enable' : 'Disable'}</button>
            <button onClick={() => { if (confirm(`Delete the account ${u.username}? Their data stays on the server.`)) act(() => jsonPost(`/api/admin/users/${u.username}`, {}, 'DELETE')); }} style={{ background: 'transparent', border: 'none', color: T.overdue, fontSize: 12, cursor: 'pointer' }}>Delete</button>
          </>}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <input value={draft.username} onChange={e => setDraft(d => ({ ...d, username: e.target.value.toLowerCase() }))} placeholder="username" autoComplete="off" style={setInput} />
        <input type="password" value={draft.password} onChange={e => setDraft(d => ({ ...d, password: e.target.value }))} placeholder="temporary password" autoComplete="new-password" style={setInput} />
        <select value={draft.role} onChange={e => setDraft(d => ({ ...d, role: e.target.value }))} style={{ ...setInput, flex: '0 0 auto' }}>
          <option value="member">member</option><option value="admin">admin</option>
        </select>
        <button disabled={!draft.username || draft.password.length < 10} onClick={create} style={{ ...setBtn(true), opacity: (!draft.username || draft.password.length < 10) ? 0.5 : 1 }}>Add person</button>
      </div>
      {msg && <div style={{ fontSize: 12, color: T.textMuted, marginTop: 8 }}>{msg}</div>}
      <div style={{ height: 1, background: T.border, margin: '18px 0' }} />
    </>
  );
}

function SettingsDrawer({ onClose, isMobile }) {
  const [me, setMe] = aUseState(null);
  const [freshKey, setFreshKey] = aUseState('');   // a just-created personal key, shown once
  const loadMe = () => fetch('/api/me').then(r => r.json()).then(d => { if (d.ok) setMe(d); }).catch(() => {});
  const [info, setInfo] = aUseState(null);
  const [reveal, setReveal] = aUseState(false);
  const [copied, setCopied] = aUseState('');
  const [autoRegen, setAutoRegen] = aUseState(() => { try { return localStorage.getItem('todouz.autoRegenHtml') !== '0'; } catch { return true; } });
  const [pushState, setPushState] = aUseState('unknown');   // unsupported | denied | off | on
  const [pushBusy, setPushBusy] = aUseState(false);
  const [pushMsg, setPushMsg] = aUseState('');
  // AI-agent mode (which model powers "Ask agent"): local Claude Code session
  // vs a user-supplied Anthropic API key. The key itself is never fetched back.
  const [agentCfg, setAgentCfg] = aUseState(null);
  const [agentBusy, setAgentBusy] = aUseState(false);
  const [agentMsg, setAgentMsg] = aUseState('');
  const [keyDraft, setKeyDraft] = aUseState('');
  const [modelDraft, setModelDraft] = aUseState({});
  // Routines (scheduled agent runs) and read-only connected sources.
  const [routines, setRoutines] = aUseState(null);
  const [routineEdit, setRoutineEdit] = aUseState(null);   // { name, schedule, web, prompt } being edited
  const [routineMsg, setRoutineMsg] = aUseState('');
  const [sources, setSources] = aUseState(null);
  const [srcKeyDraft, setSrcKeyDraft] = aUseState('');
  const [srcMsg, setSrcMsg] = aUseState('');
  const loadRoutines = async () => { try { const r = await (await fetch('/api/routines')).json(); if (r.ok) setRoutines(r); } catch {} };
  const loadSources = async () => { try { const r = await (await fetch('/api/sources')).json(); if (r.ok) setSources(r.sources); } catch {} };
  const isAdmin = !!me && (me.role === 'admin' || !me.auth_enabled);
  aUseEffect(() => { loadMe(); }, []);
  aUseEffect(() => { if (me && me.role === 'admin') { loadRoutines(); loadSources(); } }, [me?.role]);
  const routinePost = async (path, body, okMsg) => {
    setRoutineMsg('');
    try {
      const r = await (await fetch(`/api/routines/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
      if (r.error) setRoutineMsg(r.error); else if (okMsg) setRoutineMsg(okMsg);
      await loadRoutines();
      return r;
    } catch (e) { setRoutineMsg(String(e?.message || e)); }
  };
  const openRoutineEditor = async (name) => {
    try { const r = await (await fetch(`/api/routines/${name}`)).json(); if (r.ok) setRoutineEdit({ ...r.routine }); } catch {}
  };
  const saveSource = async (name, key) => {
    setSrcMsg('');
    try {
      const r = await (await fetch('/api/sources', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, key }) })).json();
      if (r.ok) { setSources(r.sources); setSrcKeyDraft(''); setSrcMsg(key ? 'Connected. Routines can now read it.' : 'Disconnected.'); }
      else setSrcMsg(r.error || 'Could not save.');
    } catch (e) { setSrcMsg(String(e?.message || e)); }
  };
  const whenLocal = (iso) => iso ? new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
  aUseEffect(() => {
    let alive = true;
    fetch('/api/settings').then(r => r.json()).then(d => { if (alive) setInfo(d); }).catch(() => {});
    fetch('/api/agent-config').then(r => r.json()).then(d => { if (alive && d.ok) { setAgentCfg(d); setModelDraft(d.models || {}); } }).catch(() => {});
    (async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) { if (alive) setPushState('unsupported'); return; }
      if (Notification.permission === 'denied') { if (alive) setPushState('denied'); return; }
      try { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); if (alive) setPushState(sub ? 'on' : 'off'); }
      catch { if (alive) setPushState('off'); }
    })();
    return () => { alive = false; };
  }, []);

  const enablePush = async () => {
    setPushBusy(true); setPushMsg('');
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) { setPushState('unsupported'); return; }
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setPushState(perm === 'denied' ? 'denied' : 'off'); setPushMsg('Permission not granted.'); return; }
      const reg = await navigator.serviceWorker.ready;
      const vr = await (await fetch('/api/push/vapid')).json();
      if (!vr.publicKey) { setPushMsg('Server push not ready — try again in a moment.'); return; }
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vr.publicKey) });
      const r = await (await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub }) })).json();
      if (r.ok || r.count != null) { setPushState('on'); setPushMsg('Reminders enabled on this device.'); }
      else setPushMsg(r.error || 'Could not subscribe.');
    } catch (e) { setPushMsg(String(e?.message || e)); }
    finally { setPushBusy(false); }
  };
  const disablePush = async () => {
    setPushBusy(true); setPushMsg('');
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) { await fetch('/api/push/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {}); await sub.unsubscribe().catch(() => {}); }
      setPushState('off'); setPushMsg('Reminders turned off on this device.');
    } catch (e) { setPushMsg(String(e?.message || e)); }
    finally { setPushBusy(false); }
  };
  const testPush = async () => {
    setPushMsg('sending…');
    try { const r = await (await fetch('/api/push/test', { method: 'POST' })).json(); setPushMsg(r.sent ? `Sent to ${r.sent} device(s).` : 'No subscribed devices to send to.'); }
    catch (e) { setPushMsg(String(e?.message || e)); }
  };
  const saveAgent = async (patch) => {
    setAgentBusy(true); setAgentMsg('');
    try {
      const r = await (await fetch('/api/agent-config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })).json();
      if (r.ok) {
        setAgentCfg(a => ({ ...a, mode: r.mode, models: r.models, anthropic_key_set: r.anthropic_key_set, _pending: undefined }));
        setModelDraft(r.models || {});
        setKeyDraft('');
        setAgentMsg('Saved.');
      } else setAgentMsg(r.error || 'Could not save.');
    } catch (e) { setAgentMsg(String(e?.message || e)); }
    finally { setAgentBusy(false); }
  };

  const base = info?.base_url || '';
  // Briefs carry YOUR key: the one you just created, else the install's admin key
  // (admins only), else a placeholder to paste a personal key into.
  const key = freshKey || info?.api_key || '<your API key — create one under Account>';
  const copy = (label, text) => {
    try { navigator.clipboard.writeText(text); setCopied(label); setTimeout(() => setCopied(''), 1600); } catch {}
  };

  const brief = `You can read, edit, reorganise, add AND delete items in my "todouz" life-OS through its HTTP API. You have full access — treat it as your own task board and help me keep it tidy.

Base URL: ${base}
Auth: send header  Authorization: Bearer ${key}  on every request.
Calls: POST ${base}/api/<tool>  with a JSON body (use {} when there are no args).

Common tools:
• list_epics {}                          – all lists/folders (gives epic_slug)
• list_issues {epic?, status?, query?}   – items (status: open|completed|all)
• get_issue {id, epic}                   – one item + its fields (+ app_url deep-link)
• create_issue {epic, title, due?, priority?, tags?, subtasks?, parent_issue_id?}
• update_issue {id, epic, patch:{...}}   – edit fields (title, due, priority, status, tags, parent_issue_id, description…)
• complete_issue {id, epic, summary}     – always pass a short summary of what was done
• delete_issue {id, epic, cascade?}      – permanently remove an item + its sub-items (prefer complete_issue w/ a "won't do" summary unless I say scrap/delete)
• move_issue {id, epic, target_epic}     – move an item to another list/folder
• delete_category {name} / create_category {name} – remove / add a whole list
• add_timeblock {date, start, end, title, issue_id?, epic_slug?}
• list_today {} / list_upcoming {days?}
• write_note {epic, id, markdown, html?}  – note: markdown source (+ optional HTML render)
• attach_image {epic, id, data, caption?, embed?} – upload a screenshot/image (base64 bytes) + embed it in the item body as markdown. Use embed:false to just get the ![](url) back and place it yourself. NEVER write "[screenshot here]" placeholders.
• brain_context / brain_search / brain_read / brain_write / brain_capture – my second brain (long-term notes about me, decisions, people, learnings). Call brain_context {topic} first for background; save durable knowledge there, tasks stay as items.

Always look up the exact epic_slug + id via list_epics / list_issues before editing.

Reorganising & follow-ups (please do this for me):
• Group loose to-dos under a top-level "action list" item, with the real work as sub-items (create_issue with parent_issue_id, or update_issue patch.parent_issue_id).
• In that top-level item's description, keep an "Action items" markdown table where each row LINKS to its sub-item so I can tap straight through. Use the item's app_url (returned by get_issue / create_issue), e.g.  [ISS-011 Draft the deck](${base}/dashboard/#issue=<epic_slug>/<id>) . Link by name, not by bare "ISS-##".
• Follow the issue-worklog skill for formatting + always leave a Work log entry when you touch an item.

Example:
curl -s ${base}/api/list_epics -X POST \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" -d '{}'`;

  // Bootstrap prompt for connecting any AI session to the second brain.
  const brainBrief = `You're connecting to my "second brain" — the long-term memory in my todouz app, shared by every AI session I use. Read it to get context on me; write back what's worth remembering.

Base URL: ${base}
Auth: header  Authorization: Bearer ${key}  on every request.
Calls: POST ${base}/api/<tool> with a JSON body.

1. START every session with:  brain_context {"topic": "<what we're working on>"}
   → my profile, roadmap, standing preferences, the most relevant notes, and an index of everything.
2. Look before you write:  brain_search {"query": "..."}  /  brain_read {"slug": "..."}
3. Save what's durable — decisions (and why), preferences, people, learnings, concepts, sources:
   brain_write {"title": "...", "type": "decision|preference|person|learning|concept|source|note", "body": "markdown", "tags": [...], "projects": ["category/folder"], "source": "<your session name>"}
   • One idea per note. Link related notes with [[slug]].
   • Add to an existing note with {"slug": "...", "mode": "append", "body": "..."} instead of duplicating it.
   • Maturity via "status": seed → growing → evergreen.
4. Not sure where something belongs? brain_capture {"text": "...", "source": "<your session name>"} → my Inbox.
5. Always set "source" to a short name for this session (e.g. "claude-code-laptop", "claude-ai", "chatgpt"). Every change is logged and I can revert it.

Tasks and to-dos belong in todouz items, not the brain.

Example:
curl -s ${base}/api/brain_context -X POST \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" -d '{"topic":"thesis"}'`;

  const curlExample = `curl -s ${base}/api/list_today -X POST \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" -d '{}'`;

  const mcpConfig = `{
  "mcpServers": {
    "todouz": {
      "command": "node",
      "args": ["/absolute/path/to/todouz/mcp-server/index.mjs"]
    }
  }
}`;

  const mono = { fontFamily: T.fontMono, fontSize: 12, lineHeight: 1.5 };
  const codeBox = {
    ...mono, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 8,
    padding: '12px 14px', margin: 0, color: T.text, overflowX: 'auto',
  };
  const copyBtn = (label, text) => (
    <button onClick={() => copy(label, text)} style={{
      background: T.text, color: '#fff', border: 'none', borderRadius: 8,
      padding: '6px 12px', fontFamily: T.fontBody, fontSize: 12, fontWeight: 500, cursor: 'pointer', flexShrink: 0,
    }}>{copied === label ? 'copied ✓' : 'copy'}</button>
  );
  const sectionLabel = { fontFamily: T.fontBody, fontSize: 11, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: T.textFaint, margin: '22px 0 8px' };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 250, background: 'rgba(26,23,20,0.4)', display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: isMobile ? '100%' : 'min(620px, 96vw)', height: '100%', background: T.bg,
        borderLeft: `1px solid ${T.border}`, boxShadow: T.shadowLg, display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
          <h2 style={{ fontFamily: T.fontDisplay, fontSize: 20, fontWeight: 600, margin: 0 }}>Settings</h2>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', fontSize: 20, color: T.textMuted, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 20px 40px' }}>
          <AccountSection me={me} onMe={loadMe} onFreshKey={setFreshKey} sectionLabel={sectionLabel} />
          {freshKey && (
            <div style={{ background: withAlpha(T.accent, 0.08), border: `1.5px solid ${T.accent}`, borderRadius: 10, padding: '10px 12px', margin: '-6px 0 18px' }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Your new key — copy it now, it won't be shown again</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <code style={{ fontFamily: T.fontMono, fontSize: 12, wordBreak: 'break-all', flex: 1 }}>{freshKey}</code>
                {copyBtn('fresh', freshKey)}
              </div>
              <div style={{ fontSize: 11, color: T.textFaint, marginTop: 6 }}>The briefs further down now include it.</div>
            </div>
          )}
          {me?.auth_enabled && me.role === 'admin' && <UsersSection me={me} sectionLabel={sectionLabel} />}
          <div style={sectionLabel}>Notifications</div>
          <div style={{ fontSize: 13, color: T.textMuted, marginBottom: 8 }}>
            Get a push reminder before a session or item — set a “remind me” lead time on any session or item, and it arrives even when todouz is closed.
          </div>
          {pushState === 'unsupported' ? (
            <div style={{ fontSize: 12, color: T.textMuted }}>Push isn’t available in this browser. On iPhone, add todouz to your Home Screen first (Share → Add to Home Screen), open it from there, then enable reminders.</div>
          ) : pushState === 'denied' ? (
            <div style={{ fontSize: 12, color: T.overdue }}>Notifications are blocked for todouz — allow them in your browser/OS settings, then reload.</div>
          ) : (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {pushState === 'on' ? (
                <>
                  <span style={{ fontSize: 13, color: T.done, fontWeight: 600 }}>✓ Reminders on (this device)</span>
                  <button onClick={testPush} disabled={pushBusy} style={{ background: T.surface, color: T.text, border: `1px solid ${T.border}`, borderRadius: 8, padding: '6px 12px', fontSize: 13, cursor: 'pointer' }}>Send test</button>
                  <button onClick={disablePush} disabled={pushBusy} style={{ background: 'transparent', color: T.textMuted, border: `1px solid ${T.border}`, borderRadius: 8, padding: '6px 12px', fontSize: 13, cursor: 'pointer' }}>Turn off</button>
                </>
              ) : (
                <button onClick={enablePush} disabled={pushBusy} style={{ background: T.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>{pushBusy ? 'Enabling…' : '🔔 Enable reminders on this device'}</button>
              )}
            </div>
          )}
          {pushMsg && <div style={{ fontSize: 12, color: T.textMuted, marginTop: 6 }}>{pushMsg}</div>}
          <div style={{ height: 1, background: T.border, margin: '18px 0' }} />

          {isAdmin && <>
          <div style={sectionLabel}>AI agent</div>
          {!agentCfg ? (
            <div style={{ fontSize: 12, color: T.textFaint, fontStyle: 'italic' }}>loading…</div>
          ) : (
            <div>
              <div style={{ fontSize: 13, color: T.textMuted, marginBottom: 10 }}>
                Which model powers <b>Ask agent</b>. Both modes drive the same todouz tools — only where it runs (and who's billed) changes.
              </div>
              {[
                ['local', 'Local Claude Code session', "This server's built-in Claude Code session (your subscription). No key needed."],
                ['anthropic', 'Anthropic API key', 'The same Claude agent, billed to your own Anthropic API key.'],
              ].map(([m, title, desc]) => {
                const active = agentCfg.mode === m;
                return (
                  <button key={m} disabled={agentBusy}
                    onClick={() => { if (m === 'anthropic' && !agentCfg.anthropic_key_set) setAgentCfg(a => ({ ...a, _pending: 'anthropic' })); else saveAgent({ mode: m }); }}
                    style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 8, cursor: 'pointer',
                      background: active ? withAlpha(T.accent, 0.08) : T.surface, border: `1.5px solid ${active ? T.accent : T.border}`, borderRadius: 10, padding: '10px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${active ? T.accent : T.borderStrong}`, background: active ? T.accent : 'transparent', flexShrink: 0 }} />
                      <span style={{ fontWeight: 600, fontSize: 14, color: T.text }}>{title}</span>
                      {m === 'anthropic' && agentCfg.anthropic_key_set && <span style={{ fontSize: 11, color: T.done }}>key on file ✓</span>}
                    </div>
                    <div style={{ fontSize: 12, color: T.textFaint, marginTop: 3, marginLeft: 22 }}>{desc}</div>
                  </button>
                );
              })}
              {(agentCfg.mode === 'anthropic' || agentCfg._pending === 'anthropic') && (
                <div style={{ margin: '4px 0 6px', paddingLeft: 2 }}>
                  <label style={{ fontSize: 12, color: T.textMuted, display: 'block', marginBottom: 4 }}>
                    Anthropic API key {agentCfg.anthropic_key_set && <span style={{ color: T.textFaint }}>(leave blank to keep the current key)</span>}
                  </label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input type="password" value={keyDraft} onChange={e => setKeyDraft(e.target.value)} autoComplete="off"
                      placeholder={agentCfg.anthropic_key_set ? '•••••••• saved' : 'sk-ant-…'}
                      style={{ flex: 1, minWidth: 0, background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 8, padding: '8px 10px', fontFamily: T.fontMono, fontSize: 13, color: T.text, outline: 'none' }} />
                    <button disabled={agentBusy || (!keyDraft.trim() && !agentCfg.anthropic_key_set)}
                      onClick={() => saveAgent({ mode: 'anthropic', ...(keyDraft.trim() ? { anthropic_key: keyDraft.trim() } : {}) })}
                      style={{ background: T.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer', flexShrink: 0 }}>Use API key</button>
                  </div>
                  {agentCfg.anthropic_key_set && (
                    <button onClick={() => saveAgent({ mode: 'local', anthropic_key: '' })} style={{ marginTop: 6, background: 'transparent', border: 'none', color: T.overdue, fontSize: 12, cursor: 'pointer', padding: 0 }}>Remove key &amp; use Local</button>
                  )}
                  <div style={{ fontSize: 11, color: T.textFaint, marginTop: 6 }}>Stored on your server only, never shown again. Get a key at console.anthropic.com.</div>
                </div>
              )}
              <div style={{ marginTop: 10 }}>
                <label style={{ fontSize: 12, color: T.textMuted, display: 'block', marginBottom: 4 }}>
                  Model <span style={{ color: T.textFaint }}>(blank = default: {agentCfg.defaults?.[agentCfg.mode]})</span>
                </label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input value={modelDraft[agentCfg.mode] || ''} onChange={e => setModelDraft(d => ({ ...d, [agentCfg.mode]: e.target.value }))}
                    placeholder={agentCfg.defaults?.[agentCfg.mode] || 'claude-sonnet-5'}
                    style={{ flex: 1, minWidth: 0, background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 8, padding: '8px 10px', fontFamily: T.fontMono, fontSize: 13, color: T.text, outline: 'none' }} />
                  <button disabled={agentBusy} onClick={() => saveAgent({ models: { [agentCfg.mode]: modelDraft[agentCfg.mode] || '' } })}
                    style={{ background: T.surface, color: T.text, border: `1px solid ${T.border}`, borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer', flexShrink: 0 }}>Save</button>
                </div>
              </div>
              {agentMsg && <div style={{ fontSize: 12, color: T.textMuted, marginTop: 8 }}>{agentMsg}</div>}
            </div>
          )}
          <div style={{ height: 1, background: T.border, margin: '18px 0' }} />

          <div style={sectionLabel}>Routines</div>
          <div style={{ fontSize: 13, color: T.textMuted, marginBottom: 10 }}>
            Scheduled runs on this server's Claude session (the AI agent mode above), in {routines?.tz || 'local'} time. They write your morning brief and the Feed. Each one is a markdown file you can edit.
          </div>
          {!routines ? <div style={{ fontSize: 12, color: T.textFaint, fontStyle: 'italic' }}>loading…</div> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {routines.routines.map(r => (
                <div key={r.name} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: '9px 12px', opacity: r.enabled ? 1 : 0.65 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }} title={r.enabled ? 'Turn off' : 'Turn on'}>
                      <input type="checkbox" checked={r.enabled} onChange={e => routinePost('save', { name: r.name, enabled: e.target.checked })} />
                      <b style={{ fontSize: 13.5, color: T.text }}>{r.title}</b>
                    </label>
                    <span style={{ fontSize: 11, color: T.textFaint, fontFamily: T.fontMono }}>{r.schedule}{r.web ? ' · web' : ''}</span>
                    <span style={{ flex: 1 }} />
                    {r.running ? <span style={{ fontSize: 12, color: T.accent }}>⏳ running</span>
                      : r.queued ? <span style={{ fontSize: 12, color: T.accent }}>queued</span>
                      : <button onClick={() => routinePost('run', { name: r.name }, `${r.title} started. Results appear in the Feed.`)} disabled={r.name === 'deep-dive'} title={r.name === 'deep-dive' ? 'Runs when you tap Deeper on a post' : 'Run now'}
                          style={{ background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 7, padding: '3px 10px', fontSize: 12, cursor: r.name === 'deep-dive' ? 'default' : 'pointer', color: T.text, opacity: r.name === 'deep-dive' ? 0.5 : 1 }}>Run now</button>}
                    <button onClick={() => routineEdit?.name === r.name ? setRoutineEdit(null) : openRoutineEditor(r.name)}
                      style={{ background: 'transparent', border: `1px solid ${T.border}`, borderRadius: 7, padding: '3px 10px', fontSize: 12, cursor: 'pointer', color: T.textMuted }}>{routineEdit?.name === r.name ? 'Close' : 'Edit'}</button>
                  </div>
                  <div style={{ fontSize: 11.5, color: T.textFaint, marginTop: 4 }}>
                    {r.next_run ? <>Next: {whenLocal(r.next_run)}</> : r.schedule === 'manual' ? 'Runs on request' : r.enabled ? '' : 'Off'}
                    {r.last_run && <> · Last: {whenLocal(r.last_run)} {r.last_status === 'ok' ? '✓' : r.last_status === 'error' ? <span style={{ color: T.overdue }} title={r.last_error || ''}>✕ {/login|authenticat|oauth/i.test(r.last_error || '') ? "Claude login on the server expired (see the Feed for the fix)" : String(r.last_error || '').slice(0, 80)}</span> : r.last_status === 'running' ? '⏳' : ''}</>}
                    {!r.schedule_valid && <span style={{ color: T.overdue }}> · schedule not understood</span>}
                  </div>
                  {routineEdit?.name === r.name && (
                    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <input value={routineEdit.schedule} onChange={e => setRoutineEdit(x => ({ ...x, schedule: e.target.value }))} placeholder="daily 06:30"
                          style={{ width: 170, background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 7, padding: '6px 8px', fontFamily: T.fontMono, fontSize: 12.5, color: T.text, outline: 'none' }} />
                        <label style={{ fontSize: 12, color: T.textMuted, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <input type="checkbox" checked={!!routineEdit.web} onChange={e => setRoutineEdit(x => ({ ...x, web: e.target.checked }))} /> can search the web
                        </label>
                        <span style={{ fontSize: 11, color: T.textFaint }}>daily 06:30 · weekdays 07:00 · weekly sun 18:00 · every 6h · manual</span>
                      </div>
                      <textarea value={routineEdit.prompt} onChange={e => setRoutineEdit(x => ({ ...x, prompt: e.target.value }))} rows={12} spellCheck={false}
                        style={{ width: '100%', boxSizing: 'border-box', background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 8, padding: 10, fontFamily: T.fontMono, fontSize: 12, color: T.text, outline: 'none', resize: 'vertical', lineHeight: 1.45 }} />
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={async () => { const res = await routinePost('save', { name: r.name, schedule: routineEdit.schedule, web: routineEdit.web, prompt: routineEdit.prompt }, 'Saved.'); if (res && res.ok) setRoutineEdit(null); }}
                          style={{ background: T.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 13, cursor: 'pointer' }}>Save</button>
                        <button onClick={() => setRoutineEdit(null)} style={{ background: 'transparent', border: `1px solid ${T.border}`, borderRadius: 8, padding: '6px 14px', fontSize: 13, cursor: 'pointer', color: T.textMuted }}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {routineMsg && <div style={{ fontSize: 12, color: T.textMuted, marginTop: 8 }}>{routineMsg}</div>}

          <div style={sectionLabel}>Connected sources</div>
          <div style={{ fontSize: 13, color: T.textMuted, marginBottom: 10 }}>
            Read-only access for routines and the agent, so your brief and Brain can draw on other workspaces. Nothing in a connected workspace can be changed from todouz.
          </div>
          {!sources ? <div style={{ fontSize: 12, color: T.textFaint, fontStyle: 'italic' }}>loading…</div> : Object.entries(sources).map(([name, s]) => (
            <div key={name} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <b style={{ fontSize: 13.5 }}>{s.label}</b>
                {s.connected ? <span style={{ fontSize: 12, color: T.done, fontWeight: 600 }}>✓ connected{s.key_from_env ? ' (from server environment)' : ''}</span> : <span style={{ fontSize: 12, color: T.textFaint }}>not connected</span>}
              </div>
              <div style={{ fontSize: 11, color: T.textFaint, fontFamily: T.fontMono, margin: '3px 0 8px' }}>{s.url}</div>
              {!s.key_from_env && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <input type="password" value={srcKeyDraft} onChange={e => setSrcKeyDraft(e.target.value)} autoComplete="off"
                    placeholder={s.connected ? '•••••••• saved — paste a new key to replace' : 'Paste the workspace API key'}
                    style={{ flex: 1, minWidth: 0, background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 8, padding: '7px 10px', fontFamily: T.fontMono, fontSize: 12.5, color: T.text, outline: 'none' }} />
                  <button disabled={!srcKeyDraft.trim()} onClick={() => saveSource(name, srcKeyDraft.trim())}
                    style={{ background: T.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '7px 12px', fontSize: 13, cursor: 'pointer', opacity: srcKeyDraft.trim() ? 1 : 0.5 }}>Connect</button>
                  {s.connected && <button onClick={() => saveSource(name, '')} style={{ background: 'transparent', border: `1px solid ${T.border}`, borderRadius: 8, padding: '7px 12px', fontSize: 13, cursor: 'pointer', color: T.overdue }}>Disconnect</button>}
                </div>
              )}
            </div>
          ))}
          {srcMsg && <div style={{ fontSize: 12, color: T.textMuted, marginTop: 8 }}>{srcMsg}</div>}
          <div style={{ height: 1, background: T.border, margin: '18px 0' }} />
          </>}

          <div style={sectionLabel}>Notes</div>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, color: T.text, cursor: 'pointer', padding: '4px 0' }}>
            <input
              type="checkbox"
              checked={autoRegen}
              onChange={e => { const v = e.target.checked; setAutoRegen(v); try { localStorage.setItem('todouz.autoRegenHtml', v ? '1' : '0'); } catch {} }}
              style={{ marginTop: 2 }}
            />
            <span>Auto-regenerate the HTML version when I edit a note's markdown
              <span style={{ display: 'block', fontSize: 11, color: T.textFaint, marginTop: 2 }}>Markdown is always the editable source. When this is off, editing markdown leaves any existing AI HTML version unchanged until you regenerate it (by selecting the item and asking the AI).</span>
            </span>
          </label>

          {!info ? (
            <div style={{ color: T.textFaint, fontStyle: 'italic', padding: '20px 0' }}>loading…</div>
          ) : (
            <>
              <p style={{ fontSize: 13, color: T.textMuted, marginTop: 16, marginBottom: 0 }}>
                Everything in todouz is reachable over a simple HTTP API. With your key, any script — or any AI chat — can read and edit your data (and only yours, plus shared lists).
              </p>

              {info.api_key && <>
              <div style={sectionLabel}>Install admin key</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <code style={{ ...codeBox, flex: 1, padding: '10px 12px' }}>{reveal ? info.api_key : '•'.repeat(Math.min(info.api_key.length, 48))}</code>
                <button onClick={() => setReveal(v => !v)} style={{ background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 8, padding: '6px 12px', fontFamily: T.fontBody, fontSize: 12, cursor: 'pointer', color: T.text, flexShrink: 0 }}>{reveal ? 'hide' : 'reveal'}</button>
                {copyBtn('key', info.api_key)}
              </div>
              <p style={{ fontSize: 11, color: T.textFaint, marginTop: 6 }}>Acts as {info.user || 'the owner'} with admin rights. Prefer a personal key (Account, above) for AI sessions; keep this one for backups and scripts.</p>
              </>}

              <div style={sectionLabel}>Connect an AI session to your Brain</div>
              <p style={{ fontSize: 12.5, color: T.textMuted, margin: '0 0 8px' }}>Paste this into Claude Code, claude.ai, ChatGPT — any session — and it will load your context from the Brain and build it out as you work. Each session names itself, so the Brain tab shows who wrote what.</p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>{copyBtn('brain', brainBrief)}</div>
              <pre style={codeBox}>{brainBrief}</pre>

              <div style={sectionLabel}>Paste into any AI chat</div>
              <p style={{ fontSize: 12.5, color: T.textMuted, margin: '0 0 8px' }}>Drop this brief into ChatGPT / Claude / etc. and it can manage your todouz data for you.</p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>{copyBtn('brief', brief)}</div>
              <pre style={codeBox}>{brief}</pre>

              <div style={sectionLabel}>Quick test (curl)</div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>{copyBtn('curl', curlExample)}</div>
              <pre style={codeBox}>{curlExample}</pre>

              <div style={sectionLabel}>Connect via MCP (Claude Desktop / Code)</div>
              <p style={{ fontSize: 12.5, color: T.textMuted, margin: '0 0 8px' }}>
                For a local checkout, add todouz as an MCP server so Claude can call its tools natively (needs local access to the <code style={mono}>data/</code> files). For a remote instance, use the API brief above instead.
              </p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>{copyBtn('mcp', mcpConfig)}</div>
              <pre style={codeBox}>{mcpConfig}</pre>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── IssuePicker ──────────────────────────────────────────────────────
// Searchable issue list with live filter. Filters by id / title / epic slug.
// Used inside NewItemModal to attach a sub-issue's parent, or a timeblock's issue.
function IssuePicker({ value, onChange, placeholder }) {
  const [q, setQ] = aUseState('');
  const [all, setAll] = aUseState(null);
  const [open, setOpen] = aUseState(false);

  aUseEffect(() => {
    api('list_issues', { status: 'open' })
      .then(r => setAll(r.issues || []))
      .catch(() => setAll([]));
  }, []);

  const filtered = aUseMemo(() => {
    if (!all) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return all.slice(0, 50);
    return all.filter(it => {
      const blob = `${it.id} ${it.title} ${it.epic_slug}`.toLowerCase();
      return blob.includes(needle);
    }).slice(0, 50);
  }, [all, q]);

  const selected = aUseMemo(() => {
    if (!value || !all) return null;
    return all.find(it => it.id === value.id && it.epic_slug === value.epic_slug);
  }, [value, all]);

  if (selected && !open) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 12px', borderRadius: 8,
        background: T.surface2, border: `1px solid ${T.border}`,
      }}>
        <span style={{ fontFamily: T.fontMono, fontSize: 11, color: T.textFaint }}>{selected.id}</span>
        <span style={{ fontSize: 12, color: T.textFaint }}>{selected.epic_slug}</span>
        <span style={{ flex: 1, fontSize: 13, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected.title}</span>
        <button onClick={() => { setOpen(true); setQ(''); }} style={{
          background: 'transparent', border: 'none', color: T.textMuted, fontSize: 11, cursor: 'pointer',
        }}>change</button>
        <button onClick={() => onChange(null)} style={{
          background: 'transparent', border: 'none', color: T.overdue, fontSize: 12, cursor: 'pointer',
        }}>✕</button>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <input
        autoFocus={!window.matchMedia('(max-width: 768px)').matches}
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder || 'search item by id, title, or folder…'}
        style={{
          width: '100%', boxSizing: 'border-box',
          background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 8,
          padding: '8px 12px', fontFamily: T.fontBody, fontSize: 13, color: T.text, outline: 'none',
        }}
      />
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
          background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8,
          boxShadow: T.shadowLg, zIndex: 230,
          maxHeight: window.matchMedia('(max-width: 768px)').matches ? 200 : 280,
          overflowY: 'auto',
        }}>
          {filtered.length === 0 && (
            <div style={{ padding: 12, fontSize: 12, color: T.textFaint, fontStyle: 'italic' }}>
              {all == null ? 'loading…' : 'no matches'}
            </div>
          )}
          {filtered.map(it => {
            const c = epicColor(it.epic_slug, it.epic_slug.split('/')[0]);
            return (
              <button
                key={it.epic_slug + ':' + it.id}
                onClick={() => { onChange({ id: it.id, epic_slug: it.epic_slug, title: it.title }); setOpen(false); setQ(''); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  width: '100%', padding: '8px 12px',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  textAlign: 'left',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = T.surfaceHover; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{
                  fontFamily: T.fontMono, fontSize: 10, color: c,
                  padding: '1px 6px', background: withAlpha(c, 0.08), borderRadius: 999, flexShrink: 0,
                }}>{it.epic_slug.split('/')[1]}</span>
                <span style={{ fontFamily: T.fontMono, fontSize: 10, color: T.textFaint, flexShrink: 0 }}>{it.id}</span>
                <span style={{
                  flex: 1, fontSize: 13, color: T.text,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{it.title}</span>
                {it.due && <span style={{ fontFamily: T.fontMono, fontSize: 11, color: T.textMuted }}>{it.due}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── NewItemModal ─────────────────────────────────────────────────────
// Unified create dialog. The user picks one of four types up front, then
// fills the relevant fields. Each branch maps to its existing MCP tool.
// Height of the on-screen keyboard (0 when closed), via the visualViewport API.
// Lets the sheet sit ABOVE the keyboard instead of behind it.
function useKeyboardInset() {
  const [kb, setKb] = aUseState({ inset: 0, availH: 0 });
  aUseEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const on = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setKb({ inset: inset > 60 ? inset : 0, availH: vv.height });
    };
    vv.addEventListener('resize', on);
    vv.addEventListener('scroll', on);
    on();
    return () => { vv.removeEventListener('resize', on); vv.removeEventListener('scroll', on); };
  }, []);
  return kb;
}

const KIND_META = {
  issue:     { icon: 'issue', label: 'Item',    title: 'New item',    blurb: 'A task or to-do' },
  timeblock: { icon: 'work',  label: 'Session', title: 'New session', blurb: 'A scheduled block of time' },
  subissue:  { icon: 'list',  label: 'Item',    title: 'New item',    blurb: 'A step under an existing item' },
  epic:      { icon: 'plan',  label: 'Folder',  title: 'New folder',  blurb: 'A project or grouping' },
  category:  { icon: 'today', label: 'List',    title: 'New list',    blurb: 'A top-level group' },
};

function NewItemModal({ initial = {}, onClose, onCreated }) {
  const prefill = initial.prefill || {};
  // Smart-add is a two-step wizard: pick WHAT to add, then fill the form. When
  // the caller already knows the kind (e.g. a day's "+ session"), skip straight
  // to the form.
  const [kind, setKind] = aUseState(initial.kind || null);
  const [step, setStep] = aUseState(initial.kind ? 'form' : 'choose');
  const [busy, setBusy] = aUseState(false);
  const [err, setErr] = aUseState(null);
  const { inset: kbInset, availH } = useKeyboardInset();
  const isMobile = window.matchMedia('(max-width: 768px)').matches;

  aUseEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      // Esc backs out of the form to the chooser first, then closes.
      if (step === 'form' && !initial.kind) { setStep('choose'); setErr(null); }
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, step, initial.kind]);

  const submitting = () => { setBusy(true); setErr(null); };
  const done = (result) => { setBusy(false); onCreated && onCreated(result || {}); };
  const fail = (e) => { setBusy(false); setErr(e?.message || String(e)); };
  const goBack = () => { setStep('choose'); setErr(null); };
  const pick = (k) => { setKind(k); setErr(null); setStep('form'); };

  // Human date for the context banner / card blurbs.
  const dateLabel = prefill.date ? (() => {
    try { return fmtLong(parseISODate(prefill.date)) + (prefill.time ? ` · ${prefill.time}` : ''); } catch { return prefill.date; }
  })() : null;

  // STABLE height: the sheet is the same size on every screen + every form, so
  // switching type never moves the header — which also killed the mid-tap
  // resize that let taps fall through to the page behind.
  const sheetStyle = isMobile ? {
    position: 'fixed', left: 0, right: 0, bottom: kbInset,
    width: '100%', boxSizing: 'border-box', background: T.surface,
    borderTop: `1px solid ${T.border}`, borderRadius: '16px 16px 0 0', boxShadow: T.shadowLg,
    zIndex: 221, display: 'flex', flexDirection: 'column',
    height: kbInset ? Math.max(300, availH - 8) : 'min(86dvh, 640px)',
    overflow: 'hidden',
  } : {
    position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
    width: 'min(560px, 92vw)', background: T.surface,
    border: `1px solid ${T.border}`, borderRadius: 12, boxShadow: T.shadowLg,
    zIndex: 221, display: 'flex', flexDirection: 'column',
    height: 'min(88vh, 640px)', overflow: 'hidden',
  };
  const headPad = isMobile ? '14px 16px 10px' : '20px 24px 12px';
  const bodyPad = isMobile ? '0 16px 16px' : '0 24px 20px';
  const meta = kind ? KIND_META[kind] : null;

  const chooserCard = (k, featured) => {
    const m = KIND_META[k];
    const blurb = k === 'issue' && dateLabel ? `Due ${dateLabel}`
      : k === 'timeblock' && dateLabel ? `Scheduled on ${dateLabel}`
      : m.blurb;
    return (
      <button key={k} onClick={() => pick(k)} style={{
        display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
        padding: '14px 14px', marginBottom: 8, borderRadius: 12, cursor: 'pointer',
        background: featured ? withAlpha(T.accent, 0.06) : T.surface,
        border: `1px solid ${featured ? withAlpha(T.accent, 0.4) : T.border}`,
      }}>
        <span style={{
          width: 40, height: 40, borderRadius: 10, flexShrink: 0,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: featured ? withAlpha(T.accent, 0.12) : T.surface2,
          color: featured ? T.accent : T.textMuted,
        }}><Icon kind={m.icon} size={20} /></span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: T.text }}>{m.label}</span>
          <span style={{ display: 'block', fontSize: 12, color: T.textMuted, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{blurb}</span>
        </span>
        <span style={{ color: T.textFaint, fontSize: 18 }}>›</span>
      </button>
    );
  };

  // Date context surfaces Item + Session first (the two things you'd add to a day).
  // Folders aren't in the global chooser — they're added contextually inside a
  // list ("+ add folder") where nesting is unambiguous.
  const order = ['issue', 'timeblock', 'category'];

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(26,23,20,0.32)', zIndex: 220 }} />
      <div style={sheetStyle} onClick={e => e.stopPropagation()}>
        {/* ── fixed head ── */}
        <div style={{ flexShrink: 0, padding: headPad }}>
          {isMobile && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: -4, marginBottom: 8 }}>
              <div style={{ width: 40, height: 4, borderRadius: 2, background: T.borderStrong }} />
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {step === 'form' && !initial.kind && (
              <button onClick={goBack} aria-label="back" style={{
                background: 'transparent', border: 'none', cursor: 'pointer', color: T.textMuted,
                fontSize: 20, lineHeight: 1, padding: 0,
                minWidth: 32, minHeight: 32, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}>‹</button>
            )}
            <h2 style={{ fontFamily: T.fontDisplay, fontSize: 22, fontWeight: 600, margin: 0 }}>
              {step === 'choose' ? 'Add' : (meta ? meta.title : 'New')}
            </h2>
            <span style={{ flex: 1 }} />
            {isMobile ? (
              <button onClick={onClose} aria-label="close" style={{
                background: 'transparent', border: 'none', fontSize: 20,
                color: T.textMuted, cursor: 'pointer', lineHeight: 1,
                minWidth: 36, minHeight: 36, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}>✕</button>
            ) : (
              <span style={{ fontSize: 11, color: T.textFaint, alignSelf: 'center' }}><kbd>esc</kbd> {step === 'form' && !initial.kind ? 'back' : 'close'}</span>
            )}
          </div>
          {/* Context banner — what this add is scoped to. */}
          {dateLabel && (
            <div style={{
              marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 12, color: T.accent, fontWeight: 500,
              background: withAlpha(T.accent, 0.08), padding: '4px 10px', borderRadius: 999,
            }}><Icon kind="event" size={13} /> {dateLabel}</div>
          )}
        </div>

        {/* ── scrolling body ── */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: bodyPad, minHeight: 0 }}>
          {step === 'choose' ? (
            <div style={{ paddingTop: 4 }}>
              {order.map((k, i) => chooserCard(k, !!dateLabel && (k === 'issue' || k === 'timeblock')))}
            </div>
          ) : (
            <>
              {kind === 'issue'     && <NewIssueForm prefill={prefill} busy={busy} onSubmit={submitting} onDone={done} onErr={fail} />}
              {kind === 'subissue'  && <NewSubissueForm prefill={prefill} busy={busy} onSubmit={submitting} onDone={done} onErr={fail} />}
              {kind === 'timeblock' && <NewTimeblockForm prefill={prefill} busy={busy} onSubmit={submitting} onDone={done} onErr={fail} />}
              {kind === 'epic'      && <NewEpicForm prefill={prefill} busy={busy} onSubmit={submitting} onDone={done} onErr={fail} />}
              {kind === 'category'  && <NewCategoryForm busy={busy} onSubmit={submitting} onDone={done} onErr={fail} />}
              {err && <div style={{ color: T.overdue, fontSize: 12, marginTop: 8 }}>{err}</div>}
            </>
          )}
        </div>
      </div>
    </>
  );
}

// Shared form layout helpers
function modalLabel() {
  return {
    display: 'block', fontFamily: T.fontBody, fontSize: 11, fontWeight: 600,
    letterSpacing: '0.10em', textTransform: 'uppercase',
    color: T.textFaint, marginBottom: 6, marginTop: 4,
  };
}
function modalInput() {
  return {
    // 16px min font: anything smaller makes iOS Safari zoom the page on focus,
    // which reads as the sheet "breaking". Consistent height + comfy padding so
    // every field in the Add menus is the same size and a proper tap target.
    // minWidth:0 is the fix for the time/priority "overlap": native <input
    // type=time/date> have a large intrinsic min-width (the picker spinner) that
    // overflows a 1fr grid track unless we let them shrink.
    width: '100%', minWidth: 0, maxWidth: '100%', boxSizing: 'border-box', display: 'block',
    background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 8,
    padding: '10px 12px', minHeight: 44, lineHeight: 1.4,
    fontFamily: T.fontMono, fontSize: 16, color: T.text,
    // Left-align the value. iOS centres native date/time inputs by default, so
    // the dates/times sat centred while every other field was left-aligned —
    // the actual iOS value is aligned via ::-webkit-date-and-time-value in CSS.
    textAlign: 'left',
    outline: 'none',
  };
}
function FormFooter({ primary, busy, onCancel }) {
  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  const btn = {
    flex: 1, boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    padding: isMobile ? '12px 16px' : '9px 18px', minHeight: isMobile ? 46 : 0,
    fontFamily: T.fontBody, fontSize: 15, borderRadius: 10, cursor: 'pointer', lineHeight: 1,
  };
  return (
    // A proper footer bar pinned to the bottom of the scrolling modal body:
    // full-width (edge-to-edge on mobile), Cancel + primary as an even pair of
    // equal-height buttons, with a top shadow so content clearly scrolls under it.
    <div style={{
      display: 'flex', gap: 10, alignItems: 'stretch',
      position: 'sticky', bottom: 0, zIndex: 2,
      background: T.surface, borderTop: `1px solid ${T.border}`,
      boxShadow: '0 -8px 14px -10px rgba(26,23,20,0.22)',
      margin: isMobile ? '16px -16px 0' : '16px 0 0',
      padding: isMobile ? '12px 16px calc(10px + env(safe-area-inset-bottom, 0px))' : '12px 0 2px',
    }}>
      <button type="button" onClick={onCancel} style={{
        ...btn, flex: 1, background: 'transparent', color: T.textMuted,
        border: `1px solid ${T.border}`, fontWeight: 500,
      }}>Cancel</button>
      <button type="submit" disabled={busy} style={{
        ...btn, flex: 2, background: T.text, color: '#fff', border: 'none', fontWeight: 600,
        cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.7 : 1,
      }}>{busy ? '…' : primary}</button>
    </div>
  );
}

// ─── Per-kind subforms ────────────────────────────────────────────────

// Minimal form: a category is just a folder under data/epics/. It shows up as
// an empty column in the by-epic view, ready for epics to be added or dragged in.
function NewCategoryForm({ busy, onSubmit, onDone, onErr }) {
  const [name, setName] = aUseState('');
  const submit = async () => {
    const n = name.trim().toLowerCase().replace(/\s+/g, '-');
    if (!n) return;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(n)) { onErr(new Error('lowercase letters/digits/dashes only')); return; }
    onSubmit();
    try {
      const r = await api('create_category', { name: n });
      if (r?.error) { onErr(new Error(r.error)); return; }
      onDone({});
    } catch (e) { onErr(e); }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <label style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>List name</label>
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
          placeholder="e.g. health, finance, travel"
          style={{
            width: '100%', boxSizing: 'border-box', marginTop: 6, minHeight: 44,
            background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 8,
            padding: '10px 12px', fontFamily: T.fontBody, fontSize: 16, color: T.text, outline: 'none',
          }}
        />
        <div style={{ fontSize: 11, color: T.textFaint, marginTop: 6 }}>
          Shows as an empty column — drag folders in or add new ones there.
        </div>
      </div>
      <div>
        <button onClick={submit} disabled={busy || !name.trim()} style={{
          background: name.trim() ? T.accent : T.surface2,
          color: name.trim() ? '#fff' : T.textFaint,
          border: 'none', borderRadius: 8, padding: '9px 18px',
          fontFamily: T.fontBody, fontSize: 13, fontWeight: 600,
          cursor: name.trim() ? 'pointer' : 'default',
        }}>{busy ? '…' : 'Create list'}</button>
      </div>
    </div>
  );
}

// Remember the epic you last created into, so +New doesn't reset to the
// alphabetical first (which was an archived subject).
const LAST_EPIC_KEY = 'todouz.lastEpic';

function NewIssueForm({ prefill, busy, onSubmit, onDone, onErr }) {
  const [epicSlug, setEpicSlug] = aUseState(prefill.epic_slug || '');
  const [epicOptions, setEpicOptions] = aUseState([]);
  const [title, setTitle] = aUseState('');
  const [type, setType] = aUseState('issue');       // issue | item | folder
  const [due, setDue] = aUseState(prefill.date || '');
  const [dueTime, setDueTime] = aUseState(prefill.time || '');
  const [priority, setPriority] = aUseState('medium');
  const [autoComplete, setAutoComplete] = aUseState(false);
  const [me, setMe] = aUseState('');   // current user → default assignee
  const isMobile = window.matchMedia('(max-width: 768px)').matches;

  aUseEffect(() => {
    fetch('/api/category-visibility').then(r => r.json()).then(j => setMe(j.user || '')).catch(() => {});
  }, []);

  aUseEffect(() => {
    api('list_epics').then(r => {
      // archived subjects sink to the bottom and never become the default.
      const all = (r.epics || []).filter(e => !e.recurring).map(e => e.slug);
      const active = all.filter(s => !s.startsWith('archive/')).sort();
      const archived = all.filter(s => s.startsWith('archive/')).sort();
      const list = [...active, ...archived];
      setEpicOptions(list);
      if (!epicSlug && list.length) {
        let remembered = '';
        try { remembered = localStorage.getItem(LAST_EPIC_KEY) || ''; } catch {}
        setEpicSlug(list.includes(remembered) ? remembered : (active[0] || list[0]));
      }
    });
  }, []); // eslint-disable-line

  const isFolder = type === 'folder';
  const submit = async (e) => {
    e.preventDefault();
    if (!epicSlug || !title.trim()) return onErr({ message: 'epic + title required' });
    onSubmit();
    try {
      const r = await api('create_issue', {
        epic: epicSlug,
        title: title.trim(),
        type,
        priority: isFolder ? undefined : priority,
        due: isFolder ? undefined : (due || undefined),
        due_time: (!isFolder && due && dueTime) ? dueTime : undefined,
        auto_complete: (!isFolder && autoComplete) ? true : undefined,
        assign_to: (!isFolder && me) ? [me] : undefined,   // default: assign to me (array — multi-assignee)
      });
      if (r.error) return onErr(r);
      try { localStorage.setItem(LAST_EPIC_KEY, epicSlug); } catch {}
      onDone({ openIssue: { id: r.id, epic_slug: epicSlug } });
    } catch (e) { onErr(e); }
  };

  return (
    <>
    <form onSubmit={submit}>
      <label style={modalLabel()}>Folder</label>
      <select value={epicSlug} onChange={e => setEpicSlug(e.target.value)} style={modalInput()}>
        {epicOptions.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
      <label style={modalLabel()}>Title</label>
      <input autoFocus value={title} onChange={e => setTitle(e.target.value)}
        placeholder={isFolder ? 'group name…' : 'what needs doing?'} style={modalInput()} />
      {!isFolder && (
        <>
          <label style={modalLabel()}>Due <span style={{ color: T.textFaint, fontWeight: 400 }}>(optional) — type it, or tap 📅 to pick against your schedule</span></label>
          <DateTimeField mode="datetime" date={due} time={dueTime}
            inputStyle={modalInput()}
            onChange={(p) => { if ('date' in p) setDue(p.date); if ('time' in p) setDueTime(p.time); }} />
          <label style={modalLabel()}>Priority</label>
          <select value={priority} onChange={e => setPriority(e.target.value)} style={modalInput()}>
            <option value="high">high</option>
            <option value="medium">medium</option>
            <option value="low">low</option>
          </select>
          <AutoCompleteToggle
            checked={autoComplete}
            onChange={setAutoComplete}
            hint="Marks itself done once its due date/time passes — for classes, appointments, anything you don't tick off. Needs a due date."
          />
        </>
      )}
      <FormFooter primary="Create item" busy={busy} onCancel={() => onDone(null)} />
    </form>
    </>
  );
}

// Shared toggle for "auto-complete when the time passes" (issue + session forms).
function AutoCompleteToggle({ checked, onChange, hint }) {
  return (
    <label style={{
      display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer',
      margin: '12px 0 4px', padding: '10px 12px',
      background: checked ? withAlpha(T.accent, 0.08) : T.surface2,
      border: `1px solid ${checked ? withAlpha(T.accent, 0.4) : T.border}`, borderRadius: 8,
    }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        style={{ width: 18, height: 18, marginTop: 1, accentColor: T.accent, flexShrink: 0 }} />
      <span style={{ fontSize: 13, color: T.text, lineHeight: 1.4 }}>
        Auto-complete when its time passes
        <span style={{ display: 'block', fontSize: 11, color: T.textMuted, marginTop: 2 }}>{hint}</span>
      </span>
    </label>
  );
}

function NewSubissueForm({ prefill, busy, onSubmit, onDone, onErr }) {
  const [parent, setParent] = aUseState(prefill.parent || null);
  const [title, setTitle] = aUseState('');
  const [due, setDue] = aUseState(prefill.date || '');
  const [dueTime, setDueTime] = aUseState(prefill.time || '');
  const [priority, setPriority] = aUseState('medium');

  const submit = async (e) => {
    e.preventDefault();
    if (!parent || !title.trim()) return onErr({ message: 'parent + title required' });
    onSubmit();
    try {
      const r = await api('create_subissue', {
        parent_issue_id: parent.id,
        parent_epic: parent.epic_slug,
        title: title.trim(),
        priority,
        due: due || undefined,
        due_time: (due && dueTime) ? dueTime : undefined,
      });
      if (r.error) return onErr(r);
      onDone({ openIssue: { id: r.id, epic_slug: parent.epic_slug } });
    } catch (e) { onErr(e); }
  };

  return (
    <form onSubmit={submit}>
      <label style={modalLabel()}>Parent item</label>
      <IssuePicker value={parent} onChange={setParent} placeholder="search the parent item…" />
      <label style={modalLabel()}>Title</label>
      <input value={title} onChange={e => setTitle(e.target.value)}
        placeholder="item title" style={modalInput()} />
      <label style={modalLabel()}>Due <span style={{ color: T.textFaint, fontWeight: 400 }}>(optional) — type it, or tap 📅 to pick against your schedule</span></label>
      <DateTimeField mode="datetime" date={due} time={dueTime}
        inputStyle={modalInput()}
        onChange={(p) => { if ('date' in p) setDue(p.date); if ('time' in p) setDueTime(p.time); }} />
      <label style={modalLabel()}>Priority</label>
      <select value={priority} onChange={e => setPriority(e.target.value)} style={modalInput()}>
        <option value="high">high</option>
        <option value="medium">medium</option>
        <option value="low">low</option>
      </select>
      <FormFooter primary="Create item" busy={busy} onCancel={() => onDone(null)} />
    </form>
  );
}

function NewTimeblockForm({ prefill, busy, onSubmit, onDone, onErr }) {
  const [issue, setIssue] = aUseState(prefill.linkIssue || null);
  const [title, setTitle] = aUseState('');
  const [date, setDate] = aUseState(prefill.date || fmtISO(new Date()));
  const [start, setStart] = aUseState(prefill.time || '09:00');
  const [end, setEnd] = aUseState(prefill.endTime
    ? prefill.endTime
    : prefill.time
      ? (() => { const [h, m] = prefill.time.split(':').map(Number); return `${String((h + 1) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`; })()
      : '12:00');
  const [note, setNote] = aUseState('');
  const [autoComplete, setAutoComplete] = aUseState(false);
  const [reminder, setReminder] = aUseState('');   // lead-time minutes before start
  // repeatWeeks > 1 → bulk-generate concrete blocks one week apart. No template concept.
  const [repeatWeeks, setRepeatWeeks] = aUseState(1);

  // When the user picks an issue, prefill the title from its title (only if blank)
  aUseEffect(() => {
    if (issue && !title) setTitle(issue.title || '');
  }, [issue]); // eslint-disable-line

  const submit = async (e) => {
    e.preventDefault();
    if (!date || !start || !end || (!title.trim() && !issue?.title)) {
      return onErr({ message: 'date, start, end, title required' });
    }
    onSubmit();
    try {
      const reps = Math.max(1, Math.min(52, Number(repeatWeeks) || 1));
      const r = await api('add_timeblock', {
        date, start, end,
        title: title.trim() || issue.title,
        note: note.trim() || undefined,
        issue_id: issue?.id || undefined,
        epic_slug: issue?.epic_slug || undefined,
        repeat_weeks: reps,
        auto_complete: autoComplete ? true : undefined,
        reminder: reminder ? Number(reminder) : undefined,
      });
      if (r.error) return onErr(r);
      onDone({});
    } catch (e) { onErr(e); }
  };

  return (
    <>
    <form onSubmit={submit}>
      <label style={modalLabel()}>Link to item <span style={{ color: T.textFaint, fontWeight: 400 }}>(optional)</span></label>
      <IssuePicker value={issue} onChange={setIssue} placeholder="search an issue to link…" />
      <label style={modalLabel()}>Title</label>
      <input value={title} onChange={e => setTitle(e.target.value)}
        placeholder={issue ? issue.title : 'what will you do?'} style={modalInput()} />
      <label style={modalLabel()}>When <span style={{ color: T.textFaint, fontWeight: 400 }}>— type it, or tap 📅 to pick against your schedule</span></label>
      <DateTimeField mode="session" date={date} start={start} end={end}
        inputStyle={modalInput()}
        onChange={(p) => { if ('date' in p) setDate(p.date); if ('start' in p) setStart(p.start); if ('end' in p) setEnd(p.end); }} />
      <label style={modalLabel()}>Repeat weekly <span style={{ color: T.textFaint, fontWeight: 400 }}>(creates independent blocks, one per week)</span></label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <input
          type="number" min={1} max={52}
          value={repeatWeeks}
          onChange={e => setRepeatWeeks(Math.max(1, Math.min(52, Number(e.target.value) || 1)))}
          style={{ ...modalInput(), width: 80 }}
        />
        <span style={{ fontSize: 12, color: T.textMuted }}>
          {repeatWeeks <= 1
            ? 'one block (no repeat)'
            : `→ ${repeatWeeks} blocks starting ${date}`}
        </span>
      </div>
      <AutoCompleteToggle
        checked={autoComplete}
        onChange={setAutoComplete}
        hint="Stops showing as an unfinished session once its end time passes — for classes, pilates, anything you attend but never tick off."
      />
      <label style={modalLabel()}>Remind me <span style={{ color: T.textFaint, fontWeight: 400 }}>(push notification before it starts)</span></label>
      <select value={reminder} onChange={e => setReminder(e.target.value)} style={modalInput()}>
        {REMINDER_OPTS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
      </select>
      <label style={modalLabel()}>Description <span style={{ color: T.textFaint, fontWeight: 400 }}>(optional)</span></label>
      <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
        placeholder="links, context, what to remember…"
        style={{ ...modalInput(), resize: 'vertical', fontFamily: T.fontBody }} />
      <FormFooter primary={repeatWeeks > 1 ? `Add ${repeatWeeks} blocks` : 'Add timeblock'} busy={busy} onCancel={() => onDone(null)} />
    </form>
    </>
  );
}

function NewEpicForm({ prefill, busy, onSubmit, onDone, onErr }) {
  const [category, setCategory] = aUseState(prefill.category || 'personal');
  const [slug, setSlug] = aUseState('');
  const [title, setTitle] = aUseState('');
  const [agent, setAgent] = aUseState('');
  // Category list comes from the live filesystem so the user can pick existing folders
  // OR type a brand new one. "+ new category…" surfaces a free-text input.
  const [knownCategories, setKnownCategories] = aUseState([]);
  const [creatingCategory, setCreatingCategory] = aUseState(false);

  aUseEffect(() => {
    api('list_categories').then(r => {
      const cats = r.categories || [];
      setKnownCategories(cats);
      if (!cats.includes(category) && cats.length) setCategory(cats[0]);
    });
  }, []); // eslint-disable-line

  aUseEffect(() => {
    if (!slug && title) {
      const s = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
      setSlug(s);
    }
  }, [title]); // eslint-disable-line

  const submit = async (e) => {
    e.preventDefault();
    if (!title.trim() || !slug.trim() || !category.trim()) return onErr({ message: 'title + slug + list required' });
    if (!/^[a-z0-9][a-z0-9-]*$/.test(category)) return onErr({ message: 'list must be lowercase letters/digits/dashes' });
    onSubmit();
    try {
      const r = await api('create_epic', {
        category: category.trim(), slug: slug.trim(), title: title.trim(),
        agent_owner: agent.trim() || undefined,
      });
      if (r.error) return onErr(r);
      onDone({ openEpicSlug: r.slug });
    } catch (e) { onErr(e); }
  };

  return (
    <form onSubmit={submit}>
      <label style={modalLabel()}>Title</label>
      <input autoFocus value={title} onChange={e => setTitle(e.target.value)}
        placeholder="e.g. Marathon training" style={modalInput()} />
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <label style={modalLabel()}>List</label>
          {creatingCategory ? (
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                autoFocus
                value={category}
                onChange={e => setCategory(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                placeholder="new-category"
                style={{ ...modalInput(), flex: 1 }}
              />
              <button
                type="button"
                onClick={() => { setCreatingCategory(false); setCategory(knownCategories[0] || 'personal'); }}
                style={{
                  background: 'transparent', border: `1px solid ${T.border}`, borderRadius: 8,
                  padding: '0 10px', color: T.textMuted, fontSize: 12, cursor: 'pointer',
                }}
              >pick existing</button>
            </div>
          ) : (
            <select
              value={category}
              onChange={e => {
                if (e.target.value === '__NEW__') { setCreatingCategory(true); setCategory(''); }
                else setCategory(e.target.value);
              }}
              style={modalInput()}
            >
              {knownCategories.map(c => <option key={c} value={c}>{c}</option>)}
              <option value="__NEW__">+ new list…</option>
            </select>
          )}
        </div>
        <div style={{ flex: 2 }}>
          <label style={modalLabel()}>Slug <span style={{ color: T.textFaint, fontWeight: 400 }}>(lowercase, no spaces)</span></label>
          <input value={slug} onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
            placeholder="e.g. marathon-2026" style={modalInput()} />
        </div>
      </div>
      <FormFooter primary="Create folder" busy={busy} onCancel={() => onDone(null)} />
    </form>
  );
}

Object.assign(window, { App });
