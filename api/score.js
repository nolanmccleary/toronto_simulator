import { vercel } from './_lib/http.mjs';
import { handleScore } from './_lib/handlers.mjs';
export default vercel(handleScore);
