-- Placeholder checkout (CHECKOUT_PLACEHOLDER=1) records this status instead of
-- calling Stripe. A new enum value cannot be used in the same transaction, so
-- the unique index that includes it lives in the next migration.

alter type public.payment_status add value if not exists 'paid_test';
