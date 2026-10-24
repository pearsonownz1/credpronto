-- Admin fulfillment: one final-file correction per order, a notarized step, and mail carrier / shipped time.
-- Apply separately. This file is not run by the app. It does not modify existing order rows.
--
-- The preview corrections table (open / resolved / dismissed, tied to a preview page) is the
-- pre-payment review flow. This table is the later "fix the final file" request and does not share that enum.

create table public.order_final_corrections (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  request_text text not null,
  status text not null default 'open',
  final_path text,
  final_version integer,
  claimed_at timestamptz,
  fixed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint order_final_corrections_order_key unique (order_id),
  constraint order_final_corrections_text_chk check (char_length(btrim(request_text)) between 1 and 4000),
  constraint order_final_corrections_status_chk check (status in ('open', 'in_progress', 'fixed')),
  constraint order_final_corrections_state_chk check (
    (
      status = 'open'
      and claimed_at is null
      and fixed_at is null
      and final_path is null
      and final_version is null
    )
    or (
      status = 'in_progress'
      and claimed_at is not null
      and fixed_at is null
      and final_path is null
      and final_version is null
    )
    or (
      status = 'fixed'
      and claimed_at is not null
      and fixed_at is not null
      and final_path is not null
      and char_length(final_path) > 0
      and final_version >= 1
    )
  )
);

comment on table public.order_final_corrections is
  'One customer request to fix the delivered final. Status is open, in_progress, or fixed. Not the preview corrections table.';

comment on column public.order_final_corrections.final_path is
  'Object key in the private finals bucket for the corrected file. Set only when status is fixed.';

create index order_final_corrections_open_idx
  on public.order_final_corrections (created_at)
  where status = 'open';

alter table public.order_final_corrections enable row level security;

create policy staff_all on public.order_final_corrections
  for all to authenticated
  using ((select private.is_staff()))
  with check ((select private.is_staff()));

revoke all on table public.order_final_corrections from public, anon;

grant select, insert, update, delete on table public.order_final_corrections to authenticated, service_role;

-- Notarization already stores pending and done. Staff can now record the in-between notarized step.
alter table public.orders drop constraint if exists orders_notarization_status_chk;

alter table public.orders
  add constraint orders_notarization_status_chk check (
    notarization_status is null or notarization_status in ('pending', 'notarized', 'done')
  );

alter table public.orders
  add column if not exists mail_carrier text,
  add column if not exists mail_shipped_at timestamptz;

alter table public.orders drop constraint if exists orders_mail_carrier_chk;

alter table public.orders
  add constraint orders_mail_carrier_chk check (
    mail_carrier is null or char_length(btrim(mail_carrier)) between 1 and 40
  );

-- A timestamp is only stored once the hard copy is shipped. Existing shipped rows may have a null timestamp.
alter table public.orders drop constraint if exists orders_mail_shipped_at_chk;

alter table public.orders
  add constraint orders_mail_shipped_at_chk check (
    mail_status = 'shipped' or mail_shipped_at is null
  );

comment on column public.orders.mail_carrier is
  'Carrier for the hard-copy add-on, such as USPS. Null until staff record it.';

comment on column public.orders.mail_shipped_at is
  'When mail_status became shipped. Null while the hard copy is still pending.';
