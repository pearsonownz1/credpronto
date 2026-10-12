-- Per-page translation progress on the existing orders.progress jsonb.
-- pagesRead and pagesTotal stay the OCR counts.
-- pagesDone and pagesTranslateTotal are optional non-negative integers.
-- pagesDone stays <= pagesTranslateTotal when both are present.
-- translation_runs and translation_page_jobs coordinate one invocation per billable page.
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
    and (
      progress->'pagesDone' is null
      or (
        jsonb_typeof(progress->'pagesDone') = 'number'
        and (progress->>'pagesDone') !~ '\.'
        and (progress->>'pagesDone')::integer >= 0
      )
    )
    and (
      progress->'pagesTranslateTotal' is null
      or (
        jsonb_typeof(progress->'pagesTranslateTotal') = 'number'
        and (progress->>'pagesTranslateTotal') !~ '\.'
        and (progress->>'pagesTranslateTotal')::integer >= 0
      )
    )
    and (
      progress->'pagesDone' is null
      or progress->'pagesTranslateTotal' is null
      or (progress->>'pagesDone')::integer <= (progress->>'pagesTranslateTotal')::integer
    )
  );

comment on column public.orders.progress is
  'Quote and translation progress. step is uploaded|reading|language|counting|quoting|done|translating. pagesRead and pagesTotal are the OCR counts and pagesRead stays <= pagesTotal. pagesDone and pagesTranslateTotal are optional non-negative integers for the translation job, with pagesDone <= pagesTranslateTotal. retries is an optional non-negative integer used by the translation watchdog.';

create table public.translation_runs (
  order_id uuid not null references public.orders (id) on delete cascade,
  version integer not null,
  status text not null default 'running',
  page_count integer not null,
  round integer not null default 0,
  token text,
  qa_issues jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint translation_runs_pkey primary key (order_id, version),
  constraint translation_runs_version_chk check (version >= 1),
  constraint translation_runs_page_count_chk check (page_count >= 0),
  constraint translation_runs_round_chk check (round >= 0),
  constraint translation_runs_status_chk check (
    status in ('running', 'assembling', 'ready', 'failed')
  )
);

comment on table public.translation_runs is
  'One translation attempt for an order preview version. Page jobs fan out from a running row. assembling claims the layout step once.';

create table public.translation_page_jobs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  version integer not null,
  document_id uuid not null references public.documents (id) on delete cascade,
  page_id uuid not null references public.document_pages (id) on delete cascade,
  page_number integer not null,
  combined_page_number integer not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  output jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint translation_page_jobs_run_fkey
    foreign key (order_id, version)
    references public.translation_runs (order_id, version)
    on delete cascade,
  constraint translation_page_jobs_page_key unique (order_id, version, page_id),
  constraint translation_page_jobs_page_number_chk check (page_number >= 1),
  constraint translation_page_jobs_combined_chk check (combined_page_number >= 1),
  constraint translation_page_jobs_attempts_chk check (attempts >= 0 and attempts <= 2),
  constraint translation_page_jobs_status_chk check (
    status in ('pending', 'running', 'ready', 'failed')
  )
);

comment on table public.translation_page_jobs is
  'One model call for one billable page. attempts is 1 after the first claim and 2 after the single retry. Skipped pages are not inserted.';

create index translation_page_jobs_run_status_idx
  on public.translation_page_jobs (order_id, version, status);

alter table public.translation_runs enable row level security;
alter table public.translation_page_jobs enable row level security;

grant select, insert, update, delete on table public.translation_runs to service_role;
grant select, insert, update, delete on table public.translation_page_jobs to service_role;
