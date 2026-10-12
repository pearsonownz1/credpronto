-- Allow the integrations-page events and a signed test ping.
-- webhook.test has no order. The other events still require one.
-- order.quoted, order.delivered, and order.failed keep the retry schedule.
-- order.preview_ready, order.paid, order.completed, and webhook.test are one attempt.

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
      'order.completed',
      'webhook.test'
    )
  );

alter table public.webhook_deliveries
  alter column order_id drop not null;

alter table public.webhook_deliveries
  add constraint webhook_deliveries_order_chk check (
    (event = 'webhook.test' and order_id is null)
    or (event <> 'webhook.test' and order_id is not null)
  );
