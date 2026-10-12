-- QA run status. The table that stores these labels is the next migration.

create type public.qa_status as enum (
  'pass',
  'fail',
  'retranslated'
);
