/* AutoGarage Pro — moteur de synchronisation (ligne par ligne).
   Remplace l'ancien moteur « tout renvoyer / tout remplacer » :
   - n'envoie que les lignes modifiées ; les suppressions sont propagées ;
   - la réception FUSIONNE (une ligne locale modifiée n'est pas écrasée, une ligne supprimée ailleurs est retirée) ;
   - pagination (le serveur plafonne à 1000 lignes par requête) ;
   - réception incrémentale (updated_at) quand la base est à jour ;
   - un identifiant déjà pris par un autre appareil n'écrase JAMAIS la ligne distante (copie conservée) ;
   - une modification faite pendant un envoi n'est jamais perdue (comparaison par empreinte, pas d'indicateur « sale »).
   Principe : pour chaque table on garde une « base » = empreinte de chaque ligne au dernier échange réussi.
   Dépend de : cloud.js (_cloudToken, _cloudRefresh, _cloudUid, _gpGetArray, _gpSetArray), _SYNC_TABLE_MAP, saveData. */
(function () {
  'use strict';

  var PAGE = 1000;               /* plafond serveur par requête */
  var PUSH_BATCH = 100, DEL_BATCH = 40, IN_BATCH = 50;
  var FULL_EVERY = 90 * 1000;    /* cycle complet automatique */
  var UNSHIFT_KEYS = { interventions: 1, factures: 1, transactions: 1, depenses: 1, commandes: 1, sessions_caisse: 1 };

  var DEMO = false; try { DEMO = localStorage.getItem('gp_demo') === '1'; } catch (x) {}

  function toastMsg(m, t) { if (typeof toast === 'function') toast(m, t || 'info'); }
  function badge(s) { if (typeof _syncSetBadge === 'function') { try { _syncSetBadge(s); } catch (x) {} } }

  /* ── Empreintes ───────────────────────────────────────────────────────── */
  function canon(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    var ks = Object.keys(v).filter(function (k) { return v[k] !== undefined; }).sort();
    return '{' + ks.map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
  }
  function h53(str) {                       /* cyrb53 */
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (var i = 0, ch; i < str.length; i++) {
      ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }
  function hashRow(row) { return h53(canon(row)); }

  /* Identifiant d'une ligne (certains tableaux n'ont pas de champ id) */
  function idOf(key, row) {
    if (!row || typeof row !== 'object') return null;
    if (key === 'stock_depots') return (row.depotId != null && row.pieceId != null) ? row.depotId + '|' + row.pieceId : null;
    if (key === 'catalogue') return row.pieceId != null ? String(row.pieceId) : (row.id != null ? String(row.id) : null);
    return (row.id !== undefined && row.id !== null && row.id !== '') ? String(row.id) : null;
  }

  /* ── Tables ───────────────────────────────────────────────────────────── */
  function tables() {
    var map = (typeof _SYNC_TABLE_MAP !== 'undefined') ? _SYNC_TABLE_MAP : {};
    var out = {};
    Object.keys(map).forEach(function (k) { out[k] = map[k].table; });
    out.config = 'config';
    return out;
  }

  /* « config » = une seule ligne : le paramétrage de l'entreprise */
  function getArray(key) {
    if (key === 'config') {
      try { var c = JSON.parse(localStorage.getItem('gp_parametrage') || 'null'); return c && typeof c === 'object' ? [Object.assign({ id: 'parametrage' }, c)] : []; } catch (x) { return []; }
    }
    return typeof window._gpGetArray === 'function' ? window._gpGetArray(key) : null;
  }
  function setArray(key, rows) {
    if (key === 'config') {
      var r = rows[0]; if (!r) return true;
      var c = Object.assign({}, r); delete c.id;
      try { localStorage.setItem('gp_parametrage', JSON.stringify(c)); return true; } catch (x) { return false; }
    }
    return typeof window._gpSetArray === 'function' ? window._gpSetArray(key, rows) : false;
  }

  /* ── État persistant (par compte) ─────────────────────────────────────── */
  var state = null, stateKey = null;
  function uid() { return typeof window._cloudUid === 'function' ? window._cloudUid() : null; }
  function loadState() {
    var u = uid(); if (!u) return null;
    var k = 'gp_sync_v2_' + u;
    if (state && stateKey === k) return state;
    stateKey = k;
    try { state = JSON.parse(localStorage.getItem(k)); } catch (x) { state = null; }
    if (!state || typeof state !== 'object') state = {};
    state.base = state.base || {}; state.ts = state.ts || {};
    return state;
  }
  function saveState() { if (state && stateKey) { try { localStorage.setItem(stateKey, JSON.stringify(state)); } catch (x) {} } }

  /* ── Conflits : la copie locale divergente est conservée, rien n'est perdu ─ */
  var CONF_KEY = 'gp_sync_conflicts';
  function addConflict(key, id, local, remote, why) {
    try {
      var list = JSON.parse(localStorage.getItem(CONF_KEY) || '[]');
      list.unshift({ date: new Date().toISOString(), table: key, id: id, motif: why, locale: local, cloud: remote });
      localStorage.setItem(CONF_KEY, JSON.stringify(list.slice(0, 200)));
    } catch (x) {}
    result.conflicts++;
  }
  window._syncConflicts = function () { try { return JSON.parse(localStorage.getItem(CONF_KEY) || '[]'); } catch (x) { return []; } };
  function saveConflicts(list) { try { localStorage.setItem(CONF_KEY, JSON.stringify(list)); } catch (x) {} chip(); }

  /* Bouton dans le menu quand il y a des conflits à examiner */
  function chip() {
    var n = window._syncConflicts().length, side = document.getElementById('aj-side'), b = document.getElementById('sync-conf-btn');
    if (!n) { if (b) b.remove(); return; }
    if (!side) return;
    if (!b) { b = document.createElement('button'); b.id = 'sync-conf-btn'; b.className = 'aj-side-btn'; b.addEventListener('click', function () { window._syncShowConflicts(); }); side.appendChild(b); }
    b.textContent = '⚠️ ' + n + ' conflit' + (n > 1 ? 's' : '') + ' de synchro';
  }

  function esc2(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function preview(o) { try { var s = JSON.stringify(o); return s.length > 140 ? s.slice(0, 140) + '…' : s; } catch (x) { return ''; } }

  window._syncShowConflicts = function () {
    var old = document.getElementById('sync-conf-modal'); if (old) old.remove();
    var list = window._syncConflicts();
    var m = document.createElement('div');
    m.id = 'sync-conf-modal';
    m.style.cssText = 'position:fixed;inset:0;z-index:10004;background:rgba(0,0,0,.65);display:flex;justify-content:center;align-items:flex-start;padding:5vh 12px 0;overflow-y:auto';
    m.innerHTML = '<div style="width:720px;max-width:100%;background:var(--bg-card);border:1px solid var(--border-bright);border-radius:14px;padding:18px 20px;margin-bottom:24px;color:var(--text-main)">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><strong style="font-size:16px">⚠️ Conflits de synchronisation</strong><button id="sc-x" class="btn btn-secondary btn-sm">✕</button></div>' +
      '<p style="font-size:12.5px;color:var(--text-sub);margin:8px 0 12px;line-height:1.5">Un même élément a été modifié ou créé en même temps sur deux appareils. Le <b>cloud a été conservé</b> et la <b>copie de cet appareil est gardée ci-dessous</b> : rien n\'est perdu. « Restaurer ma version » remplace la version du cloud par celle-ci.</p>' +
      (list.length ? list.map(function (c, i) {
        return '<div style="background:var(--bg-base);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:8px">' +
          '<div style="font-weight:700;font-size:13px">' + esc2(c.table) + ' · ' + esc2(c.id) + ' <span style="font-weight:400;color:var(--text-sub);font-size:11px">' + esc2(new Date(c.date).toLocaleString('fr-FR')) + '</span></div>' +
          '<div style="font-size:11.5px;color:var(--text-sub);margin:3px 0">' + esc2(c.motif) + '</div>' +
          '<div style="font-size:11px;font-family:var(--font-mono);color:var(--text-sub);word-break:break-all"><b>Ma version :</b> ' + esc2(preview(c.locale)) + '<br><b>Cloud :</b> ' + esc2(preview(c.cloud)) + '</div>' +
          '<div style="display:flex;gap:6px;margin-top:8px"><button class="btn btn-primary btn-sm" data-restore="' + i + '">Restaurer ma version</button><button class="btn btn-secondary btn-sm" data-drop="' + i + '">Ignorer</button></div></div>';
      }).join('') : '<p style="color:var(--text-sub)">Aucun conflit.</p>') +
      (list.length ? '<button id="sc-all" class="btn btn-secondary btn-sm">Tout ignorer</button>' : '') + '</div>';
    document.body.appendChild(m);
    var close = function () { m.remove(); };
    m.addEventListener('click', function (ev) {
      if (ev.target === m || ev.target.id === 'sc-x') return close();
      if (ev.target.id === 'sc-all') { saveConflicts([]); return close(); }
      var r = ev.target.getAttribute && ev.target.getAttribute('data-restore'), d = ev.target.getAttribute && ev.target.getAttribute('data-drop');
      var cur = window._syncConflicts();
      if (r !== null && r !== undefined) { restoreConflict(cur[Number(r)]); cur.splice(Number(r), 1); saveConflicts(cur); window._syncShowConflicts(); }
      else if (d !== null && d !== undefined) { cur.splice(Number(d), 1); saveConflicts(cur); window._syncShowConflicts(); }
    });
  };

  function restoreConflict(c) {
    if (!c) return;
    var arr = getArray(c.table); if (!arr) return;
    var i = arr.findIndex(function (x) { return idOf(c.table, x) === String(c.id); });
    if (i >= 0) arr[i] = c.locale; else arr.push(c.locale);
    setArray(c.table, arr);
    try { if (typeof saveData === 'function') saveData(); } catch (x) {}
    schedulePush();
    toastMsg('Version restaurée : elle sera envoyée au cloud', 'success');
  }

  /* ── Accès réseau (jeton + renouvellement + pagination) ───────────────── */
  function conn() { return { url: String(window._SUPA_URL || '').replace(/\/$/, ''), key: window._SUPA_KEY || '' }; }

  function http(method, path, body, prefer, retried, wantRange) {
    return new Promise(function (resolve, reject) {
      var c = conn(), tok = window._cloudToken && window._cloudToken();
      if (!tok) { var e0 = new Error('Non connecté'); e0.noAuth = true; return reject(e0); }
      var r = new XMLHttpRequest();
      r.open(method, c.url + '/rest/v1/' + path, true);
      r.setRequestHeader('apikey', c.key); r.setRequestHeader('Authorization', 'Bearer ' + tok);
      r.setRequestHeader('Content-Type', 'application/json'); r.setRequestHeader('Accept', 'application/json');
      if (prefer) r.setRequestHeader('Prefer', prefer);
      r.timeout = 40000;
      r.onload = function () {
        var data = null; try { data = r.responseText ? JSON.parse(r.responseText) : null; } catch (x) {}
        if (r.status >= 200 && r.status < 300) return resolve(wantRange ? { data: data, range: r.getResponseHeader('Content-Range') } : data);
        if (r.status === 401 && !retried && typeof window._cloudRefresh === 'function') {
          return window._cloudRefresh().then(function () { return http(method, path, body, prefer, true, wantRange); }).then(resolve, function () { var e1 = new Error('Session expirée'); e1.noAuth = true; reject(e1); });
        }
        var e = new Error((data && (data.message || data.hint)) || ('HTTP ' + r.status));
        e.status = r.status; e.code = data && data.code; reject(e);
      };
      r.onerror = r.ontimeout = function () { var e = new Error('network'); e.network = true; reject(e); };
      r.send(body ? JSON.stringify(body) : null);
    });
  }

  function getAll(table, query) {            /* toutes les pages */
    var out = [], off = 0;
    function next() {
      return http('GET', table + '?' + query + '&limit=' + PAGE + '&offset=' + off).then(function (rows) {
        rows = Array.isArray(rows) ? rows : [];
        Array.prototype.push.apply(out, rows);
        if (rows.length < PAGE) return out;
        off += PAGE; return next();
      });
    }
    return next();
  }

  /* Sonde légère : dernière modification + nombre de lignes distantes (une seule petite requête) */
  function probe(table) {
    return http('GET', table + '?select=updated_at&order=updated_at.desc&limit=1', null, 'count=exact', false, true).then(function (res) {
      var m = /\/(\d+)$/.exec(res.range || ''), row = res.data && res.data[0];
      return { count: m ? parseInt(m[1], 10) : null, last: row ? row.updated_at : null };
    });
  }

  function inList(ids) {                     /* id=in.("a","b") */
    return 'in.(' + ids.map(function (s) { return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }).join(',') + ')';
  }
  function chunks(arr, n) { var o = []; for (var i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; }
  function seq(items, fn) { return items.reduce(function (p, it) { return p.then(function () { return fn(it); }); }, Promise.resolve()); }

  /* ── Lecture locale ───────────────────────────────────────────────────── */
  function localMap(key, arr) {
    var map = {}, dups = 0, skipped = 0;
    arr.forEach(function (row) {
      var id = idOf(key, row);
      if (id === null) { skipped++; return; }
      if (map[id]) { dups++; return; }       /* doublon d'identifiant : la première occurrence fait foi */
      map[id] = { row: row, hash: hashRow(row) };
    });
    return { map: map, dups: dups, skipped: skipped };
  }

  var result = { pushed: 0, deleted: 0, added: 0, updated: 0, removed: 0, conflicts: 0, errors: [] };
  var readOnly = {};                         /* tables que ce rôle n'a pas le droit d'écrire */
  var configMissing = false;

  function noteError(key, e) {
    if (e && e.noAuth) return;
    if (key === 'config' && e && (e.status === 404 || e.code === 'PGRST205' || e.code === '42P01')) { configMissing = true; return; }
    if (e && (e.status === 403 || e.code === '42501')) {
      if (!readOnly[key]) { readOnly[key] = true; toastMsg('Droits insuffisants pour synchroniser « ' + key + ' » : vos modifications restent sur cet appareil', 'info'); }
      return;
    }
    result.errors.push(key + ' : ' + ((e && e.message) || 'erreur'));
  }

  /* ── Réception d'une table (fusion) ───────────────────────────────────── */
  function pullTable(key, table, opts) {
    var st = loadState(); if (!st) return Promise.resolve();
    var arr = getArray(key); if (!arr) return Promise.resolve();
    var base = st.base[key] || (st.base[key] = {});
    var hasBase = Object.keys(base).length > 0 && !!st.ts[key];

    function fetchRemote() {
      if (!hasBase) return getAll(table, 'select=id,data,updated_at&order=id').then(function (rows) { return { rows: rows, full: true }; });
      var since = st.ts[key];
      return Promise.all([
        getAll(table, 'select=id&order=id'),
        getAll(table, 'select=id,data,updated_at&updated_at=gte.' + encodeURIComponent(since) + '&order=updated_at,id')
      ]).then(function (res) {
        var ids = res[0], changed = res[1], seen = {};
        changed.forEach(function (r) { seen[r.id] = 1; });
        var unknown = ids.filter(function (r) { return !seen[r.id] && base[r.id] === undefined; });
        if (unknown.length) return getAll(table, 'select=id,data,updated_at&order=id').then(function (rows) { return { rows: rows, full: true }; });
        return { ids: ids, rows: changed, full: false };
      });
    }

    /* rien de nouveau côté cloud ? (même dernière modification, même nombre de lignes) → aucun téléchargement */
    var pre = hasBase ? probe(table).catch(function () { return null; }) : Promise.resolve(null);
    return pre.then(function (pb) {
      if (pb && pb.count !== null && pb.count === Object.keys(base).length && (!pb.last || pb.last <= st.ts[key]) && !opts.force) return null;
      return fetchRemote();
    }).then(function (rem) {
      if (!rem) return;
      var R = {}, maxTs = st.ts[key] || null;
      rem.rows.forEach(function (r) {
        R[r.id] = { data: r.data, hash: hashRow(r.data) };
        if (r.updated_at && (!maxTs || r.updated_at > maxTs)) maxTs = r.updated_at;
      });
      if (!rem.full) rem.ids.forEach(function (r) { if (!R[r.id] && base[r.id] !== undefined) R[r.id] = { hash: base[r.id], same: true }; });

      var seenLocal = {}, out = [], changes = 0, removedHere = 0;
      var removals = [];
      arr.forEach(function (row) {
        var id = idOf(key, row);
        if (id === null) { out.push(row); return; }
        if (seenLocal[id]) { out.push(row); return; }
        seenLocal[id] = 1;
        var lh = hashRow(row), b = base[id], r = R[id];
        if (!r) {
          if (b !== undefined) {
            if (lh === b) { removals.push(id); out.push(row); }       /* supprimée ailleurs, intacte ici → à retirer (sous garde) */
            else { delete base[id]; out.push(row); }                  /* modifiée ici : on la garde, elle sera renvoyée */
          } else out.push(row);                                       /* nouvelle ici */
          return;
        }
        if (b === undefined) {                                        /* jamais échangée : le cloud fait foi, copie locale conservée */
          if (lh === r.hash) { base[id] = lh; out.push(row); }
          else if (r.data) { addConflict(key, id, row, r.data, 'identifiant déjà présent sur le cloud'); base[id] = r.hash; out.push(r.data); changes++; result.updated++; }
          else out.push(row);
          return;
        }
        if (r.same || r.hash === b) { out.push(row); return; }       /* inchangée côté cloud */
        if (lh === b) { base[id] = r.hash; out.push(r.data); changes++; result.updated++; return; }   /* cloud plus récent, local intact */
        if (lh === r.hash) { base[id] = lh; out.push(row); return; }  /* même contenu des deux côtés */
        addConflict(key, id, row, r.data, 'modifiée des deux côtés : version de cet appareil gardée');
        base[id] = r.hash;                                            /* la version locale sera renvoyée */
        out.push(row);
      });

      /* suppressions venant d'un autre appareil : garde-fou contre les retraits massifs */
      if (removals.length) {
        var mass = removals.length > 20 && removals.length > arr.length * 0.5;
        if (mass) { toastMsg('Réception « ' + key + ' » : ' + removals.length + ' suppressions inhabituelles ignorées par sécurité', 'info'); removals.forEach(function (id) { delete base[id]; }); }
        else {
          var rm = {}; removals.forEach(function (id) { rm[id] = 1; });
          out = out.filter(function (row) { var id = idOf(key, row); return id === null || !rm[id]; });
          removals.forEach(function (id) { delete base[id]; });
          removedHere = removals.length; changes += removedHere; result.removed += removedHere;
        }
      }

      /* lignes nouvelles venues du cloud */
      var added = [];
      Object.keys(R).forEach(function (id) {
        if (seenLocal[id] || R[id].same) return;
        if (base[id] !== undefined) return;                           /* supprimée ici, suppression à envoyer */
        added.push(R[id].data); base[id] = R[id].hash; result.added++; changes++;
      });
      if (added.length) out = UNSHIFT_KEYS[key] ? added.concat(out) : out.concat(added);

      st.ts[key] = maxTs || st.ts[key] || null;
      if (rem.full && !st.ts[key]) st.ts[key] = '1970-01-01T00:00:00+00:00';
      if (changes) { setArray(key, out); opts.changedKeys[key] = 1; }
      saveState();
    });
  }

  /* ── Envoi d'une table ────────────────────────────────────────────────── */
  function pushTable(key, table, opts) {
    var st = loadState(); if (!st || readOnly[key]) return Promise.resolve();
    var arr = getArray(key); if (!arr) return Promise.resolve();
    var base = st.base[key] || (st.base[key] = {});
    var lm = localMap(key, arr);
    if (lm.skipped) console.warn('[Sync] ' + key + ' : ' + lm.skipped + ' ligne(s) sans identifiant ignorée(s)');

    var changed = [], fresh = [], deleted = [];
    Object.keys(lm.map).forEach(function (id) {
      if (base[id] !== lm.map[id].hash) { changed.push(id); if (base[id] === undefined) fresh.push(id); }
    });
    Object.keys(base).forEach(function (id) { if (!lm.map[id]) deleted.push(id); });
    if (!changed.length && !deleted.length) return Promise.resolve();

    var step = Promise.resolve();

    /* 1. identifiants nouveaux : jamais d'écrasement d'une ligne qui existe déjà au cloud */
    if (fresh.length) {
      step = step.then(function () {
        return seq(chunks(fresh, IN_BATCH), function (ids) {
          return http('GET', table + '?select=id,data&id=' + encodeURIComponent(inList(ids))).then(function (rows) {
            (rows || []).forEach(function (r) {
              var mine = lm.map[r.id]; if (!mine) return;
              var rh = hashRow(r.data);
              if (rh === mine.hash) { base[r.id] = rh; changed.splice(changed.indexOf(r.id), 1); return; }
              addConflict(key, r.id, mine.row, r.data, 'identifiant créé en même temps sur un autre appareil : version du cloud gardée');
              base[r.id] = rh; changed.splice(changed.indexOf(r.id), 1);
              var cur = getArray(key); if (cur) { var i = cur.findIndex(function (x) { return idOf(key, x) === r.id; }); if (i >= 0) { cur[i] = r.data; opts.changedKeys[key] = 1; } }
            });
          });
        });
      });
    }

    /* 2. lignes modifiées / nouvelles */
    step = step.then(function () {
      return seq(chunks(changed, PUSH_BATCH), function (ids) {
        var docs = ids.map(function (id) { return { id: id, data: lm.map[id].row }; });
        return http('POST', table + '?on_conflict=id', docs, 'resolution=merge-duplicates,return=minimal').then(function () {
          ids.forEach(function (id) { base[id] = lm.map[id].hash; }); result.pushed += ids.length; saveState();
        });
      });
    });

    /* 3. suppressions (garde-fou si une grosse part disparaît d'un coup) */
    step = step.then(function () {
      if (!deleted.length) return;
      var total = Object.keys(base).length;
      if (deleted.length > 20 && deleted.length > total * 0.5) {
        var ok = true;
        try { ok = window.confirm('Synchronisation : ' + deleted.length + ' éléments de « ' + key + ' » ont été supprimés sur cet appareil.\n\nLes supprimer aussi du cloud (pour tous les appareils) ?\n\nAnnuler = les conserver sur le cloud.'); } catch (x) {}
        if (!ok) { deleted.forEach(function (id) { delete base[id]; }); saveState(); return; }
      }
      return seq(chunks(deleted, DEL_BATCH), function (ids) {
        return http('DELETE', table + '?id=' + encodeURIComponent(inList(ids)), null, 'return=minimal').then(function () {
          ids.forEach(function (id) { delete base[id]; }); result.deleted += ids.length; saveState();
        });
      });
    });
    return step;
  }

  /* ── Cycle ────────────────────────────────────────────────────────────── */
  var queue = Promise.resolve(), pendingAgain = null;
  var lastFull = 0;

  function persistLocal(changedKeys) {
    if (!Object.keys(changedKeys).length) return;
    try { if (typeof saveData === 'function') saveData(); } catch (x) {}
    try { if (typeof _caisseLocalSave === 'function') _caisseLocalSave(); } catch (x) {}
    try { if (typeof window.fixInvoiceCounter === 'function') window.fixInvoiceCounter(); } catch (x) {}
    try {
      var active = document.querySelector('.page.active');
      if (active && typeof showPage === 'function') showPage(active.id.replace('page-', ''));
    } catch (x) {}
  }

  function run(opts) {
    opts = opts || {};
    return (queue = queue.then(function () { return runNow(opts); }, function () { return runNow(opts); }));
  }

  function runNow(opts) {
    if (DEMO || !window._cloudToken || !window._cloudToken() || !loadState()) { return Promise.resolve({ skipped: true }); }
    if (!navigator.onLine) { badge('offline'); return Promise.resolve({ offline: true }); }
    result = { pushed: 0, deleted: 0, added: 0, updated: 0, removed: 0, conflicts: 0, errors: [] };
    var map = tables(), keys = (opts.keys && opts.keys.length ? opts.keys : Object.keys(map)).filter(function (k) { return map[k] && !(k === 'config' && configMissing); });
    var o = { changedKeys: {} };
    badge('syncing');
    return seq(keys, function (k) {
      var p = Promise.resolve();
      if (opts.pull) p = p.then(function () { return pullTable(k, map[k], o); });
      if (opts.push !== false) p = p.then(function () { return pushTable(k, map[k], o); });
      return p.catch(function (e) { noteError(k, e); if (e && (e.noAuth || e.network)) throw e; });
    }).then(function () {
      persistLocal(o.changedKeys);
      if (opts.pull && typeof window._gpAfterPull === 'function') window._gpAfterPull(!!opts.allowReload);
      lastFull = opts.pull ? Date.now() : lastFull;
      try { localStorage.removeItem('gp_sync_dirty_v19'); } catch (x) {}
      if (result.errors.length) { badge('error'); if (!opts.silent) toastMsg('⚠️ Synchronisation : ' + result.errors[0].slice(0, 80), 'error'); }
      else { badge('synced'); if (typeof _syncUpdateLastSync === 'function') _syncUpdateLastSync(); }
      chip();
      if (result.conflicts) toastMsg('⚠️ ' + result.conflicts + ' conflit(s) de synchronisation : la copie de cet appareil est conservée (menu → ⚠️ conflits)', 'info');
      return result;
    }).catch(function (e) {
      persistLocal(o.changedKeys);
      badge(e && e.network ? 'offline' : 'error');
      return { error: e };
    });
  }

  /* ── Déclencheurs ─────────────────────────────────────────────────────── */
  var pushTimer = null;
  function schedulePush() {
    if (DEMO) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(function () { pushTimer = null; run({ pull: false, push: true, silent: true }); }, 3000);
  }

  /* Remplacement des fonctions de l'ancien moteur : mêmes noms, nouvelle logique (réaffirmé après les anciens correctifs) */
  function install() {
    window._syncFlush = function (cb) { if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; } run({ pull: false, push: true, silent: true }).then(function () { if (typeof cb === 'function') cb(); }); };
    window._syncPull = function (keys, cb) { if (typeof keys === 'function') { cb = keys; keys = null; } run({ pull: true, push: true, keys: keys, silent: false }).then(function () { if (typeof cb === 'function') cb(); }); };
    window.syncNow = function (cb) { run({ pull: true, push: true }).then(function (r) { toastMsg(r && r.skipped ? 'Synchronisation cloud indisponible : connectez-vous avec votre e-mail' : '☁️ Synchronisation terminée', r && r.skipped ? 'error' : 'success'); if (typeof cb === 'function') cb(); }); };
    window.syncPullNow = function () { window.syncNow(); };
    window._syncFull = function (o) { o = o || {}; return run({ pull: true, push: true, allowReload: !!o.login, silent: !o.login }); };
  }
  install();
  document.addEventListener('DOMContentLoaded', function () { setTimeout(install, 2500); });
  window._syncStop = function () { if (pushTimer) clearTimeout(pushTimer); pushTimer = null; state = null; stateKey = null; };
  window._syncDiagnostic = function () {
    var st = loadState() || { base: {}, ts: {} };
    var d = {}; Object.keys(tables()).forEach(function (k) { d[k] = { base: Object.keys(st.base[k] || {}).length, local: (getArray(k) || []).length, lectureSeule: !!readOnly[k] }; });
    return { derniere: result, tables: d, conflits: window._syncConflicts().length };
  };

  /* Les modules à stockage local (Flotte, Diagnostic…) écrivent directement dans localStorage */
  try {
    var origSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k) { var r = origSet.apply(this, arguments); try { if (this === window.localStorage && /^sf_/.test(k)) schedulePush(); } catch (x) {} return r; };
  } catch (x) {}

  /* Cycle complet périodique, au retour au premier plan et au retour du réseau */
  setInterval(function () { if (document.visibilityState === 'visible' && navigator.onLine) run({ pull: true, push: true, silent: true }); }, FULL_EVERY);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && Date.now() - lastFull > 30000) run({ pull: true, push: true, silent: true }); });
  window.addEventListener('online', function () { setTimeout(function () { run({ pull: true, push: true, silent: true }); }, 1200); });

  /* ── Numérotation des factures : jamais de doublon d'identifiant ───────── */
  /* Avant : le compteur repartait de 159 à chaque chargement de page → deux factures « F-0159 », la seconde écrasait la première au cloud. */
  window.fixInvoiceCounter = function () {
    try {
      if (typeof DB === 'undefined' || typeof fineCounter === 'undefined') return;
      var max = 0;
      DB.factures.forEach(function (f) {
        var m = /^(?:F-|FINE-\d{4}-)(\d+)$/.exec(String(f.id || ''));
        if (m) max = Math.max(max, parseInt(m[1], 10));
      });
      if (max + 1 > fineCounter) fineCounter = max + 1;
    } catch (x) {}
  };
  ['openNewFactureModal', 'saveFacture'].forEach(function (name) {
    var orig = window[name];
    if (typeof orig !== 'function' || orig._inv) return;
    window[name] = function () { window.fixInvoiceCounter(); return orig.apply(this, arguments); };
    window[name]._inv = true;
  });
  document.addEventListener('DOMContentLoaded', function () { setTimeout(window.fixInvoiceCounter, 1500); setTimeout(chip, 2500); });
})();
