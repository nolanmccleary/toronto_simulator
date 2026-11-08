# Deploying Toronto Simulator to Vercel

The game is a static site; accounts + the leaderboard are serverless functions in `/api`.
Locally it runs with **zero setup** (`npm start` → http://localhost:5173) using a JSON file
(`.data/accounts.json`) for storage. In production it uses Postgres.

## One-time setup

1. **Push the repo to GitHub** (or GitLab/Bitbucket).
2. In **Vercel → Add New → Project**, import the repo. Framework preset: **Other**
   (no build command, no output directory — Vercel serves the root statically and turns
   `/api/*.js` into serverless functions automatically).
3. **Add a database:** project → **Storage** → **Create Database** → **Postgres**
   (Neon-backed, free tier) → connect it to the project. This auto-adds `POSTGRES_URL`
   to the project's environment variables. The tables are created automatically on first use.
4. **Add a session secret:** project → **Settings → Environment Variables** → add
   `SESSION_SECRET` = a long random string (e.g. `openssl rand -hex 32`). Required in
   production — without it, logins are rejected.
5. **Deploy.** Every push to the main branch auto-deploys; preview deploys per branch/PR.

That's it. `@vercel/postgres` is the only dependency and Vercel installs it during the build.

## Environment variables

| Variable         | Where                      | Purpose                                            |
|------------------|----------------------------|----------------------------------------------------|
| `POSTGRES_URL`   | set automatically by Storage | Use Postgres instead of the local JSON file.      |
| `SESSION_SECRET` | you set it                 | Signs session cookies. **Required in production.** |

## API

| Route              | Method | Body / Notes                                   |
|--------------------|--------|------------------------------------------------|
| `/api/signup`      | POST   | `{username, password}` → sets session cookie   |
| `/api/login`       | POST   | `{username, password}` → sets session cookie   |
| `/api/logout`      | POST   | clears the session cookie                      |
| `/api/me`          | GET    | `{user: {username} | null}`                    |
| `/api/score`       | POST   | `{score, wave}` (auth required)                |
| `/api/leaderboard` | GET    | top 20 players by best run                     |

## Note on score integrity

Scores are reported by the browser, so a determined user could forge a submission (true of
any fully client-side game). Submissions require a logged-in session and are sanity-capped,
which is fine for a casual leaderboard. Server-authoritative validation would be a larger
future effort.
