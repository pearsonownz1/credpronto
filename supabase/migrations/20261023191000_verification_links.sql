-- Public verification links for finished translation and evaluation PDFs.
-- Apply separately. This file is not run by the app.
-- The token is the access key in https://www.credpronto.com/verify/<token>.
-- Service role only. Browser roles have no access.

create table public.verification_links (
  token text primary key,
  order_id uuid not null references public.orders (id) on delete cascade,
  document_type text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  constraint verification_links_token_chk check (char_length(token) >= 22),
  constraint verification_links_token_charset_chk check (token ~ '^[A-Za-z0-9_-]+$'),
  constraint verification_links_document_type_chk check (document_type in ('translation', 'evaluation')),
  constraint verification_links_revoked_actor_chk check (revoked_at is not null or revoked_by is null)
);

create unique index verification_links_active_order_type_uidx
  on public.verification_links (order_id, document_type)
  where revoked_at is null;

create index verification_links_order_idx
  on public.verification_links (order_id, document_type);

alter table public.verification_links enable row level security;

revoke all on table public.verification_links from public, anon, authenticated;

grant select, insert, update, delete on table public.verification_links to service_role;

comment on table public.verification_links is
  'Unguessable verify token for one finished translation or evaluation. The raw token is the access key. Service role only.';

comment on column public.verification_links.token is
  'URL-safe token, at least 128 bits. Primary key. Not returned by the verify API.';

comment on column public.verification_links.document_type is
  'translation or evaluation. One active link per order and type.';

comment on column public.verification_links.revoked_at is
  'Set when staff revoke the link. A revoked link no longer signs a document URL.';

comment on column public.verification_links.revoked_by is
  'Auth user who revoked the link. Null when the link is active.';
