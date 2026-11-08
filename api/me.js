import { vercel } from './_lib/http.mjs';
import { handleMe } from './_lib/handlers.mjs';
export default vercel(handleMe);
