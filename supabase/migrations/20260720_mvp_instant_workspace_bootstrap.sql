-- MVP instant onboarding: an authenticated browser session becomes a
-- TeachMate profile and membership in one transaction. Teachers and school
-- administrators choose a school name; students join through a class code.
-- This deliberately favors low-friction MVP onboarding over invite workflows.

-- This migration may be re-run from the SQL editor after an interrupted
-- attempt. Remove both historical signatures before installing the current
-- four-argument version.
drop function if exists public.bootstrap_mvp_workspace(public.user_role, text, text);
drop function if exists public.bootstrap_mvp_workspace(public.user_role, text, text, text);

create function public.bootstrap_mvp_workspace(
  p_role public.user_role,
  p_full_name text,
  p_school_name text default null,
  p_join_code text default null
)
returns table (school_id uuid, role public.user_role, class_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_school_id uuid;
  v_class_id uuid;
  v_existing_role public.user_role;
  v_full_name text := left(trim(coalesce(p_full_name, '')), 160);
  v_school_name text := left(trim(coalesce(p_school_name, '')), 160);
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.';
  end if;

  -- The auth trigger normally makes this row. Keeping it here makes the
  -- instant anonymous MVP flow reliable even if the trigger has not run yet.
  if char_length(v_full_name) < 1 then
    raise exception 'A full name is required.';
  end if;

  insert into public.profiles (id, full_name)
  values ((select auth.uid()), v_full_name)
  on conflict (id) do update set full_name = excluded.full_name;

  select membership.school_id, membership.role
  into v_school_id, v_existing_role
  from public.school_memberships membership
  where membership.user_id = (select auth.uid())
    and membership.status = 'active'
  limit 1;

  if v_school_id is not null then
    if v_existing_role <> p_role then
      raise exception 'This browser session is already set up as %. Sign out before starting a different role.', v_existing_role;
    end if;
    if p_role = 'student'::public.user_role and nullif(trim(coalesce(p_join_code, '')), '') is not null then
      select class_record.id into v_class_id
      from public.classes class_record
      where upper(trim(class_record.join_code)) = upper(trim(p_join_code));
      if v_class_id is not null then
        insert into public.enrollments (class_id, student_id)
        values (v_class_id, (select auth.uid()))
        on conflict on constraint enrollments_pkey do nothing;
      end if;
    end if;
    return query select v_school_id, v_existing_role, v_class_id;
    return;
  end if;

  if p_role = 'student'::public.user_role then
    select class_record.school_id, class_record.id
    into v_school_id, v_class_id
    from public.classes class_record
    where upper(trim(class_record.join_code)) = upper(trim(coalesce(p_join_code, '')));
    if v_school_id is null then
      raise exception 'Class ID was not found.';
    end if;
  else
    if char_length(v_school_name) < 2 then
      raise exception 'A school name is required.';
    end if;
    -- Keep simultaneous MVP sign-ins for the same school name in one school
    -- row even though school names are intentionally not made globally unique.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(lower(v_school_name)));
    select school.id into v_school_id
    from public.schools school
    where lower(trim(school.name)) = lower(v_school_name)
    order by school.created_at
    limit 1;
    if v_school_id is null then
      insert into public.schools (name) values (v_school_name) returning id into v_school_id;
    end if;
  end if;

  insert into public.school_memberships (school_id, user_id, role, status)
  values (v_school_id, (select auth.uid()), p_role, 'active');

  if p_role = 'student'::public.user_role then
    insert into public.enrollments (class_id, student_id)
    values (v_class_id, (select auth.uid()))
    on conflict on constraint enrollments_pkey do nothing;
  end if;

  return query select v_school_id, p_role, v_class_id;
end;
$$;

revoke all on function public.bootstrap_mvp_workspace(public.user_role, text, text, text) from public, anon;
grant execute on function public.bootstrap_mvp_workspace(public.user_role, text, text, text) to authenticated;
