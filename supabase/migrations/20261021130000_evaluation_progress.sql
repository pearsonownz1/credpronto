-- Staff evaluation stages. Separate from orders.status so paid, approved,
-- and delivered stay the order lifecycle.
-- Production already has these columns. ADD COLUMN IF NOT EXISTS is a no-op there.
-- A null evaluation_status is allowed. A paid evaluation with no status shows as under review.

alter table public.orders
  add column if not exists evaluation_status text
    check (
      evaluation_status in (
        'under_review',
        'performing_evaluation',
        'performing_layout',
        'evaluation_complete'
      )
    ),
  add column if not exists under_review_at timestamptz,
  add column if not exists performing_evaluation_at timestamptz,
  add column if not exists performing_layout_at timestamptz,
  add column if not exists evaluation_complete_at timestamptz;

comment on column public.orders.evaluation_status is
  'Credential evaluation stage: under_review, performing_evaluation, performing_layout, or evaluation_complete. Null until set. A paid evaluation with no status is shown as under review.';

comment on column public.orders.under_review_at is
  'When the evaluation entered under_review. Null until that stage is stored.';

comment on column public.orders.performing_evaluation_at is
  'When the evaluation entered performing_evaluation.';

comment on column public.orders.performing_layout_at is
  'When the evaluation entered performing_layout.';

comment on column public.orders.evaluation_complete_at is
  'When the evaluation entered evaluation_complete.';
