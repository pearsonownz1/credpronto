-- Chinese, Japanese, and Korean sides are billed on character units, not words.
-- word_count stores the unit count for billing_basis = 'cjk':
--   Han/Hiragana/Katakana/Hangul characters, plus one per ASCII number or Latin run.
-- billable_units = greatest(1, ceil(word_count / 400)).
-- Other languages stay on greatest(1, ceil(word_count / 250)).

alter table public.document_pages
  add column billing_basis text not null default 'words';

alter table public.document_pages
  add constraint document_pages_billing_basis_chk
  check (billing_basis in ('words', 'cjk'));

alter table public.document_pages drop constraint document_pages_billable_rule_chk;

alter table public.document_pages add constraint document_pages_billable_rule_chk check (
  (
    word_count is null
    and billable_units is null
    and billing_basis = 'words'
  )
  or (
    billing_basis = 'words'
    and word_count is not null
    and billable_units is not null
    and word_count >= 0
    and billable_units = greatest(1, ceil(word_count::numeric / 250)::integer)
  )
  or (
    billing_basis = 'cjk'
    and word_count is not null
    and billable_units is not null
    and word_count >= 0
    and billable_units = greatest(1, ceil(word_count::numeric / 400)::integer)
  )
);

comment on column public.document_pages.billing_basis is
  'words: billable_units = greatest(1, ceil(word_count / 250)). cjk: word_count is the CJK unit count and billable_units = greatest(1, ceil(word_count / 400)).';
