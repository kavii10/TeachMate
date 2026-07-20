-- Compatibility safeguard for existing projects that applied the original
-- schema before the invite-code migration. Teacher onboarding creates its
-- first class immediately, so this flag must always exist.
alter table public.classes
  add column if not exists joining_enabled boolean not null default true;
