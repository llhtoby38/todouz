# 01 — Overview

## What this is

A personal organiser for the user. Lives on disk as a tree of markdown + JSON. Editable by hand, by other tools (vim, Cursor, Obsidian, git), or by agents via the MCP server.

## Mental model

Borrowed from Linear / GitHub Issues, adapted for a personal life:

- **Category** — the high-level area of life (uni, body, side projects, kitchen, future planning, personal).
- **Agent** — a personality + system prompt. Owns one category. Drives chat sessions.
- **Epic** — a long-running project under a category. Has a `epic.md` (background, plan, progression) + a list of issues. Examples: `studies/CS-401`, `side-project/thetas`, `body/gym`.
- **Issue** — an actionable item under an epic. One-off (a deliverable due 2026-05-08) or recurring (a Wed gym session). Sub-tasks live inside.
- **Session** — a Claude Code transcript (one JSONL on disk). Linked to issues so chats persist across drawer-closes and restarts.
- **Schedule** — a derived view, not a stored entity. Computed from issues with dates + recurring rules.

## Why this is different from the prototype

The prototype scattered work across `focus.md`, `semester.md`, `todos.md`, `schedule.md`, captures inbox, and per-agent inboxes. Things drifted out of sync. The new model: **every actionable item is an Issue under exactly one Epic.** Schedule + today views are derived. No duplicate truths.

## Two surfaces, one data layer

### 1. Dashboard (web UI)

`http://localhost:8765/dashboard/` — Notion/Linear hybrid. Today view, calendar, epic browser, agent chat. Pure read/write against the same files the MCP tools touch.

### 2. MCP server (stdio)

Registered with `claude mcp add todouz node /abs/path/to/todouz/mcp-server/index.mjs`. Then in any Claude Code session, anywhere on disk:

> "todouz: add an issue under thetas to ship the Stripe integration by Friday, priority high"

The agent calls `create_issue` and the dashboard sees it on next refetch.

## Re-using the Claude subscription (no API key)

The dashboard's chat surface uses `@anthropic-ai/claude-agent-sdk`'s `query()` which falls back to the local `claude` CLI's OAuth token in the macOS Keychain (`Claude Code-credentials`). Same as the prototype — works end-to-end without any Anthropic API key, billed against Claude Pro/Max.

The MCP server is independent of this — it's just stdio tools. When attached to another `claude` session, that session uses its own auth.

## Non-goals

- No 2D pixel-art house, no characters, no avatars. Pure information-design dashboard.
- No mobile app. Web only.
- No multi-user. Single user, one machine, one source of truth on disk.
- No SQL / no SQLite. Markdown + JSON files. Loses fancy queries; gains git-friendliness, hand-editability, and crash-resilience.
- No real-time sync between processes. The dashboard polls / re-fetches on chat completion. Good enough.

## Success criteria (MVP)

By the end of the build, I should be able to:

1. Open the dashboard, see exactly what's due today across uni / body / side projects.
2. Click an issue, see its sub-tasks + epic.md context, edit either.
3. Press space, type a brain-dump like "I just had sprint planning for CS-401, need to review architecture, finalize tech stack, build a diagram, and write the week 9 report by Tue", and watch the scheduler agent create the right issues under the right epic with sub-tasks — in one round trip, no follow-up questions.
4. From any terminal, run `claude` (with todouz MCP attached) and ask it to add/update issues — see the dashboard reflect the change after refresh.
5. Mark a recurring gym session done with a short log note ("40min push, bench 30/40/40, biceps fading by set 3"), and see the agent both log it under the gym epic's epic.md AND adjust the next session's planned itinerary based on what I logged.

## What gets dropped

From the prototype: `focus.md`, the inbox column, the capture modal, the per-card chat panel duplication, the orchestrator agent (replaced by scheduler as the catch-all).

Kept: the agent roster (scheduler, studies, builds, body, compass), the home-context personal profile, all the gym/uni/project data — migrated, see `05-migration.md`.
