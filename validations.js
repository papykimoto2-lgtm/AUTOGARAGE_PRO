/* AutoGarage Pro — Page « Validations » : l'espace de la hiérarchie (procédure VAL de Zahara).
   Files d'attente : bons de caisse, dépenses, visas de clôture de caisse (écart), remises à confirmer, écritures à viser.
   Chaque décision est tracée (auteur, date, motif) ; on ne valide jamais sa propre demande ; on ne valide que dans la limite de son plafond ;
   une décision est définitive. Réglage des habilitations et des plafonds par l'administrateur. */
(function () {
  'use strict';
  var F = window.FIN; if (!F || !F.caisse) { console.warn('[Validations] modules caisse/finance manquants'); return; }
  var esc = F.esc, fmt = F.fmt, C = F.caisse;
  var HIST = 'hist';
  var tab = 'attente';

  function me() { return F.who(); }
  function caisseDeciders() { return F.can('caisseValider'); }

  /* ── Files d'attente ─────────────────────────────────────────────────── */
  function files() {
    var bons = F.coll.bons.filter(function (b) { return b.statut === 'attente'; });
    var deps = (typeof DB_DEPENSES !== 'undefined' ? DB_DEPENSES : []).filter(function (d) { return d.vstatut === 'attente'; });
    var visas = C.sessions().filter(function (s) { return s.visa && s.visa.statut === 'attente'; });
    var remises = F.coll.bons.filter(function (b) { return C.TYPES[b.type].remise && b.statut === 'valide' && b.remise && b.remise.statut === 'a_confirmer'; });
    var ecr = F.coll.ecritures.filter(function (e) { return e.statut !== 'vise'; });
    return { bons: bons, deps: deps, visas: visas, remises: remises, ecr: ecr };
  }
  function countFor() {
    var f = files(), m = me(), n = 0;
    if (caisseDeciders()) n += f.bons.length + f.deps.length + f.visas.length + f.remises.length;
    if (F.can('comptaViser')) n += f.ecr.length;
    return n;
  }
  function badge() {
    var b = document.getElementById('badge-validations'); if (!b) return;
    var n = countFor(); b.style.display = n ? '' : 'none'; b.textContent = n;
  }

  /* ── Décisions (fenêtre de motif pour le rejet) ──────────────────────── */
  function decide(kind, id, decision) {
    var run = function (motif) {
      var r = kind === 'bon' ? C.decideBon(id, decision, motif) : kind === 'dep' ? C.decideDepense(id, decision, motif) : kind === 'visa' ? C.decideVisaCloture(id, decision, motif) : F.compta.viser(id);
      F.toast(r.ok ? (decision === 'valide' ? 'Validé' : 'Rejeté') : r.why, r.ok ? (decision === 'valide' ? 'success' : 'info') : 'error');
      render(); return r.ok;
    };
    if (decision === 'rejete') {
      F.modal({ id: 'fin-rej', title: '⛔ Rejeter', html: '<div class="form-group"><label class="form-label">Motif du rejet * <span class="fin-sub">(visible par l\'auteur)</span></label><textarea class="form-control" id="rj-m" rows="3"></textarea></div>', buttons: [{ label: 'Annuler' }, { label: 'Rejeter', cls: 'btn-danger', onClick: function (m) { return run(m.querySelector('#rj-m').value) ? undefined : false; } }] });
    } else {
      F.ask(kind === 'ecr' ? 'Viser l\'écriture ?' : 'Valider ?', '<p class="fin-note">Décision <b>définitive</b>, tracée à votre nom (' + esc(me().nom) + ').</p>', 'Valider', function () { return run('') ? undefined : false; });
    }
  }

  /* ── Affichage ───────────────────────────────────────────────────────── */
  function rowActions(kind, id, can, why) {
    if (!can.ok) return '<span class="fin-sub" title="' + esc(can.why) + '">🔒 ' + esc(can.why) + '</span>';
    return '<button class="btn btn-primary btn-sm" data-dec="' + kind + '|' + esc(id) + '|valide">Valider</button><button class="btn btn-secondary btn-sm" data-dec="' + kind + '|' + esc(id) + '|rejete">Rejeter</button>';
  }
  function section(title, sub, rows) {
    return '<div class="card"><div class="card-header"><div><div class="card-title">' + title + '</div><div class="card-subtitle">' + sub + '</div></div></div>' + rows + '</div>';
  }
  var EMPTY = '<div style="padding:22px;text-align:center;color:var(--text-dim)">Rien en attente.</div>';

  function viewAttente() {
    var f = files(), out = '', total = 0;
    if (!caisseDeciders() && !F.can('comptaViser')) return '<div class="fin-warn">🔒 Votre rôle ne comporte aucun droit de validation. Les décisions sont prises par la hiérarchie (chef d\'atelier, administrateur).</div>';
    if (caisseDeciders()) {
      total += f.bons.length + f.deps.length + f.visas.length + f.remises.length;
      out += section('🧾 Mouvements de caisse', 'Entrées, sorties, remises, réapprovisionnements : comptent dans le solde seulement une fois validés', f.bons.length ? '<div class="table-wrap"><table><thead><tr><th>N°</th><th>Type</th><th>Motif</th><th>Personne</th><th>Montant</th><th>Demandeur</th><th></th></tr></thead><tbody>' + f.bons.map(function (b) {
        var t = C.TYPES[b.type]; return '<tr><td style="font-family:var(--font-mono);font-size:11px">' + esc(b.id) + '</td><td>' + esc(t.label) + '</td><td>' + esc(b.motif) + (b.piece ? '<div class="fin-sub">Pièce : ' + esc(b.piece) + '</div>' : '') + '</td><td>' + esc(b.tiers) + '</td><td style="text-align:right;font-family:var(--font-mono);color:' + (t.sens > 0 ? 'var(--green)' : 'var(--red)') + '">' + (t.sens > 0 ? '+' : '−') + fmt(b.montant) + '</td><td>' + esc(b.demandeur_nom) + '<div class="fin-sub">' + esc((b.cree || '').slice(0, 16).replace('T', ' ')) + '</div></td><td class="fin-rowact">' + rowActions('bon', b.id, F.canDecide('caisse', b.montant, b.demandeur_login)) + '</td></tr>'; }).join('') + '</tbody></table></div>' : EMPTY);
      out += section('💸 Dépenses', 'Dépenses saisies, à approuver avant d\'être comptabilisées', f.deps.length ? '<div class="table-wrap"><table><thead><tr><th>N°</th><th>Date</th><th>Catégorie</th><th>Bénéficiaire</th><th>Montant</th><th>Demandeur</th><th></th></tr></thead><tbody>' + f.deps.map(function (d) { var cat = (typeof CATEGORIES_DEP !== 'undefined' && CATEGORIES_DEP[d.cat]) ? CATEGORIES_DEP[d.cat].label : d.cat; return '<tr><td style="font-family:var(--font-mono);font-size:11px">' + esc(d.id) + '</td><td>' + esc(d.date) + '</td><td>' + esc(cat) + '</td><td>' + esc(d.benef) + (d.desc ? '<div class="fin-sub">' + esc(d.desc) + '</div>' : '') + '</td><td style="text-align:right;font-family:var(--font-mono)">' + fmt(d.montant) + '</td><td>' + esc(d.demandeur_nom || '—') + '</td><td class="fin-rowact">' + rowActions('dep', d.id, F.canDecide('caisse', d.montant, d.demandeur_login)) + '</td></tr>'; }).join('') + '</tbody></table></div>' : EMPTY);
      out += section('🔒 Visas de clôture de caisse', 'Écart supérieur à la tolérance (' + fmt(F.hab().ecartTolere) + ' F)', f.visas.length ? '<div class="table-wrap"><table><thead><tr><th>Session</th><th>Date</th><th>Opérateur</th><th>Écart</th><th>Explication</th><th></th></tr></thead><tbody>' + f.visas.map(function (s) { return '<tr><td style="font-family:var(--font-mono);font-size:11px">' + esc(s.id) + '</td><td>' + esc(s.dateCloture || s.dateOuverture) + '</td><td>' + esc(s.operateur || '') + '</td><td style="text-align:right;color:var(--red);font-family:var(--font-mono)">' + (s.visa.ecart >= 0 ? '+' : '') + fmt(s.visa.ecart) + '</td><td>' + esc(s.explicationEcart || '—') + '</td><td class="fin-rowact">' + rowActions('visa', s.id, F.canDecide('caisse', Math.abs(s.visa.ecart), s.visa.demandeur_login)) + '</td></tr>'; }).join('') + '</tbody></table></div>' : EMPTY);
      if (f.remises.length) out += section('🏦 Remises à confirmer', 'Réception à confirmer par une autre personne que celle qui a saisi la remise', '<div class="table-wrap"><table><thead><tr><th>N°</th><th>Type</th><th>Pièce</th><th>Montant</th><th>Saisie par</th><th></th></tr></thead><tbody>' + f.remises.map(function (b) { var own = F.sameUser(b.demandeur_login, me().login); return '<tr><td style="font-family:var(--font-mono);font-size:11px">' + esc(b.id) + '</td><td>' + esc(C.TYPES[b.type].label) + '</td><td>' + esc(b.piece) + '</td><td style="text-align:right">' + fmt(b.montant) + '</td><td>' + esc(b.demandeur_nom) + '</td><td>' + (own ? '<span class="fin-sub">🔒 vous l\'avez saisie</span>' : '<button class="btn btn-primary btn-sm" data-conf="' + esc(b.id) + '">Confirmer la réception</button>') + '</td></tr>'; }).join('') + '</tbody></table></div>');
    }
    if (F.can('comptaViser')) {
      total += f.ecr.length;
      out += section('📒 Écritures à viser', 'Pièces comptables au brouillard (visa dans la limite de votre plafond, jamais sur sa propre saisie)', f.ecr.length ? '<div class="table-wrap"><table><thead><tr><th>Date</th><th>Jnl</th><th>Pièce</th><th>Libellé</th><th>Montant</th><th>Saisie</th><th></th></tr></thead><tbody>' + f.ecr.slice(0, 200).map(function (e) { return '<tr><td>' + esc(e.date) + '</td><td>' + esc(e.journal) + '</td><td>' + esc(e.piece) + '</td><td>' + esc(e.libelle) + '</td><td style="text-align:right;font-family:var(--font-mono)">' + fmt(F.compta.totaux(e.lignes).debit) + '</td><td>' + esc(e.auteur_nom || '') + '</td><td class="fin-rowact">' + rowActions('ecr', e.id, F.canDecide('compta', F.compta.totaux(e.lignes).debit, e.auteur_login)) + '</td></tr>'; }).join('') + '</tbody></table></div>' : EMPTY);
    }
    return (total ? '' : '<div class="fin-ok">✅ Aucune décision en attente.</div>') + out;
  }

  function viewHistorique() {
    var rows = [];
    F.coll.bons.forEach(function (b) { if (b.statut !== 'attente' && b.dateDecision) rows.push({ d: b.dateDecision, t: 'Bon de caisse', ref: b.id, m: b.montant, st: b.statut, par: b.decideur_nom, dem: b.demandeur_nom, motif: b.motifRejet }); });
    (typeof DB_DEPENSES !== 'undefined' ? DB_DEPENSES : []).forEach(function (d) { if (d.dateDecision) rows.push({ d: d.dateDecision, t: 'Dépense', ref: d.id, m: d.montant, st: d.vstatut, par: d.decideur_nom, dem: d.demandeur_nom, motif: d.motifRejet }); });
    C.sessions().forEach(function (s) { if (s.visa && s.visa.dateDecision) rows.push({ d: s.visa.dateDecision, t: 'Visa de clôture', ref: s.id, m: Math.abs(s.visa.ecart), st: s.visa.statut, par: s.visa.decideur_nom, dem: s.visa.demandeur_nom, motif: s.visa.motif }); });
    F.coll.ecritures.forEach(function (e) { if (e.statut === 'vise' && e.dateVisa && !e.auto) rows.push({ d: e.dateVisa, t: 'Écriture', ref: e.piece || e.id, m: F.compta.totaux(e.lignes).debit, st: 'valide', par: e.viseur_nom, dem: e.auteur_nom }); });
    rows.sort(function (a, b) { return a.d < b.d ? 1 : -1; });
    return '<div class="card"><div class="card-title">Historique des décisions</div>' + (rows.length ? '<div class="table-wrap"><table><thead><tr><th>Date</th><th>Objet</th><th>Réf.</th><th>Montant</th><th>Décision</th><th>Décideur</th><th>Demandeur</th><th>Motif</th></tr></thead><tbody>' + rows.map(function (r) { return '<tr><td>' + esc(r.d.slice(0, 16).replace('T', ' ')) + '</td><td>' + esc(r.t) + '</td><td style="font-family:var(--font-mono);font-size:11px">' + esc(r.ref) + '</td><td style="text-align:right">' + fmt(r.m) + '</td><td>' + C.badgeSt(r.st) + '</td><td>' + esc(r.par || '') + '</td><td>' + esc(r.dem || '') + '</td><td>' + esc(r.motif || '') + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<div style="padding:24px;text-align:center;color:var(--text-dim)">Aucune décision.</div>') + '</div>';
  }

  function render() {
    badge();
    var root = document.getElementById('validations-root'); if (!root) return;
    var act = document.getElementById('validations-actions');
    if (act) act.innerHTML = me().role === 'admin' ? '<button class="btn btn-secondary btn-sm" data-act="hab">⚙️ Habilitations et plafonds</button>' : '';
    root.innerHTML = '<div class="fin-tabs"><button class="ftab' + (tab === 'attente' ? ' active' : '') + '" data-vtab="attente">En attente <span class="nav-badge red"' + (countFor() ? '' : ' style="display:none"') + '>' + countFor() + '</span></button><button class="ftab' + (tab === HIST ? ' active' : '') + '" data-vtab="' + HIST + '">Historique</button></div>' +
      '<div class="fin-note">Règles : on ne valide <b>jamais sa propre demande</b> · uniquement <b>dans la limite de son plafond</b> · une décision est <b>définitive</b> · un rejet est <b>motivé</b>. Votre plafond : <b>' + (F.plafond() === Infinity ? 'illimité' : fmt(F.plafond()) + ' F') + '</b>.</div>' +
      (tab === HIST ? viewHistorique() : viewAttente());
  }

  /* ── Habilitations ───────────────────────────────────────────────────── */
  function habModal() {
    if (me().role !== 'admin') return F.toast('Réservé à l\'administrateur', 'error');
    var h = F.hab();
    var rows = F.ROLE_LIST.map(function (r) {
      var rr = h.roles[r[0]] || {}, p = h.plafonds[r[0]];
      return '<tr><td><b>' + esc(r[1]) + '</b></td>' + F.RIGHTS.map(function (x) { return '<td style="text-align:center"><input type="checkbox" data-hr="' + r[0] + '|' + x.id + '"' + (r[0] === 'admin' || rr[x.id] ? ' checked' : '') + (r[0] === 'admin' ? ' disabled' : '') + '></td>'; }).join('') + '<td><input class="form-control" data-hp="' + r[0] + '" type="number" min="0" placeholder="illimité" value="' + (p === null || p === undefined ? '' : p) + '" style="width:110px"' + (r[0] === 'admin' ? ' disabled' : '') + '></td></tr>';
    }).join('');
    F.modal({ id: 'fin-hab', wide: true, title: '⚙️ Habilitations et plafonds', html: '<div class="fin-note"><b>Plafond</b> : montant maximal qu\'un rôle peut valider. Vide = illimité · 0 = aucune validation. L\'administrateur a tous les droits.</div>' +
      '<div class="table-wrap"><table><thead><tr><th>Rôle</th>' + F.RIGHTS.map(function (x) { return '<th style="text-align:center;font-size:11px">' + esc(x.label) + '</th>'; }).join('') + '<th>Plafond (F)</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<label class="fin-check" style="margin-top:12px"><input type="checkbox" id="hb-strict"' + (h.strict ? ' checked' : '') + '> <span><b>Séparation des tâches stricte</b> : personne ne valide sa propre demande (administrateur compris). Décochez uniquement pour une petite structure où l\'administrateur fait tout.</span></label>' +
      '<div class="form-row"><div class="form-group"><label class="form-label">Sortie / dépense soumise à validation à partir de (F)</label><input class="form-control" id="hb-seuil" type="number" min="0" value="' + h.seuilSortie + '"></div><div class="form-group"><label class="form-label">Écart de clôture toléré sans visa (F)</label><input class="form-control" id="hb-ecart" type="number" min="0" value="' + h.ecartTolere + '"></div><div class="form-group"><label class="form-label">Délai de clôture de caisse (heures)</label><input class="form-control" id="hb-delai" type="number" min="1" value="' + h.delaiClotureH + '"></div></div>',
      buttons: [{ label: 'Annuler' }, { label: 'Enregistrer', cls: 'btn-primary', onClick: function (m) {
        var n = F.defaultHab(); n.strict = m.querySelector('#hb-strict').checked;
        n.seuilSortie = Number(m.querySelector('#hb-seuil').value) || 0; n.ecartTolere = Number(m.querySelector('#hb-ecart').value) || 0; n.delaiClotureH = Number(m.querySelector('#hb-delai').value) || 24;
        m.querySelectorAll('[data-hr]').forEach(function (c) { var p = c.getAttribute('data-hr').split('|'); n.roles[p[0]][p[1]] = c.checked ? 1 : 0; });
        m.querySelectorAll('[data-hp]').forEach(function (c) { var r = c.getAttribute('data-hp'); n.plafonds[r] = c.value === '' ? null : Number(c.value); });
        n.roles.admin = { caisseSaisie: 1, caisseValider: 1, comptaSaisie: 1, comptaViser: 1, comptaCloturer: 1 }; n.plafonds.admin = null;
        F.saveHab(n); F.toast('Habilitations enregistrées', 'success'); render();
      } }] });
  }

  document.addEventListener('click', function (ev) {
    var page = document.getElementById('page-validations'); if (!page || !page.contains(ev.target)) return;
    var t = ev.target.closest('[data-dec],[data-vtab],[data-act],[data-conf]'); if (!t) return;
    if (t.hasAttribute('data-vtab')) { tab = t.getAttribute('data-vtab'); return render(); }
    if (t.hasAttribute('data-dec')) { var p = t.getAttribute('data-dec').split('|'); return decide(p[0], p[1], p[2]); }
    if (t.hasAttribute('data-conf')) { var id = t.getAttribute('data-conf'); return F.modal({ id: 'fin-conf2', title: 'Confirmer la réception de la remise', html: '<div class="form-group"><label class="form-label">Référence de la preuve * (reçu bancaire, accusé signé)</label><input class="form-control" id="vc-ref"></div>', buttons: [{ label: 'Annuler' }, { label: 'Confirmer', cls: 'btn-primary', onClick: function (m) { var r = C.confirmerRemise(id, m.querySelector('#vc-ref').value); F.toast(r.ok ? 'Réception confirmée' : r.why, r.ok ? 'success' : 'error'); render(); return r.ok ? undefined : false; } }] }); }
    if (t.getAttribute('data-act') === 'hab') return habModal();
  });

  F.onPage('validations', render);
  window.addEventListener('fin-data-changed', function () { badge(); try { if (document.querySelector('#page-validations.active')) render(); } catch (x) {} });
  document.addEventListener('DOMContentLoaded', function () { setInterval(badge, 5000); setTimeout(badge, 2000); });

  F.validations = { render: render, badge: badge, files: files, countFor: countFor, habModal: habModal };
})();
