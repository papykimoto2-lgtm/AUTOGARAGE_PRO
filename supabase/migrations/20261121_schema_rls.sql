-- AutoGarage Pro — schéma de base (déjà appliqué au projet : conservé ici pour la documentation et les tests)
-- Profils utilisateurs (rôles vérifiés côté serveur)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  login text unique not null,
  nom text,
  role text not null default 'meca' check (role in ('admin','chef','meca','caissier','custom')),
  pages jsonb,
  statut text not null default 'actif' check (statut in ('actif','inactif')),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create or replace function public.app_role()
returns text language sql stable security definer set search_path = ''
as $$ select role from public.profiles where id = (select auth.uid()) and statut = 'actif' $$;
revoke all on function public.app_role() from public, anon;
grant execute on function public.app_role() to authenticated;

drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_insert on public.profiles;
drop policy if exists profiles_update on public.profiles;
drop policy if exists profiles_delete on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (id = (select auth.uid()) or (select public.app_role()) = 'admin');
create policy profiles_insert on public.profiles for insert to authenticated with check ((select public.app_role()) = 'admin');
create policy profiles_update on public.profiles for update to authenticated using ((select public.app_role()) = 'admin') with check ((select public.app_role()) = 'admin');
create policy profiles_delete on public.profiles for delete to authenticated using ((select public.app_role()) = 'admin' and id <> (select auth.uid()));
revoke all on public.profiles from anon;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;

-- Tables « document » : id texte + données JSON + horodatage
do $$
declare
  cfg jsonb := '{
    "atelier":    {"read":["admin","chef","meca","caissier","custom"], "write":["admin","chef","meca","custom"],
                   "tables":["interventions","entretiens","diagnostics","stock","depots","stock_depots","catalogue","outillage","outillage_prets","requisitions","transferts","mvt_history","maint_prev"]},
    "commercial": {"read":["admin","chef","meca","caissier","custom"], "write":["admin","chef","custom"],
                   "tables":["rdv","visites_techniques","flottes","contrats_fl","carburant_fl","commandes","fournisseurs"]},
    "clients":    {"read":["admin","chef","meca","caissier","custom"], "write":["admin","chef","meca","caissier","custom"],
                   "tables":["clients","vehicles"]},
    "finance":    {"read":["admin","chef","caissier","custom"], "write":["admin","caissier","custom"],
                   "tables":["factures","lignes_facturation","transactions","recettes","depenses","sessions_caisse","factures_fourn"]},
    "rh":         {"read":["admin","chef"], "write":["admin","chef"], "tables":["personnel"]}
  }';
  g text; t text; rd text[]; wr text[];
begin
  for g in select jsonb_object_keys(cfg) loop
    select array(select jsonb_array_elements_text(cfg->g->'read'))  into rd;
    select array(select jsonb_array_elements_text(cfg->g->'write')) into wr;
    for t in select jsonb_array_elements_text(cfg->g->'tables') loop
      execute format('create table if not exists public.%I (id text primary key, data jsonb not null default ''{}''::jsonb, updated_at timestamptz not null default now())', t);
      execute format('alter table public.%I enable row level security', t);
      execute format('drop trigger if exists touch_%1$s on public.%1$I', t);
      execute format('create trigger touch_%1$s before update on public.%1$I for each row execute function public.touch_updated_at()', t);
      execute format('drop policy if exists %I on public.%I', t||'_select', t);
      execute format('drop policy if exists %I on public.%I', t||'_insert', t);
      execute format('drop policy if exists %I on public.%I', t||'_update', t);
      execute format('drop policy if exists %I on public.%I', t||'_delete', t);
      execute format('create policy %I on public.%I for select to authenticated using ((select public.app_role()) = any (%L::text[]))', t||'_select', t, rd);
      execute format('create policy %I on public.%I for insert to authenticated with check ((select public.app_role()) = any (%L::text[]))', t||'_insert', t, wr);
      execute format('create policy %I on public.%I for update to authenticated using ((select public.app_role()) = any (%L::text[])) with check ((select public.app_role()) = any (%L::text[]))', t||'_update', t, wr, wr);
      execute format('create policy %I on public.%I for delete to authenticated using ((select public.app_role()) = any (%L::text[]))', t||'_delete', t, wr);
      execute format('revoke all on public.%I from anon', t);
    end loop;
  end loop;
end $$;
