-- Licensed AACRAO EDGE reference data. Apply separately. This file is not run by the app.
-- Do not insert rows here. The source files stay out of the repo.
-- No anon or authenticated policy: the service role bypasses RLS and is the only reader.

create table public.edge_credentials (
  id uuid primary key default gen_random_uuid(),
  country_slug text not null,
  country text not null,
  title text not null,
  content text not null,
  level_number integer,
  level_title text,
  url text,
  us_equivalency text,
  constraint edge_credentials_country_slug_chk check (char_length(country_slug) > 0),
  constraint edge_credentials_title_chk check (char_length(title) > 0)
);

create index edge_credentials_country_title_idx
  on public.edge_credentials (country_slug, lower(title));

create table public.edge_grading_scales (
  id uuid primary key default gen_random_uuid(),
  country_slug text not null,
  title text not null,
  raw text,
  rows jsonb not null default '[]'::jsonb,
  constraint edge_grading_scales_country_slug_chk check (char_length(country_slug) > 0),
  constraint edge_grading_scales_title_chk check (char_length(title) > 0),
  constraint edge_grading_scales_rows_chk check (jsonb_typeof(rows) = 'array')
);

alter table public.edge_credentials enable row level security;
alter table public.edge_grading_scales enable row level security;

revoke all on table public.edge_credentials from public, anon, authenticated;
revoke all on table public.edge_grading_scales from public, anon, authenticated;

grant select, insert, update, delete on table public.edge_credentials to service_role;
grant select, insert, update, delete on table public.edge_grading_scales to service_role;

alter table public.orders
  add column edge_credential_id uuid references public.edge_credentials (id) on delete set null,
  add column edge_grading_scale_id uuid references public.edge_grading_scales (id) on delete set null;

comment on table public.edge_credentials is
  'AACRAO EDGE credential reference. Licensed. Service role only. Not returned on customer routes.';

comment on table public.edge_grading_scales is
  'AACRAO EDGE grading scales. rows is an array of {indigenous_grade, us_equivalent}. Service role only.';

comment on column public.orders.edge_credential_id is
  'Matched EDGE credential for this evaluation. Null when nothing matched. Staff review only.';

comment on column public.orders.edge_grading_scale_id is
  'Matched EDGE grading scale for this evaluation. Null when no scale matched.';
