-- Let a translation job store step 'translating' and an integer retries count
-- on the existing orders.progress jsonb. No new column.
-- Apply separately. This file is not run by the app.

alter table public.orders drop constraint orders_progress_chk;

alter table public.orders
  add constraint orders_progress_chk check (
    jsonb_typeof(progress) = 'object'
    and progress->>'step' in (
      'uploaded',
      'reading',
      'language',
      'counting',
      'quoting',
      'done',
      'translating'
    )
    and jsonb_typeof(progress->'pagesRead') = 'number'
    and jsonb_typeof(progress->'pagesTotal') = 'number'
    and (progress->>'pagesRead') !~ '\.'
    and (progress->>'pagesTotal') !~ '\.'
    and (progress->>'pagesRead')::integer >= 0
    and (progress->>'pagesTotal')::integer >= 0
    and (progress->>'pagesRead')::integer <= (progress->>'pagesTotal')::integer
    and (
      progress->'retries' is null
      or (
        jsonb_typeof(progress->'retries') = 'number'
        and (progress->>'retries') !~ '\.'
        and (progress->>'retries')::integer >= 0
      )
    )
  );

comment on column public.orders.progress is
  'Quote and translation progress. step is uploaded|reading|language|counting|quoting|done|translating. pagesRead and pagesTotal are integers and pagesRead stays <= pagesTotal. retries is an optional non-negative integer used by the translation watchdog.';
