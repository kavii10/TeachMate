import { Router } from 'express';
import { z } from 'zod';
import { generateAssistantReply, generateStructured } from '../lib/ai-router.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();

const assistantRequestSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  page: z.string().trim().min(1).max(80).default('dashboard'),
  classContext: z.object({
    name: z.string().max(160).optional(),
    subject: z.string().max(100).optional(),
    grade: z.string().max(40).optional()
  }).nullable().optional(),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(4000)
  })).max(12).default([])
});

const parseStoredWorkspacePayload = (value) => {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const summarizeStatuses = (records = []) => records.reduce((totals, item) => {
  const status = String(item?.status || 'unknown').toLowerCase();
  totals[status] = (totals[status] || 0) + 1;
  return totals;
}, {});

const withRecordedHomeworkActivity = (homework, studentId = null) => homework.map(item => {
  const saved = parseStoredWorkspacePayload(item.instructions);
  const submissions = Array.isArray(saved?.submissions) ? saved.submissions : null;
  const visibleSubmissions = studentId
    ? (submissions || []).filter(submission => submission?.studentId === studentId)
    : submissions || [];
  return {
    id: item.id,
    classId: item.class_id,
    title: item.title,
    status: item.status,
    dueAt: item.due_at,
    createdAt: item.created_at,
    description: typeof saved?.description === 'string' ? saved.description : item.instructions || null,
    recordedSubmissions: submissions
      ? {
          total: visibleSubmissions.length,
          statuses: summarizeStatuses(visibleSubmissions),
          students: visibleSubmissions.slice(0, 100).map(submission => ({
            studentId: submission.studentId || null,
            studentName: submission.studentName || null,
            status: submission.status || 'unknown',
            submittedAt: submission.submittedAt || null
          }))
        }
      : null
  };
});

const withRecordedAssessmentMarks = (assessments, studentId = null) => assessments.map(item => {
  const saved = parseStoredWorkspacePayload(item.instructions);
  const studentMarks = saved?.studentMarks && typeof saved.studentMarks === 'object' ? saved.studentMarks : {};
  const marks = studentId
    ? studentMarks[studentId]
      ? [{ studentId, ...studentMarks[studentId] }]
      : []
    : Object.entries(studentMarks).slice(0, 100).map(([id, mark]) => ({ studentId: id, ...(mark || {}) }));
  return {
    id: item.id,
    classId: item.class_id,
    title: item.title,
    status: item.status,
    dueAt: item.due_at,
    totalMarks: item.total_marks,
    createdAt: item.created_at,
    recordedMarks: marks
  };
});

async function trustedAssistantContext(req) {
  const schoolId = req.auth.profile.school_id;
  const role = req.auth.profile.role;
  const warnings = [];
  const optionalData = async (label, request) => {
    const { data, error } = await request;
    if (error) {
      warnings.push(label);
      return [];
    }
    return data ?? [];
  };

  if (role === 'teacher') {
    const { data: classes, error: classesError } = await req.auth.supabase
      .from('classes')
      .select('id, name, grade, subject')
      .eq('school_id', schoolId)
      .eq('teacher_id', req.auth.user.id)
      .order('name');

    if (classesError) {
      throw new Error('Could not load authorized teacher workspace context.');
    }

    const classIds = (classes ?? []).map(item => item.id);
    const noClasses = Promise.resolve({ data: [], error: null });
    const byClass = (table, fields, limit = 200) => classIds.length
      ? req.auth.supabase.from(table).select(fields).in('class_id', classIds).limit(limit)
      : noClasses;

    const [assessmentRows, homeworkRows, enrollments, submissions, attendanceSessions, feedback, messages, resources] = await Promise.all([
      optionalData('assessments', req.auth.supabase
        .from('assessments')
        .select('id, class_id, title, instructions, status, due_at, total_marks, created_at')
        .eq('school_id', schoolId)
        .eq('teacher_id', req.auth.user.id)
        .order('created_at', { ascending: false })
        .limit(100)),
      optionalData('homework', req.auth.supabase
        .from('homework_assignments')
        .select('id, class_id, title, instructions, status, due_at, created_at')
        .eq('school_id', schoolId)
        .eq('teacher_id', req.auth.user.id)
        .order('created_at', { ascending: false })
        .limit(100)),
      optionalData('student roster', byClass('enrollments', 'class_id, student_id, enrolled_at, student:profiles!inner(id, full_name)', 250)),
      optionalData('submissions', req.auth.supabase
        .from('submissions')
        .select('id, assessment_id, student_id, status, submitted_at, assessment:assessments!inner(id, class_id, title, teacher_id)')
        .eq('school_id', schoolId)
        .eq('assessment.teacher_id', req.auth.user.id)
        .order('submitted_at', { ascending: false })
        .limit(500)),
      optionalData('attendance sessions', byClass('attendance_sessions', 'id, class_id, session_date, topic', 60)),
      optionalData('feedback', byClass('feedback_notes', 'id, class_id, student_id, title, status, created_at', 100)),
      optionalData('messages', req.auth.supabase
        .from('direct_messages')
        .select('id, subject, read_at, created_at')
        .eq('school_id', schoolId)
        .eq('recipient_id', req.auth.user.id)
        .order('created_at', { ascending: false })
        .limit(50)),
      optionalData('resources', req.auth.supabase
        .from('resources')
        .select('id, title, resource_type, created_at')
        .eq('school_id', schoolId)
        .eq('owner_id', req.auth.user.id)
        .order('created_at', { ascending: false })
        .limit(100))
    ]);

    const assessments = withRecordedAssessmentMarks(assessmentRows);
    const homework = withRecordedHomeworkActivity(homeworkRows);

    const attendanceSessionIds = attendanceSessions.map(item => item.id);
    const attendanceRecords = await optionalData(
      'attendance records',
      attendanceSessionIds.length
        ? req.auth.supabase.from('attendance_records').select('attendance_session_id, student_id, status').in('attendance_session_id', attendanceSessionIds).limit(1000)
        : Promise.resolve({ data: [], error: null })
    );

    const rosterByClass = Object.fromEntries(classIds.map(id => [id, []]));
    enrollments.forEach(item => {
      if (rosterByClass[item.class_id]) {
        rosterByClass[item.class_id].push({ id: item.student_id, name: item.student?.full_name || 'Unnamed student' });
      }
    });
    const attendanceByStatus = attendanceRecords.reduce((totals, item) => {
      totals[item.status] = (totals[item.status] || 0) + 1;
      return totals;
    }, {});

    return {
      role,
      classes: (classes ?? []).map(item => ({ ...item, roster: rosterByClass[item.id] || [] })),
      assessments,
      homework,
      submissions,
      attendance: {
        recentSessions: attendanceSessions,
        recordCounts: attendanceByStatus
      },
      feedback,
      resources,
      messages: {
        recent: messages,
        unreadCount: messages.filter(item => !item.read_at).length
      },
      unavailableData: warnings
    };
  }

  if (role === 'student') {
    const { data: enrollments, error } = await req.auth.supabase
      .from('enrollments')
      .select('class:classes!inner(id, name, grade, subject)')
      .eq('student_id', req.auth.user.id);

    if (error) throw new Error('Could not load authorized student workspace context.');

    const classIds = (enrollments ?? []).map(item => item.class.id);
    const noClasses = Promise.resolve({ data: [], error: null });
    const publishedByClass = (table, fields, limit = 100) => classIds.length
      ? req.auth.supabase.from(table).select(fields).in('class_id', classIds).eq('status', 'published').limit(limit)
      : noClasses;
    const feedbackByClass = classIds.length
      ? req.auth.supabase
          .from('feedback_notes')
          .select('id, class_id, title, body, status, published_at, created_at')
          .in('class_id', classIds)
          .eq('student_id', req.auth.user.id)
          .eq('status', 'published')
          .limit(100)
      : noClasses;
    const [assessmentRows, homeworkRows, feedback, submissions, attendance, voiceFeedback] = await Promise.all([
      optionalData('assessments', publishedByClass('assessments', 'id, class_id, title, instructions, due_at, total_marks, status, created_at')),
      optionalData('homework', publishedByClass('homework_assignments', 'id, class_id, title, instructions, due_at, status, created_at')),
      optionalData('feedback', feedbackByClass),
      optionalData('my submissions', req.auth.supabase
        .from('submissions')
        .select('id, assessment_id, status, submitted_at, reviewed_at, assessment:assessments!inner(id, class_id, title)')
        .eq('student_id', req.auth.user.id)
        .order('updated_at', { ascending: false })
        .limit(100)),
      optionalData('my attendance', req.auth.supabase
        .from('attendance_records')
        .select('status, recorded_at, session:attendance_sessions!inner(class_id, session_date, topic)')
        .eq('student_id', req.auth.user.id)
        .limit(100)),
      optionalData('voice feedback', req.auth.supabase
        .from('voice_feedback_messages')
        .select('id, class_id, assessment_id, title, published_at')
        .eq('student_id', req.auth.user.id)
        .eq('status', 'published')
        .order('published_at', { ascending: false })
        .limit(100))
    ]);

    const assessments = withRecordedAssessmentMarks(assessmentRows, req.auth.user.id);
    // A homework record can contain teacher-side submission metadata. Restrict it
    // to this student's entry before it is ever sent to the model.
    const homework = withRecordedHomeworkActivity(homeworkRows, req.auth.user.id);

    return {
      role,
      classes: (enrollments ?? []).map(item => item.class),
      assessments,
      homework,
      feedback,
      submissions,
      attendance,
      voiceFeedback,
      unavailableData: warnings
    };
  }

  // School Admin role
  const [teachers, students, classes, announcements] = await Promise.all([
    req.auth.supabase
      .from('school_memberships')
      .select('id', { count: 'exact', head: true })
      .eq('school_id', schoolId)
      .eq('status', 'active')
      .eq('role', 'teacher'),
    req.auth.supabase
      .from('school_memberships')
      .select('id', { count: 'exact', head: true })
      .eq('school_id', schoolId)
      .eq('status', 'active')
      .eq('role', 'student'),
    req.auth.supabase
      .from('classes')
      .select('id', { count: 'exact', head: true })
      .eq('school_id', schoolId),
    req.auth.supabase
      .from('announcements')
      .select('id', { count: 'exact', head: true })
      .eq('school_id', schoolId)
  ]);

  if ([teachers, students, classes, announcements].some(r => r.error)) {
    throw new Error('Could not load authorized administrator context.');
  }

  return {
    role: 'school_admin',
    const enrollments = await optionalData('enrollments', supabaseAdmin.from('class_students').select('class_id, classes(id, name, subject, grade)').eq('student_id', req.auth.user.id));
    const classes = enrollments.map(e => e.classes).filter(Boolean);
    const classIds = classes.map(c => c.id);

    return {
      role,
      user: { id: req.auth.user.id, fullName: req.auth.profile.full_name, email: req.auth.profile.email, schoolId },
      classes,
      homework: classIds.length > 0 ? withRecordedHomeworkActivity(await optionalData('homework', supabaseAdmin.from('homework').select('id, class_id, title, instructions, status, due_at, created_at').in('class_id', classIds)), req.auth.user.id) : [],
      assessments: classIds.length > 0 ? withRecordedAssessmentMarks(await optionalData('assessments', supabaseAdmin.from('assessments').select('id, class_id, title, instructions, status, total_marks, due_at, created_at').in('class_id', classIds)), req.auth.user.id) : []
    };
  }

  const schools = await optionalData('school', supabaseAdmin.from('schools').select('*').eq('id', schoolId));
  return {
    role,
    user: { id: req.auth.user.id, fullName: req.auth.profile.full_name, email: req.auth.profile.email, schoolId },
    school: schools[0] ?? null
  };
}

router.post('/assistant/stream', async (req, res, next) => {
  try {
    const input = assistantRequestSchema.parse(req.body);
    const dbContext = await trustedAssistantContext(req);
    const liveContext = input.workspaceContext ? { ...dbContext, ...input.workspaceContext } : dbContext;
    const roleName = liveContext.role === 'school_admin' ? 'school administrator' : liveContext.role;

    const systemPrompt = `You are Ask AI, TeachMate's real-time intelligent workspace AI assistant for ${roleName}.
Your job is to analyze the user's question alongside their live classroom database & dashboard data and provide a fresh, precise, real-time answer.

STRICT RULES:
- Never output generic template disclaimers or boilerplate headers (do NOT say "Here is the verified data regarding", "User Role:", "Active Scope:", or "Workspace Summary:").
- Analyze the provided live workspace database context dynamically to answer questions about students, homework, quizzes, submissions, attendance, marks, feedback, and resources.
- State exact counts, names, scores, and percentages calculated directly from the live database context.
- If asked custom questions or schedule/agenda questions, answer naturally, directly, and accurately.
- Do NOT fabricate or estimate data if it is not in the context; state clearly what is recorded.`;

    const fullPrompt = `Live Workspace Database Context: ${JSON.stringify(liveContext)}
Current Page / Tab: ${input.page}
Active Class Context: ${JSON.stringify(input.classContext ?? null)}
Recent Chat History: ${JSON.stringify(input.history)}
User Question: ${input.message}`;

    res.status(200);
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.flushHeaders?.();

    res.write(`event: status\ndata: ${JSON.stringify({ message: 'Analyzing live classroom database…' })}\n\n`);

    const output = await generateAssistantReply({
      schoolId: req.auth.profile.school_id,
      userId: req.auth.user.id,
      system: systemPrompt,
      prompt: fullPrompt
    });

    if (output.attempted && output.attempted.length > 0) {
      res.write(`event: fallback\ndata: ${JSON.stringify({ message: 'Switched to backup AI provider.' })}\n\n`);
    }

    const providerDisplayName = output.provider
      ? output.provider.charAt(0).toUpperCase() + output.provider.slice(1)
      : 'TeachMate AI';
    res.write(`event: provider\ndata: ${JSON.stringify({ provider: providerDisplayName })}\n\n`);

    const chunks = output.text.match(/.{1,90}(?:\s|$)|.{1,90}/g) ?? [output.text];
    for (const chunk of chunks) {
      res.write(`event: delta\ndata: ${JSON.stringify({ text: chunk })}\n\n`);
    }

    res.write('event: done\ndata: {}\n\n');
    res.end();
  } catch (error) {
    if (res.headersSent) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: error.message || 'Ask AI is temporarily unavailable.' })}\n\n`);
      return res.end();
    }
    next(error);
  }
});

router.post('/quiz-generator', requireRole('teacher', 'school_admin'), async (req, res, next) => {
  try {
    const input = quizRequestSchema.parse(req.body);
    const systemPrompt = `You are an expert curriculum author and master educator for TeachMate.
Generate a highly accurate, subject-specific practice quiz on the topic "${input.topic}".
STRICT INSTRUCTIONS:
- Every single question MUST directly test core concepts, definitions, formulas, or facts specifically about "${input.topic}".
- Never use generic placeholder templates (do NOT generate questions like "Which of the following describes the principle of topic?").
- For MCQ questions: provide exactly 4 distinct, plausible option choices (A, B, C, D) with 1 clear correct answer.
- For Fill Blank questions: leave options as empty array [] and set answer to the exact missing term.
- Include a concise, educational explanation for why the answer is correct.`;

    const prompt = `Topic: "${input.topic}"
Difficulty: ${input.difficulty}
Question Count: ${input.questionCount}

Create a practice quiz titled appropriately for "${input.topic}" with ${input.questionCount} questions.`;

    const output = await generateStructured({
      schoolId: req.auth.profile.school_id,
      userId: req.auth.user.id,
      purpose: 'quiz_generation',
      system: systemPrompt,
      prompt,
      schema: { type: 'object' },
      validate: quizResponseSchema
    });
    res.status(200).json({ draft: output.result, meta: { provider: output.provider } });
  } catch (error) {
    next(error);
  }
});

export default router;
