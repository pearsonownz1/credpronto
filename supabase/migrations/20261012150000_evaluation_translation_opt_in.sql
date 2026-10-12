-- Certified translation on an evaluation is opt-in. Apply separately. This file is not run by the app.
-- Existing priced translations keep the line so the new check matches rows already charged.

alter table public.orders
  add column include_translation boolean not null default false;

update public.orders
set include_translation = true
where coalesce(translation_cents, 0) > 0;

alter table public.orders drop constraint orders_evaluation_price_chk;

alter table public.orders
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
            include_translation = true
            and billable_pages is not null
            and translation_cents = billable_pages * unit_price_cents
          )
        )
      )
    );

comment on column public.orders.include_translation is
  'True when the customer opted into certified translation on an evaluation. The translation line is omitted unless this is true.';

comment on column public.orders.translation_cents is
  'Certified translation fee in cents. 0 unless include_translation is true, in which case it is billable_pages times unit_price_cents.';
