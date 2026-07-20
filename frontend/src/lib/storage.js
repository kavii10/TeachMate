const emailKey = email => email.trim().toLowerCase();
const roleKey = role => {
  const value = String(role || '').trim().toLowerCase();
  if (value === 'student') return 'student';
  if (value === 'admin' || value === 'administrator' || value === 'school_admin') return 'admin';
  return 'teacher';
};
const keyFor = (email, role) => `teachmate:demo:${emailKey(email)}${role ? `:${roleKey(role)}` : ''}`;
const classRegistryKey = 'teachmate:demo:classes';
const activeAccountKey = 'teachmate:active-account';
const pendingProfileKey = 'teachmate:pending-profile';
const backupKeyFor = (email, role) => `${keyFor(email, role)}:backup`;

export const normalizeClassId = value => String(value || '').trim().toUpperCase().replace(/\s+/g, '');

function loadClassRegistry() {
  try { return JSON.parse(localStorage.getItem(classRegistryKey) || '{}'); } catch { return {}; }
}

function saveClassRegistry(registry) {
  localStorage.setItem(classRegistryKey, JSON.stringify(registry));
}

/**
 * Generate human-readable Invite Code (e.g., SCI10-7XK9P, MATH9-H3LQ2)
 */
export function createDemoClassId(subject = 'SCI', grade = '10') {
  const registry = loadClassRegistry();
  const cleanSubj = String(subject || 'SCI').trim().replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase() || 'SCI';
  const cleanGrade = String(grade || '10').trim().replace(/[^a-zA-Z0-9]/g, '').slice(0, 3).toUpperCase() || '10';

  let code;
  do {
    const randomPart = globalThis.crypto?.getRandomValues
      ? Array.from(crypto.getRandomValues(new Uint8Array(4))).map(b => b.toString(36)).join('').toUpperCase().slice(0, 5)
      : Math.random().toString(36).slice(2, 7).toUpperCase();
    code = `${cleanSubj}${cleanGrade}-${randomPart.padEnd(5, 'X')}`;
  } while (registry[code]);

  return code;
}

export function registerDemoClass(classRecord) {
  const registry = loadClassRegistry();
  const joinCode = normalizeClassId(classRecord.joinCode || classRecord.inviteCode);
  const record = { ...classRecord, joinCode, inviteCode: joinCode, joiningEnabled: classRecord.joiningEnabled ?? true };
  registry[joinCode] = record;
  saveClassRegistry(registry);
  return record;
}

export function findDemoClass(classId) {
  if (!classId) return null;
  const normalized = normalizeClassId(classId);
  const registry = loadClassRegistry();

  if (registry[normalized]) return registry[normalized];

  // Also search by partial match or inviteCode key
  const match = Object.values(registry).find(
    c => (c.joinCode && normalizeClassId(c.joinCode) === normalized) || (c.inviteCode && normalizeClassId(c.inviteCode) === normalized)
  );
  return match || null;
}

export function loadAccount(email, role) {
  try {
    const saved = JSON.parse(localStorage.getItem(keyFor(email, role)) || localStorage.getItem(backupKeyFor(email, role)) || 'null');
    if (saved || !role) return saved;
    const legacy = JSON.parse(localStorage.getItem(keyFor(email)) || 'null');
    return legacy && roleKey(legacy.profile?.role) === roleKey(role) ? legacy : null;
  } catch { return null; }
}

export function saveAccount(email, data) {
  const payload = JSON.stringify(data);
  const key = keyFor(email, data?.profile?.role);
  localStorage.setItem(backupKeyFor(email, data?.profile?.role), payload);
  localStorage.setItem(key, payload);
}

export function saveActiveAccount(profile) {
  if (!profile?.email) return;
  localStorage.setItem(activeAccountKey, JSON.stringify({ email: emailKey(profile.email), role: roleKey(profile.role) }));
}

export function loadActiveAccount() {
  try {
    const active = JSON.parse(localStorage.getItem(activeAccountKey) || 'null');
    return active?.email ? loadAccount(active.email, active.role) : null;
  } catch { return null; }
}

export function clearActiveAccount() {
  localStorage.removeItem(activeAccountKey);
}

export function savePendingProfile(profile) {
  if (profile?.email) localStorage.setItem(pendingProfileKey, JSON.stringify(profile));
}

export function loadPendingProfile(email) {
  try {
    const pending = JSON.parse(localStorage.getItem(pendingProfileKey) || 'null');
    return pending?.email === emailKey(email) ? pending : null;
  } catch { return null; }
}

export function clearPendingProfile() {
  localStorage.removeItem(pendingProfileKey);
}

export function addStudentToDemoClass(cleanCode, studentInfo) {
  const normalized = normalizeClassId(cleanCode);
  const registry = loadClassRegistry();
  const demoRecord = findDemoClass(normalized);

  if (!demoRecord) return null;

  const studentObj = {
    id: studentInfo.id || `student-${Date.now()}`,
    name: studentInfo.fullName || studentInfo.name || 'Enrolled Student',
    email: studentInfo.email || '',
    rollNumber: studentInfo.rollNumber || `R-${Math.floor(100 + Math.random() * 900)}`,
    className: demoRecord.name || 'Classroom',
    classId: demoRecord.id || normalized,
    attendance: 100,
    avgMarks: 85,
    score: 0,
    initials: (studentInfo.fullName || studentInfo.name || 'ST').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase()
  };

  const currentRoster = demoRecord.studentsList || [];
  const exists = currentRoster.some(s => (s.email && s.email.toLowerCase() === studentObj.email.toLowerCase()) || s.name.toLowerCase() === studentObj.name.toLowerCase());
  const updatedRoster = exists ? currentRoster : [...currentRoster, studentObj];
  
  const updatedClassRecord = {
    ...demoRecord,
    studentsList: updatedRoster,
    students: updatedRoster.length
  };
  registry[normalized] = updatedClassRecord;
  if (demoRecord.joinCode) registry[demoRecord.joinCode] = updatedClassRecord;
  saveClassRegistry(registry);

  if (demoRecord.teacherEmail) {
    const teacherAccount = loadAccount(demoRecord.teacherEmail, 'teacher');
    if (teacherAccount) {
      const teacherStudents = teacherAccount.students || [];
      const teacherStudentExists = teacherStudents.some(s => (s.email && s.email.toLowerCase() === studentObj.email.toLowerCase()) || s.name.toLowerCase() === studentObj.name.toLowerCase());
      const updatedTeacherStudents = teacherStudentExists ? teacherStudents : [...teacherStudents, studentObj];
      
      const updatedTeacherClasses = (teacherAccount.classes || []).map(c => {
        if (normalizeClassId(c.joinCode || c.inviteCode) === normalized || c.id === demoRecord.id) {
          return { ...c, students: updatedRoster.length, studentsList: updatedRoster };
        }
        return c;
      });

      saveAccount(demoRecord.teacherEmail, {
        ...teacherAccount,
        students: updatedTeacherStudents,
        classes: updatedTeacherClasses
      });
    }
  }

  return studentObj;
}

export function loadTheme() {
  return localStorage.getItem('teachmate:theme') || 'light';
}

export function saveTheme(theme) {
  localStorage.setItem('teachmate:theme', theme);
}
