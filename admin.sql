-- Mes Finances : ESPACE ADMINISTRATEUR (à exécuter APRÈS schema.sql)
-- Supabase : SQL Editor > New query > coller tout le fichier > Run. Le fichier peut être relancé sans risque.
--
-- Principe de sécurité :
--  * le droit d'administrateur est vérifié PAR LA BASE à chaque appel (fonction is_admin) ; l'écran ne fait que l'afficher ;
--  * aucune clé secrète dans l'application : tout passe par des fonctions que seuls les administrateurs peuvent exécuter ;
--  * l'espace n'affiche JAMAIS les montants, comptes, catégories ni notes des transactions (uniquement des nombres) ;
--  * toute suspension / suppression est enregistrée dans un journal (admin_audit), que personne ne peut modifier.

-- ============ TABLES ============
create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  note       text check (char_length(note) <= 100),
  created_at timestamptz not null default now()
);
create table if not exists public.admin_audit (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  admin_id    uuid not null,                       -- volontairement sans clé étrangère : l'historique survit à la suppression d'un compte
  admin_email text,
  action      text not null check (action in ('ban', 'unban', 'delete_user')),
  target_id   uuid,
  target_email text
);

-- Personne (ni visiteur, ni utilisateur connecté) n'accède directement à ces tables : uniquement via les fonctions ci-dessous.
alter table public.admins      enable row level security;
alter table public.admin_audit enable row level security;
revoke all on public.admins, public.admin_audit from anon, authenticated;

-- ============ CONTRÔLE D'ACCÈS ============
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins a where a.user_id = (select auth.uid()));
$$;

create or replace function public.require_admin() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
end;
$$;

-- ============ STATISTIQUES GLOBALES (nombres uniquement) ============
create or replace function public.admin_stats() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return jsonb_build_object(
    'users_total',     (select count(*) from auth.users),
    'users_confirmed', (select count(*) from auth.users where email_confirmed_at is not null),
    'users_banned',    (select count(*) from auth.users where banned_until is not null and banned_until > now()),
    'new_7d',          (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'new_30d',         (select count(*) from auth.users where created_at > now() - interval '30 days'),
    'active_7d',       (select count(*) from auth.users where last_sign_in_at > now() - interval '7 days'),
    'active_30d',      (select count(*) from auth.users where last_sign_in_at > now() - interval '30 days'),
    'tx_total',        (select count(*) from public.transactions),
    'tx_7d',           (select count(*) from public.transactions where created_at > now() - interval '7 days')
  );
end;
$$;

create or replace function public.admin_series(p_days int default 14)
returns table (out_day date, out_signups bigint, out_tx bigint)
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  p_days := least(greatest(coalesce(p_days, 14), 1), 90);
  return query
    select d::date,
           (select count(*) from auth.users u where u.created_at::date = d::date),
           (select count(*) from public.transactions t where t.created_at::date = d::date)
    from generate_series((current_date - (p_days - 1))::timestamp, current_date::timestamp, interval '1 day') d
    order by 1;
end;
$$;

create or replace function public.admin_schools()
returns table (out_school text, out_n bigint)
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return query
    select case when p.school = 'custom' then coalesce(nullif(trim(p.school_name), ''), 'Autre établissement')
                when p.school is null or p.school = 'default' then null
                else p.school end,
           count(*)
    from auth.users u left join public.profiles p on p.id = u.id
    group by 1 order by 2 desc limit 20;
end;
$$;

-- ============ LISTE DES COMPTES (jamais de montants) ============
create or replace function public.admin_list_users(p_search text default '', p_limit int default 20, p_offset int default 0)
returns table (out_id uuid, out_email text, out_created timestamptz, out_last_login timestamptz, out_confirmed boolean,
               out_banned boolean, out_admin boolean, out_first text, out_school text, out_school_name text, out_classe text,
               out_tx bigint, out_total bigint)
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  p_limit  := least(greatest(coalesce(p_limit, 20), 1), 50);
  p_offset := greatest(coalesce(p_offset, 0), 0);
  return query
    select u.id, u.email::text, u.created_at, u.last_sign_in_at, (u.email_confirmed_at is not null),
           (u.banned_until is not null and u.banned_until > now()),
           exists (select 1 from public.admins a where a.user_id = u.id),
           p.first_name, p.school, p.school_name, p.classe,
           (select count(*) from public.transactions t where t.user_id = u.id),
           count(*) over ()
    from auth.users u left join public.profiles p on p.id = u.id
    where coalesce(p_search, '') = ''
       or u.email ilike '%' || replace(replace(replace(left(p_search, 80), '%', ''), '_', ''), '\', '') || '%'
    order by u.created_at desc
    limit p_limit offset p_offset;
end;
$$;

-- ============ ACTIONS (journalisées) ============
create or replace function public.admin_set_banned(p_target uuid, p_banned boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_email text; v_me uuid := (select auth.uid());
begin
  perform public.require_admin();
  if p_target = v_me then raise exception 'cannot_target_self'; end if;
  if exists (select 1 from public.admins where user_id = p_target) then raise exception 'cannot_target_admin'; end if;
  select email into v_email from auth.users where id = p_target;
  if v_email is null then raise exception 'not_found'; end if;
  update auth.users set banned_until = case when p_banned then 'infinity'::timestamptz else null end where id = p_target;
  if p_banned then delete from auth.sessions where user_id = p_target; end if;   -- coupe les sessions actives
  insert into public.admin_audit (admin_id, admin_email, action, target_id, target_email)
    values (v_me, (select email from auth.users where id = v_me), case when p_banned then 'ban' else 'unban' end, p_target, v_email);
end;
$$;

create or replace function public.admin_delete_user(p_target uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_email text; v_me uuid := (select auth.uid());
begin
  perform public.require_admin();
  if p_target = v_me then raise exception 'cannot_target_self'; end if;
  if exists (select 1 from public.admins where user_id = p_target) then raise exception 'cannot_target_admin'; end if;
  select email into v_email from auth.users where id = p_target;
  if v_email is null then raise exception 'not_found'; end if;
  delete from auth.users where id = p_target;                                       -- les données du compte sont supprimées en cascade
  insert into public.admin_audit (admin_id, admin_email, action, target_id, target_email)
    values (v_me, (select email from auth.users where id = v_me), 'delete_user', p_target, v_email);
end;
$$;

create or replace function public.admin_audit_list(p_limit int default 50)
returns table (out_at timestamptz, out_admin text, out_action text, out_target text)
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return query select a.at, a.admin_email, a.action, a.target_email
               from public.admin_audit a order by a.at desc limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

-- ============ DROITS D'EXÉCUTION : uniquement les utilisateurs connectés (les non-admins reçoivent « forbidden ») ============
revoke all on function public.is_admin()                       from public, anon;
revoke all on function public.require_admin()                  from public, anon, authenticated;
revoke all on function public.admin_stats()                    from public, anon;
revoke all on function public.admin_series(int)                from public, anon;
revoke all on function public.admin_schools()                  from public, anon;
revoke all on function public.admin_list_users(text, int, int) from public, anon;
revoke all on function public.admin_set_banned(uuid, boolean)  from public, anon;
revoke all on function public.admin_delete_user(uuid)          from public, anon;
revoke all on function public.admin_audit_list(int)            from public, anon;
grant execute on function public.is_admin()                       to authenticated;
grant execute on function public.admin_stats()                    to authenticated;
grant execute on function public.admin_series(int)                to authenticated;
grant execute on function public.admin_schools()                  to authenticated;
grant execute on function public.admin_list_users(text, int, int) to authenticated;
grant execute on function public.admin_set_banned(uuid, boolean)  to authenticated;
grant execute on function public.admin_delete_user(uuid)          to authenticated;
grant execute on function public.admin_audit_list(int)            to authenticated;

-- ============ DÉSIGNER LE PREMIER ADMINISTRATEUR ============
-- 1) Créez d'abord votre compte normalement dans l'application (et confirmez votre e-mail).
-- 2) Remplacez l'adresse ci-dessous par la vôtre, ENLEVEZ les deux tirets du début de la ligne "insert", puis lancez-la :
-- insert into public.admins (user_id, note) select id, 'propriétaire' from auth.users where email = 'votre.adresse@exemple.sn';
--
-- Pour retirer un administrateur :
-- delete from public.admins where user_id = (select id from auth.users where email = 'adresse@exemple.sn');

-- ============ VÉRIFICATION (le résultat s'affiche sous l'éditeur) ============
-- Doit afficher 2 lignes avec rls_active = true.
select c.relname as table_name, c.relrowsecurity as rls_active
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('admins', 'admin_audit')
order by c.relname;
