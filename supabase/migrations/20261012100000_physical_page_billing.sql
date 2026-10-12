-- Physical-page billing.
-- Word sides keep billing_basis = 'words':
--   word_count is the word count
--   billable_units = greatest(1, ceil(word_count / 250))
-- Character sides use billing_basis = 'chars':
--   word_count is the Han, Hiragana, Katakana, and Hangul character count
--   (Latin groups and digits are not counted)
--   billable_units = greatest(1, ceil(word_count / 1000))
-- Skipped sides (already in the target language, blank, not a document, or
-- chosen by the customer) store billable_units = 0 and are not billed.
-- Rows priced before this rule keep billing_basis cjk (/400).

alter table public.document_pages
  add column skip boolean not null default false;

alter table public.document_pages
  add column skip_reason text;

alter table public.document_pages drop constraint document_pages_billing_basis_chk;

alter table public.document_pages
  add constraint document_pages_billing_basis_chk
  check (billing_basis in ('words', 'cjk', 'chars'));

alter table public.document_pages drop constraint document_pages_billable_rule_chk;

alter table public.document_pages add constraint document_pages_billable_rule_chk check (
  (
    word_count is null
    and billable_units is null
    and skip = false
    and skip_reason is null
  )
  or (
    billing_basis = 'words'
    and skip = false
    and skip_reason is null
    and word_count is not null
    and billable_units is not null
    and word_count >= 0
    and billable_units = greatest(1, ceil(word_count::numeric / 250)::integer)
  )
  or (
    billing_basis = 'cjk'
    and skip = false
    and skip_reason is null
    and word_count is not null
    and billable_units is not null
    and word_count >= 0
    and billable_units = greatest(1, ceil(word_count::numeric / 400)::integer)
  )
  or (
    billing_basis = 'chars'
    and skip = false
    and skip_reason is null
    and word_count is not null
    and billable_units is not null
    and word_count >= 0
    and billable_units = greatest(1, ceil(word_count::numeric / 1000)::integer)
  )
  or (
    skip = true
    and skip_reason in ('target_language', 'blank', 'not_document', 'customer')
    and word_count is not null
    and billable_units = 0
    and word_count >= 0
  )
);

comment on column public.document_pages.billing_basis is
  'words: word_count is the word count and billable_units = greatest(1, ceil(word_count / 250)). chars: word_count is the CJK character count and billable_units = greatest(1, ceil(word_count / 1000)). cjk (/400) remains for rows priced before the character rule. billable_units is 0 when skip is true.';

comment on column public.document_pages.skip is
  'True when the side is not billed, translated, or included in the preview.';

comment on column public.document_pages.skip_reason is
  'target_language, blank, not_document, or customer. Null when skip is false.';
