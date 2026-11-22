/* AutoGarage Pro — connexion cloud (Supabase Auth) et première synchronisation.
   - Un identifiant contenant « @ » ouvre une session Supabase : le rôle vient de la table `profiles`
     (vérifié côté serveur) et le jeton protège toutes les lectures/écritures (RLS).
   - Un identifiant sans « @ » reste la connexion locale hors ligne (données de cet appareil uniquement, pas de synchronisation).
   Dépend de : _SUPA_URL / _SUPA_KEY, ROLES, session, startApp, doLogin, doLogout, _syncFlush, _syncPull. */
(function () {
  'use strict';

  var LS_SESSION = 'gp_cloud_session';
  var NEW_URL = 'https://seppjannzatoduoperxn.supabase.co';

  function $(id) { return document.getElementById(id); }

  /* Mode démonstration : aucune donnée ne quitte l'appareil (synchronisation coupée, connexion cloud refusée) */
  var DEMO = false; try { DEMO = localStorage.getItem('gp_demo') === '1'; } catch (x) {}
  if (DEMO) {
    try { Object.defineProperty(navigator, 'onLine', { get: function () { return false; }, configurable: true }); } catch (x) {}
    window._cloudToken = function () { return null; };
  }
  function toastMsg(m, t) { if (typeof toast === 'function') toast(m, t || 'info'); }
  function conn() {
    return { url: (window._SUPA_URL || NEW_URL).replace(/\/$/, ''), key: window._SUPA_KEY || '' };
  }

  /* Les anciens réglages (ancien projet) ne doivent plus rediriger la synchronisation */
  try {
    var oldUrl = localStorage.getItem('gp_supa_url');
    if (oldUrl && oldUrl.indexOf('seppjannzatoduoperxn') === -1) {
      localStorage.removeItem('gp_supa_url');
      localStorage.removeItem('gp_supa_key');
      localStorage.removeItem('gp_sync_dirty_v19');
    }
    var oldKey = localStorage.getItem('gp_supa_key');
    if (oldKey && oldKey !== window._SUPA_KEY) localStorage.removeItem('gp_supa_key');
  } catch (x) {}

  /* ── XHR (le « fetch » est bloqué dans certains environnements) ───────── */
  function xhr(method, url, headers, body) {
    return new Promise(function (resolve, reject) {
      var r = new XMLHttpRequest();
      r.open(method, url, true);
      Object.keys(headers || {}).forEach(function (k) { r.setRequestHeader(k, headers[k]); });
      r.timeout = 20000;
      r.onload = function () {
        var data = null;
        try { data = r.responseText ? JSON.parse(r.responseText) : null; } catch (x) {}
        if (r.status >= 200 && r.status < 300) resolve(data);
        else { var e = new Error((data && (data.msg || data.error_description || data.message)) || ('HTTP ' + r.status)); e.status = r.status; e.code = data && (data.error_code || data.code); reject(e); }
      };
      r.onerror = function () { var e = new Error('network'); e.network = true; reject(e); };
      r.ontimeout = function () { var e = new Error('network'); e.network = true; reject(e); };
      r.send(body || null);
    });
  }

  /* ── Session cloud ────────────────────────────────────────────────────── */
  /* « Se souvenir de moi » coché : session durable (localStorage). Sinon : sessionStorage, effacée à la fermeture du navigateur. */
  function load() {
    try { var a = sessionStorage.getItem(LS_SESSION); if (a) return JSON.parse(a); } catch (x) {}
    try { return JSON.parse(localStorage.getItem(LS_SESSION)); } catch (x) { return null; }
  }
  function save(s) {
    try { localStorage.removeItem(LS_SESSION); } catch (x) {}
    try { sessionStorage.removeItem(LS_SESSION); } catch (x) {}
    if (!s) return;
    try { (s.remember ? localStorage : sessionStorage).setItem(LS_SESSION, JSON.stringify(s)); } catch (x) {}
  }

  window._cloudUid = function () { var s = load(); return s && s.user && s.user.id ? s.user.id : null; };
  if (!DEMO) window._cloudToken = function () { var s = load(); return s && s.access_token ? s.access_token : null; };

  var refreshing = null;
  window._cloudRefresh = function () {
    if (refreshing) return refreshing;
    var s = load();
    if (!s || !s.refresh_token) return Promise.reject(new Error('no session'));
    var c = conn();
    refreshing = xhr('POST', c.url + '/auth/v1/token?grant_type=refresh_token', { apikey: c.key, 'Content-Type': 'application/json' },
      JSON.stringify({ refresh_token: s.refresh_token })).then(function (d) {
      s.access_token = d.access_token; s.refresh_token = d.refresh_token;
      s.expires_at = Date.now() + (d.expires_in || 3600) * 1000; save(s);
      refreshing = null; return d.access_token;
    }, function (e) { refreshing = null; throw e; });
    return refreshing;
  };

  /* Renouvellement préventif toutes les 40 minutes */
  setInterval(function () { if (load()) window._cloudRefresh().catch(function () {}); }, 40 * 60 * 1000);

  function showLoginError(msg) {
    var el = $('login-error');
    if (el) { el.textContent = '❌ ' + msg; el.style.display = ''; }
    toastMsg(msg, 'error');
  }

  /* ── Connexion par e-mail ─────────────────────────────────────────────── */
  function cloudLogin(email, password, remember) {
    var c = conn();
    var btn = document.querySelector('#login-screen button[onclick*="doLogin"], #login-screen .login-btn');
    if (btn) { btn.disabled = true; btn.setAttribute('data-txt', btn.textContent); btn.textContent = 'Connexion…'; }
    function unlock() { if (btn) { btn.disabled = false; btn.textContent = btn.getAttribute('data-txt') || 'Se connecter →'; } }

    xhr('POST', c.url + '/auth/v1/token?grant_type=password', { apikey: c.key, 'Content-Type': 'application/json' },
      JSON.stringify({ email: email, password: password }))
      .then(function (d) {
        var s = { access_token: d.access_token, refresh_token: d.refresh_token, expires_at: Date.now() + (d.expires_in || 3600) * 1000,
                  user: { id: d.user && d.user.id, email: d.user && d.user.email }, remember: !!remember };
        save(s);
        return xhr('GET', c.url + '/rest/v1/profiles?id=eq.' + encodeURIComponent(s.user.id) + '&select=login,nom,role,pages,statut',
          { apikey: c.key, Authorization: 'Bearer ' + s.access_token, Accept: 'application/json' }).then(function (rows) {
          var p = rows && rows[0];
          if (!p || p.statut !== 'actif') { save(null); throw Object.assign(new Error('forbidden'), { forbidden: true }); }
          s.profile = p; save(s);          /* profil conservé pour la reconnexion automatique (même hors ligne) */
          return { s: s, p: p };
        });
      })
      .then(function (r) { unlock(); openSession(r.s, r.p); })
      .catch(function (e) {
        unlock();
        if (e.network) showLoginError('Cloud injoignable. Vérifiez la connexion, ou utilisez votre identifiant local (hors ligne).');
        else if (e.forbidden) showLoginError('Compte non autorisé ou désactivé. Contactez l\'administrateur.');
        else if (e.status === 400 || e.status === 401 || e.code === 'invalid_credentials') showLoginError('E-mail ou mot de passe incorrect');
        else if (e.status === 429) showLoginError('Trop de tentatives. Réessayez dans quelques minutes.');
        else showLoginError('Connexion impossible : ' + e.message);
      });
  }

  function openSession(s, p) {
    var role = ROLES[p.role] ? p.role : 'meca';
    var pages = p.role === 'custom' ? (p.pages || []) : ROLES[role].pages.slice();
    session = { user: p.nom || p.login, role: p.role === 'custom' ? 'custom' : role, login: p.login, pages: pages, cloud: true, uid: s.user.id };
    window._sessionStart = Date.now();
    var err = $('login-error'); if (err) err.style.display = 'none';
    var sec = (typeof _secLoad === 'function') ? _secLoad() : {};
    if (typeof secApplyLockTimer === 'function') secApplyLockTimer(sec);
    if (typeof startApp === 'function') startApp();
    setTimeout(function () { initialSync(s.user.id); }, 800);
  }

  /* Connexion : cycle complet (réception fusionnée puis envoi des lignes modifiées) */
  function initialSync() {
    if (typeof window._syncFull === 'function') window._syncFull({ login: true });
  }

  /* ── Accès aux tableaux de données (lecture et écriture) ───────────────── */
  /* Les `const`/`let` globaux ne sont pas des propriétés de window : on les atteint par leur nom. */
  var GLOBALS = {
    fournisseurs:    function () { return typeof DB_FOURNISSEURS !== 'undefined' ? DB_FOURNISSEURS : null; },
    depenses:        function () { return typeof DB_DEPENSES !== 'undefined' ? DB_DEPENSES : null; },
    entretien:       function () { return typeof DB_ENTRETIEN !== 'undefined' ? DB_ENTRETIEN : null; },
    vt:              function () { return typeof DB_VT !== 'undefined' ? DB_VT : null; },
    rdv:             function () { return typeof DB_RDV !== 'undefined' ? DB_RDV : null; },
    commandes:       function () { return typeof DB_COMMANDES !== 'undefined' ? DB_COMMANDES : null; },
    recettes:        function () { return typeof DB_RECETTES !== 'undefined' ? DB_RECETTES : null; },
    requisitions:    function () { return typeof DB_REQUISITIONS !== 'undefined' ? DB_REQUISITIONS : null; },
    depots:          function () { return typeof DB_DEPOTS !== 'undefined' ? DB_DEPOTS : null; },
    stock_depots:    function () { return typeof DB_STOCK_DEPOTS !== 'undefined' ? DB_STOCK_DEPOTS : null; },
    catalogue:       function () { return typeof DB_CATALOGUE !== 'undefined' ? DB_CATALOGUE : null; },
    sessions_caisse: function () { return typeof DB_SESSIONS_CAISSE !== 'undefined' ? DB_SESSIONS_CAISSE : null; },
    lignes_fact:     function () { return typeof DB_LIGNES_FACTURATION !== 'undefined' ? DB_LIGNES_FACTURATION : null; },
    factures_fourn:  function () { return typeof DB_FACTURES_FOURN !== 'undefined' ? DB_FACTURES_FOURN : null; },
    transferts:      function () { return typeof DB_TRANSFERTS !== 'undefined' ? DB_TRANSFERTS : null; },
    outillage:       function () { return typeof DB_OUTILLAGE !== 'undefined' ? DB_OUTILLAGE : null; },
    outillage_prets: function () { return typeof DB_OUTILLAGE_PRETS !== 'undefined' ? DB_OUTILLAGE_PRETS : null; },
    mvt_history:     function () { return typeof DB_MVT_HISTORY !== 'undefined' ? DB_MVT_HISTORY : null; }
  };
  /* Modules dont les tableaux sont dans une fermeture : on passe par leur stockage local */
  var LS_MODULES = { diagnostics: 'sf_diagnostics', flottes: 'sf_flottes', contrats_fl: 'sf_contrats_fl', carburant_fl: 'sf_carburant_fl', maint_prev: 'sf_maint_prev' };
  var MAIN = ['clients', 'vehicles', 'interventions', 'stock', 'factures', 'personnel', 'transactions'];
  var lsChanged = false;

  /* Modules ajoutés (caisse, comptabilité…) : ils déclarent leur tableau vivant et leur table à la synchronisation */
  var REGISTRY = {};
  window._gpRegisterModule = function (key, def) { REGISTRY[key] = def; };
  window._gpRegistered = function () { var o = {}; Object.keys(REGISTRY).forEach(function (k) { o[k] = REGISTRY[k].table; }); return o; };

  window._gpGetArray = function (key) {
    if (REGISTRY[key]) return REGISTRY[key].get();
    if (MAIN.indexOf(key) !== -1) return (typeof DB !== 'undefined' && Array.isArray(DB[key])) ? DB[key] : null;
    if (GLOBALS[key]) return GLOBALS[key]();
    if (LS_MODULES[key]) { try { var a = JSON.parse(localStorage.getItem(LS_MODULES[key])); return Array.isArray(a) ? a : []; } catch (x) { return []; } }
    return null;
  };
  window._gpSetArray = function (key, data) {
    if (REGISTRY[key]) {
      var live = REGISTRY[key].get(); if (!live) return false;
      var copy = data.slice(); live.length = 0; copy.forEach(function (r) { live.push(r); });
      if (typeof REGISTRY[key].afterSet === 'function') REGISTRY[key].afterSet();
      return true;
    }
    if (MAIN.indexOf(key) !== -1) { if (typeof DB !== 'undefined' && DB[key] !== undefined) DB[key] = data; return true; }
    if (GLOBALS[key]) { var a = GLOBALS[key](); if (a) { var cp = data.slice(); a.length = 0; cp.forEach(function (r) { a.push(r); }); return true; } return false; }
    if (LS_MODULES[key]) {
      try {
        var next = JSON.stringify(data);
        if (localStorage.getItem(LS_MODULES[key]) !== next) { localStorage.setItem(LS_MODULES[key], next); lsChanged = true; }
        return true;
      } catch (x) { return false; }
    }
    return false;
  };
  /* Les modules à stockage local relisent leurs données au chargement : un rechargement unique les met à jour */
  window._gpAfterPull = function (allowReload) {
    if (!lsChanged) return;
    lsChanged = false;
    if (!allowReload) { toastMsg('Mises à jour Flotte / Diagnostic reçues : rechargez la page pour les afficher', 'info'); return; }
    try { if (sessionStorage.getItem('gp_reload_after_pull')) return; sessionStorage.setItem('gp_reload_after_pull', '1'); } catch (x) {}
    toastMsg('Mise à jour des modules Flotte / Diagnostic…', 'info');
    setTimeout(function () { location.reload(); }, 1800);
  };

  /* ── Écran de connexion : afficher le mot de passe, se souvenir de moi ─── */
  var RK = 'gp_remember', RID = 'gp_remember_id';
  function lsGet(k) { try { return localStorage.getItem(k); } catch (x) { return null; } }
  function isRemember() { var c = $('login-remember'); return c ? c.checked : lsGet(RK) === '1'; }
  function rememberId(id) {
    try {
      if (isRemember()) { localStorage.setItem(RK, '1'); localStorage.setItem(RID, id); }
      else { localStorage.removeItem(RK); localStorage.removeItem(RID); }
    } catch (x) {}
  }

  function setupLoginUI() {
    var pw = $('login-pass'), user = $('login-user');
    if (!pw || !user || $('login-eye')) return;

    /* champ mot de passe + bouton œil */
    var w = document.createElement('div');
    w.className = 'login-pw';
    pw.parentNode.insertBefore(w, pw);
    w.appendChild(pw);
    var eye = document.createElement('button');
    eye.type = 'button'; eye.id = 'login-eye';
    eye.setAttribute('aria-label', 'Afficher le mot de passe'); eye.setAttribute('aria-pressed', 'false'); eye.title = 'Afficher le mot de passe';
    eye.textContent = '👁';
    eye.addEventListener('click', function () {
      var show = pw.type === 'password';
      pw.type = show ? 'text' : 'password';
      eye.textContent = show ? '🙈' : '👁';
      eye.setAttribute('aria-pressed', show ? 'true' : 'false');
      var lab = show ? 'Masquer le mot de passe' : 'Afficher le mot de passe';
      eye.setAttribute('aria-label', lab); eye.title = lab;
      pw.focus();
    });
    w.appendChild(eye);

    /* se souvenir de moi */
    var row = document.createElement('div');
    row.className = 'login-remember';
    row.innerHTML = '<label><input type="checkbox" id="login-remember"> <span>Se souvenir de moi</span></label>' +
                    '<div class="login-remember-hint">Garde votre session ouverte sur cet appareil. À cocher uniquement sur un appareil personnel.</div>';
    w.insertAdjacentElement('afterend', row);

    /* identifiant mémorisé */
    if (lsGet(RK) === '1') {
      $('login-remember').checked = true;
      var id = lsGet(RID);
      if (id && !user.value) { user.value = id; }
      if (id) { try { pw.focus(); } catch (x) {} }
    }

    /* un mot de passe masqué après une erreur ou une déconnexion */
    pw.type = 'password';
  }

  /* ── Reconnexion automatique (session mémorisée) ──────────────────────── */
  function resumeStatus(txt) {
    var t = $('login-resume');
    if (!txt) { if (t) t.remove(); return; }
    if (!t) {
      t = document.createElement('div'); t.id = 'login-resume'; t.setAttribute('role', 'status');
      var box = document.querySelector('#login-screen .login-box'); if (!box) return;
      var tag = box.querySelector('.login-tagline'); if (tag) tag.insertAdjacentElement('afterend', t); else box.insertBefore(t, box.firstChild);
    }
    t.textContent = txt;
  }

  function autoResume() {
    if (DEMO) return;
    var s = load();
    if (!s || !s.remember || !s.profile || !s.refresh_token) return;
    var app = $('app'); if (app && app.classList.contains('show')) return;
    resumeStatus('🔐 Reconnexion automatique…');
    function go(p, offline) {
      resumeStatus('');
      openSession(s, p);
      if (offline) toastMsg('Hors ligne : session locale rouverte, synchronisation à la reconnexion', 'info');
    }
    if (navigator.onLine === false) { go(s.profile, true); return; }
    var c = conn();
    window._cloudRefresh().then(function () {
      var cur = load();
      return xhr('GET', c.url + '/rest/v1/profiles?id=eq.' + encodeURIComponent(s.user.id) + '&select=login,nom,role,pages,statut',
        { apikey: c.key, Authorization: 'Bearer ' + (cur && cur.access_token), Accept: 'application/json' });
    }).then(function (rows) {
      var p = rows && rows[0];
      if (!p || p.statut !== 'actif') { save(null); resumeStatus(''); showLoginError('Compte désactivé ou introuvable. Reconnectez-vous.'); return; }
      var cur = load() || s; cur.profile = p; save(cur);
      go(p, false);
    }).catch(function (e) {
      if (e && e.network) { go(s.profile, true); return; }       /* pas de réseau : on garde la session locale */
      save(null); resumeStatus('');                                /* session révoquée ou expirée : retour à l'écran de connexion */
    });
  }

  /* ── Branchement sur la connexion / déconnexion existantes ────────────── */
  function hook() {
    if (typeof window.doLogin === 'function' && !window.doLogin._cloud) {
      var origLogin = window.doLogin;
      window.doLogin = function () {
        var u = ($('login-user') && $('login-user').value || '').trim();
        var pw = $('login-pass') && $('login-pass').value || '';
        if (u.indexOf('@') !== -1) {
          if (DEMO) { showLoginError('Démonstration en cours : connexion cloud désactivée. Utilisez « demo » ou quittez la démonstration (demo.html).'); return; }
          if (!pw) { showLoginError('Identifiant et mot de passe obligatoires'); return; }
          rememberId(u.toLowerCase());
          cloudLogin(u.toLowerCase(), pw, isRemember());
          return;
        }
        rememberId(u);
        return origLogin.apply(this, arguments);
      };
      window.doLogin._cloud = true;
    }
    if (typeof window.doLogout === 'function' && !window.doLogout._cloud) {
      var origLogout = window.doLogout;
      window.doLogout = function () {
        var s = load(), c = conn();
        if (s && s.access_token) { try { xhr('POST', c.url + '/auth/v1/logout', { apikey: c.key, Authorization: 'Bearer ' + s.access_token }).catch(function () {}); } catch (x) {} }
        save(null);
        if (typeof window._syncStop === 'function') window._syncStop();
        return origLogout.apply(this, arguments);
      };
      window.doLogout._cloud = true;
    }
    setupLoginUI();
    var f = $('login-user');
    if (f) { f.placeholder = 'E-mail ou identifiant'; f.setAttribute('autocomplete', 'username'); }
    var lab = f && f.previousElementSibling;
    if (lab && /identifiant/i.test(lab.textContent)) lab.textContent = 'E-mail ou identifiant';
  }

  /* Le patch de connexion est défini par des scripts en ligne : on se branche après leur chargement */
  document.addEventListener('DOMContentLoaded', function () { hook(); setTimeout(hook, 1500); setTimeout(autoResume, 1000); });
})();
