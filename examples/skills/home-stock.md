---
description: Maintain the home/home-stock inventory — status tags, restock flow.
when_to_use: User says something ran out, they bought groceries, or asks what's in the kitchen.
---

# Home stock

`home/home-stock` mirrors what's physically in the kitchen. First-layer issues
are storage categories (Spices & seasonings, Oils & fats, Wines & cooking alcohol,
Baking & dry goods, Sauces & condiments, Fresh, Frozen, Dairy & eggs, Drinks);
each item is a sub-issue with exactly one status tag.

## Rules

1. **"Ran out of X" / "no more X"** → find X under home-stock, set tags to
   `out-of-stock` (keep its storage tag). If X isn't tracked yet, create it as a
   sub-issue of the right category, tagged `out-of-stock`.

2. **"Bought X" / after a shopping session completes** → set X back to `in-stock`.

3. **Never delete stock items** — they are the standing catalogue. Status tags
   flip; items stay. (Delete only if the user says they'll never buy it again.)

4. **Shopping-list integration:** the `shopping-list` skill reads this epic before
   adding anything. Keep statuses truthful — they are the source the whole
   kitchen flow depends on.

5. Items should stay `status: open`. Do NOT complete_issue a stock item when it's
   bought — completion would archive it out of the catalogue.
