---
description: How to put screenshots and structured evidence INTO a todouz item. The ONLY way to upload an image is the attach_image tool (HTTP API POST /api/attach_image) — there is no /api/attach, /api/upload, or /api/upload_attachment. Pass the real image bytes as base64; embed them as markdown; lay results out as clean rendered content (headings, tables, figures). Never leave "[screenshot here]" placeholders or ASCII separators.
when_to_use: Whenever you need to add a screenshot, image, photo, or visual evidence to an item, or write up QA/test/experiment results, an evidence log, or any structured report in an item body — anything where the item should SHOW something, not just describe it. Read this again if an "attach"/"upload" endpoint 404s.
---

# Screenshots & structured evidence

An item's body is **rendered markdown** shown in the app — headings, tables, and images all display for real. So write the finished thing, not a plan for it, and put actual images in, not descriptions of images.

## Uploading a screenshot — the ONE correct way

There is exactly one tool that puts an image into todouz: **`attach_image`**. Do not guess endpoint names.

- **Over the HTTP API:** `POST <base>/api/attach_image` — e.g. `POST http://localhost:8765/api/attach_image`, with header `Authorization: Bearer <your key>` and a JSON body.
- **Over MCP:** call the `attach_image` tool.
- ⚠️ **These do NOT exist and will 404:** `/api/attach`, `/api/upload`, `/api/upload_attachment`, `/api/attachments/upload` (the last is browser-only). If any attach/upload path 404s, you used the wrong one — the tool is `attach_image`.

**JSON body / arguments:**

| field | required | what |
|-------|----------|------|
| `epic` | ✅ | the item's epic_slug, e.g. `"work/platform"` |
| `id` | ✅ | the item id, e.g. `"ISS-037"` |
| `data` | ✅* | the image **BYTES as base64** — a bare base64 string, or a full `data:image/png;base64,…` URL. **Not** a file path, **not** a URL to a file, **not** a description. If your screenshot is a PNG on disk, read its bytes and base64-encode them. |
| `mime` | | `"image/png"` (default) / `"image/jpeg"` / `"image/gif"` / `"image/webp"`. Inferred from a `data:` URL. |
| `filename` | | e.g. `"at-064-tram-filter.png"` (auto-named if omitted). |
| `alt` | | alt text describing the image. |
| `caption` | | an italic caption rendered under the image. |
| `embed` | | `true` (default) inserts the `![](…)` into the body; `false` uploads only and returns the markdown for you to place. |
| `attachment_id` | | use **instead of** `data` to embed an image that's already uploaded (by its id). |

\* Provide **`data`** (to upload new bytes) **or** `attachment_id` (to embed an existing one).

**Returns:** `{ ok: true, attachment_id, url, markdown }` — `markdown` is `![alt](/api/attachments/<id>)`, `url` is `/api/attachments/<id>` (the served image).

**curl:**
```bash
curl -s http://localhost:8765/api/attach_image -X POST \
  -H "Authorization: Bearer <YOUR_KEY>" -H "Content-Type: application/json" \
  -d '{"epic":"work/platform","id":"ISS-037","data":"<BASE64_PNG_BYTES>","mime":"image/png","caption":"Test 4: search returns 12 results","embed":false}'
```

## There are no "comments" — evidence lives IN the body

todouz items do **not** have a separate comment thread. Results, notes, and screenshots all go INTO the item's markdown body (its description). If you're mapping "which screenshot belongs to which comment", drop that idea: make **one section per item/test** and embed the screenshot directly under it (see the layout below). One item's body is the whole write-up.

## Golden rules

- **A screenshot means an uploaded image.** The only way to include one is `attach_image` with the real image **bytes** (base64). It stores the file and gives you a `![alt](/api/attachments/<id>)` embed that renders inline.
- **Never write a placeholder.** No `[screenshot here]`, no "attach the tram-filter screenshot", no "(see image)". If you don't have the bytes, say so in your reply to the user and ask for them — don't fake it in the body.
- **The body is the final artifact, not a memo to yourself.** Don't paste "post this as a comment", "replace the table with this", "everything below is mine to post", or section-numbered posting instructions into the item. That meta-text belongs in your chat reply, not the item.
- **No ASCII/box-drawing separators.** Never `####################`, `====`, or `----` as dividers. Use markdown headings (`##`, `###`) and, if you truly need a rule, a single `---` on its own line.
- **Headings in the body are fine** — `##`, `###`, `####` all work and stay in the item. The only reserved names are the structural subsections `### Sub-tasks`, `### Default itinerary`, `### Log`, `### Linked files`: don't use those exact `###` headings as content (rename to e.g. `### Notes` / `### Method`). Everything else, including `### AT-064`, is safe.

## Adding one screenshot (quick)

`attach_image { epic, id, data, caption }` — `embed:true` is the default, so it uploads the image and appends it to the body (above any Work log). Give it a `caption` so the reader knows what they're looking at.

## Evidence for several tasks (structured — do this for QA/test write-ups)

You want one clean section per task/test, each with its result and its screenshot right there. Build it in this order so the body is assembled **once** and reads top-to-bottom:

1. **Upload every screenshot first** with `attach_image { …, embed:false }`. That only stores the file and returns the `markdown` string (`![…](/api/attachments/<id>)`) — it does NOT touch the body yet. Keep each returned string next to the task it belongs to.
2. **Write the whole body once** with `update_issue` (`patch.description`) or `write_note`, dropping each screenshot's markdown under its task.

A good shape:

```
# Epic B QA — Real-Time Network Monitoring
Tested against dev `38f89d8` on 2026-08-19. Summary of results below; evidence per test follows.

## Results

| ID | Test | Result | Notes |
|----|------|--------|-------|
| AT-064 | Filter hides non-matching vehicles | ✅ PASS | Tram filter: 1766 → 152 active |
| AT-056 | Hailo status differentiated on map | ❌ FAIL | Icons key off transport mode only |

## Evidence

### AT-064 — Map filter controls · PASS
Applying the tram filter left only trams; active vehicles dropped 1766 → 152.

![AT-064 tram filter applied](/api/attachments/…)

### AT-056 — Vehicle Hailo status · FAIL
No Hailo status field on the map; icons only encode transport mode.

![AT-056 map with no Hailo status](/api/attachments/…)
```

- Use ✅ / ❌ / ⚠️ (or PASS/FAIL/PARTIAL) consistently in the results table.
- Put the screenshot **immediately under the task it proves**, with one line of context above it.
- Keep a link to the source (PR/wiki) inline, e.g. `[AT spec](https://…)`.

## Tool quick-reference

- **`attach_image { epic, id, data, mime?, filename?, alt?, caption?, embed?, attachment_id? }`** → `POST /api/attach_image`. `data` = base64 image bytes (or a `data:` URL). `embed:false` = upload only + return `markdown`. Returns `{ attachment_id, url, markdown }`. **This is the only upload endpoint.**
- `update_issue { id, epic, patch:{ description } }` — set/replace the whole body.
- `write_note { epic, id, markdown, html? }` — set the body; add `html` only if a rich render genuinely helps.
- Preserve any existing `## Work log` (see the issue-worklog skill) — append to it, don't overwrite.
