import { Router } from 'express';

const router = Router();

router.get('/announcements', async (req, res, next) => {
  try {
    const { data, error } = await req.auth.supabase
      .from('announcements')
      .select('id, title, body, audience, created_at')
      .eq('school_id', req.auth.profile.school_id)
      .in('audience', ['all', 'teachers'])
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    res.json({ announcements: (data ?? []).map(item => ({ ...item, source: 'School administration' })) });
  } catch (error) { next(error); }
});

// A class workspace is always resolved from the authenticated teacher's own
// class list.  The UUID is never trusted by itself, so a teacher cannot open
// another teacher's roster by changing a URL in the browser.
router.get('/classes/:classId/workspace', async (req, res, next) => {
  try {
    const classId = req.params.classId;
    const [classResult, rosterResult, assessmentsResult] = await Promise.all([
      req.auth.supabase.from('classes').select('id, name, grade, subject, academic_year, join_code').eq('id', classId).eq('school_id', req.auth.profile.school_id).eq('teacher_id', req.auth.user.id).maybeSingle(),
      req.auth.supabase.from('enrollments').select('student_id, enrolled_at, student:profiles!inner(id, full_name)').eq('class_id', classId).order('enrolled_at'),
      req.auth.supabase.from('assessments').select('id, title, status, total_marks, due_at, created_at').eq('class_id', classId).eq('teacher_id', req.auth.user.id).order('created_at', { ascending: false })
    ]);
    if (classResult.error || rosterResult.error || assessmentsResult.error) throw new Error('Could not load this class workspace.');
    if (!classResult.data) return res.status(404).json({ error: 'Class not found or not assigned to this teacher.' });
    res.json({ class: classResult.data, students: rosterResult.data ?? [], assessments: assessmentsResult.data ?? [] });
  } catch (error) { next(error); }
});

router.get('/dashboard', async (req, res, next) => {
  try {
    const schoolId = req.auth.profile.school_id;
    const [classes, pendingSubmissions, drafts] = await Promise.all([
      req.auth.supabase.from('classes').select('id, name, grade, subject').eq('school_id', schoolId).eq('teacher_id', req.auth.user.id).order('name'),
      req.auth.supabase.from('submissions').select('id, assessment:assessments!inner(teacher_id)', { count: 'exact', head: true }).eq('school_id', schoolId).eq('status', 'submitted').eq('assessment.teacher_id', req.auth.user.id),
      req.auth.supabase.from('voice_feedback_drafts').select('id', { count: 'exact', head: true }).eq('school_id', schoolId).eq('teacher_id', req.auth.user.id).eq('status', 'draft')
    ]);
    if (classes.error || pendingSubmissions.error || drafts.error) throw new Error('Could not load the teacher dashboard.');
    res.json({ teacher: req.auth.profile, classes: classes.data, pendingReviewCount: pendingSubmissions.count ?? 0, voiceDraftCount: drafts.count ?? 0 });
  } catch (error) { next(error); }
});

export default router;
