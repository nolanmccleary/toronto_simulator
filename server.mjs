// Minimal zero-dependency static file server.
// Serves ES modules with the right MIME type so native imports work in the browser.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonBody, sendJson } from './api/_lib/http.mjs';
import { handleSignup, handleLogin, handleLogout, handleMe, handleScore, handleLeaderboard } from './api/_lib/handlers.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = process.env.PORT || 5173;

// Same API as the Vercel serverless functions, routed in-process for local dev.
const API = {
  '/api/signup': handleSignup,
  '/api/login': handleLogin,
  '/api/logout': handleLogout,
  '/api/me': handleMe,
  '/api/score': handleScore,
  '/api/leaderboard': handleLeaderboard,
};
async function handleApi(req, res, pathname) {
  const fn = API[pathname];
  if (!fn) { sendJson(res, { status: 404, json: { error: 'not found' } }); return; }
  try {
    const body = req.method === 'POST' ? await readJsonBody(req) : {};
    const result = await fn({ method: req.method, body, cookieHeader: req.headers.cookie || '' });
    sendJson(res, result);
  } catch (e) {
    console.error(e);
    sendJson(res, { status: 500, json: { error: 'server error' } });
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.startsWith('/api/')) { await handleApi(req, res, path); return; }
    if (path === '/') path = '/index.html';
    // Prevent path traversal.
    const full = normalize(join(ROOT, path));
    if (!full.startsWith(ROOT)) { res.writeHead(403).end('Forbidden'); return; }
    const data = await readFile(full);
    res.writeHead(200, {
      'Content-Type': MIME[extname(full)] || 'application/octet-stream',
      // Dev server: never cache, so edits always take effect on reload.
      'Cache-Control': 'no-store, must-revalidate',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}).listen(PORT, () => {
  console.log(`Toronto Simulator → http://localhost:${PORT}`);
});
