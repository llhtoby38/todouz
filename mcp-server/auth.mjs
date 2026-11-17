// auth.mjs — accounts, passwords, sessions and personal API keys.
//
// Users live in data/state/users.json:
//   { users: [{ username, role: 'admin'|'member', pw, disabled, session_version,
//               created, keys: [{ id, name, hash, prefix, created, last_used }] }] }
// Passwords are scrypt hashes ("scrypt$<salt>$<hash>"); API keys are stored as
// sha256 and shown to the user exactly once.
//
// Bootstrap: TODOUZ_USERS="alex:pw1,sam:pw2" creates any listed user that is not
// in the store yet (admins: TODOUZ_ADMINS, else the install owner, else the first
// user). After that the store wins, so a password changed in the app stays changed.
//
// Sessions are stateless HMAC cookies that embed the user's session_version, so
// changing a password or "sign out everywhere" revokes every older cookie.

import { createHmac, createHash, randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { readJSON, writeJSON } from './store.mjs';

const scrypt = promisify(_scrypt);
const USERS_REL = 'state/users.json';
const SESSION_TTL_MS = 30 * 86400000;
export const AUTH_SECRET = process.env.TODOUZ_SECRET || randomBytes(32).toString('hex');
export const USERNAME_RE = /^[a-z][a-z0-9_-]{1,31}$/;
export const MIN_PASSWORD = 10;

// ─── store ───────────────────────────────────────────────────────────
let _cache = null;
async function load() {
  if (_cache) return _cache;
  const d = await readJSON(USERS_REL, { users: [] });
  _cache = { users: Array.isArray(d?.users) ? d.users : [] };
  return _cache;
}
async function save(d) { _cache = d; await writeJSON(USERS_REL, d); }
const find = (d, username) => d.users.find(u => u.username === String(username || '').toLowerCase());
export const publicUser = (u) => u && ({
  username: u.username, role: u.role, disabled: !!u.disabled, created: u.created,
  keys: (u.keys || []).map(k => ({ id: k.id, name: k.name, prefix: k.prefix, created: k.created, last_used: k.last_used || null })),
});

// Drop the in-memory copy (after an admin data import replaced users.json).
export function reloadUsers() { _cache = null; }
export async function hasUsers() { return (await load()).users.length > 0; }
export async function getUser(username) { return find(await load(), username) || null; }
export async function listUsers() { return (await load()).users.map(publicUser); }

// ─── passwords ───────────────────────────────────────────────────────
export async function hashPassword(pw) {
  const salt = randomBytes(16).toString('hex');
  const hash = (await scrypt(String(pw), salt, 64)).toString('hex');
  return `scrypt$${salt}$${hash}`;
}
async function checkPassword(pw, stored) {
  const [alg, salt, hash] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const got = await scrypt(String(pw), salt, 64);
  const want = Buffer.from(hash, 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
}
export function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD) return `password must be at least ${MIN_PASSWORD} characters`;
  if (pw.length > 200) return 'password is too long';
  return null;
}

// ─── bootstrap from env ──────────────────────────────────────────────
export async function bootstrapUsers() {
  const pairs = (process.env.TODOUZ_USERS || '').split(',').map(s => s.trim()).filter(Boolean)
    .map(p => { const i = p.indexOf(':'); return i > 0 ? { user: p.slice(0, i).toLowerCase(), pass: p.slice(i + 1) } : null; })
    .filter(Boolean);
  // Default admin: the install owner (TODOUZ_LEGACY_OWNER, "owner") if listed, else the first user.
  const owner = (process.env.TODOUZ_LEGACY_OWNER || 'owner').toLowerCase();
  const defaultAdmin = pairs.some(p => p.user === owner) ? owner : pairs[0]?.user;
  const admins = new Set((process.env.TODOUZ_ADMINS || defaultAdmin || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
  const d = await load();
  let added = 0;
  for (const { user, pass } of pairs) {
    if (!USERNAME_RE.test(user) || find(d, user)) continue;
    d.users.push({ username: user, role: admins.has(user) ? 'admin' : 'member', pw: await hashPassword(pass), disabled: false, session_version: 1, created: new Date().toISOString(), keys: [] });
    added++;
  }
  // Personal keys handed out via env (TODOUZ_USER_KEYS="sam:<key>") for headless setup.
  for (const pair of (process.env.TODOUZ_USER_KEYS || '').split(',').map(s => s.trim()).filter(Boolean)) {
    const i = pair.indexOf(':');
    if (i <= 0) continue;
    const u = find(d, pair.slice(0, i));
    const key = pair.slice(i + 1);
    if (!u || key.length < 24) continue;
    const hash = sha256(key);
    if ((u.keys || []).some(k => k.hash === hash)) continue;
    (u.keys ||= []).push({ id: randomBytes(6).toString('hex'), name: 'from environment', hash, prefix: key.slice(0, 6), created: new Date().toISOString() });
    added++;
  }
  if (added) await save(d);
  return { users: d.users.length, added };
}

// ─── accounts ────────────────────────────────────────────────────────
export async function createUser({ username, password, role = 'member' }) {
  username = String(username || '').toLowerCase().trim();
  if (!USERNAME_RE.test(username)) return { error: 'username: 2–32 chars, lowercase letters, digits, - or _, starting with a letter' };
  const bad = passwordProblem(password);
  if (bad) return { error: bad };
  const d = await load();
  if (find(d, username)) return { error: 'that username is taken' };
  const u = { username, role: role === 'admin' ? 'admin' : 'member', pw: await hashPassword(password), disabled: false, session_version: 1, created: new Date().toISOString(), keys: [] };
  d.users.push(u);
  await save(d);
  return { ok: true, user: publicUser(u) };
}

export async function updateUser(username, { role, disabled, password } = {}) {
  const d = await load();
  const u = find(d, username);
  if (!u) return { error: 'user not found' };
  if (role !== undefined) {
    if (!['admin', 'member'].includes(role)) return { error: 'role must be admin or member' };
    if (u.role === 'admin' && role !== 'admin' && d.users.filter(x => x.role === 'admin' && !x.disabled).length <= 1) return { error: 'cannot remove the last admin' };
    u.role = role;
  }
  if (disabled !== undefined) {
    if (disabled && u.role === 'admin' && d.users.filter(x => x.role === 'admin' && !x.disabled).length <= 1) return { error: 'cannot disable the last admin' };
    u.disabled = !!disabled;
    u.session_version = (u.session_version || 1) + 1;
  }
  if (password !== undefined) {
    const bad = passwordProblem(password);
    if (bad) return { error: bad };
    u.pw = await hashPassword(password);
    u.session_version = (u.session_version || 1) + 1;
  }
  await save(d);
  return { ok: true, user: publicUser(u) };
}

export async function deleteUser(username) {
  const d = await load();
  const u = find(d, username);
  if (!u) return { error: 'user not found' };
  if (u.role === 'admin' && d.users.filter(x => x.role === 'admin').length <= 1) return { error: 'cannot delete the last admin' };
  d.users = d.users.filter(x => x !== u);
  await save(d);
  return { ok: true };
}

export async function changeOwnPassword(username, current, next) {
  const u = await getUser(username);
  if (!u || !(await checkPassword(current, u.pw))) return { error: 'current password is wrong' };
  return await updateUser(username, { password: next });
}

export async function signOutEverywhere(username) {
  const d = await load();
  const u = find(d, username);
  if (!u) return { error: 'user not found' };
  u.session_version = (u.session_version || 1) + 1;
  await save(d);
  return { ok: true };
}

// ─── login + rate limit ──────────────────────────────────────────────
// 8 failures per (ip, username) or 30 per ip inside 15 minutes locks it for the window.
const FAILS = new Map();
const WINDOW_MS = 15 * 60000;
function failKey(...p) { return p.join('|'); }
function tooMany(key, max) {
  const now = Date.now();
  const arr = (FAILS.get(key) || []).filter(t => now - t < WINDOW_MS);
  FAILS.set(key, arr);
  return arr.length >= max;
}
function noteFail(key) { const arr = FAILS.get(key) || []; arr.push(Date.now()); FAILS.set(key, arr); }

export async function login(username, password, ip = '') {
  username = String(username || '').toLowerCase().trim();
  const kUser = failKey(ip, username), kIp = failKey(ip), kName = failKey('*', username);
  if (tooMany(kUser, 8) || tooMany(kIp, 30) || tooMany(kName, 40)) return { error: 'too many attempts — try again in 15 minutes', status: 429 };
  const u = await getUser(username);
  // Hash even when the user doesn't exist, so timing doesn't reveal which usernames are real.
  const ok = u ? await checkPassword(password, u.pw) : (await hashPassword(password), false);
  if (!ok || u.disabled) { noteFail(kUser); noteFail(kIp); noteFail(kName); return { error: 'wrong username or password', status: 401 }; }
  FAILS.delete(kUser);
  return { ok: true, user: publicUser(u), token: signSession(u) };
}

// ─── sessions ────────────────────────────────────────────────────────
function signSession(u) {
  const payload = `${u.username}.${u.session_version || 1}.${Date.now() + SESSION_TTL_MS}`;
  return `${payload}.${createHmac('sha256', AUTH_SECRET).update(payload).digest('hex')}`;
}
export const SESSION_MAX_AGE_S = Math.floor(SESSION_TTL_MS / 1000);

// → { user, role } or null
export async function verifySession(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 4) return null;
  const [user, ver, expiry, sig] = parts;
  const expect = createHmac('sha256', AUTH_SECRET).update(`${user}.${ver}.${expiry}`).digest('hex');
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Number(expiry) < Date.now()) return null;
  const u = await getUser(user);
  if (!u || u.disabled || String(u.session_version || 1) !== ver) return null;
  return { user: u.username, role: u.role };
}

// ─── personal API keys ───────────────────────────────────────────────
const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');

export async function createKey(username, name) {
  const d = await load();
  const u = find(d, username);
  if (!u) return { error: 'user not found' };
  if ((u.keys || []).length >= 20) return { error: 'at most 20 keys per user' };
  const key = `tdz_${randomBytes(24).toString('hex')}`;
  const rec = { id: randomBytes(6).toString('hex'), name: String(name || 'AI session').slice(0, 60), hash: sha256(key), prefix: key.slice(0, 8), created: new Date().toISOString() };
  (u.keys ||= []).push(rec);
  await save(d);
  return { ok: true, key, id: rec.id, name: rec.name };
}

export async function revokeKey(username, id) {
  const d = await load();
  const u = find(d, username);
  if (!u) return { error: 'user not found' };
  const before = (u.keys || []).length;
  u.keys = (u.keys || []).filter(k => k.id !== id);
  if (u.keys.length === before) return { error: 'key not found' };
  await save(d);
  return { ok: true };
}

// → { user, role } or null. Touches last_used at most once a minute.
export async function verifyKey(key) {
  if (!key || !String(key).startsWith('tdz_') && String(key).length < 24) return null;
  const hash = sha256(key);
  const d = await load();
  for (const u of d.users) {
    const k = (u.keys || []).find(x => x.hash === hash);
    if (!k) continue;
    if (u.disabled) return null;
    const now = new Date();
    if (!k.last_used || now - new Date(k.last_used) > 60000) { k.last_used = now.toISOString(); save(d).catch(() => {}); }
    return { user: u.username, role: u.role };
  }
  return null;
}
