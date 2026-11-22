/* AutoGarage Pro — Caisse : bons validés par la hiérarchie, PIN, remises, clôture contrôlée, rapprochement.
   S'ajoute à la caisse existante (sessions, encaissements des factures) sans la remplacer.
   Règles reprises des procédures CAI de Zahara :
   - une entrée / sortie de caisse ne compte dans le solde qu'une fois VALIDÉE par une autre personne, dans la limite de son plafond ;
   - une décision est définitive ; un rejet est motivé ;
   - une seule session ouverte, tenue par une seule personne, avec un code PIN ;
   - remise en banque / à la direction : pièce obligatoire, réception confirmée par une AUTRE personne ;
   - clôture : comptage, écart expliqué, mouvements en attente mentionnés, visa si l'écart dépasse la tolérance.
   Les remises et réapprovisionnements passent par le FOND de la session : ils ne faussent ni le chiffre d'affaires ni les dépenses. */
(function () {
  'use strict';
  var F = window.FIN; if (!F) { console.warn('[Caisse] finance.js manquant'); return; }
  var esc = F.esc, fmt = F.fmt;

  var TYPES = {
    entree: { label: 'Bon d\'entrée', sens: 1, tiers: 'Déposant' },
    sortie: { label: 'Bon de sortie', sens: -1, tiers: 'Bénéficiaire' },
    remise_banque: { label: 'Remise en banque', sens: -1, tiers: 'Banque / porteur', remise: true },
    remise_direction: { label: 'Remise à la direction', sens: -1, tiers: 'Remis à', remise: true },
    reappro: { label: 'Réapprovisionnement de caisse', sens: 1, tiers: 'Origine des fonds' }
  };
  var MODES = ['💵 Espèces', '📱 Mobile Money', '💳 Carte'];

  function session() { return typeof _caisseSessionActive === 'function' ? _caisseSessionActive() : null; }
  function sessions() { return typeof DB_SESSIONS_CAISSE !== 'undefined' ? DB_SESSIONS_CAISSE : []; }
  function bucket(mode) { var k = typeof _caisseNormalMode === 'function' ? _caisseNormalMode(mode) : 'Especes'; return k === 'Carte' ? 'Carte' : k === 'Especes' ? 'Especes' : 'MobileMoney'; }
  function solde(mode) { try { return (_caisseSoldeSession() || {})[bucket(mode)] || 0; } catch (x) { return 0; } }
  function persist() { F.save(); try { if (typeof saveData === 'function') saveData(); } catch (x) {} refresh(); }
  function refresh() {
    try { window.dispatchEvent(new Event('fin-data-changed')); } catch (x) {}
    try { if (typeof renderCaisse === 'function' && document.querySelector('#page-caisse.active')) renderCaisse(); } catch (x) {}
    try { renderBonsTab(); } catch (x) {}
  }
  function pending(sessionId) { return F.coll.bons.filter(function (b) { return b.statut === 'attente' && (!sessionId || b.sessionId === sessionId); }); }

  /* ── Création d'un bon ───────────────────────────────────────────────── */
  function createBon(p, force) {
    var me = F.who(), t = TYPES[p.type];
    if (!t) return { ok: false, why: 'Type de bon inconnu.' };
    if (!F.can('caisseSaisie')) return { ok: false, why: 'Votre rôle ne permet pas de saisir des bons de caisse.' };
    var s = session();
    if (!s) return { ok: false, why: 'Ouvrez d\'abord la caisse (aucune session ouverte).' };
    if (s.operateur_login && !F.sameUser(s.operateur_login, me.login) && me.role !== 'admin') return { ok: false, why: 'Cette caisse est tenue par ' + (s.operateur || s.operateur_login) + '.' };
    var m = Number(p.montant);
    if (!(m > 0)) return { ok: false, why: 'Le montant doit être supérieur à zéro.' };
    if (!String(p.motif || '').trim()) return { ok: false, why: 'Le motif est obligatoire.' };
    if (!String(p.tiers || '').trim()) return { ok: false, why: t.tiers + ' obligatoire.' };
    if (t.remise && !String(p.piece || '').trim()) return { ok: false, why: 'Une remise exige une pièce : n° du bordereau de versement (banque) ou du reçu signé (direction).' };
    var mode = t.remise || p.type === 'reappro' ? MODES[0] : (p.mode || MODES[0]);
    if (!force) {
      if (t.sens < 0 && m > solde(mode)) return { ok: false, confirm: 'La sortie (' + fmt(m) + ' F) dépasse le solde disponible (' + fmt(solde(mode)) + ' F). Continuer ?' };
      var dup = F.coll.bons.some(function (b) { return b.type === p.type && Number(b.montant) === m && String(b.tiers).toLowerCase() === String(p.tiers).trim().toLowerCase() && b.sessionId === s.id && (Date.now() - new Date(b.cree).getTime()) < 10 * 60 * 1000; });
      if (dup) return { ok: false, confirm: 'Un bon identique (même type, montant et personne) a été saisi il y a moins de 10 minutes. Continuer ?' };
    }
    var bon = {
      id: F.numBon(p.type), type: p.type, date: p.date || F.today(), montant: m, mode: mode, motif: String(p.motif).trim(), tiers: String(p.tiers).trim(),
      piece: String(p.piece || '').trim(), sessionId: s.id, statut: 'attente', cree: F.nowISO(),
      demandeur_login: me.login, demandeur_nom: me.nom, demandeur_role: me.role
    };
    if (p.lien) bon.lien = p.lien;
    F.coll.bons.unshift(bon);
    persist();
    return { ok: true, bon: bon };
  }

  /* ── Décision de la hiérarchie ───────────────────────────────────────── */
  function applyBon(b, s) {
    var t = TYPES[b.type];
    if (b.type === 'entree' || b.type === 'sortie') {
      var trx = { id: 'TRX-' + b.id, date: b.date, ref: b.id, client: b.tiers, montant: t.sens * b.montant, mode: b.mode, notes: b.motif, source: 'bon', bonId: b.id,
        transaction_type: t.sens > 0 ? 'encaissement' : 'depense', type: t.sens > 0 ? 'encaissement' : 'depense' };
      DB.transactions.unshift(trx); b.trxId = trx.id;
      if (b.lien && b.lien.type === 'ff' && typeof DB_FACTURES_FOURN !== 'undefined') {
        var ff = DB_FACTURES_FOURN.find(function (f) { return f.id === b.lien.id; });
        if (ff) { ff.statut = 'payee'; ff.datePaiement = b.date; ff.modePaiement = b.mode; }
      }
    } else {
      /* remise / réapprovisionnement : mouvement de FONDS de la session (ni recette ni dépense) */
      s.fondEspeces = Math.round((Number(s.fondEspeces) || 0) + t.sens * b.montant);
      (s.mouvementsFonds = s.mouvementsFonds || []).push({ bonId: b.id, type: b.type, montant: t.sens * b.montant, date: b.date });
      if (t.remise) b.remise = { statut: 'a_confirmer' };
    }
  }

  function decideBon(id, decision, motif) {
    var b = F.coll.bons.find(function (x) { return x.id === id; });
    if (!b) return { ok: false, why: 'Bon introuvable.' };
    if (b.statut !== 'attente') return { ok: false, why: 'Décision définitive : ce bon est déjà ' + (b.statut === 'valide' ? 'validé' : b.statut === 'rejete' ? 'rejeté' : 'clos') + '.' };
    var me = F.who();
    if (decision === 'rejete' && !String(motif || '').trim()) return { ok: false, why: 'Le motif du rejet est obligatoire.' };
    if (decision === 'retire') {                                   /* l'auteur retire sa propre demande */
      if (!F.sameUser(b.demandeur_login, me.login) && me.role !== 'admin') return { ok: false, why: 'Seul l\'auteur peut retirer sa demande.' };
      b.statut = 'rejete'; b.motifRejet = 'Retiré par son auteur' + (motif ? ' : ' + motif : ''); b.decideur_login = me.login; b.decideur_nom = me.nom; b.dateDecision = F.nowISO();
      persist(); return { ok: true, bon: b };
    }
    var d = F.canDecide('caisse', b.montant, b.demandeur_login);
    if (!d.ok) return { ok: false, why: d.why };
    if (decision === 'valide') {
      var s = F.coll.bons && sessions().find(function (x) { return x.id === b.sessionId; });
      if (!s || s.statut !== 'ouverte') return { ok: false, why: 'La session de ce bon est clôturée : validation impossible.' };
      var t = TYPES[b.type];
      if (t.sens < 0 && b.montant > solde(b.mode)) return { ok: false, why: 'Disponible insuffisant en caisse (' + fmt(solde(b.mode)) + ' F) pour cette sortie de ' + fmt(b.montant) + ' F.' };
      applyBon(b, s);
      b.statut = 'valide';
    } else {
      b.statut = 'rejete'; b.motifRejet = String(motif).trim();
    }
    b.decideur_login = me.login; b.decideur_nom = me.nom; b.decideur_role = me.role; b.dateDecision = F.nowISO();
    persist();
    return { ok: true, bon: b };
  }

  /* Remise : réception confirmée par une AUTRE personne, avec la référence de la preuve */
  function confirmerRemise(id, ref) {
    var b = F.coll.bons.find(function (x) { return x.id === id; });
    if (!b || !TYPES[b.type] || !TYPES[b.type].remise) return { ok: false, why: 'Remise introuvable.' };
    if (b.statut !== 'valide') return { ok: false, why: 'La remise doit d\'abord être validée.' };
    if (b.remise && b.remise.statut === 'confirmee') return { ok: false, why: 'Réception déjà confirmée.' };
    var me = F.who();
    if (F.sameUser(me.login, b.demandeur_login)) return { ok: false, why: 'La réception doit être confirmée par une autre personne que celle qui a saisi la remise.' };
    if (!F.can('caisseValider') && me.role !== 'admin') return { ok: false, why: 'Confirmation réservée à la hiérarchie.' };
    if (!String(ref || '').trim()) return { ok: false, why: 'Saisissez la référence de la preuve (reçu bancaire, accusé signé).' };
    b.remise = { statut: 'confirmee', preuve: String(ref).trim(), par_login: me.login, par_nom: me.nom, date: F.nowISO() };
    persist(); return { ok: true, bon: b };
  }

  /* Annuler un bon validé : bon inverse (contre-passation), à valider à son tour */
  function inverseType(type) { return { entree: 'sortie', sortie: 'entree', reappro: 'remise_direction', remise_banque: 'reappro', remise_direction: 'reappro' }[type]; }
  function contrepasserBon(id, motif) {
    var b = F.coll.bons.find(function (x) { return x.id === id; });
    if (!b || b.statut !== 'valide') return { ok: false, why: 'Seul un bon validé se contre-passe.' };
    if (b.contrepasse) return { ok: false, why: 'Ce bon est déjà contre-passé.' };
    if (!String(motif || '').trim()) return { ok: false, why: 'Le motif est obligatoire.' };
    var r = createBon({ type: inverseType(b.type), montant: b.montant, motif: 'Contre-passation de ' + b.id + ' — ' + motif, tiers: b.tiers, piece: b.piece || 'CP-' + b.id, mode: b.mode, lien: { type: 'contrepassation', id: b.id } }, true);
    if (r.ok) { b.contrepasse = r.bon.id; persist(); }
    return r;
  }

  /* ── PIN ──────────────────────────────────────────────────────────────── */
  function pinKey(login) { return 'gp_pin_' + String(login || '').toLowerCase(); }
  function sha(txt) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt)).then(function (b) { return Array.from(new Uint8Array(b)).map(function (x) { return x.toString(16).padStart(2, '0'); }).join(''); });
  }
  function pinHas(login) { try { return !!localStorage.getItem(pinKey(login)); } catch (x) { return false; } }
  function pinSet(login, pin) { return sha('autogarage:' + String(login).toLowerCase() + ':' + pin).then(function (h) { try { localStorage.setItem(pinKey(login), h); } catch (x) {} return true; }); }
  function pinCheck(login, pin) { return sha('autogarage:' + String(login).toLowerCase() + ':' + pin).then(function (h) { var s = null; try { s = localStorage.getItem(pinKey(login)); } catch (x) {} return s === h; }); }

  /* ── Ouverture : PIN, motif de différence, une seule session ─────────── */
  function lastClosed() { return sessions().filter(function (s) { return s.statut === 'cloturee'; })[0] || null; }

  function injectOpenExtras() {
    var body = document.querySelector('#modal-ouverture-caisse .modal-body'); if (!body) return;
    var box = document.getElementById('fin-oc-extra'); if (box) box.remove();
    var me = F.who(), last = lastClosed();
    box = document.createElement('div'); box.id = 'fin-oc-extra';
    box.innerHTML = (last ? '<div class="fin-note">Dernier comptage de clôture (espèces) : <b>' + fmt(last.compteEspeces) + ' F</b>. Si le fond saisi diffère, indiquez le motif.</div>' : '') +
      '<div class="form-group fin-diff" style="display:none"><label class="form-label">Motif de la différence avec le dernier comptage *</label><input class="form-control" id="oc-motif-diff" placeholder="Ex. dépôt en banque, erreur de comptage…"></div>' +
      '<div class="form-group"><label class="form-label">🔐 Code PIN (4 chiffres) *</label><input class="form-control" id="oc-pin" type="password" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="••••"></div>' +
      (pinHas(me.login) ? '' : '<div class="form-group"><label class="form-label">Créez votre code PIN : confirmez *</label><input class="form-control" id="oc-pin2" type="password" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="••••"><div class="fin-note">Première ouverture : choisissez un code à 4 chiffres, il vous sera demandé à chaque ouverture.</div></div>');
    var notes = document.getElementById('oc-notes');
    (notes ? notes.closest('.form-group') : body.lastElementChild).insertAdjacentElement('beforebegin', box);
    var fond = document.getElementById('oc-fond-especes');
    var upd = function () { var d = box.querySelector('.fin-diff'); if (d && last) d.style.display = (Number(fond.value) || 0) !== (Number(last.compteEspeces) || 0) ? '' : 'none'; };
    if (fond) { fond.addEventListener('input', upd); upd(); }
  }

  function wrapOpen() {
    var o1 = window.ouvrirCaisse;
    if (typeof o1 === 'function' && !o1._fin) {
      window.ouvrirCaisse = function () {
        if (!F.can('caisseSaisie')) { F.toast('Votre rôle ne permet pas d\'ouvrir la caisse.', 'error'); return; }
        var r = o1.apply(this, arguments);
        injectOpenExtras();
        var op = document.getElementById('oc-operateur'); if (op) { op.value = F.who().nom || F.who().login; }
        return r;
      };
      window.ouvrirCaisse._fin = true;
    }
    var o2 = window.saveOuvertureCaisse;
    if (typeof o2 === 'function' && !o2._fin) {
      window.saveOuvertureCaisse = function () {
        var me = F.who(), ctx = this, args = arguments;
        var g = function (id) { return (document.getElementById(id) || {}).value || ''; };
        var fail = function (m) { F.toast(m, 'error'); };
        if (!F.can('caisseSaisie')) return fail('Votre rôle ne permet pas d\'ouvrir la caisse.');
        if (session()) return fail('Une session est déjà ouverte (une seule session à la fois).');
        var fond = Number(g('oc-fond-especes')) || 0;
        if (fond < 0) return fail('Le fond de caisse ne peut pas être négatif.');
        var last = lastClosed();
        if (last && fond !== (Number(last.compteEspeces) || 0) && !g('oc-motif-diff').trim()) return fail('Le fond diffère du dernier comptage : saisissez le motif de la différence.');
        var pin = g('oc-pin');
        if (!/^\d{4}$/.test(pin)) return fail('Saisissez votre code PIN à 4 chiffres.');
        var step = pinHas(me.login)
          ? pinCheck(me.login, pin).then(function (ok) { if (!ok) throw new Error('Code PIN incorrect.'); })
          : (g('oc-pin2') === pin ? pinSet(me.login, pin) : Promise.reject(new Error('Les deux codes PIN ne correspondent pas.')));
        /* une seule session sur tous les appareils : on actualise d'abord depuis le cloud (si joignable) */
        var sync = (typeof window._syncFull === 'function' && navigator.onLine) ? Promise.race([window._syncFull(), new Promise(function (r) { setTimeout(r, 4000); })]).catch(function () {}) : Promise.resolve();
        step.then(function () { return sync; }).then(function () {
          if (session()) throw new Error('Une session vient d\'être ouverte sur un autre appareil.');
          var r = o2.apply(ctx, args);
          var s = session();
          if (s) { s.operateur_login = me.login; s.operateur_role = me.role; s.fondInitialEspeces = Number(s.fondEspeces) || 0; s.motifDiff = g('oc-motif-diff').trim() || undefined; s.ouvertPar = me.nom; persist(); }
          return r;
        }).catch(function (e) { fail(e.message || 'Ouverture impossible.'); });
      };
      window.saveOuvertureCaisse._fin = true;
    }
  }

  /* ── Clôture : comptage, écart expliqué, mouvements en attente, visa ─── */
  function injectCloseExtras() {
    var body = document.querySelector('#modal-cloture-caisse .modal-body'); if (!body) return;
    var box = document.getElementById('fin-cl-extra'); if (box) box.remove();
    var s = session(); if (!s) return;
    var pend = pending(s.id);
    box = document.createElement('div'); box.id = 'fin-cl-extra';
    box.innerHTML = (pend.length ? '<div class="fin-warn">⏳ <b>' + pend.length + ' mouvement(s) en attente de validation</b> (' + fmt(pend.reduce(function (n, b) { return n + b.montant; }, 0)) + ' F) : ils ne comptent pas dans le solde. Mentionnez-les ci-dessous.</div>' +
        '<label class="fin-check"><input type="checkbox" id="cl-pend-ack"> Je mentionne ces mouvements en attente dans la clôture.</label>' : '') +
      '<div class="form-group"><label class="form-label">Explication de l\'écart <span id="cl-expl-req"></span></label><textarea class="form-control" id="cl-explication" rows="2" placeholder="Obligatoire si le comptage diffère du solde théorique"></textarea></div>' +
      '<div class="form-group" id="cl-late" style="display:none"><label class="form-label">Motif de la clôture tardive / par un tiers *</label><input class="form-control" id="cl-motif-tiers"></div>';
    var notes = document.getElementById('cl-notes');
    (notes ? notes.closest('.form-group') : body.lastElementChild).insertAdjacentElement('beforebegin', box);
    var me = F.who(), late = (Date.now() - new Date(s.dateOuverture + 'T' + (s.heureOuverture || '00:00') + ':00').getTime()) > F.hab().delaiClotureH * 3600 * 1000;
    var third = s.operateur_login && !F.sameUser(s.operateur_login, me.login);
    if (late || third) { document.getElementById('cl-late').style.display = ''; }
  }

  function wrapClose() {
    var c1 = window.cloturerCaisse;
    if (typeof c1 === 'function' && !c1._fin) {
      window.cloturerCaisse = function () { var r = c1.apply(this, arguments); injectCloseExtras(); return r; };
      window.cloturerCaisse._fin = true;
    }
    var c2 = window.saveClotureCaisse;
    if (typeof c2 === 'function' && !c2._fin) {
      window.saveClotureCaisse = function () {
        var s = session(), me = F.who(), ctx = this, args = arguments;
        if (!s) { F.toast('Aucune session ouverte', 'error'); return; }
        var g = function (id) { return (document.getElementById(id) || {}).value || ''; };
        var fail = function (m) { F.toast(m, 'error'); };
        if (s.operateur_login && !F.sameUser(s.operateur_login, me.login) && me.role !== 'admin') return fail('Seule la personne qui tient la caisse (' + (s.operateur || s.operateur_login) + ') ou un administrateur peut la clôturer.');
        var cE = g('cl-compte-especes'), cM = g('cl-compte-mm'), cC = g('cl-compte-carte');
        if (cE === '' || Number(cE) < 0 || Number(cM) < 0 || Number(cC) < 0) return fail('Comptage absent ou négatif : saisissez le montant réellement compté.');
        var t = _caisseSoldeSession(), ecart = Math.round((Number(cE) - t.Especes) + (Number(cM) - t.MobileMoney) + (Number(cC) - t.Carte));
        var pend = pending(s.id);
        if (pend.length && !(document.getElementById('cl-pend-ack') || {}).checked) return fail('Mentionnez les mouvements en attente de validation (case à cocher).');
        if (ecart !== 0 && !g('cl-explication').trim()) return fail('Écart de ' + fmt(ecart) + ' F : saisissez l\'explication de l\'écart.');
        var late = (Date.now() - new Date(s.dateOuverture + 'T' + (s.heureOuverture || '00:00') + ':00').getTime()) > F.hab().delaiClotureH * 3600 * 1000;
        var third = s.operateur_login && !F.sameUser(s.operateur_login, me.login);
        if ((late || third) && !g('cl-motif-tiers').trim()) return fail('Clôture tardive ou par un tiers : saisissez le motif.');
        var expl = g('cl-explication').trim(), motifT = g('cl-motif-tiers').trim();
        var r = c2.apply(ctx, args);
        if (s.statut === 'cloturee') {
          s.explicationEcart = expl || undefined; s.cloture_par_login = me.login; s.cloture_par_nom = me.nom; s.clotureParTiers = !!third; s.clotureTardive = !!late; s.motifTiersOuTardive = motifT || undefined;
          s.mouvementsEnAttente = pend.map(function (b) { return b.id; });
          if (Math.abs(ecart) > F.hab().ecartTolere) s.visa = { statut: 'attente', ecart: ecart, demandeur_login: me.login, demandeur_nom: me.nom, date: F.nowISO() };
          persist();
          if (s.visa) F.toast('Écart de ' + fmt(ecart) + ' F supérieur à la tolérance : visa de la hiérarchie demandé.', 'info');
        }
        return r;
      };
      window.saveClotureCaisse._fin = true;
    }
  }

  /* Visa de clôture (écart significatif) */
  function decideVisaCloture(sessionId, decision, motif) {
    var s = sessions().find(function (x) { return x.id === sessionId; });
    if (!s || !s.visa || s.visa.statut !== 'attente') return { ok: false, why: 'Aucun visa en attente pour cette session.' };
    var d = F.canDecide('caisse', Math.abs(s.visa.ecart), s.visa.demandeur_login);
    if (!d.ok) return { ok: false, why: d.why };
    if (decision === 'rejete' && !String(motif || '').trim()) return { ok: false, why: 'Le motif est obligatoire.' };
    var me = F.who();
    s.visa.statut = decision === 'valide' ? 'valide' : 'rejete'; s.visa.motif = String(motif || '').trim() || undefined; s.visa.decideur_login = me.login; s.visa.decideur_nom = me.nom; s.visa.dateDecision = F.nowISO();
    persist(); return { ok: true };
  }

  /* ── Sortie de caisse déclenchée par les modules existants ────────────── */
  function needsValidation(montant) { return Number(montant) >= F.hab().seuilSortie; }

  function wrapPaiementFourn() {
    var o = window.savePaiementFourn;
    if (typeof o !== 'function' || o._fin) return;
    window.savePaiementFourn = function () {
      var m = document.getElementById('modal-paiement-fourn'), ffId = m && m._currentFfId;
      var montant = parseFloat((document.getElementById('pf-montant-saisi') || {}).value) || 0;
      var mode = (document.getElementById('pf-mode') || {}).value || 'Espèces';
      if (!ffId || !(montant > 0) || !needsValidation(montant)) return o.apply(this, arguments);
      var ff = DB_FACTURES_FOURN.find(function (f) { return f.id === ffId; });
      if (!ff) return o.apply(this, arguments);
      var r = createBon({ type: 'sortie', montant: montant, mode: /mobile|wave|orange|mtn/i.test(mode) ? MODES[1] : /carte/i.test(mode) ? MODES[2] : MODES[0], motif: 'Paiement facture fournisseur ' + (ff.ffNum || ff.id), tiers: ff.fourn || 'Fournisseur', piece: ff.ffNum || ff.id, lien: { type: 'ff', id: ff.id } }, true);
      if (!r.ok) { F.toast(r.why, 'error'); return; }
      closeModal('modal-paiement-fourn');
      F.toast('Paiement soumis à la validation de la hiérarchie (' + r.bon.id + ')', 'info');
    };
    window.savePaiementFourn._fin = true;
  }

  function wrapDepense() {
    var o = window.saveDepense;
    if (typeof o !== 'function' || o._fin) return;
    window.saveDepense = function () {
      var before = new Set((typeof DB_DEPENSES !== 'undefined' ? DB_DEPENSES : []).map(function (d) { return d.id; }));
      var editing = typeof _depenseEditId !== 'undefined' && _depenseEditId;
      var r = o.apply(this, arguments);
      try {
        var me = F.who();
        (DB_DEPENSES || []).forEach(function (d) {
          var isNew = !before.has(d.id);
          if (isNew || (editing && d.id === editing)) {
            if (!needsValidation(d.montant)) { d.vstatut = 'valide'; return; }
            d.vstatut = 'attente'; d.demandeur_login = d.demandeur_login || me.login; d.demandeur_nom = d.demandeur_nom || me.nom;
            d.valide = '— en attente —'; delete d.decideur_login; delete d.dateDecision; delete d.motifRejet;
          }
        });
        persist();
      } catch (e) { console.warn('[Caisse] dépense', e); }
      return r;
    };
    window.saveDepense._fin = true;
  }

  function decideDepense(id, decision, motif) {
    var d = (DB_DEPENSES || []).find(function (x) { return x.id === id; });
    if (!d) return { ok: false, why: 'Dépense introuvable.' };
    if (d.vstatut !== 'attente') return { ok: false, why: 'Décision définitive : cette dépense est déjà traitée.' };
    var dc = F.canDecide('caisse', d.montant, d.demandeur_login);
    if (!dc.ok) return { ok: false, why: dc.why };
    if (decision === 'rejete' && !String(motif || '').trim()) return { ok: false, why: 'Le motif du rejet est obligatoire.' };
    var me = F.who();
    d.vstatut = decision === 'valide' ? 'valide' : 'rejete'; d.decideur_login = me.login; d.decideur_nom = me.nom; d.dateDecision = F.nowISO();
    d.valide = decision === 'valide' ? me.nom : '— rejetée —'; if (decision === 'rejete') d.motifRejet = String(motif).trim();
    try { if (typeof saveData === 'function') saveData(); } catch (x) {} F.save(); refresh();
    try { if (typeof renderDepenses === 'function') renderDepenses(); } catch (x) {}
    return { ok: true };
  }

  /* ── Onglets « Bons » et « Rapprochement » de la page Caisse ─────────── */
  var FILTER = '';
  function injectTabs() {
    var bar = document.querySelector('#page-caisse .ftab-bar');
    if (!bar || document.getElementById('ctab-bons')) return;
    var b1 = document.createElement('button'); b1.className = 'ftab'; b1.id = 'ctab-bons'; b1.setAttribute('onclick', "switchCaisseTab('bons')"); b1.innerHTML = '🧾 Bons <span class="nav-badge red" id="ctab-bons-badge" style="display:none">0</span>';
    var b2 = document.createElement('button'); b2.className = 'ftab'; b2.id = 'ctab-rapp'; b2.setAttribute('onclick', "switchCaisseTab('rapp')"); b2.textContent = '⚖️ Rapprochement';
    bar.appendChild(b1); bar.appendChild(b2);
    var host = document.getElementById('ctab-panel-sessions').parentNode;
    ['bons', 'rapp'].forEach(function (n) { var p = document.createElement('div'); p.id = 'ctab-panel-' + n; p.style.display = 'none'; host.appendChild(p); });
  }
  function wrapSwitchTab() {
    var o = window.switchCaisseTab;
    if (typeof o !== 'function' || o._fin) return;
    window.switchCaisseTab = function (tab) {
      var r = o.apply(this, arguments);
      ['bons', 'rapp'].forEach(function (t) {
        var btn = document.getElementById('ctab-' + t), pan = document.getElementById('ctab-panel-' + t);
        if (btn) btn.classList.toggle('active', t === tab);
        if (pan) pan.style.display = t === tab ? '' : 'none';
      });
      if (tab === 'bons') renderBonsTab();
      if (tab === 'rapp') renderRapprochement();
      return r;
    };
    window.switchCaisseTab._fin = true;
  }

  var STATUT = { attente: ['⏳ En attente', 'fin-st-att'], valide: ['✅ Validé', 'fin-st-ok'], rejete: ['⛔ Rejeté', 'fin-st-ko'] };
  function badgeSt(s) { var x = STATUT[s] || [s, '']; return '<span class="fin-st ' + x[1] + '">' + x[0] + '</span>'; }

  function renderBonsTab() {
    var p = document.getElementById('ctab-panel-bons'); if (!p) return;
    var s = session(), me = F.who();
    var list = F.coll.bons.filter(function (b) { return !FILTER || b.statut === FILTER; });
    var nPend = pending().length, bd = document.getElementById('ctab-bons-badge');
    if (bd) { bd.style.display = nPend ? '' : 'none'; bd.textContent = nPend; }
    var remises = F.coll.bons.filter(function (b) { return TYPES[b.type].remise && b.statut === 'valide' && b.remise && b.remise.statut === 'a_confirmer'; });
    p.innerHTML =
      '<div class="card"><div class="card-header"><div><div class="card-title">🧾 Bons de caisse</div><div class="card-subtitle">Un bon ne compte dans le solde qu\'une fois <b>validé</b> par la hiérarchie (jamais par son auteur).</div></div>' +
      '<div class="fin-actions">' + (F.can('caisseSaisie') ? Object.keys(TYPES).map(function (k) { return '<button class="btn btn-secondary btn-sm" data-newbon="' + k + '">' + (TYPES[k].sens > 0 ? '＋ ' : '－ ') + TYPES[k].label + '</button>'; }).join('') : '') + '</div></div>' +
      (!s ? '<div class="fin-warn">Aucune session ouverte : ouvrez la caisse pour saisir des bons.</div>' : '') +
      (remises.length ? '<div class="fin-warn">🏦 <b>' + remises.length + ' remise(s) à confirmer</b> (réception à confirmer par une autre personne).</div>' : '') +
      '<div class="fin-filters">' + [['', 'Tous'], ['attente', 'En attente'], ['valide', 'Validés'], ['rejete', 'Rejetés']].map(function (f) { return '<button class="ftab' + (FILTER === f[0] ? ' active' : '') + '" data-filter="' + f[0] + '">' + f[1] + '</button>'; }).join('') + '</div>' +
      (list.length ? '<div class="table-wrap"><table><thead><tr><th>N°</th><th>Date</th><th>Type</th><th>Motif</th><th>Personne</th><th>Montant</th><th>Statut</th><th>Demandeur</th><th></th></tr></thead><tbody>' +
        list.map(function (b) {
          var t = TYPES[b.type], acts = '';
          if (b.statut === 'attente' && (F.sameUser(b.demandeur_login, me.login) || me.role === 'admin')) acts += '<button class="btn btn-secondary btn-sm" data-retire="' + esc(b.id) + '">Retirer</button>';
          if (b.statut === 'valide' && t.remise && b.remise && b.remise.statut === 'a_confirmer' && F.can('caisseValider')) acts += '<button class="btn btn-primary btn-sm" data-confirm="' + esc(b.id) + '">Confirmer la réception</button>';
          if (b.statut === 'valide' && !b.contrepasse && me.role === 'admin' && !(b.lien && b.lien.type === 'contrepassation')) acts += '<button class="btn btn-secondary btn-sm" data-cp="' + esc(b.id) + '">Contre-passer</button>';
          return '<tr><td style="font-family:var(--font-mono);font-size:11px">' + esc(b.id) + '</td><td>' + esc(b.date) + '</td><td>' + esc(t.label) + '</td><td>' + esc(b.motif) + (b.piece ? '<div class="fin-sub">Pièce : ' + esc(b.piece) + '</div>' : '') + (b.motifRejet ? '<div class="fin-sub" style="color:var(--red)">Rejet : ' + esc(b.motifRejet) + '</div>' : '') + (b.remise && b.remise.statut === 'confirmee' ? '<div class="fin-sub">Reçue — preuve ' + esc(b.remise.preuve) + ' (' + esc(b.remise.par_nom) + ')</div>' : '') + '</td><td>' + esc(b.tiers) + '</td>' +
            '<td style="text-align:right;font-family:var(--font-mono);color:' + (t.sens > 0 ? 'var(--green)' : 'var(--red)') + '">' + (t.sens > 0 ? '+' : '−') + fmt(b.montant) + '</td><td>' + badgeSt(b.statut) + (b.contrepasse ? '<div class="fin-sub">contre-passé</div>' : '') + '</td><td>' + esc(b.demandeur_nom) + (b.decideur_nom ? '<div class="fin-sub">décision : ' + esc(b.decideur_nom) + '</div>' : '') + '</td><td>' + acts + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<div style="padding:30px;text-align:center;color:var(--text-dim)">Aucun bon.</div>') + '</div>';
  }

  function bonForm(type) {
    var t = TYPES[type];
    var h = '<div class="form-group"><label class="form-label">Montant (FCFA) *</label><input class="form-control" id="fb-montant" type="number" min="1" step="1"></div>' +
      '<div class="form-group"><label class="form-label">Motif *</label><input class="form-control" id="fb-motif"></div>' +
      '<div class="form-group"><label class="form-label">' + t.tiers + ' *</label><input class="form-control" id="fb-tiers"></div>' +
      '<div class="form-group"><label class="form-label">Pièce justificative' + (t.remise ? ' * <span class="fin-sub">(n° bordereau de versement ou reçu signé)</span>' : '') + '</label><input class="form-control" id="fb-piece"></div>';
    if (type === 'entree' || type === 'sortie') h += '<div class="form-group"><label class="form-label">Mode</label><select class="form-control" id="fb-mode">' + MODES.map(function (m) { return '<option>' + m + '</option>'; }).join('') + '</select></div>';
    return h;
  }
  function openBonModal(type) {
    var t = TYPES[type];
    F.modal({ id: 'fin-bon', title: (t.sens > 0 ? '＋ ' : '－ ') + t.label, html: bonForm(type), buttons: [{ label: 'Annuler' }, { label: 'Soumettre à validation', cls: 'btn-primary', onClick: function (m) {
      var v = function (id) { return (m.querySelector('#' + id) || {}).value || ''; };
      var res = createBon({ type: type, montant: v('fb-montant'), motif: v('fb-motif'), tiers: v('fb-tiers'), piece: v('fb-piece'), mode: v('fb-mode') });
      if (res.confirm) { if (!window.confirm(res.confirm)) return false; res = createBon({ type: type, montant: v('fb-montant'), motif: v('fb-motif'), tiers: v('fb-tiers'), piece: v('fb-piece'), mode: v('fb-mode') }, true); }
      if (!res.ok) { F.toast(res.why, 'error'); return false; }
      F.toast('Bon ' + res.bon.id + ' soumis à la validation de la hiérarchie', 'success');
    } }] });
  }

  function renderRapprochement() {
    var p = document.getElementById('ctab-panel-rapp'); if (!p) return;
    var ss = sessions().slice().reverse();                    /* du plus ancien au plus récent */
    var prevCompte = null, ruptures = 0, cumul = 0;
    var rows = ss.map(function (s) {
      var ouv = Number(s.fondInitialEspeces != null ? s.fondInitialEspeces : s.fondEspeces) || 0;
      var rupt = prevCompte !== null && ouv !== prevCompte;
      if (rupt) ruptures++;
      if (s.statut === 'cloturee') { prevCompte = Number(s.compteEspeces) || 0; cumul += Number(s.ecartTotal) || 0; }
      return '<tr' + (rupt ? ' class="fin-rupt"' : '') + '><td style="font-family:var(--font-mono);font-size:11px">' + esc(s.id) + '</td><td>' + esc(s.dateOuverture) + '</td><td>' + esc(s.operateur || '') + '</td><td style="text-align:right">' + fmt(ouv) + '</td><td style="text-align:right">' + (s.statut === 'cloturee' ? fmt(s.soldeTheoEsp) : '—') + '</td><td style="text-align:right">' + (s.statut === 'cloturee' ? fmt(s.compteEspeces) : '—') + '</td><td style="text-align:right;color:' + ((Number(s.ecartTotal) || 0) === 0 ? 'var(--green)' : 'var(--red)') + '">' + (s.statut === 'cloturee' ? ((s.ecartTotal >= 0 ? '+' : '') + fmt(s.ecartTotal)) : '—') + '</td><td>' + (rupt ? '⚠️ rupture de chaîne' : '') + (s.visa ? ' ' + badgeSt(s.visa.statut) : '') + '</td></tr>';
    });
    var remises = F.coll.bons.filter(function (b) { return TYPES[b.type].remise && b.statut === 'valide' && b.remise && b.remise.statut === 'a_confirmer'; }).length;
    p.innerHTML = '<div class="card"><div class="card-header"><div><div class="card-title">⚖️ Rapprochement de caisse</div><div class="card-subtitle">Fond d\'ouverture, comptage de clôture et écarts, session après session</div></div></div>' +
      '<div class="fin-kpis"><div><span>Écart cumulé</span><b style="color:' + (cumul === 0 ? 'var(--green)' : 'var(--red)') + '">' + (cumul >= 0 ? '+' : '') + fmt(cumul) + ' F</b></div><div><span>Ruptures de chaîne</span><b style="color:' + (ruptures ? 'var(--red)' : 'var(--green)') + '">' + ruptures + '</b></div><div><span>Remises à confirmer</span><b>' + remises + '</b></div><div><span>Bons en attente</span><b>' + pending().length + '</b></div></div>' +
      (rows.length ? '<div class="table-wrap"><table><thead><tr><th>Session</th><th>Date</th><th>Opérateur</th><th>Fond d\'ouverture</th><th>Solde théorique</th><th>Comptage réel</th><th>Écart</th><th>Contrôle</th></tr></thead><tbody>' + rows.reverse().join('') + '</tbody></table></div>' : '<div style="padding:30px;text-align:center;color:var(--text-dim)">Aucune session.</div>') +
      '<div class="fin-note" style="margin-top:10px">Une <b>rupture de chaîne</b> signale un fond d\'ouverture différent du dernier comptage : à expliquer. Contrôle recommandé chaque mois.</div></div>';
  }

  /* clics */
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest && ev.target.closest('[data-newbon],[data-retire],[data-confirm],[data-cp],[data-filter]'); if (!t || !t.closest('#ctab-panel-bons')) return;
    if (t.hasAttribute('data-newbon')) return openBonModal(t.getAttribute('data-newbon'));
    if (t.hasAttribute('data-filter')) { FILTER = t.getAttribute('data-filter'); return renderBonsTab(); }
    var id = t.getAttribute('data-retire') || t.getAttribute('data-confirm') || t.getAttribute('data-cp');
    if (t.hasAttribute('data-retire')) { var r = decideBon(id, 'retire'); F.toast(r.ok ? 'Demande retirée' : r.why, r.ok ? 'info' : 'error'); }
    if (t.hasAttribute('data-confirm')) F.modal({ id: 'fin-conf', title: 'Confirmer la réception de la remise', html: '<div class="form-group"><label class="form-label">Référence de la preuve * (reçu bancaire, accusé signé)</label><input class="form-control" id="fc-ref"></div>', buttons: [{ label: 'Annuler' }, { label: 'Confirmer', cls: 'btn-primary', onClick: function (m) { var r = confirmerRemise(id, m.querySelector('#fc-ref').value); F.toast(r.ok ? 'Réception confirmée' : r.why, r.ok ? 'success' : 'error'); return r.ok ? undefined : false; } }] });
    if (t.hasAttribute('data-cp')) F.modal({ id: 'fin-cpb', title: 'Contre-passer le bon', html: '<p class="fin-note">Un bon inverse sera créé ; il devra être validé à son tour.</p><div class="form-group"><label class="form-label">Motif *</label><input class="form-control" id="fcp-m"></div>', buttons: [{ label: 'Annuler' }, { label: 'Contre-passer', cls: 'btn-danger', onClick: function (m) { var r = contrepasserBon(id, m.querySelector('#fcp-m').value); F.toast(r.ok ? 'Bon inverse soumis à validation' : r.why, r.ok ? 'success' : 'error'); return r.ok ? undefined : false; } }] });
  });

  function init() { injectTabs(); wrapSwitchTab(); wrapOpen(); wrapClose(); wrapPaiementFourn(); wrapDepense(); }
  document.addEventListener('DOMContentLoaded', function () { init(); setTimeout(init, 1500); });
  window.addEventListener('fin-data-changed', function () { try { renderBonsTab(); } catch (x) {} });

  F.caisse = { TYPES: TYPES, createBon: createBon, decideBon: decideBon, confirmerRemise: confirmerRemise, contrepasserBon: contrepasserBon, decideDepense: decideDepense, decideVisaCloture: decideVisaCloture,
    pending: pending, pinSet: pinSet, pinCheck: pinCheck, pinHas: pinHas, solde: solde, session: session, sessions: sessions, openBonModal: openBonModal, badgeSt: badgeSt, renderBonsTab: renderBonsTab, renderRapprochement: renderRapprochement };
})();
