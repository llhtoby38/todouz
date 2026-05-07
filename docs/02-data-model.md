# 02 — Data model

Extends the entity diagram. Concrete file shapes + JSON schemas so a tool implementer doesn't have to guess.

## Entities

### Category

A fixed enum. Adding a new category is a code change (so the dashboard knows how to render it).

```ts
type Category =
  | 'studies'         // university subjects
  | 'side-project'    // Thetas.ai, Champteams, Plecto, etc.
  | 'body'            // gym, sleep, nutrition
  | 'kitchen'         // cooking, meal planning
  | 'future-planning' // FDE prep, Canberra trip, driving licence
  | 'personal';       // catch-all admin (taxes, oven repair, ...)
```

Categories don't have their own files. They're just folder names under `data/epics/`.

### Agent

A personality + system prompt. Owns exactly one category. Drives sessions.

```
data/agents/<name>/
├── identity.md         # who they are, voice, what they care about
├── system-prompt.md    # the prompt prepended to every session
└── (sessions live in ~/.claude/projects/<hashed-cwd>/<sid>.jsonl,
     not duplicated here — see Session below)
```

Default roster:

| name | category | role |
|---|---|---|
| `scheduler` | (none — catch-all) | routes anything ambiguous, defaults destination |
| `studies` | studies | uni — subjects, deliverables, week reports |
| `builds` | side-project | side projects + code |
| `body` | body | gym, sleep, energy, recovery |
| `compass` | (cross-cutting) | strategy, FDE prep, weekly reflection, "should I?" questions |

`scheduler` and `compass` are cross-category — they don't own any one thing, they help orchestrate. All other agents own one category.

### Epic

A long-running project. Each epic is a folder.

```
data/epics/<category>/<slug>/
├── epic.md       # background, plan, progression, observations
└── issues.md        # all issues for this epic, one section each
```

`epic.md` is the **slow-changing context** for the epic. For CS-401: lecturer, repo URL, my role on the team, decisions log. For Gym: full plan, current weights baseline, mobility limits, progression notes. The agent reads this before reasoning.

`issues.md` is the **fast-changing backlog**. See Issue below for the format.

Frontmatter at the top of `epic.md`:

```yaml
---
title: CS-401 — Software Project
category: studies
agent_owner: studies
related_epics: []
recurring_schedule: null
---
```

For a recurring epic like `body/gym`, frontmatter:

```yaml
---
title: Gym (Push / Legs / Pull split)
category: body
agent_owner: body
related_epics: []
recurring_schedule:
  - { dow: Wed, time: '09:00', issue_template: 'push' }
  - { dow: Sat, time: '09:00', issue_template: 'legs' }
  - { dow: Sun, time: '09:00', issue_template: 'pull' }
---
```

### Issue

The actionable unit. Lives as one `## ISS-NNN` section inside the epic's `issues.md`.

```markdown
## ISS-014 — Draft Enterprise Proposal review
- agent: studies
- due: 2026-05-08
- priority: high
- recurring: false
- status: open
- sessions: [1eb450c6-53d3-40a2-9053-ceee9158080a]
- related_issues: [ISS-012]

Spec received from Mark on Mon. Need to read the example draft, sketch the architecture diagram, write the 5-page proposal. Team meeting Thu to align.

### Sub-tasks
- [x] Read example draft
- [ ] Sketch architecture diagram
- [ ] Write proposal section 1–3 (1500w)
- [ ] Write proposal section 4–5 (1000w)
- [ ] Self-review + submit before Thu midnight

### Linked files
- See: [course notes](../../studies/cs-401/notes.pdf)
```

For a **recurring** issue:

```markdown
## ISS-021 — Push day session
- agent: body
- recurring: true
- recurring_schedule: { dow: Wed, time: '09:00' }
- priority: medium
- status: open
- sessions: [3c91a77e-..., a8b2...]

Standard push day from gym-plan.md. Bench / Incline / Tris / Biceps superset.

### Default itinerary (cloned per instance)
- Bench press 4×8 (working weight 40kg)
- Incline DB 3×10
- Cable triceps 4×12
- Biceps superset 3×12

### Log
- 2026-05-04 (Mon, 40min): bench 30/40/40, biceps 8kg×12 throughout, tris 4kg×15. Felt OK on chest, biceps fading by set 3. **Note**: drop biceps to 3 sets next time.
- 2026-04-29 (Wed, 75min): full plan completed. Bench 30kg×8 → 35×6.
- ...
```

### Issue ID format

`ISS-NNN` where NNN is monotonic per-epic. Storing the next-id counter in `data/state/issue-counter.json`:

```json
{
  "studies/cs-401": 14,
  "body/gym": 21,
  ...
}
```

Newly-created issues bump the counter atomically.

### Session

A Claude Code transcript. Stored by the SDK at `~/.claude/projects/<hashed-cwd>/<sid>.jsonl` — we don't duplicate, just reference.

Per-issue list of sessions kept in the issue's `sessions:` field above.

A reverse index for fast "list all sessions across the system" lookup:

```
data/state/session-links.json
```

```json
{
  "1eb450c6-53d3-40a2-9053-ceee9158080a": {
    "agent": "studies",
    "issue_ids": ["ISS-014"],
    "first_message_excerpt": "Draft Enterprise Proposal — what should I do first?",
    "last_updated": "2026-05-04T23:01:43Z"
  }
}
```

### Schedule

Not stored. **Derived view**: walk all open issues, pick the ones with a `due` or `recurring_schedule`, project onto a calendar.

Two stored bits that the schedule reads:

1. **Completion state** — `data/state/completion.json`:
   ```json
   {
     "ISS-014": { "completed": true, "completed_at": "2026-05-04T23:01:43Z" },
     "ISS-021#2026-05-04": { "completed": true, "completed_at": "2026-05-04T10:30:00Z", "log": "40min push, bench 30/40/40" }
   }
   ```
   For recurring issues, the key is `<id>#<date>` so each instance can be ticked independently while the recurring rule stays open.

2. **One-off events** that aren't issues (e.g. "Alex's flight" — informational, no action needed) — `data/state/events.json`:
   ```json
   [
     { "id": "evt-001", "title": "Canberra flight depart", "date": "2026-05-30", "time": "11:00", "category": "future-planning" }
   ]
   ```

## Folder layout (concrete)

```
todouz/data/
├── personal/
│   └── profile.md                   # who I am, working patterns, preferences
├── agents/
│   ├── scheduler/
│   │   ├── identity.md
│   │   └── system-prompt.md
│   ├── studies/
│   ├── builds/
│   ├── body/
│   └── compass/
├── epics/
│   ├── studies/
│   │   ├── cs-401/
│   │   │   ├── epic.md
│   │   │   └── issues.md
│   │   ├── cs-410/
│   │   ├── cs-420/
│   │   └── cs-430/
│   ├── side-project/
│   │   ├── thetas/
│   │   ├── champteams/
│   │   ├── plecto/
│   │   └── todouz/             # this repo, recursively
│   ├── body/
│   │   └── gym/
│   ├── kitchen/
│   │   └── weekly-meal-plan/
│   ├── future-planning/
│   │   ├── fde-prep/
│   │   ├── canberra-trip/
│   │   └── driving-licence/
│   └── personal/
│       └── inbox/                   # catch-all stray todos
├── linked-docs/                     # reusable refs (gym-plan template, weekly-review prompt)
└── state/
    ├── completion.json
    ├── events.json
    ├── session-links.json
    └── issue-counter.json
```

## Why markdown not SQLite

- I can edit anything by hand from vim. The agent, the dashboard, and `cat` all see the same data.
- `git diff` shows meaningful changes — issue text, sub-task ticks, epic.md edits.
- Other Claude sessions can grep + read the files directly without learning a schema.
- A crashed process never corrupts the store — worst case is one half-written file.

The cost is no JOINs and no transactions. We accept the trade.

## Concurrency model

Single-writer. The dashboard's HTTP server and the stdio MCP server share the same `tools.mjs` dispatcher. Two writes from different sessions hitting the same file race; the loser silently overwrites. **Acceptable** for a single-user system; if we hit issues we'll add a lockfile per epic file.

## Identifiers

- Epic slug: `<category>/<short-name>` — kebab-case, all lowercase.
- Issue id: `ISS-NNN` per-epic.
- Recurring instance id: `ISS-NNN#YYYY-MM-DD`.
- Agent name: lowercase, dashes only.
- Session id: UUID v4 from Claude Code SDK.
