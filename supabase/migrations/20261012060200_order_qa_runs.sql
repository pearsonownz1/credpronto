-- One row per QA comparison of a translation. attempt is 1, 2, or 3.

create table public.order_qa_runs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  attempt integer not null,
  status public.qa_status not null,
  score integer not null,
  issues jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint order_qa_runs_order_attempt_key unique (order_id, attempt),
  constraint order_qa_runs_attempt_chk check (attempt between 1 and 3),
  constraint order_qa_runs_score_chk check (score between 0 and 100)
);

comment on table public.order_qa_runs is
  'QA comparison of a translation. Customers do not select these rows.';

create index order_qa_runs_order_id_idx on public.order_qa_runs (order_id, attempt);

alter table public.order_qa_runs enable row level security;

create policy staff_all on public.order_qa_runs
  for all to authenticated
  using ((select private.is_staff()))
  with check ((select private.is_staff()));

revoke all on table public.order_qa_runs from public, anon;

grant select, insert, update, delete on table public.order_qa_runs to authenticated, service_role;
