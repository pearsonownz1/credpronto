-- Staff notes on an order. Customers have no policy on this table.

create table public.order_notes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete restrict,
  body text not null,
  created_at timestamptz not null default now(),
  constraint order_notes_body_chk check (char_length(btrim(body)) between 1 and 4000)
);

comment on table public.order_notes is
  'Internal staff notes. Not visible to the customer session.';

create index order_notes_order_id_created_at_idx
  on public.order_notes (order_id, created_at);

alter table public.order_notes enable row level security;

create policy staff_all on public.order_notes
  for all to authenticated
  using ((select private.is_staff()))
  with check ((select private.is_staff()));

revoke all on table public.order_notes from public, anon;

grant select, insert, update, delete on table public.order_notes to authenticated, service_role;
