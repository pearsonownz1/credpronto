-- Anonymous instant pre-evaluation. Apply separately. This file is not run by the app.
-- The public id is an unguessable token. Only its hash is used for lookup.
-- access_token is stored so the result email can link back after the model finishes.
-- No anon or authenticated policy: the service role bypasses RLS and is the only reader.
-- Do not insert rows here.

create table public.pre_evaluations (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  access_token text not null unique,
  status text not null default 'processing',
  storage_path text not null,
  filename text not null,
  mime text not null,
  size_bytes bigint not null,
  ip_hash text not null,
  country text,
  credential_name text,
  us_equivalency text,
  confidence text,
  rationale text,
  document_kind text,
  degree_count integer not null default 1,
  edge_credential_id uuid references public.edge_credentials (id) on delete set null,
  edge_match_method text,
  email text,
  email_submitted_at timestamptz,
  result_email_sent_at timestamptz,
  suggestion_started_at timestamptz,
  order_id uuid references public.orders (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pre_evaluations_status_chk check (status in ('processing', 'ready', 'failed')),
  constraint pre_evaluations_confidence_chk check (confidence is null or confidence in ('high', 'medium', 'low')),
  constraint pre_evaluations_kind_chk check (document_kind is null or document_kind in ('diploma', 'transcript')),
  constraint pre_evaluations_degree_chk check (degree_count between 1 and 5),
  constraint pre_evaluations_match_chk check (edge_match_method is null or edge_match_method in ('base', 'fuzzy')),
  constraint pre_evaluations_mime_chk check (mime in ('application/pdf', 'image/jpeg', 'image/png')),
  constraint pre_evaluations_size_chk check (size_bytes > 0 and size_bytes <= 10485760),
  constraint pre_evaluations_token_chk check (char_length(token_hash) = 64 and char_length(access_token) between 43 and 128),
  constraint pre_evaluations_email_chk check (email is null or (char_length(email) between 3 and 320 and position('@' in email) > 1))
);

create index pre_evaluations_ip_created_idx
  on public.pre_evaluations (ip_hash, created_at);

create index pre_evaluations_ip_email_idx
  on public.pre_evaluations (ip_hash, email_submitted_at);

alter table public.pre_evaluations enable row level security;

revoke all on table public.pre_evaluations from public, anon, authenticated;

grant select, insert, update, delete on table public.pre_evaluations to service_role;

comment on table public.pre_evaluations is
  'Anonymous instant equivalency suggestion. The email column is the lead. Service role only. Not readable by anon or authenticated.';

comment on column public.pre_evaluations.access_token is
  'Unguessable public id. Service role only. Never log it.';

comment on column public.pre_evaluations.ip_hash is
  'SHA-256 of the client address. The raw address is not stored.';

comment on column public.pre_evaluations.email is
  'Lead email. Null until the visitor submits it. The suggestion stays hidden until then.';

-- Private bucket for the uploaded diploma or transcript. No client storage policy.
insert into storage.buckets (id, name, public, file_size_limit)
values ('pre-evaluations', 'pre-evaluations', false, 10485760);
