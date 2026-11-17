// tools.mjs — the canonical tool catalogue + dispatcher.
//
// Used by:
//   - mcp-server/index.mjs (stdio MCP)
//   - mcp-server/http-server.mjs (HTTP /api/* + /api/chat)
//   - scripts/migrate.mjs
//
// Every tool returns a JSON-serialisable result. Errors are { error: "msg" } —
// they never throw across the JSON-RPC boundary.

import { join } from 'node:path';
import {
  read, write, exists, listDirs, listFiles, ensureDir, removeFile,
  readJSON, writeJSON, DATA_ROOT, TODOUZ_ROOT,
} from './store.mjs';
import { saveAttachmentBytes, getAttachmentMeta } from './attachments.mjs';
import { BRAIN_TOOLS, handleBrainCall } from './brain.mjs';
import { FEED_TOOLS, handleFeedCall } from './feed.mjs';
import { SOURCE_TOOLS, handleSourceCall } from './sources.mjs';
import { SHARE_TOOLS, handleShareCall } from './shares.mjs';
import { currentCtx, guardCall, filterResult, claimCategory, LEGACY_OWNER } from './access.mjs';
import { profileRelFor } from './brain.mjs';
import {
  parseEpic, serializeEpic,
  parseIssues, serializeIssues, serializeIssue,
  startOfDay, fmtISO, parseISODate, diffDays, dayName,
} from './parsers.mjs';
import {
  reindexAll as dbReindexAll,
  getStats as dbGetStats,
  DB_FILE,
  syncEpicFromDisk,
  syncCompletionsFromDisk,
  syncEventsFromDisk,
  syncTimeblocksFromDisk,
  syncSessionsFromDisk,
} from './db.mjs';

// Public base for deep-links returned as `app_url`. A link of the form
// <APP_BASE>/dashboard/#issue=<epic_slug>/<id> opens that exact item in the app
// drawer — agents put these in action-item tables so a row taps straight to its
// page. Override via TODOUZ_PUBLIC_URL if the app is hosted elsewhere.
const APP_BASE = (process.env.TODOUZ_PUBLIC_URL || `http://localhost:${process.env.PORT || 8765}`).replace(/\/+$/, '');
function issueAppUrl(epicSlug, id) { return `${APP_BASE}/dashboard/#issue=${epicSlug}/${id}`; }

// ─── reminders ────────────────────────────────────────────────────────
// Session/item times are wall-clock in the user's timezone; the server may run
// in UTC, so convert a "YYYY-MM-DD" + "HH:MM" in TODOUZ_TZ to an epoch ms.
const TODOUZ_TZ = process.env.TODOUZ_TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
function tzOffsetMs(atMs) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: TODOUZ_TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(atMs));
  const m = {}; for (const x of p) m[x.type] = x.value;
  const asUTC = Date.UTC(+m.year, +m.month - 1, +m.day, +(m.hour === '24' ? 0 : m.hour), +m.minute, +m.second);
  return asUTC - atMs;   // ms the tz is ahead of UTC at that instant
}
function zonedMs(dateISO, timeHM) {
  const [Y, M, D] = String(dateISO || '').split('-').map(Number);
  const [h, mi] = String(timeHM || '00:00').split(':').map(Number);
  if (!Y || !M || !D) return null;
  const naive = Date.UTC(Y, M - 1, D, h || 0, mi || 0);
  let ms = naive - tzOffsetMs(naive);
  ms = naive - tzOffsetMs(ms);   // second pass resolves DST-transition edges
  return ms;
}
function reminderLead(mins) {
  return mins >= 1440 ? `${Math.round(mins / 1440)}d` : mins >= 60 ? `${Math.round(mins / 60)}h` : `${mins}m`;
}
// Every session/item that carries a `reminder` (lead-time minutes), with the
// epoch ms it should fire at. The push scheduler decides which are due now.
export async function collectReminders() {
  const out = [];
  const fireKey = (ms) => new Date(ms).toISOString().slice(0, 16);   // minute precision
  try {
    for (const b of await readBlocks()) {
      const mins = Number(b && b.reminder);
      if (!mins || b.completed) continue;
      const startMs = zonedMs(b.date, b.start);
      if (startMs == null) continue;
      const fireAt = startMs - mins * 60000;
      out.push({
        key: `session:${b.id}:${fireKey(fireAt)}`,
        title: `⏰ ${b.title}`,
        body: `Starts at ${b.start} (in ${reminderLead(mins)})`,
        url: (b.issue_id && b.epic_slug) ? issueAppUrl(b.epic_slug, b.issue_id) : `${APP_BASE}/dashboard/`,
        fireAt,
        row: { epic_slug: b.epic_slug || null, owner: b.owner || LEGACY_OWNER },
      });
    }
  } catch (e) { console.error('[reminders] sessions', e?.message || e); }
  try {
    const completion = await readJSON('state/completion.json', {});
    for (const cat of await listDirs('epics')) {
      for (const short of await listDirs(`epics/${cat}`)) {
        const slug = `${cat}/${short}`;
        const parsed = parseIssues(await read(`epics/${cat}/${short}/issues.md`));
        for (const it of parsed.issues) {
          const mins = Number(it.fields.reminder);
          if (!mins || !it.fields.due) continue;
          if (isIssueCompleted(it, completion, slug)) continue;
          const dueMs = zonedMs(it.fields.due, it.fields.due_time || '09:00');
          if (dueMs == null) continue;
          const fireAt = dueMs - mins * 60000;
          out.push({
            key: `item:${slug}/${it.id}:${fireKey(fireAt)}`,
            title: `⏰ ${it.title}`,
            body: `${it.fields.due_time ? `Due at ${it.fields.due_time}` : 'Due today'} (in ${reminderLead(mins)})`,
            url: issueAppUrl(slug, it.id),
            fireAt,
            row: { epic_slug: slug },
          });
        }
      }
    }
  } catch (e) { console.error('[reminders] items', e?.message || e); }
  return out;
}

// Convenience wrappers — swallow sync errors so a DB hiccup never breaks the
// canonical markdown write. The user can always `reindex_database` to recover.
async function syncEpic(slug) {
  try { await syncEpicFromDisk(slug); } catch (e) { console.error('[db sync epic]', slug, e?.message || e); }
}
async function syncCompletions() {
  try { await syncCompletionsFromDisk(); } catch (e) { console.error('[db sync completions]', e?.message || e); }
}
async function syncEvents() {
  try { await syncEventsFromDisk(); } catch (e) { console.error('[db sync events]', e?.message || e); }
}
async function syncTimeblocks() {
  try { await syncTimeblocksFromDisk(); } catch (e) { console.error('[db sync timeblocks]', e?.message || e); }
}
async function syncSessions() {
  try { await syncSessionsFromDisk(); } catch (e) { console.error('[db sync sessions]', e?.message || e); }
}

// ─── catalogue ────────────────────────────────────────────────────────

export const CATEGORIES = ['work', 'projects', 'learning', 'health', 'home', 'personal'];

export const TOOLS = [
  // ─── read ───
  {
    name: 'list_categories',
    description: 'List the fixed enum of life categories. No args.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_agents',
    description: 'List all agents in the registry under data/agents/. Returns name, category, role excerpt, and session count for each.',
    inputSchema: {
      type: 'object',
      properties: { category: { type: 'string', description: 'Optional filter — one of the category enum values.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'list_epics',
    description: 'List all epics under data/epics/, optionally filtered by category and/or agent owner. Returns slug, title, agent_owner, recurring flag, open_issue_count, next_due.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string' },
        agent: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_epic',
    description: 'Fetch a single epic. Returns frontmatter, full epic.md body, and the issue list.',
    inputSchema: {
      type: 'object',
      properties: { slug: { type: 'string', description: 'e.g. "learning/ml-course"' } },
      required: ['slug'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_issues',
    description: 'List issues across one or more epics, with filters. Default returns open issues only.',
    inputSchema: {
      type: 'object',
      properties: {
        epic: { type: 'string', description: 'Restrict to one epic slug. If omitted, scans all epics.' },
        agent: { type: 'string' },
        status: { type: 'string', enum: ['open', 'completed', 'all'], description: 'Default "open".' },
        priority: { type: 'string', enum: ['high', 'medium', 'low'] },
        due_within_days: { type: 'number', description: 'Open issues with due ≤ today + N. Use 0 for "due today".' },
        recurring: { type: 'boolean' },
        pinned: { type: 'boolean', description: 'Filter by pinned state — pass true for only pinned items (they show atop the Overview).' },
        query: { type: 'string', description: 'Substring match on title + description.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Only issues carrying ALL of these tags (AND semantics). Tags are lowercase kebab, e.g. ["fast", "protein"].' },
        limit: { type: 'number' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_issue',
    description: 'Fetch a single issue. If `epic` is omitted, scans all epics for the id. WORKLOG CONVENTION: when you fetch an issue to WORK on it, you own documenting the work back into the issue — read_skill("issue-worklog"), keep a "## Work log" in the description, and pass a `summary` to complete_issue when done.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'e.g. "ISS-014"' },
        epic: { type: 'string' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'write_note',
    description: "Write a note onto an item. ALWAYS write the `markdown` version — it is the canonical, human-editable source stored in the item's description. ADDITIONALLY pass `html` ONLY when the content is complex enough that a rich visual layout gives a materially better experience (e.g. data worth charting, comparison tables, diagrams, colour-coded callouts) — a self-contained HTML render that the dashboard shows in preference to the markdown. Keep the html faithful to the markdown. For simple notes, markdown alone is correct. The source file (e.g. a lecture PDF) stays the item's attachment — this tool doesn't touch attachments. Returns the item id.",
    inputSchema: {
      type: 'object',
      properties: {
        epic: { type: 'string', description: 'The item\'s epic_slug, e.g. "projects/my-app".' },
        id: { type: 'string', description: 'The item id, e.g. "ISS-004".' },
        markdown: { type: 'string', description: 'The note as markdown → becomes the item description (the canonical source). Almost always provide this.' },
        html: { type: 'string', description: 'OPTIONAL rich HTML render (a complete self-contained <!doctype html> document, inline <style>, CDN libs via <script src>). Provide only when visuals materially help (charts/diagrams/tables). Pass an empty string to clear an existing render.' },
      },
      required: ['epic', 'id'],
      additionalProperties: false,
    },
  },
  {
    name: 'attach_image',
    description: `Upload a screenshot/image and embed it in an item's markdown body. This is the ONLY way to put an actual image into an item over MCP/the API — pass the raw image BYTES as base64 (or a full "data:image/png;base64,..." URL), NOT a file path or a description of the image. The bytes are stored as an attachment (served at /api/attachments/<id>) and a Markdown image embed is added so it renders inline in the item.

WHEN CAPTURING EVIDENCE (screenshots proving a task/test result):
 • embed:true (default) appends the image to the body — good for a single "here's proof" shot.
 • For a STRUCTURED layout (e.g. one screenshot under each row/task), call this once per image with embed:false to just upload + get the \`markdown\` string back, then write the whole body ONCE with update_issue, dropping each returned \`![alt](url)\` where it belongs.
NEVER write a placeholder like "[screenshot here]" or "attach a screenshot" into the body, and NEVER use ASCII separators (####…) — see the screenshots-and-evidence skill. Returns { attachment_id, url, markdown }.`,
    inputSchema: {
      type: 'object',
      properties: {
        epic: { type: 'string', description: 'The item\'s epic_slug, e.g. "work/platform".' },
        id: { type: 'string', description: 'The item id, e.g. "ISS-037".' },
        data: { type: 'string', description: 'The image BYTES as base64 (a bare base64 string, or a full "data:image/png;base64,…" URL). Not a file path, not a description. Provide this OR attachment_id.' },
        attachment_id: { type: 'string', description: 'Embed an ALREADY-uploaded image by its attachment id instead of uploading new bytes — e.g. an image the user pasted into chat that the app pre-saved (its id is given to you in the message). Use this OR data.' },
        mime: { type: 'string', description: 'Image MIME type: image/png (default), image/jpeg, image/gif, image/webp. Inferred from a data: URL if you pass one.' },
        filename: { type: 'string', description: 'Optional filename for the attachment (e.g. "at-064-tram-filter.png"). Auto-generated if omitted.' },
        alt: { type: 'string', description: 'Alt text for the image (what it shows). Falls back to caption/filename.' },
        caption: { type: 'string', description: 'Optional italic caption rendered under the image (e.g. "AT-064: tram filter, 1766 → 152 active").' },
        embed: { type: 'boolean', description: 'true (default) = also insert the ![](url) into the item description. false = only upload + return the markdown string for you to place yourself.' },
        position: { type: 'string', enum: ['end', 'start'], description: 'When embed:true, add the image at the end (default, above any Work log) or start of the body.' },
      },
      required: ['epic', 'id'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_today',
    description: 'Schedule view for one day. Defaults to today (server local). Returns due issues, recurring issues whose schedule hits today, events, and overdue count.',
    inputSchema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'ISO YYYY-MM-DD. Default today.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'list_upcoming',
    description: 'Schedule view for the next N days. Returns one entry per day in range with the issues + recurring + events that touch it.',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'How many days ahead. Default 7.' },
        from_date: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_profile',
    description: 'Read data/personal/profile.md — the user\'s profile. Use to ground reasoning in their preferences and patterns.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  // ─── skills ───
  {
    name: 'list_skills',
    description: 'List all domain skills under data/skills/. Each skill is a markdown playbook (when to use it + operating rules). ALWAYS check this list when a request touches a recognisable domain (shopping, meal planning, gym, studies, reflection…) and read_skill the matching one BEFORE acting.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'read_skill',
    description: 'Read one skill\'s full markdown body (its operating rules). Call after list_skills identifies a relevant skill.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Skill file name without .md, e.g. "shopping-list".' } },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'write_skill',
    description: 'Create or overwrite a skill playbook under data/skills/<name>.md. Use when the user teaches you a new repeatable workflow ("from now on when I ask X, do Y").',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Lowercase kebab file name, no .md.' },
        description: { type: 'string', description: 'One-line summary shown in list_skills.' },
        when_to_use: { type: 'string', description: 'Trigger conditions — what user asks should activate this skill.' },
        body: { type: 'string', description: 'The full markdown playbook (operating rules, steps, tool sequences).' },
      },
      required: ['name', 'description', 'body'],
      additionalProperties: false,
    },
  },
  // ─── write ───
  {
    name: 'create_issue',
    description: `Create a new issue under an epic. Returns the new issue id (auto-generated as ISS-NNN per epic).

IMPORTANT:
 • Description is markdown. Use real newlines (literal LF), NOT escaped "\\n" sequences —
   the markdown renderer treats backslash-n as plain text and shows it as "\\n" to the user.
 • Issues are static — they cannot be recurring. If a piece of work happens weekly (gym
   session, weekly report), create the issue once and attach a recurring TIMEBLOCK to it
   via add_timeblock with recurring:true + recurring_schedule.
 • due is a YYYY-MM-DD string; due_time is an optional HH:MM. Only set due_time when you
   have a real time-of-day deadline (e.g. submission cutoff).
 • FORMATTING (issue-worklog skill): verb-first imperative title, no trailing period; the first
   description line states what "done" means; ALWAYS tag actionable items with an effort tag +
   a time estimate. When you later work this issue, keep a "## Work log" in its description.
 • ORGANISING: to group work, create a top-level "action list" item, then create each task with
   parent_issue_id set to it, and keep an "## Action items" markdown table in the parent linking
   each row to its sub-item via that sub-item's app_url (returned below). See the issue-worklog skill.
 • The response includes app_url — a deep-link that opens this exact item in the app. Use it as the
   link target in action-item tables; never reference a bare "ISS-NNN".`,
    inputSchema: {
      type: 'object',
      properties: {
        epic: { type: 'string', description: 'Epic slug.' },
        title: { type: 'string' },
        description: { type: 'string' },
        due: { type: 'string', description: 'ISO YYYY-MM-DD.' },
        priority: { type: 'string', enum: ['high', 'medium', 'low'] },
        recurring: { type: 'boolean' },
        recurring_schedule: { type: 'object' },
        agent: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Lowercase kebab tags, e.g. ["fast", "protein", "main"]. ALWAYS tag new issues: meal/effort/food-category for recipes, effort + estimated time (time-15m / time-30m / time-60m) for tasks.' },
        type: { type: 'string', enum: ['issue', 'item', 'folder'], description: 'issue (default) = actionable work that wants scheduled timeblocks. item = a thing (salt, a book, a purchase) — completable but never nagged about missing timeblocks. folder = a pure grouping node that holds child issues (e.g. a recipe meal-category); no due/priority semantics, excluded from open counts + schedules.' },
        auto_complete: { type: 'boolean', description: 'auto-complete: once its due date/time passes it counts as done automatically (no manual completion) — for classes, appointments, a pilates session.' },
        assign_to: { description: 'Who this is assigned to — an array of usernames (e.g. ["alex","sam"]) or a single/comma-separated string. Multiple assignees allowed. Defaults to the creator.' },
        parent_issue_id: { type: 'string', description: 'Nest this new item under a parent item in the SAME epic (its id, e.g. "ISS-004"). Use for action-list grouping — the parent holds the linked Action items table.' },
        reminder: { type: 'number', description: 'Push a reminder this many MINUTES before the due time (e.g. 10, 30, 60, 1440 for a day). Needs a due date; if no due_time, fires relative to 09:00 on the due day.' },
        subtasks: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, due: { type: 'string' } }, required: ['text'] } },
      },
      required: ['epic', 'title'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_issue',
    description: 'Update an existing issue\'s fields. Sub-tasks are not modified — use add_subtask / toggle_subtask for those. WORKLOG: preserve the "## Work log" section in the description — append to it, never overwrite; note *why* when you change scope (see the issue-worklog skill).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        epic: { type: 'string' },
        patch: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            due: { type: 'string' },
            priority: { type: 'string' },
            agent: { type: 'string' },
            recurring: { type: 'boolean' },
            recurring_schedule: { type: 'object' },
            status: { type: 'string', enum: ['open', 'completed'] },
            parent_issue_id: { type: 'string', description: 'Re-parent to another issue. Pass empty string or null to detach.' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Replace the tag list. Lowercase kebab. Pass [] to clear.' },
            type: { type: 'string', enum: ['issue', 'item', 'folder'], description: 'Convert between actionable issue, item (no timeblock nagging), and grouping folder.' },
            auto_complete: { type: 'boolean', description: 'auto-complete: once its due date/time passes it counts as done automatically (no manual completion) — for classes, appointments, a pilates session.' },
            pinned: { type: 'boolean', description: 'Pin the item to the top of the Overview page regardless of due date — for recurring-ish items (a shopping list) you don\'t want to keep re-dating. Pass false to unpin.' },
            reminder: { type: 'number', description: 'Lead-time MINUTES before the due time to push a reminder (10 / 30 / 60 / 1440). Needs a due date. Pass 0 or null to clear.' },
            assign_to: { description: 'Assignees — an array of usernames (e.g. ["alex","sam"]) or a single/comma-separated string. Pass [] or "" to unassign everyone.' },
            related_issues: {
              type: 'array',
              items: { type: 'string' },
              description: 'Replace the related-issue links. Each ref MUST be fully qualified "<category>/<epic>/ISS-nnn" (e.g. "kitchen/recipes/ISS-023") — ids are per-epic, so a bare ISS-001 is ambiguous. Refs that don\'t match that shape are dropped. Rendered in the dashboard as tappable links, so use it to hang a shopping list off the recipes it came from. Pass [] to clear.',
            },
          },
        },
      },
      required: ['id', 'patch'],
      additionalProperties: false,
    },
  },
  {
    name: 'move_issue',
    description: 'Move an issue from one epic to another. The issue is reassigned a fresh id from the target epic\'s counter (since issue ids are scoped per-epic). Sub-issues are moved with their parent. Every cross-reference is rewritten: timeblock.epic_slug/issue_id, completion keys, parent_issue_id refs inside the source/target.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Issue id (ISS-NNN) to move.' },
        epic: { type: 'string', description: 'Source epic slug (category/short). Required so we hit the right ISS-NNN — ids are not globally unique.' },
        target_epic: { type: 'string', description: 'Destination epic slug (category/short).' },
      },
      required: ['id', 'epic', 'target_epic'],
      additionalProperties: false,
    },
  },
  {
    name: 'complete_issue',
    description: 'Mark an issue done. ALWAYS pass `summary` — an outcome-first recap of the work — which is appended under a "## Work log" section in the issue description so every completed issue carries a summary the user can read under it (see the issue-worklog skill). For non-recurring: flips status to "completed" + writes completion.json. For recurring: appends a log entry AND writes a per-instance completion key (id#date); the recurring issue itself stays open.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        epic: { type: 'string' },
        summary: { type: 'string', description: 'REQUIRED by convention: a concise, outcome-first recap of what was done. Appended as a dated entry under "## Work log" in the issue description + saved in the completion record. For recurring issues it doubles as the log entry.' },
        log_note: { type: 'string', description: 'Alias of `summary` for recurring issues — what got done. Stored in completion.json AND under ### Log.' },
        for_date: { type: 'string', description: 'For recurring — ISO date. Default today.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_subtask',
    description: 'Append a sub-task to an issue\'s ### Sub-tasks block (creating it if missing).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        epic: { type: 'string' },
        text: { type: 'string' },
        due: { type: 'string' },
      },
      required: ['id', 'text'],
      additionalProperties: false,
    },
  },
  {
    name: 'toggle_subtask',
    description: 'Toggle a sub-task checkbox by matching its text. Pass `done` to set explicitly, omit to flip.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        epic: { type: 'string' },
        subtask_text: { type: 'string' },
        done: { type: 'boolean' },
      },
      required: ['id', 'subtask_text'],
      additionalProperties: false,
    },
  },
  {
    name: 'append_to_epic',
    description: 'Append a bullet to a section in an epic\'s epic.md. Use for journaling progressions, observations, decisions — anything slow-changing that belongs in the epic\'s context, not in an issue.',
    inputSchema: {
      type: 'object',
      properties: {
        epic: { type: 'string' },
        section: { type: 'string', description: 'H2 section name; created if missing.' },
        line: { type: 'string', description: 'Bullet content (no leading "- ").' },
      },
      required: ['epic', 'section', 'line'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_session',
    description: "Edit a saved session's display title (or clear it to fall back to the first-message excerpt). Use when the user renames a chat thread in the AgentsDrawer.",
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string' },
        patch: {
          type: 'object',
          properties: {
            title: { type: ['string', 'null'], description: "Display title. Null/empty clears it." },
          },
          additionalProperties: true,
        },
      },
      required: ['session_id', 'patch'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_session',
    description: 'Unlink a saved session from the dashboard sidebar. The underlying JSONL transcript at ~/.claude/projects/.../<sid>.jsonl stays on disk by default (safe; can be re-linked later) — pass purge:true to also delete the file.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string' },
        purge: { type: 'boolean', description: 'If true, also delete the JSONL transcript file. Default false.' },
      },
      required: ['session_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_sessions',
    description: 'List Claude Code chat sessions linked to issues.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string' },
        issue_id: { type: 'string' },
        limit: { type: 'number' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'link_session',
    description: 'Link a Claude Code session id to an issue.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string' },
        issue_id: { type: 'string' },
        epic: { type: 'string' },
        agent: { type: 'string' },
      },
      required: ['session_id', 'issue_id'],
      additionalProperties: false,
    },
  },
  // ─── timeblocks (planned work sessions on the calendar) ───
  // A timeblock is a chunk of time you've committed to doing work in.
  // Distinct from events (external commitments) and issues (deliverables) — this is
  // "I will sit down and work on X from 8pm-11pm tonight." Renders on Today + WeekStrip.
  {
    name: 'add_timeblock',
    description: `Plan a work session at a specific time, optionally linked to an issue.

CRITICAL — picking the right (issue_id, epic_slug):
 • Issue ids ("ISS-NNN") are NOT globally unique — each epic has its own ISS-001, ISS-002, etc.
 • You MUST pass both issue_id AND epic_slug whenever you link a block to an issue. The server
   refuses to guess and will return an error if the pair doesn't resolve to a real issue.
 • Before linking, locate the actual issue via list_issues / get_issue. Don't assume "ISS-001"
   maps to the epic you have in mind — linking a flight to body/gym/ISS-001 because both happen
   to be ISS-001 is exactly the bug we guard against.
 • If the right epic doesn't exist yet, create it with create_epic FIRST, then add an issue
   under it via create_issue, then add this block. Do not invent a duplicate epic.

Bulk weekly generation: set repeat_weeks: N (max 52) to create N concrete blocks one week apart
starting from \`date\`. Each generated block is fully independent — editable, reschedulable,
deletable, completable on its own. Use this for "the next 12 gym sessions" — the user can then
write a different itinerary per session. There is NO recurring/template concept; everything
that lives on the calendar is a real row in timeblocks.json.`,
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'ISO YYYY-MM-DD (first occurrence when repeat_weeks > 1)' },
        start: { type: 'string', description: 'HH:MM (24h)' },
        end: { type: 'string', description: 'HH:MM (24h)' },
        title: { type: 'string', description: 'What you\'ll do in this block.' },
        issue_id: { type: 'string', description: 'Optional ISS-NNN — must come paired with epic_slug to resolve correctly.' },
        epic_slug: { type: 'string', description: 'Required if issue_id is set. Otherwise optional epic categorisation.' },
        note: { type: 'string', description: 'Optional multi-line context (markdown).' },
        repeat_weeks: { type: 'number', description: 'Optional. When > 1, also creates additional blocks one week apart (independent rows). Default 1. Capped at 52.' },
        auto_complete: { type: 'boolean', description: 'Optional. When true, the session counts as done once its end time passes — it stops showing as an unfinished session. Use for classes / pilates / anything you attend but never tick off.' },
        reminder: { type: 'number', description: 'Optional. Push a reminder this many MINUTES before the session start (e.g. 10, 30, 60).' },
      },
      required: ['date', 'start', 'end', 'title'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_timeblocks',
    description: 'List planned work sessions in a date range. Default: today only.',
    inputSchema: {
      type: 'object',
      properties: {
        from_date: { type: 'string' },
        to_date: { type: 'string' },
        issue_id: { type: 'string' },
        epic_slug: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'update_timeblock',
    description: 'Update an existing timeblock. Every block is a concrete row — patch any field on it directly. To move one occurrence of a "weekly" series to a different date, just patch its `date`; the others stay where they are.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        patch: {
          type: 'object',
          properties: {
            date: { type: 'string' },
            start: { type: 'string' },
            end: { type: 'string' },
            title: { type: 'string' },
            note: { type: 'string' },
            issue_id: { type: 'string' },
            epic_slug: { type: 'string' },
            reminder: { type: 'number', description: 'Lead-time minutes before start to push a reminder; null/0 clears it.' },
          },
          additionalProperties: true,
        },
      },
      required: ['id', 'patch'],
      additionalProperties: false,
    },
  },
  {
    name: 'complete_timeblock',
    description: 'Mark a timeblock done. Optional `note` records what actually happened (so partial completion is captured).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        note: { type: 'string' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_timeblock',
    description: 'Remove a timeblock from the schedule. Use when the user says "cancel / scrap / drop" a planned session.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_overdue',
    description: 'List all open (non-recurring) issues whose `due` date is before today. Sorted by days-overdue descending — most overdue first. Includes a `days_overdue` field per issue. Used by the dashboard to render an Overdue section so unfinished work from prior days never disappears.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Cap the result. Default unlimited.' },
        epic: { type: 'string', description: 'Restrict to a single epic.' },
        max_days_overdue: { type: 'number', description: 'Hide items overdue by more than N days (e.g. ancient orphans).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_completed',
    description: 'List completed (archived) issues, with optional date-range and search query. Used by the dashboard archive view AND by external agents who want to see what was finished recently.',
    inputSchema: {
      type: 'object',
      properties: {
        days_back: { type: 'number', description: 'How far back to look. Default 30.' },
        query: { type: 'string', description: 'Substring search on title.' },
        epic: { type: 'string' },
        limit: { type: 'number' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'create_subissue',
    description: `Create a sub-issue under an existing parent. Inherits the parent's epic + agent + priority unless overridden. Sub-issues can themselves have sub-issues — arbitrary depth.

Same markdown-newline + recurring + due/due_time rules as create_issue apply. The parent must
already exist (look it up via list_issues / get_issue). parent_issue_id + parent_epic are both
required — relying on issue-id-only lookup is fragile because ISS-NNN is per-epic, not global.`,
    inputSchema: {
      type: 'object',
      properties: {
        parent_issue_id: { type: 'string' },
        parent_epic: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        due: { type: 'string' },
        priority: { type: 'string', enum: ['high', 'medium', 'low'] },
        agent: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Lowercase kebab tags — same conventions as create_issue.' },
        type: { type: 'string', enum: ['issue', 'item', 'folder'], description: 'Same semantics as create_issue. Stock entries under a category folder are type "item".' },
        subtasks: { type: 'array', items: { type: 'object' } },
      },
      required: ['parent_issue_id', 'title'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_issue',
    description: 'Permanently remove an issue and all its sub-issues. Use only on user "delete / scrap / remove" intent — for done items use complete_issue (which keeps them in the archive). Prefer completing with a "won\'t do — <reason>" summary over deleting whenever there is history worth keeping; never silently delete (see the issue-worklog skill).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        epic: { type: 'string' },
        cascade: { type: 'boolean' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_epic',
    description: "Patch an epic's frontmatter (title, agent_owner, related_epics, category, short_slug) and/or replace its body content. Patching `category` or `short_slug` MOVES the folder (data/epics/<cat>/<short> → data/epics/<newCat>/<newShort>) and rewrites every cross-reference (completion keys, timeblock epic_slugs, issue-counter key). The slug returned in the response may differ from the slug passed in if a move happened.",
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string' },
        patch: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            category: { type: 'string', description: 'Move the epic to this category. Lowercase letters/digits/dashes. Pass a new value to create a new category folder.' },
            short_slug: { type: 'string', description: 'Rename the short slug (the part after category/). Lowercase letters/digits/dashes.' },
            color: { type: 'string', description: 'Per-folder colour as a hex string (e.g. "#0e7490") used on the calendar/plan blocks + list accents, overriding the category default. Pass null / "" to clear and fall back to the category colour.' },
            agent_owner: { type: 'string' },
            related_epics: { type: 'array', items: { type: 'string' } },
            body: { type: 'string' },
          },
          additionalProperties: true,
        },
      },
      required: ['slug', 'patch'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_epic',
    description: 'Permanently delete an entire epic — its folder, all issues, sub-issues, and arbitrary files. Also cleans up completion entries and timeblocks linked to its issues. Use only on explicit user instruction (scrap / kill / remove / abandon). Cannot be undone.',
    inputSchema: {
      type: 'object',
      properties: { slug: { type: 'string' } },
      required: ['slug'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_epic',
    description: `Create a new epic. Creates data/epics/<category>/<slug>/ with epic.md + empty issues.md.

ALWAYS check first with list_epics whether a fitting epic already exists. The slug is the
folder name and must be unique within the category. Do NOT create duplicates like
"personal/lisbon-trip" when "travel/lisbon-trip" already exists — pick the
existing one or rename intentionally. Epics are persistent; clean-up is annoying.

The slug MUST be lowercase letters/digits/dashes only (no spaces, no underscores).`,
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Any lowercase-dashes name (e.g. "work", "health", "personal"). Common defaults: work, projects, learning, health, home, personal. New values spin up a new top-level folder.' },
        slug: { type: 'string', description: 'short identifier within the category, e.g. "ml-course" (lowercase, no spaces)' },
        title: { type: 'string', description: 'human-readable title' },
        agent_owner: { type: 'string', description: 'optional default agent for issues in this epic' },
        body: { type: 'string', description: 'optional long-form context written after frontmatter' },
      },
      required: ['category', 'slug', 'title'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_category',
    description: 'Create a new (empty) top-level category folder under data/epics/. Categories are just folders — they show as columns in the dashboard\'s by-epic view even before any epic lives in them.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Lowercase letters/digits/dashes, e.g. "health", "finance".' },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_category',
    description: 'Permanently delete an entire top-level category folder (data/epics/<name>/) and EVERY epic, issue, sub-issue, and file inside it. Also cleans completion entries, timeblocks, issue counters, and the visibility/projects flags for that category. The remove counterpart to create_category. Cannot be undone — use only on explicit user instruction (scrap / kill / remove).',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'category folder name (lowercase-dashes), e.g. "kitchen".' },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_subtask',
    description: 'Rename a sub-task on an issue. Matches by current text (case-insensitive substring). For toggling done/undone use toggle_subtask instead.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        epic: { type: 'string' },
        match_text: { type: 'string', description: 'current sub-task text to match' },
        new_text: { type: 'string', description: 'replacement text' },
        new_due: { type: 'string', description: 'optional ISO due date for the sub-task — pass null/empty to clear' },
      },
      required: ['id', 'match_text', 'new_text'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_subtask',
    description: 'Remove a sub-task from an issue. Matches by current text (case-insensitive substring).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        epic: { type: 'string' },
        match_text: { type: 'string' },
      },
      required: ['id', 'match_text'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_full_context',
    description: "One-shot dump of the user's complete state for external agents (e.g. a planner attached via `claude mcp add todouz` from another session). Returns: profile, today, next 14 days, all open issues across all epics, all timeblocks, upcoming events, and recent completions in a single payload. Use when an agent without prior context needs to plan or reason about the user's full situation. WORKLOG CONVENTION: document work back into each issue you act on — read_skill(\"issue-worklog\"), keep a \"## Work log\" in the description, and pass a summary to complete_issue on completion.",
    inputSchema: {
      type: 'object',
      properties: {
        days_ahead: { type: 'number' },
        days_back: { type: 'number' },
        max_issues: { type: 'number' },
      },
      additionalProperties: false,
    },
  },
  // ─── arbitrary file storage per epic ─────────────────────────────────
  // Lets agents create notes, drafts, references, transcripts, etc. inside an epic folder.
  // Files are plain markdown/text — readable by hand + by every other agent attached to this MCP.
  {
    name: 'list_epic_files',
    description: 'List arbitrary files stored under an epic (in addition to epic.md / issues.md). Use to discover what notes / drafts / references exist for a given subject.',
    inputSchema: {
      type: 'object',
      properties: { epic: { type: 'string' } },
      required: ['epic'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_epic_file',
    description: 'Read a file under an epic folder by name. Returns full contents.',
    inputSchema: {
      type: 'object',
      properties: { epic: { type: 'string' }, filename: { type: 'string' } },
      required: ['epic', 'filename'],
      additionalProperties: false,
    },
  },
  {
    name: 'write_epic_file',
    description: 'Create or overwrite a file under an epic folder. Use ONLY for epic-WIDE docs no single item owns — a full-course study guide, a transcript, a multi-week cheat sheet. For notes/summaries ABOUT a specific item (e.g. lecture notes for a "Week N" item, notes distilled from an attached slide PDF), DO NOT use this — use write_note, which puts a rich HTML note into that item\'s DESCRIPTION. Filename is sanitised; existing files are overwritten.',
    inputSchema: {
      type: 'object',
      properties: {
        epic: { type: 'string' },
        filename: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['epic', 'filename', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'append_epic_file',
    description: 'Append content to an existing epic file (or create it if missing). For incrementally building up notes across sessions.',
    inputSchema: {
      type: 'object',
      properties: {
        epic: { type: 'string' },
        filename: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['epic', 'filename', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_epic_file',
    description: 'Remove a file from an epic folder. Refuses to delete epic.md or issues.md.',
    inputSchema: {
      type: 'object',
      properties: { epic: { type: 'string' }, filename: { type: 'string' } },
      required: ['epic', 'filename'],
      additionalProperties: false,
    },
  },
  // ─── events (one-offs not tied to issues) ───
  {
    name: 'materialize_recurring',
    description: "Create a concrete instance issue from a recurring template for a given date. Each week's recurring task (gym session, weekly report) gets its own unique issue with its own subtasks/log/completion state — editing this week's instance won't affect next week's. The template stays as a schedule + defaults. Idempotent: returns the existing instance if one already exists for that date.",
    inputSchema: {
      type: 'object',
      properties: {
        template_id: { type: 'string', description: 'ISS-NNN of the recurring template.' },
        epic: { type: 'string', description: 'Epic slug (e.g. "body/gym"). Optional but recommended for disambiguation.' },
        date: { type: 'string', description: 'ISO YYYY-MM-DD the instance is for. Defaults to today.' },
      },
      required: ['template_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_event',
    description: 'Add a one-off scheduled event (e.g. "Flight to Lisbon"). Not actionable, just informational on the calendar.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        date: { type: 'string', description: 'ISO YYYY-MM-DD' },
        time: { type: 'string', description: 'HH:MM' },
        duration_min: { type: 'number' },
        category: { type: 'string' },
        note: { type: 'string' },
      },
      required: ['title', 'date'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_events',
    description: 'List one-off events from data/state/events.json. Optional date range / category filter.',
    inputSchema: {
      type: 'object',
      properties: {
        from_date: { type: 'string' },
        to_date: { type: 'string' },
        category: { type: 'string' },
      },
      additionalProperties: false,
    },
  },

  {
    name: 'update_event',
    description: 'Patch fields on an existing event by id: title / date / time / duration_min / category / note. Any unspecified field is left alone.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        patch: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            date: { type: 'string' },
            time: { type: 'string' },
            duration_min: { type: 'number' },
            category: { type: 'string' },
            note: { type: 'string' },
          },
          additionalProperties: true,
        },
      },
      required: ['id', 'patch'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_event',
    description: 'Permanently delete an event by id from state/events.json. Use to remove stale calendar markers or duplicates.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
  },

  // ─── database (SQLite read-index over markdown) ───
  {
    name: 'reindex_database',
    description: 'Rebuild the SQLite read-index from the markdown source-of-truth. Safe to call any time. Returns row counts per table.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_database_stats',
    description: 'Return current SQLite index stats: row counts per table, db file path, and metadata about the last reindex run.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  // ─── second brain (brain.mjs) ───
  ...BRAIN_TOOLS,
  // ─── spark feed (feed.mjs) ───
  ...FEED_TOOLS,
  // ─── read-only connected workspaces (sources.mjs) ───
  ...SOURCE_TOOLS,
  // ─── posts shared in from other apps (shares.mjs) ───
  ...SHARE_TOOLS,
];

// ─── dispatcher ───────────────────────────────────────────────────────

// Every call goes through access control: the caller (currentCtx) is checked
// against the categories/rows the call touches, and the result is trimmed to
// what they may see. No caller = the operator on the box → unrestricted.
export async function handleCall(name, args = {}) {
  const ctx = currentCtx();
  if (!ctx) return await dispatch(name, args);
  args = { ...(args || {}) };
  // Ownership is server-assigned; nobody can hand a row to someone else.
  if (args.patch && typeof args.patch === 'object') {
    args.patch = { ...args.patch };
    delete args.patch.owner;
  }
  try {
    const denied = await guardCall(name, args, ctx);
    if (denied) return denied;
    return await filterResult(name, await dispatch(name, args), ctx);
  } catch (e) {
    return { error: String(e?.message || e) };
  }
}

async function dispatch(name, args = {}) {
  try {
    switch (name) {
      case 'list_categories': return await listCategoriesFn();
      case 'list_agents':     return await listAgentsFn(args);
      case 'list_epics':      return await listEpicsFn(args);
      case 'get_epic':        return await getEpicFn(args);
      case 'list_issues':     return await listIssuesFn(args);
      case 'get_issue':       return await getIssueFn(args);
      case 'write_note':      return await writeNoteFn(args);
      case 'attach_image':    return await attachImageFn(args);
      case 'list_today':      return await listTodayFn(args);
      case 'list_upcoming':   return await listUpcomingFn(args);
      case 'get_profile':     return await getProfileFn();
      case 'list_skills':     return await listSkillsFn();
      case 'read_skill':      return await readSkillFn(args);
      case 'write_skill':     return await writeSkillFn(args);
      case 'create_issue':    return await createIssueFn(args);
      case 'update_issue':    return await updateIssueFn(args);
      case 'move_issue':      return await moveIssueFn(args);
      case 'complete_issue':  return await completeIssueFn(args);
      case 'add_subtask':     return await addSubtaskFn(args);
      case 'toggle_subtask':  return await toggleSubtaskFn(args);
      case 'append_to_epic':  return await appendToEpicFn(args);
      case 'set_render_html': return await setRenderHtmlFn(args);
      case 'list_sessions':   return await listSessionsFn(args);
      case 'link_session':    return await linkSessionFn(args);
      case 'update_session':  return await updateSessionFn(args);
      case 'delete_session':  return await deleteSessionFn(args);
      case 'materialize_recurring': return await materializeRecurringFn(args);
      case 'create_subissue':       return await createSubissueFn(args);
      case 'list_completed':        return await listCompletedFn(args);
      case 'list_overdue':          return await listOverdueFn(args);
      case 'delete_issue':          return await deleteIssueFn(args);
      case 'update_epic':           return await updateEpicFn(args);
      case 'delete_epic':           return await deleteEpicFn(args);
      case 'get_full_context':      return await getFullContextFn(args);
      case 'list_epic_files':       return await listEpicFilesFn(args);
      case 'read_epic_file':        return await readEpicFileFn(args);
      case 'write_epic_file':       return await writeEpicFileFn(args);
      case 'append_epic_file':      return await appendEpicFileFn(args);
      case 'delete_epic_file':      return await deleteEpicFileFn(args);
      case 'add_event':       return await addEventFn(args);
      case 'list_events':     return await listEventsFn(args);
      case 'update_event':    return await updateEventFn(args);
      case 'delete_event':    return await deleteEventFn(args);
      case 'add_timeblock':       return await addTimeblockFn(args);
      case 'list_timeblocks':     return await listTimeblocksFn(args);
      case 'update_timeblock':    return await updateTimeblockFn(args);
      case 'complete_timeblock':  return await completeTimeblockFn(args);
      case 'delete_timeblock':    return await deleteTimeblockFn(args);
      case 'reindex_database':    return await dbReindexAll();
      case 'get_database_stats':  return dbGetStats();
      case 'create_epic':         return await createEpicFn(args);
      case 'create_category':     return await createCategoryFn(args);
      case 'delete_category':     return await deleteCategoryFn(args);
      case 'update_subtask':      return await updateSubtaskFn(args);
      case 'delete_subtask':      return await deleteSubtaskFn(args);
      default: {
        if (name.startsWith('brain_')) {
          const r = await handleBrainCall(name, args);
          if (r !== undefined) return r;
        }
        if (name.startsWith('feed_')) {
          const r = await handleFeedCall(name, args);
          if (r !== undefined) return r;
        }
        if (name === 'workspace_read') return await handleSourceCall(name, args);
        if (name.startsWith('share_')) {
          const r = await handleShareCall(name, args);
          if (r !== undefined) return r;
        }
        return { error: `unknown tool: ${name}` };
      }
    }
  } catch (e) {
    return { error: String(e?.message || e), stack: e?.stack };
  }
}

// ─── implementations ──────────────────────────────────────────────────

// Categories used to be a hard-coded enum. Now we derive them dynamically from the
// filesystem (every subdirectory under data/epics/) so the user can spin up new ones
// freely. CATEGORIES is preserved as a *default* list used only when the dir is empty.
async function listCategoriesFn() {
  const existing = await listDirs('epics');
  const all = new Set([...CATEGORIES, ...existing]);
  return { categories: Array.from(all).sort() };
}

async function listAgentsFn({ category }) {
  const names = await listDirs('agents');
  const out = [];
  for (const name of names) {
    const identity = await read(`agents/${name}/identity.md`);
    const roleMatch = identity.match(/^_?Role:?_?\s*(.+)$/m);
    const excerpt = roleMatch ? roleMatch[1].trim() :
      identity.split('\n').filter(l => l.trim() && !l.startsWith('#')).slice(0, 2).join(' ').slice(0, 200);
    // Find category from agents-by-category mapping
    const meta = await readJSON('state/agent-meta.json', {});
    const cat = (meta[name] && meta[name].category) || null;
    if (category && cat !== category) continue;
    const sessions = await listFiles(`agents/${name}/sessions`);
    out.push({ name, category: cat, role_excerpt: excerpt, session_count: sessions.length });
  }
  return { agents: out };
}

async function listEpicsFn({ category, agent } = {}) {
  const epics = [];
  const cats = category ? [category] : await listDirs('epics');
  const completion = await readJSON('state/completion.json', {});
  for (const cat of cats) {
    const slugs = await listDirs(`epics/${cat}`);
    for (const slug of slugs) {
      const epicMd = await read(`epics/${cat}/${slug}/epic.md`);
      const issuesMd = await read(`epics/${cat}/${slug}/issues.md`);
      if (!epicMd && !issuesMd) continue;
      const epic = parseEpic(epicMd);
      const issues = parseIssues(issuesMd).issues;
      const ownerAgent = epic.frontmatter.agent_owner || null;
      if (agent && ownerAgent !== agent) continue;
      const epicSlug = `${cat}/${slug}`;
      // Folders are pure grouping nodes — they never count as open work.
      const open = issues.filter(it => !isIssueCompleted(it, completion, epicSlug) && (it.fields.type || 'issue') !== 'folder');
      // `open_issue_count` is what the EpicCard header chip shows: actionable
      // issues that aren't nested under another actionable issue. Children of
      // FOLDERS still count as top-level — the folder is just shelving.
      const byId = new Map(issues.map(it => [it.id, it]));
      const isTopActionable = (it) => {
        if (it.fields.template_id) return false;
        let p = it.fields.parent_issue_id ? byId.get(it.fields.parent_issue_id) : null;
        while (p) {
          if ((p.fields.type || 'issue') !== 'folder') return false;  // nested under real work
          p = p.fields.parent_issue_id ? byId.get(p.fields.parent_issue_id) : null;
        }
        return true;
      };
      const openTop = open.filter(isTopActionable);
      // Next due date among open (top-level + sub)
      const dued = open.map(it => it.fields.due).filter(Boolean).sort();
      epics.push({
        slug: `${cat}/${slug}`,
        title: epic.frontmatter.title || slug,
        category: cat,
        color: epic.frontmatter.color || null,     // per-folder colour override (else category default)
        agent_owner: ownerAgent,
        recurring: !!(epic.frontmatter.recurring_schedule && (Array.isArray(epic.frontmatter.recurring_schedule) ? epic.frontmatter.recurring_schedule.length : true)),
        open_issue_count: openTop.length,
        open_total_count: open.length,             // includes sub-issues — exposed in case any caller wants it
        total_issue_count: issues.length,
        next_due: dued[0] || null,
      });
    }
  }
  epics.sort((a, b) => a.slug.localeCompare(b.slug));
  return { epics };
}

async function getEpicFn({ slug }) {
  if (!slug || !slug.includes('/')) return { error: 'slug must be "category/short-name"' };
  const [cat, short] = slug.split('/');
  const epicMd = await read(`epics/${cat}/${short}/epic.md`);
  const issuesMd = await read(`epics/${cat}/${short}/issues.md`);
  if (!epicMd && !issuesMd) return { error: `epic not found: ${slug}` };
  const epic = parseEpic(epicMd);
  const issues = parseIssues(issuesMd).issues;
  const completion = await readJSON('state/completion.json', {});
  const annotated = issues.map(it => ({
    id: it.id,
    title: it.title,
    fields: it.fields,
    description: it.description,
    subtasks: it.subtasks,
    log: it.log,
    linked_files: it.linked_files,
    default_itinerary: it.default_itinerary,
    is_completed: isIssueCompleted(it, completion, slug),
    completion: lookupCompletion(completion, slug, it.id),
  }));
  return {
    slug,
    category: cat,
    title: epic.frontmatter.title || short,
    color: epic.frontmatter.color || null,
    agent_owner: epic.frontmatter.agent_owner || null,
    related_epics: epic.frontmatter.related_epics || [],
    recurring_schedule: epic.frontmatter.recurring_schedule || null,
    epic_md: epicMd,
    body: epic.body,
    issues: annotated,
  };
}

async function listIssuesFn({ epic, agent, status = 'open', priority, due_within_days, recurring, pinned, query, tags, limit } = {}) {
  const wantTags = normalizeTags(tags);
  const completion = await readJSON('state/completion.json', {});
  const out = [];
  const todayD = startOfDay(new Date());
  const horizon = due_within_days != null ? new Date(todayD.getTime() + due_within_days * 86400000) : null;
  let epics;
  if (epic) {
    const [cat, short] = epic.split('/');
    epics = [{ cat, short }];
  } else {
    epics = [];
    const cats = await listDirs('epics');
    for (const c of cats) for (const s of await listDirs(`epics/${c}`)) epics.push({ cat: c, short: s });
  }
  for (const { cat, short } of epics) {
    const issuesMd = await read(`epics/${cat}/${short}/issues.md`);
    const epicMd = await read(`epics/${cat}/${short}/epic.md`);
    const epicData = parseEpic(epicMd);
    const epicAgent = epicData.frontmatter.agent_owner;
    const issues = parseIssues(issuesMd).issues;
    const epicSlugLocal = `${cat}/${short}`;
    for (const it of issues) {
      const completed = isIssueCompleted(it, completion, epicSlugLocal);
      if (status === 'open' && completed) continue;
      if (status === 'completed' && !completed) continue;
      const itAgent = it.fields.agent || epicAgent;
      if (agent && itAgent !== agent) continue;
      if (priority && it.fields.priority !== priority) continue;
      if (recurring != null && !!it.fields.recurring !== !!recurring) continue;
      if (pinned != null && !!it.fields.pinned !== !!pinned) continue;
      if (horizon && it.fields.due) {
        const d = parseISODate(it.fields.due);
        if (!d || d > horizon || d < todayD) continue;
      } else if (horizon && !it.fields.due) {
        continue;
      }
      if (query) {
        const blob = (it.title + ' ' + it.description).toLowerCase();
        if (!blob.includes(query.toLowerCase())) continue;
      }
      if (wantTags.length) {
        const itTags = it.fields.tags || [];
        if (!wantTags.every(t => itTags.includes(t))) continue;
      }
      // Look up parent title within this epic (sub-issues live in the same issues.md)
      let parent_title = null;
      if (it.fields.parent_issue_id) {
        const p = issues.find(x => x.id === it.fields.parent_issue_id);
        if (p) parent_title = p.title;
      }
      out.push({
        id: it.id,
        epic_slug: `${cat}/${short}`,
        title: it.title,
        description_snippet: (it.description || '').slice(0, 400),
        type: it.fields.type || 'issue',
        tags: it.fields.tags || [],
        agent: itAgent,
        due: it.fields.due,
        due_time: it.fields.due_time || null,
        created: it.fields.created || null,
        priority: it.fields.priority || 'medium',
        recurring: !!it.fields.recurring,
        pinned: !!it.fields.pinned,
        reminder: it.fields.reminder || null,
        status: completed ? 'completed' : 'open',
        open_subtask_count: it.subtasks.filter(s => !s.done).length,
        total_subtask_count: it.subtasks.length,
        is_completed: completed,
        template_id: it.fields.template_id || null,
        instance_date: it.fields.instance_date || null,
        parent_issue_id: it.fields.parent_issue_id || null,
        parent_title,
      });
    }
  }
  // Sort: due ascending (no-due last), then priority high→low, then id
  const PRIO = { high: 0, medium: 1, low: 2 };
  out.sort((a, b) => {
    if (!!a.due !== !!b.due) return a.due ? -1 : 1;
    if (a.due && b.due && a.due !== b.due) return a.due.localeCompare(b.due);
    const pa = PRIO[a.priority] ?? 1, pb = PRIO[b.priority] ?? 1;
    if (pa !== pb) return pa - pb;
    return a.id.localeCompare(b.id);
  });
  return { count: out.length, issues: limit ? out.slice(0, limit) : out };
}

async function getIssueFn({ id, epic }) {
  const target = await locateIssue(id, epic);
  if (!target) return { error: `issue not found: ${id}` };
  const { cat, short, issue, parsed } = target;
  const completion = await readJSON('state/completion.json', {});
  // Children = any issue in the same epic whose parent_issue_id points at us.
  const epicAgent = parseEpic(await read(`epics/${cat}/${short}/epic.md`)).frontmatter.agent_owner;
  const children = parsed.issues
    .filter(it => it.fields.parent_issue_id === issue.id)
    .map(it => toIssueSummary(cat, short, it, epicAgent, parsed.issues));

  // Ancestor chain: walk parent_issue_id up to the root, recording {id, title} each step.
  // The frontend renders these as a breadcrumb so the parent context is visible
  // at a glance even on deeply nested sub-issues.
  const ancestors = [];
  let parentId = issue.fields.parent_issue_id || null;
  const seen = new Set([issue.id]);  // cycle guard
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = parsed.issues.find(it => it.id === parentId);
    if (!parent) break;
    ancestors.unshift({
      id: parent.id,
      title: parent.title,
      epic_slug: `${cat}/${short}`,
    });
    parentId = parent.fields.parent_issue_id || null;
  }

  // Resolve related refs into renderable rows. A ref that no longer points at a
  // live issue comes back with missing:true rather than being dropped, so a
  // broken link is visible instead of silently disappearing.
  const related = [];
  for (const ref of (issue.fields.related_issues || [])) {
    const parts = String(ref).split('/');
    if (parts.length !== 3) continue;
    const [rcat, rshort, rid] = parts;
    const rslug = `${rcat}/${rshort}`;
    let found = null;
    try {
      const rparsed = parseIssues(await read(`epics/${rcat}/${rshort}/issues.md`));
      found = rparsed.issues.find(it => it.id === rid) || null;
    } catch {}
    related.push(found
      ? {
          id: found.id, epic_slug: rslug, title: found.title,
          tags: found.fields.tags || [],
          is_completed: isIssueCompleted(found, completion, rslug),
        }
      : { id: rid, epic_slug: rslug, title: ref, missing: true });
  }

  // The optional AI-generated HTML render lives outside issues.md (keeps the
  // markdown file clean + parse-safe). Markdown is the source; if a render
  // exists the dashboard prioritises it for display.
  const renderHtml = await read(`renders/${cat}/${short}/${issue.id}.html`);

  return {
    id: issue.id,
    epic_slug: `${cat}/${short}`,
    app_url: issueAppUrl(`${cat}/${short}`, issue.id),   // deep-link that opens this item in the app
    title: issue.title,
    fields: issue.fields,
    description: issue.description,
    description_html: renderHtml || null,
    subtasks: issue.subtasks,
    related,
    default_itinerary: issue.default_itinerary,
    log: issue.log,
    linked_files: issue.linked_files,
    is_completed: isIssueCompleted(issue, completion, `${cat}/${short}`),
    completion: lookupCompletion(completion, `${cat}/${short}`, issue.id),
    children,
    parent_issue_id: issue.fields.parent_issue_id || null,
    ancestors,
  };
}

async function listTodayFn({ date } = {}) {
  const day = date ? parseISODate(date) : startOfDay(new Date());
  if (!day) return { error: 'invalid date' };
  const dow = day.getDay();
  const dayStr = fmtISO(day);
  const todayD = startOfDay(new Date());
  const completion = await readJSON('state/completion.json', {});
  const eventsAll = (await readJSON('state/events.json', { events: [] })).events || [];

  // walk all epics
  const due = [];
  const recurring = [];
  let overdue = 0;
  // Track which (template_id) already has an instance for this day → so we suppress the template itself.
  const instancedTemplateIds = new Set();
  const cats = await listDirs('epics');
  for (const c of cats) {
    for (const s of await listDirs(`epics/${c}`)) {
      const md = await read(`epics/${c}/${s}/issues.md`);
      const epicMd = await read(`epics/${c}/${s}/epic.md`);
      const epicAgent = parseEpic(epicMd).frontmatter.agent_owner;
      const issues = parseIssues(md).issues;
      const epicSlugT = `${c}/${s}`;
      for (const it of issues) {
        if (isIssueCompleted(it, completion, epicSlugT)) {
          // If a completed instance for today exists, mark its template as "covered"
          if (it.fields.template_id && it.fields.instance_date === dayStr) {
            instancedTemplateIds.add(it.fields.template_id);
          }
          continue;
        }
        if (it.fields.recurring) {
          // Templates handled in the suppression pass below.
          continue;
        }
        // Concrete issue (one-off) or recurring instance
        const itDue = it.fields.due ? parseISODate(it.fields.due) : null;
        if (!itDue) continue;
        if (itDue.getTime() === day.getTime()) {
          due.push(toIssueSummary(c, s, it, epicAgent, issues));
          if (it.fields.template_id) instancedTemplateIds.add(it.fields.template_id);
        } else if (itDue < todayD) {
          overdue++;
        }
      }
    }
  }
  // Second pass: only show recurring templates whose instances aren't already in due_today.
  for (const c of cats) {
    for (const s of await listDirs(`epics/${c}`)) {
      const md = await read(`epics/${c}/${s}/issues.md`);
      const epicMd = await read(`epics/${c}/${s}/epic.md`);
      const epicAgent = parseEpic(epicMd).frontmatter.agent_owner;
      const issues = parseIssues(md).issues;
      for (const it of issues) {
        if (!it.fields.recurring) continue;
        if (instancedTemplateIds.has(it.id)) continue;
        const rs = it.fields.recurring_schedule;
        if (!rs) continue;
        if (rs.dow !== dow && rs.dow != dow) continue;
        // Honour the optional end date: if `until` is set, suppress occurrences past it.
        // `from` is symmetric — if set, suppress before it.
        if (rs.until && dayStr > rs.until) continue;
        if (rs.from && dayStr < rs.from) continue;
        // Instance key form: <epic>/<id>#<date> (qualified) — fall back to legacy <id>#<date>
        const qualifiedInst = `${c}/${s}/${it.id}#${dayStr}`;
        const legacyInst    = `${it.id}#${dayStr}`;
        if (completion[qualifiedInst] || completion[legacyInst]) continue;
        recurring.push(toIssueSummary(c, s, it, epicAgent, issues));
      }
    }
  }

  const events = eventsAll.filter(e => e.date === dayStr);
  // Use the same expansion logic as listTimeblocksFn so recurring templates synthesize
  // a virtual instance on every matching dow within the window.
  const tbResp = await listTimeblocksFn({ from_date: dayStr, to_date: dayStr });
  const blocks = (tbResp.blocks || []).sort((a, b) => a.start.localeCompare(b.start));
  return {
    date: dayStr,
    weekday: dayName(day),
    due_today: due,
    recurring_today: recurring,
    events_today: events,
    timeblocks_today: blocks,
    overdue_count: overdue,
  };
}

async function listUpcomingFn({ days = 7, from_date } = {}) {
  const start = from_date ? parseISODate(from_date) : startOfDay(new Date());
  if (!start) return { error: 'invalid from_date' };
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    const dayPayload = await listTodayFn({ date: fmtISO(d) });
    out.push({
      date: dayPayload.date,
      weekday: dayPayload.weekday,
      items: [...dayPayload.due_today, ...dayPayload.recurring_today],
      events: dayPayload.events_today,
      timeblocks: dayPayload.timeblocks_today || [],
    });
  }
  return { from: fmtISO(start), days, days_list: out };
}

async function getProfileFn() {
  const content = await read(profileRelFor(currentCtx()?.user, 'profile'));
  return { content };
}

// ─── skills ───────────────────────────────────────────────────────────
// A skill is a markdown playbook at data/skills/<name>.md with a light
// frontmatter block (--- fenced) carrying `description` and `when_to_use`.
// The chat system prompt injects the skill INDEX (names + when_to_use);
// the agent reads the full body on demand with read_skill.
function parseSkillFrontmatter(md) {
  const out = { description: '', when_to_use: '', body: md || '' };
  if (!md || !md.startsWith('---')) return out;
  const end = md.indexOf('\n---', 3);
  if (end === -1) return out;
  const fm = md.slice(3, end).trim();
  out.body = md.slice(end + 4).trim();
  for (const line of fm.split('\n')) {
    const m = line.match(/^(\w[\w_]*):\s*(.*)$/);
    if (m) {
      if (m[1] === 'description') out.description = m[2].trim();
      if (m[1] === 'when_to_use') out.when_to_use = m[2].trim();
    }
  }
  return out;
}

async function listSkillsFn() {
  await ensureDir('skills');
  const files = await listFiles('skills');
  const skills = [];
  for (const f of files) {
    if (!f.endsWith('.md')) continue;
    const md = await read(`skills/${f}`);
    const { description, when_to_use } = parseSkillFrontmatter(md);
    skills.push({ name: f.replace(/\.md$/, ''), description, when_to_use });
  }
  skills.sort((a, b) => a.name.localeCompare(b.name));
  return { count: skills.length, skills };
}

async function readSkillFn({ name } = {}) {
  if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) return { error: 'name must be lowercase kebab (no .md)' };
  const md = await read(`skills/${name}.md`);
  if (!md) return { error: `skill not found: ${name}` };
  const { description, when_to_use, body } = parseSkillFrontmatter(md);
  return { name, description, when_to_use, body };
}

async function writeSkillFn({ name, description, when_to_use, body } = {}) {
  if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) return { error: 'name must be lowercase kebab (no .md)' };
  if (!description || !body) return { error: 'description and body are required' };
  await ensureDir('skills');
  const md = `---\ndescription: ${description}\n${when_to_use ? `when_to_use: ${when_to_use}\n` : ''}---\n\n${body.trim()}\n`;
  await write(`skills/${name}.md`, md);
  return { ok: true, name };
}

// Normalise a caller-supplied tag list to lowercase kebab. Accepts anything
// array-ish; silently drops empties so sloppy agent calls don't error.
// Related-issue refs are always FULLY QUALIFIED — "<category>/<epic>/ISS-nnn".
// Issue ids are per-epic (ISS-020), so a bare "ISS-001" is genuinely ambiguous:
// kitchen/recipes/ISS-001 is Breakfast, kitchen/home-stock/ISS-001 is Spices.
const RELATED_REF_RE = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*\/ISS-\d+$/i;
function normalizeRelated(refs) {
  if (!Array.isArray(refs)) return [];
  const out = [];
  for (const r of refs) {
    const v = String(r || '').trim();
    if (RELATED_REF_RE.test(v) && !out.includes(v)) out.push(v);
  }
  return out;
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags
    .map(t => String(t).trim().toLowerCase().replace(/\s+/g, '-'))
    .filter(Boolean);
}

// assign_to → array of lowercased usernames. Accepts an array, a single string,
// or a comma-separated string. "" / null / undefined all clear it to [].
function normalizeAssignees(a) {
  const arr = Array.isArray(a) ? a : String(a || '').split(',');
  return [...new Set(arr.map(s => String(s).trim().toLowerCase()).filter(Boolean))];
}

async function createIssueFn({ epic, title, description, due, due_time, priority = 'medium', recurring = false, recurring_schedule, agent, tags, type, subtasks, auto_complete = false, assign_to, parent_issue_id, reminder } = {}) {
  if (!epic || !title) return { error: 'epic and title are required' };
  if (!epic.includes('/')) return { error: 'epic must be "category/slug"' };
  const [cat, short] = epic.split('/');
  if (!await exists(`epics/${cat}/${short}`)) return { error: `epic does not exist: ${epic}` };
  const issuesMdRel = `epics/${cat}/${short}/issues.md`;
  const issuesMd = await read(issuesMdRel);
  const parsed = parseIssues(issuesMd);
  // Bump per-epic counter
  const counter = await readJSON('state/issue-counter.json', {});
  const next = (counter[epic] || 0) + 1;
  counter[epic] = next;
  await writeJSON('state/issue-counter.json', counter);
  const id = `ISS-${String(next).padStart(3, '0')}`;
  // Default agent: epic's owner
  const epicMd = await read(`epics/${cat}/${short}/epic.md`);
  const epicData = parseEpic(epicMd);
  const ownerAgent = agent || epicData.frontmatter.agent_owner;
  const newIssue = {
    id, title,
    fields: {
      agent: ownerAgent,
      due: due || null,
      due_time: due_time || null,
      created: fmtISO(startOfDay(new Date())),   // stamp the creation date on every item
      priority,
      recurring,
      recurring_schedule: recurring_schedule || null,
      auto_complete: !!auto_complete,
      // assign_to accepts a string, comma-separated string, or array → array.
      assign_to: normalizeAssignees(assign_to),
      status: 'open',
      type: (type === 'item' || type === 'folder') ? type : 'issue',
      tags: normalizeTags(tags),
      // Nest directly under a parent item (for action-list grouping). The
      // parent must live in the same epic — that's how childMap is built.
      parent_issue_id: parent_issue_id || null,
      reminder: reminder ? Number(reminder) : null,
      sessions: [],
      related_issues: [],
    },
    description: description || '',
    subtasks: (subtasks || []).map(s => (typeof s === "string" ? { done: false, text: s, due: null } : { done: false, text: s.text, due: s.due || null })).filter(s => s.text),
    default_itinerary: [],
    log: [],
    linked_files: [],
  };
  parsed.title = parsed.title || (epicData.frontmatter.title || short);
  parsed.issues.push(newIssue);
  await write(issuesMdRel, serializeIssues(parsed));
  await syncEpic(epic);
  return { ok: true, id, epic_slug: epic, app_url: issueAppUrl(epic, id) };
}

async function updateIssueFn({ id, epic, patch }) {
  const target = await locateIssue(id, epic);
  if (!target) return { error: `issue not found: ${id}` };
  const { cat, short, issue, parsed } = target;
  const fields = issue.fields;
  const changed = [];
  for (const [k, v] of Object.entries(patch || {})) {
    if (k === 'title') { issue.title = v; changed.push(k); continue; }
    if (k === 'description') { issue.description = v; changed.push(k); continue; }
    if (k === 'description_format') { fields.description_format = (v === 'html' ? 'html' : 'markdown'); changed.push(k); continue; }
    if (k === 'tags') { fields.tags = normalizeTags(v); changed.push(k); continue; }
    if (k === 'related_issues') { fields.related_issues = normalizeRelated(v); changed.push(k); continue; }
    if (k === 'type') { fields.type = (v === 'item' || v === 'folder') ? v : 'issue'; changed.push(k); continue; }
    if (k === 'assign_to') { fields.assign_to = normalizeAssignees(v); changed.push(k); continue; }
    if (k === 'pinned') { fields.pinned = !!v && v !== 'false'; changed.push(k); continue; }
    if (k === 'reminder') { fields.reminder = (v == null || v === '' || v === false) ? null : Number(v); changed.push(k); continue; }
    if (['due', 'due_time', 'priority', 'agent', 'recurring', 'recurring_schedule', 'status', 'parent_issue_id', 'auto_complete'].includes(k)) {
      // null / "" / undefined explicitly clears the parent — anything else is set.
      fields[k] = (k === 'parent_issue_id' && (v === '' || v === null)) ? null : v;
      changed.push(k);
    }
  }
  await write(`epics/${cat}/${short}/issues.md`, serializeIssues(parsed));
  // NOTE: editing the markdown does NOT touch the HTML render here. The dashboard
  // queues an HTML regeneration after a markdown save (unless the user disabled
  // auto-regenerate in settings), so the render tracks the source.
  // Status change writes/clears completion.json — using qualified key (<epic>/<id>) per ISS-020 fix.
  if (changed.includes('status')) {
    const completion = await readJSON('state/completion.json', {});
    const key = completionKey(`${cat}/${short}`, id);
    if (fields.status === 'completed') {
      completion[key] = { completed: true, completed_at: new Date().toISOString() };
    } else {
      delete completion[key];
      // Also clear any legacy unqualified key that might have been left over.
      if (completion[id] && !Object.keys(completion).some(k => k !== id && k.endsWith(`/${id}`) && completion[k]?.completed)) {
        delete completion[id];
      }
    }
    await writeJSON('state/completion.json', completion);
    await syncCompletions();
  }
  await syncEpic(`${cat}/${short}`);
  return { ok: true, id, changed_fields: changed };
}

// Write an AI note straight into the item's DESCRIPTION (not an attachment).
// HTML notes render inline in the item drawer in a sandboxed iframe; markdown
// notes render via the app's markdown renderer. The source file (e.g. the
// lecture PDF the note was distilled from) stays the item's attachment — it's
// uploaded separately and is untouched here. Replaces any existing description.
async function writeNoteFn(args = {}) {
  let { epic, id, markdown, html } = args;
  // Back-compat with the old {content, format} shape.
  if (markdown == null && html == null && args.content != null) {
    if (args.format === 'html') html = args.content; else markdown = args.content;
  }
  if (!epic || !id) return { error: 'epic and id are required' };
  if (markdown == null && html == null) return { error: 'provide markdown (the source) and/or html (the render)' };
  const target = await locateIssue(id, epic);
  if (!target) return { error: `issue not found: ${id}` };
  const { cat, short, issue, parsed } = target;
  if (markdown != null) {
    issue.description = String(markdown);
    delete issue.fields.description_format;   // markdown is now the canonical source
    await write(`epics/${cat}/${short}/issues.md`, serializeIssues(parsed));
  }
  const renderPath = `renders/${cat}/${short}/${issue.id}.html`;
  if (html != null) {
    if (String(html).trim()) await write(renderPath, String(html));
    else await removeFile(renderPath);
  }
  await syncEpic(`${cat}/${short}`);
  return { ok: true, id: issue.id, epic_slug: `${cat}/${short}`, has_html: html != null && !!String(html || '').trim() };
}

// Save/replace/clear ONLY the HTML render for an item (markdown untouched).
// Used by the dashboard's "Generate HTML" flow and the HTML editor.
async function setRenderHtmlFn({ epic, id, html }) {
  if (!epic || !id) return { error: 'epic and id are required' };
  const target = await locateIssue(id, epic);
  if (!target) return { error: `issue not found: ${id}` };
  const { cat, short, issue } = target;
  const renderPath = `renders/${cat}/${short}/${issue.id}.html`;
  if (html != null && String(html).trim()) await write(renderPath, String(html));
  else await removeFile(renderPath);
  await syncEpic(`${cat}/${short}`);
  return { ok: true, id: issue.id, epic_slug: `${cat}/${short}`, has_html: !!(html && String(html).trim()) };
}

// ─── attachments ─────────────────────────────────────────────────────
// Maintain an item's `attachments` frontmatter list (the bytes live under
// data/attachments/ — see attachments.mjs). Exported so the HTTP layer and the
// agent's note tool can link/unlink without duplicating issue-location logic.
export async function linkAttachment(epic, id, attId) {
  const target = await locateIssue(id, epic);
  if (!target) return { error: `issue not found: ${id}` };
  const { cat, short, issue, parsed } = target;
  const list = issue.fields.attachments || [];
  if (!list.includes(attId)) list.push(attId);
  issue.fields.attachments = list;
  await write(`epics/${cat}/${short}/issues.md`, serializeIssues(parsed));
  await syncEpic(`${cat}/${short}`);
  return { ok: true, attachments: list };
}
export async function unlinkAttachment(epic, id, attId) {
  const target = await locateIssue(id, epic);
  if (!target) return { error: `issue not found: ${id}` };
  const { cat, short, issue, parsed } = target;
  issue.fields.attachments = (issue.fields.attachments || []).filter(a => a !== attId);
  await write(`epics/${cat}/${short}/issues.md`, serializeIssues(parsed));
  await syncEpic(`${cat}/${short}`);
  return { ok: true, attachments: issue.fields.attachments };
}

// Upload an image (base64) and EMBED it in the item's markdown body. This is the
// only way an agent (MCP or the JSON API) can put a screenshot into an item —
// the bytes are stored as a normal attachment (served at /api/attachments/<id>,
// which is a valid inline <img> src) and a `![alt](url)` embed is added so it
// renders in the drawer. Use embed:false to only upload + get the markdown back
// so YOU can place it exactly (e.g. inside a per-task evidence section).
async function attachImageFn(args = {}) {
  let { epic, id, data, attachment_id, filename, mime, alt, caption, embed = true, position = 'end' } = args;
  if (!epic || !id) return { error: 'epic and id are required' };

  const target = await locateIssue(id, epic);
  if (!target) return { error: `issue not found: ${id}` };
  const { cat, short, issue, parsed } = target;

  // Two modes: embed an ALREADY-uploaded attachment by id (e.g. an image the
  // user pasted into chat, which the server pre-saved), or upload fresh base64.
  let attId, fname;
  if (attachment_id && !data) {
    const meta = await getAttachmentMeta(attachment_id);
    if (!meta) return { error: `attachment not found: ${attachment_id}` };
    if (meta.mime && !/^image\//.test(meta.mime)) return { error: `attachment ${attachment_id} is not an image (${meta.mime})` };
    attId = attachment_id;
    fname = meta.filename;
  } else {
    if (!data || typeof data !== 'string') return { error: 'provide data (base64 image bytes / a data: URL) or attachment_id' };
    let b64 = data.trim();
    const dm = /^data:([^;,]+);base64,(.*)$/s.exec(b64);   // accept a full data: URL too
    if (dm) { mime = mime || dm[1]; b64 = dm[2]; }
    b64 = b64.replace(/\s+/g, '');
    let buf;
    try { buf = Buffer.from(b64, 'base64'); } catch { return { error: 'data is not valid base64' }; }
    if (!buf.length) return { error: 'decoded image is empty — pass raw base64 image bytes' };
    if (buf.length > 25 * 1024 * 1024) return { error: 'image too large (max 25MB)' };
    mime = (mime || 'image/png').toLowerCase();
    if (!/^image\//.test(mime)) return { error: `mime must be image/* (png, jpeg, gif, webp); got "${mime}"` };
    const ext = (mime.split('/')[1] || 'png').replace(/[^a-z0-9]/g, '') || 'png';
    fname = (filename && String(filename).trim()) || `screenshot-${fmtISO(new Date())}-${issue.id}.${ext}`;
    const att = await saveAttachmentBytes(buf, { filename: fname, mime, kind: 'file' });
    attId = att.id;
  }
  const url = `/api/attachments/${attId}`;
  const altText = String(alt || caption || fname).replace(/[\[\]]/g, ' ').trim();
  const markdown = `![${altText}](${url})`;
  const block = caption ? `${markdown}\n\n*${String(caption).trim()}*` : markdown;

  // Always register the id in the item's attachments list (so it's tracked +
  // survives even if the embed is later edited out of the body).
  const list = issue.fields.attachments || [];
  if (!list.includes(attId)) list.push(attId);
  issue.fields.attachments = list;

  let embedded = false;
  if (embed) {
    const desc = String(issue.description || '');
    if (position === 'start') {
      issue.description = `${block}\n\n${desc}`.trimEnd() + '\n';
    } else {
      // Append to the very end, but keep it ABOVE a trailing "## Work log" so the
      // running log stays last (the log is the item's history, evidence is content).
      const logIdx = desc.search(/\n#{2,}\s*work log\b/i);
      if (logIdx >= 0) {
        issue.description = desc.slice(0, logIdx).trimEnd() + `\n\n${block}\n` + desc.slice(logIdx);
      } else {
        issue.description = (desc.trimEnd() + `\n\n${block}\n`).replace(/^\n+/, '');
      }
    }
    embedded = true;
  }
  await write(`epics/${cat}/${short}/issues.md`, serializeIssues(parsed));
  await syncEpic(`${cat}/${short}`);
  return { ok: true, attachment_id: attId, url, markdown, embedded, filename: fname };
}

// Move an issue (and its sub-tree) into a different epic. Because issue ids are
// scoped per-epic, the moved issue gets a freshly-allocated id from the target
// epic's counter — every cross-reference (timeblocks, completion keys,
// parent_issue_id pointers from sub-issues) is rewritten accordingly.
async function moveIssueFn({ id, epic, target_epic }) {
  if (!id || !epic || !target_epic) return { error: 'id, epic and target_epic are all required' };
  if (epic === target_epic) return { error: 'source and target epic are the same — nothing to move' };
  if (!target_epic.includes('/')) return { error: 'target_epic must be "category/short-name"' };

  const source = await locateIssue(id, epic);
  if (!source) return { error: `issue not found in source epic: ${epic}/${id}` };

  const [tCat, tShort] = target_epic.split('/');
  if (!await exists(`epics/${tCat}/${tShort}`)) return { error: `target epic does not exist: ${target_epic}` };

  // Walk the sub-tree under the moved issue so the whole branch travels together.
  // Collect ids in BFS order so children are processed AFTER their parents — that
  // way we always know what the parent's new id is when we re-stamp the children.
  const sourceParsed = source.parsed;
  const movingSet = new Set([id]);
  let queue = [id];
  while (queue.length) {
    const next = [];
    for (const pid of queue) {
      for (const it of sourceParsed.issues) {
        if (it.fields.parent_issue_id === pid && !movingSet.has(it.id)) {
          movingSet.add(it.id);
          next.push(it.id);
        }
      }
    }
    queue = next;
  }
  // BFS order list (root first)
  const movingOrder = [id];
  {
    let frontier = [id];
    while (frontier.length) {
      const next = [];
      for (const pid of frontier) {
        for (const it of sourceParsed.issues) {
          if (it.fields.parent_issue_id === pid) {
            movingOrder.push(it.id);
            next.push(it.id);
          }
        }
      }
      frontier = next;
    }
  }

  // Allocate fresh ids in the target epic up-front so we can rewrite refs before writing.
  const counter = await readJSON('state/issue-counter.json', {});
  let nextNum = counter[target_epic] || 0;
  const idMap = {};                  // oldId → newId
  for (const oldId of movingOrder) {
    nextNum += 1;
    idMap[oldId] = `ISS-${String(nextNum).padStart(3, '0')}`;
  }
  counter[target_epic] = nextNum;
  await writeJSON('state/issue-counter.json', counter);

  // Pull the actual issue objects out of the source.
  const movedIssues = [];
  for (const oldId of movingOrder) {
    const idx = sourceParsed.issues.findIndex(it => it.id === oldId);
    if (idx === -1) continue;
    movedIssues.push(sourceParsed.issues[idx]);
  }
  // Remove from source
  sourceParsed.issues = sourceParsed.issues.filter(it => !movingSet.has(it.id));
  await write(`epics/${source.cat}/${source.short}/issues.md`, serializeIssues(sourceParsed));

  // Add to target with re-stamped ids + rewritten parent_issue_id refs.
  const targetMdRel = `epics/${tCat}/${tShort}/issues.md`;
  const targetMd = await read(targetMdRel);
  const targetParsed = parseIssues(targetMd);
  if (!targetParsed.title) {
    const tEpicMd = await read(`epics/${tCat}/${tShort}/epic.md`);
    targetParsed.title = parseEpic(tEpicMd)?.frontmatter?.title || tShort;
  }
  for (const it of movedIssues) {
    const newId = idMap[it.id];
    if (it.fields.parent_issue_id && idMap[it.fields.parent_issue_id]) {
      it.fields.parent_issue_id = idMap[it.fields.parent_issue_id];
    } else if (it.fields.parent_issue_id && !idMap[it.fields.parent_issue_id]) {
      // Parent is staying behind in the source epic — sub-issue can't have a cross-epic
      // parent, so detach it. The caller almost always moves the root explicitly so this
      // path is rare (only triggers if someone moves a non-root branch).
      it.fields.parent_issue_id = null;
    }
    it.id = newId;
    targetParsed.issues.push(it);
  }
  await write(targetMdRel, serializeIssues(targetParsed));

  // Rewrite completion.json: any qualified key under source epic for a moved id
  // becomes the target-epic qualified key with the new id (preserving any
  // #date suffix for recurring instances).
  const completion = await readJSON('state/completion.json', {});
  const rekeyed = {};
  for (const [k, v] of Object.entries(completion)) {
    const hashIdx = k.indexOf('#');
    const base = hashIdx >= 0 ? k.slice(0, hashIdx) : k;
    const suffix = hashIdx >= 0 ? k.slice(hashIdx) : '';
    // Qualified keys look like "<cat>/<short>/<ISS-NNN>"
    if (base.startsWith(`${epic}/`)) {
      const oldIssueId = base.slice(epic.length + 1);
      if (idMap[oldIssueId]) {
        rekeyed[`${target_epic}/${idMap[oldIssueId]}${suffix}`] = v;
        continue;
      }
    }
    rekeyed[k] = v;
  }
  await writeJSON('state/completion.json', rekeyed);

  // Rewrite timeblocks: blocks pointing at any moved (id, source-epic) pair get
  // re-pointed to (newId, target_epic).
  const blocks = await readBlocks();
  for (const b of blocks) {
    if (b.epic_slug === epic && b.issue_id && idMap[b.issue_id]) {
      b.epic_slug = target_epic;
      b.issue_id = idMap[b.issue_id];
    }
  }
  await writeBlocks(blocks);

  await syncEpic(epic);
  await syncEpic(target_epic);
  await syncCompletions();

  return {
    ok: true,
    moved: movingOrder.length,
    id_map: idMap,
    new_id: idMap[id],
    target_epic,
  };
}

// Append a dated entry under a "## Work log" heading at the end of an issue's
// markdown description (creating the heading if absent). Keeps completed issues
// carrying a summary the user can read under them. See the issue-worklog skill.
function appendWorkLog(desc, entry) {
  const base = String(desc || '').replace(/\s+$/, '');
  if (/(^|\n)#{2,}\s*work log\b/i.test(base)) return base + '\n' + entry + '\n';
  return (base ? base + '\n\n' : '') + '## Work log\n\n' + entry + '\n';
}

async function completeIssueFn({ id, epic, log_note, for_date, summary }) {
  const target = await locateIssue(id, epic);
  if (!target) return { error: `issue not found: ${id}` };
  const { cat, short, issue, parsed } = target;
  const completion = await readJSON('state/completion.json', {});
  // Recurring template: auto-materialize an instance for the date, then mark THAT instance complete.
  // The user can keep their per-week state (subtasks, log, weights) without affecting the template.
  if (issue.fields.recurring) {
    const dateStr = for_date || fmtISO(startOfDay(new Date()));
    const matRes = await materializeRecurringFn({ template_id: id, epic: `${cat}/${short}`, date: dateStr });
    if (matRes.error) return matRes;
    // Recurse with the new instance's id
    return await completeIssueFn({ id: matRes.id, epic: matRes.epic_slug, log_note, summary });
  }
  // Concrete issue (or instance): flip status + write completion.json (qualified key).
  const note = (summary || log_note || '').trim() || null;
  completion[completionKey(`${cat}/${short}`, id)] = { completed: true, completed_at: new Date().toISOString(), note };
  issue.fields.status = 'completed';
  // Always leave a dated summary under the issue on completion (issue-worklog skill).
  if (note) issue.description = appendWorkLog(issue.description, `- ${fmtISO(startOfDay(new Date()))} — ${note}`);
  // For instances: also append to template's log so the template carries a roll-up history.
  // Mutate the SAME parsed object so the single write below captures both changes.
  if (note && issue.fields.template_id) {
    const template = parsed.issues.find(it => it.id === issue.fields.template_id);
    if (template && template.fields.recurring) {
      template.log.push({ date: issue.fields.instance_date || fmtISO(startOfDay(new Date())), note });
    }
  }
  await write(`epics/${cat}/${short}/issues.md`, serializeIssues(parsed));
  await writeJSON('state/completion.json', completion);
  await syncCompletions();
  await syncEpic(`${cat}/${short}`);
  return {
    ok: true, id,
    completion_kind: issue.fields.template_id ? 'recurring-instance' : 'one-off',
    instance_date: issue.fields.instance_date || null,
  };
}

// Materialize a recurring template into a concrete issue for a specific date.
// Idempotent: if an instance already exists for that date, returns it without creating a duplicate.
async function materializeRecurringFn({ template_id, epic, date }) {
  if (!template_id) return { error: 'template_id is required' };
  const target = await locateIssue(template_id, epic);
  if (!target) return { error: `template not found: ${template_id}` };
  if (!target.issue.fields.recurring) return { error: `${template_id} is not a recurring template` };
  const { cat, short, issue: tpl, parsed } = target;
  const slug = `${cat}/${short}`;
  const dateStr = date || fmtISO(startOfDay(new Date()));

  // Check existing instance
  const existing = parsed.issues.find(it =>
    it.fields.template_id === template_id && it.fields.instance_date === dateStr
  );
  if (existing) {
    return { ok: true, id: existing.id, epic_slug: slug, already_existed: true };
  }

  // Bump per-epic counter
  const counter = await readJSON('state/issue-counter.json', {});
  const next = (counter[slug] || 0) + 1;
  counter[slug] = next;
  await writeJSON('state/issue-counter.json', counter);
  const newId = `ISS-${String(next).padStart(3, '0')}`;

  // Build the instance: copy template's defaults
  const subtasks = (tpl.default_itinerary || []).map(s => ({ done: false, text: s.text, due: null }));
  const instance = {
    id: newId,
    title: tpl.title, // keep clean; the date is in fields.instance_date
    fields: {
      agent: tpl.fields.agent,
      due: dateStr,
      priority: tpl.fields.priority || 'medium',
      recurring: false,
      recurring_schedule: null,
      status: 'open',
      sessions: [],
      related_issues: [],
      template_id,
      instance_date: dateStr,
    },
    description: tpl.description || '',
    subtasks,
    default_itinerary: [],
    log: [],
    linked_files: tpl.linked_files ? tpl.linked_files.slice() : [],
  };
  parsed.issues.push(instance);
  await write(`epics/${cat}/${short}/issues.md`, serializeIssues(parsed));
  await syncEpic(slug);
  return { ok: true, id: newId, epic_slug: slug, already_existed: false, template_id };
}

async function addSubtaskFn({ id, epic, text, due, for_date }) {
  const target = await locateIssue(id, epic);
  if (!target) return { error: `issue not found: ${id}` };
  // Recurring template: auto-materialize so the subtask lands on this week's instance,
  // not on the template (which would cross-pollute every future week).
  if (target.issue.fields.recurring) {
    const dateStr = for_date || fmtISO(startOfDay(new Date()));
    const matRes = await materializeRecurringFn({ template_id: id, epic: `${target.cat}/${target.short}`, date: dateStr });
    if (matRes.error) return matRes;
    return await addSubtaskFn({ id: matRes.id, epic: matRes.epic_slug, text, due });
  }
  const { cat, short, issue, parsed } = target;
  issue.subtasks.push({ done: false, text, due: due || null });
  await write(`epics/${cat}/${short}/issues.md`, serializeIssues(parsed));
  await syncEpic(`${cat}/${short}`);
  return { ok: true, id, text };
}

async function toggleSubtaskFn({ id, epic, subtask_text, done }) {
  const target = await locateIssue(id, epic);
  if (!target) return { error: `issue not found: ${id}` };
  const { cat, short, issue, parsed } = target;
  const matchTxt = subtask_text.trim().toLowerCase();
  let matched = null;
  for (const s of issue.subtasks) {
    if (s.text.toLowerCase() === matchTxt || s.text.toLowerCase().startsWith(matchTxt)) { matched = s; break; }
  }
  if (!matched) return { error: `sub-task not found: ${subtask_text}` };
  matched.done = done == null ? !matched.done : !!done;
  await write(`epics/${cat}/${short}/issues.md`, serializeIssues(parsed));
  await syncEpic(`${cat}/${short}`);
  return { ok: true, id, new_state: matched.done };
}

async function appendToEpicFn({ epic, section, line }) {
  if (!epic.includes('/')) return { error: 'epic must be "category/slug"' };
  const [cat, short] = epic.split('/');
  const path = `epics/${cat}/${short}/epic.md`;
  let md = await read(path);
  if (!md) return { error: `epic not found: ${epic}` };
  const lines = md.split('\n');
  // Find ## section heading
  const sectionLower = section.toLowerCase();
  let idx = lines.findIndex(l => l.match(/^##\s+/) && l.replace(/^##\s+/, '').trim().toLowerCase().startsWith(sectionLower));
  if (idx === -1) {
    // Append a new section at end
    if (lines[lines.length - 1] !== '') lines.push('');
    lines.push(`## ${section}`);
    lines.push('');
    lines.push(`- ${line}`);
    lines.push('');
  } else {
    // Insert after heading + any blank
    let insertAt = idx + 1;
    while (insertAt < lines.length && lines[insertAt].trim() === '') insertAt++;
    // Append after existing bullets in this section
    while (insertAt < lines.length && !lines[insertAt].startsWith('## ') && lines[insertAt].trim()) insertAt++;
    lines.splice(insertAt, 0, `- ${line}`);
  }
  await write(path, lines.join('\n'));
  await syncEpic(epic);
  return { ok: true, epic, section, line: `- ${line}` };
}

async function listSessionsFn({ agent, issue_id, limit } = {}) {
  const links = await readJSON('state/session-links.json', {});
  let entries = Object.entries(links).map(([sid, info]) => ({ session_id: sid, ...info, owner: info.owner || LEGACY_OWNER }));
  if (agent) entries = entries.filter(e => e.agent === agent);
  if (issue_id) entries = entries.filter(e => (e.issue_ids || []).includes(issue_id));
  entries.sort((a, b) => (b.last_updated || '').localeCompare(a.last_updated || ''));
  if (limit) entries = entries.slice(0, limit);
  return { sessions: entries };
}

async function linkSessionFn({ session_id, issue_id, epic, agent }) {
  if (!session_id || !issue_id) return { error: 'session_id and issue_id required' };
  const links = await readJSON('state/session-links.json', {});
  const cur = links[session_id] || { agent: agent || null, issue_ids: [], first_message_excerpt: '', last_updated: null, owner: currentCtx()?.user || LEGACY_OWNER };
  if (!cur.issue_ids.includes(issue_id)) cur.issue_ids.push(issue_id);
  if (agent) cur.agent = agent;
  cur.last_updated = new Date().toISOString();
  links[session_id] = cur;
  await writeJSON('state/session-links.json', links);
  // Also touch the issue's `sessions:` field
  const target = await locateIssue(issue_id, epic);
  if (target) {
    const { cat, short, issue, parsed } = target;
    if (!issue.fields.sessions.includes(session_id)) {
      issue.fields.sessions.push(session_id);
      await write(`epics/${cat}/${short}/issues.md`, serializeIssues(parsed));
      await syncEpic(`${cat}/${short}`);
    }
  }
  await syncSessions();
  return { ok: true };
}

async function updateSessionFn({ session_id, patch }) {
  if (!session_id) return { error: 'session_id required' };
  const links = await readJSON('state/session-links.json', {});
  if (!links[session_id]) return { error: `session not found: ${session_id}` };
  const cur = links[session_id];
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'title')) {
    const t = patch.title;
    if (t == null || t === '') delete cur.title;
    else cur.title = String(t).slice(0, 120);
  }
  // Also accept `issue_ids` updates if ever needed.
  if (patch && Array.isArray(patch.issue_ids)) cur.issue_ids = patch.issue_ids.slice();
  links[session_id] = cur;
  await writeJSON('state/session-links.json', links);
  await syncSessions();
  return { ok: true, session_id, session: cur };
}

async function deleteSessionFn({ session_id, purge = false }) {
  if (!session_id) return { error: 'session_id required' };
  const links = await readJSON('state/session-links.json', {});
  if (!links[session_id]) return { error: `session not found: ${session_id}` };
  delete links[session_id];
  await writeJSON('state/session-links.json', links);
  await syncSessions();
  let purged = false;
  if (purge) {
    // Walk ~/.claude/projects/* looking for <sid>.jsonl. The hashed-cwd directory differs.
    try {
      const { homedir } = await import('node:os');
      const { readdir, unlink } = await import('node:fs/promises');
      const { join: pjoin } = await import('node:path');
      const base = pjoin(homedir(), '.claude', 'projects');
      const dirs = await readdir(base);
      for (const d of dirs) {
        const candidate = pjoin(base, d, `${session_id}.jsonl`);
        try { await unlink(candidate); purged = true; break; }
        catch { /* ENOENT in this dir, keep scanning */ }
      }
    } catch { /* best effort */ }
  }
  return { ok: true, session_id, purged };
}

async function addEventFn({ title, date, time, duration_min, category, note }) {
  const events = (await readJSON('state/events.json', { events: [] })).events || [];
  // Skip ids already in use, so a deleted event never makes the next id clash.
  const used = new Set(events.map(e => e.id));
  let n = events.length + 1;
  while (used.has(`evt-${String(n).padStart(3, '0')}`)) n++;
  const id = `evt-${String(n).padStart(3, '0')}`;
  events.push({ id, title, date, time: time || null, duration_min: duration_min || null, category: category || null, note: note || null, owner: currentCtx()?.user || LEGACY_OWNER });
  await writeJSON('state/events.json', { events });
  await syncEvents();
  return { ok: true, event_id: id };
}

async function updateEventFn({ id, patch }) {
  if (!id || !patch) return { error: 'id and patch are required' };
  const data = await readJSON('state/events.json', { events: [] });
  const events = data.events || [];
  const i = events.findIndex(e => e.id === id);
  if (i === -1) return { error: `event not found: ${id}` };
  const ALLOWED = new Set(['title', 'date', 'time', 'duration_min', 'category', 'note']);
  const changed = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!ALLOWED.has(k)) continue;
    if (k === 'date' && v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return { error: 'date must be YYYY-MM-DD' };
    events[i][k] = v;
    changed.push(k);
  }
  if (!changed.length) return { error: 'no recognised fields in patch' };
  await writeJSON('state/events.json', { events });
  await syncEvents();
  return { ok: true, id, changed_fields: changed, event: events[i] };
}

async function deleteEventFn({ id }) {
  if (!id) return { error: 'id is required' };
  const data = await readJSON('state/events.json', { events: [] });
  const events = data.events || [];
  const i = events.findIndex(e => e.id === id);
  if (i === -1) return { error: `event not found: ${id}` };
  const removed = events.splice(i, 1)[0];
  await writeJSON('state/events.json', { events });
  await syncEvents();
  return { ok: true, removed };
}

async function listEventsFn({ from_date, to_date, category } = {}) {
  let events = (await readJSON('state/events.json', { events: [] })).events || [];
  if (from_date) events = events.filter(e => e.date >= from_date);
  if (to_date) events = events.filter(e => e.date <= to_date);
  if (category) events = events.filter(e => e.category === category);
  events.sort((a, b) => a.date.localeCompare(b.date));
  return { count: events.length, events };
}

// ─── timeblocks ───
async function readBlocks() {
  return (await readJSON('state/timeblocks.json', { blocks: [] })).blocks || [];
}
async function writeBlocks(blocks) {
  await writeJSON('state/timeblocks.json', { blocks });
  await syncTimeblocks();
}

async function addTimeblockFn({ date, start, end, title, issue_id, epic_slug, note, repeat_weeks, auto_complete, reminder }) {
  if (!date || !start || !end || !title) return { error: 'date, start, end, and title required' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'date must be YYYY-MM-DD' };
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return { error: 'start/end must be HH:MM' };

  // If issue_id given, ensure it actually resolves to a real issue. Auto-fill epic_slug
  // when the agent forgot to pass it (and the resolution is unique). Refuse if not found.
  if (issue_id) {
    const target = await locateIssue(issue_id, epic_slug);
    if (!target) {
      return { error: `issue ${issue_id} not found${epic_slug ? ` in epic ${epic_slug}` : ' (also pass epic_slug to disambiguate; the same id can exist in multiple epics)'}` };
    }
    const resolvedSlug = `${target.cat}/${target.short}`;
    if (epic_slug && epic_slug !== resolvedSlug) {
      return { error: `issue ${issue_id} lives in ${resolvedSlug}, not ${epic_slug}. Either pass the correct epic_slug or omit it.` };
    }
    epic_slug = resolvedSlug;
  }

  const blocks = await readBlocks();
  // Avoid id collisions if the user has deleted blocks (length-based ids could clash).
  const used = new Set(blocks.map(b => b.id));
  const nextId = () => {
    let n = blocks.length + 1;
    while (used.has(`tb-${String(n).padStart(3, '0')}`)) n++;
    const id = `tb-${String(n).padStart(3, '0')}`;
    used.add(id);
    return id;
  };

  // Bulk-generate: if repeat_weeks > 1, create that many concrete blocks one week apart.
  // Each is an independent row — fully editable, reschedulable, completable. No "template"
  // concept exists. Capped at 52 to avoid runaways.
  const reps = Math.max(1, Math.min(52, Number(repeat_weeks) || 1));
  const anchor = parseISODate(date);
  const created = [];
  for (let w = 0; w < reps; w++) {
    const d = new Date(anchor.getTime() + w * 7 * 86400000);
    const dateIso = fmtISO(d);
    const block = {
      id: nextId(),
      date: dateIso,
      start, end, title,
      issue_id: issue_id || null,
      epic_slug: epic_slug || null,
      note: note || null,
      completed: false,
      auto_complete: !!auto_complete,
      // Lead-time minutes before `start` to push a reminder (null = none).
      reminder: reminder ? Number(reminder) : null,
      owner: currentCtx()?.user || LEGACY_OWNER,
    };
    blocks.push(block);
    created.push(block);
  }
  await writeBlocks(blocks);
  return { ok: true, id: created[0].id, block: created[0], created_count: created.length, created_ids: created.map(b => b.id) };
}

async function listTimeblocksFn({ from_date, to_date, issue_id, epic_slug } = {}) {
  let blocks = await readBlocks();
  if (from_date) blocks = blocks.filter(b => b.date >= from_date);
  if (to_date) blocks = blocks.filter(b => b.date <= to_date);
  if (issue_id) blocks = blocks.filter(b => b.issue_id === issue_id);
  if (epic_slug) blocks = blocks.filter(b => b.epic_slug === epic_slug);
  blocks.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  return { count: blocks.length, blocks };
}

async function updateTimeblockFn({ id, patch }) {
  const blocks = await readBlocks();
  const i = blocks.findIndex(b => b.id === id);
  if (i === -1) return { error: `timeblock not found: ${id}` };
  if (patch?.date && !/^\d{4}-\d{2}-\d{2}$/.test(patch.date)) return { error: 'date must be YYYY-MM-DD' };
  if (patch?.start && !/^\d{2}:\d{2}$/.test(patch.start)) return { error: 'start must be HH:MM' };
  if (patch?.end && !/^\d{2}:\d{2}$/.test(patch.end)) return { error: 'end must be HH:MM' };

  const merged = { ...blocks[i], ...(patch || {}) };
  if (patch && 'reminder' in patch) merged.reminder = patch.reminder ? Number(patch.reminder) : null;
  // Re-validate the issue↔epic link if either changed
  if (merged.issue_id) {
    const target = await locateIssue(merged.issue_id, merged.epic_slug);
    if (!target) return { error: `issue ${merged.issue_id} not found${merged.epic_slug ? ` in ${merged.epic_slug}` : ''}` };
    merged.epic_slug = `${target.cat}/${target.short}`;
  }
  blocks[i] = merged;
  await writeBlocks(blocks);
  return { ok: true, block: blocks[i] };
}

async function completeTimeblockFn({ id, note }) {
  const blocks = await readBlocks();
  const i = blocks.findIndex(b => b.id === id);
  if (i === -1) return { error: `timeblock not found: ${id}` };
  blocks[i].completed = true;
  blocks[i].completed_at = new Date().toISOString();
  if (note) blocks[i].completion_note = note;
  await writeBlocks(blocks);
  return { ok: true, block: blocks[i] };
}

async function deleteTimeblockFn({ id }) {
  const blocks = await readBlocks();
  const i = blocks.findIndex(b => b.id === id);
  if (i === -1) return { error: `timeblock not found: ${id}` };
  const removed = blocks.splice(i, 1)[0];
  await writeBlocks(blocks);
  return { ok: true, removed };
}

// ─── helpers ──────────────────────────────────────────────────────────

// Look up completion by qualified key (<epic_slug>/<id>) — the fix for ISS-020.
// Falls back to unqualified id-only key for backwards compatibility with any
// caller that may still write that way (migration removed the legacy keys, but
// keep the fallback so we self-heal if anyone re-introduces them).
function completionKey(epicSlug, id) {
  return `${epicSlug}/${id}`;
}
function lookupCompletion(completion, epicSlug, id) {
  if (!completion) return null;
  return completion[completionKey(epicSlug, id)] || completion[id] || null;
}
// Auto-complete: a time-based issue (auto_complete flag + a due date/time) is
// implicitly done once that moment has passed — the user never ticks it.
function autoDonePassed(issue) {
  const f = issue && issue.fields;
  if (!f || !f.auto_complete || !f.due) return false;
  const now = new Date();
  const today = fmtISO(startOfDay(now));
  if (f.due < today) return true;
  if (f.due > today) return false;
  if (!f.due_time) return false;                 // due today, no time → wait till it lands
  const [h, m] = String(f.due_time).split(':').map(Number);
  return (now.getHours() * 60 + now.getMinutes()) >= (h * 60 + m);
}
function isIssueCompleted(issue, completion, epicSlug) {
  if (!issue) return false;
  if (issue.fields.status === 'completed') return true;
  if (autoDonePassed(issue)) return true;
  // epicSlug should always be provided by callers post-fix; fall back to unqualified
  // lookup only as a transitional safety net.
  if (epicSlug) {
    const rec = lookupCompletion(completion, epicSlug, issue.id);
    return !!(rec && rec.completed);
  }
  return !!(completion && completion[issue.id] && completion[issue.id].completed);
}

function toIssueSummary(cat, short, issue, epicAgent, allIssues) {
  // When called with `allIssues` (the same epic's parsed.issues), include
  // parent_title so the UI can render a "parent › this" breadcrumb on the card.
  let parent_title = null;
  if (issue.fields.parent_issue_id && Array.isArray(allIssues)) {
    const p = allIssues.find(it => it.id === issue.fields.parent_issue_id);
    if (p) parent_title = p.title;
  }
  // Description snippet — clipped to a bounded size so the summary stays small
  // when the payload lists dozens of issues, but long enough that free-text
  // search inside the dashboard can match "tag: fast" / "protein" etc. inside
  // the description body.
  const descText = (issue.description || '').slice(0, 400);
  return {
    id: issue.id,
    epic_slug: `${cat}/${short}`,
    title: issue.title,
    description_snippet: descText,
    type: issue.fields.type || 'issue',
    tags: issue.fields.tags || [],
    agent: issue.fields.agent || epicAgent,
    due: issue.fields.due,
    due_time: issue.fields.due_time || null,
    created: issue.fields.created || null,
    priority: issue.fields.priority || 'medium',
    recurring: !!issue.fields.recurring,
    pinned: !!issue.fields.pinned,
    reminder: issue.fields.reminder || null,
    status: issue.fields.status || 'open',
    open_subtask_count: issue.subtasks.filter(s => !s.done).length,
    total_subtask_count: issue.subtasks.length,
    template_id: issue.fields.template_id || null,
    instance_date: issue.fields.instance_date || null,
    parent_issue_id: issue.fields.parent_issue_id || null,
    parent_title,
  };
}

// Find an issue by id. If `epic` (slug) given, restrict to that epic for speed.
// Returns { cat, short, parsed, issue } or null.
async function locateIssue(id, epic) {
  if (epic && epic.includes('/')) {
    const [cat, short] = epic.split('/');
    const md = await read(`epics/${cat}/${short}/issues.md`);
    const parsed = parseIssues(md);
    const issue = parsed.issues.find(it => it.id === id);
    if (issue) return { cat, short, parsed, issue };
    return null;
  }
  // Scan all epics
  const cats = await listDirs('epics');
  for (const cat of cats) {
    for (const short of await listDirs(`epics/${cat}`)) {
      const md = await read(`epics/${cat}/${short}/issues.md`);
      const parsed = parseIssues(md);
      const issue = parsed.issues.find(it => it.id === id);
      if (issue) return { cat, short, parsed, issue };
    }
  }
  return null;
}

// ─── sub-issues + epic management + file storage ─────────────────────

async function createSubissueFn(args) {
  const { parent_issue_id, parent_epic, title, description, due, due_time, priority, agent, tags, type, subtasks } = args || {};
  if (!parent_issue_id || !title) return { error: 'parent_issue_id and title required' };
  const target = await locateIssue(parent_issue_id, parent_epic);
  if (!target) return { error: `parent issue not found: ${parent_issue_id}` };
  const { cat, short, issue: parent, parsed } = target;
  const slug = `${cat}/${short}`;

  // Bump per-epic counter
  const counter = await readJSON('state/issue-counter.json', {});
  const next = (counter[slug] || 0) + 1;
  counter[slug] = next;
  await writeJSON('state/issue-counter.json', counter);
  const newId = `ISS-${String(next).padStart(3, '0')}`;

  const child = {
    id: newId,
    title,
    fields: {
      agent: agent || parent.fields.agent,
      due: due || null,
      due_time: due_time || null,
      created: fmtISO(startOfDay(new Date())),   // stamp the creation date on every sub-item
      priority: priority || parent.fields.priority || 'medium',
      recurring: false,
      recurring_schedule: null,
      status: 'open',
      type: (type === 'item' || type === 'folder') ? type : 'issue',
      tags: normalizeTags(tags),
      sessions: [],
      related_issues: [],
      template_id: null,
      instance_date: null,
      parent_issue_id,
    },
    description: description || '',
    subtasks: (subtasks || []).map(s => (typeof s === "string" ? { done: false, text: s, due: null } : { done: false, text: s.text, due: s.due || null })).filter(s => s.text),
    default_itinerary: [],
    log: [],
    linked_files: [],
  };
  parsed.issues.push(child);
  await write(`epics/${slug}/issues.md`, serializeIssues(parsed));
  await syncEpic(slug);
  return { ok: true, id: newId, epic_slug: slug, parent_issue_id };
}

async function deleteIssueFn({ id, epic, cascade = true }) {
  if (!id) return { error: 'id is required' };
  const target = await locateIssue(id, epic);
  if (!target) return { error: `issue not found: ${id}` };
  const { cat, short, parsed } = target;
  const slug = `${cat}/${short}`;
  // Collect all descendant ids (cascade) so we can remove them in one pass.
  const toRemove = new Set([id]);
  if (cascade) {
    let added = true;
    while (added) {
      added = false;
      for (const it of parsed.issues) {
        if (toRemove.has(it.fields.parent_issue_id) && !toRemove.has(it.id)) {
          toRemove.add(it.id);
          added = true;
        }
      }
    }
  }
  parsed.issues = parsed.issues.filter(it => !toRemove.has(it.id));
  await write(`epics/${slug}/issues.md`, serializeIssues(parsed));
  // Clean any per-issue completion entries. Keys are either:
  //   - "<epic>/<id>"        — qualified (post-ISS-020 fix)
  //   - "<epic>/<id>#<date>" — recurring instance, qualified
  //   - "<id>"               — legacy unqualified (we still clean these for the same id)
  //   - "<id>#<date>"        — legacy unqualified recurring instance
  // Only delete entries whose epic matches AND whose base id is in toRemove.
  const completion = await readJSON('state/completion.json', {});
  for (const k of Object.keys(completion)) {
    const noInstance = k.split('#')[0];
    const parts = noInstance.split('/');
    const baseId = parts[parts.length - 1];
    const ownerEpic = parts.length >= 3 ? `${parts[0]}/${parts[1]}` : null;
    if (!toRemove.has(baseId)) continue;
    // Qualified: only delete if matches this epic. Unqualified: delete unconditionally (legacy).
    if (ownerEpic && ownerEpic !== slug) continue;
    delete completion[k];
  }
  await writeJSON('state/completion.json', completion);
  await syncCompletions();
  await syncEpic(slug);
  return { ok: true, removed_ids: Array.from(toRemove), epic_slug: slug };
}

async function createCategoryFn({ name } = {}) {
  if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    return { error: 'name must be lowercase letters/digits/dashes' };
  }
  if (await exists(`epics/${name}`)) return { ok: true, name, already_existed: true };
  await ensureDir(`epics/${name}`);
  await claimCategory(name);
  return { ok: true, name, already_existed: false };
}

async function createEpicFn({ category, slug, title, agent_owner, body }) {
  if (!category || !slug || !title) return { error: 'category, slug, title are required' };
  // Category is free-form — any lowercase-dashes string spins up a new top-level folder
  // under data/epics/. Validation is just slug-format, not membership of a fixed enum.
  if (!/^[a-z0-9][a-z0-9-]*$/.test(category)) return { error: 'category must be lowercase letters/digits/dashes (e.g. "studies", "personal")' };
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return { error: 'slug must be lowercase letters/digits/dashes (e.g. "ml-course")' };
  const dirRel = `epics/${category}/${slug}`;
  if (await exists(dirRel)) return { error: `epic already exists: ${category}/${slug}` };
  const newCategory = !(await exists(`epics/${category}`));
  await ensureDir(dirRel);
  if (newCategory) await claimCategory(category);
  const fm = { title, category, agent_owner: agent_owner || null, related_epics: [] };
  const epicBody = body || `# ${title}\n\n_Add long-form context, links, decisions here. Markdown supported._\n`;
  await write(`${dirRel}/epic.md`, serializeEpic({ frontmatter: fm, body: epicBody }));
  await write(`${dirRel}/issues.md`, `# Issues for ${title}\n`);
  await syncEpic(`${category}/${slug}`);
  return { ok: true, slug: `${category}/${slug}`, category, title };
}

async function updateSubtaskFn({ id, epic, match_text, new_text, new_due }) {
  if (!id || !match_text || !new_text) return { error: 'id, match_text, new_text are required' };
  const target = await locateIssue(id, epic);
  if (!target) return { error: `issue not found: ${id}` };
  const { cat, short, issue, parsed } = target;
  const m = match_text.trim().toLowerCase();
  let matched = null;
  for (const s of issue.subtasks) {
    if (s.text.toLowerCase() === m || s.text.toLowerCase().includes(m)) { matched = s; break; }
  }
  if (!matched) return { error: `sub-task not found: ${match_text}` };
  matched.text = new_text.trim();
  if (new_due === '' || new_due === null) matched.due = null;
  else if (new_due) matched.due = new_due;
  await write(`epics/${cat}/${short}/issues.md`, serializeIssues(parsed));
  await syncEpic(`${cat}/${short}`);
  return { ok: true, id, text: matched.text, due: matched.due };
}

async function deleteSubtaskFn({ id, epic, match_text }) {
  if (!id || !match_text) return { error: 'id and match_text are required' };
  const target = await locateIssue(id, epic);
  if (!target) return { error: `issue not found: ${id}` };
  const { cat, short, issue, parsed } = target;
  const m = match_text.trim().toLowerCase();
  const before = issue.subtasks.length;
  issue.subtasks = issue.subtasks.filter(s => !(s.text.toLowerCase() === m || s.text.toLowerCase().includes(m)));
  if (issue.subtasks.length === before) return { error: `sub-task not found: ${match_text}` };
  await write(`epics/${cat}/${short}/issues.md`, serializeIssues(parsed));
  await syncEpic(`${cat}/${short}`);
  return { ok: true, id, removed: 1 };
}

async function updateEpicFn({ slug, patch }) {
  if (!slug || !slug.includes('/')) return { error: 'slug must be "category/short-name"' };
  const [cat, short] = slug.split('/');
  const path = `epics/${cat}/${short}/epic.md`;
  const md = await read(path);
  if (!md) return { error: `epic not found: ${slug}` };

  // Detect category and/or short-slug renames up-front. Either one (or both) forces
  // a physical directory move + cross-reference rewrite: completion keys (qualified
  // by epic_slug), timeblock.epic_slug, and the per-epic issue-counter key.
  const hasCat = patch && Object.prototype.hasOwnProperty.call(patch, 'category');
  const hasShort = patch && Object.prototype.hasOwnProperty.call(patch, 'short_slug');
  const newCategory = hasCat ? patch.category : cat;
  const newShort = hasShort ? patch.short_slug : short;
  let finalCat = cat;
  let finalShort = short;
  let finalSlug = slug;
  if ((newCategory && newCategory !== cat) || (newShort && newShort !== short)) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(newCategory)) {
      return { error: 'category must be lowercase letters/digits/dashes' };
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(newShort)) {
      return { error: 'short_slug must be lowercase letters/digits/dashes' };
    }
    const newDirRel = `epics/${newCategory}/${newShort}`;
    if (newDirRel !== `epics/${cat}/${short}` && await exists(newDirRel)) {
      return { error: `target already exists: ${newCategory}/${newShort}` };
    }
    await ensureDir(`epics/${newCategory}`);
    const { rename } = await import('node:fs/promises');
    const { join: pjoin } = await import('node:path');
    await rename(pjoin(DATA_ROOT, `epics/${cat}/${short}`), pjoin(DATA_ROOT, newDirRel));
    finalCat = newCategory;
    finalShort = newShort;
    finalSlug = `${newCategory}/${newShort}`;
    // Re-key completion entries — qualified shape is "<oldSlug>/<id>[#date]" → "<newSlug>/<id>[#date]"
    const completion = await readJSON('state/completion.json', {});
    const reKeyed = {};
    for (const [k, v] of Object.entries(completion)) {
      reKeyed[k.startsWith(`${slug}/`) ? `${finalSlug}/${k.slice(slug.length + 1)}` : k] = v;
    }
    await writeJSON('state/completion.json', reKeyed);
    // Re-point timeblocks linked to this epic.
    const blocks = await readBlocks();
    for (const b of blocks) if (b.epic_slug === slug) b.epic_slug = finalSlug;
    await writeBlocks(blocks);
    // Re-key the per-epic issue-counter so future create_issue calls under the
    // new slug pick up where the old slug left off.
    const counter = await readJSON('state/issue-counter.json', {});
    if (Object.prototype.hasOwnProperty.call(counter, slug)) {
      counter[finalSlug] = counter[slug];
      delete counter[slug];
      await writeJSON('state/issue-counter.json', counter);
    }
    // session-links.json stores epics inside each session record — leave as best-effort,
    // since those are read-mostly and a stale slug there just shows the old path until
    // the user resumes that chat. Not worth a deep walk.
  }

  // Now write the new epic.md (always under the final path, in case we moved).
  const epic = parseEpic(md);
  const fm = { ...epic.frontmatter };
  let body = epic.body;
  for (const [k, v] of Object.entries(patch || {})) {
    if (k === 'body') { body = v; continue; }
    if (k === 'category') { fm.category = finalCat; continue; }
    if (k === 'short_slug') { continue; }    // captured in finalShort; not a frontmatter field
    if (k === 'color') {
      // Clear cleanly on empty/null; otherwise store a validated hex.
      const c = String(v == null ? '' : v).trim();
      if (!c) { delete fm.color; }
      else if (/^#?[0-9a-fA-F]{6}$/.test(c)) { fm.color = c.startsWith('#') ? c.toLowerCase() : `#${c.toLowerCase()}`; }
      else return { error: `color must be a 6-digit hex like "#0e7490" (got ${JSON.stringify(v)})` };
      continue;
    }
    fm[k] = v;
  }
  const finalPath = `epics/${finalSlug}/epic.md`;
  await write(finalPath, serializeEpic({ frontmatter: fm, body }));
  // The old slug's index row may still exist (rename happened underneath better-sqlite3),
  // so we sync BOTH the old and new slugs — old to drop stale rows, new to insert fresh ones.
  if (finalSlug !== slug) await syncEpic(slug);
  await syncEpic(finalSlug);
  return { ok: true, slug: finalSlug, moved: finalSlug !== slug };
}

async function deleteEpicFn({ slug }) {
  if (!slug || !slug.includes('/')) return { error: 'slug must be "category/short-name"' };
  const [cat, short] = slug.split('/');
  const dirRel = `epics/${cat}/${short}`;
  if (!await exists(dirRel)) return { error: `epic not found: ${slug}` };

  // Collect every issue id in this epic so we can clean state
  const issuesMd = await read(`${dirRel}/issues.md`);
  const issueIds = parseIssues(issuesMd).issues.map(it => it.id);

  // Remove the directory recursively
  const { rm } = await import('node:fs/promises');
  const { join: pjoin } = await import('node:path');
  await rm(pjoin(DATA_ROOT, dirRel), { recursive: true, force: true });

  // Clean completion entries. Supports both qualified (<epic>/<id>[#date]) and legacy
  // unqualified keys (<id>[#date]). Only delete qualified entries whose epic matches.
  const completion = await readJSON('state/completion.json', {});
  const idSet = new Set(issueIds);
  for (const k of Object.keys(completion)) {
    const noInstance = k.split('#')[0];
    const parts = noInstance.split('/');
    const baseId = parts[parts.length - 1];
    const ownerEpic = parts.length >= 3 ? `${parts[0]}/${parts[1]}` : null;
    if (!idSet.has(baseId)) continue;
    if (ownerEpic && ownerEpic !== slug) continue;
    delete completion[k];
  }
  await writeJSON('state/completion.json', completion);

  // Clean timeblocks linked to this epic. We deliberately ONLY use epic_slug here
  // (not issue_id), because issue ids aren't globally unique (ISS-020) — checking
  // by id alone would sweep up unrelated timeblocks from other epics that happen
  // to use the same ISS-NNN. The epic_slug check is sufficient and safe.
  const tbs = await readBlocks();
  const remaining = tbs.filter(b => b.epic_slug !== slug);
  await writeBlocks(remaining);

  // Drop the issue counter for this epic (so a future create_epic with the same slug starts fresh)
  const counter = await readJSON('state/issue-counter.json', {});
  delete counter[slug];
  await writeJSON('state/issue-counter.json', counter);

  // syncEpic detects the missing directory and removes the rows. writeBlocks above
  // already re-synced timeblocks. Completions need an explicit sync since we hit the
  // file directly here rather than via complete_issue.
  await syncEpic(slug);
  await syncCompletions();
  return { ok: true, slug, removed_issue_count: issueIds.length };
}

// The remove counterpart to createCategoryFn: nuke a whole top-level category
// folder and every epic under it, then clean the same state deleteEpicFn does
// (completion, timeblocks, counters) plus the category's visibility/projects flags.
async function deleteCategoryFn({ name } = {}) {
  if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) return { error: 'name must be lowercase letters/digits/dashes' };
  const dirRel = `epics/${name}`;
  if (!await exists(dirRel)) return { error: `category not found: ${name}` };

  const shorts = await listDirs(dirRel);
  const epicSlugs = shorts.map(s => `${name}/${s}`);
  const issueIds = new Set();
  for (const s of shorts) {
    try { parseIssues(await read(`${dirRel}/${s}/issues.md`)).issues.forEach(it => issueIds.add(it.id)); } catch {}
  }

  const { rm } = await import('node:fs/promises');
  const { join: pjoin } = await import('node:path');
  await rm(pjoin(DATA_ROOT, dirRel), { recursive: true, force: true });

  // Completion: drop qualified keys owned by any epic in this category (and
  // legacy unqualified keys whose base id we saw here).
  const completion = await readJSON('state/completion.json', {});
  const epicSet = new Set(epicSlugs);
  for (const k of Object.keys(completion)) {
    const parts = k.split('#')[0].split('/');
    const ownerEpic = parts.length >= 3 ? `${parts[0]}/${parts[1]}` : null;
    const baseId = parts[parts.length - 1];
    if (ownerEpic ? epicSet.has(ownerEpic) : issueIds.has(baseId)) delete completion[k];
  }
  await writeJSON('state/completion.json', completion);

  // Timeblocks + counters scoped to this category by epic_slug prefix.
  const tbs = await readBlocks();
  await writeBlocks(tbs.filter(b => !String(b.epic_slug || '').startsWith(`${name}/`)));
  const counter = await readJSON('state/issue-counter.json', {});
  for (const sl of epicSlugs) delete counter[sl];
  await writeJSON('state/issue-counter.json', counter);

  // Housekeeping: drop the category's visibility + Projects-board flags.
  for (const rel of ['state/visibility.json', 'state/projects.json']) {
    try { const j = await readJSON(rel, {}); if (j && j[name]) { delete j[name]; await writeJSON(rel, j); } } catch {}
  }

  for (const sl of epicSlugs) { try { await syncEpic(sl); } catch {} }
  await syncCompletions();
  return { ok: true, name, removed_epic_count: epicSlugs.length, removed_issue_count: issueIds.size };
}

async function getFullContextFn({ days_ahead = 14, days_back = 7, max_issues = 100 } = {}) {
  // Compose a single payload covering everything an external agent needs.
  const [today, upcoming, openIssues, blocks, events, profile, completed] = await Promise.all([
    listTodayFn({}),
    listUpcomingFn({ days: days_ahead }),
    listIssuesFn({ status: 'open', limit: max_issues }),
    listTimeblocksFn({ from_date: fmtISO(startOfDay(new Date())), to_date: fmtISO(new Date(Date.now() + days_ahead * 86400000)) }),
    listEventsFn({ from_date: fmtISO(startOfDay(new Date())), to_date: fmtISO(new Date(Date.now() + days_ahead * 86400000)) }),
    getProfileFn(),
    listCompletedFn({ days_back }),
  ]);
  const epics = await listEpicsFn({});
  return {
    generated_at: new Date().toISOString(),
    profile_excerpt: (profile?.content || '').slice(0, 4000),
    today,
    upcoming,
    epics: epics.epics,
    open_issues: openIssues.issues,
    timeblocks: blocks.blocks,
    events: events.events,
    recent_completions: completed.issues,
  };
}

// List open issues whose due date is before today. Powers the dashboard's
// Overdue section so unfinished work never disappears just because the day rolled over.
async function listOverdueFn({ limit, epic, max_days_overdue } = {}) {
  const today = startOfDay(new Date());
  const completion = await readJSON('state/completion.json', {});
  const cats = await listDirs('epics');
  const out = [];
  for (const c of cats) {
    if (epic && !epic.startsWith(`${c}/`)) continue;
    for (const s of await listDirs(`epics/${c}`)) {
      if (epic && epic !== `${c}/${s}`) continue;
      const md = await read(`epics/${c}/${s}/issues.md`);
      const epicMd = await read(`epics/${c}/${s}/epic.md`);
      const epicAgent = parseEpic(epicMd).frontmatter.agent_owner;
      const epicSlugO = `${c}/${s}`;
      for (const it of parseIssues(md).issues) {
        // Skip recurring TEMPLATES — their occurrences materialize per-date and don't have a "due" the way one-offs do
        if (it.fields.recurring) continue;
        if (isIssueCompleted(it, completion, epicSlugO)) continue;
        if (!it.fields.due) continue;
        const dueD = parseISODate(it.fields.due);
        if (!dueD || dueD >= today) continue;
        const days = diffDays(today, dueD);
        if (max_days_overdue != null && days > max_days_overdue) continue;
        out.push({ ...toIssueSummary(c, s, it, epicAgent, parseIssues(md).issues), days_overdue: days });
      }
    }
  }
  out.sort((a, b) => b.days_overdue - a.days_overdue);
  return { count: out.length, issues: limit ? out.slice(0, limit) : out };
}

// Helper: list completed issues in the recent past (used by get_full_context + archive view)
async function listCompletedFn({ days_back = 30, query, epic, limit } = {}) {
  const completion = await readJSON('state/completion.json', {});
  const cutoff = Date.now() - days_back * 86400000;
  const cats = await listDirs('epics');
  const out = [];
  for (const c of cats) {
    if (epic && !epic.startsWith(`${c}/`)) continue;
    for (const s of await listDirs(`epics/${c}`)) {
      if (epic && epic !== `${c}/${s}`) continue;
      const md = await read(`epics/${c}/${s}/issues.md`);
      const epicMd = await read(`epics/${c}/${s}/epic.md`);
      const epicAgent = parseEpic(epicMd).frontmatter.agent_owner;
      const issues = parseIssues(md).issues;
      const epicSlugC = `${c}/${s}`;
      for (const it of issues) {
        const c1 = lookupCompletion(completion, epicSlugC, it.id);
        if (!c1?.completed_at) continue;
        const t = new Date(c1.completed_at).getTime();
        if (t < cutoff) continue;
        if (query) {
          const blob = (it.title + ' ' + it.description).toLowerCase();
          if (!blob.includes(String(query).toLowerCase())) continue;
        }
        out.push({ ...toIssueSummary(c, s, it, epicAgent, issues), completed_at: c1.completed_at, completion_note: c1.note || null });
      }
    }
  }
  out.sort((a, b) => (b.completed_at || '').localeCompare(a.completed_at || ''));
  return { count: out.length, issues: limit ? out.slice(0, limit) : out };
}

// ─── arbitrary file storage in epic folders ──────────────────────────
const RESERVED_FILES = new Set(['epic.md', 'issues.md']);

function safeFilename(name) {
  return String(name || '').trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

async function listEpicFilesFn({ epic }) {
  if (!epic || !epic.includes('/')) return { error: 'epic must be "category/slug"' };
  const [cat, short] = epic.split('/');
  if (!await exists(`epics/${cat}/${short}`)) return { error: `epic not found: ${epic}` };
  const all = await listFiles(`epics/${cat}/${short}`);
  const files = all.filter(n => !RESERVED_FILES.has(n));
  return { count: files.length, files };
}

async function readEpicFileFn({ epic, filename }) {
  if (!epic?.includes('/') || !filename) return { error: 'epic and filename required' };
  const fn = safeFilename(filename);
  if (!fn) return { error: 'invalid filename' };
  if (RESERVED_FILES.has(fn)) return { error: `${fn} is a reserved file — read via get_epic` };
  const [cat, short] = epic.split('/');
  const content = await read(`epics/${cat}/${short}/${fn}`);
  if (!content) return { error: `file not found: ${fn}` };
  return { ok: true, epic, filename: fn, content };
}

async function writeEpicFileFn({ epic, filename, content }) {
  if (!epic?.includes('/') || !filename) return { error: 'epic and filename required' };
  const fn = safeFilename(filename);
  if (!fn) return { error: 'invalid filename' };
  if (RESERVED_FILES.has(fn)) return { error: `${fn} is reserved — use update_epic for epic.md` };
  const [cat, short] = epic.split('/');
  if (!await exists(`epics/${cat}/${short}`)) return { error: `epic not found: ${epic}` };
  await write(`epics/${cat}/${short}/${fn}`, content || '');
  return { ok: true, epic, filename: fn };
}

async function appendEpicFileFn({ epic, filename, content }) {
  if (!epic?.includes('/') || !filename) return { error: 'epic and filename required' };
  const fn = safeFilename(filename);
  if (!fn) return { error: 'invalid filename' };
  if (RESERVED_FILES.has(fn)) return { error: `${fn} is reserved` };
  const [cat, short] = epic.split('/');
  const path = `epics/${cat}/${short}/${fn}`;
  const cur = await read(path);
  const sep = cur && !cur.endsWith('\n') ? '\n' : '';
  await write(path, (cur || '') + sep + (content || ''));
  return { ok: true, epic, filename: fn };
}

async function deleteEpicFileFn({ epic, filename }) {
  if (!epic?.includes('/') || !filename) return { error: 'epic and filename required' };
  const fn = safeFilename(filename);
  if (RESERVED_FILES.has(fn)) return { error: `cannot delete ${fn}` };
  const [cat, short] = epic.split('/');
  const { unlink } = await import('node:fs/promises');
  const { join: pjoin } = await import('node:path');
  try {
    await unlink(pjoin(DATA_ROOT, `epics/${cat}/${short}/${fn}`));
    return { ok: true, epic, filename: fn };
  } catch (e) {
    return { error: `delete failed: ${e.message}` };
  }
}

// ─── safeReplacer (for JSON.stringify in MCP responses) ──────────────
export function safeReplacer(_key, value) {
  if (value instanceof Date) return value.toISOString();
  return value;
}
