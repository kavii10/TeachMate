-- Announcements are always authored by the authenticated staff member.
-- This prevents a direct API call from assigning another user's profile as
-- the author, even though the normal app flow is server-side.
drop policy if exists "staff create announcements" on public.announcements;

create policy "staff create announcements"
on public.announcements for insert to authenticated
with check (
  school_id = private.current_school_id()
  and author_id = (select auth.uid())
  and (
    (class_id is null and private.current_role() in ('teacher', 'school_admin'))
    or (class_id is not null and private.can_manage_class(class_id))
  )
);
