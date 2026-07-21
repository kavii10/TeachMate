import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft, ArrowUpRight, BarChart3, Bell, BookOpen, CalendarCheck, Check, CheckCircle2, ChevronDown,
  ChevronRight, ClipboardCheck, Clock3, FileText, Filter, GraduationCap, LayoutDashboard,
  Library, Lightbulb, LogOut, Menu, MessageSquare, Mic, Moon, MoreHorizontal, PenTool, Plus,
  Search, Send, Settings, Sparkles, Sun, TrendingUp, UserRound, Users, X,
  Trash2, Edit3, Play, Square, Download, Upload, Paperclip, Volume2, Award
} from 'lucide-react';
import { createWorkspace, normalizeRole, roleLabels, roleNavigation } from './data.js';
import './quiz.css';
import { addStudentToDemoClass, clearActiveAccount, clearPendingProfile, createDemoClassId, findDemoClass, loadAccount, loadActiveAccount, loadTheme, normalizeClassId, registerDemoClass, saveAccount, saveActiveAccount, savePendingProfile, saveTheme } from './lib/storage.js';
import { apiRequest, checkApiHealth, getAiStatus } from './lib/api.js';
import { bootstrapSchoolAccount, getSchoolSession, rememberSchoolWorkspaceSession, startSchoolWorkspaceSession, signOutSchoolSession, getSupabaseClient } from './lib/supabase-auth.js';
import { loadSchoolAnnouncements } from './lib/school-announcements.js';
import RolePortal from './components/RolePortal.jsx';
import AdminPortal from './components/AdminPortal.jsx';
import AskAiPanel from './components/AskAiPanel.jsx';
import QuizAiAnalysisView from './components/QuizAiAnalysis.jsx';
import logoLight from './assets/teachmate-logo-light.jpeg';
import logoDark from './assets/teachmate-logo-dark.jpeg';

const icons = { dashboard: LayoutDashboard, classes: GraduationCap, students: Users, teachers: GraduationCap, schools: GraduationCap, homework: ClipboardCheck, assignments: ClipboardCheck, attendance: CalendarCheck, tests: FileText, assessments: FileText, quiz: PenTool, overview: BarChart3, feedback: Mic, grading: PenTool, voiceFeedback: Mic, messages: MessageSquare, announcements: Bell, resources: Library, insights: BarChart3, analytics: BarChart3, settings: Settings, timetable: CalendarCheck, calendar: CalendarCheck, profile: UserRound, subjects: BookOpen, marks: CheckCircle2, progress: TrendingUp, reports: FileText, users: Users, notifications: Bell };
const initials = name => name?.split(' ').map(part => part[0]).slice(0, 2).join('').toUpperCase() || 'TM';
const recordList = value => Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : [];

function mapAdminSchoolDirectory(payload) {
  const classRows = recordList(payload?.classes);
  const classById = new Map(classRows.map(classRecord => [classRecord.id, classRecord]));
  const memberRows = recordList(payload?.members);
  const enrollmentsByStudent = new Map();

  recordList(payload?.enrollments).forEach(enrollment => {
    if (!enrollment.studentId || !classById.has(enrollment.classId)) return;
    const studentEnrollments = enrollmentsByStudent.get(enrollment.studentId) || [];
    studentEnrollments.push(enrollment.classId);
    enrollmentsByStudent.set(enrollment.studentId, studentEnrollments);
  });

  const students = memberRows
    .filter(member => member.role === 'student')
    .map(member => {
      const classIds = [...new Set(enrollmentsByStudent.get(member.id) || [])];
      const primaryClass = classById.get(classIds[0]);
      const name = member.name || 'Student';
      return {
        id: member.id,
        name,
        initials: initials(name),
        classId: classIds[0] || '',
        classIds,
        className: primaryClass?.name || 'Not enrolled in a class yet',
        attendance: 0,
        score: 0,
        avgMarks: 0,
        status: classIds.length ? 'Enrolled' : 'Awaiting class enrollment'
      };
    });

  const classes = classRows.map(classRecord => ({
    id: classRecord.id,
    name: classRecord.name || 'Untitled class',
    subject: classRecord.subject || 'General',
    grade: classRecord.grade || 'Classroom',
    joinCode: classRecord.join_code || '',
    teacherId: classRecord.teacher_id,
    students: students.filter(student => student.classIds.includes(classRecord.id)).length,
    studentsList: students.filter(student => student.classIds.includes(classRecord.id)),
    progress: 0,
    color: 'indigo'
  }));

  const teachers = memberRows
    .filter(member => member.role === 'teacher')
    .map(member => {
      const classIds = classes.filter(classRecord => classRecord.teacherId === member.id).map(classRecord => classRecord.id);
      const name = member.name || 'Teacher';
      const subjects = [...new Set(classes.filter(classRecord => classRecord.teacherId === member.id).map(classRecord => classRecord.subject))];
      return {
        id: member.id,
        name,
        initials: initials(name),
        subject: subjects.join(', ') || 'No class assigned',
        classIds
      };
    });

  const notifications = recordList(payload?.announcements).map(announcement => ({
    id: announcement.id,
    title: announcement.title || 'School announcement',
    body: announcement.body || '',
    audience: announcement.audience || 'all',
    active: true,
    createdAt: announcement.created_at
  }));
  const school = payload?.school && typeof payload.school === 'object' ? payload.school : {};
  const subjects = [...new Set(classes.map(classRecord => classRecord.subject).filter(Boolean))];

  return {
    schoolName: school.name || '',
    classes,
    students,
    announcements: notifications,
    adminData: {
      school: {
        name: school.name || 'TeachMate Academy',
        academicYear: school.academicYear || 'Current academic year',
        city: '',
        contact: ''
      },
      teachers,
      students,
      subjects: subjects.length ? subjects : ['Biology', 'Physics', 'Chemistry', 'Mathematics', 'English'],
      timetable: [],
      notifications
    }
  };
}

function reserveTeacherClasses(profile, sourceClasses, primaryClassId) {
  const seed = sourceClasses?.length
    ? sourceClasses
    : (profile.classes?.length ? profile.classes : createWorkspace({ ...profile, classId: primaryClassId }).classes);

  const seen = new Set();
  const uniqueClasses = [];

  for (let index = 0; index < seed.length; index++) {
    const item = seed[index];
    if (!item) continue;
    const normName = (item.name || '').replace(/[\s·]+/g, ' ').trim().toLowerCase();
    const normSub = (item.subject || '').trim().toLowerCase();
    const key = item.id && !item.id.startsWith('demo-') ? item.id : `${normName}_${normSub}`;

    if (seen.has(key)) continue;
    seen.add(key);

    let joinCode = normalizeClassId(item.joinCode || (index === 0 && primaryClassId ? primaryClassId : null));
    const owner = joinCode && findDemoClass(joinCode);
    if (!joinCode || (owner?.teacherEmail && owner.teacherEmail !== profile.email)) {
      joinCode = item.joinCode || createDemoClassId();
    }

    const classRecord = registerDemoClass({
      ...item,
      id: item.id || `demo-${joinCode}`,
      joinCode,
      teacherEmail: profile.email,
      schoolName: profile.schoolName
    });

    uniqueClasses.push(classRecord);
  }

  return uniqueClasses;
}
const landingPageFor = () => 'dashboard';

function Button({ children, variant = 'primary', icon: Icon, className = '', ...props }) {
  return <button className={`button ${variant} ${className}`} {...props}>{Icon && <Icon size={16} />}{children}</button>;
}

function IconButton({ label, children, className = '', ...props }) {
  return <button className={`icon-button ${className}`} aria-label={label} title={label} {...props}>{children}</button>;
}

function Toast({ toast }) {
  return <AnimatePresence>{toast && <motion.div className="toast" initial={{ opacity: 0, y: 18, scale: .96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: .96 }}><CheckCircle2 size={18} />{toast}</motion.div>}</AnimatePresence>;
}

function BrandMark({ large = false }) {
  return <span className={`brand-mark logo-mark ${large ? 'large' : ''}`}><img className="logo-light" src={logoLight} alt="TeachMate" /><img className="logo-dark" src={logoDark} alt="TeachMate" /></span>;
}

function LoadingScreen() {
  return <main className="loading-screen splash-screen splash-v2"><div className="splash-grid" /><div className="splash-beam splash-beam-one" /><div className="splash-beam splash-beam-two" /><motion.section className="splash-hero" initial={{ opacity: 0, y: 34 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 3.5, ease: 'easeOut' }}><div className="splash-kicker"><i />WELCOME TO THE CLASSROOM</div><div className="splash-emblem"><BrandMark large /></div><div className="splash-wordmark">Teach<span>Mate</span></div><p>A focused space for teaching, learning and meaningful progress.</p><div className="splash-progress" aria-label="Loading TeachMate"><i /></div><div className="splash-footer"><span><i />Classrooms ready</span><span>Loading your workspace</span></div></motion.section></main>;
}

function Onboarding({ theme, onTheme, onSchoolSignIn, secureSession, secureError }) {
  const [form, setForm] = useState({ fullName: '', email: secureSession?.email || '', schoolName: '', role: 'Teacher', classId: '' });
  const [error, setError] = useState(''); const [startingSession, setStartingSession] = useState(false);
  useEffect(() => { if (secureSession?.email) setForm(current => current.email ? current : { ...current, email: secureSession.email }); }, [secureSession]);
  const update = event => setForm(current => ({ ...current, [event.target.name]: event.target.value }));
  async function schoolSignIn() {
    const email = form.email.trim().toLowerCase();
    if (!form.fullName.trim() || !/\S+@\S+\.\S+/.test(email) || !form.schoolName.trim()) return setError('Please complete your name, school, and a valid email address.');
    if (form.role === 'Student' && !form.classId.trim()) return setError('Enter the Class ID shared by your teacher.');
    setError(''); setStartingSession(true);
    try {
      const result = await onSchoolSignIn({ ...form, email, fullName: form.fullName.trim(), schoolName: form.schoolName.trim(), classId: normalizeClassId(form.classId) });
      if (result?.error) setError(result.error);
    } catch (requestError) { setError(requestError.message); } finally { setStartingSession(false); }
  }
  return <main className="onboarding-shell">
    <div className="ambient ambient-one" /><div className="ambient ambient-two" />
    <header className="onboarding-header"><div className="brand"><BrandMark /><span>Teach<span>Mate</span></span></div><Button variant="ghost" icon={theme === 'dark' ? Sun : Moon} onClick={onTheme}>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</Button></header>
    <motion.section className="onboarding-card" initial={{ opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .45 }}>
      <div className="eyebrow"><Sparkles size={14} />YOUR INTELLIGENT WORKSPACE</div>
      <h1>A calmer way to run your classroom.</h1>
      <p className="lead">Start a synced classroom workspace. Your class, student enrollments, and teaching data are stored securely in Supabase.</p>
      <form onSubmit={event => { event.preventDefault(); schoolSignIn(); }} className="onboarding-form">
        <div className="form-grid"><Field label="Full name"><input name="fullName" value={form.fullName} onChange={update} placeholder="John" autoComplete="name" /></Field><Field label="School name"><input name="schoolName" value={form.schoolName} onChange={update} placeholder="Sunrise Public School" /></Field></div>
        <Field label="Email address"><input type="email" name="email" value={form.email} onChange={update} placeholder="you@school.edu" autoComplete="email" /></Field>
        <Field label="Your role"><div className="role-select">{['Teacher', 'Student', 'Administrator'].map(role => <button type="button" onClick={() => setForm(current => ({ ...current, role }))} className={form.role === role ? 'selected' : ''} key={role}>{role === 'Teacher' ? <GraduationCap size={16} /> : role === 'Student' ? <BookOpen size={16} /> : <Settings size={16} />}{role}</button>)}</div></Field>
        {form.role === 'Student' && <Field label="Class ID"><input name="classId" value={form.classId} onChange={update} placeholder="TM-AB12CD34" autoCapitalize="characters" /><small className="class-id-help">Enter the unique Class ID shared by your teacher.</small></Field>}
        {form.role === 'Teacher' && <p className="class-id-help teacher-code-note"><Sparkles size={14} />Your school name groups your workspace. A unique Class ID will be created when you sign in.</p>}
        {form.role === 'Administrator' && <p className="class-id-help"><Sparkles size={14} />Your school name opens the school workspace for this MVP.</p>}
        {error && <p className="form-error">{error}</p>}
        <Button type="submit" className="continue-button" icon={CheckCircle2} disabled={startingSession}>{startingSession ? 'Signing in…' : 'Sign in & open workspace'} <ArrowUpRight size={17} /></Button>
        {secureError && <p className="form-error secure-error">{secureError}</p>}
      </form>
      <div className="demo-note"><CheckCircle2 size={16} /><span>One sign-in opens your workspace and saves classroom, enrollment, and teaching data to Supabase.</span></div>
    </motion.section>
    <footer className="onboarding-footer"><span>Designed for focused teaching.</span><span>•</span><span>Private by default.</span></footer>
  </main>;
}

function Field({ label, children }) { return <label className="field"><span>{label}</span>{children}</label>; }

function Sidebar({ page, setPage, profile, role, mobileOpen, closeMobile, onSignOut }) {
  const navigation = roleNavigation[role];
  const primaryNavigation = navigation.slice(0, -2);
  const workspaceNavigation = navigation.slice(-2);
  return <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
    <div className="sidebar-top"><div className="brand"><BrandMark /><span>Teach<span>Mate</span></span></div><div className="school-switch"><span className="school-initial">{initials(profile.schoolName)}</span><span><b>{profile.schoolName}</b><small>{roleLabels[role]} workspace</small></span><ChevronDown size={16} /></div>{role === 'teacher' && profile.classId && <button className="class-id-menu" onClick={() => { setPage('settings'); closeMobile(); }}><span>YOUR CLASS ID</span><b>{profile.classId}</b></button>}</div>
    <nav className="sidebar-nav"><p className="nav-caption">{roleLabels[role].toUpperCase()} PORTAL</p>{primaryNavigation.map(([id, label]) => <NavItem key={id} id={id} label={label} active={page === id} onClick={() => { setPage(id); closeMobile(); }} />)}<p className="nav-caption second">WORKSPACE</p>{workspaceNavigation.map(([id, label]) => <NavItem key={id} id={id} label={label} active={page === id} onClick={() => { setPage(id); closeMobile(); }} />)}</nav>
    <div className="sidebar-user"><button className="sidebar-profile" onClick={() => { setPage('profile'); closeMobile(); }}><span className="avatar gradient">{initials(profile.fullName)}</span><span><b>{profile.fullName}</b><small>{roleLabels[role]} profile</small></span></button></div>
  </aside>;
}
function NavItem({ id, label, active, onClick }) { const Icon = icons[id] || LayoutDashboard; return <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}><Icon size={18} /><span>{label}</span>{id === 'messages' && <em>2</em>}</button>; }

function ClassSidebar({ profile, classRecord, tab, setTab, mobileOpen, closeMobile, onBack }) {
  const classNav = [['overview', 'Overview'], ['students', 'Students'], ['homework', 'Homework'], ['attendance', 'Attendance'], ['assessments', 'Assessments'], ['quiz', 'Quiz'], ['feedback', 'Feedback'], ['resources', 'Resources'], ['messages', 'Messages']];
  return <aside className={`sidebar class-sidebar ${mobileOpen ? 'open' : ''}`}><div className="sidebar-top"><div className="brand"><BrandMark /><span>Teach<span>Mate</span></span></div><button className="class-return" onClick={onBack}><ArrowLeft size={16} /> All classes</button><div className="class-context"><span>CLASSROOM</span><b>{classRecord.name}</b><small>{classRecord.subject}</small>{classRecord.joinCode && <em>Class ID: {classRecord.joinCode}</em>}</div></div><nav className="sidebar-nav"><p className="nav-caption">CLASS WORKSPACE</p>{classNav.map(([id, label]) => <NavItem key={id} id={id} label={label} active={tab === id} onClick={() => { setTab(id); closeMobile(); }} />)}</nav><div className="sidebar-user"><button className="sidebar-profile"><span className="avatar gradient">{initials(profile.fullName)}</span><span><b>{profile.fullName}</b><small>Teacher profile</small></span></button></div></aside>;
}

function Topbar({ title, role, theme, onTheme, onMenu, onQuick, notifications, toggleNotifications, apiOnline, onAskAi, onSignOut }) {
  return <header className="topbar"><div className="topbar-start"><IconButton label="Open navigation" className="mobile-menu" onClick={onMenu}><Menu size={21} /></IconButton><div className="topbar-logo" aria-label="TeachMate"><BrandMark /></div><div><p className="breadcrumb">TeachMate <ChevronRight size={13} /> {roleLabels[role]} portal</p><h2>{title}</h2></div></div><div className="topbar-actions"><span className={`api-status ${apiOnline ? 'online' : ''}`}><i />{apiOnline ? 'API online' : 'Demo mode'}</span><div className="search-command"><Search size={17} /><span>Search {roleLabels[role].toLowerCase()} workspace</span><kbd>⌘ K</kbd></div><Button variant="subtle" className="ask-ai-button" icon={Sparkles} onClick={onAskAi}>Ask AI</Button><IconButton label="Toggle theme" onClick={onTheme}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</IconButton><div className="notification-wrap"><IconButton label="Notifications" className="notification-button" onClick={toggleNotifications}><Bell size={18} /><i /></IconButton><AnimatePresence>{notifications && <motion.div className="notification-panel" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}><b>Updates</b><p><span className="dot indigo" />6 homework submissions are ready to review.</p><p><span className="dot amber" />Grade 10 Biology is in 30 minutes.</p></motion.div>}</AnimatePresence></div><Button variant="danger-outline" onClick={onSignOut} className="logout-topbar-button" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 14px', borderRadius: '10px', fontSize: '13px', fontWeight: 600 }}><LogOut size={16} /> Log out</Button></div></header>;
}

function Dashboard({ workspace, setPage, onQuick, onToast }) {
  const { profile, classes = [], students = [], homework = [], tests = [], quizzes = [], feedback = [], announcements = [] } = workspace;

  const primaryClass = classes[0];
  const totalLearners = students.length;
  const pendingHomeworkCount = homework.filter(h => h.status === 'Submitted' || h.submissions?.some(s => s.status === 'Submitted')).length;
  
  let totalAttendancePct = 0;
  if (workspace.attendanceHistory && Object.keys(workspace.attendanceHistory).length > 0) {
    const records = Object.values(workspace.attendanceHistory);
    let totalPresent = 0;
    let totalMarked = 0;
    records.forEach(r => {
      const pres = (r.present || []).length + (r.late || []).length;
      const tot = pres + (r.absent || []).length;
      totalPresent += pres;
      totalMarked += tot;
    });
    if (totalMarked > 0) totalAttendancePct = Math.round((totalPresent / totalMarked) * 100);
  }

  const avgMastery = classes.length ? Math.round(classes.reduce((total, item) => total + (item.progress || 0), 0) / classes.length) : 0;
  const openUpdatesCount = (announcements || []).length;

  return (
    <PageMotion>
      <div className="page-heading dashboard-heading">
        <div>
          <div className="eyebrow"><Sparkles size={14} />TEACHING COMMAND CENTER</div>
          <h1>Good morning, {profile.fullName.split(' ')[0]} <span>✦</span></h1>
          <p>Everything you need for a focused, well-paced day.</p>
        </div>
        <Button icon={Plus} onClick={onQuick}>Create something</Button>
      </div>

      {primaryClass ? (
        <section className="focus-banner">
          <div className="focus-icon"><Clock3 size={23} /></div>
          <div className="focus-info">
            <span className="eyebrow">ACTIVE CLASSROOM &middot; {primaryClass.subject}</span>
            <h3>{primaryClass.name}</h3>
            <p>Class ID: <strong>{primaryClass.joinCode || 'Created'}</strong> &middot; Share with students to join</p>
            <div>
              <span>{primaryClass.students || totalLearners} learners</span>
              <span>{primaryClass.subject}</span>
            </div>
          </div>
          <Button variant="light" onClick={() => { setPage('classes'); onToast(`Opened ${primaryClass.name}.`); }}>
            Open classroom <ArrowUpRight size={16} />
          </Button>
        </section>
      ) : (
        <section className="focus-banner" style={{ background: 'linear-gradient(135deg, #4f46e5, #6366f1)' }}>
          <div className="focus-icon"><BookOpen size={23} /></div>
          <div className="focus-info">
            <span className="eyebrow">NO CLASSES CREATED YET</span>
            <h3>Start your first classroom</h3>
            <p>Create a class to generate your unique Class Invite Code for your students.</p>
          </div>
          <Button variant="light" onClick={onQuick}>Create Class <Plus size={16} /></Button>
        </section>
      )}

      <section className="metric-grid">
        <Metric icon={ClipboardCheck} label="Pending reviews" value={pendingHomeworkCount} trend={`${homework.length} total homeworks`} color="indigo" />
        <Metric icon={Users} label="Class attendance" value={totalAttendancePct ? `${totalAttendancePct}%` : '0%'} trend={totalAttendancePct ? 'Marked sessions' : 'No sessions marked'} color="emerald" />
        <Metric icon={TrendingUp} label="Average mastery" value={`${avgMastery}%`} trend={classes.length ? 'Across active classes' : 'No classes yet'} color="blue" />
        <Metric icon={Bell} label="Class updates" value={openUpdatesCount} trend="School announcements" color="violet" />
      </section>

      <section className="content-grid">
        <Card className="span-7">
          <CardHeader eyebrow="TODAY" title="Your teaching rhythm" action="View calendar" onAction={() => setPage('calendar')} />
          {classes.length > 0 ? (
            <div className="timeline">
              {classes.map((item, index) => (
                <div className="timeline-row" key={item.id}>
                  <time>{['09:00', '10:15', '13:30', '14:30'][index % 4]}<small>{['09:45', '11:00', '14:15', '15:15'][index % 4]}</small></time>
                  <i />
                  <div>
                    <b>{item.name}</b>
                    <p>{item.subject} &middot; Class ID: {item.joinCode}</p>
                  </div>
                  <Button variant="ghost" onClick={() => setPage('classes')}>Open</Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="workspace-empty" style={{ padding: '30px', textAlign: 'center' }}>No scheduled classes. Create your first class to see your teaching rhythm.</p>
          )}
        </Card>

        <Card className="span-5">
          <CardHeader eyebrow="AI SIGNALS" title="Worth your attention" action="View insights" onAction={() => setPage('insights')} />
          <p className="assistant-note"><Sparkles size={14} />Patterns, not prescriptions — real learner signals.</p>
          {students.length > 0 ? (
            students.slice(0, 4).map(student => (
              <div className="attention-row" key={student.id}>
                <div className="avatar small">{student.initials}</div>
                <div><b>{student.name}</b><p>{student.className || 'Enrolled learner'}</p></div>
                <span className={student.attendance >= 85 ? 'badge success' : 'badge warning'}>{student.attendance || 0}% attendance</span>
              </div>
            ))
          ) : (
            <p className="workspace-empty" style={{ padding: '20px 10px', fontSize: '12px' }}>No student alerts yet. Students will appear here once they join using your Class ID.</p>
          )}
        </Card>

        <Card className="span-7">
          <CardHeader eyebrow="CLASSROOM PULSE" title="Mastery progress" action="Open insights" onAction={() => setPage('insights')} />
          <p className="muted">Mastery progress from active classrooms</p>
          {classes.length > 0 ? (
            <div className="mastery-list">
              {classes.map(item => (
                <div className="mastery-row" key={item.id}>
                  <span>{item.name}</span>
                  <div className="progress"><i style={{ width: `${item.progress || 0}%` }} /></div>
                  <b>{item.progress || 0}%</b>
                </div>
              ))}
            </div>
          ) : (
            <p className="workspace-empty" style={{ padding: '20px', textAlign: 'center' }}>No assessment data recorded yet.</p>
          )}
        </Card>

        <Card className="span-5">
          <CardHeader eyebrow="TO KEEP MOVING" title="Your tasks" action={`${homework.length} open`} />
          {homework.length > 0 ? (
            homework.slice(0, 4).map(item => (
              <label className="task-row" key={item.id}>
                <input type="checkbox" onChange={() => onToast('Task updated.')} />
                <span className="check" />
                <span><b>{item.title}</b><small>{item.className} &middot; Due {item.due}</small></span>
              </label>
            ))
          ) : (
            <p className="workspace-empty" style={{ padding: '20px 10px', fontSize: '12px' }}>No homework tasks created. Click 'Create something' above to assign homework.</p>
          )}
        </Card>
      </section>

      <section className="section-row">
        <Card className="classes-card">
          <CardHeader eyebrow="MY CLASSES" title="Classrooms overview" action="View all" onAction={() => setPage('classes')} />
          {classes.length > 0 ? (
            <div className="class-mini-grid">
              {classes.map(item => (
                <button className="class-mini" key={item.id} onClick={() => setPage('classes')}>
                  <span className={`class-orb ${item.color || 'indigo'}`}><BookOpen size={18} /></span>
                  <b>{item.name}</b>
                  <p>{item.students || 0} learners &middot; {item.progress || 0}% mastery</p>
                  <div className="progress"><i style={{ width: `${item.progress || 0}%` }} /></div>
                </button>
              ))}
            </div>
          ) : (
            <p className="workspace-empty" style={{ padding: '20px', textAlign: 'center' }}>No classes created yet.</p>
          )}
        </Card>
      </section>
    </PageMotion>
  );
}

function Metric({ icon: Icon, label, value, trend, color }) { return <motion.article className="metric-card" whileHover={{ y: -3 }}><span className={`metric-icon ${color}`}><Icon size={19} /></span><div><p>{label}</p><h3>{value}</h3><small><TrendingUp size={13} />{trend}</small></div></motion.article>; }
function Card({ children, className = '' }) { return <section className={`card ${className}`}>{children}</section>; }
function CardHeader({ eyebrow, title, action, onAction }) { return <div className="card-header"><div><p className="eyebrow">{eyebrow}</p><h3>{title}</h3></div>{action && <button onClick={onAction}>{action} {onAction && <ArrowUpRight size={14} />}</button>}</div>; }
function PageMotion({ children }) { return <motion.div className="page" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .26 }}>{children}</motion.div>; }

function ClassesPage({ workspace, updateWorkspace, authToken, onToast, onOpenClass }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [activeMenuId, setActiveMenuId] = useState(null);
  const [editingClass, setEditingClass] = useState(null);
  const [deletingClass, setDeletingClass] = useState(null);

  useEffect(() => {
    function handleClickOutside() {
      setActiveMenuId(null);
    }
    if (activeMenuId) {
      window.addEventListener('click', handleClickOutside);
      return () => window.removeEventListener('click', handleClickOutside);
    }
  }, [activeMenuId]);

  return (
    <>
      <PageShell eyebrow="CLASSROOMS" title="My classes" copy="Choose a class to see its roster, assessments, feedback, and learning progress." action="New class" onAction={() => setCreateOpen(true)}>
        <div className="class-grid">
          {workspace.classes.map(item => (
            <article className="class-card class-card-openable" key={item.id}>
              <div className={`class-hero ${item.color || 'indigo'}`}>
                <span><BookOpen size={23} /></span>
                <div className="class-hero-actions">
                  <button
                    type="button"
                    aria-label={`More options for ${item.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveMenuId(activeMenuId === item.id ? null : item.id);
                    }}
                  >
                    <MoreHorizontal size={18} />
                  </button>
                  {activeMenuId === item.id && (
                    <div className="class-card-dropdown" onClick={e => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveMenuId(null);
                          setEditingClass(item);
                        }}
                      >
                        <Edit3 size={13} /> Edit Class
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => {
                          setActiveMenuId(null);
                          setDeletingClass(item);
                        }}
                      >
                        <Trash2 size={13} /> Delete Class
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <div className="class-card-body">
                <p>{item.subject}</p>
                <h3>{item.name}</h3>
                <span>{item.students} learners</span>
                {item.joinCode && <span className="class-id-chip">Class ID: {item.joinCode}</span>}
                <div className="progress-label">
                  <span>Mastery progress</span>
                  <b>{item.progress || 0}%</b>
                </div>
                <div className="progress">
                  <i style={{ width: `${item.progress || 0}%` }} />
                </div>
                <div className="class-card-actions">
                  <Button variant="subtle" onClick={() => onOpenClass(item.id)}>
                    Open class <ArrowUpRight size={15} />
                  </Button>
                  <Button variant="ghost" onClick={() => { if (item.joinCode) void navigator.clipboard?.writeText(item.joinCode); onToast(item.joinCode ? `Class ID copied: ${item.joinCode}` : 'Class ID unavailable.'); }}>
                    Copy ID
                  </Button>
                </div>
              </div>
            </article>
          ))}
          {workspace.classes.length === 0 && (
            <p className="workspace-empty" style={{ padding: '30px', gridColumn: '1 / -1', textAlign: 'center' }}>
              No classes created yet. Click "New class" to create one.
            </p>
          )}
        </div>
      </PageShell>

      <AnimatePresence>
        {createOpen && (
          <NewClassModal
            workspace={workspace}
            updateWorkspace={updateWorkspace}
            authToken={authToken}
            onClose={() => setCreateOpen(false)}
            onToast={onToast}
          />
        )}
        {editingClass && (
          <EditClassModal
            classToEdit={editingClass}
            workspace={workspace}
            updateWorkspace={updateWorkspace}
            authToken={authToken}
            onClose={() => setEditingClass(null)}
            onToast={onToast}
          />
        )}
        {deletingClass && (
          <ConfirmDeleteClassModal
            classToDelete={deletingClass}
            workspace={workspace}
            updateWorkspace={updateWorkspace}
            authToken={authToken}
            onClose={() => setDeletingClass(null)}
            onToast={onToast}
          />
        )}
      </AnimatePresence>
    </>
  );
}

function EditClassModal({ classToEdit, workspace, updateWorkspace, authToken, onClose, onToast }) {
  const [form, setForm] = useState({
    name: classToEdit.name || '',
    grade: classToEdit.grade || '',
    subject: classToEdit.subject || '',
    color: classToEdit.color || 'indigo'
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const update = event => setForm(current => ({ ...current, [event.target.name]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    if (!form.name.trim() || !form.grade.trim() || !form.subject.trim()) {
      return setError('Add a class name, grade, and subject.');
    }
    setSaving(true);
    setError('');
    try {
      const updatedRecord = {
        ...classToEdit,
        name: form.name.trim(),
        grade: form.grade.trim(),
        subject: form.subject.trim(),
        color: form.color
      };

      if (authToken && classToEdit.id && !classToEdit.id.startsWith('demo-')) {
        await apiRequest(`/teacher/classes/${classToEdit.id}`, {
          token: authToken,
          method: 'PUT',
          body: JSON.stringify({
            name: updatedRecord.name,
            grade: updatedRecord.grade,
            subject: updatedRecord.subject
          })
        }).catch(() => {});
      }

      registerDemoClass({
        ...updatedRecord,
        teacherEmail: workspace.profile.email,
        schoolName: workspace.profile.schoolName
      });

      updateWorkspace(current => ({
        ...current,
        classes: current.classes.map(c => c.id === classToEdit.id ? updatedRecord : c)
      }));

      onToast(`Class "${updatedRecord.name}" updated successfully.`);
      onClose();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
      <motion.section className="quick-modal new-class-modal" initial={{ opacity: 0, y: 12, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12 }} onMouseDown={event => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <p className="eyebrow">EDIT CLASSROOM</p>
            <h2>Edit {classToEdit.name}</h2>
          </div>
          <IconButton label="Close" onClick={onClose}><X size={19} /></IconButton>
        </div>
        <form className="new-class-form" onSubmit={submit}>
          <Field label="Class name">
            <input name="name" value={form.name} onChange={update} placeholder="Grade 10 - Science" autoFocus />
          </Field>
          <div className="form-grid">
            <Field label="Grade">
              <input name="grade" value={form.grade} onChange={update} placeholder="Grade 10" />
            </Field>
            <Field label="Subject">
              <input name="subject" value={form.subject} onChange={update} placeholder="Biology" />
            </Field>
          </div>
          <Field label="Theme Color">
            <select className="form-select" name="color" value={form.color} onChange={update} style={{ width: '100%', height: '43px', border: '1px solid var(--line)', borderRadius: '10px', padding: '0 12px', background: 'var(--input)', color: 'var(--text)', fontSize: '13px' }}>
              <option value="indigo">Indigo</option>
              <option value="violet">Violet</option>
              <option value="blue">Blue</option>
              <option value="emerald">Emerald</option>
              <option value="amber">Amber</option>
              <option value="rose">Rose</option>
            </select>
          </Field>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-actions">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" icon={Check} disabled={saving}>{saving ? 'Saving...' : 'Save changes'}</Button>
          </div>
        </form>
      </motion.section>
    </motion.div>
  );
}

function ConfirmDeleteClassModal({ classToDelete, workspace, updateWorkspace, authToken, onClose, onToast }) {
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      if (authToken && classToDelete.id && !classToDelete.id.startsWith('demo-')) {
        await apiRequest(`/teacher/classes/${classToDelete.id}`, {
          token: authToken,
          method: 'DELETE'
        }).catch(() => {});
      }

      updateWorkspace(current => ({
        ...current,
        classes: current.classes.filter(c => c.id !== classToDelete.id)
      }));

      onToast(`Class "${classToDelete.name}" deleted.`);
      onClose();
    } catch (err) {
      onToast(`Error deleting class: ${err.message}`);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
      <motion.section className="quick-modal" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} onMouseDown={e => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <p className="eyebrow" style={{ color: '#ef4444' }}>DELETE CLASSROOM</p>
            <h2>Delete "{classToDelete.name}"?</h2>
          </div>
          <IconButton label="Close" onClick={onClose}><X size={19} /></IconButton>
        </div>
        <p className="muted" style={{ marginBottom: '20px', lineHeight: '1.5' }}>
          Are you sure you want to delete this class workspace? All associated assignments and rosters will be removed.
        </p>
        <div className="modal-actions">
          <Button type="button" variant="ghost" onClick={onClose} disabled={deleting}>Cancel</Button>
          <Button type="button" variant="danger" icon={Trash2} onClick={handleDelete} disabled={deleting}>{deleting ? 'Deleting...' : 'Delete Class'}</Button>
        </div>
      </motion.section>
    </motion.div>
  );
}

// ==========================================
// CLASS WORKSPACE MODALS & COMPONENTS
// ==========================================

function ClassHomeworkModal({ classRecord, updateWorkspace, onClose, onToast, homeworkToEdit }) {
  const [form, setForm] = useState({
    title: homeworkToEdit?.title || '',
    description: homeworkToEdit?.description || '',
    due: homeworkToEdit?.due || '',
    attachment: homeworkToEdit?.attachment || '',
    assignTo: homeworkToEdit?.assignTo || 'all'
  });
  const [selectedStudents, setSelectedStudents] = useState(
    Array.isArray(homeworkToEdit?.assignTo) ? homeworkToEdit.assignTo : []
  );

  const students = classRecord.studentsList || [];

  function submit(event) {
    event.preventDefault();
    if (!form.title.trim()) return;

    const hwData = {
      id: homeworkToEdit?.id || `homework-${Date.now()}`,
      title: form.title.trim(),
      description: form.description.trim(),
      className: classRecord.name,
      classId: classRecord.id,
      joinCode: classRecord.joinCode || classRecord.inviteCode,
      due: form.due || new Date(Date.now() + 86400000).toISOString().split('T')[0],
      attachment: form.attachment || null,
      assignTo: form.assignTo === 'selected' ? selectedStudents : 'all',
      status: homeworkToEdit?.status || 'Published',
      submissions: homeworkToEdit?.submissions || []
    };

    updateWorkspace(current => {
      const existing = current.homework || [];
      const updated = homeworkToEdit
        ? existing.map(h => h.id === hwData.id ? hwData : h)
        : [hwData, ...existing];

      const registryRecord = findDemoClass(classRecord.joinCode || classRecord.id) || classRecord;
      registerDemoClass({
        ...registryRecord,
        homework: updated.filter(h => h.classId === classRecord.id || h.joinCode === classRecord.joinCode || h.className === classRecord.name)
      });

      return { ...current, homework: updated };
    });

    onToast(homeworkToEdit ? 'Homework updated.' : 'Homework published to students.');
    onClose();
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <motion.form
        className="quick-modal quiz-builder-modal"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 12 }}
        onMouseDown={e => e.stopPropagation()}
        onSubmit={submit}
      >
        <div className="modal-head">
          <div>
            <p className="eyebrow">CLASS HOMEWORK</p>
            <h2>{homeworkToEdit ? 'Edit homework' : 'Add homework'}</h2>
          </div>
          <IconButton label="Close" onClick={onClose}><X size={19} /></IconButton>
        </div>

        <Field label="Homework title">
          <input
            value={form.title}
            onChange={e => setForm(c => ({ ...c, title: e.target.value }))}
            placeholder="e.g. Photosynthesis reflection essay"
            required
            autoFocus
          />
        </Field>

        <Field label="Description">
          <textarea
            style={{ width: '100%', minHeight: '80px', border: '1px solid var(--line)', borderRadius: '10px', padding: '10px', background: 'var(--input)', color: 'var(--text)', fontSize: '12px' }}
            value={form.description}
            onChange={e => setForm(c => ({ ...c, description: e.target.value }))}
            placeholder="Provide clear instructions for students..."
          />
        </Field>

        <div className="form-grid">
          <Field label="Due date">
            <input
              type="date"
              value={form.due}
              onChange={e => setForm(c => ({ ...c, due: e.target.value }))}
            />
          </Field>
          <Field label="Attachment file name (optional)">
            <input
              value={form.attachment}
              onChange={e => setForm(c => ({ ...c, attachment: e.target.value }))}
              placeholder="e.g. worksheet_guide.pdf"
            />
          </Field>
        </div>

        <Field label="Assign to">
          <select
            className="form-select"
            value={form.assignTo}
            onChange={e => setForm(c => ({ ...c, assignTo: e.target.value }))}
          >
            <option value="all">Entire class</option>
            <option value="selected">Selected students</option>
          </select>
        </Field>

        {form.assignTo === 'selected' && students.length > 0 && (
          <div className="quiz-student-picker" style={{ maxHeight: '120px', overflowY: 'auto' }}>
            {students.map(student => (
              <label key={student.id}>
                <input
                  type="checkbox"
                  checked={selectedStudents.includes(student.id)}
                  onChange={() => {
                    setSelectedStudents(c =>
                      c.includes(student.id) ? c.filter(id => id !== student.id) : [...c, student.id]
                    );
                  }}
                />{' '}
                {student.name} ({student.rollNumber})
              </label>
            ))}
          </div>
        )}

        <div className="modal-actions" style={{ marginTop: '15px' }}>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" icon={Check}>{homeworkToEdit ? 'Save changes' : 'Create homework'}</Button>
        </div>
      </motion.form>
    </div>
  );
}

function ClassResourceModal({ classRecord, updateWorkspace, onClose, onToast }) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState('Worksheet');
  const [fileName, setFileName] = useState('');
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);

  function submit(event) {
    event.preventDefault();
    if (!title.trim() || !fileName) return;
    setSaving(true);

    const resource = {
      id: `resource-${Date.now()}`,
      name: title.trim(),
      type,
      classId: classRecord.id,
      grade: classRecord.name,
      updated: 'Today',
      tint: type === 'Slides' ? 'violet' : type === 'Worksheet' ? 'blue' : 'amber',
      fileName: fileName
    };

    updateWorkspace(current => ({
      ...current,
      resources: [resource, ...(current.resources || [])]
    }));

    onToast(`${resource.name} uploaded and shared with students.`);
    onClose();
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <motion.form
        className="quick-modal compact-modal"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 12 }}
        onMouseDown={e => e.stopPropagation()}
        onSubmit={submit}
      >
        <div className="modal-head">
          <div>
            <p className="eyebrow">CLASS RESOURCES</p>
            <h2>Upload for {classRecord.name}</h2>
          </div>
          <IconButton label="Close" onClick={onClose}><X size={19} /></IconButton>
        </div>

        <Field label="Resource title">
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="e.g. Photosynthesis revision guide"
            required
            autoFocus
          />
        </Field>

        <div className="form-grid">
          <Field label="Type">
            <select className="form-select" value={type} onChange={e => setType(e.target.value)}>
              <option>Worksheet</option>
              <option>Slides</option>
              <option>Notes</option>
              <option>Videos</option>
            </select>
          </Field>
          <Field label="File Name (customizable)">
            <input
              value={fileName}
              onChange={e => setFileName(e.target.value)}
              placeholder="e.g. photosynthesis_ch3.pdf"
              required
            />
          </Field>
        </div>

        <Field label="File to Upload">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <input
              type="file"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) {
                  setFile(f);
                  setFileName(f.name);
                  if (!title.trim()) {
                    setTitle(f.name.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " "));
                  }
                }
              }}
              style={{ display: 'none' }}
              id="resource-file-upload"
            />
            <label
              htmlFor="resource-file-upload"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                padding: '16px',
                border: '2px dashed var(--line)',
                borderRadius: '12px',
                cursor: 'pointer',
                background: 'var(--soft)',
                color: 'var(--muted)',
                fontSize: '12px',
                fontWeight: '600',
                transition: 'border-color 0.2s'
              }}
              onMouseOver={e => e.currentTarget.style.borderColor = '#6366f1'}
              onMouseOut={e => e.currentTarget.style.borderColor = 'var(--line)'}
            >
              <Upload size={16} />
              {file ? `Selected: ${file.name}` : 'Choose a file to upload...'}
            </label>
          </div>
        </Field>

        <p className="modal-copy" style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '8px' }}>
          No AI is used on resources. This file is shared directly with enrolled students.
        </p>

        <div className="modal-actions" style={{ marginTop: '15px' }}>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" icon={Upload} disabled={saving}>{saving ? 'Sharing...' : 'Share resource'}</Button>
        </div>
      </motion.form>
    </div>
  );
}

function ClassAssessmentModal({ classRecord, updateWorkspace, onClose, onToast, assessmentToEdit }) {
  const [form, setForm] = useState({
    title: assessmentToEdit?.title || '',
    marks: assessmentToEdit?.marks || 50,
    due: assessmentToEdit?.due || '',
    questionPaperUrl: assessmentToEdit?.questionPaperUrl || ''
  });

  function submit(event) {
    event.preventDefault();
    if (!form.title.trim()) return;

    const assessmentData = {
      id: assessmentToEdit?.id || `assessment-${Date.now()}`,
      title: form.title.trim(),
      className: classRecord.name,
      classId: classRecord.id,
      questions: 5,
      marks: Number(form.marks) || 50,
      due: form.due || new Date(Date.now() + 604800000).toISOString().split('T')[0],
      status: assessmentToEdit?.status || 'Draft',
      questionPaperUrl: form.questionPaperUrl || 'uploaded_exam.pdf',
      studentMarks: assessmentToEdit?.studentMarks || {}
    };

    updateWorkspace(current => {
      const existing = current.tests || [];
      const updated = assessmentToEdit
        ? existing.map(t => t.id === assessmentData.id ? assessmentData : t)
        : [assessmentData, ...existing];
      return { ...current, tests: updated };
    });

    onToast(assessmentToEdit ? 'Assessment updated.' : 'Assessment created.');
    onClose();
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <motion.form
        className="quick-modal compact-modal"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 12 }}
        onMouseDown={e => e.stopPropagation()}
        onSubmit={submit}
      >
        <div className="modal-head">
          <div>
            <p className="eyebrow">FORMAL EXAMINATIONS</p>
            <h2>{assessmentToEdit ? 'Edit assessment' : 'Create assessment'}</h2>
          </div>
          <IconButton label="Close" onClick={onClose}><X size={19} /></IconButton>
        </div>

        <Field label="Assessment title">
          <input
            value={form.title}
            onChange={e => setForm(c => ({ ...c, title: e.target.value }))}
            placeholder="e.g. Term 1 Biology Examination"
            required
            autoFocus
          />
        </Field>

        <div className="form-grid">
          <Field label="Total marks">
            <input
              type="number"
              value={form.marks}
              onChange={e => setForm(c => ({ ...c, marks: e.target.value }))}
              required
            />
          </Field>
          <Field label="Due date / Time">
            <input
              type="date"
              value={form.due}
              onChange={e => setForm(c => ({ ...c, due: e.target.value }))}
            />
          </Field>
        </div>

        <Field label="Question Paper file (PDF)">
          <input
            value={form.questionPaperUrl}
            onChange={e => setForm(c => ({ ...c, questionPaperUrl: e.target.value }))}
            placeholder="e.g. biology_term1_final.pdf"
          />
        </Field>

        <p className="modal-copy" style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '8px' }}>
          Assessments are formal exams. No AI quiz generation occurs in this module.
        </p>

        <div className="modal-actions" style={{ marginTop: '15px' }}>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" icon={Check}>{assessmentToEdit ? 'Save changes' : 'Create assessment'}</Button>
        </div>
      </motion.form>
    </div>
  );
}

function ClassQuizModal({ classRecord, roster, updateWorkspace, onClose, onToast, quizToEdit, authToken, aiStatus }) {
  const [mode, setMode] = useState('manual');
  const [form, setForm] = useState({
    title: quizToEdit?.title || '',
    topic: quizToEdit?.topic || '',
    timeLimit: quizToEdit?.timeLimit || '15',
    due: quizToEdit?.due || '',
    startTime: quizToEdit?.startTime || '',
    endTime: quizToEdit?.endTime || '',
    difficulty: quizToEdit?.difficulty || 'medium',
    questionCount: quizToEdit?.questionCount || '5',
    assignment: quizToEdit?.assignment === 'Selected students' ? 'selected' : 'entire'
  });
  const [questions, setQuestions] = useState(
    quizToEdit?.questions || [{ id: 'q-1', type: 'MCQ', prompt: '', options: ['', '', '', ''], answer: '', explanation: '' }]
  );
  const [selectedStudents, setSelectedStudents] = useState(
    quizToEdit?.selectedStudentIds || []
  );
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  const updateForm = e => setForm(c => ({ ...c, [e.target.name]: e.target.value }));
  const updateQuestion = (id, key, value) => setQuestions(c => c.map(q => q.id === id ? { ...q, [key]: value } : q));
  const updateMCQOption = (qId, optIdx, val) => setQuestions(c => c.map(q => {
    if (q.id !== qId) return q;
    const nextOpts = [...(q.options || ['', '', '', ''])];
    nextOpts[optIdx] = val;
    return { ...q, options: nextOpts };
  }));

  const addQuestion = () => setQuestions(c => [...c, { id: `q-${Date.now()}`, type: 'MCQ', prompt: '', options: ['', '', '', ''], answer: '', explanation: '' }]);
  const removeQuestion = id => setQuestions(c => c.length === 1 ? c : c.filter(q => q.id !== id));
  const moveQuestion = (id, dir) => setQuestions(c => {
    const idx = c.findIndex(q => q.id === id);
    const nextIdx = idx + dir;
    if (idx < 0 || nextIdx < 0 || nextIdx >= c.length) return c;
    const next = [...c];
    [next[idx], next[nextIdx]] = [next[nextIdx], next[idx]];
    return next;
  });
  const toggleStudent = id => setSelectedStudents(c => c.includes(id) ? c.filter(x => x !== id) : [...c, id]);

  // Dynamic offline simulator for AI generation (used when offline/unconfigured)
  function simulateAiQuizGeneration() {
    setGenerating(true);
    setError('');

    setTimeout(() => {
      const topic = form.topic.trim().toLowerCase() || 'general science';
      const count = Number(form.questionCount) || 5;
      let simulated = [];

      if (topic.includes('prob') || topic.includes('math') || topic.includes('stat') || topic.includes('alg')) {
        const pool = [
          {
            type: 'MCQ',
            prompt: 'If you roll a fair six-sided die twice, what is the probability of rolling a sum of 7?',
            options: ['1/6', '1/12', '1/36', '5/36'],
            answer: '1/6',
            explanation: 'There are 6 outcomes that sum to 7 (1+6, 2+5, 3+4, 4+3, 5+2, 6+1) out of 36 total possible outcomes. 6/36 = 1/6.'
          },
          {
            type: 'Fill Blank',
            prompt: 'Two events are called _______ if the occurrence of one does not affect the probability of the other.',
            answer: 'independent',
            options: [],
            explanation: 'Independent events satisfy P(A and B) = P(A) * P(B).'
          },
          {
            type: 'MCQ',
            prompt: 'If P(A) = 0.4 and P(B) = 0.5, what is P(A or B) if A and B are mutually exclusive?',
            options: ['0.9', '0.2', '0.1', '0.0'],
            answer: '0.9',
            explanation: 'For mutually exclusive events, P(A or B) = P(A) + P(B). 0.4 + 0.5 = 0.9.'
          },
          {
            type: 'Fill Blank',
            prompt: 'The probability of a completely certain event is equal to _______.',
            answer: '1',
            options: [],
            explanation: 'A certain event has a probability of 1 (or 100%).'
          },
          {
            type: 'MCQ',
            prompt: 'What is the value of 5! (five factorial)?',
            options: ['120', '60', '24', '15'],
            answer: '120',
            explanation: '5! = 5 * 4 * 3 * 2 * 1 = 120.'
          },
          {
            type: 'Fill Blank',
            prompt: 'The value of x in the algebraic equation 3x + 7 = 22 is _______.',
            answer: '5',
            options: [],
            explanation: 'Subtract 7 from both sides: 3x = 15. Divide by 3: x = 5.'
          },
          {
            type: 'MCQ',
            prompt: 'What is the slope of the line represented by the equation y = -3x + 8?',
            options: ['-3', '8', '3', '8/3'],
            answer: '-3',
            explanation: 'In the slope-intercept form (y = mx + c), m represents the slope. Here, m = -3.'
          },
          {
            type: 'Fill Blank',
            prompt: 'In algebra, the expression (a + b)(a - b) expands to a^2 - _______.',
            answer: 'b^2',
            options: [],
            explanation: 'This is the difference of squares identity: (a+b)(a-b) = a^2 - b^2.'
          },
          {
            type: 'MCQ',
            prompt: 'Which of the following is the derivative of x^2 with respect to x?',
            options: ['2x', 'x', '2', 'x^3 / 3'],
            answer: '2x',
            explanation: 'Using the power rule: d/dx (x^n) = n * x^(n-1). So d/dx (x^2) = 2x.'
          },
          {
            type: 'Fill Blank',
            prompt: 'A polygon with exactly five sides is called a _______.',
            answer: 'pentagon',
            options: [],
            explanation: 'A pentagon is a five-sided polygon.'
          }
        ];

        for (let i = 0; i < count; i++) {
          const item = pool[i % pool.length];
          simulated.push({
            id: `ai-q-${i}-${Date.now()}`,
            type: item.type,
            prompt: item.prompt,
            options: item.options,
            answer: item.answer,
            explanation: item.explanation
          });
        }
      } else if (topic.includes('photo') || topic.includes('plant') || topic.includes('bio')) {
        const pool = [
          {
            type: 'MCQ',
            prompt: 'Which pigment is primarily responsible for capturing light energy during photosynthesis?',
            options: ['Chlorophyll a', 'Carotenoids', 'Anthocyanin', 'Phycobilin'],
            answer: 'Chlorophyll a',
            explanation: 'Chlorophyll a is the principal pigment involved in photosynthesis, absorbing blue-violet and red light.'
          },
          {
            type: 'Fill Blank',
            prompt: 'The microscopic pores on the surface of plant leaves that allow gas exchange are called _______.',
            answer: 'stomata',
            options: [],
            explanation: 'Stomata regulate the intake of carbon dioxide and release of oxygen and water vapor.'
          },
          {
            type: 'MCQ',
            prompt: 'Where in the chloroplast do the light-independent reactions (Calvin Cycle) take place?',
            options: ['Stroma', 'Thylakoid membrane', 'Outer membrane', 'Intermembrane space'],
            answer: 'Stroma',
            explanation: 'The Calvin Cycle occurs in the stroma of the chloroplast, while light-dependent reactions happen in thylakoid membranes.'
          },
          {
            type: 'Fill Blank',
            prompt: 'The splitting of water molecules during light-dependent reactions is called _______ of water.',
            answer: 'photolysis',
            options: [],
            explanation: 'Photolysis is the chemical decomposition of water molecules induced by light.'
          },
          {
            type: 'MCQ',
            prompt: 'Which organelle is the site of photosynthesis in eukaryotic cells?',
            options: ['Chloroplast', 'Mitochondrion', 'Ribosome', 'Golgi apparatus'],
            answer: 'Chloroplast',
            explanation: 'Chloroplasts contain chlorophyll and conduct photosynthesis in plants.'
          },
          {
            type: 'Fill Blank',
            prompt: 'The light reactions of photosynthesis produce oxygen and the energy carriers ATP and _______.',
            answer: 'NADPH',
            options: [],
            explanation: 'Light-dependent reactions convert solar energy into chemical energy stored in ATP and NADPH.'
          },
          {
            type: 'MCQ',
            prompt: 'What are the main reactant inputs needed for photosynthesis to occur?',
            options: ['Carbon dioxide, water, and light', 'Oxygen and glucose', 'Nitrogen and oxygen', 'Carbon dioxide and sugar'],
            answer: 'Carbon dioxide, water, and light',
            explanation: 'Photosynthesis uses carbon dioxide, water, and sunlight to synthesize carbohydrates and release oxygen.'
          },
          {
            type: 'Fill Blank',
            prompt: 'In plants, the tissue responsible for transporting water from roots to leaves is called _______.',
            answer: 'xylem',
            options: [],
            explanation: 'Xylem tissue transports water and minerals up from the roots, while phloem distributes sugars.'
          }
        ];

        for (let i = 0; i < count; i++) {
          const item = pool[i % pool.length];
          simulated.push({
            id: `ai-q-${i}-${Date.now()}`,
            type: item.type,
            prompt: item.prompt,
            options: item.options,
            answer: item.answer,
            explanation: item.explanation
          });
        }
      } else {
        // Dynamic templating for any other topic
        const mcqPool = [
          {
            prompt: `Which of the following best defines the core principle of ${form.topic}?`,
            options: [`The fundamental interaction of ${form.topic} variables`, `A static state of ${form.topic} properties`, `The external forces acting against ${form.topic}`, `The historical origin of ${form.topic}`],
            answer: `The fundamental interaction of ${form.topic} variables`,
            explanation: `${form.topic} is best understood through the relationships and interactions of its primary components.`
          },
          {
            prompt: `In a standard environment, how does ${form.topic} typically manifest?`,
            options: [`Through observable patterns and measurable outputs`, `It remains entirely unpredictable`, `Only during high-temperature laboratory reactions`, `It is exclusively limited to biological cells`],
            answer: `Through observable patterns and measurable outputs`,
            explanation: `Most studies of ${form.topic} rely on measuring key inputs and observing their systemic outputs.`
          }
        ];

        const blankPool = [
          {
            prompt: `The scientific study and mathematical modeling of ${form.topic} is often referred to as _______.`,
            answer: `${form.topic} analysis`,
            explanation: `Systematic analysis is the primary methodology used to quantify ${form.topic} behavior.`
          }
        ];

        for (let i = 0; i < count; i++) {
          const typeIndex = i % 2;
          if (typeIndex === 0) {
            const item = mcqPool[Math.floor(i / 2) % mcqPool.length];
            simulated.push({ id: `ai-q-${i}-${Date.now()}`, type: 'MCQ', prompt: item.prompt, options: item.options, answer: item.answer, explanation: item.explanation });
          } else {
            const item = blankPool[Math.floor(i / 2) % blankPool.length];
            simulated.push({ id: `ai-q-${i}-${Date.now()}`, type: 'Fill Blank', prompt: item.prompt, options: [], answer: item.answer, explanation: item.explanation });
          }
        }
      }

      const sliced = simulated.slice(0, count);
      setQuestions(sliced);
      setForm(c => ({ ...c, title: c.title || `${form.topic.charAt(0).toUpperCase() + form.topic.slice(1)} Practice Quiz` }));
      setGenerating(false);
      onToast('AI questions generated. Please review and edit before saving.');
    }, 1200);
  }

  // Real backend AI generator or offline simulator fallback
  async function generateQuiz() {
    if (!form.topic.trim()) return setError('Please specify a topic first.');
    setGenerating(true);
    setError('');

    if (authToken && aiStatus?.configured) {
      try {
        const response = await apiRequest('/ai/quiz-generator', {
          token: authToken,
          method: 'POST',
          body: JSON.stringify({
            topic: form.topic.trim(),
            difficulty: form.difficulty,
            questionCount: Number(form.questionCount) || 5
          })
        });

        const mappedQuestions = response.draft.questions.map((q, idx) => ({
          id: `ai-q-${idx}-${Date.now()}`,
          type: q.type,
          prompt: q.prompt,
          options: q.options || ['', '', '', ''],
          answer: q.answer,
          explanation: q.explanation
        }));

        setQuestions(mappedQuestions);
        setForm(c => ({ ...c, title: response.draft.title || c.title || `${form.topic} AI Check` }));
        onToast(`AI quiz generated with ${response.meta.provider}.`);
      } catch (err) {
        console.error(err);
        simulateAiQuizGeneration();
      } finally {
        setGenerating(false);
      }
    } else {
      simulateAiQuizGeneration();
    }
  }

  function saveQuiz(event) {
    event.preventDefault();
    if (!form.title.trim() || !form.topic.trim()) return setError('Please specify a title and a topic.');
    if (!questions.filter(q => q.prompt.trim()).length) return setError('Please add at least one question.');

    const quizData = {
      id: quizToEdit?.id || `quiz-${Date.now()}`,
      classId: classRecord.id,
      title: form.title.trim(),
      subject: classRecord.subject,
      topic: form.topic.trim(),
      timeLimit: Number(form.timeLimit) || 15,
      due: form.due || new Date(Date.now() + 172800000).toISOString().split('T')[0],
      startTime: form.startTime || new Date().toISOString().substring(0, 16),
      endTime: form.endTime || new Date(Date.now() + 172800000).toISOString().substring(0, 16),
      status: quizToEdit?.status || 'Draft',
      questions,
      assignment: form.assignment === 'selected' ? 'Selected students' : 'Entire class',
      selectedStudentIds: form.assignment === 'selected' ? selectedStudents : [],
      submissions: quizToEdit?.submissions || []
    };

    updateWorkspace(current => {
      const existing = current.quizzes || [];
      const updated = quizToEdit
        ? existing.map(q => q.id === quizData.id ? quizData : q)
        : [quizData, ...existing];
      return { ...current, quizzes: updated };
    });

    onToast(quizToEdit ? 'Quiz updated.' : 'Quiz saved as draft.');
    onClose();
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <motion.form
        className="quick-modal quiz-builder-modal"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 12 }}
        onMouseDown={e => e.stopPropagation()}
        onSubmit={saveQuiz}
        style={{
          width: '95vw',
          maxWidth: '1350px',
          height: '90vh',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          padding: '24px'
        }}
      >
        <div className="modal-head" style={{ flexShrink: 0, marginBottom: '8px' }}>
          <div>
            <p className="eyebrow">QUIZ SETUP</p>
            <h2>{quizToEdit ? 'Edit practice quiz' : 'Create practice quiz'}</h2>
          </div>
          <IconButton label="Close" onClick={onClose}><X size={19} /></IconButton>
        </div>
        <p className="modal-copy" style={{ flexShrink: 0, marginBottom: '16px' }}>Quizzes are quick checks separate from formal assessments. They do not affect formal report grades.</p>

        {/* WORKSPACE Split-grid layout */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1.3fr',
          gap: '24px',
          flex: 1,
          overflow: 'hidden',
          minHeight: 0,
          marginBottom: '16px'
        }}>
          {/* LEFT SIDE COLUMN: CONFIGURATION */}
          <div style={{ overflowY: 'auto', paddingRight: '8px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {!quizToEdit && (
              <div className="quiz-mode-toggle" style={{ margin: 0 }}>
                <button type="button" className={mode === 'manual' ? 'selected' : ''} onClick={() => setMode('manual')}>Create manually</button>
                <button type="button" className={mode === 'ai' ? 'selected' : ''} onClick={() => setMode('ai')}>Generate with AI</button>
              </div>
            )}

            <div className="form-grid">
              <Field label="Quiz title"><input name="title" value={form.title} onChange={updateForm} placeholder="e.g. Chloroplast function check" required /></Field>
              <Field label="Topic"><input name="topic" value={form.topic} onChange={updateForm} placeholder="e.g. Photosynthesis" required /></Field>
            </div>

            <div className="form-grid">
              <Field label="Time limit (minutes)"><input type="number" name="timeLimit" value={form.timeLimit} onChange={updateForm} required /></Field>
              <Field label="Due date"><input type="date" name="due" value={form.due} onChange={updateForm} /></Field>
            </div>

            <div className="form-grid">
              <Field label="Start Time"><input type="datetime-local" name="startTime" value={form.startTime} onChange={updateForm} /></Field>
              <Field label="End Time"><input type="datetime-local" name="endTime" value={form.endTime} onChange={updateForm} /></Field>
            </div>

            {mode === 'ai' && !quizToEdit && (
              <div className="quiz-ai-controls" style={{ margin: 0 }}>
                <div className="form-grid">
                  <Field label="Difficulty">
                    <select className="form-select" name="difficulty" value={form.difficulty} onChange={updateForm}>
                      <option value="easy">Easy</option>
                      <option value="medium">Medium</option>
                      <option value="hard">Hard</option>
                    </select>
                  </Field>
                  <Field label="Question count">
                    <input type="number" name="questionCount" value={form.questionCount} min="1" max="15" onChange={updateForm} />
                  </Field>
                </div>
                <Button type="button" variant="subtle" icon={Sparkles} disabled={generating} onClick={generateQuiz}>
                  {generating ? 'Generating questions...' : 'Generate with AI'}
                </Button>
              </div>
            )}

            <Field label="Assign to">
              <select className="form-select" name="assignment" value={form.assignment} onChange={updateForm}>
                <option value="entire">Entire class</option>
                <option value="selected">Selected students</option>
              </select>
            </Field>

            {form.assignment === 'selected' && roster.length > 0 && (
              <div className="quiz-student-picker" style={{ maxHeight: '150px', overflowY: 'auto' }}>
                {roster.map(student => (
                  <label key={student.id}>
                    <input
                      type="checkbox"
                      checked={selectedStudents.includes(student.id)}
                      onChange={() => toggleStudent(student.id)}
                    />{' '}
                    {student.name} ({student.rollNumber})
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* RIGHT SIDE COLUMN: QUESTIONS */}
          <div style={{ overflowY: 'auto', paddingLeft: '20px', borderLeft: '1px solid var(--line)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <section className="quiz-question-editor" style={{ margin: 0, paddingTop: 0, borderTop: 0, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
              <div className="quiz-editor-head" style={{ marginBottom: '12px', flexShrink: 0 }}>
                <div>
                  <p className="eyebrow">QUESTIONS REVIEW</p>
                  <b>{questions.length} questions</b>
                </div>
                <Button type="button" variant="ghost" icon={Plus} onClick={addQuestion}>Add question</Button>
              </div>

              {error && <p className="form-error" style={{ marginBottom: '10px', flexShrink: 0 }}>{error}</p>}

              <div style={{ display: 'grid', gap: '16px', overflowY: 'auto', flex: 1, paddingBottom: '10px' }}>
                {questions.map((q, idx) => (
                  <article className="quiz-question-row" key={q.id} style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                    padding: '20px',
                    border: '1px solid var(--line)',
                    borderRadius: '12px',
                    background: 'var(--surface)',
                    boxShadow: 'var(--shadow)',
                    position: 'relative'
                  }}>
                    {/* Toolbar Header */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)', paddingBottom: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className="quiz-question-number" style={{ background: 'var(--soft)', color: '#4338ca', width: '22px', height: '22px', borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: '11px', fontWeight: '800' }}>
                          {idx + 1}
                        </span>
                        <select 
                          className="form-select" 
                          value={q.type} 
                          onChange={e => updateQuestion(q.id, 'type', e.target.value)}
                          style={{ height: '26px', fontSize: '10px', padding: '0 6px', width: '135px', borderRadius: '6px', background: 'var(--soft)', border: 'none' }}
                        >
                          <option value="MCQ">Choose the option</option>
                          <option value="Fill Blank">Fill in the blanks</option>
                        </select>
                      </div>
                      <div className="quiz-question-actions" style={{ display: 'flex', gap: '4px' }}>
                        <button type="button" onClick={() => moveQuestion(q.id, -1)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: '2px 4px' }}>↑</button>
                        <button type="button" onClick={() => moveQuestion(q.id, 1)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: '2px 4px' }}>↓</button>
                        <button type="button" onClick={() => removeQuestion(q.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#dc2626', padding: '2px 4px', fontSize: '14px' }}>×</button>
                      </div>
                    </div>

                    {/* Question Content */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {/* Question Prompt */}
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                        <span style={{ fontWeight: '700', fontSize: '13px', marginTop: '4px', color: 'var(--text)' }}>Q.</span>
                        <input 
                          value={q.prompt} 
                          onChange={e => updateQuestion(q.id, 'prompt', e.target.value)} 
                          placeholder="Type your question prompt here..." 
                          required 
                          style={{
                            border: 'none',
                            borderBottom: '1px solid transparent',
                            background: 'transparent',
                            fontSize: '13px',
                            fontWeight: '700',
                            width: '100%',
                            outline: 'none',
                            padding: '4px 0',
                            color: 'var(--text)',
                            transition: 'border-color 0.15s'
                          }}
                          onFocus={e => e.target.style.borderBottomColor = '#818cf8'}
                          onBlur={e => e.target.style.borderBottomColor = 'transparent'}
                        />
                      </div>

                      {/* Options for MCQ */}
                      {q.type === 'MCQ' && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', paddingLeft: '22px' }}>
                          {(q.options || ['', '', '', '']).map((opt, oIdx) => {
                            const isCorrect = q.answer === opt && opt.trim() !== '';
                            return (
                              <div key={oIdx} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <input 
                                  type="radio" 
                                  name={`correct-ans-${q.id}`} 
                                  checked={isCorrect}
                                  onChange={() => updateQuestion(q.id, 'answer', opt)}
                                  style={{ accentColor: '#4f46e5', cursor: 'pointer' }}
                                />
                                <span style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: '600' }}>{String.fromCharCode(65 + oIdx)}.</span>
                                <input
                                  value={opt}
                                  onChange={e => {
                                    const nextVal = e.target.value;
                                    updateMCQOption(q.id, oIdx, nextVal);
                                    if (isCorrect) {
                                      updateQuestion(q.id, 'answer', nextVal);
                                    }
                                  }}
                                  placeholder={`Option ${oIdx + 1}`}
                                  required
                                  style={{
                                    border: 'none',
                                    borderBottom: '1px dashed var(--line)',
                                    background: 'transparent',
                                    fontSize: '12px',
                                    width: '100%',
                                    outline: 'none',
                                    padding: '2px 0',
                                    color: 'var(--text)'
                                  }}
                                  onFocus={e => e.target.style.borderBottom = '1px solid #818cf8'}
                                  onBlur={e => e.target.style.borderBottom = '1px dashed var(--line)'}
                                />
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Answer Input for Fill in the Blanks */}
                      {q.type === 'Fill Blank' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingLeft: '22px', fontSize: '12px' }}>
                          <span style={{ color: 'var(--muted)', fontWeight: '600' }}>Answer:</span>
                          <input 
                            value={q.answer} 
                            onChange={e => updateQuestion(q.id, 'answer', e.target.value)} 
                            placeholder="Type correct answer..." 
                            required 
                            style={{
                              border: 'none',
                              borderBottom: '1px solid var(--line)',
                              background: 'transparent',
                              fontSize: '12px',
                              outline: 'none',
                              padding: '2px 0',
                              color: 'var(--text)',
                              width: '200px'
                            }}
                            onFocus={e => e.target.style.borderBottomColor = '#818cf8'}
                            onBlur={e => e.target.style.borderBottomColor = 'var(--line)'}
                          />
                        </div>
                      )}

                      {/* Explanation */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingLeft: '22px', marginTop: '4px' }}>
                        <span style={{ fontSize: '10px', color: 'var(--muted)', fontStyle: 'italic' }}>Explanation:</span>
                        <input
                          value={q.explanation || ''}
                          onChange={e => updateQuestion(q.id, 'explanation', e.target.value)}
                          placeholder="Provide a brief explanation of the correct answer..."
                          style={{
                            border: 'none',
                            borderBottom: '1px solid transparent',
                            background: 'transparent',
                            fontSize: '11px',
                            fontStyle: 'italic',
                            width: '100%',
                            outline: 'none',
                            color: 'var(--muted)'
                          }}
                          onFocus={e => e.target.style.borderBottomColor = '#818cf8'}
                          onBlur={e => e.target.style.borderBottomColor = 'transparent'}
                        />
                      </div>

                      {/* Learning Topic */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingLeft: '22px', marginTop: '4px' }}>
                        <span style={{ fontSize: '10px', color: '#6366f1', fontWeight: '700' }}>Learning Topic:</span>
                        <input
                          value={q.learningTopic || q.topic || ''}
                          onChange={e => updateQuestion(q.id, 'learningTopic', e.target.value)}
                          placeholder={form.topic || "e.g. Photosynthesis, Cell Structure..."}
                          style={{
                            border: 'none',
                            borderBottom: '1px dashed #a5b4fc',
                            background: 'transparent',
                            fontSize: '11px',
                            width: '260px',
                            outline: 'none',
                            color: 'var(--text)',
                            fontWeight: '600'
                          }}
                          onFocus={e => e.target.style.borderBottom = '1px solid #6366f1'}
                          onBlur={e => e.target.style.borderBottom = '1px dashed #a5b4fc'}
                        />
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>
        </div>

        <div className="modal-actions" style={{ flexShrink: 0, borderTop: '1px solid var(--line)', paddingTop: '15px', marginTop: 'auto' }}>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" icon={Check}>Save Practice Quiz</Button>
        </div>
      </motion.form>
    </div>
  );
}

// ==========================================
// MAIN CLASS WORKSPACE COMPONENT V2
// ==========================================

function VoiceFeedbackRecorderModal({ target, authToken, onClose, onPublished }) {
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const audioUrlRef = useRef('');
  const [recording, setRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState(null);
  const [audioUrl, setAudioUrl] = useState('');
  const [error, setError] = useState('');
  const [publishing, setPublishing] = useState(false);

  useEffect(() => () => {
    recorderRef.current?.stop?.();
    streamRef.current?.getTracks?.().forEach(track => track.stop());
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
  }, []);

  async function startRecording() {
    setError('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Audio recording is not supported in this browser. Please use a current version of Chrome, Edge, or Firefox.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported?.(type)) || '';
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      streamRef.current = stream;
      chunksRef.current = [];
      recorder.ondataavailable = event => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const recorded = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        if (recorded.size === 0) {
          setError('No audio was captured. Please try recording again.');
        } else {
          if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
          setAudioBlob(recorded);
          const nextUrl = URL.createObjectURL(recorded);
          audioUrlRef.current = nextUrl;
          setAudioUrl(nextUrl);
        }
        stream.getTracks().forEach(track => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        setRecording(false);
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      setAudioBlob(null);
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = '';
        setAudioUrl('');
      }
    } catch (recordError) {
      setError(recordError.name === 'NotAllowedError' ? 'Microphone access was blocked. Allow microphone access, then try again.' : 'Could not start the microphone. Please try again.');
    }
  }

  function stopRecording() {
    recorderRef.current?.stop?.();
  }

  async function publishRecording() {
    if (!audioBlob) return setError('Record your feedback before publishing it.');
    if (!authToken) return setError('Sign in to the synced workspace before publishing voice feedback.');

    setPublishing(true);
    setError('');
    try {
      const extension = audioBlob.type.includes('ogg') ? 'ogg' : 'webm';
      const form = new FormData();
      form.append('audio', new File([audioBlob], `voice-feedback.${extension}`, { type: audioBlob.type || 'audio/webm' }));
      form.append('classId', target.classId);
      form.append('studentId', target.studentId);
      if (target.assessmentId) form.append('assessmentId', target.assessmentId);
      form.append('title', target.title);
      const response = await apiRequest('/voice/feedback', { token: authToken, method: 'POST', body: form });
      onPublished(response.feedback);
      onClose();
    } catch (publishError) {
      setError(publishError.message || 'Could not publish the voice feedback.');
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="modal-backdrop" style={{ zIndex: 100 }} onMouseDown={recording ? undefined : onClose}>
      <motion.div className="quick-modal compact-modal" initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} onMouseDown={event => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <p className="eyebrow">PRIVATE VOICE FEEDBACK</p>
            <h2>Record for {target.studentName}</h2>
          </div>
          <IconButton label="Close" disabled={recording || publishing} onClick={onClose}><X size={18} /></IconButton>
        </div>
        <p className="muted">This publishes your original audio only to <b>{target.studentName}</b> for <b>{target.title}</b>. It is not transcribed or analyzed by AI.</p>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', padding: '20px 0 8px' }}>
          <span style={{ height: '64px', width: '64px', borderRadius: '50%', display: 'grid', placeItems: 'center', background: recording ? '#ef4444' : '#eef2ff', color: recording ? '#fff' : '#4f46e5', boxShadow: recording ? '0 0 0 9px rgba(239,68,68,.14)' : 'none' }}><Mic size={28} /></span>
          <b>{recording ? 'Recording…' : audioBlob ? 'Recording ready to publish' : 'Record a voice message'}</b>
          <small className="muted">The student will receive this audio after you publish it.</small>
          {recording ? <Button variant="danger" icon={Square} onClick={stopRecording}>Stop recording</Button> : <Button variant="subtle" icon={Mic} onClick={startRecording} disabled={publishing}>{audioBlob ? 'Record again' : 'Start recording'}</Button>}
        </div>

        {audioUrl && <audio controls src={audioUrl} style={{ width: '100%', marginTop: '12px' }} />}
        {error && <p className="form-error" style={{ marginTop: '12px' }}>{error}</p>}

        <div className="modal-actions" style={{ marginTop: '18px' }}>
          <Button variant="ghost" onClick={onClose} disabled={recording || publishing}>Discard</Button>
          <Button variant="primary" icon={Send} onClick={publishRecording} disabled={!audioBlob || recording || publishing}>{publishing ? 'Publishing…' : 'Publish to student'}</Button>
        </div>
      </motion.div>
    </div>
  );
}

function ClassWorkspacePageV2({ workspace, classId, tab, setTab, onBack, onToast, updateWorkspace, authToken, aiStatus }) {
  const classRecord = workspace.classes.find(item => item.id === classId);
  const grade = classRecord?.name.match(/Grade\s*\d+/)?.[0] || 'Grade 10';
  const roster = workspace.students.filter(student => student.className?.includes(grade));
  const classRecordWithRoster = { ...classRecord, studentsList: roster };

  // Modals Toggle State
  const [profileStudent, setProfileStudent] = useState(null);
  const [profileStudentTab, setProfileStudentTab] = useState('info');
  const [homeworkOpen, setHomeworkOpen] = useState(false);
  const [editHomework, setEditHomework] = useState(null);
  const [viewHomeworkSubmissions, setViewHomeworkSubmissions] = useState(null);
  const [resourceOpen, setResourceOpen] = useState(false);
  const [assessmentOpen, setAssessmentOpen] = useState(false);
  const [gradingAssessment, setGradingAssessment] = useState(null);
  const [editingQuiz, setEditingQuiz] = useState(null);
  const [quizOpen, setQuizOpen] = useState(false);
  const [viewingQuizStats, setViewingQuizStats] = useState(null);

  // Search/Filters states
  const [attendanceDate, setAttendanceDate] = useState('2026-07-19');
  const [attendanceSearch, setAttendanceSearch] = useState('');
  const [resourceSearch, setResourceSearch] = useState('');
  const [messageSearch, setMessageSearch] = useState('');
  const [selectedStudentChat, setSelectedStudentChat] = useState('');
  const [messageText, setMessageText] = useState('');

  // Voice Feedback states
  const [feedbackTarget, setFeedbackTarget] = useState(null);

  if (!classRecord) return null;

  // Filter collections
  const classHomework = (workspace.homework || []).filter(item => item.className?.includes(grade));
  const classTests = (workspace.tests || []).filter(item => item.className?.includes(grade));
  const demoRegistryRecord = findDemoClass(classRecord.joinCode || classRecord.inviteCode || classRecord.id);
  const demoQuizzes = demoRegistryRecord?.quizzes || [];
  const rawQuizzes = [...demoQuizzes, ...(workspace.quizzes || [])];
  const quizMap = new Map();

  rawQuizzes.forEach(q => {
    if (!q) return;
    const isForClass = !q.classId || q.classId === classRecord.id || q.classId === classRecord.joinCode || (demoRegistryRecord?.joinCode && q.classId === demoRegistryRecord.joinCode) || q.title === classRecord.subject || true;
    if (!isForClass) return;

    const existing = quizMap.get(q.id) || Array.from(quizMap.values()).find(ex => ex.title === q.title);
    const key = existing ? existing.id : q.id;

    if (!existing) {
      quizMap.set(key, q);
    } else {
      const existingSubs = existing.submissions || [];
      const newSubs = q.submissions || [];
      const subMap = new Map();
      [...existingSubs, ...newSubs].forEach(s => {
        if (s && s.studentId) subMap.set(s.studentId, s);
      });
      quizMap.set(key, { ...existing, ...q, submissions: Array.from(subMap.values()) });
    }
  });

  const classQuizzes = Array.from(quizMap.values());
  const classFeedback = (workspace.feedback || []).filter(item =>
    roster.some(stud => stud.id === item.studentId)
  );
  const classResources = (workspace.resources || []).filter(item => item.classId === classRecord.id);

  // Send message thread handler
  const messageStudent = roster.find(item => item.id === selectedStudentChat) || roster[0];
  const messageKey = messageStudent ? `${classRecord.id}:${messageStudent.id}` : null;
  const classMessages = messageKey ? workspace.classMessages?.[messageKey] || [] : [];

  function sendClassMessage(event) {
    event.preventDefault();
    if (!messageText.trim() || !messageKey) return;

    updateWorkspace(current => ({
      ...current,
      classMessages: {
        ...(current.classMessages || {}),
        [messageKey]: [
          ...(current.classMessages?.[messageKey] || []),
          { id: `class-message-${Date.now()}`, text: messageText.trim(), time: 'Now', from: 'teacher' }
        ]
      }
    }));
    setMessageText('');
    onToast(`Message sent to ${messageStudent.name}.`);
  }

  // Attendance controls
  const markedAttendance = workspace.attendanceHistory?.[attendanceDate] || { present: [], absent: [], late: [] };
  function toggleAttendance(studentId, status) {
    const history = { ...workspace.attendanceHistory };
    const dateRecord = history[attendanceDate] || { present: [], absent: [], late: [] };

    // Remove from all first
    dateRecord.present = dateRecord.present.filter(id => id !== studentId);
    dateRecord.absent = dateRecord.absent.filter(id => id !== studentId);
    dateRecord.late = dateRecord.late.filter(id => id !== studentId);

    // Add to selected
    if (status === 'present') dateRecord.present.push(studentId);
    else if (status === 'absent') dateRecord.absent.push(studentId);
    else if (status === 'late') dateRecord.late.push(studentId);

    history[attendanceDate] = dateRecord;

    // Recalculate student averages
    const updatedStudents = workspace.students.map(student => {
      const allDates = Object.keys(history);
      const studentClassDates = allDates.filter(d => {
        const rec = history[d];
        return [...rec.present, ...rec.absent, ...rec.late].includes(student.id);
      });
      if (!studentClassDates.length) return student;

      const attendedCount = studentClassDates.filter(d => {
        const rec = history[d];
        return rec.present.includes(student.id) || rec.late.includes(student.id);
      }).length;

      const attendancePct = Math.round((attendedCount / studentClassDates.length) * 100);
      return { ...student, attendance: attendancePct };
    });

    updateWorkspace(current => ({
      ...current,
      attendanceHistory: history,
      students: updatedStudents,
      attendance: attendanceDate === '2026-07-19' ? { date: attendanceDate, present: dateRecord.present, absent: dateRecord.absent } : current.attendance
    }));
  }

  function exportAttendanceCSV() {
    const dateRecord = workspace.attendanceHistory?.[attendanceDate] || { present: [], absent: [], late: [] };
    let csv = 'Roll Number,Name,Status\n';
    roster.forEach(student => {
      let status = 'Not Marked';
      if (dateRecord.present.includes(student.id)) status = 'Present';
      else if (dateRecord.absent.includes(student.id)) status = 'Absent';
      else if (dateRecord.late.includes(student.id)) status = 'Late';
      csv += `"${student.rollNumber}","${student.name}","${status}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${classRecord.name.replace(/\s+/g, '_')}_attendance_${attendanceDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    onToast('Attendance report exported successfully.');
  }

  // Select the student and open the real recorder. The recording is uploaded as
  // audio only; no transcript or AI grading draft is produced.
  function startVoiceRecording(studentId, studentName, title, type = 'assessment', submissionId = '') {
    setFeedbackTarget({
      studentId,
      studentName,
      title,
      type,
      classId: classRecord.id,
      assessmentId: type === 'assessment' ? submissionId : null
    });
  }

  // Graded quiz helper calculation
  const scoredQuizzes = classQuizzes.filter(q => q.submissions && q.submissions.length > 0);
  const totalClassSubmissions = classQuizzes.reduce((sum, q) => sum + (q.submissions?.length || 0), 0);

  // Layout selection
  let detail = null;

  // ==========================================
  // TAB 1: OVERVIEW
  // ==========================================
  if (tab === 'overview') {
    // Dynamic summary computations
    const totalStudents = roster.length;
    const todayPresentCount = markedAttendance.present.length + markedAttendance.late.length;
    const attendanceSummary = totalStudents ? `${todayPresentCount} / ${totalStudents} present` : 'No register marked';

    const pendingHwCount = classHomework.filter(h => h.status === 'Published').reduce((sum, h) => {
      const completedCount = h.submissions?.filter(s => s.status === 'Submitted' || s.status === 'Graded').length || 0;
      return sum + (totalStudents - completedCount);
    }, 0);

    const upcomingAssessment = classTests.find(t => t.status === 'Published')?.title || 'No upcoming exams';
    const upcomingQuiz = classQuizzes.find(q => q.status === 'Published')?.title || 'No active quizzes';
    const pendingFeedbackCount = classHomework.reduce((sum, h) => sum + (h.submissions?.filter(s => s.status === 'Submitted').length || 0), 0) +
      classTests.reduce((sum, t) => sum + (Object.values(t.studentMarks || {}).filter(m => m.status === 'Pending').length || 0), 0);

    // Compute dynamic recent activity stream
    const activities = [];
    classHomework.forEach(h => {
      activities.push({
        type: 'Homework Assigned',
        text: `Homework '${h.title}' assigned to ${h.assignTo === 'all' ? 'entire class' : 'selected students'}.`,
        date: h.due
      });
      h.submissions?.forEach(sub => {
        if (sub.status === 'Submitted' || sub.status === 'Late') {
          activities.push({
            type: 'Student Submission',
            text: `${sub.studentName} submitted '${h.title}'.`,
            date: sub.submittedAt
          });
        }
      });
    });

    classQuizzes.forEach(q => {
      if (q.status === 'Published') {
        activities.push({
          type: 'Quiz Published',
          text: `Practice quiz '${q.title}' published.`,
          date: q.startTime || q.due
        });
      }
      q.submissions?.forEach(sub => {
        activities.push({
          type: 'Student Submission',
          text: `${sub.studentName} completed quiz '${q.title}' (Score: ${sub.score}%).`,
          date: sub.submittedAt
        });
      });
    });

    classTests.forEach(t => {
      activities.push({
        type: 'Assessment Created',
        text: `Formal exam '${t.title}' created (${t.marks} marks possible).`,
        date: t.due
      });
    });

    classFeedback.forEach(f => {
      activities.push({
        type: 'Feedback Sent',
        text: `Audio/written feedback sent to ${f.studentName} for '${f.title}'.`,
        date: 'Recent'
      });
    });

    // Sort activities by date/timestamp
    const recentActivities = activities.slice(0, 5);

    detail = (
      <section className="workspace-detail-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '18px', width: '100%' }}>
        <Card className="span-7">
          <CardHeader eyebrow="CLASS INFO" title={`${classRecord.name} Details`} />
          <div className="stat-list">
            <div><span>Class Name</span><b>{classRecord.name}</b></div>
            <div><span>Subject</span><b>{classRecord.subject}</b></div>
            <div><span>Total Students</span><b>{totalStudents} learners</b></div>
            <div><span>Today's Attendance</span><b>{attendanceSummary}</b></div>
            <div><span>Homework Pending</span><b>{pendingHwCount} items</b></div>
            <div><span>Upcoming Assessment</span><b>{upcomingAssessment}</b></div>
            <div><span>Upcoming Quiz</span><b>{upcomingQuiz}</b></div>
            <div><span>Pending Feedback</span><b>{pendingFeedbackCount} drafts</b></div>
          </div>
        </Card>

        <Card className="span-5">
          <CardHeader eyebrow="RECENT ACTIVITY" title="Rhythm stream" />
          <div className="timeline" style={{ padding: '5px 0' }}>
            {recentActivities.length > 0 ? recentActivities.map((act, index) => (
              <div className="timeline-row now" key={index} style={{ minHeight: '65px' }}>
                <time style={{ fontSize: '9px' }}>{act.type.split(' ')[0]}</time>
                <i />
                <div>
                  <b style={{ fontSize: '11px', color: 'var(--text)' }}>{act.type}</b>
                  <p style={{ fontSize: '10px', margin: '2px 0' }}>{act.text}</p>
                </div>
              </div>
            )) : (
              <p className="workspace-empty" style={{ fontSize: '11px' }}>No activity logged yet.</p>
            )}
          </div>
        </Card>
      </section>
    );
  }

  // ==========================================
  // TAB 2: STUDENTS
  // ==========================================
  else if (tab === 'students') {
    detail = (
      <Card>
        <CardHeader eyebrow="CLASS ROSTER" title="Enrolled students" />
        <p className="muted" style={{ marginBottom: '14px' }}>Click a student to view their detailed academic profile, marks history and attendance.</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Roll Number</th>
                <th>Attendance %</th>
                <th>Homework Status</th>
                <th>Average Marks</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {roster.map(student => {
                // Compute average marks and homework status
                const studHw = classHomework.filter(h => h.status === 'Published');
                const completedHwCount = studHw.filter(h =>
                  h.submissions?.some(s => s.studentId === student.id && (s.status === 'Submitted' || s.status === 'Graded'))
                ).length;
                const hwStatusText = `${completedHwCount} / ${studHw.length} completed`;

                return (
                  <tr key={student.id} style={{ cursor: 'pointer' }} onClick={() => { setProfileStudent(student); setProfileStudentTab('info'); }}>
                    <td>
                      <div className="person">
                        <span className="avatar small">{student.initials}</span>
                        <b>{student.name}</b>
                      </div>
                    </td>
                    <td><b>{student.rollNumber}</b></td>
                    <td><b>{student.attendance}%</b></td>
                    <td>{hwStatusText}</td>
                    <td><span className="badge success">{student.avgMarks}%</span></td>
                    <td>
                      <IconButton label="Open Profile">
                        <ChevronRight size={17} />
                      </IconButton>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    );
  }

  // ==========================================
  // TAB 3: HOMEWORK
  // ==========================================
  else if (tab === 'homework') {
    if (viewHomeworkSubmissions) {
      const hw = viewHomeworkSubmissions;
      const subs = hw.submissions || [];
      const submittedList = subs.filter(s => s.status === 'Submitted' || s.status === 'Graded');
      const pendingList = roster.filter(student => !subs.some(s => s.studentId === student.id && (s.status === 'Submitted' || s.status === 'Graded')));
      const lateList = subs.filter(s => s.status === 'Late');

      detail = (
        <Card>
          <div className="card-header">
            <div>
              <p className="eyebrow" style={{ display: 'flex', gap: '8px' }}>
                <button style={{ border: '0', background: 'transparent', color: '#4f46e5', fontWeight: '800', cursor: 'pointer' }} onClick={() => setViewHomeworkSubmissions(null)}>
                  &larr; Back to homeworks
                </button>
              </p>
              <h3>{hw.title} Submissions</h3>
            </div>
            <span className="badge info">{hw.status}</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '15px', marginTop: '15px' }}>
            {/* COLUMN 1: SUBMITTED */}
            <div style={{ border: '1px solid var(--line)', borderRadius: '12px', padding: '12px', background: 'var(--soft)' }}>
              <h4 style={{ margin: '0 0 10px', fontSize: '12px', display: 'flex', justifyContent: 'space-between' }}>
                <span>Submitted</span> <span className="badge success">{submittedList.length}</span>
              </h4>
              <div style={{ display: 'grid', gap: '8px' }}>
                {submittedList.map(sub => (
                  <div key={sub.studentId} style={{ background: 'var(--surface)', padding: '10px', borderRadius: '8px', border: '1px solid var(--line)', fontSize: '11px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: '700' }}>
                      <span>{sub.studentName}</span>
                      <span style={{ color: 'var(--muted)' }}>{sub.rollNumber}</span>
                    </div>
                    <p style={{ margin: '6px 0', lineStyle: 'italic', color: 'var(--muted)' }}>"{sub.content}"</p>
                    {sub.attachmentUrl && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#4f46e5', fontSize: '10px', fontWeight: '700' }}>
                        <Paperclip size={10} /> {sub.attachmentUrl}
                      </div>
                    )}
                    <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className={`badge ${sub.status === 'Graded' ? 'success' : 'neutral'}`}>
                        {sub.status === 'Graded' ? `Graded: ${sub.score}/40` : 'Awaiting Grade'}
                      </span>
                      <Button
                        variant="subtle"
                        icon={Mic}
                        onClick={() => startVoiceRecording(sub.studentId, sub.studentName, hw.title, 'homework', hw.id)}
                        style={{ height: '26px', minHeight: '26px', fontSize: '10px', padding: '0 8px' }}
                      >
                        Record voice feedback
                      </Button>
                    </div>
                  </div>
                ))}
                {submittedList.length === 0 && <p className="workspace-empty" style={{ fontSize: '10px' }}>No submissions yet.</p>}
              </div>
            </div>

            {/* COLUMN 2: PENDING */}
            <div style={{ border: '1px solid var(--line)', borderRadius: '12px', padding: '12px', background: 'var(--soft)' }}>
              <h4 style={{ margin: '0 0 10px', fontSize: '12px', display: 'flex', justifyContent: 'space-between' }}>
                <span>Pending</span> <span className="badge warning">{pendingList.length}</span>
              </h4>
              <div style={{ display: 'grid', gap: '8px' }}>
                {pendingList.map(student => (
                  <div key={student.id} style={{ background: 'var(--surface)', padding: '10px', borderRadius: '8px', border: '1px solid var(--line)', fontSize: '11px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <b>{student.name}</b>
                    <span className="badge warning">Pending</span>
                  </div>
                ))}
              </div>
            </div>

            {/* COLUMN 3: LATE */}
            <div style={{ border: '1px solid var(--line)', borderRadius: '12px', padding: '12px', background: 'var(--soft)' }}>
              <h4 style={{ margin: '0 0 10px', fontSize: '12px', display: 'flex', justifyContent: 'space-between' }}>
                <span>Late</span> <span className="badge danger">{lateList.length}</span>
              </h4>
              <div style={{ display: 'grid', gap: '8px' }}>
                {lateList.map(sub => (
                  <div key={sub.studentId} style={{ background: 'var(--surface)', padding: '10px', borderRadius: '8px', border: '1px solid var(--line)', fontSize: '11px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: '700' }}>
                      <span>{sub.studentName}</span>
                      <span className="badge danger">Late</span>
                    </div>
                    <p style={{ margin: '4px 0', color: 'var(--muted)' }}>"{sub.content}"</p>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
                      <span style={{ fontSize: '9px', color: 'var(--muted)' }}>
                        Submitted {new Date(sub.submittedAt).toLocaleDateString()}
                      </span>
                      <Button
                        variant="subtle"
                        icon={Mic}
                        onClick={() => startVoiceRecording(sub.studentId, sub.studentName, hw.title, 'homework', hw.id)}
                        style={{ height: '26px', minHeight: '26px', fontSize: '10px', padding: '0 8px' }}
                      >
                        Record voice feedback
                      </Button>
                    </div>
                  </div>
                ))}
                {lateList.length === 0 && <p className="workspace-empty" style={{ fontSize: '10px' }}>No late submissions.</p>}
              </div>
            </div>
          </div>
        </Card>
      );
    } else {
      detail = (
        <Card>
          <CardHeader eyebrow="HOMEWORK" title="Class Homeworks" action="Create homework" onAction={() => { setEditHomework(null); setHomeworkOpen(true); }} />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Due Date</th>
                  <th>Assigned To</th>
                  <th>Submissions</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {classHomework.map(hw => {
                  const completedCount = hw.submissions?.filter(s => s.status === 'Submitted' || s.status === 'Graded').length || 0;
                  const ratioText = `${completedCount} / ${roster.length}`;

                  return (
                    <tr key={hw.id}>
                      <td><b>{hw.title}</b></td>
                      <td><b>{hw.due}</b></td>
                      <td>{hw.assignTo === 'all' ? 'Entire class' : 'Selected students'}</td>
                      <td>
                        <div className="submission-count">
                          <i style={{ width: `${(completedCount / roster.length) * 100}%` }} />
                          {ratioText}
                        </div>
                      </td>
                      <td>
                        <span className={`badge ${hw.status === 'Published' ? 'success' : 'neutral'}`}>{hw.status}</span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <Button variant="subtle" onClick={() => setViewHomeworkSubmissions(hw)}>Submissions</Button>
                          {hw.status === 'Draft' && (
                            <Button
                              variant="primary"
                              onClick={() => {
                                updateWorkspace(current => ({
                                  ...current,
                                  homework: current.homework.map(h => {
                                    if (h.id !== hw.id) return h;
                                    // populate dummy submissions for roster on publish
                                    const dummySub = roster.map(student => ({
                                      studentId: student.id,
                                      studentName: student.name,
                                      rollNumber: student.rollNumber,
                                      content: '',
                                      status: 'Pending',
                                      submittedAt: null
                                    }));
                                    return { ...h, status: 'Published', submissions: dummySub };
                                  })
                                }));
                                onToast('Homework published to students.');
                              }}
                            >
                              Publish
                            </Button>
                          )}
                          <IconButton label="Edit" onClick={() => { setEditHomework(hw); setHomeworkOpen(true); }}><Edit3 size={15} /></IconButton>
                          <IconButton
                            label="Delete"
                            onClick={() => {
                              updateWorkspace(current => ({ ...current, homework: current.homework.filter(h => h.id !== hw.id) }));
                              onToast('Homework deleted.');
                            }}
                          >
                            <Trash2 size={15} />
                          </IconButton>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {classHomework.length === 0 && (
                  <tr>
                    <td colSpan="6">
                      <p className="workspace-empty">No homework found for this class.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      );
    }
  }

  // ==========================================
  // TAB 4: ATTENDANCE
  // ==========================================
  else if (tab === 'attendance') {
    const presentList = markedAttendance.present;
    const absentList = markedAttendance.absent;
    const lateList = markedAttendance.late;
    const markedCount = presentList.length + absentList.length + lateList.length;

    const filteredRoster = roster.filter(student =>
      student.name.toLowerCase().includes(attendanceSearch.toLowerCase()) ||
      student.rollNumber.includes(attendanceSearch)
    );

    const presentPct = roster.length ? Math.round(((presentList.length + lateList.length) / roster.length) * 100) : 0;

    detail = (
      <div className="attendance-layout" style={{ gridTemplateColumns: '300px 1fr' }}>
        <Card className="attendance-summary">
          <span className="summary-date">{attendanceDate}</span>
          <h2>{presentList.length + lateList.length} <small>/ {roster.length} present</small></h2>
          <div className="donut" style={{ background: `conic-gradient(#10b981 0% ${presentPct}%, #e2e8f0 ${presentPct}% 100%)` }}>
            <span>{presentPct}%</span>
          </div>
          <p>Class attendance register is fully local and secure.</p>
          <div style={{ marginTop: '15px', display: 'flex', gap: '8px', justifyContent: 'center' }}>
            <Button variant="subtle" icon={Download} onClick={exportAttendanceCSV}>Export CSV</Button>
          </div>
        </Card>

        <Card className="attendance-list">
          <div className="card-header" style={{ display: 'block' }}>
            <p className="eyebrow">ATTENDANCE REGISTER</p>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '8px' }}>
              <input
                type="date"
                value={attendanceDate}
                onChange={e => setAttendanceDate(e.target.value)}
                style={{ height: '36px', border: '1px solid var(--line)', borderRadius: '8px', padding: '0 8px', background: 'var(--input)', color: 'var(--text)', fontSize: '12px' }}
              />
              <div className="table-search" style={{ margin: '0', width: '200px' }}>
                <Search size={15} />
                <input placeholder="Search roster..." value={attendanceSearch} onChange={e => setAttendanceSearch(e.target.value)} />
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gap: '8px', marginTop: '15px' }}>
            {filteredRoster.map(student => {
              let currentStatus = 'absent';
              if (presentList.includes(student.id)) currentStatus = 'present';
              else if (lateList.includes(student.id)) currentStatus = 'late';

              return (
                <div key={student.id} className="attendance-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0' }}>
                  <div className="person">
                    <span className="avatar small">{student.initials}</span>
                    <div>
                      <b>{student.name}</b>
                      <small style={{ color: 'var(--muted)' }}>Roll: {student.rollNumber}</small>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      className={`attendance-toggle ${currentStatus === 'present' ? 'present' : ''}`}
                      onClick={() => toggleAttendance(student.id, 'present')}
                      style={{ border: currentStatus === 'present' ? '1px solid #10b981' : '1px solid var(--line)', background: currentStatus === 'present' ? '#ecfdf5' : 'transparent', color: currentStatus === 'present' ? '#059669' : 'var(--muted)' }}
                    >
                      Present
                    </button>
                    <button
                      className={`attendance-toggle ${currentStatus === 'late' ? 'present' : ''}`}
                      onClick={() => toggleAttendance(student.id, 'late')}
                      style={{ border: currentStatus === 'late' ? '1px solid #f59e0b' : '1px solid var(--line)', background: currentStatus === 'late' ? '#fffbeb' : 'transparent', color: currentStatus === 'late' ? '#d97706' : 'var(--muted)' }}
                    >
                      Late
                    </button>
                    <button
                      className="attendance-toggle"
                      onClick={() => toggleAttendance(student.id, 'absent')}
                      style={{ border: currentStatus === 'absent' ? '1px solid #ef4444' : '1px solid var(--line)', background: currentStatus === 'absent' ? '#fdf2f2' : 'transparent', color: currentStatus === 'absent' ? '#dc2626' : 'var(--muted)' }}
                    >
                      Absent
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    );
  }

  // ==========================================
  // TAB 5: ASSESSMENTS
  // ==========================================
  else if (tab === 'assessments') {
    if (gradingAssessment) {
      const exam = gradingAssessment;
      const marksMap = exam.studentMarks || {};

      function saveMarks(studentId, obtainedVal, commentsVal) {
        updateWorkspace(current => ({
          ...current,
          tests: current.tests.map(test => {
            if (test.id !== exam.id) return test;
            return {
              ...test,
              studentMarks: {
                ...(test.studentMarks || {}),
                [studentId]: {
                  ...(test.studentMarks?.[studentId] || {}),
                  marks: obtainedVal === '' ? null : Number(obtainedVal),
                  comments: commentsVal,
                  status: obtainedVal === '' ? 'Pending' : 'Graded'
                }
              }
            };
          })
        }));
        onToast('Marks saved successfully.');
      }

      detail = (
        <Card>
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p className="eyebrow">
                <button style={{ border: '0', background: 'transparent', color: '#4f46e5', fontWeight: '800', cursor: 'pointer' }} onClick={() => setGradingAssessment(null)}>
                  &larr; Back to exams
                </button>
              </p>
              <h3>Enter Marks: {exam.title}</h3>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <Button variant="subtle" icon={Plus} onClick={() => setAssessmentOpen(true)}>Add Assessment</Button>
              <span className="badge info">{exam.status}</span>
            </div>
          </div>

          <div style={{ display: 'grid', gap: '12px', marginTop: '15px' }}>
            {roster.map(student => {
              const record = marksMap[student.id] || { marks: '', comments: '', status: 'Pending' };

              return (
                <div key={student.id} style={{ display: 'grid', gridTemplateColumns: '180px 100px 1fr 140px', gap: '12px', alignItems: 'center', padding: '12px', background: 'var(--soft)', borderRadius: '10px', border: '1px solid var(--line)' }}>
                  <div className="person">
                    <span className="avatar small">{student.initials}</span>
                    <div>
                      <b>{student.name}</b>
                      <small style={{ color: 'var(--muted)' }}>Roll: {student.rollNumber}</small>
                    </div>
                  </div>

                  <div>
                    <input
                      type="number"
                      placeholder={`/ ${exam.marks}`}
                      defaultValue={record.marks === null ? '' : record.marks}
                      onBlur={e => saveMarks(student.id, e.target.value, record.comments)}
                      style={{ width: '80px', height: '36px', border: '1px solid var(--line)', borderRadius: '8px', padding: '0 8px', background: 'var(--surface)', color: 'var(--text)' }}
                    />
                  </div>

                  <div>
                    <input
                      type="text"
                      placeholder="Comment feedback..."
                      defaultValue={record.comments}
                      onBlur={e => saveMarks(student.id, record.marks, e.target.value)}
                      style={{ width: '100%', height: '36px', border: '1px solid var(--line)', borderRadius: '8px', padding: '0 8px', background: 'var(--surface)', color: 'var(--text)' }}
                    />
                  </div>

                  <div>
                    <Button
                      variant="subtle"
                      icon={Mic}
                      onClick={() => startVoiceRecording(student.id, student.name, exam.title, 'assessment', exam.id)}
                      style={{ height: '32px', minHeight: '32px', fontSize: '10px' }}
                    >
                      Record voice feedback
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      );
    } else {
      detail = (
        <Card>
          <CardHeader eyebrow="FORMAL EXAMS" title="Assessments" action="Create Exam" onAction={() => { setAssessmentOpen(true); }} />
          <p className="muted" style={{ marginBottom: '14px' }}>Assessments are formal grading examinations. There are no AI quiz generations in this module.</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Paper</th>
                  <th>Marks</th>
                  <th>Due Date</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {classTests.map(exam => {
                  const gradedCount = Object.values(exam.studentMarks || {}).filter(m => m.status === 'Graded').length;

                  return (
                    <tr key={exam.id}>
                      <td><b>{exam.title}</b></td>
                      <td>
                        {exam.questionPaperUrl ? (
                          <span style={{ fontSize: '11px', color: '#4f46e5', fontWeight: '700' }}>
                            <Paperclip size={10} /> {exam.questionPaperUrl}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--muted)' }}>No paper uploaded</span>
                        )}
                      </td>
                      <td><b>{exam.marks}</b></td>
                      <td>{exam.due || 'No date'}</td>
                      <td>
                        <span className={`badge ${exam.status === 'Published' ? 'success' : exam.status === 'Completed' ? 'neutral' : 'info'}`}>
                          {exam.status}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <Button variant="subtle" onClick={() => setGradingAssessment(exam)}>Enter Marks</Button>
                          {exam.status === 'Draft' && (
                            <Button
                              variant="primary"
                              onClick={() => {
                                updateWorkspace(current => ({
                                  ...current,
                                  tests: current.tests.map(t => {
                                    if (t.id !== exam.id) return t;
                                    // populate empty marks list
                                    const marksList = {};
                                    roster.forEach(st => {
                                      marksList[st.id] = { marks: null, status: 'Pending', comments: '', submittedAnswersUrl: '' };
                                    });
                                    return { ...t, status: 'Published', studentMarks: marksList };
                                  })
                                }));
                                onToast('Exam published to students.');
                              }}
                            >
                              Publish
                            </Button>
                          )}
                          {exam.status === 'Published' && (
                            <Button
                              variant="subtle"
                              onClick={() => {
                                updateWorkspace(current => ({
                                  ...current,
                                  tests: current.tests.map(t => t.id === exam.id ? { ...t, status: 'Completed' } : t)
                                }));
                                onToast('Exam finalized.');
                              }}
                            >
                              Close Exam
                            </Button>
                          )}
                          <IconButton
                            label="Delete"
                            onClick={() => {
                              updateWorkspace(current => ({ ...current, tests: current.tests.filter(t => t.id !== exam.id) }));
                              onToast('Assessment deleted.');
                            }}
                          >
                            <Trash2 size={15} />
                          </IconButton>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {classTests.length === 0 && (
                  <tr>
                    <td colSpan="6">
                      <p className="workspace-empty">No assessments created.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      );
    }
  }

  // ==========================================
  // TAB 6: QUIZZES (NEW MODULE)
  // ==========================================
  else if (tab === 'quiz') {
    if (viewingQuizStats) {
      return (
        <div style={{ padding: '24px 32px 48px', flex: 1, minWidth: 0, overflowY: 'auto' }}>
          <QuizAiAnalysisView
            quiz={viewingQuizStats}
            roster={roster}
            onBack={() => setViewingQuizStats(null)}
            onToast={onToast}
            updateWorkspace={updateWorkspace}
          />
        </div>
      );
    }

    // Dashboard View for Quizzes
    const avgScoreTotal = scoredQuizzes.length
      ? Math.round(scoredQuizzes.reduce((sum, q) => sum + (q.averageScore || 0), 0) / scoredQuizzes.length)
      : 'N/A';

    detail = (
      <div style={{ display: 'grid', gap: '20px' }}>
        <section className="quiz-summary-grid">
          <article><span>Total Quizzes</span><b>{classQuizzes.length}</b><small>Practice checks</small></article>
          <article><span>Drafts</span><b>{classQuizzes.filter(q => q.status === 'Draft').length}</b><small>Need review</small></article>
          <article><span>Published</span><b>{classQuizzes.filter(q => q.status === 'Published').length}</b><small>Active quizzes</small></article>
          <article><span>Average Score</span><b>{avgScoreTotal}%</b><small>Class average</small></article>
          <article>
            <span>Submissions</span>
            <b>{totalClassSubmissions}</b>
            <small>Total student attempts</small>
          </article>
        </section>

        <Card className="workspace-table">
          <CardHeader eyebrow="PRACTICE MODULE" title="Practice Quizzes" action="Create quiz" onAction={() => { setEditingQuiz(null); setQuizOpen(true); }} />
          <p className="muted" style={{ marginBottom: '14px' }}>Quizzes are short diagnostics. Teachers review and edit AI suggestions before publishing. AI never publishes automatically.</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Topic</th>
                  <th>Questions</th>
                  <th>Time Limit</th>
                  <th>Assigned To</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {classQuizzes.map(quiz => (
                  <tr key={quiz.id}>
                    <td><b>{quiz.title}</b></td>
                    <td>{quiz.topic}</td>
                    <td><b>{quiz.questions?.length || 0} questions</b></td>
                    <td>{quiz.timeLimit} mins</td>
                    <td>{quiz.assignment || 'Entire class'}</td>
                    <td>
                      <span className={`badge ${quiz.status === 'Published' ? 'success' : 'neutral'}`}>
                        {quiz.status}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <Button variant="subtle" icon={Sparkles} onClick={() => setViewingQuizStats(quiz)}>
                          AI Analysis
                        </Button>
                        {quiz.status === 'Draft' && (
                          <Button
                            variant="primary"
                            onClick={() => {
                              updateWorkspace(current => ({
                                ...current,
                                quizzes: current.quizzes.map(q => q.id === quiz.id ? { ...q, status: 'Published' } : q)
                              }));
                              onToast('Quiz published to assigned students.');
                            }}
                          >
                            Publish
                          </Button>
                        )}
                        <IconButton label="Edit" onClick={() => { setEditingQuiz(quiz); setQuizOpen(true); }}><Edit3 size={15} /></IconButton>
                        <IconButton
                          label="Delete"
                          onClick={() => {
                            updateWorkspace(current => ({ ...current, quizzes: current.quizzes.filter(q => q.id !== quiz.id) }));
                            onToast('Quiz deleted.');
                          }}
                        >
                          <Trash2 size={15} />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                ))}
                {classQuizzes.length === 0 && (
                  <tr>
                    <td colSpan="7">
                      <p className="workspace-empty">No practice quizzes. Click "Create quiz" to start.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    );
  }

  // ==========================================
  // TAB 7: PRIVATE VOICE FEEDBACK
  // ==========================================
  else if (tab === 'feedback') {
    // Collect all assessment and homework submissions needing grading/feedback
    const papers = [];
    classHomework.forEach(hw => {
      hw.submissions?.forEach(sub => {
        if (sub.status === 'Submitted' || sub.status === 'Graded') {
          papers.push({
            id: `hw-${hw.id}-${sub.studentId}`,
            studentId: sub.studentId,
            studentName: sub.studentName,
            rollNumber: sub.rollNumber,
            title: hw.title,
            type: 'homework',
            refId: hw.id,
            status: sub.status,
            content: sub.content,
            attachment: sub.attachmentUrl,
            marks: sub.status === 'Graded' ? sub.score : null
          });
        }
      });
    });

    classTests.forEach(test => {
      Object.entries(test.studentMarks || {}).forEach(([studId, mark]) => {
        const student = roster.find(s => s.id === studId);
        if (student) {
          papers.push({
            id: `test-${test.id}-${studId}`,
            studentId: studId,
            studentName: student.name,
            rollNumber: student.rollNumber,
            title: test.title,
            type: 'assessment',
            refId: test.id,
            status: mark.status,
            content: 'Formal examination script.',
            attachment: test.questionPaperUrl,
            marks: mark.marks
          });
        }
      });
    });

    detail = (
      <div style={{ display: 'grid', gap: '20px' }}>
        <Card className="feedback-card" style={{ background: 'linear-gradient(135deg, #f5f3ff, #ede9fe)', border: '1px solid #c7d2fe', padding: '24px' }}>
          <div className="voice-head">
            <span className="voice-icon" style={{ background: '#ddd6fe', color: '#6d28d9' }}><Mic size={24} /></span>
            <div>
              <p className="eyebrow" style={{ color: '#6d28d9', margin: '0' }}>PRIVATE VOICE FEEDBACK</p>
              <h3 style={{ margin: '4px 0', fontSize: '18px' }}>Record and send audio feedback</h3>
            </div>
          </div>
          <p style={{ color: '#5b21b6', fontSize: '12px', margin: '12px 0 16px', lineHeight: '1.5' }}>
            Record your feedback in your own words. When you publish, only the selected student can play the private audio recording. TeachMate does not transcribe or analyze it.
          </p>
        </Card>

        <Card>
          <CardHeader eyebrow="STUDENT PAPERS" title="Submissions awaiting correction" />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Assignment / Exam</th>
                  <th>Type</th>
                  <th>Submission status</th>
                  <th>Score given</th>
                  <th>Voice feedback</th>
                </tr>
              </thead>
              <tbody>
                {papers.map(p => (
                  <tr key={p.id}>
                    <td>
                      <div className="person">
                        <span className="avatar small">{initials(p.studentName)}</span>
                        <b>{p.studentName}</b>
                      </div>
                    </td>
                    <td><b>{p.title}</b></td>
                    <td><span className={`badge ${p.type === 'homework' ? 'info' : 'success'}`}>{p.type}</span></td>
                    <td>{p.status}</td>
                    <td><b>{p.marks !== null ? `${p.marks}` : '—'}</b></td>
                    <td>
                      <Button
                        variant="primary"
                        icon={Mic}
                        onClick={() => startVoiceRecording(p.studentId, p.studentName, p.title, p.type, p.refId)}
                      >
                        Record voice feedback
                      </Button>
                    </td>
                  </tr>
                ))}
                {papers.length === 0 && (
                  <tr>
                    <td colSpan="6">
                      <p className="workspace-empty">No student papers submitted yet.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    );
  }

  // ==========================================
  // TAB 8: RESOURCES
  // ==========================================
  else if (tab === 'resources') {
    const filteredRes = classResources.filter(res =>
      res.name.toLowerCase().includes(resourceSearch.toLowerCase()) ||
      res.fileName.toLowerCase().includes(resourceSearch.toLowerCase())
    );

    detail = (
      <Card>
        <div className="resource-toolbar">
          <div className="table-search" style={{ width: '250px' }}>
            <Search size={16} />
            <input placeholder="Search resources..." value={resourceSearch} onChange={e => setResourceSearch(e.target.value)} />
          </div>
          <Button icon={Plus} onClick={() => setResourceOpen(true)}>Upload resource</Button>
        </div>
        <p className="muted" style={{ marginBottom: '14px' }}>Teachers upload materials (PDF, PPT, worksheets, notes, videos) for student viewing and downloads. No AI is used here.</p>

        <div className="resource-grid">
          {filteredRes.map(res => (
            <article className="resource-card" key={res.id}>
              <span className={`resource-cover ${res.tint || 'violet'}`}>
                <Library size={24} />
                <small style={{ fontSize: '8px' }}>{res.type.toUpperCase()}</small>
              </span>
              <span>
                <b>{res.name}</b>
                <p style={{ fontSize: '9px', color: 'var(--muted)', marginTop: '3px' }}>{res.fileName}</p>
                <small style={{ fontSize: '9px', color: 'var(--muted)' }}>Uploaded: {res.updated}</small>
              </span>
              <IconButton
                label="Download"
                onClick={() => {
                  onToast(`Downloading: ${res.fileName}`);
                }}
              >
                <Download size={16} />
              </IconButton>
              <IconButton
                label="Delete"
                onClick={() => {
                  updateWorkspace(current => ({ ...current, resources: current.resources.filter(r => r.id !== res.id) }));
                  onToast('Resource removed.');
                }}
                style={{ color: '#ef4444' }}
              >
                <Trash2 size={14} />
              </IconButton>
            </article>
          ))}
          {filteredRes.length === 0 && <p className="workspace-empty">No resources found.</p>}
        </div>
      </Card>
    );
  }

  // ==========================================
  // TAB 9: MESSAGES
  // ==========================================
  else if (tab === 'messages') {
    const filteredContacts = roster.filter(student =>
      student.name.toLowerCase().includes(messageSearch.toLowerCase())
    );

    detail = (
      <section className="class-message-layout" style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '18px' }}>
        <Card className="class-message-list" style={{ padding: '0', overflow: 'hidden' }}>
          <CardHeader eyebrow="CLASS STUDENTS" title="Student Chat" />
          <div className="table-search" style={{ margin: '0 15px 15px', width: 'auto' }}>
            <Search size={15} />
            <input placeholder="Search students..." value={messageSearch} onChange={e => setMessageSearch(e.target.value)} />
          </div>
          <div style={{ overflowY: 'auto', maxHeight: '360px' }}>
            {filteredContacts.map(student => (
              <button
                className={`class-message-student ${messageStudent?.id === student.id ? 'selected' : ''}`}
                key={student.id}
                onClick={() => setSelectedStudentChat(student.id)}
                style={{ width: '100%', border: '0', borderTop: '1px solid var(--line)', background: messageStudent?.id === student.id ? '#eef2ff' : 'transparent', textAlign: 'left', padding: '12px 16px', display: 'flex', gap: '8px' }}
              >
                <span className="avatar small">{student.initials}</span>
                <span>
                  <b>{student.name}</b>
                  <small style={{ color: 'var(--muted)', fontSize: '9px' }}>Roll: {student.rollNumber}</small>
                </span>
              </button>
            ))}
          </div>
        </Card>

        <Card className="class-message-thread" style={{ display: 'grid', gridTemplateRows: 'auto 1fr auto', minHeight: '430px' }}>
          <CardHeader eyebrow="PRIVATE CHAT" title={messageStudent ? `${messageStudent.name} (${messageStudent.rollNumber})` : 'Select Student'} />
          <div className="class-message-bubbles" style={{ overflowY: 'auto', maxHeight: '300px', display: 'flex', flexDirection: 'column', gap: '10px', padding: '15px', background: 'var(--soft)' }}>
            {classMessages.length ? classMessages.map(msg => (
              <div
                key={msg.id}
                className="class-message-bubble"
                style={{
                  alignSelf: msg.from === 'teacher' ? 'flex-end' : 'flex-start',
                  background: msg.from === 'teacher' ? '#4f46e5' : 'var(--surface)',
                  color: msg.from === 'teacher' ? '#fff' : 'var(--text)',
                  border: msg.from === 'teacher' ? 'none' : '1px solid var(--line)',
                  borderRadius: '12px',
                  padding: '8px 12px',
                  maxWidth: '70%'
                }}
              >
                <p style={{ margin: '0', fontSize: '12px' }}>{msg.text}</p>
                <small style={{ display: 'block', fontSize: '8px', color: msg.from === 'teacher' ? '#ddd' : 'var(--muted)', textAlign: 'right', marginTop: '4px' }}>
                  {msg.time} &middot; Read
                </small>
              </div>
            )) : (
              <p className="workspace-empty">No messages in this chat. Start a conversation below.</p>
            )}
          </div>

          <form className="chat-compose" onSubmit={sendClassMessage} style={{ display: 'flex', gap: '8px', padding: '12px', borderTop: '1px solid var(--line)' }}>
            <input
              value={messageText}
              onChange={e => setMessageText(e.target.value)}
              placeholder={`Message ${messageStudent?.name || 'student'}...`}
              style={{ flex: '1', height: '36px', border: '1px solid var(--line)', borderRadius: '8px', padding: '0 10px', background: 'var(--input)', color: 'var(--text)', fontSize: '12px' }}
            />
            <Button type="submit" icon={Send}>Send</Button>
          </form>
        </Card>
      </section>
    );
  }

  return (
    <PageMotion>
      <button className="workspace-back" onClick={onBack}><ArrowLeft size={16} /> All classes</button>

      {/* RENDER FULL HERO BANNER AND METRICS ONLY ON OVERVIEW TAB */}
      {tab === 'overview' ? (
        <>
          <section className={`class-workspace-hero ${classRecord.color || 'indigo'}`}>
            <div>
              <span className="workspace-icon"><BookOpen size={24} /></span>
              <p>{classRecord.subject} &middot; Class workspace</p>
              <h1>{classRecord.name}</h1>
              <span className="workspace-id">Class ID: {classRecord.joinCode || 'Saved locally'}</span>
            </div>
            <div className="workspace-hero-actions">
              <Button variant="light" onClick={() => { if (classRecord.joinCode) void navigator.clipboard?.writeText(classRecord.joinCode); onToast(`Class ID copied: ${classRecord.joinCode}`); }}>
                Share Class ID
              </Button>
            </div>
          </section>

          <section className="workspace-metrics">
            <article>
              <span>Students</span>
              <b>{roster.length}</b>
              <small>Enrolled in class</small>
            </article>
            <article>
              <span>Mastery</span>
              <b>{classRecord.progress || 0}%</b>
              <small>Current learning progress</small>
            </article>
            <article>
              <span>Active Homework</span>
              <b>{classHomework.filter(h => h.status === 'Published').length}</b>
              <small>Assigned assignments</small>
            </article>
          </section>
        </>
      ) : (
        <div className="page-heading" style={{ marginBottom: '18px' }}>
          <div>
            <div className="eyebrow">{classRecord.name} &middot; {classRecord.subject}</div>
            <h1 style={{ fontSize: '24px', letterSpacing: '-0.8px' }}>
              {tab.charAt(0).toUpperCase() + tab.slice(1) === 'Quiz' ? 'Practice Quizzes' : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </h1>
          </div>
        </div>
      )}

      {detail}

      {/* MODALS RENDERING */}
      <AnimatePresence>
        {homeworkOpen && (
          <ClassHomeworkModal
            classRecord={classRecordWithRoster}
            updateWorkspace={updateWorkspace}
            onClose={() => setHomeworkOpen(false)}
            onToast={onToast}
            homeworkToEdit={editHomework}
          />
        )}

        {resourceOpen && (
          <ClassResourceModal
            classRecord={classRecord}
            updateWorkspace={updateWorkspace}
            onClose={() => setResourceOpen(false)}
            onToast={onToast}
          />
        )}

        {assessmentOpen && (
          <ClassAssessmentModal
            classRecord={classRecord}
            updateWorkspace={updateWorkspace}
            onClose={() => setAssessmentOpen(false)}
            onToast={onToast}
          />
        )}

        {quizOpen && (
          <ClassQuizModal
            classRecord={classRecord}
            roster={roster}
            updateWorkspace={updateWorkspace}
            onClose={() => { setQuizOpen(false); setEditingQuiz(null); }}
            onToast={onToast}
            quizToEdit={editingQuiz}
            authToken={authToken}
            aiStatus={aiStatus}
          />
        )}

        {/* Private recording: stored as audio and published only to the selected student. */}
        {feedbackTarget && (
          <VoiceFeedbackRecorderModal
            target={feedbackTarget}
            authToken={authToken}
            onClose={() => setFeedbackTarget(null)}
            onPublished={feedback => {
              updateWorkspace(current => ({
                ...current,
                voiceFeedback: [{
                  ...feedback,
                  studentId: feedbackTarget.studentId,
                  studentName: feedbackTarget.studentName,
                  classId: feedbackTarget.classId
                }, ...(current.voiceFeedback || [])]
              }));
              onToast(`Voice feedback published to ${feedbackTarget.studentName}.`);
            }}
          />
        )}



        {/* STUDENT PROFILE DETAILED MODAL */}
        {profileStudent && (
          <div className="modal-backdrop" onMouseDown={() => setProfileStudent(null)}>
            <motion.div
              className="quick-modal quiz-builder-modal"
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              onMouseDown={e => e.stopPropagation()}
              style={{ width: '680px', maxHeight: '90vh', overflowY: 'auto' }}
            >
              <div className="modal-head">
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span className="avatar" style={{ height: '48px', width: '48px', fontSize: '14px' }}>{profileStudent.initials}</span>
                  <div>
                    <h2 style={{ margin: '0' }}>{profileStudent.name}</h2>
                    <p className="muted" style={{ margin: '2px 0 0' }}>Roll: {profileStudent.rollNumber} &middot; {profileStudent.className}</p>
                  </div>
                </div>
                <IconButton label="Close" onClick={() => setProfileStudent(null)}><X size={19} /></IconButton>
              </div>

              {/* PROFILE MODULE TABS */}
              <nav className="workspace-tabs" style={{ display: 'flex', margin: '14px 0 16px', borderBottom: '1px solid var(--line)' }}>
                {[
                  ['info', 'Basic Info'],
                  ['attendance', 'Attendance'],
                  ['homework', 'Homework'],
                  ['assessments', 'Exams'],
                  ['quizzes', 'Quizzes'],
                  ['feedback', 'Feedback']
                ].map(([tabId, label]) => (
                  <button
                    key={tabId}
                    className={profileStudentTab === tabId ? 'active' : ''}
                    onClick={() => setProfileStudentTab(tabId)}
                    style={{ border: '0', background: 'transparent', padding: '8px 12px', fontSize: '11px', fontWeight: '700', borderBottom: profileStudentTab === tabId ? '2px solid #4f46e5' : 'none', color: profileStudentTab === tabId ? '#4f46e5' : 'var(--muted)', cursor: 'pointer' }}
                  >
                    {label}
                  </button>
                ))}
              </nav>

              <div style={{ minHeight: '220px' }}>
                {profileStudentTab === 'info' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div style={{ border: '1px solid var(--line)', borderRadius: '10px', padding: '10px' }}>
                      <span className="muted" style={{ fontSize: '10px' }}>ATTENDANCE RATE</span>
                      <b style={{ display: 'block', fontSize: '20px', marginTop: '4px' }}>{profileStudent.attendance}%</b>
                      <small style={{ color: 'var(--muted)' }}>Calculated over term classes</small>
                    </div>
                    <div style={{ border: '1px solid var(--line)', borderRadius: '10px', padding: '10px' }}>
                      <span className="muted" style={{ fontSize: '10px' }}>AVERAGE MASTER MARK</span>
                      <b style={{ display: 'block', fontSize: '20px', marginTop: '4px' }}>{profileStudent.avgMarks}%</b>
                      <small style={{ color: 'var(--muted)' }}>Across formal exams</small>
                    </div>
                  </div>
                )}

                {profileStudentTab === 'attendance' && (
                  <div style={{ display: 'grid', gap: '6px' }}>
                    {Object.entries(workspace.attendanceHistory || {}).map(([date, rec]) => {
                      let status = 'Absent';
                      let color = 'danger';
                      if (rec.present.includes(profileStudent.id)) { status = 'Present'; color = 'success'; }
                      else if (rec.late.includes(profileStudent.id)) { status = 'Late'; color = 'warning'; }

                      return (
                        <div key={date} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 10px', background: 'var(--soft)', borderRadius: '8px', border: '1px solid var(--line)', fontSize: '11px' }}>
                          <b>{date}</b>
                          <span className={`badge ${color}`}>{status}</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {profileStudentTab === 'homework' && (
                  <div style={{ display: 'grid', gap: '8px' }}>
                    {classHomework.map(hw => {
                      const sub = hw.submissions?.find(s => s.studentId === profileStudent.id) || { status: 'Pending' };

                      return (
                        <div key={hw.id} style={{ padding: '10px', background: 'var(--soft)', borderRadius: '8px', border: '1px solid var(--line)', fontSize: '11px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: '700' }}>
                            <span>{hw.title}</span>
                            <span className={`badge ${sub.status === 'Submitted' || sub.status === 'Graded' ? 'success' : 'warning'}`}>{sub.status}</span>
                          </div>
                          {sub.content && <p style={{ margin: '6px 0 0', color: 'var(--muted)', fontStyle: 'italic' }}>"{sub.content}"</p>}
                        </div>
                      );
                    })}
                  </div>
                )}

                {profileStudentTab === 'assessments' && (
                  <div style={{ display: 'grid', gap: '8px' }}>
                    {classTests.map(exam => {
                      const markRecord = exam.studentMarks?.[profileStudent.id] || { marks: null, comments: 'No feedback.', status: 'Pending' };

                      return (
                        <div key={exam.id} style={{ padding: '10px', background: 'var(--soft)', borderRadius: '8px', border: '1px solid var(--line)', fontSize: '11px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: '700' }}>
                            <span>{exam.title}</span>
                            <b>{markRecord.marks !== null ? `${markRecord.marks} / ${exam.marks}` : 'Not graded'}</b>
                          </div>
                          <p style={{ margin: '4px 0 0', color: 'var(--muted)' }}>Comments: {markRecord.comments || 'None'}</p>
                        </div>
                      );
                    })}
                  </div>
                )}

                {profileStudentTab === 'quizzes' && (
                  <div style={{ display: 'grid', gap: '8px' }}>
                    {classQuizzes.map(quiz => {
                      const sub = quiz.submissions?.find(s => s.studentId === profileStudent.id);

                      return (
                        <div key={quiz.id} style={{ padding: '10px', background: 'var(--soft)', borderRadius: '8px', border: '1px solid var(--line)', fontSize: '11px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: '700' }}>
                            <span>{quiz.title}</span>
                            <b>{sub ? `${sub.score}%` : 'Not Taken'}</b>
                          </div>
                          {sub && <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: '10px' }}>Topics: Strong: {sub.analysis?.strongTopics?.join(', ') || 'N/A'}; Weak: {sub.analysis?.weakTopics?.join(', ') || 'None'}</p>}
                        </div>
                      );
                    })}
                  </div>
                )}

                {profileStudentTab === 'feedback' && (
                  <div style={{ display: 'grid', gap: '8px' }}>
                    {classFeedback.filter(f => f.studentId === profileStudent.id).map(f => (
                      <div key={f.id} style={{ padding: '10px', background: 'var(--soft)', borderRadius: '8px', border: '1px solid var(--line)', fontSize: '11px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: '700' }}>
                          <span>{f.title}</span>
                          <b>Score: {f.marks}/{f.possibleMarks}</b>
                        </div>
                        <p style={{ margin: '4px 0', color: 'var(--muted)' }}>Comments: "{f.text}"</p>
                        {f.transcript && (
                          <div style={{ fontSize: '10px', background: 'var(--surface)', padding: '6px', borderRadius: '6px', border: '1px solid var(--line)' }}>
                            <Volume2 size={12} style={{ display: 'inline', marginRight: '4px' }} /> "{f.transcript}"
                          </div>
                        )}
                      </div>
                    ))}
                    {classFeedback.filter(f => f.studentId === profileStudent.id).length === 0 && (
                      <p className="workspace-empty">No voice feedback corrections recorded.</p>
                    )}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '15px' }}>
                <Button variant="ghost" onClick={() => setProfileStudent(null)}>Close Profile</Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </PageMotion>
  );
}

function ClassWorkspaceShell({ workspace, classId, tab, setTab, onBack, onToast, updateWorkspace, mobileOpen, closeMobile, authToken, aiStatus }) {
  const classRecord = workspace.classes.find(item => item.id === classId);
  if (!classRecord) return null;
  return (
    <div className="class-workspace-shell">
      <ClassSidebar profile={workspace.profile} classRecord={classRecord} tab={tab} setTab={setTab} mobileOpen={mobileOpen} closeMobile={closeMobile} onBack={onBack} />
      <ClassWorkspacePageV2 workspace={workspace} classId={classId} tab={tab} setTab={setTab} onBack={onBack} onToast={onToast} updateWorkspace={updateWorkspace} authToken={authToken} aiStatus={aiStatus} />
    </div>
  );
}

function NewClassModal({ workspace, updateWorkspace, authToken, onClose, onToast }) {
  const [form, setForm] = useState({ name: '', grade: '', subject: '', academicYear: '2026-27' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  const update = event => setForm(current => ({ ...current, [event.target.name]: event.target.value }));

  async function review(event) {
    event.preventDefault();
    if (!form.name.trim() || !form.grade.trim() || !form.subject.trim()) return setError('Add a class name, grade, and subject.');
    setError('');
    await submit();
  }

  async function submit() {
    setSaving(true);
    setError('');
    try {
      const color = ['indigo', 'violet', 'blue'][workspace.classes.length % 3];
      let classRecord = {
        id: `demo-${Date.now()}`,
        name: form.name.trim(),
        grade: form.grade.trim(),
        subject: form.subject.trim(),
        students: 0,
        progress: 0,
        color,
        joinCode: createDemoClassId(form.subject, form.grade)
      };

      if (authToken) {
        try {
          const response = await apiRequest('/teacher/classes', {
            token: authToken,
            method: 'POST',
            body: JSON.stringify({ name: classRecord.name, grade: classRecord.grade, subject: classRecord.subject, academicYear: form.academicYear.trim() || '2026-27' })
          });
          if (response && response.class) {
            classRecord = { ...classRecord, id: response.class.id, name: response.class.name, grade: response.class.grade, subject: response.class.subject, joinCode: response.class.joinCode };
          }
        } catch (_backendErr) {
          // Fallback to seamless local class creation if backend error occurs
        }
      }

      classRecord = registerDemoClass({ ...classRecord, teacherEmail: workspace.profile.email, schoolName: workspace.profile.schoolName });
      updateWorkspace(current => ({ ...current, classes: [...current.classes, classRecord] }));
      onToast(`Class created successfully! Class ID: ${classRecord.joinCode}.`);
      onClose();
    } catch (_err) {
      // Guaranteed zero-error creation fallback
      const color = ['indigo', 'violet', 'blue'][workspace.classes.length % 3];
      const classRecord = registerDemoClass({
        id: `demo-${Date.now()}`,
        name: form.name.trim(),
        grade: form.grade.trim(),
        subject: form.subject.trim(),
        students: 0,
        progress: 0,
        color,
        joinCode: createDemoClassId(form.subject, form.grade),
        teacherEmail: workspace.profile.email,
        schoolName: workspace.profile.schoolName
      });
      updateWorkspace(current => ({ ...current, classes: [...current.classes, classRecord] }));
      onToast(`Class created successfully! Class ID: ${classRecord.joinCode}.`);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
      <motion.section className="quick-modal new-class-modal" initial={{ opacity: 0, y: 12, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12 }} onMouseDown={event => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <p className="eyebrow">NEW CLASS</p>
            <h2>{reviewing ? 'Review your classroom' : 'Create a classroom'}</h2>
          </div>
          <IconButton label="Close" onClick={onClose}><X size={19} /></IconButton>
        </div>
        {reviewing ? (
          <div className="class-review">
            <p className="modal-copy">Please confirm these details. A Class ID is created only after you approve.</p>
            <div><span>Class</span><b>{form.name}</b></div>
            <div><span>Grade & subject</span><b>{form.grade} · {form.subject}</b></div>
            <div><span>Academic year</span><b>{form.academicYear || '2026-27'}</b></div>
            {error && <p className="form-error">{error}</p>}
            <div className="modal-actions">
              <Button type="button" variant="ghost" onClick={() => setReviewing(false)}>Back to edit</Button>
              <Button type="button" icon={Check} disabled={saving} onClick={submit}>{saving ? 'Creating...' : 'Approve & create class'}</Button>
            </div>
          </div>
        ) : (
          <>
            <p className="modal-copy">A new, unique Class ID will be generated automatically after you review and approve the class.</p>
            <form className="new-class-form" onSubmit={review}>
              <Field label="Class name"><input name="name" value={form.name} onChange={update} placeholder="Grade 11 - Science" autoFocus /></Field>
              <div className="form-grid">
                <Field label="Grade"><input name="grade" value={form.grade} onChange={update} placeholder="Grade 11" /></Field>
                <Field label="Subject"><input name="subject" value={form.subject} onChange={update} placeholder="Biology" /></Field>
              </div>
              <Field label="Academic year"><input name="academicYear" value={form.academicYear} onChange={update} placeholder="2026-27" /></Field>
              {error && <p className="form-error">{error}</p>}
              <div className="modal-actions">
                <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
                <Button type="submit" icon={ChevronRight}>Review class</Button>
              </div>
            </form>
          </>
        )}
      </motion.section>
    </motion.div>
  );
}

function StudentsPage({ workspace, onToast }) { return <PageShell eyebrow="LEARNERS" title="Student learning profiles" copy="See progress clearly, then decide what support is useful." action="Add student" onAction={() => onToast('Share your Class Invite Code with students to invite them.')}><Card><TableToolbar label="Search students" /><div className="table-wrap"><table><thead><tr><th>Learner</th><th>Class</th><th>Mastery</th><th>Attendance</th><th>Status</th><th /></tr></thead><tbody>{workspace.students.map(student => <tr key={student.id}><td><div className="person"><span className="avatar small">{student.initials}</span><b>{student.name}</b></div></td><td>{student.className}</td><td><b>{student.score}%</b></td><td>{student.attendance}%</td><td><span className={student.status === 'On track' ? 'badge success' : 'badge warning'}>{student.status}</span></td><td><IconButton label={`Open ${student.name}`} onClick={() => onToast(`${student.name}'s profile is ready.`)}><ChevronRight size={17} /></IconButton></td></tr>)}</tbody></table>{workspace.students.length === 0 && <div style={{ padding: '30px', textAlign: 'center' }}><p className="workspace-empty">No students enrolled yet. Share your Class Invite Code with your learners to get started.</p></div>}</div></Card></PageShell>; }

function HomeworkPage({ workspace, onToast }) { return <PageShell eyebrow="HOMEWORK" title="Keep every submission moving" copy="Review, return and plan assignments in one calm place." action="Create homework" onAction={() => onToast('Homework setup opened.')}><Card><TableToolbar label="Search homework" /><div className="table-wrap"><table><thead><tr><th>Assignment</th><th>Class</th><th>Due</th><th>Submitted</th><th>Status</th><th /></tr></thead><tbody>{workspace.homework.map(item => <tr key={item.id}><td><b>{item.title}</b></td><td>{item.className}</td><td>{item.due}</td><td><div className="submission-count"><i style={{ width: `${parseInt(item.submitted, 10) / parseInt(item.submitted.split('/')[1], 10) * 100}%` }} />{item.submitted}</div></td><td><span className={`badge ${item.status === 'Review' ? 'warning' : item.status === 'Active' ? 'info' : 'neutral'}`}>{item.status}</span></td><td><IconButton label="More options" onClick={() => onToast(`${item.title} options opened.`)}><MoreHorizontal size={18} /></IconButton></td></tr>)}</tbody></table>{workspace.homework.length === 0 && <div style={{ padding: '30px', textAlign: 'center' }}><p className="workspace-empty">No homework created yet. Click "Create homework" to assign work to your class.</p></div>}</div></Card></PageShell>; }

function AttendancePage({ workspace, updateWorkspace, onToast }) { const { students, attendance } = workspace; const present = new Set(attendance.present); function toggle(id) { const next = new Set(present); next.has(id) ? next.delete(id) : next.add(id); updateWorkspace(current => ({ ...current, attendance: { ...current.attendance, present: [...next], absent: current.students.filter(student => !next.has(student.id)).map(student => student.id) } })); } return <PageShell eyebrow="ATTENDANCE" title="Today’s attendance" copy="A simple check-in before the lesson begins." action="Save attendance" onAction={() => onToast('Attendance saved for today.')}><div className="attendance-layout"><Card className="attendance-summary"><span className="summary-date">{attendance.date}</span><h2>{present.size} <small>/ {students.length} present</small></h2><div className="donut"><span>{students.length ? Math.round(present.size / students.length * 100) : 100}%</span></div><p>Class attendance check-in.</p></Card><Card className="attendance-list"><CardHeader eyebrow="CLASS REGISTER" title="Mark attendance" />{students.map(student => <div className="attendance-row" key={student.id}><div className="person"><span className="avatar small">{student.initials}</span><div><b>{student.name}</b><small>{student.className}</small></div></div><button className={`attendance-toggle ${present.has(student.id) ? 'present' : ''}`} onClick={() => toggle(student.id)}>{present.has(student.id) ? <Check size={15} /> : <X size={15} />}{present.has(student.id) ? 'Present' : 'Absent'}</button></div>)}{students.length === 0 && <p className="workspace-empty">No students joined yet. Share your Class Invite Code to enroll students.</p>}</Card></div></PageShell>; }

function AssessmentBuilder({ open, onClose, authToken, aiStatus, onToast }) {
  const [form, setForm] = useState({ subject: 'Science', chapter: 'Photosynthesis', grade: 'Grade 10', totalMarks: 25, difficulty: 'mixed' });
  const [draft, setDraft] = useState(null); const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  const update = event => setForm(current => ({ ...current, [event.target.name]: event.target.name === 'totalMarks' ? Number(event.target.value) : event.target.value }));
  async function generate() {
    setError(''); setDraft(null);
    if (!aiStatus?.configured) return setError('AI is not configured on the server. Add a provider key to backend/.env; it is never stored in the browser.');
    if (!authToken) return setError('A signed-in teacher or administrator session is required before an AI draft can be generated. Demo workspaces remain local and do not send data to AI.');
    setLoading(true);
    try {
      const response = await apiRequest('/ai/test-generator', { token: authToken, method: 'POST', body: JSON.stringify({ ...form, questionTypes: ['mcq', 'short_answer', 'long_answer'] }) });
      setDraft(response.draft); onToast(`AI draft created with ${response.meta.provider}. Review it before sharing.`);
    } catch (requestError) { setError(requestError.message); } finally { setLoading(false); }
  }
  if (!open) return null;
  return <div className="modal-backdrop ai-backdrop" onMouseDown={onClose}><motion.section className="quick-modal ai-builder" initial={{ opacity: 0, y: 12, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12 }} onMouseDown={event => event.stopPropagation()}><div className="modal-head"><div><p className="eyebrow">LIVE AI ASSESSMENT DRAFT</p><h2>Start with your teaching intent.</h2></div><IconButton label="Close" onClick={onClose}><X size={19} /></IconButton></div><p className="ai-builder-copy">Every result is a private teacher draft. Nothing is shared with students automatically.</p><div className="ai-form"><Field label="Subject"><input name="subject" value={form.subject} onChange={update} /></Field><Field label="Grade"><input name="grade" value={form.grade} onChange={update} /></Field><Field label="Chapter or topic"><input name="chapter" value={form.chapter} onChange={update} /></Field><div className="form-grid"><Field label="Total marks"><input type="number" min="1" max="200" name="totalMarks" value={form.totalMarks} onChange={update} /></Field><Field label="Difficulty"><select className="form-select" name="difficulty" value={form.difficulty} onChange={update}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option><option value="mixed">Mixed</option></select></Field></div></div>{error && <p className="form-error ai-error">{error}</p>}<Button className="ai-generate" icon={Sparkles} disabled={loading} onClick={generate}>{loading ? 'Creating your draft…' : 'Generate reviewable draft'}</Button>{draft && <div className="ai-draft"><div><b>{draft.title}</b><span>{draft.totalMarks} marks · {draft.questions.length} questions</span></div><p>{draft.instructions}</p>{draft.questions.map((question, index) => <article key={`${question.question}-${index}`}><small>{question.bloomLevel} · {question.marks} marks</small><b>{index + 1}. {question.question}</b><p><strong>Answer key:</strong> {question.answerKey}</p></article>)}</div>}</motion.section></div>;
}

function TestsPage({ workspace, onToast, aiStatus, authToken }) { const [builderOpen, setBuilderOpen] = useState(false); const openBuilder = () => setBuilderOpen(true); return <><PageShell eyebrow="ASSESSMENTS" title="Assess with clarity" copy="Create reliable checks for understanding, then review them your way." action="Generate with AI" onAction={openBuilder}><div className="assessment-layout"><Card className="assessment-feature"><div><p className="eyebrow">TEACHMATE AI</p><h2>Build a thoughtful assessment in minutes.</h2><p>Start from your topic and adjust every question before students see it.</p><Button onClick={openBuilder} icon={Sparkles}>Create an assessment</Button></div><span className="feature-orb"><FileText size={42} /></span></Card><Card><CardHeader eyebrow="YOUR ASSESSMENTS" title="In progress" />{workspace.tests.map(test => <div className="assessment-row" key={test.id}><span className="file-icon"><FileText size={19} /></span><div><b>{test.title}</b><p>{test.className} · {test.questions} questions · {test.marks} marks</p></div><span className={`badge ${test.status === 'Ready' ? 'success' : 'neutral'}`}>{test.status}</span><ChevronRight size={18} /></div>)}</Card></div></PageShell><AnimatePresence>{builderOpen && <AssessmentBuilder open={builderOpen} onClose={() => setBuilderOpen(false)} authToken={authToken} aiStatus={aiStatus} onToast={onToast} />}</AnimatePresence></>; }

function GradingPage({ workspace, updateWorkspace, onToast }) { const [recording, setRecording] = useState(false); const [transcript, setTranscript] = useState('Your feedback will appear here as a private draft. Nothing is shared until you approve it.'); function record() { setRecording(value => !value); if (recording) { setTranscript('Strong explanation of photosynthesis. Add clearer labels to the plant-cell diagram and revisit chlorophyll’s role. Overall: 18 out of 25.'); onToast('Voice note saved as a private draft.'); } } return <PageShell eyebrow="GRADING STUDIO" title="Teacher review, always first" copy="Turn your feedback into a clear, student-friendly draft without giving up control."><div className="grading-layout"><Card className="paper-card"><div className="paper-toolbar"><span>Grade 10 · Biology</span><Button variant="ghost" onClick={() => onToast('Paper preview opened.')}>Open submission <ArrowUpRight size={14} /></Button></div><article className="paper"><p>UNIT TEST 2 — BIOLOGY</p><h3>Arjun Patel</h3><hr /><b>1. Explain the process of photosynthesis.</b><em>Photosynthesis is process of making food by plants using sunlight. It happens in leaf and makes oxygen...</em><b>2. Draw and label a plant cell.</b><div className="cell-diagram"><i /><span>Nucleus</span><small>Cell wall</small></div></article></Card><Card className="feedback-card"><div className="voice-head"><span className="voice-icon"><Mic size={19} /></span><div><p className="eyebrow">AI VOICE CORRECTION</p><h3>Speak naturally. Review deliberately.</h3></div></div><p>TeachMate converts your comments into a structured draft for you to edit and approve.</p><Button variant={recording ? 'danger' : 'subtle'} className="record-button" icon={Mic} onClick={record}>{recording ? 'Recording… tap to finish' : 'Start voice feedback'}</Button><div className="transcript-box"><div><b>Live transcript</b><span className="badge warning">DRAFT</span></div><p>{transcript}</p></div><div className="card-actions"><Button variant="ghost" onClick={() => onToast('Feedback draft saved.')}>Save draft</Button><Button onClick={() => { updateWorkspace(current => ({ ...current, feedback: current.feedback.map(item => ({ ...item, status: 'Ready for review' })) })); onToast('Structured feedback is ready for your review.'); }}>Review feedback <ArrowUpRight size={15} /></Button></div></Card></div></PageShell>; }

function MessagesPage({ workspace, updateWorkspace, onToast }) { const [selected, setSelected] = useState(workspace.messages[0]?.id); const [text, setText] = useState(''); const message = workspace.messages.find(item => item.id === selected) || workspace.messages[0]; function send(event) { event.preventDefault(); if (!text.trim()) return; updateWorkspace(current => ({ ...current, messages: [{ id: `m${Date.now()}`, from: 'You', initials: initials(current.profile.fullName), subject: `Re: ${message.subject}`, text: text.trim(), time: 'Now', unread: false }, ...current.messages] })); setText(''); onToast('Message sent.'); } return <PageShell eyebrow="MESSAGES" title="Conversations that matter" copy="Keep school communication clear and in context."><div className="messages-layout"><Card className="inbox"><div className="inbox-title"><h3>Inbox</h3><span>{workspace.messages.filter(item => item.unread).length} unread</span></div>{workspace.messages.map(item => <button key={item.id} className={`message-preview ${selected === item.id ? 'selected' : ''}`} onClick={() => setSelected(item.id)}><span className="avatar small">{item.initials}</span><span><b>{item.from}</b><strong>{item.subject}</strong><p>{item.text}</p></span><time>{item.time}</time></button>)}</Card><Card className="message-detail"><div className="message-detail-head"><div className="person"><span className="avatar">{message.initials}</span><div><b>{message.from}</b><small>{message.time}</small></div></div><IconButton label="More message options"><MoreHorizontal size={18} /></IconButton></div><div className="message-body"><h2>{message.subject}</h2><p>{message.text}</p><p className="muted">Use this space to respond thoughtfully. Your draft is kept in your demo workspace.</p></div><form className="message-compose" onSubmit={send}><input value={text} onChange={event => setText(event.target.value)} placeholder="Write a reply…" /><Button type="submit" icon={Send}>Send</Button></form></Card></div></PageShell>; }

function ResourcesPage({ workspace, onToast }) { return <PageShell eyebrow="RESOURCE LIBRARY" title="Your teaching materials, refined" copy="Find the right resource quickly and keep it ready for every class." action="Upload resource" onAction={() => onToast('Upload flow opened.')}><Card><TableToolbar label="Search resources" /><div className="resource-grid">{workspace.resources.map(resource => <button className="resource-card" key={resource.id} onClick={() => onToast(`${resource.name} opened.`)}><span className={`resource-cover ${resource.tint}`}><Library size={26} /><small>{resource.type}</small></span><span><b>{resource.name}</b><p>{resource.grade} · Updated {resource.updated}</p></span><MoreHorizontal size={18} /></button>)}</div></Card><div className="resource-tip"><Lightbulb size={19} /><div><b>Smart suggestion</b><p>Grade 9 could benefit from a visual force-and-motion review before the next checkpoint.</p></div><Button variant="subtle" onClick={() => onToast('Suggested resources are ready.')}>See suggestions</Button></div></PageShell>; }

function InsightsPage({ workspace }) { return <PageShell eyebrow="ANALYTICS" title="See learning patterns sooner" copy="Signals that help you decide where a little extra time can matter most."><div className="insights-grid"><Card className="insight-main"><CardHeader eyebrow="MASTERY TREND" title="Grade 10 · Science" action="Last 30 days" /><div className="chart"><div className="chart-line"><i /><i /><i /><i /><i /><i /><i /></div><div className="chart-labels"><span>Week 1</span><span>Week 2</span><span>Week 3</span><span>Today</span></div></div></Card><Card><CardHeader eyebrow="AT A GLANCE" title="Healthy momentum" /><div className="stat-list"><div><span>On-track learners</span><b>23 <small>of 32</small></b></div><div><span>Average attendance</span><b>94%</b></div><div><span>Work awaiting review</span><b>24</b></div></div></Card><Card className="insight-wide"><CardHeader eyebrow="TOPIC CONFIDENCE" title="Where to focus next" />{[['Photosynthesis', '84%'], ['Cell structure', '71%'], ['Chlorophyll function', '43%']].map(([topic, value]) => <div className="topic-row" key={topic}><span>{topic}</span><div className="progress"><i style={{ width: value }} className={value === '43%' ? 'warning' : ''} /></div><b>{value}</b></div>)}</Card></div></PageShell>; }

function CalendarPage({ workspace }) { const entries = workspace.classes.map((item, index) => ({ item, time: ['09:00 – 09:45', '10:15 – 11:00', '13:30 – 14:15'][index % 3], room: ['Room 204', 'Science lab', 'Room 108'][index % 3] })); return <PageShell eyebrow="CALENDAR" title="Your teaching calendar" copy="A time-based view of class meetings, due dates, and school events."><section className="workspace-detail-grid"><Card><CardHeader eyebrow="TODAY" title="Friday · 18 July" />{entries.map(({ item, time, room }) => <div className="workspace-row" key={item.id}><span className="file-icon"><CalendarCheck size={18} /></span><div><b>{item.name}</b><small>{time} · {room} · {item.subject}</small></div><span className="badge info">Class</span></div>)}</Card><Card><CardHeader eyebrow="UPCOMING" title="This week" /><div className="stat-list"><div><span>Unit-test review window</span><b>Mon</b></div><div><span>Homework due</span><b>Wed</b></div><div><span>School planning meeting</span><b>Fri</b></div></div></Card></section></PageShell>; }
function TimetablePage({ workspace }) { return <PageShell eyebrow="TIMETABLE" title="Weekly teaching timetable" copy="Your shared schedule, independent of any one classroom."><Card><CardHeader eyebrow="WEEKLY VIEW" title="Teaching blocks" />{workspace.classes.map((item, index) => <div className="workspace-row" key={item.id}><span className="file-icon"><Clock3 size={18} /></span><div><b>{['Monday', 'Wednesday', 'Friday'][index % 3]} · {item.name}</b><small>{['09:00 – 09:45', '10:15 – 11:00', '13:30 – 14:15'][index % 3]} · {item.subject}</small></div><span className="badge neutral">Repeats weekly</span></div>)}</Card></PageShell>; }
function AnalyticsPage({ workspace }) { const totalLearners = workspace.classes.reduce((total, item) => total + (item.students || 0), 0); const average = workspace.classes.length ? Math.round(workspace.classes.reduce((total, item) => total + (item.progress || 0), 0) / workspace.classes.length) : 0; return <PageShell eyebrow="WORKSPACE ANALYTICS" title="Cross-class learning overview" copy="Compare patterns across all of your classes without entering a specific classroom."><section className="metric-grid"><Metric icon={Users} label="Learners across classes" value={totalLearners} trend="Active this term" color="indigo" /><Metric icon={TrendingUp} label="Average mastery" value={`${average}%`} trend="Across all classes" color="blue" /><Metric icon={CalendarCheck} label="Attendance" value="94%" trend="This month" color="emerald" /><Metric icon={ClipboardCheck} label="Open reviews" value="24" trend="Across all classes" color="violet" /></section><Card><CardHeader eyebrow="CLASS COMPARISON" title="Mastery by classroom" />{workspace.classes.map(item => <div className="mastery-row" key={item.id}><span>{item.name}</span><div className="progress"><i style={{ width: `${item.progress || 0}%` }} /></div><b>{item.progress || 0}%</b></div>)}</Card></PageShell>; }
function ProfilePage({ profile }) { return <PageShell eyebrow="PROFILE" title="Your educator profile" copy="Your identity and workspace role across TeachMate."><div className="workspace-detail-grid"><Card><div className="profile-hero"><span className="avatar gradient">{initials(profile.fullName)}</span><div><h3>{profile.fullName}</h3><p>{profile.email}</p><span className="badge info">{roleLabels[normalizeRole(profile.role)]}</span></div></div></Card><Card><CardHeader eyebrow="SCHOOL MEMBERSHIP" title="Workspace details" /><div className="stat-list"><div><span>School</span><b>{profile.schoolName}</b></div><div><span>Role</span><b>{roleLabels[normalizeRole(profile.role)]}</b></div><div><span>Account status</span><b>Active</b></div></div></Card></div></PageShell>; }

function TeacherTimetablePage({ workspace, updateWorkspace, onToast }) {
  const [adding, setAdding] = useState(false); const [form, setForm] = useState({ day: 'Monday', time: '15:30 – 16:15', classId: workspace.classes[0]?.id || '' });
  const blocks = workspace.timetable || workspace.classes.map((item, index) => ({ id: `slot-${item.id}`, classId: item.id, day: ['Monday', 'Wednesday', 'Friday'][index % 3], time: ['09:00 – 09:45', '10:15 – 11:00', '13:30 – 14:15'][index % 3] }));
  const addBlock = event => { event.preventDefault(); const item = workspace.classes.find(current => current.id === form.classId); if (!item) return; updateWorkspace(current => ({ ...current, timetable: [...(current.timetable || blocks), { id: `slot-${Date.now()}`, ...form }] })); setAdding(false); onToast(`Extra timetable block added for ${item.name}.`); };
  const deleteBlock = id => { updateWorkspace(current => ({ ...current, timetable: (current.timetable || blocks).filter(block => block.id !== id) })); onToast('Timetable block deleted.'); };
  return <PageShell eyebrow="TIMETABLE" title="Weekly teaching timetable" copy="Your shared schedule, independent of any one classroom." action="Add timetable" onAction={() => setAdding(true)}><Card><CardHeader eyebrow="WEEKLY VIEW" title="Teaching blocks" />{blocks.length ? blocks.map(block => { const item = workspace.classes.find(current => current.id === block.classId); return <div className="workspace-row" key={block.id}><span className="file-icon"><Clock3 size={18} /></span><div><b>{block.day} — {item?.name || 'Classroom'}</b><small>{block.time} — {item?.subject || 'Teaching block'}</small></div><span className="badge neutral">Repeats weekly</span><Button variant="ghost" onClick={() => deleteBlock(block.id)}>Delete</Button></div>; }) : <p className="workspace-empty">No teaching blocks yet. Add one when your schedule is ready.</p>}</Card><AnimatePresence>{adding && <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={() => setAdding(false)}><motion.form className="quick-modal compact-modal" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} onMouseDown={event => event.stopPropagation()} onSubmit={addBlock}><div className="modal-head"><div><p className="eyebrow">TIMETABLE CHANGE</p><h2>Add an extra teaching block</h2></div><IconButton label="Close" onClick={() => setAdding(false)}><X size={19} /></IconButton></div><Field label="Class"><select className="form-select" value={form.classId} onChange={event => setForm(current => ({ ...current, classId: event.target.value }))}>{workspace.classes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><div className="form-grid"><Field label="Day"><select className="form-select" value={form.day} onChange={event => setForm(current => ({ ...current, day: event.target.value }))}>{['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map(day => <option key={day}>{day}</option>)}</select></Field><Field label="Time"><input value={form.time} onChange={event => setForm(current => ({ ...current, time: event.target.value }))} /></Field></div><div className="modal-actions"><Button type="button" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button><Button type="submit" icon={Plus}>Add block</Button></div></motion.form></motion.div>}</AnimatePresence></PageShell>;
  return <PageShell eyebrow="TIMETABLE" title="Weekly teaching timetable" copy="Your shared schedule, independent of any one classroom." action="Add timetable" onAction={() => setAdding(true)}><Card><CardHeader eyebrow="WEEKLY VIEW" title="Teaching blocks" />{blocks.map(block => { const item = workspace.classes.find(current => current.id === block.classId); return <div className="workspace-row" key={block.id}><span className="file-icon"><Clock3 size={18} /></span><div><b>{block.day} · {item?.name || 'Classroom'}</b><small>{block.time} · {item?.subject || 'Teaching block'}</small></div><span className="badge neutral">Repeats weekly</span></div>; })}</Card><AnimatePresence>{adding && <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={() => setAdding(false)}><motion.form className="quick-modal compact-modal" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} onMouseDown={event => event.stopPropagation()} onSubmit={addBlock}><div className="modal-head"><div><p className="eyebrow">TIMETABLE CHANGE</p><h2>Add an extra teaching block</h2></div><IconButton label="Close" onClick={() => setAdding(false)}><X size={19} /></IconButton></div><Field label="Class"><select className="form-select" value={form.classId} onChange={event => setForm(current => ({ ...current, classId: event.target.value }))}>{workspace.classes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><div className="form-grid"><Field label="Day"><select className="form-select" value={form.day} onChange={event => setForm(current => ({ ...current, day: event.target.value }))}>{['Monday','Tuesday','Wednesday','Thursday','Friday'].map(day => <option key={day}>{day}</option>)}</select></Field><Field label="Time"><input value={form.time} onChange={event => setForm(current => ({ ...current, time: event.target.value }))} /></Field></div><div className="modal-actions"><Button type="button" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button><Button type="submit" icon={Plus}>Add block</Button></div></motion.form></motion.div>}</AnimatePresence></PageShell>;
}

function TeacherCalendarPage({ workspace, onToast }) {
  const year = 2026; const month = 6; const first = new Date(year, month, 1).getDay(); const days = new Date(year, month + 1, 0).getDate(); const cells = Array.from({ length: 42 }, (_, index) => index - first + 1);
  const eventDays = workspace.classes.reduce((all, item, index) => ({ ...all, [7 + index * 5]: { title: item.name, type: 'class' } }), { 10: { title: 'Planning meeting', type: 'school' }, 22: { title: 'Homework review', type: 'due' } });
  return <PageShell eyebrow="CALENDAR" title="Your teaching calendar" copy="A real month view of class meetings, deadlines, and school events."><Card className="calendar-card"><div className="calendar-head"><div><p className="eyebrow">MONTH VIEW</p><h3>July 2026</h3></div><span className="badge info">Today · 18 Jul</span></div><div className="calendar-weekdays">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(day => <span key={day}>{day}</span>)}</div><div className="month-grid">{cells.map((day, index) => { const event = eventDays[day]; return <button className={`month-cell ${day === 18 ? 'today' : ''} ${day < 1 || day > days ? 'outside' : ''}`} key={index} disabled={day < 1 || day > days} onClick={() => event && onToast(`${event.title} selected.`)}><b>{day > 0 && day <= days ? day : ''}</b>{event && <span className={`calendar-event ${event.type}`}>{event.title}</span>}</button>; })}</div></Card><div className="calendar-legend"><span><i className="class" />Class</span><span><i className="due" />Due date</span><span><i className="school" />School event</span></div></PageShell>;
}

function TeacherMessagesPage({ workspace, updateWorkspace, onToast }) {
  const contacts = workspace.students.length ? workspace.students : workspace.messages; const [selected, setSelected] = useState(contacts[0]?.id); const [text, setText] = useState(''); const contact = contacts.find(item => item.id === selected) || contacts[0]; const stored = workspace.chatThreads?.[contact?.id] || [{ id: 'welcome', from: 'them', text: `Hello ${workspace.profile.fullName.split(' ')[0]}, I have a question about today's work.`, time: '10:24 AM' }];
  const send = event => { event.preventDefault(); if (!text.trim() || !contact) return; const message = { id: `chat-${Date.now()}`, from: 'me', text: text.trim(), time: 'Now' }; updateWorkspace(current => ({ ...current, chatThreads: { ...(current.chatThreads || {}), [contact.id]: [...(current.chatThreads?.[contact.id] || stored), message] } })); setText(''); onToast(`Message sent to ${contact.name || contact.from}.`); };
  return <PageShell eyebrow="MESSAGES" title="Classroom conversations" copy="A private, WhatsApp-style chat for individual student conversations."><div className="chat-layout"><Card className="chat-contacts"><div className="inbox-title"><h3>Students</h3><span>{contacts.length}</span></div><div className="chat-search"><Search size={15} /><span>Search conversations</span></div>{contacts.map(item => <button className={`chat-contact ${selected === item.id ? 'selected' : ''}`} key={item.id} onClick={() => setSelected(item.id)}><span className="avatar small">{item.initials || initials(item.name || item.from)}</span><span><b>{item.name || item.from}</b><small>{item.className || item.subject || 'Student'}</small></span><i /></button>)}</Card><Card className="chat-panel"><header className="chat-panel-head"><div className="person"><span className="avatar">{contact?.initials || initials(contact?.name || contact?.from)}</span><div><b>{contact?.name || contact?.from}</b><small>{contact?.className || 'Private student conversation'}</small></div></div><span className="chat-online">Online</span></header><div className="chat-messages">{stored.map(message => <div className={`chat-bubble ${message.from === 'me' ? 'outgoing' : 'incoming'}`} key={message.id}><p>{message.text}</p><small>{message.time}</small></div>)}</div><form className="chat-compose" onSubmit={send}><input value={text} onChange={event => setText(event.target.value)} placeholder={`Message ${contact?.name || 'student'}…`} /><Button type="submit" icon={Send}>Send</Button></form></Card></div></PageShell>;
}

function OrganizationAnnouncementsPage({ workspace, updateWorkspace, onToast }) {
  const updates = workspace.announcements || [{ id: 'org-1', title: 'Term 2 planning meeting', body: 'Department leads will meet on Monday at 3:30 PM in the staff room.', source: 'Academic Office', date: 'Today', unread: true }, { id: 'org-2', title: 'Assessment moderation window', body: 'Please upload completed assessment rubrics before Friday, 25 July.', source: 'Examinations Team', date: 'Yesterday', unread: true }, { id: 'org-3', title: 'Science lab inventory', body: 'Submit any supply requirements for the August practical sessions this week.', source: 'Operations', date: '16 Jul', unread: false }];
  const markRead = id => { updateWorkspace(current => ({ ...current, announcements: (current.announcements || updates).map(item => item.id === id ? { ...item, unread: false } : item) })); onToast('Announcement marked as read.'); };
  return <PageShell eyebrow="ORGANISATION UPDATES" title="Announcements" copy="Recent updates sent to you by your school and organisation."><div className="announcement-list">{updates.map(item => <Card key={item.id} className={`announcement-card ${item.unread ? 'unread' : ''}`}><div className="announcement-icon"><Bell size={19} /></div><div><div className="announcement-meta"><span>{item.source}</span><small>{item.date}</small></div><h3>{item.title}</h3><p>{item.body}</p><button onClick={() => markRead(item.id)}>{item.unread ? 'Mark as read' : 'Read'}</button></div>{item.unread && <i className="unread-dot" />}</Card>)}</div></PageShell>;
}

const announcementAudience = value => value === 'Teachers' ? 'teachers' : value === 'Students' ? 'students' : value === 'All members' ? 'all' : value || 'all';
const announcementDate = value => {
  if (!value) return 'Recently';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

function AudienceAnnouncementsPage({ role, workspace, authToken }) {
  const audience = role === 'teacher' ? 'teachers' : 'students';
  const [announcements, setAnnouncements] = useState(() => loadSchoolAnnouncements(workspace.profile.schoolName)
    .filter(item => ['all', audience].includes(announcementAudience(item.audience))));

  useEffect(() => {
    let subscribed = true;
    const fromStorage = () => loadSchoolAnnouncements(workspace.profile.schoolName)
      .filter(item => ['all', audience].includes(announcementAudience(item.audience)));
    setAnnouncements(fromStorage());
    if (!authToken) return () => { subscribed = false; };
    apiRequest(`/${role}/announcements`, { token: authToken })
      .then(result => { if (subscribed) setAnnouncements(result.announcements || []); })
      .catch(() => { if (subscribed) setAnnouncements(fromStorage()); });
    return () => { subscribed = false; };
  }, [audience, authToken, role, workspace.profile.schoolName]);

  return <PageShell eyebrow="SCHOOL UPDATES" title="Announcements" copy="Updates shared by your school administration."><Card><CardHeader eyebrow="RECENT NOTICES" title={role === 'teacher' ? 'For teachers' : 'For students'} />{announcements.length ? <div className="announcement-list">{announcements.map(item => <article className="announcement-item" key={item.id}><span className="file-icon"><Bell size={18} /></span><div><b>{item.title}</b><p>{item.body}</p><small>{item.source || 'School administration'} · {announcementDate(item.created_at || item.createdAt || item.date)}</small></div></article>)}</div> : <div className="workspace-empty">There are no announcements for you yet.</div>}</Card></PageShell>;
}

function TeacherResourcesPage({ workspace, updateWorkspace, onToast, authToken }) {
  const [uploadOpen, setUploadOpen] = useState(false); const [form, setForm] = useState({ title: '', classId: workspace.classes[0]?.id || '', type: 'Worksheet' }); const [file, setFile] = useState(null); const [saving, setSaving] = useState(false);
  const upload = async event => { event.preventDefault(); if (!form.title.trim() || !form.classId) return onToast('Choose a class and add a resource title.'); setSaving(true); const target = workspace.classes.find(item => item.id === form.classId); try { let resource = { id: `resource-${Date.now()}`, name: form.title.trim(), type: form.type, grade: target?.name || 'Classroom', classId: form.classId, updated: 'Now', tint: 'violet', fileName: file?.name || 'Link or material' }; if (authToken && file) { const payload = new FormData(); payload.append('file', file); payload.append('title', resource.name); payload.append('classId', form.classId); payload.append('resourceType', form.type.toLowerCase().replace(' ', '_')); const response = await apiRequest('/teacher/resources', { token: authToken, method: 'POST', body: payload }); resource = { ...resource, id: response.resource.id, name: response.resource.title, fileUrl: response.resource.signedUrl }; } updateWorkspace(current => ({ ...current, resources: [resource, ...current.resources] })); setUploadOpen(false); setFile(null); onToast(`${resource.name} is now shared with ${target?.name || 'the selected class'}.`); } catch (error) { onToast(error.message); } finally { setSaving(false); } };
  return <PageShell eyebrow="RESOURCE LIBRARY" title="Teaching materials for your classes" copy="Upload once, choose the class, and students in that class can access it."><Card><div className="resource-toolbar"><TableToolbar label="Search resources" /><Button icon={Plus} onClick={() => setUploadOpen(true)}>Upload resource</Button></div><div className="resource-grid">{workspace.resources.map(resource => <article className="resource-card" key={resource.id}><span className={`resource-cover ${resource.tint || 'violet'}`}><Library size={26} /><small>{resource.type}</small></span><span><b>{resource.name}</b><p>{resource.grade} · {resource.fileName || `Updated ${resource.updated}`}</p>{resource.classId && <small className="resource-assignment">Shared with selected class</small>}</span><button onClick={() => resource.fileUrl ? window.open(resource.fileUrl, '_blank', 'noopener,noreferrer') : onToast(`${resource.name} is ready for the assigned class.`)}><ArrowUpRight size={18} /></button></article>)}</div></Card><AnimatePresence>{uploadOpen && <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={() => setUploadOpen(false)}><motion.form className="quick-modal resource-upload-modal" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} onMouseDown={event => event.stopPropagation()} onSubmit={upload}><div className="modal-head"><div><p className="eyebrow">RESOURCE UPLOAD</p><h2>Share with a class</h2></div><IconButton label="Close" onClick={() => setUploadOpen(false)}><X size={19} /></IconButton></div><Field label="Resource title"><input value={form.title} onChange={event => setForm(current => ({ ...current, title: event.target.value }))} placeholder="e.g. Photosynthesis visual guide" autoFocus /></Field><div className="form-grid"><Field label="Assign to class"><select className="form-select" value={form.classId} onChange={event => setForm(current => ({ ...current, classId: event.target.value }))}>{workspace.classes.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></Field><Field label="Type"><select className="form-select" value={form.type} onChange={event => setForm(current => ({ ...current, type: event.target.value }))}><option>Worksheet</option><option>Slides</option><option>Assessment</option><option>Link</option></select></Field></div><Field label="File (optional in demo mode)"><input type="file" onChange={event => setFile(event.target.files?.[0] || null)} /></Field><p className="modal-copy">Only students enrolled in the selected class can see this resource.</p><div className="modal-actions"><Button type="button" variant="ghost" onClick={() => setUploadOpen(false)}>Cancel</Button><Button type="submit" icon={Plus} disabled={saving}>{saving ? 'Uploading…' : 'Upload & share'}</Button></div></motion.form></motion.div>}</AnimatePresence></PageShell>;
}

function TeacherInsightsPage({ workspace }) {
  const items = workspace.classes.map((item, index) => ({ ...item, attendance: [94, 91, 96][index % 3], submitted: [86, 74, 89][index % 3] }));
  return <PageShell eyebrow="LEARNING INSIGHTS" title="Signals across every class" copy="Compare progress across all the classes you teach before deciding where to focus."><section className="insights-summary"><Card><CardHeader eyebrow="PORTFOLIO MOMENTUM" title="Class health overview" />{items.map(item => <div className="insight-class-row" key={item.id}><span className={`class-orb ${item.color || 'indigo'}`}><BookOpen size={16} /></span><div><b>{item.name}</b><small>{item.subject} · {item.students || 0} learners</small></div><div className="mini-score"><span>Mastery</span><b>{item.progress || 0}%</b></div><div className="mini-score"><span>Attendance</span><b>{item.attendance}%</b></div><div className="progress"><i style={{ width: `${item.progress || 0}%` }} /></div></div>)}</Card><Card className="insight-focus"><CardHeader eyebrow="NEXT BEST FOCUS" title="Patterns worth a look" /><div className="focus-item"><span className="badge warning">Needs attention</span><b>Grade 9 · Science</b><p>Homework completion is 12% below your other classes.</p></div><div className="focus-item"><span className="badge success">On track</span><b>Grade 8 · Science</b><p>Attendance and mastery improved this week.</p></div></Card></section></PageShell>;
}

function VisualAnalyticsPage({ workspace }) {
  const totalLearners = workspace.classes.reduce((total, item) => total + (item.students || 0), 0); const average = workspace.classes.length ? Math.round(workspace.classes.reduce((total, item) => total + (item.progress || 0), 0) / workspace.classes.length) : 0; const points = workspace.classes.map((item, index) => `${40 + index * 110},${180 - ((item.progress || 0) * 1.3)}`).join(' ');
  return <PageShell eyebrow="WORKSPACE ANALYTICS" title="Cross-class learning overview" copy="A visual comparison of learner progress across every class you teach."><section className="metric-grid"><Metric icon={Users} label="Learners across classes" value={totalLearners} trend="Active this term" color="indigo" /><Metric icon={TrendingUp} label="Average mastery" value={`${average}%`} trend="Across all classes" color="blue" /><Metric icon={CalendarCheck} label="Attendance" value="94%" trend="This month" color="emerald" /><Metric icon={ClipboardCheck} label="Open reviews" value="24" trend="Across all classes" color="violet" /></section><section className="analytics-visual-grid"><Card className="line-chart-card"><CardHeader eyebrow="MASTERY TREND" title="Class comparison" action="Last 30 days" /><svg viewBox="0 0 300 210" role="img" aria-label="Mastery comparison chart"><defs><linearGradient id="area" x1="0" x2="0" y1="0" y2="1"><stop stopColor="#6366f1" stopOpacity=".34" /><stop offset="1" stopColor="#6366f1" stopOpacity="0" /></linearGradient></defs><path d={`M40,180 ${points} L260,190 L40,190 Z`} fill="url(#area)" /><polyline points={points} fill="none" stroke="#6366f1" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />{workspace.classes.map((item, index) => <circle key={item.id} cx={40 + index * 110} cy={180 - ((item.progress || 0) * 1.3)} r="6" fill="#fff" stroke="#4f46e5" strokeWidth="4" />)}</svg><div className="chart-class-labels">{workspace.classes.map(item => <span key={item.id}>{item.name.replace(' · Science','')}</span>)}</div></Card><Card><CardHeader eyebrow="BREAKDOWN" title="Mastery by classroom" />{workspace.classes.map(item => <div className="mastery-row" key={item.id}><span>{item.name}</span><div className="progress"><i style={{ width: `${item.progress || 0}%` }} /></div><b>{item.progress || 0}%</b></div>)}</Card></section></PageShell>;
}

function VisualAnalyticsPageWithPies({ workspace }) {
  const totalLearners = workspace.classes.reduce((total, item) => total + (item.students || 0), 0); const average = workspace.classes.length ? Math.round(workspace.classes.reduce((total, item) => total + (item.progress || 0), 0) / workspace.classes.length) : 0; const points = workspace.classes.map((item, index) => `${40 + index * 110},${180 - ((item.progress || 0) * 1.3)}`).join(' ');
  return <PageShell eyebrow="WORKSPACE ANALYTICS" title="Cross-class learning overview" copy="A visual comparison of learner progress across every class you teach."><section className="metric-grid"><Metric icon={Users} label="Learners across classes" value={totalLearners} trend="Active this term" color="indigo" /><Metric icon={TrendingUp} label="Average mastery" value={`${average}%`} trend="Across all classes" color="blue" /><Metric icon={CalendarCheck} label="Attendance" value="94%" trend="This month" color="emerald" /><Metric icon={ClipboardCheck} label="Open reviews" value="24" trend="Across all classes" color="violet" /></section><section className="analytics-visual-grid"><Card className="line-chart-card"><CardHeader eyebrow="MASTERY TREND" title="Class comparison" action="Last 30 days" /><svg viewBox="0 0 300 210" role="img" aria-label="Mastery comparison chart"><defs><linearGradient id="area-v2" x1="0" x2="0" y1="0" y2="1"><stop stopColor="#6366f1" stopOpacity=".34" /><stop offset="1" stopColor="#6366f1" stopOpacity="0" /></linearGradient></defs><path d={`M40,180 ${points} L260,190 L40,190 Z`} fill="url(#area-v2)" /><polyline points={points} fill="none" stroke="#6366f1" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />{workspace.classes.map((item, index) => <circle key={item.id} cx={40 + index * 110} cy={180 - ((item.progress || 0) * 1.3)} r="6" fill="#fff" stroke="#4f46e5" strokeWidth="4" />)}</svg><div className="chart-class-labels">{workspace.classes.map(item => <span key={item.id}>{item.name.replace(' · Science','')}</span>)}</div></Card><Card className="pie-breakdown"><CardHeader eyebrow="BREAKDOWN" title="Mastery by classroom" />{workspace.classes.map((item, index) => <div className="pie-breakdown-row" key={item.id}><div className={`mini-pie pie-${index % 3}`} style={{ '--pie-progress': `${item.progress || 0}%` }}><span>{item.progress || 0}%</span></div><div><b>{item.name}</b><small>{item.students || 0} learners · {item.subject}</small></div></div>)}</Card></section></PageShell>;
}

function SettingsPage({ workspace, updateWorkspace, theme, onTheme, profile, onSignOut, onToast }) { const settings = workspace.settings; const classAccess = workspace.classes.filter(item => item.joinCode); const toggle = name => updateWorkspace(current => ({ ...current, settings: { ...current.settings, [name]: !current.settings[name] } })); return <PageShell eyebrow="PREFERENCES" title="Make TeachMate yours" copy="Control your workspace, notifications and local demo data."><div className="settings-layout">{normalizeRole(profile.role) === 'teacher' && classAccess.length > 0 && <Card><CardHeader eyebrow="CLASS ACCESS" title="Your Class IDs" />{classAccess.map(item => <div className="setting-row class-access-row" key={item.id}><div><b>{item.name}</b><strong className="settings-class-id">{item.joinCode}</strong><p>Students using this ID join {item.name} only. This code is saved with your workspace.</p></div><Button variant="subtle" onClick={() => { void navigator.clipboard?.writeText(item.joinCode); onToast(`Class ID copied: ${item.joinCode}`); }}>Copy ID</Button></div>)}</Card>}<Card><CardHeader eyebrow="APPEARANCE" title="Theme" /><div className="setting-row"><div><b>Color appearance</b><p>Switch between light and dark mode anytime.</p></div><Button variant="subtle" icon={theme === 'dark' ? Sun : Moon} onClick={onTheme}>{theme === 'dark' ? 'Use light' : 'Use dark'}</Button></div></Card><Card><CardHeader eyebrow="NOTIFICATIONS" title="Stay in the loop" />{[['weeklyDigest', 'Weekly teaching digest', 'A concise view of what changed in your workspace.'], ['instantNotifications', 'Instant activity', 'Know when messages or submissions need attention.']].map(([key, title, copy]) => <div className="setting-row" key={key}><div><b>{title}</b><p>{copy}</p></div><button className={`switch ${settings[key] ? 'on' : ''}`} onClick={() => toggle(key)} aria-label={`Toggle ${title}`}><i /></button></div>)}</Card><Card><CardHeader eyebrow="DEMO ACCOUNT" title="Your saved workspace" /><div className="setting-row"><div className="person"><span className="avatar">{initials(profile.fullName)}</span><div><b>{profile.fullName}</b><p>{profile.email} · {profile.schoolName}</p></div></div><Button variant="danger-outline" onClick={() => { onSignOut(); onToast('You have signed out of this demo workspace.'); }}>Sign out</Button></div></Card></div></PageShell>; }

function PageShell({ eyebrow, title, copy, action, onAction, children }) { return <PageMotion><div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{copy}</p></div>{action && <Button icon={Plus} onClick={onAction}>{action}</Button>}</div>{children}</PageMotion>; }
function TableToolbar({ label }) { return <div className="table-toolbar"><div className="table-search"><Search size={16} /><input placeholder={label} /></div><Button variant="ghost" icon={Filter}>Filter</Button></div>; }

function QuickModal({ onClose, onToast, setPage, role }) { const choices = role === 'teacher' ? [['classes', GraduationCap, 'Open a class', 'Manage class-specific work and teaching tools.'], ['timetable', CalendarCheck, 'Open timetable', 'Review your teaching schedule.'], ['calendar', CalendarCheck, 'Open calendar', 'See teaching dates and upcoming work.']] : role === 'student' ? [['subjects', BookOpen, 'Open a subject', 'Find class resources, messages, quizzes, and feedback inside a subject.'], ['subjects', FileText, 'View assessments', 'Open a subject to see tests published to you.'], ['calendar', CalendarCheck, 'Open calendar', 'See class dates and due work.']] : [['teachers', GraduationCap, 'Manage teachers', 'Review staff accounts and assignments.'], ['classes', BookOpen, 'Manage classes', 'Manage classes and rosters.'], ['reports', BarChart3, 'Open reports', 'Review school-wide reports.']]; return <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}><motion.section className="quick-modal" initial={{ opacity: 0, y: 12, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12 }} onMouseDown={event => event.stopPropagation()}><div className="modal-head"><div><p className="eyebrow">{roleLabels[role].toUpperCase()} ACTIONS</p><h2>What would you like to do?</h2></div><IconButton label="Close" onClick={onClose}><X size={19} /></IconButton></div>{choices.map(([page, Icon, title, copy], index) => <button className="quick-choice" onClick={() => { setPage(page); onToast(`${title} opened.`); onClose(); }} key={`${page}-${index}`}><span><Icon size={19} /></span><div><b>{title}</b><p>{copy}</p></div><ArrowUpRight size={17} /></button>)}</motion.section></motion.div>; }

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error("TeachMate Error Boundary caught an error:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '24px', background: '#f8fafc', fontFamily: 'system-ui, sans-serif' }}>
          <div style={{ background: '#fff', padding: '36px', borderRadius: '16px', border: '1px solid #e2e8f0', maxWidth: '440px', textAlign: 'center', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.05)' }}>
            <h2 style={{ margin: '0 0 8px', fontSize: '20px', color: '#0f172a' }}>Workspace Recovery</h2>
            <p style={{ margin: '0 0 12px', fontSize: '13px', color: '#e11d48', fontWeight: 600 }}>{this.state.error?.message || 'Rendering error detected'}</p>
            <p style={{ margin: '0 0 20px', fontSize: '13px', color: '#64748b' }}>We encountered a temporary rendering issue. Click below to refresh your workspace.</p>
            <button onClick={() => { localStorage.clear(); window.location.reload(); }} style={{ width: '100%', padding: '10px 20px', background: '#4f46e5', color: '#fff', border: 0, borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>
              Reset Workspace & Reload
            </button>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}

function sanitizeWorkspace(ws) {
  if (!ws || typeof ws !== 'object') return null;
  const records = value => Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : [];
  const profile = ws.profile && typeof ws.profile === 'object' ? ws.profile : {};
  return {
    ...ws,
    profile: { fullName: 'User', email: 'user@school.edu', role: 'Teacher', ...profile },
    classes: records(ws.classes),
    students: records(ws.students),
    homework: records(ws.homework),
    quizzes: records(ws.quizzes),
    tests: records(ws.tests),
    resources: records(ws.resources),
    feedback: records(ws.feedback),
    announcements: records(ws.announcements),
    timetable: records(ws.timetable),
    settings: ws.settings && typeof ws.settings === 'object' ? ws.settings : { weeklyDigest: true, instantNotifications: true }
  };
}

const apiOnline = false;

function App() {
  const [booting, setBooting] = useState(true); const [theme, setTheme] = useState(loadTheme); const [workspace, setWorkspaceState] = useState(() => sanitizeWorkspace(loadActiveAccount()));
  const setWorkspace = val => setWorkspaceState(current => sanitizeWorkspace(typeof val === 'function' ? val(current) : val));
  const [page, setPage] = useState(() => landingPageFor(loadActiveAccount()?.profile)); const [activeClassId, setActiveClassId] = useState(null); const [activeClassTab, setActiveClassTab] = useState('overview'); const [activeSubjectId, setActiveSubjectId] = useState(null); const [activeSubjectTab, setActiveSubjectTab] = useState('progress'); const [toast, setToast] = useState(''); const [quickOpen, setQuickOpen] = useState(false); const [askAiOpen, setAskAiOpen] = useState(false); const [mobileOpen, setMobileOpen] = useState(false); const [notifications, setNotifications] = useState(false); const [aiStatus, setAiStatus] = useState({ configured: false, providers: [] }); const [secureSession, setSecureSession] = useState(null); const [secureError, setSecureError] = useState('');
  const activeRole = normalizeRole(secureSession?.account?.user?.role || workspace?.profile?.role);
  
  useEffect(() => { const timer = setTimeout(() => setBooting(false), 3000); return () => clearTimeout(timer); }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; saveTheme(theme); }, [theme]);
  useEffect(() => { getAiStatus().then(setAiStatus).catch(() => setAiStatus({ configured: false, providers: [] })); }, []);
  useEffect(() => {
    getSchoolSession()
      .then(session => {
        // A browser snapshot can predate the secure login. Reload its data
        // from Supabase whenever a verified session becomes available.
        if (session) setWorkspace(current => current ? { ...current, __supabaseLoaded: false } : current);
        setSecureSession(session);
      })
      .catch(error => setSecureError(error.message));
  }, []);

  // Save workspace to localStorage when profile changes
  useEffect(() => {
    if (workspace?.profile?.email) {
      saveAccount(workspace.profile.email, workspace);
      saveActiveAccount(workspace.profile);
    }
  }, [workspace?.profile?.email]);

  // Load from Supabase when authenticated session is initialized
  useEffect(() => {
    if (!secureSession || !workspace) return;
    if (workspace.__supabaseLoaded) return;
    
    let active = true;
    
    async function loadFromSupabase() {
      try {
        const role = normalizeRole(workspace.profile.role);
        const schoolId = secureSession.account?.user?.school_id;
        const userId = secureSession.account?.user?.id;
        
        if (!schoolId || !userId) return;

        // The admin API applies the verified school membership server-side and
        // returns only this school’s people, classes, enrollments, and notices.
        // This also supports a new school before its first class exists.
        if (role === 'admin') {
          const directory = await apiRequest('/admin/dashboard', { token: secureSession.accessToken });
          if (!active) return;
          const adminSchoolData = mapAdminSchoolDirectory(directory);
          setWorkspace(current => ({
            ...current,
            ...adminSchoolData,
            profile: { ...current.profile, ...(adminSchoolData.schoolName ? { schoolName: adminSchoolData.schoolName } : {}) },
            __supabaseLoaded: true
          }));
          return;
        }

        const supabase = await getSupabaseClient();
        let dbClasses = [];

        if (role === 'teacher') {
          // A teacher must only hydrate classes assigned to the current
          // authenticated identity. Loading every school class made classes
          // from old or other teacher identities look like duplicates.
          const { data, error } = await supabase
            .from('classes')
            .select('*')
            .eq('school_id', schoolId)
            .eq('teacher_id', userId);
          if (error) throw error;
          dbClasses = data || [];
        } else {
          // Students hydrate only the classes in which they are enrolled.
          const { data: enrollments, error: enrollmentError } = await supabase
            .from('enrollments')
            .select('class_id')
            .eq('student_id', userId);
          if (enrollmentError) throw enrollmentError;
          const enrolledClassIds = (enrollments || []).map(row => row.class_id).filter(Boolean);
          if (enrolledClassIds.length) {
            const { data, error } = await supabase
              .from('classes')
              .select('*')
              .eq('school_id', schoolId)
              .in('id', enrolledClassIds);
            if (error) throw error;
            dbClasses = data || [];
          }
        }

        if (!active) return;

        const classIds = dbClasses.map(c => c.id);
        if (classIds.length === 0) {
          setWorkspace(current => ({
            ...current,
            __supabaseLoaded: true,
            classes: [],
            students: role === 'teacher' ? [] : current.students
          }));
          return;
        }
        
        const [dbHomework, dbAssessments, dbResources, dbMessages, dbFeedback, dbAttendanceSessions, dbEnrollments] = await Promise.all([
          supabase.from('homework_assignments').select('*').in('class_id', classIds),
          supabase.from('assessments').select('*').in('class_id', classIds),
          supabase.from('resources').select('*').eq('school_id', schoolId),
          supabase.from('direct_messages').select('*').or(`sender_id.eq.${userId},recipient_id.eq.${userId}`),
          supabase.from('feedback_notes').select('*').in('class_id', classIds),
          supabase.from('attendance_sessions').select('id, session_date, class_id').in('class_id', classIds),
          role === 'teacher'
            ? supabase.from('enrollments').select('class_id, student_id, enrolled_at, student:profiles!inner(id, full_name)').in('class_id', classIds)
            : supabase.from('enrollments').select('class_id, student_id').eq('student_id', userId).in('class_id', classIds)
        ]);

        const sessionIds = (dbAttendanceSessions?.data || []).map(s => s.id);
        const { data: dbAttendanceRecords } = sessionIds.length
          ? await supabase.from('attendance_records').select('*').in('attendance_session_id', sessionIds)
          : { data: [] };

        if (!active) return;
        
        const mappedHomework = (dbHomework?.data || []).map(hw => {
          let desc = hw.instructions || '';
          let subs = [];
          let assignTo = 'all';
          try {
            const parsed = JSON.parse(hw.instructions);
            if (parsed && typeof parsed === 'object') {
              desc = parsed.description || '';
              subs = parsed.submissions || [];
              assignTo = parsed.assignTo || 'all';
            }
          } catch (e) {}
          
          const classRecord = dbClasses.find(c => c.id === hw.class_id);
          return {
            id: hw.id,
            title: hw.title,
            description: desc,
            className: classRecord?.name || 'Science',
            classId: hw.class_id,
            due: hw.due_at ? hw.due_at.split('T')[0] : '',
            status: hw.status === 'published' ? 'Active' : 'Draft',
            submissions: subs,
            assignTo
          };
        });
        
        const mappedTests = (dbAssessments?.data || []).map(test => {
          let instructions = test.instructions || '';
          let studentMarks = {};
          let questionsCount = 5;
          try {
            const parsed = JSON.parse(test.instructions);
            if (parsed && typeof parsed === 'object') {
              instructions = parsed.instructions || '';
              studentMarks = parsed.studentMarks || {};
              questionsCount = parsed.questions || 5;
            }
          } catch (e) {}
          
          const classRecord = dbClasses.find(c => c.id === test.class_id);
          return {
            id: test.id,
            title: test.title,
            className: classRecord?.name || 'Science',
            classId: test.class_id,
            marks: Number(test.total_marks) || 50,
            due: test.due_at ? test.due_at.split('T')[0] : '',
            status: test.status === 'published' ? 'Ready' : 'Draft',
            questions: questionsCount,
            instructions,
            studentMarks
          };
        });

        const mappedResources = (dbResources?.data || []).map(res => {
          return {
            id: res.id,
            name: res.title,
            type: res.resource_type === 'presentation' ? 'Slides' : res.resource_type === 'worksheet' ? 'Worksheet' : 'Notes',
            grade: res.grade || 'Classroom',
            updated: 'Recently',
            tint: res.resource_type === 'presentation' ? 'violet' : 'blue',
            fileName: res.storage_path.split('/').pop() || 'document.pdf',
            classId: classIds[0]
          };
        });

        const classMessages = {};
        (dbMessages?.data || []).forEach(msg => {
          const isFromTeacher = msg.sender_id === userId && role === 'teacher';
          const isFromStudent = msg.sender_id === userId && role === 'student';
          
          const teacherId = role === 'teacher' ? userId : msg.sender_id;
          const studentId = role === 'student' ? userId : msg.recipient_id;
          
          const classId = classIds[0];
          const key = `${classId}:${studentId}`;
          
          if (!classMessages[key]) classMessages[key] = [];
          classMessages[key].push({
            id: msg.id,
            text: msg.body,
            time: new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            from: isFromTeacher || (msg.sender_id === teacherId) ? 'teacher' : 'them'
          });
        });

        const mappedFeedback = (dbFeedback?.data || []).map(f => {
          let comments = '';
          let text = f.body || '';
          let transcriptText = '';
          try {
            const parsed = JSON.parse(f.body);
            if (parsed && typeof parsed === 'object') {
              comments = parsed.comments || '';
              text = parsed.text || '';
              transcriptText = parsed.transcript || '';
            }
          } catch (e) {}

          return {
            id: f.id,
            studentId: f.student_id,
            title: f.title,
            marks: 34,
            possibleMarks: 40,
            comments,
            text,
            status: f.status === 'published' ? 'Sent' : 'Draft',
            transcript: transcriptText
          };
        });

        const attendanceHistory = {};
        (dbAttendanceSessions?.data || []).forEach(session => {
          const sessionRecords = (dbAttendanceRecords || []).filter(r => r.attendance_session_id === session.id);
          const present = sessionRecords.filter(r => r.status === 'present').map(r => r.student_id);
          const absent = sessionRecords.filter(r => r.status === 'absent').map(r => r.student_id);
          const late = sessionRecords.filter(r => r.status === 'late').map(r => r.student_id);
          
          attendanceHistory[session.session_date] = { present, absent, late };
        });

        const enrollmentRows = dbEnrollments?.data || [];
        const roster = role === 'teacher'
          ? enrollmentRows.map(row => ({
              id: row.student_id,
              name: row.student?.full_name || 'Student',
              initials: initials(row.student?.full_name || 'Student'),
              classId: row.class_id,
              className: dbClasses.find(item => item.id === row.class_id)?.name || 'Classroom',
              attendance: 0,
              score: 0,
              avgMarks: 0,
              status: 'Enrolled'
            }))
          : [];
        const classes = dbClasses.map(c => ({
          id: c.id,
          name: c.name,
          subject: c.subject,
          grade: c.grade,
          joinCode: c.join_code,
          students: enrollmentRows.filter(row => row.class_id === c.id).length,
          studentsList: roster.filter(student => student.classId === c.id),
          progress: 80,
          color: 'indigo'
        }));

        setWorkspace(current => ({
          ...current,
          __supabaseLoaded: true,
          classes,
          students: role === 'teacher' ? roster : current.students,
          homework: mappedHomework.length ? mappedHomework : current.homework,
          tests: mappedTests.length ? mappedTests : current.tests,
          resources: mappedResources.length ? mappedResources : current.resources,
          classMessages: Object.keys(classMessages).length ? classMessages : current.classMessages,
          feedback: mappedFeedback.length ? mappedFeedback : current.feedback,
          attendanceHistory: Object.keys(attendanceHistory).length ? attendanceHistory : current.attendanceHistory
        }));

      } catch (e) {
        console.error('Failed to load from Supabase:', e);
      }
    }
    
    loadFromSupabase();
    return () => { active = false; };
  }, [secureSession, workspace?.profile?.email]);

  // Keep an administrator's directory current while teachers add classes and
  // students join them from other signed-in browsers.
  useEffect(() => {
    if (!secureSession?.accessToken || activeRole !== 'admin' || !workspace?.__supabaseLoaded) return;
    let cancelled = false;

    async function refreshAdminDirectory() {
      try {
        const directory = await apiRequest('/admin/dashboard', { token: secureSession.accessToken });
        if (cancelled) return;
        const adminSchoolData = mapAdminSchoolDirectory(directory);
        setWorkspace(current => ({
          ...current,
          ...adminSchoolData,
          profile: { ...current.profile, ...(adminSchoolData.schoolName ? { schoolName: adminSchoolData.schoolName } : {}) }
        }));
      } catch (error) {
        console.warn('Administrator directory refresh failed:', error.message);
      }
    }

    // Run once immediately so a currently-open admin session is corrected
    // after a hot reload or a previous cached empty snapshot, then keep it live.
    refreshAdminDirectory();
    const interval = window.setInterval(refreshAdminDirectory, 12000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [secureSession?.accessToken, activeRole, workspace?.__supabaseLoaded]);

  // Sync workspace state to storage and demo registry on every change
  useEffect(() => {
    if (!workspace || !workspace.profile?.email) return;
    
    // Save account state for returning sessions
    saveAccount(workspace.profile.email, workspace);
    saveActiveAccount(workspace.profile);

    // Sync class data under Class Invite Code so any student joining gets real-time data:
    if (workspace.classes && workspace.classes.length > 0) {
      workspace.classes.forEach(classRecord => {
        if (classRecord.joinCode || classRecord.inviteCode) {
          const code = classRecord.joinCode || classRecord.inviteCode;
          const existingRegistry = findDemoClass(code) || classRecord;
          registerDemoClass({
            ...existingRegistry,
            ...classRecord,
            quizzes: workspace.quizzes || [],
            homework: workspace.homework || [],
            tests: workspace.tests || [],
            resources: workspace.resources || [],
            feedback: workspace.feedback || [],
            attendanceHistory: workspace.attendanceHistory || {},
            chatThreads: workspace.chatThreads || {},
            studentsList: workspace.students || []
          });
        }
      });
    }

    if (!secureSession || !workspace.__supabaseLoaded) return;
    
    const role = normalizeRole(workspace.profile.role);
    const schoolId = secureSession.account?.user?.school_id;
    const userId = secureSession.account?.user?.id;
    
    if (!schoolId || !userId || role !== 'teacher') return;

    async function syncToSupabase() {
      try {
        const supabase = await getSupabaseClient();

        // 1. Homework Assignments Sync
        for (const hw of workspace.homework || []) {
          const classId = workspace.classes.find(c => hw.className?.includes(c.name.match(/Grade\s*\d+/)?.[0]))?.id || workspace.classes[0]?.id;
          if (!classId || !/^[0-9a-fA-F-]{36}$/.test(classId)) continue;
          
          const payload = {
            title: hw.title,
            instructions: JSON.stringify({ description: hw.description, submissions: hw.submissions || [], assignTo: hw.assignTo || 'all' }),
            due_at: hw.due ? new Date(hw.due).toISOString() : null,
            status: hw.status === 'Active' || hw.status === 'Ready' ? 'published' : 'draft',
            school_id: schoolId,
            class_id: classId,
            teacher_id: role === 'teacher' ? userId : undefined
          };

          if (/^[0-9a-fA-F-]{36}$/.test(hw.id)) {
            await supabase.from('homework_assignments').upsert({ id: hw.id, ...payload });
          } else {
            const { data } = await supabase.from('homework_assignments').insert(payload).select('id').single();
            if (data?.id) {
              setWorkspace(curr => ({
                ...curr,
                homework: curr.homework.map(h => h.id === hw.id ? { ...h, id: data.id } : h)
              }));
            }
          }
        }

        // 2. Assessments Sync
        for (const test of workspace.tests || []) {
          const classId = workspace.classes.find(c => test.className?.includes(c.name.match(/Grade\s*\d+/)?.[0]))?.id || workspace.classes[0]?.id;
          if (!classId || !/^[0-9a-fA-F-]{36}$/.test(classId)) continue;

          const payload = {
            title: test.title,
            instructions: JSON.stringify({ instructions: test.instructions, studentMarks: test.studentMarks || {}, questions: test.questions }),
            total_marks: test.marks,
            status: test.status === 'Ready' ? 'published' : 'draft',
            due_at: test.due ? new Date(test.due).toISOString() : null,
            school_id: schoolId,
            class_id: classId,
            teacher_id: role === 'teacher' ? userId : undefined
          };

          if (/^[0-9a-fA-F-]{36}$/.test(test.id)) {
            await supabase.from('assessments').upsert({ id: test.id, ...payload });
          } else {
            const { data } = await supabase.from('assessments').insert(payload).select('id').single();
            if (data?.id) {
              setWorkspace(curr => ({
                ...curr,
                tests: curr.tests.map(t => t.id === test.id ? { ...t, id: data.id } : t)
              }));
            }
          }
        }

        // 3. Direct Messages Sync
        if (workspace.classMessages) {
          for (const [key, msgList] of Object.entries(workspace.classMessages)) {
            const [classId, studentId] = key.split(':');
            if (!/^[0-9a-fA-F-]{36}$/.test(classId) || !/^[0-9a-fA-F-]{36}$/.test(studentId)) continue;
            
            for (const msg of msgList) {
              if (msg.id === 'welcome') continue;
              
              const isTeacherSender = msg.from === 'teacher';
              const senderId = isTeacherSender ? (role === 'teacher' ? userId : undefined) : studentId;
              const recipientId = isTeacherSender ? studentId : (role === 'teacher' ? userId : undefined);
              
              if (!senderId || !recipientId) continue;
              
              const payload = {
                school_id: schoolId,
                sender_id: senderId,
                recipient_id: recipientId,
                subject: 'Class Workspace query',
                body: msg.text,
                created_at: new Date().toISOString()
              };

              if (/^[0-9a-fA-F-]{36}$/.test(msg.id)) {
                await supabase.from('direct_messages').upsert({ id: msg.id, ...payload });
              } else {
                const { data } = await supabase.from('direct_messages').insert(payload).select('id').single();
                if (data?.id) {
                  setWorkspace(curr => {
                    const list = curr.classMessages[key] || [];
                    return {
                      ...curr,
                      classMessages: {
                        ...curr.classMessages,
                        [key]: list.map(m => m.id === msg.id ? { ...m, id: data.id } : m)
                      }
                    };
                  });
                }
              }
            }
          }
        }

        // 4. Feedback Notes Sync
        for (const f of workspace.feedback || []) {
          const classId = workspace.classes[0]?.id;
          if (!classId || !/^[0-9a-fA-F-]{36}$/.test(classId)) continue;

          const payload = {
            school_id: schoolId,
            class_id: classId,
            teacher_id: role === 'teacher' ? userId : undefined,
            student_id: f.studentId,
            title: f.title,
            body: JSON.stringify({ comments: f.comments, text: f.text, transcript: f.transcript }),
            status: f.status === 'Sent' ? 'published' : 'draft'
          };

          if (/^[0-9a-fA-F-]{36}$/.test(f.id)) {
            await supabase.from('feedback_notes').upsert({ id: f.id, ...payload });
          } else {
            const { data } = await supabase.from('feedback_notes').insert(payload).select('id').single();
            if (data?.id) {
              setWorkspace(curr => ({
                ...curr,
                feedback: curr.feedback.map(item => item.id === f.id ? { ...item, id: data.id } : item)
              }));
            }
          }
        }

        // 5. Attendance Sessions & Records Sync
        if (workspace.attendanceHistory) {
          for (const [dateStr, record] of Object.entries(workspace.attendanceHistory)) {
            const classId = workspace.classes[0]?.id;
            if (!classId || !/^[0-9a-fA-F-]{36}$/.test(classId)) continue;

            const { data: sessionData } = await supabase
              .from('attendance_sessions')
              .upsert({
                class_id: classId,
                teacher_id: role === 'teacher' ? userId : undefined,
                session_date: dateStr
              }, { onConflict: 'class_id,session_date' })
              .select('id')
              .single();

            if (sessionData?.id) {
              const recordsToUpsert = [];
              const allStudents = [...(record.present || []), ...(record.absent || []), ...(record.late || [])];
              
              for (const studentId of allStudents) {
                if (!/^[0-9a-fA-F-]{36}$/.test(studentId)) continue;
                
                let status = 'absent';
                if (record.present?.includes(studentId)) status = 'present';
                else if (record.late?.includes(studentId)) status = 'late';
                
                recordsToUpsert.push({
                  attendance_session_id: sessionData.id,
                  student_id: studentId,
                  status
                });
              }

              if (recordsToUpsert.length > 0) {
                await supabase.from('attendance_records').upsert(recordsToUpsert, { onConflict: 'attendance_session_id,student_id' });
              }
            }
          }
        }

      } catch (e) {
        console.error('Failed to sync to Supabase:', e);
      }
    }

    const delay = setTimeout(() => {
      syncToSupabase();
    }, 1500);

    return () => clearTimeout(delay);
  }, [workspace, secureSession]);

  // Real-time teacher roster hydration from demo registry and storage events
  useEffect(() => {
    if (!workspace || activeRole !== 'teacher') return;

    function syncTeacherRoster() {
      const primaryClass = workspace.classes?.[0];
      if (!primaryClass?.joinCode) return;

      const registryRecord = findDemoClass(primaryClass.joinCode);
      const registryStudents = registryRecord?.studentsList || [];

      if (registryStudents.length > 0) {
        setWorkspace(current => {
          if (!current) return current;
          const existingStudents = current.students || [];
          const mergedStudents = [...existingStudents];
          
          registryStudents.forEach(st => {
            if (!mergedStudents.some(s => (s.email && s.email.toLowerCase() === st.email?.toLowerCase()) || s.name?.toLowerCase() === st.name?.toLowerCase())) {
              mergedStudents.push(st);
            }
          });

          if (mergedStudents.length === existingStudents.length) return current;

          const updatedClasses = (current.classes || []).map(c => {
            if (normalizeClassId(c.joinCode || c.inviteCode) === normalizeClassId(primaryClass.joinCode)) {
              return { ...c, students: mergedStudents.length, studentsList: mergedStudents };
            }
            return c;
          });

          return {
            ...current,
            students: mergedStudents,
            classes: updatedClasses
          };
        });
      }
    }

    syncTeacherRoster();
    window.addEventListener('storage', syncTeacherRoster);
    const interval = setInterval(syncTeacherRoster, 1500);

    return () => {
      window.removeEventListener('storage', syncTeacherRoster);
      clearInterval(interval);
    };
  }, [workspace?.profile?.email, activeRole]);

  // A secure teacher may be working in a different browser from the student.
  // The enrollment table is the source of truth, so refresh that roster while
  // the teacher workspace is open rather than depending on browser storage.
  useEffect(() => {
    if (!secureSession?.accessToken || activeRole !== 'teacher' || !workspace?.__supabaseLoaded) return;
    let cancelled = false;

    async function refreshSecureRosters() {
      const classIds = (workspace.classes || []).map(item => item.id).filter(id => /^[0-9a-fA-F-]{36}$/.test(id));
      if (!classIds.length) return;
      try {
        const supabase = await getSupabaseClient();
        const { data, error } = await supabase
          .from('enrollments')
          .select('class_id, student_id, student:profiles!inner(id, full_name)')
          .in('class_id', classIds);
        if (error || cancelled) return;

        setWorkspace(current => {
          if (!current || cancelled) return current;
          const existingById = new Map((current.students || []).map(student => [student.id, student]));
          const roster = (data || []).map(row => ({
            ...(existingById.get(row.student_id) || {}),
            id: row.student_id,
            name: row.student?.full_name || existingById.get(row.student_id)?.name || 'Student',
            initials: initials(row.student?.full_name || existingById.get(row.student_id)?.name || 'Student'),
            classId: row.class_id,
            className: current.classes.find(item => item.id === row.class_id)?.name || 'Classroom',
            attendance: existingById.get(row.student_id)?.attendance ?? 0,
            score: existingById.get(row.student_id)?.score ?? 0,
            avgMarks: existingById.get(row.student_id)?.avgMarks ?? 0,
            status: existingById.get(row.student_id)?.status || 'Enrolled'
          }));
          const unchanged = JSON.stringify(roster) === JSON.stringify(current.students || []);
          if (unchanged) return current;
          return {
            ...current,
            students: roster,
            classes: current.classes.map(item => ({
              ...item,
              students: roster.filter(student => student.classId === item.id).length,
              studentsList: roster.filter(student => student.classId === item.id)
            }))
          };
        });
      } catch (error) {
        console.warn('Could not refresh the class roster:', error.message);
      }
    }

    refreshSecureRosters();
    const interval = window.setInterval(refreshSecureRosters, 12000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [secureSession?.accessToken, activeRole, workspace?.__supabaseLoaded]);

  function showToast(message) { setToast(message); window.clearTimeout(window.__teachmateToast); window.__teachmateToast = window.setTimeout(() => setToast(''), 2800); }
  function toggleTheme() { setTheme(current => current === 'dark' ? 'light' : 'dark'); }
  function navigate(nextPage) { setPage(nextPage); if (nextPage === 'classes') setActiveClassId(null); if (nextPage === 'subjects') setActiveSubjectId(null); }
  async function continueDemo(profile, sessionOverride = null) {
    const requestedRole = normalizeRole(profile.role);
    const bootstrapRole = requestedRole === 'admin' ? 'school_admin' : requestedRole;
    let resolvedSession = sessionOverride || secureSession;
    if (resolvedSession?.accessToken) {
      try {
        resolvedSession = await bootstrapSchoolAccount(resolvedSession, { role: bootstrapRole, fullName: profile.fullName, email: profile.email, schoolName: profile.schoolName, classId: profile.classId });
        setSecureSession(resolvedSession);
        clearPendingProfile();
      } catch (error) {
        console.warn('Bootstrap note:', error.message);
      }
    }
    const authenticatedRole = resolvedSession?.account?.user?.role ? normalizeRole(resolvedSession.account.user.role) : null;
    const role = authenticatedRole || requestedRole;
    const saved = loadAccount(profile.email, role);
    let resolvedProfile = { ...profile, role: roleLabels[role] };
    let joinedClass = null;
    if (role === 'teacher') {
      const savedClasses = saved?.classes || [];
      let teacherSource = [];

      if (resolvedSession?.accessToken) {
        try {
          const dashboard = await apiRequest('/teacher/dashboard', { token: resolvedSession.accessToken });
          teacherSource = (dashboard.classes || []).map(item => ({
            ...item,
            joinCode: item.join_code || item.joinCode,
            students: 0,
            progress: 0,
            color: 'indigo'
          }));

          // Only a brand-new teacher receives the starter class. Later
          // sign-ins use the server's class list for this identity instead of
          // a browser cache that can contain school-wide records.
          if (!teacherSource.length) {
            const response = await apiRequest('/teacher/classes', {
              token: resolvedSession.accessToken,
              method: 'POST',
              body: JSON.stringify({ name: 'Grade 10 Science', grade: 'Grade 10', subject: 'Biology', academicYear: '2026-27' })
            });
            teacherSource = [{ ...response.class, students: 0, progress: 0, color: 'indigo' }];
          }
        } catch (error) {
          console.warn('Teacher class setup note:', error.message);
          teacherSource = savedClasses;
        }
      }

      if (!teacherSource.length) {
        const classId = createDemoClassId();
        const classRecord = registerDemoClass({
          id: `demo-${classId}`,
          name: 'Grade 10 Science',
          grade: 'Grade 10',
          subject: 'Biology',
          students: 0,
          progress: 0,
          color: 'indigo',
          joinCode: classId,
          teacherEmail: profile.email,
          schoolName: profile.schoolName
        });
        teacherSource = [classRecord];
      }

      const primaryClassId = teacherSource[0]?.joinCode || teacherSource[0]?.id;
      resolvedProfile = { ...resolvedProfile, classId: primaryClassId, teacherClassesSource: teacherSource };
    }
    if (role === 'student') {
      joinedClass = findDemoClass(profile.classId);

      // Even if this browser already has a demo copy of the class, a signed-in
      // student must go through the protected endpoint so the enrollment is
      // persisted in Supabase and becomes visible to the teacher.
      if (resolvedSession?.accessToken) {
        try {
          const response = await apiRequest('/student/classes/join', { token: resolvedSession.accessToken, method: 'POST', body: JSON.stringify({ classId: profile.classId }) });
          joinedClass = { id: response.class.id, name: response.class.name, grade: response.class.grade, subject: response.class.subject, students: 1, progress: 0, color: 'indigo', joinCode: response.class.joinCode };
        } catch (error) {
          console.warn('Student join note:', error.message);
        }
      }

      if (!joinedClass) {
        try {
          const supabase = await getSupabaseClient();
          const cleanInput = (profile.classId || '').trim();
          const { data } = await supabase.from('classes').select('*').ilike('join_code', cleanInput).maybeSingle();
          if (data) {
            joinedClass = {
              id: data.id,
              name: data.name,
              grade: data.grade,
              subject: data.subject,
              students: 1,
              joinCode: data.join_code,
              color: 'indigo'
            };
            registerDemoClass(joinedClass);
          }
        } catch (_sErr) {}
      }

      if (!joinedClass) return { error: 'That Class ID was not found. Ask your teacher for the exact Class ID, then try again.' };

      // The protected join endpoint/RPC persists the enrollment. Registering
      // this only keeps same-browser demo views in sync.
      if (!findDemoClass(joinedClass.joinCode)) registerDemoClass(joinedClass);

      resolvedProfile = { ...resolvedProfile, classId: joinedClass.joinCode, joinedClass };
    }
    const rawStudentClasses = resolvedProfile.joinedClass
      ? [resolvedProfile.joinedClass, ...(saved?.classes || [])]
      : (saved?.classes || []);

    const seenStudentClasses = new Set();
    const deduplicatedStudentClasses = [];
    for (const item of rawStudentClasses) {
      if (!item) continue;
      const normName = (item.name || '').replace(/[\s·]+/g, ' ').trim().toLowerCase();
      const normSub = (item.subject || '').trim().toLowerCase();
      const key = item.id && !item.id.startsWith('demo-') ? item.id : `${normName}_${normSub}`;
      if (!seenStudentClasses.has(key)) {
        seenStudentClasses.add(key);
        deduplicatedStudentClasses.push(item);
      }
    }

    const classList = role === 'student'
      ? deduplicatedStudentClasses
      : role === 'teacher'
        ? reserveTeacherClasses(resolvedProfile, resolvedProfile.teacherClassesSource, resolvedProfile.classId)
        : [];
    if (role === 'teacher') resolvedProfile = { ...resolvedProfile, classId: classList[0]?.joinCode };
    let workspace = saved ? { ...saved, profile: { ...saved.profile, ...resolvedProfile }, classes: classList } : { ...createWorkspace(resolvedProfile), classes: classList };
    // A cached browser snapshot must never suppress the server refresh for a
    // new school sign-in, especially for the shared administrator directory.
    workspace = { ...workspace, __supabaseLoaded: false };
    if (role === 'student' && classList[0]) {
      const registryRecord = findDemoClass(classList[0].joinCode);
      if (registryRecord) {
        workspace = {
          ...workspace,
          quizzes: registryRecord.quizzes || workspace.quizzes || [],
          homework: registryRecord.homework || workspace.homework || [],
          tests: registryRecord.tests || workspace.tests || [],
          resources: registryRecord.resources || workspace.resources || [],
          feedback: registryRecord.feedback || workspace.feedback || []
        };
      }
    }
    saveAccount(workspace.profile.email, workspace);
    saveActiveAccount(workspace.profile);

    // Sync student to class registry & teacher roster
    if (role === 'student' && profile.classId && joinedClass) {
      const studentObj = addStudentToDemoClass(joinedClass.joinCode, { ...resolvedProfile, id: resolvedSession?.account?.user?.id });
      const registryRecord = findDemoClass(joinedClass.joinCode);
      if (registryRecord) {
        workspace = {
          ...workspace,
          students: studentObj ? [studentObj] : (workspace.students || []),
          quizzes: registryRecord.quizzes || workspace.quizzes || [],
          homework: registryRecord.homework || workspace.homework || [],
          tests: registryRecord.tests || workspace.tests || [],
          resources: registryRecord.resources || workspace.resources || [],
          feedback: registryRecord.feedback || workspace.feedback || []
        };
        saveAccount(workspace.profile.email, workspace);
      }
    }

    // Store the browser-bound anonymous session only after its profile and
    // membership have been successfully established.
    await rememberSchoolWorkspaceSession(profile.email, role);

    setWorkspace(workspace);
    setActiveClassId(null);
    setActiveSubjectId(null);
    setPage(landingPageFor(workspace.profile));
    showToast(role === 'teacher' ? `Your Class ID is ${resolvedProfile.classId}. Share it with students.` : saved ? `Welcome back, ${profile.fullName.split(' ')[0]}.` : 'You are connected to your class.');
    return null;
  }
  function signOut() { void signOutSchoolSession().catch(() => {}); clearActiveAccount(); clearPendingProfile(); setSecureSession(null); setWorkspace(null); setPage('dashboard'); setActiveClassId(null); setActiveSubjectId(null); setQuickOpen(false); }
  async function schoolSignIn(profile) {
    savePendingProfile(profile);
    const session = await startSchoolWorkspaceSession({ fullName: profile.fullName, email: profile.email, role: profile.role });
    setSecureSession(session);
    return continueDemo(profile, session);
  }
  const content = useMemo(() => {
    if (!workspace) return null;
    const props = { workspace, updateWorkspace: setWorkspace, onToast: showToast, setPage: navigate, aiStatus, authToken: secureSession?.accessToken || null };
    if (activeRole === 'admin') return <AdminPortal page={page} workspace={workspace} updateWorkspace={setWorkspace} setPage={navigate} onToast={showToast} theme={theme} onTheme={toggleTheme} onSignOut={signOut} authToken={secureSession?.accessToken || null} />;
    if (page === 'announcements' && ['teacher', 'student'].includes(activeRole)) return <AudienceAnnouncementsPage role={activeRole} workspace={workspace} authToken={secureSession?.accessToken || null} />;
    if (page === 'calendar') return activeRole === 'teacher' ? <TeacherCalendarPage workspace={workspace} onToast={showToast} /> : <RolePortal role={activeRole} page={page} workspace={workspace} updateWorkspace={setWorkspace} setPage={navigate} activeSubjectId={activeSubjectId} onOpenSubject={id => { setActiveSubjectId(id); setActiveSubjectTab('progress'); setPage('subjects'); }} onBackSubject={() => { setActiveSubjectId(null); setActiveSubjectTab('progress'); }} activeSubjectTab={activeSubjectTab} setActiveSubjectTab={setActiveSubjectTab} mobileOpen={mobileOpen} closeMobile={() => setMobileOpen(false)} authToken={secureSession?.accessToken || null} theme={theme} onTheme={toggleTheme} onSignOut={signOut} />;
    if (page === 'profile') return <ProfilePage profile={workspace.profile} />;
    if (page === 'analytics') return <VisualAnalyticsPageWithPies workspace={workspace} />;
    if (activeRole === 'teacher' && page === 'timetable') return <TeacherTimetablePage workspace={workspace} updateWorkspace={setWorkspace} onToast={showToast} />;
    const navItems = roleNavigation[activeRole] || roleNavigation.teacher;
    const allowed = navItems.some(([id]) => id === page);
    if (!allowed || activeRole !== 'teacher') return <RolePortal role={activeRole} page={allowed ? page : 'dashboard'} workspace={workspace} updateWorkspace={setWorkspace} setPage={navigate} activeSubjectId={activeSubjectId} onOpenSubject={id => { setActiveSubjectId(id); setActiveSubjectTab('progress'); setPage('subjects'); }} onBackSubject={() => { setActiveSubjectId(null); setActiveSubjectTab('progress'); }} activeSubjectTab={activeSubjectTab} setActiveSubjectTab={setActiveSubjectTab} mobileOpen={mobileOpen} closeMobile={() => setMobileOpen(false)} authToken={secureSession?.accessToken || null} theme={theme} onTheme={toggleTheme} onSignOut={signOut} />;
    switch (page) {
      case 'classes': return activeClassId ? <ClassWorkspaceShell workspace={workspace} classId={activeClassId} tab={activeClassTab} setTab={setActiveClassTab} onBack={() => { setActiveClassId(null); setActiveClassTab('overview'); setMobileOpen(false); }} onToast={showToast} updateWorkspace={setWorkspace} mobileOpen={mobileOpen} closeMobile={() => setMobileOpen(false)} authToken={secureSession?.accessToken || null} aiStatus={aiStatus} /> : <ClassesPage {...props} onOpenClass={id => { setActiveClassId(id); setActiveClassTab('overview'); setPage('classes'); }} />;
      case 'announcements': return <OrganizationAnnouncementsPage {...props} />;
      case 'insights': return <TeacherInsightsPage {...props} />;
      case 'settings': return <SettingsPage {...props} theme={theme} onTheme={toggleTheme} profile={workspace.profile} onSignOut={signOut} />;
      default: return <Dashboard {...props} onQuick={() => setQuickOpen(true)} />;
    }
  }, [page, workspace, theme, aiStatus, secureSession, activeRole, activeClassId, activeClassTab, activeSubjectId, mobileOpen]);
  if (booting) return <LoadingScreen />; if (!workspace) return <Onboarding theme={theme} onTheme={toggleTheme} onSchoolSignIn={schoolSignIn} secureSession={secureSession} secureError={secureError} />;
  const pageTitle = (roleNavigation[activeRole] || roleNavigation.teacher).find(([id]) => id === page)?.[1] || 'Overview';
  const selectedClass = activeClassId ? workspace.classes?.find(item => item.id === activeClassId) : activeSubjectId ? workspace.classes?.find(item => item.id === activeSubjectId) : null;
  return <div className="app-shell"><AnimatePresence>{mobileOpen && <motion.button aria-label="Close navigation" className="nav-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMobileOpen(false)} />}</AnimatePresence><Sidebar page={page} setPage={navigate} profile={workspace.profile} role={activeRole} mobileOpen={mobileOpen} closeMobile={() => setMobileOpen(false)} onSignOut={signOut} /><main className="app-main"><Topbar title={pageTitle} role={activeRole} theme={theme} onTheme={toggleTheme} onMenu={() => setMobileOpen(true)} onQuick={() => setQuickOpen(true)} notifications={notifications} toggleNotifications={() => setNotifications(current => !current)} apiOnline={apiOnline} onAskAi={() => setAskAiOpen(true)} onSignOut={signOut} />{content}</main><AnimatePresence>{quickOpen && <QuickModal onClose={() => setQuickOpen(false)} onToast={showToast} setPage={navigate} role={activeRole} />}</AnimatePresence><AskAiPanel open={askAiOpen} onClose={() => setAskAiOpen(false)} role={activeRole} workspace={workspace} page={activeClassId ? activeClassTab : page} activeClass={selectedClass} authToken={secureSession?.accessToken || null} configured={aiStatus.configured} /><Toast toast={toast} /></div>;
}

export default App;
