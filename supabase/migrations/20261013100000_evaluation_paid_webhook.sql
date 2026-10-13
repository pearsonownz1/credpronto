-- evaluation.paid is one attempt, like order.paid.
-- A translation payment still records order.paid.

alter table public.webhook_deliveries
  drop constraint webhook_deliveries_event_chk;

alter table public.webhook_deliveries
  add constraint webhook_deliveries_event_chk check (
    event in (
      'order.quoted',
      'order.delivered',
      'order.failed',
      'order.preview_ready',
      'order.paid',
      'evaluation.paid',
      'order.completed',
      'webhook.test'
    )
  );
