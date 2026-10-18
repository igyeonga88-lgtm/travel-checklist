-- Run once in your Supabase project's SQL Editor. No keys or passwords belong here.
-- The same authenticated account sees the same single trip on all devices.
create table if not exists public.travel_documents (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 5242880),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);
alter table public.travel_documents enable row level security;
revoke all on public.travel_documents from anon;
grant select, insert, update on public.travel_documents to authenticated;
drop policy if exists "own trip only" on public.travel_documents;
create policy "own trip only" on public.travel_documents for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Atomic compare-and-swap: a stale device can never silently replace newer data.
create or replace function public.save_travel_document(expected_revision bigint, document jsonb)
returns setof public.travel_documents language plpgsql security invoker set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if expected_revision = 0 then
    return query insert into public.travel_documents(user_id, data)
      values(auth.uid(), document) on conflict(user_id) do nothing returning *;
  else
    return query update public.travel_documents set data = document,
      revision = revision + 1, updated_at = now()
      where user_id = auth.uid() and revision = expected_revision returning *;
  end if;
  if not found then raise exception 'Concurrent update' using errcode = '40001'; end if;
end $$;
revoke all on function public.save_travel_document(bigint, jsonb) from public, anon;
grant execute on function public.save_travel_document(bigint, jsonb) to authenticated;
