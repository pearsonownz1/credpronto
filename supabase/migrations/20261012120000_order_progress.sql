-- Quote progress polled by GET /api/orders/[token].
-- step: uploaded | reading | language | counting | quoting | done
-- pagesRead increases once per extracted page and stays <= pagesTotal.
-- Apply separately. This file is not run by the app.

alter table public.orders
  add column progress jsonb;

update public.orders
set progress = jsonb_build_object(
  'step', case when status = 'draft' then 'uploaded' else 'done' end,
  'pagesRead', 0,
  'pagesTotal', 0
);

alter table public.orders
  alter column progress set not null,
  alter column progress set default '{"step":"uploaded","pagesRead":0,"pagesTotal":0}'::jsonb;

alter table public.orders
  add constraint orders_progress_chk check (
    jsonb_typeof(progress) = 'object'
    and progress->>'step' in ('uploaded', 'reading', 'language', 'counting', 'quoting', 'done')
    and jsonb_typeof(progress->'pagesRead') = 'number'
    and jsonb_typeof(progress->'pagesTotal') = 'number'
    and (progress->>'pagesRead') !~ '\.'
    and (progress->>'pagesTotal') !~ '\.'
    and (progress->>'pagesRead')::integer >= 0
    and (progress->>'pagesTotal')::integer >= 0
    and (progress->>'pagesRead')::integer <= (progress->>'pagesTotal')::integer
  );

comment on column public.orders.progress is
  'Quote pipeline progress: step uploaded|reading|language|counting|quoting|done, plus pagesRead and pagesTotal. pagesRead increases once per extracted page.';
