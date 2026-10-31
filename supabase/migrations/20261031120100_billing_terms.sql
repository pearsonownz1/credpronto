-- card charges the saved PaymentMethod. net adds the order to an open Stripe invoice.

alter table public.billing_customers
  add column terms text not null default 'card';

alter table public.billing_customers
  add constraint billing_customers_terms_chk check (terms in ('card', 'net'));

alter table public.billing_customers
  add column open_invoice_id text;

comment on column public.billing_customers.terms is
  'card charges the saved PaymentMethod. net adds the order to the open Stripe invoice.';

comment on column public.billing_customers.open_invoice_id is
  'Draft Stripe invoice that the next net-terms order is added to.';
