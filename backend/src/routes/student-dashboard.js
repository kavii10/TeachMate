import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';

const router = Router();

router.get('/announcements', async (req, res, next) => {
  try {
    const { data, error } = await req.auth.supabase
      .from('announcements')
      .select('id, title, body, audience, created_at')
      .eq('school_id', req.auth.profile.school_id)
      .in('audience', ['all', 'students'])
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    res.json({ announcements: (data ?? []).map(item => ({ ...item, source: 'School administration' })) });
  } catch (error) { next(error); }
});

// Student subject data is scoped by an enrollment lookup first.  This keeps a
// copied internal UUID from revealing another class's progress or assessments.
router.get('/subjects/:classId/workspace', async (req, res, next) => {
  try {
    const classId = req.params.classId;
    const { data: enrollment, error: enrollmentError } = await req.auth.supabase
      .from('enrollments')
      .select('class_id, enrolled_at, class:classes!inner(id, name, grade, subject, teacher_id, join_code)')
      .eq('class_id', classId)
      .eq('student_id', req.auth.user.id)
      .maybeSingle();
    if (enrollmentError) throw new Error('Could not verify this subject enrollment.');
    if (!enrollment) return res.status(404).json({ error: 'You are not enrolled in this subject.' });

    const { data: assessments, error: assessmentError } = await req.auth.supabase
      .from('assessments')
      .select('id, title, total_marks, due_at, created_at')
      .eq('class_id', classId)
      .eq('status', 'published')
      .order('due_at', { ascending: true });
    if (assessmentError) throw new Error('Could not load subject assessments.');
    const assessmentIds = (assessments ?? []).map(item => item.id);
    const { data: submissions, error: submissionError } = assessmentIds.length
      ? await req.auth.supabase.from('submissions').select('id, assessment_id, status, submitted_at, reviewed_at').eq('student_id', req.auth.user.id).in('assessment_id', assessmentIds)
      : { data: [], error: null };
    if (submissionError) throw new Error('Could not load your subject progress.');
    res.json({ enrollment, assessments: assessments ?? [], submissions: submissions ?? [] });
  } catch (error) { next(error); }
});

router.get('/dashboard', async (req, res, next) => {
  try {
    const { data: enrollments, error } = await req.auth.supabase
      .from('enrollments')
      .select('class_id, enrolled_at, class:classes!inner(id, name, grade, subject, teacher_id)')
      .eq('student_id', req.auth.user.id)
      .order('enrolled_at');
    if (error) throw new Error('Could not load the student dashboard.');
    const classIds = enrollments.map(item => item.class_id);
    const { count: assessmentCount, error: assessmentError } = classIds.length
      ? await req.auth.supabase.from('assessments').select('id', { count: 'exact', head: true }).in('class_id', classIds).eq('status', 'published')
      : { count: 0, error: null };
    if (assessmentError) throw new Error('Could not load student assessments.');
    res.json({ student: req.auth.profile, enrollments, publishedAssessmentCount: assessmentCount ?? 0 });
  } catch (error) { next(error); }
});

// The student receives only their own published recording. Signed URLs keep
// the Storage bucket private and expire automatically.
router.get('/voice-feedback', async (req, res, next) => {
  try {
    const { data: feedback, error } = await req.auth.supabase
      .from('voice_feedback_messages')
      .select('id, class_id, assessment_id, title, audio_path, published_at, created_at')
      .eq('student_id', req.auth.user.id)
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(100);
    if (error) throw error;

    const rows = feedback ?? [];
    // The student has SELECT access only to their own published message through
    // Storage RLS. A server key is optional, not a requirement for delivery.
    const storageClient = supabaseAdmin || req.auth.supabase;
    const delivered = await Promise.all(rows.map(async item => {
      const { data: signed, error: signedError } = await storageClient.storage
        .from('voice-feedback')
        .createSignedUrl(item.audio_path, 60 * 60);
      return {
        id: item.id,
        classId: item.class_id,
        assessmentId: item.assessment_id,
        title: item.title,
        publishedAt: item.published_at,
        createdAt: item.created_at,
        signedUrl: signedError ? null : signed?.signedUrl || null
      };
    }));

    res.json({ feedback: delivered });
  } catch (error) { next(error); }
});

export default router;
