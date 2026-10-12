-- When an API key last authenticated a request. Null until the first use.
-- GET and POST /api/me/api-keys return this as lastUsedAt.
-- requireApiKey writes it. The raw key is still not stored.

alter table public.api_keys
  add column last_used_at timestamptz;

comment on column public.api_keys.last_used_at is
  'Last time this key authenticated a request. Null until the first use.';
