export const roleNavigation = {
  teacher: [
    ['dashboard', 'Overview'], ['classes', 'My classes'], ['timetable', 'Timetable'], ['calendar', 'Calendar'], ['announcements', 'Announcements'], ['insights', 'Learning insights'], ['analytics', 'Analytics'], ['profile', 'Profile'], ['settings', 'Settings']
  ],
  student: [
    ['dashboard', 'Overview'], ['subjects', 'My subjects'], ['calendar', 'Calendar'], ['announcements', 'Announcements'], ['profile', 'Profile'], ['settings', 'Settings']
  ],
  admin: [
    ['dashboard', 'Overview'], ['schools', 'Schools'], ['teachers', 'Teachers'], ['classes', 'Classes'], ['subjects', 'Subjects'], ['analytics', 'Analytics'], ['reports', 'Reports'], ['users', 'User management'], ['notifications', 'Notifications'], ['profile', 'Profile'], ['settings', 'Settings']
  ]
};

export function normalizeRole(role) {
  const value = String(role || '').trim().toLowerCase();
  if (value === 'school_admin' || value === 'admin' || value === 'administrator') return 'admin';
  if (value === 'student') return 'student';
  return 'teacher';
}

export const roleLabels = { teacher: 'Teacher', student: 'Student', admin: 'Administrator' };

/**
 * Creates a clean, empty, real data-driven Workspace for a user account.
 * Contains ZERO fake mock data by default. All items are created by users and stored in the database.
 */
export function createWorkspace(profile) {
  const classes = profile.joinedClass ? [profile.joinedClass] : [];
  const students = [];
  const homework = [];
  const quizzes = [];
  const attendanceHistory = {};
  const tests = [];
  const feedback = [];
  const resources = [];
  const announcements = [];
  const chatThreads = {};

  return {
    profile,
    classes,
    students,
    homework,
    quizzes,
    attendanceHistory,
    tests,
    feedback,
    resources,
    announcements,
    chatThreads,
    settings: {
      weeklyDigest: true,
      instantNotifications: true,
      theme: 'light'
    },
    adminData: {
      teachers: [],
      students: [],
      classes: [],
      notifications: []
    }
  };
}
