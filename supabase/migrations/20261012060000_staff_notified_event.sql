-- Staff notification for a new order. Add the value only.
-- Postgres cannot use a new enum value in the same transaction that adds it.

alter type public.order_event_type add value if not exists 'staff_notified';
