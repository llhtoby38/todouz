// parsers.mjs — pure md ↔ AST conversion. No file IO. No globals.
//
// Three core ASTs:
//   - EpicMd    : { frontmatter: object, body: string }
//   - IssuesMd  : { issues: Issue[] }
//   - Issue     : { id, title, fields, description, subtasks, log, linked_files, default_itinerary }
//
// Plus tiny helpers for YAML frontmatter (limited subset — just k:v + nested object + array of strings).

// ─── frontmatter ──────────────────────────────────────────────────────
// We only need a tiny YAML subset. No anchors, no multiline strings, no JSON-style flow.
// Supports: scalar, nested object (one level deep), array of scalars `[]` or `- item` block,
//           and the special "null" / "true" / "false" / numbers.

export function parseFrontmatter(md) {
  if (!md.startsWith('---\n')) return { frontmatter: {}, body: md };
  const end = md.indexOf('\n---\n', 4);
  if (end === -1) return { frontmatter: {}, body: md };
  const fmText = md.slice(4, end);
  const body = md.slice(end + 5);
  return { frontmatter: parseYamlSubset(fmText), body };
}

export function serializeFrontmatter(obj, body = '') {
  const fm = stringifyYamlSubset(obj);
  return `---\n${fm}---\n${body}`;
}

function parseYamlSubset(text) {
  const out = {};
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) { i++; continue; }
    // Top-level key (no leading whitespace)
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!m) { i++; continue; }
    const key = m[1];
    const rest = m[2].trim();
    if (rest === '' || rest === '|' || rest === '>') {
      // Either a nested object or a list-of-bullets follows.
      const nested = [];
      i++;
      while (i < lines.length) {
        const next = lines[i];
        if (!next.match(/^\s+/) && next.trim() !== '') break;
        nested.push(next);
        i++;
      }
      // Detect "- item" form (list of objects/scalars)
      const allBullets = nested.every(l => l.trim() === '' || l.trim().startsWith('- '));
      if (allBullets) {
        out[key] = nested
          .filter(l => l.trim().startsWith('- '))
          .map(l => parseScalarOrInlineObject(l.trim().slice(2)));
      } else {
        // Nested key:value object (one level)
        const sub = {};
        for (const sl of nested) {
          const sm = sl.match(/^\s+([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
          if (sm) sub[sm[1]] = parseScalar(sm[2].trim());
        }
        out[key] = sub;
      }
    } else {
      out[key] = parseScalar(rest);
      i++;
    }
  }
  return out;
}

function parseScalar(s) {
  if (s === '' || s === 'null' || s === '~') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d*\.\d+$/.test(s)) return parseFloat(s);
  // Inline array: [a, b, c]
  if (s.startsWith('[') && s.endsWith(']')) {
    const inside = s.slice(1, -1).trim();
    if (!inside) return [];
    return inside.split(',').map(x => parseScalar(unquote(x.trim())));
  }
  // Inline object: { k: v, k: v }
  if (s.startsWith('{') && s.endsWith('}')) {
    const obj = {};
    const inside = s.slice(1, -1).trim();
    if (!inside) return obj;
    for (const part of splitTopLevel(inside, ',')) {
      const m = part.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*?)\s*$/);
      if (m) obj[m[1]] = parseScalar(unquote(m[2]));
    }
    return obj;
  }
  return unquote(s);
}

function parseScalarOrInlineObject(s) {
  return parseScalar(s);
}

function unquote(s) {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

// Split a string by `sep` ignoring chars inside {} or [] (one level deep).
function splitTopLevel(s, sep) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') depth--;
    else if (c === sep && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts;
}

function stringifyYamlSubset(obj) {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) { out.push(`${k}: null`); continue; }
    if (typeof v === 'boolean' || typeof v === 'number') { out.push(`${k}: ${v}`); continue; }
    if (typeof v === 'string') { out.push(`${k}: ${quoteIfNeeded(v)}`); continue; }
    if (Array.isArray(v)) {
      if (v.length === 0) { out.push(`${k}: []`); continue; }
      // If items are simple scalars, use inline form for compactness; objects → block list.
      if (v.every(x => typeof x !== 'object' || x === null)) {
        out.push(`${k}: [${v.map(x => quoteIfNeeded(String(x ?? ''))).join(', ')}]`);
      } else {
        out.push(`${k}:`);
        for (const item of v) {
          out.push(`  - ${stringifyInlineObject(item)}`);
        }
      }
      continue;
    }
    // Plain object → either inline (small) or block.
    const keys = Object.keys(v);
    if (keys.length <= 3 && keys.every(k2 => typeof v[k2] !== 'object' || v[k2] === null)) {
      out.push(`${k}: ${stringifyInlineObject(v)}`);
    } else {
      out.push(`${k}:`);
      for (const [k2, v2] of Object.entries(v)) {
        out.push(`  ${k2}: ${typeof v2 === 'string' ? quoteIfNeeded(v2) : v2}`);
      }
    }
  }
  return out.join('\n') + '\n';
}

function stringifyInlineObject(obj) {
  if (typeof obj !== 'object' || obj === null) return String(obj);
  const parts = Object.entries(obj).map(([k, v]) => `${k}: ${typeof v === 'string' ? quoteIfNeeded(v) : v ?? 'null'}`);
  return `{ ${parts.join(', ')} }`;
}

function quoteIfNeeded(s) {
  if (s === '' || /^(true|false|null|~)$/.test(s)) return `"${s}"`;
  if (/^[-?\d.]/.test(s) || /[:#{}\[\],&*!|>'"%@`]/.test(s)) return JSON.stringify(s);
  return s;
}

// ─── epic.md ──────────────────────────────────────────────────────────

export function parseEpic(md) {
  if (!md) return { frontmatter: {}, body: '' };
  return parseFrontmatter(md);
}

export function serializeEpic(epic) {
  const fm = epic.frontmatter || {};
  return serializeFrontmatter(fm, epic.body || '');
}

// ─── issues.md ────────────────────────────────────────────────────────
// One file per epic. Header: "# Issues for <title>".
// Each issue is a `## ISS-NNN — <title>` block with:
//   - metadata bullets directly after the heading
//   - description (free-form md until the first `### ` subsection)
//   - optional `### Sub-tasks` (nested checkboxes)
//   - optional `### Default itinerary` (recurring only, nested checkboxes used as template)
//   - optional `### Log` (recurring only, one bullet per date)
//   - optional `### Linked files` (one `- See: [label](path)` per line)

const ISSUE_HEADING_RE = /^##\s+(ISS-\d+)\s*—\s*(.+)$/;
const SUBSECTION_RE = /^###\s+(.+)$/;
const META_BULLET_RE = /^-\s+([a-z_]+):\s*(.*)$/;
const SUBTASK_RE = /^\s*-\s*\[([ xX])\]\s+(.+?)(?:\s*—\s*_due\s+(\d{4}-\d{2}-\d{2})_)?\s*$/;
const LINKED_FILE_RE = /^\s*-\s+See:\s+\[([^\]]+)\]\(([^)]+)\)\s*$/;
const LOG_ENTRY_RE = /^\s*-\s+(\d{4}-\d{2}-\d{2}).*?:\s*(.+)$/;

export function parseIssues(md) {
  if (!md) return { title: '', issues: [] };
  const lines = md.split('\n');
  const issues = [];
  let titleLine = '';
  let i = 0;
  // Find optional file title (# ...)
  while (i < lines.length && !lines[i].startsWith('#')) i++;
  if (i < lines.length && lines[i].startsWith('# ')) {
    titleLine = lines[i].slice(2).trim();
    i++;
  }
  // Walk for `## ISS-NNN —` blocks
  while (i < lines.length) {
    const m = lines[i].match(ISSUE_HEADING_RE);
    if (!m) { i++; continue; }
    const id = m[1];
    const title = m[2].trim();
    const start = i;
    let end = i + 1;
    while (end < lines.length && !lines[end].match(ISSUE_HEADING_RE)) end++;
    const block = lines.slice(start + 1, end);
    issues.push(parseIssueBlock(id, title, block));
    i = end;
  }
  return { title: titleLine, issues };
}

function parseIssueBlock(id, title, lines) {
  const issue = {
    id,
    title,
    fields: {
      agent: null,
      due: null,
      priority: 'medium',
      recurring: false,
      recurring_schedule: null,
      status: 'open',
      sessions: [],
      related_issues: [],
      // Instance metadata: when an issue was created by materializing a recurring template,
      // these point at the template + the date the instance is for. Templates leave both null.
      template_id: null,
      instance_date: null,
      // Parent reference for sub-issue hierarchy. Top-level issues leave this null.
      // Allows arbitrary nesting (parent → child → grandchild) — children traversed via this field.
      parent_issue_id: null,
    },
    description: '',
    subtasks: [],
    default_itinerary: [],
    log: [],
    linked_files: [],
  };
  let i = 0;
  // Eat leading blanks
  while (i < lines.length && !lines[i].trim()) i++;
  // Metadata block: consecutive `- key: value` lines
  while (i < lines.length) {
    const m = lines[i].match(META_BULLET_RE);
    if (!m) break;
    const key = m[1];
    const raw = m[2].trim();
    if (key === 'sessions' || key === 'related_issues') {
      // [a, b, c] or [] form
      if (raw.startsWith('[') && raw.endsWith(']')) {
        const inside = raw.slice(1, -1).trim();
        issue.fields[key] = inside ? inside.split(',').map(s => s.trim().replace(/^["']|["']$/g, '')) : [];
      } else {
        issue.fields[key] = raw ? [raw] : [];
      }
    } else if (key === 'recurring') {
      issue.fields.recurring = raw === 'true';
    } else if (key === 'recurring_schedule') {
      // Inline `{ dow: 2, time: '23:59' }` form
      if (raw === 'null' || raw === '') issue.fields.recurring_schedule = null;
      else issue.fields.recurring_schedule = parseInlineObject(raw);
    } else if (key === 'due' && raw === 'null') {
      issue.fields.due = null;
    } else {
      issue.fields[key] = raw === 'null' ? null : raw;
    }
    i++;
  }
  // Eat trailing blanks
  while (i < lines.length && !lines[i].trim()) i++;
  // Description: everything up to first ### subsection
  const descStart = i;
  while (i < lines.length && !lines[i].match(SUBSECTION_RE)) i++;
  issue.description = lines.slice(descStart, i).join('\n').trim();
  // Subsections
  while (i < lines.length) {
    const m = lines[i].match(SUBSECTION_RE);
    if (!m) { i++; continue; }
    const heading = m[1].trim().toLowerCase();
    i++;
    const subStart = i;
    while (i < lines.length && !lines[i].match(SUBSECTION_RE)) i++;
    const subLines = lines.slice(subStart, i);
    if (heading === 'sub-tasks' || heading === 'subtasks') issue.subtasks = parseChecklist(subLines);
    else if (heading === 'default itinerary') issue.default_itinerary = parseChecklist(subLines);
    else if (heading === 'log') issue.log = parseLog(subLines);
    else if (heading === 'linked files') issue.linked_files = parseLinkedFiles(subLines);
  }
  return issue;
}

function parseInlineObject(s) {
  if (!s.startsWith('{') || !s.endsWith('}')) return null;
  const inside = s.slice(1, -1).trim();
  const out = {};
  for (const part of splitTopLevel(inside, ',')) {
    const m = part.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*?)\s*$/);
    if (m) {
      const v = m[2].trim();
      if (/^-?\d+$/.test(v)) out[m[1]] = parseInt(v, 10);
      else if (v === 'null') out[m[1]] = null;
      else out[m[1]] = v.replace(/^["']|["']$/g, '');
    }
  }
  return out;
}

function parseChecklist(lines) {
  const out = [];
  for (const line of lines) {
    const m = line.match(SUBTASK_RE);
    if (!m) continue;
    out.push({
      done: m[1].toLowerCase() === 'x',
      text: m[2].trim(),
      due: m[3] || null,
    });
  }
  return out;
}

function parseLog(lines) {
  const out = [];
  for (const line of lines) {
    const m = line.match(LOG_ENTRY_RE);
    if (!m) continue;
    out.push({ date: m[1], note: m[2].trim() });
  }
  return out;
}

function parseLinkedFiles(lines) {
  const out = [];
  for (const line of lines) {
    const m = line.match(LINKED_FILE_RE);
    if (m) out.push({ label: m[1], path: m[2] });
  }
  return out;
}

// ─── serialise issue ─────────────────────────────────────────────────

export function serializeIssue(issue) {
  const lines = [];
  lines.push(`## ${issue.id} — ${issue.title}`);
  // Metadata
  const f = issue.fields || {};
  if (f.agent != null) lines.push(`- agent: ${f.agent}`);
  if (f.due != null) lines.push(`- due: ${f.due}`);
  if (f.priority != null) lines.push(`- priority: ${f.priority}`);
  lines.push(`- recurring: ${f.recurring ? 'true' : 'false'}`);
  if (f.recurring && f.recurring_schedule) {
    const rs = f.recurring_schedule;
    const parts = Object.entries(rs).map(([k, v]) => `${k}: ${typeof v === 'string' ? `"${v}"` : v}`);
    lines.push(`- recurring_schedule: { ${parts.join(', ')} }`);
  }
  lines.push(`- status: ${f.status || 'open'}`);
  if (f.sessions && f.sessions.length) lines.push(`- sessions: [${f.sessions.join(', ')}]`);
  else lines.push(`- sessions: []`);
  if (f.related_issues && f.related_issues.length) lines.push(`- related_issues: [${f.related_issues.join(', ')}]`);
  if (f.template_id) lines.push(`- template_id: ${f.template_id}`);
  if (f.instance_date) lines.push(`- instance_date: ${f.instance_date}`);
  if (f.parent_issue_id) lines.push(`- parent_issue_id: ${f.parent_issue_id}`);
  lines.push('');
  // Description
  if (issue.description) {
    lines.push(issue.description);
    lines.push('');
  }
  // Subtasks
  if (issue.subtasks && issue.subtasks.length) {
    lines.push('### Sub-tasks');
    for (const s of issue.subtasks) {
      const due = s.due ? ` — _due ${s.due}_` : '';
      lines.push(`- [${s.done ? 'x' : ' '}] ${s.text}${due}`);
    }
    lines.push('');
  }
  // Default itinerary
  if (issue.default_itinerary && issue.default_itinerary.length) {
    lines.push('### Default itinerary');
    for (const s of issue.default_itinerary) {
      lines.push(`- [${s.done ? 'x' : ' '}] ${s.text}`);
    }
    lines.push('');
  }
  // Log
  if (issue.log && issue.log.length) {
    lines.push('### Log');
    for (const l of issue.log) {
      lines.push(`- ${l.date}: ${l.note}`);
    }
    lines.push('');
  }
  // Linked files
  if (issue.linked_files && issue.linked_files.length) {
    lines.push('### Linked files');
    for (const lf of issue.linked_files) {
      lines.push(`- See: [${lf.label}](${lf.path})`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function serializeIssues({ title, issues }) {
  const lines = [];
  if (title) {
    lines.push(`# ${title}`);
    lines.push('');
  }
  for (const issue of issues) {
    lines.push(serializeIssue(issue));
  }
  return lines.join('\n');
}

// ─── date helpers (re-exported for tools) ────────────────────────────

export function parseISODate(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
}
export function fmtISO(d) {
  if (!d) return '';
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
export function startOfDay(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0); return x;
}
export function diffDays(a, b) {
  return Math.round((startOfDay(a) - startOfDay(b)) / 86400000);
}
export function dayName(d) {
  return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
}
