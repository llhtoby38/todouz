---
description: Plan what to eat — a recipe session on a day means "cooking/eating this that day".
when_to_use: User picks dishes for coming days, asks "what should I cook", or wants meals scheduled.
---

# Meal planning

Recipes live under `home/recipes` as sub-issues of meal-category issues
(Breakfast / Main / Side / Soup / Dessert / Drinks). **Planning a meal = creating
a session (timeblock) linked to the recipe issue on the chosen day.**

## Procedure

1. **Find candidate recipes.** `list_issues({epic: "home/recipes", tags: [...]})`
   — filter by what the user asked for: `effort-low` on a busy day, `time-15m`
   for quick dinners, `soup` in winter. Tags follow the conventions in the
   `issue-tagging` skill.

2. **Schedule each chosen dish.**
   `add_timeblock({date, start, end, title: "<Dish name>", issue_id, epic_slug: "home/recipes"})`
   - Dinner default 18:30–19:30; adjust to the recipe's `time-*` tag (a
     `time-1h` dish starts earlier).
   - One block per dish per day. Multiple dishes same evening → separate blocks
     back-to-back or one combined block titled with both dishes.

3. **Offer the shopping list.** After planning, offer to run the `shopping-list`
   skill for the planned window (or just do it if the user already asked).

4. **Respect energy.** Don't stack two `effort-high` dishes in one week unless
   asked. If the week looks busy (check upcoming deadlines), bias to
   `effort-low` / `no-effort` picks.
