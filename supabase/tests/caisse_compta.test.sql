-- Test des règles serveur « caisse validée par la hiérarchie + comptabilité ».
-- Usage (base de test avec les 3 migrations appliquées + environnement auth minimal) : psql -f supabase/tests/caisse_compta.test.sql
-- Chaque ligne affiche PASS ou FAIL ; la dernière ligne résume.
\set ON_ERROR_STOP off
begin;
create temp table res(name text, ok boolean, detail text);
grant all on res to public;

insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-0000000000a1','admin@t'),('00000000-0000-0000-0000-0000000000c1','chef@t'),('00000000-0000-0000-0000-0000000000d1','caiss@t'),
 ('00000000-0000-0000-0000-0000000000e1','compta@t'),('00000000-0000-0000-0000-0000000000f1','meca@t');
insert into public.profiles(id,login,nom,role) values
 ('00000000-0000-0000-0000-0000000000a1','kessie','Admin','admin'),('00000000-0000-0000-0000-0000000000c1','chef1','Chef','chef'),('00000000-0000-0000-0000-0000000000d1','caiss1','Caissier','caissier'),
 ('00000000-0000-0000-0000-0000000000e1','compta1','Comptable','comptable'),('00000000-0000-0000-0000-0000000000f1','meca1','Meca','meca');
insert into public.exercices(id,data) values ('2025','{"statut":"clos","exercice":"2025"}'),('2026','{"statut":"ouvert"}');
insert into public.comptes(id,data) values ('571','{"num":"571"}'),('706','{"num":"706"}'),('999','{"num":"999"}');

-- exécute une instruction en tant qu'utilisateur ; renvoie 'OK' ou le message d'erreur
create function pg_temp.as_user(uid text, stmt text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid)::text, true);
  execute 'set local role authenticated';
  begin execute stmt; exception when others then reset role; return sqlerrm; end;
  reset role; return 'OK';
end $$;
create function pg_temp.t(name text, uid text, stmt text, expect_err text) returns void language plpgsql as $$
declare r text := pg_temp.as_user(uid, stmt);
begin
  insert into res values (name, case when expect_err is null then r = 'OK' else r like '%' || expect_err || '%' end, r);
end $$;

\set A '00000000-0000-0000-0000-0000000000a1'
\set C '00000000-0000-0000-0000-0000000000c1'
\set D '00000000-0000-0000-0000-0000000000d1'
\set E '00000000-0000-0000-0000-0000000000e1'
\set F '00000000-0000-0000-0000-0000000000f1'

-- ── BONS DE CAISSE ──
select pg_temp.t('caissier crée un bon en attente', :'D', $q$insert into bons_caisse(id,data) values ('B1','{"statut":"attente","demandeur_login":"caiss1","montant":50000,"type":"sortie"}')$q$, null);
select pg_temp.t('caissier crée un bon au nom d''un autre', :'D', $q$insert into bons_caisse(id,data) values ('B2','{"statut":"attente","demandeur_login":"chef1","montant":10}')$q$, 'utilisateur connecté');
select pg_temp.t('un bon ne peut pas être créé déjà validé', :'D', $q$insert into bons_caisse(id,data) values ('B3','{"statut":"valide","demandeur_login":"caiss1","montant":10}')$q$, 'en attente');
select pg_temp.t('montant nul refusé', :'D', $q$insert into bons_caisse(id,data) values ('B4','{"statut":"attente","demandeur_login":"caiss1","montant":0}')$q$, 'supérieur à zéro');
select pg_temp.t('caissier ne valide pas (même son bon)', :'D', $q$update bons_caisse set data = data || '{"statut":"valide","decideur_login":"caiss1"}' where id='B1'$q$, 'hiérarchie');
select pg_temp.t('mécanicien ne voit/écrit aucun bon', :'F', $q$insert into bons_caisse(id,data) values ('B5','{"statut":"attente","demandeur_login":"meca1","montant":5}')$q$, 'row-level security');
select pg_temp.t('comptable (droit non accordé) ne valide pas', :'E', $q$update bons_caisse set data = data || '{"statut":"valide","decideur_login":"compta1"}' where id='B1'$q$, 'hiérarchie');
select pg_temp.t('chef valide dans son plafond (50 000 ≤ 100 000)', :'C', $q$update bons_caisse set data = data || '{"statut":"valide","decideur_login":"chef1"}' where id='B1'$q$, null);
select pg_temp.t('décision définitive : valide → rejeté refusé', :'A', $q$update bons_caisse set data = data || '{"statut":"rejete","decideur_login":"kessie","motifRejet":"x"}' where id='B1'$q$, 'définitive');
select pg_temp.t('un bon décidé ne se modifie plus (montant)', :'A', $q$update bons_caisse set data = data || '{"montant":1}' where id='B1'$q$, 'ne se modifie plus');
select pg_temp.t('un bon décidé ne se supprime pas', :'A', $q$delete from bons_caisse where id='B1'$q$, 'ne se supprime pas');
select pg_temp.t('remise : le suivi de réception reste modifiable', :'C', $q$update bons_caisse set data = data || '{"remise":{"statut":"confirmee"}}' where id='B1'$q$, null);
select pg_temp.t('caissier crée un gros bon (150 000)', :'D', $q$insert into bons_caisse(id,data) values ('B6','{"statut":"attente","demandeur_login":"caiss1","montant":150000}')$q$, null);
select pg_temp.t('chef refusé au-delà de son plafond', :'C', $q$update bons_caisse set data = data || '{"statut":"valide","decideur_login":"chef1"}' where id='B6'$q$, 'plafond');
select pg_temp.t('rejet sans motif refusé', :'C', $q$update bons_caisse set data = data || '{"statut":"rejete","decideur_login":"chef1"}' where id='B6'$q$, 'motif');
select pg_temp.t('décideur usurpé refusé', :'C', $q$update bons_caisse set data = data || '{"statut":"rejete","decideur_login":"kessie","motifRejet":"x"}' where id='B6'$q$, 'utilisateur connecté');
select pg_temp.t('l''auteur retire sa propre demande', :'D', $q$update bons_caisse set data = data || '{"statut":"rejete","decideur_login":"caiss1","motifRejet":"Retiré"}' where id='B6'$q$, null);
select pg_temp.t('admin crée un bon', :'A', $q$insert into bons_caisse(id,data) values ('B7','{"statut":"attente","demandeur_login":"kessie","montant":999999}')$q$, null);
select pg_temp.t('admin ne valide pas son propre bon (séparation stricte)', :'A', $q$update bons_caisse set data = data || '{"statut":"valide","decideur_login":"kessie"}' where id='B7'$q$, 'propre demande');
insert into public.config(id,data) values ('habilitations','{"strict":false}');
select pg_temp.t('…autorisé si « petite structure » (strict désactivé)', :'A', $q$update bons_caisse set data = data || '{"statut":"valide","decideur_login":"kessie"}' where id='B7'$q$, null);
delete from public.config where id='habilitations';

-- ── ÉCRITURES ──
select pg_temp.t('comptable saisit une écriture équilibrée', :'E', $q$insert into ecritures(id,data) values ('E1','{"statut":"brouillard","exercice":"2026","auteur_login":"compta1","lignes":[{"compte":"571","debit":1000,"credit":0},{"compte":"706","debit":0,"credit":1000}]}')$q$, null);
select pg_temp.t('écriture déséquilibrée refusée', :'E', $q$insert into ecritures(id,data) values ('E2','{"statut":"brouillard","exercice":"2026","lignes":[{"compte":"571","debit":1000,"credit":0},{"compte":"706","debit":0,"credit":900}]}')$q$, 'déséquilibrée');
select pg_temp.t('une seule ligne refusée', :'E', $q$insert into ecritures(id,data) values ('E3','{"statut":"brouillard","exercice":"2026","lignes":[{"compte":"571","debit":1000,"credit":0}]}')$q$, 'déséquilibrée');
select pg_temp.t('création directement visée refusée', :'E', $q$insert into ecritures(id,data) values ('E4','{"statut":"vise","exercice":"2026","lignes":[{"compte":"571","debit":1,"credit":0},{"compte":"706","debit":0,"credit":1}]}')$q$, 'brouillard');
select pg_temp.t('exercice clos : écriture refusée', :'E', $q$insert into ecritures(id,data) values ('E5','{"statut":"brouillard","exercice":"2025","lignes":[{"compte":"571","debit":1,"credit":0},{"compte":"706","debit":0,"credit":1}]}')$q$, 'clos');
select pg_temp.t('comptable (droit non accordé) ne vise pas', :'E', $q$update ecritures set data = data || '{"statut":"vise","viseur_login":"compta1"}' where id='E1'$q$, 'hiérarchie comptable');
select pg_temp.t('admin vise l''écriture du comptable', :'A', $q$update ecritures set data = data || '{"statut":"vise","viseur_login":"kessie","dateVisa":"2026-11-22"}' where id='E1'$q$, null);
select pg_temp.t('pièce visée intangible (modification du libellé)', :'A', $q$update ecritures set data = data || '{"libelle":"modifié"}' where id='E1'$q$, 'intangible');
select pg_temp.t('pièce visée : suppression refusée', :'A', $q$delete from ecritures where id='E1'$q$, 'visée');
select pg_temp.t('pièce visée : drapeau de contre-passation autorisé', :'A', $q$update ecritures set data = data || '{"contrepasse":"E9"}' where id='E1'$q$, null);
select pg_temp.t('levée de visa refusée au comptable', :'E', $q$update ecritures set data = data || '{"statut":"brouillard"}' where id='E1'$q$, 'administrateur');
select pg_temp.t('levée de visa par l''administrateur', :'A', $q$update ecritures set data = data || '{"statut":"brouillard"}' where id='E1'$q$, null);
select pg_temp.t('admin ne vise pas sa propre saisie', :'A', $q$insert into ecritures(id,data) values ('E6','{"statut":"brouillard","exercice":"2026","auteur_login":"kessie","lignes":[{"compte":"571","debit":10,"credit":0},{"compte":"706","debit":0,"credit":10}]}')$q$, null);
select pg_temp.t('…visa de sa propre saisie refusé', :'A', $q$update ecritures set data = data || '{"statut":"vise","viseur_login":"kessie"}' where id='E6'$q$, 'propre saisie');
select pg_temp.t('à-nouveaux visés par l''administrateur (journal AN)', :'A', $q$insert into ecritures(id,data) values ('AN-2026','{"statut":"vise","journal":"AN","exercice":"2026","viseur_login":"kessie","lignes":[{"compte":"571","debit":5,"credit":0},{"compte":"706","debit":0,"credit":5}]}')$q$, null);

-- ── PLAN, EXERCICES, ACCÈS ──
select pg_temp.t('compte utilisé : suppression refusée', :'E', $q$delete from comptes where id='571'$q$, 'utilisé');
select pg_temp.t('compte inutilisé : suppression autorisée', :'E', $q$delete from comptes where id='999'$q$, null);
select pg_temp.t('comptable ne clôture pas un exercice (0 ligne modifiée)', :'E', $q$do $x$ declare n int; begin update exercices set data = data || '{"statut":"clos"}' where id='2026'; get diagnostics n = row_count; if n = 0 then raise exception 'aucune ligne modifiable'; end if; end $x$$q$, 'aucune ligne');
select pg_temp.t('administrateur clôture un exercice', :'A', $q$do $x$ declare n int; begin update exercices set data = data || '{"statut":"clos"}' where id='2026'; get diagnostics n = row_count; if n = 0 then raise exception 'aucune ligne modifiable'; end if; end $x$$q$, null);
select pg_temp.t('chef écrit une transaction (effet d''une validation)', :'C', $q$insert into transactions(id,data) values ('T1','{"montant":1}')$q$, null);
select pg_temp.t('mécanicien n''écrit pas de transaction', :'F', $q$insert into transactions(id,data) values ('T2','{"montant":1}')$q$, 'row-level security');
select pg_temp.t('chef ne modifie pas les habilitations', :'C', $q$insert into config(id,data) values ('habilitations','{}')$q$, 'row-level security');
select pg_temp.t('admin enregistre les habilitations', :'A', $q$insert into config(id,data) values ('habilitations','{"strict":true}')$q$, null);
select pg_temp.t('visiteur non connecté : accès refusé', '', $q$select 1$q$, null);

-- visiteur anonyme
create function pg_temp.anon_try() returns text language plpgsql as $$
begin set local role anon; begin perform 1 from public.bons_caisse; reset role; return 'AUTORISE'; exception when others then reset role; return sqlerrm; end; end $$;
insert into res select 'visiteur anonyme : lecture des bons refusée', pg_temp.anon_try() like '%permission denied%', pg_temp.anon_try();

select case when ok then 'PASS' else 'FAIL' end as r, name, case when ok then '' else detail end as detail from res order by ok, name;
select count(*) filter (where ok) || ' réussis / ' || count(*) || ' tests' as resume from res;
rollback;
