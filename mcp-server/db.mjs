// db.mjs — lightweight SQLite read-index over the markdown source-of-truth.
//
// Design choices, all deliberate:
// - Markdown files under data/epics/**/*.md remain the canonical store. They are
//   diffable, hand-editable, and survive the database being deleted. SQLite here
//   is a *cache* — fully rebuildable from disk at any time via reindexAll().
// - Stored at data/state/index.db so it sits beside the other JSON state files
//   and is naturally gitignored along with everything else under data/state/.
// - WAL mode + synchronous=NORMAL: fast writes, durable enough for a single-user
//   personal app. We don't need fsync per transaction for a rebuildable index.
// - One open connection per process, lazily initialized. Schema is created on
//   first open via CREATE TABLE IF NOT EXISTS, so a missing DB self-heals.
//
// What gets indexed:
//   issues       — every ## ISS-NNN block across every epic, with completion joined in.
//   epics        — one row per epics/<cat>/<slug>.
//   completions  — mirror of state/completion.json (keep history of when things finished).
//   events       — mirror of state/events.json (one-off events / appointments).
//   timeblocks   — mirror of state/timeblocks.json (calendared focus blocks).
//   sessions     — mirror of state/session-links.json (chat session metadata).
//   reindex_log  — one row per reindexAll() run for forensics.
//
// Nothing here mutates markdown. To write data, use the tools in tools.mjs —
// they update markdown first, then sync the relevant rows into SQLite.

import Database from 'better-sqlite3';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

import { DATA_ROOT, abs, read, readJSON, listDirs } from './store.mjs';
import { parseEpic, parseIssues } from './parsers.mjs';

const DB_PATH = join(DATA_ROOT, 'state', 'index.db');

let _db = null;

// ─── connection ──────────────────────────────────────────────────────
export function getDb() {
  if (_db) return _db;
  mkdirSync(join(DATA_ROOT, 'state'), { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('synchronous = NORMAL');
  _db.pragma('foreign_keys = ON');
  ensureSchema(_db);
  return _db;
}

export function closeDb() {
  if (_db) { try { _db.close(); } catch {} _db = null; }
}

// ─── schema ──────────────────────────────────────────────────────────
function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS epics (
      slug              TEXT PRIMARY KEY,             -- "category/short"
      category          TEXT NOT NULL,
      short             TEXT NOT NULL,
      title             TEXT,
      agent_owner       TEXT,
      recurring         INTEGER NOT NULL DEFAULT 0,   -- bool
      body              TEXT,                         -- full epic.md body (post-frontmatter)
      frontmatter_json  TEXT,                         -- raw frontmatter as JSON
      last_indexed_at   TEXT NOT NULL                 -- ISO timestamp
    );
    CREATE INDEX IF NOT EXISTS idx_epics_category ON epics(category);
    CREATE INDEX IF NOT EXISTS idx_epics_agent    ON epics(agent_owner);

    -- NB: issue IDs ("ISS-NNN") are scoped per-epic in the markdown today (see
    -- ISS-020 — the long-standing data-model bug we haven't fixed yet). Until that
    -- lands, the only globally unique key is (epic_slug, id). Keep an index on id
    -- alone so "locate by id, scan epics" lookups stay fast.
    CREATE TABLE IF NOT EXISTS issues (
      id                TEXT NOT NULL,                -- "ISS-NNN"
      epic_slug         TEXT NOT NULL,
      title             TEXT NOT NULL,
      description       TEXT,
      agent             TEXT,
      due               TEXT,                         -- YYYY-MM-DD or NULL
      priority          TEXT,                         -- high|medium|low
      status            TEXT,                         -- open|completed|...
      recurring         INTEGER NOT NULL DEFAULT 0,
      recurring_schedule_json TEXT,
      template_id       TEXT,
      instance_date     TEXT,
      parent_issue_id   TEXT,
      open_subtask_count  INTEGER NOT NULL DEFAULT 0,
      total_subtask_count INTEGER NOT NULL DEFAULT 0,
      is_completed      INTEGER NOT NULL DEFAULT 0,   -- joined from completion.json at index time
      completed_at      TEXT,                         -- ISO timestamp from completion.json
      sessions_json     TEXT,
      related_issues_json TEXT,
      subtasks_json     TEXT,
      linked_files_json TEXT,
      last_indexed_at   TEXT NOT NULL,
      PRIMARY KEY (epic_slug, id),
      FOREIGN KEY (epic_slug) REFERENCES epics(slug) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_issues_id         ON issues(id);
    CREATE INDEX IF NOT EXISTS idx_issues_epic       ON issues(epic_slug);
    CREATE INDEX IF NOT EXISTS idx_issues_agent      ON issues(agent);
    CREATE INDEX IF NOT EXISTS idx_issues_due        ON issues(due);
    CREATE INDEX IF NOT EXISTS idx_issues_completed  ON issues(is_completed);
    CREATE INDEX IF NOT EXISTS idx_issues_parent     ON issues(parent_issue_id);
    CREATE INDEX IF NOT EXISTS idx_issues_recurring  ON issues(recurring);

    CREATE TABLE IF NOT EXISTS completions (
      issue_id     TEXT PRIMARY KEY,                  -- matches the key shape in completion.json
      completed    INTEGER NOT NULL DEFAULT 1,
      completed_at TEXT,
      raw_json     TEXT
    );

    CREATE TABLE IF NOT EXISTS events (
      id           TEXT PRIMARY KEY,
      title        TEXT,
      date         TEXT,
      end_date     TEXT,
      category     TEXT,
      epic_slug    TEXT,
      done         INTEGER NOT NULL DEFAULT 0,
      raw_json     TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);

    CREATE TABLE IF NOT EXISTS timeblocks (
      id           TEXT PRIMARY KEY,
      date         TEXT,
      start_time   TEXT,
      end_time     TEXT,
      title        TEXT,
      issue_id     TEXT,
      status       TEXT,
      raw_json     TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_timeblocks_date ON timeblocks(date);

    CREATE TABLE IF NOT EXISTS sessions (
      session_id      TEXT PRIMARY KEY,
      agent           TEXT,
      first_message_excerpt TEXT,
      last_updated    TEXT,
      turn_count      INTEGER,
      issue_ids_json  TEXT,
      raw_json        TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent);

    CREATE TABLE IF NOT EXISTS reindex_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at  TEXT NOT NULL,
      finished_at TEXT,
      ok          INTEGER,
      counts_json TEXT,
      error       TEXT
    );

    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}

// ─── upsert helpers ─────────────────────────────────────────────────
// These are the entry points used by mutation tools to keep SQLite in sync
// without paying for a full reindex.

export function upsertEpic({ slug, category, short, title, agent_owner, recurring, body, frontmatter }) {
  const db = getDb();
  db.prepare(`
    INSERT INTO epics (slug, category, short, title, agent_owner, recurring, body, frontmatter_json, last_indexed_at)
    VALUES (@slug, @category, @short, @title, @agent_owner, @recurring, @body, @frontmatter_json, @ts)
    ON CONFLICT(slug) DO UPDATE SET
      category=excluded.category,
      short=excluded.short,
      title=excluded.title,
      agent_owner=excluded.agent_owner,
      recurring=excluded.recurring,
      body=excluded.body,
      frontmatter_json=excluded.frontmatter_json,
      last_indexed_at=excluded.last_indexed_at
  `).run({
    slug, category, short,
    title: title || null,
    agent_owner: agent_owner || null,
    recurring: recurring ? 1 : 0,
    body: body || null,
    frontmatter_json: JSON.stringify(frontmatter || {}),
    ts: new Date().toISOString(),
  });
}

export function deleteEpicRow(slug) {
  const db = getDb();
  db.prepare('DELETE FROM issues WHERE epic_slug = ?').run(slug);
  db.prepare('DELETE FROM epics WHERE slug = ?').run(slug);
}

export function upsertIssue(row) {
  const db = getDb();
  db.prepare(`
    INSERT INTO issues (
      id, epic_slug, title, description, agent, due, priority, status,
      recurring, recurring_schedule_json, template_id, instance_date, parent_issue_id,
      open_subtask_count, total_subtask_count, is_completed, completed_at,
      sessions_json, related_issues_json, subtasks_json, linked_files_json, last_indexed_at
    ) VALUES (
      @id, @epic_slug, @title, @description, @agent, @due, @priority, @status,
      @recurring, @recurring_schedule_json, @template_id, @instance_date, @parent_issue_id,
      @open_subtask_count, @total_subtask_count, @is_completed, @completed_at,
      @sessions_json, @related_issues_json, @subtasks_json, @linked_files_json, @last_indexed_at
    )
    ON CONFLICT(epic_slug, id) DO UPDATE SET
      title=excluded.title,
      description=excluded.description,
      agent=excluded.agent,
      due=excluded.due,
      priority=excluded.priority,
      status=excluded.status,
      recurring=excluded.recurring,
      recurring_schedule_json=excluded.recurring_schedule_json,
      template_id=excluded.template_id,
      instance_date=excluded.instance_date,
      parent_issue_id=excluded.parent_issue_id,
      open_subtask_count=excluded.open_subtask_count,
      total_subtask_count=excluded.total_subtask_count,
      is_completed=excluded.is_completed,
      completed_at=excluded.completed_at,
      sessions_json=excluded.sessions_json,
      related_issues_json=excluded.related_issues_json,
      subtasks_json=excluded.subtasks_json,
      linked_files_json=excluded.linked_files_json,
      last_indexed_at=excluded.last_indexed_at
  `).run(row);
}

// Delete by (id, epic_slug). If epic_slug is omitted, deletes every row matching
// id (only ambiguous because of ISS-020; for now this matches the legacy tool semantics).
export function deleteIssueRow(id, epic_slug = null) {
  const db = getDb();
  if (epic_slug) db.prepare('DELETE FROM issues WHERE id = ? AND epic_slug = ?').run(id, epic_slug);
  else db.prepare('DELETE FROM issues WHERE id = ?').run(id);
}

export function upsertCompletion(issueId, record) {
  const db = getDb();
  db.prepare(`
    INSERT INTO completions (issue_id, completed, completed_at, raw_json)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(issue_id) DO UPDATE SET
      completed=excluded.completed,
      completed_at=excluded.completed_at,
      raw_json=excluded.raw_json
  `).run(
    issueId,
    record && record.completed ? 1 : 0,
    record && record.completed_at ? record.completed_at : null,
    JSON.stringify(record || {}),
  );
  // Also keep the issues row in sync if it exists.
  db.prepare(`
    UPDATE issues
    SET is_completed = ?, completed_at = ?
    WHERE id = ?
  `).run(record && record.completed ? 1 : 0, record && record.completed_at ? record.completed_at : null, issueId);
}

export function upsertEvent(ev) {
  if (!ev || !ev.id) return;
  const db = getDb();
  db.prepare(`
    INSERT INTO events (id, title, date, end_date, category, epic_slug, done, raw_json)
    VALUES (@id, @title, @date, @end_date, @category, @epic_slug, @done, @raw)
    ON CONFLICT(id) DO UPDATE SET
      title=excluded.title, date=excluded.date, end_date=excluded.end_date,
      category=excluded.category, epic_slug=excluded.epic_slug, done=excluded.done,
      raw_json=excluded.raw_json
  `).run({
    id: ev.id,
    title: ev.title || null,
    date: ev.date || null,
    end_date: ev.end_date || null,
    category: ev.category || null,
    epic_slug: ev.epic_slug || null,
    done: ev.done ? 1 : 0,
    raw: JSON.stringify(ev),
  });
}

export function deleteEventRow(id) {
  getDb().prepare('DELETE FROM events WHERE id = ?').run(id);
}

export function upsertTimeblock(tb) {
  if (!tb || !tb.id) return;
  const db = getDb();
  db.prepare(`
    INSERT INTO timeblocks (id, date, start_time, end_time, title, issue_id, status, raw_json)
    VALUES (@id, @date, @start_time, @end_time, @title, @issue_id, @status, @raw)
    ON CONFLICT(id) DO UPDATE SET
      date=excluded.date, start_time=excluded.start_time, end_time=excluded.end_time,
      title=excluded.title, issue_id=excluded.issue_id, status=excluded.status,
      raw_json=excluded.raw_json
  `).run({
    id: tb.id,
    date: tb.date || null,
    start_time: tb.start_time || tb.start || null,
    end_time: tb.end_time || tb.end || null,
    title: tb.title || null,
    issue_id: tb.issue_id || null,
    status: tb.status || null,
    raw: JSON.stringify(tb),
  });
}

export function deleteTimeblockRow(id) {
  getDb().prepare('DELETE FROM timeblocks WHERE id = ?').run(id);
}

export function upsertSession(sessionId, record) {
  if (!sessionId || !record) return;
  const db = getDb();
  db.prepare(`
    INSERT INTO sessions (session_id, agent, first_message_excerpt, last_updated, turn_count, issue_ids_json, raw_json)
    VALUES (@sid, @agent, @excerpt, @updated, @turns, @issues, @raw)
    ON CONFLICT(session_id) DO UPDATE SET
      agent=excluded.agent,
      first_message_excerpt=excluded.first_message_excerpt,
      last_updated=excluded.last_updated,
      turn_count=excluded.turn_count,
      issue_ids_json=excluded.issue_ids_json,
      raw_json=excluded.raw_json
  `).run({
    sid: sessionId,
    agent: record.agent || null,
    excerpt: record.first_message_excerpt || null,
    updated: record.last_updated || null,
    turns: record.turn_count || 0,
    issues: JSON.stringify(record.issue_ids || []),
    raw: JSON.stringify(record),
  });
}

export function deleteSessionRow(sessionId) {
  getDb().prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId);
}

// ─── stats ────────────────────────────────────────────────────────────
export function getStats() {
  const db = getDb();
  const tables = ['epics', 'issues', 'completions', 'events', 'timeblocks', 'sessions', 'reindex_log'];
  const counts = {};
  for (const t of tables) {
    counts[t] = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  }
  const lastReindex = db
    .prepare('SELECT started_at, finished_at, ok, counts_json, error FROM reindex_log ORDER BY id DESC LIMIT 1')
    .get();
  let last = null;
  if (lastReindex) {
    last = {
      started_at: lastReindex.started_at,
      finished_at: lastReindex.finished_at,
      ok: !!lastReindex.ok,
      counts: lastReindex.counts_json ? safeJSON(lastReindex.counts_json) : null,
      error: lastReindex.error || null,
    };
  }
  return { db_path: DB_PATH, counts, last_reindex: last };
}

function safeJSON(s) { try { return JSON.parse(s); } catch { return null; } }

// ─── full reindex ────────────────────────────────────────────────────
// Walks markdown + JSON state files and upserts everything. Idempotent.
// Wrapped in a single transaction for speed; either the whole rebuild lands
// or nothing does, and the previous index keeps serving reads in the meantime.

export async function reindexAll() {
  const db = getDb();
  const startedAt = new Date().toISOString();

  // Gather everything *before* opening the transaction (parsers are async/IO),
  // then apply the writes synchronously inside it.
  const completion = await readJSON('state/completion.json', {});
  const events = await readJSON('state/events.json', []);
  const timeblocks = await readJSON('state/timeblocks.json', []);
  const sessions = await readJSON('state/session-links.json', {});

  const epicRows = [];
  const issueRows = [];
  const cats = await listDirs('epics');
  for (const cat of cats) {
    const shorts = await listDirs(`epics/${cat}`);
    for (const short of shorts) {
      const epicMd = await read(`epics/${cat}/${short}/epic.md`);
      const issuesMd = await read(`epics/${cat}/${short}/issues.md`);
      if (!epicMd && !issuesMd) continue;
      const epic = parseEpic(epicMd);
      const fm = epic.frontmatter || {};
      const slug = `${cat}/${short}`;
      epicRows.push({
        slug, category: cat, short,
        title: fm.title || short,
        agent_owner: fm.agent_owner || null,
        recurring: !!(fm.recurring_schedule && (Array.isArray(fm.recurring_schedule) ? fm.recurring_schedule.length : true)),
        body: epic.body || '',
        frontmatter: fm,
      });
      const parsed = parseIssues(issuesMd);
      for (const it of parsed.issues) {
        const comp = completion[it.id];
        const isCompleted = (it.fields.status === 'completed') || !!(comp && comp.completed);
        const openSub = (it.subtasks || []).filter(s => !s.done).length;
        const totalSub = (it.subtasks || []).length;
        issueRows.push({
          id: it.id,
          epic_slug: slug,
          title: it.title,
          description: it.description || '',
          agent: it.fields.agent || fm.agent_owner || null,
          due: it.fields.due || null,
          priority: it.fields.priority || 'medium',
          status: it.fields.status || 'open',
          recurring: it.fields.recurring ? 1 : 0,
          recurring_schedule_json: JSON.stringify(it.fields.recurring_schedule || null),
          template_id: it.fields.template_id || null,
          instance_date: it.fields.instance_date || null,
          parent_issue_id: it.fields.parent_issue_id || null,
          open_subtask_count: openSub,
          total_subtask_count: totalSub,
          is_completed: isCompleted ? 1 : 0,
          completed_at: comp && comp.completed_at ? comp.completed_at : null,
          sessions_json: JSON.stringify(it.fields.sessions || []),
          related_issues_json: JSON.stringify(it.fields.related_issues || []),
          subtasks_json: JSON.stringify(it.subtasks || []),
          linked_files_json: JSON.stringify(it.linked_files || []),
          last_indexed_at: startedAt,
        });
      }
    }
  }

  const counts = { epics: 0, issues: 0, completions: 0, events: 0, timeblocks: 0, sessions: 0 };
  let finishedAt = null;
  let err = null;

  const tx = db.transaction(() => {
    // Wipe stale rows. Reindex is intended to mirror disk exactly, so anything
    // that used to be on disk but isn't anymore should disappear from the cache too.
    db.exec('DELETE FROM issues');
    db.exec('DELETE FROM epics');
    db.exec('DELETE FROM completions');
    db.exec('DELETE FROM events');
    db.exec('DELETE FROM timeblocks');
    db.exec('DELETE FROM sessions');

    for (const e of epicRows) {
      upsertEpic(e); counts.epics++;
    }
    for (const r of issueRows) {
      upsertIssue(r); counts.issues++;
    }
    for (const [issueId, rec] of Object.entries(completion || {})) {
      upsertCompletion(issueId, rec); counts.completions++;
    }
    const eventArr = Array.isArray(events) ? events : (events?.events || []);
    for (const ev of eventArr) { upsertEvent(ev); counts.events++; }
    const tbArr = Array.isArray(timeblocks) ? timeblocks : (timeblocks?.blocks || timeblocks?.timeblocks || []);
    for (const tb of tbArr) { upsertTimeblock(tb); counts.timeblocks++; }
    for (const [sid, rec] of Object.entries(sessions || {})) {
      upsertSession(sid, rec); counts.sessions++;
    }
    db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('last_reindex_at', startedAt);
  });

  try {
    tx();
    finishedAt = new Date().toISOString();
    db.prepare('INSERT INTO reindex_log (started_at, finished_at, ok, counts_json, error) VALUES (?, ?, 1, ?, NULL)')
      .run(startedAt, finishedAt, JSON.stringify(counts));
  } catch (e) {
    err = String(e?.message || e);
    finishedAt = new Date().toISOString();
    try {
      db.prepare('INSERT INTO reindex_log (started_at, finished_at, ok, counts_json, error) VALUES (?, ?, 0, ?, ?)')
        .run(startedAt, finishedAt, JSON.stringify(counts), err);
    } catch {}
  }

  return { ok: !err, started_at: startedAt, finished_at: finishedAt, counts, error: err, db_path: DB_PATH };
}

// ─── incremental sync from disk ──────────────────────────────────────
// Called by mutation tools after they finish writing to markdown / JSON.
// Cheaper than reindexAll() but achieves the same invariant: the index
// matches what's on disk for the affected entity.

// Re-sync one epic (epic + all its issues). Safe to call on slugs that no
// longer exist on disk — in that case, removes the rows. Wrapped in a single
// transaction so readers never see a half-updated epic.
export async function syncEpicFromDisk(slug) {
  if (!slug || !slug.includes('/')) return { ok: false, error: 'invalid slug' };
  const db = getDb();
  const [cat, short] = slug.split('/');
  const epicMd = await read(`epics/${cat}/${short}/epic.md`);
  const issuesMd = await read(`epics/${cat}/${short}/issues.md`);

  if (!epicMd && !issuesMd) {
    db.transaction(() => {
      db.prepare('DELETE FROM issues WHERE epic_slug = ?').run(slug);
      db.prepare('DELETE FROM epics WHERE slug = ?').run(slug);
    })();
    return { ok: true, removed: true, slug };
  }

  const completion = await readJSON('state/completion.json', {});
  const epic = parseEpic(epicMd);
  const fm = epic.frontmatter || {};
  const parsed = parseIssues(issuesMd);
  const ts = new Date().toISOString();

  const epicRow = {
    slug, category: cat, short,
    title: fm.title || short,
    agent_owner: fm.agent_owner || null,
    recurring: !!(fm.recurring_schedule && (Array.isArray(fm.recurring_schedule) ? fm.recurring_schedule.length : true)),
    body: epic.body || '',
    frontmatter: fm,
  };

  const issueRows = parsed.issues.map((it) => {
    const comp = completion[it.id];
    const isCompleted = (it.fields.status === 'completed') || !!(comp && comp.completed);
    return {
      id: it.id,
      epic_slug: slug,
      title: it.title,
      description: it.description || '',
      agent: it.fields.agent || fm.agent_owner || null,
      due: it.fields.due || null,
      priority: it.fields.priority || 'medium',
      status: it.fields.status || 'open',
      recurring: it.fields.recurring ? 1 : 0,
      recurring_schedule_json: JSON.stringify(it.fields.recurring_schedule || null),
      template_id: it.fields.template_id || null,
      instance_date: it.fields.instance_date || null,
      parent_issue_id: it.fields.parent_issue_id || null,
      open_subtask_count: (it.subtasks || []).filter(s => !s.done).length,
      total_subtask_count: (it.subtasks || []).length,
      is_completed: isCompleted ? 1 : 0,
      completed_at: comp && comp.completed_at ? comp.completed_at : null,
      sessions_json: JSON.stringify(it.fields.sessions || []),
      related_issues_json: JSON.stringify(it.fields.related_issues || []),
      subtasks_json: JSON.stringify(it.subtasks || []),
      linked_files_json: JSON.stringify(it.linked_files || []),
      last_indexed_at: ts,
    };
  });

  db.transaction(() => {
    // Wipe stale rows for this epic — anything previously indexed but no
    // longer in the markdown should disappear (e.g. after delete_issue).
    db.prepare('DELETE FROM issues WHERE epic_slug = ?').run(slug);
    upsertEpic(epicRow);
    for (const r of issueRows) upsertIssue(r);
  })();
  return { ok: true, slug, issue_count: issueRows.length };
}

// Re-mirror state/completion.json into the completions table AND propagate
// is_completed flags into the issues table so list_issues etc. stay correct.
export async function syncCompletionsFromDisk() {
  const completion = await readJSON('state/completion.json', {});
  const db = getDb();
  db.transaction(() => {
    db.exec('DELETE FROM completions');
    // Reset is_completed for issues that have status=open in markdown — they
    // may have been previously completed and just un-completed. We can't know
    // status without re-reading markdown, so leave is_completed alone here and
    // rely on the per-issue upsert in syncEpicFromDisk to refresh it. Just
    // mirror the completions table; the issues table is best-effort updated
    // below by row.
    for (const [issueId, rec] of Object.entries(completion || {})) {
      upsertCompletion(issueId, rec);
    }
  })();
  return { ok: true, count: Object.keys(completion || {}).length };
}

// Re-mirror state/events.json into the events table.
export async function syncEventsFromDisk() {
  const raw = await readJSON('state/events.json', { events: [] });
  const events = Array.isArray(raw) ? raw : (raw?.events || []);
  const db = getDb();
  db.transaction(() => {
    db.exec('DELETE FROM events');
    for (const ev of events) upsertEvent(ev);
  })();
  return { ok: true, count: events.length };
}

// Re-mirror state/timeblocks.json into the timeblocks table.
export async function syncTimeblocksFromDisk() {
  const raw = await readJSON('state/timeblocks.json', { blocks: [] });
  const blocks = Array.isArray(raw) ? raw : (raw?.blocks || []);
  const db = getDb();
  db.transaction(() => {
    db.exec('DELETE FROM timeblocks');
    for (const tb of blocks) upsertTimeblock(tb);
  })();
  return { ok: true, count: blocks.length };
}

// Re-mirror state/session-links.json into the sessions table.
export async function syncSessionsFromDisk() {
  const links = await readJSON('state/session-links.json', {});
  const db = getDb();
  db.transaction(() => {
    db.exec('DELETE FROM sessions');
    for (const [sid, rec] of Object.entries(links || {})) upsertSession(sid, rec);
  })();
  return { ok: true, count: Object.keys(links || {}).length };
}

export const DB_FILE = DB_PATH;
