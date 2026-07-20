import { Router } from 'express';
import { z } from 'zod';

const router = Router();
const announcementSchema = z.object({
  title: z.string().trim().min(1).max(180),
  body: z.string().trim().min(1).max(5000),
  audience: z.enum(['all', 'teachers', 'students'])
});

router.get('/dashboard', async (req, res, next) => {
  try {
    const schoolId = req.auth.profile.school_id;
    const [teachers, students, classes] = await Promise.all([
      req.auth.supabase.from('school_memberships').select('id', { count: 'exact', head: true }).eq('school_id', schoolId).eq('status', 'active').eq('role', 'teacher'),
      req.auth.supabase.from('school_memberships').select('id', { count: 'exact', head: true }).eq('school_id', schoolId).eq('status', 'active').eq('role', 'student'),
      req.auth.supabase.from('classes').select('id', { count: 'exact', head: true }).eq('school_id', schoolId)
    ]);
    if (teachers.error || students.error || classes.error) throw new Error('Could not load the administrator dashboard.');
    res.json({ administrator: req.auth.profile, counts: { teachers: teachers.count ?? 0, students: students.count ?? 0, classes: classes.count ?? 0 } });
  } catch (error) { next(error); }
});

// Administrators create school-wide notices. The database policy uses the
// audience column to decide which authenticated members may read each row.
router.post('/announcements', async (req, res, next) => {
  try {
    const input = announcementSchema.parse(req.body);
    const { data, error } = await req.auth.supabase
      .from('announcements')
      .insert({
        school_id: req.auth.profile.school_id,
        author_id: req.auth.user.id,
        title: input.title,
        body: input.body,
        audience: input.audience
      })
      .select('id, title, body, audience, created_at')
      .single();
    if (error) throw error;
    res.status(201).json({ announcement: { ...data, source: 'School administration' } });
  } catch (error) { next(error); }
});

export default router;
