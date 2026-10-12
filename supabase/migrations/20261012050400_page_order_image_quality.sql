-- Logical page order and the image-quality hold.
-- Apply separately. This file is not run by the app.

alter table public.documents
  add column applied_position integer;

alter table public.documents
  add constraint documents_applied_position_chk
  check (applied_position is null or applied_position >= 1);

comment on column public.documents.position is
  'Upload order. This does not change when analysis reorders pages.';

comment on column public.documents.applied_position is
  '1-based order used for the combined original after analysis. Null until analysis. Combined pages follow applied_position, then page_number.';

alter table public.document_pages
  add column upload_page integer,
  add column logical_page integer,
  add column order_hint text,
  add column quality_score numeric,
  add column quality_flags text[] not null default '{}',
  add column quality_message text;

alter table public.document_pages
  add constraint document_pages_upload_page_chk check (upload_page is null or upload_page >= 1),
  add constraint document_pages_logical_page_chk check (logical_page is null or logical_page >= 1),
  add constraint document_pages_quality_score_chk check (
    quality_score is null or (quality_score >= 0 and quality_score <= 1)
  ),
  add constraint document_pages_quality_flags_chk check (
    quality_flags <@ array['blurry', 'cropped', 'glare', 'too_dark', 'unreadable_fields']::text[]
  );

comment on column public.document_pages.page_number is
  'Applied page inside the document, starting at 1. Matches the combined original after analysis.';

comment on column public.document_pages.upload_page is
  '1-based page index in the uploaded file, before a logical reorder.';

comment on column public.document_pages.logical_page is
  'Printed page number, or the N in a cue such as page N/M. Null when analysis did not see one.';

comment on column public.document_pages.order_hint is
  'Cue the model reported, such as "page 1/2" or a continuation mark.';

comment on column public.document_pages.quality_score is
  'Legibility from 0 to 1. A visual page below 0.6 sets orders.review_reason to image_quality.';

comment on column public.document_pages.quality_flags is
  'Subset of blurry, cropped, glare, too_dark, unreadable_fields.';

comment on column public.document_pages.quality_message is
  'Retake instructions when this page failed the image-quality gate.';

alter table public.orders
  add column page_order_basis text,
  add column page_order jsonb;

alter table public.orders
  add constraint orders_page_order_basis_chk
  check (page_order_basis is null or page_order_basis in ('logical', 'upload'));

comment on column public.orders.page_order_basis is
  'logical when analysis reordered pages from printed numbers or continuation cues. upload when that evidence was not confident.';

comment on column public.orders.page_order is
  'Applied page order recorded at analysis. basis plus one entry per page with upload and applied positions.';
