---
description: How an AI agent documents and organises work on todouz issues — the Work log, completion summaries, the create/edit/delete formatting rules, and how to group tasks into a top-level action list with a linked action-item table. Applies whenever an issue is touched via MCP or the API.
when_to_use: Whenever you fetch, create, edit, complete, delete, or REORGANISE a todouz issue (get_issue / get_full_context / create_issue / update_issue / complete_issue / delete_issue), or when the user asks you to organise / plan / break down / tidy up work — any time an agent (chat, Claude Code, or the API) works their board.
---

# Issue worklog & formatting

You leave a paper trail. Whenever you fetch an issue to work on it, the **issue itself** is where the work gets documented — not just your chat reply. Keep everything outcome-first and short.

## The Work log

Every issue you do real work on carries a running `## Work log` section at the END of its markdown description:

```
## Work log
- 2026-08-08 — shipped the drag-to-nest fix (PR #61); opened drop targets to any item
- 2026-08-09 — blocked: needs a cycle guard for deep nesting
```

- **Append, never overwrite.** Read the current description with `get_issue`, add a new dated line, write it back with `write_note` (markdown) or `update_issue` (`patch.description`). Preserve existing entries.
- One line per work session. Outcome first, then the detail. No walls of text.

## On completion — ALWAYS summarise

When you finish an issue, **always** record a summary:

- Call `complete_issue` with a **`summary`** — a concise, outcome-first recap of what was done. It is appended under `## Work log` automatically and stored in the completion record, so every completed issue carries a summary the user can read under it.
- Never complete an issue with no `summary`.

## Create / edit / delete rules

**create_issue**
- Title: verb-first, imperative, ≤ ~80 chars, no trailing period ("Fix drag-to-nest", not "Fixing the drag.").
- Description: markdown. First line states intent — what "done" means. Add a `## Plan` for multi-step work.
- Always tag actionable items: an effort tag (`effort-low` / `effort-medium` / `effort-high`) **and** a time estimate (`time-15m` / `time-30m` / `time-60m` / `time-2h+`). Set `due` / `priority` when known.
- Check `list_issues` / `get_issue` first — don't duplicate an existing item.

**update_issue / edit**
- Preserve the `## Work log`; append to it, don't clobber it.
- If you change scope or approach, note *why* in a Work log line.

**delete_issue**
- Only on explicit user instruction ("scrap / kill / remove"). It is permanent.
- **Prefer completing with a "won't do — <reason>" summary over deleting** whenever there's history worth keeping — a completed item with a reason survives; a deleted one doesn't.
- Never silently delete. If you delete, say so and why.

## Organise into linked action lists

When the user hands you a pile of things to do, a project, or a vague goal — **don't just dump flat items.** Group them so they has one thing to open and a clear list to follow.

1. **Create a top-level "action list" item** — the outcome, verb-first (e.g. "Ship the beta", "Sort out the insurance renewal"). This is the parent they opens.
2. **Create each real task as a sub-item of it** — `create_issue` with `parent_issue_id` set to the parent's id (same epic), or re-parent existing items with `update_issue { patch: { parent_issue_id } }`.
3. **In the parent's description, keep an `## Action items` markdown table** where every row **links to its sub-item**, so they can tap a row and land straight on that item's page.

Use each item's **`app_url`** (returned by `create_issue` and `get_issue`) as the link target — never write a bare "ISS-035", it's meaningless until you open it. Link by the task name:

```
## Action items

| # | Action | Status | Due |
|---|--------|--------|-----|
| 1 | [Write the release notes](http://localhost:8765/dashboard/#issue=projects/streaks/ISS-012) | open | Mon |
| 2 | [Fix the onboarding crash](http://localhost:8765/dashboard/#issue=projects/streaks/ISS-013) | done | — |
```

- The link format is always `<base>/dashboard/#issue=<epic_slug>/<id>` — but just copy the `app_url` the API already gives you.
- **Keep the table in sync**: when you complete/rename/add a sub-item, update the parent's Action items row (status, or add the new row). One tap-through per task is the whole point.
- Order rows the way they should tackle them (sequence, or by due date). Add a one-line intent above the table if the list needs context.

## Tone
Coach-not-cop. Record facts, not effort theatre. If something failed, say so with the reason — don't bury it under a rosy summary.
