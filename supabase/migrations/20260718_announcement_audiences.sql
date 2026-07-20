-- School-wide notices are addressed to teachers, students, or everyone.
alter table public.announcements
  add column if not exists audience text not null default 'all';

alter table public.announcements
  drop constraint if exists announcements_audience_check;

alter table public.announcements
  add constraint announcements_audience_check
  check (audience in ('all', 'teachers', 'students'));

create index if not exists announcements_school_audience_created_idx
  on public.announcements (school_id, audience, created_at desc);

drop policy if exists "school members view announcements" on public.announcements;

create policy "audience members view announcements"
on public.announcements for select to authenticated
using (
  school_id = private.current_school_id()
  and (
    private.current_role() = 'school_admin'
    or audience = 'all'
    or (audience = 'teachers' and private.current_role() = 'teacher')
    or (audience = 'students' and private.current_role() = 'student')
  )
  and (
    class_id is null
    or private.can_manage_class(class_id)
    or private.is_enrolled(class_id)
  )
);
