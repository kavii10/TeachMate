import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => callback(null, Boolean(file.mimetype))
});

const createSchema = z.object({
  title: z.string().trim().min(1).max(180),
  classId: z.string().uuid(),
  resourceType: z.enum(['worksheet', 'lesson_plan', 'presentation', 'assessment', 'other'])
});

const typeFromUpload = type => ({ slides: 'presentation', link: 'other' }[type] || type);
const safeName = value => value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'resource';

async function signedResource(supabase, resource) {
  const { data, error } = await supabase.storage.from('teaching-resources').createSignedUrl(resource.storage_path, 900);
  if (error) throw new Error(`Could not prepare the resource: ${error.message}`);
  return { ...resource, signedUrl: data.signedUrl };
}

export const teacherResourcesRouter = Router();
teacherResourcesRouter.post('/resources', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Choose a file before uploading a secure school resource.' });
    const input = createSchema.parse({ ...req.body, resourceType: typeFromUpload(req.body.resourceType) });
    let classQuery = req.auth.supabase.from('classes').select('id, name, grade, subject').eq('id', input.classId).eq('school_id', req.auth.profile.school_id);
    if (req.auth.profile.role === 'teacher') classQuery = classQuery.eq('teacher_id', req.auth.user.id);
    const { data: classRecord, error: classError } = await classQuery.maybeSingle();
    if (classError) throw classError;
    if (!classRecord) return res.status(404).json({ error: 'This classroom is not available for resource sharing.' });

    const objectPath = `${req.auth.profile.school_id}/${classRecord.id}/${req.auth.user.id}/${Date.now()}-${safeName(req.file.originalname)}`;
    const { error: uploadError } = await req.auth.supabase.storage.from('teaching-resources').upload(objectPath, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
    if (uploadError) throw new Error(`Secure file upload failed: ${uploadError.message}`);

    const { data: resource, error: resourceError } = await req.auth.supabase.from('resources').insert({
      school_id: req.auth.profile.school_id,
      owner_id: req.auth.user.id,
      title: input.title,
      resource_type: input.resourceType,
      storage_path: objectPath,
      grade: classRecord.grade,
      subject: classRecord.subject
    }).select('id, title, resource_type, grade, subject, storage_path, created_at').single();
    if (resourceError) throw resourceError;

    const { error: assignmentError } = await req.auth.supabase.from('resource_assignments').insert({ resource_id: resource.id, class_id: classRecord.id, assigned_by: req.auth.user.id });
    if (assignmentError) throw assignmentError;
    res.status(201).json({ resource: { ...(await signedResource(req.auth.supabase, resource)), classId: classRecord.id, className: classRecord.name } });
  } catch (error) { next(error); }
});

teacherResourcesRouter.get('/resources', async (req, res, next) => {
  try {
    const { data, error } = await req.auth.supabase.from('resource_assignments').select('class_id, class:classes!inner(id, name), resource:resources!inner(id, title, resource_type, grade, subject, storage_path, created_at)').order('assigned_at', { ascending: false });
    if (error) throw error;
    const resources = await Promise.all((data || []).map(async row => ({ ...(await signedResource(req.auth.supabase, row.resource)), classId: row.class_id, className: row.class.name })));
    res.json({ resources });
  } catch (error) { next(error); }
});

export const studentResourcesRouter = Router();
studentResourcesRouter.get('/resources', async (req, res, next) => {
  try {
    const { data, error } = await req.auth.supabase.from('resource_assignments').select('class_id, class:classes!inner(id, name, subject), resource:resources!inner(id, title, resource_type, grade, subject, storage_path, created_at)').order('assigned_at', { ascending: false });
    if (error) throw error;
    const resources = await Promise.all((data || []).map(async row => ({ ...(await signedResource(req.auth.supabase, row.resource)), classId: row.class_id, className: row.class.name, classSubject: row.class.subject })));
    res.json({ resources });
  } catch (error) { next(error); }
});
