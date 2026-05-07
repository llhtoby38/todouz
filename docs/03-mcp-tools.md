# 03 — MCP tools

Every tool the agent has. Each has: a one-line description, an input schema, what files it touches, and a usage example.

The same catalogue is exposed two ways:
- **stdio MCP** (`mcp-server/index.mjs`) — for `claude mcp add todouz node /abs/path/to/index.mjs`. Use from any Claude Code session, anywhere on disk. The server resolves all paths absolutely from its own location.
- **HTTP** (`mcp-server/http-server.mjs`) — same dispatcher behind `/api/*` for the dashboard.

## Tool grouping

```
read   — list_categories, list_agents, list_epics, get_epic, list_issues,
         get_issue, list_today, list_upcoming, search, get_profile

write  — create_epic, create_issue, update_issue, complete_issue,
         reopen_issue, delete_issue, move_issue, add_subtask,
         toggle_subtask, append_to_project, log_recurrence

agent  — list_sessions, link_session, get_session, list_agents,
         get_agent, create_agent

events — add_event, mark_event_done, list_events
```

22 tools in MVP. Naming is verb-first, snake_case. Each returns a JSON-serialisable object; errors are `{error: "..."}`.

---

## Read tools

### list_categories

```ts
list_categories(): { categories: Category[] }
```

Returns the fixed enum. No file IO.

### list_agents

```ts
list_agents({ category?: Category }): { agents: AgentSummary[] }

interface AgentSummary {
  name: string;
  category: Category | null;       // null for cross-cutting (scheduler, compass)
  role_excerpt: string;            // first non-heading line of identity.md, ≤200 chars
  session_count: number;
}
```

Walks `data/agents/`. Filters by category if passed.

### list_epics

```ts
list_epics({ category?: Category, agent?: string }): { epics: EpicSummary[] }

interface EpicSummary {
  slug: string;            // e.g. "studies/cs-401"
  title: string;
  category: Category;
  agent_owner: string;
  recurring: boolean;      // true if recurring_schedule is set
  open_issue_count: number;
  next_due: string | null; // YYYY-MM-DD of nearest open issue
}
```

### get_epic

```ts
get_epic({ slug: string }): {
  slug, title, category, agent_owner, related_epics: string[],
  recurring_schedule: ScheduleRule[] | null,
  project_md: string,             // raw content
  issues: IssueSummary[],
}
```

Reads `data/epics/<slug>/epic.md` + `issues.md`, returns the parse.

### list_issues

```ts
list_issues({
  epic?: string,
  agent?: string,
  status?: 'open' | 'completed' | 'all',  // default 'open'
  priority?: 'high' | 'medium' | 'low',
  due_within_days?: number,                // open issues with due within N days
  recurring?: boolean,
  limit?: number,
  query?: string,                          // full-text on title + description
}): { issues: IssueSummary[] }

interface IssueSummary {
  id: string;                  // "ISS-014"
  epic_slug: string;
  title: string;
  agent: string;
  due: string | null;          // YYYY-MM-DD
  priority: 'high' | 'medium' | 'low';
  recurring: boolean;
  status: 'open' | 'completed';
  open_subtask_count: number;
  total_subtask_count: number;
}
```

### get_issue

```ts
get_issue({ id: string, epic?: string }): {
  id, epic_slug, title, agent, due, priority, recurring,
  recurring_schedule: ScheduleRule | null,
  status, sessions: string[],
  description: string,
  subtasks: { text: string, done: boolean, due?: string }[],
  log_entries: { date: string, note: string }[],   // only for recurring
  related_issues: string[],
  linked_files: { label: string, path: string }[],
}
```

`epic` is optional; if omitted, scans all epics for the id (slower but works for cross-Claude-session queries where the caller doesn't know the epic).

### list_today

```ts
list_today({ date?: string }): {           // date defaults to today
  date: string,
  weekday: string,
  due_today: IssueSummary[],               // open issues with due == date
  recurring_today: IssueSummary[],         // recurring matches dow
  events_today: Event[],                   // from events.json
  overdue_count: number,                   // open issues with due < date
}
```

Computes the schedule view. Used by the dashboard's TODAY card and by the agent for "what should I do?" questions.

### list_upcoming

```ts
list_upcoming({ days: number, from_date?: string }): {
  range: { from: string, to: string },
  days: { date: string, weekday: string, items: IssueSummary[] }[],
}
```

### search

```ts
search({ query: string, limit?: number }): {
  matches: ({
    type: 'issue' | 'project' | 'profile' | 'log_entry',
    excerpt: string,
    epic_slug?: string,
    issue_id?: string,
    score: number,
  })[]
}
```

Naive substring + token match — good enough for the MVP. Phase-2: BM25 with a tiny inverted index in `state/`.

### get_profile

```ts
get_profile(): { content: string }
```

Reads `data/personal/profile.md`. Used by agents to ground responses.

---

## Write tools

### create_epic

```ts
create_epic({
  slug: string,                  // "studies/cs-401"
  title: string,
  category: Category,
  agent_owner: string,
  project_md?: string,           // initial body; default: just frontmatter
  recurring_schedule?: ScheduleRule[],
}): { ok, slug, paths: { project: string, issues: string } }
```

Refuses if the slug already exists.

### create_issue

```ts
create_issue({
  epic: string,
  title: string,
  description?: string,
  due?: string,                  // YYYY-MM-DD
  priority?: 'high' | 'medium' | 'low',     // default 'medium'
  recurring?: boolean,
  recurring_schedule?: ScheduleRule,
  agent?: string,                // default = epic.agent_owner
  subtasks?: { text: string, due?: string }[],
}): { ok, id, epic_slug }
```

Bumps `data/state/issue-counter.json[epic]`. Inserts a new `## ISS-NNN` block at the bottom of `issues.md`.

### update_issue

```ts
update_issue({
  id: string, epic?: string,
  patch: Partial<{
    title, description, due, priority, agent,
    recurring, recurring_schedule, status,
  }>
}): { ok, id, changed_fields: string[] }
```

### complete_issue

```ts
complete_issue({
  id: string, epic?: string,
  log_note?: string,             // for recurring issues, appended to ### Log
  for_date?: string,             // for recurring, defaults to today
}): { ok, id, completion_kind: 'one-off' | 'recurring-instance' }
```

For one-off: flips `status` to `completed` in `issues.md` and writes `data/state/completion.json[id]`.

For recurring: writes `completion.json["<id>#<date>"]` and appends a log entry under `### Log` in the issue. The recurring issue's overall status stays `open`.

### reopen_issue

Inverse of complete_issue. Removes the completion entry; for recurring + `for_date`, removes that single instance's record.

### delete_issue

```ts
delete_issue({ id, epic?, reason? }): { ok, removed_block: string }
```

Permanently removes the `## ISS-NNN` block. `removed_block` is returned as a paste-back receipt.

### move_issue

```ts
move_issue({ id, from_epic, to_epic }): { ok, new_id }
```

Sub-tasks + log + linked files travel along. Issue gets a fresh `ISS-NNN` in the destination epic's counter.

### add_subtask / toggle_subtask

```ts
add_subtask({ issue_id, epic?, text, due? }): { ok }
toggle_subtask({ issue_id, epic?, subtask_text, done? }): { ok, new_state }
```

Standard nested-checkbox manipulation.

### append_to_project

```ts
append_to_project({
  epic: string,
  section: string,               // h2 heading inside epic.md
  line: string,                  // bullet content (no leading "- ")
}): { ok }
```

For journaling progressions, observations, decisions — anything that belongs in the slow-changing context, not in an issue.

Example: after a gym session, the body agent calls `append_to_project({ epic: 'body/gym', section: 'Progression notes', line: 'Bench: hit 40×8 first time on Mon 5/4. Next aim 42.5×6.' })`.

### log_recurrence

Specialised wrapper around complete_issue + append_to_project for recurring tasks. Used by the body agent on gym sessions.

```ts
log_recurrence({
  issue_id: string, epic?: string,
  for_date?: string,             // default today
  completed: boolean,             // did the planned itinerary actually happen?
  note: string,                  // free-form, gets stored in completion.json AND under ### Log
  observations?: {               // optional structured fields for body agent's progression tracking
    duration_min?: number,
    rpe?: number,                // 1–10
    skipped?: string[],          // sub-tasks the user skipped
    extras?: string[],           // things they did beyond the plan
  },
}): { ok, completion_key: string }
```

The `observations` structure is opaque to the schedule view — it just gets serialised under the log entry. Phase-2: a body-specific `get_progression(issue_id)` tool that walks all log entries and returns a chart-ready timeseries.

---

## Agent / session tools

### list_sessions

```ts
list_sessions({ agent?: string, issue_id?: string, limit?: number }): {
  sessions: SessionSummary[]
}

interface SessionSummary {
  id: string;
  agent: string;
  issue_ids: string[];           // can be linked to multiple
  first_message_excerpt: string;
  last_updated: string;          // ISO
  turn_count: number;
}
```

Reads `state/session-links.json`. Filter by agent or by linked issue.

### link_session

```ts
link_session({ session_id, issue_id, epic? }): { ok }
```

Idempotent. Adds the session id to the issue's `sessions:` list AND to the reverse index.

### get_session

```ts
get_session({ session_id }): {
  messages: ChatMessage[],       // parsed JSONL (same shape the dashboard renders)
  agent: string,
  cwd: string,
}
```

### create_agent / get_agent / list_agents

Mostly the same as the prototype. `create_agent` writes `identity.md` + `system-prompt.md` + ensures `data/agents/<name>/` exists.

---

## Event tools (one-offs not tied to an issue)

For "Alex's flight", "doctor appointment" — informational schedule entries.

### add_event

```ts
add_event({
  title, date, time?, duration_min?, category?, note?,
}): { ok, event_id }
```

### mark_event_done

```ts
mark_event_done({ event_id, done?, note? }): { ok }
```

### list_events

```ts
list_events({ from_date?, to_date?, category? }): { events: Event[] }
```

---

## Cross-Claude-session use

When attached to another `claude` session, the MCP server sees a different `cwd`. Tools must therefore use absolute paths derived from `mcp-server/`'s own location, NOT from `process.cwd()`. The same constraint applied to the prototype and was already correct there (`PROJECT_ROOT = dirname(SERVER_DIR)`).

A new Claude session running from `~/Documents/University/CS-401/` can call:

> ask todouz to mark ISS-014 done with note "submitted via Canvas"

And the dashboard at `localhost:8765/dashboard/` reflects the change after refetch.

---

## Conventions

- **Idempotency**: write tools that target a specific resource (`mark_complete`, `link_session`) silently no-op when the state is already what's requested.
- **Path matching**: when callers pass an issue title, we accept loose prefix-matching (the prototype's pattern). Exact id is preferred when known.
- **Time zones**: all dates are ISO `YYYY-MM-DD`, treated as Australia/Melbourne local. `due` without a time means "end of that day".
- **Errors**: `{error: "human readable message"}` — never throws across the JSON boundary.
- **Returns**: every tool returns either `{ok: true, ...payload}` for writes or the data directly for reads. Reads never have `ok` because the empty case (no matches) is `{matches: [], count: 0}`, not an error.

---

## Phase rollout

| Phase | Tools | What unlocks |
|---|---|---|
| **1 — MVP** | list_categories, list_agents, list_epics, get_epic, list_issues, get_issue, list_today, create_issue, update_issue, complete_issue, add_subtask, toggle_subtask, append_to_project, list_sessions, get_profile | Dashboard works end-to-end. Capture-to-cards flow works. |
| **2 — Recurring + Search** | log_recurrence, search, list_upcoming, link_session, add_event, mark_event_done | Gym progression tracking. Better cross-epic queries. |
| **3 — Cross-session** | move_issue, delete_issue, create_epic, create_agent, get_progression | Full editorial control from any Claude session. |
