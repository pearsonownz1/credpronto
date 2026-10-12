-- Checkout add-ons and the US shipping address for mail.
-- addon ids are text checks, not a new enum.
-- Apply separately. This file is not run by the app.

alter table public.orders
  add column addon_cents integer not null default 0,
  add column expedited boolean not null default false,
  add column shipping_name text,
  add column shipping_line1 text,
  add column shipping_line2 text,
  add column shipping_city text,
  add column shipping_state text,
  add column shipping_postal_code text,
  add column shipping_country text,
  add column mail_status text,
  add column mail_tracking text,
  add column notarization_status text;

alter table public.orders
  add constraint orders_addon_cents_chk check (addon_cents >= 0),
  add constraint orders_mail_status_chk check (mail_status is null or mail_status in ('pending', 'shipped')),
  add constraint orders_notarization_status_chk check (
    notarization_status is null or notarization_status in ('pending', 'done')
  ),
  add constraint orders_shipping_address_chk check (
    (
      shipping_name is null
      and shipping_line1 is null
      and shipping_line2 is null
      and shipping_city is null
      and shipping_state is null
      and shipping_postal_code is null
      and shipping_country is null
    )
    or (
      char_length(btrim(shipping_name)) between 1 and 120
      and char_length(btrim(shipping_line1)) between 1 and 200
      and (shipping_line2 is null or char_length(btrim(shipping_line2)) between 1 and 200)
      and char_length(btrim(shipping_city)) between 1 and 120
      and shipping_state ~ '^[A-Z]{2}$'
      and shipping_postal_code ~ '^[0-9]{5}(-[0-9]{4})?$'
      and shipping_country = 'US'
    )
  );

alter table public.orders drop constraint orders_total_matches_pages_chk;
alter table public.orders drop constraint orders_evaluation_price_chk;

alter table public.orders
  add constraint orders_total_matches_pages_chk
    check (
      total_cents is null
      or billable_pages is null
      or service is not null
      or total_cents = billable_pages * unit_price_cents + addon_cents
    ),
  add constraint orders_evaluation_price_chk
    check (
      service is null
      or total_cents is null
      or (
        evaluation_cents is not null
        and translation_cents is not null
        and degree_count is not null
        and total_cents = evaluation_cents + translation_cents + addon_cents
        and evaluation_cents = degree_count * case service
          when 'diploma' then 1995
          when 'course_by_course' then 3995
          else null
        end
        and (
          translation_cents = 0
          or (
            billable_pages is not null
            and translation_cents = billable_pages * unit_price_cents
          )
        )
      )
    );

comment on column public.orders.addon_cents is
  'Sum of selected checkout add-ons, in cents. Included in total_cents.';

comment on column public.orders.expedited is
  'True when the expedited add-on was purchased. Staff review lists these first.';

create table public.order_addons (
  order_id uuid not null references public.orders (id) on delete cascade,
  addon_id text not null,
  unit_cents integer not null,
  quantity integer not null,
  total_cents integer not null,
  created_at timestamptz not null default now(),
  primary key (order_id, addon_id),
  constraint order_addons_id_chk check (addon_id in ('notarization', 'mail', 'expedited')),
  constraint order_addons_unit_chk check (unit_cents > 0),
  constraint order_addons_quantity_chk check (quantity > 0),
  constraint order_addons_total_chk check (total_cents = unit_cents * quantity)
);

comment on table public.order_addons is
  'Selected checkout add-ons. One row per add-on. Prices are the cents charged on that order.';

alter table public.order_addons enable row level security;

create policy staff_all on public.order_addons
  for all to authenticated
  using ((select private.is_staff()))
  with check ((select private.is_staff()));

create policy customer_select_own_order_addons on public.order_addons
  for select to authenticated
  using ((select private.owns_order(order_id)));

revoke all on table public.order_addons from public, anon;

grant select, insert, update, delete on table public.order_addons to authenticated, service_role;
