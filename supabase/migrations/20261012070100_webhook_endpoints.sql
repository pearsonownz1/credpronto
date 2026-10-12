-- One outbound webhook endpoint per profile. The signing secret is
-- returned once from PUT /api/me/webhook and is not readable by the
-- customer session. Staff may select the row. Writes use the service role.

create table public.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  url text not null,
  signing_secret text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint webhook_endpoints_user_key unique (user_id),
  constraint webhook_endpoints_url_chk check (url ~ '^https://'),
  constraint webhook_endpoints_secret_chk check (char_length(signing_secret) > 0)
);

comment on table public.webhook_endpoints is
  'HTTPS endpoint and HMAC secret for order.quoted, order.delivered, and order.failed.';

create trigger webhook_endpoints_set_updated_at
  before update on public.webhook_endpoints
  for each row
  execute function private.set_updated_at();

alter table public.webhook_endpoints enable row level security;

create policy staff_select_webhook_endpoints on public.webhook_endpoints
  for select to authenticated
  using ((select private.is_staff()));

revoke all on table public.webhook_endpoints from public, anon;

grant select on table public.webhook_endpoints to authenticated;
grant select, insert, update, delete on table public.webhook_endpoints to service_role;
