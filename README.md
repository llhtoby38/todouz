# todouz

An **ADHD-friendly task manager** with epics, sub-issues, time-blocks, and an MCP server, so any Claude Code / Claude Desktop / Cursor session can read and write your tasks alongside you.

> 🔧 This is a personal tool I'm sharing publicly — not a polished product. Expect rough edges. PRs welcome.

## Why it exists

Most productivity tools assume you'll plan once and execute. ADHD brains don't work that way. todouz is built around three principles that actually work:

- **Energy-based, not calendar-based.** Tasks surface based on where they fit in your day's energy, not on rigid schedules you'll abandon by Tuesday.
- **Capture, don't act.** Press a key, dump your thoughts, get back to what you were doing. The agent processes the dump into structured work later.
- **Body-doubling with agents.** Multiple Claude sessions can attach to your todouz via MCP and collaborate on your data — leaving notes for each other in epic folders, breaking down work into sub-issues, scheduling time-blocks. Single-player productivity tool, multiplayer execution.

## Features

- **Hierarchical task model**: Categories → Epics → Issues → Sub-issues → Sub-tasks. Arbitrary nesting depth.
- **Recurring as instances**: A weekly gym session this week is a separate object from next week's, so progressive overload doesn't bleed.
- **Time-blocks**: planned work sessions distinct from issues and events. Surface on your calendar.
- **Markdown-on-disk**: every issue, epic, and note lives as plain markdown under `data/`. Git-friendly, hand-editable, exportable. No SQL.
- **Energy-based "today" view**: due-today + recurring-today + planned blocks merged into one chronological list, not three competing widgets.
- **Single-page web dashboard**: editorial-modern UI (Fraunces + Onest + JetBrains Mono), single-page vertical scroll, sliding drawers for issue and epic detail.
- **Universal agent chat**: built-in chat surface backed by `@anthropic-ai/claude-agent-sdk` — uses your local Claude CLI's OAuth subscription token (no API key, no per-message billing) when available.
- **MCP server**: 38+ tools exposing the same data layer to any external Claude session. Add it to your Claude Code or Claude Desktop config and modify your tasks from anywhere.
- **Archive view**: search across every completed issue with date-range filter.

## Tech stack

- Node.js 20+
- Express 5 (HTTP API + dashboard static serving)
- React 18 via CDN + Babel-standalone (no build step for the SPA)
- `@modelcontextprotocol/sdk` (stdio MCP server)
- `@anthropic-ai/claude-agent-sdk` (in-dashboard chat)
- Markdown + JSON files on disk

## Run locally

```bash
git clone https://github.com/llhtoby38/todouz.git
cd todouz
npm install
npm run seed          # one-time: copy starter agent templates into data/
npm run start         # foreground; or use ./start.sh --background
open http://localhost:8765/dashboard/
```

The server listens on port 8765 by default. Override with `PORT=9000 npm start`.

### Auth

The in-dashboard chat surface tries to use your local **Claude Pro/Max subscription** via the OAuth token the Claude CLI keeps in your OS keychain. If that's not present, the SDK falls back to `ANTHROPIC_API_KEY` from your environment. If neither is configured, only the read/write tooling works — chat won't.

To install the Claude CLI: <https://docs.anthropic.com/claude-code>

## MCP integration

Wire todouz into any other Claude Code session so you can edit your tasks from your terminal, your editor, or anywhere else on disk.

**For Claude Code (user-scoped, available everywhere):**

```bash
claude mcp add todouz \
  --scope user \
  -- \
  node /absolute/path/to/todouz/mcp-server/index.mjs
```

Then in any Claude Code session: *"todouz: list today's items and tell me what to focus on"* — and the agent will call `list_today` + `whats_next` and act on the results.

**For Claude Desktop**, add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "todouz": {
      "command": "node",
      "args": ["/absolute/path/to/todouz/mcp-server/index.mjs"]
    }
  }
}
```

**For Cursor**, add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "todouz": {
      "command": "node",
      "args": ["/absolute/path/to/todouz/mcp-server/index.mjs"]
    }
  }
}
```

Once attached, the external session has access to all 38+ tools: `list_today`, `create_issue`, `create_subissue`, `add_timeblock`, `complete_issue`, `update_epic`, `get_full_context` (one-shot dump of the user's full state), and so on. See `docs/03-mcp-tools.md` for the full catalogue.

## Project layout

```
todouz/
├── dashboard/           single-page React SPA (no build step)
├── mcp-server/          stdio MCP + Express HTTP server
│   ├── index.mjs        stdio MCP entry
│   ├── http-server.mjs  HTTP API + dashboard static serving + chat streaming
│   ├── tools.mjs        38+ tool implementations + JSON-RPC catalogue
│   ├── parsers.mjs      pure markdown ↔ AST conversion
│   └── store.mjs        atomic file IO
├── data/                YOUR personal data (gitignored — every user has their own)
├── examples/            starter templates copied to data/ on first run
└── docs/                architecture + data-model + tools + dashboard spec
```

## Data model

Every actionable thing is an **Issue** under exactly one **Epic** under one of six **Categories**: studies, side-project, body, kitchen, future-planning, personal. Issues can nest into sub-issues with their own sub-tasks. Recurring issues materialise as per-date instances so editing one doesn't bleed into the next occurrence. Time-blocks are planned work sessions linked to issues. Schedules are derived views, never stored.

Read `docs/02-data-model.md` for the full ER diagram + on-disk file shapes.

## Customising your agents

The agent personalities live in `data/agents/<name>/system-prompt.md`. The starter templates in `examples/` cover a few common roles (scheduler, planner). Edit them to match your work. Each agent runs in its own folder cwd, so its system prompt + identity feed into every chat session.

## Caveats

- **Single user, single machine.** No auth, no multi-tenancy. The data dir is per-machine on disk.
- **macOS-first for the OAuth detection.** The Keychain probe for the Claude CLI's credentials only runs on macOS; Linux/Windows users will need to set `ANTHROPIC_API_KEY` for the in-dashboard chat to work.
- **The SPA loads via CDN.** Babel-standalone + React UMD bundles transform JSX in the browser. Fast to iterate, slow to first paint. Acceptable for a personal tool; swap in Vite if you outgrow it.
- **No undo.** Deletions are permanent. Trust the markdown-on-disk + git for history.

## Author

Lee Lok Hang Toby — <https://github.com/llhtoby38>

## License

MIT — see [LICENSE](./LICENSE).
