import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';

const classSchema = z.object({
  name: z.string().trim().min(2).max(160),
  grade: z.string().trim().min(1).max(40),
  subject: z.string().trim().min(2).max(100),
  academicYear: z.string().trim().min(1).max(40).optional()
});

const joinSchema = z.object({
  inviteCode: z.string().trim().min(3).max(30).optional(),
  classId: z.string().trim().min(3).max(30).optional()
});

/**
 * Generate human-readable, secure Invite Code
 * Example: SCI10-7XK9P, MATH9-H3LQ2, BIOL10-9F2A1
 */
export function generateInviteCode(subject = 'CLASS', grade = '10') {
  const cleanSubj = subject.trim().replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase() || 'CLASS';
  const cleanGrade = grade.trim().replace(/[^a-zA-Z0-9]/g, '').slice(0, 3).toUpperCase() || '10';
  const randomPart = randomBytes(3).toString('hex').toUpperCase().slice(0, 5);
  return `${cleanSubj}${cleanGrade}-${randomPart}`;
}

export const teacherClassRouter = Router();

// Create new class with Invite Code
teacherClassRouter.post('/classes', async (req, res, next) => {
  try {
    const input = classSchema.parse(req.body);
    // Reuse an existing class before creating one. The initial teacher
    // workspace asks for the same Grade 10 Biology class on a later login, so
    // this must be deterministic even when legacy duplicate records exist.
    // `maybeSingle()` without a limit errors when it finds multiple old
    // matches; selecting the oldest match avoids turning that error into a new
    // INSERT.
    const { data: existingClass, error: existingClassError } = await req.auth.supabase
      .from('classes')
      .select('id, name, grade, subject, join_code, joining_enabled, created_at')
      .eq('school_id', req.auth.profile.school_id)
      .eq('teacher_id', req.auth.user.id)
      .eq('name', input.name)
      .eq('grade', input.grade)
      .eq('subject', input.subject)
      .eq('academic_year', input.academicYear || '2026')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (existingClassError) throw existingClassError;

    if (existingClass) {
      return res.status(200).json({
        class: {
          ...existingClass,
          joinCode: existingClass.join_code,
          inviteCode: existingClass.join_code,
          joiningEnabled: existingClass.joining_enabled ?? true
        }
      });
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const inviteCode = generateInviteCode(input.subject, input.grade);
      const { data, error } = await req.auth.supabase
        .from('classes')
        .insert({
          school_id: req.auth.profile.school_id,
          teacher_id: req.auth.user.id,
          name: input.name,
          grade: input.grade,
          subject: input.subject,
          academic_year: input.academicYear || '2026',
          join_code: inviteCode,
          joining_enabled: true
        })
        .select('id, name, grade, subject, join_code, joining_enabled, created_at')
        .single();

      if (!error) {
        return res.status(201).json({
          class: {
            ...data,
            joinCode: data.join_code,
            inviteCode: data.join_code,
            joiningEnabled: data.joining_enabled ?? true
          }
        });
      }
      if (error.code !== '23505') return res.status(400).json({ error: error.message });
    }
    res.status(503).json({ error: 'Could not generate a unique Invite Code. Please try again.' });
  } catch (error) {
    next(error);
  }
});

// Regenerate Invite Code for a Class
teacherClassRouter.put('/classes/:id/invite-code', async (req, res, next) => {
  try {
    const classId = req.params.id;
    const targetClass = await req.auth.supabase
      .from('classes')
      .select('id, subject, grade, teacher_id')
      .eq('id', classId)
      .single();

    if (targetClass.error || !targetClass.data) {
      return res.status(404).json({ error: 'Class was not found.' });
    }

    const newCode = generateInviteCode(targetClass.data.subject, targetClass.data.grade);
    const { data, error } = await req.auth.supabase.rpc('regenerate_class_invite_code', {
      p_class_id: classId,
      p_new_code: newCode
    });

    if (error) {
      // Fallback direct update if RPC is pending
      const updateResult = await req.auth.supabase
        .from('classes')
        .update({ join_code: newCode })
        .eq('id', classId)
        .select('id, join_code')
        .single();
      if (updateResult.error) return res.status(400).json({ error: updateResult.error.message });
      return res.status(200).json({ inviteCode: updateResult.data.join_code, joinCode: updateResult.data.join_code });
    }

    res.status(200).json({ inviteCode: data || newCode, joinCode: data || newCode });
  } catch (error) {
    next(error);
  }
});

// Toggle Class Joining Status (Enable / Disable)
teacherClassRouter.patch('/classes/:id/joining', async (req, res, next) => {
  try {
    const classId = req.params.id;
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'Field "enabled" must be a boolean.' });
    }

    const { data, error } = await req.auth.supabase
      .from('classes')
      .update({ joining_enabled: enabled })
      .eq('id', classId)
      .select('id, joining_enabled')
      .single();

    if (error) return res.status(400).json({ error: error.message });

    res.status(200).json({
      classId: data.id,
      joiningEnabled: data.joining_enabled
    });
  } catch (error) {
    next(error);
  }
});

// Student Class Router
export const studentClassRouter = Router();

studentClassRouter.post('/classes/join', async (req, res, next) => {
  try {
    const input = joinSchema.parse(req.body);
    const codeToUse = (input.inviteCode || input.classId || '').trim().toUpperCase();

    if (!codeToUse) {
      return res.status(400).json({ error: 'Please enter a valid Class Invite Code.' });
    }

    const { data, error } = await req.auth.supabase.rpc('join_class_by_code', {
      p_join_code: codeToUse
    });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    const classRecord = data?.[0];
    if (!classRecord) {
      return res.status(404).json({ error: 'Class with this Invite Code was not found.' });
    }

    res.status(200).json({
      class: {
        ...classRecord,
        joinCode: classRecord.join_code,
        inviteCode: classRecord.join_code,
        joiningEnabled: classRecord.joining_enabled ?? true
      }
    });
  } catch (error) {
    next(error);
  }
});
