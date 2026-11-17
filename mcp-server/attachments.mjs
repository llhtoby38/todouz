// attachments.mjs — file storage for things linked to items (uploaded files +
// AI-generated notes). Bytes live under data/attachments/, one flat file per
// attachment plus a `<id>.json` metadata sidecar. Kept binary-safe and streamed
// so large lecture PDFs never buffer fully in memory.
//
// An attachment id is a UUID, so it is always safe to interpolate into a path —
// callers should still validate the shape before trusting request input.

import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, writeFile, readFile, unlink, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DATA_ROOT } from './store.mjs';
import { currentCtx } from './access.mjs';

const ATT_DIR = join(DATA_ROOT, 'attachments');
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isValidId(id) { return typeof id === 'string' && ID_RE.test(id); }

const binPath = (id) => join(ATT_DIR, id);
const metaPath = (id) => join(ATT_DIR, `${id}.json`);

async function writeMeta(id, meta) {
  await writeFile(metaPath(id), JSON.stringify(meta, null, 2));
  return meta;
}

// Stream a request/readable body straight to disk, then record metadata.
export async function saveAttachmentFromStream(src, { filename, mime, kind = 'file', format = null, owner = currentCtx()?.user || null } = {}) {
  await mkdir(ATT_DIR, { recursive: true });
  const id = randomUUID();
  await new Promise((resolve, reject) => {
    const ws = createWriteStream(binPath(id));
    src.on('error', reject);
    ws.on('error', reject);
    ws.on('finish', resolve);
    src.pipe(ws);
  });
  const { size } = await stat(binPath(id));
  return writeMeta(id, {
    id,
    filename: filename || id,
    mime: mime || 'application/octet-stream',
    size,
    kind,                 // 'file' | 'note'
    format,               // for notes: 'html' | 'markdown'
    created: new Date().toISOString(),
    ...(owner ? { owner } : {}),   // who may read/delete it (none = legacy owner)
  });
}

// Save an in-memory buffer/string (used by AI note creation).
export async function saveAttachmentBytes(bytes, { filename, mime, kind = 'file', format = null, owner = currentCtx()?.user || null } = {}) {
  await mkdir(ATT_DIR, { recursive: true });
  const id = randomUUID();
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes), 'utf8');
  await writeFile(binPath(id), buf);
  return writeMeta(id, {
    id,
    filename: filename || id,
    mime: mime || 'application/octet-stream',
    size: buf.length,
    kind,
    format,
    created: new Date().toISOString(),
    ...(owner ? { owner } : {}),
  });
}

export async function getAttachmentMeta(id) {
  if (!isValidId(id)) return null;
  try { return JSON.parse(await readFile(metaPath(id), 'utf8')); }
  catch { return null; }
}

// Read the raw bytes (used to edit/re-render a note in-app).
export async function getAttachmentText(id) {
  if (!isValidId(id)) return null;
  try { return await readFile(binPath(id), 'utf8'); }
  catch { return null; }
}

export function attachmentStream(id) { return createReadStream(binPath(id)); }

export async function deleteAttachment(id) {
  if (!isValidId(id)) return false;
  let ok = false;
  try { await unlink(binPath(id)); ok = true; } catch {}
  try { await unlink(metaPath(id)); } catch {}
  return ok;
}
