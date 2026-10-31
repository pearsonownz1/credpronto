-- One staging order per customer for files that are not an order yet.

create unique index orders_one_mcp_hold_per_user
  on public.orders (user_id)
  where external_ref = 'mcp-hold';
