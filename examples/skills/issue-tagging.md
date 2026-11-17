---
description: Tag conventions + time-estimation rules applied to every issue the agent creates.
when_to_use: ALWAYS when creating or editing issues/sub-issues — recipes, tasks, stock items alike.
---

# Issue tagging

Tags are lowercase kebab, stored on the issue's `tags` field, filterable in the
dashboard and via `list_issues({tags})` (AND semantics). Apply them at creation
time — untagged issues are a bug, not a default.

## Universal tags (any actionable issue)

- **Effort:** `effort-low` | `effort-medium` | `effort-high`
- **Time estimate:** `time-15m` | `time-30m` | `time-1h` | `time-2h+`
- Domain tag matching the epic's world: `uni`, `side-project`, `admin`, `errand`…

## Recipes (home/recipes)

- **Meal type:** `breakfast` | `main` | `side` | `soup` | `dessert` | `snack` | `drink`
- **Cuisine (exactly one where sensible):** `japanese` | `chinese` | `korean` | `thai` | `vietnamese` | `malaysian` | `asian` (generic) | `italian` | `french` | `spanish` | `middle-eastern` | `western` | `fusion`
- **Effort:** `no-effort` (heat & eat) | `effort-low` | `effort-medium` | `effort-high`
- **Cook time:** `time-5m` | `time-15m` | `time-30m` | `time-1h` | `time-2h+`
- **Food category:** `protein` | `carbs` | `vegi` | `sweets` (multiple allowed)

## Home stock (home/home-stock)

- **Status (exactly one):** `in-stock` | `low-stock` | `out-of-stock`
- **Storage:** `pantry` | `fridge` | `freezer` | `spice-rack`

## Time-estimation + booking rule

When creating an actionable issue with a due date:
1. Estimate the focused time it needs → add the matching `time-*` tag.
2. If > ~30 min, look for a free slot before the due date (`list_upcoming`)
   and offer to book it via `add_timeblock` — or book immediately when the
   user has already said "schedule it".
