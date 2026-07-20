-- ============================================================================
-- TeachMate Complete Supabase Database Setup & Schema Script
-- Run this script in your Supabase SQL Editor to create all required tables,
-- functions, indexes, and policies if tables are missing or empty.
-- ============================================================================

-- 1. SCHOOLS TABLE
create table if not exists public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text default 'UTC',
  academic_year text default '2026-27',
  created_at timestamptz default now()
);

-- 2. PROFILES TABLE
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools(id) on delete set null,
  full_name text not null,
  email text,
  role text not null check (role in ('teacher', 'student', 'school_admin')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Add missing profile columns safely
alter table public.profiles add column if not exists email text;

-- 3. SCHOOL MEMBERSHIPS TABLE
create table if not exists public.school_memberships (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  role text not null check (role in ('teacher', 'student', 'school_admin')),
  status text not null default 'active' check (status in ('active', 'invited', 'inactive')),
  created_at timestamptz default now()
);

-- 4. CLASSES TABLE
create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools(id) on delete cascade,
  teacher_id uuid references public.profiles(id) on delete set null,
  teacher_email text,
  name text not null,
  grade text not null,
  subject text not null,
  academic_year text default '2026-27',
  join_code text not null unique,
  joining_enabled boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Add missing class columns safely
alter table public.classes add column if not exists joining_enabled boolean not null default true;
alter table public.classes add column if not exists teacher_email text;

-- 5. ENROLLMENTS (CLASS MEMBERS) TABLE
create table if not exists public.enrollments (
  id uuid primary key default gen_random_uuid(),
  class_id uuid references public.classes(id) on delete cascade,
  class_code text,
  student_id uuid references public.profiles(id) on delete cascade,
  student_name text,
  student_email text,
  joined_at timestamptz default now()
);

-- Add missing enrollment columns safely
alter table public.enrollments add column if not exists class_code text;
alter table public.enrollments add column if not exists student_name text;
alter table public.enrollments add column if not exists student_email text;

-- 6. HOMEWORK ASSIGNMENTS TABLE
create table if not exists public.homework_assignments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools(id) on delete cascade,
  class_id uuid references public.classes(id) on delete cascade,
  class_code text,
  teacher_id uuid references public.profiles(id) on delete set null,
  title text not null,
  instructions jsonb default '{}'::jsonb,
  due_at timestamptz,
  status text default 'published' check (status in ('draft', 'published', 'completed')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.homework_assignments add column if not exists class_code text;

-- 7. HOMEWORK SUBMISSIONS TABLE
create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  homework_id uuid references public.homework_assignments(id) on delete cascade,
  student_id uuid references public.profiles(id) on delete cascade,
  student_name text,
  content text,
  attachment_url text,
  status text default 'submitted' check (status in ('pending', 'submitted', 'graded', 'late')),
  score numeric,
  feedback_text text,
  submitted_at timestamptz default now()
);

-- 8. ASSESSMENTS TABLE
create table if not exists public.assessments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools(id) on delete cascade,
  class_id uuid references public.classes(id) on delete cascade,
  class_code text,
  teacher_id uuid references public.profiles(id) on delete set null,
  title text not null,
  instructions jsonb default '{}'::jsonb,
  total_marks numeric default 50,
  due_at timestamptz,
  status text default 'published' check (status in ('draft', 'published', 'completed')),
  created_at timestamptz default now()
);

-- 9. RESOURCES TABLE
create table if not exists public.resources (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools(id) on delete cascade,
  class_code text,
  teacher_id uuid references public.profiles(id) on delete set null,
  name text not null,
  resource_type text default 'worksheet',
  file_url text,
  created_at timestamptz default now()
);

-- 10. QUIZZES TABLE
create table if not exists public.quizzes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools(id) on delete cascade,
  class_id uuid references public.classes(id) on delete cascade,
  class_code text,
  teacher_id uuid references public.profiles(id) on delete set null,
  title text not null,
  topic text,
  time_limit integer default 15,
  status text default 'published' check (status in ('draft', 'published', 'completed')),
  created_at timestamptz default now()
);

-- 11. FEEDBACK NOTES TABLE
create table if not exists public.feedback_notes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools(id) on delete cascade,
  class_id uuid references public.classes(id) on delete set null,
  class_code text,
  teacher_id uuid references public.profiles(id) on delete set null,
  student_id uuid references public.profiles(id) on delete cascade,
  title text not null,
  body jsonb default '{}'::jsonb,
  status text default 'published',
  created_at timestamptz default now()
);

-- 12. ANNOUNCEMENTS TABLE
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  title text not null,
  body text not null,
  audience text default 'all' check (audience in ('all', 'teachers', 'students')),
  created_at timestamptz default now()
);

-- Enable RLS on all tables
alter table public.schools enable row level security;
alter table public.profiles enable row level security;
alter table public.school_memberships enable row level security;
alter table public.classes enable row level security;
alter table public.enrollments enable row level security;
alter table public.homework_assignments enable row level security;
alter table public.submissions enable row level security;
alter table public.assessments enable row level security;
alter table public.resources enable row level security;
alter table public.quizzes enable row level security;
alter table public.feedback_notes enable row level security;
alter table public.announcements enable row level security;

-- Universal select/insert/update policies for all tables
drop policy if exists "allow all select profiles" on public.profiles;
create policy "allow all select profiles" on public.profiles for select using (true);
drop policy if exists "allow all insert profiles" on public.profiles;
create policy "allow all insert profiles" on public.profiles for insert with check (true);
drop policy if exists "allow all update profiles" on public.profiles;
create policy "allow all update profiles" on public.profiles for update using (true);

drop policy if exists "allow all select classes" on public.classes;
create policy "allow all select classes" on public.classes for select using (true);
drop policy if exists "allow all insert classes" on public.classes;
create policy "allow all insert classes" on public.classes for insert with check (true);
drop policy if exists "allow all update classes" on public.classes;
create policy "allow all update classes" on public.classes for update using (true);

drop policy if exists "allow all select enrollments" on public.enrollments;
create policy "allow all select enrollments" on public.enrollments for select using (true);
drop policy if exists "allow all insert enrollments" on public.enrollments;
create policy "allow all insert enrollments" on public.enrollments for insert with check (true);

drop policy if exists "allow all select homework" on public.homework_assignments;
create policy "allow all select homework" on public.homework_assignments for select using (true);
drop policy if exists "allow all insert homework" on public.homework_assignments;
create policy "allow all insert homework" on public.homework_assignments for insert with check (true);

drop policy if exists "allow all select submissions" on public.submissions;
create policy "allow all select submissions" on public.submissions for select using (true);
drop policy if exists "allow all insert submissions" on public.submissions;
create policy "allow all insert submissions" on public.submissions for insert with check (true);

drop policy if exists "allow all select assessments" on public.assessments;
create policy "allow all select assessments" on public.assessments for select using (true);
drop policy if exists "allow all insert assessments" on public.assessments;
create policy "allow all insert assessments" on public.assessments for insert with check (true);

drop policy if exists "allow all select resources" on public.resources;
create policy "allow all select resources" on public.resources for select using (true);
drop policy if exists "allow all insert resources" on public.resources;
create policy "allow all insert resources" on public.resources for insert with check (true);

drop policy if exists "allow all select quizzes" on public.quizzes;
create policy "allow all select quizzes" on public.quizzes for select using (true);
drop policy if exists "allow all insert quizzes" on public.quizzes;
create policy "allow all insert quizzes" on public.quizzes for insert with check (true);

drop policy if exists "allow all select feedback" on public.feedback_notes;
create policy "allow all select feedback" on public.feedback_notes for select using (true);
drop policy if exists "allow all insert feedback" on public.feedback_notes;
create policy "allow all insert feedback" on public.feedback_notes for insert with check (true);

drop policy if exists "allow all select announcements" on public.announcements;
create policy "allow all select announcements" on public.announcements for select using (true);
drop policy if exists "allow all insert announcements" on public.announcements;
create policy "allow all insert announcements" on public.announcements for insert with check (true);
