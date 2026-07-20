const keyFor = schoolName => `teachmate:school-announcements:${String(schoolName || 'default').trim().toLowerCase()}`;

export function loadSchoolAnnouncements(schoolName) {
  try {
    const raw = localStorage.getItem(keyFor(schoolName));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

export function publishSchoolAnnouncement(schoolName, announcement) {
  const next = [announcement, ...loadSchoolAnnouncements(schoolName)].slice(0, 100);
  try { localStorage.setItem(keyFor(schoolName), JSON.stringify(next)); } catch { /* Storage is a demo fallback. */ }
  return next;
}
