-- Selected upload services. Apply separately. This file is not run by the app.
-- Existing rows stay null. The app derives them from service and include_translation.
-- Do not backfill.

alter table public.orders
  add column if not exists services text[],
  add column if not exists service_files jsonb,
  add column if not exists evaluation_results jsonb;

alter table public.orders
  add constraint orders_services_chk check (
    services is null
    or (
      cardinality(services) between 1 and 3
      and services <@ array['translation','diploma','course_by_course']::text[]
      and (cardinality(services) < 2 or services[1] is distinct from services[2])
      and (cardinality(services) < 3 or (services[1] is distinct from services[3] and services[2] is distinct from services[3]))
    )
  );

alter table public.orders
  add constraint orders_service_files_chk check (
    service_files is null or jsonb_typeof(service_files) = 'object'
  ),
  add constraint orders_evaluation_results_chk check (
    evaluation_results is null or jsonb_typeof(evaluation_results) = 'array'
  );

comment on column public.orders.services is
  'Upload services on this order: translation, diploma, course_by_course. Null on older rows.';

comment on column public.orders.service_files is
  'Staff PDF path for each evaluation when more than one evaluation was ordered.';

comment on column public.orders.evaluation_results is
  'One evaluation result per selected evaluation.';

-- Replace price, choice, and page checks so a row with both evaluations can be stored.
-- services IS NULL keeps the previous formula so existing rows still pass.

alter table public.orders drop constraint orders_evaluation_choice_chk;
alter table public.orders drop constraint orders_evaluation_price_chk;
alter table public.orders drop constraint orders_total_matches_pages_chk;

alter table public.orders
  add constraint orders_evaluation_choice_chk check (
    (
      services is null
      and (
        (service is null and degree_count is null)
        or (service is not null and degree_count is not null)
      )
    )
    or (
      services is not null
      and (
        (
          not (services && array['diploma','course_by_course']::text[])
          and service is null
          and degree_count is null
        )
        or (
          services && array['diploma','course_by_course']::text[]
          and degree_count is not null
          and degree_count >= 1
          and (
            (service = 'diploma' and not ('course_by_course' = any(services)))
            or (service = 'course_by_course' and not ('diploma' = any(services)))
            or (
              service is null
              and 'diploma' = any(services)
              and 'course_by_course' = any(services)
            )
          )
        )
      )
    )
  ),
  add constraint orders_evaluation_price_chk check (
    (
      services is null
      and (
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
      )
    )
    or (
      services is not null
      and (
        total_cents is null
        or (
          not (services && array['diploma','course_by_course']::text[])
          and service is null
          and degree_count is null
        )
        or (
          services && array['diploma','course_by_course']::text[]
          and degree_count is not null
          and evaluation_cents is not null
          and translation_cents is not null
          and total_cents = evaluation_cents + translation_cents + addon_cents
          and evaluation_cents = degree_count * (
            (case when 'diploma' = any(services) then 1995 else 0 end)
            + (case when 'course_by_course' = any(services) then 3995 else 0 end)
          )
          and (
            translation_cents = 0
            or (
              'translation' = any(services)
              and include_translation = true
              and billable_pages is not null
              and translation_cents = billable_pages * unit_price_cents
            )
          )
          and (
            (service = 'diploma' and not ('course_by_course' = any(services)))
            or (service = 'course_by_course' and not ('diploma' = any(services)))
            or (
              service is null
              and 'diploma' = any(services)
              and 'course_by_course' = any(services)
            )
          )
        )
      )
    )
  ),
  add constraint orders_total_matches_pages_chk check (
    total_cents is null
    or billable_pages is null
    or service is not null
    or (services is not null and services && array['diploma','course_by_course']::text[])
    or total_cents = billable_pages * unit_price_cents + addon_cents
  );
