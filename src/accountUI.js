// Wires the account forms + leaderboard panels to the account API.
import { account } from './account.js';

const $ = (id) => document.getElementById(id);

const el = {
  signedIn: null, name: null, logout: null,
  form: null, user: null, pass: null, login: null, signup: null, msg: null,
  boards: [], status: null,
};

function msg(text, kind = 'err') {
  if (!el.msg) return;
  el.msg.textContent = text || '';
  el.msg.className = text ? kind : '';
}

function renderAccount() {
  const u = account.user;
  el.signedIn.classList.toggle('hide', !u);
  el.form.classList.toggle('hide', !!u);
  if (u) el.name.textContent = u.username;
  if (!u) { el.pass.value = ''; }
  msg('');
}

function renderLeaderboard(rows) {
  const me = account.user?.username;
  const html = rows.length
    ? rows.map((r, i) => {
        const mine = r.username === me ? ' mine' : '';
        const name = String(r.username).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
        return `<li class="brow${mine}"><span class="rank">${i + 1}</span><span class="who">${name}</span><span class="pts">${r.score}</span><span class="wv">w${r.wave}</span></li>`;
      }).join('')
    : '<li class="board-empty">no scores yet — be the first</li>';
  for (const ol of el.boards) ol.innerHTML = html;
}

async function refreshBoard() {
  try { renderLeaderboard(await account.leaderboard()); }
  catch { for (const ol of el.boards) ol.innerHTML = '<li class="board-empty">leaderboard unavailable</li>'; }
}

async function submit(kind) {
  const username = el.user.value.trim();
  const password = el.pass.value;
  if (!username || !password) { msg('Enter a username and password.'); return; }
  el.login.disabled = el.signup.disabled = true;
  try {
    await (kind === 'signup' ? account.signup(username, password) : account.login(username, password));
    renderAccount();
    refreshBoard();
  } catch (e) {
    msg(e.message || 'Failed.');
  } finally {
    el.login.disabled = el.signup.disabled = false;
  }
}

export const accountUI = {
  async init() {
    el.signedIn = $('acct-signedin'); el.name = $('acct-name'); el.logout = $('logout-btn');
    el.form = $('acct-form'); el.user = $('acct-user'); el.pass = $('acct-pass');
    el.login = $('login-btn'); el.signup = $('signup-btn'); el.msg = $('acct-msg');
    el.boards = [$('board-list-start'), $('board-list-over')].filter(Boolean);
    el.status = $('score-status');

    // Interacting with these panels must not trigger the overlay's click-to-play.
    for (const node of document.querySelectorAll('[data-noplay]')) {
      node.addEventListener('click', (e) => e.stopPropagation());
    }
    el.form.addEventListener('submit', (e) => { e.preventDefault(); submit('login'); });
    el.signup.addEventListener('click', () => submit('signup'));
    el.logout.addEventListener('click', async () => { await account.logout(); renderAccount(); refreshBoard(); });

    await account.refresh();
    renderAccount();
    await refreshBoard();
  },

  // Called on game over. Submits the run if logged in; returns a status line.
  async reportScore(score, wave) {
    if (el.status) el.status.textContent = '';
    if (!account.user) {
      if (el.status) el.status.innerHTML = 'playing as guest — <b>log in to save your score</b>';
      return;
    }
    try {
      const { best } = await account.submitScore(score, wave);
      if (el.status) el.status.textContent = score >= best ? `new personal best: ${best}` : `saved · your best: ${best}`;
      await refreshBoard();
    } catch (e) {
      if (el.status) el.status.textContent = 'could not save score: ' + (e.message || 'error');
    }
  },
};
