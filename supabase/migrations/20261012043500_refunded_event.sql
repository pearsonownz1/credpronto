-- Record a refund in the funnel. New enum values must land in their own migration.

alter type public.order_event_type add value if not exists 'refunded';
