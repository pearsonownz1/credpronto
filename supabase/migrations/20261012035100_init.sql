-- CredPronto initial schema.
--
-- Customer browsers never query these tables. The Next.js server uses the
-- service role after checking the order token. Staff (rows in public.staff)
-- are the only authenticated role with policies. anon has no privileges.
--
-- Expects a Supabase database: auth.users, storage.buckets, storage.objects,
-- and the roles anon, authenticated, and service_role. storage.objects RLS is
-- already enabled by Supabase. This migration does not alter that table's RLS.

-- citext already lives in `extensions` on hosted Supabase. Create it there
-- only when this database does not have it yet, and keep both schemas on the
-- search_path so `citext` resolves in either layout.
create schema if not exists extensions;

do $citext$
begin
  if not exists (select 1 from pg_extension where extname = 'citext') then
    create extension citext with schema extensions;
  end if;
end
$citext$;

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.service_type as enum (
  'translation',
  'evaluation',
  'expert_letter'
);

create type public.order_status as enum (
  'draft',
  'quoted',
  'confirmed',
  'processing',
  'preview_ready',
  'needs_review',
  'correction_requested',
  'paid',
  'approved',
  'delivered',
  'cancelled',
  'failed'
);

create type public.document_status as enum (
  'uploaded',
  'processing',
  'ready',
  'failed'
);

create type public.correction_status as enum (
  'open',
  'resolved',
  'dismissed'
);

create type public.payment_status as enum (
  'pending',
  'paid',
  'failed',
  'refunded',
  'canceled'
);

create type public.delivery_status as enum (
  'pending',
  'approved',
  'delivered',
  'failed'
);

create type public.translation_status as enum (
  'pending',
  'ready',
  'failed'
);

create type public.preview_status as enum (
  'pending',
  'ready',
  'failed'
);

create type public.order_event_type as enum (
  'landing_view',
  'upload_started',
  'upload_done',
  'quote_shown',
  'preview_ready',
  'preview_viewed',
  'checkout_started',
  'paid',
  'downloaded'
);

create type public.staff_role as enum (
  'admin',
  'reviewer'
);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  email citext not null,
  name text,
  created_at timestamptz not null default now(),
  constraint customers_email_key unique (email),
  constraint customers_email_format_chk check (
    char_length(email::text) between 3 and 320
    and email::text ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  )
);

comment on table public.customers is
  'Email identity for a buyer. No auth.users row is required.';

create table public.staff (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role public.staff_role not null,
  created_at timestamptz not null default now()
);

comment on table public.staff is
  'Admin and reviewer accounts. Presence in this table is the RLS gate.';

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  -- Lowercase hex SHA-256 of the raw token. The raw token exists only in the email link.
  public_token_hash text not null,
  customer_id uuid not null references public.customers (id) on delete restrict,
  service_type public.service_type not null,
  status public.order_status not null default 'draft',
  source_language text,
  target_language text not null default 'en',
  language_confirmed boolean not null default false,
  billable_pages integer,
  unit_price_cents integer not null default 995,
  total_cents integer,
  currency text not null default 'usd',
  eta_at timestamptz,
  review_reason text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  gclid text,
  landing_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_public_token_hash_key unique (public_token_hash),
  constraint orders_public_token_hash_chk check (public_token_hash ~ '^[0-9a-f]{64}$'),
  constraint orders_currency_chk check (currency ~ '^[a-z]{3}$'),
  constraint orders_unit_price_chk check (unit_price_cents >= 0),
  constraint orders_billable_pages_chk check (billable_pages is null or billable_pages >= 0),
  constraint orders_total_cents_chk check (total_cents is null or total_cents >= 0),
  constraint orders_total_matches_pages_chk check (
    total_cents is null
    or billable_pages is null
    or total_cents = billable_pages * unit_price_cents
  ),
  -- A paid translation must carry a confirmed language pair and an exact page price.
  -- Other service types may be priced without billable pages.
  constraint orders_translation_priced_when_paid_chk check (
    service_type <> 'translation'
    or status not in ('paid', 'approved', 'delivered')
    or (
      language_confirmed
      and billable_pages is not null
      and billable_pages > 0
      and total_cents = billable_pages * unit_price_cents
    )
  )
);

comment on column public.orders.public_token_hash is
  'Lowercase hex SHA-256 of the unguessable order token. Never store the raw token.';

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  -- Object key inside the private bucket `originals` (not a URL, no bucket prefix).
  original_path text not null,
  filename text not null,
  mime text,
  size bigint,
  page_count integer,
  status public.document_status not null default 'uploaded',
  detected_language text,
  confidence numeric,
  created_at timestamptz not null default now(),
  constraint documents_original_path_chk check (char_length(original_path) > 0),
  constraint documents_filename_chk check (char_length(filename) > 0),
  constraint documents_size_chk check (size is null or size >= 0),
  constraint documents_page_count_chk check (page_count is null or page_count >= 0),
  constraint documents_confidence_chk check (
    confidence is null or (confidence >= 0 and confidence <= 1)
  )
);

create table public.document_pages (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  page_number integer not null,
  word_count integer,
  billable_units integer,
  ocr_text text,
  needs_review boolean not null default false,
  constraint document_pages_page_key unique (document_id, page_number),
  constraint document_pages_page_number_chk check (page_number >= 1),
  -- One side is 1 billable page through 250 words. Each further 250 words is another page.
  -- Zero words still counts as one side. Both columns stay null until the count is known.
  constraint document_pages_billable_rule_chk check (
    (word_count is null and billable_units is null)
    or (
      word_count is not null
      and billable_units is not null
      and word_count >= 0
      and billable_units = greatest(1, ceil(word_count::numeric / 250)::integer)
    )
  )
);

create table public.confirmations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  field_key text not null,
  original_value text,
  confirmed_value text,
  created_at timestamptz not null default now(),
  constraint confirmations_order_field_key unique (order_id, field_key),
  constraint confirmations_field_key_chk check (char_length(field_key) > 0)
);

create table public.translations (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  version integer not null,
  model text,
  status public.translation_status not null default 'pending',
  -- Structured segments as a JSON object, or a JSON string when the model returns plain text.
  output jsonb,
  created_at timestamptz not null default now(),
  constraint translations_document_version_key unique (document_id, version),
  constraint translations_version_chk check (version >= 1)
);

create table public.previews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  version integer not null,
  -- Object key inside the private bucket `previews` (watermarked rendering).
  preview_path text not null,
  status public.preview_status not null default 'pending',
  generated_at timestamptz not null default now(),
  constraint previews_order_version_key unique (order_id, version),
  constraint previews_version_chk check (version >= 1),
  constraint previews_path_chk check (char_length(preview_path) > 0)
);

create table public.corrections (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  document_id uuid references public.documents (id) on delete cascade,
  page_number integer,
  passage text,
  note text,
  status public.correction_status not null default 'open',
  resolved_preview_version integer,
  created_at timestamptz not null default now(),
  constraint corrections_page_chk check (
    page_number is null or (page_number >= 1 and document_id is not null)
  ),
  constraint corrections_resolved_version_chk check (
    resolved_preview_version is null or resolved_preview_version >= 1
  ),
  constraint corrections_resolved_chk check (
    (status = 'resolved') = (resolved_preview_version is not null)
  )
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  stripe_checkout_session_id text not null,
  stripe_payment_intent_id text,
  amount_cents integer not null,
  status public.payment_status not null default 'pending',
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  constraint payments_checkout_session_key unique (stripe_checkout_session_id),
  constraint payments_amount_chk check (amount_cents >= 0),
  constraint payments_paid_at_chk check (
    status not in ('paid', 'refunded') or paid_at is not null
  )
);

create table public.deliveries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  -- Object keys inside the private bucket `finals`.
  final_path text,
  certification_path text,
  approved_by uuid references public.staff (user_id) on delete restrict,
  approved_at timestamptz,
  delivered_at timestamptz,
  status public.delivery_status not null default 'pending',
  created_at timestamptz not null default now(),
  constraint deliveries_order_key unique (order_id),
  constraint deliveries_approved_chk check (
    status not in ('approved', 'delivered')
    or (approved_at is not null and approved_by is not null)
  ),
  constraint deliveries_delivered_chk check (
    status <> 'delivered' or delivered_at is not null
  ),
  constraint deliveries_files_chk check (
    status not in ('approved', 'delivered')
    or (
      final_path is not null
      and certification_path is not null
      and char_length(final_path) > 0
      and char_length(certification_path) > 0
    )
  )
);

create table public.order_events (
  id uuid primary key default gen_random_uuid(),
  -- Null only for landing_view, which can be recorded before a draft order exists.
  order_id uuid references public.orders (id) on delete cascade,
  type public.order_event_type not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint order_events_order_required_chk check (
    order_id is not null or type = 'landing_view'
  )
);

-- ---------------------------------------------------------------------------
-- Indexes (foreign keys and status). Unique keys above already index those columns.
-- ---------------------------------------------------------------------------

create index orders_customer_id_idx on public.orders (customer_id);
create index orders_status_created_at_idx on public.orders (status, created_at);

create index documents_order_id_idx on public.documents (order_id);
create index documents_status_idx on public.documents (status);

create index document_pages_needs_review_idx
  on public.document_pages (document_id)
  where needs_review;

create index translations_status_idx on public.translations (status);
create index previews_status_idx on public.previews (status);

create index corrections_order_id_idx on public.corrections (order_id);
create index corrections_document_id_idx on public.corrections (document_id);
create index corrections_status_idx on public.corrections (status);

create index payments_order_id_idx on public.payments (order_id);
create index payments_status_idx on public.payments (status);
create index payments_stripe_payment_intent_id_idx
  on public.payments (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;
create unique index payments_one_paid_per_order_idx
  on public.payments (order_id)
  where status = 'paid';

create index deliveries_status_idx on public.deliveries (status);
create index deliveries_approved_by_idx on public.deliveries (approved_by);

create index order_events_order_id_idx on public.order_events (order_id);
create index order_events_type_created_at_idx on public.order_events (type, created_at);

-- ---------------------------------------------------------------------------
-- Private helpers. security definer lives here so PostgREST does not expose it.
-- ---------------------------------------------------------------------------

create schema if not exists private;

revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create or replace function private.is_staff()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return exists (
    select 1
    from public.staff
    where user_id = (select auth.uid())
  );
end;
$$;

comment on function private.is_staff() is
  'True when auth.uid() is a row in public.staff. security definer so the staff policy can read staff without recursing.';

revoke all on function private.is_staff() from public;
grant execute on function private.is_staff() to authenticated;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

revoke all on function private.set_updated_at() from public;
grant execute on function private.set_updated_at() to authenticated, service_role;

create trigger orders_set_updated_at
  before update on public.orders
  for each row
  execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security. No anon policies. Authenticated access requires staff.
-- ---------------------------------------------------------------------------

alter table public.customers enable row level security;
alter table public.staff enable row level security;
alter table public.orders enable row level security;
alter table public.documents enable row level security;
alter table public.document_pages enable row level security;
alter table public.confirmations enable row level security;
alter table public.translations enable row level security;
alter table public.previews enable row level security;
alter table public.corrections enable row level security;
alter table public.payments enable row level security;
alter table public.deliveries enable row level security;
alter table public.order_events enable row level security;

create policy staff_all on public.customers
  for all to authenticated
  using ((select private.is_staff()))
  with check ((select private.is_staff()));

create policy staff_all on public.staff
  for all to authenticated
  using ((select private.is_staff()))
  with check ((select private.is_staff()));

create policy staff_all on public.orders
  for all to authenticated
  using ((select private.is_staff()))
  with check ((select private.is_staff()));

create policy staff_all on public.documents
  for all to authenticated
  using ((select private.is_staff()))
  with check ((select private.is_staff()));

create policy staff_all on public.document_pages
  for all to authenticated
  using ((select private.is_staff()))
  with check ((select private.is_staff()));

create policy staff_all on public.confirmations
  for all to authenticated
  using ((select private.is_staff()))
  with check ((select private.is_staff()));

create policy staff_all on public.translations
  for all to authenticated
  using ((select private.is_staff()))
  with check ((select private.is_staff()));

create policy staff_all on public.previews
  for all to authenticated
  using ((select private.is_staff()))
  with check ((select private.is_staff()));

create policy staff_all on public.corrections
  for all to authenticated
  using ((select private.is_staff()))
  with check ((select private.is_staff()));

create policy staff_all on public.payments
  for all to authenticated
  using ((select private.is_staff()))
  with check ((select private.is_staff()));

create policy staff_all on public.deliveries
  for all to authenticated
  using ((select private.is_staff()))
  with check ((select private.is_staff()));

create policy staff_all on public.order_events
  for all to authenticated
  using ((select private.is_staff()))
  with check ((select private.is_staff()));

-- Default privileges on Supabase grant these tables to anon. Take that back.
revoke all on table
  public.customers,
  public.staff,
  public.orders,
  public.documents,
  public.document_pages,
  public.confirmations,
  public.translations,
  public.previews,
  public.corrections,
  public.payments,
  public.deliveries,
  public.order_events
from public, anon;

grant select, insert, update, delete on table
  public.customers,
  public.staff,
  public.orders,
  public.documents,
  public.document_pages,
  public.confirmations,
  public.translations,
  public.previews,
  public.corrections,
  public.payments,
  public.deliveries,
  public.order_events
to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Private storage buckets. Service role writes objects and mints signed URLs.
-- Staff may read. Customers have no storage policy.
-- Do not enable RLS on storage.objects; Supabase already owns that.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values
  ('originals', 'originals', false),
  ('previews', 'previews', false),
  ('finals', 'finals', false);

create policy staff_read_originals on storage.objects
  for select to authenticated
  using (bucket_id = 'originals' and (select private.is_staff()));

create policy staff_read_previews on storage.objects
  for select to authenticated
  using (bucket_id = 'previews' and (select private.is_staff()));

create policy staff_read_finals on storage.objects
  for select to authenticated
  using (bucket_id = 'finals' and (select private.is_staff()));
