// store.mjs — file IO. All paths absolute under DATA_ROOT (computed from this file's location).
//
// Atomic writes: write to <path>.tmp then rename to <path> so a crash never leaves a half-file.

import { readFile, writeFile, mkdir, rename, readdir, stat, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const SERVER_DIR = dirname(__filename);
export const TODOUZ_ROOT = resolve(SERVER_DIR, '..');
// TODOUZ_DATA_DIR points a local dev run at a scratch copy so testing never
// writes into the repo's tracked data/ snapshot.
export const DATA_ROOT = process.env.TODOUZ_DATA_DIR ? resolve(process.env.TODOUZ_DATA_DIR) : join(TODOUZ_ROOT, 'data');

// rel → absolute. rel is rooted at todouz/data unless it starts with "/" or already absolute.
export function abs(rel) {
  if (rel.startsWith('/')) return rel;
  return join(DATA_ROOT, rel);
}

export async function read(rel) {
  try { return await readFile(abs(rel), 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return ''; throw e; }
}

export async function write(rel, content) {
  const path = abs(rel);
  await mkdir(dirname(path), { recursive: true });
  const tmp = path + '.tmp';
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, path);
}

export async function exists(rel) {
  try { await stat(abs(rel)); return true; } catch { return false; }
}

export async function listDirs(rel) {
  try {
    const entries = await readdir(abs(rel), { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_'))
      .map(e => e.name)
      .sort();
  } catch { return []; }
}

export async function listFiles(rel) {
  try {
    const entries = await readdir(abs(rel), { withFileTypes: true });
    return entries
      .filter(e => e.isFile() && !e.name.startsWith('.'))
      .map(e => e.name)
      .sort();
  } catch { return []; }
}

export async function ensureDir(rel) {
  await mkdir(abs(rel), { recursive: true });
}

export async function readJSON(rel, fallback = null) {
  const txt = await read(rel);
  if (!txt) return fallback;
  try { return JSON.parse(txt); } catch { return fallback; }
}

export async function writeJSON(rel, obj) {
  await write(rel, JSON.stringify(obj, null, 2) + '\n');
}

export async function removeFile(rel) {
  try { await unlink(abs(rel)); return true; } catch { return false; }
}
