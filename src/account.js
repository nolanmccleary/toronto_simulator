// Thin client for the accounts/leaderboard API. Cookies carry the session (same-origin).
async function api(path, opts = {}) {
  const res = await fetch('/api/' + path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  let data = {};
  try { data = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

export const account = {
  user: null, // { username } | null

  async refresh() {
    try { this.user = (await api('me')).user; } catch { this.user = null; }
    return this.user;
  },
  async signup(username, password) {
    this.user = (await api('signup', { method: 'POST', body: JSON.stringify({ username, password }) })).user;
    return this.user;
  },
  async login(username, password) {
    this.user = (await api('login', { method: 'POST', body: JSON.stringify({ username, password }) })).user;
    return this.user;
  },
  async logout() {
    try { await api('logout', { method: 'POST' }); } finally { this.user = null; }
  },
  submitScore(score, wave) {
    return api('score', { method: 'POST', body: JSON.stringify({ score, wave }) });
  },
  async leaderboard() {
    return (await api('leaderboard')).leaderboard || [];
  },
};
