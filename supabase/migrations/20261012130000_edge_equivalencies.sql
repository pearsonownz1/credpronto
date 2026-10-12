-- Licensed AACRAO EDGE equivalency suggestions. Apply separately. This file is not run by the app.
-- Do not insert rows here. The source files stay out of the repo.
-- No anon or authenticated policy: the service role bypasses RLS and is the only reader.

create table public.edge_equivalencies (
  id uuid primary key default gen_random_uuid(),
  edge_credential_id uuid not null references public.edge_credentials (id) on delete cascade,
  country text not null,
  credential_title text not null,
  edge_level text,
  us_equivalency text not null,
  basis text not null,
  confidence text not null,
  constraint edge_equivalencies_country_chk check (char_length(country) > 0),
  constraint edge_equivalencies_title_chk check (char_length(credential_title) > 0),
  constraint edge_equivalencies_us_chk check (char_length(us_equivalency) > 0),
  constraint edge_equivalencies_basis_chk check (char_length(basis) > 0),
  constraint edge_equivalencies_confidence_chk check (confidence in ('high', 'medium', 'low'))
);

create index edge_equivalencies_credential_idx
  on public.edge_equivalencies (edge_credential_id);

alter table public.edge_equivalencies enable row level security;

revoke all on table public.edge_equivalencies from public, anon, authenticated;

grant select, insert, update, delete on table public.edge_equivalencies to service_role;

comment on table public.edge_equivalencies is
  'AACRAO EDGE equivalency suggestions. Licensed. Service role only. Not returned on customer routes.';

comment on column public.edge_equivalencies.confidence is
  'high, medium, or low. Staff routing only. Never copied onto customer pages, emails, PDFs, or API responses.';
