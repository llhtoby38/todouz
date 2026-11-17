---
description: Turn a lecture PDF (or rough notes) into a clean, self-contained HTML study note and attach it to the relevant subject item, using the write_note tool.
when_to_use: User uploads/points at a lecture PDF or asks to "make notes", "create a study note", "summarise this lecture", or "build an HTML note" for a subject.
---

# HTML study notes

Produce ONE self-contained HTML document per lecture and attach it to the
subject item with `write_note({epic, id, title, format: "html", content})`. The
note renders in the item drawer's sandboxed viewer (scripts run, but in a null
origin), so external libraries via `<script src>` CDN are fine; there is no build
step and nothing is persisted except the single HTML file.

This skill is a living recipe — refine the template below whenever we agree on a
better end product.

## Where it goes

- `epic`: the subject's epic_slug (e.g. `learning/ml-course`). Find it with
  `list_epics` / `list_issues` if unsure — never guess the slug.
- `id`: the item the note belongs to. If the lecture has its own item (e.g. an
  item titled "L01 — …"), attach there; otherwise attach to the subject's main
  item, or create a lightweight item first with `create_issue`.
- `title`: `L<NN> — <Lecture title>` (e.g. `L01 — Framework & Systems Thinking`).

## Source → structure

1. **Read the source fully first.** For a PDF, read every page; capture the
   lecture code/number, title, learning outcomes, section headings, definitions,
   key frameworks/diagrams, formulas, and any worked examples. Don't summarise
   from the title alone.
2. **Re-organise, don't transcribe.** A good note is *better structured than the
   slides*: group scattered points, name the through-lines, surface the 3–5
   things that actually matter, and make relationships explicit.
3. **Preserve fidelity where it counts.** Definitions, formulas, and named
   frameworks must be exact. Everything else is fair game to rephrase for clarity.

## HTML template (adapt, don't blindly copy)

A single document with an inline `<style>`. Design goals: calm, readable,
skimmable; a sticky table of contents; callouts for definitions / key ideas /
exam-relevant points; math via KaTeX; light/dark aware.

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>L01 — Framework & Systems Thinking</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"
  onload="renderMathInElement(document.body,{delimiters:[{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false}]})"></script>
<style>
  :root{--ink:#1a1714;--muted:#5a534b;--faint:#8a827a;--line:#e7e2da;--bg:#faf8f4;--card:#fff;--accent:#c2410c;--accent-soft:#fdeee6}
  @media (prefers-color-scheme:dark){:root{--ink:#ece7df;--muted:#b8b0a6;--faint:#8a827a;--line:#2c2925;--bg:#1a1714;--card:#221f1b;--accent:#e8875a;--accent-soft:#2a1d14}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
       max-width:820px;margin-inline:auto;padding:32px 20px 96px}
  h1{font-size:30px;letter-spacing:-.02em;margin:0 0 4px}
  .sub{color:var(--faint);font-size:14px;margin-bottom:28px}
  h2{font-size:21px;margin:36px 0 10px;padding-top:8px;border-top:1px solid var(--line)}
  h3{font-size:16px;margin:22px 0 6px}
  a{color:var(--accent)}
  .toc{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 18px;margin:0 0 28px}
  .toc b{font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--faint)}
  .toc ol{margin:8px 0 0;padding-left:20px}
  .callout{border:1px solid var(--line);border-left:4px solid var(--accent);background:var(--accent-soft);
           border-radius:8px;padding:12px 16px;margin:16px 0}
  .callout .tag{font-size:11px;letter-spacing:.08em;text-transform:uppercase;font-weight:700;color:var(--accent)}
  .def{border-left-color:#2563eb;background:color-mix(in srgb,#2563eb 8%,transparent)}
  .def .tag{color:#2563eb}
  .exam{border-left-color:#b45309;background:color-mix(in srgb,#b45309 8%,transparent)}
  .exam .tag{color:#b45309}
  .term{font-weight:600}
  table{border-collapse:collapse;width:100%;margin:14px 0;font-size:14px}
  th,td{border:1px solid var(--line);padding:8px 10px;text-align:left}
  th{background:color-mix(in srgb,var(--ink) 5%,transparent)}
  code{background:color-mix(in srgb,var(--ink) 7%,transparent);padding:1px 5px;border-radius:4px;font-size:.9em}
  details{border:1px solid var(--line);border-radius:8px;padding:8px 14px;margin:12px 0;background:var(--card)}
  summary{cursor:pointer;font-weight:600}
  .pill{display:inline-block;font-size:12px;padding:2px 9px;border-radius:999px;background:var(--accent-soft);color:var(--accent);margin:2px 4px 2px 0}
</style>
</head>
<body>
  <h1>Framework &amp; Systems Thinking</h1>
  <div class="sub">ML course · Module 01 · <span>your note date</span></div>

  <nav class="toc"><b>Contents</b>
    <ol><li><a href="#outcomes">Learning outcomes</a></li>
        <li><a href="#big">The big idea</a></li>
        <li><a href="#terms">Key terms</a></li>
        <li><a href="#detail">Detail</a></li>
        <li><a href="#recap">One-minute recap</a></li></ol>
  </nav>

  <h2 id="outcomes">Learning outcomes</h2>
  <ul><li>…</li></ul>

  <div class="callout def"><span class="tag">Definition</span>
    <p><span class="term">Systems thinking</span> — …</p></div>

  <h2 id="big">The big idea</h2>
  <p>…</p>

  <h2 id="terms">Key terms</h2>
  <p><span class="pill">term</span><span class="pill">another</span></p>

  <h2 id="detail">Detail</h2>
  <p>Formulas inline like $E = mc^2$ or display:</p>
  <p>$$ \nabla \cdot \mathbf{E} = \frac{\rho}{\varepsilon_0} $$</p>

  <div class="callout exam"><span class="tag">Exam relevant</span>
    <p>…</p></div>

  <details><summary>Worked example</summary><p>…</p></details>

  <h2 id="recap">One-minute recap</h2>
  <ol><li>…</li></ol>
</body>
</html>
```

## Rules of thumb

- **Self-contained.** All CSS inline. Only `<script src>` / `<link>` to public
  CDNs (KaTeX, a diagram lib) — never same-origin fetches (the viewer sandbox
  gives the note a null origin, so cross-origin CDN is fine but app APIs are not).
- **Callout vocabulary:** `.def` (definitions), plain `.callout` (key idea),
  `.exam` (likely assessed). Use them sparingly — 3–6 per lecture.
- **Math:** wrap in `$…$` / `$$…$$`; KaTeX auto-render handles it.
- **Length:** a note should be readable in a few minutes. Push depth into
  `<details>` so the spine stays skimmable.
- **After writing:** confirm the attachment id came back, then tell the user it's
  on the item and offer to tweak (tone, depth, add diagrams, past-exam angle).

## Iterating

When the user refines a note ("more concise", "add a diagram of X", "tie back to
lecture N"), regenerate the full HTML and `write_note` again (a new attachment),
then optionally remove the old one. Fold durable preferences back into this skill
so the next lecture starts from the improved template.
