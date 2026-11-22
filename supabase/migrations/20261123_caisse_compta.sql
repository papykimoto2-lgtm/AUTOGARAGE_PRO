-- AutoGarage Pro — Caisse validée par la hiérarchie + Comptabilité
-- À exécuter dans Supabase → SQL Editor, APRÈS 20261121_schema_rls.sql et 20261122_sync_config_and_indexes.sql. Rejouable sans danger.
--
-- Ce que le serveur garantit (en plus des contrôles de l'application) :
--   • un bon de caisse est créé « en attente » par son demandeur ;
--   • seule la hiérarchie décide, dans la limite de son plafond, jamais sur sa propre demande (si « séparation stricte ») ;
--   • une décision est définitive ; un bon décidé n'est plus modifiable (sauf remise / contre-passation / ventilation) ;
--   • une écriture est équilibrée (≥ 2 lignes) ; une pièce visée est intangible (sauf levée de visa par l'administrateur) ;
--   • un exercice clos est verrouillé ; un compte utilisé ne se supprime pas.

-- 1. Nouveau rôle « comptable »
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin','chef','meca','caissier','custom','comptable'));

-- 2. Identité de l'utilisateur connecté
create or replace function public.app_login()
returns text language sql stable security definer set search_path = ''
as $$ select login from public.profiles where id = (select auth.uid()) and statut = 'actif' $$;
revoke all on function public.app_login() from public, anon;
grant execute on function public.app_login() to authenticated;

-- 3. Nouvelles tables document
do $$
declare t text;
begin
  foreach t in array array['bons_caisse','ecritures','comptes','exercices'] loop
    execute format('create table if not exists public.%I (id text primary key, data jsonb not null default ''{}''::jsonb, updated_at timestamptz not null default now())', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop trigger if exists touch_%1$s on public.%1$I', t);
    execute format('create trigger touch_%1$s before update on public.%1$I for each row execute function public.touch_updated_at()', t);
    execute format('create index if not exists %I on public.%I (updated_at)', t||'_updated_at_idx', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- 4. Droits d'accès par table (remplace les politiques précédentes)
do $$
declare
  cfg jsonb := '{
    "bons_caisse":        {"read":["admin","chef","comptable","caissier"], "ins":["admin","chef","comptable","caissier"], "upd":["admin","chef","comptable","caissier"], "del":["admin","chef","comptable","caissier"]},
    "ecritures":          {"read":["admin","chef","comptable"],            "ins":["admin","comptable"],                  "upd":["admin","chef","comptable"],            "del":["admin","comptable"]},
    "comptes":            {"read":["admin","chef","comptable"],            "ins":["admin","comptable"],                  "upd":["admin","comptable"],                   "del":["admin","comptable"]},
    "exercices":          {"read":["admin","chef","comptable"],            "ins":["admin","comptable"],                  "upd":["admin"],                               "del":["admin"]},

    "interventions":      {"read":["admin","chef","meca","caissier","custom","comptable"], "ins":["admin","chef","meca","custom"], "upd":["admin","chef","meca","custom"], "del":["admin","chef","meca","custom"]},
    "entretiens":         {"read":["admin","chef","meca","caissier","custom","comptable"], "ins":["admin","chef","meca","custom"], "upd":["admin","chef","meca","custom"], "del":["admin","chef","meca","custom"]},
    "diagnostics":        {"read":["admin","chef","meca","caissier","custom","comptable"], "ins":["admin","chef","meca","custom"], "upd":["admin","chef","meca","custom"], "del":["admin","chef","meca","custom"]},
    "stock":              {"read":["admin","chef","meca","caissier","custom","comptable"], "ins":["admin","chef","meca","custom"], "upd":["admin","chef","meca","custom"], "del":["admin","chef","meca","custom"]},
    "depots":             {"read":["admin","chef","meca","caissier","custom","comptable"], "ins":["admin","chef","meca","custom"], "upd":["admin","chef","meca","custom"], "del":["admin","chef","meca","custom"]},
    "stock_depots":       {"read":["admin","chef","meca","caissier","custom","comptable"], "ins":["admin","chef","meca","custom"], "upd":["admin","chef","meca","custom"], "del":["admin","chef","meca","custom"]},
    "catalogue":          {"read":["admin","chef","meca","caissier","custom","comptable"], "ins":["admin","chef","meca","custom"], "upd":["admin","chef","meca","custom"], "del":["admin","chef","meca","custom"]},
    "outillage":          {"read":["admin","chef","meca","caissier","custom","comptable"], "ins":["admin","chef","meca","custom"], "upd":["admin","chef","meca","custom"], "del":["admin","chef","meca","custom"]},
    "outillage_prets":    {"read":["admin","chef","meca","caissier","custom","comptable"], "ins":["admin","chef","meca","custom"], "upd":["admin","chef","meca","custom"], "del":["admin","chef","meca","custom"]},
    "requisitions":       {"read":["admin","chef","meca","caissier","custom","comptable"], "ins":["admin","chef","meca","custom"], "upd":["admin","chef","meca","custom"], "del":["admin","chef","meca","custom"]},
    "transferts":         {"read":["admin","chef","meca","caissier","custom","comptable"], "ins":["admin","chef","meca","custom"], "upd":["admin","chef","meca","custom"], "del":["admin","chef","meca","custom"]},
    "mvt_history":        {"read":["admin","chef","meca","caissier","custom","comptable"], "ins":["admin","chef","meca","custom"], "upd":["admin","chef","meca","custom"], "del":["admin","chef","meca","custom"]},
    "maint_prev":         {"read":["admin","chef","meca","caissier","custom","comptable"], "ins":["admin","chef","meca","custom"], "upd":["admin","chef","meca","custom"], "del":["admin","chef","meca","custom"]},

    "rdv":                {"read":["admin","chef","meca","caissier","custom","comptable"], "ins":["admin","chef","custom"], "upd":["admin","chef","custom"], "del":["admin","chef","custom"]},
    "visites_techniques": {"read":["admin","chef","meca","caissier","custom","comptable"], "ins":["admin","chef","custom"], "upd":["admin","chef","custom"], "del":["admin","chef","custom"]},
    "flottes":            {"read":["admin","chef","meca","caissier","custom","comptable"], "ins":["admin","chef","custom"], "upd":["admin","chef","custom"], "del":["admin","chef","custom"]},
    "contrats_fl":        {"read":["admin","chef","meca","caissier","custom","comptable"], "ins":["admin","chef","custom"], "upd":["admin","chef","custom"], "del":["admin","chef","custom"]},
    "carburant_fl":       {"read":["admin","chef","meca","caissier","custom","comptable"], "ins":["admin","chef","custom"], "upd":["admin","chef","custom"], "del":["admin","chef","custom"]},
    "commandes":          {"read":["admin","chef","meca","caissier","custom","comptable"], "ins":["admin","chef","custom","comptable"], "upd":["admin","chef","custom","comptable"], "del":["admin","chef","custom","comptable"]},
    "fournisseurs":       {"read":["admin","chef","meca","caissier","custom","comptable"], "ins":["admin","chef","custom","comptable"], "upd":["admin","chef","custom","comptable"], "del":["admin","chef","custom","comptable"]},

    "clients":            {"read":["admin","chef","meca","caissier","custom","comptable"], "ins":["admin","chef","meca","caissier","custom"], "upd":["admin","chef","meca","caissier","custom"], "del":["admin","chef","meca","caissier","custom"]},
    "vehicles":           {"read":["admin","chef","meca","caissier","custom","comptable"], "ins":["admin","chef","meca","caissier","custom"], "upd":["admin","chef","meca","caissier","custom"], "del":["admin","chef","meca","caissier","custom"]},

    "factures":           {"read":["admin","chef","caissier","custom","comptable"], "ins":["admin","caissier","custom","comptable"], "upd":["admin","caissier","custom","comptable"], "del":["admin","caissier","custom","comptable"]},
    "lignes_facturation": {"read":["admin","chef","caissier","custom","comptable"], "ins":["admin","caissier","custom","comptable"], "upd":["admin","caissier","custom","comptable"], "del":["admin","caissier","custom","comptable"]},
    "recettes":           {"read":["admin","chef","caissier","custom","comptable"], "ins":["admin","caissier","custom","comptable"], "upd":["admin","caissier","custom","comptable"], "del":["admin","caissier","custom","comptable"]},
    "transactions":       {"read":["admin","chef","caissier","custom","comptable"], "ins":["admin","chef","caissier","custom","comptable"], "upd":["admin","chef","caissier","custom","comptable"], "del":["admin","chef","caissier","custom","comptable"]},
    "depenses":           {"read":["admin","chef","caissier","custom","comptable"], "ins":["admin","chef","caissier","custom","comptable"], "upd":["admin","chef","caissier","custom","comptable"], "del":["admin","chef","caissier","custom","comptable"]},
    "sessions_caisse":    {"read":["admin","chef","caissier","custom","comptable"], "ins":["admin","chef","caissier","custom","comptable"], "upd":["admin","chef","caissier","custom","comptable"], "del":["admin","chef","caissier","custom","comptable"]},
    "factures_fourn":     {"read":["admin","chef","caissier","custom","comptable"], "ins":["admin","chef","caissier","custom","comptable"], "upd":["admin","chef","caissier","custom","comptable"], "del":["admin","chef","caissier","custom","comptable"]},

    "personnel":          {"read":["admin","chef"], "ins":["admin","chef"], "upd":["admin","chef"], "del":["admin","chef"]},
    "config":             {"read":["admin","chef","meca","caissier","custom","comptable"], "ins":["admin"], "upd":["admin"], "del":["admin"]}
  }';
  t text; rd text[]; ins text[]; upd text[]; del text[];
begin
  for t in select jsonb_object_keys(cfg) loop
    select array(select jsonb_array_elements_text(cfg->t->'read')) into rd;
    select array(select jsonb_array_elements_text(cfg->t->'ins'))  into ins;
    select array(select jsonb_array_elements_text(cfg->t->'upd'))  into upd;
    select array(select jsonb_array_elements_text(cfg->t->'del'))  into del;
    execute format('drop policy if exists %I on public.%I', t||'_select', t);
    execute format('drop policy if exists %I on public.%I', t||'_insert', t);
    execute format('drop policy if exists %I on public.%I', t||'_update', t);
    execute format('drop policy if exists %I on public.%I', t||'_delete', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.app_role()) = any (%L::text[]))', t||'_select', t, rd);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select public.app_role()) = any (%L::text[]))', t||'_insert', t, ins);
    execute format('create policy %I on public.%I for update to authenticated using ((select public.app_role()) = any (%L::text[])) with check ((select public.app_role()) = any (%L::text[]))', t||'_update', t, upd, upd);
    execute format('create policy %I on public.%I for delete to authenticated using ((select public.app_role()) = any (%L::text[]))', t||'_delete', t, del);
  end loop;
end $$;

-- 5. Contrôles de la hiérarchie sur les bons de caisse
create or replace function public.bons_guard()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  cfg jsonb; v_role text := public.app_role(); v_login text := public.app_login();
  old_st text; new_st text; v_strict boolean; montant numeric; plaf text; allowed boolean;
  keep text[] := array['remise','contrepasse','ventile'];
begin
  if tg_op = 'DELETE' then
    if (old.data->>'statut') <> 'attente' then raise exception 'Un bon décidé ne se supprime pas.'; end if;
    if v_role is distinct from 'admin' and (old.data->>'demandeur_login') is distinct from v_login then raise exception 'Seul l''auteur ou un administrateur peut supprimer ce bon.'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if (new.data->>'statut') is distinct from 'attente' then raise exception 'Un bon est créé « en attente de validation ».'; end if;
    if (new.data->>'demandeur_login') is distinct from v_login then raise exception 'Le demandeur doit être l''utilisateur connecté.'; end if;
    if coalesce((new.data->>'montant')::numeric, 0) <= 0 then raise exception 'Le montant doit être supérieur à zéro.'; end if;
    return new;
  end if;

  old_st := old.data->>'statut'; new_st := new.data->>'statut';
  if old_st in ('valide','rejete') then
    if new_st is distinct from old_st then raise exception 'Décision définitive : un bon % ne change plus de statut.', old_st; end if;
    if (new.data - keep) is distinct from (old.data - keep) then raise exception 'Un bon décidé ne se modifie plus.'; end if;
    return new;
  end if;

  -- bon en attente
  if new_st is not distinct from 'attente' then return new; end if;             -- modification de son propre bon
  if new_st = 'rejete' and (old.data->>'demandeur_login') = v_login and (new.data->>'decideur_login') = v_login then return new;   -- retrait par l'auteur
  end if;
  select data into cfg from public.config where id = 'habilitations';
  if (new.data->>'decideur_login') is distinct from v_login then raise exception 'Le décideur doit être l''utilisateur connecté.'; end if;
  if v_role = 'admin' then allowed := true;
  elsif cfg is null or not (coalesce(cfg->'roles', '{}'::jsonb) ? v_role) then allowed := v_role = 'chef';
  else allowed := coalesce((cfg->'roles'->v_role->>'caisseValider')::int, 0) = 1;
  end if;
  if not allowed then raise exception 'Seule la hiérarchie décide des bons de caisse.'; end if;
  v_strict := coalesce((cfg->>'strict')::boolean, true);
  if v_strict and (old.data->>'demandeur_login') = v_login then raise exception 'On ne valide jamais sa propre demande.'; end if;
  if new_st = 'rejete' and btrim(coalesce(new.data->>'motifRejet', '')) = '' then raise exception 'Le motif du rejet est obligatoire.'; end if;
  if v_role <> 'admin' then
    if cfg is not null and (coalesce(cfg->'plafonds', '{}'::jsonb) ? v_role) then plaf := cfg->'plafonds'->>v_role;
    elsif cfg is null or not (coalesce(cfg->'plafonds', '{}'::jsonb) ? v_role) then plaf := case v_role when 'chef' then '100000' when 'comptable' then '0' else '0' end;
    end if;
    montant := (old.data->>'montant')::numeric;
    if plaf is not null and plaf <> '' and (plaf::numeric = 0 or montant > plaf::numeric) then raise exception 'Montant supérieur à votre plafond de validation.'; end if;
  end if;
  return new;
end $$;
drop trigger if exists bons_guard_trg on public.bons_caisse;
create trigger bons_guard_trg before insert or update or delete on public.bons_caisse for each row execute function public.bons_guard();

-- 6. Contrôles comptables
create or replace function public.ecr_equilibree(lignes jsonb)
returns boolean language sql immutable set search_path = ''
as $$
  select jsonb_typeof(lignes) = 'array' and jsonb_array_length(lignes) >= 2
     and coalesce((select sum(coalesce((l->>'debit')::numeric, 0)) from jsonb_array_elements(lignes) l), 0)
       = coalesce((select sum(coalesce((l->>'credit')::numeric, 0)) from jsonb_array_elements(lignes) l), 0)
     and coalesce((select sum(coalesce((l->>'debit')::numeric, 0)) from jsonb_array_elements(lignes) l), 0) > 0
$$;

create or replace function public.ecritures_guard()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  cfg jsonb; v_role text := public.app_role(); v_login text := public.app_login();
  ex text; ex_st text; old_st text; new_st text; v_strict boolean; montant numeric; plaf text; allowed boolean;
  keep text[] := array['contrepasse','anomalie'];
begin
  if tg_op = 'DELETE' then ex := old.data->>'exercice'; else ex := new.data->>'exercice'; end if;
  select data->>'statut' into ex_st from public.exercices where id = ex;
  if ex_st = 'clos' then raise exception 'L''exercice % est clos : aucune écriture ne peut être créée, modifiée ni supprimée.', ex; end if;

  if tg_op = 'DELETE' then
    if (old.data->>'statut') = 'vise' then raise exception 'Une pièce visée ne se supprime pas : contre-passez-la.'; end if;
    return old;
  end if;

  if not public.ecr_equilibree(new.data->'lignes') then raise exception 'Écriture déséquilibrée (débit ≠ crédit) ou de moins de deux lignes.'; end if;

  if tg_op = 'INSERT' then
    if (new.data->>'statut') = 'vise' and not (new.data->>'journal' = 'AN' and v_role = 'admin') then raise exception 'Une écriture est créée au brouillard ; le visa est un acte distinct.'; end if;
    return new;
  end if;

  old_st := old.data->>'statut'; new_st := new.data->>'statut';
  if old_st = 'vise' then
    if new_st = 'brouillard' then
      if v_role is distinct from 'admin' then raise exception 'La levée d''un visa est réservée à l''administrateur.'; end if;
      return new;
    end if;
    if (new.data - keep) is distinct from (old.data - keep) then raise exception 'Une pièce visée est intangible : contre-passez-la.'; end if;
    return new;
  end if;

  if new_st = 'vise' then
    select data into cfg from public.config where id = 'habilitations';
    if v_role = 'admin' then allowed := true;
    elsif cfg is null or not (coalesce(cfg->'roles', '{}'::jsonb) ? v_role) then allowed := false;
    else allowed := coalesce((cfg->'roles'->v_role->>'comptaViser')::int, 0) = 1;
    end if;
    if not allowed then raise exception 'Le visa est réservé à la hiérarchie comptable.'; end if;
    if (new.data->>'viseur_login') is distinct from v_login then raise exception 'Le viseur doit être l''utilisateur connecté.'; end if;
    v_strict := coalesce((cfg->>'strict')::boolean, true);
    if v_strict and (new.data->>'auteur_login') = v_login then raise exception 'On ne vise jamais sa propre saisie.'; end if;
    if v_role <> 'admin' then
      if cfg is not null and (coalesce(cfg->'plafonds', '{}'::jsonb) ? v_role) then plaf := cfg->'plafonds'->>v_role; else plaf := '0'; end if;
      select sum(coalesce((l->>'debit')::numeric, 0)) into montant from jsonb_array_elements(new.data->'lignes') l;
      if plaf is not null and plaf <> '' and (plaf::numeric = 0 or montant > plaf::numeric) then raise exception 'Montant supérieur à votre plafond de visa.'; end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists ecritures_guard_trg on public.ecritures;
create trigger ecritures_guard_trg before insert or update or delete on public.ecritures for each row execute function public.ecritures_guard();

create or replace function public.comptes_guard()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.ecritures e where e.data->'lignes' @> jsonb_build_array(jsonb_build_object('compte', old.id))) then
      raise exception 'Le compte % est utilisé par des écritures : il ne se supprime pas.', old.id;
    end if;
    return old;
  end if;
  return new;
end $$;
drop trigger if exists comptes_guard_trg on public.comptes;
create trigger comptes_guard_trg before delete on public.comptes for each row execute function public.comptes_guard();

-- Pas d'exécution directe des fonctions de contrôle par les utilisateurs
revoke all on function public.bons_guard() from public, anon, authenticated;
revoke all on function public.ecritures_guard() from public, anon, authenticated;
revoke all on function public.comptes_guard() from public, anon, authenticated;
