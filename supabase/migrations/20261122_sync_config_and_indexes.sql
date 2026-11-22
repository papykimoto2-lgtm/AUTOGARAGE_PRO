-- AutoGarage Pro — synchronisation : paramétrage de l'entreprise + index de réception incrémentale
-- À exécuter une fois dans Supabase → SQL Editor (projet AutoGarage). Sans danger si rejoué.

-- Paramétrage (une ligne « parametrage ») : lecture pour tous les rôles actifs, écriture administrateur
create table if not exists public.config (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.config enable row level security;

drop trigger if exists touch_config on public.config;
create trigger touch_config before update on public.config for each row execute function public.touch_updated_at();

drop policy if exists config_select on public.config;
drop policy if exists config_insert on public.config;
drop policy if exists config_update on public.config;
drop policy if exists config_delete on public.config;
create policy config_select on public.config for select to authenticated using ((select public.app_role()) is not null);
create policy config_insert on public.config for insert to authenticated with check ((select public.app_role()) = 'admin');
create policy config_update on public.config for update to authenticated using ((select public.app_role()) = 'admin') with check ((select public.app_role()) = 'admin');
create policy config_delete on public.config for delete to authenticated using ((select public.app_role()) = 'admin');
revoke all on public.config from anon;

-- Réception incrémentale (updated_at) : un index par table document
do $$
declare t text;
begin
  for t in select unnest(array['personnel','interventions','entretiens','diagnostics','stock','depots','stock_depots','catalogue','outillage','outillage_prets','requisitions','transferts','mvt_history','maint_prev','clients','vehicles','factures','lignes_facturation','transactions','recettes','depenses','sessions_caisse','factures_fourn','rdv','visites_techniques','flottes','contrats_fl','carburant_fl','commandes','fournisseurs','config'])
  loop
    execute format('create index if not exists %I on public.%I (updated_at)', t || '_updated_at_idx', t);
  end loop;
end $$;
