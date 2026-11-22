-- Test du registre des documents imprimés et de la vérification publique.
-- Usage (base avec les migrations 20261121 à 20261124) : psql -f supabase/tests/documents_imprimes.test.sql
\set ON_ERROR_STOP off
begin;
create temp table res(name text, ok boolean, detail text);
grant all on res to public;
insert into auth.users(id,email) values ('00000000-0000-0000-0000-0000000000a1','admin@t'),('00000000-0000-0000-0000-0000000000c1','chef@t');
insert into public.profiles(id,login,nom,role) values ('00000000-0000-0000-0000-0000000000a1','kessie','Admin','admin'),('00000000-0000-0000-0000-0000000000c1','chef1','Chef','chef');

create function pg_temp.as_user(uid text, stmt text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid)::text, true);
  execute 'set local role authenticated';
  begin execute stmt; exception when others then reset role; return sqlerrm; end;
  reset role; return 'OK';
end $$;
create function pg_temp.t(name text, uid text, stmt text, expect_err text) returns void language plpgsql as $$
declare r text := pg_temp.as_user(uid, stmt);
begin insert into res values (name, case when expect_err is null then r = 'OK' else r like '%' || expect_err || '%' end, r); end $$;

-- hash de test : 64 caractères hexadécimaux ; id = AG- + 10 premiers caractères en majuscules
select pg_temp.t('chef enregistre un document', '00000000-0000-0000-0000-0000000000c1',
 $$insert into public.documents_imprimes(id,data) values ('AG-0123456789','{"hash":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","type":"Facture","ref":"FAC-1","montant":"118000","entreprise":"SANIX","emis_login":"chef1","emis_nom":"Chef","date":"2026-11-22T10:00:00Z","impressions":1}')$$, null);
select pg_temp.t('id et empreinte incohérents refusés', '00000000-0000-0000-0000-0000000000c1',
 $$insert into public.documents_imprimes(id,data) values ('AG-AAAAAAAAAA','{"hash":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","type":"x"}')$$, 'incohérents');
select pg_temp.t('empreinte trop courte refusée', '00000000-0000-0000-0000-0000000000c1',
 $$insert into public.documents_imprimes(id,data) values ('AG-BBBBBBBBBB','{"hash":"BBBBBBBBBB"}')$$, 'incohérents');
select pg_temp.t('le compteur d''impressions peut évoluer', '00000000-0000-0000-0000-0000000000c1',
 $$update public.documents_imprimes set data = data || '{"impressions":2}' where id='AG-0123456789'$$, null);
select pg_temp.t('le montant ne peut plus être falsifié via la référence', '00000000-0000-0000-0000-0000000000c1',
 $$update public.documents_imprimes set data = data || '{"ref":"FAC-999"}' where id='AG-0123456789'$$, 'ne peut pas être modifié');
select pg_temp.t('l''empreinte est immuable', '00000000-0000-0000-0000-0000000000c1',
 $$update public.documents_imprimes set data = jsonb_set(data,'{hash}','"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"') where id='AG-0123456789'$$, 'ne peut pas être modifié');
select pg_temp.t('le type est immuable', '00000000-0000-0000-0000-0000000000a1',
 $$update public.documents_imprimes set data = data || '{"type":"Autre"}' where id='AG-0123456789'$$, 'ne peut pas être modifié');
do $$ declare n int; begin
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000c1')::text, true);
  set local role authenticated; delete from public.documents_imprimes where id='AG-0123456789'; get diagnostics n = row_count; reset role;
  insert into res values ('le chef ne supprime pas un document', n = 0, n::text);
end $$;

-- vérification publique (anon)
do $$ declare r jsonb; begin
  set local role anon;
  r := public.verifier_document('AG-0123456789','abcdef0123456789');
  insert into res values ('anon : code correct → trouvé', (r->>'trouve')::boolean and r->>'type'='Facture' and r->>'ref'='FAC-1', r::text);
  insert into res values ('la réponse ne contient pas l''empreinte complète', r->>'hash' is null and r::text not like '%0123456789abcdef0123456789abcdef%', r::text);
  r := public.verifier_document('AG-0123456789','0000000000000000');
  insert into res values ('anon : mauvaise partie secrète → non trouvé', not (r->>'trouve')::boolean, r::text);
  r := public.verifier_document('AG-9999999999','456789abcdef0123');
  insert into res values ('anon : identifiant inconnu → non trouvé', not (r->>'trouve')::boolean, r::text);
  r := public.verifier_document('AG-0123456789','4567');
  insert into res values ('anon : code secret trop court → non trouvé', not (r->>'trouve')::boolean, r::text);
  r := public.verifier_document('AG-0123456789','');
  insert into res values ('anon : code secret vide → non trouvé', not (r->>'trouve')::boolean, r::text);
  reset role;
end $$;
do $$ declare n int := 0; begin
  set local role anon;
  begin select count(*) into n from public.documents_imprimes; exception when others then n := -1; end;
  reset role;
  insert into res values ('anon ne lit pas la table directement', n <= 0, n::text);
end $$;
select pg_temp.t('l''admin supprime un document', '00000000-0000-0000-0000-0000000000a1', $$delete from public.documents_imprimes where id='AG-0123456789'$$, null);

select case when ok then 'PASS ' else 'FAIL ' end || name || case when ok then '' else '  → ' || coalesce(detail,'') end as résultat from res order by ok, name;
select count(*) filter (where ok) || '/' || count(*) || ' tests réussis' as bilan from res;
rollback;
