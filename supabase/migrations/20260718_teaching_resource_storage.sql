-- Private teaching files are addressed by school/class/user. The related
-- resource_assignments row is the authority for which students see a file.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'teaching-resources',
  'teaching-resources',
  false,
  10485760,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/jpeg', 'image/png', 'text/plain'
  ]
)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "teachers upload teaching resources" on storage.objects;
create policy "teachers upload teaching resources"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'teaching-resources'
  and split_part(name, '/', 1) = private.current_school_id()::text
  and split_part(name, '/', 3) = (select auth.uid())::text
  and private.current_role() in ('teacher', 'school_admin')
);

drop policy if exists "class participants download teaching resources" on storage.objects;
create policy "class participants download teaching resources"
on storage.objects for select to authenticated
using (
  bucket_id = 'teaching-resources'
  and split_part(name, '/', 1) = private.current_school_id()::text
  and (
    private.current_role() in ('teacher', 'school_admin')
    or (
      split_part(name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and private.is_enrolled(split_part(name, '/', 2)::uuid)
    )
  )
);

drop policy if exists "teachers delete their teaching resources" on storage.objects;
create policy "teachers delete their teaching resources"
on storage.objects for delete to authenticated
using (
  bucket_id = 'teaching-resources'
  and split_part(name, '/', 1) = private.current_school_id()::text
  and split_part(name, '/', 3) = (select auth.uid())::text
  and private.current_role() in ('teacher', 'school_admin')
);
