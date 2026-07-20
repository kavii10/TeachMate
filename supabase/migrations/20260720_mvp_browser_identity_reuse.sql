-- Keep MVP instant workspaces browser-bound while recording the entered email
-- on the TeachMate profile. The email is a lookup key for the client-side
-- browser session only; authorization remains based on auth.uid() and the
-- active school membership.

alter table public.profiles add column if not exists email text;

update public.profiles
set email = nullif(lower(trim(email)), '')
where email is distinct from nullif(lower(trim(email)), '');

create index if not exists profiles_normalized_email_idx
  on public.profiles (lower(trim(email)))
  where nullif(trim(email), '') is not null;

-- Do not create a profile for a brand-new anonymous Auth user. The bootstrap
-- function below first checks whether this email and role already belong to a
-- browser-bound TeachMate workspace, then creates the profile atomically.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.is_anonymous, false) then
    return new;
  end if;

  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(nullif(left(new.raw_user_meta_data ->> 'full_name', 160), ''), split_part(new.email, '@', 1), 'New user'),
    nullif(lower(trim(new.email)), '')
  )
  on conflict (id) do update
  set full_name = excluded.full_name,
      email = coalesce(excluded.email, public.profiles.email);
  return new;
end;
$$;

drop function if exists public.bootstrap_mvp_workspace(public.user_role, text, text, text);
drop function if exists public.bootstrap_mvp_workspace(public.user_role, text, text, text, text);

create function public.bootstrap_mvp_workspace(
  p_role public.user_role,
  p_full_name text,
  p_email text,
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
  v_existing_user_id uuid;
  v_full_name text := left(trim(coalesce(p_full_name, '')), 160);
  v_email text := lower(trim(coalesce(p_email, '')));
  v_school_name text := left(trim(coalesce(p_school_name, '')), 160);
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.';
  end if;
  if char_length(v_full_name) < 1 then
    raise exception 'A full name is required.';
  end if;
  if char_length(v_email) < 3 or char_length(v_email) > 320 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'A valid email address is required.';
  end if;

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

    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('teachmate:mvp:' || v_email || ':' || p_role::text));
    select profile.id into v_existing_user_id
    from public.profiles profile
    join public.school_memberships membership on membership.user_id = profile.id
    where lower(trim(profile.email)) = v_email
      and membership.status = 'active'
      and membership.role = p_role
      and profile.id <> (select auth.uid())
    order by membership.created_at
    limit 1;

    if v_existing_user_id is not null then
      raise exception 'This email already has a % workspace. Return using the same browser session to continue without creating a duplicate.', p_role;
    end if;

    insert into public.profiles (id, full_name, email)
    values ((select auth.uid()), v_full_name, v_email)
    on conflict (id) do update set full_name = excluded.full_name, email = excluded.email;

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

  -- A role-scoped lock prevents two rapid sign-ins with the same email from
  -- creating two anonymous profiles before either browser can save its session.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('teachmate:mvp:' || v_email || ':' || p_role::text));
  select profile.id into v_existing_user_id
  from public.profiles profile
  join public.school_memberships membership on membership.user_id = profile.id
  where lower(trim(profile.email)) = v_email
    and membership.status = 'active'
    and membership.role = p_role
  order by membership.created_at
  limit 1;

  if v_existing_user_id is not null and v_existing_user_id <> (select auth.uid()) then
    raise exception 'This email already has a % workspace. Return using the same browser session to continue without creating a duplicate.', p_role;
  end if;

  insert into public.profiles (id, full_name, email)
  values ((select auth.uid()), v_full_name, v_email)
  on conflict (id) do update set full_name = excluded.full_name, email = excluded.email;

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

revoke all on function public.bootstrap_mvp_workspace(public.user_role, text, text, text, text) from public, anon;
grant execute on function public.bootstrap_mvp_workspace(public.user_role, text, text, text, text) to authenticated;
