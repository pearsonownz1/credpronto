-- Link an order to the auth user who claimed it.
--
-- user_id stays null until a verified sign-in claims the order. Token routes
-- keep using the service role, which bypasses RLS. Customers may select only
-- their own orders and the documents, previews, and payment rows on those
-- orders. Staff still have staff_all on every table.

alter table public.orders
  add column user_id uuid references auth.users (id) on delete set null;

comment on column public.orders.user_id is
  'auth.users id of the customer who claimed this order. Null while the order is reached only by its token.';

create index orders_user_id_idx on public.orders (user_id);

create or replace function private.owns_order(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.orders
    where id = target
      and user_id = (select auth.uid())
  );
$$;

comment on function private.owns_order(uuid) is
  'True when the order belongs to auth.uid(). security definer so child-table policies can read orders without recursing.';

revoke all on function private.owns_order(uuid) from public;
grant execute on function private.owns_order(uuid) to authenticated;

create policy customer_select_own_orders on public.orders
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy customer_select_own_documents on public.documents
  for select to authenticated
  using ((select private.owns_order(order_id)));

create policy customer_select_own_previews on public.previews
  for select to authenticated
  using ((select private.owns_order(order_id)));

create policy customer_select_own_payments on public.payments
  for select to authenticated
  using ((select private.owns_order(order_id)));

comment on policy customer_select_own_payments on public.payments is
  'Owning customers may select payment metadata for their orders: status, amount, timestamps, and the Stripe ids stored on the row. Card data is not stored. Writes stay on staff_all.';
