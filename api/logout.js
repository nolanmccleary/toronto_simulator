import { vercel } from './_lib/http.mjs';
import { handleLogout } from './_lib/handlers.mjs';
export default vercel(handleLogout);
