// Storage layer for accounts + scores.
// Production (Vercel): Postgres via @vercel/postgres when POSTGRES_URL is set.
// Local dev: a JSON file (.data/accounts.json) so `node server.mjs` runs with zero setup.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const PG_URL = process.env.POSTGRES_URL || process.env.DATABASE_URL || '';
const usePg = !!PG_URL;

// ---------- Postgres backend ----------
let _sql = null;
async function sql() {
  if (!_sql) ({ sql: _sql } = await import('@vercel/postgres'));
  return _sql;
}
let _schemaReady = false;
async function ensurePg() {
  if (_schemaReady) return;
  const q = await sql();
  await q`CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    username   TEXT UNIQUE NOT NULL,
    uname_lc   TEXT UNIQUE NOT NULL,
    pass       TEXT NOT NULL,
    created_at BIGINT NOT NULL
  )`;
  await q`CREATE TABLE IF NOT EXISTS scores (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id),
    score      INTEGER NOT NULL,
    wave       INTEGER NOT NULL,
    created_at BIGINT NOT NULL
  )`;
  await q`CREATE INDEX IF NOT EXISTS scores_user_idx ON scores(user_id)`;
  _schemaReady = true;
}

// ---------- JSON-file backend (local dev) ----------
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DATA_FILE = process.env.DATA_FILE || join(ROOT, '.data', 'accounts.json');
let _cache = null;
async function loadFile() {
  if (_cache) return _cache;
  try { _cache = JSON.parse(await readFile(DATA_FILE, 'utf8')); }
  catch { _cache = { users: [], scores: [] }; }
  _cache.users ||= []; _cache.scores ||= [];
  return _cache;
}
async function saveFile() {
  await mkdir(dirname(DATA_FILE), { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  await writeFile(tmp, JSON.stringify(_cache, null, 2));
  await rename(tmp, DATA_FILE); // atomic swap
}

// ---------- Public API (backend-agnostic) ----------
export async function getUserByName(username) {
  const lc = username.toLowerCase();
  if (usePg) {
    await ensurePg();
    const q = await sql();
    const { rows } = await q`SELECT id, username, pass FROM users WHERE uname_lc = ${lc} LIMIT 1`;
    return rows[0] || null;
  }
  const db = await loadFile();
  return db.users.find((u) => u.uname_lc === lc) || null;
}

export async function getUserById(id) {
  if (usePg) {
    await ensurePg();
    const q = await sql();
    const { rows } = await q`SELECT id, username FROM users WHERE id = ${id} LIMIT 1`;
    return rows[0] || null;
  }
  const db = await loadFile();
  const u = db.users.find((x) => x.id === id);
  return u ? { id: u.id, username: u.username } : null;
}

// Returns the created user, or null if the username is already taken.
export async function createUser(username, passHash) {
  const id = randomUUID();
  const lc = username.toLowerCase();
  const now = Date.now();
  if (usePg) {
    await ensurePg();
    const q = await sql();
    try {
      await q`INSERT INTO users (id, username, uname_lc, pass, created_at)
              VALUES (${id}, ${username}, ${lc}, ${passHash}, ${now})`;
    } catch (e) {
      if (String(e.message || e).includes('duplicate') || e.code === '23505') return null;
      throw e;
    }
    return { id, username };
  }
  const db = await loadFile();
  if (db.users.some((u) => u.uname_lc === lc)) return null;
  db.users.push({ id, username, uname_lc: lc, pass: passHash, created_at: now });
  await saveFile();
  return { id, username };
}

export async function addScore(userId, score, wave) {
  const id = randomUUID();
  const now = Date.now();
  if (usePg) {
    await ensurePg();
    const q = await sql();
    await q`INSERT INTO scores (id, user_id, score, wave, created_at)
            VALUES (${id}, ${userId}, ${score}, ${wave}, ${now})`;
    const { rows } = await q`SELECT MAX(score) AS best FROM scores WHERE user_id = ${userId}`;
    return { best: rows[0]?.best ?? score };
  }
  const db = await loadFile();
  db.scores.push({ id, user_id: userId, score, wave, created_at: now });
  await saveFile();
  const best = Math.max(...db.scores.filter((s) => s.user_id === userId).map((s) => s.score));
  return { best };
}

// Top N players by their single best run (one row per player).
export async function topScores(limit = 20) {
  if (usePg) {
    await ensurePg();
    const q = await sql();
    const { rows } = await q`
      SELECT username, score, wave FROM (
        SELECT DISTINCT ON (u.id) u.username, s.score, s.wave
        FROM scores s JOIN users u ON u.id = s.user_id
        ORDER BY u.id, s.score DESC, s.created_at ASC
      ) t ORDER BY score DESC, username ASC LIMIT ${limit}`;
    return rows.map((r) => ({ username: r.username, score: r.score, wave: r.wave }));
  }
  const db = await loadFile();
  const best = new Map();
  for (const s of db.scores) {
    const u = db.users.find((x) => x.id === s.user_id);
    if (!u) continue;
    const cur = best.get(u.id);
    if (!cur || s.score > cur.score) best.set(u.id, { username: u.username, score: s.score, wave: s.wave });
  }
  return [...best.values()].sort((a, b) => b.score - a.score || a.username.localeCompare(b.username)).slice(0, limit);
}

export const backend = usePg ? 'postgres' : 'file';
