/* AutoGarage Pro — intégrité des données : suppressions en cascade, modifications répercutées, détection d'orphelins.

   Avant : supprimer un client laissait ses véhicules, ordres de réparation et factures « orphelins » ; renommer un client
   ou changer une plaque ne mettait à jour aucune des copies (ordres, rendez-vous, visites, caisse).
   Maintenant :
   - toute suppression affiche l'IMPACT (ce qui est lié) et propose d'annuler ou de supprimer aussi les éléments liés ;
     les éléments financiers (factures, encaissements, commandes) demandent un compte administrateur et une case à cocher ;
   - un renommage de client ou un changement de plaque est répercuté sur les copies ;
   - un contrôle repère les orphelins existants (ou créés par la synchronisation entre appareils) et propose de les nettoyer.
   Dépend de : _gpGetArray (cloud.js) pour lire les tableaux, DB, session, saveData. */
(function () {
  'use strict';

  function arr(key) {
    /* le module Diagnostic expose son tableau vivant sur window : on modifie le tableau réel, pas une copie lue du stockage */
    if (key === 'diagnostics' && Array.isArray(window.DB_DIAGNOSTICS)) return window.DB_DIAGNOSTICS;
    var a = typeof window._gpGetArray === 'function' ? window._gpGetArray(key) : null;
    return Array.isArray(a) ? a : [];
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toastMsg(m, t) { if (typeof toast === 'function') toast(m, t || 'info'); }
  function isAdmin() { try { return typeof session !== 'undefined' && session && session.role === 'admin'; } catch (x) { return false; } }
  function same(a, b) { return a !== undefined && a !== null && b !== undefined && b !== null && String(a) === String(b); }
  function idSet(rows) { var s = {}; rows.forEach(function (r) { s[String(r.id)] = 1; }); return s; }

  /* ── Calcul de l'impact d'une suppression ─────────────────────────────── */
  /* Chaque groupe : { key (tableau), label, rows, finance }  */
  function group(key, label, rows, finance) { return rows.length ? { key: key, label: label, rows: rows, finance: !!finance } : null; }

  function vehiclesOfClient(cid) { return arr('vehicles').filter(function (v) { return same(v.client_id, cid); }); }

  function impact(kind, id) {
    var g = [], V, O, F, T, plates;
    function push(x) { if (x) g.push(x); }

    function fromVehicles(vs, withClientFields, cid) {
      var vids = {}, pl = {};
      vs.forEach(function (v) { vids[String(v.id)] = 1; pl[v.plaque] = 1; });
      var inter = arr('interventions').filter(function (o) { return vids[String(o.vehicle_id)] || (cid !== undefined && same(o.client_id, cid)); });
      var oids = idSet(inter);
      var fact = arr('factures').filter(function (f) { return (cid !== undefined && same(f.client_id, cid)) || oids[String(f.or_id)]; });
      var fids = idSet(fact);
      push(group('interventions', 'ordre(s) de réparation', inter));
      push(group('factures', 'facture(s)', fact, true));
      push(group('transactions', 'encaissement(s) de caisse', arr('transactions').filter(function (t) { return t.ref && fids[String(t.ref)]; }), true));
      push(group('requisitions', 'bon(s) de réquisition', arr('requisitions').filter(function (r) { return oids[String(r.orId)]; })));
      push(group('vt', 'visite(s) technique(s)', arr('vt').filter(function (x) { return vids[String(x.vehicle_id)] || pl[x.vehicle] || (cid !== undefined && same(x.client_id, cid)); })));
      push(group('rdv', 'rendez-vous', arr('rdv').filter(function (x) { return pl[x.vehicle]; })));
      push(group('entretien', 'entretien(s)', arr('entretien').filter(function (x) { return vids[String(x.vehicle_id)] || pl[x.vehicle] || (cid !== undefined && same(x.client_id, cid)); })));
      push(group('diagnostics', 'diagnostic(s)', arr('diagnostics').filter(function (x) { return vids[String(x.vehicle_id)] || vids[String(x.vehicleId)] || pl[x.plaque]; })));
    }

    if (kind === 'client') {
      V = vehiclesOfClient(id);
      push(group('vehicles', 'véhicule(s)', V));
      fromVehicles(V, true, id);
    } else if (kind === 'vehicle') {
      var veh = arr('vehicles').filter(function (v) { return same(v.id, id); });
      fromVehicles(veh, false, undefined);
    } else if (kind === 'intervention') {
      O = arr('interventions').filter(function (o) { return same(o.id, id); });
      var oi = idSet(O);
      F = arr('factures').filter(function (f) { return oi[String(f.or_id)]; });
      var fi = idSet(F);
      push(group('factures', 'facture(s)', F, true));
      push(group('transactions', 'encaissement(s) de caisse', arr('transactions').filter(function (t) { return t.ref && fi[String(t.ref)]; }), true));
      push(group('requisitions', 'bon(s) de réquisition', arr('requisitions').filter(function (r) { return oi[String(r.orId)]; })));
    } else if (kind === 'facture') {
      push(group('transactions', 'encaissement(s) de caisse', arr('transactions').filter(function (t) { return same(t.ref, id); }), true));
    } else if (kind === 'piece') {
      var piece = arr('stock').filter(function (s) { return same(s.ref, id) || same(s.id, id); })[0];
      if (piece) {
        push(group('stock_depots', 'ligne(s) de stock par dépôt', arr('stock_depots').filter(function (s) { return same(s.pieceId, piece.id); })));
        push(group('catalogue', 'fiche(s) du catalogue fournisseurs', arr('catalogue').filter(function (c) { return piece.ref && same(c.ref, piece.ref); })));
      }
    } else if (kind === 'fournisseur') {
      var fr = arr('fournisseurs').filter(function (f) { return same(f.id, id); })[0];
      push(group('commandes', 'commande(s) fournisseur', arr('commandes').filter(function (c) { return same(c.fournisseur_id, id); }), true));
      push(group('factures_fourn', 'facture(s) fournisseur', arr('factures_fourn').filter(function (f) { return same(f.fourn, id) || (fr && same(f.fourn, fr.nom)); }), true));
    }
    return g;
  }
  window._integriteImpact = impact;

  /* ── Suppression des lignes d'un groupe (en place : les références restent valides) ─ */
  function removeRows(key, rows) {
    var a = arr(key);
    var rm = new Set(rows);
    for (var i = a.length - 1; i >= 0; i--) if (rm.has(a[i])) a.splice(i, 1);
  }

  /* ── Fenêtre de confirmation avec impact ──────────────────────────────── */
  function dialog(title, name, groups, onOk) {
    var old = document.getElementById('integ-modal'); if (old) old.remove();
    var finance = groups.some(function (x) { return x.finance; });
    var blocked = finance && !isAdmin();
    var total = groups.reduce(function (n, x) { return n + x.rows.length; }, 0);
    var m = document.createElement('div');
    m.id = 'integ-modal';
    m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
    m.innerHTML = '<div class="integ-box">' +
      '<div class="integ-title">🗑️ ' + esc(title) + '</div>' +
      '<div class="integ-name">' + esc(name) + '</div>' +
      '<p class="integ-p">Cet élément est <b>lié à ' + total + ' autre(s) enregistrement(s)</b>. Les laisser sans lien créerait des fiches orphelines (nom, véhicule ou client introuvable). Choisissez :</p>' +
      '<ul class="integ-list">' + groups.map(function (x) { return '<li' + (x.finance ? ' class="fin"' : '') + '><b>' + x.rows.length + '</b> ' + esc(x.label) + (x.finance ? ' <span class="integ-tag">financier</span>' : '') + '</li>'; }).join('') + '</ul>' +
      (finance ? '<label class="integ-check"><input type="checkbox" id="integ-ack"' + (blocked ? ' disabled' : '') + '> Je comprends que les éléments financiers listés seront supprimés définitivement (comptabilité, caisse).</label>' : '') +
      (blocked ? '<div class="integ-warn">⛔ Seul un <b>administrateur</b> peut supprimer des éléments financiers. Demandez-lui, ou supprimez d\'abord ces éléments liés depuis leur module.</div>' : '') +
      '<div class="integ-actions"><button type="button" class="btn btn-secondary" id="integ-cancel">Annuler</button>' +
      '<button type="button" class="btn btn-danger" id="integ-ok"' + (finance ? ' disabled' : '') + (blocked ? ' disabled' : '') + '>Supprimer tout (' + (total + 1) + ')</button></div></div>';
    document.body.appendChild(m);
    var ok = m.querySelector('#integ-ok'), ack = m.querySelector('#integ-ack');
    if (ack) ack.addEventListener('change', function () { ok.disabled = !ack.checked || blocked; });
    function close() { m.remove(); document.removeEventListener('keydown', onKey, true); }
    function onKey(ev) { if (ev.key === 'Escape') { ev.stopPropagation(); close(); } }
    document.addEventListener('keydown', onKey, true);
    m.querySelector('#integ-cancel').addEventListener('click', close);
    m.addEventListener('click', function (ev) { if (ev.target === m) close(); });
    ok.addEventListener('click', function () { if (ok.disabled) return; close(); onOk(); });
    (m.querySelector('#integ-cancel')).focus();
  }

  /* ── Branchement sur les suppressions existantes ──────────────────────── */
  function runOriginal(orig, args, ctx) {
    var saved = window._sfConfirm;
    window._sfConfirm = function (msg, cb) { cb(); };        /* la confirmation a déjà eu lieu */
    try { return orig.apply(ctx, args); } finally { window._sfConfirm = saved; }
  }

  function wrapDelete(name, kind, labelFn, idFn) {
    var orig = window[name];
    if (typeof orig !== 'function' || orig._integ) return;
    window[name] = function () {
      var args = arguments, ctx = this, id = idFn ? idFn.apply(null, args) : args[0];
      var groups = [];
      try { groups = impact(kind, id); } catch (e) { console.warn('[Intégrité]', e); }
      if (!groups.length) return orig.apply(ctx, args);       /* rien de lié : parcours d'origine inchangé */
      dialog('Supprimer ' + labelFn(id).kind + ' ?', labelFn(id).name, groups, function () {
        var n = 0;
        groups.forEach(function (x) { removeRows(x.key, x.rows); n += x.rows.length; });
        runOriginal(orig, args, ctx);
        try { if (typeof saveData === 'function') saveData(); } catch (e) {}
        toastMsg(n + ' élément(s) lié(s) supprimé(s) avec lui', 'info');
        scanSoon();
      });
    };
    window[name]._integ = true;
  }

  function install() {
    wrapDelete('deleteClientConfirmById', 'client', function (id) { var c = arr('clients').filter(function (x) { return same(x.id, id); })[0]; return { kind: 'le client', name: c ? c.nom : String(id) }; });
    wrapDelete('deleteVehicleConfirmById', 'vehicle', function (id) { var v = arr('vehicles').filter(function (x) { return same(x.id, id); })[0]; return { kind: 'le véhicule', name: v ? (v.plaque + ' — ' + (v.marque || '') + ' ' + (v.modele || '')) : String(id) }; });
    wrapDelete('deleteORConfirmById', 'intervention', function (id) { var o = arr('interventions').filter(function (x) { return same(x.id, id); })[0]; return { kind: 'l\'ordre de réparation', name: String(id) + (o && o.type ? ' — ' + o.type : '') }; });
    wrapDelete('deleteFacture', 'facture', function (id) { return { kind: 'la facture', name: String(id) }; });
    wrapDelete('deletePiece', 'piece', function (ref) { var p = arr('stock').filter(function (x) { return same(x.ref, ref); })[0]; return { kind: 'la pièce', name: p ? (p.nom + ' (' + ref + ')') : String(ref) }; });
    wrapDelete('deleteFournisseur', 'fournisseur', function (id) { var f = arr('fournisseurs').filter(function (x) { return same(x.id, id); })[0]; return { kind: 'le fournisseur', name: f ? f.nom : String(id) }; });
    wrapSave('saveClient', clientSnap, propagateClient);
    wrapSave('saveVehicle', vehicleSnap, propagateVehicle);
  }

  /* ── Modifications en cascade (renommage client, changement de plaque) ── */
  function clientSnap() { var s = {}; arr('clients').forEach(function (c) { s[c.id] = { nom: c.nom, tel: c.tel, wa: c.wa }; }); return s; }
  function vehicleSnap() { var s = {}; arr('vehicles').forEach(function (v) { s[v.id] = { plaque: v.plaque, marque: v.marque, modele: v.modele }; }); return s; }

  function wrapSave(name, snapFn, propFn) {
    var orig = window[name];
    if (typeof orig !== 'function' || orig._integ) return;
    window[name] = function () {
      var before = snapFn();
      var r = orig.apply(this, arguments);
      try { var after = snapFn(), n = 0; Object.keys(after).forEach(function (id) { if (before[id]) n += propFn(id, before[id], after[id]); }); if (n) { if (typeof saveData === 'function') saveData(); toastMsg(n + ' élément(s) lié(s) mis à jour', 'info'); } } catch (e) { console.warn('[Intégrité]', e); }
      return r;
    };
    window[name]._integ = true;
  }

  function setIf(obj, field, val) { if (val !== undefined && obj[field] !== val) { obj[field] = val; return 1; } return 0; }

  function propagateClient(id, old, now) {
    if (old.nom === now.nom && old.tel === now.tel && old.wa === now.wa) return 0;
    var n = 0, tel = now.wa || now.tel;
    var cl = arr('clients').filter(function (c) { return same(c.id, id); })[0];
    if (!cl) return 0;
    var cid = cl.id, vs = vehiclesOfClient(cid), pl = {}; vs.forEach(function (v) { pl[v.plaque] = 1; });
    var facts = arr('factures').filter(function (f) { return same(f.client_id, cid); }), fids = idSet(facts);
    arr('interventions').forEach(function (o) { if (same(o.client_id, cid)) n += setIf(o, 'client', now.nom); });
    arr('vt').forEach(function (x) { if (same(x.client_id, cid)) { n += setIf(x, 'client', now.nom); n += setIf(x, 'tel', tel); } });
    arr('entretien').forEach(function (x) { if (same(x.client_id, cid)) { n += setIf(x, 'client', now.nom); n += setIf(x, 'tel', tel); } });
    arr('rdv').forEach(function (x) { if (pl[x.vehicle]) n += setIf(x, 'client', now.nom); });
    arr('transactions').forEach(function (t) { if (t.ref && fids[String(t.ref)]) n += setIf(t, 'client', now.nom); });
    arr('diagnostics').forEach(function (x) { if (same(x.client_id, cid) || (x.vehicle_id !== undefined && vs.some(function (v) { return same(v.id, x.vehicle_id); }))) n += setIf(x, 'client', now.nom); });
    return n;
  }

  function propagateVehicle(id, old, now) {
    if (old.plaque === now.plaque && old.marque === now.marque && old.modele === now.modele) return 0;
    var n = 0, label = (now.marque || '') + ' ' + (now.modele || '');
    arr('interventions').forEach(function (o) { if (same(o.vehicle_id, id)) { n += setIf(o, 'plaque', now.plaque); n += setIf(o, 'marque', label.trim()); } });
    arr('vt').forEach(function (x) { if (same(x.vehicle_id, id) || x.vehicle === old.plaque) { n += setIf(x, 'vehicle', now.plaque); n += setIf(x, 'marque', label.trim()); } });
    arr('entretien').forEach(function (x) { if (same(x.vehicle_id, id) || x.vehicle === old.plaque) { n += setIf(x, 'vehicle', now.plaque); n += setIf(x, 'marque', label.trim()); } });
    arr('rdv').forEach(function (x) { if (x.vehicle === old.plaque) n += setIf(x, 'vehicle', now.plaque); });
    arr('diagnostics').forEach(function (x) { if (same(x.vehicle_id, id) || x.plaque === old.plaque) n += setIf(x, 'plaque', now.plaque); });
    return n;
  }

  /* ── Détection des orphelins ──────────────────────────────────────────── */
  function scan() {
    var cl = idSet(arr('clients')), ve = idSet(arr('vehicles')), or = idSet(arr('interventions')), fa = idSet(arr('factures')), pl = idSet(arr('stock'));
    var plates = {}; arr('vehicles').forEach(function (v) { plates[v.plaque] = 1; });
    var C = [];
    function add(key, label, rows, fixable, finance) { if (rows.length) C.push({ key: key, label: label, rows: rows, fixable: fixable, finance: !!finance }); }
    add('vehicles', 'Véhicules sans client', arr('vehicles').filter(function (v) { return v.client_id !== undefined && v.client_id !== null && !cl[String(v.client_id)]; }), true);
    add('interventions', 'Ordres de réparation sans véhicule', arr('interventions').filter(function (o) { return o.vehicle_id !== undefined && o.vehicle_id !== null && !ve[String(o.vehicle_id)]; }), true);
    add('factures', 'Factures sans client', arr('factures').filter(function (f) { return f.client_id !== undefined && f.client_id !== null && !cl[String(f.client_id)]; }), false, true);
    add('transactions', 'Encaissements sans facture', arr('transactions').filter(function (t) { return t.ref && /^(F-|FINE-)/.test(String(t.ref)) && !fa[String(t.ref)]; }), false, true);
    add('requisitions', 'Bons de réquisition sans ordre de réparation', arr('requisitions').filter(function (r) { return r.orId && !or[String(r.orId)]; }), true);
    add('stock_depots', 'Lignes de stock sans pièce', arr('stock_depots').filter(function (s) { return !pl[String(s.pieceId)]; }), true);
    add('vt', 'Visites techniques sans véhicule', arr('vt').filter(function (x) { return x.vehicle_id !== undefined && x.vehicle_id !== null && !ve[String(x.vehicle_id)]; }), true);
    add('entretien', 'Entretiens sans véhicule', arr('entretien').filter(function (x) { return x.vehicle_id !== undefined && x.vehicle_id !== null && !ve[String(x.vehicle_id)]; }), true);
    return C;
  }
  window._integriteScan = scan;

  /* Noms obsolètes (copies différentes de la fiche) : corrigeables automatiquement */
  function stale() {
    var n = 0, cl = {}, ve = {};
    arr('clients').forEach(function (c) { cl[c.id] = c; });
    arr('vehicles').forEach(function (v) { ve[v.id] = v; });
    var list = [];
    arr('interventions').forEach(function (o) {
      var c = cl[o.client_id], v = ve[o.vehicle_id];
      if (c && o.client !== c.nom) list.push(function () { o.client = c.nom; });
      if (v && o.plaque !== v.plaque) list.push(function () { o.plaque = v.plaque; });
    });
    return list;
  }
  window._integriteStale = function () { return stale().length; };

  function chip(count) {
    var side = document.getElementById('aj-side'), b = document.getElementById('integ-btn');
    if (!count) { if (b) b.remove(); return; }
    if (!side) return;
    if (!b) { b = document.createElement('button'); b.id = 'integ-btn'; b.className = 'aj-side-btn'; b.addEventListener('click', openScan); side.appendChild(b); }
    b.textContent = '🧹 ' + count + ' incohérence' + (count > 1 ? 's' : '') + ' à vérifier';
  }

  var scanTimer = null;
  function scanSoon() { clearTimeout(scanTimer); scanTimer = setTimeout(function () { var c = scan(); chip(c.reduce(function (n, x) { return n + x.rows.length; }, 0) + stale().length); }, 600); }
  window._integriteRescan = scanSoon;

  function openScan() {
    var old = document.getElementById('integ-scan'); if (old) old.remove();
    var cats = scan(), st = stale().length, adm = isAdmin();
    var m = document.createElement('div');
    m.id = 'integ-scan'; m.className = 'integ-overlay';
    m.innerHTML = '<div class="integ-box integ-wide"><div class="integ-title">🧹 Contrôle de cohérence des données</div>' +
      '<p class="integ-p">Fiches dont l\'élément parent n\'existe plus (suppression faite avant la mise à jour, ou depuis un autre appareil). Nettoyer retire seulement ces fiches orphelines.</p>' +
      (cats.length || st ? '' : '<p class="integ-ok">✅ Aucune incohérence.</p>') +
      cats.map(function (c, i) {
        var blocked = c.finance && !adm;
        return '<div class="integ-row"><div><b>' + c.rows.length + '</b> ' + esc(c.label) + (c.finance ? ' <span class="integ-tag">financier</span>' : '') +
          '<div class="integ-sub">' + esc(c.rows.slice(0, 4).map(function (r) { return r.id || r.plaque || ''; }).join(', ')) + (c.rows.length > 4 ? '…' : '') + '</div></div>' +
          (c.fixable ? '<button class="btn btn-secondary btn-sm" data-clean="' + i + '">Supprimer</button>' : '<span class="integ-sub">à traiter à la main' + (blocked ? ' (administrateur)' : '') + '</span>') + '</div>';
      }).join('') +
      (st ? '<div class="integ-row"><div><b>' + st + '</b> nom(s) ou plaque(s) obsolète(s) dans les ordres de réparation</div><button class="btn btn-primary btn-sm" data-stale="1">Mettre à jour</button></div>' : '') +
      '<div class="integ-actions"><button class="btn btn-secondary" id="integ-close">Fermer</button></div></div>';
    document.body.appendChild(m);
    m.addEventListener('click', function (ev) {
      var t = ev.target;
      if (t === m || t.id === 'integ-close') { m.remove(); return; }
      var ci = t.getAttribute && t.getAttribute('data-clean');
      if (ci !== null && ci !== undefined) { var c = cats[Number(ci)]; removeRows(c.key, c.rows); if (typeof saveData === 'function') saveData(); toastMsg(c.rows.length + ' fiche(s) orpheline(s) supprimée(s)', 'info'); scanSoon(); m.remove(); openScan(); }
      if (t.getAttribute && t.getAttribute('data-stale')) { var fx = stale(); fx.forEach(function (f) { f(); }); if (typeof saveData === 'function') saveData(); toastMsg(fx.length + ' valeur(s) mise(s) à jour', 'info'); scanSoon(); m.remove(); openScan(); }
    });
  }
  window._integriteOpen = openScan;

  document.addEventListener('DOMContentLoaded', function () {
    install();
    setTimeout(install, 2500);                      /* réaffirmé après les anciens correctifs */
    setTimeout(scanSoon, 4000);
    setInterval(function () { if (document.visibilityState === 'visible') scanSoon(); }, 3 * 60 * 1000);
  });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') scanSoon(); });
})();
