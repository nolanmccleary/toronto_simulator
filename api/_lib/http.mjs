// Tiny request/response helpers shared by the local server and the Vercel functions.

export async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;       // Vercel pre-parses JSON
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  const chunks = [];
  for await (const c of req) chunks.push(c);                           // raw stream (local server)
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}

export function sendJson(res, result) {
  if (result.setCookie) res.setHeader('Set-Cookie', result.setCookie);
  res.statusCode = result.status || 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(result.json));
}

// Wrap a backend-agnostic handler as a Vercel serverless function (default export).
export function vercel(handler) {
  return async (req, res) => {
    try {
      const body = req.method === 'POST' ? await readJsonBody(req) : {};
      const result = await handler({ method: req.method, body, cookieHeader: req.headers.cookie || '' });
      sendJson(res, result);
    } catch (e) {
      console.error(e);
      sendJson(res, { status: 500, json: { error: 'server error' } });
    }
  };
}
