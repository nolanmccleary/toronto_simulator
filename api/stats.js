import { vercel } from './_lib/http.mjs';
import { handleStats } from './_lib/handlers.mjs';
export default vercel(handleStats);
