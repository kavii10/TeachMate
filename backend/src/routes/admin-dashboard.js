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
    const [schoolResult, membershipsResult, classesResult, announcementsResult] = await Promise.all([
      req.auth.supabase.from('schools').select('id, name, academic_year, timezone').eq('id', schoolId).maybeSingle(),
      req.auth.supabase
        .from('school_memberships')
        // school_memberships points at profiles through both user_id and invited_by.
        // Fetch profile records separately so this query never relies on an
        // ambiguous PostgREST embedded relationship.
        .select('user_id, role, created_at')
        .eq('school_id', schoolId)
        .eq('status', 'active')
        .in('role', ['teacher', 'student'])
        .order('created_at'),
      req.auth.supabase
        .from('classes')
        .select('id, name, grade, subject, academic_year, join_code, teacher_id, created_at')
        .eq('school_id', schoolId)
        .order('created_at'),
      req.auth.supabase
        .from('announcements')
        .select('id, title, body, audience, created_at')
        .eq('school_id', schoolId)
        .order('created_at', { ascending: false })
        .limit(50)
    ]);

    const baseQueryErrors = {
      school: schoolResult.error,
      memberships: membershipsResult.error,
      classes: classesResult.error,
      announcements: announcementsResult.error
    };
    if (Object.values(baseQueryErrors).some(Boolean)) {
      console.error('Administrator school directory query failed:', Object.fromEntries(
        Object.entries(baseQueryErrors)
          .filter(([, error]) => error)
          .map(([query, error]) => [query, error.message])
      ));
      throw new Error('Could not load the administrator school directory.');
    }

    const classes = classesResult.data || [];
    const memberships = membershipsResult.data || [];
    const memberIds = [...new Set(memberships.map(membership => membership.user_id))];
    const classIds = classes.map(classRecord => classRecord.id);
    const [profilesResult, enrollmentsResult] = await Promise.all([
      memberIds.length
        ? req.auth.supabase
            .from('profiles')
            .select('id, full_name')
            .in('id', memberIds)
        : { data: [], error: null },
      classIds.length
        ? req.auth.supabase
            .from('enrollments')
            .select('class_id, student_id, enrolled_at')
            .in('class_id', classIds)
            .order('enrolled_at')
        : { data: [], error: null }
    ]);

    const relatedQueryErrors = {
      profiles: profilesResult.error,
      enrollments: enrollmentsResult.error
    };
    if (Object.values(relatedQueryErrors).some(Boolean)) {
      console.error('Administrator school directory related query failed:', Object.fromEntries(
        Object.entries(relatedQueryErrors)
          .filter(([, error]) => error)
          .map(([query, error]) => [query, error.message])
      ));
      throw new Error('Could not load the administrator school directory.');
    }

    const profilesById = new Map((profilesResult.data || []).map(profile => [profile.id, profile]));
    const members = (membershipsResult.data || []).map(membership => {
      const profile = profilesById.get(membership.user_id);
      return {
        id: membership.user_id,
        role: membership.role,
        name: profile?.full_name || 'Unnamed member',
        joinedAt: membership.created_at
      };
    });

    res.json({
      administrator: req.auth.profile,
      school: schoolResult.data ? {
        id: schoolResult.data.id,
        name: schoolResult.data.name,
        academicYear: schoolResult.data.academic_year,
        timezone: schoolResult.data.timezone
      } : { id: schoolId },
      members,
      classes,
      enrollments: (enrollmentsResult.data || []).map(enrollment => {
        const student = profilesById.get(enrollment.student_id);
        return {
          classId: enrollment.class_id,
          studentId: enrollment.student_id,
          studentName: student?.full_name || 'Unnamed student',
          enrolledAt: enrollment.enrolled_at
        };
      }),
      announcements: announcementsResult.data || [],
      counts: {
        teachers: members.filter(member => member.role === 'teacher').length,
        students: members.filter(member => member.role === 'student').length,
        classes: classes.length
      }
    });
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
