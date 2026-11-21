/* AutoGarage Pro — module « Aujourd'hui » + recherche globale + installation (PWA)
   Dépend des globales de l'application : DB, DB_RDV, DB_VT, session, showPage, esc, toast. */
(function () {
  'use strict';

  var SNOOZE_KEY = 'gp_alert_snooze';
  var DAY = 86400000;

  function $(id) { return document.getElementById(id); }
  function e(s) { return typeof esc === 'function' ? esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function today() { return new Date().toISOString().slice(0, 10); }
  function daysBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / DAY); }
  function arr(x) { return Array.isArray(x) ? x : []; }
  function fmt(n) { return (Number(n) || 0).toLocaleString('fr-FR'); }

  /* ── Reports « Plus tard » ─────────────────────────────────────────── */
  function snoozes() { try { return JSON.parse(localStorage.getItem(SNOOZE_KEY)) || {}; } catch (x) { return {}; } }
  function snooze(id, hours) {
    var s = snoozes(); s[id] = Date.now() + hours * 3600000;
    Object.keys(s).forEach(function (k) { if (s[k] < Date.now()) delete s[k]; });
    try { localStorage.setItem(SNOOZE_KEY, JSON.stringify(s)); } catch (x) {}
    render();
  }
  window._ajSnooze = snooze;

  /* ── Calcul des alertes ────────────────────────────────────────────── */
  function computeAlerts() {
    var t = today(), out = [];
    var db = (typeof DB !== 'undefined') ? DB : {};

    arr(db.interventions).forEach(function (o) {
      var st = String(o.statut || '');
      if (st !== 'En attente' && st !== 'En cours') return;
      var due = o.date_remise;
      if (due && due < t) {
        var d = daysBetween(due, t);
        out.push({ id: 'or-late-' + o.id, level: 'red', page: 'interventions',
          title: (o.id || 'OR') + ' · ' + (o.client || 'Client'), sub: (o.plaque || '') + ' ' + (o.marque || ''),
          msg: 'Retard de ' + d + ' jour' + (d > 1 ? 's' : '') + ' sur la remise du véhicule' });
      } else if (st === 'En attente' && o.date && daysBetween(o.date, t) >= 3) {
        out.push({ id: 'or-wait-' + o.id, level: 'amber', page: 'interventions',
          title: (o.id || 'OR') + ' · ' + (o.client || 'Client'), sub: (o.plaque || '') + ' ' + (o.marque || ''),
          msg: 'En attente depuis ' + daysBetween(o.date, t) + ' jours, non démarrée' });
      }
    });

    arr(db.interventions).forEach(function (o) {
      if (o.statut !== 'Terminé') return;
      var billed = arr(db.factures).some(function (f) { return f.or_id === o.id; });
      if (billed) return;
      out.push({ id: 'or-bill-' + o.id, level: 'amber', page: 'factures', fact: o.id,
        title: (o.id || 'OR') + ' · ' + (o.client || 'Client'), sub: (o.plaque || '') + ' ' + (o.marque || ''),
        msg: 'Travaux terminés, aucune facture émise' + (o.montant ? ' (' + fmt(o.montant) + ' FCFA)' : '') });
    });

    arr(db.factures).forEach(function (f) {
      var st = String(f.statut || '');
      if (st !== 'En attente' && st !== 'Partiel') return;
      if (!f.date || daysBetween(f.date, t) < 15) return;
      var cl = arr(db.clients).find(function (c) { return c.id === f.client_id; });
      out.push({ id: 'fac-' + f.id, level: 'amber', page: 'factures',
        title: 'Facture ' + (f.id || '') + ' · ' + (cl ? cl.nom : 'Client'), sub: fmt(f.montant) + ' FCFA',
        msg: 'Impayée depuis ' + daysBetween(f.date, t) + ' jours (' + st.toLowerCase() + ')' });
    });

    arr(db.stock).forEach(function (p) {
      if (p.min != null && Number(p.qty) <= Number(p.min)) {
        out.push({ id: 'stk-' + p.id, level: Number(p.qty) === 0 ? 'red' : 'amber', page: 'stock',
          title: (p.ref || '') + ' · ' + (p.nom || 'Pièce'), sub: 'Stock : ' + (Number(p.qty) || 0) + ' / seuil ' + p.min,
          msg: Number(p.qty) === 0 ? 'Rupture de stock' : 'Stock sous le seuil d\'alerte' });
      }
    });

    if (typeof DB_VT !== 'undefined') {
      arr(DB_VT).forEach(function (v) {
        if (!v.dateExpiration) return;
        var left = daysBetween(t, v.dateExpiration);
        if (left <= 30) {
          out.push({ id: 'vt-' + v.id, level: left < 0 ? 'red' : 'amber', page: 'visite-tech',
            title: 'Visite technique · ' + (v.vehicle || ''), sub: v.client || '',
            msg: left < 0 ? 'Expirée depuis ' + (-left) + ' jour(s)' : 'Expire dans ' + left + ' jour(s)' });
        }
      });
    }

    if (typeof DB_RDV !== 'undefined') {
      arr(DB_RDV).forEach(function (r) {
        if (r.date === t && r.statut === 'attente') {
          out.push({ id: 'rdv-' + r.id, level: 'blue', page: 'agenda',
            title: 'RDV ' + (r.heure || '') + ' · ' + (r.client || ''), sub: r.vehicle || '',
            msg: r.label || r.type || 'Rendez-vous du jour' });
        }
      });
    }

    var sn = snoozes();
    var order = { red: 0, amber: 1, blue: 2 };
    return out.filter(function (a) { return !(sn[a.id] && sn[a.id] > Date.now()); })
              .sort(function (a, b) { return order[a.level] - order[b.level]; });
  }

  /* ── Rendu du bloc « Aujourd'hui » dans le tableau de bord ─────────── */
  function ensureBlock() {
    var block = $('aj-block');
    if (block) return block;
    var header = document.querySelector('#page-dashboard .page-header');
    if (!header) return null;
    block = document.createElement('section');
    block.id = 'aj-block';
    header.insertAdjacentElement('afterend', block);
    return block;
  }

  function render() {
    var block = ensureBlock();
    if (!block) return;
    var name = (typeof session !== 'undefined' && session && session.user) ? session.user : '';
    var h = new Date().getHours();
    var hello = h < 18 ? 'Bonjour' : 'Bonsoir';
    var alerts = computeAlerts();
    var shown = alerts.slice(0, 8);

    var html = '<div class="aj-head"><div><div class="aj-hello">' + hello + (name ? ' ' + e(name) : '') + '</div>' +
      '<div class="aj-sub">' + (alerts.length ? 'Voici ce qui demande votre attention maintenant.' : 'Rien d\'urgent pour le moment ✅') + '</div></div>' +
      '<div class="aj-quick">' +
      '<button class="btn btn-primary btn-sm" onclick="showPage(\'interventions\');openNewOR()">＋ Nouvelle intervention</button>' +
      '<button class="btn btn-secondary btn-sm" onclick="showPage(\'clients\')">👥 Clients</button>' +
      '<button class="btn btn-secondary btn-sm" onclick="showPage(\'factures\')">🧾 Factures</button>' +
      '<button class="btn btn-secondary btn-sm" onclick="_ajOpenSearch()">🔍 Rechercher <kbd>/</kbd></button>' +
      '</div></div>';

    if (alerts.length) {
      html += '<div class="aj-title">Alertes <span class="aj-badge">' + alerts.length + '</span></div><div class="aj-list">';
      shown.forEach(function (a) {
        html += '<div class="aj-card aj-' + a.level + '"><div class="aj-card-main"><div class="aj-card-title">' + e(a.title) +
          (a.sub ? ' <span class="aj-card-sub">' + e(a.sub) + '</span>' : '') + '</div><div class="aj-card-msg">' + e(a.msg) + '</div></div>' +
          '<div class="aj-card-actions">' +
          (a.fact ? '<button class="btn btn-primary btn-sm" data-aj-fact="' + e(a.fact) + '">🧾 Facturer</button>'
            : '<button class="btn btn-primary btn-sm" data-aj-page="' + e(a.page) + '">Ouvrir</button>') +
          '<button class="btn btn-secondary btn-sm" data-aj-snooze="' + e(a.id) + '" data-h="2">⏰ 2 h</button>' +
          '<button class="btn btn-secondary btn-sm" data-aj-snooze="' + e(a.id) + '" data-h="24">⏰ Demain</button>' +
          '</div></div>';
      });
      if (alerts.length > shown.length) html += '<div class="aj-more">+ ' + (alerts.length - shown.length) + ' autre(s) alerte(s)</div>';
      html += '</div>';
    }
    block.innerHTML = html;
  }

  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('[data-aj-page],[data-aj-snooze],[data-aj-fact]');
    if (!b) return;
    if (b.hasAttribute('data-aj-fact')) { billOR(b.getAttribute('data-aj-fact')); }
    else if (b.hasAttribute('data-aj-page')) { showPage(b.getAttribute('data-aj-page')); }
    else { snooze(b.getAttribute('data-aj-snooze'), Number(b.getAttribute('data-h')) || 2); }
  });

  /* ── Facturer un OR terminé : ouvre la facture pré-remplie ─────────── */
  function billOR(orId) {
    showPage('factures');
    if (typeof openNewFactureModal !== 'function') return;
    openNewFactureModal();
    var sel = $('f-or');
    if (sel) { sel.value = orId; if (typeof onORSelected === 'function') onORSelected(orId); }
  }

  /* ── Couleur du thème (comme Angel's) ──────────────────────────────── */
  var THEMES = [
    { n: 'Orange', a: '#f97316', b: '#fb923c', g: 'rgba(249,115,22,0.3)', h: null },
    { n: 'Bleu', a: '#3b82f6', b: '#60a5fa', g: 'rgba(59,130,246,0.3)', h: 215 },
    { n: 'Vert', a: '#22c55e', b: '#4ade80', g: 'rgba(34,197,94,0.3)', h: 152 },
    { n: 'Violet', a: '#a855f7', b: '#c084fc', g: 'rgba(168,85,247,0.3)', h: 268 },
    { n: 'Rouge', a: '#ef4444', b: '#f87171', g: 'rgba(239,68,68,0.3)', h: 352 },
    { n: 'Turquoise', a: '#14b8a6', b: '#2dd4bf', g: 'rgba(20,184,166,0.3)', h: 182 }
  ];
  /* Version « jour » : accents plus foncés pour rester lisibles sur fond clair */
  var DARK_ACCENT = ['#b83c0a', '#1d4ed8', '#15803d', '#7e22ce', '#b91c1c', '#0f766e'];

  var MODE_KEY = 'gp_mode';                 /* 'dark' (nuit, défaut) | 'light' (jour) | 'auto' (suit l'appareil) */
  function getMode() { var m = null; try { m = localStorage.getItem(MODE_KEY); } catch (x) {} return (m === 'light' || m === 'auto') ? m : 'dark'; }
  function systemLight() { try { return !!(window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches); } catch (x) { return false; } }
  function isLight() { var m = getMode(); return m === 'light' || (m === 'auto' && systemLight()); }
  function themeIdx() { var i = 0; try { i = Number(localStorage.getItem('gp_theme_idx')) || 0; } catch (x) {} return THEMES[i] ? i : 0; }

  /* Calcule et applique toutes les variables : couleur d'accent × jour/nuit */
  function applyPalette() {
    var i = themeIdx(), t = THEMES[i], r = document.documentElement.style, light = isLight();
    var root = document.documentElement;
    root.setAttribute('data-ui', light ? 'light' : 'dark');

    var all = ['--bg-deep', '--bg-base', '--bg-card', '--bg-card2', '--bg-hover', '--border', '--border-bright',
               '--text-main', '--text-sub', '--text-dim', '--shadow', '--shadow-card',
               '--green', '--red', '--yellow', '--blue', '--purple'];
    all.forEach(function (k) { r.removeProperty(k); });

    var acc = light ? DARK_ACCENT[i] : t.a;
    r.setProperty('--accent', acc); r.setProperty('--accent2', light ? t.a : t.b); r.setProperty('--accent-glow', light ? t.g.replace('0.3', '0.18') : t.g);

    if (light) {
      var H = t.h == null ? 30 : t.h, S = t.h == null ? 18 : 28;
      r.setProperty('--bg-deep', 'hsl(' + H + ',' + S + '%,94%)');
      r.setProperty('--bg-base', 'hsl(' + H + ',' + S + '%,97%)');
      r.setProperty('--bg-card', '#ffffff');
      r.setProperty('--bg-card2', 'hsl(' + H + ',' + S + '%,95%)');
      r.setProperty('--bg-hover', 'hsl(' + H + ',' + (S + 6) + '%,90%)');
      r.setProperty('--border', 'rgba(15,23,42,0.10)');
      r.setProperty('--border-bright', 'rgba(15,23,42,0.20)');
      r.setProperty('--text-main', '#0f172a');
      r.setProperty('--text-sub', '#475569');
      r.setProperty('--text-dim', '#556274');
      r.setProperty('--shadow', '0 8px 28px rgba(15,23,42,0.14)');
      r.setProperty('--shadow-card', '0 2px 10px rgba(15,23,42,0.08)');
      r.setProperty('--green', '#166534'); r.setProperty('--red', '#b91c1c'); r.setProperty('--yellow', '#92400e');
      r.setProperty('--blue', '#1d4ed8'); r.setProperty('--purple', '#7e22ce');
    } else if (t.h != null) {
      var D = t.h;
      r.setProperty('--bg-deep', 'hsl(' + D + ',45%,5%)');
      r.setProperty('--bg-base', 'hsl(' + D + ',42%,7%)');
      r.setProperty('--bg-card', 'hsl(' + D + ',38%,10%)');
      r.setProperty('--bg-card2', 'hsl(' + D + ',34%,13%)');
      r.setProperty('--bg-hover', 'hsl(' + D + ',32%,19%)');
      r.setProperty('--border', 'hsla(' + D + ',60%,90%,0.09)');
      r.setProperty('--border-bright', 'hsla(' + D + ',60%,90%,0.18)');
    }

    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', light ? '#ffffff' : (t.h == null ? '#0a0f1e' : 'hsl(' + t.h + ',42%,7%)'));
    var cs = document.querySelector('meta[name="color-scheme"]'); if (cs) cs.setAttribute('content', light ? 'light' : 'dark');

    var dots = document.querySelectorAll('.aj-dot');
    for (var k = 0; k < dots.length; k++) dots[k].classList.toggle('on', k === i);
    var seg = document.querySelectorAll('.aj-mode-btn'), mode = getMode();
    for (var s = 0; s < seg.length; s++) seg[s].classList.toggle('on', seg[s].getAttribute('data-mode') === mode);
    var q = $('mode-btn'); if (q) { q.textContent = light ? '🌙' : '☀️'; q.title = light ? 'Passer en mode nuit' : 'Passer en mode jour'; q.setAttribute('aria-label', q.title); }
  }

  function applyTheme(i) { try { localStorage.setItem('gp_theme_idx', String(i)); } catch (x) {} applyPalette(); }
  function setMode(m) { try { localStorage.setItem(MODE_KEY, m); } catch (x) {} applyPalette(); }
  window._ajSetMode = setMode;
  window._ajIsLight = isLight;

  /* mode « auto » : suit le réglage de l'appareil en temps réel */
  try {
    var mq = window.matchMedia('(prefers-color-scheme: light)');
    var onSys = function () { if (getMode() === 'auto') applyPalette(); };
    if (mq.addEventListener) mq.addEventListener('change', onSys); else if (mq.addListener) mq.addListener(onSys);
  } catch (x) {}

  applyPalette();                           /* le plus tôt possible : évite un flash de la mauvaise palette */

  /* ── Recherche globale (touche « / » ou Ctrl+K) ───────────────────── */
  function norm(s) { return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

  function search(q) {
    var n = norm(q), res = [];
    if (n.length < 2) return res;
    var db = (typeof DB !== 'undefined') ? DB : {};
    function has() { for (var i = 0; i < arguments.length; i++) if (norm(arguments[i]).indexOf(n) !== -1) return true; return false; }
    arr(db.clients).forEach(function (c) { if (has(c.nom, c.tel, c.wa, c.email, c.ncc)) res.push({ g: 'Clients', t: c.nom, s: c.tel || c.email || '', page: 'clients' }); });
    arr(db.vehicles).forEach(function (v) { if (has(v.plaque, v.marque, v.modele, v.vin)) res.push({ g: 'Véhicules', t: (v.plaque || '') + ' — ' + (v.marque || '') + ' ' + (v.modele || ''), s: '', page: 'vehicles' }); });
    arr(db.interventions).forEach(function (o) { if (has(o.id, o.plaque, o.client, o.description)) res.push({ g: 'Interventions', t: (o.id || '') + ' · ' + (o.client || ''), s: (o.plaque || '') + ' · ' + (o.statut || ''), page: 'interventions' }); });
    arr(db.factures).forEach(function (f) { if (has(f.id, f.or_id)) res.push({ g: 'Factures', t: 'Facture ' + f.id, s: fmt(f.montant) + ' FCFA · ' + (f.statut || ''), page: 'factures' }); });
    arr(db.stock).forEach(function (p) { if (has(p.ref, p.nom)) res.push({ g: 'Stock', t: (p.ref || '') + ' · ' + (p.nom || ''), s: 'Qté ' + (p.qty != null ? p.qty : '—'), page: 'stock' }); });
    return res.slice(0, 40);
  }

  function closeSearch() { var m = $('aj-search'); if (m) m.remove(); }

  function openSearch() {
    if (!$('app') || !$('app').classList.contains('show')) return; /* pas avant la connexion */
    if ($('aj-search')) { $('aj-q').focus(); return; }
    var m = document.createElement('div');
    m.id = 'aj-search';
    m.innerHTML = '<div class="aj-s-box" role="dialog" aria-label="Recherche"><input id="aj-q" type="search" autocomplete="off" placeholder="Client, plaque, n° d\'OR, facture, pièce…"><div id="aj-res" class="aj-s-res"><div class="aj-s-empty">Tapez au moins 2 caractères</div></div></div>';
    document.body.appendChild(m);
    m.addEventListener('click', function (ev) { if (ev.target === m) closeSearch(); });
    var input = $('aj-q'), box = $('aj-res'), results = [];
    input.focus();
    input.addEventListener('input', function () {
      results = search(input.value);
      if (!results.length) { box.innerHTML = '<div class="aj-s-empty">' + (input.value.length < 2 ? 'Tapez au moins 2 caractères' : 'Aucun résultat') + '</div>'; return; }
      var html = '', last = '';
      results.forEach(function (r, i) {
        if (r.g !== last) { html += '<div class="aj-s-group">' + e(r.g) + '</div>'; last = r.g; }
        html += '<div class="aj-s-item" data-i="' + i + '"><span>' + e(r.t) + '</span><small>' + e(r.s) + '</small></div>';
      });
      box.innerHTML = html;
    });
    box.addEventListener('click', function (ev) {
      var it = ev.target.closest('.aj-s-item'); if (!it) return;
      var r = results[Number(it.getAttribute('data-i'))]; closeSearch(); if (r) showPage(r.page);
    });
  }
  window._ajOpenSearch = openSearch;

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') { closeSearch(); return; }
    var tag = (ev.target && ev.target.tagName) || '';
    var typing = /INPUT|TEXTAREA|SELECT/.test(tag) || (ev.target && ev.target.isContentEditable);
    if ((ev.key === '/' && !typing && !ev.ctrlKey && !ev.metaKey) || ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k')) {
      ev.preventDefault(); openSearch();
    }
  });

  /* L'installation (PWA) est gérée par install.js ; ici seulement le bouton du menu. */

  /* Bouton rapide jour/nuit dans la barre du haut (visible aussi sur téléphone) */
  function addModeButton() {
    if ($('mode-btn')) return true;
    var bell = $('notif-btn'); if (!bell || !bell.parentNode) return false;
    var b = document.createElement('div');
    b.id = 'mode-btn'; b.className = 'topbar-notif'; b.setAttribute('role', 'button'); b.tabIndex = 0;
    var flip = function () { setMode(isLight() ? 'dark' : 'light'); };
    b.addEventListener('click', flip);
    b.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); flip(); } });
    bell.parentNode.insertBefore(b, bell);
    applyPalette();
    return true;
  }

  function addSidebarButtons() {
    var nav = document.querySelector('.sidebar-nav-wrap');
    if (!nav || $('aj-side')) return;
    var wrap = document.createElement('div');
    wrap.id = 'aj-side';
    wrap.innerHTML = '<button class="aj-side-btn" onclick="_ajOpenSearch()">🔍 Rechercher <kbd>/</kbd></button>' +
      '<button class="aj-side-btn" id="aj-install" onclick="window._instOpen && window._instOpen()">📲 Installer l\'application</button>' +
      '<div class="aj-mode" role="group" aria-label="Affichage jour / nuit">' +
        '<button class="aj-mode-btn" data-mode="dark" title="Nuit">🌙 Nuit</button>' +
        '<button class="aj-mode-btn" data-mode="light" title="Jour">☀️ Jour</button>' +
        '<button class="aj-mode-btn" data-mode="auto" title="Suit le réglage de l\'appareil">🌓 Auto</button></div>' +
      '<div class="aj-dots" aria-label="Couleur du thème">' + THEMES.map(function (t, i) {
        return '<button class="aj-dot" data-theme="' + i + '" title="' + t.n + '" style="background:' + t.a + '"></button>';
      }).join('') + '</div>';
    wrap.addEventListener('click', function (ev) {
      var d = ev.target.closest('[data-theme]'); if (d) { applyTheme(Number(d.getAttribute('data-theme'))); return; }
      var m = ev.target.closest('[data-mode]'); if (m) setMode(m.getAttribute('data-mode'));
    });
    nav.insertBefore(wrap, nav.firstChild);
    if (window._instIsInstalled && window._instIsInstalled()) $('aj-install').style.display = 'none';
    applyPalette();
  }

  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }

  /* ── Branchement sur la navigation existante ──────────────────────── */
  function hook() {
    addSidebarButtons();
    addModeButton();
    if (typeof window.showPage === 'function' && !window.showPage._ajWrapped) {
      var orig = window.showPage;
      window.showPage = function (name) {
        var r = orig.apply(this, arguments);
        if (name === 'dashboard') setTimeout(render, 0);
        return r;
      };
      window.showPage._ajWrapped = true;
    }
  }

  document.addEventListener('DOMContentLoaded', function () { setTimeout(function () { hook(); render(); }, 1200); });
  setInterval(function () { if ($('page-dashboard') && $('page-dashboard').classList.contains('active')) render(); }, 60000);
})();
