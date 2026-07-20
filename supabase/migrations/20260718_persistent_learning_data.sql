-- Persistent data used by homework, attendance, feedback, announcements,
-- messages and per-user UI preferences. All public tables are RLS protected.
create table if not exists public.user_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  theme text not null default 'light' check (theme in ('light', 'dark', 'system')),
  notifications jsonb not null default '{"weeklyDigest":true,"instantNotifications":true}'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists public.homework_assignments (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade, teacher_id uuid not null references public.profiles(id) on delete restrict,
  title text not null check (char_length(title) between 1 and 180), instructions text, due_at timestamptz,
  status public.assessment_status not null default 'draft', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.attendance_sessions (
  id uuid primary key default gen_random_uuid(), class_id uuid not null references public.classes(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete restrict, session_date date not null, topic text,
  created_at timestamptz not null default now(), unique (class_id, session_date)
);
create table if not exists public.attendance_records (
  attendance_session_id uuid not null references public.attendance_sessions(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  status text not null check (status in ('present', 'absent', 'late', 'excused')), recorded_at timestamptz not null default now(),
  primary key (attendance_session_id, student_id)
);
create table if not exists public.feedback_notes (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade, teacher_id uuid not null references public.profiles(id) on delete restrict,
  student_id uuid not null references public.profiles(id) on delete cascade, title text not null check (char_length(title) between 1 and 180),
  body text not null, status public.draft_status not null default 'draft', published_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  class_id uuid references public.classes(id) on delete cascade, author_id uuid not null references public.profiles(id) on delete restrict,
  title text not null check (char_length(title) between 1 and 180), body text not null, created_at timestamptz not null default now()
);
create table if not exists public.direct_messages (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete restrict, recipient_id uuid not null references public.profiles(id) on delete restrict,
  subject text not null check (char_length(subject) between 1 and 180), body text not null, read_at timestamptz, created_at timestamptz not null default now(), check (sender_id <> recipient_id)
);

create index if not exists homework_assignments_class_due_idx on public.homework_assignments(class_id, due_at);
create index if not exists attendance_sessions_class_date_idx on public.attendance_sessions(class_id, session_date desc);
create index if not exists attendance_records_student_idx on public.attendance_records(student_id);
create index if not exists feedback_notes_class_student_idx on public.feedback_notes(class_id, student_id);
create index if not exists announcements_school_class_idx on public.announcements(school_id, class_id, created_at desc);
create index if not exists direct_messages_recipient_idx on public.direct_messages(recipient_id, created_at desc);
create trigger user_preferences_updated_at before update on public.user_preferences for each row execute function private.set_updated_at();
create trigger homework_assignments_updated_at before update on public.homework_assignments for each row execute function private.set_updated_at();
create trigger feedback_notes_updated_at before update on public.feedback_notes for each row execute function private.set_updated_at();

alter table public.user_preferences enable row level security;
alter table public.homework_assignments enable row level security;
alter table public.attendance_sessions enable row level security;
alter table public.attendance_records enable row level security;
alter table public.feedback_notes enable row level security;
alter table public.announcements enable row level security;
alter table public.direct_messages enable row level security;
grant select, insert, update, delete on public.user_preferences, public.homework_assignments, public.attendance_sessions, public.attendance_records, public.feedback_notes, public.announcements, public.direct_messages to authenticated;

create policy "users manage own preferences" on public.user_preferences for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "class participants view homework" on public.homework_assignments for select to authenticated using (private.can_manage_class(class_id) or private.is_enrolled(class_id));
create policy "class owners manage homework" on public.homework_assignments for all to authenticated using (private.can_manage_class(class_id)) with check (school_id = private.current_school_id() and teacher_id = (select auth.uid()) and private.can_manage_class(class_id));
create policy "class participants view attendance sessions" on public.attendance_sessions for select to authenticated using (private.can_manage_class(class_id) or private.is_enrolled(class_id));
create policy "class owners manage attendance sessions" on public.attendance_sessions for all to authenticated using (private.can_manage_class(class_id)) with check (teacher_id = (select auth.uid()) and private.can_manage_class(class_id));
create policy "students and class owners view attendance records" on public.attendance_records for select to authenticated using (student_id = (select auth.uid()) or exists (select 1 from public.attendance_sessions session where session.id = attendance_session_id and private.can_manage_class(session.class_id)));
create policy "class owners manage attendance records" on public.attendance_records for all to authenticated using (exists (select 1 from public.attendance_sessions session where session.id = attendance_session_id and private.can_manage_class(session.class_id))) with check (exists (select 1 from public.attendance_sessions session where session.id = attendance_session_id and private.can_manage_class(session.class_id)));
create policy "students view published feedback" on public.feedback_notes for select to authenticated using ((student_id = (select auth.uid()) and status = 'published') or private.can_manage_class(class_id));
create policy "class owners manage feedback" on public.feedback_notes for all to authenticated using (private.can_manage_class(class_id)) with check (school_id = private.current_school_id() and teacher_id = (select auth.uid()) and private.can_manage_class(class_id));
create policy "school members view announcements" on public.announcements for select to authenticated using (school_id = private.current_school_id() and (class_id is null or private.can_manage_class(class_id) or private.is_enrolled(class_id)));
create policy "staff create announcements" on public.announcements for insert to authenticated with check (school_id = private.current_school_id() and ((class_id is null and private.current_role() in ('teacher', 'school_admin')) or (class_id is not null and private.can_manage_class(class_id))));
create policy "participants view direct messages" on public.direct_messages for select to authenticated using (sender_id = (select auth.uid()) or recipient_id = (select auth.uid()));
create policy "members send direct messages" on public.direct_messages for insert to authenticated with check (school_id = private.current_school_id() and sender_id = (select auth.uid()) and private.shares_class_context(recipient_id));
create policy "recipients mark direct messages read" on public.direct_messages for update to authenticated using (recipient_id = (select auth.uid())) with check (recipient_id = (select auth.uid()));

-- Passwordless users may only create their own teacher school or join a class
-- whose opaque Class ID they possess. No caller-supplied user id is accepted.
create or replace function public.bootstrap_teacher_workspace(p_school_name text) returns table (school_id uuid, role public.user_role) language plpgsql security definer set search_path = '' as $$
declare v_school_id uuid; v_role public.user_role;
begin
  if (select auth.uid()) is null then raise exception 'Authentication is required.'; end if;
  select membership.school_id, membership.role into v_school_id, v_role from public.school_memberships membership where membership.user_id = (select auth.uid()) and membership.status = 'active' limit 1;
  if v_school_id is not null then
    if v_role not in ('teacher', 'school_admin') then raise exception 'This account already belongs to a student workspace.'; end if;
    return query select v_school_id, v_role; return;
  end if;
  if char_length(trim(coalesce(p_school_name, ''))) < 2 then raise exception 'A school name is required.'; end if;
  insert into public.schools (name) values (left(trim(p_school_name), 160)) returning id into v_school_id;
  insert into public.school_memberships (school_id, user_id, role, status) values (v_school_id, (select auth.uid()), 'teacher', 'active');
  return query select v_school_id, 'teacher'::public.user_role;
end; $$;
create or replace function public.bootstrap_student_by_code(p_join_code text) returns table (school_id uuid, class_id uuid, role public.user_role) language plpgsql security definer set search_path = '' as $$
declare target_class public.classes%rowtype; existing_school uuid; existing_role public.user_role;
begin
  if (select auth.uid()) is null then raise exception 'Authentication is required.'; end if;
  select * into target_class from public.classes where join_code = upper(trim(p_join_code)); if not found then raise exception 'Class ID was not found.'; end if;
  select membership.school_id, membership.role into existing_school, existing_role from public.school_memberships membership where membership.user_id = (select auth.uid()) and membership.status = 'active' limit 1;
  if existing_school is not null and existing_school <> target_class.school_id then raise exception 'This account already belongs to another school.'; end if;
  if existing_role is not null and existing_role <> 'student' then raise exception 'This account is not a student account.'; end if;
  insert into public.school_memberships (school_id, user_id, role, status) values (target_class.school_id, (select auth.uid()), 'student', 'active') on conflict (school_id, user_id) do nothing;
  insert into public.enrollments (class_id, student_id) values (target_class.id, (select auth.uid())) on conflict (class_id, student_id) do nothing;
  return query select target_class.school_id, target_class.id, 'student'::public.user_role;
end; $$;
revoke all on function public.bootstrap_teacher_workspace(text) from public, anon;
revoke all on function public.bootstrap_student_by_code(text) from public, anon;
grant execute on function public.bootstrap_teacher_workspace(text) to authenticated;
grant execute on function public.bootstrap_student_by_code(text) to authenticated;
