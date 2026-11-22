/* AutoGarage Pro — Comptabilité (plan SYSCOHADA simplifié, journaux, écritures automatiques, visa, exercices, états, FEC).
   Reprend les principes COM de Zahara :
   - une écriture est équilibrée (débit = crédit, 2 lignes minimum) et n'utilise que des comptes du plan ;
   - une pièce VISÉE est intangible : elle se contre-passe ; un exercice CLOS est verrouillé ;
   - les écritures sont générées automatiquement depuis les factures, encaissements, dépenses, bons de caisse, écarts…
     (même identifiant = régénérées si la source change, jamais après visa) ;
   - le visa relève de la hiérarchie (droit, plafond, séparation des tâches) ; la clôture et la réouverture de l'administrateur.
   Hypothèses à faire valider par votre expert-comptable : taux de TVA (18 % par défaut), comptes par défaut, calendrier de clôture. */
(function () {
  'use strict';
  var F = window.FIN; if (!F) { console.warn('[Compta] finance.js manquant'); return; }
  var esc = F.esc, fmt = F.fmt, r2 = F.round2;
  var CFG_KEY = 'gp_compta_cfg';

  /* ── Plan comptable et paramètres ─────────────────────────────────────── */
  var PLAN = [
    ['101', 'Capital social'], ['106', 'Réserves'], ['110', 'Report à nouveau'], ['120', 'Résultat de l\'exercice (provisoire)'], ['131', 'Résultat net : bénéfice'], ['139', 'Résultat net : perte'],
    ['162', 'Emprunts et dettes auprès des établissements de crédit'],
    ['215', 'Matériel et outillage industriel'], ['218', 'Matériel de transport et mobilier'], ['2845', 'Amortissements du matériel'],
    ['311', 'Marchandises (pièces détachées)'], ['321', 'Fournitures consommables (huiles, filtres…)'],
    ['401', 'Fournisseurs'], ['411', 'Clients'], ['421', 'Personnel : rémunérations dues'], ['431', 'Sécurité sociale (CNPS)'], ['4431', 'TVA facturée (collectée)'], ['4452', 'TVA récupérable sur achats'], ['4471', 'Impôts et taxes à payer'],
    ['481', 'Fournisseurs d\'investissements'], ['4711', 'Débiteurs divers'],
    ['521', 'Banque'], ['571', 'Caisse'], ['572', 'Mobile Money'], ['585', 'Virements de fonds (internes)'],
    ['601', 'Achats de marchandises (pièces)'], ['6022', 'Achats de fournitures consommables'], ['6054', 'Carburants'], ['605', 'Eau, électricité'], ['6081', 'Achats de petit matériel et outillage'],
    ['622', 'Locations et charges locatives'], ['624', 'Entretien, réparations'], ['627', 'Publicité'], ['628', 'Frais de télécommunications'],
    ['631', 'Frais bancaires'], ['641', 'Impôts et taxes'], ['661', 'Rémunérations du personnel'], ['664', 'Charges sociales'], ['658', 'Charges diverses (écarts de caisse : manquants)'], ['659', 'Autres charges'],
    ['701', 'Ventes de marchandises (pièces)'], ['706', 'Services vendus (main-d\'œuvre, prestations)'], ['758', 'Produits divers (écarts de caisse : excédents)'], ['759', 'Autres produits']
  ];
  var JOURNAUX = [['VT', 'Ventes'], ['AC', 'Achats'], ['CA', 'Caisse'], ['BQ', 'Banque'], ['OD', 'Opérations diverses'], ['AN', 'À-nouveaux']];
  var DEF_CFG = {
    tva: 18,
    comptes: { clients: '411', fournisseurs: '401', ventes: '706', tvaCollectee: '4431', tvaRecup: '4452', achats: '601', caisse: '571', mobile: '572', banque: '521', virement: '585', ecartManquant: '658', ecartExcedent: '758', resultatBenef: '131', resultatPerte: '139' },
    categories: { pieces: '601', salaires: '661', loyer: '622', electricite: '605', carburant: '6054', materiel: '6081', publicite: '627', taxe: '641', autre: '659' },
    regles: [{ mot: 'loyer', compte: '622' }, { mot: 'carburant|essence|gasoil|gazole', compte: '6054' }, { mot: 'electric|eau|cie|sodeci', compte: '605' }, { mot: 'publicit', compte: '627' }, { mot: 'banque|frais bancaires', compte: '631' }, { mot: 'salaire|paie', compte: '661' }, { mot: 'transport|entretien|reparation|réparation', compte: '624' }]
  };
  function cfg() {
    var s = null; try { s = JSON.parse(localStorage.getItem(CFG_KEY)); } catch (x) {}
    var c = JSON.parse(JSON.stringify(DEF_CFG));
    if (s && typeof s === 'object') {
      if (typeof s.tva === 'number') c.tva = s.tva;
      if (s.comptes) Object.assign(c.comptes, s.comptes);
      if (s.categories) Object.assign(c.categories, s.categories);
      if (Array.isArray(s.regles)) c.regles = s.regles;
    }
    return c;
  }
  function saveCfg(c) { try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch (x) {} touch(); }
  function touch() { F.save(); try { if (typeof saveData === 'function') saveData(); } catch (x) {} try { window.dispatchEvent(new Event('fin-data-changed')); } catch (x) {} }

  /* ── Plan et exercices : initialisation identique sur tous les appareils (même contenu = pas de conflit) ── */
  function seed() {
    if (!F.coll.comptes.length) PLAN.forEach(function (p) { F.coll.comptes.push({ id: p[0], num: p[0], lib: p[1], classe: Number(p[0][0]) }); });
    ensureExercice(F.today());
  }
  function ensureExercice(date) {
    var y = String(date).slice(0, 4);
    var e = F.coll.exercices.find(function (x) { return x.id === y; });
    if (!e) { e = { id: y, debut: y + '-01-01', fin: y + '-12-31', statut: 'ouvert' }; F.coll.exercices.push(e); }
    return e;
  }
  function exerciceDe(date) { var y = String(date).slice(0, 4); return F.coll.exercices.find(function (x) { return x.id === y; }) || null; }
  function clos(date) { var e = exerciceDe(date); return !!(e && e.statut === 'clos'); }
  function compte(num) { return F.coll.comptes.find(function (c) { return c.num === String(num); }); }

  /* ── Outils d'écritures ───────────────────────────────────────────────── */
  function totaux(lignes) { var d = 0, c = 0; (lignes || []).forEach(function (l) { d += Number(l.debit) || 0; c += Number(l.credit) || 0; }); return { debit: r2(d), credit: r2(c) }; }
  function equilibree(lignes) { var t = totaux(lignes); return t.debit === t.credit && t.debit > 0; }
  function montantEcriture(e) { return totaux(e.lignes).debit; }
  function L(num, debit, credit, lib) { return { compte: String(num), debit: r2(debit || 0), credit: r2(credit || 0), lib: lib || undefined }; }
  function signature(lignes) { return JSON.stringify((lignes || []).map(function (l) { return [l.compte, r2(l.debit), r2(l.credit)]; })); }

  function validerLignes(lignes) {
    if (!Array.isArray(lignes) || lignes.length < 2) return 'Une écriture comporte au moins deux lignes.';
    var d = 0, c = 0;
    for (var i = 0; i < lignes.length; i++) {
      var l = lignes[i];
      if (!compte(l.compte)) return 'Le compte « ' + l.compte + ' » n\'existe pas dans le plan comptable.';
      var dd = Number(l.debit) || 0, cc = Number(l.credit) || 0;
      if (dd < 0 || cc < 0) return 'Les montants ne peuvent pas être négatifs.';
      if ((dd > 0) === (cc > 0)) return 'Chaque ligne porte soit un débit, soit un crédit.';
      d += dd; c += cc;
    }
    if (!(lignes.some(function (l) { return Number(l.debit) > 0; }) && lignes.some(function (l) { return Number(l.credit) > 0; }))) return 'Il faut au moins une ligne au débit et une au crédit.';
    if (r2(d) !== r2(c)) return 'Écriture déséquilibrée : débit ' + fmt(d) + ' ≠ crédit ' + fmt(c) + '.';
    return null;
  }

  /* ── Saisie manuelle ──────────────────────────────────────────────────── */
  function saisir(p) {
    var me = F.who();
    if (!F.can('comptaSaisie')) return { ok: false, why: 'Votre rôle ne permet pas de saisir des écritures.' };
    var date = p.date || F.today();
    if (!p.libelle || !String(p.libelle).trim()) return { ok: false, why: 'Le libellé est obligatoire.' };
    if (!JOURNAUX.some(function (j) { return j[0] === p.journal; })) return { ok: false, why: 'Journal inconnu.' };
    ensureExercice(date);
    if (clos(date)) return { ok: false, why: 'L\'exercice ' + date.slice(0, 4) + ' est clos : aucune écriture à cette date.' };
    var err = validerLignes(p.lignes); if (err) return { ok: false, why: err };
    var e = { id: 'ECR-' + date.slice(0, 4) + '-' + F.rnd(6), date: date, journal: p.journal, piece: String(p.piece || '').trim(), libelle: String(p.libelle).trim(), lignes: p.lignes.map(function (l) { return L(l.compte, l.debit, l.credit, l.lib); }),
      statut: 'brouillard', auto: false, exercice: date.slice(0, 4), auteur_login: me.login, auteur_nom: me.nom, cree: F.nowISO() };
    F.coll.ecritures.unshift(e); touch();
    return { ok: true, ecriture: e };
  }

  function viser(id) {
    var e = F.coll.ecritures.find(function (x) { return x.id === id; });
    if (!e) return { ok: false, why: 'Écriture introuvable.' };
    if (e.statut === 'vise') return { ok: false, why: 'Écriture déjà visée.' };
    if (clos(e.date)) return { ok: false, why: 'Exercice clos.' };
    var err = validerLignes(e.lignes); if (err) return { ok: false, why: err };
    var d = F.canDecide('compta', montantEcriture(e), e.auteur_login || (e.auto ? '' : ''));
    if (!d.ok) return { ok: false, why: d.why };
    var me = F.who();
    e.statut = 'vise'; e.viseur_login = me.login; e.viseur_nom = me.nom; e.dateVisa = F.nowISO(); delete e.anomalie;
    touch(); return { ok: true, ecriture: e };
  }

  function devalider(id, motif) {
    var e = F.coll.ecritures.find(function (x) { return x.id === id; });
    if (!e || e.statut !== 'vise') return { ok: false, why: 'Seule une écriture visée se dévalide.' };
    if (F.who().role !== 'admin') return { ok: false, why: 'La levée d\'un visa est réservée à l\'administrateur.' };
    if (clos(e.date)) return { ok: false, why: 'Exercice clos.' };
    if (!String(motif || '').trim()) return { ok: false, why: 'Le motif est obligatoire.' };
    (e.historiqueVisa = e.historiqueVisa || []).push({ viseur: e.viseur_nom, date: e.dateVisa, leve_par: F.who().nom, leve_le: F.nowISO(), motif: String(motif).trim() });
    e.statut = 'brouillard'; delete e.viseur_login; delete e.viseur_nom; delete e.dateVisa;
    touch(); return { ok: true };
  }

  function contrepasser(id, motif) {
    var e = F.coll.ecritures.find(function (x) { return x.id === id; });
    if (!e || e.statut !== 'vise') return { ok: false, why: 'Seule une écriture visée se contre-passe.' };
    if (e.contrepasse) return { ok: false, why: 'Déjà contre-passée.' };
    if (!F.can('comptaSaisie')) return { ok: false, why: 'Votre rôle ne permet pas cette opération.' };
    if (!String(motif || '').trim()) return { ok: false, why: 'Le motif est obligatoire.' };
    var date = F.today(); ensureExercice(date);
    if (clos(date)) return { ok: false, why: 'L\'exercice en cours est clos.' };
    var me = F.who();
    var n = { id: 'ECR-' + date.slice(0, 4) + '-' + F.rnd(6), date: date, journal: 'OD', piece: e.piece, libelle: 'Contre-passation de ' + (e.piece || e.id) + ' — ' + motif, contrepasseDe: e.id,
      lignes: e.lignes.map(function (l) { return L(l.compte, l.credit, l.debit, l.lib); }), statut: 'brouillard', auto: false, exercice: date.slice(0, 4), auteur_login: me.login, auteur_nom: me.nom, cree: F.nowISO() };
    F.coll.ecritures.unshift(n); e.contrepasse = n.id; touch();
    return { ok: true, ecriture: n };
  }

  function supprimer(id) {
    var i = F.coll.ecritures.findIndex(function (x) { return x.id === id; });
    if (i < 0) return { ok: false, why: 'Écriture introuvable.' };
    var e = F.coll.ecritures[i], me = F.who();
    if (e.statut === 'vise') return { ok: false, why: 'Une pièce visée ne se supprime pas : contre-passez-la.' };
    if (e.auto) return { ok: false, why: 'Une écriture automatique se corrige à la source.' };
    if (clos(e.date)) return { ok: false, why: 'Exercice clos.' };
    if (!F.sameUser(e.auteur_login, me.login) && me.role !== 'admin') return { ok: false, why: 'Seul l\'auteur ou un administrateur peut supprimer cette écriture.' };
    F.coll.ecritures.splice(i, 1); touch(); return { ok: true };
  }

  /* ── Génération automatique ───────────────────────────────────────────── */
  function cashAccount(mode) {
    var c = cfg().comptes, k = typeof _caisseNormalMode === 'function' ? _caisseNormalMode(mode) : 'Especes';
    if (k === 'Especes') return [c.caisse, 'CA'];
    if (k === 'Wave' || k === 'OrangeMoney' || k === 'MTNMoMo') return [c.mobile, 'CA'];
    return [c.banque, 'BQ'];
  }
  function regleCompte(texte) {
    var t = String(texte || '').toLowerCase();
    var r = cfg().regles.filter(function (x) { try { return new RegExp(x.mot, 'i').test(t); } catch (e) { return false; } })[0];
    return r ? r.compte : null;
  }

  function cibles() {
    var c = cfg(), cc = c.comptes, out = [];
    function add(id, date, journal, piece, libelle, lignes) { if (lignes && lignes.length >= 2 && equilibree(lignes)) out.push({ id: 'AUTO-' + id, source: id, date: date, journal: journal, piece: piece, libelle: libelle, lignes: lignes }); }
    var rate = Number(c.tva) || 0, clients = {};
    (typeof DB !== 'undefined' ? DB.clients : []).forEach(function (cl) { clients[cl.id] = cl.nom; });

    /* 1. factures clients */
    (DB.factures || []).forEach(function (f) {
      var ttc = Number(f.montant) || 0; if (!(ttc > 0) || !f.date) return;
      var ht = r2(ttc / (1 + rate / 100)), tva = r2(ttc - ht);
      var lg = [L(cc.clients, ttc, 0, clients[f.client_id])]; lg.push(L(cc.ventes, 0, ht)); if (tva > 0) lg.push(L(cc.tvaCollectee, 0, tva));
      add('facture:' + f.id, f.date, 'VT', f.id, 'Facture ' + f.id + ' — ' + (clients[f.client_id] || 'client'), lg);
    });
    /* 2. mouvements de caisse (encaissements de factures, sorties, bons) */
    var bonsParId = {}; F.coll.bons.forEach(function (b) { bonsParId[b.id] = b; });
    (DB.transactions || []).forEach(function (t) {
      var m = Math.abs(Number(t.montant) || 0); if (!m || !t.date) return;
      var ca = cashAccount(t.mode), enc = t.transaction_type === 'encaissement';
      if (t.source === 'bon') {
        var b = bonsParId[t.bonId]; if (!b || !b.ventile || !b.ventile.compte) return;       /* « à ventiler » : pas d'écriture tant que non ventilé */
        add('bon:' + b.id, t.date, ca[1], b.id, (b.motif || 'Bon de caisse') + ' — ' + b.tiers, enc ? [L(ca[0], m, 0), L(b.ventile.compte, 0, m)] : [L(b.ventile.compte, m, 0), L(ca[0], 0, m)]);
        return;
      }
      if (enc && DB.factures.some(function (f) { return f.id === t.ref; })) { add('enc:' + t.id, t.date, ca[1], t.id, 'Encaissement ' + t.ref + ' — ' + (t.client || ''), [L(ca[0], m, 0), L(cc.clients, 0, m)]); return; }
      if (!enc && typeof DB_FACTURES_FOURN !== 'undefined' && DB_FACTURES_FOURN.some(function (f) { return f.ffNum === t.ref || f.id === t.ref; })) { add('pay:' + t.id, t.date, ca[1], t.id, 'Règlement fournisseur ' + t.ref + ' — ' + (t.client || ''), [L(cc.fournisseurs, m, 0), L(ca[0], 0, m)]); }
    });
    /* 3. dépenses validées */
    (typeof DB_DEPENSES !== 'undefined' ? DB_DEPENSES : []).forEach(function (d) {
      if (d.vstatut === 'attente' || d.vstatut === 'rejete') return;
      var m = Number(d.montant) || 0; if (!(m > 0) || !d.date) return;
      var ca = cashAccount(d.mode), cat = (typeof CATEGORIES_DEP !== 'undefined' && CATEGORIES_DEP[d.cat]) ? CATEGORIES_DEP[d.cat].label : d.cat;
      add('dep:' + d.id, d.date, ca[1], d.id, 'Dépense ' + cat + ' — ' + (d.benef || ''), [L(c.categories[d.cat] || c.categories.autre, m, 0), L(ca[0], 0, m)]);
    });
    /* 4. factures fournisseurs (montant pris hors taxe sauf champ tva) */
    (typeof DB_FACTURES_FOURN !== 'undefined' ? DB_FACTURES_FOURN : []).forEach(function (f) {
      var m = Number(f.montant) || 0; if (!(m > 0) || !f.date) return;
      var tva = Number(f.tva) || 0, lg = [L(cc.achats, m - tva, 0, f.pieceNom)]; if (tva > 0) lg.push(L(cc.tvaRecup, tva, 0)); lg.push(L(cc.fournisseurs, 0, m));
      add('ff:' + f.id, f.date, 'AC', f.ffNum || f.id, 'Facture fournisseur ' + (f.ffNum || f.id) + ' — ' + (f.fourn || ''), lg);
    });
    /* 5. écarts de caisse et mouvements de fonds */
    (typeof DB_SESSIONS_CAISSE !== 'undefined' ? DB_SESSIONS_CAISSE : []).forEach(function (s) {
      if (s.statut !== 'cloturee') return;
      var e = Number(s.ecartTotal) || 0; if (!e) return;
      add('ecart:' + s.id, s.dateCloture || s.dateOuverture, 'CA', s.id, 'Écart de caisse ' + (s.dateCloture || ''), e < 0 ? [L(cc.ecartManquant, -e, 0), L(cc.caisse, 0, -e)] : [L(cc.caisse, e, 0), L(cc.ecartExcedent, 0, e)]);
    });
    F.coll.bons.forEach(function (b) {
      if (b.statut !== 'valide') return;
      if (b.type === 'remise_banque') add('fonds:' + b.id, b.date, 'CA', b.id, 'Remise en banque ' + b.piece, [L(cc.banque, b.montant, 0), L(cc.caisse, 0, b.montant)]);
      if (b.type === 'remise_direction') add('fonds:' + b.id, b.date, 'CA', b.id, 'Remise à la direction ' + b.piece, [L(cc.virement, b.montant, 0), L(cc.caisse, 0, b.montant)]);
      if (b.type === 'reappro') add('fonds:' + b.id, b.date, 'CA', b.id, 'Réapprovisionnement de caisse', [L(cc.caisse, b.montant, 0), L(cc.virement, 0, b.montant)]);
    });
    return out;
  }

  /* Régénération idempotente : jamais après visa ni dans un exercice clos */
  function generer() {
    seed();
    var cib = cibles(), par = {}, res = { crees: 0, maj: 0, supprimes: 0, refuses: 0, anomalies: 0 };
    cib.forEach(function (c) { par[c.id] = c; });
    F.coll.ecritures.slice().forEach(function (e) {
      if (!e.auto || e.journal === 'AN') return;            /* les à-nouveaux de clôture ne sont pas régénérés */
      var c = par[e.id];
      if (!c) {                                                        /* source disparue */
        if (e.statut === 'vise' || clos(e.date)) { if (!e.anomalie) { e.anomalie = 'source supprimée après visa : contre-passer'; res.anomalies++; } }
        else { F.coll.ecritures.splice(F.coll.ecritures.indexOf(e), 1); res.supprimes++; }
        return;
      }
      if (signature(c.lignes) !== signature(e.lignes) || c.date !== e.date) {
        if (e.statut === 'vise' || clos(e.date)) { if (!e.anomalie) { e.anomalie = 'source modifiée après visa : contre-passer'; res.anomalies++; } }
        else if (clos(c.date)) res.refuses++;
        else { e.lignes = c.lignes; e.date = c.date; e.libelle = c.libelle; e.exercice = c.date.slice(0, 4); res.maj++; }
      } else if (e.anomalie && e.statut !== 'vise') delete e.anomalie;
      delete par[e.id];
    });
    Object.keys(par).forEach(function (id) {
      var c = par[id]; ensureExercice(c.date);
      if (clos(c.date)) { res.refuses++; return; }
      F.coll.ecritures.push({ id: c.id, source: c.source, auto: true, date: c.date, journal: c.journal, piece: c.piece, libelle: c.libelle, lignes: c.lignes, statut: 'brouillard', exercice: c.date.slice(0, 4), auteur_login: 'système', auteur_nom: 'Écriture automatique', cree: F.nowISO() });
      res.crees++;
    });
    if (res.crees || res.maj || res.supprimes || res.anomalies) touch();
    return res;
  }

  /* Ventilation d'un bon de caisse (choix du compte de contrepartie) */
  function ventiler(bonId, num) {
    var b = F.coll.bons.find(function (x) { return x.id === bonId; });
    if (!b || b.statut !== 'valide') return { ok: false, why: 'Seul un bon validé se ventile.' };
    if (!F.can('comptaSaisie')) return { ok: false, why: 'La ventilation est réservée à la comptabilité.' };
    if (!compte(num)) return { ok: false, why: 'Compte inconnu.' };
    if (clos(b.date)) return { ok: false, why: 'Exercice clos : ventilation impossible.' };
    b.ventile = { compte: String(num), par_login: F.who().login, par_nom: F.who().nom, date: F.nowISO() };
    touch(); generer(); return { ok: true };
  }
  function bonsAVentiler() {
    return F.coll.bons.filter(function (b) { return b.statut === 'valide' && (b.type === 'entree' || b.type === 'sortie') && !b.ventile && !(b.lien && b.lien.type === 'ff'); });
  }
  function ventilationAuto() {
    var n = 0;
    bonsAVentiler().forEach(function (b) { var c = regleCompte(b.motif + ' ' + b.tiers); if (c && compte(c) && !clos(b.date)) { b.ventile = { compte: c, par_login: 'système', par_nom: 'Règle automatique', date: F.nowISO() }; n++; } });
    if (n) touch(); return n;
  }

  /* ── États ────────────────────────────────────────────────────────────── */
  function lignesDe(opts) {
    opts = opts || {};
    var out = [];
    F.coll.ecritures.forEach(function (e) {
      if (opts.exercice && e.exercice !== opts.exercice) return;
      if (opts.viseSeulement && e.statut !== 'vise') return;
      if (opts.du && e.date < opts.du) return; if (opts.au && e.date > opts.au) return;
      if (opts.journal && e.journal !== opts.journal) return;
      e.lignes.forEach(function (l) { out.push({ e: e, compte: l.compte, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, lib: l.lib }); });
    });
    return out;
  }
  function balance(opts) {
    var m = {};
    lignesDe(opts).forEach(function (l) { var x = m[l.compte] || (m[l.compte] = { compte: l.compte, debit: 0, credit: 0 }); x.debit += l.debit; x.credit += l.credit; });
    return Object.keys(m).sort().map(function (k) { var x = m[k], c = compte(k); x.lib = c ? c.lib : '(compte inconnu)'; x.debit = r2(x.debit); x.credit = r2(x.credit); x.sd = x.debit > x.credit ? r2(x.debit - x.credit) : 0; x.sc = x.credit > x.debit ? r2(x.credit - x.debit) : 0; return x; });
  }
  function resultat(opts) {
    var b = balance(opts), prod = 0, ch = 0;
    b.forEach(function (x) { if (x.compte[0] === '7') prod += x.sc - x.sd; if (x.compte[0] === '6') ch += x.sd - x.sc; });
    return { produits: r2(prod), charges: r2(ch), resultat: r2(prod - ch), lignes: b.filter(function (x) { return x.compte[0] === '6' || x.compte[0] === '7'; }) };
  }
  function tva(opts) {
    var b = balance(opts), col = 0, rec = 0, cc = cfg().comptes;
    b.forEach(function (x) { if (x.compte === cc.tvaCollectee) col += x.sc - x.sd; if (x.compte === cc.tvaRecup) rec += x.sd - x.sc; });
    return { collectee: r2(col), recuperable: r2(rec), apayer: r2(col - rec) };
  }

  /* ── Clôture / réouverture de l'exercice ──────────────────────────────── */
  function cloturer(year) {
    var e = F.coll.exercices.find(function (x) { return x.id === String(year); });
    if (!e) return { ok: false, why: 'Exercice introuvable.' };
    if (e.statut === 'clos') return { ok: false, why: 'Exercice déjà clos.' };
    if (!F.can('comptaCloturer')) return { ok: false, why: 'La clôture est réservée à l\'administrateur.' };
    var prev = F.coll.exercices.find(function (x) { return x.id === String(Number(year) - 1); });
    if (prev && prev.statut !== 'clos') return { ok: false, why: 'On clôture dans l\'ordre : clôturez d\'abord l\'exercice ' + prev.id + '.' };
    generer();
    var brouillon = F.coll.ecritures.filter(function (x) { return x.exercice === e.id && x.statut !== 'vise'; });
    if (brouillon.length) return { ok: false, why: brouillon.length + ' écriture(s) encore au brouillard : visez-les ou supprimez-les avant la clôture.' };
    var bal = balance({ exercice: e.id });
    var td = bal.reduce(function (n, x) { return n + x.debit; }, 0), tc = bal.reduce(function (n, x) { return n + x.credit; }, 0);
    if (r2(td) !== r2(tc)) return { ok: false, why: 'Balance déséquilibrée : clôture impossible.' };
    var res = resultat({ exercice: e.id });
    var next = ensureExercice(String(Number(year) + 1) + '-01-01'), cc = cfg().comptes, me = F.who();
    /* à-nouveaux : soldes des comptes de bilan (classes 1 à 5) + résultat */
    var lg = [];
    bal.filter(function (x) { return x.compte[0] >= '1' && x.compte[0] <= '5'; }).forEach(function (x) { if (x.sd) lg.push(L(x.compte, x.sd, 0)); if (x.sc) lg.push(L(x.compte, 0, x.sc)); });
    if (res.resultat > 0) lg.push(L(cc.resultatBenef, 0, res.resultat)); else if (res.resultat < 0) lg.push(L(cc.resultatPerte, -res.resultat, 0));
    var an = null;
    if (lg.length >= 2 && equilibree(lg)) {
      an = { id: 'AN-' + next.id, auto: true, source: 'an:' + e.id, date: next.debut, journal: 'AN', piece: 'AN-' + next.id, libelle: 'À-nouveaux de l\'exercice ' + e.id, lignes: lg, statut: 'vise', exercice: next.id,
        auteur_login: 'système', auteur_nom: 'Clôture ' + e.id, viseur_login: me.login, viseur_nom: me.nom, dateVisa: F.nowISO(), cree: F.nowISO() };
      var ex = F.coll.ecritures.findIndex(function (x) { return x.id === an.id; }); if (ex >= 0) F.coll.ecritures.splice(ex, 1); F.coll.ecritures.push(an);
    }
    e.statut = 'clos'; e.cloture = { par_login: me.login, par_nom: me.nom, date: F.nowISO(), resultat: res.resultat };
    touch(); return { ok: true, resultat: res.resultat, an: an };
  }
  function rouvrir(year, motif) {
    var e = F.coll.exercices.find(function (x) { return x.id === String(year); });
    if (!e || e.statut !== 'clos') return { ok: false, why: 'Cet exercice n\'est pas clos.' };
    if (!F.can('comptaCloturer')) return { ok: false, why: 'La réouverture est réservée à l\'administrateur.' };
    if (!String(motif || '').trim()) return { ok: false, why: 'Le motif est obligatoire.' };
    var suiv = F.coll.exercices.find(function (x) { return x.id === String(Number(year) + 1); });
    if (suiv && suiv.statut === 'clos') return { ok: false, why: 'Rouvrez d\'abord l\'exercice ' + suiv.id + ' (réouverture dans l\'ordre inverse).' };
    if (suiv && F.coll.ecritures.some(function (x) { return x.exercice === suiv.id && x.journal !== 'AN' && x.statut === 'vise'; })) return { ok: false, why: 'L\'exercice ' + suiv.id + ' contient déjà des écritures visées.' };
    var i = F.coll.ecritures.findIndex(function (x) { return x.id === 'AN-' + String(Number(year) + 1); }); if (i >= 0) F.coll.ecritures.splice(i, 1);
    (e.reouvertures = e.reouvertures || []).push({ par: F.who().nom, date: F.nowISO(), motif: String(motif).trim() });
    e.statut = 'ouvert'; delete e.cloture; touch(); return { ok: true };
  }

  /* ── Exports ──────────────────────────────────────────────────────────── */
  function download(name, text, type) {
    var blob = new Blob(['﻿' + text], { type: type || 'text/plain;charset=utf-8' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function fecText(year) {
    var rows = ['JournalCode\tJournalLib\tEcritureNum\tEcritureDate\tCompteNum\tCompteLib\tCompAuxNum\tCompAuxLib\tPieceRef\tPieceDate\tEcritureLib\tDebit\tCredit\tEcritureLet\tDateLet\tValidDate\tMontantdevise\tIdevise'];
    var compteurs = {}, ecr = F.coll.ecritures.filter(function (e) { return !year || e.exercice === String(year); }).slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.id < b.id ? -1 : 1); });
    var d8 = function (s) { return String(s || '').replace(/-/g, ''); };
    ecr.forEach(function (e) {
      compteurs[e.journal] = (compteurs[e.journal] || 0) + 1;
      var jl = (JOURNAUX.find(function (j) { return j[0] === e.journal; }) || [e.journal, e.journal])[1];
      e.lignes.forEach(function (l) {
        var c = compte(l.compte), n = function (v) { return String(r2(v)).replace('.', ','); };
        rows.push([e.journal, jl, String(compteurs[e.journal]).padStart(6, '0'), d8(e.date), l.compte, c ? c.lib : '', '', '', e.piece || e.id, d8(e.date), String(e.libelle).replace(/[\t\r\n]/g, ' '), n(l.debit), n(l.credit), '', '', e.dateVisa ? d8(e.dateVisa.slice(0, 10)) : '', '', ''].join('\t'));
      });
    });
    return rows.join('\n');
  }
  function csv(rows) { return rows.map(function (r) { return r.map(function (c) { var s = String(c == null ? '' : c); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(';'); }).join('\n'); }

  /* ══════════════════════════ INTERFACE ══════════════════════════ */
  var ST = { tab: 'synthese', exercice: String(new Date().getFullYear()), journal: '', compte: '' };
  var TABS = [['synthese', 'Synthèse'], ['brouillard', 'À viser'], ['journal', 'Journal'], ['grandlivre', 'Grand livre'], ['balance', 'Balance'], ['etats', 'Résultat & Bilan'], ['tva', 'TVA'], ['ventilation', 'Ventilation caisse'], ['plan', 'Plan comptable'], ['exercices', 'Exercices'], ['params', 'Paramètres']];
  function sel(id, opts, cur) { return '<select id="' + id + '" class="form-control" style="width:auto;display:inline-block;padding:6px 8px;font-size:12px">' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(cur) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>'; }
  function exOpts() { return F.coll.exercices.slice().sort(function (a, b) { return a.id < b.id ? 1 : -1; }).map(function (e) { return [e.id, 'Exercice ' + e.id + (e.statut === 'clos' ? ' (clos)' : '')]; }); }
  function bad(txt) { return '<div class="fin-warn">' + txt + '</div>'; }
  function badgeStatut(e) { return e.statut === 'vise' ? '<span class="fin-st fin-st-ok">✅ Visée</span>' : '<span class="fin-st fin-st-att">📝 Brouillard</span>'; }

  function render() {
    var root = document.getElementById('compta-root'); if (!root) return;
    seed(); ventilationAuto(); generer();
    var h = '<div class="fin-tabs">' + TABS.map(function (t) { return '<button class="ftab' + (ST.tab === t[0] ? ' active' : '') + '" data-ctab="' + t[0] + '">' + t[1] + (t[0] === 'brouillard' ? ' <span class="nav-badge red">' + F.coll.ecritures.filter(function (e) { return e.exercice === ST.exercice && e.statut !== 'vise'; }).length + '</span>' : '') + '</button>'; }).join('') + '</div>';
    h += '<div class="fin-filters">' + sel('ct-ex', exOpts(), ST.exercice) + '</div>';
    var fn = VIEWS[ST.tab] || VIEWS.synthese;
    root.innerHTML = h + '<div id="compta-view">' + fn() + '</div>';
    var act = document.getElementById('compta-actions');
    if (act) act.innerHTML = (F.can('comptaSaisie') ? '<button class="btn btn-primary btn-sm" data-act="new">＋ Nouvelle écriture</button>' : '') + '<button class="btn btn-secondary btn-sm" data-act="fec">⬇ Export FEC</button>';
  }

  var VIEWS = {
    synthese: function () {
      var res = resultat({ exercice: ST.exercice }), t = tva({ exercice: ST.exercice }), b = balance({ exercice: ST.exercice });
      var td = b.reduce(function (n, x) { return n + x.debit; }, 0), tc = b.reduce(function (n, x) { return n + x.credit; }, 0);
      var brou = F.coll.ecritures.filter(function (e) { return e.exercice === ST.exercice && e.statut !== 'vise'; }).length, anom = F.coll.ecritures.filter(function (e) { return e.anomalie; }).length;
      var tres = b.filter(function (x) { return /^5[2-7]/.test(x.compte); }).reduce(function (n, x) { return n + x.sd - x.sc; }, 0);
      return '<div class="fin-kpis"><div><span>Produits</span><b style="color:var(--green)">' + fmt(res.produits) + ' F</b></div><div><span>Charges</span><b style="color:var(--red)">' + fmt(res.charges) + ' F</b></div><div><span>Résultat</span><b style="color:' + (res.resultat >= 0 ? 'var(--green)' : 'var(--red)') + '">' + fmt(res.resultat) + ' F</b></div><div><span>Trésorerie</span><b>' + fmt(tres) + ' F</b></div><div><span>TVA à payer</span><b>' + fmt(t.apayer) + ' F</b></div></div>' +
        '<div class="card"><div class="card-title">Contrôles</div><ul class="fin-checks"><li class="' + (r2(td) === r2(tc) ? 'ok' : 'ko') + '">Balance équilibrée : débit ' + fmt(td) + ' / crédit ' + fmt(tc) + '</li><li class="' + (brou ? 'ko' : 'ok') + '">' + brou + ' écriture(s) au brouillard (à viser)</li><li class="' + (anom ? 'ko' : 'ok') + '">' + anom + ' anomalie(s) : source modifiée ou supprimée après visa</li><li class="' + (bonsAVentiler().length ? 'ko' : 'ok') + '">' + bonsAVentiler().length + ' mouvement(s) de caisse à ventiler</li></ul>' +
        '<div class="fin-note">Les écritures sont générées automatiquement depuis les factures, encaissements, dépenses validées, factures fournisseurs, bons de caisse et écarts de clôture. Le comptable les <b>contrôle</b>, la hiérarchie les <b>vise</b>.</div></div>';
    },
    brouillard: function () {
      var l = F.coll.ecritures.filter(function (e) { return e.exercice === ST.exercice && e.statut !== 'vise'; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
      if (!l.length) return '<div class="card"><div style="padding:30px;text-align:center;color:var(--text-dim)">✅ Rien à viser.</div></div>';
      return '<div class="card"><div class="card-header"><div class="card-title">Écritures au brouillard</div><div class="card-subtitle">Le visa relève de la hiérarchie (droit, plafond, jamais sur sa propre saisie).</div></div><div class="table-wrap"><table><thead><tr><th>Date</th><th>Jnl</th><th>Pièce</th><th>Libellé</th><th>Montant</th><th>Statut</th><th></th></tr></thead><tbody>' +
        l.map(function (e) { return '<tr><td>' + esc(e.date) + '</td><td>' + esc(e.journal) + '</td><td>' + esc(e.piece) + '</td><td>' + esc(e.libelle) + (e.anomalie ? '<div class="fin-sub" style="color:var(--red)">⚠ ' + esc(e.anomalie) + '</div>' : '') + '</td><td style="text-align:right;font-family:var(--font-mono)">' + fmt(montantEcriture(e)) + '</td><td>' + badgeStatut(e) + '</td><td class="fin-rowact"><button class="btn btn-secondary btn-sm" data-det="' + esc(e.id) + '">Détail</button><button class="btn btn-primary btn-sm" data-viser="' + esc(e.id) + '">Viser</button>' + (!e.auto ? '<button class="btn btn-secondary btn-sm" data-sup="' + esc(e.id) + '">Supprimer</button>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
    },
    journal: function () {
      var l = F.coll.ecritures.filter(function (e) { return e.exercice === ST.exercice && (!ST.journal || e.journal === ST.journal); }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
      return '<div class="fin-filters">' + sel('ct-jn', [['', 'Tous les journaux']].concat(JOURNAUX), ST.journal) + '</div><div class="card"><div class="table-wrap"><table><thead><tr><th>Date</th><th>Jnl</th><th>Pièce</th><th>Libellé</th><th>Débit</th><th>Crédit</th><th>Statut</th><th></th></tr></thead><tbody>' +
        (l.map(function (e) { var t = totaux(e.lignes); return '<tr><td>' + esc(e.date) + '</td><td>' + esc(e.journal) + '</td><td>' + esc(e.piece) + '</td><td>' + esc(e.libelle) + (e.anomalie ? '<div class="fin-sub" style="color:var(--red)">⚠ ' + esc(e.anomalie) + '</div>' : '') + (e.contrepasse ? '<div class="fin-sub">contre-passée</div>' : '') + '</td><td style="text-align:right;font-family:var(--font-mono)">' + fmt(t.debit) + '</td><td style="text-align:right;font-family:var(--font-mono)">' + fmt(t.credit) + '</td><td>' + badgeStatut(e) + '</td><td class="fin-rowact"><button class="btn btn-secondary btn-sm" data-det="' + esc(e.id) + '">Détail</button></td></tr>'; }).join('') || '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--text-dim)">Aucune écriture.</td></tr>') + '</tbody></table></div></div>';
    },
    grandlivre: function () {
      var nums = Array.from(new Set(lignesDe({ exercice: ST.exercice }).map(function (l) { return l.compte; }))).sort();
      var cur = ST.compte && nums.indexOf(ST.compte) >= 0 ? ST.compte : (nums[0] || '');
      var ls = lignesDe({ exercice: ST.exercice }).filter(function (l) { return l.compte === cur; }).sort(function (a, b) { return a.e.date < b.e.date ? -1 : 1; }), cum = 0;
      return '<div class="fin-filters">' + sel('ct-cp', nums.map(function (n) { var c = compte(n); return [n, n + ' — ' + (c ? c.lib : '?')]; }), cur) + '<button class="btn btn-secondary btn-sm" data-act="gl-csv">⬇ CSV</button></div><div class="card"><div class="table-wrap"><table><thead><tr><th>Date</th><th>Jnl</th><th>Pièce</th><th>Libellé</th><th>Débit</th><th>Crédit</th><th>Solde</th></tr></thead><tbody>' +
        ls.map(function (l) { cum = r2(cum + l.debit - l.credit); return '<tr><td>' + esc(l.e.date) + '</td><td>' + esc(l.e.journal) + '</td><td>' + esc(l.e.piece) + '</td><td>' + esc(l.e.libelle) + '</td><td style="text-align:right">' + (l.debit ? fmt(l.debit) : '') + '</td><td style="text-align:right">' + (l.credit ? fmt(l.credit) : '') + '</td><td style="text-align:right;font-family:var(--font-mono)">' + fmt(cum) + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
    },
    balance: function () {
      var b = balance({ exercice: ST.exercice }), t = { d: 0, c: 0, sd: 0, sc: 0 };
      b.forEach(function (x) { t.d += x.debit; t.c += x.credit; t.sd += x.sd; t.sc += x.sc; });
      return '<div class="fin-filters"><button class="btn btn-secondary btn-sm" data-act="bal-csv">⬇ CSV</button></div><div class="card"><div class="table-wrap"><table><thead><tr><th>Compte</th><th>Libellé</th><th>Débit</th><th>Crédit</th><th>Solde débiteur</th><th>Solde créditeur</th></tr></thead><tbody>' +
        b.map(function (x) { return '<tr><td>' + esc(x.compte) + '</td><td>' + esc(x.lib) + '</td><td style="text-align:right">' + fmt(x.debit) + '</td><td style="text-align:right">' + fmt(x.credit) + '</td><td style="text-align:right">' + (x.sd ? fmt(x.sd) : '') + '</td><td style="text-align:right">' + (x.sc ? fmt(x.sc) : '') + '</td></tr>'; }).join('') +
        '<tr class="fin-total"><td colspan="2">Total</td><td style="text-align:right">' + fmt(t.d) + '</td><td style="text-align:right">' + fmt(t.c) + '</td><td style="text-align:right">' + fmt(t.sd) + '</td><td style="text-align:right">' + fmt(t.sc) + '</td></tr></tbody></table></div></div>' + (r2(t.d) === r2(t.c) ? '' : bad('Balance déséquilibrée.'));
    },
    etats: function () {
      var res = resultat({ exercice: ST.exercice }), b = balance({ exercice: ST.exercice });
      var actif = b.filter(function (x) { return x.compte[0] >= '2' && x.compte[0] <= '5' && x.sd > 0; }), passif = b.filter(function (x) { return (x.compte[0] === '1' || x.compte[0] >= '2' && x.compte[0] <= '5') && x.sc > 0 && x.compte[0] !== '6'; });
      var ta = actif.reduce(function (n, x) { return n + x.sd; }, 0), tp = passif.reduce(function (n, x) { return n + x.sc; }, 0) + res.resultat;
      var tr = function (x, v) { return '<tr><td>' + esc(x.compte) + ' ' + esc(x.lib) + '</td><td style="text-align:right">' + fmt(v) + '</td></tr>'; };
      return '<div class="grid-2"><div class="card"><div class="card-title">Compte de résultat</div><table><tbody>' + res.lignes.filter(function (x) { return x.compte[0] === '7'; }).map(function (x) { return tr(x, x.sc - x.sd); }).join('') + '<tr class="fin-total"><td>Produits</td><td style="text-align:right">' + fmt(res.produits) + '</td></tr>' + res.lignes.filter(function (x) { return x.compte[0] === '6'; }).map(function (x) { return tr(x, x.sd - x.sc); }).join('') + '<tr class="fin-total"><td>Charges</td><td style="text-align:right">' + fmt(res.charges) + '</td></tr><tr class="fin-total"><td>Résultat</td><td style="text-align:right;color:' + (res.resultat >= 0 ? 'var(--green)' : 'var(--red)') + '">' + fmt(res.resultat) + '</td></tr></tbody></table></div>' +
        '<div class="card"><div class="card-title">Bilan simplifié</div><div class="fin-sub">Actif</div><table><tbody>' + actif.map(function (x) { return tr(x, x.sd); }).join('') + '<tr class="fin-total"><td>Total actif</td><td style="text-align:right">' + fmt(ta) + '</td></tr></tbody></table><div class="fin-sub" style="margin-top:10px">Passif</div><table><tbody>' + passif.map(function (x) { return tr(x, x.sc); }).join('') + '<tr><td>Résultat de l\'exercice</td><td style="text-align:right">' + fmt(res.resultat) + '</td></tr><tr class="fin-total"><td>Total passif</td><td style="text-align:right">' + fmt(tp) + '</td></tr></tbody></table></div></div>' + (r2(ta) === r2(tp) ? '' : '<div class="fin-note">Bilan simplifié : l\'actif et le passif diffèrent tant que des comptes de bilan (ex. soldes inversés) ne sont pas régularisés ; à valider avec votre expert-comptable.</div>');
    },
    tva: function () {
      var t = tva({ exercice: ST.exercice });
      return '<div class="fin-kpis"><div><span>TVA collectée</span><b>' + fmt(t.collectee) + ' F</b></div><div><span>TVA récupérable</span><b>' + fmt(t.recuperable) + ' F</b></div><div><span>' + (t.apayer >= 0 ? 'TVA à payer' : 'Crédit de TVA') + '</span><b style="color:' + (t.apayer >= 0 ? 'var(--red)' : 'var(--green)') + '">' + fmt(Math.abs(t.apayer)) + ' F</b></div></div><div class="fin-note">Taux appliqué aux factures : ' + cfg().tva + ' % (Paramètres). Montants TTC des factures décomposés en HT et TVA.</div>';
    },
    ventilation: function () {
      var l = bonsAVentiler();
      var opts = F.coll.comptes.filter(function (c) { return /^[1-7]/.test(c.num) && !/^5[27]/.test(c.num); }).sort(function (a, b) { return a.num < b.num ? -1 : 1; }).map(function (c) { return [c.num, c.num + ' — ' + c.lib]; });
      return '<div class="card"><div class="card-header"><div class="card-title">Mouvements de caisse à ventiler</div><div class="card-subtitle">Choisissez le compte de contrepartie : l\'écriture est ensuite générée. Des règles (mot-clé → compte) ventilent seules les cas courants.</div></div>' +
        (l.length ? '<div class="table-wrap"><table><thead><tr><th>Bon</th><th>Date</th><th>Motif</th><th>Montant</th><th>Compte de contrepartie</th><th></th></tr></thead><tbody>' + l.map(function (b) { return '<tr><td style="font-family:var(--font-mono);font-size:11px">' + esc(b.id) + '</td><td>' + esc(b.date) + '</td><td>' + esc(b.motif) + ' — ' + esc(b.tiers) + '</td><td style="text-align:right">' + (b.type === 'entree' ? '+' : '−') + fmt(b.montant) + '</td><td>' + sel('vt-' + b.id, opts, b.type === 'entree' ? '706' : '659') + '</td><td><button class="btn btn-primary btn-sm" data-vent="' + esc(b.id) + '"' + (F.can('comptaSaisie') ? '' : ' disabled') + '>Ventiler</button></td></tr>'; }).join('') + '</tbody></table></div>' : '<div style="padding:30px;text-align:center;color:var(--text-dim)">✅ Rien à ventiler.</div>') + '</div>';
    },
    plan: function () {
      return '<div class="card"><div class="card-header"><div class="card-title">Plan comptable</div>' + (F.can('comptaSaisie') ? '<button class="btn btn-secondary btn-sm" data-act="new-compte">＋ Compte</button>' : '') + '</div><div class="table-wrap"><table><thead><tr><th>N°</th><th>Libellé</th><th>Classe</th></tr></thead><tbody>' + F.coll.comptes.slice().sort(function (a, b) { return a.num < b.num ? -1 : 1; }).map(function (c) { return '<tr><td>' + esc(c.num) + '</td><td>' + esc(c.lib) + '</td><td>' + c.classe + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
    },
    exercices: function () {
      return '<div class="card"><div class="card-header"><div class="card-title">Exercices comptables</div><div class="card-subtitle">On clôture dans l\'ordre, une seule fois ; un exercice clos est verrouillé. Réservé à l\'administrateur.</div></div><div class="table-wrap"><table><thead><tr><th>Exercice</th><th>Période</th><th>Statut</th><th>Résultat</th><th></th></tr></thead><tbody>' + F.coll.exercices.slice().sort(function (a, b) { return a.id < b.id ? 1 : -1; }).map(function (e) {
        return '<tr><td>' + esc(e.id) + '</td><td>' + esc(e.debut) + ' → ' + esc(e.fin) + '</td><td>' + (e.statut === 'clos' ? '🔒 Clos' : '🟢 Ouvert') + '</td><td style="text-align:right">' + (e.cloture ? fmt(e.cloture.resultat) + ' F' : fmt(resultat({ exercice: e.id }).resultat) + ' F (provisoire)') + '</td><td class="fin-rowact">' + (F.can('comptaCloturer') ? (e.statut === 'clos' ? '<button class="btn btn-secondary btn-sm" data-reouv="' + esc(e.id) + '">Rouvrir</button>' : '<button class="btn btn-primary btn-sm" data-clot="' + esc(e.id) + '">Clôturer</button>') : '') + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
    },
    params: function () {
      var c = cfg(), cc = c.comptes, lab = { clients: 'Clients', fournisseurs: 'Fournisseurs', ventes: 'Produit des ventes / prestations', tvaCollectee: 'TVA collectée', tvaRecup: 'TVA récupérable', achats: 'Achats de marchandises', caisse: 'Caisse', mobile: 'Mobile Money', banque: 'Banque', virement: 'Virement interne', ecartManquant: 'Écart de caisse : manquant', ecartExcedent: 'Écart de caisse : excédent' };
      var disabled = F.who().role === 'admin' ? '' : ' disabled';
      return '<div class="card"><div class="card-title">Paramètres comptables</div><div class="fin-note">À faire valider par votre expert-comptable : taux de TVA, comptes par défaut, calendrier de clôture.</div><div class="form-group"><label class="form-label">Taux de TVA (%)</label><input class="form-control" id="pc-tva" type="number" value="' + c.tva + '" style="max-width:120px"' + disabled + '></div><div class="form-row">' +
        Object.keys(lab).map(function (k) { return '<div class="form-group"><label class="form-label">' + lab[k] + '</label><input class="form-control" data-pc="' + k + '" value="' + esc(cc[k]) + '"' + disabled + '></div>'; }).join('') + '</div><button class="btn btn-primary" data-act="save-params"' + disabled + '>Enregistrer</button></div>';
    }
  };

  /* détail d'une écriture */
  function detail(id) {
    var e = F.coll.ecritures.find(function (x) { return x.id === id; }); if (!e) return;
    var t = totaux(e.lignes);
    F.modal({ id: 'fin-det', wide: true, title: 'Écriture — ' + esc(e.piece || e.id), html: '<div class="fin-sub">' + esc(e.date) + ' · Journal ' + esc(e.journal) + ' · ' + badgeStatut(e) + (e.auto ? ' · automatique (' + esc(e.source) + ')' : '') + '</div><p>' + esc(e.libelle) + '</p><table><thead><tr><th>Compte</th><th>Libellé</th><th>Débit</th><th>Crédit</th></tr></thead><tbody>' +
      e.lignes.map(function (l) { var c = compte(l.compte); return '<tr><td>' + esc(l.compte) + '</td><td>' + esc(c ? c.lib : '') + '</td><td style="text-align:right">' + (l.debit ? fmt(l.debit) : '') + '</td><td style="text-align:right">' + (l.credit ? fmt(l.credit) : '') + '</td></tr>'; }).join('') + '<tr class="fin-total"><td colspan="2">Total</td><td style="text-align:right">' + fmt(t.debit) + '</td><td style="text-align:right">' + fmt(t.credit) + '</td></tr></tbody></table>' +
      '<div class="fin-sub" style="margin-top:10px">Saisie : ' + esc(e.auteur_nom || '') + (e.viseur_nom ? ' · Visa : ' + esc(e.viseur_nom) + ' (' + esc((e.dateVisa || '').slice(0, 10)) + ')' : '') + (e.contrepasseDe ? ' · contre-passation de ' + esc(e.contrepasseDe) : '') + '</div>' + (e.anomalie ? bad('⚠ ' + esc(e.anomalie)) : ''),
      buttons: [{ label: 'Fermer', close: true }].concat(e.statut === 'vise' && !e.contrepasse && F.can('comptaSaisie') ? [{ label: 'Contre-passer', cls: 'btn-danger', onClick: function () { cpDialog(e.id); return true; } }] : []).concat(e.statut === 'vise' && F.who().role === 'admin' ? [{ label: 'Lever le visa', cls: 'btn-secondary', onClick: function () { lvDialog(e.id); return true; } }] : []) });
  }
  function cpDialog(id) { F.modal({ id: 'fin-cp', title: 'Contre-passer l\'écriture', html: '<div class="fin-note">Une écriture inverse (au brouillard) sera créée ; elle devra être visée.</div><div class="form-group"><label class="form-label">Motif *</label><input class="form-control" id="cp-m"></div>', buttons: [{ label: 'Annuler' }, { label: 'Contre-passer', cls: 'btn-danger', onClick: function (m) { var r = contrepasser(id, m.querySelector('#cp-m').value); F.toast(r.ok ? 'Écriture inverse créée (à viser)' : r.why, r.ok ? 'success' : 'error'); if (r.ok) render(); return r.ok ? undefined : false; } }] }); }
  function lvDialog(id) { F.modal({ id: 'fin-lv', title: 'Lever le visa', html: '<div class="form-group"><label class="form-label">Motif *</label><input class="form-control" id="lv-m"></div>', buttons: [{ label: 'Annuler' }, { label: 'Lever le visa', cls: 'btn-danger', onClick: function (m) { var r = devalider(id, m.querySelector('#lv-m').value); F.toast(r.ok ? 'Visa levé' : r.why, r.ok ? 'info' : 'error'); if (r.ok) render(); return r.ok ? undefined : false; } }] }); }

  function newEcritureDialog() {
    var opts = F.coll.comptes.slice().sort(function (a, b) { return a.num < b.num ? -1 : 1; }).map(function (c) { return '<option value="' + esc(c.num) + '">' + esc(c.num + ' — ' + c.lib) + '</option>'; }).join('');
    var row = function () { return '<div class="fin-line"><select class="form-control fl-c">' + opts + '</select><input class="form-control fl-d" type="number" min="0" placeholder="Débit"><input class="form-control fl-k" type="number" min="0" placeholder="Crédit"></div>'; };
    F.modal({ id: 'fin-new', wide: true, title: '＋ Nouvelle écriture', html: '<div class="form-row"><div class="form-group"><label class="form-label">Date *</label><input class="form-control" id="ne-date" type="date" value="' + F.today() + '"></div><div class="form-group"><label class="form-label">Journal *</label><select class="form-control" id="ne-jn">' + JOURNAUX.filter(function (j) { return j[0] !== 'AN'; }).map(function (j) { return '<option value="' + j[0] + '">' + j[1] + '</option>'; }).join('') + '</select></div></div><div class="form-row"><div class="form-group"><label class="form-label">Pièce</label><input class="form-control" id="ne-piece"></div><div class="form-group"><label class="form-label">Libellé *</label><input class="form-control" id="ne-lib"></div></div><div id="ne-lines">' + row() + row() + '</div><button type="button" class="btn btn-secondary btn-sm" id="ne-add">＋ Ligne</button><div class="fin-sub" id="ne-tot" style="margin-top:8px"></div>',
      buttons: [{ label: 'Annuler' }, { label: 'Enregistrer (brouillard)', cls: 'btn-primary', onClick: function (m) {
        var lignes = []; m.querySelectorAll('.fin-line').forEach(function (r) { var d = Number(r.querySelector('.fl-d').value) || 0, k = Number(r.querySelector('.fl-k').value) || 0; if (d || k) lignes.push({ compte: r.querySelector('.fl-c').value, debit: d, credit: k }); });
        var res = saisir({ date: m.querySelector('#ne-date').value, journal: m.querySelector('#ne-jn').value, piece: m.querySelector('#ne-piece').value, libelle: m.querySelector('#ne-lib').value, lignes: lignes });
        F.toast(res.ok ? 'Écriture enregistrée au brouillard' : res.why, res.ok ? 'success' : 'error'); if (res.ok) render(); return res.ok ? undefined : false;
      } }] });
    var m = document.getElementById('fin-new'), box = m.querySelector('#ne-lines');
    m.querySelector('#ne-add').addEventListener('click', function () { box.insertAdjacentHTML('beforeend', row()); });
    m.addEventListener('input', function () { var d = 0, k = 0; m.querySelectorAll('.fl-d').forEach(function (i) { d += Number(i.value) || 0; }); m.querySelectorAll('.fl-k').forEach(function (i) { k += Number(i.value) || 0; }); m.querySelector('#ne-tot').innerHTML = 'Débit ' + fmt(d) + ' · Crédit ' + fmt(k) + (d === k && d > 0 ? ' ✅ équilibrée' : ' ⚠ déséquilibrée'); });
  }

  document.addEventListener('click', function (ev) {
    var root = document.getElementById('page-compta'); if (!root || !root.contains(ev.target)) return;
    var t = ev.target.closest('[data-ctab],[data-act],[data-det],[data-viser],[data-sup],[data-vent],[data-clot],[data-reouv]'); if (!t) return;
    if (t.hasAttribute('data-ctab')) { ST.tab = t.getAttribute('data-ctab'); return render(); }
    if (t.hasAttribute('data-det')) return detail(t.getAttribute('data-det'));
    if (t.hasAttribute('data-viser')) { var r = viser(t.getAttribute('data-viser')); F.toast(r.ok ? 'Écriture visée' : r.why, r.ok ? 'success' : 'error'); return render(); }
    if (t.hasAttribute('data-sup')) { var s = supprimer(t.getAttribute('data-sup')); F.toast(s.ok ? 'Écriture supprimée' : s.why, s.ok ? 'info' : 'error'); return render(); }
    if (t.hasAttribute('data-vent')) { var id = t.getAttribute('data-vent'), v = ventiler(id, (document.getElementById('vt-' + id) || {}).value); F.toast(v.ok ? 'Mouvement ventilé : écriture générée' : v.why, v.ok ? 'success' : 'error'); return render(); }
    if (t.hasAttribute('data-clot')) { var y = t.getAttribute('data-clot'); return F.ask('Clôturer l\'exercice ' + y, '<p class="fin-note">Les à-nouveaux seront générés sur l\'exercice suivant ; l\'exercice sera <b>verrouillé</b>.</p>', 'Clôturer', function () { var c = cloturer(y); F.toast(c.ok ? 'Exercice ' + y + ' clos — résultat ' + fmt(c.resultat) + ' F' : c.why, c.ok ? 'success' : 'error'); if (c.ok) render(); return c.ok ? undefined : false; }, true); }
    if (t.hasAttribute('data-reouv')) { var y2 = t.getAttribute('data-reouv'); return F.modal({ id: 'fin-ro', title: 'Rouvrir l\'exercice ' + y2, html: '<div class="form-group"><label class="form-label">Motif *</label><input class="form-control" id="ro-m"></div>', buttons: [{ label: 'Annuler' }, { label: 'Rouvrir', cls: 'btn-danger', onClick: function (m) { var r = rouvrir(y2, m.querySelector('#ro-m').value); F.toast(r.ok ? 'Exercice rouvert' : r.why, r.ok ? 'info' : 'error'); if (r.ok) render(); return r.ok ? undefined : false; } }] }); }
    var a = t.getAttribute('data-act');
    if (a === 'new') return newEcritureDialog();
    if (a === 'fec') return download('FEC_' + ST.exercice + '.txt', fecText(ST.exercice));
    if (a === 'bal-csv') return download('balance_' + ST.exercice + '.csv', csv([['Compte', 'Libellé', 'Débit', 'Crédit', 'Solde débiteur', 'Solde créditeur']].concat(balance({ exercice: ST.exercice }).map(function (x) { return [x.compte, x.lib, x.debit, x.credit, x.sd, x.sc]; }))));
    if (a === 'gl-csv') return download('grand_livre_' + ST.exercice + '.csv', csv([['Date', 'Journal', 'Pièce', 'Libellé', 'Compte', 'Débit', 'Crédit']].concat(lignesDe({ exercice: ST.exercice }).map(function (l) { return [l.e.date, l.e.journal, l.e.piece, l.e.libelle, l.compte, l.debit, l.credit]; }))));
    if (a === 'new-compte') return F.modal({ id: 'fin-nc', title: 'Nouveau compte', html: '<div class="form-group"><label class="form-label">Numéro *</label><input class="form-control" id="nc-n"></div><div class="form-group"><label class="form-label">Libellé *</label><input class="form-control" id="nc-l"></div>', buttons: [{ label: 'Annuler' }, { label: 'Créer', cls: 'btn-primary', onClick: function (m) { var n = m.querySelector('#nc-n').value.trim(), l = m.querySelector('#nc-l').value.trim(); if (!/^[1-8]\d{2,7}$/.test(n) || !l) { F.toast('Numéro (3 à 8 chiffres, classe 1 à 8) et libellé obligatoires.', 'error'); return false; } if (compte(n)) { F.toast('Ce compte existe déjà.', 'error'); return false; } F.coll.comptes.push({ id: n, num: n, lib: l, classe: Number(n[0]) }); touch(); render(); } }] });
    if (a === 'save-params') { if (F.who().role !== 'admin') return F.toast('Réservé à l\'administrateur', 'error'); var c = cfg(); c.tva = Number(document.getElementById('pc-tva').value) || 0; document.querySelectorAll('[data-pc]').forEach(function (i) { c.comptes[i.getAttribute('data-pc')] = i.value.trim(); }); saveCfg(c); F.toast('Paramètres enregistrés', 'success'); generer(); render(); }
  });
  document.addEventListener('change', function (ev) {
    var id = ev.target.id; if (!document.getElementById('page-compta') || !document.getElementById('page-compta').contains(ev.target)) return;
    if (id === 'ct-ex') { ST.exercice = ev.target.value; render(); } if (id === 'ct-jn') { ST.journal = ev.target.value; render(); } if (id === 'ct-cp') { ST.compte = ev.target.value; render(); }
  });

  F.onPage('compta', render);
  window.addEventListener('fin-data-changed', function () { try { if (document.querySelector('#page-compta.active')) render(); } catch (x) {} });
  document.addEventListener('DOMContentLoaded', function () { setTimeout(function () { seed(); }, 800); });

  F.compta = { cfg: cfg, saveCfg: saveCfg, seed: seed, generer: generer, saisir: saisir, viser: viser, devalider: devalider, contrepasser: contrepasser, supprimer: supprimer, ventiler: ventiler, ventilationAuto: ventilationAuto,
    bonsAVentiler: bonsAVentiler, balance: balance, resultat: resultat, tva: tva, cloturer: cloturer, rouvrir: rouvrir, fecText: fecText, compte: compte, clos: clos, validerLignes: validerLignes, totaux: totaux, render: render, JOURNAUX: JOURNAUX };
})();
