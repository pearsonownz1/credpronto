-- When an order is paid, and whether staff have already been emailed.
-- Nullable so existing rows stay valid. paid_at is backfilled from payments
-- and, if that is missing, from the paid order event.

alter table public.orders
  add column if not exists paid_at timestamptz,
  add column if not exists staff_alert_sent_at timestamptz,
  add column if not exists staff_urgent_alert_sent_at timestamptz;

comment on column public.orders.paid_at is
  'When the order became paid. Null until checkout settles.';

comment on column public.orders.staff_alert_sent_at is
  'When the first staff alert was sent for a paid order that still needs a person.';

comment on column public.orders.staff_urgent_alert_sent_at is
  'When the one urgent follow-up was sent because the order was still unapproved.';

update public.orders as o
set paid_at = p.paid_at
from (
  select distinct on (order_id) order_id, paid_at
  from public.payments
  where paid_at is not null
    and status in ('paid', 'paid_test', 'refunded')
  order by order_id, paid_at asc
) as p
where o.id = p.order_id
  and o.paid_at is null;

update public.orders as o
set paid_at = e.created_at
from (
  select distinct on (order_id) order_id, created_at
  from public.order_events
  where type = 'paid'
    and order_id is not null
  order by order_id, created_at asc
) as e
where o.id = e.order_id
  and o.paid_at is null
  and o.status in ('paid', 'approved', 'delivered');

create index if not exists orders_paid_staff_alert_idx
  on public.orders (paid_at)
  where staff_urgent_alert_sent_at is null
    and status in ('paid', 'needs_review', 'correction_requested');

-- Auto-release certifies without a staff user. approved_at is still required.
-- A person who clicks approve still sets approved_by.
alter table public.deliveries drop constraint if exists deliveries_approved_chk;

alter table public.deliveries add constraint deliveries_approved_chk check (
  status not in ('approved', 'delivered')
  or approved_at is not null
);

comment on constraint deliveries_approved_chk on public.deliveries is
  'Approved and delivered rows record approved_at. approved_by stays null when the order is auto-released.';
