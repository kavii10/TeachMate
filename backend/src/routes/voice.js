import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { z } from 'zod';
import { env } from '../config/env.js';
import { transcribeAudio } from '../services/voice.js';
import { hasServiceRoleKey, supabaseAdmin } from '../lib/supabase.js';

const router = Router();
const allowedAudioTypes = new Set(['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/webm', 'audio/ogg']);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.MAX_AUDIO_UPLOAD_MB * 1024 * 1024, files: 1 }, fileFilter: (_req, file, callback) => callback(null, allowedAudioTypes.has(file.mimetype)) });
const publishVoiceFeedbackSchema = z.object({
  classId: z.string().uuid(),
  studentId: z.string().uuid(),
  assessmentId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(180)
});

const fileExtensionFor = (mimeType) => ({
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/wav': 'wav',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg'
}[mimeType] || 'webm');

// Records the teacher's original audio and immediately publishes it to the
// selected enrolled student. It deliberately never calls an AI or a
// transcription provider.
router.post('/feedback', upload.single('audio'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Record or upload one supported audio file.' });

    const input = publishVoiceFeedbackSchema.parse(req.body);
    let classQuery = req.auth.supabase
      .from('classes')
      .select('id, school_id, teacher_id')
      .eq('id', input.classId)
      .eq('school_id', req.auth.profile.school_id);
    if (req.auth.profile.role === 'teacher') classQuery = classQuery.eq('teacher_id', req.auth.user.id);
    const { data: classRecord, error: classError } = await classQuery.maybeSingle();
    if (classError) throw classError;
    if (!classRecord) return res.status(404).json({ error: 'This class is not available for voice feedback.' });

    const { data: enrollment, error: enrollmentError } = await req.auth.supabase
      .from('enrollments')
      .select('student_id')
      .eq('class_id', classRecord.id)
      .eq('student_id', input.studentId)
      .maybeSingle();
    if (enrollmentError) throw enrollmentError;
    if (!enrollment) return res.status(404).json({ error: 'The selected student is not enrolled in this class.' });

    if (input.assessmentId) {
      const { data: assessment, error: assessmentError } = await req.auth.supabase
        .from('assessments')
        .select('id')
        .eq('id', input.assessmentId)
        .eq('class_id', classRecord.id)
        .eq('school_id', req.auth.profile.school_id)
        .maybeSingle();
      if (assessmentError) throw assessmentError;
      if (!assessment) return res.status(404).json({ error: 'This assessment is not available in the selected class.' });
    }

    const feedbackId = randomUUID();
    const objectPath = `${req.auth.profile.school_id}/${classRecord.id}/${input.studentId}/${feedbackId}.${fileExtensionFor(req.file.mimetype)}`;
    // Prefer the server key when it exists, but the matching Storage RLS policy
    // also lets a signed-in class owner record and publish without one.
    const storageClient = supabaseAdmin || req.auth.supabase;
    const storage = await storageClient.storage
      .from('voice-feedback')
      .upload(objectPath, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
    if (storage.error) throw new Error(`Secure recording storage failed: ${storage.error.message}`);

    const publishedAt = new Date().toISOString();
    const { data: feedback, error: insertError } = await req.auth.supabase
      .from('voice_feedback_messages')
      .insert({
        id: feedbackId,
        school_id: req.auth.profile.school_id,
        class_id: classRecord.id,
        assessment_id: input.assessmentId || null,
        student_id: input.studentId,
        teacher_id: req.auth.user.id,
        title: input.title,
        audio_path: objectPath,
        status: 'published',
        published_at: publishedAt
      })
      .select('id, class_id, assessment_id, student_id, title, status, published_at, created_at')
      .single();

    if (insertError) {
      await storageClient.storage.from('voice-feedback').remove([objectPath]);
      throw new Error(`Voice feedback save failed: ${insertError.message}`);
    }

    res.status(201).json({ feedback });
  } catch (error) { next(error); }
});

router.post('/transcribe', upload.single('audio'), async (req, res, next) => {
  try {
    if (!hasServiceRoleKey) return res.status(503).json({ error: 'Voice feedback is not configured. Add SUPABASE_SERVICE_ROLE_KEY to backend/.env.' });
    if (!req.file) return res.status(400).json({ error: 'Upload one supported audio file.' });
    const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const objectPath = `${req.auth.profile.school_id}/${req.auth.user.id}/${Date.now()}-${safeName}`;
    const storage = await supabaseAdmin.storage.from('voice-feedback').upload(objectPath, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
    if (storage.error) throw new Error(`Secure recording storage failed: ${storage.error.message}`);

    const transcription = await transcribeAudio(req.file);
    const { data: record, error: insertError } = await supabaseAdmin.from('voice_feedback_drafts').insert({ school_id: req.auth.profile.school_id, teacher_id: req.auth.user.id, audio_path: objectPath, transcript: transcription.transcript, status: 'draft' }).select('id, status, created_at').single();
    if (insertError) throw new Error(`Voice draft save failed: ${insertError.message}`);
    res.status(201).json({ draft: record, transcript: transcription.transcript, provider: transcription.provider, approvalRequired: true });
  } catch (error) { next(error); }
});

export default router;
