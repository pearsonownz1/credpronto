-- CJK pages bill on characters: greatest(1, ceil(word_count / 1000)).
-- word_count for billing_basis = 'cjk' is the Han/Hiragana/Katakana/Hangul count.
-- Analysis stores that density in billable_units (at least 1). The check still accepts
-- billable_units = 0. Whether the density is charged is document_pages.skipped.
-- This migration adds no column and no table.
-- NOT VALID keeps rows quoted under the previous 400-unit rule in place.

alter table public.document_pages drop constraint document_pages_billable_rule_chk;

alter table public.document_pages
  add constraint document_pages_billable_rule_chk check (
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
      and (
        billable_units = 0
        or billable_units = greatest(1, ceil(word_count::numeric / 250)::integer)
      )
    )
    or (
      billing_basis = 'cjk'
      and word_count is not null
      and billable_units is not null
      and word_count >= 0
      and (
        billable_units = 0
        or billable_units = greatest(1, ceil(word_count::numeric / 1000)::integer)
      )
    )
  ) not valid;

comment on column public.document_pages.billing_basis is
  'words: billable_units is 0 or greatest(1, ceil(word_count / 250)). cjk: word_count is the CJK character count and billable_units is 0 or greatest(1, ceil(word_count / 1000)). Analysis stores the density. skipped decides the charge.';
