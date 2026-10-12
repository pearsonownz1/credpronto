-- How an evaluation matched a printed credential title. Apply separately. This file is not run by the app.
-- base: same country and the same normalized base title. fuzzy: same-country similarity of at least 0.8.
-- No seed rows. Licensed reference data stays out of the repo.
-- Staff and the service role can read the column with the rest of orders. Customer routes must not return it.

alter table public.orders
  add column edge_match_method text,
  add constraint orders_edge_match_method_chk
    check (edge_match_method is null or edge_match_method in ('base', 'fuzzy'));

comment on column public.orders.edge_match_method is
  'base or fuzzy. How the evaluation matched an internal credential. Staff only. Not returned on customer routes.';
