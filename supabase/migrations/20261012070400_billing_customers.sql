-- One Stripe Customer per profile. Card numbers are not stored.
-- payment_method_id, brand, and last4 are filled when a SetupIntent succeeds
-- and cleared when the customer removes the card. The Stripe Customer id stays.

create table public.billing_customers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id text not null,
  payment_method_id text,
  brand text,
  last4 text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_customers_stripe_customer_key unique (stripe_customer_id),
  constraint billing_customers_stripe_customer_chk check (char_length(stripe_customer_id) > 0),
  constraint billing_customers_last4_chk check (last4 is null or char_length(last4) = 4)
);

comment on table public.billing_customers is
  'Stripe Customer for off-session charges. No card number is stored.';

create trigger billing_customers_set_updated_at
  before update on public.billing_customers
  for each row
  execute function private.set_updated_at();

alter table public.billing_customers enable row level security;

create policy customer_select_own_billing on public.billing_customers
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy staff_select_billing_customers on public.billing_customers
  for select to authenticated
  using ((select private.is_staff()));

revoke all on table public.billing_customers from public, anon;

grant select on table public.billing_customers to authenticated;
grant select, insert, update, delete on table public.billing_customers to service_role;
