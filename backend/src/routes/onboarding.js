import { Router } from 'express';
import { z } from 'zod';

const router = Router();
const optionalClassId = z.preprocess(
  value => typeof value === 'string' && !value.trim() ? undefined : value,
  z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{4,30}$/).optional()
);
const bootstrapSchema = z.object({
  role: z.enum(['teacher', 'student', 'school_admin']),
  fullName: z.string().trim().min(1).max(160),
  schoolName: z.string().trim().min(2).max(160).optional(),
  classId: optionalClassId
});

// These RPCs run as the authenticated user and create only the narrow
// membership that the sign-up flow requires.  They never accept a user id
// from the browser.
router.post('/bootstrap', async (req, res, next) => {
  try {
    const input = bootstrapSchema.parse(req.body);
    const { data, error } = await req.auth.supabase.rpc('bootstrap_mvp_workspace', {
      p_role: input.role,
      p_full_name: input.fullName,
      p_school_name: input.schoolName || null,
      p_join_code: input.classId || null
    });
    if (error) return res.status(400).json({ error: error.message });
    res.status(200).json({ setup: data?.[0] ?? data });
  } catch (error) { next(error); }
});

export default router;
