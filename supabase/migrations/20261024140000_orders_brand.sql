-- Free GEO Credential Services orders. CredPronto rows stay on the default.
alter table public.orders
  add column if not exists brand text not null default 'credpronto';

alter table public.orders
  drop constraint if exists orders_brand_check;

alter table public.orders
  add constraint orders_brand_check check (brand in ('credpronto', 'gcs'));
