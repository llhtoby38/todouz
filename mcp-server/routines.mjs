// routines.mjs — scheduled agent runs ("routines") on the server's own Claude
// session (the Max subscription baked into the container) or an API key.
//
// A routine is a markdown file, data/routines/<name>.md: frontmatter for the
// schedule, the body is the prompt. Same idea as agent-cron: plain files you can
// read and edit. The defaults below are written once; after that the files are
// the user's to change (and a deleted default is not recreated).
//
// Schedules, in local time (TODOUZ_TZ, or the machine's timezone):
//   daily 06:30 · weekdays 07:00 · weekly sun 18:00 · weekly mon,thu 08:00 · every 6h · manual
// A slot missed while the server was down still runs if it is under 3 hours late.
// One routine runs at a time; the rest queue.

import { randomBytes } from 'node:crypto';
import { read, write, exists, listFiles, readJSON, writeJSON, removeFile } from './store.mjs';
import { parseFrontmatter } from './parsers.mjs';

const DIR = 'routines';
const STATE = 'state/routines.json';
const RUNS = 'state/routine-runs.json';
const TZ = process.env.TODOUZ_TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
const GRACE_MS = 3 * 3600 * 1000;
const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// ─── default routines ────────────────────────────────────────────────
const DEFAULTS = {
  'daily-brief': {
    title: 'Daily focus brief', schedule: 'daily 06:30', web: false, max_turns: 40,
    prompt: `You are writing the user's daily focus brief. The aim is clarity under overload: help them see the few things that matter today and clear the noise. Do not lecture.

1. Call brain_context {topic: "today's priorities"}. Respect their preferences: plan by energy (high, medium, low) rather than time slots, a minimum viable next step, capture don't act.
2. Call list_today, list_overdue and list_upcoming {days: 7}. Ignore kitchen inventory (home-stock, recipes) and routine classes unless something is unusual.
3. If an outside workspace is connected (workspace_read), list its in-progress tasks assigned to the user. If none is connected, skip this step silently.
4. Call feed_taste and read their replies for anything they asked for.

Then call feed_post exactly once with kind "brief":
- title: a one-line read of the day, specific to today, never generic.
- body, markdown, under about 180 words, with three short sections:
  **Today's three**: at most three things, each with its energy level and a minimum next step.
  **Can wait**: one line naming what they can consciously ignore today.
  **From your brain**: one note worth keeping in mind, linked as [[slug]].
- items: the three focus items with action "focus", energy and next_step; then up to five stale items, each with action "done" (looks finished but not ticked), "drop" (no longer relevant) or "date" (matters but has no date) and a short why. Use the real epic_slug and id from the tools.
- notes: the Brain slugs you referenced.
Do not create, edit or complete items yourself. The user acts on the suggestions from the feed.`,
  },
  'spark-feed': {
    title: 'Spark feed', schedule: 'daily 07:00', web: true, max_turns: 70,
    prompt: `You make the user's spark feed: short posts that keep them informed and spark their own thinking. Quality over quantity: at most 6 new posts.

1. Call feed_taste first. Fulfil every deeper_request before anything else (step 4).
2. Call brain_context {topic: "current interests and open questions"} and use brain_search to find their fields and live questions. Read their profile and goals (the core Brain notes) to work out their fields. If the Brain is still thin, use the folders and items they are working on as the starting point.
3. New posts, a mix of:
   - news (2 or 3): something from the last 7 days that matters to one of their fields. Search the web, check it, ALWAYS include sources with URLs, and say in one line why it matters to them specifically, linking the Brain note it touches.
   - insight (1 or 2): a non-obvious connection between two or more of their notes or items.
   - resurface (1): an older Brain note worth seeing again, with a fresh angle.
   - question (1): a sharp question that could move a current decision forward.
   Each post: the title is the hook, at most 12 words; body at most 120 words of plain British English; no em dashes, no hype, no filler. tags: 2 to 4 topical tags. notes: related Brain slugs.
4. For each deeper_request: research it properly, then feed_post kind "deep" with reply_to set to the request id, a title that states the finding, up to about 250 words with sources. Save the durable part to the Brain with brain_write (type source or learning, status seed), linking related notes.
5. Steer by their reactions: more of what they sparked, less of what they marked meh, nothing that repeats recent_titles.`,
  },
  'growth-feed': {
    title: 'Growth feed: speaking, conversation, books', schedule: 'daily 07:30', web: true, max_turns: 80, rev: 2,
    prompt: `You are the user's growth coach inside their feed. Read their goals from the core Brain notes (goal and profile) first. By default this routine focuses on communication: speaking in public with confidence, natural conversations, and learning from good books. Follow the goals the user has written down over this default. Model the feed on the best learning apps (RiseGuide's one-idea-a-day lessons, book-summary apps, Readwise), but every card must come from a real, checkable source. Generic advice and lines you made up are worthless to them; they can tell when something is AI filler.

Hard rules for every post:
- Ground it in a named source: a specific book (title, author, and the chapter or principle), a specific talk or video (with its URL), or a credible article or study (with its URL). Search the web and open the page to check it before you post. If you cannot find and check a source, do not make the post.
- Quotes must be real and verbatim from that source. If you are not sure of the exact words, do not use a quote visual.
- Prefer practitioners the user has named, or ones widely respected for the topic (for speaking, for example, Julian Treasure, Chris Anderson, Carmine Gallo, Celeste Headlee, Chris Voss, Dale Carnegie).
- Never write a generic opener such as "what has been the trickiest part of your week". A conversation card must teach a named technique, show its source, and then show how they could use it in one real situation, in their own voice, with one sentence on why it works.
- Plain British English, no em dashes, no hype.

Steps:
1. Call feed_taste (goals, reading_list, practice_14d and recent takes, due_reviews, likes, meh, replies) and journey_status (today's speaking lesson). Build around today's lesson topic where you can, without repeating it.
2. First run only: if goals is empty, create the goal notes "Speak and converse naturally" and "Learn from entrepreneurial books" with brain_write (type "goal", status "growing"). If reading_list is empty, create source notes (type "source", status "seed", tags ["book"]) for The Mom Test, Zero to One, The Lean Startup, Talk Like TED, How to Win Friends and Influence People, Never Split the Difference, Storyworthy.
3. list_upcoming {days: 7} for real situations that need talking (presentations, client or mentor meetings, interviews, networking). Ignore kitchen inventory and routine classes.
4. Post 3 cards:
   - book (1): one principle from a book on their reading list, preferring the one they are reading (status growing). Pass book {title, author} so the real cover is used. title = the principle as a hook. hook = how they could say it in their own words in a real conversation. body = what the author actually argues (with chapter or principle name), two or three concrete takeaways, and when to use it. sources: a page that discusses the book (the author's site, the publisher, or a reputable summary) so it can be checked.
   - hook (1): a named technique from a real source (for example Chris Voss's labelling, Headlee's open questions, Carnegie's names principle, Vinh Giang's pausing) applied to a specific upcoming situation from step 3. Body: the technique and its source, the situation, two example lines they could use, and why it works. sources: the talk or page.
   - drill (1): a 60-second speaking exercise tied to a real technique from a talk or book (with the source URL). Prefer a video (YouTube or TED) as the source so the card shows its thumbnail. visual {type: "steps", title: "60-second drill", items}. If practice_14d shows takes, read their numbers (wpm, fillers, pauses) and target their weakest one.
5. Do not repost due_reviews; the feed shows them itself.
6. Append durable book ideas to the book's note with brain_write mode "append" (idea, chapter, date).
Do not create or change todo items.`,
  },
  'weekly-review': {
    title: 'Weekly done, drop or date', schedule: 'weekly sun 18:00', web: false, max_turns: 50,
    prompt: `Weekly review. Most of the user's sense of overload comes from a list that no longer reflects reality: items that are done but not ticked, ideas that quietly died, and things that matter but have no date. Your job is to make the list honest again, by suggestion only.

1. brain_context {topic: "weekly review"}; list_issues {status: "open"}; list_overdue; list_upcoming {days: 14}. Ignore kitchen inventory (home-stock, recipes) and recurring classes.
2. Pick up to 15 items that most need a decision. For each, suggest one action: "done" (evidence it is finished), "drop" (stale or superseded), "date" (matters, needs a date), or "focus" (should be in next week's few). Give a one-line why.
3. Call feed_post once with kind "triage": title naming the week, body under 150 words with "**Next week's shape**" (the two or three things the week is really about, sorted by energy) and "**Patterns**" (one honest observation, for example a project that keeps slipping, with a link to a Brain note). items: the suggestions with real epic_slug and id.
4. If you notice a durable pattern about how they works, append it to the matching Brain preference or learning note with mode "append", or capture it with brain_capture.
Do not change any items yourself.`,
  },
  'brain-gardener': {
    title: 'Brain gardening', schedule: 'weekly sun 19:00', web: false, max_turns: 50,
    prompt: `Weekly gardening of the user's second brain. Keep it trustworthy and connected. Never invent facts.

1. brain_search {type: "inbox"}. For each capture decide: distil it into one atomic typed note (brain_write, link related notes with [[slug]]), merge it into an existing note (mode "append"), or leave it. Set status "archived" on captures you fully distilled. Never delete.
2. Find notes that should link to each other and add the links by appending a "Related:" line.
3. Find notes whose facts have gone stale (dates passed, decisions superseded) and append a dated update rather than rewriting history.
4. Promote notes to "growing" or "evergreen" only when they have been confirmed or used.
5. feed_post once, kind "note", titled "Brain gardening, week of <date>", summarising what changed, with the touched notes in notes.`,
  },
  'deep-dive': {
    title: 'Dig deeper (on request)', schedule: 'manual', web: true, max_turns: 50,
    prompt: `The user tapped "dig deeper" on a feed post (given below). Research it properly: search the web and read the best sources, and brain_search for their related notes.

1. feed_post kind "deep" with reply_to set to the post id, a title that states what you found, a body of up to about 250 words in plain British English with no em dashes, sources with URLs, and related notes.
2. Save the durable part to the Brain with brain_write (type source, learning or concept, status seed), linking the related notes with [[slug]].`,
  },
  'cradle': {
    title: 'Cradle: let notes meet (on request)', schedule: 'manual', web: false, max_turns: 40,
    prompt: `The user put a few Brain notes into the Cradle (listed below) and asked you to let them meet. Your job is to write one new thinking note that grows out of exactly these notes. You cannot ask them anything.

1. brain_read every note in the cradle, and brain_links {slug} for each, so you know how they already relate. brain_search for at most three other notes only if a claim clearly needs one more piece of evidence; say which ones you used.
2. Think in the mode they chose:
   - "deeper": answer their question as well as these notes allow. Find where they agree, where they pull against each other, and under what conditions each one holds.
   - "connect": find the non-obvious link between the notes: a shared mechanism, a tension, or one note that explains or limits another.
3. Write it with brain_write: a new note (type "note", status "seed", tags ["cradle", plus 1 to 3 topical tags]), with a title that states the idea itself, never "Cradle result". Body in markdown, under about 350 words, with these sections:
   **Question**: their question, or the one you chose if they left it blank.
   **What came out**: the answer or connection in 3 to 6 sentences.
   **Grounding**: one bullet per cradle note: [[slug]] and what it contributes, with a short quote copied word for word from that note in "double quotes". Never put anything inside quotes that is not verbatim from the note.
   **Inference**: what you concluded that the notes do not say directly, and the condition it depends on. Keep the original certainty: "may" in a note stays "may".
   **Next questions**: two short questions worth asking next.
4. feed_post once, kind "insight": the title is the idea (at most 12 words), body at most 90 words saying what met and what came out, notes: the new slug first, then the cradle slugs. Use a visual of type "steps" or "compare" when it helps.
Do not create or change todo items, and do not edit the cradle notes themselves.`,
  },
  'speech-coach': {
    title: 'Speech coach (on request)', schedule: 'manual', web: false, max_turns: 20,
    prompt: `The user recorded a practice take on a drill or lesson card and asked for coaching. The card and their latest takes (measured numbers and the browser's transcript) are below. Be a good speaking coach: specific, warm, and short.

Notes on the numbers: wpm between about 130 and 170 is comfortable for most listeners; fillers are counted from the transcript, and browsers often drop "um" and "uh", so the real count may be higher; pauses are silences of half a second or more, long_pauses are over 2.5 seconds; volume_variety is how much their loudness moved (low means flat delivery). If there are several takes, say what changed between them.

Write ONE feed_post, kind "deep", reply_to the card id, title stating the single most useful fix (at most 10 words). Body under 170 words with:
**What worked**: one or two concrete things, quoting their own words from the transcript.
**Fix next**: the one change that would help most, with a short before and after using their own sentence.
**Structure**: did it have a clear point, a reason or example, and a close? Name what was missing.
**Next take**: one instruction for the next 60-second take.
Use a visual of type "stat" or "compare" if it helps (for example wpm before and after). Do not invent numbers that are not in the takes. Do not create or change todo items.`,
  },
  'feed-reply': {
    title: 'Answer a feed reply (on reply)', schedule: 'manual', web: true, max_turns: 30,
    prompt: `The user replied to a feed post (the post and its reply thread are below; their newest message is the last one from "user"). They expect you to act on it now, like a chat. You cannot ask them anything first.

1. Call feed_taste and feed_prefs {action: "list"} so you know their goals and the standing preferences.
2. Work out what they want, and do it:
   - A preference about the feed ("more like this", "less of X", "too generic", "stop posting about Y", a style they dislike): record it with feed_prefs add, in the right list ("more", "less", "rules" or "mute_tags"), as one short, specific sentence, with post_id. Edit or remove an older entry it replaces. If they dislike this post, also feed_react {reaction: "meh"} on it.
   - A correction ("this is wrong", "that's my test data"): check it. If they are right, say what was wrong and add a rule so it does not happen again.
   - A question: answer it properly. Use WebSearch and WebFetch for facts and brain_search for their notes. Quote sources word for word only.
   - A request for posts ("give me more on this", "make this a drill", "find the book"): make 1 to 3 feed_post cards that do exactly that, following the growth-feed standards: a named, checked source, verbatim quotes, no generic openers, and book {title, author} for book cards so a real cover is fetched. Set reply_to to this post's id.
   - Anything that needs a task: create_issue in the right epic.
3. Always finish with feed_react {id: <this post id>, reaction: "answer", text}: a reply in plain British English, 1 to 4 sentences, no em dashes, that says what you did ("Added a rule: …", "Posted two cards on …", or the answer itself). This is what they sees in the thread, so be direct and specific, never "Great question".
Do not change their todo items unless they asked.`,
  },
  'share-digest': {
    title: 'Shared posts (on share)', schedule: 'manual', web: true, max_turns: 90,
    prompt: `The user shared posts into todouz from other apps (Instagram reels, YouTube videos, tweets, Threads, LinkedIn, articles). Turn each one into something they can use. Runs when they share something.

1. share_list {status: "pending"}. If there are none, finish.
2. Get context once: feed_taste, brain_context {topic: "current projects and the tools they use"}, and list_epics so you know their project folders (category/folder, for example projects/my-app).
3. For each pending share, oldest first:
   a. Work out what the post actually says. Start from their note (it overrides everything), then meta.description (usually the caption), meta.title, meta.author and the shared text. Then WebFetch the url. Instagram, Facebook, Threads and TikTok often hide posts from logged-out fetches; if so, WebSearch the caption, the creator and any names in it to find the same content elsewhere (their YouTube, blog, GitHub, or write-ups). Never invent what a video says. If something is uncertain, say so.
   b. Act on the mode:
      - tools: find every tool it recommends (Claude skills, MCP servers, CLIs, libraries, apps, prompts or techniques). Verify each one on its official repo or site: what it does, how to install or use it, whether it is real and maintained (stars, last release or commit), and the price. Drop anything you cannot verify and say so. For each real tool, brain_write slug "tool-<name>" (mode "append" if it exists), type "source", status "seed", tags ["tool", plus its kind such as "claude-skill", "mcp-server", "cli", "library", "app" or "technique"], body: what it is, install or setup, your verdict, the official link, "Seen in: <share url>", and which of their projects it would help and how. Set projects to those folders.
        Then, for each project that gained a tool, keep a guide note slug "toolkit-<folder>" (title "Toolkit: <project name>", type "note", projects ["<category>/<folder>"]) with three sections: "Try next", "In use", "Skipped". Create it if missing; otherwise brain_read it and brain_write the full updated body, adding each new tool under "Try next" as "[[tool-slug]]: one line on why it fits this project". Never list a tool twice; if it is already there, leave it where it is.
      - learn: distil the key ideas into one atomic Brain note (brain_write, type "learning" or "concept", status "seed"): the core idea in plain words, why it matters to them, the source url, and [[links]] to related notes.
      - save: brain_capture the post with a two-line summary, the url and their note.
      - auto: choose the best of the above yourself. A post recommending tools, skills or apps is "tools"; an explainer or idea is "learn"; anything else is "save".
   c. feed_post exactly once for the share: kind "share", a title stating the result (for example "3 Claude skills from that reel, 2 fit todouz"), body at most 120 words: what the post was, what you found, and the single best thing to try next and where. sources: the share url first, then the verified official links. notes: every Brain slug you wrote. image: meta.image if present. For a list of tools, use visual {type: "steps", title, items: ["tool: what it does", …]}.
   d. share_resolve {id, status: "done", summary (one line), post_id (from feed_post), notes}. If you could not work out the content at all, still feed_post a short share card saying what you could and could not tell and asking them to add a note, then share_resolve with status "failed" and the reason.
Do not create or change todo items. The user decides what to try.`,
  },
};

// ─── time in the user's zone ─────────────────────────────────────────
function parts(ms) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short' });
  const o = {}; for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, hh: +o.hour, mm: +o.minute, ss: +o.second, dow: DOW.indexOf(o.weekday.toLowerCase().slice(0, 3)) };
}
function offsetAt(ms) { const p = parts(ms); return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - Math.floor(ms / 1000) * 1000; }
function wallToUtc(y, m, d, hh, mm) {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let t = guess - offsetAt(guess);
  const o2 = offsetAt(t); if (guess - o2 !== t) t = guess - o2;
  return t;
}
export function localTimeLabel(ms = Date.now()) {
  return new Intl.DateTimeFormat('en-AU', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms));
}
export function localISODate(ms = Date.now()) {
  const p = parts(ms);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}
export function localDateLabel(ms = Date.now()) {
  return new Intl.DateTimeFormat('en-AU', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(ms));
}

// "daily 06:30" → { kind, days:Set<dow>|null, hh, mm, everyH }
export function parseSchedule(s) {
  const t = String(s || '').trim().toLowerCase();
  if (!t || t === 'manual') return { kind: 'manual' };
  let m;
  if ((m = /^every\s+(\d{1,2})\s*h$/.exec(t))) { const n = +m[1]; return n >= 1 && n <= 24 ? { kind: 'every', everyH: n } : null; }
  if ((m = /^(daily|weekdays|weekly\s+([a-z,\s]+))\s+(\d{1,2}):(\d{2})$/.exec(t))) {
    const hh = +m[3], mm = +m[4]; if (hh > 23 || mm > 59) return null;
    let days = null;
    if (m[1] === 'weekdays') days = new Set([1, 2, 3, 4, 5]);
    else if (m[1].startsWith('weekly')) {
      days = new Set(m[2].split(/[,\s]+/).filter(Boolean).map(x => DOW.indexOf(x.slice(0, 3))));
      if (!days.size || days.has(-1)) return null;
    }
    return { kind: 'at', days, hh, mm };
  }
  return null;
}

// Latest scheduled slot at or before `now` (ms), or null.
export function lastSlot(sched, now = Date.now()) {
  if (!sched || sched.kind === 'manual') return null;
  const p = parts(now);
  for (let back = 0; back <= 8; back++) {
    const day = parts(wallToUtc(p.y, p.m, p.d, 12, 0) - back * 86400000);
    if (sched.kind === 'every') {
      for (let h = 24 - sched.everyH; h >= 0; h -= sched.everyH) {
        if (h % sched.everyH) continue;
        const t = wallToUtc(day.y, day.m, day.d, h, 0); if (t <= now) return t;
      }
    } else {
      if (sched.days && !sched.days.has(day.dow)) continue;
      const t = wallToUtc(day.y, day.m, day.d, sched.hh, sched.mm); if (t <= now) return t;
    }
  }
  return null;
}
export function nextSlot(sched, now = Date.now()) {
  if (!sched || sched.kind === 'manual') return null;
  const p = parts(now);
  for (let fwd = 0; fwd <= 8; fwd++) {
    const day = parts(wallToUtc(p.y, p.m, p.d, 12, 0) + fwd * 86400000);
    if (sched.kind === 'every') {
      for (let h = 0; h < 24; h += sched.everyH) { const t = wallToUtc(day.y, day.m, day.d, h, 0); if (t > now) return t; }
    } else {
      if (sched.days && !sched.days.has(day.dow)) continue;
      const t = wallToUtc(day.y, day.m, day.d, sched.hh, sched.mm); if (t > now) return t;
    }
  }
  return null;
}

// ─── routine files ───────────────────────────────────────────────────
const validName = (n) => /^[a-z0-9][a-z0-9-]{0,40}$/.test(String(n || ''));

function serialize(r) {
  return ['---',
    `title: "${String(r.title || r.name).replace(/"/g, "'")}"`,
    `schedule: ${r.schedule || 'manual'}`,
    `enabled: ${r.enabled ? 'true' : 'false'}`,
    `web: ${r.web ? 'true' : 'false'}`,
    `max_turns: ${Number(r.max_turns) || 40}`,
    '---', '', String(r.prompt || '').trim(), ''].join('\n');
}

async function readRoutine(name) {
  if (!validName(name) || !await exists(`${DIR}/${name}.md`)) return null;
  const { frontmatter: fm, body } = parseFrontmatter(await read(`${DIR}/${name}.md`));
  return {
    name, title: String(fm.title || name), schedule: String(fm.schedule || 'manual'),
    enabled: fm.enabled === true, web: fm.web === true, max_turns: Number(fm.max_turns) || 40,
    prompt: String(body || '').trim(),
  };
}

export async function ensureDefaultRoutines() {
  const st = (await readJSON(STATE, {})) || {};
  st.seeded = st.seeded || [];
  let changed = false;
  st.revs = st.revs || {};
  for (const [name, def] of Object.entries(DEFAULTS)) {
    // A default whose prompt was rewritten (rev bumped) replaces the stored
    // prompt once, keeping the schedule and on/off state the user may have changed.
    if (st.seeded.includes(name) && (def.rev || 1) > (st.revs[name] || 1)) {
      const cur = await readRoutine(name);
      const { rev, ...rest } = def;
      await write(`${DIR}/${name}.md`, serialize({ name, ...rest, ...(cur ? { schedule: cur.schedule, enabled: cur.enabled } : { enabled: true }) }));
      st.revs[name] = def.rev; changed = true;
      continue;
    }
    if (st.seeded.includes(name)) continue;
    if (!await exists(`${DIR}/${name}.md`)) { const { rev, ...rest } = def; await write(`${DIR}/${name}.md`, serialize({ name, ...rest, enabled: true })); }
    st.seeded.push(name); if (def.rev) st.revs[name] = def.rev; changed = true;
  }
  if (changed) await writeJSON(STATE, st);
}

export async function listRoutines() {
  const st = (await readJSON(STATE, {})) || {};
  const runs = (await readJSON(RUNS, [])) || [];
  const out = [];
  for (const f of (await listFiles(DIR)).filter(f => f.endsWith('.md'))) {
    const r = await readRoutine(f.slice(0, -3)); if (!r) continue;
    const sched = parseSchedule(r.schedule);
    const last = runs.find(x => x.name === r.name);
    out.push({
      name: r.name, title: r.title, schedule: r.schedule, schedule_valid: !!sched, enabled: r.enabled, web: r.web,
      next_run: r.enabled && sched ? (nextSlot(sched) ? new Date(nextSlot(sched)).toISOString() : null) : null,
      last_run: st.last_run?.[r.name] || null,
      last_status: last ? last.status : null, last_error: last?.error || null,
      running: running?.name === r.name, queued: queue.some(q => q.name === r.name),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getRoutine(name) { return await readRoutine(name); }

export async function saveRoutine(patch = {}) {
  const name = String(patch.name || '');
  if (!validName(name)) return { error: 'name must be lowercase letters, numbers and hyphens' };
  const cur = (await readRoutine(name)) || { name, title: name, schedule: 'manual', enabled: false, web: false, max_turns: 40, prompt: '' };
  const next = { ...cur };
  if (typeof patch.title === 'string' && patch.title.trim()) next.title = patch.title.trim().slice(0, 80);
  if (typeof patch.schedule === 'string') {
    if (!parseSchedule(patch.schedule)) return { error: `can't read the schedule "${patch.schedule}". Try "daily 06:30", "weekdays 07:00", "weekly sun 18:00", "every 6h" or "manual".` };
    next.schedule = patch.schedule.trim().toLowerCase();
  }
  if (patch.enabled !== undefined) next.enabled = patch.enabled === true || patch.enabled === 'true';
  if (patch.web !== undefined) next.web = patch.web === true || patch.web === 'true';
  if (patch.max_turns !== undefined) next.max_turns = Math.max(5, Math.min(150, Number(patch.max_turns) || 40));
  if (typeof patch.prompt === 'string') next.prompt = patch.prompt.slice(0, 20000);
  if (!next.prompt.trim()) return { error: 'a routine needs a prompt' };
  await write(`${DIR}/${name}.md`, serialize(next));
  return { ok: true, routine: next };
}

export async function deleteRoutine(name) {
  if (!await readRoutine(name)) return { error: `no routine ${name}` };
  await removeFile(`${DIR}/${name}.md`);
  return { ok: true };
}

export async function listRuns({ name, limit = 20 } = {}) {
  const runs = (await readJSON(RUNS, [])) || [];
  return runs.filter(r => !name || r.name === name).slice(0, Math.min(100, Number(limit) || 20));
}

// ─── runner ──────────────────────────────────────────────────────────
let running = null;          // { name, id, started }
const queue = [];            // [{ name, trigger, args }]
let runAgentFn = null;       // injected by http-server: ({prompt, system, allowWeb, maxTurns}) → {ok, text, toolCalls, turns, error}
let afterRunFn = null;       // injected: (run) → void (push notifications etc.)

async function recordRun(run) {
  const runs = (await readJSON(RUNS, [])) || [];
  const i = runs.findIndex(r => r.id === run.id);
  if (i >= 0) runs[i] = run; else runs.unshift(run);
  await writeJSON(RUNS, runs.slice(0, 60));
}

export function enqueueRoutine(name, { trigger = 'manual', args = {} } = {}) {
  if (!validName(name)) return { error: 'bad routine name' };
  // args.requeue: new work arrived for a routine that reads its own queue (e.g. a
  // share landing mid-run), so one more run after the current one is needed.
  // Runs about one specific thing (a post, a set of cradle notes) can queue side by side.
  const specific = !!(args.post_id || (Array.isArray(args.slugs) && args.slugs.length));
  if (running?.name === name && !specific && !args.requeue) return { ok: true, already: 'running' };
  if (queue.some(q => q.name === name && !specific)) return { ok: true, already: 'queued' };
  queue.push({ name, trigger, args });
  setTimeout(pump, 0);
  return { ok: true, queued: true, position: queue.length };
}

async function pump() {
  if (running || !queue.length || !runAgentFn) return;
  const job = queue.shift();
  const r = await readRoutine(job.name);
  if (!r) { setTimeout(pump, 0); return; }
  const id = `${job.name}-${Date.now().toString(36)}-${randomBytes(2).toString('hex')}`;
  running = { name: r.name, id, started: new Date().toISOString() };
  const run = { id, name: r.name, title: r.title, trigger: job.trigger, started: running.started, finished: null, status: 'running', summary: null, error: null, tool_calls: 0, turns: null };
  await recordRun(run);
  const st = (await readJSON(STATE, {})) || {};
  st.last_run = { ...(st.last_run || {}), [r.name]: running.started };
  await writeJSON(STATE, st);

  let extra = '';
  if (job.args?.post_id) {
    try { const p = JSON.parse(await read(`feed/${job.args.post_id}.json`)); extra = `\n\nThe post (id ${p.id}):\n\`\`\`json\n${JSON.stringify({ id: p.id, kind: p.kind, title: p.title, hook: p.hook, body: p.body, sources: p.sources, notes: p.notes, tags: p.tags, ...(r.name === 'speech-coach' ? { lesson: p.lesson, visual: p.visual, takes: (p.reactions?.sessions || []).slice(-3) } : {}), ...(r.name === 'feed-reply' ? { thread: (p.reactions?.replies || []).slice(-8).map(x => ({ from: x.from || 'user', at: x.at, text: x.text })) } : {}) }, null, 2)}\n\`\`\``; }
    catch { extra = `\n\n(The post ${job.args.post_id} could not be read.)`; }
  }
  if (Array.isArray(job.args?.slugs) && job.args.slugs.length) {
    const mode = job.args.mode === 'connect' ? 'connect' : 'deeper';
    extra += `\n\nNotes in the cradle: ${job.args.slugs.map(x => `[[${x}]]`).join(', ')}\nMode: ${mode}\nHis question: ${job.args.question ? JSON.stringify(job.args.question) : '(none: choose the most useful question these notes raise)'}`;
  }
  const system = `You are "${r.name}", a scheduled todouz routine running unattended on the user's server. Right now it is ${localDateLabel()}, ${localTimeLabel()} (${localISODate()}, ${TZ}). Nobody is watching this run, so never ask questions: decide, act through the tools, and finish with one line summarising what you did.
- Every feed_post you make must include routine "${r.name}" and run_id "${id}", and source "${r.name}".
- Every brain_write or brain_capture must include source "${r.name}".
- Write in plain British English: specific, no em dashes, no hype, no filler.
- The feed is read like a shorts feed, so make posts visual: when a number, comparison, ranking, quote or short sequence carries the point, attach a feed_post visual (stat, compare, bars, quote or steps; see the feed_post description). Keep the body short when the visual already says it.
- Tasks belong in todouz items, durable knowledge in the Brain, things to read in the feed.
- Be time-aware. Everything is relative to right now: "today" means ${localISODate()}. If it is past midday, plan the rest of the day, not the whole day. Never put something whose time has already passed into today's plan; treat it as overdue instead. When an item has a due date or time, say it (for example "due today 18:00" or "overdue since Mon 12 Oct"), and use words like "tomorrow" only next to the actual date, because the post may be read later.`;
  try {
    // The run's identity rides into the todouz MCP process as env vars, so every
    // post and Brain write is stamped with it server-side, whatever the model says.
    const res = await runAgentFn({ prompt: r.prompt + extra, system, allowWeb: r.web, maxTurns: r.max_turns, env: { TODOUZ_ROUTINE: r.name, TODOUZ_RUN_ID: id } });
    Object.assign(run, { status: res.ok ? 'ok' : 'error', summary: String(res.text || '').slice(0, 1200), error: res.error || null, tool_calls: res.toolCalls || 0, turns: res.turns || null });
  } catch (e) {
    Object.assign(run, { status: 'error', error: String(e?.message || e) });
  }
  run.finished = new Date().toISOString();
  // Which feed posts did this run make?
  try {
    const posts = [];
    for (const f of (await listFiles('feed')).filter(f => f.endsWith('.json'))) {
      const p = JSON.parse(await read(`feed/${f}`));
      if (p.run_id === id || (p.routine === r.name && p.created >= run.started)) posts.push({ id: p.id, kind: p.kind, title: p.title });
    }
    run.posts = posts;
  } catch { run.posts = []; }
  await recordRun(run);
  running = null;
  try { if (afterRunFn) await afterRunFn(run); } catch {}
  setTimeout(pump, 0);
}

export function routineStatus() { return { running, queue: queue.map(q => ({ name: q.name, trigger: q.trigger })) }; }

// Called every minute: queue any enabled routine whose latest slot has not run yet.
async function tick() {
  try {
    const st = (await readJSON(STATE, {})) || {};
    const now = Date.now();
    for (const f of (await listFiles(DIR)).filter(f => f.endsWith('.md'))) {
      const r = await readRoutine(f.slice(0, -3));
      if (!r || !r.enabled) continue;
      const slot = lastSlot(parseSchedule(r.schedule), now);
      if (!slot || now - slot > GRACE_MS) continue;
      const last = st.last_run?.[r.name] ? new Date(st.last_run[r.name]).getTime() : 0;
      if (last < slot) enqueueRoutine(r.name, { trigger: 'schedule' });
    }
  } catch (e) { console.error('[routines] tick failed', e?.message || e); }
}

export async function startRoutineScheduler({ runAgent, afterRun, intervalMs = 60000, autoRun = true } = {}) {
  runAgentFn = runAgent; afterRunFn = afterRun;
  await ensureDefaultRoutines();
  // A run that was in flight when the server stopped will never finish: mark it.
  const runs = (await readJSON(RUNS, [])) || [];
  let dirty = false;
  for (const r of runs) if (r.status === 'running') { r.status = 'error'; r.error = 'server restarted during the run'; r.finished = r.finished || new Date().toISOString(); dirty = true; }
  if (dirty) await writeJSON(RUNS, runs);
  if (!autoRun) return null;   // manual runs only
  setTimeout(tick, 15000);
  return setInterval(tick, intervalMs);
}
