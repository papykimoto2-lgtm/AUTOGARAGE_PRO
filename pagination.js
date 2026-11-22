/* AutoGarage Pro — pagination des listes (tableaux, grilles de cartes, colonnes du tableau d'interventions).
   S'applique automatiquement après chaque affichage d'une liste : aucun module n'a besoin d'être modifié.
   - Tableaux : pages de 10 / 25 / 50 / 100 lignes ou « Tout » (les lignes de détail restent avec leur ligne).
   - Grilles (véhicules, stock) : pages de 12 / 24 / 48 / 96 cartes ou « Tout ».
   - Colonnes d'interventions : « Afficher plus » par paquets de 20.
   Les filtres et la recherche ramènent à la page 1 ; la page courante est conservée quand la liste est rafraîchie. */
(function () {
  'use strict';

  var CFG = {
    table: { sizes: [10, 25, 50, 100, 0], def: 25, min: 10, key: 'gp_pg_table' },
    grid:  { sizes: [12, 24, 48, 96, 0], def: 24, min: 12, key: 'gp_pg_grid' }
  };
  var MORE_STEP = 20, MORE_MIN = 30;
  var HIDE = 'pg-hide';

  var state = new WeakMap();     /* conteneur → { page, size, shown, pager } */
  var seen = [];                 /* conteneurs connus (pour remettre à la page 1) */

  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function getSize(kind) {
    var c = CFG[kind], v = null; try { v = parseInt(localStorage.getItem(c.key), 10); } catch (x) {}
    return (v === 0 || c.sizes.indexOf(v) !== -1) && !isNaN(v) ? v : c.def;
  }
  function setSize(kind, v) { try { localStorage.setItem(CFG[kind].key, String(v)); } catch (x) {} }

  /* ── Éléments à paginer ───────────────────────────────────────────────── */
  function tableItems(table) {
    var rows = qsa(':scope > tbody > tr', table);
    var items = [];
    rows.forEach(function (tr) {
      var tds = qsa(':scope > td, :scope > th', tr);
      var detail = items.length && tds.length === 1 && (tds[0].colSpan || 1) >= 3;     /* ligne de détail rattachée à la précédente */
      if (detail) items[items.length - 1].push(tr); else items.push([tr]);
    });
    return items;
  }
  function childItems(el) { return qsa(':scope > *', el).filter(function (c) { return !c.classList.contains('pgr'); }).map(function (c) { return [c]; }); }

  function targets() {
    var page = document.querySelector('.page.active');
    if (!page) return [];
    var out = [];
    qsa('table', page).forEach(function (t) {
      if (t.closest('.modal-overlay, #aide-modal, #inst-modal, .no-pg') || t.id === 'dash-or-table') return;
      out.push({ el: t, kind: 'table', mode: 'pages', items: tableItems });
    });
    ['vehicles-grid', 'stock-grid'].forEach(function (id) {
      var g = document.getElementById(id);
      if (g && page.contains(g)) out.push({ el: g, kind: 'grid', mode: 'pages', items: childItems });
    });
    qsa('.kanban-cards', page).forEach(function (k) { out.push({ el: k, kind: 'kanban', mode: 'more', items: childItems }); });
    return out;
  }

  /* ── Application ──────────────────────────────────────────────────────── */
  function show(items, from, to) {
    items.forEach(function (grp, i) {
      var vis = i >= from && i < to;
      grp.forEach(function (n) { n.classList.toggle(HIDE, !vis); });
    });
  }
  function clear(items) { items.forEach(function (grp) { grp.forEach(function (n) { n.classList.remove(HIDE); }); }); }

  function pagerHost(t) { return t.kind === 'table' ? (t.el.closest('.table-wrap') || t.el) : t.el; }

  function removePager(st) { if (st && st.pager && st.pager.parentNode) st.pager.parentNode.removeChild(st.pager); if (st) st.pager = null; }

  function apply(t) {
    var st = state.get(t.el);
    if (!st) { st = { page: 1, size: null, shown: MORE_STEP, pager: null }; state.set(t.el, st); seen.push(t.el); }
    var items = t.items(t.el), n = items.length;

    if (t.mode === 'more') {
      if (n <= MORE_MIN) { clear(items); removePager(st); return; }
      if (st.shown > n) st.shown = n;
      show(items, 0, Math.max(st.shown, MORE_STEP));
      drawMore(t, st, n);
      return;
    }

    var cfg = CFG[t.kind], size = getSize(t.kind);
    if (n <= cfg.min) { clear(items); removePager(st); return; }
    var pages = size === 0 ? 1 : Math.max(1, Math.ceil(n / size));
    if (st.page > pages) st.page = pages;
    if (st.page < 1) st.page = 1;
    var from = size === 0 ? 0 : (st.page - 1) * size, to = size === 0 ? n : from + size;
    show(items, from, to);
    drawPager(t, st, n, size, pages, from, Math.min(to, n));
  }

  /* ── Barre de pagination ──────────────────────────────────────────────── */
  function mount(t, st, el) {
    var host = pagerHost(t);
    if (st.pager && st.pager.parentNode) st.pager.parentNode.replaceChild(el, st.pager);
    else if (host.parentNode) host.parentNode.insertBefore(el, host.nextSibling);
    st.pager = el;
  }

  function pageList(cur, total) {
    var set = {}, out = [], i;
    [1, total, cur - 1, cur, cur + 1].forEach(function (p) { if (p >= 1 && p <= total) set[p] = 1; });
    var nums = Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
    for (i = 0; i < nums.length; i++) { if (i && nums[i] - nums[i - 1] > 1) out.push('…'); out.push(nums[i]); }
    return out;
  }

  function drawPager(t, st, n, size, pages, from, to) {
    var el = document.createElement('div');
    el.className = 'pgr';
    var sizes = CFG[t.kind].sizes;
    var html = '<div class="pgr-info" aria-live="polite">' + (n ? (from + 1) + '–' + to + ' sur ' + n : '0') + '</div>';
    if (pages > 1) {
      html += '<nav class="pgr-nav" aria-label="Pagination"><button type="button" class="pgr-b" data-go="' + (st.page - 1) + '"' + (st.page === 1 ? ' disabled' : '') + ' aria-label="Page précédente">‹</button>';
      pageList(st.page, pages).forEach(function (p) {
        html += p === '…' ? '<span class="pgr-dots">…</span>'
          : '<button type="button" class="pgr-b' + (p === st.page ? ' on' : '') + '" data-go="' + p + '" aria-label="Page ' + p + '"' + (p === st.page ? ' aria-current="page"' : '') + '>' + p + '</button>';
      });
      html += '<button type="button" class="pgr-b" data-go="' + (st.page + 1) + '"' + (st.page === pages ? ' disabled' : '') + ' aria-label="Page suivante">›</button></nav>';
    }
    html += '<label class="pgr-size">Par page <select aria-label="Éléments par page">' + sizes.map(function (s) {
      return '<option value="' + s + '"' + (s === size ? ' selected' : '') + '>' + (s === 0 ? 'Tout' : s) + '</option>';
    }).join('') + '</select></label>';
    el.innerHTML = html;
    el.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-go]'); if (!b || b.disabled) return;
      st.page = parseInt(b.getAttribute('data-go'), 10); apply(t); topOf(t);
    });
    el.querySelector('select').addEventListener('change', function () {
      setSize(t.kind, parseInt(this.value, 10)); st.page = 1;
      targets().forEach(function (x) { if (x.kind === t.kind) { var s = state.get(x.el); if (s) s.page = 1; apply(x); } });
    });
    mount(t, st, el);
  }

  function drawMore(t, st, n) {
    var el = document.createElement('div');
    el.className = 'pgr pgr-more';
    var shown = Math.min(Math.max(st.shown, MORE_STEP), n), left = n - shown;
    el.innerHTML = '<div class="pgr-info">' + shown + ' sur ' + n + '</div>' +
      (left > 0 ? '<button type="button" class="pgr-b pgr-moreb">Afficher ' + Math.min(MORE_STEP, left) + ' de plus</button>' : '') +
      (shown > MORE_STEP ? '<button type="button" class="pgr-b" data-less="1">Réduire</button>' : '');
    el.addEventListener('click', function (ev) {
      if (ev.target.closest('.pgr-moreb')) { st.shown = shown + MORE_STEP; apply(t); }
      else if (ev.target.closest('[data-less]')) { st.shown = MORE_STEP; apply(t); }
    });
    mount(t, st, el);
  }

  function topOf(t) {
    var h = pagerHost(t);
    try { var r = h.getBoundingClientRect(); if (r.top < 0 || r.top > window.innerHeight * 0.6) h.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (x) {}
  }

  /* ── Déclenchement ────────────────────────────────────────────────────── */
  var timer = null, busy = false;
  function schedule() { if (timer) return; timer = setTimeout(function () { timer = null; run(); }, 80); }
  function run() {
    if (busy) return; busy = true;
    try { targets().forEach(apply); } catch (e) { console.warn('[Pagination]', e); }
    busy = false;
  }

  /* Un filtre ou une recherche ramène à la première page (avant que l'application ne réaffiche la liste) */
  function resetPages() { seen.forEach(function (el) { var s = state.get(el); if (s) { s.page = 1; s.shown = MORE_STEP; } }); }
  ['input', 'change'].forEach(function (evt) {
    document.addEventListener(evt, function (ev) {
      var e = ev.target;
      if (!e || !e.closest || e.closest('.pgr') || e.closest('.modal-overlay')) return;
      if (e.matches('input:not([type]), input[type="search"], input[type="text"], select')) resetPages();
    }, true);
  });

  var mo = new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      var m = muts[i];
      var onlyPager = true, nodes = Array.prototype.slice.call(m.addedNodes).concat(Array.prototype.slice.call(m.removedNodes));
      if (!nodes.length) continue;
      for (var j = 0; j < nodes.length; j++) { var n = nodes[j]; if (!(n.nodeType === 1 && n.classList && n.classList.contains('pgr'))) { onlyPager = false; break; } }
      if (!onlyPager) { schedule(); return; }
    }
  });

  document.addEventListener('DOMContentLoaded', function () {
    var root = document.getElementById('app') || document.body;
    mo.observe(root, { childList: true, subtree: true });
    schedule();
  });
  window._pgRefresh = run;
})();
