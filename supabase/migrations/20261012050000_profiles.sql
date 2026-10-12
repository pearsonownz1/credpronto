-- Customer and staff accounts.
--
-- public.profiles is created for every auth.users row. is_admin defaults to
-- false. private.is_staff() stays true for public.staff and is also true when
-- the signed-in user's profile has is_admin. Reviewers remain staff rows;
-- promoting a profile does not require a second insert for the RLS gate.
--
-- The first admin is still a service-role update (SQL editor or a seed):
--   update public.profiles set is_admin = true where id = '<user uuid>';
-- A non-staff session cannot update is_admin because there is no self-update policy.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'One row per auth user. is_admin is the account flag that private.is_staff() honors.';

comment on column public.profiles.is_admin is
  'When true, private.is_staff() is true for this user. Defaults to false.';

insert into public.profiles (id)
select id
from auth.users
on conflict (id) do nothing;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

comment on function private.handle_new_user() is
  'Inserts public.profiles when auth.users gains a row. security definer so the auth trigger can write profiles.';

revoke all on function private.handle_new_user() from public;
grant usage on schema private to supabase_auth_admin;
grant execute on function private.handle_new_user() to supabase_auth_admin, service_role;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function private.handle_new_user();

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function private.set_updated_at();

create or replace function private.is_staff()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return exists (
    select 1
    from public.staff
    where user_id = (select auth.uid())
  )
  or exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and is_admin
  );
end;
$$;

comment on function private.is_staff() is
  'True when auth.uid() is in public.staff or public.profiles.is_admin is true. security definer so policies can read those tables without recursing.';

revoke all on function private.is_staff() from public;
grant execute on function private.is_staff() to authenticated;

alter table public.profiles enable row level security;

create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy staff_all on public.profiles
  for all to authenticated
  using ((select private.is_staff()))
  with check ((select private.is_staff()));

revoke all on table public.profiles from public, anon;

grant select, insert, update, delete on table public.profiles to authenticated, service_role;
