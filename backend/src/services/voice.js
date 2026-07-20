import { env } from '../config/env.js';

const transcriptionPrompt = 'Transcribe exactly. This is a teacher grading a student paper. Preserve question numbers, marks, comments, grammar observations, conceptual weaknesses, and overall score. Do not invent feedback.';

export async function transcribeWithGroq(file) {
  if (!env.GROQ_API_KEY) throw new Error('Groq transcription is not configured.');
  const form = new FormData();
  form.append('file', new Blob([file.buffer], { type: file.mimetype }), file.originalname);
  form.append('model', env.GROQ_TRANSCRIPTION_MODEL);
  form.append('response_format', 'json');
  form.append('temperature', '0');
  form.append('prompt', transcriptionPrompt);
  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` }, body: form, signal: AbortSignal.timeout(env.AI_REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Groq transcription returned ${response.status}.`);
  const body = await response.json();
  return { transcript: body.text, provider: 'groq' };
}

export async function transcribeWithGemini(file) {
  if (!env.GEMINI_API_KEY) throw new Error('Gemini transcription is not configured.');
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: transcriptionPrompt }, { inlineData: { mimeType: file.mimetype, data: file.buffer.toString('base64') } }] }], generationConfig: { temperature: 0 } }), signal: AbortSignal.timeout(env.AI_REQUEST_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`Gemini transcription returned ${response.status}.`);
  const body = await response.json();
  return { transcript: body.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('').trim(), provider: 'gemini' };
}

export async function transcribeWithOpenRouter(file) {
  if (!env.OPENROUTER_API_KEY) throw new Error('OpenRouter transcription is not configured.');
  const format = file.mimetype.split('/').pop().replace('x-m4a', 'm4a');
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, 'HTTP-Referer': env.APP_ORIGIN, 'X-Title': 'TeachMate' },
    body: JSON.stringify({ model: env.OPENROUTER_MODEL, temperature: 0, messages: [{ role: 'user', content: [{ type: 'text', text: transcriptionPrompt }, { type: 'input_audio', input_audio: { data: file.buffer.toString('base64'), format } }] }] }), signal: AbortSignal.timeout(env.AI_REQUEST_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`OpenRouter transcription returned ${response.status}.`);
  const body = await response.json();
  return { transcript: body.choices?.[0]?.message?.content?.trim(), provider: 'openrouter' };
}

export async function transcribeAudio(file) {
  const errors = [];
  for (const provider of [transcribeWithGroq, transcribeWithGemini, transcribeWithOpenRouter]) {
    try { const response = await provider(file); if (response.transcript) return response; } catch (error) { errors.push(error.message); }
  }
  throw new Error('Transcription is temporarily unavailable. Please save the recording and try again.');
}
