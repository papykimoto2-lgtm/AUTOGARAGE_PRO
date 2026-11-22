/* AutoGarage Pro — pièces imprimables de la caisse : journal du jour, état de clôture signé,
   bordereau de remise. Onglet « Pièces » de la page Caisse. Dépend de finance.js et caisse.js. */
(function () {
  'use strict';
  var F = window.FIN; if (!F) return;
  var esc = F.esc, fmt = F.fmt;

  function C() { return F.caisse || {}; }
  function sessions() { return typeof DB_SESSIONS_CAISSE !== 'undefined' ? DB_SESSIONS_CAISSE : []; }
  function typeLabel(t) { var x = C().TYPES && C().TYPES[t]; return x ? x.label : t; }
  function frDate(d) { if (!d) return '—'; var p = String(d).slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : d; }
  function frDT(iso) { if (!iso) return '—'; var d = new Date(iso); return isNaN(d) ? esc(iso) : d.toLocaleDateString('fr-FR') + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); }
  function money(n) { n = Number(n) || 0; return (n < 0 ? '−' : '') + fmt(Math.abs(n)) + ' F'; }
  function signed(n) { n = Number(n) || 0; return (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n)) + ' F'; }
  function modeKey(m) { return typeof _caisseNormalMode === 'function' ? _caisseNormalMode(m) : 'Especes'; }
  function isIn(t) { return t.transaction_type === 'encaissement'; }

  var CSS = 'body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0;padding:24px;font-size:12px}' +
    'h2{font-size:14px;margin:18px 0 6px;border-bottom:1px solid #d1d5db;padding-bottom:3px}' +
    'table{width:100%;border-collapse:collapse;margin:6px 0}th,td{border:1px solid #d1d5db;padding:5px 7px;text-align:left;vertical-align:top}' +
    'th{background:#f3f4f6;font-size:11px}td.r,th.r{text-align:right;font-variant-numeric:tabular-nums}' +
    '.kpi{display:flex;gap:10px;flex-wrap:wrap;margin:8px 0}.kpi div{border:1px solid #d1d5db;border-radius:6px;padding:6px 10px;min-width:120px}' +
    '.kpi span{display:block;font-size:10px;color:#6b7280}.kpi b{font-size:14px}' +
    '.sign{display:flex;gap:16px;margin-top:26px}.sign div{flex:1;border:1px solid #9ca3af;border-radius:6px;min-height:96px;padding:8px;font-size:11px}' +
    '.sign small{display:block;color:#6b7280;margin-top:4px}.note{font-size:11px;color:#374151;margin:6px 0}' +
    '.tag{display:inline-block;border:1px solid #9ca3af;border-radius:4px;padding:1px 6px;font-size:10px}' +
    '.btn-print{background:#f97316;color:#fff;border:0;border-radius:8px;padding:8px 20px;font-weight:700;cursor:pointer;margin-bottom:14px}' +
    '@media print{.btn-print{display:none}body{padding:10mm}}';

  function head(titre, ref) {
    if (typeof getCompanyPrintHeader === 'function') { var h = getCompanyPrintHeader(titre, ref); return '<style>' + h.css + '</style>' + h.html; }
    return '<h1>' + esc(titre) + '</h1><div>' + esc(ref) + '</div>';
  }
  function foot() { return typeof getCompanyPrintFooter === 'function' ? getCompanyPrintFooter() : ''; }
  function page(titre, ref, body) {
    return '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>' + esc(titre + ' ' + ref) + '</title><style>' + CSS + '</style></head><body>' +
      '<button class="btn-print" onclick="window.print()">🖨️ Imprimer / Enregistrer en PDF</button>' + head(titre, ref) + body + foot() + '</body></html>';
  }
  function open(html) {
    var w = window.open('', '_blank');
    if (!w) { F.toast('Autorisez les fenêtres pop-up pour imprimer.', 'error'); return false; }
    w.document.write(html); w.document.close(); return true;
  }

  /* ── Mouvements d'une période ─────────────────────────────────────────── */
  function trxEntre(d1, d2) { return (DB.transactions || []).filter(function (t) { return t.date >= d1 && t.date <= d2; }).sort(function (a, b) { return String(a.date).localeCompare(b.date); }); }
  function bonsEntre(d1, d2) { return F.coll.bons.filter(function (b) { return b.date >= d1 && b.date <= d2; }); }
  function depensesEntre(d1, d2) { return (typeof DB_DEPENSES !== 'undefined' ? DB_DEPENSES : []).filter(function (d) { return d.date >= d1 && d.date <= d2; }); }

  function trxTable(list) {
    if (!list.length) return '<p class="note">Aucun mouvement.</p>';
    var tin = 0, tout = 0;
    var rows = list.map(function (t) {
      var m = Math.abs(Number(t.montant) || 0), inn = isIn(t); if (inn) tin += m; else tout += m;
      return '<tr><td>' + frDate(t.date) + '</td><td>' + esc(t.ref || t.id || '') + '</td><td>' + esc(t.client || t.notes || '') + (t.source === 'bon' ? ' <span class="tag">bon</span>' : '') + '</td><td>' + esc(t.mode || '') + '</td><td class="r">' + (inn ? fmt(m) : '') + '</td><td class="r">' + (inn ? '' : fmt(m)) + '</td></tr>';
    }).join('');
    return '<table><thead><tr><th>Date</th><th>Référence</th><th>Libellé</th><th>Mode</th><th class="r">Entrées (F)</th><th class="r">Sorties (F)</th></tr></thead><tbody>' + rows +
      '<tr><th colspan="4" class="r">Totaux</th><th class="r">' + fmt(tin) + '</th><th class="r">' + fmt(tout) + '</th></tr></tbody></table>';
  }
  function bonsTable(list) {
    if (!list.length) return '<p class="note">Aucun bon sur la période.</p>';
    return '<table><thead><tr><th>Bon</th><th>Type</th><th>Personne / lieu</th><th>Motif</th><th class="r">Montant</th><th>Statut</th><th>Décision</th></tr></thead><tbody>' + list.map(function (b) {
      var st = { attente: 'En attente', valide: 'Validé', rejete: 'Rejeté' }[b.statut] || b.statut;
      var dec = b.decideur_nom ? esc(b.decideur_nom) + ' · ' + frDT(b.dateDecision) + (b.motifRejet ? '<br>Motif : ' + esc(b.motifRejet) : '') : '—';
      return '<tr><td>' + esc(b.id) + '</td><td>' + esc(typeLabel(b.type)) + '</td><td>' + esc(b.tiers) + '</td><td>' + esc(b.motif) + '</td><td class="r">' + fmt(b.montant) + '</td><td>' + st + '</td><td>' + dec + '</td></tr>';
    }).join('') + '</tbody></table>';
  }

  /* ── 1. Journal de caisse ────────────────────────────────────────────── */
  function journalHtml(date) {
    var d = date || F.today();
    var trx = trxEntre(d, d), bons = bonsEntre(d, d), deps = depensesEntre(d, d);
    var ss = sessions().filter(function (s) { return s.dateOuverture <= d && (!s.dateCloture || s.dateCloture >= d); });
    var ca = 0, sorties = 0;
    trx.forEach(function (t) { var m = Math.abs(Number(t.montant) || 0); if (isIn(t)) ca += m; else sorties += m; });
    var attente = bons.filter(function (b) { return b.statut === 'attente'; });
    var depAtt = deps.filter(function (x) { return x.vstatut === 'attente'; });
    var sess = ss.length ? '<table><thead><tr><th>Session</th><th>Opérateur</th><th>Ouverture</th><th>Clôture</th><th class="r">Fond d\'ouverture</th><th class="r">Écart</th></tr></thead><tbody>' + ss.map(function (s) {
      return '<tr><td>' + esc(s.id) + '</td><td>' + esc(s.operateur || '') + '</td><td>' + frDate(s.dateOuverture) + ' ' + esc(s.heureOuverture || '') + '</td><td>' + (s.dateCloture ? frDate(s.dateCloture) + ' ' + esc(s.heureCloture || '') : 'Ouverte') + '</td><td class="r">' + fmt((s.fondInitialEspeces != null ? s.fondInitialEspeces : s.fondEspeces) || 0) + '</td><td class="r">' + (s.statut === 'cloturee' ? signed(s.ecartTotal) : '—') + '</td></tr>';
    }).join('') + '</tbody></table>' : '<p class="note">Aucune session de caisse ce jour.</p>';
    var body = '<h2>Journal de caisse du ' + frDate(d) + '</h2>' +
      '<div class="kpi"><div><span>Encaissements</span><b>' + money(ca) + '</b></div><div><span>Décaissements</span><b>' + money(sorties) + '</b></div><div><span>Solde du jour</span><b>' + signed(ca - sorties) + '</b></div><div><span>Bons en attente</span><b>' + attente.length + '</b></div><div><span>Dépenses en attente</span><b>' + depAtt.length + '</b></div></div>' +
      '<h2>Sessions</h2>' + sess + '<h2>Mouvements validés</h2>' + trxTable(trx) + '<h2>Bons de caisse du jour</h2>' + bonsTable(bons) +
      (attente.length || depAtt.length ? '<p class="note"><b>Attention :</b> ' + (attente.length + depAtt.length) + ' demande(s) restent en attente de décision et ne figurent pas dans les totaux.</p>' : '') +
      '<div class="sign"><div>Établi par<small>Nom, date et signature</small></div><div>Vérifié par la hiérarchie<small>Nom, date et signature</small></div></div>';
    return page('Journal de caisse', 'JC-' + d, body);
  }

  /* ── 2. État de clôture signé ────────────────────────────────────────── */
  function clotureHtml(id) {
    var s = sessions().find(function (x) { return x.id === id; });
    if (!s) return null;
    var fin = s.dateCloture || F.today();
    var trx = trxEntre(s.dateOuverture, fin), bons = bonsEntre(s.dateOuverture, fin).filter(function (b) { return !b.sessionId || b.sessionId === s.id; });
    var cl = s.statut === 'cloturee';
    var rows = [['Espèces', s.fondInitialEspeces != null ? s.fondInitialEspeces : s.fondEspeces, s.soldeTheoEsp, s.compteEspeces, s.ecartEspeces], ['Mobile Money', s.fondMM, s.soldeTheoMM, s.compteMM, s.ecartMM], ['Carte', s.fondCarte, s.soldeTheoCarte, s.compteCarte, s.ecartCarte]];
    var tab = '<table><thead><tr><th>Mode</th><th class="r">Fond d\'ouverture</th><th class="r">Solde théorique</th><th class="r">Comptage réel</th><th class="r">Écart</th></tr></thead><tbody>' + rows.map(function (r) {
      return '<tr><td>' + r[0] + '</td><td class="r">' + fmt(r[1] || 0) + '</td><td class="r">' + (cl ? fmt(r[2] || 0) : '—') + '</td><td class="r">' + (cl ? fmt(r[3] || 0) : '—') + '</td><td class="r">' + (cl ? signed(r[4]) : '—') + '</td></tr>';
    }).join('') + (cl ? '<tr><th colspan="4" class="r">Écart total</th><th class="r">' + signed(s.ecartTotal) + '</th></tr>' : '') + '</tbody></table>';
    var fonds = (s.mouvementsFonds || []).length ? '<h2>Mouvements de fonds (remises, réapprovisionnements)</h2><table><thead><tr><th>Bon</th><th>Type</th><th>Date</th><th class="r">Montant</th></tr></thead><tbody>' + s.mouvementsFonds.map(function (m) { return '<tr><td>' + esc(m.bonId) + '</td><td>' + esc(typeLabel(m.type)) + '</td><td>' + frDate(m.date) + '</td><td class="r">' + signed(m.montant) + '</td></tr>'; }).join('') + '</tbody></table>' : '';
    var v = s.visa, visaTxt = !v ? (cl && Math.abs(s.ecartTotal || 0) > F.hab().ecartTolere ? 'Visa requis — non demandé' : 'Aucun visa requis (écart dans la tolérance de ' + fmt(F.hab().ecartTolere) + ' F)') :
      ({ attente: 'Visa en attente de la hiérarchie', valide: 'Visa accordé par ' + esc(v.decideur_nom || '') + ' le ' + frDT(v.dateDecision), rejete: 'Visa refusé par ' + esc(v.decideur_nom || '') + ' le ' + frDT(v.dateDecision) + (v.motif ? ' — ' + esc(v.motif) : '') }[v.statut] || '');
    var info = '<table><tbody><tr><th>Session</th><td>' + esc(s.id) + '</td><th>Opérateur</th><td>' + esc(s.operateur || '') + '</td></tr><tr><th>Ouverture</th><td>' + frDate(s.dateOuverture) + ' ' + esc(s.heureOuverture || '') + '</td><th>Clôture</th><td>' + (cl ? frDate(s.dateCloture) + ' ' + esc(s.heureCloture || '') + (s.cloture_par_nom ? ' par ' + esc(s.cloture_par_nom) : '') : 'Session encore ouverte') + '</td></tr></tbody></table>';
    var expl = cl ? '<h2>Contrôle</h2><p class="note"><b>Explication de l\'écart :</b> ' + esc(s.explicationEcart || (s.ecartTotal ? 'non renseignée' : 'sans objet')) + '</p>' +
      (s.clotureParTiers || s.clotureTardive ? '<p class="note"><b>Clôture ' + (s.clotureParTiers ? 'par une autre personne' : 'tardive') + ' :</b> ' + esc(s.motifTiersOuTardive || '') + '</p>' : '') +
      (s.mouvementsEnAttente && s.mouvementsEnAttente.length ? '<p class="note"><b>Demandes en attente à la clôture :</b> ' + s.mouvementsEnAttente.map(esc).join(', ') + '</p>' : '') +
      (s.notesCloture ? '<p class="note"><b>Notes :</b> ' + esc(s.notesCloture) + '</p>' : '') + '<p class="note"><b>Visa de la hiérarchie :</b> ' + visaTxt + '</p>' : '';
    var body = '<h2>État de clôture de caisse</h2>' + info + tab + fonds + expl + '<h2>Mouvements de la session</h2>' + trxTable(trx) + '<h2>Bons de la session</h2>' + bonsTable(bons) +
      '<div class="sign"><div>Caissier<small>' + esc(s.operateur || '') + ' — date et signature</small></div><div>Hiérarchie (visa)<small>' + (v && v.statut === 'valide' ? esc(v.decideur_nom || '') + ' — ' + frDT(v.dateDecision) : 'Nom, date et signature') + '</small></div></div>';
    return page('État de clôture de caisse', s.id, body);
  }

  /* ── 3. Bordereau de remise ──────────────────────────────────────────── */
  function bordereauHtml(id) {
    var b = F.coll.bons.find(function (x) { return x.id === id; });
    if (!b || !(C().TYPES[b.type] || {}).remise) return null;
    var banque = b.type === 'remise_banque', r = b.remise || {};
    var st = b.statut === 'valide' ? 'Validée par ' + esc(b.decideur_nom || '') + ' le ' + frDT(b.dateDecision) : b.statut === 'rejete' ? 'Rejetée' : 'En attente de validation';
    var conf = r.statut === 'confirmee' ? 'Réception confirmée par ' + esc(r.par_nom || '') + ' le ' + frDT(r.date) + ' — preuve : ' + esc(r.preuve || '') : (b.statut === 'valide' ? 'Réception à confirmer par une autre personne que ' + esc(b.demandeur_nom || '') : '—');
    var body = '<h2>' + (banque ? 'Bordereau de remise en banque' : 'Bordereau de remise à la direction') + '</h2>' +
      '<table><tbody><tr><th>N° du bon</th><td>' + esc(b.id) + '</td><th>Date</th><td>' + frDate(b.date) + '</td></tr>' +
      '<tr><th>' + (banque ? 'Banque' : 'Destinataire') + '</th><td>' + esc(b.tiers) + '</td><th>Pièce (' + (banque ? 'bordereau' : 'reçu') + ')</th><td>' + esc(b.piece || '') + '</td></tr>' +
      '<tr><th>Montant</th><td colspan="3"><b style="font-size:15px">' + money(b.montant) + '</b></td></tr><tr><th>Motif</th><td colspan="3">' + esc(b.motif) + '</td></tr>' +
      '<tr><th>Remis par</th><td>' + esc(b.demandeur_nom || '') + '</td><th>Session</th><td>' + esc(b.sessionId || '') + '</td></tr>' +
      '<tr><th>Validation</th><td colspan="3">' + st + '</td></tr><tr><th>Confirmation</th><td colspan="3">' + conf + '</td></tr></tbody></table>' +
      '<div class="sign"><div>Remettant (caissier)<small>' + esc(b.demandeur_nom || '') + ' — signature</small></div><div>' + (banque ? 'Porteur / banque' : 'Réceptionnaire') + '<small>Nom, date, signature' + (banque ? ' et cachet' : '') + '</small></div><div>Hiérarchie<small>Nom, date et signature</small></div></div>';
    return page('Bordereau de remise', b.id, body);
  }

  /* ── Onglet « Pièces » de la page Caisse ─────────────────────────────── */
  function injectTab() {
    var bar = document.querySelector('#page-caisse .ftab-bar');
    if (!bar || document.getElementById('ctab-pieces')) return;
    var b = document.createElement('button'); b.className = 'ftab'; b.id = 'ctab-pieces'; b.setAttribute('onclick', "switchCaisseTab('pieces')"); b.textContent = '🖨️ Pièces';
    bar.appendChild(b);
    var anchor = document.getElementById('ctab-panel-sessions'); if (!anchor) return;
    var p = document.createElement('div'); p.id = 'ctab-panel-pieces'; p.style.display = 'none'; anchor.parentNode.appendChild(p);
  }
  function wrapSwitch() {
    var o = window.switchCaisseTab; if (typeof o !== 'function' || o._etats) return;
    window.switchCaisseTab = function (tab) {
      var r = o.apply(this, arguments);
      var btn = document.getElementById('ctab-pieces'), pan = document.getElementById('ctab-panel-pieces');
      if (btn) btn.classList.toggle('active', tab === 'pieces');
      if (pan) pan.style.display = tab === 'pieces' ? '' : 'none';
      if (tab === 'pieces') render();
      return r;
    };
    window.switchCaisseTab._etats = true;
  }
  function render() {
    var p = document.getElementById('ctab-panel-pieces'); if (!p) return;
    var ss = sessions().slice(0, 30);
    var rem = F.coll.bons.filter(function (b) { return (C().TYPES[b.type] || {}).remise; }).slice(0, 30);
    p.innerHTML = '<div class="card"><div class="card-header"><div><div class="card-title">🖨️ Pièces imprimables</div><div class="card-subtitle">Journal du jour, états de clôture signés et bordereaux de remise (impression ou PDF)</div></div></div>' +
      '<div class="fin-bar" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px"><label class="form-label" style="margin:0">Journal du</label><input type="date" class="form-control" id="et-date" value="' + F.today() + '" style="max-width:170px"><button class="btn btn-primary btn-sm" data-et="journal">📒 Journal de caisse</button></div>' +
      '<h4 style="margin:10px 0 6px">États de clôture</h4>' + (ss.length ? '<div class="table-wrap"><table><thead><tr><th>Session</th><th>Date</th><th>Opérateur</th><th>Écart</th><th>Statut</th><th></th></tr></thead><tbody>' + ss.map(function (s) {
        return '<tr><td style="font-family:var(--font-mono);font-size:11px">' + esc(s.id) + '</td><td>' + frDate(s.dateOuverture) + '</td><td>' + esc(s.operateur || '') + '</td><td>' + (s.statut === 'cloturee' ? signed(s.ecartTotal) : '—') + '</td><td>' + (s.statut === 'cloturee' ? '🔒 Clôturée' : '🔓 Ouverte') + '</td><td><button class="btn btn-secondary btn-sm" data-et="cloture" data-id="' + esc(s.id) + '">🖨️ État signé</button></td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="fin-note">Aucune session.</p>') +
      '<h4 style="margin:14px 0 6px">Remises (banque / direction)</h4>' + (rem.length ? '<div class="table-wrap"><table><thead><tr><th>Bon</th><th>Date</th><th>Type</th><th>Destinataire</th><th>Montant</th><th>Statut</th><th></th></tr></thead><tbody>' + rem.map(function (b) {
        return '<tr><td style="font-family:var(--font-mono);font-size:11px">' + esc(b.id) + '</td><td>' + frDate(b.date) + '</td><td>' + esc(typeLabel(b.type)) + '</td><td>' + esc(b.tiers) + '</td><td>' + money(b.montant) + '</td><td>' + ({ attente: 'En attente', valide: 'Validée', rejete: 'Rejetée' }[b.statut] || '') + '</td><td><button class="btn btn-secondary btn-sm" data-et="bordereau" data-id="' + esc(b.id) + '">🖨️ Bordereau</button></td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="fin-note">Aucune remise.</p>') + '</div>';
  }
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest && ev.target.closest('[data-et]'); if (!t || !t.closest('#ctab-panel-pieces')) return;
    var k = t.getAttribute('data-et'), id = t.getAttribute('data-id'), h = null;
    if (k === 'journal') h = journalHtml((document.getElementById('et-date') || {}).value || F.today());
    if (k === 'cloture') h = clotureHtml(id);
    if (k === 'bordereau') h = bordereauHtml(id);
    if (h) open(h); else F.toast('Pièce introuvable.', 'error');
  });
  window.addEventListener('fin-data-changed', function () { var pan = document.getElementById('ctab-panel-pieces'); if (pan && pan.style.display !== 'none') { try { render(); } catch (x) {} } });

  function init() { injectTab(); wrapSwitch(); }
  document.addEventListener('DOMContentLoaded', function () { init(); setTimeout(init, 1600); });

  F.etats = { journalHtml: journalHtml, clotureHtml: clotureHtml, bordereauHtml: bordereauHtml, render: render };
})();
