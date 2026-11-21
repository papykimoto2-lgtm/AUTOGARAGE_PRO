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
          '<button class="btn btn-primary btn-sm" data-aj-page="' + e(a.page) + '">Ouvrir</button>' +
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
    var b = ev.target.closest && ev.target.closest('[data-aj-page],[data-aj-snooze]');
    if (!b) return;
    if (b.hasAttribute('data-aj-page')) { showPage(b.getAttribute('data-aj-page')); }
    else { snooze(b.getAttribute('data-aj-snooze'), Number(b.getAttribute('data-h')) || 2); }
  });

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

  /* ── Installation sur téléphone / ordinateur (PWA) ─────────────────── */
  var deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', function (ev) {
    ev.preventDefault(); deferredPrompt = ev;
    var b = $('aj-install'); if (b) b.style.display = '';
  });
  window.addEventListener('appinstalled', function () { var b = $('aj-install'); if (b) b.style.display = 'none'; deferredPrompt = null; });

  function addSidebarButtons() {
    var nav = document.querySelector('.sidebar-nav-wrap');
    if (!nav || $('aj-side')) return;
    var wrap = document.createElement('div');
    wrap.id = 'aj-side';
    wrap.innerHTML = '<button class="aj-side-btn" onclick="_ajOpenSearch()">🔍 Rechercher <kbd>/</kbd></button>' +
      '<button class="aj-side-btn" id="aj-install" style="display:none">📲 Installer l\'application</button>';
    nav.insertBefore(wrap, nav.firstChild);
    $('aj-install').addEventListener('click', function () {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function () { deferredPrompt = null; $('aj-install').style.display = 'none'; });
    });
    if (deferredPrompt) $('aj-install').style.display = '';
  }

  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }

  /* ── Branchement sur la navigation existante ──────────────────────── */
  function hook() {
    addSidebarButtons();
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
