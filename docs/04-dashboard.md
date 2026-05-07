# 04 — Dashboard

## Layers (bottom-up)

```
┌─────────────────────────────────────────────────┐
│ 6. UI layer            React SPA, Babel-standalone, no build step
├─────────────────────────────────────────────────┤
│ 5. Auth layer          Reuses Claude CLI's OAuth (~/.claude/credentials)
├─────────────────────────────────────────────────┤
│ 4. Server layer        Express HTTP + stdio MCP, both wrap the same dispatcher
├─────────────────────────────────────────────────┤
│ 3. Tools layer         tools.mjs — the catalogue from docs/03
├─────────────────────────────────────────────────┤
│ 2. Parser layer        parsers.mjs — markdown ↔ in-memory model
├─────────────────────────────────────────────────┤
│ 1. Storage layer       Files: data/**/*.md + data/state/*.json
└─────────────────────────────────────────────────┘
```

Each layer talks **only** to the one directly below. Tests can drop in fakes at any seam.

### 1. Storage

Filesystem. `todouz/data/`. See `02-data-model.md` for the layout. No DB. Every write is a write-to-temp + atomic rename so a crash never leaves a half-file.

### 2. Parser

Pure functions: `parseEpic(md) → EpicAST`, `serializeEpic(ast) → md`, similar for issues. No IO. No globals. Trivially testable.

Three core ASTs:
- `EpicAST` — frontmatter + body markdown
- `IssuesAST` — array of `{ id, title, fields, description, subtasks, log_entries }`
- `IssueAST` — single issue (used after splitting IssuesAST)

The serializer preserves whitespace and comments from the original where possible — we don't want git diffs full of cosmetic churn.

### 3. Tools

`tools.mjs` exports `TOOLS` (catalogue) and `handleCall(name, args) → Promise<result>`. Implementations call into the parser + storage helpers. **Never** call out to anything else (no fetch, no SDK). This makes the tool layer easy to add to any host.

### 4. Server

Two entry points share `tools.mjs`:

- **`mcp-server/index.mjs`** — stdio MCP server. Used by `claude mcp add`. Wraps `handleCall` in the JSON-RPC shape MCP expects.

- **`mcp-server/http-server.mjs`** — Express. Two kinds of endpoints:
  - `/api/<tool_name>` — POST JSON body, calls `handleCall`. The dashboard hits these.
  - `/api/chat` — special: takes `{ message, agent, history?, attachments?, resumeSession?, taskCtx? }`. Spawns `query()` from `@anthropic-ai/claude-agent-sdk` with `mcpServers: { todouz: { command: 'node', args: [<index.mjs>] } }`, streams the events back as NDJSON. The SDK uses the same OAuth token from the keychain.

Both bind on port 8765 by default; HTTP serves the static SPA at `/dashboard/`.

### 5. Auth

The HTTP server probes the macOS Keychain for the `Claude Code-credentials` entry once (cached 60s). If present, the SDK auto-uses it. No Anthropic API key, no per-message billing.

When attached as an MCP to another Claude session, this layer is irrelevant — that session has its own auth.

### 6. UI

React 18 via CDN + Babel-standalone for inline JSX. Fast to ship, no toolchain. Files are `.jsx` served as-is and transformed in the browser.

Tradeoff: a full-page reload on dev edits, no minification. Acceptable for personal use. If we outgrow it, swap in Vite — the component code doesn't have to change.

---

## Top-level navigation — none

**One page, scroll vertically.** No tabs, no view switcher, no per-view URLs. Today, the week strip, all epics grouped by category, and the calendar live on the same long page in fixed order.

```
┌─────────────────────────────────────────────────────────────┐
│ TODOUZ    Mon 5 May 2026               [+ ask]  [settings]  │  ← header (fixed)
├─────────────────────────────────────────────────────────────┤
│ TODAY                                                        │
│   · due today  · recurring today  · events  · up next        │
├─────────────────────────────────────────────────────────────┤
│ THIS WEEK   (Mon │ Tue │ Wed │ Thu │ Fri │ Sat │ Sun)        │
├─────────────────────────────────────────────────────────────┤
│ EPICS                                                        │
│   ┌─ Studies ─┐  ┌─ Side Project ─┐  ┌─ Body ─┐ …            │
├─────────────────────────────────────────────────────────────┤
│ MONTH CALENDAR                                               │
└─────────────────────────────────────────────────────────────┘
```

Two overlays slide in from the right when needed:

- **IssueDrawer** — clicking any issue card. Sub-tasks, description, hand-off to chat, complete button.
- **AgentsDrawer** — pressing space, or `+ ask` in the header. The single chat surface for any agent.

Both close on `esc` or click-outside. They don't navigate away from the page.

---

## Component tree

```
App
├── Header
│   ├── DateLine
│   ├── AskButton           opens AgentsDrawer (scheduler default)
│   └── SettingsButton
├── TodaySection
│   ├── DueTodayList
│   ├── RecurringTodayList
│   ├── EventsTodayList
│   └── UpNextPanel             (top 3 future open issues — recomputed live)
├── WeekStrip                    (Mon–Sun mini cards, click → IssueDrawer or DayPopover)
├── EpicsGrid                    (category columns, each shows its epics + open issues)
│   └── CategoryColumn × N
│       └── EpicCard
│           ├── EpicHeader       (title, agent owner, open count)
│           ├── ProgressionLine  (recurring only — last 3 logs)
│           └── IssueList        (open issues, click → IssueDrawer)
├── CalendarMonth                (month grid; click a day → DayPopover)
├── IssueDrawer (slide-in, right side, overlay — does NOT navigate)
│   ├── IssueHeader              (id, title, owner, due, priority badges)
│   ├── DescriptionEditor
│   ├── SubTaskList
│   ├── RecurrenceLog            (only for recurring)
│   ├── LinkedFilesList
│   ├── HandoffToAgent           "discuss this with <agent>" → AgentsDrawer w/ seed
│   └── CompleteButton
└── AgentsDrawer (slide-out, full-height, the universal chat surface)
    ├── AgentsList               (left rail — scheduler highlighted)
    ├── SessionsList             (per-agent, with timestamps)
    └── ChatPanel                (NDJSON stream, attachments, cancel)
```

---

## Flows

### F1 — see what's due today

Open dashboard → defaults to TodayView → see DueTodayList. Cards link to IssueDrawer for sub-task ticking.

### F2 — quick brain-dump

Anywhere → press space → AgentsDrawer opens at scheduler with empty input → type "i had sprint planning for CS-401, need to review architecture, finalize tech stack, build a diagram, and write the week 9 report by Tue" → enter → scheduler reads the dump, calls `create_issue` 3–4 times under the right epic with sub-tasks, summarises in 2 lines. Dashboard refetches automatically when the chat stream ends.

### F3 — drill into an epic

Header → "epics" → CategoryColumn for body → EpicCard "Gym" → EpicDetailView shows epic.md (the plan, current weights, observations) + the recurring issue list. Click "Push day session" → IssueDrawer with the default itinerary + log of past sessions.

### F4 — log a gym session

After the workout, open the Gym epic's "Push day" issue → click "Discuss with body" in IssueDrawer → AgentsDrawer opens with card context → type "did 40min today, bench 30/40/40, biceps 8kg×12 throughout, tris 4kg×15. felt OK on chest, biceps fading by set 3. progressive overload: bench up next week" → body agent calls `log_recurrence` (writes to completion + ### Log) AND `append_to_project` ("Bench: hit 40×8 first time on Mon 5/4. Next aim 42.5×6."). Dashboard refetches.

### F5 — modify from another Claude session

In `~/Documents/University/CS-401/` run `claude` → `claude mcp` includes todouz → say "todouz: add an issue under thetas to ship Stripe integration by Friday, priority high" → tool fires → switch back to dashboard → refetch → new issue under `side-project/thetas`.

### F6 — calendar planning

Header → "calendar" → see a month grid. Click May 22 → DayCell expands showing all issues + events. Click an issue → IssueDrawer.

---

## State management (UI)

- **Server-truthful state**: epics, issues, sessions. Fetched from `/api/*`. Cached in a top-level `useDashboardData()` hook. Re-fetched on:
  - initial mount
  - chat stream completion
  - explicit user refresh
- **UI-only state**: which view, which drawer is open, hover popovers, expanded/collapsed sections. `useState` per component or a tiny `useUIState()` hook for cross-component (e.g. "is the AgentsDrawer open?").
- **localStorage**: `todouz.lastView`, `todouz.lastAgent`, `todouz.epicCollapseState` — purely cosmetic.

Conflict resolution: server is always right after a refetch. Optimistic UI updates are allowed for sub-task toggles (instant visual flip, then sync) but not for issue creation.

---

## Performance budget

This is a personal tool with maybe ~200 issues max. Performance is not a constraint — the parsers can be naive. Targets:

- Initial dashboard load: **< 500ms** to first paint.
- After chat completion, refetch: **< 200ms**.
- list_today: **< 50ms** server-side.

---

## What we explicitly don't do (UI)

- No drag-and-drop reordering. (Issues are sorted by due date / priority, computed.)
- No inline issue creation from a list — always go through the drawer or the agent. Forces structure.
- No notifications. (Unless we wire a separate background runner — out of scope for MVP.)
- No themes. One look, the same as the prototype's warm-paper aesthetic.
