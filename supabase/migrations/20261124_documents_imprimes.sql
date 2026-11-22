-- AutoGarage Pro — registre des documents imprimés (QR code de sécurité) et vérification publique.
-- À exécuter après 20261123_caisse_compta.sql.
-- Chaque impression enregistre {hash, type, ref, émetteur, date…}. La page publique verif.html appelle
-- verifier_document(p_id, p_h) : elle ne renvoie que des champs d'authentification, uniquement si l'identifiant
-- ET la partie secrète de l'empreinte (16 caractères) correspondent.

create table if not exists public.documents_imprimes (id text primary key, data jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now());
alter table public.documents_imprimes enable row level security;
create index if not exists documents_imprimes_updated_at_idx on public.documents_imprimes (updated_at);

drop policy if exists documents_imprimes_select on public.documents_imprimes;
drop policy if exists documents_imprimes_insert on public.documents_imprimes;
drop policy if exists documents_imprimes_update on public.documents_imprimes;
drop policy if exists documents_imprimes_delete on public.documents_imprimes;
create policy documents_imprimes_select on public.documents_imprimes for select to authenticated using ((select public.app_role()) is not null);
create policy documents_imprimes_insert on public.documents_imprimes for insert to authenticated with check ((select public.app_role()) is not null);
create policy documents_imprimes_update on public.documents_imprimes for update to authenticated using ((select public.app_role()) is not null) with check ((select public.app_role()) is not null);
create policy documents_imprimes_delete on public.documents_imprimes for delete to authenticated using ((select public.app_role()) = 'admin');

-- Immuabilité : l'empreinte, le type, la référence et l'émetteur d'un document enregistré ne changent plus
-- (seuls le compteur d'impressions et la date de dernière impression évoluent).
create or replace function public.documents_imprimes_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if (old.data->>'hash') is distinct from (new.data->>'hash')
       or (old.data->>'type') is distinct from (new.data->>'type')
       or (old.data->>'ref') is distinct from (new.data->>'ref')
       or (old.data->>'emis_login') is distinct from (new.data->>'emis_login')
       or (old.data->>'date') is distinct from (new.data->>'date') then
      raise exception 'Un document imprimé enregistré ne peut pas être modifié';
    end if;
  end if;
  if length(coalesce(new.data->>'hash', '')) <> 64 or upper(left(new.data->>'hash', 10)) <> substr(upper(new.id), 4, 10) then
    raise exception 'Identifiant et empreinte incohérents';
  end if;
  return new;
end $$;
drop trigger if exists documents_imprimes_guard_trg on public.documents_imprimes;
create trigger documents_imprimes_guard_trg before insert or update on public.documents_imprimes for each row execute function public.documents_imprimes_guard();

create or replace function public.verifier_document(p_id text, p_h text) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_build_object('trouve', true, 'id', d.id, 'type', d.data->>'type', 'ref', d.data->>'ref', 'montant', d.data->>'montant',
      'entreprise', d.data->>'entreprise', 'date', d.data->>'date', 'emis_nom', d.data->>'emis_nom', 'impressions', coalesce((d.data->>'impressions')::int, 1))
    from public.documents_imprimes d
    where d.id = p_id and length(coalesce(p_h, '')) = 16 and substr(d.data->>'hash', 11, 16) = lower(p_h)
    limit 1
  ), jsonb_build_object('trouve', false));
$$;
revoke all on function public.verifier_document(text, text) from public;
grant execute on function public.verifier_document(text, text) to anon, authenticated;
