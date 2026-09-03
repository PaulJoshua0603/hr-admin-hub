create table if not exists app_store (
  key text primary key,
  value jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table app_store enable row level security;

create policy "allow all on app_store"
  on app_store
  for all
  using (true)
  with check (true);

-- Files section: storage bucket for uploaded documents/pictures
insert into storage.buckets (id, name, public)
values ('files', 'files', false)
on conflict (id) do nothing;

drop policy if exists "files bucket - authenticated read" on storage.objects;
create policy "files bucket - authenticated read"
  on storage.objects for select
  using (bucket_id = 'files' and auth.role() = 'authenticated');

drop policy if exists "files bucket - authenticated write" on storage.objects;
create policy "files bucket - authenticated write"
  on storage.objects for insert
  with check (bucket_id = 'files' and auth.role() = 'authenticated');

drop policy if exists "files bucket - authenticated update" on storage.objects;
create policy "files bucket - authenticated update"
  on storage.objects for update
  using (bucket_id = 'files' and auth.role() = 'authenticated');

drop policy if exists "files bucket - authenticated delete" on storage.objects;
create policy "files bucket - authenticated delete"
  on storage.objects for delete
  using (bucket_id = 'files' and auth.role() = 'authenticated');
