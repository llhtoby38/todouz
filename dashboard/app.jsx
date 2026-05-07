// app.jsx — single-page shell. No tabs. Vertical scroll. Two overlays (IssueDrawer + AgentsDrawer).

const { useState: aUseState, useEffect: aUseEffect, useCallback: aUseCallback } = React;

function App() {
  const data = useDashboardData();
  const [selectedIssue, setSelectedIssue] = aUseState(null);
  const [agentsLaunch, setAgentsLaunch] = aUseState(null);
  const [popoverDay, setPopoverDay] = aUseState(null);
  const [popoverBlock, setPopoverBlock] = aUseState(null);
  const [openEpicSlug, setOpenEpicSlug] = aUseState(null);
  const [archiveOpen, setArchiveOpen] = aUseState(false);

  const openAgents = aUseCallback((opts = {}) => {
    setAgentsLaunch({ agent: opts.agent || 'scheduler', seed: opts.seed || null, cardContext: opts.cardContext || null });
  }, []);

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
          // nested content (e.g. user clicked a span inside a contenteditable div)
          (typeof t.closest === 'function' && t.closest('input, textarea, select, [contenteditable="true"]'))
        );
      if (isEditable) {
        if (e.key === 'Escape') t.blur && t.blur();
        return;
      }
      // Ignore key combos with modifiers — those are application shortcuts, not hotkeys.
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === ' ') {
        e.preventDefault();
        openAgents();
      } else if (e.key === 'Escape') {
        setAgentsLaunch(null);
        setSelectedIssue(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openAgents]);

  if (data.loading) {
    return <div style={{ padding: 40, fontFamily: T.fontDisplay, fontSize: 18, fontWeight: 500, color: T.textMuted }}>loading…</div>;
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

  return (
    <div style={{ minHeight: '100vh', overflowX: 'hidden' }}>
      <Header
        todayDate={data.todayDate}
        onAsk={() => openAgents()}
        onArchive={() => setArchiveOpen(true)}
        onSettings={() => alert('settings: nothing yet — coming next')}
      />
      <main style={{ maxWidth: 1400, margin: '0 auto', padding: '12px 24px 60px', minWidth: 0 }}>
        <TodaySection data={data} onSelectIssue={setSelectedIssue} onRefresh={() => data.refetch()} onSelectBlock={setPopoverBlock} />
        <WeekStrip data={data} onSelectIssue={setSelectedIssue} onSelectDay={setPopoverDay} onSelectBlock={setPopoverBlock} />
        <EpicsGrid data={data} onSelectIssue={setSelectedIssue} onSelectEpic={(epic) => setOpenEpicSlug(epic.slug)} />
        <CalendarMonth data={data} onSelectIssue={setSelectedIssue} onSelectDay={setPopoverDay} onSelectBlock={setPopoverBlock} />
      </main>
      {selectedIssue && (
        <IssueDrawer
          issueRef={selectedIssue}
          onClose={() => setSelectedIssue(null)}
          onChanged={() => data.refetch()}
          onOpenAgents={(launch) => { setSelectedIssue(null); openAgents(launch); }}
          onSelectIssue={setSelectedIssue}
        />
      )}
      {openEpicSlug && (
        <EpicDrawer
          slug={openEpicSlug}
          onClose={() => setOpenEpicSlug(null)}
          onSelectIssue={(ref) => { setOpenEpicSlug(null); setSelectedIssue(ref); }}
          onChanged={() => data.refetch()}
        />
      )}
      {archiveOpen && (
        <ArchiveDrawer
          onClose={() => setArchiveOpen(false)}
          onSelectIssue={(ref) => { setSelectedIssue(ref); }}
        />
      )}
      {agentsLaunch && (
        <AgentsDrawer
          launch={agentsLaunch}
          onClose={() => setAgentsLaunch(null)}
          onFiles={() => data.refetch()}
        />
      )}
      {popoverDay && (
        <DayPopover
          date={popoverDay}
          onClose={() => setPopoverDay(null)}
          onSelectIssue={(ref) => { setPopoverDay(null); setSelectedIssue(ref); }}
          onTbAction={(id, action) => async () => {
            try {
              if (action === 'delete') await api('delete_timeblock', { id });
              if (action === 'complete') await api('complete_timeblock', { id });
              data.refetch();
            } catch {}
          }}
        />
      )}
      {popoverBlock && (
        <TimeblockPopover
          block={popoverBlock}
          onClose={() => setPopoverBlock(null)}
          onChanged={() => data.refetch()}
        />
      )}
    </div>
  );
}

function Header({ todayDate, onAsk, onArchive, onSettings }) {
  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 50,
      background: 'rgba(250, 248, 244, 0.85)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      borderBottom: `1px solid ${T.border}`,
      padding: '14px 28px',
      display: 'flex', alignItems: 'baseline', gap: 18,
    }}>
      <h1 style={{
        fontFamily: T.fontDisplay, fontSize: 26, margin: 0,
        fontWeight: 600, letterSpacing: '-0.02em',
        fontVariationSettings: '"opsz" 144, "SOFT" 50',
      }}>todouz</h1>
      <div style={{ fontSize: 13, color: T.textMuted, fontVariantNumeric: 'tabular-nums' }}>{fmtLong(todayDate)}</div>
      <div style={{ flex: 1 }} />
      <button onClick={onAsk} style={{
        background: T.text, color: '#fff', border: 'none',
        padding: '7px 14px', fontFamily: T.fontBody, fontSize: 13, fontWeight: 500,
        borderRadius: 6, cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', gap: 8,
      }}>
        <span>Ask agent</span>
        <kbd style={{
          background: 'rgba(255,255,255,0.16)', color: '#fff',
          padding: '1px 6px', borderRadius: 3, fontSize: 11,
          border: '1px solid rgba(255,255,255,0.18)',
          fontFamily: T.fontMono,
        }}>space</kbd>
      </button>
      <button onClick={onArchive} style={{
        background: 'transparent', color: T.textMuted,
        border: `1px solid ${T.border}`,
        padding: '7px 14px', fontFamily: T.fontBody, fontSize: 13, fontWeight: 500,
        borderRadius: 6, cursor: 'pointer',
      }}>Archive</button>
      <button onClick={onSettings} style={{
        background: 'transparent', color: T.textMuted,
        border: `1px solid ${T.border}`,
        padding: '7px 14px', fontFamily: T.fontBody, fontSize: 13, fontWeight: 500,
        borderRadius: 6, cursor: 'pointer',
      }}>Settings</button>
    </header>
  );
}

Object.assign(window, { App });
