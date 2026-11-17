---
description: Generate a shopping list as an issue with a tick-off checklist, cross-checked against home stock and linked back to the recipes it came from.
when_to_use: User asks to create a shopping list, plan groceries, or "what do I need to buy" — especially after selecting recipes/dates.
---

# Shopping list

A shopping list is an **issue** in `home/home-stock` whose **sub-tasks are the
items to buy**. Sub-tasks render in the dashboard as a real checklist you can tick
off in the supermarket — that's the whole point. Do NOT put the items in the
description as prose or as `- [ ]` markdown: description text isn't tappable.

Shape:
- `epic`: `home/home-stock`
- `title`: `🛒 Shopping list – <D Mon>` (e.g. `🛒 Shopping list – 17 Jul`)
- `due`: the day you're shopping (default today)
- `priority`: `high`
- `tags`: `shopping-list` (+ `today` when it's due today)
- `subtasks`: one per item to buy
- `related_issues`: the recipes it came from — see step 5
- `description`: one line of context (which meals it covers, what you skipped and
  why). Keep it short; the checklist carries the detail.

## Procedure

1. **Collect the recipes in scope.** If the user referenced specific recipes
   (names, ids, or a pasted `[TODOUZ SELECTION]` block), `get_issue` each one and
   read its `### Ingredients` section. If they said "for the next N days", check
   `list_upcoming` for recipe sessions already planned in that window.
   **Keep the recipe refs** — step 5 needs them.

2. **ALWAYS check home stock BEFORE adding any item.**
   `list_issues({epic: "home/home-stock", status: "open"})` — every stock item
   carries a tag: `in-stock`, `low-stock`, or `out-of-stock`.
   - Ingredient already `in-stock` → do NOT add it to the shopping list.
   - `low-stock` / `out-of-stock` → add it.
   - Not tracked in home-stock at all → add it (and consider whether it belongs
     in home-stock as a staple; if yes, create it there tagged `out-of-stock`).

3. **Also sweep home-stock for restocks.** Anything tagged `out-of-stock` (and
   `low-stock` items if the user isn't in a hurry) should be appended to the
   list even when no recipe needs it.

4. **Create the list.**
   `create_issue({epic: "home/home-stock", title, due, priority: "high",
   tags: ["shopping-list", "today"], description, subtasks: [{text: "Chicken thigh"}, …]})`
   - One item per sub-task. Merge duplicates across recipes (two recipes wanting
     onion → a single "Onion").
   - Order the sub-tasks by supermarket section (produce → meat → dairy → pantry
     → frozen) once the list runs past ~8 items. A checklist has no headers, so
     the ordering *is* the grouping.

5. **Link the recipes it came from.**
   `update_issue({id, epic: "home/home-stock",
   patch: {related_issues: ["home/recipes/ISS-023", "home/recipes/ISS-031"]}})`
   - Refs MUST be fully qualified `<category>/<epic>/ISS-nnn`. Ids are scoped
     per-epic, so a bare `ISS-001` is genuinely ambiguous —
     `home/recipes/ISS-001` is Breakfast, `home/home-stock/ISS-001` is
     Spices. Malformed refs are dropped silently, so get the shape right.
   - Link the actual recipe issues, never the category folders.
   - These render as tappable links under **Related** in the issue, so the recipe
     card is one tap away while standing in the shop.
   - It's a replace, not an append: pass the full list every time. Whenever a
     list is rebuilt or extended, re-send `related_issues` so it stays in sync
     with the recipes actually covered.

6. **After the user shops** (they say "bought everything" / tick the items):
   set the matching `home/home-stock` items back to `in-stock`
   (`update_issue({patch: {tags: [...]}})`), tick the sub-tasks off with
   `toggle_subtask`, and `complete_issue` the list.
