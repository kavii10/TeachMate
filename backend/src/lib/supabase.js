import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

export const hasServiceRoleKey = Boolean(env.SUPABASE_SERVICE_ROLE_KEY);

// The secret key is needed only for trusted operations such as private Storage
// uploads and server-side audit writes. Standard protected API requests use the
// caller's access token and RLS instead.
export const supabaseAdmin = hasServiceRoleKey
  ? createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    })
  : null;

export function createSupabaseForToken(accessToken) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } }
  });
}
