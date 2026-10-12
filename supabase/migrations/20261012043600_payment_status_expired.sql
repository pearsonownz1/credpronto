-- checkout.session.expired records this status. A new enum value cannot be
-- used in the same transaction, so this migration only adds it.

alter type public.payment_status add value if not exists 'expired';
