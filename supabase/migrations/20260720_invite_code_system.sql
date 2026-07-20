-- Invite Code System & Real Data Enforcement Migration
-- Adds joining_enabled flag, flexible human-readable invite code formats, and RPC procedures.

-- 1. Add joining_enabled to classes table
alter table public.classes add column if not exists joining_enabled boolean not null default true;

-- 2. Relax join_code check constraint to support human-readable codes like SCI10-7XK9P or TM-7XK9P
alter table public.classes drop constraint if exists classes_join_code_format;
alter table public.classes add constraint classes_join_code_format check (length(trim(join_code)) >= 4 and length(trim(join_code)) <= 30);

-- 3. Drop existing RPC functions first to prevent 42P13 return type mismatch errors
drop function if exists public.join_class_by_code(text);
drop function if exists public.regenerate_class_invite_code(uuid, text);
drop function if exists public.set_class_joining_enabled(uuid, boolean);

-- 4. Update join_class_by_code RPC function to validate joining_enabled
create or replace function public.join_class_by_code(p_join_code text)
returns table (id uuid, name text, grade text, subject text, join_code text, joining_enabled boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_class public.classes%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.';
  end if;

  select class_record.* into target_class
  from public.classes class_record
  where upper(trim(class_record.join_code)) = upper(trim(p_join_code));

  if not found then
    raise exception 'Class with this Invite Code was not found.';
  end if;

  if target_class.joining_enabled is false then
    raise exception 'This class is currently closed for new students.';
  end if;

  insert into public.enrollments (class_id, student_id)
  values (target_class.id, (select auth.uid()))
  on conflict (class_id, student_id) do nothing;

  return query select target_class.id, target_class.name, target_class.grade, target_class.subject, target_class.join_code, target_class.joining_enabled;
end;
$$;

revoke all on function public.join_class_by_code(text) from public, anon;
grant execute on function public.join_class_by_code(text) to authenticated;

-- 5. RPC function to regenerate a class invite code
create or replace function public.regenerate_class_invite_code(p_class_id uuid, p_new_code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_code text := upper(trim(p_new_code));
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.';
  end if;

  update public.classes
  set join_code = clean_code,
      updated_at = now()
  where id = p_class_id;

  return clean_code;
end;
$$;

revoke all on function public.regenerate_class_invite_code(uuid, text) from public, anon;
grant execute on function public.regenerate_class_invite_code(uuid, text) to authenticated;

-- 6. RPC function to toggle joining_enabled
create or replace function public.set_class_joining_enabled(p_class_id uuid, p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.';
  end if;

  update public.classes
  set joining_enabled = p_enabled,
      updated_at = now()
  where id = p_class_id;

  return p_enabled;
end;
$$;

revoke all on function public.set_class_joining_enabled(uuid, boolean) from public, anon;
grant execute on function public.set_class_joining_enabled(uuid, boolean) to authenticated;
