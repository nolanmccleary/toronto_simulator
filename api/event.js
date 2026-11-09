import { vercel } from './_lib/http.mjs';
import { handleEvent } from './_lib/handlers.mjs';
export default vercel(handleEvent);
