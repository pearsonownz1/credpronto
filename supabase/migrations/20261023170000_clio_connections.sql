-- Clio Manage OAuth for translation orders.
-- Access and refresh tokens are ciphertext. The raw token is not stored.
-- Row level security is on. Only the service role can read or write.

create table public.clio_oauth_states (
  state text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  region text not null,
  redirect_uri text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint clio_oauth_states_region_chk check (region in ('us', 'eu', 'ca', 'au')),
  constraint clio_oauth_states_state_chk check (char_length(state) between 43 and 128),
  constraint clio_oauth_states_redirect_chk check (char_length(redirect_uri) between 1 and 500)
);

comment on table public.clio_oauth_states is
  'One-time OAuth state tied to a CredPronto user. Deleted when the callback is read.';

create table public.clio_connections (
  user_id uuid primary key references auth.users (id) on delete cascade,
  region text not null,
  clio_user_id text not null,
  clio_account_id text,
  access_token text not null,
  refresh_token text not null,
  access_expires_at timestamptz not null,
  custom_action_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clio_connections_region_chk check (region in ('us', 'eu', 'ca', 'au')),
  constraint clio_connections_clio_user_chk check (char_length(clio_user_id) between 1 and 40),
  constraint clio_connections_access_chk check (char_length(access_token) > 0),
  constraint clio_connections_refresh_chk check (char_length(refresh_token) > 0),
  constraint clio_connections_region_user_key unique (region, clio_user_id)
);

comment on table public.clio_connections is
  'Clio Manage OAuth for one CredPronto user. Tokens are encrypted. Service role only.';

comment on column public.clio_connections.access_token is
  'Encrypted Clio access token. Not the raw token.';

comment on column public.clio_connections.refresh_token is
  'Encrypted Clio refresh token. Not the raw token.';

comment on column public.clio_connections.region is
  'Clio Manage region: us, eu, ca, or au. New regions are additional check values.';

create index clio_connections_clio_user_idx on public.clio_connections (clio_user_id);

create trigger clio_connections_set_updated_at
  before update on public.clio_connections
  for each row
  execute function private.set_updated_at();

create table public.clio_translation_handoffs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  region text not null,
  matter_id text not null,
  documents jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint clio_translation_handoffs_region_chk check (region in ('us', 'eu', 'ca', 'au')),
  constraint clio_translation_handoffs_matter_chk check (matter_id ~ '^[0-9]{1,15}$')
);

comment on table public.clio_translation_handoffs is
  'Short-lived list of matter documents the user can send into a translation order.';

create table public.clio_matter_orders (
  order_id uuid primary key references public.orders (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  region text not null,
  matter_id text not null,
  document_ids text[] not null default '{}',
  upload_status text not null default 'pending',
  upload_error text,
  clio_document_id text,
  uploaded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clio_matter_orders_region_chk check (region in ('us', 'eu', 'ca', 'au')),
  constraint clio_matter_orders_matter_chk check (matter_id ~ '^[0-9]{1,15}$'),
  constraint clio_matter_orders_upload_status_chk check (upload_status in ('pending', 'uploaded', 'failed')),
  constraint clio_matter_orders_error_chk check (upload_error is null or char_length(upload_error) <= 300)
);

comment on table public.clio_matter_orders is
  'Links a translation order to the Clio matter it came from, and tracks the certified PDF upload.';

create index clio_matter_orders_user_idx on public.clio_matter_orders (user_id, created_at desc);

create trigger clio_matter_orders_set_updated_at
  before update on public.clio_matter_orders
  for each row
  execute function private.set_updated_at();

alter table public.clio_oauth_states enable row level security;
alter table public.clio_connections enable row level security;
alter table public.clio_translation_handoffs enable row level security;
alter table public.clio_matter_orders enable row level security;

revoke all on table public.clio_oauth_states from public, anon, authenticated;
revoke all on table public.clio_connections from public, anon, authenticated;
revoke all on table public.clio_translation_handoffs from public, anon, authenticated;
revoke all on table public.clio_matter_orders from public, anon, authenticated;

grant select, insert, update, delete on table public.clio_oauth_states to service_role;
grant select, insert, update, delete on table public.clio_connections to service_role;
grant select, insert, update, delete on table public.clio_translation_handoffs to service_role;
grant select, insert, update, delete on table public.clio_matter_orders to service_role;
