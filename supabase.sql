-- Execute no SQL Editor do seu projeto Supabase, uma única vez.
create table if not exists public.games (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);

alter table public.games enable row level security;
grant select, insert, update, delete on public.games to authenticated;

create policy "Ler apenas meus jogos" on public.games
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Inserir apenas meus jogos" on public.games
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "Editar apenas meus jogos" on public.games
  for update to authenticated using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy "Excluir apenas meus jogos" on public.games
  for delete to authenticated using ((select auth.uid()) = owner_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('covers', 'covers', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy "Enviar capas na minha pasta" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'covers' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Editar capas na minha pasta" on storage.objects
  for update to authenticated
  using (bucket_id = 'covers' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'covers' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Excluir capas na minha pasta" on storage.objects
  for delete to authenticated
  using (bucket_id = 'covers' and (storage.foldername(name))[1] = (select auth.uid())::text);
