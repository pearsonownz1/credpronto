-- Guest quotes can be stored before the customer has an account.
-- Signup and sign-in write the account email onto this row.
-- Null stays allowed for many quotes at once. A real address stays unique,
-- and customers_email_format_chk still rejects a blank or malformed value.

alter table public.customers
  alter column email drop not null;

comment on column public.customers.email is
  'Buyer address. Null on a guest quote until signup or sign-in writes the account email.';
