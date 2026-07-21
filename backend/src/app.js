import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import multer from 'multer';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { ZodError } from 'zod';
import { env } from './config/env.js';
import { authenticate, authenticateBootstrap, authenticateUser, requireRole } from './middleware/auth.js';
import dashboardRouter from './routes/dashboard.js';
import studentDashboardRouter from './routes/student-dashboard.js';
import adminDashboardRouter from './routes/admin-dashboard.js';
import { studentClassRouter, teacherClassRouter } from './routes/class-access.js';
import onboardingRouter from './routes/onboarding.js';
import aiRouter from './routes/ai.js';
import { configuredAiProviders } from './lib/ai-router.js';
import voiceRouter from './routes/voice.js';
import { studentResourcesRouter, teacherResourcesRouter } from './routes/resources.js';
import homeworkRouter from './routes/homework.js';

const app = express();
const backendDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const frontendDirectory = resolve(backendDirectory, '..', 'frontend');
const origins = env.APP_ORIGIN.split(',').map(value => value.trim());
const supabaseOrigin = new URL(env.SUPABASE_URL).origin;
const supabaseRealtimeOrigin = supabaseOrigin.replace(/^http/, 'ws');

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: { directives: { connectSrc: ["'self'", supabaseOrigin, supabaseRealtimeOrigin] } }
}));
app.use(cors({ origin(origin, callback) { if (!origin || origins.includes(origin)) return callback(null, true); callback(new Error('Origin is not allowed by CORS.')); }, methods: ['GET', 'POST', 'PATCH', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization'], maxAge: 86400 }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false }));
app.use('/api/ai', rateLimit({ windowMs: 15 * 60 * 1000, limit: 25, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'AI request limit reached. Please try again later.' } }));
app.use('/api/voice', rateLimit({ windowMs: 15 * 60 * 1000, limit: 15, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Voice upload limit reached. Please try again later.' } }));

app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'teachmate-api' }));
app.get('/api/ai/status', (_req, res) => {
  const providers = configuredAiProviders();
  res.json({ configured: providers.length > 0, providers });
});
// A Supabase publishable key is designed for browser use. The service-role
// key remains server-only and is never included here.
app.get('/api/public-config', (_req, res) => res.json({ supabaseUrl: env.SUPABASE_URL, supabasePublishableKey: env.SUPABASE_PUBLISHABLE_KEY }));
app.get('/api/auth/me', authenticate, (req, res) => res.json({ user: { id: req.auth.user.id, email: req.auth.user.email, ...req.auth.profile } }));
app.use('/api/onboarding', authenticateBootstrap, onboardingRouter);
app.use('/api/teacher', authenticate, requireRole('teacher', 'school_admin'), dashboardRouter);
app.use('/api/teacher', authenticate, requireRole('teacher', 'school_admin'), teacherClassRouter);
app.use('/api/teacher', authenticate, requireRole('teacher', 'school_admin'), teacherResourcesRouter);
app.use('/api/teacher', authenticate, requireRole('teacher', 'school_admin'), homeworkRouter);
app.use('/api/student', authenticate, studentDashboardRouter);
app.use('/api/student', authenticate, studentClassRouter);
app.use('/api/student', authenticate, studentResourcesRouter);
app.use('/api/admin', authenticate, requireRole('school_admin'), adminDashboardRouter);
app.use('/api/ai', authenticate, requireRole('teacher', 'student', 'school_admin'), aiRouter);
app.use('/api/voice', authenticate, requireRole('teacher', 'school_admin'), voiceRouter);

app.use('/vendor', express.static(resolve(backendDirectory, 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd')));
app.use(express.static(resolve(frontendDirectory, 'dist'), { index: 'index.html', extensions: ['html'] }));
app.use((err, _req, res, _next) => {
  if (err instanceof ZodError) return res.status(400).json({ error: 'Invalid request data.', details: err.flatten().fieldErrors });
  if (err instanceof multer.MulterError) return res.status(400).json({ error: `Upload failed: ${err.message}` });
  const status = err.message === 'Origin is not allowed by CORS.' ? 403 : 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'An unexpected error occurred.' : err.message });
});

export default app;
