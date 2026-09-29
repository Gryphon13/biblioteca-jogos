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

-- ============================================================
-- Atualização de 29/09/2026: leitura pública e somente o dono edita.
-- (Já aplicada no projeto atual; mantenha aqui para recriar o banco.)
-- ============================================================
create table if not exists public.library_owner (
  singleton boolean primary key default true check (singleton),
  owner_id uuid not null references auth.users(id) on delete cascade
);
alter table public.library_owner enable row level security;
insert into public.library_owner (owner_id)
select id from auth.users order by created_at limit 1
on conflict (singleton) do nothing;

create schema if not exists private;
grant usage on schema private to anon, authenticated;
create or replace function private.is_library_owner(uid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.library_owner where owner_id = uid);
$$;
grant execute on function private.is_library_owner(uuid) to anon, authenticated;

grant select on public.games to anon;
create policy "Leitura pública da biblioteca do dono" on public.games
  for select to anon, authenticated using (private.is_library_owner(owner_id));
create policy "Somente o dono insere" on public.games as restrictive
  for insert to authenticated with check (private.is_library_owner((select auth.uid())));
create policy "Somente o dono edita" on public.games as restrictive
  for update to authenticated using (private.is_library_owner((select auth.uid())));
create policy "Somente o dono exclui" on public.games as restrictive
  for delete to authenticated using (private.is_library_owner((select auth.uid())));
create policy "Somente o dono envia capas" on storage.objects as restrictive
  for insert to authenticated with check (bucket_id <> 'covers' or private.is_library_owner((select auth.uid())));
create policy "Somente o dono altera capas" on storage.objects as restrictive
  for update to authenticated using (bucket_id <> 'covers' or private.is_library_owner((select auth.uid())));
create policy "Somente o dono apaga capas" on storage.objects as restrictive
  for delete to authenticated using (bucket_id <> 'covers' or private.is_library_owner((select auth.uid())));

-- Bloqueia novos cadastros depois que o dono existe.
-- Para recriar a conta do dono: drop trigger block_new_signups on auth.users;
create or replace function private.block_new_signups()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.library_owner) then
    raise exception 'Novos cadastros estão desativados nesta biblioteca';
  end if;
  return new;
end;
$$;
revoke all on function private.block_new_signups() from public, anon, authenticated;
drop trigger if exists block_new_signups on auth.users;
create trigger block_new_signups before insert on auth.users
  for each row execute function private.block_new_signups();
