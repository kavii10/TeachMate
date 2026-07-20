import { createClient } from '@supabase/supabase-js';
import { apiRequest } from './api.js';

let clientPromise;

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
export async function startSchoolWorkspaceSession(fullName = '') {
  const client = await getClient();
  const { data: current } = await client.auth.getSession();
  if (current.session) return getSchoolSession();

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

export async function getSchoolSession() {
  const client = await getClient();
  const { data: { session } } = await client.auth.getSession();
  if (!session) return null;
  try {
    const account = await apiRequest('/auth/me', { token: session.access_token });
    return { accessToken: session.access_token, email: session.user.email || '', account, needsSetup: false, isAnonymous: Boolean(session.user.is_anonymous) };
  } catch (error) {
    // New passwordless users have a valid Supabase session before their first
    // TeachMate membership is created. Keep that session so onboarding can
    // safely create the correct teacher or student context.
    return { accessToken: session.access_token, email: session.user.email || '', account: null, needsSetup: true, setupError: error.message, isAnonymous: Boolean(session.user.is_anonymous) };
  }
}

export async function bootstrapSchoolAccount(session, { role, fullName, schoolName, classId }) {
  const payload = { role, fullName };
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
