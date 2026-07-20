const API_BASE = import.meta.env.VITE_API_URL || '/api';

export async function checkApiHealth() {
  const response = await fetch(`${API_BASE}/health`);
  if (!response.ok) throw new Error('TeachMate API is unavailable.');
  return response.json();
}

// This endpoint only reports whether a server-side provider is ready. It never
// exposes a provider key to the browser.
export async function getAiStatus() {
  const response = await fetch(`${API_BASE}/ai/status`);
  if (!response.ok) throw new Error('AI status is unavailable.');
  return response.json();
}

// Protected Supabase-backed routes can use this adapter once a school session
// is connected. Demo mode intentionally keeps data in local storage instead.
export async function apiRequest(path, { token, ...options } = {}) {
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...(isFormData ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers }
  });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Request failed.');
  return response.status === 204 ? null : response.json();
}
