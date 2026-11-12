-- Mes Finances : schéma de base de données et règles de sécurité (Supabase / PostgreSQL)
-- À exécuter une fois dans Supabase : SQL Editor > New query > coller > Run.
-- Principe : chaque utilisateur ne peut lire et modifier QUE ses propres lignes (Row Level Security).

-- ============ PROFIL (facultatif) ============
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  first_name  text check (char_length(first_name) <= 30),
  last_name   text check (char_length(last_name) <= 30),
  school      text not null default 'default' check (school ~ '^[a-z0-9-]{1,40}$'),
  school_name text check (char_length(school_name) <= 60),
  classe      text check (char_length(classe) <= 20),
  school_year text check (char_length(school_year) <= 9),
  photo       text check (photo is null or (photo like 'data:image/%' and char_length(photo) <= 80000)),
  use_charter boolean not null default true,
  custom      jsonb check (custom is null or pg_column_size(custom) <= 500),
  updated_at  timestamptz not null default now()
);

-- ============ TRANSACTIONS ============
create table if not exists public.transactions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type       text not null check (type in ('expense', 'income')),
  amount     numeric(14, 2) not null check (amount > 0 and amount < 1000000000000),
  account    text not null check (account in ('Orange Money', 'Wave', 'Yas Money', 'Espèces')),
  category   text not null check (category in ('Alimentation', 'Transport', 'Logement', 'Santé', 'Loisirs', 'Facture', 'Salaire', 'Épargne', 'Autre')),
  label      text check (char_length(label) <= 80),
  date       timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists transactions_user_date_idx on public.transactions (user_id, date desc);

-- ============ OBJECTIF D'ÉPARGNE (un par utilisateur) ============
create table if not exists public.goals (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  target  numeric(14, 2) not null check (target > 0 and target < 1000000000000),
  saved   numeric(14, 2) not null check (saved >= 0 and saved < 1000000000000)
);

-- ============ SÉCURITÉ : RLS + droits minimaux ============
alter table public.profiles     enable row level security;
alter table public.transactions enable row level security;
alter table public.goals        enable row level security;

-- Personne de non connecté (rôle "anon") n'a aucun droit sur ces tables.
revoke all on public.profiles, public.transactions, public.goals from anon;
revoke all on public.profiles, public.transactions, public.goals from authenticated;
grant select, insert, update, delete on public.profiles, public.transactions, public.goals to authenticated;

-- Chaque policy compare la ligne à l'utilisateur connecté : (select auth.uid()).
drop policy if exists profiles_own on public.profiles;
create policy profiles_own on public.profiles for all to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

drop policy if exists transactions_select_own on public.transactions;
drop policy if exists transactions_insert_own on public.transactions;
drop policy if exists transactions_update_own on public.transactions;
drop policy if exists transactions_delete_own on public.transactions;
create policy transactions_select_own on public.transactions for select to authenticated using ((select auth.uid()) = user_id);
create policy transactions_insert_own on public.transactions for insert to authenticated with check ((select auth.uid()) = user_id);
create policy transactions_update_own on public.transactions for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy transactions_delete_own on public.transactions for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists goals_own on public.goals;
create policy goals_own on public.goals for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ============ SUPPRESSION DU COMPTE (droit à l'effacement) ============
-- L'utilisateur supprime LUI-MÊME son compte ; les tables ci-dessus se vident en cascade.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from auth.users where id = auth.uid();
end;
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ============ VÉRIFICATION (le résultat s'affiche sous l'éditeur) ============
-- Les 3 lignes doivent afficher rls_active = true. Si ce n'est pas le cas, relancez tout le fichier.
select c.relname as table_name, c.relrowsecurity as rls_active
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('profiles', 'transactions', 'goals')
order by c.relname;

-- Facultatif (à lancer séparément) : lister les règles d'accès.
--   select tablename, policyname, roles, cmd from pg_policies where schemaname = 'public' order by tablename;
