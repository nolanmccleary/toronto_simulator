// Backend-agnostic handlers. Each takes { method, body, cookieHeader } and returns
// { status, json, setCookie? }. The local server and the Vercel functions both call these.
import { getUserByName, getUserById, createUser, addScore, topScores, addEvent, queryStats, backend } from './store.mjs';
import { hashPassword, verifyPassword, createSession, sessionCookie, clearCookie, sessionUserId } from './auth.mjs';
import { classifyUA, deviceOf } from './bots.mjs';

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const PASSWORD_MIN = 6;
const SCORE_MAX = 1_000_000;   // sanity cap (client-reported scores; see note below)
const WAVE_MAX = 10_000;

const ok = (json, setCookie) => ({ status: 200, json, setCookie });
const bad = (msg, status = 400) => ({ status, json: { error: msg } });

export async function handleSignup({ method, body }) {
  if (method !== 'POST') return bad('method not allowed', 405);
  const username = String(body?.username ?? '').trim();
  const password = String(body?.password ?? '');
  if (!USERNAME_RE.test(username)) return bad('Username must be 3–20 letters, numbers or underscores.');
  if (password.length < PASSWORD_MIN) return bad(`Password must be at least ${PASSWORD_MIN} characters.`);
  if (await getUserByName(username)) return bad('That username is taken.', 409);
  const user = await createUser(username, await hashPassword(password));
  if (!user) return bad('That username is taken.', 409);
  const token = createSession(user.id);
  return ok({ user: { username: user.username } }, token && sessionCookie(token));
}

export async function handleLogin({ method, body }) {
  if (method !== 'POST') return bad('method not allowed', 405);
  const username = String(body?.username ?? '').trim();
  const password = String(body?.password ?? '');
  const user = await getUserByName(username);
  // Same generic error whether the user exists or the password is wrong.
  if (!user || !(await verifyPassword(password, user.pass))) return bad('Incorrect username or password.', 401);
  const token = createSession(user.id);
  return ok({ user: { username: user.username } }, token && sessionCookie(token));
}

export async function handleLogout() {
  return ok({ ok: true }, clearCookie());
}

export async function handleMe({ cookieHeader }) {
  const uid = sessionUserId(cookieHeader);
  if (!uid) return ok({ user: null });
  const user = await getUserById(uid);
  return ok({ user: user ? { username: user.username } : null });
}

export async function handleScore({ method, body, cookieHeader }) {
  if (method !== 'POST') return bad('method not allowed', 405);
  const uid = sessionUserId(cookieHeader);
  if (!uid) return bad('Log in to save your score.', 401);
  const score = Number(body?.score);
  const wave = Number(body?.wave);
  if (!Number.isInteger(score) || score < 0 || score > SCORE_MAX) return bad('Invalid score.');
  if (!Number.isInteger(wave) || wave < 0 || wave > WAVE_MAX) return bad('Invalid wave.');
  const { best } = await addScore(uid, score, wave);
  return ok({ ok: true, best });
}

export async function handleLeaderboard() {
  const rows = await topScores(20);
  return ok({ leaderboard: rows });
}

// ---------- analytics ----------
const EVENT_TYPES = new Set(['page_view', 'play_start', 'game_over', 'mode', 'signup', 'login']);

// Reduce a referrer to just its host, so we never store full URLs with query strings.
function refHost(raw) {
  if (!raw) return '';
  try { return new URL(String(raw)).hostname.replace(/^www\./, '').slice(0, 120); }
  catch { return String(raw).slice(0, 120); }
}

// Record one analytics event. The client supplies the event type + a session id + a few
// gameplay fields; everything trust-sensitive (bot flag, UA, country, timestamp, who's
// logged in) is derived here on the server. Never errors the client — analytics must not
// break the game, so failures are swallowed and reported as ok.
export async function handleEvent({ method, body, cookieHeader, headers = {} }) {
  if (method !== 'POST') return bad('method not allowed', 405);
  const type = String(body?.type ?? '');
  if (!EVENT_TYPES.has(type)) return ok({ ok: false });   // ignore unknown types silently
  const ua = String(headers['user-agent'] || '').slice(0, 400);
  const uid = sessionUserId(cookieHeader);
  let username = null;
  if (uid) { const u = await getUserById(uid); username = u ? u.username : null; }
  const score = Number.isInteger(+body?.score) && +body.score >= 0 && +body.score <= SCORE_MAX ? +body.score : null;
  const wave = Number.isInteger(+body?.wave) && +body.wave >= 0 && +body.wave <= WAVE_MAX ? +body.wave : null;
  const ev = {
    ts: Date.now(),
    type,
    session: String(body?.session ?? '').slice(0, 64) || null,
    username,
    is_bot: classifyUA(ua),
    ua,
    ref: refHost(body?.ref),
    country: String(headers['x-vercel-ip-country'] || '').slice(0, 8) || null,
    device: deviceOf(ua),
    score: type === 'game_over' ? score : null,
    wave: type === 'game_over' ? wave : null,
  };
  try { await addEvent(ev); } catch (e) { console.error('addEvent', e); }
  return ok({ ok: true });
}

// Admin-only analytics dashboard data. Gated by the ADMIN_KEY env var (?key=…).
// Open on the local file backend so dev needs no key; locked in production.
export async function handleStats({ method, query = {} }) {
  if (method !== 'GET') return bad('method not allowed', 405);
  const key = process.env.ADMIN_KEY || '';
  if (!key) {
    if (backend !== 'file') return bad('stats locked: set ADMIN_KEY', 503);
  } else if (String(query.key || '') !== key) {
    return bad('unauthorized', 401);
  }
  const days = Math.min(90, Math.max(1, parseInt(query.days, 10) || 14));
  const stats = await queryStats(days);
  return ok({ days, ...stats });
}
