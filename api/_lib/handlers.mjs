// Backend-agnostic handlers. Each takes { method, body, cookieHeader } and returns
// { status, json, setCookie? }. The local server and the Vercel functions both call these.
import { getUserByName, getUserById, createUser, addScore, topScores } from './store.mjs';
import { hashPassword, verifyPassword, createSession, sessionCookie, clearCookie, sessionUserId } from './auth.mjs';

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
