import { useEffect, useMemo, useState } from 'react';
import { BarChart3, Bell, BookOpen, CalendarCheck, ClipboardCheck, Download, FileText, GraduationCap, Library, Moon, Plus, School, ShieldCheck, Sun, Trash2, UserPlus, UserRound, Users } from 'lucide-react';
import { apiRequest } from '../lib/api.js';
import { publishSchoolAnnouncement } from '../lib/school-announcements.js';

const notificationAudience = value => value === 'Teachers' ? 'teachers' : value === 'Students' ? 'students' : 'all';
const notificationAudienceLabel = value => ({ all: 'everyone', teachers: 'teachers', students: 'students' })[notificationAudience(value)];

const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const records = value => Array.isArray(value) ? value.filter(isRecord) : [];
const text = (value, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const initialsFor = name => text(name, 'User').split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase();
const classIdsFor = value => Array.isArray(value) ? value.filter(id => typeof id === 'string' && id.trim()) : [];

const classForStudent = (classes, className) => {
  const usableClasses = records(classes);
  const requestedClass = text(className);
  return usableClasses.find(item => {
    const candidate = text(item.name).split('·')[0].trim();
    return candidate && requestedClass.includes(candidate);
  })?.id || usableClasses[0]?.id || '';
};

function createAdminSeed(workspace) {
  const profile = isRecord(workspace?.profile) ? workspace.profile : {};
  const classes = records(workspace?.classes);
  const schoolName = text(profile.schoolName, 'TeachMate Academy');
  return {
    school: { name: schoolName, academicYear: '2026–27', city: 'Chennai', contact: `office@${schoolName.toLowerCase().replace(/[^a-z0-9]/g, '')}.school` },
    teachers: [],
    students: records(workspace?.students).map(student => {
      const name = text(student.name, 'Student');
      return { ...student, name, classId: classForStudent(classes, student.className), email: text(student.email) || `${name.toLowerCase().replace(/\s+/g, '.')}@student.school` };
    }),
    subjects: ['Biology', 'Physics', 'Chemistry', 'Mathematics', 'English'],
    timetable: [],
    notifications: records(workspace?.announcements).map(a => ({ id: a.id, title: a.title, body: a.body, audience: a.audience || 'All members', active: true }))
  };
}

function normalizeAdminData(value, workspace) {
  const fallback = createAdminSeed(workspace);
  const source = isRecord(value) ? value : fallback;
  return {
    ...fallback,
    ...source,
    school: {
      ...fallback.school,
      ...(isRecord(source.school) ? source.school : {}),
      name: text(source.school?.name, fallback.school.name),
      academicYear: text(source.school?.academicYear, fallback.school.academicYear),
      city: text(source.school?.city, fallback.school.city),
      contact: text(source.school?.contact, fallback.school.contact)
    },
    teachers: records(source.teachers).map(teacher => ({ ...teacher, name: text(teacher.name, 'Teacher'), email: text(teacher.email), subject: text(teacher.subject, 'General'), classIds: classIdsFor(teacher.classIds) })),
    students: records(source.students).map(student => ({ ...student, name: text(student.name, 'Student'), email: text(student.email), classId: text(student.classId), classIds: classIdsFor(student.classIds), className: text(student.className) })),
    subjects: Array.isArray(source.subjects) ? source.subjects.filter(subject => typeof subject === 'string' && subject.trim()) : fallback.subjects,
    timetable: records(source.timetable),
    notifications: records(source.notifications)
  };
}

function Header({ eyebrow, title, copy, action, onAction }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{copy}</p></div>{action && <button className="button" onClick={onAction}><Plus size={16} /> {action}</button>}</div>;
}

function Empty({ icon: Icon, title, copy }) {
  return <section className="card role-empty"><span><Icon size={28} /></span><h3>{title}</h3><p>{copy}</p></section>;
}

export default function AdminPortal({ page, workspace, updateWorkspace, setPage, onToast, theme, onTheme, onSignOut, authToken }) {
  workspace = {
    ...(isRecord(workspace) ? workspace : {}),
    profile: {
      ...(isRecord(workspace?.profile) ? workspace.profile : {}),
      fullName: text(workspace?.profile?.fullName, 'Administrator'),
      email: text(workspace?.profile?.email),
      schoolName: text(workspace?.profile?.schoolName, 'TeachMate Academy')
    },
    classes: records(workspace?.classes),
    students: records(workspace?.students),
    homework: records(workspace?.homework),
    tests: records(workspace?.tests),
    resources: records(workspace?.resources),
    announcements: records(workspace?.announcements)
  };
  const [teacherForm, setTeacherForm] = useState({ name: '', email: '', subject: 'Biology' });
  const [studentForm, setStudentForm] = useState({ name: '', email: '', classId: workspace.classes[0]?.id || '' });
  const [subjectName, setSubjectName] = useState('');
  const [timetableForm, setTimetableForm] = useState({ classId: workspace.classes[0]?.id || '', day: 'Monday', time: '09:00 – 09:45' });
  const [noticeForm, setNoticeForm] = useState({ title: '', body: '', audience: 'All members' });
  const [teacherOpen, setTeacherOpen] = useState(false);
  const [studentOpen, setStudentOpen] = useState(false);
  const [subjectOpen, setSubjectOpen] = useState(false);
  const [timetableOpen, setTimetableOpen] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [selectedStudentClassId, setSelectedStudentClassId] = useState(null);
  const data = useMemo(() => normalizeAdminData(workspace.adminData, workspace), [workspace]);

  useEffect(() => {
    if (!isRecord(workspace.adminData)) {
      updateWorkspace(current => isRecord(current.adminData) ? current : { ...current, adminData: createAdminSeed(current) });
    }
  }, [workspace.adminData]);

  useEffect(() => {
    if (page !== 'classes') setSelectedStudentClassId(null);
  }, [page]);

  const mutate = mapper => updateWorkspace(current => {
    const currentData = normalizeAdminData(current.adminData, current);
    return { ...current, adminData: mapper(currentData) };
  });
  const teacherForClass = classId => data.teachers.find(teacher => teacher.classIds.includes(classId));
  const nameForClass = classId => workspace.classes.find(item => item.id === classId)?.name || 'Unassigned class';
  const studentIsInClass = (student, classId) => student.classId === classId || classIdsFor(student.classIds).includes(classId);
  const totalStudents = data.students.length;

  const addTeacher = event => {
    event.preventDefault();
    if (!teacherForm.name.trim() || !teacherForm.email.trim()) return onToast('Enter a teacher name and email.');
    mutate(current => ({ ...current, teachers: [...current.teachers, { id: `teacher-${Date.now()}`, name: teacherForm.name.trim(), email: teacherForm.email.trim(), subject: teacherForm.subject.trim() || 'General', classIds: [] }] }));
    setTeacherForm({ name: '', email: '', subject: 'Biology' }); setTeacherOpen(false); onToast('Teacher added to the school directory.');
  };
  const removeTeacher = id => { mutate(current => ({ ...current, teachers: current.teachers.filter(teacher => teacher.id !== id) })); onToast('Teacher removed from the directory.'); };
  const assignTeacher = (classId, teacherId) => mutate(current => ({ ...current, teachers: current.teachers.map(teacher => ({ ...teacher, classIds: teacher.classIds.filter(id => id !== classId).concat(teacher.id === teacherId ? [classId] : []) })) }));
  const addStudent = event => {
    event.preventDefault();
    if (!studentForm.name.trim() || !studentForm.classId) return onToast('Enter a student name and select a class.');
    const classRecord = workspace.classes.find(item => item.id === studentForm.classId);
    const student = { id: `student-${Date.now()}`, name: studentForm.name.trim(), email: studentForm.email.trim() || `${studentForm.name.toLowerCase().replace(/\s+/g, '.')}@student.school`, classId: studentForm.classId, className: classRecord?.name || 'Classroom', initials: studentForm.name.trim().split(' ').map(part => part[0]).slice(0, 2).join('').toUpperCase(), score: 0, attendance: 0, status: 'New learner' };
    updateWorkspace(current => { const currentData = normalizeAdminData(current.adminData, current); return { ...current, students: [...records(current.students), student], adminData: { ...currentData, students: [...currentData.students, student] } }; });
    setStudentForm({ name: '', email: '', classId: workspace.classes[0]?.id || '' }); setStudentOpen(false); onToast('Student added to the selected class.');
  };
  const removeStudent = id => { updateWorkspace(current => { const currentData = normalizeAdminData(current.adminData, current); return { ...current, students: records(current.students).filter(student => student.id !== id), adminData: { ...currentData, students: currentData.students.filter(student => student.id !== id) } }; }); onToast('Student removed from the directory.'); };
  const addSubject = event => { event.preventDefault(); const title = subjectName.trim(); if (!title) return; mutate(current => ({ ...current, subjects: current.subjects.includes(title) ? current.subjects : [...current.subjects, title] })); setSubjectName(''); setSubjectOpen(false); onToast('Subject added.'); };
  const addTimetable = event => { event.preventDefault(); if (!timetableForm.classId) return; mutate(current => ({ ...current, timetable: [...current.timetable, { id: `admin-slot-${Date.now()}`, ...timetableForm }] })); setTimetableOpen(false); onToast('Timetable block added.'); };
  const addNotice = async event => {
    event.preventDefault();
    if (!noticeForm.title.trim() || !noticeForm.body.trim()) return onToast('Add a title and message.');
    const audience = notificationAudience(noticeForm.audience);
    let notice = { id: `notice-${Date.now()}`, title: noticeForm.title.trim(), body: noticeForm.body.trim(), audience, active: true, source: 'School administration', createdAt: new Date().toISOString() };
    try {
      if (authToken) {
        const result = await apiRequest('/admin/announcements', {
          token: authToken,
          method: 'POST',
          body: JSON.stringify({ title: notice.title, body: notice.body, audience })
        });
        notice = { ...notice, ...result.announcement };
      }
      publishSchoolAnnouncement(text(workspace.profile.schoolName, data.school.name), notice);
      mutate(current => ({ ...current, notifications: [notice, ...current.notifications] }));
      setNoticeForm({ title: '', body: '', audience: 'All members' });
      setNoticeOpen(false);
      onToast(`Announcement sent to ${notificationAudienceLabel(audience)}.`);
    } catch (_error) {
      // Keep the demo workspace usable if the API is temporarily unavailable.
      // A connected Supabase session uses the server path above.
      publishSchoolAnnouncement(text(workspace.profile.schoolName, data.school.name), notice);
      mutate(current => ({ ...current, notifications: [notice, ...current.notifications] }));
      setNoticeForm({ title: '', body: '', audience: 'All members' });
      setNoticeOpen(false);
      onToast('Announcement saved on this device while the server is unavailable.');
    }
  };

  const peopleRows = (items, type) => <section className="admin-list">{records(items).map(item => {
    const isTeacher = type === 'teacher' || (type === 'member' && Array.isArray(item.classIds));
    const name = text(item.name, isTeacher ? 'Teacher' : 'Student');
    const classIds = classIdsFor(item.classIds);
    return <article className="admin-row" key={item.id || `${type}-${name}`}><span className="avatar gradient">{item.initials || initialsFor(name)}</span><div><b>{name}</b><small>{text(item.email, 'No email provided')}</small></div><span className="admin-row-meta">{isTeacher ? `${text(item.subject, 'General')} · ${classIds.length} class${classIds.length === 1 ? '' : 'es'}` : nameForClass(item.classId)}</span><button className="admin-delete" onClick={() => isTeacher ? removeTeacher(item.id) : removeStudent(item.id)} aria-label={`Remove ${name}`}><Trash2 size={16} /></button></article>;
  })}</section>;
  const statCards = <section className="metric-grid admin-metrics"><article className="metric-card"><span className="metric-icon indigo"><GraduationCap size={19} /></span><div><p>Teachers</p><h3>{data.teachers.length}</h3><small>Active school staff</small></div></article><article className="metric-card"><span className="metric-icon blue"><Users size={19} /></span><div><p>Students</p><h3>{totalStudents}</h3><small>Enrolled learners</small></div></article><article className="metric-card"><span className="metric-icon emerald"><BookOpen size={19} /></span><div><p>Classes</p><h3>{workspace.classes.length}</h3><small>Current academic year</small></div></article><article className="metric-card"><span className="metric-icon violet"><BarChart3 size={19} /></span><div><p>Average mastery</p><h3>{workspace.classes.length ? Math.round(workspace.classes.reduce((sum, item) => sum + (item.progress || 0), 0) / workspace.classes.length) : 0}%</h3><small>Across active classes</small></div></article></section>;

  const selectedStudentClass = workspace.classes.find(item => item.id === selectedStudentClassId);
  const selectedStudents = selectedStudentClass ? data.students.filter(student => studentIsInClass(student, selectedStudentClass.id)) : [];
  const studentDirectory = selectedStudentClass ? <><Header eyebrow="PEOPLE" title={selectedStudentClass.name} copy="Students enrolled in this class." /><button className="admin-student-back" onClick={() => { setSelectedStudentClassId(null); setStudentOpen(false); }}>← All classes</button><section className="workspace-detail-grid"><form className="card admin-form" onSubmit={addStudent}><p className="eyebrow">ADD STUDENT</p><h3>Add to {selectedStudentClass.name}</h3><label>Full name<input value={studentForm.name} onChange={event => setStudentForm(current => ({ ...current, name: event.target.value }))} placeholder="e.g. Riya Das" /></label><label>Email address<input type="email" value={studentForm.email} onChange={event => setStudentForm(current => ({ ...current, email: event.target.value }))} placeholder="Optional for demo" /></label><label>Class<input value={selectedStudentClass.name} readOnly /></label><button className="button" type="submit"><UserPlus size={16} /> Add student</button></form><article className="card"><p className="eyebrow">LEARNER DIRECTORY</p><h3>{selectedStudents.length} enrolled student{selectedStudents.length === 1 ? '' : 's'}</h3>{selectedStudents.length ? peopleRows(selectedStudents, 'student') : <Empty icon={Users} title="No students in this class yet" copy="Use Add student to enrol the first learner." />}</article></section></> : <><Header eyebrow="PEOPLE" title="Students" copy="Choose a class to view and manage its students." /><section className="admin-class-grid admin-student-class-grid">{workspace.classes.map(classRecord => { const students = data.students.filter(student => studentIsInClass(student, classRecord.id)); return <button className="card admin-class-card admin-student-class-card" key={classRecord.id} onClick={() => { setSelectedStudentClassId(classRecord.id); setStudentForm(current => ({ ...current, classId: classRecord.id })); }}><span className="file-icon"><Users size={20} /></span><h3>{classRecord.name}</h3><p>{classRecord.subject} · {students.length} enrolled student{students.length === 1 ? '' : 's'}</p><span className="admin-student-open">Open class students →</span></button>; })}</section></>;

  const addPanel = page === 'teachers' ? { label: 'Add teacher', open: teacherOpen, toggle: () => setTeacherOpen(current => !current), state: 'add-teacher-open' } : page === 'classes' && selectedStudentClassId ? { label: 'Add student', open: studentOpen, toggle: () => setStudentOpen(current => !current), state: 'add-student-open' } : page === 'subjects' ? { label: 'Add subject', open: subjectOpen, toggle: () => setSubjectOpen(current => !current), state: 'add-subject-open' } : page === 'timetable' ? { label: 'Add timetable block', open: timetableOpen, toggle: () => setTimetableOpen(current => !current), state: 'add-timetable-open' } : page === 'notifications' ? { label: 'Create notification', open: noticeOpen, toggle: () => setNoticeOpen(current => !current), state: 'add-notice-open' } : null;
  let content;
  if (page === 'dashboard') content = <><Header eyebrow="SCHOOL ADMINISTRATION" title="Your school, clearly managed" copy="A live overview of people, classrooms and school operations." action="Add teacher" onAction={() => setPage('teachers')} />{statCards}<section className="workspace-detail-grid"><article className="card"><p className="eyebrow">SCHOOL DIRECTORY</p><h3>{data.school.name}</h3><div className="stat-list"><div><span>Academic year</span><b>{data.school.academicYear}</b></div><div><span>Location</span><b>{data.school.city}</b></div><div><span>Contact</span><b>{data.school.contact}</b></div></div></article><article className="card"><p className="eyebrow">ACTION CENTRE</p><h3>Keep operations moving</h3><div className="role-actions"><button onClick={() => setPage('teachers')}>Manage staff <GraduationCap size={15} /></button><button onClick={() => setPage('classes')}>Manage class students <Users size={15} /></button><button onClick={() => setPage('notifications')}>Publish notice <Bell size={15} /></button></div></article></section></>;
  else if (page === 'schools') content = <><Header eyebrow="SCHOOL SETTINGS" title="School profile" copy="Your school identity and academic details." /><article className="card admin-form admin-readonly-profile"><label>School name<input value={data.school.name} readOnly /></label><div className="form-grid"><label>Academic year<input value={data.school.academicYear} readOnly /></label><label>City<input value={data.school.city} readOnly /></label></div><label>Office email<input type="email" value={data.school.contact} readOnly /></label></article>{statCards}</>;
  else if (page === 'teachers') content = <><Header eyebrow="PEOPLE" title="Teachers" copy="Add, remove and assign staff members to classrooms." /><section className="workspace-detail-grid"><form className="card admin-form" onSubmit={addTeacher}><p className="eyebrow">ADD TEACHER</p><h3>New staff member</h3><label>Full name<input value={teacherForm.name} onChange={event => setTeacherForm(current => ({ ...current, name: event.target.value }))} placeholder="e.g. Kavitha Kumar" /></label><label>Email address<input type="email" value={teacherForm.email} onChange={event => setTeacherForm(current => ({ ...current, email: event.target.value }))} placeholder="teacher@school.edu" /></label><label>Primary subject<input value={teacherForm.subject} onChange={event => setTeacherForm(current => ({ ...current, subject: event.target.value }))} /></label><button className="button" type="submit"><UserPlus size={16} /> Add teacher</button></form><article className="card"><p className="eyebrow">STAFF DIRECTORY</p><h3>{data.teachers.length} active teachers</h3>{peopleRows(data.teachers, 'teacher')}</article></section></>;
  else if (page === 'students') content = studentDirectory;
  else if (page === 'classes') content = selectedStudentClass ? studentDirectory : <><Header eyebrow="ACADEMICS" title="Class management" copy="Choose a class to manage its teacher, Class ID, and enrolled students." /><section className="admin-class-grid">{workspace.classes.map(classRecord => { const teacher = teacherForClass(classRecord.id); const students = data.students.filter(student => studentIsInClass(student, classRecord.id)); return <article className="card admin-class-card" key={classRecord.id}><span className="file-icon"><BookOpen size={20} /></span><h3>{classRecord.name}</h3><p>{classRecord.subject} · {students.length} enrolled student{students.length === 1 ? '' : 's'}</p><code>Class ID: {classRecord.joinCode || 'Not assigned'}</code><label>Teacher<select value={teacher?.id || ''} onChange={event => assignTeacher(classRecord.id, event.target.value)}><option value="">Unassigned</option>{data.teachers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><small>{teacher ? `${teacher.name} · ${teacher.subject}` : 'Assign a teacher to this class.'}</small><div className="admin-class-student-total"><span>Students in this class</span><b>{students.length}</b></div><div className="admin-class-student-preview"><span>Enrolled students</span><div>{students.length ? students.slice(0, 3).map(student => <small key={student.id}>{student.name}</small>) : <small>No students enrolled yet</small>}</div></div><button className="button subtle admin-class-students-button" onClick={() => { setSelectedStudentClassId(classRecord.id); setStudentForm(current => ({ ...current, classId: classRecord.id })); }}>View students</button></article>; })}</section></>;
  else if (page === 'subjects') content = <><Header eyebrow="ACADEMICS" title="Subject catalogue" copy="Maintain the school subjects available for classes and teacher assignments." /><form className="card admin-inline-form" onSubmit={addSubject}><input value={subjectName} onChange={event => setSubjectName(event.target.value)} placeholder="Add a subject" /><button className="button" type="submit"><Plus size={16} /> Add subject</button></form><section className="admin-chip-grid">{data.subjects.map(subject => <article className="card admin-chip" key={subject}><BookOpen size={18} /><b>{subject}</b><button className="admin-delete" onClick={() => mutate(current => ({ ...current, subjects: current.subjects.filter(item => item !== subject) }))}><Trash2 size={15} /></button></article>)}</section></>;
  else if (page === 'timetable') content = <><Header eyebrow="SCHEDULING" title="School timetable" copy="Coordinate class teaching blocks and remove outdated entries." /><form className="card admin-inline-form admin-timetable-form" onSubmit={addTimetable}><select value={timetableForm.classId} onChange={event => setTimetableForm(current => ({ ...current, classId: event.target.value }))}>{workspace.classes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select value={timetableForm.day} onChange={event => setTimetableForm(current => ({ ...current, day: event.target.value }))}>{['Monday','Tuesday','Wednesday','Thursday','Friday'].map(day => <option key={day}>{day}</option>)}</select><input value={timetableForm.time} onChange={event => setTimetableForm(current => ({ ...current, time: event.target.value }))} /><button className="button" type="submit"><Plus size={16} /> Add block</button></form><article className="card"><p className="eyebrow">WEEKLY BLOCKS</p><h3>Scheduled teaching</h3><section className="admin-list">{data.timetable.map(slot => <article className="admin-row" key={slot.id}><span className="file-icon"><CalendarCheck size={18} /></span><div><b>{nameForClass(slot.classId)}</b><small>{slot.day} · {slot.time}</small></div><button className="admin-delete" onClick={() => mutate(current => ({ ...current, timetable: current.timetable.filter(item => item.id !== slot.id) }))}><Trash2 size={16} /></button></article>)}</section></article></>;
  else if (page === 'attendance') content = <><Header eyebrow="OPERATIONS" title="Attendance" copy="A school-wide attendance snapshot for the current week." />{statCards}<section className="workspace-detail-grid"><article className="card"><p className="eyebrow">CLASS ATTENDANCE</p><h3>This week</h3>{workspace.classes.map((item, index) => <div className="mastery-row" key={item.id}><span>{item.name}</span><div className="progress"><i style={{ width: `${[94, 91, 96][index % 3]}%` }} /></div><b>{[94, 91, 96][index % 3]}%</b></div>)}</article><article className="card"><p className="eyebrow">FOLLOW UP</p><h3>Attendance alerts</h3><p className="role-card-copy">Students below 85% attendance will appear here for a wellbeing follow-up. No critical alerts are currently open.</p></article></section></>;
  else if (page === 'assessments') content = <><Header eyebrow="ACADEMICS" title="Assessments" copy="Review published, draft and upcoming assessment activity." /><article className="card"><p className="eyebrow">ASSESSMENT REGISTER</p><h3>Current assessment activity</h3>{workspace.tests.length ? <section className="admin-list">{workspace.tests.map(test => <article className="admin-row" key={test.id}><span className="file-icon"><FileText size={18} /></span><div><b>{test.title}</b><small>{test.className} · {test.questions || 0} questions · {test.marks || 0} marks</small></div><span className="badge info">{test.status}</span></article>)}</section> : <Empty icon={ClipboardCheck} title="No assessments yet" copy="Assessments created by teachers will appear here." />}</article></>;
  else if (page === 'resources') content = <><Header eyebrow="LIBRARY" title="Resource library" copy="Review materials shared by teachers and their assigned classes." /><article className="card"><p className="eyebrow">SHARED MATERIALS</p><h3>{workspace.resources.length} resources</h3>{workspace.resources.length ? <section className="admin-list">{workspace.resources.map(resource => <article className="admin-row" key={resource.id}><span className="file-icon"><Library size={18} /></span><div><b>{resource.name || resource.title}</b><small>{resource.type || resource.resource_type || 'Material'} · {resource.grade || nameForClass(resource.classId)}</small></div><span className="badge success">Available</span></article>)}</section> : <Empty icon={Library} title="Resource library is ready" copy="Teacher uploads will appear here with their class assignment." />}</article></>;
  else if (page === 'analytics') content = <><Header eyebrow="ANALYTICS" title="School learning signals" copy="Compare progress across the active classes in your school." />{statCards}<section className="workspace-detail-grid"><article className="card pie-breakdown"><p className="eyebrow">MASTERY BY CLASS</p><h3>Learning progress</h3>{workspace.classes.map((item, index) => { const progress = item.progress || 0; return <div className="pie-breakdown-row" key={item.id}><span className={`mini-pie pie-${index}`} style={{ '--pie-progress': `${progress * 3.6}deg` }}><span>{progress}%</span></span><div><b>{item.name}</b><small>{item.subject} · current mastery</small></div></div>; })}</article><article className="card"><p className="eyebrow">HEALTHY MOMENTUM</p><h3>School indicators</h3><div className="stat-list"><div><span>Average attendance</span><b>94%</b></div><div><span>Open reviews</span><b>{workspace.homework.length}</b></div><div><span>Active notices</span><b>{data.notifications.filter(item => item.active).length}</b></div></div></article></section></>;
  else if (page === 'reports') content = <><Header eyebrow="REPORTING" title="School reports" copy="Prepare operational summaries for school leadership." /><section className="admin-report-grid">{[['Attendance summary', 'Class and student attendance for the current term.'], ['Academic progress', 'Mastery, assessments and feedback across classes.'], ['People directory', 'Active teachers, students and school roles.']].map(([title, copy]) => <article className="card" key={title}><FileText size={21} /><h3>{title}</h3><p>{copy}</p><button className="button subtle" onClick={() => onToast(`${title} is ready to export.`)}><Download size={15} /> Prepare report</button></article>)}</section></>;
  else if (page === 'users') content = <><Header eyebrow="ACCESS" title="User management" copy="Review who currently has access to this school workspace." /><article className="card"><p className="eyebrow">ACTIVE MEMBERS</p><h3>School membership</h3>{peopleRows([...data.teachers, ...data.students], 'member')}</article></>;
  else if (page === 'notifications') content = <><Header eyebrow="COMMUNICATION" title="School notifications" copy="Publish and manage notices for teachers and students." /><section className="workspace-detail-grid"><form className="card admin-form" onSubmit={addNotice}><p className="eyebrow">NEW NOTICE</p><h3>Publish an update</h3><label>Title<input value={noticeForm.title} onChange={event => setNoticeForm(current => ({ ...current, title: event.target.value }))} /></label><label>Message<textarea value={noticeForm.body} onChange={event => setNoticeForm(current => ({ ...current, body: event.target.value }))} /></label><label>Audience<select value={noticeForm.audience} onChange={event => setNoticeForm(current => ({ ...current, audience: event.target.value }))}><option>All members</option><option>Teachers</option><option>Students</option></select></label><button className="button" type="submit"><Bell size={16} /> Publish notice</button></form><article className="card"><p className="eyebrow">RECENT NOTICES</p><h3>Published updates</h3><section className="admin-list">{data.notifications.map(notice => <article className="admin-row admin-notice" key={notice.id}><span className="file-icon"><Bell size={18} /></span><div><b>{notice.title}</b><small>{notice.body} · {notice.audience}</small></div><button className="admin-delete" onClick={() => mutate(current => ({ ...current, notifications: current.notifications.filter(item => item.id !== notice.id) }))}><Trash2 size={16} /></button></article>)}</section></article></section></>;
  else if (page === 'profile') content = <><Header eyebrow="ADMINISTRATOR" title="Your profile" copy="Your identity and role in this school workspace." /><section className="workspace-detail-grid"><article className="card admin-profile-card"><span className="avatar gradient">{initialsFor(workspace.profile.fullName)}</span><div><h3>{workspace.profile.fullName}</h3><p>{workspace.profile.email}</p><span className="badge info">School administrator</span></div></article><article className="card"><p className="eyebrow">ACCESS LEVEL</p><h3>Administrator permissions</h3><p className="role-card-copy">You can manage the school directory, classes, notices, reporting and settings in this workspace.</p></article></section></>;
  else if (page === 'settings') content = <><Header eyebrow="SETTINGS" title="Administrator settings" copy="Control appearance, demo data and your signed-in session." /><section className="settings-layout"><article className="card"><p className="eyebrow">APPEARANCE</p><h3>Theme</h3><div className="setting-row"><div><b>Color appearance</b><p>Switch between light and dark mode.</p></div><button className="button subtle" onClick={onTheme}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}{theme === 'dark' ? 'Use light' : 'Use dark'}</button></div></article><article className="card"><p className="eyebrow">SCHOOL DATA</p><h3>Saved administrator workspace</h3><p className="role-card-copy">Directory edits and sample records are saved to this administrator workspace and can be changed or removed anytime.</p><button className="button subtle" onClick={() => onToast('All administrator changes are saved.') }><ShieldCheck size={16} /> Data saved</button></article><article className="card"><p className="eyebrow">SESSION</p><h3>Sign out</h3><div className="setting-row"><div><b>{workspace.profile.fullName}</b><p>{workspace.profile.email}</p></div><button className="button danger-outline" onClick={onSignOut}>Sign out</button></div></article></section></>;
  else content = <><Header eyebrow="SCHOOL ADMINISTRATION" title="Administrator workspace" copy="Choose an area from the menu to manage your school." />{statCards}</>;

  return <div className={`page admin-portal ${addPanel?.open ? addPanel.state : ''}`} data-admin-page={page}>{addPanel && <button className="button admin-page-add" onClick={addPanel.toggle}>{addPanel.open ? 'Close add form' : addPanel.label}</button>}{content}</div>;
}
