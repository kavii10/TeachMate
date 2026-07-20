import { createSupabaseForToken } from '../lib/supabase.js';

export async function authenticateUser(req, res, next) {
  const token = req.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return res.status(401).json({ error: 'Authentication is required.' });

  const userSupabase = createSupabaseForToken(token);
  const { data, error } = await userSupabase.auth.getUser(token);
  if (error || !data.user) return res.status(401).json({ error: 'Your session is invalid or expired.' });

  const { data: profile, error: profileError } = await userSupabase
    .from('profiles')
    .select('id, full_name')
    .eq('id', data.user.id)
    .single();
  if (profileError || !profile) return res.status(403).json({ error: 'Workspace setup is incomplete. Please sign in again.' });

  req.auth = { user: data.user, profile, token, supabase: userSupabase };
  next();
}

// MVP onboarding is allowed to start before the profile trigger has completed.
// The database bootstrap function creates the profile and membership together
// from the authenticated user's immutable auth.uid().
export async function authenticateBootstrap(req, res, next) {
  const token = req.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return res.status(401).json({ error: 'Authentication is required.' });

  const userSupabase = createSupabaseForToken(token);
  const { data, error } = await userSupabase.auth.getUser(token);
  if (error || !data.user) return res.status(401).json({ error: 'Your session is invalid or expired.' });

  req.auth = { user: data.user, profile: null, token, supabase: userSupabase };
  next();
}

export async function authenticate(req, res, next) {
  await new Promise(resolve => authenticateUser(req, res, resolve));
  if (res.headersSent || !req.auth) return;

  const { data: membership, error: membershipError } = await req.auth.supabase
    .from('school_memberships')
    .select('school_id, role')
    .eq('user_id', req.auth.user.id)
    .eq('status', 'active')
    .maybeSingle();
  if (membershipError || !membership) return res.status(403).json({ error: 'Your account is waiting for school access approval.' });

  req.auth.profile = { ...req.auth.profile, ...membership };
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.auth || !roles.includes(req.auth.profile.role)) {
      return res.status(403).json({ error: 'You do not have permission for this action.' });
    }
    next();
  };
}
