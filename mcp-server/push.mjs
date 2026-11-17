// push.mjs — Web Push notifications + the reminder scheduler.
//
// VAPID keys are auto-generated on first boot and persisted under data/state/,
// so there is NO manual key config. Subscriptions and an "already sent" ledger
// also live under data/state/. The scheduler ticks every ~30s, asks an injected
// collector for due reminders, pushes each to every subscription, and dedups via
// the ledger so a reminder fires exactly once.

import webpush from 'web-push';
import { readJSON, writeJSON } from './store.mjs';
import { readVisibility, rowVisible, LEGACY_OWNER } from './access.mjs';

const VAPID_PATH = 'state/vapid.json';
const SUBS_PATH = 'state/push-subscriptions.json';
const SENT_PATH = 'state/reminders-sent.json';
const CONTACT = process.env.TODOUZ_PUSH_CONTACT || 'mailto:admin@example.com';

let _vapidPublic = null;

export async function initPush() {
  let v = await readJSON(VAPID_PATH, null);
  if (!v || !v.publicKey || !v.privateKey) {
    v = webpush.generateVAPIDKeys();
    await writeJSON(VAPID_PATH, v);
    console.log('[push] generated a new VAPID keypair');
  }
  webpush.setVapidDetails(CONTACT, v.publicKey, v.privateKey);
  _vapidPublic = v.publicKey;
  return v.publicKey;
}
export function vapidPublicKey() { return _vapidPublic; }

async function readSubs() { return (await readJSON(SUBS_PATH, { subs: [] })).subs || []; }
async function writeSubs(subs) { await writeJSON(SUBS_PATH, { subs }); }

export async function addSubscription(subscription, user) {
  if (!subscription || !subscription.endpoint) return { error: 'invalid subscription' };
  const subs = await readSubs();
  const kept = subs.filter(s => s.subscription.endpoint !== subscription.endpoint);
  kept.push({ subscription, user: user || null, created: new Date().toISOString() });
  await writeSubs(kept);
  return { ok: true, count: kept.length };
}
export async function removeSubscription(endpoint) {
  const subs = await readSubs();
  const kept = subs.filter(s => s.subscription.endpoint !== endpoint);
  await writeSubs(kept);
  return { ok: true, count: kept.length };
}
export async function subscriptionCount() { return (await readSubs()).length; }

// Send one payload to every subscription; prune dead ones (404/410 = gone).
// `only(user)` narrows delivery to the users who may see it (a subscription
// saved before multi-user support belongs to the legacy owner).
export async function sendToAll(payload, { only } = {}) {
  const all = await readSubs();
  const subs = only ? all.filter(s => only(s.user || LEGACY_OWNER)) : all;
  if (!subs.length) return { sent: 0, subs: 0 };
  const body = JSON.stringify(payload);
  const dead = [];
  let sent = 0;
  await Promise.all(subs.map(async s => {
    try { await webpush.sendNotification(s.subscription, body); sent++; }
    catch (e) { const c = e && e.statusCode; if (c === 404 || c === 410) dead.push(s.subscription.endpoint); }
  }));
  if (dead.length) await writeSubs(all.filter(s => !dead.includes(s.subscription.endpoint)));
  return { sent, subs: subs.length, pruned: dead.length };
}

// The reminder scheduler. `collect()` returns [{ key, title, body, url, fireAt(ms) }].
// A reminder fires when its fireAt has just passed (within `lookbackMs`, so a
// brief server outage still delivers) and hasn't been sent before.
let _timer = null;
export function startReminderScheduler(collect, { intervalMs = 30000, lookbackMs = 6 * 3600 * 1000 } = {}) {
  if (_timer) clearInterval(_timer);
  const tick = async () => {
    try {
      const now = Date.now();
      const reminders = (await collect()) || [];
      if (!reminders.length) return;
      const sent = await readJSON(SENT_PATH, {});
      const vis = await readVisibility();
      let changed = false;
      for (const r of reminders) {
        if (!r || !r.key || r.fireAt == null) continue;
        if (r.fireAt <= now && r.fireAt > now - lookbackMs && !sent[r.key]) {
          // A reminder goes only to the people who can see the session/item behind it.
          await sendToAll({ title: r.title, body: r.body, url: r.url, tag: r.key },
            { only: (user) => rowVisible(r.row || {}, { user, role: 'member' }, vis) });
          sent[r.key] = now;   // consume it whether or not anyone is subscribed yet
          changed = true;
        }
      }
      const cutoff = now - 7 * 86400000;   // forget ledger entries after a week
      for (const k of Object.keys(sent)) { if (sent[k] < cutoff) { delete sent[k]; changed = true; } }
      if (changed) await writeJSON(SENT_PATH, sent);
    } catch (e) { console.error('[push] scheduler tick error:', e?.message || e); }
  };
  _timer = setInterval(tick, intervalMs);
  tick();
  return () => { if (_timer) clearInterval(_timer); _timer = null; };
}
