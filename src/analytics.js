// Lightweight first-party analytics beacon. Posts events to our own /api/event, which
// does the trust-sensitive tagging server-side (bot detection, country, logged-in user,
// timestamp). We only send: a per-tab session id, the event type, where the visit came
// from, and a couple of gameplay numbers. No cookies beyond the existing auth session,
// no third parties, no personal data.

// One id per browser tab session = one "visitor". sessionStorage clears when the tab
// closes, so reloads in the same tab stay one visitor but a fresh visit is a new one.
function sessionId() {
  try {
    let id = sessionStorage.getItem('ts_sid');
    if (!id) {
      id = (crypto.randomUUID?.() || String(Math.random()).slice(2) + Date.now().toString(36));
      sessionStorage.setItem('ts_sid', id);
    }
    return id;
  } catch { return 'nostore'; }
}

const SID = sessionId();
const REF = (() => { try { return document.referrer || ''; } catch { return ''; } })();

export function track(type, extra = {}) {
  const payload = JSON.stringify({ type, session: SID, ref: REF, ...extra });
  try {
    // keepalive lets the request survive a tab navigating away (e.g. game_over → reload).
    fetch('/api/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
      credentials: 'same-origin',
    }).catch(() => {});
  } catch { /* analytics must never break the game */ }
}

// Fire the page view exactly once, as soon as this module is imported.
track('page_view');
