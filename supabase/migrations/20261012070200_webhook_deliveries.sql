-- One row per outbound webhook delivery. attempt is 1, 2, or 3.
-- status stays pending until the next retry time, then succeeded or failed.
-- Staff select. Writes use the service role.

create table public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  endpoint_id uuid not null references public.webhook_endpoints (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  event text not null,
  attempt integer not null,
  status text not null,
  response_status integer,
  next_retry_at timestamptz,
  created_at timestamptz not null default now(),
  constraint webhook_deliveries_event_chk check (
    event in ('order.quoted', 'order.delivered', 'order.failed')
  ),
  constraint webhook_deliveries_attempt_chk check (attempt between 1 and 3),
  constraint webhook_deliveries_status_chk check (
    status in ('pending', 'succeeded', 'failed')
  )
);

comment on table public.webhook_deliveries is
  'Delivery log for outbound order webhooks. A failed attempt retries at next_retry_at.';

create index webhook_deliveries_due_idx
  on public.webhook_deliveries (next_retry_at)
  where status = 'pending';

create index webhook_deliveries_order_id_idx on public.webhook_deliveries (order_id);

alter table public.webhook_deliveries enable row level security;

create policy staff_select_webhook_deliveries on public.webhook_deliveries
  for select to authenticated
  using ((select private.is_staff()));

revoke all on table public.webhook_deliveries from public, anon;

grant select on table public.webhook_deliveries to authenticated;
grant select, insert, update, delete on table public.webhook_deliveries to service_role;
