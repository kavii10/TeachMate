import { createClient } from '@supabase/supabase-js';
import { apiRequest } from './api.js';

let clientPromise;
const instantSessionPrefix = 'teachmate:instant-session:';

const roleKey = role => {
  const value = String(role || '').trim().toLowerCase();
  if (value === 'school_admin' || value === 'admin' || value === 'administrator') return 'admin';
  return value === 'student' ? 'student' : 'teacher';
};

const instantSessionKey = (email, role) => `${instantSessionPrefix}${String(email || '').trim().toLowerCase()}:${roleKey(role)}`;

function forgetInstantSession(email, role) {
  if (email?.trim()) localStorage.removeItem(instantSessionKey(email, role));
}

async function restoreInstantSession(client, email, role) {
  if (!email?.trim()) return null;

  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(instantSessionKey(email, role)) || 'null');
  } catch {
    forgetInstantSession(email, role);
    return null;
  }
  if (!saved?.accessToken || !saved?.refreshToken || !saved?.userId) return null;

  const { data, error } = await client.auth.setSession({
    access_token: saved.accessToken,
    refresh_token: saved.refreshToken
  });
  if (error || !data.session || data.session.user.id !== saved.userId) {
    forgetInstantSession(email, role);
    return null;
  }
  return data.session;
}

async function getClient() {
  if (!clientPromise) {
    clientPromise = fetch('/api/public-config')
      .then(async response => {
        if (!response.ok) throw new Error('Secure school sign-in is unavailable.');
        return response.json();
      })
      .then(({ supabaseUrl, supabasePublishableKey }) => createClient(supabaseUrl, supabasePublishableKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      }));
  }
  return clientPromise;
}

// Creates an immediate, browser-bound authenticated workspace session. This
// deliberately does not send an email or open a magic-link flow. Anonymous
// sign-ins must be enabled in the Supabase Auth settings for this project.
// Anonymous users are intentionally browser-bound for this MVP. Preserve the
// authenticated session by email + role on this browser so signing out of the
// TeachMate interface and returning later does not create another auth user.
export async function startSchoolWorkspaceSession({ fullName = '', email = '', role = '' } = {}) {
  const client = await getClient();
  const { data: current } = await client.auth.getSession();
  if (current.session) return getSchoolSession();

  if (await restoreInstantSession(client, email, role)) return getSchoolSession();

  const { error } = await client.auth.signInAnonymously({
    options: { data: fullName ? { full_name: fullName } : undefined }
  });
  if (error) {
    if (/anonymous|disabled/i.test(error.message)) {
      throw new Error('Instant workspace sign-in is disabled in Supabase. Enable Anonymous Sign-Ins in Authentication → Providers, then try again.');
    }
    throw error;
  }
  return getSchoolSession();
}

export async function rememberSchoolWorkspaceSession(email, role) {
  if (!email?.trim()) return;
  const client = await getClient();
  const { data: { session } } = await client.auth.getSession();
  if (!session?.access_token || !session.refresh_token || !session.user?.id) return;

  // Supabase itself persists the active session in browser storage. This
  // additional record lets this no-email MVP restore the same session after a
  // local TeachMate sign-out. It is never sent to the API as an identity claim.
  localStorage.setItem(instantSessionKey(email, role), JSON.stringify({
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    userId: session.user.id,
    savedAt: new Date().toISOString()
  }));
}

export async function getSchoolSession() {
  const client = await getClient();
  const { data: { session } } = await client.auth.getSession();
  if (!session) return null;
  try {
    const account = await apiRequest('/auth/me', { token: session.access_token });
    return { accessToken: session.access_token, email: session.user.email || account?.user?.email || '', account, needsSetup: false, isAnonymous: Boolean(session.user.is_anonymous) };
  } catch (error) {
    // New passwordless users have a valid Supabase session before their first
    // TeachMate membership is created. Keep that session so onboarding can
    // safely create the correct teacher or student context.
    return { accessToken: session.access_token, email: session.user.email || '', account: null, needsSetup: true, setupError: error.message, isAnonymous: Boolean(session.user.is_anonymous) };
  }
}

export async function bootstrapSchoolAccount(session, { role, fullName, email, schoolName, classId }) {
  const payload = { role, fullName, email };
  if (schoolName?.trim()) payload.schoolName = schoolName.trim();
  if (classId?.trim()) payload.classId = classId.trim();
  await apiRequest('/onboarding/bootstrap', { token: session.accessToken, method: 'POST', body: JSON.stringify(payload) });
  return getSchoolSession();
}

export async function signOutSchoolSession() {
  const client = await getClient();
  await client.auth.signOut({ scope: 'local' });
}

export async function getSupabaseClient() {
  return getClient();
}
