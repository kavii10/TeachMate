-- A private, publishable audio message from a teacher to one enrolled student.
-- This is intentionally separate from AI/transcription drafts: the recording
-- is stored and delivered as audio without being interpreted or transformed.
create table if not exists public.voice_feedback_messages (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  assessment_id uuid references public.assessments(id) on delete set null,
  student_id uuid not null references public.profiles(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete restrict,
  title text not null check (char_length(title) between 1 and 180),
  audio_path text not null unique,
  status public.draft_status not null default 'draft',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  constraint voice_feedback_message_published_check check (status <> 'published' or published_at is not null)
);

create index if not exists voice_feedback_messages_student_published_idx
  on public.voice_feedback_messages (student_id, status, published_at desc);
create index if not exists voice_feedback_messages_teacher_created_idx
  on public.voice_feedback_messages (teacher_id, created_at desc);

alter table public.voice_feedback_messages enable row level security;
grant select, insert, update, delete on public.voice_feedback_messages to authenticated;

drop policy if exists "students read their published voice feedback" on public.voice_feedback_messages;
create policy "students read their published voice feedback"
  on public.voice_feedback_messages for select to authenticated
  using (
    student_id = (select auth.uid())
    and status = 'published'
    and school_id = private.current_school_id()
    and private.is_enrolled(class_id)
  );

drop policy if exists "class owners manage voice feedback" on public.voice_feedback_messages;
create policy "class owners manage voice feedback"
  on public.voice_feedback_messages for all to authenticated
  using (private.can_manage_class(class_id))
  with check (
    school_id = private.current_school_id()
    and private.can_manage_class(class_id)
    and (private.is_admin() or teacher_id = (select auth.uid()))
  );

-- Audio stays private. A student can only read an object referenced by their
-- own published voice-feedback message. Class owners can upload and manage
-- recordings for only the classes they manage.
drop policy if exists "teachers view school recordings" on storage.objects;
drop policy if exists "class owners play voice feedback" on storage.objects;
create policy "class owners play voice feedback"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'voice-feedback'
    and exists (
      select 1
      from public.voice_feedback_messages feedback
      where feedback.audio_path = name
        and private.can_manage_class(feedback.class_id)
    )
  );

drop policy if exists "class owners upload voice feedback" on storage.objects;
create policy "class owners upload voice feedback"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'voice-feedback'
    and split_part(name, '/', 1) = private.current_school_id()::text
    and split_part(name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and private.can_manage_class(split_part(name, '/', 2)::uuid)
  );

drop policy if exists "class owners delete voice feedback" on storage.objects;
create policy "class owners delete voice feedback"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'voice-feedback'
    and split_part(name, '/', 1) = private.current_school_id()::text
    and split_part(name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and private.can_manage_class(split_part(name, '/', 2)::uuid)
  );

drop policy if exists "students play their published voice feedback" on storage.objects;
create policy "students play their published voice feedback"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'voice-feedback'
    and exists (
      select 1
      from public.voice_feedback_messages feedback
      where feedback.audio_path = name
        and feedback.student_id = (select auth.uid())
        and feedback.status = 'published'
    )
  );
