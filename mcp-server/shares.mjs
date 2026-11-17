// shares.mjs — "share to todouz": posts the user shares from other apps (a reel, a
// video, a tweet, an article) land here, and the share-digest routine turns each
// one into something useful: verified tools filed against their projects, a
// learning note, or just a kept link, plus a feed card saying what it found.
//
// Saving is instant and needs no model call, so nothing shared is ever lost; the
// public preview (title, caption, author, image) is captured at share time
// because the agent's own web fetch is often blocked by social sites.
//
// Storage: one JSON file per share in data/shares/<id>.json.

import { randomBytes } from 'node:crypto';
import { read, write, exists, listFiles } from './store.mjs';
import { currentCtx, LEGACY_OWNER } from './access.mjs';

const DIR = 'shares';
export const SHARE_MODES = ['auto', 'tools', 'learn', 'save'];
export const SHARE_STATUSES = ['pending', 'done', 'failed'];
const nowISO = () => new Date().toISOString();
const clip = (s, n) => { s = String(s || '').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };
const arr = (v) => (Array.isArray(v) ? v : (v == null || v === '' ? [] : [v]));

function newId() {
  const d = new Date();
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  return `${ymd}-${randomBytes(4).toString('hex')}`;
}
const validId = (id) => /^\d{8}-[a-f0-9]{8}$/.test(String(id || ''));

async function readShare(id) {
  if (!validId(id) || !await exists(`${DIR}/${id}.json`)) return null;
  try {
    const s = JSON.parse(await read(`${DIR}/${id}.json`));
    s.owner = s.owner || LEGACY_OWNER;
    const ctx = currentCtx();
    return (ctx && s.owner !== ctx.user) ? null : s;
  } catch { return null; }
}
async function writeShare(s) { await write(`${DIR}/${s.id}.json`, JSON.stringify(s, null, 2) + '\n'); }

// Android's share sheet often puts the link inside the text ("Check this out
// https://…"), and some apps leave url empty, so look in both.
function findUrl(...fields) {
  for (const f of fields) {
    const m = /https?:\/\/[^\s<>"']+/i.exec(String(f || ''));
    if (m) return m[0].replace(/[).,!?]+$/, '');
  }
  return null;
}

export function platformOf(url) {
  let h = '';
  try { h = new URL(url).hostname.replace(/^www\.|^m\./, ''); } catch { return 'web'; }
  if (/(^|\.)instagram\.com$/.test(h)) return 'instagram';
  if (/(^|\.)(youtube\.com|youtu\.be)$/.test(h)) return 'youtube';
  if (/(^|\.)(facebook\.com|fb\.watch)$/.test(h)) return 'facebook';
  if (/(^|\.)threads\.(net|com)$/.test(h)) return 'threads';
  if (/(^|\.)(x\.com|twitter\.com)$/.test(h)) return 'x';
  if (/(^|\.)linkedin\.com$/.test(h)) return 'linkedin';
  if (/(^|\.)tiktok\.com$/.test(h)) return 'tiktok';
  if (/(^|\.)reddit\.com$/.test(h)) return 'reddit';
  if (/(^|\.)github\.com$/.test(h)) return 'github';
  return 'web';
}

const decode = (s) => String(s || '')
  .replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&');

// The post's public preview: YouTube via its keyless oEmbed, everything else via
// the page's og: tags (Instagram puts the caption in og:description). Best effort,
// short timeout; a failure just means the routine works from the link alone.
export async function fetchShareMeta(url) {
  const meta = {};
  const get = async (u, accept) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try { return await fetch(u, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; todouz-share/1.0; +https://github.com/llhtoby38/todouz)', Accept: accept, 'Accept-Language': 'en' } }); }
    finally { clearTimeout(timer); }
  };
  try {
    if (platformOf(url) === 'youtube') {
      const r = await get(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, 'application/json');
      if (r.ok) { const j = await r.json(); meta.title = j.title; meta.author = j.author_name; meta.image = j.thumbnail_url; }
    }
    const r = await get(url, 'text/html');
    if (r.ok && /html/i.test(r.headers.get('content-type') || '')) {
      const html = (await r.text()).slice(0, 600000);
      const tag = (names) => {
        for (const n of names) {
          const t = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${n}["'][^>]*>`, 'i'));
          const c = t && t[0].match(/content=["']([^"']*)["']/i);
          if (c && c[1].trim()) return decode(c[1]).trim();
        }
        return null;
      };
      meta.title = meta.title || tag(['og:title', 'twitter:title']) || decode((html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '').trim() || null;
      meta.description = tag(['og:description', 'twitter:description', 'description']);
      meta.image = meta.image || tag(['og:image', 'twitter:image']);
      meta.site = tag(['og:site_name']);
      meta.final_url = r.url && r.url !== url ? r.url : undefined;
    }
  } catch {}
  for (const k of Object.keys(meta)) if (!meta[k]) delete meta[k];
  if (meta.title) meta.title = clip(meta.title, 300);
  if (meta.description) meta.description = clip(meta.description, 3000);
  if (meta.image && !/^https:\/\//.test(meta.image)) delete meta.image;
  return meta;
}

// ─── operations ──────────────────────────────────────────────────────
export async function createShare({ url, title, text, note, mode, source } = {}) {
  const link = findUrl(url, text, title);
  const words = [title, text, note].map(x => String(x || '').trim()).filter(Boolean).join(' ');
  if (!link && !words) return { error: 'nothing to share: send a link or some text' };
  const share = {
    id: newId(),
    url: link,
    platform: link ? platformOf(link) : 'text',
    title: clip(title, 300) || null,
    text: clip(text, 4000) || null,
    note: clip(note, 2000) || null,
    mode: SHARE_MODES.includes(mode) ? mode : 'auto',
    status: 'pending',
    meta: link ? await fetchShareMeta(link) : {},
    created: nowISO(),
    source: String(source || 'dashboard').slice(0, 80),
    attempts: 0,
    result: null,
    owner: currentCtx()?.user || LEGACY_OWNER,
  };
  await writeShare(share);
  return { ok: true, share };
}

export async function listShares({ status = 'all', limit = 30 } = {}) {
  const files = (await listFiles(DIR)).filter(f => f.endsWith('.json'));
  const out = [];
  for (const f of files) {
    const s = await readShare(f.slice(0, -5));
    if (s && (status === 'all' || s.status === status)) out.push(s);
  }
  // Pending work is handled oldest first; everything else reads newest first.
  out.sort((a, b) => status === 'pending' ? a.created.localeCompare(b.created) : b.created.localeCompare(a.created));
  return out.slice(0, Math.max(1, Math.min(200, Number(limit) || 30)));
}

export async function pendingShareCount() { return (await listShares({ status: 'pending', limit: 200 })).length; }

async function resolveShare({ id, status = 'done', summary, post_id, notes } = {}) {
  const s = await readShare(id);
  if (!s) return { error: `share not found: ${id}` };
  if (!['done', 'failed'].includes(status)) return { error: 'status must be done or failed' };
  s.status = status;
  s.attempts = (s.attempts || 0) + 1;
  s.result = {
    summary: clip(summary, 1200) || null,
    post_id: post_id ? String(post_id).slice(0, 40) : null,
    notes: arr(notes).map(String).filter(Boolean).slice(0, 30),
    at: nowISO(),
  };
  await writeShare(s);
  return { ok: true, id: s.id, status: s.status };
}

// Send a share back to the queue, optionally with more context from the user
// (e.g. "it's the second tool they mention") or a different mode.
export async function retryShare({ id, note, mode } = {}) {
  const s = await readShare(id);
  if (!s) return { error: `share not found: ${id}` };
  if (note && String(note).trim()) s.note = clip([s.note, String(note).trim()].filter(Boolean).join('\n'), 2000);
  if (SHARE_MODES.includes(mode)) s.mode = mode;
  s.status = 'pending';
  await writeShare(s);
  return { ok: true, share: s };
}

// ─── tools (for the share-digest routine and any connected AI session) ──
export const SHARE_TOOLS = [
  {
    name: 'share_list',
    description: 'List posts the user shared into todouz from other apps (reels, videos, tweets, articles, links). status: pending (waiting to be processed, oldest first) | done | failed | all. Each share has url, platform, mode (auto | tools: find and verify the tools it recommends and file them against their projects | learn: distil it into a Brain learning | save: just keep it), their note, and meta: the public preview captured when shared (title, description = usually the caption, author, image).',
    inputSchema: { type: 'object', properties: { status: { type: 'string', enum: [...SHARE_STATUSES, 'all'] }, limit: { type: 'number' } }, additionalProperties: false },
  },
  {
    name: 'share_resolve',
    description: 'Mark a shared post as processed. status "done" once it has been filed (pass the feed post id and the Brain note slugs you wrote), or "failed" when the content could not be worked out at all (say why in summary, so the user can add a note and retry).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' }, status: { type: 'string', enum: ['done', 'failed'] }, summary: { type: 'string' },
        post_id: { type: 'string' }, notes: { type: 'array', items: { type: 'string' } },
      },
      required: ['id', 'status'], additionalProperties: false,
    },
  },
];

export async function handleShareCall(name, args = {}) {
  switch (name) {
    case 'share_list':    return { ok: true, shares: await listShares(args) };
    case 'share_resolve': return await resolveShare(args);
    default: return undefined;
  }
}
