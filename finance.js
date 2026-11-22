/* AutoGarage Pro — socle « Caisse & Comptabilité » (inspiré des procédures CAI / COM / VAL de Zahara).
   Fournit : données (bons de caisse, écritures, plan comptable, exercices), habilitations par rôle avec plafonds,
   règles de décision de la hiérarchie (plafond, séparation des tâches, décision définitive), numérotation,
   fenêtres communes, nouveaux menus (Validations, Comptabilité) et rôle « Comptable ».
   Les modules caisse.js, compta.js et validations.js s'appuient sur window.FIN. */
(function () {
  'use strict';

  var KEY = 'gp_fin_v1';
  var HAB_KEY = 'gp_habilitations';

  /* ── Données (tableaux vivants, partagés avec la synchronisation) ─────── */
  var COLL = { bons: [], ecritures: [], comptes: [], exercices: [] };
  var TABLE = { bons: 'bons_caisse', ecritures: 'ecritures', comptes: 'comptes', exercices: 'exercices' };

  function load() {
    var raw = null; try { raw = JSON.parse(localStorage.getItem(KEY)); } catch (x) {}
    Object.keys(COLL).forEach(function (k) {
      COLL[k].length = 0;
      if (raw && Array.isArray(raw[k])) raw[k].forEach(function (r) { COLL[k].push(r); });
    });
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(COLL)); } catch (x) { console.warn('[Finance] enregistrement local impossible', x); }
  }
  load();

  Object.keys(COLL).forEach(function (k) {
    var def = { table: TABLE[k], get: function () { return COLL[k]; }, afterSet: function () { save(); try { window.dispatchEvent(new Event('fin-data-changed')); } catch (x) {} } };
    if (typeof window._gpRegisterModule === 'function') window._gpRegisterModule(k, def);
  });
  /* cloud.js est chargé avant ; sinon on réessaie après le chargement */
  document.addEventListener('DOMContentLoaded', function () {
    Object.keys(COLL).forEach(function (k) {
      if (typeof window._gpRegisterModule === 'function') window._gpRegisterModule(k, { table: TABLE[k], get: function () { return COLL[k]; }, afterSet: function () { save(); try { window.dispatchEvent(new Event('fin-data-changed')); } catch (x) {} } });
    });
  });

  window.DB_BONS = COLL.bons; window.DB_ECRITURES = COLL.ecritures; window.DB_COMPTES = COLL.comptes; window.DB_EXERCICES = COLL.exercices;

  /* ── Utilitaires ──────────────────────────────────────────────────────── */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(n) { return Math.round(Number(n) || 0).toLocaleString('fr-FR'); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function nowISO() { return new Date().toISOString(); }
  function rnd(n) { var s = ''; while (s.length < n) s += Math.random().toString(36).slice(2); return s.slice(0, n); }
  function toastMsg(m, t) { if (typeof toast === 'function') toast(m, t || 'info'); }
  function sess() { return (typeof session !== 'undefined' && session) ? session : {}; }
  function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

  /* ── Identité ─────────────────────────────────────────────────────────── */
  function who() {
    var s = sess(), login = String(s.login || s.user || '').toLowerCase();
    return { login: login, nom: s.user || s.login || '', role: s.role || '', uid: s.uid || login };
  }
  function sameUser(a, b) { return !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase(); }

  /* ── Habilitations ────────────────────────────────────────────────────── */
  var RIGHTS = [
    { id: 'caisseSaisie', label: 'Saisir des bons de caisse' },
    { id: 'caisseValider', label: 'Valider les bons de caisse' },
    { id: 'comptaSaisie', label: 'Saisir des écritures' },
    { id: 'comptaViser', label: 'Viser les écritures' },
    { id: 'comptaCloturer', label: 'Clôturer / rouvrir l\'exercice' }
  ];
  var ROLE_LIST = [['admin', 'Administrateur'], ['chef', 'Chef d\'atelier'], ['comptable', 'Comptable'], ['caissier', 'Caissier'], ['meca', 'Mécanicien']];

  function defaultHab() {
    return {
      strict: true,            /* nul ne valide sa propre demande, administrateur compris */
      roles: {
        admin: { caisseSaisie: 1, caisseValider: 1, comptaSaisie: 1, comptaViser: 1, comptaCloturer: 1 },
        chef: { caisseSaisie: 0, caisseValider: 1, comptaSaisie: 0, comptaViser: 0, comptaCloturer: 0 },
        comptable: { caisseSaisie: 0, caisseValider: 0, comptaSaisie: 1, comptaViser: 0, comptaCloturer: 0 },
        caissier: { caisseSaisie: 1, caisseValider: 0, comptaSaisie: 0, comptaViser: 0, comptaCloturer: 0 },
        meca: { caisseSaisie: 0, caisseValider: 0, comptaSaisie: 0, comptaViser: 0, comptaCloturer: 0 }
      },
      plafonds: { admin: null, chef: 100000, comptable: 0, caissier: 0, meca: 0 },   /* vide = illimité ; 0 = aucune validation */
      seuilSortie: 0,          /* sortie de caisse validée par la hiérarchie à partir de ce montant (0 = toujours) */
      ecartTolere: 500,        /* écart de clôture au-delà duquel un visa de la hiérarchie est demandé */
      delaiClotureH: 24
    };
  }
  function hab() {
    var d = defaultHab(), s = null;
    try { s = JSON.parse(localStorage.getItem(HAB_KEY)); } catch (x) {}
    if (!s || typeof s !== 'object') return d;
    if (typeof s.strict === 'boolean') d.strict = s.strict;
    ['seuilSortie', 'ecartTolere', 'delaiClotureH'].forEach(function (k) { if (typeof s[k] === 'number') d[k] = s[k]; });
    if (s.roles) Object.keys(s.roles).forEach(function (r) { d.roles[r] = Object.assign({}, d.roles[r] || {}, s.roles[r]); });
    if (s.plafonds) Object.keys(s.plafonds).forEach(function (r) { d.plafonds[r] = s.plafonds[r]; });
    return d;
  }
  function saveHab(h) {
    try { localStorage.setItem(HAB_KEY, JSON.stringify(h)); } catch (x) {}
    try { if (typeof window._syncFlush === 'function') window._syncFlush(); } catch (x) {}
  }
  function can(right, role) {
    role = role || who().role;
    if (role === 'admin') return true;                       /* l'administrateur ne peut pas se verrouiller */
    var r = hab().roles[role]; return !!(r && r[right]);
  }
  function plafond(role) {
    role = role || who().role;
    var v = hab().plafonds[role];
    if (role === 'admin' && (v === undefined || v === null || v === '')) return Infinity;
    if (v === undefined || v === null || v === '' || isNaN(Number(v))) return Infinity;   /* vide ou non numérique = illimité */
    return Number(v);
  }

  /* Règle de décision de la hiérarchie (valider / viser) : droit, plafond, séparation des tâches */
  function canDecide(domain, montant, demandeurLogin, role) {
    var right = domain === 'compta' ? 'comptaViser' : 'caisseValider';
    role = role || who().role;
    if (!can(right, role)) return { ok: false, why: domain === 'compta' ? 'Le visa est réservé à la hiérarchie comptable.' : 'La validation est réservée à la hiérarchie.' };
    var p = plafond(role);
    if (p === 0) return { ok: false, why: 'Votre plafond de validation est nul : vous ne pouvez pas valider.' };
    if (Math.abs(Number(montant) || 0) > p) return { ok: false, why: 'Montant supérieur à votre plafond de validation (' + fmt(p) + ' F).' };
    if (hab().strict && sameUser(demandeurLogin, who().login)) return { ok: false, why: 'On ne valide jamais sa propre demande.' };
    return { ok: true };
  }

  /* ── Numérotation ─────────────────────────────────────────────────────── */
  function numBon(type) {
    var T = { entree: 'E', sortie: 'S', remise_banque: 'RB', remise_direction: 'RD', reappro: 'RA' }[type] || 'X';
    var d = today().replace(/-/g, ''), prefix = 'BON-' + d + '-' + T + '-';
    var n = COLL.bons.filter(function (b) { return String(b.id).indexOf(prefix) === 0; }).length + 1;
    return prefix + String(n).padStart(3, '0') + '-' + rnd(2);       /* suffixe aléatoire : pas de collision entre deux appareils */
  }

  /* ── Fenêtres communes ────────────────────────────────────────────────── */
  function modal(opts) {
    var id = opts.id || 'fin-modal';
    var old = document.getElementById(id); if (old) old.remove();
    var m = document.createElement('div');
    m.id = id; m.className = 'fin-overlay'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
    m.innerHTML = '<div class="fin-box' + (opts.wide ? ' fin-wide' : '') + '"><div class="fin-head"><div class="fin-title">' + opts.title + '</div><button type="button" class="fin-x" data-close aria-label="Fermer">✕</button></div>' +
      '<div class="fin-body">' + opts.html + '</div><div class="fin-foot">' + (opts.buttons || []).map(function (b, i) {
        return '<button type="button" class="btn ' + (b.cls || 'btn-secondary') + '" data-btn="' + i + '">' + b.label + '</button>';
      }).join('') + '</div></div>';
    document.body.appendChild(m);
    function close() { m.remove(); document.removeEventListener('keydown', onKey, true); }
    function onKey(ev) { if (ev.key === 'Escape') { ev.stopPropagation(); close(); } }
    document.addEventListener('keydown', onKey, true);
    m.addEventListener('click', function (ev) {
      if (ev.target === m || ev.target.hasAttribute('data-close')) return close();
      var b = ev.target.closest && ev.target.closest('[data-btn]');
      if (b) { var def = (opts.buttons || [])[Number(b.getAttribute('data-btn'))]; if (def && def.onClick) { var keep = def.onClick(m, close); if (keep !== false && def.close !== false) close(); } }
    });
    return { el: m, close: close, $: function (s) { return m.querySelector(s); } };
  }
  function ask(title, html, okLabel, onOk, danger) {
    return modal({ id: 'fin-ask', title: title, html: html, buttons: [{ label: 'Annuler' }, { label: okLabel || 'Confirmer', cls: danger ? 'btn-danger' : 'btn-primary', onClick: function (m) { return onOk(m); } }] });
  }

  /* ── Rôle « Comptable », nouvelles pages et menus ─────────────────────── */
  var NEW_PAGES = { admin: ['compta', 'validations'], chef: ['validations'], comptable: ['dashboard', 'caisse', 'factures', 'depenses', 'fournisseurs', 'rapports', 'stats', 'compta', 'validations'] };
  function integrateRoles() {
    try {
      if (typeof ROLES !== 'undefined') {
        Object.keys(NEW_PAGES).forEach(function (r) {
          if (!ROLES[r]) ROLES[r] = { label: 'Comptable', pages: [] };
          NEW_PAGES[r].forEach(function (p) { if (ROLES[r].pages.indexOf(p) === -1) ROLES[r].pages.push(p); });
        });
      }
      if (typeof ROLE_LABELS !== 'undefined') ROLE_LABELS.comptable = ROLE_LABELS.comptable || 'Comptable';
      if (typeof ROLE_COLORS !== 'undefined') ROLE_COLORS.comptable = ROLE_COLORS.comptable || 'var(--purple)';
      if (typeof ROLES_DEFAULT !== 'undefined') {
        Object.keys(NEW_PAGES).forEach(function (r) {
          if (!ROLES_DEFAULT[r]) ROLES_DEFAULT[r] = { label: 'Comptable', pages: [] };
          var arr = ROLES_DEFAULT[r].pages || (ROLES_DEFAULT[r].pages = []);
          NEW_PAGES[r].forEach(function (p) { if (arr.indexOf(p) === -1) arr.push(p); });
        });
      }
    } catch (e) { console.warn('[Finance] rôles', e); }
    /* option « Comptable » dans le formulaire utilisateurs */
    qsa('#usr-f-role').forEach(function (sel) { if (!sel.querySelector('option[value="comptable"]')) { var o = document.createElement('option'); o.value = 'comptable'; o.textContent = '📒 Comptable'; sel.insertBefore(o, sel.querySelector('option[value="custom"]')); } });
  }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /* Les menus existants masquent/affichent selon session.pages : on y ajoute nos pages avant */
  function wrapApplyRoleAccess() {
    var orig = window.applyRoleAccess;
    if (typeof orig !== 'function' || orig._fin) return;
    window.applyRoleAccess = function () {
      try {
        var s = sess(), add = NEW_PAGES[s.role] || [];
        if (s.pages && add.length) add.forEach(function (p) { if (s.pages.indexOf(p) === -1 && s.role !== 'custom') s.pages.push(p); });
      } catch (x) {}
      return orig.apply(this, arguments);
    };
    window.applyRoleAccess._fin = true;
  }

  function injectPagesAndNav() {
    var content = document.querySelector('.page-content');
    if (content) {
      [['validations', 'Validations'], ['compta', 'Comptabilité']].forEach(function (p) {
        if (!document.getElementById('page-' + p[0])) {
          var d = document.createElement('div'); d.className = 'page'; d.id = 'page-' + p[0];
          d.innerHTML = '<div class="page-header"><div class="page-title">' + (p[0] === 'compta' ? '📒 Compta<span>bilité</span>' : '✅ <span>Validations</span>') + '</div><div class="page-actions" id="' + p[0] + '-actions"></div></div><div id="' + p[0] + '-root"></div>';
          content.appendChild(d);
        }
      });
    }
    var anchor = document.getElementById('nav-caisse');
    if (anchor && !document.getElementById('nav-validations')) {
      var v = document.createElement('div'); v.className = 'nav-item'; v.id = 'nav-validations'; v.setAttribute('onclick', "showPage('validations')");
      v.innerHTML = '<span class="nav-icon">✅</span> Validations <span class="nav-badge red" id="badge-validations" style="display:none">0</span>';
      var c = document.createElement('div'); c.className = 'nav-item'; c.id = 'nav-compta'; c.setAttribute('onclick', "showPage('compta')");
      c.innerHTML = '<span class="nav-icon">📒</span> Comptabilité';
      anchor.parentNode.insertBefore(v, anchor.nextSibling);
      v.parentNode.insertBefore(c, v.nextSibling);
    }
  }

  /* showPage : affichage des nouvelles pages */
  var pageRenderers = {};
  function onPage(name, fn) { pageRenderers[name] = fn; }
  function wrapShowPage() {
    var orig = window.showPage;
    if (typeof orig !== 'function' || orig._fin) return;
    window.showPage = function (name) {
      var r = orig.apply(this, arguments);
      if (pageRenderers[name]) { try { pageRenderers[name](); } catch (e) { console.warn('[Finance] page ' + name, e); } }
      return r;
    };
    window.showPage._fin = true;
  }

  function init() {
    integrateRoles(); injectPagesAndNav(); wrapApplyRoleAccess(); wrapShowPage();
  }
  document.addEventListener('DOMContentLoaded', function () { init(); setTimeout(init, 1500); });
  window.addEventListener('gp-config-changed', function () { try { window.dispatchEvent(new Event('fin-data-changed')); } catch (x) {} });

  window.FIN = {
    coll: COLL, save: save, load: load, esc: esc, fmt: fmt, today: today, nowISO: nowISO, rnd: rnd, round2: round2, toast: toastMsg, qsa: qsa,
    who: who, sameUser: sameUser, hab: hab, saveHab: saveHab, defaultHab: defaultHab, RIGHTS: RIGHTS, ROLE_LIST: ROLE_LIST,
    can: can, plafond: plafond, canDecide: canDecide, numBon: numBon, modal: modal, ask: ask, onPage: onPage, sess: sess
  };
})();
