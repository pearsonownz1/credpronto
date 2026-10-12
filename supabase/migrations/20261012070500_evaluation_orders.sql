-- Credential evaluation fields. Apply separately. This file is not run by the app.
-- order_type is text, not an enum, so this file does not add an enum value.

alter table public.orders
  add column order_type text not null default 'translation',
  add column service text,
  add column degree_count integer,
  add column evaluation_cents integer,
  add column translation_cents integer,
  add column evaluation_result jsonb;

update public.orders
set order_type = service_type::text
where service_type::text in ('translation', 'evaluation', 'expert_letter');

alter table public.orders
  add constraint orders_order_type_chk
    check (order_type in ('translation', 'evaluation', 'expert_letter')),
  add constraint orders_service_chk
    check (service is null or service in ('diploma', 'course_by_course')),
  add constraint orders_degree_count_chk
    check (degree_count is null or degree_count >= 1),
  add constraint orders_evaluation_choice_chk
    check (
      (service is null and degree_count is null)
      or (service is not null and degree_count is not null)
    ),
  add constraint orders_evaluation_cents_chk
    check (evaluation_cents is null or evaluation_cents >= 0),
  add constraint orders_translation_cents_chk
    check (translation_cents is null or translation_cents >= 0);

alter table public.orders drop constraint orders_total_matches_pages_chk;

alter table public.orders
  add constraint orders_total_matches_pages_chk
    check (
      total_cents is null
      or billable_pages is null
      or service is not null
      or total_cents = billable_pages * unit_price_cents
    );

alter table public.orders
  add constraint orders_evaluation_price_chk
    check (
      service is null
      or total_cents is null
      or (
        evaluation_cents is not null
        and translation_cents is not null
        and degree_count is not null
        and total_cents = evaluation_cents + translation_cents
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

comment on column public.orders.order_type is
  'translation, evaluation, or expert_letter. Defaults to translation. Customer evaluations also set service.';

comment on column public.orders.service is
  'diploma or course_by_course when the customer ordered an evaluation. Null for a translation.';

comment on column public.orders.degree_count is
  'Degrees priced on an evaluation. Null for a translation.';

comment on column public.orders.evaluation_cents is
  'Evaluation fee in cents: degree_count times 1995 (diploma) or 3995 (course_by_course).';

comment on column public.orders.translation_cents is
  'Bundled translation fee in cents. 0 when the source is English. Otherwise billable_pages times unit_price_cents.';

comment on column public.orders.evaluation_result is
  'Diploma credentials or the course-by-course table, totals, GPA, and grade scale.';
