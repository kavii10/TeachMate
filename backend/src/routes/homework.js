import { Router } from 'express';
import { z } from 'zod';

const createHomeworkSchema = z.object({
  title: z.string().trim().min(1).max(180),
  dueLabel: z.string().trim().max(80).optional().default('')
});

const parseDueDate = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const date = new Date(`${value}T23:59:59.000Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const router = Router();
router.post('/classes/:classId/homework', async (req, res, next) => {
  try {
    const input = createHomeworkSchema.parse(req.body);
    const { data: classRecord, error: classError } = await req.auth.supabase
      .from('classes')
      .select('id, name')
      .eq('id', req.params.classId)
      .eq('school_id', req.auth.profile.school_id)
      .eq('teacher_id', req.auth.user.id)
      .maybeSingle();
    if (classError) throw classError;
    if (!classRecord) return res.status(404).json({ error: 'This classroom is not available for homework.' });

    const { data: homework, error } = await req.auth.supabase.from('homework_assignments').insert({
      school_id: req.auth.profile.school_id,
      class_id: classRecord.id,
      teacher_id: req.auth.user.id,
      title: input.title,
      due_at: parseDueDate(input.dueLabel),
      status: 'published'
    }).select('id, title, due_at, status, created_at').single();
    if (error) throw error;
    res.status(201).json({ homework: { ...homework, dueLabel: input.dueLabel || (homework.due_at ? new Date(homework.due_at).toLocaleDateString() : 'No due date') } });
  } catch (error) { next(error); }
});

export default router;
