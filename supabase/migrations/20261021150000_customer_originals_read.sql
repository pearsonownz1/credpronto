-- Customers can read the original uploads on orders they own.
--
-- Orders are tied to an account through orders.user_id. Upload objects live in
-- the private originals bucket, keyed by that order id. This policy lets the
-- signed-in owner select those objects. It does not grant insert, update, or
-- delete, and it does not make the bucket public. Staff keep staff_read_originals.

create or replace function private.object_order_id(object_name text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (storage.foldername(object_name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then ((storage.foldername(object_name))[1])::uuid
    else null
  end;
$$;

comment on function private.object_order_id(text) is
  'Order id from the first storage folder, or null when the key is not an order id.';

revoke all on function private.object_order_id(text) from public;
grant execute on function private.object_order_id(text) to authenticated;

create policy customer_read_own_originals on storage.objects
  for select to authenticated
  using (
    bucket_id = 'originals'
    and (select private.owns_order(private.object_order_id(name)))
  );

comment on policy customer_read_own_originals on storage.objects is
  'The account that owns the order may read its original uploads. Writes stay on the service role.';
