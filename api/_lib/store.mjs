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
  await q`CREATE TABLE IF NOT EXISTS events (
    id        TEXT PRIMARY KEY,
    ts        BIGINT NOT NULL,
    type      TEXT NOT NULL,
    session   TEXT,
    username  TEXT,
    is_bot    BOOLEAN DEFAULT FALSE,
    ua        TEXT,
    ref       TEXT,
    country   TEXT,
    device    TEXT,
    score     INTEGER,
    wave      INTEGER
  )`;
  await q`CREATE INDEX IF NOT EXISTS events_ts_idx ON events(ts)`;
  await q`CREATE INDEX IF NOT EXISTS events_type_idx ON events(type)`;
  _schemaReady = true;
}

// ---------- JSON-file backend (local dev) ----------
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DATA_FILE = process.env.DATA_FILE || join(ROOT, '.data', 'accounts.json');
let _cache = null;
async function loadFile() {
  if (_cache) return _cache;
  try { _cache = JSON.parse(await readFile(DATA_FILE, 'utf8')); }
  catch { _cache = { users: [], scores: [], events: [] }; }
  _cache.users ||= []; _cache.scores ||= []; _cache.events ||= [];
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

// ---------- analytics events ----------
export async function addEvent(e) {
  const id = randomUUID();
  if (usePg) {
    await ensurePg();
    const q = await sql();
    await q`INSERT INTO events (id, ts, type, session, username, is_bot, ua, ref, country, device, score, wave)
            VALUES (${id}, ${e.ts}, ${e.type}, ${e.session}, ${e.username}, ${e.is_bot}, ${e.ua}, ${e.ref}, ${e.country}, ${e.device}, ${e.score}, ${e.wave})`;
    return;
  }
  const db = await loadFile();
  db.events.push({ id, ...e });
  if (db.events.length > 20000) db.events.splice(0, db.events.length - 20000); // cap the dev file
  await saveFile();
}

// Aggregate analytics for the dashboard. Humans and bots are separated; the funnel is
// computed per session (one browser session = one "visitor").
export async function queryStats(days = 14) {
  const since = Date.now() - days * 86400000;
  if (usePg) { await ensurePg(); return pgStats(await sql(), since, days); }
  return fileStats(await loadFile(), since, days);
}

async function pgStats(q, since) {
  const rows = async (query) => (await query).rows;
  const [funnel] = await rows(q`
    SELECT count(*) FILTER (WHERE human)::int human_sessions,
           count(*) FILTER (WHERE NOT human)::int bot_sessions,
           count(*) FILTER (WHERE human AND played)::int played,
           count(*) FILTER (WHERE human AND finished)::int finished,
           count(*) FILTER (WHERE human AND signed)::int signed
    FROM (SELECT session, bool_or(NOT is_bot) human, bool_or(type='play_start') played,
                 bool_or(type='game_over') finished, bool_or(type='signup') signed
          FROM events WHERE ts>=${since} AND session IS NOT NULL GROUP BY session) s`);
  const [pv] = await rows(q`SELECT count(*) FILTER (WHERE NOT is_bot)::int human, count(*) FILTER (WHERE is_bot)::int bot
                            FROM events WHERE type='page_view' AND ts>=${since}`);
  const [games] = await rows(q`SELECT count(*)::int n, round(avg(score))::int avg_score, max(score)::int max_score, round(avg(wave),1) avg_wave
                               FROM events WHERE type='game_over' AND NOT is_bot AND ts>=${since}`);
  const refs = await rows(q`SELECT coalesce(nullif(ref,''),'(direct)') ref, count(DISTINCT session)::int n
                            FROM events WHERE type='page_view' AND NOT is_bot AND ts>=${since} GROUP BY 1 ORDER BY n DESC LIMIT 8`);
  const countries = await rows(q`SELECT coalesce(nullif(country,''),'??') country, count(DISTINCT session)::int n
                                 FROM events WHERE type='page_view' AND NOT is_bot AND ts>=${since} GROUP BY 1 ORDER BY n DESC LIMIT 8`);
  const devices = await rows(q`SELECT coalesce(device,'?') device, count(DISTINCT session)::int n
                               FROM events WHERE type='page_view' AND NOT is_bot AND ts>=${since} GROUP BY 1 ORDER BY n DESC`);
  const topBots = await rows(q`SELECT ua, count(DISTINCT session)::int n FROM events
                               WHERE is_bot AND type='page_view' AND ts>=${since} GROUP BY ua ORDER BY n DESC LIMIT 8`);
  const daily = await rows(q`SELECT (ts/86400000)::int AS "day", count(*) FILTER (WHERE NOT is_bot)::int human, count(*) FILTER (WHERE is_bot)::int bot
                             FROM events WHERE type='page_view' AND ts>=${since} GROUP BY 1 ORDER BY 1`);
  const recent = await rows(q`SELECT ts, type, is_bot, country, device, score, wave FROM events ORDER BY ts DESC LIMIT 25`);
  return shape(funnel, pv, games, refs, countries, devices, topBots, daily, recent);
}

function fileStats(db, since) {
  const ev = db.events.filter((e) => e.ts >= since);
  const bySession = new Map();
  for (const e of ev) {
    if (!e.session) continue;
    const s = bySession.get(e.session) || { human: false, played: false, finished: false, signed: false };
    if (!e.is_bot) s.human = true;
    if (e.type === 'play_start') s.played = true;
    if (e.type === 'game_over') s.finished = true;
    if (e.type === 'signup') s.signed = true;
    bySession.set(e.session, s);
  }
  const sess = [...bySession.values()];
  const funnel = {
    human_sessions: sess.filter((s) => s.human).length,
    bot_sessions: sess.filter((s) => !s.human).length,
    played: sess.filter((s) => s.human && s.played).length,
    finished: sess.filter((s) => s.human && s.finished).length,
    signed: sess.filter((s) => s.human && s.signed).length,
  };
  const pvs = ev.filter((e) => e.type === 'page_view');
  const pv = { human: pvs.filter((e) => !e.is_bot).length, bot: pvs.filter((e) => e.is_bot).length };
  const go = ev.filter((e) => e.type === 'game_over' && !e.is_bot);
  const games = { n: go.length, avg_score: go.length ? Math.round(go.reduce((a, e) => a + (e.score || 0), 0) / go.length) : 0, max_score: go.reduce((m, e) => Math.max(m, e.score || 0), 0), avg_wave: go.length ? (go.reduce((a, e) => a + (e.wave || 0), 0) / go.length).toFixed(1) : 0 };
  const distinctBy = (arr, key) => { const m = new Map(); for (const e of arr) { const k = e[key] || ''; const set = m.get(k) || new Set(); set.add(e.session); m.set(k, set); } return [...m].map(([k, set]) => ({ k, n: set.size })).sort((a, b) => b.n - a.n); };
  const humanPV = pvs.filter((e) => !e.is_bot);
  const refs = distinctBy(humanPV.map((e) => ({ ...e, ref: e.ref || '(direct)' })), 'ref').slice(0, 8).map((x) => ({ ref: x.k, n: x.n }));
  const countries = distinctBy(humanPV.map((e) => ({ ...e, country: e.country || '??' })), 'country').slice(0, 8).map((x) => ({ country: x.k, n: x.n }));
  const devices = distinctBy(humanPV.map((e) => ({ ...e, device: e.device || '?' })), 'device').map((x) => ({ device: x.k, n: x.n }));
  const topBots = distinctBy(pvs.filter((e) => e.is_bot), 'ua').slice(0, 8).map((x) => ({ ua: x.k, n: x.n }));
  const dayMap = new Map();
  for (const e of pvs) { const d = Math.floor(e.ts / 86400000); const o = dayMap.get(d) || { day: d, human: 0, bot: 0 }; o[e.is_bot ? 'bot' : 'human']++; dayMap.set(d, o); }
  const daily = [...dayMap.values()].sort((a, b) => a.day - b.day);
  const recent = [...ev].sort((a, b) => b.ts - a.ts).slice(0, 25).map((e) => ({ ts: e.ts, type: e.type, is_bot: e.is_bot, country: e.country, device: e.device, score: e.score, wave: e.wave }));
  return shape(funnel, pv, games, refs, countries, devices, topBots, daily, recent);
}

function shape(funnel, pv, games, refs, countries, devices, topBots, daily, recent) {
  return {
    generatedAt: Date.now(),
    pageviews: { human: pv.human || 0, bot: pv.bot || 0, total: (pv.human || 0) + (pv.bot || 0) },
    visitors: { human: funnel.human_sessions || 0, bot: funnel.bot_sessions || 0 },
    funnel: {
      visitors: funnel.human_sessions || 0,
      played: funnel.played || 0,
      finishedGame: funnel.finished || 0,
      signedUp: funnel.signed || 0,
      bounced: (funnel.human_sessions || 0) - (funnel.played || 0),
    },
    games: games || {},
    referrers: refs, countries, devices, topBots, daily, recent,
  };
}

export const backend = usePg ? 'postgres' : 'file';
