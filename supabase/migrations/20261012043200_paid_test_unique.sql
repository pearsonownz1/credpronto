-- One settled payment per order, whether Stripe (paid) or the placeholder (paid_test).

drop index if exists public.payments_one_paid_per_order_idx;

create unique index payments_one_settled_per_order_idx
  on public.payments (order_id)
  where status in ('paid', 'paid_test');

alter table public.payments drop constraint payments_paid_at_chk;

alter table public.payments add constraint payments_paid_at_chk check (
  status not in ('paid', 'paid_test', 'refunded') or paid_at is not null
);
