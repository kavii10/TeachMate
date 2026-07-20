-- TeachMate initial schema. Apply through the Supabase CLI or SQL editor.
-- Auth users are created by Supabase Auth. A school administrator activates
-- access by creating one active school_memberships row for that user.

-- Ensure UUID generator is available
create extension if not exists pgcrypto;

create schema if not exists private;

create type public.user_role as enum ('school_admin', 'teacher', 'student');
create type public.membership_status as enum ('pending', 'active', 'suspended');
create type public.assessment_status as enum ('draft', 'published', 'archived');
create type public.submission_status as enum ('draft', 'submitted', 'reviewed', 'returned');
create type public.draft_status as enum ('draft', 'approved', 'published', 'archived');
create type public.resource_type as enum ('worksheet', 'lesson_plan', 'presentation', 'assessment', 'other');

create table public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 160),
  timezone text not null default 'Asia/Kolkata',
  academic_year text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Contains only user-editable identity data. Roles and school access live in
-- school_memberships, never in auth user_metadata.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 1 and 160),
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.school_memberships (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.user_role not null,
  status public.membership_status not null default 'pending',
  invited_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, user_id)
);
-- TeachMate currently selects a single active school per user. This avoids
-- ambiguous tenant context in RLS; a future multi-school switcher can replace
-- this with an explicit, validated active-school claim.
create unique index school_memberships_one_active_user_idx
  on public.school_memberships(user_id) where status = 'active';

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 160),
  grade text not null check (char_length(grade) between 1 and 40),
  subject text not null check (char_length(subject) between 1 and 100),
  academic_year text not null check (char_length(academic_year) between 1 and 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.enrollments (
  class_id uuid not null references public.classes(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  primary key (class_id, student_id)
);

create table public.class_sessions (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  room text,
  topic text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table public.assessments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete restrict,
  title text not null check (char_length(title) between 1 and 180),
  instructions text,
  total_marks numeric(7, 2) not null check (total_marks > 0),
  status public.assessment_status not null default 'draft',
  due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.assessment_questions (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  position integer not null check (position > 0),
  prompt text not null,
  question_type text not null check (question_type in ('mcq', 'short_answer', 'long_answer', 'case_study', 'programming')),
  marks numeric(7, 2) not null check (marks > 0),
  bloom_level text,
  answer_key text,
  created_at timestamptz not null default now(),
  unique (assessment_id, position)
);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  status public.submission_status not null default 'draft',
  submitted_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assessment_id, student_id),
  check ((status = 'draft' and submitted_at is null) or (status <> 'draft' and submitted_at is not null))
);

create table public.submission_answers (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  question_id uuid not null references public.assessment_questions(id) on delete cascade,
  answer_text text,
  attachment_path text,
  marks_awarded numeric(7, 2) check (marks_awarded >= 0),
  teacher_comment text,
  updated_at timestamptz not null default now(),
  unique (submission_id, question_id)
);

create table public.voice_feedback_drafts (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete restrict,
  submission_id uuid references public.submissions(id) on delete set null,
  audio_path text not null,
  transcript text not null,
  structured_feedback jsonb,
  status public.draft_status not null default 'draft',
  approved_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint voice_feedback_approval_check check (
    (status in ('draft', 'approved', 'archived')) or approved_at is not null
  ),
  constraint voice_feedback_publish_check check (status <> 'published' or published_at is not null)
);

create table public.resources (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete restrict,
  title text not null check (char_length(title) between 1 and 180),
  resource_type public.resource_type not null,
  storage_path text not null unique,
  grade text,
  subject text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.resource_assignments (
  resource_id uuid not null references public.resources(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  assigned_by uuid not null references public.profiles(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  due_at timestamptz,
  primary key (resource_id, class_id)
);

-- Audit rows are created only by trusted server code using the secret key.
create table public.ai_audit_logs (
  id bigint generated always as identity primary key,
  school_id uuid not null references public.schools(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  purpose text not null,
  provider text not null,
  status text not null check (status in ('success', 'failed')),
  prompt_hash text not null,
  error_message text,
  created_at timestamptz not null default now()
);

create index classes_school_teacher_idx on public.classes(school_id, teacher_id);
create index enrollments_student_idx on public.enrollments(student_id);
create index class_sessions_class_starts_idx on public.class_sessions(class_id, starts_at);
create index assessments_class_status_idx on public.assessments(class_id, status);
create index submissions_assessment_status_idx on public.submissions(assessment_id, status);
create index submissions_student_idx on public.submissions(student_id);
create index voice_feedback_teacher_status_idx on public.voice_feedback_drafts(teacher_id, status);
create index resources_school_owner_idx on public.resources(school_id, owner_id);
create index ai_audit_school_created_idx on public.ai_audit_logs(school_id, created_at desc);
create index classes_teacher_idx on public.classes(teacher_id);
create index assessments_school_idx on public.assessments(school_id);
create index assessments_teacher_idx on public.assessments(teacher_id);
create index submissions_school_idx on public.submissions(school_id);
create index submission_answers_question_idx on public.submission_answers(question_id);
create index voice_feedback_school_idx on public.voice_feedback_drafts(school_id);
create index voice_feedback_submission_idx on public.voice_feedback_drafts(submission_id);
create index resources_owner_idx on public.resources(owner_id);
create index resource_assignments_class_idx on public.resource_assignments(class_id);
create index resource_assignments_assigned_by_idx on public.resource_assignments(assigned_by);
create index school_memberships_invited_by_idx on public.school_memberships(invited_by);
create index ai_audit_actor_idx on public.ai_audit_logs(actor_id);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$ begin new.updated_at = now(); return new; end; $$;

create trigger schools_updated_at before update on public.schools for each row execute function private.set_updated_at();
create trigger profiles_updated_at before update on public.profiles for each row execute function private.set_updated_at();
create trigger memberships_updated_at before update on public.school_memberships for each row execute function private.set_updated_at();
create trigger classes_updated_at before update on public.classes for each row execute function private.set_updated_at();
create trigger assessments_updated_at before update on public.assessments for each row execute function private.set_updated_at();
create trigger submissions_updated_at before update on public.submissions for each row execute function private.set_updated_at();
create trigger feedback_updated_at before update on public.voice_feedback_drafts for each row execute function private.set_updated_at();
create trigger resources_updated_at before update on public.resources for each row execute function private.set_updated_at();

-- The trigger creates an identity profile only. It deliberately does not grant
-- school access or a role based on user-controlled metadata.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(nullif(left(new.raw_user_meta_data ->> 'full_name', 160), ''), split_part(new.email, '@', 1), 'New user')
  );
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.handle_new_user();

create or replace function private.current_school_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select school_id from public.school_memberships
  where user_id = (select auth.uid()) and status = 'active'
  limit 1
$$;
create or replace function private.current_role()
returns public.user_role language sql stable security definer set search_path = '' as $$
  select role from public.school_memberships
  where user_id = (select auth.uid()) and status = 'active'
  limit 1
$$;
create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.current_role() = 'school_admin'::public.user_role
$$;
create or replace function private.shares_active_school(target_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.school_memberships mine
    join public.school_memberships theirs on theirs.school_id = mine.school_id
    where mine.user_id = (select auth.uid()) and mine.status = 'active'
      and theirs.user_id = target_user and theirs.status = 'active'
  )
$$;
create or replace function private.is_class_teacher(target_class uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.classes
    where id = target_class and school_id = private.current_school_id() and teacher_id = (select auth.uid())
  )
$$;
create or replace function private.is_enrolled(target_class uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.enrollments where class_id = target_class and student_id = (select auth.uid()))
$$;
create or replace function private.can_manage_class(target_class uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_admin() or private.is_class_teacher(target_class)
$$;
create or replace function private.can_manage_assessment(target_assessment uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.assessments where id = target_assessment and private.can_manage_class(class_id))
$$;

revoke all on schema private from public;
revoke all on all functions in schema private from public;
grant usage on schema private to authenticated;
grant execute on all functions in schema private to authenticated;

alter table public.schools enable row level security;
alter table public.profiles enable row level security;
alter table public.school_memberships enable row level security;
alter table public.classes enable row level security;
alter table public.enrollments enable row level security;
alter table public.class_sessions enable row level security;
alter table public.assessments enable row level security;
alter table public.assessment_questions enable row level security;
alter table public.submissions enable row level security;
alter table public.submission_answers enable row level security;
alter table public.voice_feedback_drafts enable row level security;
alter table public.resources enable row level security;
alter table public.resource_assignments enable row level security;
alter table public.ai_audit_logs enable row level security;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

create policy "members view their school" on public.schools for select to authenticated using (id = private.current_school_id());
create policy "admins update their school" on public.schools for update to authenticated using (id = private.current_school_id() and private.is_admin()) with check (id = private.current_school_id() and private.is_admin());

create policy "users view relevant profiles" on public.profiles for select to authenticated using (
  id = (select auth.uid()) or private.shares_active_school(id)
);
create policy "users update own profile" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "members view own membership" on public.school_memberships for select to authenticated using (user_id = (select auth.uid()) or (school_id = private.current_school_id() and private.is_admin()));
create policy "admins manage memberships" on public.school_memberships for all to authenticated using (school_id = private.current_school_id() and private.is_admin()) with check (school_id = private.current_school_id() and private.is_admin());

create policy "staff and enrolled students view classes" on public.classes for select to authenticated using (school_id = private.current_school_id() and (private.current_role() in ('school_admin', 'teacher') or private.is_enrolled(id)));
create policy "staff create classes" on public.classes for insert to authenticated with check (school_id = private.current_school_id() and private.current_role() in ('school_admin', 'teacher') and (private.is_admin() or teacher_id = (select auth.uid())));
create policy "owners manage classes" on public.classes for update to authenticated using (private.can_manage_class(id)) with check (school_id = private.current_school_id() and (private.is_admin() or teacher_id = (select auth.uid())));
create policy "owners delete classes" on public.classes for delete to authenticated using (private.can_manage_class(id));

create policy "class participants view enrollments" on public.enrollments for select to authenticated using (student_id = (select auth.uid()) or private.can_manage_class(class_id));
create policy "owners manage enrollments" on public.enrollments for all to authenticated using (private.can_manage_class(class_id)) with check (private.can_manage_class(class_id));

create policy "class participants view sessions" on public.class_sessions for select to authenticated using (private.can_manage_class(class_id) or private.is_enrolled(class_id));
create policy "owners manage sessions" on public.class_sessions for all to authenticated using (private.can_manage_class(class_id)) with check (private.can_manage_class(class_id));

create policy "staff and enrolled students view assessments" on public.assessments for select to authenticated using (school_id = private.current_school_id() and (private.can_manage_class(class_id) or (status = 'published' and private.is_enrolled(class_id))));
create policy "owners manage assessments" on public.assessments for all to authenticated using (private.can_manage_class(class_id)) with check (school_id = private.current_school_id() and private.can_manage_class(class_id));
create policy "assessment viewers see questions" on public.assessment_questions for select to authenticated using (exists (select 1 from public.assessments where id = assessment_id and (private.can_manage_class(class_id) or (status = 'published' and private.is_enrolled(class_id)))));
create policy "assessment owners manage questions" on public.assessment_questions for all to authenticated using (private.can_manage_assessment(assessment_id)) with check (private.can_manage_assessment(assessment_id));

create policy "students and class owners view submissions" on public.submissions for select to authenticated using (student_id = (select auth.uid()) or private.can_manage_assessment(assessment_id));
create policy "students create their own submission" on public.submissions for insert to authenticated with check (school_id = private.current_school_id() and student_id = (select auth.uid()) and exists (select 1 from public.assessments where id = assessment_id and status = 'published' and private.is_enrolled(class_id)));
create policy "students update drafts and staff review" on public.submissions for update to authenticated using ((student_id = (select auth.uid()) and status = 'draft') or private.can_manage_assessment(assessment_id)) with check ((student_id = (select auth.uid()) and school_id = private.current_school_id()) or private.can_manage_assessment(assessment_id));
create policy "owners delete draft submissions" on public.submissions for delete to authenticated using (student_id = (select auth.uid()) and status = 'draft');

create policy "submission participants view answers" on public.submission_answers for select to authenticated using (exists (select 1 from public.submissions where id = submission_id and (student_id = (select auth.uid()) or private.can_manage_assessment(assessment_id))));
create policy "students write their draft answers" on public.submission_answers for insert to authenticated with check (exists (select 1 from public.submissions where id = submission_id and student_id = (select auth.uid()) and status = 'draft'));
create policy "students update drafts and staff review answers" on public.submission_answers for update to authenticated using (exists (select 1 from public.submissions where id = submission_id and ((student_id = (select auth.uid()) and status = 'draft') or private.can_manage_assessment(assessment_id)))) with check (exists (select 1 from public.submissions where id = submission_id and ((student_id = (select auth.uid()) and status = 'draft') or private.can_manage_assessment(assessment_id))));

create policy "teachers manage their feedback drafts" on public.voice_feedback_drafts for all to authenticated using (school_id = private.current_school_id() and (teacher_id = (select auth.uid()) or private.is_admin())) with check (school_id = private.current_school_id() and (teacher_id = (select auth.uid()) or private.is_admin()));
create policy "staff manage school resources" on public.resources for all to authenticated using (school_id = private.current_school_id() and private.current_role() in ('school_admin', 'teacher')) with check (school_id = private.current_school_id() and private.current_role() in ('school_admin', 'teacher'));
create policy "class participants view assignments" on public.resource_assignments for select to authenticated using (private.can_manage_class(class_id) or private.is_enrolled(class_id));
create policy "class owners manage assignments" on public.resource_assignments for all to authenticated using (private.can_manage_class(class_id)) with check (private.can_manage_class(class_id));
create policy "admins view audit logs" on public.ai_audit_logs for select to authenticated using (school_id = private.current_school_id() and private.is_admin());

-- Private bucket: the Express server stores recordings with its secret key.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('voice-feedback', 'voice-feedback', false, 20971520, array['audio/mpeg','audio/mp4','audio/x-m4a','audio/wav','audio/webm','audio/ogg'])
on conflict (id) do nothing;

create policy "teachers view school recordings" on storage.objects for select to authenticated using (
  bucket_id = 'voice-feedback' and (storage.foldername(name))[1] = private.current_school_id()::text and private.current_role() in ('teacher', 'school_admin')
);
