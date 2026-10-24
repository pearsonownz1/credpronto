-- A paid translation total includes add-on cents.
-- orders_total_matches_pages_chk already adds addon_cents. This check did not,
-- so notarization or mailing made total_cents fail when status moved to paid.
-- Apply separately. This file is not run by the app.

alter table public.orders drop constraint orders_translation_priced_when_paid_chk;

alter table public.orders
  add constraint orders_translation_priced_when_paid_chk check (
    service_type <> 'translation'
    or status not in ('paid', 'approved', 'delivered')
    or (
      language_confirmed
      and billable_pages is not null
      and billable_pages > 0
      and total_cents = billable_pages * unit_price_cents + addon_cents
    )
  );
