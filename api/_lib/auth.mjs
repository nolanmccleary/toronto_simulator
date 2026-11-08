// Password hashing (scrypt) + stateless signed session cookies (HMAC). All built-in crypto.
import { randomBytes, scrypt, timingSafeEqual, createHmac } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const KEYLEN = 64;

const SECRET = process.env.SESSION_SECRET
  || (process.env.VERCEL ? null : 'dev-insecure-secret-change-me'); // prod MUST set SESSION_SECRET
if (!SECRET) console.warn('[auth] SESSION_SECRET is not set — sessions will be rejected.');

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

// ---- passwords ----
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const dk = await scryptAsync(password, salt, KEYLEN);
  return `${salt}:${dk.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [salt, hashHex] = String(stored).split(':');
  if (!salt || !hashHex) return false;
  const dk = await scryptAsync(password, salt, KEYLEN);
  const a = Buffer.from(hashHex, 'hex');
  return a.length === dk.length && timingSafeEqual(a, dk);
}

// ---- sessions (token = base64url("<userId>.<expiry>.<sig>")) ----
const b64url = (buf) => Buffer.from(buf).toString('base64url');

export function createSession(userId) {
  if (!SECRET) return null;
  const exp = Date.now() + SESSION_TTL_MS;
  const payload = `${userId}.${exp}`;
  const sig = createHmac('sha256', SECRET).update(payload).digest('base64url');
  return b64url(`${payload}.${sig}`);
}

export function readSession(token) {
  if (!SECRET || !token) return null;
  let decoded;
  try { decoded = Buffer.from(token, 'base64url').toString('utf8'); } catch { return null; }
  const i = decoded.lastIndexOf('.');
  if (i < 0) return null;
  const payload = decoded.slice(0, i);
  const sig = decoded.slice(i + 1);
  const expect = createHmac('sha256', SECRET).update(payload).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const [userId, expStr] = payload.split('.');
  if (!userId || Number(expStr) < Date.now()) return null;
  return userId;
}

// ---- cookie helpers ----
const COOKIE = 'tsid';
const secure = !!process.env.VERCEL; // Secure flag only where we serve over https

export function sessionCookie(token) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}
export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}
export function sessionUserId(cookieHeader) {
  return readSession(parseCookies(cookieHeader)[COOKIE]);
}
