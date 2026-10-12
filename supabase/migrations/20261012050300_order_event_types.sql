-- New funnel events. Add the values only.
-- Postgres cannot use a new enum value in the same transaction that adds it,
-- so this file does not insert or compare these labels.

alter type public.order_event_type add value if not exists 'account_linked';
alter type public.order_event_type add value if not exists 'translation_edited';
alter type public.order_event_type add value if not exists 'note_added';
alter type public.order_event_type add value if not exists 'approved';
