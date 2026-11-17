// drawers.jsx — IssueDrawer (per-issue detail) + AgentsDrawer (universal chat surface).
// Both slide in from the right, overlay the page, dismiss on esc / click-outside.

const { useState: dUseState, useEffect: dUseEffect, useRef: dUseRef } = React;

// Download an attachment WITHOUT navigating the page. A plain <a href> to the
// download URL blanks the wrapped desktop app (it navigates the webview to a
// Content-Disposition:attachment response). Fetching the bytes into a blob and
// clicking a synthetic <a download> keeps the current page put.
async function downloadAttachmentFile(id, filename) {
  try {
    const r = await fetch(`/api/attachments/${id}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename || id;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (e) { alert('download failed: ' + (e?.message || e)); }
}

// iPhone photos arrive as HEIC, which browsers can't render in <img>. Convert to
// JPEG in the browser before upload (lazy-loading the converter only when needed),
// so attachments + embedded images actually display. Non-HEIC files pass through.
let _heic2anyPromise = null;
function loadHeic2any() {
  if (window.heic2any) return Promise.resolve(window.heic2any);
  if (!_heic2anyPromise) {
    _heic2anyPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';
      s.onload = () => resolve(window.heic2any);
      s.onerror = () => reject(new Error('could not load the HEIC converter'));
      document.head.appendChild(s);
    });
  }
  return _heic2anyPromise;
}
async function maybeConvertHeic(file) {
  const isHeic = /image\/hei[cf]/i.test(file.type || '') || /\.hei[cf]$/i.test(file.name || '');
  if (!isHeic) return file;
  try {
    const heic2any = await loadHeic2any();
    const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
    const blob = Array.isArray(out) ? out[0] : out;
    const name = (file.name || 'photo').replace(/\.hei[cf]$/i, '') + '.jpg';
    return new File([blob], name, { type: 'image/jpeg' });
  } catch (e) {
    // Conversion unavailable (offline / load failed) — upload the original so
    // nothing is lost; it just won't preview until re-uploaded online.
    console.warn('HEIC conversion failed, uploading original', e);
    return file;
  }
}

// ─── shared resizable-drawer helper ─────────────────────────────────
// Each drawer remembers its own width in localStorage under `todouz.drawer.<kind>.width`.
// Returns { width, dragHandle } — dragHandle is a JSX element you place on the left edge.
function useDrawerWidth(kind, { defaultWidth = 560, min = 360, max = null } = {}) {
  const storageKey = `todouz.drawer.${kind}.width`;
  const [width, setWidth] = dUseState(() => {
    try {
      const saved = parseInt(localStorage.getItem(storageKey) || '', 10);
      if (Number.isFinite(saved) && saved >= min) return saved;
    } catch {}
    return defaultWidth;
  });
  const draggingRef = dUseRef(false);

  dUseEffect(() => {
    const onMove = (e) => {
      if (!draggingRef.current) return;
      const cap = max != null ? max : (window.innerWidth - 60);
      const next = Math.max(min, Math.min(cap, window.innerWidth - e.clientX));
      setWidth(next);
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.userSelect = '';
      try { localStorage.setItem(storageKey, String(width)); } catch {}
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [width, min, max, storageKey]);

  const startDrag = (e) => {
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.userSelect = 'none';
  };

  // Thin invisible grab strip on the left edge of the drawer. 6px wide, full height.
  const isMobileNow = window.matchMedia('(max-width: 768px)').matches;
  const dragHandle = isMobileNow ? null : (
    <div
      onMouseDown={startDrag}
      title="drag to resize"
      style={{
        position: 'absolute', top: 0, bottom: 0, left: -3,
        width: 6, cursor: 'col-resize', zIndex: 5,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = withAlpha('#c2410c', 0.18); }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    />
  );

  return { width: isMobileNow ? window.innerWidth : width, dragHandle };
}

// ─── IssueDrawer ──────────────────────────────────────────────────────
// One toolbar button for the rich editor. mousedown-preventDefault keeps the
// editor's selection so the command applies to what you had selected.
function RichBtn({ label, active, onClick, title, wide }) {
  return (
    <button type="button" title={title} onMouseDown={e => e.preventDefault()} onClick={onClick}
      style={{
        minWidth: wide ? 'auto' : 32, height: 32, padding: '0 9px', flexShrink: 0,
        border: `1px solid ${active ? T.accent : T.border}`,
        background: active ? withAlpha(T.accent, 0.12) : T.surface,
        color: active ? T.accent : T.text, borderRadius: 7, cursor: 'pointer',
        fontFamily: T.fontBody, fontSize: 12.5, fontWeight: 600, lineHeight: 1,
      }}>{label}</button>
  );
}

// A live WYSIWYG editor for an item body. Markdown stays the source of truth:
// initialMarkdown is rendered to HTML (marked) to seed TipTap, and on save the
// editor HTML is turned back into markdown (turndown + gfm) — so existing files
// keep rendering unchanged. Pasting/dropping an image uploads it and inserts the
// picture live. Falls back to the raw textarea when TipTap isn't loaded.
function RichEditor({ initialMarkdown, onChange, onSave, onCancel, onRaw, uploadImage, isMobile }) {
  const holderRef = dUseRef(null);
  const editorRef = dUseRef(null);
  const imgInputRef = dUseRef(null);
  const changeTimer = dUseRef(null);
  const saveRef = dUseRef(null);
  const savedHtmlRef = dUseRef(null);   // preserves content across the fullscreen re-mount
  const [uploading, setUploading] = dUseState(0);
  const [fullscreen, setFullscreen] = dUseState(false);   // enlarge the editor to the whole window
  // In-editor view — 'rich' (TipTap), 'md' (raw markdown textarea), 'preview'
  // (rendered, read-only). Switchable in normal AND fullscreen, so you never
  // have to leave the editor to see or hand-edit the source.
  const [view, setView] = dUseState('rich');
  const [mdText, setMdText] = dUseState(initialMarkdown || '');
  const [, bump] = dUseState(0);

  // In full-screen, Escape exits the mode. A capture-phase listener runs before
  // the drawer's Escape, and a shared window flag makes the drawer ignore Escape
  // while we're fullscreen — so Escape closes fullscreen, not the whole drawer.
  dUseEffect(() => {
    window.__editorFullscreen = fullscreen;
    if (!fullscreen) return;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); setFullscreen(false); } };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); window.__editorFullscreen = false; };
  }, [fullscreen]);

  const toMarkdown = () => {
    const ed = editorRef.current; if (!ed || !window.TurndownService) return initialMarkdown || '';
    // Normalise TipTap's HTML so turndown emits clean markdown: its tables carry
    // <colgroup> + per-cell <p>/colspan/min-width that the GFM table rule won't
    // convert (it leaves the table as raw HTML). Strip those, and unwrap the lone
    // <p> inside list items, so tables/lists become real markdown.
    const div = document.createElement('div');
    div.innerHTML = ed.getHTML();
    div.querySelectorAll('colgroup').forEach(c => c.remove());
    div.querySelectorAll('table').forEach(t => t.removeAttribute('style'));
    div.querySelectorAll('td,th').forEach(cell => {
      cell.removeAttribute('colspan'); cell.removeAttribute('rowspan'); cell.removeAttribute('style');
      if (cell.children.length === 1 && cell.firstElementChild.tagName === 'P') cell.innerHTML = cell.firstElementChild.innerHTML;
    });
    div.querySelectorAll('li').forEach(li => { if (li.children.length === 1 && li.firstElementChild.tagName === 'P') li.firstElementChild.replaceWith(...li.firstElementChild.childNodes); });
    const td = new window.TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*', hr: '---' });
    if (window.TipTap && window.TipTap.gfm) { try { td.use(window.TipTap.gfm); } catch {} }
    return String(td.turndown(div.innerHTML) || '').trim();
  };
  // The current markdown regardless of which view is active (rich → serialise
  // TipTap; md/preview → the working text).
  const currentMarkdown = () => (view === 'rich' ? toMarkdown() : mdText);
  saveRef.current = () => onSave(currentMarkdown());   // kept fresh so the ⌘↵ shortcut isn't stale
  // Switch views without losing content. Leaving rich captures its markdown;
  // entering rich re-seeds TipTap from the (possibly hand-edited) markdown.
  const goView = (next) => {
    if (next === view) return;
    if (view === 'rich') { const md = toMarkdown(); setMdText(md); }        // rich → md/preview
    if (next === 'rich') { savedHtmlRef.current = (window.marked && window.marked.parse) ? window.marked.parse(mdText || '', { gfm: true, breaks: false }) : (mdText || ''); }
    setView(next);
  };
  const insertImageFile = async (file) => {
    if (!file || !(file.type || '').startsWith('image/') || !editorRef.current) return;
    if (file.size > 25 * 1024 * 1024) { alert('Image too large (max 25MB)'); return; }
    setUploading(u => u + 1);
    try {
      const r = await uploadImage(file);
      if (r && r.url) editorRef.current.chain().focus().setImage({ src: r.url, alt: file.name || 'image' }).run();
    } catch { /* upload failed — leave the editor untouched */ }
    setUploading(u => Math.max(0, u - 1));
  };

  dUseEffect(() => {
    const TT = window.TipTap;
    if (view !== 'rich' || !TT || !holderRef.current) return;   // only the rich view mounts TipTap
    // Toggling fullscreen re-mounts (the editor moves to/from a body-level portal
    // so it can escape the drawer's transform). Re-seed from the last HTML so no
    // content is lost across the switch; otherwise seed from the markdown.
    const html = savedHtmlRef.current != null
      ? savedHtmlRef.current
      : ((window.marked && window.marked.parse) ? window.marked.parse(initialMarkdown || '', { gfm: true, breaks: false }) : (initialMarkdown || ''));
    let editor;
    try {
      editor = new TT.Editor({
        element: holderRef.current,
        extensions: [
          TT.StarterKit,
          TT.Image.configure({ inline: false, allowBase64: false }),
          TT.Link.configure({ openOnClick: false, autolink: true }),
          TT.Table.configure({ resizable: false }),
          TT.TableRow, TT.TableHeader, TT.TableCell,
          TT.Placeholder.configure({ placeholder: 'Write here — headings, tables, lists… paste or drop an image to embed it.' }),
        ],
        content: html,
        editorProps: {
          attributes: { class: 'md' },
          handleKeyDown: (_view, event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); if (saveRef.current) saveRef.current(); return true; }
            return false;
          },
          handlePaste: (_view, event) => {
            const items = event.clipboardData && event.clipboardData.items;
            if (items) {
              const files = [];
              for (const it of items) if (it.kind === 'file' && (it.type || '').startsWith('image/')) { const f = it.getAsFile(); if (f) files.push(f); }
              if (files.length) { event.preventDefault(); files.forEach(insertImageFile); return true; }
            }
            return false;   // let TipTap parse pasted rich text (HTML) natively
          },
          handleDrop: (_view, event) => {
            const files = [...((event.dataTransfer && event.dataTransfer.files) || [])].filter(f => (f.type || '').startsWith('image/'));
            if (files.length) { event.preventDefault(); files.forEach(insertImageFile); return true; }
            return false;
          },
        },
        onTransaction: () => {
          bump(x => (x + 1) % 1e6);   // refresh toolbar active states
          if (onChange) { if (changeTimer.current) clearTimeout(changeTimer.current); changeTimer.current = setTimeout(() => { try { onChange(toMarkdown()); } catch {} }, 600); }
        },
      });
    } catch (e) { console.warn('TipTap init failed', e); return; }
    editorRef.current = editor;
    bump(x => x + 1);
    return () => { if (changeTimer.current) clearTimeout(changeTimer.current); try { savedHtmlRef.current = editor.getHTML(); } catch {} editor.destroy(); editorRef.current = null; };
  }, [fullscreen, view]); // eslint-disable-line — re-mount into/out of the fullscreen portal / view switch

  const ed = editorRef.current;
  const on = (n, a) => !!(ed && ed.isActive(n, a));
  const run = (fn) => { if (ed) fn(ed.chain().focus()).run(); };
  const inTable = on('table');

  const content = (
    <div className={fullscreen ? 'rich-fullscreen' : undefined}
      style={fullscreen ? { position: 'fixed', inset: 0, zIndex: 400, background: T.surface, padding: isMobile ? '10px 12px calc(10px + env(safe-area-inset-bottom,0px))' : '16px 24px', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' } : undefined}>
      {view === 'rich' && <div style={{ display: 'flex', gap: 4, flexWrap: isMobile ? 'nowrap' : 'wrap', overflowX: isMobile ? 'auto' : 'visible', WebkitOverflowScrolling: 'touch', paddingBottom: 6, flexShrink: 0 }}>
        <RichBtn label="H1" active={on('heading', { level: 1 })} onClick={() => run(c => c.toggleHeading({ level: 1 }))} title="Heading 1" />
        <RichBtn label="H2" active={on('heading', { level: 2 })} onClick={() => run(c => c.toggleHeading({ level: 2 }))} title="Heading 2" />
        <RichBtn label="H3" active={on('heading', { level: 3 })} onClick={() => run(c => c.toggleHeading({ level: 3 }))} title="Heading 3" />
        <RichBtn label="B" active={on('bold')} onClick={() => run(c => c.toggleBold())} title="Bold" />
        <RichBtn label={<span style={{ fontStyle: 'italic' }}>I</span>} active={on('italic')} onClick={() => run(c => c.toggleItalic())} title="Italic" />
        <RichBtn label={<span style={{ textDecoration: 'line-through' }}>S</span>} active={on('strike')} onClick={() => run(c => c.toggleStrike())} title="Strikethrough" />
        <RichBtn label="•" active={on('bulletList')} onClick={() => run(c => c.toggleBulletList())} title="Bullet list" />
        <RichBtn label="1." active={on('orderedList')} onClick={() => run(c => c.toggleOrderedList())} title="Numbered list" />
        <RichBtn label="❝" active={on('blockquote')} onClick={() => run(c => c.toggleBlockquote())} title="Quote" />
        <RichBtn label="‹›" active={on('codeBlock')} onClick={() => run(c => c.toggleCodeBlock())} title="Code block" />
        <RichBtn label="🔗" active={on('link')} onClick={() => { const url = window.prompt('Link URL (blank to remove):', ed && ed.getAttributes('link').href || ''); if (url == null) return; url ? run(c => c.extendMarkRange('link').setLink({ href: url })) : run(c => c.unsetLink()); }} title="Link" />
        <RichBtn label="▦" onClick={() => run(c => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }))} title="Insert table" />
        <RichBtn label="—" onClick={() => run(c => c.setHorizontalRule())} title="Divider" />
        <RichBtn label="🖼" onClick={() => imgInputRef.current && imgInputRef.current.click()} title="Insert image" />
        {inTable && <>
          <span style={{ width: 1, background: T.border, margin: '2px 3px', flexShrink: 0 }} />
          <RichBtn label="+row" wide onClick={() => run(c => c.addRowAfter())} title="Add row" />
          <RichBtn label="+col" wide onClick={() => run(c => c.addColumnAfter())} title="Add column" />
          <RichBtn label="−row" wide onClick={() => run(c => c.deleteRow())} title="Delete row" />
          <RichBtn label="−col" wide onClick={() => run(c => c.deleteColumn())} title="Delete column" />
          <RichBtn label="⌦tbl" wide onClick={() => run(c => c.deleteTable())} title="Delete table" />
        </>}
      </div>}
      {/* Rich view: TipTap mounts here. md/preview views hide it (kept mounted-then-destroyed by the effect). */}
      <div ref={holderRef} hidden={view !== 'rich'} style={fullscreen && view === 'rich' ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', marginBottom: 8 } : undefined} />
      {view === 'md' && (
        <textarea autoFocus value={mdText} onChange={e => { setMdText(e.target.value); if (onChange) onChange(e.target.value); }}
          onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); onSave(mdText); } }}
          spellCheck={false}
          style={{ width: '100%', boxSizing: 'border-box', flex: fullscreen ? 1 : undefined, minHeight: fullscreen ? 0 : 260,
            background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 8, padding: 12,
            fontFamily: T.fontMono, fontSize: 13, color: T.text, outline: 'none', resize: fullscreen ? 'none' : 'vertical', lineHeight: 1.5, marginBottom: 8 }} />
      )}
      {view === 'preview' && (
        <div style={{ flex: fullscreen ? 1 : undefined, minHeight: fullscreen ? 0 : 200, overflowY: 'auto', border: `1px solid ${T.border}`, borderRadius: 8, padding: '4px 14px', marginBottom: 8, background: T.surface }}>
          <Md text={mdText} />
        </div>
      )}
      <input ref={imgInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
        onChange={e => { [...(e.target.files || [])].forEach(insertImageFile); e.target.value = ''; }} />
      <div style={{ display: 'flex', gap: 6, marginTop: fullscreen ? 0 : 6, alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
        <button onClick={() => onSave(currentMarkdown())} style={primaryBtn(true)}>Save</button>
        <button onClick={onCancel} style={secondaryBtn()}>Cancel</button>
        {/* View switcher — works in normal AND fullscreen, so you can drop to raw
            markdown or a rendered preview without leaving the editor. */}
        <div style={{ display: 'inline-flex', gap: 2, background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 8, padding: 2 }}>
          {[['rich', 'Rich'], ['md', 'Markdown'], ['preview', 'Preview']].map(([k, lbl]) => (
            <button key={k} onClick={() => goView(k)} title={k === 'md' ? 'edit the raw markdown' : k === 'preview' ? 'rendered preview' : 'rich editor'}
              style={{ padding: '5px 10px', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: T.fontBody, fontSize: 12, fontWeight: view === k ? 600 : 500, background: view === k ? T.surface : 'transparent', color: view === k ? T.text : T.textMuted, boxShadow: view === k ? T.shadowSm : 'none' }}>{lbl}</button>
          ))}
        </div>
        <button onClick={() => setFullscreen(f => !f)} style={secondaryBtn()} title={fullscreen ? 'exit full screen (Esc)' : 'full-screen editor'}>{fullscreen ? '⤡ Exit' : '⛶ Full screen'}</button>
        {uploading > 0 && <span style={{ fontSize: 11, color: T.accent, alignSelf: 'center' }}>⏳ uploading {uploading}…</span>}
        <span style={{ flex: 1 }} />
        {!isMobile && <span style={{ fontSize: 11, color: T.textFaint, alignSelf: 'center' }}>paste images &amp; rich text · <kbd>⌘↵</kbd> save</span>}
      </div>
    </div>
  );
  // In fullscreen, portal to <body> so a transformed drawer ancestor can't clip
  // the position:fixed overlay to the drawer width.
  return fullscreen ? ReactDOM.createPortal(content, document.body) : content;
}

function IssueDrawer({ issueRef, onClose, onChanged, onSelectIssue, parentRef, selectMode, isSelected, onToggleSelect, onOpenChat }) {
  const headerOffset = useHeaderOffset();
  const isMobile = useIsMobile();
  const [full, setFull] = dUseState(null);
  const [loading, setLoading] = dUseState(true);
  const [busy, setBusy] = dUseState(false);
  const [editingDesc, setEditingDesc] = dUseState(false);
  const [descDraft, setDescDraft] = dUseState('');
  const [descFull, setDescFull] = dUseState(false);   // description → full-screen viewer
  const [genBusy, setGenBusy] = dUseState(false);     // HTML (re)generation in flight
  const [showMd, setShowMd] = dUseState(false);       // view the markdown source instead of the HTML render
  const [draftCached, setDraftCached] = dUseState(false); // ISS-007: unsaved markdown draft is cached in localStorage
  // Rich-paste into the markdown editor: paste/drop images (→ upload + embed) and
  // paste rich text (→ turned into markdown). Source stays markdown so existing
  // files render unchanged.
  const descRef = dUseRef(null);
  const uploadSeq = dUseRef(0);
  const [uploading, setUploading] = dUseState(0);       // in-flight image uploads
  const [descDragging, setDescDragging] = dUseState(false);
  const [copiedMd, setCopiedMd] = dUseState(false);
  // WYSIWYG editor: use TipTap when it's loaded; rawMode drops to the textarea.
  const [rawMode, setRawMode] = dUseState(false);
  const [tiptapReady, setTiptapReady] = dUseState(!!window.TipTap);
  dUseEffect(() => {
    if (window.TipTap) { setTiptapReady(true); return; }
    const on = () => setTiptapReady(true);
    window.addEventListener('tiptap-ready', on);
    return () => window.removeEventListener('tiptap-ready', on);
  }, []);
  // Upload one image → attachment, return its url for the editor to embed.
  const uploadImageAttachment = async (file) => {
    file = await maybeConvertHeic(file);   // HEIC → JPEG so pasted/attached photos render
    const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result || '')); r.onerror = rej; r.readAsDataURL(file); });
    const resp = await api('attach_image', { epic: full.epic_slug, id: full.id, data: dataUrl, filename: file.name || `pasted-${Date.now()}.png`, mime: file.type || 'image/png', embed: false });
    return { url: resp && resp.url, markdown: resp && resp.markdown };
  };
  const [propsOpen, setPropsOpen] = dUseState(true);   // Properties expanded by default
  const [editingTitle, setEditingTitle] = dUseState(false);
  const [titleDraft, setTitleDraft] = dUseState('');
  const titleTapRef = dUseRef(0);   // manual double-tap detection (touch)
  const startTitleEdit = () => { if (full && !full.error) { setTitleDraft(full.title); setEditingTitle(true); } };
  const onTitleTap = () => {
    const now = Date.now();
    if (now - titleTapRef.current < 300) { titleTapRef.current = 0; startTitleEdit(); }
    else titleTapRef.current = now;
  };
  const [showAddSubissue, setShowAddSubissue] = dUseState(false);
  const [subissueDraft, setSubissueDraft] = dUseState('');
  // When a planned-block row is clicked we open the TimeblockDrawer on top.
  // It stacks above the IssueDrawer (z-index handled inside TimeblockDrawer).
  const [openBlockId, setOpenBlockId] = dUseState(null);

  const [blocks, setBlocks] = dUseState([]);
  dUseEffect(() => {
    setLoading(true); setFull(null); setBlocks([]);
    setEditingDesc(false); setEditingTitle(false); setShowAddSubissue(false);
    Promise.all([
      api('get_issue', { id: issueRef.id, epic: issueRef.epic_slug }),
      // Must scope by epic_slug too — issue ids aren't globally unique (ISS-020), so
      // filtering by issue_id alone leaks blocks from another epic's same-ID issue.
      api('list_timeblocks', { issue_id: issueRef.id, epic_slug: issueRef.epic_slug }),
    ]).then(([f, tb]) => {
      setFull(f); setBlocks(tb.blocks || []); setLoading(false);
    }).catch(e => { setFull({ error: String(e) }); setLoading(false); });
  }, [issueRef?.id]);

  // ISS-007: cache the in-progress markdown edit so an accidental close or a
  // background refetch never loses it. Keyed per issue; cleared on save/cancel.
  const descKey = `todouz.desc.${issueRef?.epic_slug || ''}/${issueRef?.id || ''}`;
  dUseEffect(() => {
    try { setDraftCached(localStorage.getItem(descKey) != null); } catch { setDraftCached(false); }
  }, [descKey, full && full.id]);
  dUseEffect(() => {
    if (!editingDesc) return;
    try { localStorage.setItem(descKey, descDraft); setDraftCached(true); } catch {}
  }, [descDraft, editingDesc, descKey]);
  const clearDescDraft = () => { try { localStorage.removeItem(descKey); } catch {} setDraftCached(false); };
  const openDescEditor = () => {
    let cached = null; try { cached = localStorage.getItem(descKey); } catch {}
    setDescDraft(cached != null ? cached : ((full && full.description) || ''));
    setEditingDesc(true);
  };

  // ── rich paste / drop into the markdown editor ──
  // Insert text at the caret (or replace a unique token) inside the draft.
  const insertAtCursor = (text) => {
    const el = descRef.current;
    if (!el) { setDescDraft(d => d + text); return; }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    setDescDraft(d => d.slice(0, start) + text + d.slice(end));
    requestAnimationFrame(() => { try { el.focus(); el.selectionStart = el.selectionEnd = start + text.length; } catch {} });
  };
  // Upload one pasted/dropped image → attachment, then drop its ![](url) markdown
  // in at the caret. A placeholder token holds the spot while the upload runs.
  const uploadImageToDraft = (file) => {
    if (!full || !full.id) return;
    if (file.size > 25 * 1024 * 1024) { insertAtCursor('\n*(image too large — max 25MB)*\n'); return; }
    const token = `![uploading image ${++uploadSeq.current}…]()`;
    insertAtCursor(token);
    setUploading(u => u + 1);
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result || '');
      let md = '';
      try {
        const r = await api('attach_image', { epic: full.epic_slug, id: full.id, data: dataUrl, filename: file.name || `pasted-${Date.now()}.png`, mime: file.type || 'image/png', embed: false });
        md = (r && r.markdown) ? r.markdown : '';
      } catch {}
      setDescDraft(d => d.replace(token, md || '*(image upload failed — try again)*'));
      setUploading(u => Math.max(0, u - 1));
    };
    reader.onerror = () => { setDescDraft(d => d.replace(token, '*(could not read image)*')); setUploading(u => Math.max(0, u - 1)); };
    reader.readAsDataURL(file);
  };
  // Convert pasted rich text (text/html) to markdown, but only when it actually
  // carries formatting — a plain-text copy (which browsers still flag as html)
  // should paste as-is, not get mangled by the converter.
  const htmlToMarkdown = (html) => {
    if (!window.TurndownService) return null;
    if (!/<(h[1-6]|ul|ol|li|table|thead|tbody|tr|td|th|pre|code|blockquote|strong|b|em|i|a|img|hr|p)\b/i.test(html)) return null;
    try {
      const td = new window.TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*' });
      const md = String(td.turndown(html) || '').trim();
      return md || null;
    } catch { return null; }
  };
  const onDescPaste = (e) => {
    const cd = e.clipboardData;
    if (!cd) return;
    const imgs = [];
    for (const it of (cd.items || [])) {
      if (it.kind === 'file' && (it.type || '').startsWith('image/')) { const f = it.getAsFile(); if (f) imgs.push(f); }
    }
    if (imgs.length) { e.preventDefault(); imgs.forEach(uploadImageToDraft); return; }
    let html = ''; try { html = cd.getData('text/html'); } catch {}
    if (html && html.trim()) {
      const md = htmlToMarkdown(html);
      if (md != null) { e.preventDefault(); insertAtCursor(md); }
    }
  };
  const onDescDrop = (e) => {
    const imgs = [...((e.dataTransfer && e.dataTransfer.files) || [])].filter(f => (f.type || '').startsWith('image/'));
    if (imgs.length) { e.preventDefault(); setDescDragging(false); imgs.forEach(uploadImageToDraft); }
  };
  const onDescDragOver = (e) => { if (e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files')) { e.preventDefault(); if (!descDragging) setDescDragging(true); } };
  const copyMarkdown = async () => {
    try { await navigator.clipboard.writeText(descDraft); setCopiedMd(true); setTimeout(() => setCopiedMd(false), 1400); } catch {}
  };

  dUseEffect(() => {
    const onKey = e => { if (e.key === 'Escape') { if (window.__editorFullscreen) return; const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return; onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const refresh = async () => {
    try {
      const [j, tb] = await Promise.all([
        api('get_issue', { id: issueRef.id, epic: issueRef.epic_slug }),
        // Must scope by epic_slug too — issue ids aren't globally unique (ISS-020), so
      // filtering by issue_id alone leaks blocks from another epic's same-ID issue.
      api('list_timeblocks', { issue_id: issueRef.id, epic_slug: issueRef.epic_slug }),
      ]);
      setFull(j);
      setBlocks(tb.blocks || []);
      onChanged && onChanged();
    } catch {}
  };

  // Ask the AI (headless — no chat window) to (re)render the markdown as HTML.
  // On success the render is saved server-side and we refetch. `silent` skips the
  // error alert for background regeneration after a markdown save.
  const genHtml = async ({ silent } = {}) => {
    if (genBusy || !full) return;
    setGenBusy(true);
    try {
      const r = await fetch('/api/generate-html', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ epic: full.epic_slug, id: full.id }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error || r.statusText);
      await refresh();
    } catch (e) { if (!silent) alert('Generate HTML failed: ' + (e?.message || e)); }
    finally { setGenBusy(false); }
  };

  // Save the markdown edit. If the item already has an AI HTML render and the user
  // hasn't disabled auto-regenerate (Settings), queue a background regen so the
  // HTML tracks the edited source.
  const saveDesc = async (md) => {
    const finalMd = (typeof md === 'string') ? md : descDraft;
    const hadHtml = !!(full && full.description_html);
    await api('update_issue', { id: full.id, epic: full.epic_slug, patch: { description: finalMd } });
    setEditingDesc(false);
    setRawMode(false);
    clearDescDraft();
    await refresh();
    let autoRegen = true;
    try { autoRegen = localStorage.getItem('todouz.autoRegenHtml') !== '0'; } catch {}
    if (hadHtml && autoRegen) genHtml({ silent: true });
  };

  const completeBtn = async () => {
    if (!full || busy) return;
    setBusy(true);
    try {
      await api('complete_issue', { id: full.id, epic: full.epic_slug });
      await refresh();
    } finally { setBusy(false); }
  };

  // Pin / unpin — pinned items sit at the top of the Overview regardless of due.
  const togglePin = async () => {
    if (!full || full.error) return;
    const next = !full.fields?.pinned;
    await api('update_issue', { id: full.id, epic: full.epic_slug, patch: { pinned: next } });
    await refresh();
    onChanged && onChanged();   // refresh the Overview's Pinned section
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

  // Use the shared resizable-drawer helper so users can drag the left edge to widen.
  const { width: drawerWidth, dragHandle } = useDrawerWidth('issue', { defaultWidth: 560 });

  // Lock background scrolling while the item is open — the page behind the
  // drawer shouldn't move.
  dUseEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);
  // Swipe right to dismiss (touch) — a horizontal-dominant rightward flick past
  // ~80px closes the drawer, so you don't have to reach the ✕.
  const swipeRef = dUseRef(null);
  const onSwipeStart = (e) => { if (e.touches.length === 1) { const t = e.touches[0]; swipeRef.current = { x: t.clientX, y: t.clientY }; } };
  const onSwipeEnd = (e) => {
    const s = swipeRef.current; swipeRef.current = null;
    if (!s || !e.changedTouches[0]) return;
    const dx = e.changedTouches[0].clientX - s.x, dy = e.changedTouches[0].clientY - s.y;
    if (dx > 80 && Math.abs(dx) > Math.abs(dy) * 1.4) onClose();
  };

  if (!issueRef) return null;
  const c = full ? epicColor(full.epic_slug, full.epic_slug?.split('/')[0]) : T.textMuted;

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', top: headerOffset, right: 0, bottom: 0, left: 0, background: 'rgba(26,23,20,0.32)', zIndex: 200 }} />
      <aside
        onTouchStart={onSwipeStart}
        onTouchEnd={onSwipeEnd}
        style={{
          position: 'fixed', top: headerOffset, right: 0, bottom: 0,
          width: Math.min(drawerWidth, Math.round(window.innerWidth * (window.matchMedia('(max-width: 768px)').matches ? 1 : 0.95))),
          background: T.surface, borderLeft: `1px solid ${T.border}`,
          boxShadow: T.shadowLg,
          zIndex: 201,
          display: 'flex', flexDirection: 'column',
          animation: 'slidein 0.2s ease-out',
        }}>
        {dragHandle}
        <style>{`@keyframes slidein { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>
        <header style={{
          padding: '18px 22px 14px', borderBottom: `1px solid ${T.border}`,
          display: 'flex', alignItems: 'flex-start', gap: 10,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Full ancestor breadcrumb when this is a sub-issue (root → … → parent → this).
                Each crumb is clickable. Deep chains are rendered with the › separator. */}
            {full?.ancestors?.length > 0 && onSelectIssue && (
              <div style={{
                display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4,
                marginBottom: 6, fontFamily: T.fontBody, fontSize: 12, color: T.textMuted,
              }}>
                {full.ancestors.map((a, i) => (
                  <span key={a.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <button
                      onClick={() => onSelectIssue({ id: a.id, epic_slug: a.epic_slug })}
                      style={{
                        background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
                        color: T.textMuted, fontSize: 12, fontFamily: T.fontBody,
                      }}
                      title={`open ${a.id}`}
                    >
                      <span style={{ fontFamily: T.fontMono, color: T.textFaint, marginRight: 4 }}>{a.id}</span>
                      <span style={{ textDecoration: 'underline', textUnderlineOffset: 2 }}>{a.title}</span>
                    </button>
                    <span style={{ color: T.textFaint }}>›</span>
                  </span>
                ))}
              </div>
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
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  fontSize: 11, fontWeight: 700, color: '#fff',
                  background: T.done, padding: '3px 10px', borderRadius: 999, letterSpacing: '0.06em',
                }}>✓ DONE</span>
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
              <h2 onClick={onTitleTap} onDoubleClick={startTitleEdit} style={{
                fontFamily: T.fontDisplay, fontSize: 22, fontWeight: 600, lineHeight: 1.2,
                letterSpacing: '-0.015em', margin: 0,
                cursor: 'pointer',
                userSelect: 'text',
                // Strike-through when completed so the "done" state is unmistakable.
                textDecoration: full?.is_completed ? 'line-through' : 'none',
                color: full?.is_completed ? T.textMuted : (full?.error ? T.overdue : T.text),
              }} title="double-tap to edit">
                {full?.error
                  ? 'Item not found'
                  : (full?.title || (loading ? 'loading…' : 'not found'))}
              </h2>
            )}
            {full?.fields?.due && (
              <div style={{ fontSize: 13, color: T.textMuted, marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
                Due {formatDue(full.fields.due, full.fields.due_time)} · {(() => { const d = parseISODate(full.fields.due); if (!d) return ''; const days = diffDays(d, new Date()); return days === 0 ? 'today' : days < 0 ? `${Math.abs(days)}d overdue` : `in ${days}d`; })()}
              </div>
            )}
          </div>
          {full && !full.error && (
            <button onClick={togglePin} aria-label={full.fields?.pinned ? 'unpin' : 'pin'}
              title={full.fields?.pinned ? 'Unpin from top of Overview' : 'Pin to top of Overview'}
              style={{
                background: full.fields?.pinned ? withAlpha(T.accent, 0.12) : 'transparent',
                border: `1px solid ${full.fields?.pinned ? withAlpha(T.accent, 0.4) : T.border}`,
                color: full.fields?.pinned ? T.accent : T.textMuted, cursor: 'pointer',
                fontSize: 15, borderRadius: 8, padding: '4px 9px', lineHeight: 1, marginRight: 6,
                flexShrink: 0, minHeight: 32, filter: full.fields?.pinned ? 'none' : 'grayscale(1)',
              }}>📌</button>
          )}
          <button onClick={onClose} style={drawerCloseStyle(isMobile)} aria-label="close">✕</button>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Orphan state — the backend couldn't find the issue (it was deleted or
              moved + re-numbered) but the dashboard surfaced a reference to it.
              We can't load fields, but we CAN clean up timeblocks still pointing
              here so the row stops appearing. */}
          {full?.error && (
            <div style={{
              padding: 14, borderRadius: 8,
              background: withAlpha('#b45309', 0.06),
              border: `1px solid ${withAlpha('#b45309', 0.35)}`,
              fontSize: 13, color: T.text, lineHeight: 1.5,
            }}>
              <div style={{ fontFamily: T.fontMono, fontSize: 11, color: '#b45309', marginBottom: 6 }}>
                ⚠ orphan reference
              </div>
              The dashboard pointed at <span style={{ fontFamily: T.fontMono }}>{issueRef?.epic_slug}/{issueRef?.id}</span>,
              but no issue exists there. The most common cause: the issue was deleted
              or moved to a different epic, leaving stale rows behind.
              {blocks.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{blocks.length} timeblock{blocks.length === 1 ? '' : 's'} still link here:</div>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {blocks.map(b => (
                      <li key={b.id} style={{ fontSize: 12, color: T.textMuted, fontFamily: T.fontMono }}>
                        {b.date} {b.start}–{b.end} · {b.title}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {blocks.length === 0 && (
                <div style={{ marginTop: 6, fontSize: 12, color: T.textMuted }}>
                  No linked timeblocks — closing this drawer is enough.
                </div>
              )}
            </div>
          )}

          {/* Properties — collapsed by default to keep the view clean. Tap to
              reveal due / priority / assignee / tags; each edits inline. */}
          {full && !full.error && (
            <div>
              <button
                onClick={() => setPropsOpen(o => !o)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                  background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
                  fontFamily: T.fontBody, fontSize: 11, fontWeight: 600, letterSpacing: '0.12em',
                  textTransform: 'uppercase', color: T.textFaint,
                }}>
                <span style={{ display: 'inline-block', transform: propsOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.12s', fontSize: 10 }}>▸</span>
                Properties
                {(() => {
                  const asg = Array.isArray(full.fields?.assign_to) ? full.fields.assign_to : (full.fields?.assign_to ? [full.fields.assign_to] : []);
                  const bits = [full.fields?.due, full.fields?.priority, asg.length ? asg.join('+') : null, (full.fields?.tags||[]).length ? `${full.fields.tags.length} tag${full.fields.tags.length>1?'s':''}` : null].filter(Boolean);
                  return (!propsOpen && bits.length) ? (
                    <span style={{ letterSpacing: 0, textTransform: 'none', fontWeight: 400, color: T.textFaint, fontFamily: T.fontMono, fontSize: 11 }}>
                      {bits.join(' · ')}
                    </span>
                  ) : null;
                })()}
              </button>
              {propsOpen && (
                <div style={{ marginTop: 10 }}>
                  <MetaEditor issue={full} onChanged={refresh} />
                  {full.fields?.created && (() => {
                    const d = parseISODate(full.fields.created);
                    const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                    const nice = d ? `${d.getDate()} ${M[d.getMonth()]} ${d.getFullYear()}` : full.fields.created;
                    return <div style={{ marginTop: 10, fontSize: 11, color: T.textFaint, fontFamily: T.fontMono }}>Created {nice}</div>;
                  })()}
                </div>
              )}
            </div>
          )}

          {full && !full.error && (
            <Field label="Description" action={
              (full.description || full.description_html) && !editingDesc ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {genBusy && <span style={{ fontSize: 10, color: T.textFaint, fontStyle: 'italic', marginRight: 2 }}>✨ updating…</span>}
                  {draftCached && <span title="You have an unsaved draft — it loads when you tap edit" style={{ fontSize: 10, color: T.accent, marginRight: 2 }}>• draft</span>}
                  {/* Small toggle between the AI HTML render and the markdown source. */}
                  {full.description_html && (
                    <button
                      onClick={() => setShowMd(v => !v)}
                      title={showMd ? 'Show the HTML version' : 'Show the markdown source'}
                      style={{ background: 'transparent', border: `1px solid ${T.border}`, color: T.textMuted, cursor: 'pointer', fontSize: 10, padding: '2px 7px', lineHeight: 1.6, borderRadius: 999, fontFamily: T.fontMono }}
                    >{showMd ? '🖼 HTML' : 'M↓'}</button>
                  )}
                  <button
                    onClick={openDescEditor}
                    title="Edit the markdown source"
                    style={{ background: 'transparent', border: 'none', color: T.textMuted, cursor: 'pointer', fontSize: 13, padding: '2px 6px', lineHeight: 1, borderRadius: 6 }}
                  >✎</button>
                  <button
                    onClick={() => setDescFull(true)}
                    title="Expand description to full screen"
                    style={{ background: 'transparent', border: 'none', color: T.textMuted, cursor: 'pointer', fontSize: 15, padding: '2px 6px', lineHeight: 1, borderRadius: 6 }}
                  >⤢</button>
                </div>
              ) : null
            }>
              {editingDesc ? (
                (tiptapReady && !rawMode) ? (
                  <RichEditor
                    initialMarkdown={descDraft}
                    onChange={(md) => setDescDraft(md)}
                    onSave={(md) => saveDesc(md)}
                    onCancel={() => { setEditingDesc(false); setRawMode(false); clearDescDraft(); }}
                    onRaw={(md) => { setDescDraft(md); setRawMode(true); }}
                    uploadImage={uploadImageAttachment}
                    isMobile={isMobile}
                  />
                ) : (
                <>
                  <textarea
                    ref={descRef}
                    value={descDraft}
                    onChange={e => setDescDraft(e.target.value)}
                    onPaste={onDescPaste}
                    onDrop={onDescDrop}
                    onDragOver={onDescDragOver}
                    onDragLeave={() => setDescDragging(false)}
                    autoFocus
                    onKeyDown={async e => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        await saveDesc();
                      } else if (e.key === 'Escape') { setEditingDesc(false); clearDescDraft(); }
                    }}
                    rows={Math.min(20, Math.max(6, descDraft.split('\n').length + 1))}
                    style={{
                      width: '100%', boxSizing: 'border-box',
                      background: descDragging ? withAlpha(T.accent, 0.06) : T.surface2,
                      border: `1px ${descDragging ? 'dashed' : 'solid'} ${descDragging ? T.accent : T.border}`, borderRadius: 8,
                      padding: 12, fontFamily: T.fontMono, fontSize: 13, color: T.text,
                      outline: 'none', resize: 'vertical', lineHeight: 1.5,
                    }}
                  />
                  <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button onClick={() => saveDesc()} style={primaryBtn(true)}>Save</button>
                    <button onClick={() => { setEditingDesc(false); setRawMode(false); clearDescDraft(); }} style={secondaryBtn()}>Cancel</button>
                    <button onClick={copyMarkdown} style={secondaryBtn()} title="copy the raw markdown">{copiedMd ? 'Copied ✓' : 'Copy markdown'}</button>
                    {tiptapReady && <button onClick={() => setRawMode(false)} style={secondaryBtn()} title="switch to the live rich editor">◧ Rich editor</button>}
                    {uploading > 0 && <span style={{ fontSize: 11, color: T.accent, alignSelf: 'center' }}>⏳ uploading {uploading} image{uploading > 1 ? 's' : ''}…</span>}
                    <span style={{ flex: 1 }} />
                    {!window.matchMedia('(max-width: 768px)').matches && <span style={{ fontSize: 11, color: T.textFaint, alignSelf: 'center' }}>raw markdown · paste/drop images · <kbd>⌘↵</kbd> save · <kbd>esc</kbd> cancel</span>}
                  </div>
                </>
                )
              ) : (
                <div
                  onDoubleClick={openDescEditor}
                  onClick={() => { if (!full.description) openDescEditor(); }}
                  style={{ minHeight: 24, userSelect: 'text', cursor: full.description ? 'default' : 'text' }}
                  title="double-click to edit"
                >
                  {(full.description_html && !showMd) ? (
                    <HtmlDescription html={full.description_html} />
                  ) : full.description ? (
                    (!full.description_html && full.fields && full.fields.description_format === 'html')
                      ? <HtmlDescription html={full.description} />
                      : <Md text={full.description} />
                  ) : full.description_html ? (
                    <HtmlDescription html={full.description_html} />
                  ) : (
                    <div style={{ fontSize: 13, color: T.textFaint, fontStyle: 'italic' }}>+ add description (markdown supported)</div>
                  )}
                </div>
              )}
            </Field>
          )}

          {/* Related issues (e.g. the recipes a shopping list was built from).
              Placed above the checklist so the recipe card is one tap away while
              you're looking at the list, not buried under 31 items. */}
          {full && !full.error && (full.related || []).length > 0 && (
            <Field label={`Related${full.related.length > 1 ? ` (${full.related.length})` : ''}`}>
              {full.related.map(r => {
                const rc = epicColor(r.epic_slug, r.epic_slug?.split('/')[0]);
                return (
                  <div
                    key={`${r.epic_slug}/${r.id}`}
                    onClick={() => !r.missing && onSelectIssue && onSelectIssue({ id: r.id, epic_slug: r.epic_slug, title: r.title })}
                    role={r.missing ? undefined : 'button'}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: isMobile ? '10px 10px' : '8px 10px',
                      minHeight: isMobile ? 40 : 0,
                      marginBottom: 4,
                      background: T.surface,
                      border: `1px solid ${T.border}`,
                      borderLeft: `3px solid ${r.missing ? T.textFaint : rc}`,
                      borderRadius: 6,
                      cursor: r.missing ? 'default' : 'pointer',
                      opacity: r.missing ? 0.6 : (r.is_completed ? 0.55 : 1),
                    }}
                    onMouseEnter={e => { if (!r.missing) e.currentTarget.style.background = T.surfaceHover; }}
                    onMouseLeave={e => { e.currentTarget.style.background = T.surface; }}
                  >
                    <span style={{
                      fontFamily: T.fontMono, fontSize: 10, color: rc, flexShrink: 0,
                      padding: '1px 6px', background: withAlpha(rc, 0.08), borderRadius: 999,
                    }}>{r.epic_slug?.split('/')[1] || '?'}</span>
                    <span style={{
                      flex: 1, fontSize: isMobile ? 14 : 13, color: r.missing ? T.textFaint : T.text,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      textDecoration: r.is_completed ? 'line-through' : 'none',
                      fontStyle: r.missing ? 'italic' : 'normal',
                    }}>{r.missing ? `${r.title} (not found)` : r.title}</span>
                    {!r.missing && <span style={{ color: T.textFaint }}>→</span>}
                  </div>
                );
              })}
            </Field>
          )}

          {/* Attachments — files (lecture PDFs, etc.) + AI-generated notes linked
              to this item. Stored on disk under data/attachments/. */}
          {full && !full.error && (
            <IssueAttachments issue={full} isMobile={isMobile} onChanged={refresh} />
          )}

          {/* Checklist. This section was removed once on the theory that checklists
              would live as `- [ ]` lines in the description — but subtasks stayed
              first-class everywhere else (parser, serializer, add/toggle/update/
              delete_subtask), so the agent kept writing real subtasks that nothing
              rendered. A 31-item shopping list landed in that gap: stored, correct,
              and invisible. */}
          {full && !full.error && (
            <Field label={`Checklist${(full.subtasks || []).length ? ` (${full.subtasks.filter(x => !x.done).length} left of ${full.subtasks.length})` : ''}`}>
              {!(full.subtasks || []).length && (
                <div style={{ fontSize: 12, color: T.textFaint, fontStyle: 'italic', marginBottom: 6 }}>none yet</div>
              )}
              {(full.subtasks || []).map((st, i) => (
                <SubtaskRow
                  key={`${st.text}:${i}`}
                  s={st}
                  busy={busy}
                  selectMode={selectMode}
                  selected={!!(isSelected && isSelected({ kind: 'subtask', epic_slug: full.epic_slug, id: full.id, text: st.text }))}
                  onSelectToggle={() => onToggleSelect && onToggleSelect({
                    kind: 'subtask', epic_slug: full.epic_slug, id: full.id,
                    text: st.text, done: !!st.done, label: full.title || null,
                  })}
                  onToggle={async () => {
                    setBusy(true);
                    try {
                      await api('toggle_subtask', { id: full.id, epic: full.epic_slug, subtask_text: st.text, done: !st.done });
                      await refresh();
                    } catch (e) { alert('could not update item: ' + (e?.message || e)); }
                    finally { setBusy(false); }
                  }}
                  onEdit={async (text) => {
                    if (!text || text === st.text) return;
                    setBusy(true);
                    try {
                      await api('update_subtask', { id: full.id, epic: full.epic_slug, match_text: st.text, new_text: text });
                      await refresh();
                    } catch (e) { alert('could not rename item: ' + (e?.message || e)); }
                    finally { setBusy(false); }
                  }}
                  onDelete={async () => {
                    setBusy(true);
                    try {
                      await api('delete_subtask', { id: full.id, epic: full.epic_slug, match_text: st.text });
                      await refresh();
                    } catch (e) { alert('could not delete item: ' + (e?.message || e)); }
                    finally { setBusy(false); }
                  }}
                />
              ))}
              <SubtaskAdder
                disabled={busy}
                onAdd={async (text) => {
                  const t = (text || '').trim();
                  if (!t) return;
                  setBusy(true);
                  try {
                    await api('add_subtask', { id: full.id, epic: full.epic_slug, text: t });
                    await refresh();
                  } catch (e) { alert('could not add item: ' + (e?.message || e)); }
                  finally { setBusy(false); }
                }}
              />
            </Field>
          )}

          {full && !full.error && (
            <Field label={`Items${full.children?.length ? ` (${full.children.filter(c => !c.is_completed).length} open)` : ''}`}>
              {(!full.children || full.children.length === 0) && !showAddSubissue && (
                <div style={{ fontSize: 12, color: T.textFaint, fontStyle: 'italic', marginBottom: 6 }}>none yet</div>
              )}
              {full.children && full.children.map(child => {
                const cc = epicColor(child.epic_slug, child.epic_slug.split('/')[0]);
                const childSelected = !!(selectMode && isSelected && isSelected({ kind: 'issue', epic_slug: child.epic_slug, id: child.id }));
                return (
                  <div
                    key={child.id}
                    onClick={() => onSelectIssue && onSelectIssue({ id: child.id, epic_slug: child.epic_slug, title: child.title })}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 10px', marginBottom: 4,
                      background: childSelected ? withAlpha(T.accent, 0.10) : T.surface,
                      border: `1px solid ${childSelected ? T.accent : T.border}`,
                      borderLeft: `3px solid ${cc}`,
                      borderRadius: 6, cursor: 'pointer',
                      opacity: child.is_completed ? 0.55 : 1,
                    }}
                    onMouseEnter={e => { if (!childSelected) e.currentTarget.style.background = T.surfaceHover; }}
                    onMouseLeave={e => { if (!childSelected) e.currentTarget.style.background = T.surface; }}
                  >
                    {selectMode && (
                      <span style={{
                        width: 18, height: 18, flexShrink: 0, borderRadius: 999,
                        border: `1.5px solid ${childSelected ? T.accent : T.borderStrong}`,
                        background: childSelected ? T.accent : 'transparent',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        color: '#fff', fontSize: 11, fontWeight: 700,
                      }}>{childSelected && '✓'}</span>
                    )}
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
                    {!selectMode && <span style={{ color: T.textFaint }}>→</span>}
                  </div>
                );
              })}
              {showAddSubissue ? (
                <AddSubIssueInline
                  parent={full}
                  onCancel={() => setShowAddSubissue(false)}
                  onCreated={() => { setShowAddSubissue(false); refresh(); }}
                  onSelectIssue={onSelectIssue}
                />
              ) : (
                <button onClick={() => setShowAddSubissue(true)} style={{
                  background: 'transparent', border: `1px dashed ${T.border}`,
                  padding: '8px 12px', fontFamily: T.fontBody, fontSize: 12, color: T.textMuted,
                  borderRadius: 6, cursor: 'pointer', marginTop: 4,
                  width: '100%',
                }}>+ add item</button>
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

          {full && !full.error && (
            <Field label={`Sessions${blocks.length ? ` (${blocks.filter(b => !b.completed).length} open)` : ''}`}>
              {blocks.length === 0 && <div style={{ fontSize: 12, color: T.textFaint, fontStyle: 'italic' }}>none yet</div>}
              {blocks.map(b => (
                <div
                  key={b.id}
                  onClick={() => setOpenBlockId(b.id)}
                  title="click to edit timeblock"
                  style={{
                    fontSize: 13, color: T.text, padding: '6px 8px',
                    display: 'flex', gap: 10, alignItems: 'center',
                    opacity: b.completed ? 0.55 : 1,
                    borderBottom: `1px solid ${T.border}`,
                    cursor: 'pointer', borderRadius: 4,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = T.surfaceHover; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <span style={{
                    fontFamily: T.fontMono, fontSize: 12, color: T.textMuted,
                    minWidth: 144, flexShrink: 0, fontVariantNumeric: 'tabular-nums',
                  }}>{b.date} · {b.start}–{b.end}</span>
                  <span style={{
                    flex: 1, textDecoration: b.completed ? 'line-through' : 'none',
                    overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>{b.title}</span>
                  {(b.subtasks?.length > 0) && (
                    <span style={{ fontSize: 11, color: T.textMuted, fontFamily: T.fontMono, flexShrink: 0 }}>
                      {(b.subtasks || []).filter(s => s.done).length}/{(b.subtasks || []).length}
                    </span>
                  )}
                  {!b.completed && (
                    <button
                      onClick={async (e) => { e.stopPropagation(); await api('complete_timeblock', { id: b.id }); refresh(); }}
                      style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: T.done, fontSize: 13, fontWeight: 600, padding: '0 6px' }}
                      title="mark done"
                    >✓</button>
                  )}
                  <button
                    onClick={async (e) => { e.stopPropagation(); if (confirm(`Delete "${b.title}"?`)) { await api('delete_timeblock', { id: b.id }); refresh(); } }}
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: T.overdue, fontSize: 13, fontWeight: 600, padding: '0 6px' }}
                    title="delete"
                  >✕</button>
                </div>
              ))}
              <AddTimeblockInline issue={full} onAdded={refresh} />
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

        </div>

        <footer style={{
          padding: '14px 22px', borderTop: `1px solid ${T.border}`,
          background: T.surface, display: 'flex', gap: 10, alignItems: 'center',
        }}>
          {/* Mark complete only for things with a due date — undated items are
              reference/checklist entries you don't tick off as a whole. Schedules
              (auto_complete: a class, gym, pilates) are done the moment their time
              passes, so they never show a manual "mark done". */}
          {full && !full.error && !full.is_completed && full.fields?.due && !full.fields?.auto_complete && (
            <button onClick={completeBtn} disabled={busy} style={{
              background: T.done, color: '#fff', border: 'none',
              padding: '9px 18px', fontFamily: T.fontBody, fontSize: 13, fontWeight: 500,
              cursor: busy ? 'wait' : 'pointer', borderRadius: 8,
            }}>{busy ? '…' : (full.fields?.recurring ? 'Mark today done' : 'Mark complete')}</button>
          )}
          {full && !full.error && full.is_completed && (
            <button onClick={reopenBtn} disabled={busy} style={{
              background: 'transparent', color: T.textMuted, border: `1px solid ${T.border}`,
              padding: '9px 18px', fontFamily: T.fontBody, fontSize: 13, fontWeight: 500,
              cursor: busy ? 'wait' : 'pointer', borderRadius: 8,
            }}>Reopen</button>
          )}
          {full && !full.error && (
            <button
              onClick={async () => {
                if (!confirm(`Delete "${full.title}" and all its child items? This is permanent.`)) return;
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
          {full?.error && (
            <button
              onClick={async () => {
                setBusy(true);
                try {
                  // Sweep every timeblock still pointing at this dead (epic, id) pair.
                  // delete_timeblock is single-shot; we Promise.all over the list.
                  await Promise.all((blocks || []).map(b => api('delete_timeblock', { id: b.id })));
                  onChanged && onChanged();
                  onClose();
                } catch (e) {
                  alert('cleanup failed: ' + (e?.message || e));
                } finally {
                  setBusy(false);
                }
              }}
              disabled={busy}
              style={{
                background: '#b45309', color: '#fff', border: 'none',
                padding: '9px 18px', fontFamily: T.fontBody, fontSize: 13, fontWeight: 500,
                cursor: busy ? 'wait' : 'pointer', borderRadius: 8,
              }}
            >{busy ? '…' : (blocks.length > 0 ? `Remove ${blocks.length} orphan block${blocks.length === 1 ? '' : 's'} & close` : 'Close')}</button>
          )}
          <span style={{ flex: 1 }} />
          {/* Open THIS item in a fresh agent chat, with it attached as context. */}
          {full && !full.error && onOpenChat && (
            <button
              onClick={() => onOpenChat(full)}
              disabled={busy}
              title="Open this item in a new AI chat"
              style={{
                background: T.text, color: T.surface, border: 'none', borderRadius: 8,
                fontFamily: T.fontBody, fontSize: 13, fontWeight: 600,
                padding: '9px 16px', cursor: busy ? 'wait' : 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >💬 Ask AI</button>
          )}
          {/* A phone has no esc key — give the footer a real Close button. */}
          {window.matchMedia('(max-width: 768px)').matches ? (
            <button onClick={onClose} style={{
              background: 'transparent', border: `1px solid ${T.border}`, borderRadius: 8,
              color: T.text, fontFamily: T.fontBody, fontSize: 13, fontWeight: 500,
              padding: '9px 16px', cursor: 'pointer',
            }}>Close</button>
          ) : (
            <span style={{ fontSize: 11, color: T.textFaint }}><kbd>esc</kbd> close</span>
          )}
        </footer>
      </aside>
      {/* Timeblock editor stacks on top of the issue drawer */}
      {openBlockId && (
        <TimeblockDrawer
          blockId={openBlockId}
          onClose={() => setOpenBlockId(null)}
          onChanged={() => { refresh(); }}
          onOpenIssue={(ref) => { setOpenBlockId(null); onSelectIssue && onSelectIssue(ref); }}
        />
      )}
      {descFull && full && !full.error && (
        <DescriptionViewer
          text={(full.description_html && !showMd) ? full.description_html : (full.description || full.description_html)}
          isHtml={full.description_html ? !showMd : (full.fields?.description_format === 'html')}
          title={full.title}
          onClose={() => setDescFull(false)}
        />
      )}
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

// ─── Attachments ──────────────────────────────────────────────────────
function humanSize(n) {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
function attIcon(m) {
  if (m.kind === 'note') return '📝';
  const t = m.mime || '';
  if (t.includes('pdf')) return '📄';
  if (t.startsWith('image/')) return '🖼️';
  if (t.startsWith('video/')) return '🎬';
  if (t.startsWith('audio/')) return '🎵';
  if (t.includes('zip') || t.includes('compressed')) return '🗜️';
  return '📎';
}

// Files (PDFs, etc.) + AI notes linked to an item. Uploads stream the raw file
// as the request body; the server links the returned id into the item's
// `attachments` frontmatter, so refreshing the issue reflects the change.
function IssueAttachments({ issue, isMobile, onChanged }) {
  const ids = (issue.fields && issue.fields.attachments) || [];
  const key = ids.join(',');
  const [metas, setMetas] = dUseState([]);
  const [busy, setBusy] = dUseState(false);
  const [viewing, setViewing] = dUseState(null);
  const fileRef = dUseRef(null);
  const issueRefStr = `${issue.epic_slug}/${issue.id}`;

  dUseEffect(() => {
    let alive = true;
    if (!ids.length) { setMetas([]); return; }
    fetch(`/api/attachments?ids=${encodeURIComponent(key)}`)
      .then(r => r.json()).then(d => { if (alive) setMetas(d.attachments || []); })
      .catch(() => { if (alive) setMetas([]); });
    return () => { alive = false; };
  }, [key]);

  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      file = await maybeConvertHeic(file);   // iPhone HEIC → JPEG so it renders
      const qs = new URLSearchParams({ issue: issueRefStr, filename: file.name, mime: file.type || 'application/octet-stream' });
      const r = await fetch(`/api/attachments/upload?${qs.toString()}`, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      onChanged && onChanged();
    } catch (e) { alert('Upload failed: ' + (e?.message || e)); }
    finally { setBusy(false); }
  };

  const remove = async (m) => {
    if (!confirm(`Remove "${m.filename}"?`)) return;
    setBusy(true);
    try {
      await fetch(`/api/attachments/${m.id}?issue=${encodeURIComponent(issueRefStr)}`, { method: 'DELETE' });
      onChanged && onChanged();
    } catch {} finally { setBusy(false); }
  };

  const open = (m) => {
    if (m.kind === 'note') setViewing(m);
    else window.open(`/api/attachments/${m.id}`, '_blank', 'noopener');
  };

  return (
    <Field label={`Attachments${metas.length ? ` (${metas.length})` : ''}`}>
      {metas.map(m => (
        <AttachmentRow key={m.id} meta={m} isMobile={isMobile} onOpen={() => open(m)} onRemove={() => remove(m)} />
      ))}
      <input ref={fileRef} type="file" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; upload(f); }} />
      <button onClick={() => fileRef.current && fileRef.current.click()} disabled={busy}
        style={{
          width: '100%', marginTop: metas.length ? 6 : 0, minHeight: isMobile ? 42 : 36,
          background: 'transparent', border: `1px dashed ${T.border}`, borderRadius: 8,
          color: T.textMuted, fontFamily: T.fontBody, fontSize: 13, cursor: busy ? 'default' : 'pointer',
        }}>{busy ? 'working…' : '+ attach a file'}</button>
      {viewing && <NoteViewer meta={viewing} onClose={() => setViewing(null)} />}
    </Field>
  );
}

function AttachmentRow({ meta, isMobile, onOpen, onRemove }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: isMobile ? '10px 10px' : '8px 10px', minHeight: isMobile ? 40 : 0,
      marginBottom: 4, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6,
    }}>
      <span style={{ fontSize: 16, flexShrink: 0 }}>{attIcon(meta)}</span>
      <span onClick={onOpen} role="button" title="open"
        style={{
          flex: 1, minWidth: 0, fontSize: isMobile ? 14 : 13, color: T.text, cursor: 'pointer',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{meta.filename}</span>
      <span style={{ fontSize: 11, color: T.textFaint, fontFamily: T.fontMono, flexShrink: 0 }}>{humanSize(meta.size)}</span>
      <button onClick={() => downloadAttachmentFile(meta.id, meta.filename)} title="download" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: T.textMuted, flexShrink: 0, padding: '0 4px', fontSize: 15, lineHeight: 1 }}>⤓</button>
      <button onClick={onRemove} title="remove" style={{ background: 'transparent', border: 'none', color: T.textFaint, cursor: 'pointer', fontSize: 14, flexShrink: 0 }}>✕</button>
    </div>
  );
}

// Render an agent-authored HTML description inline, in a sandboxed null-origin
// iframe: scripts run (so KaTeX / diagrams / CDN libs keep working) but the note
// can't read todouz's cookies or reach its DOM. The wrapper injects a tiny
// script that posts the content height back so the frame auto-sizes instead of
// living inside a fixed scroll box. A per-instance nonce keeps multiple notes
// from cross-talking. Markdown descriptions still render via <Md>.
function HtmlDescription({ html }) {
  const [height, setHeight] = dUseState(280);
  const nonce = dUseRef('d' + Math.random().toString(36).slice(2)).current;
  dUseEffect(() => {
    function onMsg(e) {
      const d = e.data;
      if (d && d.__todouzHeight && d.nonce === nonce) {
        setHeight(Math.min(2400, Math.max(80, Math.ceil(d.__todouzHeight) + 8)));
      }
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [nonce]);
  const inject = '<script>(function(){function p(){try{parent.postMessage({__todouzHeight:Math.max(document.documentElement.scrollHeight,document.body?document.body.scrollHeight:0),nonce:' + JSON.stringify(nonce) + "},'*')}catch(e){}}window.addEventListener('load',p);setTimeout(p,300);setTimeout(p,1200);try{new ResizeObserver(p).observe(document.documentElement)}catch(e){}})()<\/script>";
  const srcDoc = (html || '').includes('</body>') ? html.replace('</body>', inject + '</body>') : (html + inject);
  return (
    <iframe
      title="description"
      srcDoc={srcDoc}
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
      style={{ width: '100%', height, border: `1px solid ${T.border}`, borderRadius: 8, background: '#fff', display: 'block' }}
    />
  );
}

// Full-screen viewer for an item's description — same chrome as NoteViewer.
// HTML fills the frame in a sandboxed iframe; markdown renders via <Md>.
function DescriptionViewer({ text, isHtml, title, onClose }) {
  dUseEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  // True full-screen: fills the entire viewport with its own top bar.
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 340, background: T.surface, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <span style={{ fontSize: 15 }}>📄</span>
        <span style={{ flex: 1, minWidth: 0, fontFamily: T.fontDisplay, fontSize: 16, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title || 'Description'}</span>
        <button onClick={onClose} aria-label="close" style={{ background: 'transparent', border: `1px solid ${T.border}`, borderRadius: 8, padding: '6px 12px', fontSize: 13, color: T.text, cursor: 'pointer' }}>Close ✕</button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', background: isHtml ? '#fff' : T.surface, minHeight: 0 }}>
        {isHtml
          ? <iframe title={title || 'description'} srcDoc={text} sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" style={{ width: '100%', height: '100%', border: 'none', display: 'block' }} />
          : <div style={{ padding: '24px 20px', maxWidth: 880, margin: '0 auto' }}><Md text={text} /></div>}
      </div>
    </div>
  );
}

// HTML notes render in a sandboxed iframe — scripts may run (so the note keeps
// its "freedom") but in a null origin, so a note can't read todouz's cookies or
// reach its DOM. Markdown notes render with the app's Md component.
function NoteViewer({ meta, onClose }) {
  const [mdText, setMdText] = dUseState(null);
  const isHtml = meta.format === 'html' || (meta.mime || '').includes('html');
  dUseEffect(() => {
    if (isHtml) return;
    let alive = true;
    fetch(`/api/attachments/${meta.id}`).then(r => r.text()).then(t => { if (alive) setMdText(t); }).catch(() => {});
    return () => { alive = false; };
  }, [meta.id]);
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(26,23,20,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.surface, borderRadius: 12, width: 'min(900px, 96vw)', height: 'min(90vh, 900px)', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: T.shadowLg }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: `1px solid ${T.border}` }}>
          <span style={{ fontSize: 15 }}>📝</span>
          <span style={{ flex: 1, minWidth: 0, fontFamily: T.fontDisplay, fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta.filename}</span>
          <button onClick={() => downloadAttachmentFile(meta.id, meta.filename)} title="download" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 16, lineHeight: 1 }}>⤓</button>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', fontSize: 18, color: T.textMuted, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', background: '#fff' }}>
          {isHtml
            ? <iframe title={meta.filename} src={`/api/attachments/${meta.id}`} sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" style={{ width: '100%', height: '100%', border: 'none', display: 'block' }} />
            : <div style={{ padding: 16 }}>{mdText == null ? <span style={{ color: T.textFaint }}>loading…</span> : <Md text={mdText} />}</div>}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, action }) {
  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        marginBottom: 8,
      }}>
        <span style={{
          fontFamily: T.fontBody, fontSize: 11, fontWeight: 600,
          letterSpacing: '0.12em', textTransform: 'uppercase', color: T.textFaint,
        }}>{label}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

// Single sub-task row: click checkbox to toggle, double-click text to rename,
// hover to reveal the delete X.
function SubtaskRow({ s, busy, onToggle, onEdit, onDelete, selectMode, selected, onSelectToggle }) {
  const isMobile = useIsMobile();
  const [editing, setEditing] = dUseState(false);
  const [draft, setDraft] = dUseState(s.text);
  const [hover, setHover] = dUseState(false);

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10,
        padding: '6px 0',
        opacity: s.done ? 0.5 : 1,
      }}
    >
      {/* Ticking items off is the whole point of a checklist on a phone, so the
          box gets a 32px hit area there while staying visually compact. In
          select mode the same box selects instead — one tap, one meaning. */}
      <div
        onClick={() => {
          if (selectMode) { onSelectToggle && onSelectToggle(); return; }
          if (!busy && !editing) onToggle();
        }}
        style={{
          flexShrink: 0, cursor: busy ? 'wait' : 'pointer',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
          ...(isMobile
            ? { minWidth: 32, minHeight: 32, marginLeft: -6, paddingTop: 4 }
            : { marginTop: 1 }),
        }}
      >
        <div style={{
          width: isMobile ? 22 : 16, height: isMobile ? 22 : 16,
          border: `1.5px solid ${selectMode ? (selected ? T.accent : T.borderStrong) : (s.done ? T.done : T.borderStrong)}`,
          background: selectMode ? (selected ? T.accent : 'transparent') : (s.done ? T.done : 'transparent'),
          // round while selecting so it never reads as a completion tick
          borderRadius: selectMode ? 999 : 4,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontSize: isMobile ? 14 : 11, fontWeight: 700,
        }}>{selectMode ? (selected && '✓') : (s.done && '✓')}</div>
      </div>
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => { setEditing(false); onEdit(draft.trim()); }}
          onKeyDown={e => {
            if (e.key === 'Enter') { setEditing(false); onEdit(draft.trim()); }
            else if (e.key === 'Escape') { setDraft(s.text); setEditing(false); }
          }}
          style={{
            flex: 1, background: T.surface2, border: `1px solid ${T.borderStrong}`,
            borderRadius: 4, padding: '3px 8px',
            fontFamily: T.fontBody, fontSize: 14, color: T.text, outline: 'none',
          }}
        />
      ) : (
        <div
          onClick={() => selectMode && onSelectToggle && onSelectToggle()}
          onDoubleClick={() => { if (!selectMode) { setDraft(s.text); setEditing(true); } }}
          title={selectMode ? 'tap to select' : 'double-click to rename'}
          style={{
            flex: 1, fontSize: 14, color: T.text,
            textDecoration: s.done ? 'line-through' : 'none', lineHeight: 1.45,
            cursor: 'text', userSelect: 'text',
          }}
        >
          {s.text}{s.due && <span style={{ fontStyle: 'italic', color: T.textFaint, marginLeft: 6, fontSize: 12 }}>· due {s.due}</span>}
        </div>
      )}
      {/* Touch has no hover, so the delete affordance would be unreachable on a
          phone if it stayed hover-gated — show it outright there. */}
      {!editing && (hover || isMobile) && (
        <button
          onClick={onDelete}
          title="delete sub-task"
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: T.overdue, fontSize: isMobile ? 16 : 13, lineHeight: 1,
            padding: isMobile ? '0 8px' : '0 4px',
            minWidth: isMobile ? 32 : 0, minHeight: isMobile ? 32 : 0,
          }}
        >✕</button>
      )}
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

// MetaEditor — inline editors for due / priority / agent so the user can
// adjust these without involving the AI. Each chip is dblclick-to-edit.
// Render "YYYY-MM-DD HH:MM" when both date and time are set, otherwise just the date.
// Empty/null → empty string so the chip can show its "not set" placeholder.
function formatDue(date, time) {
  if (!date) return '';
  return time ? `${date} ${time}` : date;
}

// Drawer close buttons: one style, three drawers. 22px is a fine mouse target
// and a poor thumb one, so touch gets a 36px box.
function drawerCloseStyle(isMobile) {
  return {
    background: 'transparent', border: 'none',
    fontSize: isMobile ? 22 : 18,
    color: T.textMuted, cursor: 'pointer', lineHeight: 1, borderRadius: 4,
    padding: isMobile ? 6 : 4,
    minWidth: isMobile ? 36 : 0, minHeight: isMobile ? 36 : 0,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  };
}

function MetaEditor({ issue, onChanged }) {
  const isMobile = useIsMobile();
  // Note: recurring is intentionally NOT here. Issues are static — recurrence lives
  // on the timeblock (session) instead. Open any session in TimeblockDrawer to set
  // a weekly schedule + optional end date.
  const [editingDue, setEditingDue] = dUseState(false);
  const [editingPriority, setEditingPriority] = dUseState(false);
  const [editingReminder, setEditingReminder] = dUseState(false);
  const [editingTags, setEditingTags] = dUseState(false);
  const [showPicker, setShowPicker] = dUseState(false);   // calendar time-picker overlay
  const [dueDraft, setDueDraft] = dUseState(issue.fields?.due || '');
  const [dueTimeDraft, setDueTimeDraft] = dUseState(issue.fields?.due_time || '');
  const [tagsDraft, setTagsDraft] = dUseState((issue.fields?.tags || []).join(', '));
  const [users, setUsers] = dUseState([]);
  dUseEffect(() => {
    fetch('/api/category-visibility').then(r => r.json()).then(j => setUsers(j.users || [])).catch(() => {});
  }, []);

  const save = async (patch) => {
    try {
      await api('update_issue', { id: issue.id, epic: issue.epic_slug, patch });
      onChanged && onChanged();
    } catch (e) { alert('save failed: ' + (e?.message || e)); }
  };

  const chip = (label, value, onEdit) => (
    <button onClick={onEdit} style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      background: T.surface2, border: `1px solid ${T.border}`,
      borderRadius: 999,
      padding: isMobile ? '7px 12px' : '4px 10px', minHeight: isMobile ? 34 : 0,
      fontFamily: T.fontBody, fontSize: isMobile ? 13 : 12, color: T.text,
      cursor: 'pointer',
    }}
    onMouseEnter={e => { e.currentTarget.style.borderColor = T.borderStrong; }}
    onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; }}
    title="click to edit"
    >
      <span style={{ color: T.textFaint, fontSize: 11 }}>{label}:</span>
      <span style={{ fontFamily: T.fontMono }}>{value || <em style={{ color: T.textFaint }}>not set</em>}</span>
    </button>
  );

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      {/* Due — date + optional time-of-day. Inline editor commits both fields together
          on blur. Empty time → due_time cleared. */}
      {editingDue ? (
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
          background: T.surface2, border: `1px solid ${T.borderStrong}`, borderRadius: 12,
          padding: '4px 8px',
        }}>
          <DateTimeField mode="datetime" date={dueDraft} time={dueTimeDraft}
            inputStyle={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, padding: '5px 8px', fontFamily: T.fontMono, fontSize: 13, color: T.text, outline: 'none', minWidth: 0 }}
            onChange={(p) => { if ('date' in p) setDueDraft(p.date); if ('time' in p) setDueTimeDraft(p.time); }} />
          <button
            onClick={async () => {
              const newDate = dueDraft || null;
              const newTime = (dueDraft && dueTimeDraft) ? dueTimeDraft : null;  // time only meaningful with date
              const patch = {};
              if (newDate !== (issue.fields?.due || null)) patch.due = newDate;
              if (newTime !== (issue.fields?.due_time || null)) patch.due_time = newTime;
              if (Object.keys(patch).length) await save(patch);
              setEditingDue(false);
            }}
            style={{
              background: T.text, color: '#fff', border: 'none',
              padding: '4px 10px', borderRadius: 999,
              fontFamily: T.fontBody, fontSize: 11, cursor: 'pointer',
            }}>save</button>
          <button onClick={() => {
            setDueDraft(issue.fields?.due || '');
            setDueTimeDraft(issue.fields?.due_time || '');
            setEditingDue(false);
          }} style={{
            background: 'transparent', border: 'none', color: T.textMuted, fontSize: 11, cursor: 'pointer', padding: '2px 4px',
          }}>esc</button>
        </span>
      ) : chip('due', formatDue(issue.fields?.due, issue.fields?.due_time), () => {
        setDueDraft(issue.fields?.due || '');
        setDueTimeDraft(issue.fields?.due_time || '');
        setEditingDue(true);
      })}

      {/* Priority */}
      {editingPriority ? (
        <select autoFocus
          value={issue.fields?.priority || 'medium'}
          onChange={async e => {
            await save({ priority: e.target.value });
            setEditingPriority(false);
          }}
          onBlur={() => setEditingPriority(false)}
          style={{
            background: T.surface2, border: `1px solid ${T.borderStrong}`, borderRadius: 999,
            padding: '4px 10px', fontFamily: T.fontMono, fontSize: 12, color: T.text, outline: 'none', cursor: 'pointer',
          }}>
          <option value="high">high</option>
          <option value="medium">medium</option>
          <option value="low">low</option>
        </select>
      ) : chip('priority', issue.fields?.priority || 'medium', () => setEditingPriority(true))}

      {/* Reminder — a push notification this many minutes before the due time.
          Needs a due date to fire. */}
      {editingReminder ? (
        <select autoFocus
          value={String(issue.fields?.reminder || '')}
          onChange={async e => { await save({ reminder: e.target.value ? Number(e.target.value) : null }); setEditingReminder(false); }}
          onBlur={() => setEditingReminder(false)}
          style={{ background: T.surface2, border: `1px solid ${T.borderStrong}`, borderRadius: 999, padding: '4px 10px', fontFamily: T.fontMono, fontSize: 12, color: T.text, outline: 'none', cursor: 'pointer' }}>
          <option value="">no reminder</option>
          <option value="5">5 min before</option>
          <option value="10">10 min before</option>
          <option value="30">30 min before</option>
          <option value="60">1 hour before</option>
          <option value="120">2 hours before</option>
          <option value="1440">1 day before</option>
        </select>
      ) : chip('remind', (() => { const m = issue.fields?.reminder; if (!m) return null; return m >= 1440 ? `${Math.round(m/1440)}d before` : m >= 60 ? `${Math.round(m/60)}h before` : `${m}m before`; })(), () => setEditingReminder(true))}

      {/* Assignees — multi-select: tap a name to add/remove. Both can be assigned.
          Defaults to the creator on new items. */}
      {users.map(u => {
        const cur = Array.isArray(issue.fields?.assign_to) ? issue.fields.assign_to : (issue.fields?.assign_to ? [issue.fields.assign_to] : []);
        const on = cur.includes(u);
        return (
          <button
            key={u}
            onClick={async () => { await save({ assign_to: on ? cur.filter(x => x !== u) : [...cur, u] }); }}
            title={on ? `assigned to ${u} — tap to unassign` : `assign to ${u}`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              background: on ? T.accent : T.surface2,
              color: on ? '#fff' : T.textMuted,
              border: `1px solid ${on ? T.accent : T.border}`, borderRadius: 999,
              padding: isMobile ? '7px 12px' : '4px 10px', minHeight: isMobile ? 34 : 0,
              fontFamily: T.fontBody, fontSize: isMobile ? 13 : 12, cursor: 'pointer',
            }}
          >{on && <Icon kind="check" size={11} />}{u}</button>
        );
      })}

      {/* Tags — comma-separated editor. Normalised to lowercase kebab on the
          backend, so "Fast, Main Dish" saves as fast, main-dish. */}
      {editingTags ? (
        <input autoFocus value={tagsDraft}
          onChange={e => setTagsDraft(e.target.value)}
          onBlur={async () => {
            // Comma-separated, case-insensitive: lowercase here so the chip reflects
            // it immediately (the backend also normalises to lowercase kebab). Dedupe
            // so "Chest, chest" collapses to one.
            const list = [...new Set(tagsDraft.split(',').map(s => s.trim().toLowerCase()).filter(Boolean))];
            const current = issue.fields?.tags || [];
            if (JSON.stringify(list) !== JSON.stringify(current)) await save({ tags: list });
            setEditingTags(false);
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') e.currentTarget.blur();
            else if (e.key === 'Escape') { setTagsDraft((issue.fields?.tags || []).join(', ')); setEditingTags(false); }
          }}
          placeholder="fast, protein, main"
          style={{
            background: T.surface2, border: `1px solid ${T.borderStrong}`, borderRadius: 999,
            padding: '4px 10px', fontFamily: T.fontMono, fontSize: 12, color: T.text, outline: 'none',
            width: 220,
          }} />
      ) : chip('tags', (issue.fields?.tags || []).join(', '), () => {
        setTagsDraft((issue.fields?.tags || []).join(', '));
        setEditingTags(true);
      })}
    </div>
  );
}

// One-line summary for the recurring chip, e.g. "every Wed 17:00", "weekly · until 2026-09-01", or "no".
function recurringSummary(recurring, schedule) {
  if (!recurring) return 'no';
  const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const dow = schedule?.dow;
  const time = schedule?.time;
  const until = schedule?.until;
  let s = '';
  if (dow != null && DOW[dow]) s = `every ${DOW[dow]}`;
  else s = 'weekly';
  if (time) s += ` ${time}`;
  if (until) s += ` · until ${until}`;
  else s += ' · forever';
  return s;
}

// Expanded editor for the recurring chip. Toggle on/off; when on, pick day-of-week,
// time, and "until forever" vs "until specific date". Generic — works for any entity
// whose recurrence is expressed as { recurring: bool, recurring_schedule: { dow, time?, until? } }.
function RecurringEditor({ currentRecurring, currentSchedule, onSave, onCancel, includeTime = true }) {
  const sched = currentSchedule || {};
  const [enabled, setEnabled] = dUseState(!!currentRecurring);
  const [dow, setDow] = dUseState(sched.dow != null ? sched.dow : new Date().getDay());
  const [time, setTime] = dUseState(sched.time || '09:00');
  const [mode, setMode] = dUseState(sched.until ? 'until' : 'forever');
  const [until, setUntil] = dUseState(sched.until || '');
  const [busy, setBusy] = dUseState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (!enabled) {
        await onSave({ recurring: false, recurring_schedule: null });
        return;
      }
      // Build the schedule object. Drop `until` when "forever" so we don't write a stale field.
      const newSched = { dow: Number(dow) };
      if (includeTime) newSched.time = time;
      if (mode === 'until' && until) newSched.until = until;
      await onSave({ recurring: true, recurring_schedule: newSched });
    } finally { setBusy(false); }
  };

  const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  return (
    <div style={{
      flexBasis: '100%',
      marginTop: 4, padding: 12,
      background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 10,
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
        <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
        <span style={{ fontFamily: T.fontBody, fontSize: 13, color: T.text }}>
          Repeat this session weekly
        </span>
      </label>
      {enabled && (
        <>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div>
              <label style={miniLabel()}>Day of week</label>
              <select value={dow} onChange={e => setDow(e.target.value)} style={blockInput()}>
                {DOW.map((d, i) => <option key={i} value={i}>{d}</option>)}
              </select>
            </div>
            {includeTime && (
              <div>
                <label style={miniLabel()}>Time</label>
                <input type="time" value={time} onChange={e => setTime(e.target.value)} style={blockInput()} />
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 13 }}>
              <input
                type="radio"
                name="recur-mode"
                checked={mode === 'forever'}
                onChange={() => setMode('forever')}
              />
              Forever
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 13 }}>
              <input
                type="radio"
                name="recur-mode"
                checked={mode === 'until'}
                onChange={() => setMode('until')}
              />
              Until
            </label>
            {mode === 'until' && (
              <input
                type="date"
                value={until}
                onChange={e => setUntil(e.target.value)}
                style={blockInput()}
                autoFocus
              />
            )}
          </div>
        </>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={submit} disabled={busy} style={primaryBtn(!busy)}>
          {busy ? '…' : (enabled ? 'Save recurrence' : 'Turn off recurring')}
        </button>
        <button onClick={onCancel} style={secondaryBtn()}>Cancel</button>
      </div>
    </div>
  );
}

// "+ add planned block" form. Roomy enough to show the full title + a multi-line
// note, with one-click "recommended slots" chips computed from the user's current
// availability across the next 14 days. The default subtasks template fires on
// submit so the new block lands with a usable checklist.
function AddTimeblockInline({ issue, onAdded }) {
  const [open, setOpen] = dUseState(false);
  const [date, setDate] = dUseState(new Date().toISOString().slice(0, 10));
  const [start, setStart] = dUseState('09:00');
  const [end, setEnd] = dUseState('12:00');
  const [title, setTitle] = dUseState('');
  const [note, setNote] = dUseState('');
  // repeatWeeks > 1 → bulk-generate that many concrete blocks one week apart, each
  // independently editable / reschedulable / completable. There is no template — every row
  // is real, so the user can later put a different itinerary in each session's description.
  const [repeatWeeks, setRepeatWeeks] = dUseState(1);
  const [busy, setBusy] = dUseState(false);
  const [slots, setSlots] = dUseState([]);

  // Load existing blocks for the next 14 days so we can compute open windows.
  dUseEffect(() => {
    if (!open) return;
    const today = new Date();
    const from = fmtISO(startOfDay(today));
    const to = fmtISO(new Date(today.getTime() + 14 * 86400000));
    api('list_timeblocks', { from_date: from, to_date: to })
      .then(r => setSlots(computeFreeSlots(r.blocks || [], from, 14)))
      .catch(() => setSlots([]));
  }, [open]);

  if (!open) {
    return (
      <button onClick={() => { setTitle(issue.title); setOpen(true); }} style={{
        background: 'transparent', border: `1px dashed ${T.border}`,
        padding: '8px 12px', fontFamily: T.fontBody, fontSize: 12, color: T.textMuted,
        borderRadius: 6, cursor: 'pointer', marginTop: 6, width: '100%',
      }}>+ add session</button>
    );
  }

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const seeded = note.trim() || defaultSessionDescription(issue, title.trim());
      const reps = Math.max(1, Math.min(52, Number(repeatWeeks) || 1));
      await api('add_timeblock', {
        date, start, end,
        title: title.trim() || issue.title,
        note: seeded || undefined,
        issue_id: issue.id, epic_slug: issue.epic_slug,
        repeat_weeks: reps,
      });
      setOpen(false);
      setNote('');
      setRepeatWeeks(1);
      onAdded && onAdded();
    } catch (e) { alert('add failed: ' + (e?.message || e)); }
    finally { setBusy(false); }
  };

  const pickSlot = (s) => {
    setDate(s.date);
    setStart(s.start);
    setEnd(s.end);
  };

  return (
    <div style={{
      marginTop: 8, padding: 14,
      background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 8,
      display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      <div>
        <label style={miniLabel()}>Title</label>
        <input
          autoFocus
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); if (e.key === 'Escape') setOpen(false); }}
          placeholder={`what will you do? (default: "${issue.title}")`}
          style={{
            width: '100%', boxSizing: 'border-box',
            background: T.surface, border: `1px solid ${T.border}`,
            borderRadius: 6, padding: '8px 12px',
            fontFamily: T.fontBody, fontSize: 14, color: T.text, outline: 'none',
          }}
        />
      </div>

      <div>
        <label style={miniLabel()}>When <span style={{ color: T.textFaint, fontWeight: 400 }}>· {computeDurationLocal(start, end)}h — type it, or tap 📅 for the schedule</span></label>
        <DateTimeField mode="session" date={date} start={start} end={end}
          inputStyle={blockInput(150)}
          onChange={(p) => { if ('date' in p) setDate(p.date); if ('start' in p) setStart(p.start); if ('end' in p) setEnd(p.end); }} />
      </div>

      {/* Bulk-generate: create N concrete blocks one week apart. Each is independent —
          editable, reschedulable, completable on its own. After generation there's no
          "template" — the user can drop a different itinerary into each session. */}
      <div>
        <label style={miniLabel()}>Repeat weekly</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <input
            type="number"
            min={1}
            max={52}
            value={repeatWeeks}
            onChange={e => setRepeatWeeks(Math.max(1, Math.min(52, Number(e.target.value) || 1)))}
            style={blockInput(72)}
          />
          <span style={{ fontSize: 12, color: T.textMuted }}>
            {repeatWeeks <= 1
              ? 'one block (no repeat)'
              : `→ creates ${repeatWeeks} blocks, one per week starting ${date}`}
          </span>
        </div>
      </div>

      {/* Recommended slots scanned from the next 14 days */}
      {slots.length > 0 && (
        <div>
          <label style={miniLabel()}>Recommended open slots</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
            {slots.map((s, i) => {
              const active = s.date === date && s.start === start && s.end === end;
              return (
                <button
                  key={i}
                  onClick={() => pickSlot(s)}
                  title={`${s.date} ${s.start}-${s.end} · ${s.label}`}
                  style={{
                    background: active ? T.text : T.surface,
                    color: active ? '#fff' : T.text,
                    border: `1px solid ${active ? T.text : T.border}`,
                    borderRadius: 999, padding: '4px 10px',
                    fontFamily: T.fontMono, fontSize: 11, cursor: 'pointer',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  <span style={{ color: active ? '#fff' : T.textFaint }}>{s.label}</span>
                  {' '}
                  <span>{s.start}-{s.end}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <label style={miniLabel()}>Note <span style={{ color: T.textFaint, fontWeight: 400 }}>(optional)</span></label>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); if (e.key === 'Escape') setOpen(false); }}
          placeholder="anything to remember when you sit down — links, context, what you tried last time…"
          rows={Math.min(8, Math.max(3, note.split('\n').length + 1))}
          style={{
            width: '100%', boxSizing: 'border-box',
            background: T.surface, border: `1px solid ${T.border}`,
            borderRadius: 6, padding: '8px 12px',
            fontFamily: T.fontBody, fontSize: 13, color: T.text, outline: 'none',
            resize: 'vertical', lineHeight: 1.5,
          }}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button onClick={submit} disabled={busy} style={primaryBtn(!busy)}>{busy ? '…' : 'Add block'}</button>
        <button onClick={() => setOpen(false)} style={secondaryBtn()}>Cancel</button>
        <span style={{ flex: 1 }} />
        {!window.matchMedia('(max-width: 768px)').matches && <span style={{ fontSize: 11, color: T.textFaint }}><kbd>⌘↵</kbd> add · <kbd>esc</kbd> close</span>}
      </div>

    </div>
  );
}

function miniLabel() {
  return {
    display: 'block', fontFamily: T.fontBody, fontSize: 10, fontWeight: 600,
    letterSpacing: '0.10em', textTransform: 'uppercase',
    color: T.textFaint, marginBottom: 4,
  };
}

// Inline form for creating a sub-issue from inside the parent's drawer. Mirrors
// the AddTimeblockInline layout: title, due, priority, description, footer. The
// sub-issue inherits the parent's epic + agent automatically.
// Inline sub-issue add — single title input. After create, the parent IssueDrawer
// hands off to a fresh IssueDrawer for the new sub-issue so the user can fill in
// description / due / priority there instead of fitting it all into this pill.
function AddSubIssueInline({ parent, onCreated, onCancel, onSelectIssue }) {
  const [title, setTitle] = dUseState('');
  const [busy, setBusy] = dUseState(false);
  const [err, setErr] = dUseState(null);

  const submit = async () => {
    if (busy) return;
    const t = title.trim();
    if (!t) { setErr('title required'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await api('create_subissue', {
        parent_issue_id: parent.id,
        parent_epic: parent.epic_slug,
        title: t,
      });
      if (r?.error) { setErr(r.error); return; }
      onCreated && onCreated(r);
      // Hand off to a fresh IssueDrawer for the new sub-issue so the user can
      // edit description / due / etc. there. Falls back to just closing the inline
      // input if the host didn't pass onSelectIssue.
      if (r?.id && onSelectIssue) onSelectIssue({ id: r.id, epic_slug: r.epic_slug || parent.epic_slug });
    } catch (e) { setErr(String(e?.message || e)); }
    finally { setBusy(false); }
  };

  return (
    <div style={{
      marginTop: 8, padding: 10,
      background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 8,
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ fontSize: 11, color: T.textFaint, fontFamily: T.fontMono }}>
        ↳ item under <span style={{ color: T.text }}>{parent.id}</span> · {parent.title}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          autoFocus
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); submit(); }
            if (e.key === 'Escape') onCancel && onCancel();
          }}
          placeholder="what's the item? · enter to add · esc to cancel"
          style={{
            flex: 1, boxSizing: 'border-box',
            background: T.surface, border: `1px solid ${T.border}`,
            borderRadius: 6, padding: '8px 12px',
            fontFamily: T.fontBody, fontSize: 13, color: T.text, outline: 'none',
          }}
        />
        <button onClick={submit} disabled={busy || !title.trim()} style={primaryBtn(!busy && !!title.trim())}>
          {busy ? '…' : 'Add'}
        </button>
        <button onClick={() => onCancel && onCancel()} style={secondaryBtn()}>Cancel</button>
      </div>
      {err && <div style={{ color: T.overdue, fontSize: 12 }}>{err}</div>}
      <div style={{ fontSize: 11, color: T.textFaint }}>
        Just the title for now — opens for editing once created.
      </div>
    </div>
  );
}
function blockInput(width) {
  return {
    background: T.surface, border: `1px solid ${T.border}`,
    borderRadius: 6, padding: '6px 10px',
    fontFamily: T.fontMono, fontSize: 13, color: T.text, outline: 'none',
    width: width || 'auto', boxSizing: 'border-box',
  };
}
function computeDurationLocal(start, end) {
  const [sh, sm] = String(start).split(':').map(Number);
  const [eh, em] = String(end).split(':').map(Number);
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60;
  return (mins / 60).toFixed(mins % 60 === 0 ? 0 : 1);
}

// Find open windows in the next N days. Strategy: for each day, take 3 candidate
// windows (morning / afternoon / evening) and discard any that overlap an existing
// non-completed block. Returns up to ~6 nearest-in-time openings.
function computeFreeSlots(existingBlocks, fromIso, days) {
  const WINDOWS = [
    { start: '09:00', end: '12:30', label: 'morning' },
    { start: '14:00', end: '17:30', label: 'afternoon' },
    { start: '19:00', end: '22:30', label: 'evening' },
  ];
  const blocksByDate = {};
  for (const b of existingBlocks) {
    if (b.completed) continue;
    (blocksByDate[b.date] = blocksByDate[b.date] || []).push(b);
  }
  const out = [];
  const start = parseISODate(fromIso) || startOfDay(new Date());
  const todayMs = startOfDay(new Date()).getTime();
  const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    const iso = fmtISO(d);
    const dayBlocks = blocksByDate[iso] || [];
    for (const w of WINDOWS) {
      // Skip windows that have already passed today.
      if (d.getTime() === todayMs && toMins(w.end) <= nowMins) continue;
      const overlaps = dayBlocks.some(b => rangesOverlap(b.start, b.end, w.start, w.end));
      if (overlaps) continue;
      out.push({ date: iso, start: w.start, end: w.end, label: shortDateLabel(d) });
      if (out.length >= 6) return out;
    }
  }
  return out;
}
function toMins(t) { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; }
function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  const aS = toMins(aStart), aE = toMins(aEnd);
  const bS = toMins(bStart), bE = toMins(bEnd);
  return aS < bE && bS < aE;
}
function shortDateLabel(d) {
  const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const today = startOfDay(new Date());
  const diff = Math.round((startOfDay(d).getTime() - today.getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return `${DOW[d.getDay()]} ${d.getDate()}`;
}

// Seed a session description (markdown) when the user creates a planned block
// without typing their own. Uses the same heuristic from before but emits markdown
// `- [ ]` lines instead of a separate subtasks array. Users can edit the description
// after the session lands. Empty string if no useful signal.
function defaultSessionDescription(issue, blockTitle) {
  if (!issue) return '';
  const title = (blockTitle || '').toLowerCase();
  const iTitle = (issue.title || '').toLowerCase();
  const isReview  = /review|submit|polish|final|rehearsal|rehearse/.test(title);
  const isSession2 = /session\s*2|session\s*3|session\s*4/.test(title);
  const isFirst    = /session\s*1/.test(title);
  const isPresent  = /present|slide|rehearsal/.test(title) || /present|slide/.test(iTitle);
  const isExam     = /exam|revision/.test(title) || /exam|revision/.test(iTitle);

  let steps = null;
  if (isExam) {
    steps = ['Pull up notes / past papers', 'Active recall pass on weak topics', 'Timed practice problems', 'Log gaps to revisit next session'];
  } else if (isPresent && isReview) {
    steps = ['Read through slides end-to-end', 'Time yourself on each slide', 'Tighten speaker notes for the rough spots', 'Export PDF backup'];
  } else if (isPresent) {
    steps = ['Outline section flow', 'Draft each slide', 'Add speaker notes'];
  } else if (isReview || isSession2) {
    steps = ['Re-read previous-session output', 'Address open TODOs / gaps', 'Final pass for clarity + typos', 'Submit'];
  } else if (isFirst || /work|draft|start|implement|build/.test(title)) {
    steps = ['Review issue context + linked notes', 'Plan approach for this session', 'Work the core piece', 'Capture handoff notes for next session'];
  }
  if (!steps) return '';
  return steps.map(s => `- [ ] ${s}`).join('\n');
}

// ─── AgentsDrawer ─────────────────────────────────────────────────────
// Universal chat surface. Persists "last session per agent" in localStorage so
// closing + reopening the drawer brings back the conversation.
const LAST_SESSION_KEY = (agent) => `todouz.lastSession.${agent}`;
const DRAWER_WIDTH_KEY = 'todouz.agentsDrawer.width';
const DEFAULT_DRAWER_WIDTH = 1000;

function AgentsDrawer({ launch, onClose, onFiles }) {
  const isMobile = useIsMobile();
  const [selected, setSelected] = dUseState(launch?.agent || 'scheduler');
  const [seed, setSeed] = dUseState(launch?.seed || null);
  const [cardContext, setCardContext] = dUseState(launch?.cardContext || null);
  const [resumeSessionId, setResumeSessionId] = dUseState(null);
  const [sessions, setSessions] = dUseState([]);
  // Mobile has no room for the 256px rail, so it becomes a slide-in sheet.
  // Without this the phone had no way to start a new chat or switch sessions.
  const [sessionsOpen, setSessionsOpen] = dUseState(false);
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
        width: window.matchMedia('(max-width: 768px)').matches ? '100vw' : `min(${width}px, 96vw)`,
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
        {/* Left rail: sessions only. The old per-agent picker is gone — there is
            ONE agent now, and domain behaviour comes from data/skills/ playbooks
            (the backend injects the skill index into every chat). */}
        {/* Backdrop for the mobile sessions sheet */}
        {isMobile && sessionsOpen && (
          <div onClick={() => setSessionsOpen(false)} style={{
            position: 'absolute', inset: 0, background: 'rgba(26,23,20,0.32)', zIndex: 5,
          }} />
        )}
        <div style={{
          flexShrink: 0,
          background: T.surface2,
          borderRight: `1px solid ${T.border}`,
          display: 'flex',
          flexDirection: 'column',
          ...(isMobile ? {
            position: 'absolute', top: 0, bottom: 0, left: 0, zIndex: 6,
            width: 'min(300px, 85vw)',
            transform: sessionsOpen ? 'translateX(0)' : 'translateX(-101%)',
            transition: 'transform 180ms ease',
            boxShadow: sessionsOpen ? T.shadowLg : 'none',
          } : { width: 256 }),
        }}>
          <div style={{ padding: '18px 18px 8px' }}>
            <h2 style={{ fontFamily: T.fontDisplay, fontSize: 18, fontWeight: 600, margin: 0 }}>Chat</h2>
            <div style={{ fontSize: 11, color: T.textFaint, marginTop: 2 }}>one agent · skills-based</div>
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
            <button onClick={() => { startNewChat(); setSessionsOpen(false); }} style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontFamily: T.fontBody, fontSize: isMobile ? 14 : 11, fontWeight: 500,
              color: T.accent,
              padding: isMobile ? '6px 8px' : 0, minHeight: isMobile ? 34 : 0,
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
                onPick={() => { pickSession(s.session_id); setSessionsOpen(false); }}
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
            display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 12,
            padding: isMobile ? '10px 14px' : '16px 22px',
            borderBottom: `1px solid ${T.border}`,
            background: T.surface,
          }}>
            <h2 style={{
              fontFamily: T.fontDisplay, fontSize: isMobile ? 18 : 22, margin: 0, fontWeight: 600,
              color: T.text, letterSpacing: '-0.015em',
              whiteSpace: 'nowrap', flexShrink: 0,
            }}>ai agent</h2>
            {resumeSessionId && (
              <span style={{
                fontFamily: T.fontMono, fontSize: 11, fontWeight: 500, color: T.done,
                padding: '2px 10px', background: withAlpha('#15803d', 0.10), borderRadius: 999,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0,
              }}>{/* the id is noise on a phone — the sessions sheet names the thread */}
                {isMobile ? 'resuming' : `resuming · ${resumeSessionId.slice(0, 8)}`}</span>
            )}
            <span style={{ flex: 1 }} />
            {isMobile && (
              <button
                onClick={() => setSessionsOpen(true)}
                aria-label="sessions"
                title="sessions"
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: T.textMuted, padding: 6, borderRadius: 6,
                  minWidth: 36, minHeight: 36,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}
              ><Icon kind="list" size={18} /></button>
            )}
            <button onClick={onClose} style={drawerCloseStyle(isMobile)} aria-label="close">✕</button>
          </header>
          <div style={{ flex: 1, overflow: 'hidden', padding: window.matchMedia('(max-width: 768px)').matches ? '8px 10px 10px' : 14, minHeight: 0 }}>
            <ChatPanel
              key={`${selected}:${chatKey}:${resumeSessionId || 'new'}`}
              agent={selected}
              seedMessage={seed}
              cardContext={cardContext}
              contextItems={launch?.contextItems || null}
              resumeSessionId={resumeSessionId}
              prefillInput={launch?.prefillInput || null}
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
  const isMobile = useIsMobile();
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
          fontSize: isMobile ? 14 : 12, color: T.text, overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500,
          // Reserve room whenever the action cluster is showing, else the title
          // slides underneath it — on mobile that's always.
          paddingRight: (hover || isMobile) ? (isMobile ? 76 : 36) : 0,
        }}>{display}</div>
      )}
      <div style={{
        fontSize: 10, color: T.textFaint, marginTop: 2,
        fontFamily: T.fontMono, fontVariantNumeric: 'tabular-nums',
      }}>
        {fmtRelative(s.last_updated)} · {s.turn_count || 1} turn{s.turn_count === 1 ? '' : 's'}
      </div>
      {(hover || isMobile) && !editing && (
        <div style={{
          position: 'absolute', top: 6, right: 6,
          display: 'flex', gap: 2,
        }}>
          <button
            onClick={(e) => { stop(e); setDraft(s.title || ''); setEditing(true); }}
            title="rename"
            style={{
              background: T.surface, border: `1px solid ${T.border}`,
              fontSize: isMobile ? 13 : 11,
              padding: isMobile ? '6px 9px' : '2px 6px', cursor: 'pointer',
              color: T.textMuted, borderRadius: 4, lineHeight: 1,
              minWidth: isMobile ? 32 : 0, minHeight: isMobile ? 32 : 0,
            }}
          >✎</button>
          <button
            onClick={(e) => { stop(e); if (confirm(`Delete this session? "${display}"`)) onDeleted(); }}
            title="delete"
            style={{
              background: T.surface, border: `1px solid ${T.border}`,
              fontSize: isMobile ? 13 : 11,
              padding: isMobile ? '6px 9px' : '2px 6px', cursor: 'pointer',
              color: T.overdue, borderRadius: 4, lineHeight: 1,
              minWidth: isMobile ? 32 : 0, minHeight: isMobile ? 32 : 0,
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
function ChatPanel({ agent, seedMessage, cardContext, contextItems, resumeSessionId, prefillInput, onSeedConsumed, onSessionStarted, onFiles }) {
  const [messages, setMessages] = dUseState([]);
  // prefillInput seeds the box with text. Select mode no longer uses it — picked
  // items ride as context attachment chips instead — but it stays for callers
  // that genuinely want to pre-type something. It lands in the
  // input box unsent — the user writes their instruction around it.
  const [input, setInput] = dUseState(prefillInput || '');
  // Composer auto-grows with its content (Claude-app behaviour) — no drag bar,
  // no fixed rows. Capped by maxHeight in the style, then it scrolls.
  const taRef = dUseRef(null);
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

  // Keyboard-aware height: iOS shrinks window.visualViewport when the keyboard
  // opens but leaves 100vh alone — so without this the composer sits behind the
  // keyboard. We reserve the keyboard's height as bottom padding.
  const [kbInset, setKbInset] = dUseState(0);
  dUseEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setKbInset(inset > 60 ? inset : 0);   // ignore URL-bar-sized jitter
    };
    vv.addEventListener('resize', onResize);
    vv.addEventListener('scroll', onResize);
    onResize();
    return () => { vv.removeEventListener('resize', onResize); vv.removeEventListener('scroll', onResize); };
  }, []);

  // Grow/shrink the textarea to fit its content.
  dUseEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, Math.round(window.innerHeight * 0.38)) + 'px';
  }, [input]);

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
  // Things picked in select mode (and any issue context the launcher passed)
  // ride along as attachment chips — the same affordance as an attached image —
  // instead of being pasted into the box as text the user has to type around.
  dUseEffect(() => {
    const seeded = [];
    for (const it of (contextItems || [])) {
      seeded.push({ kind: 'context', name: `${it.kind}: ${selectionChipLabel(it)}`, ref: it });
    }
    if (cardContext && !(contextItems || []).length) {
      seeded.push({
        kind: 'context',
        name: `issue: ${cardContext.title || cardContext.id}`,
        ref: { kind: 'issue', id: cardContext.id, epic_slug: cardContext.epic_slug, label: cardContext.title || null },
      });
    }
    if (seeded.length) setAttachments(prev => [...seeded, ...prev]);
    // mount-only: re-seeding on every render would resurrect chips the user removed
  }, []);

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
      } else if ((f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) && f.size < 25 * 1024 * 1024) {
        // PDFs ride to the model as a base64 document block (Claude reads PDFs
        // natively) — the same inline path images use. > ~25 MB won't fit the
        // JSON body, so those fall through to "unsupported".
        const reader = new FileReader();
        reader.onload = () => {
          const data = String(reader.result || '').split(',')[1] || '';
          addAtt({ kind: 'pdf', name: f.name, mediaType: 'application/pdf', data, size: f.size });
        };
        reader.readAsDataURL(f);
      } else {
        addAtt({ kind: 'unsupported', name: f.name, size: f.size, reason: 'binary or > limit' });
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
    // Only a string may override the composer contents. Guard: passing this
    // straight to onClick would hand us a MouseEvent, and String(event) is
    // "[object Object]" — which is exactly what shipped to the model once.
    const override = typeof overrideText === 'string' ? overrideText : null;
    const text = String(override != null ? override : input).trim();
    if ((!text && attachments.length === 0) || busy) return;
    const att = attachments.slice();
    setMessages(prev => [...prev, { role: 'user', text, attachments: att }, { role: 'assistant', parts: [], inFlight: true }]);
    setInput('');
    setAttachments([]);
    setBusy(true);
    try {
      const payloadAtts = att
        .filter(a => a.kind === 'image' || a.kind === 'document' || a.kind === 'pdf')
        .map(a => a.kind === 'image'
          ? { kind: 'image', name: a.name, mediaType: a.mediaType, data: a.data }
          : a.kind === 'pdf'
            ? { kind: 'pdf', name: a.name, mediaType: a.mediaType || 'application/pdf', data: a.data }
            : { kind: 'document', name: a.name, content: a.content });
      // Context chips are UI sugar; on the wire they're still the [TODOUZ
      // SELECTION] block the agent's prompt already knows how to read.
      const ctxBlock = serializeSelection(att.filter(a => a.kind === 'context').map(a => a.ref));
      const outgoing = [ctxBlock, text].filter(Boolean).join('\n\n');
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: outgoing || '(see attachments)',
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
      style={{
        display: 'flex', flexDirection: 'column', height: '100%', position: 'relative',
        paddingBottom: kbInset, transition: 'padding-bottom 0.12s ease-out',
      }}
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
      <div ref={scrollerRef} style={{ flex: 1, overflowY: 'auto', paddingBottom: 12, minHeight: 0 }}>
        {hydrating && (
          <div style={{ fontSize: 12, color: T.textFaint, fontStyle: 'italic', padding: 14 }}>· loading saved transcript…</div>
        )}
        {!hydrating && messages.length === 0 && (
          <div style={{
            height: '100%', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '24px 28px', textAlign: 'center',
          }}>
            <div style={{ color: T.textFaint, display: 'inline-flex' }}><Icon kind="chat" size={26} /></div>
            <div style={{ fontFamily: T.fontDisplay, fontSize: 19, fontWeight: 600, color: T.text }}>
              What needs doing?
            </div>
            <div style={{ fontSize: 13, color: T.textFaint, lineHeight: 1.5, maxWidth: 320 }}>
              Plan meals, build a shopping list, break down an assignment, or just
              ask what's on today.
            </div>
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
      {/* ─── composer ─────────────────────────────────────────────────
          Claude-app shape: one rounded card floating over the thread. The
          textarea auto-grows with content (no drag bar, no fixed rows) and the
          controls sit on a row beneath it: + attach on the left, send circle
          on the right. */}
      <div style={{
        background: T.surface,
        border: `1px solid ${T.borderStrong}`,
        borderRadius: 24,
        boxShadow: T.shadow,
        padding: '10px 10px 8px 14px',
        display: 'flex', flexDirection: 'column', gap: 6,
      }}>
        <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }}
          onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }} />
        <textarea
          ref={taRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onPaste={onPaste}
          onKeyDown={e => {
            // Enter sends on desktop; on phones Enter must insert a newline
            // (the on-screen keyboard has no shift) — send via the button.
            const mob = window.matchMedia('(max-width: 768px)').matches;
            if (e.key === 'Enter' && (e.metaKey || (!mob && !e.shiftKey))) { e.preventDefault(); send(); }
          }}
          placeholder="Ask anything…"
          rows={1}
          disabled={busy}
          style={{
            width: '100%', boxSizing: 'border-box',
            background: 'transparent', border: 'none', outline: 'none',
            padding: '6px 4px 0', margin: 0,
            minHeight: 34,
            fontFamily: T.fontBody, fontSize: 16, color: T.text,
            lineHeight: 1.45, resize: 'none', overflowY: 'auto',
            maxHeight: '38dvh',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            title="attach a file or image"
            style={roundIconBtn(false)}
          ><Icon kind="plus" size={18} /></button>
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setLinkPickerOpen(o => !o)}
              disabled={busy}
              title="link a context file"
              style={roundIconBtn(false)}
            ><Icon kind="attach" size={16} /></button>
            {linkPickerOpen && (
              <div style={{
                position: 'absolute', bottom: '100%', left: 0, marginBottom: 8,
                background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10,
                boxShadow: T.shadowLg,
                minWidth: 260, maxWidth: '80vw', maxHeight: 240, overflowY: 'auto', zIndex: 10,
              }}>
                {contextFiles.length === 0 && <div style={{ padding: 10, fontSize: 12, color: T.textFaint }}>loading…</div>}
                {contextFiles.map(f => (
                  <button key={f.path} onClick={() => linkContextFile(f.path)} style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '9px 12px', background: 'transparent', border: 'none',
                    fontFamily: T.fontMono, fontSize: 12, color: T.text, cursor: 'pointer',
                  }}
                    onMouseEnter={(e) => e.currentTarget.style.background = T.surfaceHover}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >{f.label}</button>
                ))}
              </div>
            )}
          </div>
          <span style={{ flex: 1 }} />
          <button
            onClick={() => send()}
            disabled={busy || (!input.trim() && attachments.length === 0)}
            title={busy ? 'thinking…' : 'send'}
            style={{
              ...roundIconBtn(true),
              background: busy ? T.surface2 : ((input.trim() || attachments.length) ? T.accent : T.surface2),
              color: busy ? T.textFaint : ((input.trim() || attachments.length) ? '#fff' : T.textFaint),
              cursor: (!busy && (input.trim() || attachments.length)) ? 'pointer' : 'default',
            }}
          ><Icon kind="send" size={18} /></button>
        </div>
      </div>
    </div>
  );
}

// Circular control used in the composer row (Claude-app style).
function roundIconBtn(primary) {
  return {
    width: 34, height: 34, borderRadius: '50%',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: primary ? T.accent : T.surface2,
    color: primary ? '#fff' : T.textMuted,
    border: primary ? 'none' : `1px solid ${T.border}`,
    cursor: 'pointer', padding: 0, flexShrink: 0,
  };
}

const chipBtn = {
  background: T.surface, border: `1px solid ${T.border}`,
  padding: '5px 12px', fontFamily: T.fontBody, fontSize: 12, fontWeight: 500, color: T.textMuted,
  cursor: 'pointer', borderRadius: 6,
};

function AttachmentChip({ att, onRemove }) {
  const isImage = att.kind === 'image';
  const isDoc = att.kind === 'document';
  const isPdf = att.kind === 'pdf';
  const isContext = att.kind === 'context';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '4px 10px', borderRadius: 6,
      background: isContext ? T.accentSoft : T.surface,
      border: `1px solid ${isContext ? withAlpha(T.accent, 0.35) : T.border}`,
      fontSize: 12, color: isContext ? T.accent : T.text,
      fontFamily: isContext ? T.fontMono : T.fontBody,
    }}>
      {isImage && <img src={att.dataUrl} alt={att.name} style={{ width: 24, height: 24, objectFit: 'cover', borderRadius: 4 }} />}
      <span style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {!isImage && !isContext && ((isDoc || isPdf) ? '📄 ' : '⚠ ')}{att.name}
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
        {/* Show what was attached — images inline, other files as chips — so the
            transcript reflects exactly what was sent to the agent. */}
        {m.attachments && m.attachments.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: m.text ? 8 : 0 }}>
            {m.attachments.map((a, i) => (a.kind === 'image' && a.dataUrl) ? (
              <img key={i} src={a.dataUrl} alt={a.name || 'image'}
                style={{ maxWidth: 180, maxHeight: 180, borderRadius: 8, border: `1px solid ${T.border}`, objectFit: 'cover', display: 'block' }} />
            ) : (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '5px 10px', background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, color: T.textMuted }}>
                📎 {a.name || 'file'}
              </span>
            ))}
          </div>
        )}
        {m.text ? <Md text={m.text} /> : null}
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
function DayPopover({ date, onClose, onSelectIssue, onTbAction, onChanged }) {
  const isMobile = useIsMobile();
  const [day, setDay] = dUseState(null);
  const reload = dUseRef(0);
  dUseEffect(() => {
    let alive = true;
    api('list_today', { date }).then(d => { if (alive) setDay(d); });
    return () => { alive = false; };
  }, [date, reload.current]);
  const refresh = () => {
    reload.current += 1;
    api('list_today', { date }).then(d => setDay(d));
    onChanged && onChanged();
  };

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
          <button onClick={onClose} style={drawerCloseStyle(isMobile)} aria-label="close">✕</button>
        </header>
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {!day && <div style={{ fontSize: 12, color: T.textFaint, fontStyle: 'italic' }}>loading…</div>}
          {day && rows.length === 0 && (
            <div style={{ fontSize: 13, color: T.textFaint, fontStyle: 'italic', padding: '8px 0' }}>
              Nothing scheduled for this day.
            </div>
          )}
          {day && rows.map((row, i) => (
            <window.DayItemRow
              key={i}
              row={row}
              onSelectIssue={(ref) => { onClose(); onSelectIssue(ref); }}
              onTbAction={onTbAction}
              enableQuickActions={true}
              onRefresh={refresh}
            />
          ))}
        </div>
      </div>
    </>
  );
}

// ─── TimeblockDrawer ──────────────────────────────────────────────────
// Full editor for a single timeblock — slides in from the right just like
// IssueDrawer. Lets the user edit:
//   • title (double-click)
//   • date (chip → mini calendar showing other blocks per day)
//   • start / end time (chip → time inputs; derived duration shown)
//   • linked issue (read-only chip → click to open IssueDrawer)
//   • free-form note (double-click textarea)
//   • subtasks (checklist, add / rename / toggle / delete)
//   • mark complete / delete in footer
//
// `block` is the initial server-side object. Edits go through update_timeblock and
// then we refetch the canonical row from the server so the UI never drifts.
function TimeblockDrawer({ blockId, onClose, onChanged, onOpenIssue }) {
  const headerOffset = useHeaderOffset();
  const isMobile = useIsMobile();
  const { width: tbWidth, dragHandle: tbHandle } = useDrawerWidth('timeblock', { defaultWidth: 520 });
  const [block, setBlock] = dUseState(null);
  const [busy, setBusy] = dUseState(false);
  const [editingTitle, setEditingTitle] = dUseState(false);
  const [titleDraft, setTitleDraft] = dUseState('');
  const [editingNote, setEditingNote] = dUseState(false);
  const [noteDraft, setNoteDraft] = dUseState('');
  const [editingWhen, setEditingWhen] = dUseState(false);  // one editor for date+start+end
  const [editingRecurring, setEditingRecurring] = dUseState(false);
  const [dateDraft, setDateDraft] = dUseState('');
  const [startDraft, setStartDraft] = dUseState('');
  const [endDraft, setEndDraft] = dUseState('');

  const refetch = async () => {
    // No get_timeblock endpoint; use list_timeblocks with a wide range and filter client-side.
    const r = await api('list_timeblocks', { from_date: '2020-01-01', to_date: '2030-12-31' });
    const b = (r.blocks || []).find(x => x.id === blockId);
    setBlock(b || null);
  };

  dUseEffect(() => {
    refetch();
  }, [blockId]);

  dUseEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const patch = async (p) => {
    setBusy(true);
    try {
      const r = await api('update_timeblock', { id: blockId, patch: p });
      if (r.error) { alert('save failed: ' + r.error); return; }
      onChanged && onChanged();
      await refetch();
    } finally { setBusy(false); }
  };

  const doComplete = async () => {
    setBusy(true);
    try { await api('complete_timeblock', { id: blockId }); onChanged && onChanged(); await refetch(); }
    finally { setBusy(false); }
  };
  const doReopen = async () => {
    // Re-opening just clears completed flag via update_timeblock
    await patch({ completed: false, completed_at: null });
  };
  const doDelete = async () => {
    if (!block) return;
    if (!confirm(`Delete "${block.title}"?`)) return;
    setBusy(true);
    try { await api('delete_timeblock', { id: blockId }); onChanged && onChanged(); onClose(); }
    finally { setBusy(false); }
  };

  // Subtask helpers — patch the whole array (the backend replaces it).
  const setSubtasks = async (next) => patch({ subtasks: next });

  const toggleSub = async (i) => {
    const next = [...(block.subtasks || [])];
    next[i] = { ...next[i], done: !next[i].done };
    await setSubtasks(next);
  };
  const editSub = async (i, newText) => {
    if (!newText.trim()) return;
    const next = [...(block.subtasks || [])];
    next[i] = { ...next[i], text: newText.trim() };
    await setSubtasks(next);
  };
  const deleteSub = async (i) => {
    const next = [...(block.subtasks || [])];
    next.splice(i, 1);
    await setSubtasks(next);
  };
  const addSub = async (text) => {
    if (!text.trim()) return;
    const next = [...(block.subtasks || []), { text: text.trim(), done: false }];
    await setSubtasks(next);
  };

  if (!block) {
    return (
      <>
        <div onClick={onClose} style={{ position: 'fixed', top: headerOffset, right: 0, bottom: 0, left: 0, background: 'rgba(26,23,20,0.32)', zIndex: 200 }} />
        <aside style={timeblockDrawerStyle(undefined, tbWidth, headerOffset)}>
          {tbHandle}
          <div style={{ padding: 24, color: T.textMuted, fontSize: 13 }}>loading timeblock…</div>
        </aside>
      </>
    );
  }

  const c = block.epic_slug ? epicColor(block.epic_slug, block.epic_slug.split('/')[0]) : T.textMuted;
  const dur = computeDuration(block.start, block.end);

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', top: headerOffset, right: 0, bottom: 0, left: 0, background: 'rgba(26,23,20,0.32)', zIndex: 200 }} />
      <aside style={timeblockDrawerStyle(c, tbWidth, headerOffset)}>
        {tbHandle}
        <style>{`@keyframes slidein { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>
        <header style={{
          padding: '18px 22px 14px', borderBottom: `1px solid ${T.border}`,
          display: 'flex', alignItems: 'flex-start', gap: 10,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontFamily: T.fontMono, fontSize: 11, color: c,
                padding: '2px 8px', background: withAlpha(c, 0.08), borderRadius: 999,
              }}>
                <window.Icon kind="work" size={11} />
                {block.epic_slug ? block.epic_slug.split('/')[1] : 'unscheduled'}
              </span>
              {block.issue_id && (
                <button
                  onClick={() => onOpenIssue && onOpenIssue({ id: block.issue_id, epic_slug: block.epic_slug })}
                  style={{
                    fontFamily: T.fontMono, fontSize: 11, color: T.text,
                    padding: '2px 8px', background: T.surface2, border: `1px solid ${T.border}`,
                    borderRadius: 999, cursor: 'pointer',
                  }}
                  title="open linked item"
                >→ {block.issue_id}</button>
              )}
              {block.completed && (
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
                autoFocus
                onBlur={async () => {
                  if (titleDraft.trim() && titleDraft.trim() !== block.title) await patch({ title: titleDraft.trim() });
                  setEditingTitle(false);
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                  else if (e.key === 'Escape') { setEditingTitle(false); }
                }}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  fontFamily: T.fontDisplay, fontSize: 22, fontWeight: 600, lineHeight: 1.2,
                  background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 6, padding: '4px 8px',
                  color: T.text, outline: 'none',
                }}
              />
            ) : (
              <h2
                onDoubleClick={() => { setTitleDraft(block.title); setEditingTitle(true); }}
                style={{
                  fontFamily: T.fontDisplay, fontSize: 22, fontWeight: 600, lineHeight: 1.2,
                  letterSpacing: '-0.015em', margin: 0, userSelect: 'text',
                }}
                title="double-click to rename"
              >{block.title}</h2>
            )}
          </div>
          <button onClick={onClose} style={drawerCloseStyle(isMobile)} aria-label="close">✕</button>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* When — one editor: type date/start/end, or tap 📅 to place it against the schedule. */}
          <Field label="When">
            {editingWhen ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <DateTimeField mode="session" date={dateDraft} start={startDraft} end={endDraft}
                  onChange={(p) => { if ('date' in p) setDateDraft(p.date); if ('start' in p) setStartDraft(p.start); if ('end' in p) setEndDraft(p.end); }} />
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button onClick={async () => {
                    const p = {};
                    if (dateDraft && dateDraft !== block.date) p.date = dateDraft;
                    if (startDraft && startDraft !== block.start) p.start = startDraft;
                    if (endDraft && endDraft !== block.end) p.end = endDraft;
                    if (Object.keys(p).length) await patch(p);
                    setEditingWhen(false);
                  }} style={primaryBtn(true)}>Save</button>
                  <button onClick={() => setEditingWhen(false)} style={secondaryBtn()}>Cancel</button>
                </div>
              </div>
            ) : (
              <button onClick={() => { setDateDraft(block.date); setStartDraft(block.start); setEndDraft(block.end); setEditingWhen(true); }} style={whenChip()} title="click to change when">
                <window.Icon kind="event" size={12} />
                <span style={{ fontFamily: T.fontMono }}>{block.date}</span>
                <span style={{ color: T.textFaint }}>·</span>
                <span style={{ fontFamily: T.fontMono }}>{block.start}–{block.end}</span>
                <span style={{ color: T.textFaint, fontFamily: T.fontMono }}>· {dur}h</span>
              </button>
            )}
          </Field>

          {/* Reminder — a push notification this many minutes before the session start. */}
          <Field label="Remind me">
            <select value={String(block.reminder || '')}
              onChange={async e => { await patch({ reminder: e.target.value ? Number(e.target.value) : null }); }}
              style={{ background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 8, padding: '7px 10px', fontFamily: T.fontBody, fontSize: 13, color: T.text, outline: 'none', cursor: 'pointer' }}>
              <option value="">No reminder</option>
              <option value="5">5 min before</option>
              <option value="10">10 min before</option>
              <option value="30">30 min before</option>
              <option value="60">1 hour before</option>
              <option value="120">2 hours before</option>
              <option value="1440">1 day before</option>
            </select>
          </Field>

          {/* Description (formerly "Note") — the canonical content for this session.
              Markdown supported, including `- [ ]` checklists for in-block steps. */}
          <Field label="Description">
            {editingNote ? (
              <>
                <textarea
                  value={noteDraft}
                  autoFocus
                  onChange={e => setNoteDraft(e.target.value)}
                  rows={Math.min(16, Math.max(6, noteDraft.split('\n').length + 1))}
                  onKeyDown={async e => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      await patch({ note: noteDraft });
                      setEditingNote(false);
                    } else if (e.key === 'Escape') { setEditingNote(false); }
                  }}
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 8,
                    padding: 12, fontFamily: T.fontMono, fontSize: 13, color: T.text,
                    outline: 'none', resize: 'vertical', lineHeight: 1.5,
                  }}
                />
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <button onClick={async () => { await patch({ note: noteDraft }); setEditingNote(false); }} style={primaryBtn(true)}>Save</button>
                  <button onClick={() => setEditingNote(false)} style={secondaryBtn()}>Cancel</button>
                  <span style={{ flex: 1 }} />
                  {!window.matchMedia('(max-width: 768px)').matches && <span style={{ fontSize: 11, color: T.textFaint, alignSelf: 'center' }}><kbd>⌘↵</kbd> save</span>}
                </div>
              </>
            ) : (
              <div
                onDoubleClick={() => { setNoteDraft(block.note || ''); setEditingNote(true); }}
                onClick={() => { if (!block.note) { setNoteDraft(''); setEditingNote(true); } }}
                style={{ minHeight: 60, userSelect: 'text', cursor: block.note ? 'default' : 'text' }}
                title="double-click to edit"
              >
                {block.note
                  ? <Md text={block.note} />
                  : <span style={{ fontSize: 13, color: T.textFaint, fontStyle: 'italic' }}>+ add description (markdown supported · use `- [ ]` for in-session steps)</span>}
              </div>
            )}
          </Field>

          {/* Steps removed — the description (above) now holds the in-block checklist as
              markdown `- [ ]` lines. One canonical place for content per entity. */}
        </div>

        <footer style={{
          padding: '14px 22px', borderTop: `1px solid ${T.border}`,
          background: T.surface, display: 'flex', gap: 10, alignItems: 'center',
        }}>
          {!block.completed ? (
            <button onClick={doComplete} disabled={busy} style={{
              background: T.done, color: '#fff', border: 'none',
              padding: '9px 18px', fontFamily: T.fontBody, fontSize: 13, fontWeight: 500,
              cursor: busy ? 'wait' : 'pointer', borderRadius: 8,
            }}>{busy ? '…' : 'Mark done'}</button>
          ) : (
            <button onClick={doReopen} disabled={busy} style={{
              background: 'transparent', color: T.textMuted, border: `1px solid ${T.border}`,
              padding: '9px 18px', fontFamily: T.fontBody, fontSize: 13, fontWeight: 500,
              cursor: busy ? 'wait' : 'pointer', borderRadius: 8,
            }}>Reopen</button>
          )}
          <button onClick={doDelete} disabled={busy} style={{
            background: 'transparent', color: T.overdue, border: `1px solid ${T.border}`,
            padding: '9px 14px', fontFamily: T.fontBody, fontSize: 13, fontWeight: 500,
            cursor: busy ? 'wait' : 'pointer', borderRadius: 8,
          }}>Delete</button>
          <span style={{ flex: 1 }} />
          {/* A phone has no esc key — give the footer a real Close button. */}
          {window.matchMedia('(max-width: 768px)').matches ? (
            <button onClick={onClose} style={{
              background: 'transparent', border: `1px solid ${T.border}`, borderRadius: 8,
              color: T.text, fontFamily: T.fontBody, fontSize: 13, fontWeight: 500,
              padding: '9px 16px', cursor: 'pointer',
            }}>Close</button>
          ) : (
            <span style={{ fontSize: 11, color: T.textFaint }}><kbd>esc</kbd> close</span>
          )}
        </footer>
      </aside>
    </>
  );
}

function timeblockDrawerStyle(c, width, headerOffset = 0) {
  const w = width != null
    ? Math.min(width, Math.round(window.innerWidth * (window.matchMedia('(max-width: 768px)').matches ? 1 : 0.95)))
    : 'min(520px, 92vw)';
  return {
    position: 'fixed', top: headerOffset, right: 0, bottom: 0,
    width: w,
    background: T.surface,
    borderLeft: `4px dashed ${c || T.textMuted}`,
    boxShadow: T.shadowLg,
    zIndex: 201,
    display: 'flex', flexDirection: 'column',
    animation: 'slidein 0.2s ease-out',
  };
}
function whenChip() {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    background: T.surface2, border: `1px solid ${T.border}`,
    borderRadius: 999, padding: '6px 12px',
    fontFamily: T.fontBody, fontSize: 13, color: T.text, cursor: 'pointer',
  };
}
function timeInputStyle() {
  return {
    background: T.surface2, border: `1px solid ${T.borderStrong}`, borderRadius: 6,
    padding: '5px 8px', fontFamily: T.fontMono, fontSize: 13, color: T.text, outline: 'none',
  };
}
function computeDuration(start, end) {
  const [sh, sm] = String(start).split(':').map(Number);
  const [eh, em] = String(end).split(':').map(Number);
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60; // overnight
  return (mins / 60).toFixed(mins % 60 === 0 ? 0 : 1);
}

// Subtask row tailored for timeblocks (similar to SubtaskRow for issues, but
// edits patch the whole array via the parent's setSubtasks).
function TimeblockSubtaskRow({ s, busy, onToggle, onEdit, onDelete }) {
  const isMobile = useIsMobile();
  const [editing, setEditing] = dUseState(false);
  const [draft, setDraft] = dUseState(s.text);
  const [hover, setHover] = dUseState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10,
        padding: '6px 0', opacity: s.done ? 0.5 : 1,
      }}
    >
      <div
        onClick={() => !busy && !editing && onToggle()}
        style={{
          width: 16, height: 16, marginTop: 1, flexShrink: 0,
          border: `1.5px solid ${s.done ? T.done : T.borderStrong}`,
          background: s.done ? T.done : 'transparent',
          borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontSize: 11, fontWeight: 700, cursor: busy ? 'wait' : 'pointer',
        }}
      >{s.done && '✓'}</div>
      {editing ? (
        <input
          autoFocus value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => { setEditing(false); onEdit(draft); }}
          onKeyDown={e => {
            if (e.key === 'Enter') { setEditing(false); onEdit(draft); }
            else if (e.key === 'Escape') { setDraft(s.text); setEditing(false); }
          }}
          style={{
            flex: 1, background: T.surface2, border: `1px solid ${T.borderStrong}`,
            borderRadius: 4, padding: '3px 8px',
            fontFamily: T.fontBody, fontSize: 14, color: T.text, outline: 'none',
          }}
        />
      ) : (
        <div
          onDoubleClick={() => { setDraft(s.text); setEditing(true); }}
          title="double-click to rename"
          style={{
            flex: 1, fontSize: 14, color: T.text,
            textDecoration: s.done ? 'line-through' : 'none', lineHeight: 1.45,
            cursor: 'text', userSelect: 'text',
          }}
        >{s.text}</div>
      )}
      {!editing && (hover || isMobile) && (
        <button onClick={onDelete} title="delete step" style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: T.overdue, fontSize: isMobile ? 16 : 13, lineHeight: 1,
          padding: isMobile ? '0 8px' : '0 4px',
          minWidth: isMobile ? 32 : 0, minHeight: isMobile ? 32 : 0,
        }}>✕</button>
      )}
    </div>
  );
}

// ─── EpicTagEditor ────────────────────────────────────────────────────
// Standalone editor for an epic's short slug — the "tag" that shows on every
// linked issue (e.g. `lyra-application`). Renamed via update_epic({short_slug}),
// which cascades through directory rename + timeblock + completion + counter
// rewrites. The drawer closes on success because its `slug` prop is now stale.
function EpicTagEditor({ epic, slug, onRenamed }) {
  const [editing, setEditing] = dUseState(false);
  const [draft, setDraft] = dUseState('');
  const [busy, setBusy] = dUseState(false);
  if (!epic) return <span style={{ fontSize: 12, color: T.textFaint }}>loading…</span>;
  const currentShort = epic.slug.split('/')[1] || '';

  if (!editing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <code style={{
          fontFamily: T.fontMono, fontSize: 13, color: T.text,
          padding: '5px 12px', background: T.surface2,
          border: `1px solid ${T.border}`, borderRadius: 6,
        }}>{currentShort}</code>
        <button
          onClick={() => { setDraft(currentShort); setEditing(true); }}
          style={{
            background: T.surface, color: T.text,
            border: `1px solid ${T.border}`, borderRadius: 6,
            padding: '5px 12px', cursor: 'pointer',
            fontFamily: T.fontBody, fontSize: 12, fontWeight: 500,
          }}
        >Rename tag…</button>
        <span style={{ fontSize: 11, color: T.textFaint }}>
          Renaming updates the chip on every linked issue + timeblock.
        </span>
      </div>
    );
  }
  const submit = async () => {
    if (busy) return;
    const t = draft.trim().replace(/^-+|-+$/g, '');
    if (!t) { setEditing(false); return; }
    if (t === currentShort) { setEditing(false); return; }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(t)) {
      alert('tag must be lowercase letters / digits / dashes (e.g. "lyra-app")');
      return;
    }
    setBusy(true);
    try {
      const r = await api('update_epic', { slug, patch: { short_slug: t } });
      if (r?.error) { alert(r.error); setBusy(false); return; }
      onRenamed && onRenamed(r);
    } catch (err) {
      alert(err.message || 'rename failed');
      setBusy(false);
    }
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
        placeholder="new-tag"
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); submit(); }
          else if (e.key === 'Escape') setEditing(false);
        }}
        style={{
          fontFamily: T.fontMono, fontSize: 13, color: T.text,
          padding: '6px 12px', background: T.surface,
          border: `1px solid ${T.accent}`, borderRadius: 6, outline: 'none',
          width: 220,
        }}
      />
      <button onClick={submit} disabled={busy || !draft.trim()} style={primaryBtn(!busy && !!draft.trim())}>
        {busy ? '…' : 'Rename'}
      </button>
      <button onClick={() => setEditing(false)} style={secondaryBtn()}>Cancel</button>
      <span style={{ fontSize: 11, color: T.textFaint, width: '100%' }}>
        Lowercase letters/digits/dashes only. The change cascades through
        timeblocks, completion history, and the issue counter.
      </span>
    </div>
  );
}

// ─── EpicDrawer ───────────────────────────────────────────────────────
// Full epic detail: edit title / body, list all issues (open + completed),
// browse arbitrary files in the epic folder, delete or archive issues.
function EpicDrawer({ slug, onClose, onSelectIssue, onChanged, onDeleted }) {
  const headerOffset = useHeaderOffset();
  const { width: epicWidth, dragHandle: epicHandle } = useDrawerWidth('epic', { defaultWidth: 680 });
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
  const [editingCategory, setEditingCategory] = dUseState(false);
  const [categoryDraft, setCategoryDraft] = dUseState('');
  const [creatingNewCategory, setCreatingNewCategory] = dUseState(false);
  const [knownCategories, setKnownCategories] = dUseState([]);
  const [editingShort, setEditingShort] = dUseState(false);
  const [shortDraft, setShortDraft] = dUseState('');

  dUseEffect(() => {
    if (editingCategory) {
      api('list_categories').then(r => setKnownCategories(r.categories || [])).catch(() => {});
    }
  }, [editingCategory]);

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
    const onKey = e => { if (e.key === 'Escape') { if (window.__editorFullscreen) return; const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return; onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const c = epic ? epicColor(epic.slug, epic.category) : T.textMuted;

  // Recolour this folder — persists on the epic + repaints every calendar/list
  // accent for it. Empty string clears the override (back to the category colour).
  const setEpicColor = async (color) => {
    try {
      await api('update_epic', { slug, patch: { color: color || '' } });
      await refresh();               // update the swatch highlight in this drawer
      onChanged && onChanged();       // repopulate EPIC_COLORS + repaint the calendar
    } catch (e) { alert('colour update failed: ' + (e?.message || e)); }
  };

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
      <div onClick={onClose} style={{ position: 'fixed', top: headerOffset, right: 0, bottom: 0, left: 0, background: 'rgba(26,23,20,0.32)', zIndex: 200 }} />
      <aside style={{
        position: 'fixed', top: headerOffset, right: 0, bottom: 0,
        width: Math.min(epicWidth, Math.round((typeof window !== 'undefined' ? window.innerWidth : 1200) * 0.95)),
        background: T.surface, borderLeft: `1px solid ${T.border}`,
        boxShadow: T.shadowLg,
        zIndex: 201, display: 'flex', flexDirection: 'column',
        animation: 'slidein 0.2s ease-out',
      }}>
        {epicHandle}
        <header style={{ padding: '18px 22px 14px', borderBottom: `1px solid ${T.border}` }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
                {editingCategory ? (
                  <>
                    {creatingNewCategory ? (
                      <input
                        autoFocus
                        value={categoryDraft}
                        onChange={e => setCategoryDraft(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                        placeholder="new-list"
                        onKeyDown={async e => {
                          if (e.key === 'Enter') {
                            const t = categoryDraft.trim();
                            if (t && t !== epic.category && /^[a-z0-9][a-z0-9-]*$/.test(t)) {
                              try {
                                await api('update_epic', { slug, patch: { category: t } });
                                onChanged && onChanged();
                                onClose();
                              } catch (err) { alert(err.message || 'failed'); }
                            }
                            setEditingCategory(false); setCreatingNewCategory(false);
                          } else if (e.key === 'Escape') { setEditingCategory(false); setCreatingNewCategory(false); }
                        }}
                        onBlur={() => { setEditingCategory(false); setCreatingNewCategory(false); }}
                        style={{
                          fontFamily: T.fontMono, fontSize: 11, color: T.text,
                          padding: '2px 8px', background: T.surface2,
                          border: `1px solid ${T.border}`, borderRadius: 999, outline: 'none', width: 140,
                        }}
                      />
                    ) : (
                      <select
                        autoFocus
                        value={categoryDraft}
                        onChange={async e => {
                          const v = e.target.value;
                          if (v === '__new__') { setCreatingNewCategory(true); setCategoryDraft(''); return; }
                          if (v && v !== epic.category) {
                            try {
                              await api('update_epic', { slug, patch: { category: v } });
                              onChanged && onChanged();
                              onClose();
                            } catch (err) { alert(err.message || 'failed'); }
                          }
                          setEditingCategory(false);
                        }}
                        onBlur={() => setEditingCategory(false)}
                        style={{
                          fontFamily: T.fontMono, fontSize: 11, color: T.text,
                          padding: '2px 8px', background: T.surface2,
                          border: `1px solid ${T.border}`, borderRadius: 999, outline: 'none',
                        }}
                      >
                        {knownCategories.map(k => <option key={k} value={k}>{k}</option>)}
                        <option value="__new__">+ new list…</option>
                      </select>
                    )}
                  </>
                ) : (
                  <button
                    onClick={() => {
                      if (!epic) return;
                      setCategoryDraft(epic.category || '');
                      setEditingCategory(true);
                    }}
                    title="change list"
                    style={{
                      fontFamily: T.fontMono, fontSize: 11, color: c,
                      padding: '2px 8px', background: withAlpha(c, 0.08), borderRadius: 999,
                      border: 'none', cursor: 'pointer',
                    }}
                  >{epic?.category || '…'}</button>
                )}
                {/* Short-slug rename. Rendered as its own chip next to the category
                    chip so the editable affordance is unmistakable. The tag the user
                    sees on issue rows (lyra-application etc.) is this short slug —
                    renaming here renames it everywhere via update_epic's cascade. */}
                {editingShort ? (
                  <input
                    autoFocus
                    value={shortDraft}
                    onChange={e => setShortDraft(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                    placeholder="short-slug"
                    onKeyDown={async e => {
                      if (e.key === 'Enter') {
                        const t = shortDraft.trim().replace(/^-+|-+$/g, '');
                        const currentShort = epic.slug.split('/')[1];
                        if (t && t !== currentShort && /^[a-z0-9][a-z0-9-]*$/.test(t)) {
                          try {
                            const r = await api('update_epic', { slug, patch: { short_slug: t } });
                            if (r?.error) { alert(r.error); setEditingShort(false); return; }
                            onChanged && onChanged();
                            onClose();              // drawer's `slug` prop is now stale
                          } catch (err) { alert(err.message || 'rename failed'); }
                        }
                        setEditingShort(false);
                      } else if (e.key === 'Escape') {
                        setEditingShort(false);
                      }
                    }}
                    onBlur={() => setEditingShort(false)}
                    style={{
                      fontFamily: T.fontMono, fontSize: 11, color: T.text,
                      padding: '2px 8px', background: T.surface2,
                      border: `1px solid ${T.accent}`, borderRadius: 999, outline: 'none',
                      width: 200,
                    }}
                  />
                ) : (
                  <button
                    onClick={() => {
                      if (!epic) return;
                      setShortDraft(epic.slug.split('/')[1] || '');
                      setEditingShort(true);
                    }}
                    title="click to rename this slug (the tag shown on every item under this folder)"
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      fontFamily: T.fontMono, fontSize: 11, color: T.textMuted,
                      padding: '2px 8px',
                      background: T.surface2,
                      border: `1px dashed ${T.border}`, borderRadius: 999,
                      cursor: 'pointer',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = T.accent; e.currentTarget.style.color = T.text; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.textMuted; }}
                  >
                    {epic ? (epic.slug.split('/')[1] || '') : ''}
                    <span style={{ fontSize: 10, opacity: 0.6 }}>✎</span>
                  </button>
                )}
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
                {openTop.length} open item{openTop.length === 1 ? '' : 's'}
              </div>
            </div>
            <button onClick={onClose} style={{
              background: 'transparent', border: 'none', fontSize: 18, color: T.textMuted,
              cursor: 'pointer', padding: 4, lineHeight: 1, borderRadius: 4,
            }}>✕</button>
          </div>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Tag — the short slug that appears on every issue's chip. We surface
              the editor here too (not just the header chip) since users hunting
              for a "rename" action expect a labelled control inside the body. */}
          <Field label="Tag (shown on every linked item)">
            <EpicTagEditor
              epic={epic}
              slug={slug}
              onRenamed={() => { onChanged && onChanged(); onClose(); }}
            />
          </Field>

          {/* Per-folder colour — repaints this subject's calendar/plan blocks and
              list accents, overriding its category's default colour. */}
          <Field label="Colour (calendar + list accents)">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {FOLDER_PALETTE.map(hex => {
                const active = (epic?.color || '').toLowerCase() === hex.toLowerCase();
                return (
                  <button key={hex} onClick={() => setEpicColor(hex)} title={hex} aria-label={`set colour ${hex}`}
                    style={{
                      width: 26, height: 26, borderRadius: 8, background: hex, cursor: 'pointer', padding: 0,
                      border: `2px solid ${active ? T.text : 'transparent'}`,
                      boxShadow: active ? `0 0 0 2px ${T.surface}` : 'inset 0 0 0 1px rgba(0,0,0,0.12)',
                    }} />
                );
              })}
              <input type="color" value={epic?.color || c} onChange={e => setEpicColor(e.target.value)} title="custom colour"
                style={{ width: 30, height: 30, padding: 0, border: `1px solid ${T.border}`, borderRadius: 8, background: T.surface, cursor: 'pointer' }} />
              {epic?.color && (
                <button onClick={() => setEpicColor('')}
                  style={{ fontSize: 12, color: T.textMuted, background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 999, padding: '5px 11px', cursor: 'pointer' }}>
                  Reset to {epic.category} default
                </button>
              )}
            </div>
          </Field>

          {/* Long-form context */}
          <Field label="Context">
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
                  {!window.matchMedia('(max-width: 768px)').matches && <span style={{ fontSize: 11, color: T.textFaint, alignSelf: 'center' }}><kbd>⌘↵</kbd> save</span>}
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

          {/* Open items */}
          <Field label={`Open items (${openTop.length})`}>
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
                  }} title={`${childCount.get(it.id)} item${childCount.get(it.id) === 1 ? '' : 's'}`}>
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
                  placeholder="new item title… enter to create"
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
              }}>+ add item</button>
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
          >Delete folder</button>
          <span style={{ flex: 1 }} />
          {window.matchMedia('(max-width: 768px)').matches ? (
            <button onClick={onClose} style={{
              background: 'transparent', border: `1px solid ${T.border}`, borderRadius: 8,
              color: T.text, fontFamily: T.fontBody, fontSize: 13, fontWeight: 500,
              padding: '9px 16px', cursor: 'pointer',
            }}>Close</button>
          ) : (
            <span style={{ fontSize: 11, color: T.textFaint }}>
              <kbd>esc</kbd> close · double-click title to rename
            </span>
          )}
        </footer>
      </aside>
    </>
  );
}

// ─── ArchiveDrawer ────────────────────────────────────────────────────
// Search + browse all completed issues across every epic.
function ArchiveDrawer({ onClose, onSelectIssue }) {
  const headerOffset = useHeaderOffset();
  const isMobile = useIsMobile();
  const [issues, setIssues] = dUseState([]);
  const [query, setQuery] = dUseState('');
  const [daysBack, setDaysBack] = dUseState(90);
  const [loading, setLoading] = dUseState(true);

  dUseEffect(() => {
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      api('list_completed', { days_back: daysBack, query: query.trim() || undefined, limit: 500 })
        .then(j => { if (alive) { setIssues(j.issues || []); setLoading(false); } })
        .catch(() => { if (alive) setLoading(false); });
    }, 200);
    return () => { alive = false; clearTimeout(t); };
  }, [query, daysBack]);

  dUseEffect(() => {
    const onKey = e => { if (e.key === 'Escape') { if (window.__editorFullscreen) return; const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return; onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Group completed items by subject/folder (epic_slug); biggest folders first,
  // newest completion first within each.
  const groups = (() => {
    const m = new Map();
    for (const it of issues) { const k = it.epic_slug || '—'; if (!m.has(k)) m.set(k, []); m.get(k).push(it); }
    return [...m.entries()]
      .map(([slug, its]) => ({ slug, items: its.slice().sort((a, b) => (b.completed_at || '').localeCompare(a.completed_at || '')) }))
      .sort((a, b) => b.items.length - a.items.length || a.slug.localeCompare(b.slug));
  })();

  const itemRow = (it) => {
    const cc = epicColor(it.epic_slug, (it.epic_slug || '').split('/')[0]);
    return (
      <div key={`${it.epic_slug}:${it.id}`}
        onClick={() => { onClose(); onSelectIssue({ id: it.id, epic_slug: it.epic_slug }); }}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', background: T.surface, border: `1px solid ${T.border}`, borderLeft: `3px solid ${cc}`, borderRadius: 8, cursor: 'pointer', minWidth: 0 }}
        onMouseEnter={e => { e.currentTarget.style.background = T.surfaceHover; }}
        onMouseLeave={e => { e.currentTarget.style.background = T.surface; }}>
        <span style={{ fontFamily: T.fontMono, fontSize: 11, color: T.textFaint, flexShrink: 0 }}>{it.id}</span>
        <span style={{ flex: 1, fontSize: 13, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.title}</span>
        {it.completed_at && <span style={{ fontSize: 11, color: T.textMuted, fontFamily: T.fontMono, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{it.completed_at.slice(0, 10)}</span>}
      </div>
    );
  };

  const controls = (
    <>
      <input value={query} onChange={e => setQuery(e.target.value)} placeholder="search archived items…" autoFocus={!isMobile}
        style={{ flex: isMobile ? 1 : 'none', width: isMobile ? undefined : 260, background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 8, padding: '8px 12px', fontFamily: T.fontBody, fontSize: 13, color: T.text, outline: 'none' }} />
      <select value={daysBack} onChange={e => setDaysBack(parseInt(e.target.value, 10))}
        style={{ background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 8, padding: '8px 12px', fontFamily: T.fontBody, fontSize: 12, color: T.text, outline: 'none' }}>
        <option value={30}>last 30 days</option>
        <option value={90}>last 90 days</option>
        <option value={365}>last year</option>
        <option value={3650}>all time</option>
      </select>
    </>
  );

  const body = (
    <>
      {loading && <div style={{ fontSize: 13, color: T.textFaint, fontStyle: 'italic', padding: '8px 0' }}>loading…</div>}
      {!loading && issues.length === 0 && (
        <div style={{ fontSize: 13, color: T.textFaint, fontStyle: 'italic', padding: '8px 0' }}>{query ? 'no matches.' : 'nothing archived yet.'}</div>
      )}
      {groups.map(g => {
        const cc = epicColor(g.slug, (g.slug || '').split('/')[0]);
        const cat = (g.slug || '').split('/')[0], sub = (g.slug || '').split('/')[1] || g.slug;
        return (
          <section key={g.slug} style={{ marginBottom: 22 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8, position: 'sticky', top: 0, background: T.surface, padding: '4px 0', zIndex: 1 }}>
              <span style={{ width: 9, height: 9, borderRadius: 3, background: cc, alignSelf: 'center' }} />
              <h3 style={{ fontFamily: T.fontDisplay, fontSize: 15, fontWeight: 600, margin: 0, color: T.text }}>{sub}</h3>
              <span style={{ fontSize: 11, color: T.textFaint, fontFamily: T.fontMono }}>{cat}</span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 11, color: T.textMuted, fontFamily: T.fontMono }}>{g.items.length} done</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(340px, 1fr))', gap: 8 }}>
              {g.items.map(itemRow)}
            </div>
          </section>
        );
      })}
    </>
  );

  // Desktop: a wide centered page that uses the whole screen; mobile keeps the
  // familiar right-side drawer.
  if (!isMobile) {
    return (
      <>
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(26,23,20,0.4)', zIndex: 200 }} />
        <div onClick={e => e.stopPropagation()} style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          width: 'min(1120px, 94vw)', height: 'min(88vh, 920px)', background: T.surface,
          border: `1px solid ${T.border}`, borderRadius: 14, boxShadow: T.shadowLg,
          zIndex: 201, display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          <header style={{ padding: '18px 24px 14px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h2 style={{ fontFamily: T.fontDisplay, fontSize: 24, fontWeight: 600, margin: 0 }}>Archive</h2>
            <span style={{ fontFamily: T.fontMono, fontSize: 12, color: T.textFaint }}>{issues.length} done · {groups.length} folder{groups.length === 1 ? '' : 's'}</span>
            <span style={{ flex: 1 }} />
            {controls}
            <button onClick={onClose} aria-label="close" style={{ background: 'transparent', border: 'none', fontSize: 20, color: T.textMuted, cursor: 'pointer', lineHeight: 1, padding: 4 }}>✕</button>
          </header>
          <div style={{ flex: 1, overflowY: 'auto', padding: '18px 24px' }}>{body}</div>
        </div>
      </>
    );
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', top: headerOffset, right: 0, bottom: 0, left: 0, background: 'rgba(26,23,20,0.32)', zIndex: 200 }} />
      <aside style={{
        position: 'fixed', top: headerOffset, right: 0, bottom: 0, width: 'min(640px, 96vw)',
        background: T.surface, borderLeft: `1px solid ${T.border}`, boxShadow: T.shadowLg,
        zIndex: 201, display: 'flex', flexDirection: 'column', animation: 'slidein 0.2s ease-out',
      }}>
        <header style={{ padding: '18px 22px 14px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <h2 style={{ fontFamily: T.fontDisplay, fontSize: 22, fontWeight: 600, margin: 0 }}>Archive</h2>
          <span style={{ fontFamily: T.fontMono, fontSize: 12, color: T.textFaint }}>{issues.length} done</span>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} aria-label="close" style={{ background: 'transparent', border: 'none', fontSize: 18, color: T.textMuted, cursor: 'pointer', padding: 4, lineHeight: 1 }}>✕</button>
        </header>
        <div style={{ padding: '12px 22px', borderBottom: `1px solid ${T.border}`, display: 'flex', gap: 8, alignItems: 'center' }}>{controls}</div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 22px' }}>{body}</div>
      </aside>
    </>
  );
}

Object.assign(window, { IssueDrawer, AgentsDrawer, DayPopover, TimeblockDrawer, EpicDrawer, ArchiveDrawer });
