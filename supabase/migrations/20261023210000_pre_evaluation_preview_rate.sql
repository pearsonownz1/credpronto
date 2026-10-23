-- Watermarked preview path, and short-window rate limits that survive across instances.
-- Apply separately. Do not edit 20261023200000_pre_evaluations.sql. Do not insert lead rows.

alter table public.pre_evaluations
  add column preview_path text,
  add column preview_mime text;

alter table public.pre_evaluations
  add constraint pre_evaluations_preview_chk check (
    (preview_path is null and preview_mime is null)
    or (
      preview_path is not null
      and preview_mime = 'application/pdf'
      and preview_path <> storage_path
      and char_length(preview_path) between 8 and 512
    )
  );

comment on column public.pre_evaluations.preview_path is
  'Private object key of the watermarked preview. Never the original upload path.';

-- The original upload stays capped at 10MB in the app. The watermarked copy can be larger.
update storage.buckets
set file_size_limit = 33554432
where id = 'pre-evaluations';

create table public.pre_evaluation_rate_windows (
  subject_hash text not null,
  kind text not null,
  window_start timestamptz not null,
  hit_count integer not null,
  primary key (subject_hash, kind, window_start),
  constraint pre_evaluation_rate_windows_kind_chk check (kind in ('upload', 'email', 'read')),
  constraint pre_evaluation_rate_windows_hash_chk check (char_length(subject_hash) = 64),
  constraint pre_evaluation_rate_windows_count_chk check (hit_count > 0)
);

alter table public.pre_evaluation_rate_windows enable row level security;

revoke all on table public.pre_evaluation_rate_windows from public, anon, authenticated;

grant select, insert, update, delete on table public.pre_evaluation_rate_windows to service_role;

comment on table public.pre_evaluation_rate_windows is
  'Short-window pre-evaluation counters. subject_hash is an ip hash or a token hash, never a raw address or token. Service role only.';

-- Null means the window is already full. A returned count means this hit was recorded.
create or replace function public.consume_pre_evaluation_rate_limit(
  p_subject_hash text,
  p_kind text,
  p_window_start timestamptz,
  p_max integer
) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  next_count integer;
begin
  if p_subject_hash is null or char_length(p_subject_hash) <> 64 then
    return null;
  end if;
  if p_kind is null or p_kind not in ('upload', 'email', 'read') then
    return null;
  end if;
  if p_max is null or p_max < 1 then
    return null;
  end if;

  delete from public.pre_evaluation_rate_windows
  where subject_hash = p_subject_hash
    and window_start < p_window_start - interval '1 day';

  with upsert as (
    insert into public.pre_evaluation_rate_windows as rate_window (subject_hash, kind, window_start, hit_count)
    values (p_subject_hash, p_kind, p_window_start, 1)
    on conflict (subject_hash, kind, window_start)
    do update set hit_count = rate_window.hit_count + 1
    where rate_window.hit_count < p_max
    returning hit_count
  )
  select hit_count into next_count from upsert;

  return next_count;
end;
$$;

revoke all on function public.consume_pre_evaluation_rate_limit(text, text, timestamptz, integer) from public, anon, authenticated;

grant execute on function public.consume_pre_evaluation_rate_limit(text, text, timestamptz, integer) to service_role;
