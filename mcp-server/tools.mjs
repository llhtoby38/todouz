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
  read, write, exists, listDirs, listFiles, ensureDir,
  readJSON, writeJSON, DATA_ROOT, TODOUZ_ROOT,
} from './store.mjs';
import {
  parseEpic, serializeEpic,
  parseIssues, serializeIssues, serializeIssue,
  startOfDay, fmtISO, parseISODate, diffDays, dayName,
} from './parsers.mjs';

// ─── catalogue ────────────────────────────────────────────────────────

export const CATEGORIES = ['studies', 'side-project', 'body', 'kitchen', 'future-planning', 'personal'];

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
      properties: { slug: { type: 'string', description: 'e.g. "studies/swen90017"' } },
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
        query: { type: 'string', description: 'Substring match on title + description.' },
        limit: { type: 'number' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_issue',
    description: 'Fetch a single issue. If `epic` is omitted, scans all epics for the id.',
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
    description: 'Read data/personal/profile.md — the user\'s profile. Use to ground reasoning in their preferences and patterns. Returns an empty string if the file does not exist.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  // ─── write ───
  {
    name: 'create_issue',
    description: 'Create a new issue under an epic. Returns the new issue id (auto-generated as ISS-NNN per epic).',
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
        subtasks: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, due: { type: 'string' } }, required: ['text'] } },
      },
      required: ['epic', 'title'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_issue',
    description: 'Update an existing issue\'s fields. Sub-tasks are not modified — use add_subtask / toggle_subtask for those.',
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
          },
        },
      },
      required: ['id', 'patch'],
      additionalProperties: false,
    },
  },
  {
    name: 'complete_issue',
    description: 'Mark an issue done. For non-recurring: flips status to "completed" + writes completion.json. For recurring: appends a log entry under ### Log AND writes a per-instance completion key (id#date). The recurring issue itself stays open.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        epic: { type: 'string' },
        log_note: { type: 'string', description: 'For recurring — what got done. Stored in completion.json AND under ### Log.' },
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
    description: 'Plan a work session at a specific time. Optionally linked to an issue (so completing the block can roll up to the issue) and/or an epic. Use for "tonight 20:00-23:00 work on the SWEN report", "Wed afternoon: ENGR draft review", etc. — anything you intend to actually sit down and do at a known time.',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'ISO YYYY-MM-DD' },
        start: { type: 'string', description: 'HH:MM (24h)' },
        end: { type: 'string', description: 'HH:MM (24h)' },
        title: { type: 'string', description: 'What you\'ll do in this block.' },
        issue_id: { type: 'string', description: 'Optional ISS-NNN to link this block to an issue.' },
        epic_slug: { type: 'string', description: 'Optional epic slug if no specific issue applies.' },
        note: { type: 'string', description: 'Optional 1-line context.' },
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
    description: 'Update an existing timeblock. Pass any subset of date/start/end/title/note/issue_id/epic_slug.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        patch: { type: 'object' },
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
    description: "Create a sub-issue under an existing parent. The new issue inherits the parent's epic + agent + priority unless overridden, and gets a `parent_issue_id` link. Use when a piece of work has its own description/subtasks/due date that doesn't fit as a single subtask line. Sub-issues can themselves have sub-issues — arbitrary depth.",
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
        subtasks: { type: 'array', items: { type: 'object' } },
      },
      required: ['parent_issue_id', 'title'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_issue',
    description: 'Permanently remove an issue and all its sub-issues. Use only on user "delete / scrap / remove" intent — for done items use complete_issue (which keeps them in the archive).',
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
    description: "Patch an epic's frontmatter (title, agent_owner, related_epics) and/or replace its body content (the long-form context after frontmatter).",
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string' },
        patch: {
          type: 'object',
          properties: {
            title: { type: 'string' },
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
    name: 'get_full_context',
    description: "One-shot dump of the user's complete state for external agents (e.g. a planner attached via `claude mcp add todouz` from another session). Returns: profile, today, next 14 days, all open issues across all epics, all timeblocks, upcoming events, and recent completions in a single payload. Use when an agent without prior context needs to plan or reason about the user's full situation.",
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
    description: 'Create or overwrite a file under an epic folder. Use for drafts, research notes, transcripts, design docs — anything that belongs to the epic but is too large/structured for an issue description. Filename is sanitised; existing files are overwritten.',
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
    description: 'Add a one-off scheduled event (e.g. "doctor appointment", "flight depart"). Not actionable — just informational on the calendar.',
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
];

// ─── dispatcher ───────────────────────────────────────────────────────

export async function handleCall(name, args = {}) {
  try {
    switch (name) {
      case 'list_categories': return listCategoriesFn();
      case 'list_agents':     return await listAgentsFn(args);
      case 'list_epics':      return await listEpicsFn(args);
      case 'get_epic':        return await getEpicFn(args);
      case 'list_issues':     return await listIssuesFn(args);
      case 'get_issue':       return await getIssueFn(args);
      case 'list_today':      return await listTodayFn(args);
      case 'list_upcoming':   return await listUpcomingFn(args);
      case 'get_profile':     return await getProfileFn();
      case 'create_issue':    return await createIssueFn(args);
      case 'update_issue':    return await updateIssueFn(args);
      case 'complete_issue':  return await completeIssueFn(args);
      case 'add_subtask':     return await addSubtaskFn(args);
      case 'toggle_subtask':  return await toggleSubtaskFn(args);
      case 'append_to_epic':  return await appendToEpicFn(args);
      case 'list_sessions':   return await listSessionsFn(args);
      case 'link_session':    return await linkSessionFn(args);
      case 'update_session':  return await updateSessionFn(args);
      case 'delete_session':  return await deleteSessionFn(args);
      case 'materialize_recurring': return await materializeRecurringFn(args);
      case 'create_subissue':       return await createSubissueFn(args);
      case 'list_completed':        return await listCompletedFn(args);
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
      case 'add_timeblock':       return await addTimeblockFn(args);
      case 'list_timeblocks':     return await listTimeblocksFn(args);
      case 'update_timeblock':    return await updateTimeblockFn(args);
      case 'complete_timeblock':  return await completeTimeblockFn(args);
      case 'delete_timeblock':    return await deleteTimeblockFn(args);
      default: return { error: `unknown tool: ${name}` };
    }
  } catch (e) {
    return { error: String(e?.message || e), stack: e?.stack };
  }
}

// ─── implementations ──────────────────────────────────────────────────

function listCategoriesFn() { return { categories: CATEGORIES }; }

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
      const open = issues.filter(it => !isIssueCompleted(it, completion));
      // Next due date among open
      const dued = open.map(it => it.fields.due).filter(Boolean).sort();
      epics.push({
        slug: `${cat}/${slug}`,
        title: epic.frontmatter.title || slug,
        category: cat,
        agent_owner: ownerAgent,
        recurring: !!(epic.frontmatter.recurring_schedule && (Array.isArray(epic.frontmatter.recurring_schedule) ? epic.frontmatter.recurring_schedule.length : true)),
        open_issue_count: open.length,
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
    is_completed: isIssueCompleted(it, completion),
    completion: completion[it.id] || null,
  }));
  return {
    slug,
    category: cat,
    title: epic.frontmatter.title || short,
    agent_owner: epic.frontmatter.agent_owner || null,
    related_epics: epic.frontmatter.related_epics || [],
    recurring_schedule: epic.frontmatter.recurring_schedule || null,
    epic_md: epicMd,
    body: epic.body,
    issues: annotated,
  };
}

async function listIssuesFn({ epic, agent, status = 'open', priority, due_within_days, recurring, query, limit } = {}) {
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
    for (const it of issues) {
      const completed = isIssueCompleted(it, completion);
      if (status === 'open' && completed) continue;
      if (status === 'completed' && !completed) continue;
      const itAgent = it.fields.agent || epicAgent;
      if (agent && itAgent !== agent) continue;
      if (priority && it.fields.priority !== priority) continue;
      if (recurring != null && !!it.fields.recurring !== !!recurring) continue;
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
      out.push({
        id: it.id,
        epic_slug: `${cat}/${short}`,
        title: it.title,
        agent: itAgent,
        due: it.fields.due,
        priority: it.fields.priority || 'medium',
        recurring: !!it.fields.recurring,
        status: completed ? 'completed' : 'open',
        open_subtask_count: it.subtasks.filter(s => !s.done).length,
        total_subtask_count: it.subtasks.length,
        is_completed: completed,
        template_id: it.fields.template_id || null,
        instance_date: it.fields.instance_date || null,
        parent_issue_id: it.fields.parent_issue_id || null,
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
    .map(it => toIssueSummary(cat, short, it, epicAgent));
  return {
    id: issue.id,
    epic_slug: `${cat}/${short}`,
    title: issue.title,
    fields: issue.fields,
    description: issue.description,
    subtasks: issue.subtasks,
    default_itinerary: issue.default_itinerary,
    log: issue.log,
    linked_files: issue.linked_files,
    is_completed: isIssueCompleted(issue, completion),
    completion: completion[issue.id] || null,
    children,
    parent_issue_id: issue.fields.parent_issue_id || null,
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
      for (const it of issues) {
        if (isIssueCompleted(it, completion)) {
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
          due.push(toIssueSummary(c, s, it, epicAgent));
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
        const instanceKey = `${it.id}#${dayStr}`;
        if (completion[instanceKey]) continue;
        recurring.push(toIssueSummary(c, s, it, epicAgent));
      }
    }
  }

  const events = eventsAll.filter(e => e.date === dayStr);
  const blocks = (await readBlocks()).filter(b => b.date === dayStr).sort((a, b) => a.start.localeCompare(b.start));
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
  const content = await read('personal/profile.md');
  return { content };
}

async function createIssueFn({ epic, title, description, due, priority = 'medium', recurring = false, recurring_schedule, agent, subtasks } = {}) {
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
      priority,
      recurring,
      recurring_schedule: recurring_schedule || null,
      status: 'open',
      sessions: [],
      related_issues: [],
    },
    description: description || '',
    subtasks: (subtasks || []).map(s => ({ done: false, text: s.text, due: s.due || null })),
    default_itinerary: [],
    log: [],
    linked_files: [],
  };
  parsed.title = parsed.title || (epicData.frontmatter.title || short);
  parsed.issues.push(newIssue);
  await write(issuesMdRel, serializeIssues(parsed));
  return { ok: true, id, epic_slug: epic };
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
    if (['due', 'priority', 'agent', 'recurring', 'recurring_schedule', 'status', 'parent_issue_id'].includes(k)) {
      // null / "" / undefined explicitly clears the parent — anything else is set.
      fields[k] = (k === 'parent_issue_id' && (v === '' || v === null)) ? null : v;
      changed.push(k);
    }
  }
  await write(`epics/${cat}/${short}/issues.md`, serializeIssues(parsed));
  // Status change writes/clears completion.json
  if (changed.includes('status')) {
    const completion = await readJSON('state/completion.json', {});
    if (fields.status === 'completed') {
      completion[id] = { completed: true, completed_at: new Date().toISOString() };
    } else {
      delete completion[id];
    }
    await writeJSON('state/completion.json', completion);
  }
  return { ok: true, id, changed_fields: changed };
}

async function completeIssueFn({ id, epic, log_note, for_date }) {
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
    return await completeIssueFn({ id: matRes.id, epic: matRes.epic_slug, log_note });
  }
  // Concrete issue (or instance): flip status + write completion.json.
  completion[id] = { completed: true, completed_at: new Date().toISOString(), note: log_note || null };
  issue.fields.status = 'completed';
  // For instances: also append to template's log so the template carries a roll-up history.
  // Mutate the SAME parsed object so the single write below captures both changes.
  if (log_note && issue.fields.template_id) {
    const template = parsed.issues.find(it => it.id === issue.fields.template_id);
    if (template && template.fields.recurring) {
      template.log.push({ date: issue.fields.instance_date || fmtISO(startOfDay(new Date())), note: log_note });
    }
  }
  await write(`epics/${cat}/${short}/issues.md`, serializeIssues(parsed));
  await writeJSON('state/completion.json', completion);
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
  return { ok: true, epic, section, line: `- ${line}` };
}

async function listSessionsFn({ agent, issue_id, limit } = {}) {
  const links = await readJSON('state/session-links.json', {});
  let entries = Object.entries(links).map(([sid, info]) => ({ session_id: sid, ...info }));
  if (agent) entries = entries.filter(e => e.agent === agent);
  if (issue_id) entries = entries.filter(e => (e.issue_ids || []).includes(issue_id));
  entries.sort((a, b) => (b.last_updated || '').localeCompare(a.last_updated || ''));
  if (limit) entries = entries.slice(0, limit);
  return { sessions: entries };
}

async function linkSessionFn({ session_id, issue_id, epic, agent }) {
  if (!session_id || !issue_id) return { error: 'session_id and issue_id required' };
  const links = await readJSON('state/session-links.json', {});
  const cur = links[session_id] || { agent: agent || null, issue_ids: [], first_message_excerpt: '', last_updated: null };
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
    }
  }
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
  return { ok: true, session_id, session: cur };
}

async function deleteSessionFn({ session_id, purge = false }) {
  if (!session_id) return { error: 'session_id required' };
  const links = await readJSON('state/session-links.json', {});
  if (!links[session_id]) return { error: `session not found: ${session_id}` };
  delete links[session_id];
  await writeJSON('state/session-links.json', links);
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
  const id = `evt-${String(events.length + 1).padStart(3, '0')}`;
  events.push({ id, title, date, time: time || null, duration_min: duration_min || null, category: category || null, note: note || null });
  await writeJSON('state/events.json', { events });
  return { ok: true, event_id: id };
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
}

async function addTimeblockFn({ date, start, end, title, issue_id, epic_slug, note }) {
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
  let n = blocks.length + 1;
  const used = new Set(blocks.map(b => b.id));
  while (used.has(`tb-${String(n).padStart(3, '0')}`)) n++;
  const id = `tb-${String(n).padStart(3, '0')}`;
  const block = { id, date, start, end, title, issue_id: issue_id || null, epic_slug: epic_slug || null, note: note || null, completed: false };
  blocks.push(block);
  await writeBlocks(blocks);
  return { ok: true, id, block };
}

async function listTimeblocksFn({ from_date, to_date, issue_id, epic_slug } = {}) {
  let blocks = await readBlocks();
  if (from_date) blocks = blocks.filter(b => b.date >= from_date);
  if (to_date) blocks = blocks.filter(b => b.date <= to_date);
  if (issue_id) blocks = blocks.filter(b => b.issue_id === issue_id);
  if (epic_slug) blocks = blocks.filter(b => b.epic_slug === epic_slug);
  // Sort by date+start
  blocks.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  return { count: blocks.length, blocks };
}

async function updateTimeblockFn({ id, patch }) {
  const blocks = await readBlocks();
  const i = blocks.findIndex(b => b.id === id);
  if (i === -1) return { error: `timeblock not found: ${id}` };
  const merged = { ...blocks[i], ...(patch || {}) };
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

function isIssueCompleted(issue, completion) {
  if (!issue) return false;
  if (issue.fields.status === 'completed') return true;
  return !!(completion && completion[issue.id] && completion[issue.id].completed);
}

function toIssueSummary(cat, short, issue, epicAgent) {
  return {
    id: issue.id,
    epic_slug: `${cat}/${short}`,
    title: issue.title,
    agent: issue.fields.agent || epicAgent,
    due: issue.fields.due,
    priority: issue.fields.priority || 'medium',
    recurring: !!issue.fields.recurring,
    status: issue.fields.status || 'open',
    open_subtask_count: issue.subtasks.filter(s => !s.done).length,
    total_subtask_count: issue.subtasks.length,
    template_id: issue.fields.template_id || null,
    instance_date: issue.fields.instance_date || null,
    parent_issue_id: issue.fields.parent_issue_id || null,
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
  const { parent_issue_id, parent_epic, title, description, due, priority, agent, subtasks } = args || {};
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
      priority: priority || parent.fields.priority || 'medium',
      recurring: false,
      recurring_schedule: null,
      status: 'open',
      sessions: [],
      related_issues: [],
      template_id: null,
      instance_date: null,
      parent_issue_id,
    },
    description: description || '',
    subtasks: (subtasks || []).map(s => ({ done: false, text: s.text, due: s.due || null })),
    default_itinerary: [],
    log: [],
    linked_files: [],
  };
  parsed.issues.push(child);
  await write(`epics/${slug}/issues.md`, serializeIssues(parsed));
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
  // Clean any per-issue completion entries
  const completion = await readJSON('state/completion.json', {});
  for (const k of Object.keys(completion)) {
    const baseId = k.split('#')[0];
    if (toRemove.has(baseId)) delete completion[k];
  }
  await writeJSON('state/completion.json', completion);
  return { ok: true, removed_ids: Array.from(toRemove), epic_slug: slug };
}

async function updateEpicFn({ slug, patch }) {
  if (!slug || !slug.includes('/')) return { error: 'slug must be "category/short-name"' };
  const [cat, short] = slug.split('/');
  const path = `epics/${cat}/${short}/epic.md`;
  const md = await read(path);
  if (!md) return { error: `epic not found: ${slug}` };
  const epic = parseEpic(md);
  const fm = { ...epic.frontmatter };
  let body = epic.body;
  for (const [k, v] of Object.entries(patch || {})) {
    if (k === 'body') { body = v; continue; }
    fm[k] = v;
  }
  await write(path, serializeEpic({ frontmatter: fm, body }));
  return { ok: true, slug };
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

  // Clean completion entries (both ISS-NNN and ISS-NNN#YYYY-MM-DD instance keys)
  const completion = await readJSON('state/completion.json', {});
  const idSet = new Set(issueIds);
  for (const k of Object.keys(completion)) {
    const baseId = k.split('#')[0];
    if (idSet.has(baseId)) delete completion[k];
  }
  await writeJSON('state/completion.json', completion);

  // Clean timeblocks linked to this epic or any of its issues
  const tbs = await readBlocks();
  const remaining = tbs.filter(b => b.epic_slug !== slug && !idSet.has(b.issue_id));
  await writeBlocks(remaining);

  // Drop the issue counter for this epic (so a future create_epic with the same slug starts fresh)
  const counter = await readJSON('state/issue-counter.json', {});
  delete counter[slug];
  await writeJSON('state/issue-counter.json', counter);

  return { ok: true, slug, removed_issue_count: issueIds.length };
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
      for (const it of issues) {
        const c1 = completion[it.id];
        if (!c1?.completed_at) continue;
        const t = new Date(c1.completed_at).getTime();
        if (t < cutoff) continue;
        if (query) {
          const blob = (it.title + ' ' + it.description).toLowerCase();
          if (!blob.includes(String(query).toLowerCase())) continue;
        }
        out.push({ ...toIssueSummary(c, s, it, epicAgent), completed_at: c1.completed_at, completion_note: c1.note || null });
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
