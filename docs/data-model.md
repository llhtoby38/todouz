# Data model

Everything todouz knows is a file under `data/` (or `TODOUZ_DATA_DIR`). You can edit any of it by hand; the server picks changes up on the next boot, or straight away after `reindex_database`.

```
data/
├── epics/<category>/<folder>/
│   ├── epic.md          folder context: frontmatter + long-form notes
│   ├── issues.md        the folder's items, one "## ISS-NNN" section each
│   └── …                any other files you attach (listed in the drawer)
├── brain/<slug>.md      second-brain notes (typed, linked)
├── skills/<name>.md     playbooks the agent reads before acting
├── routines/<name>.md   scheduled prompts (opt-in)
├── feed/*.json          feed posts and your reactions
├── personal/
│   ├── profile.md       who you are and how you work (read by every agent)
│   └── roadmap.md
└── state/
    ├── timeblocks.json  booked sessions on the calendar
    ├── events.json      one-off calendar events
    ├── completion.json  completion log (with optional summaries)
    ├── issue-counter.json  next ISS number per folder
    ├── users.json       accounts (hashed), when enabled
    └── index.db         SQLite read index, rebuilt from the files at boot
```

## Categories and folders

A category is just a directory under `data/epics/`. New installs suggest `work`, `projects`, `learning`, `health`, `home` and `personal`, but `create_category` (or creating a folder in the dashboard) adds any lowercase-dashes name.

A folder ("epic") is a directory inside a category, addressed as `category/folder`, for example `projects/streaks`.

```markdown
---
title: Streaks — habit tracker app
category: projects
color: '#6b21a8'
---

Side project. React Native app + small Node API. Goal: TestFlight beta by the end of the month.
```

## Items

Items live in the folder's `issues.md`:

```markdown
## ISS-001 — Ship TestFlight beta
- due: 2026-11-21
- priority: high
- status: open
- tags: [effort-high, time-2h+]

Last blocker before the first 20 testers.

### Sub-tasks
- [x] Fix onboarding crash on Android
- [ ] Write release notes
- [ ] Invite first 20 testers
```

- **Ids are per folder.** `ISS-001` can exist in several folders, so every tool takes `id` and `epic` together, and `move_issue` gives the item a new id in its new folder.
- **Types.** `issue` (actionable), `item` (reference, such as a recipe) and `folder` (a group of nested items).
- **Nesting.** `parent_issue_id` puts an item under another; progress rolls up.
- **Recurring.** Set `recurring: true` for things that repeat; each occurrence is completed separately.
- **Work log.** Agents append a `## Work log` to the description, and `complete_issue {summary}` records a dated recap.

## Sessions and events

A session (timeblock) is a booked slot, optionally linked to an item:

```json
{ "id": "tb-…", "date": "2026-11-18", "start": "08:00", "end": "09:30",
  "title": "ML module 4 exercises", "epic_slug": "learning/ml-course", "issue_id": "ISS-001",
  "completed": false }
```

`add_timeblock {repeat_weeks: N}` creates N independent weekly sessions; there is no hidden recurrence rule, so each one can be moved, edited or skipped on its own. Unfinished sessions from earlier days show at the top of Today until you complete, delete or drag them.

Events are informational calendar entries (a flight, a birthday) that aren't work.

## Brain notes

```markdown
---
title: Idempotency keys belong at the edge
type: learning          # note | concept | person | decision | learning | preference | source | goal | inbox
status: evergreen       # seed | growing | evergreen | archived
tags: [work, payments]
projects: [work/platform]
---

Store the key with the response for 24h at the gateway, not in each service.
Related: [[streaks-positioning]]
```

`profile` and `roadmap` are core notes stored in `data/personal/`. With `TODOUZ_LINKER=on`, the Brain adds typed links between notes (supports, contradicts, limits, extends, trade-off, applies to), and every edit is kept in `brain/.history/`.
