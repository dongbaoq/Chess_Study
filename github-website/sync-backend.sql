-- Run once in the Supabase SQL Editor as the project database owner.
-- This stores one private full-library snapshot per authenticated account.
begin;

create schema if not exists notebook_private;
revoke all on schema notebook_private from public, anon, authenticated, service_role;

create table if not exists notebook_private.studies (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null check (revision > 0),
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table notebook_private.studies enable row level security;
revoke all on table notebook_private.studies from public, anon, authenticated, service_role;

-- SECURITY DEFINER is needed because the API roles have no table access.
-- The caller's identity is derived only from its validated authentication token.
create or replace function public.notebook_read()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  result jsonb;
begin
  if caller is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select pg_catalog.jsonb_build_object('revision', s.revision, 'data', s.data)
    into result
    from notebook_private.studies as s
    where s.user_id = caller;
  if not found then
    return pg_catalog.jsonb_build_object('revision', 0, 'data', null);
  end if;
  return result;
end;
$$;

-- Insert-if-empty or update-if-revision-matches is a single atomic write.
-- A stale writer gets a conflict and cannot overwrite the current snapshot.
create or replace function public.notebook_write(expected_revision bigint, snapshot jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  new_revision bigint;
begin
  if caller is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if expected_revision is null or expected_revision < 0
     or snapshot is null or pg_catalog.jsonb_typeof(snapshot) <> 'object' then
    raise exception 'Invalid revision or snapshot' using errcode = '22023';
  end if;
  if expected_revision = 0 then
    insert into notebook_private.studies (user_id, revision, data)
      values (caller, 1, snapshot)
      on conflict (user_id) do nothing
      returning revision into new_revision;
  else
    update notebook_private.studies as s
      set revision = s.revision + 1, data = snapshot, updated_at = pg_catalog.now()
      where s.user_id = caller and s.revision = expected_revision
      returning s.revision into new_revision;
  end if;
  if new_revision is null then
    return pg_catalog.jsonb_build_object('conflict', true);
  end if;
  return pg_catalog.jsonb_build_object('revision', new_revision);
end;
$$;

-- Supabase may grant execute to API roles by default, so explicitly remove it.
revoke all on function public.notebook_read() from public, anon, authenticated, service_role;
revoke all on function public.notebook_write(bigint, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.notebook_read() to authenticated;
grant execute on function public.notebook_write(bigint, jsonb) to authenticated;
commit;
