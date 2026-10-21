-- Staff evaluation stages. Separate from orders.status so paid, approved,
-- and delivered stay the order lifecycle.

alter table public.orders
  add column if not exists evaluation_status text,
  add column if not exists under_review_at timestamptz,
  add column if not exists performing_evaluation_at timestamptz,
  add column if not exists performing_layout_at timestamptz,
  add column if not exists evaluation_complete_at timestamptz;

alter table public.orders
  drop constraint if exists orders_evaluation_status_chk;

alter table public.orders
  add constraint orders_evaluation_status_chk
  check (
    evaluation_status is null
    or evaluation_status in (
      'under_review',
      'performing_evaluation',
      'performing_layout',
      'evaluation_complete'
    )
  );

comment on column public.orders.evaluation_status is
  'Credential evaluation stage set by staff after payment: under_review, performing_evaluation, performing_layout, or evaluation_complete.';

comment on column public.orders.under_review_at is
  'When the evaluation entered under_review. Payment sets this. Staff updates do not clear it.';

comment on column public.orders.performing_evaluation_at is
  'When staff moved the evaluation to performing_evaluation.';

comment on column public.orders.performing_layout_at is
  'When staff moved the evaluation to performing_layout.';

comment on column public.orders.evaluation_complete_at is
  'When staff moved the evaluation to evaluation_complete.';
