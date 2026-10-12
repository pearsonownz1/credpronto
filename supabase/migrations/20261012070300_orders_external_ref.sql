-- Partner reference stored on the order. Unique for one user when both are set,
-- so POST /api/v1/orders can return the existing order for a repeated external_ref.

alter table public.orders
  add column external_ref text;

comment on column public.orders.external_ref is
  'Caller reference from the public API. Unique per user_id when both are set.';

alter table public.orders
  add constraint orders_external_ref_chk check (
    external_ref is null or char_length(external_ref) between 1 and 200
  );

create unique index orders_user_external_ref_key
  on public.orders (user_id, external_ref)
  where user_id is not null and external_ref is not null;
