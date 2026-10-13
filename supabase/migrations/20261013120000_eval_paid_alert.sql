-- One staff webhook per paid evaluation. Null until that alert is claimed.

alter table public.orders
  add column if not exists eval_paid_alert_sent_at timestamptz;

comment on column public.orders.eval_paid_alert_sent_at is
  'When the evaluation.paid staff webhook was claimed. Stays set so the alert is sent once.';
