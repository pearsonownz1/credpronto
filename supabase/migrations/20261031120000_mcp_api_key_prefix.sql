-- MCP keys use their own prefix so a partner key cannot call /api/mcp.

alter table public.api_keys drop constraint api_keys_prefix_chk;

alter table public.api_keys
  add constraint api_keys_prefix_chk check (prefix in ('cp_live_', 'cp_test_', 'cpk_live_'));

comment on table public.api_keys is
  'Hashed cp_live_, cp_test_, and cpk_live_ keys. The raw secret is not stored.';
