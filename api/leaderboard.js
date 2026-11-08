import { vercel } from './_lib/http.mjs';
import { handleLeaderboard } from './_lib/handlers.mjs';
export default vercel(handleLeaderboard);
