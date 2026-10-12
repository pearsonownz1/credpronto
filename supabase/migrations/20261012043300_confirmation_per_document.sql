-- Confirmations are one row per document per field. The init schema keyed
-- fields only by order, which cannot hold the same field on two uploads.

alter table public.confirmations
  add column document_id uuid references public.documents (id) on delete cascade;

alter table public.confirmations drop constraint confirmations_order_field_key;

alter table public.confirmations
  add constraint confirmations_order_document_field_key unique (order_id, document_id, field_key);

alter table public.confirmations
  add constraint confirmations_document_required_chk check (document_id is not null);

comment on column public.confirmations.document_id is
  'Document these spellings were read from. full_name, date_of_birth, parent_names, place_of_birth, and date_format are stored per document.';
