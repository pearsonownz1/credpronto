-- Audit log of staff downloads of order files. Apply separately. This file is not run by the app.
-- The app (service role) inserts one row before it signs each staff download URL.

create table if not exists public.staff_file_downloads (
  id uuid primary key default gen_random_uuid(),
  staff_user_id uuid not null,
  staff_email text,
  -- No foreign key on purpose: the audit trail outlives a deleted order.
  order_id uuid not null,
  bucket text not null,
  file_path text not null,
  file_kind text,
  downloaded_at timestamptz not null default now()
);

create index if not exists staff_file_downloads_order_idx
  on public.staff_file_downloads (order_id, downloaded_at desc);
create index if not exists staff_file_downloads_staff_idx
  on public.staff_file_downloads (staff_user_id, downloaded_at desc);

-- Inserts come from the service role only. Staff can read the log; nobody can edit it from a client.
alter table public.staff_file_downloads enable row level security;

create policy staff_file_downloads_staff_read on public.staff_file_downloads
  for select to authenticated
  using ((select private.is_staff()));

comment on table public.staff_file_downloads is
  'One row per staff download of an order file (who, which order, which path, when).';
