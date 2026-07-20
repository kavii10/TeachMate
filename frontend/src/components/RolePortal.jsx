import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ArrowUpRight, BarChart3, BookOpen, CalendarCheck, CheckCircle2, FileText, GraduationCap, MessageSquare, School, Users, Play, Volume2, Award, Sparkles, Send, Download, Paperclip, X, Check, Search, Mic, Bell, Plus, Copy, RefreshCw, Lock, Unlock } from 'lucide-react';
import { roleLabels } from '../data.js';
import { apiRequest } from '../lib/api.js';
import { findDemoClass, addStudentToDemoClass } from '../lib/storage.js';
import logoLight from '../assets/teachmate-logo-light.jpeg';
import logoDark from '../assets/teachmate-logo-dark.jpeg';

function BrandMark({ large = false }) {
  return <span className={`brand-mark logo-mark ${large ? 'large' : ''}`}><img className="logo-light" src={logoLight} alt="TeachMate" /><img className="logo-dark" src={logoDark} alt="TeachMate" /></span>;
}

const initials = name => name?.split(' ').map(part => part[0]).slice(0, 2).join('').toUpperCase() || 'TM';

const studentNavIcons = {
  progress: BarChart3,
  homework: FileText,
  tests: GraduationCap,
  quizzes: CheckCircle2,
  feedback: Mic,
  resources: BookOpen,
  messages: MessageSquare
};

export function JoinClassModal({ open, onClose, authToken, workspace, updateWorkspace, onToast }) {
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');
  const [joining, setJoining] = useState(false);

  async function submit(e) {
    e.preventDefault();
    const cleanCode = inviteCode.trim().toUpperCase();
    if (!cleanCode) return setError('Please enter a Class Invite Code.');

    setJoining(true);
    setError('');
    try {
      let joinedClass = null;

      if (authToken) {
        const response = await apiRequest('/student/classes/join', {
          token: authToken,
          method: 'POST',
          body: JSON.stringify({ inviteCode: cleanCode })
        });
        joinedClass = response.class;
      } else {
        const demoRecord = findDemoClass(cleanCode);
        if (demoRecord && demoRecord.joiningEnabled === false) {
          throw new Error('This class is currently closed for new students.');
        }
        joinedClass = demoRecord || {
          id: `class-${Date.now()}`,
          name: 'Joined Classroom',
          grade: 'Grade 10',
          subject: 'Science',
          students: 1,
          joinCode: cleanCode,
          color: 'indigo'
        };
      }

      const existingCodes = workspace.classes.map(c => (c.joinCode || c.inviteCode || '').toUpperCase());
      if (existingCodes.includes(cleanCode)) {
        throw new Error('You are already enrolled in this class.');
      }

      // Sync student to class registry and teacher roster
      const studentObj = addStudentToDemoClass(cleanCode, workspace.profile);

      updateWorkspace(current => {
        const currentStudents = current.students || [];
        const exists = studentObj && currentStudents.some(s => s.name?.toLowerCase() === studentObj.name?.toLowerCase());
        const updatedStudents = exists || !studentObj ? currentStudents : [...currentStudents, studentObj];
        return {
          ...current,
          classes: [...current.classes, joinedClass],
          students: updatedStudents,
          profile: { ...current.profile, classId: cleanCode, joinedClass }
        };
      });

      onToast(`Successfully Joined ${joinedClass.name || 'Class'}!`);
      onClose();
    } catch (err) {
      setError(err.message || 'Could not join class. Check the Invite Code and try again.');
    } finally {
      setJoining(false);
    }
  }

  if (!open) return null;

  return (
    <AnimatePresence>
      <div className="modal-backdrop" style={{ zIndex: 90 }} onMouseDown={onClose}>
        <motion.form
          className="quick-modal join-class-modal"
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12 }}
          onMouseDown={e => e.stopPropagation()}
          onSubmit={submit}
          style={{ maxWidth: '420px', padding: '24px' }}
        >
          <div className="modal-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <p className="eyebrow">STUDENT ENROLLMENT</p>
              <h2 style={{ margin: '4px 0 0', fontSize: '20px' }}>Join a Class</h2>
            </div>
            <button type="button" className="button ghost" onClick={onClose} style={{ padding: '6px' }}>
              <X size={18} />
            </button>
          </div>
          <p className="modal-copy" style={{ fontSize: '12px', color: 'var(--muted)', margin: '10px 0 16px' }}>
            Enter the Class Invite Code shared by your teacher (e.g. <code>SCI10-7XK9P</code>).
          </p>

          <div className="field" style={{ margin: '14px 0', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '11px', fontWeight: 700 }}>Invite Code</span>
            <input
              value={inviteCode}
              onChange={e => setInviteCode(e.target.value.toUpperCase())}
              placeholder="e.g. SCI10-7XK9P"
              autoFocus
              style={{
                height: '42px',
                padding: '0 14px',
                borderRadius: '8px',
                border: '1px solid var(--line)',
                fontSize: '15px',
                fontWeight: 700,
                letterSpacing: '1px',
                textTransform: 'uppercase',
                background: 'var(--input)',
                color: 'var(--text)'
              }}
            />
          </div>

          {error && <p className="form-error" style={{ color: '#ef4444', fontSize: '11.5px', marginBottom: '12px', background: '#fef2f2', padding: '8px 10px', borderRadius: '6px', border: '1px solid #fca5a5' }}>{error}</p>}

          <div className="modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
            <button type="button" className="button ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="button primary" disabled={joining} style={{ background: '#4f46e5', color: '#fff', border: 0, padding: '8px 16px', borderRadius: '8px', fontWeight: 700 }}>
              {joining ? 'Joining...' : 'Join Class'}
            </button>
          </div>
        </motion.form>
      </div>
    </AnimatePresence>
  );
}

function StudentClassSidebar({ profile, classRecord, tab, setTab, mobileOpen, closeMobile, onBack }) {
  const classNav = [
    ['progress', 'Overview'],
    ['homework', 'Homework'],
    ['tests', 'Assessments'],
    ['quizzes', 'Quiz'],
    ['feedback', 'Feedback'],
    ['resources', 'Resources'],
    ['messages', 'Messages']
  ];
  return (
    <aside className={`sidebar class-sidebar ${mobileOpen ? 'open' : ''}`}>
      <div className="sidebar-top">
        <div className="brand">
          <BrandMark />
          <span>Teach<span>Mate</span></span>
        </div>
        <button className="class-return" onClick={onBack}>
          <ArrowLeft size={16} /> All subjects
        </button>
        <div className="class-context">
          <span>SUBJECT WORKSPACE</span>
          <b>{classRecord.name}</b>
          <small>{classRecord.subject}</small>
          {classRecord.joinCode && <em>Class ID: {classRecord.joinCode}</em>}
        </div>
      </div>
      <nav className="sidebar-nav">
        <p className="nav-caption">STUDENT WORKSPACE</p>
        {classNav.map(([id, label]) => {
          const Icon = studentNavIcons[id] || FileText;
          return (
            <button
              key={id}
              className={`nav-item ${tab === id ? 'active' : ''}`}
              onClick={() => {
                setTab(id);
                closeMobile();
              }}
            >
              <Icon size={18} />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>
      <div className="sidebar-user">
        <button className="sidebar-profile">
          <span className="avatar gradient">{initials(profile.fullName)}</span>
          <span>
            <b>{profile.fullName}</b>
            <small>Student profile</small>
          </span>
        </button>
      </div>
    </aside>
  );
}

const portalCopy = {
  student: {
    eyebrow: 'STUDENT PORTAL', greeting: 'Your learning, in focus.', copy: 'Open a subject to see its progress, assessments, feedback, and resources.',
    stats: [['Classes Joined', '0', BookOpen], ['Pending homework', '0', FileText], ['Attendance', '100%', CheckCircle2], ['Teacher Feedback', '0', MessageSquare]],
    actions: [['subjects', 'Open my subjects'], ['homework', 'View homework'], ['calendar', 'View Schedule']],
    pages: { subjects: ['My subjects', 'Classes you joined with a valid Class Invite Code are shown here.'], assignments: ['Assignments', 'Only work from your enrolled classes is available.'], homework: ['Homework', 'Review and submit your assigned work.'], assessments: ['Assessments', 'Published assessments from your classes.'], marks: ['Marks', 'Your reviewed marks and results.'], feedback: ['Teacher feedback', 'Private feedback prepared for you.'], voiceFeedback: ['Voice feedback', 'Teacher voice feedback for your submissions.'], attendance: ['Attendance', 'Your class attendance record.'], progress: ['Learning progress', 'Your strengths and topics to revisit.'], resources: ['Resources', 'Teacher-shared classroom resources.'], messages: ['Messages', 'Private school conversations.'], announcements: ['Announcements', 'School and class updates.'], calendar: ['Calendar', 'Your class schedule and due dates.'], profile: ['Profile', 'Your school identity and preferences.'], settings: ['Settings', 'Manage your workspace preferences.'] }
  },
  admin: {
    eyebrow: 'SCHOOL ADMINISTRATION', greeting: 'Your school, clearly managed.', copy: 'Manage people, classes, and school-wide operations from one secure workspace.',
    stats: [['Teachers', '0', GraduationCap], ['Students', '0', Users], ['Active classes', '0', BookOpen], ['School performance', '100%', BarChart3]],
    actions: [['teachers', 'Manage teachers'], ['classes', 'Manage classes'], ['reports', 'Open reports']],
    pages: { schools: ['Schools', 'Manage school settings and academic years.'], teachers: ['Teachers', 'Manage staff accounts and class assignments.'], students: ['Students', 'Manage student accounts and enrollments.'], classes: ['Classes', 'Assign teachers and manage class rosters.'], subjects: ['Subjects', 'Maintain the school subject catalogue.'], timetable: ['Timetable', 'Coordinate school schedules.'], attendance: ['Attendance', 'Review attendance across the school.'], assessments: ['Assessments', 'Review assessment activity and publishing.'], resources: ['Resource library', 'Manage school resources and access.'], analytics: ['Analytics', 'School-wide learning signals.'], reports: ['Reports', 'Export operational and academic reports.'], users: ['User management', 'Manage memberships and permissions.'], notifications: ['Notifications', 'Manage school-wide notices.'], settings: ['Settings', 'Configure system preferences.'] }
  }
};

function RoleDashboard({ role, workspace, setPage, onOpenSubject, onJoinClassClick }) {
  const config = portalCopy[role];
  const classCount = workspace.classes?.length || 0;
  const homeworkCount = workspace.homework?.length || 0;

  return (
    <div className="page role-dashboard">
      <div className="page-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div className="eyebrow">{config.eyebrow}</div>
          <h1>{config.greeting}</h1>
          <p>{config.copy}</p>
        </div>
        {role === 'student' && (
          <button
            className="button primary"
            onClick={onJoinClassClick}
            style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)', color: '#fff', border: 0, padding: '10px 18px', borderRadius: '10px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}
          >
            <Plus size={16} /> Join Class
          </button>
        )}
      </div>

      <section className="metric-grid">
        <article className="metric-card">
          <span className="metric-icon indigo"><BookOpen size={19} /></span>
          <div><p>Joined Classes</p><h3>{classCount}</h3><small>Active rosters</small></div>
        </article>
        <article className="metric-card">
          <span className="metric-icon amber"><FileText size={19} /></span>
          <div><p>Pending Homework</p><h3>{homeworkCount}</h3><small>Assigned work</small></div>
        </article>
        <article className="metric-card">
          <span className="metric-icon emerald"><CheckCircle2 size={19} /></span>
          <div><p>Attendance</p><h3>100%</h3><small>Recorded status</small></div>
        </article>
        <article className="metric-card">
          <span className="metric-icon violet"><MessageSquare size={19} /></span>
          <div><p>Teacher Feedback</p><h3>{workspace.feedback?.length || 0}</h3><small>Observations</small></div>
        </article>
      </section>

      <section className="role-grid">
        <article className="card">
          <p className="eyebrow">YOUR CLASS CONTEXT</p>
          <h3>{role === 'student' ? 'Enrolled subjects' : 'School operations'}</h3>
          {classCount > 0 ? (
            <div className="role-list">
              {workspace.classes.slice(0, 5).map(item => (
                <button className="role-list-button" key={item.id} onClick={() => role === 'student' ? onOpenSubject(item.id) : setPage('classes')}>
                  <BookOpen size={16} />
                  <span><b>{item.name}</b><small>{item.subject}</small></span>
                  <ArrowUpRight size={15} />
                </button>
              ))}
            </div>
          ) : (
            <div style={{ padding: '24px 10px', textAlign: 'center' }}>
              <span className="metric-icon indigo" style={{ height: '44px', width: '44px', margin: '0 auto 12px' }}><GraduationCap size={24} /></span>
              <h4 style={{ margin: '0 0 4px', fontSize: '15px' }}>No classes joined yet</h4>
              <p style={{ margin: '0 0 14px', fontSize: '12px', color: 'var(--muted)' }}>Enter a Class Invite Code shared by your teacher to access your subjects, homework, and quizzes.</p>
              {role === 'student' && (
                <button className="button primary" onClick={onJoinClassClick} style={{ background: '#4f46e5', color: '#fff', border: 0, padding: '8px 16px', borderRadius: '8px', fontWeight: 700, cursor: 'pointer' }}>
                  Join Your First Class
                </button>
              )}
            </div>
          )}
        </article>

        <article className="card">
          <p className="eyebrow">QUICK ACTIONS</p>
          <h3>Keep moving</h3>
          <div className="role-actions">
            {config.actions.map(([page, label]) => (
              <button key={page} onClick={() => setPage(page)}>{label}<ArrowUpRight size={15} /></button>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}

function Card({ children, className = '' }) { return <div className={`card ${className}`}>{children}</div>; }
function CardHeader({ eyebrow, title }) { return <div className="card-header"><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div>; }

function StudentClassWorkspace({ classRecord, onBack, authToken, workspace, updateWorkspace, tab, setTab }) {
  const [hwContent, setHwContent] = useState('');
  const [hwAttachment, setHwAttachment] = useState('');
  const [selectedHw, setSelectedHw] = useState(null);
  const [activeQuizId, setActiveQuizId] = useState(null);
  const [quizAnswers, setQuizAnswers] = useState({});
  const [quizScore, setQuizScore] = useState(null);
  const [quizAnalysis, setQuizAnalysis] = useState('');

  const [messageText, setMessageText] = useState('');
  const [playingFeedbackId, setPlayingFeedbackId] = useState(null);

  const studentId = workspace.students?.find(s => s.name?.toLowerCase() === workspace.profile?.fullName?.toLowerCase())?.id || 's1';

  const quizzes = workspace.quizzes || [];
  const homework = workspace.homework || [];
  const tests = workspace.tests || [];
  const feedback = workspace.feedback || [];
  const resources = workspace.resources || [];

  const totalHw = homework.filter(hw =>
    !hw.classId ||
    hw.classId === classRecord.id ||
    hw.classId === classRecord.joinCode ||
    hw.joinCode === classRecord.joinCode ||
    hw.className === classRecord.name
  );
  const submittedHwCount = totalHw.filter(hw => hw.submissions?.some(s => s.studentId === studentId)).length;
  const homeworkProgress = totalHw.length ? Math.round((submittedHwCount / totalHw.length) * 100) : 100;

  const assessments = tests.filter(test => !test.classId || test.classId === classRecord.id || test.joinCode === classRecord.joinCode || test.className === classRecord.name);
  const studentFeedbacks = feedback.filter(f => f.studentId === studentId || f.classId === classRecord.id || f.classId === classRecord.joinCode);

  const storedMessages = workspace.chatThreads?.[classRecord.id] || [
    { from: 'them', text: `Welcome to ${classRecord.name}! Ask any questions here regarding ${classRecord.subject}.`, time: '09:00 AM' }
  ];

  function handleSubmitHomework(event) {
    event.preventDefault();
    if (!selectedHw || !hwContent.trim()) return;

    const newSubmission = {
      studentId,
      studentName: workspace.profile.fullName,
      submittedAt: new Date().toLocaleDateString(),
      content: hwContent.trim(),
      attachmentUrl: hwAttachment.trim() || null,
      status: 'Submitted'
    };

    updateWorkspace(current => ({
      ...current,
      homework: current.homework.map(h => {
        if (h.id !== selectedHw.id) return h;
        const otherSubmissions = (h.submissions || []).filter(s => s.studentId !== studentId);
        return {
          ...h,
          submissions: [...otherSubmissions, newSubmission]
        };
      })
    }));

    setHwContent('');
    setHwAttachment('');
    setSelectedHw(null);
  }

  function handleSendClassMessage(e) {
    e.preventDefault();
    if (!messageText.trim()) return;

    const newMsg = {
      from: 'me',
      text: messageText.trim(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    updateWorkspace(current => ({
      ...current,
      chatThreads: {
        ...(current.chatThreads || {}),
        [classRecord.id]: [...storedMessages, newMsg]
      }
    }));
    setMessageText('');
  }

  function submitQuiz(quiz) {
    let score = 0;
    const totalQuestions = quiz.questions?.length || 0;
    if (totalQuestions > 0) {
      quiz.questions.forEach((q, idx) => {
        if (quizAnswers[idx]?.trim().toLowerCase() === q.answer?.trim().toLowerCase()) {
          score += 1;
        }
      });
    }
    const scorePct = Math.round((score / (totalQuestions || 1)) * 100);
    setQuizScore(scorePct);

    const submissionRecord = {
      studentId,
      studentName: workspace.profile.fullName,
      score: scorePct,
      submittedAt: new Date().toISOString()
    };

    updateWorkspace(current => ({
      ...current,
      quizzes: current.quizzes.map(q => {
        if (q.id !== quiz.id) return q;
        const others = (q.submissions || []).filter(s => s.studentId !== studentId);
        return { ...q, submissions: [...others, submissionRecord] };
      })
    }));
  }

  return (
    <div className="class-workspace-content" style={{ padding: '24px', flex: 1, minWidth: 0, overflowY: 'auto' }}>
      <button className="button ghost" onClick={onBack} style={{ marginBottom: '14px' }}>
        <ArrowLeft size={16} /> All Subjects
      </button>

      {tab === 'progress' && (
        <div className="progress-tab-layout" style={{ display: 'grid', gap: '20px' }}>
          <section className="metric-grid">
            <article className="metric-card">
              <span className="metric-icon indigo"><BarChart3 size={19} /></span>
              <div><p>Overall Mastery</p><h3>{classRecord.progress || 82}%</h3><small>Subject progress</small></div>
            </article>
            <article className="metric-card">
              <span className="metric-icon amber"><FileText size={19} /></span>
              <div><p>Homework Progress</p><h3>{homeworkProgress}%</h3><small>{submittedHwCount} / {totalHw.length} submitted</small></div>
            </article>
            <article className="metric-card">
              <span className="metric-icon emerald"><Award size={19} /></span>
              <div><p>Published Tests</p><h3>{assessments.length}</h3><small>Exams scheduled</small></div>
            </article>
          </section>
        </div>
      )}

      {tab === 'homework' && (
        <article className="card workspace-table">
          <CardHeader eyebrow="HOMEWORK ASSIGNMENTS" title={`Assignments for ${classRecord.name}`} />
          <div style={{ display: 'grid', gap: '12px', marginTop: '15px' }}>
            {totalHw.map(hw => {
              const mySub = hw.submissions?.find(s => s.studentId === studentId);
              return (
                <div key={hw.id} style={{ padding: '14px', border: '1px solid var(--line)', borderRadius: '10px', background: 'var(--soft)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <b>{hw.title}</b>
                      <p style={{ margin: '4px 0 8px', fontSize: '12px', color: 'var(--text)' }}>{hw.description}</p>
                      <small style={{ color: 'var(--muted)' }}>Due Date: {hw.dueDate || hw.due || 'Friday'}</small>
                    </div>
                    <span className={`badge ${mySub ? 'success' : 'warning'}`}>
                      {mySub ? (mySub.status || 'Submitted') : 'Pending'}
                    </span>
                  </div>

                  {mySub ? (
                    <div style={{ marginTop: '10px', padding: '10px', background: 'var(--surface)', borderRadius: '8px', border: '1px solid var(--line)', fontSize: '11.5px' }}>
                      <b style={{ color: '#059669' }}>Your Submission:</b>
                      <p style={{ margin: '4px 0 0' }}>"{mySub.content}"</p>
                    </div>
                  ) : (
                    <button className="button primary" style={{ marginTop: '10px', background: '#4f46e5', color: '#fff', border: 0, padding: '6px 14px', borderRadius: '6px', fontSize: '11px', cursor: 'pointer' }} onClick={() => setSelectedHw(hw)}>
                      Submit Homework
                    </button>
                  )}
                </div>
              );
            })}
            {totalHw.length === 0 && <p className="workspace-empty">No homework assigned for this class yet.</p>}
          </div>

          {selectedHw && (
            <div className="modal-backdrop" style={{ zIndex: 95 }} onMouseDown={() => setSelectedHw(null)}>
              <form className="quick-modal" onMouseDown={e => e.stopPropagation()} onSubmit={handleSubmitHomework} style={{ maxWidth: '480px' }}>
                <div className="modal-head">
                  <h2>Submit: {selectedHw.title}</h2>
                  <button type="button" className="button ghost" onClick={() => setSelectedHw(null)}><X size={18} /></button>
                </div>
                <div className="field" style={{ margin: '14px 0' }}>
                  <span>Your Answer / Response</span>
                  <textarea
                    rows={4}
                    value={hwContent}
                    onChange={e => setHwContent(e.target.value)}
                    placeholder="Type your response here..."
                    required
                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--input)', color: 'var(--text)' }}
                  />
                </div>
                <div className="field" style={{ marginBottom: '14px' }}>
                  <span>Attachment URL (Optional)</span>
                  <input
                    value={hwAttachment}
                    onChange={e => setHwAttachment(e.target.value)}
                    placeholder="https://link-to-file.pdf"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--input)', color: 'var(--text)' }}
                  />
                </div>
                <div className="modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                  <button type="button" className="button ghost" onClick={() => setSelectedHw(null)}>Cancel</button>
                  <button type="submit" className="button primary" style={{ background: '#4f46e5', color: '#fff', border: 0, padding: '8px 16px', borderRadius: '8px' }}>Submit Work</button>
                </div>
              </form>
            </div>
          )}
        </article>
      )}

      {tab === 'tests' && (
        <article className="card workspace-table">
          <CardHeader eyebrow="FORMAL EXAMS" title="Assessments & Marks" />
          <div style={{ display: 'grid', gap: '12px', marginTop: '15px' }}>
            {assessments.map(t => (
              <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px', borderBottom: '1px solid var(--line)' }}>
                <div>
                  <b>{t.title}</b>
                  <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'var(--muted)' }}>{t.questions || 5} questions &middot; {t.marks || 50} total marks</p>
                </div>
                <span className="badge success">{t.status || 'Published'}</span>
              </div>
            ))}
            {assessments.length === 0 && <p className="workspace-empty">No formal assessments published for this class yet.</p>}
          </div>
        </article>
      )}

      {tab === 'quizzes' && (
        <article className="card workspace-table">
          <CardHeader eyebrow="PRACTICE QUIZZES" title="Classroom Quizzes" />
          <div style={{ display: 'grid', gap: '12px', marginTop: '15px' }}>
            {quizzes.filter(q => !q.classId || q.classId === classRecord.id).map(quiz => {
              const mySub = quiz.submissions?.find(s => s.studentId === studentId);
              return (
                <div key={quiz.id} style={{ padding: '14px', border: '1px solid var(--line)', borderRadius: '10px', background: 'var(--soft)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <b>{quiz.title}</b>
                      <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'var(--muted)' }}>{quiz.questions?.length || 0} Questions</p>
                    </div>
                    {mySub ? (
                      <span className="badge success">Score: {mySub.score}%</span>
                    ) : (
                      <button className="button primary" onClick={() => setActiveQuizId(quiz.id)}>Take Quiz</button>
                    )}
                  </div>

                  {activeQuizId === quiz.id && !mySub && (
                    <div style={{ marginTop: '14px', padding: '14px', background: 'var(--surface)', borderRadius: '8px', border: '1px solid var(--line)' }}>
                      {quiz.questions?.map((q, idx) => (
                        <div key={idx} style={{ marginBottom: '12px' }}>
                          <p style={{ fontWeight: 700, margin: '0 0 6px', fontSize: '12px' }}>{idx + 1}. {q.prompt}</p>
                          {q.options?.map((opt, oIdx) => (
                            <label key={oIdx} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', margin: '4px 0' }}>
                              <input
                                type="radio"
                                name={`q-${idx}`}
                                checked={quizAnswers[idx] === opt}
                                onChange={() => setQuizAnswers(prev => ({ ...prev, [idx]: opt }))}
                              />
                              <span>{opt}</span>
                            </label>
                          ))}
                        </div>
                      ))}
                      <button className="button primary" style={{ marginTop: '10px' }} onClick={() => submitQuiz(quiz)}>Submit Answers</button>
                    </div>
                  )}
                </div>
              );
            })}
            {quizzes.filter(q => !q.classId || q.classId === classRecord.id).length === 0 && (
              <p className="workspace-empty">No practice quizzes available yet.</p>
            )}
          </div>
        </article>
      )}

      {tab === 'feedback' && (
        <article className="card workspace-table">
          <CardHeader eyebrow="TEACHER FEEDBACK" title="Observations & Voice Corrections" />
          <div style={{ display: 'grid', gap: '12px', marginTop: '15px' }}>
            {studentFeedbacks.map(f => (
              <div key={f.id} style={{ padding: '14px', borderBottom: '1px solid var(--line)' }}>
                <b>{f.title || 'Paper Correction'}</b>
                <p style={{ fontSize: '12px', margin: '6px 0' }}>{f.text || f.summary}</p>
                {f.transcript && (
                  <div style={{ fontSize: '11px', background: 'var(--soft)', padding: '8px 12px', borderRadius: '6px', marginTop: '6px' }}>
                    <Volume2 size={12} style={{ display: 'inline', marginRight: '4px' }} /> "{f.transcript}"
                  </div>
                )}
              </div>
            ))}
            {studentFeedbacks.length === 0 && <p className="workspace-empty">No teacher feedback notes recorded yet.</p>}
          </div>
        </article>
      )}

      {tab === 'resources' && (
        <article className="card workspace-table">
          <CardHeader eyebrow="STUDY MATERIALS" title="Shared Class Resources" />
          <div style={{ display: 'grid', gap: '10px', marginTop: '15px' }}>
            {resources.filter(r => !r.classId || r.classId === classRecord.id).map(r => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', border: '1px solid var(--line)', borderRadius: '8px' }}>
                <div>
                  <b>{r.name}</b>
                  <small style={{ display: 'block', color: 'var(--muted)', fontSize: '10px' }}>{r.type} &middot; {r.fileName}</small>
                </div>
                <button className="button subtle" onClick={() => r.fileUrl ? window.open(r.fileUrl, '_blank') : alert(`Opening ${r.name}`)}>
                  <Download size={13} /> Download
                </button>
              </div>
            ))}
            {resources.filter(r => !r.classId || r.classId === classRecord.id).length === 0 && (
              <p className="workspace-empty">No learning resources shared by your teacher yet.</p>
            )}
          </div>
        </article>
      )}

      {tab === 'messages' && (
        <article className="card workspace-table">
          <CardHeader eyebrow="CLASS MESSAGES" title={`Conversation with your Teacher`} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '300px', overflowY: 'auto', padding: '12px', background: 'var(--soft)', borderRadius: '8px', margin: '14px 0' }}>
            {storedMessages.map((m, idx) => (
              <div key={idx} style={{ alignSelf: m.from === 'me' ? 'flex-end' : 'flex-start', maxWidth: '75%', padding: '10px 14px', borderRadius: '12px', background: m.from === 'me' ? '#4f46e5' : 'var(--surface)', color: m.from === 'me' ? '#fff' : 'var(--text)', border: m.from === 'me' ? 'none' : '1px solid var(--line)' }}>
                <p style={{ margin: 0, fontSize: '12px' }}>{m.text}</p>
                <small style={{ display: 'block', textAlign: 'right', fontSize: '9px', opacity: 0.8, marginTop: '4px' }}>{m.time}</small>
              </div>
            ))}
          </div>
          <form style={{ display: 'flex', gap: '8px' }} onSubmit={handleSendClassMessage}>
            <input
              value={messageText}
              onChange={e => setMessageText(e.target.value)}
              placeholder="Ask your teacher a question..."
              style={{ flex: 1, padding: '0 12px', height: '38px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--input)', color: 'var(--text)' }}
            />
            <button type="submit" className="button primary" style={{ background: '#4f46e5', color: '#fff', border: 0, padding: '0 16px', borderRadius: '8px', fontWeight: 700 }}>Send</button>
          </form>
        </article>
      )}
    </div>
  );
}

function SettingsView({ role, workspace, theme, onTheme, onSignOut }) {
  const [notifications, setNotifications] = useState({ homeworkAlerts: true, messageNotifs: true, assessmentUpdates: true });

  return (
    <div className="page role-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">{role.toUpperCase()} WORKSPACE</div>
          <h1>Workspace Settings</h1>
          <p>Manage your account preferences, theme, and notification settings.</p>
        </div>
      </div>

      <section className="role-grid">
        <article className="card">
          <CardHeader eyebrow="APPEARANCE" title="Theme Preference" />
          <p className="role-card-copy">Customize how TeachMate looks on your device.</p>
          <div style={{ marginTop: '15px', display: 'flex', gap: '12px' }}>
            <button className={`button ${theme === 'light' ? 'primary' : 'ghost'}`} onClick={onTheme}>
              ☀️ Light Theme
            </button>
            <button className={`button ${theme === 'dark' ? 'primary' : 'ghost'}`} onClick={onTheme}>
              🌙 Dark Theme
            </button>
          </div>
        </article>

        <article className="card">
          <CardHeader eyebrow="NOTIFICATIONS" title="Alert Preferences" />
          <div style={{ display: 'grid', gap: '12px', marginTop: '15px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12px' }}>
              <input type="checkbox" checked={notifications.homeworkAlerts} onChange={e => setNotifications(prev => ({ ...prev, homeworkAlerts: e.target.checked }))} />
              <span>Receive homework deadline reminders</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12px' }}>
              <input type="checkbox" checked={notifications.messageNotifs} onChange={e => setNotifications(prev => ({ ...prev, messageNotifs: e.target.checked }))} />
              <span>Class chat and teacher message notifications</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12px' }}>
              <input type="checkbox" checked={notifications.assessmentUpdates} onChange={e => setNotifications(prev => ({ ...prev, assessmentUpdates: e.target.checked }))} />
              <span>Assessment publishing alerts</span>
            </label>
          </div>
        </article>

        <article className="card">
          <CardHeader eyebrow="ACCOUNT IDENTITY" title="User Details" />
          <p style={{ fontSize: '12px', margin: '8px 0' }}><strong>Name:</strong> {workspace.profile?.fullName || 'User Account'}</p>
          <p style={{ fontSize: '12px', margin: '8px 0' }}><strong>Email:</strong> {workspace.profile?.email || 'user@school.edu'}</p>
          <p style={{ fontSize: '12px', margin: '8px 0' }}><strong>School:</strong> {workspace.profile?.schoolName || 'TeachMate School'}</p>
          <p style={{ fontSize: '12px', margin: '8px 0' }}><strong>Role:</strong> {roleLabels[role]}</p>
        </article>

        <article className="card">
          <CardHeader eyebrow="SESSION MANAGEMENT" title="Account Sign Out" />
          <p className="role-card-copy">Safely end your active session and sign out of your account workspace.</p>
          <div style={{ marginTop: '15px' }}>
            <button
              type="button"
              className="button danger-outline"
              style={{ padding: '10px 18px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: '8px', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              onClick={() => {
                if (onSignOut) onSignOut();
                else window.location.reload();
              }}
            >
              Sign out / Logout
            </button>
          </div>
        </article>
      </section>
    </div>
  );
}

function HomeworkView({ workspace, setPage }) {
  const homework = workspace.homework || [];
  return (
    <div className="page role-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">ASSIGNMENTS</div>
          <h1>Homework & Submissions</h1>
          <p>Review and submit your assigned homework for your classes.</p>
        </div>
      </div>
      <article className="card workspace-table">
        <CardHeader eyebrow="ALL ASSIGNMENTS" title="Homework Items" />
        <div style={{ display: 'grid', gap: '12px', marginTop: '15px' }}>
          {homework.map(hw => (
            <div key={hw.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px', borderBottom: '1px solid var(--line)' }}>
              <div>
                <b>{hw.title}</b>
                <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'var(--muted)' }}>{hw.className || 'Class'} &middot; Due: {hw.dueDate || hw.due || 'Friday'}</p>
              </div>
              <button className="button subtle" onClick={() => setPage('subjects')}>Open Subject</button>
            </div>
          ))}
          {homework.length === 0 && <p className="workspace-empty">No homework assigned yet.</p>}
        </div>
      </article>
    </div>
  );
}

function CalendarView({ role, workspace, setPage }) {
  const classesById = new Map((workspace.classes || []).map(item => [item.id, item]));
  const dateValue = (value) => {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };
  const dateLabel = (value) => {
    const parsed = dateValue(value);
    return parsed ? parsed.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : 'No date set';
  };
  const eventClass = (item) => classesById.get(item.classId) || (workspace.classes || []).find(record => record.name === item.className);
  const events = [
    ...(workspace.homework || []).map(item => ({ id: `homework-${item.id}`, type: 'Homework', title: item.title, date: item.due || item.dueDate, classRecord: eventClass(item) })),
    ...(workspace.tests || []).map(item => ({ id: `assessment-${item.id}`, type: 'Assessment', title: item.title, date: item.due, classRecord: eventClass(item) })),
    ...(workspace.quizzes || []).map(item => ({ id: `quiz-${item.id}`, type: 'Quiz', title: item.title, date: item.due || item.startTime, classRecord: eventClass(item) })),
    ...(workspace.timetable || []).map(item => ({ id: `class-${item.id}`, type: 'Class', title: item.topic || item.subject || 'Scheduled class', date: item.startsAt || item.date, classRecord: classesById.get(item.classId) }))
  ]
    .filter(item => dateValue(item.date))
    .sort((left, right) => dateValue(left.date) - dateValue(right.date));

  return (
    <div className="page role-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">{role === 'student' ? 'MY SCHEDULE' : 'WORKSPACE SCHEDULE'}</div>
          <h1>Calendar</h1>
          <p>Upcoming class dates, homework, assessments, and quizzes from this workspace.</p>
        </div>
        <button className="button subtle" onClick={() => setPage('dashboard')}>Back to dashboard</button>
      </div>
      <article className="card workspace-table">
        <CardHeader eyebrow="UPCOMING" title="Scheduled learning" />
        <div style={{ display: 'grid', gap: '10px', marginTop: '15px' }}>
          {events.map(event => (
            <article key={event.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', border: '1px solid var(--line)', borderRadius: '10px', background: 'var(--soft)' }}>
              <span className="file-icon"><CalendarCheck size={18} /></span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <b>{event.title}</b>
                <p style={{ margin: '3px 0 0', color: 'var(--muted)', fontSize: '11px' }}>{event.type} · {event.classRecord?.name || 'Classroom'}{event.classRecord?.subject ? ` · ${event.classRecord.subject}` : ''}</p>
              </div>
              <span className="badge info">{dateLabel(event.date)}</span>
            </article>
          ))}
          {events.length === 0 && <p className="workspace-empty">There are no dated class activities in your workspace yet.</p>}
        </div>
      </article>
    </div>
  );
}

function AssessmentsView({ workspace }) {
  const tests = workspace.tests || [];
  return (
    <div className="page role-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">ASSESSMENTS</div>
          <h1>Formal Assessments & Marks</h1>
          <p>Review test scores and evaluation results.</p>
        </div>
      </div>
      <article className="card workspace-table">
        <CardHeader eyebrow="RESULTS" title="Published Assessments" />
        <div style={{ display: 'grid', gap: '12px', marginTop: '15px' }}>
          {tests.map(t => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px', borderBottom: '1px solid var(--line)' }}>
              <div>
                <b>{t.title}</b>
                <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'var(--muted)' }}>{t.className || 'Class'} &middot; {t.questions || 5} questions</p>
              </div>
              <span className="badge success">{t.marks || 50} Marks</span>
            </div>
          ))}
          {tests.length === 0 && <p className="workspace-empty">No formal assessments published yet.</p>}
        </div>
      </article>
    </div>
  );
}

function FeedbackView({ workspace, authToken }) {
  const feedback = workspace.feedback || [];
  const [voiceFeedback, setVoiceFeedback] = useState(() => (workspace.voiceFeedback || []).filter(item => item.studentId === workspace.profile?.id));
  const [voiceFeedbackError, setVoiceFeedbackError] = useState('');

  useEffect(() => {
    let active = true;
    if (!authToken) return () => { active = false; };
    apiRequest('/student/voice-feedback', { token: authToken })
      .then(result => {
        if (active) setVoiceFeedback(result.feedback || []);
      })
      .catch(error => {
        if (active) setVoiceFeedbackError(error.message || 'Voice feedback is unavailable right now.');
      });
    return () => { active = false; };
  }, [authToken]);

  return (
    <div className="page role-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">TEACHER FEEDBACK</div>
          <h1>Teacher Evaluation Notes</h1>
          <p>Personalized observations and feedback from your instructors.</p>
        </div>
      </div>
      <article className="card workspace-table">
        <CardHeader eyebrow="TIMELINE" title="Recent Observations" />
        <div style={{ display: 'grid', gap: '12px', marginTop: '15px' }}>
          {feedback.map(f => (
            <div key={f.id} style={{ padding: '14px', borderBottom: '1px solid var(--line)' }}>
              <b>{f.title || f.assessmentTitle || 'Class Observation'}</b>
              <p style={{ fontSize: '12px', margin: '6px 0' }}>{f.text || f.summary}</p>
            </div>
          ))}
          {feedback.length === 0 && <p className="workspace-empty">No feedback notes recorded yet.</p>}
        </div>
      </article>
      <article className="card workspace-table" style={{ marginTop: '18px' }}>
        <CardHeader eyebrow="PRIVATE AUDIO" title="Voice feedback from your teacher" />
        <div style={{ display: 'grid', gap: '12px', marginTop: '15px' }}>
          {voiceFeedback.map(item => (
            <div key={item.id} style={{ padding: '14px', borderBottom: '1px solid var(--line)' }}>
              <b>{item.title || 'Voice feedback'}</b>
              <p style={{ fontSize: '11px', margin: '5px 0', color: 'var(--muted)' }}>{item.publishedAt ? `Published ${new Date(item.publishedAt).toLocaleString()}` : 'Published voice feedback'}</p>
              {item.signedUrl ? <audio controls preload="metadata" src={item.signedUrl} style={{ width: '100%' }} /> : <p className="workspace-empty" style={{ margin: '6px 0 0' }}>The audio is temporarily unavailable. Refresh to get a new private link.</p>}
            </div>
          ))}
          {voiceFeedbackError && <p className="form-error">{voiceFeedbackError}</p>}
          {!voiceFeedback.length && !voiceFeedbackError && <p className="workspace-empty">No voice feedback has been published for you yet.</p>}
        </div>
      </article>
    </div>
  );
}

function ProfileView({ workspace }) {
  const profile = workspace.profile || {};
  return (
    <div className="page role-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">IDENTITY</div>
          <h1>User Profile</h1>
          <p>Your official school membership details.</p>
        </div>
      </div>
      <article className="card" style={{ maxWidth: '500px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px', marginBottom: '20px' }}>
          <span className="avatar gradient" style={{ height: '54px', width: '54px', fontSize: '20px' }}>{initials(profile.fullName)}</span>
          <div>
            <h2 style={{ margin: 0 }}>{profile.fullName || 'User Name'}</h2>
            <p style={{ margin: '2px 0 0', color: 'var(--muted)', fontSize: '12px' }}>{profile.email || 'user@school.edu'}</p>
          </div>
        </div>
        <p style={{ fontSize: '12px', margin: '8px 0' }}><strong>School Name:</strong> {profile.schoolName || 'TeachMate Academy'}</p>
        <p style={{ fontSize: '12px', margin: '8px 0' }}><strong>Account Role:</strong> {profile.role || 'Student'}</p>
        <p style={{ fontSize: '12px', margin: '8px 0' }}><strong>Enrolled Class ID:</strong> <code>{profile.classId || 'TM-DEMO'}</code></p>
      </article>
    </div>
  );
}

export default function RolePortal({ role, page, workspace, updateWorkspace, setPage, activeSubjectId, onOpenSubject, onBackSubject, authToken, activeSubjectTab, setActiveSubjectTab, mobileOpen, closeMobile, theme, onTheme, onSignOut, onToast }) {
  const [joinModalOpen, setJoinModalOpen] = useState(false);

  if (page === 'dashboard') {
    return (
      <>
        <RoleDashboard
          role={role}
          workspace={workspace}
          setPage={setPage}
          onOpenSubject={onOpenSubject}
          onJoinClassClick={() => setJoinModalOpen(true)}
        />
        <JoinClassModal
          open={joinModalOpen}
          onClose={() => setJoinModalOpen(false)}
          authToken={authToken}
          workspace={workspace}
          updateWorkspace={updateWorkspace}
          onToast={onToast || alert}
        />
      </>
    );
  }
  
  if (role === 'admin' && page === 'classes') {
    return (
      <div className="page role-page">
        <div className="page-heading">
          <div><div className="eyebrow">SCHOOL ADMINISTRATION</div><h1>Class management</h1><p>Open a class record to review its teacher, learners, Class Invite Code, and activity.</p></div>
        </div>
        <section className="role-subject-grid">
          {workspace.classes.map(classRecord => (
            <article className="card role-subject-card" key={classRecord.id}>
              <span className="file-icon"><BookOpen size={20} /></span>
              <h3>{classRecord.name}</h3>
              <p>{classRecord.subject}</p>
              {classRecord.joinCode && <span className="class-id-chip">Invite Code: {classRecord.joinCode}</span>}
              <span className="subject-open">{classRecord.students || 0} learners &middot; {classRecord.progress || 0}% mastery</span>
            </article>
          ))}
          {workspace.classes.length === 0 && <p className="workspace-empty">No active classes registered yet.</p>}
        </section>
      </div>
    );
  }

  if (role === 'student' && page === 'subjects') {
    const active = workspace.classes.find(item => item.id === activeSubjectId);
    if (active) {
      return (
        <div className="class-workspace-shell">
          <StudentClassSidebar
            profile={workspace.profile}
            classRecord={active}
            tab={activeSubjectTab}
            setTab={setActiveSubjectTab}
            mobileOpen={mobileOpen}
            closeMobile={closeMobile}
            onBack={onBackSubject}
          />
          <StudentClassWorkspace
            classRecord={active}
            onBack={onBackSubject}
            authToken={authToken}
            workspace={workspace}
            updateWorkspace={updateWorkspace}
            tab={activeSubjectTab}
            setTab={setActiveSubjectTab}
          />
        </div>
      );
    }
    return (
      <>
        <div className="page role-page">
          <div className="page-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div><div className="eyebrow">STUDENT WORKSPACE</div><h1>My subjects</h1><p>Open a subject to see its own progress, tests, feedback, and resources.</p></div>
            <button className="button primary" onClick={() => setJoinModalOpen(true)} style={{ background: '#4f46e5', color: '#fff', border: 0, padding: '8px 16px', borderRadius: '8px', fontWeight: 700, cursor: 'pointer' }}>
              <Plus size={16} /> Join Class
            </button>
          </div>
          <section className="role-subject-grid">
            {workspace.classes.map(classRecord => (
              <button className="card role-subject-card" key={classRecord.id} onClick={() => onOpenSubject(classRecord.id)}>
                <span className="file-icon"><BookOpen size={20} /></span>
                <h3>{classRecord.name}</h3>
                <p>{classRecord.subject}</p>
                {classRecord.joinCode && <span className="class-id-chip">Invite Code: {classRecord.joinCode}</span>}
                <span className="subject-open">Open subject <ArrowUpRight size={15} /></span>
              </button>
            ))}
            {workspace.classes.length === 0 && (
              <div className="card" style={{ padding: '30px', textAlign: 'center', width: '100%', gridColumn: '1 / -1' }}>
                <span className="metric-icon indigo" style={{ height: '44px', width: '44px', margin: '0 auto 12px' }}><GraduationCap size={24} /></span>
                <h3>No subjects joined yet</h3>
                <p style={{ fontSize: '12px', color: 'var(--muted)', margin: '4px 0 16px' }}>Enter a Class Invite Code from your teacher to join your classroom.</p>
                <button className="button primary" onClick={() => setJoinModalOpen(true)} style={{ background: '#4f46e5', color: '#fff', border: 0, padding: '8px 18px', borderRadius: '8px', fontWeight: 700, cursor: 'pointer' }}>
                  Join Class
                </button>
              </div>
            )}
          </section>
        </div>
        <JoinClassModal
          open={joinModalOpen}
          onClose={() => setJoinModalOpen(false)}
          authToken={authToken}
          workspace={workspace}
          updateWorkspace={updateWorkspace}
          onToast={onToast || alert}
        />
      </>
    );
  }

  // Handle individual rich sub-pages
  if (page === 'calendar') return <CalendarView role={role} workspace={workspace} setPage={setPage} />;
  if (page === 'settings') return <SettingsView role={role} workspace={workspace} theme={theme} onTheme={onTheme} onSignOut={onSignOut} />;
  if (page === 'homework' || page === 'assignments') return <HomeworkView workspace={workspace} setPage={setPage} />;
  if (page === 'assessments' || page === 'tests' || page === 'marks') return <AssessmentsView workspace={workspace} />;
  if (page === 'feedback' || page === 'voiceFeedback') return <FeedbackView workspace={workspace} authToken={authToken} />;
  if (page === 'profile') return <ProfileView workspace={workspace} />;

  const [title, copy] = portalCopy[role]?.pages[page] || ['Workspace Overview', 'Review your classroom metrics and operations.'];
  return (
    <div className="page role-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">{roleLabels[role].toUpperCase()} WORKSPACE</div>
          <h1>{title}</h1>
          <p>{copy}</p>
        </div>
      </div>
      <section className="role-subject-grid">
        {workspace.classes.map(item => (
          <article className="card role-subject-card" key={item.id}>
            <span className="file-icon"><BookOpen size={20} /></span>
            <h3>{item.name}</h3>
            <p>{item.subject}</p>
            <button className="subject-open" onClick={() => setPage(role === 'student' ? 'subjects' : 'classes')}>
              View Data <ArrowUpRight size={15} />
            </button>
          </article>
        ))}
      </section>
    </div>
  );
}
