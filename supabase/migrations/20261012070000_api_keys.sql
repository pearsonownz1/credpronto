-- API keys for the public order API. The raw key is shown once.
-- Only the sha256 hex hash is stored. Customers select their own rows.
-- Staff select every row. Inserts and revokes use the service role.

create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  prefix text not null,
  key_hash text not null,
  last4 text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint api_keys_name_chk check (char_length(name) between 1 and 80),
  constraint api_keys_prefix_chk check (prefix in ('cp_live_', 'cp_test_')),
  constraint api_keys_key_hash_key unique (key_hash),
  constraint api_keys_key_hash_chk check (key_hash ~ '^[0-9a-f]{64}$'),
  constraint api_keys_last4_chk check (char_length(last4) = 4)
);

comment on table public.api_keys is
  'Hashed cp_live_ and cp_test_ keys. The raw secret is not stored.';

comment on column public.api_keys.key_hash is
  'Lowercase hex SHA-256 of the full key string.';

create index api_keys_user_id_idx on public.api_keys (user_id, created_at desc);

alter table public.api_keys enable row level security;

create policy customer_select_own_api_keys on public.api_keys
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy staff_select_api_keys on public.api_keys
  for select to authenticated
  using ((select private.is_staff()));

revoke all on table public.api_keys from public, anon;

grant select on table public.api_keys to authenticated;
grant select, insert, update, delete on table public.api_keys to service_role;
