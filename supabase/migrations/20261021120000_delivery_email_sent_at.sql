-- One customer download email per order. Null until that send is claimed.

alter table public.orders
  add column if not exists delivery_email_sent_at timestamptz;

comment on column public.orders.delivery_email_sent_at is
  'When the receipt and download email was claimed. A failed send clears it so it can be tried once more.';
