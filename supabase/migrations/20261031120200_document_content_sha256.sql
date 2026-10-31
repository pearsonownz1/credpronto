-- SHA-256 of the original upload. The raw file stays in the originals bucket.

alter table public.documents
  add column content_sha256 text;

alter table public.documents
  add constraint documents_content_sha256_chk
  check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$');

create index documents_content_sha256_idx
  on public.documents (content_sha256)
  where content_sha256 is not null;
