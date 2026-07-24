import { createHash } from 'node:crypto';
import { env } from '../config/env.js';
import { hasServiceRoleKey, supabaseAdmin } from './supabase.js';

const providerConfig = {
  gemini: () => env.GEMINI_API_KEY && env.GEMINI_MODEL && { key: env.GEMINI_API_KEY, model: env.GEMINI_MODEL },
  openai: () => env.OPENAI_API_KEY && env.OPENAI_MODEL && { key: env.OPENAI_API_KEY, model: env.OPENAI_MODEL },
  openrouter: () => env.OPENROUTER_API_KEY && env.OPENROUTER_MODEL && { key: env.OPENROUTER_API_KEY, model: env.OPENROUTER_MODEL },
  groq: () => env.GROQ_API_KEY && env.GROQ_MODEL && { key: env.GROQ_API_KEY, model: env.GROQ_MODEL }
};

export function configuredAiProviders() {
  return env.aiProviderOrder.filter(provider => Boolean(providerConfig[provider]?.()));
}

function extractJson(text) {
  const candidate = text.replace(/^```json\s*|\s*```$/g, '').trim();
  return JSON.parse(candidate);
}

async function requestJson(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(env.AI_REQUEST_TIMEOUT_MS) });
  const rawBody = await response.text();
  let body;

  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    body = {};
  }

  if (!response.ok) {
    const providerMessage = String(body?.error?.message || body?.error || body?.message || 'The provider rejected the request.')
      .replace(/(Bearer\s+)[^\s]+/gi, '$1[redacted]')
      .replace(/key=[^&\s]+/gi, 'key=[redacted]')
      .replace(/[\r\n]+/g, ' ')
      .slice(0, 220);
    throw new Error(`Provider returned ${response.status}: ${providerMessage}`);
  }

  if (!rawBody) throw new Error('Provider returned an empty response.');
  if (!Object.keys(body).length) throw new Error('Provider returned invalid JSON.');
  return body;
}

async function callGemini({ system, prompt, schema }) {
  const config = providerConfig.gemini();
  const body = await requestJson(`https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.key },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', responseJsonSchema: schema, temperature: 0.2 } })
  });
  return extractJson(body.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || '');
}

async function callOpenAiCompatible(provider, { system, prompt, schema }) {
  const config = providerConfig[provider]();
  const endpoint = provider === 'openrouter'
    ? 'https://openrouter.ai/api/v1/chat/completions'
    : provider === 'openai'
      ? 'https://api.openai.com/v1/chat/completions'
      : 'https://api.groq.com/openai/v1/chat/completions';
  const appReferer = env.APP_ORIGIN.split(',')[0].trim();
  const body = await requestJson(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.key}`, ...(provider === 'openrouter' ? { 'HTTP-Referer': appReferer, 'X-Title': 'TeachMate' } : {}) },
    body: JSON.stringify({ model: config.model, temperature: 0.2, max_tokens: 6000, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: `${system}\nReturn only JSON matching this schema: ${JSON.stringify(schema)}` }, { role: 'user', content: prompt }] })
  });
  return extractJson(body.choices?.[0]?.message?.content || '');
}

async function callTextGemini({ system, prompt }) {
  const config = providerConfig.gemini();
  const body = await requestJson(`https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.key },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.35, maxOutputTokens: 1800 } })
  });
  const text = body.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('').trim();
  if (!text) throw new Error('Provider returned an empty response.');
  return text;
}

async function callTextOpenAiCompatible(provider, { system, prompt }) {
  const config = providerConfig[provider]();
  const endpoint = provider === 'openrouter'
    ? 'https://openrouter.ai/api/v1/chat/completions'
    : provider === 'openai'
      ? 'https://api.openai.com/v1/chat/completions'
      : 'https://api.groq.com/openai/v1/chat/completions';
  const appReferer = env.APP_ORIGIN.split(',')[0].trim();
  const body = await requestJson(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.key}`, ...(provider === 'openrouter' ? { 'HTTP-Referer': appReferer, 'X-Title': 'TeachMate' } : {}) },
    body: JSON.stringify({ model: config.model, temperature: 0.35, max_tokens: 1800, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] })
  });
  const text = body.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('Provider returned an empty response.');
  return text;
}

// The assistant is intentionally text-first. Structured generation remains
// available for publishable drafts, while this endpoint is for a private,
// contextual workspace conversation.
export async function generateAssistantReply({ schoolId, userId, system, prompt }) {
  const attempted = [];
  const failures = [];
  for (const provider of configuredAiProviders()) {
    try {
      const text = provider === 'gemini'
        ? await callTextGemini({ system, prompt })
        : await callTextOpenAiCompatible(provider, { system, prompt });
      void audit({ schoolId, userId, purpose: 'workspace_assistant', provider, status: 'success', prompt });
      return { text, provider, attempted };
    } catch (error) {
      attempted.push(provider);
      failures.push(`${provider}: ${String(error.message || 'request failed').slice(0, 180)}`);
      void audit({ schoolId, userId, purpose: 'workspace_assistant', provider, status: 'failed', prompt, error: error.message });
    }
  }
  const detail = failures.length ? ` ${failures.join(' | ')}` : '';
  throw new Error(`All configured AI providers are temporarily unavailable. Please try again.${detail}`.slice(0, 700));
}

export async function generateStructured({ schoolId, userId, purpose, system, prompt, schema, validate }) {
  const attempted = [];
  for (const provider of configuredAiProviders()) {
    try {
      const result = provider === 'gemini' ? await callGemini({ system, prompt, schema }) : await callOpenAiCompatible(provider, { system, prompt, schema });
      const validated = validate.parse(result);
      void audit({ schoolId, userId, purpose, provider, status: 'success', prompt });
      return { result: validated, provider, attempted };
    } catch (error) {
      attempted.push(provider);
      void audit({ schoolId, userId, purpose, provider, status: 'failed', prompt, error: error.message });
    }
  }
  throw new Error('All configured AI providers are temporarily unavailable. Please try again.');
}

async function audit({ schoolId, userId, purpose, provider, status, prompt, error = null }) {
  if (!hasServiceRoleKey) return;
  const promptHash = createHash('sha256').update(prompt).digest('hex');
  const { error: auditError } = await supabaseAdmin.from('ai_audit_logs').insert({ school_id: schoolId, actor_id: userId, purpose, provider, status, prompt_hash: promptHash, error_message: error?.slice(0, 240) || null });
  if (auditError) console.error('AI audit log failed:', auditError.message);
}
