import { vercel } from './_lib/http.mjs';
import { handleSignup } from './_lib/handlers.mjs';
export default vercel(handleSignup);
