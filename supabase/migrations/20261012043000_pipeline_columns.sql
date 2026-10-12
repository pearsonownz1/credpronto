-- Columns the order pipeline needs beyond the init schema.
-- The init migration is already applied on credpronto-db. Do not edit it.
--
-- combined_original_path is the single PDF the viewer opens (every upload,
-- image or PDF, in order). final_translation_path and certification_path are
-- object keys in the finals bucket, copied onto deliveries at approval.

alter table public.documents
  add column position integer not null default 0;

comment on column public.documents.position is
  'Upload order. Combined original pages follow position, then page_number.';

alter table public.document_pages
  add column width_pt numeric,
  add column height_pt numeric,
  add constraint document_pages_width_pt_chk check (width_pt is null or width_pt > 0),
  add constraint document_pages_height_pt_chk check (height_pt is null or height_pt > 0);

comment on column public.document_pages.width_pt is
  'Page width in PDF points. Translation page N uses the same size as combined original page N.';

comment on column public.document_pages.height_pt is
  'Page height in PDF points. Translation page N uses the same size as combined original page N.';

alter table public.orders
  add column combined_original_path text,
  add column final_translation_path text,
  add column certification_path text,
  add constraint orders_combined_original_path_chk check (
    combined_original_path is null or char_length(combined_original_path) > 0
  ),
  add constraint orders_final_translation_path_chk check (
    final_translation_path is null or char_length(final_translation_path) > 0
  ),
  add constraint orders_certification_path_chk check (
    certification_path is null or char_length(certification_path) > 0
  );

comment on column public.orders.combined_original_path is
  'Object key in the originals bucket for the single combined original PDF.';

comment on column public.orders.final_translation_path is
  'Object key in the finals bucket for the clean translated PDF. No watermark and no certification page.';

comment on column public.orders.certification_path is
  'Object key in the finals bucket for the certification page PDF.';
