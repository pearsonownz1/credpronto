-- A customer can leave a page out of the translation from the quote.
-- billable_units stays the density count for that side. skipped decides whether it is charged.
-- Apply separately. This file is not run by the app.

alter table public.document_pages
  add column skipped boolean not null default false,
  add column skip_reason text;

comment on column public.document_pages.skipped is
  'True when this side is not translated or billed.';

comment on column public.document_pages.skip_reason is
  'Why the side was skipped, such as already English or not a document. Null when the customer skipped it.';
