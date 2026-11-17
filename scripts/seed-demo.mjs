#!/usr/bin/env node
// seed-demo.mjs — fill a data folder with a small, fictional workspace so you
// can see what todouz looks like before you add your own life to it.
//
//   TODOUZ_DATA_DIR=./demo-data node scripts/seed-demo.mjs
//   TODOUZ_DATA_DIR=./demo-data npm start
//
// Everything here is made up ("Sam", a developer with a side project, a course,
// a training plan and a flat). Dates are relative to today, so the dashboard
// always looks lived-in. Refuses to run on a folder that already has epics.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

process.env.TODOUZ_ROUTINES = 'off';
process.env.TODOUZ_LINKER = 'off';

const { DATA_ROOT } = await import('../mcp-server/store.mjs');
const { handleCall } = await import('../mcp-server/tools.mjs');

const epicsDir = join(DATA_ROOT, 'epics');
if (existsSync(epicsDir) && readdirSync(epicsDir).length && !process.argv.includes('--force')) {
  console.log(`• ${epicsDir} already has data, leaving it alone (pass --force to add the demo anyway).`);
  process.exit(0);
}

const day = (offset) => {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const call = async (name, args) => {
  const r = await handleCall(name, args);
  if (r && r.error) throw new Error(`${name}: ${r.error}`);
  return r;
};
const idOf = (r) => r?.id || r?.issue?.id || r?.created?.id;

// ─── profile ─────────────────────────────────────────────────────────
{
  const { writeFile, mkdir } = await import('node:fs/promises');
  await mkdir(join(DATA_ROOT, 'personal'), { recursive: true });
  await writeFile(join(DATA_ROOT, 'personal/profile.md'), `# Profile

Sam is a full-stack developer in London who builds a habit-tracking app called Streaks in the evenings and is working through an online machine-learning course, one module a week.

## How Sam works
- Deep work before noon; meetings, email and admin after lunch.
- Small next steps beat big plans. If a task has no next step, suggest one.
- The gym goes on the calendar like any other meeting.
- Prefers short, direct answers with the decision first.
`);
  await writeFile(join(DATA_ROOT, 'personal/roadmap.md'), `# Roadmap

Three goals for the next three months.

1. Ship the Streaks beta to 20 testers, then decide whether to charge for it.
2. Finish the ML course and build one small model for Streaks (predicting missed days).
3. Run a 10k in spring without the knee flaring up.
`);
}

// ─── folders (epics) ─────────────────────────────────────────────────
const epics = [
  { category: 'projects', slug: 'streaks', title: 'Streaks — habit tracker app', color: '#6b21a8',
    body: 'Side project. React Native app + small Node API. Goal: TestFlight beta with 20 friends by the end of the month.' },
  { category: 'work', slug: 'platform', title: 'Platform team', color: '#1e3a8a',
    body: 'Day job. Payments API migration this quarter.' },
  { category: 'learning', slug: 'ml-course', title: 'Machine learning course', color: '#0e7490',
    body: 'Eight modules, one per week. Notebooks live in ~/code/ml-course.' },
  { category: 'health', slug: 'training', title: 'Training plan', color: '#15803d',
    body: 'Three strength sessions a week plus one long run.' },
  { category: 'home', slug: 'flat', title: 'Flat & admin', color: '#a16207',
    body: 'Bills, repairs and the shopping list.' },
  { category: 'personal', slug: 'inbox', title: 'Inbox', color: '#475569',
    body: 'Anything that has not found a home yet.' },
];
for (const e of epics) {
  await call('create_epic', { category: e.category, slug: e.slug, title: e.title, body: e.body });
  await call('update_epic', { slug: `${e.category}/${e.slug}`, patch: { color: e.color } }).catch(() => {});
}

// ─── items ───────────────────────────────────────────────────────────
const items = [
  ['projects/streaks', 'Ship TestFlight beta', 4, 'high', ['Fix onboarding crash on Android', 'Write release notes', 'Invite first 20 testers']],
  ['projects/streaks', 'Design streak-freeze feature', 9, 'medium', ['Sketch the paywall-free flow', 'Decide: one freeze per week?']],
  ['projects/streaks', 'Set up crash reporting', -2, 'high', []],
  ['projects/streaks', 'Landing page copy', 12, 'low', []],
  ['work/platform', 'Payments API migration: cut over staging', 2, 'high', ['Run shadow traffic for 24h', 'Compare error rates', 'Sign-off from on-call']],
  ['work/platform', 'Write RFC for idempotency keys', 6, 'medium', []],
  ['work/platform', 'Quarterly review self-assessment', 15, 'medium', []],
  ['learning/ml-course', 'Module 4: gradient boosting notebook', 1, 'high', ['Watch lectures', 'Finish exercises 1–5', 'Submit quiz']],
  ['learning/ml-course', 'Module 5: neural networks intro', 8, 'medium', []],
  ['health/training', 'Book physio for knee', -1, 'medium', []],
  ['health/training', 'Sign up for the 10k in spring', 20, 'low', []],
  ['home/flat', 'Renew contents insurance', 3, 'high', []],
  ['home/flat', 'Shopping list', null, 'low', ['Oats', 'Coffee beans', 'Spinach', 'Eggs', 'Dish soap', 'Bin bags']],
  ['home/flat', 'Fix the bathroom extractor fan', 10, 'low', []],
  ['personal/inbox', 'Plan a weekend away', null, 'low', []],
  ['personal/inbox', 'Reply to Jo about the climbing trip', 0, 'medium', []],
];
const made = {};
for (const [epic, title, due, priority, subtasks] of items) {
  const r = await call('create_issue', {
    epic, title, priority,
    ...(due !== null ? { due: day(due) } : {}),
    ...(subtasks.length ? { subtasks } : {}),
  });
  made[title] = { epic, id: idOf(r) };
}
// a couple of ticked checklist items so progress bars show
for (const [title, ticks] of [['Ship TestFlight beta', ['Fix onboarding crash on Android']], ['Module 4: gradient boosting notebook', ['Watch lectures']], ['Payments API migration: cut over staging', ['Run shadow traffic for 24h']], ['Shopping list', ['Oats', 'Coffee beans']]]) {
  const m = made[title]; if (!m?.id) continue;
  for (const text of ticks) await call('toggle_subtask', { id: m.id, epic: m.epic, subtask_text: text, done: true }).catch(e => console.warn('  skip tick', text, e.message));
}
// pin the shopping list to the top of Overview
if (made['Shopping list']?.id) await call('update_issue', { id: made['Shopping list'].id, epic: 'home/flat', patch: { pinned: true } }).catch(() => {});
// one thing already done this week
if (made['Set up crash reporting']?.id) await call('complete_issue', { id: made['Set up crash reporting'].id, epic: 'projects/streaks', summary: 'Sentry wired into the app and the API.' }).catch(() => {});

// ─── sessions (timeblocks) ───────────────────────────────────────────
const link = (title) => made[title]?.id ? { issue_id: made[title].id, epic_slug: made[title].epic } : {};
const blocks = [
  [0, '07:30', '08:30', 'Strength — upper body', null, 'health/training'],
  [0, '09:00', '11:30', 'Staging cut-over prep', 'Payments API migration: cut over staging'],
  [0, '19:00', '20:30', 'Onboarding crash fix', 'Ship TestFlight beta'],
  [1, '08:00', '09:30', 'ML module 4 exercises', 'Module 4: gradient boosting notebook'],
  [1, '14:00', '15:00', 'Idempotency RFC outline', 'Write RFC for idempotency keys'],
  [2, '07:30', '08:30', 'Strength — lower body', null, 'health/training'],
  [2, '10:00', '12:00', 'Shadow traffic review', 'Payments API migration: cut over staging'],
  [3, '19:00', '21:00', 'Release notes + tester invites', 'Ship TestFlight beta'],
  [4, '08:00', '09:00', 'Insurance quotes', 'Renew contents insurance'],
  [5, '09:00', '10:30', 'Long run', null, 'health/training'],
  [5, '14:00', '16:00', 'Streak-freeze sketches', 'Design streak-freeze feature'],
  [-1, '19:00', '20:00', 'Landing page first draft', 'Landing page copy'],
  [-2, '08:00', '09:30', 'ML module 3 recap', null, 'learning/ml-course'],
];
for (const [off, start, end, title, item, epicOnly] of blocks) {
  await call('add_timeblock', { date: day(off), start, end, title, ...(item ? link(item) : {}), ...(epicOnly ? { epic_slug: epicOnly } : {}) }).catch(e => console.warn('  skip block', title, e.message));
}

// ─── calendar events ─────────────────────────────────────────────────
await call('add_event', { title: 'Team offsite', date: day(6), time: '10:00', duration_min: 360, category: 'work' });
await call('add_event', { title: "Jo's birthday dinner", date: day(4), time: '19:30', duration_min: 150, category: 'personal' });

// ─── starter skills (agent playbooks) ────────────────────────────────
{
  const { cp, mkdir } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const src = join(fileURLToPath(new URL('..', import.meta.url)), 'examples', 'skills');
  await mkdir(join(DATA_ROOT, 'skills'), { recursive: true });
  await cp(src, join(DATA_ROOT, 'skills'), { recursive: true, force: false, errorOnExist: false });
}

// ─── Projects board: show these categories as columns ───────────────
{
  const { writeFile, mkdir } = await import('node:fs/promises');
  await mkdir(join(DATA_ROOT, 'state'), { recursive: true });
  await writeFile(join(DATA_ROOT, 'state/projects.json'), JSON.stringify({
    projects: { in_projects: true }, work: { in_projects: true }, learning: { in_projects: true }, home: { in_projects: true },
  }, null, 2) + '\n');
}

// ─── second brain ────────────────────────────────────────────────────
const notes = [
  { slug: 'streaks-positioning', title: 'Streaks is for people who hate streaks', type: 'decision', status: 'growing', tags: ['streaks', 'product'],
    body: 'Most habit apps punish a missed day. Streaks forgives one miss a week by default. That is the whole pitch; every feature should support it.' },
  { slug: 'idempotency-keys', title: 'Idempotency keys belong at the edge', type: 'learning', status: 'evergreen', tags: ['work', 'payments'],
    body: 'Store the key with the response for 24h at the API gateway, not in each service. Retries become free and services stay simple.' },
  { slug: 'gradient-boosting', title: 'Gradient boosting in one sentence', type: 'concept', status: 'seed', tags: ['ml'],
    body: 'Fit a small tree to the mistakes of the trees before it, then add it in with a small learning rate. Repeat.' },
  { slug: 'morning-deep-work', title: 'Mornings are for deep work', type: 'preference', status: 'evergreen', tags: ['how-i-work'],
    body: 'Anything that needs thinking goes before 12:00. Meetings, email and admin after lunch.' },
];
for (const n of notes) await call('brain_write', { ...n, source: 'demo' }).catch(e => console.warn('  skip note', n.slug, e.message));

// ─── feed ────────────────────────────────────────────────────────────
const posts = [
  { kind: 'brief', title: 'Today: staging cut-over, then the Android crash', hook: 'Two things matter today.',
    body: 'Morning: staging cut-over prep for the payments migration (due in 2 days). Evening: the onboarding crash is the last blocker for the TestFlight beta. The physio booking is a two-minute call, do it at lunch. Everything else can wait.', tags: ['focus'],
    visual: { type: 'steps', title: 'Your day in three moves', items: ['09:00  Staging cut-over prep (payments migration)', '12:30  Call the physio, two minutes', '19:00  Fix the onboarding crash, then invite testers'] } },
  { kind: 'insight', title: 'Your streak-freeze idea and the idempotency RFC are the same idea', hook: 'Forgive one retry.',
    body: 'Both make a repeat harmless: a missed day that does not reset a streak, a retried payment that does not charge twice. Opening the RFC with that framing might make it easier to explain to the team.', tags: ['streaks', 'work'], notes: ['streaks-positioning', 'idempotency-keys'],
    visual: { type: 'compare', left: { value: '1 miss', label: 'a streak survives a missed day' }, right: { value: '1 retry', label: 'a payment survives a retry' }, caption: 'Same principle, two projects' } },
  { kind: 'resurface', title: 'You decided mornings are for deep work', hook: 'Tomorrow has a 08:00 ML block and a 14:00 RFC block.',
    body: 'That matches your rule. Thursday does not: the shadow-traffic review sits at 10:00 but the long run is at 07:30. Worth swapping if you can.', tags: ['how-i-work'], notes: ['morning-deep-work'],
    visual: { type: 'bars', title: 'Deep-work hours booked before noon', unit: 'h', data: [{ label: 'Mon', value: 2.5 }, { label: 'Tue', value: 1.5 }, { label: 'Wed', value: 2 }, { label: 'Thu', value: 0.5 }, { label: 'Fri', value: 1 }] } },
  { kind: 'question', title: 'What would make 20 beta testers open the app twice?', hook: 'Worth answering before Friday.',
    body: 'One idea from your notes: a day-2 nudge that shows the streak-freeze, the feature that makes Streaks different.', tags: ['streaks'],
    visual: { type: 'stat', value: '20', label: 'testers invited this week', sub: 'Goal: 12 of them still using it on day 7' } },
  { kind: 'note', title: 'Weekend idea: the coastal path from your saved list', hook: 'Saturday looks free after 16:00.',
    body: 'You asked the feed for one weekend outdoor idea a week. The 8 km loop you saved last month fits Saturday afternoon, and Sunday is a long-run day so keep it easy.', tags: ['weekend'],
    visual: { type: 'quote', text: 'One weekend outdoor idea a week.', by: 'what you asked this feed for' } },
];
for (const p of posts) await call('feed_post', { ...p, source: 'demo' }).catch(e => console.warn('  skip post', p.title, e.message));

for (const text of ['One weekend outdoor idea a week', 'Short summaries of new ML papers that matter for small apps']) await call('feed_prefs', { action: 'add', list: 'more', text }).catch(() => {});
await call('feed_prefs', { action: 'add', list: 'less', text: 'Crypto and price speculation' }).catch(() => {});

console.log(`✓ demo workspace written to ${DATA_ROOT}`);
console.log('  start it with:  TODOUZ_DATA_DIR=' + DATA_ROOT + ' npm start');
process.exit(0);
