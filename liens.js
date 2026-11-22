/* AutoGarage Pro — liens entre modules (revue d'interconnexion).
   Corrige des ruptures entre modules historiques :
   - stock : la quantité globale d'une pièce et ses quantités par dépôt restent alignées (une entrée/sortie
     de stock alimente le dépôt principal, donc l'affectation à un OR et l'inventaire voient le même stock) ;
   - fournisseurs : la dette (ca_credit) augmente à la réception d'une facture et baisse à son règlement ;
   - factures fournisseurs : règlement partiel suivi (montant_paye), jamais supérieur au restant dû ;
   - atelier : « véhicules en atelier » se déduit des ordres de réparation ouverts. */
(function () {
  'use strict';

  /* ── Stock : global ↔ dépôts ─────────────────────────────────────────── */
  function principal() {
    var d = (typeof DB_DEPOTS !== 'undefined' ? DB_DEPOTS : []);
    var p = d.find(function (x) { return x.type === 'principal' && x.actif !== false; }) || d.find(function (x) { return x.actif !== false; }) || d[0];
    return p ? p.id : 'dep-1';
  }
  function alignStock() {
    if (typeof DB === 'undefined' || !DB.stock || typeof DB_STOCK_DEPOTS === 'undefined') return 0;
    var changed = 0, pid = principal();
    var depots = (typeof DB_DEPOTS !== 'undefined' ? DB_DEPOTS : []).map(function (d) { return d.id; });
    if (depots.indexOf(pid) < 0) depots.unshift(pid);
    DB.stock.forEach(function (p) {
      var rows = DB_STOCK_DEPOTS.filter(function (r) { return r.pieceId === p.id; });
      var sum = rows.reduce(function (s, r) { return s + (Number(r.qty) || 0); }, 0), qty = Number(p.qty) || 0, diff = qty - sum;
      if (!diff) return;
      changed++;
      if (diff > 0) {
        var r = rows.find(function (x) { return x.depotId === pid; });
        if (r) r.qty = (Number(r.qty) || 0) + diff; else DB_STOCK_DEPOTS.push({ depotId: pid, pieceId: p.id, qty: diff });
      } else {
        var left = -diff;
        depots.slice().sort(function (a, b) { return (a === pid ? -1 : 0) - (b === pid ? -1 : 0); }).forEach(function (did) {
          if (left <= 0) return;
          var rr = rows.find(function (x) { return x.depotId === did; }); if (!rr) return;
          var take = Math.min(Number(rr.qty) || 0, left); rr.qty -= take; left -= take;
        });
      }
    });
    return changed;
  }
  function hookStock() {
    ['saveMvt', 'saveAffectationOR', 'saveTransfert', 'validerEcart'].forEach(function (n) {
      var o = window[n]; if (typeof o !== 'function' || o._lien) return;
      window[n] = function () {
        try { alignStock(); } catch (e) {}
        var r = o.apply(this, arguments);
        try { if (alignStock() && typeof window.saveData === 'function') window.saveData(); } catch (e) {}
        return r;
      };
      window[n]._lien = true;
    });
    var rs = window.renderStock;
    if (typeof rs === 'function' && !rs._lien) {
      window.renderStock = function () { try { alignStock(); } catch (e) {} return rs.apply(this, arguments); };
      window.renderStock._lien = true;
    }
  }

  /* ── Fournisseurs : dette et règlements ──────────────────────────────── */
  function trouverFourn(nom) {
    var l = (typeof DB_FOURNISSEURS !== 'undefined' ? DB_FOURNISSEURS : []), n = String(nom || '').trim().toLowerCase(); if (!n) return null;
    var f = l.find(function (x) { return String(x.nom || '').trim().toLowerCase() === n; });
    if (f) return f;
    var c = l.filter(function (x) { var a = String(x.nom || '').toLowerCase(); return a && (n.indexOf(a) !== -1 || a.indexOf(n) !== -1); });
    return c.length === 1 ? c[0] : null;
  }
  function detteFourn(nom, delta) {
    var f = trouverFourn(nom); if (!f || !delta) return false;
    f.ca_credit = Math.max(0, Math.round((Number(f.ca_credit) || 0) + Number(delta)));
    return true;
  }
  function resteFF(ff) { return Math.max(0, (Number(ff.montant) || 0) - (Number(ff.montant_paye) || 0)); }
  /* Enregistre un règlement : « payée » seulement quand tout est réglé ; la dette du fournisseur baisse du montant versé */
  function reglerFF(ff, montant, mode, date) {
    montant = Math.min(Number(montant) || 0, resteFF(ff));
    if (!(montant > 0)) return 0;
    ff.montant_paye = (Number(ff.montant_paye) || 0) + montant;
    ff.modePaiement = mode || ff.modePaiement; ff.datePaiement = date || ff.datePaiement || new Date().toISOString().slice(0, 10);
    ff.statut = resteFF(ff) > 0.5 ? 'a_payer' : 'payee';
    detteFourn(ff.fourn, -montant);
    return montant;
  }

  /* ── Atelier : véhicules en atelier ──────────────────────────────────── */
  function nbVehEnAtelier() {
    var ids = {};
    (DB.vehicles || []).forEach(function (v) { if (v.statut === 'En atelier') ids[v.id] = 1; });
    (DB.interventions || []).forEach(function (o) { if ((o.statut === 'En cours' || o.statut === 'En attente') && (o.vehicle_id != null)) ids[o.vehicle_id] = 1; });
    return Object.keys(ids).length;
  }

  function init() { hookStock(); }
  init(); document.addEventListener('DOMContentLoaded', function () { init(); setTimeout(init, 1500); });
  window.GPLiens = { alignStock: alignStock, detteFourn: detteFourn, resteFF: resteFF, reglerFF: reglerFF, nbVehEnAtelier: nbVehEnAtelier, trouverFourn: trouverFourn };
})();
