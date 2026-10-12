-- Which API key placed the order. Dashboard orders leave this null.
-- Deleting the key clears the pointer. The key row stays when it is only revoked.

alter table public.orders
  add column api_key_id uuid references public.api_keys (id) on delete set null;

comment on column public.orders.api_key_id is
  'API key that placed the order. Null for dashboard orders.';

create index orders_api_key_id_idx
  on public.orders (user_id, created_at desc)
  where api_key_id is not null;
