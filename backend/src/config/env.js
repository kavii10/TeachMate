import 'dotenv/config';
import { z } from 'zod';

const optionalSecret = z.string().trim().optional().default('');
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_ORIGIN: z.string().min(1).default('http://localhost:3000'),
  SUPABASE_URL: z.string().url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(20).optional(),
  SUPABASE_ANON_KEY: z.string().min(20).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
  GEMINI_API_KEY: optionalSecret,
  GEMINI_MODEL: z.string().trim().default('gemini-2.5-flash'),
  OPENROUTER_API_KEY: optionalSecret,
  OPENROUTER_MODEL: z.string().trim().default('google/gemini-2.5-flash'),
  GROQ_API_KEY: optionalSecret,
  GROQ_MODEL: z.string().trim().default('llama-3.3-70b-versatile'),
  GROQ_TRANSCRIPTION_MODEL: z.string().trim().default('whisper-large-v3-turbo'),
  AI_PROVIDER_ORDER: z.string().default('gemini,openrouter,groq'),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
  MAX_AUDIO_UPLOAD_MB: z.coerce.number().int().min(1).max(100).default(20)
}).refine(data => data.SUPABASE_PUBLISHABLE_KEY || data.SUPABASE_ANON_KEY, {
  message: 'Set SUPABASE_PUBLISHABLE_KEY (preferred) or SUPABASE_ANON_KEY.',
  path: ['SUPABASE_PUBLISHABLE_KEY']
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  // Existing installations may still use Supabase's legacy anon key. It is
  // safe to expose either key to the browser because RLS protects the data.
  SUPABASE_PUBLISHABLE_KEY: parsed.data.SUPABASE_PUBLISHABLE_KEY || parsed.data.SUPABASE_ANON_KEY,
  aiProviderOrder: parsed.data.AI_PROVIDER_ORDER.split(',').map(value => value.trim().toLowerCase()).filter(Boolean)
};
