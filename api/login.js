import { vercel } from './_lib/http.mjs';
import { handleLogin } from './_lib/handlers.mjs';
export default vercel(handleLogin);
