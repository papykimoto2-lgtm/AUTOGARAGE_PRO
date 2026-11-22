/* AutoGarage Pro — moteur d'impression unifié.
   Tout document imprimable (factures, états, rapports, pièces de caisse…) reçoit :
   - l'entête de l'entreprise (logo + raison sociale + coordonnées + mentions légales) ;
   - en pied de document, un QR code de sécurité : numéro unique, empreinte SHA-256 du contenu imprimé,
     émetteur et date. Le document est enregistré dans le registre « documents_imprimes » (synchronisé) ;
     verif.html (page publique) confirme qu'il est authentique.
   Principe : on enveloppe getCompanyPrintHeader / getCompanyPrintFooter et window.open, donc les
   impressions existantes en bénéficient sans modification. Dépend de qr.js (qrcode-generator, MIT). */
(function () {
  'use strict';
  var PRM_KEY = 'gp_parametrage', REG_KEY = 'gp_docs_v1', SITE_FALLBACK = 'https://autogarage-pro.vercel.app/';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function cfg() { try { return JSON.parse(localStorage.getItem(PRM_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function qrOn() { return cfg()['prm-qr'] !== '0'; }
  function validLogo(s) { return typeof s === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+\/=]+$/.test(s); }

  /* ── SHA-256 synchrone (texte UTF-8) ──────────────────────────────────── */
  var K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  function utf8(s) { return unescape(encodeURIComponent(s)); }
  function sha256(str) {
    var m = utf8(str), l = m.length, w = new Array(64), i, j;
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var bytes = []; for (i = 0; i < l; i++) bytes.push(m.charCodeAt(i) & 255);
    bytes.push(0x80); while (bytes.length % 64 !== 56) bytes.push(0);
    var hi = Math.floor(l * 8 / 4294967296), lo = (l * 8) >>> 0;
    bytes.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255, (lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);
    function rr(x, n) { return (x >>> n) | (x << (32 - n)); }
    for (var off = 0; off < bytes.length; off += 64) {
      for (i = 0; i < 16; i++) w[i] = (bytes[off + 4 * i] << 24) | (bytes[off + 4 * i + 1] << 16) | (bytes[off + 4 * i + 2] << 8) | bytes[off + 4 * i + 3];
      for (i = 16; i < 64; i++) { var s0 = rr(w[i - 15], 7) ^ rr(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rr(w[i - 2], 17) ^ rr(w[i - 2], 19) ^ (w[i - 2] >>> 10); w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0; }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (j = 0; j < 64; j++) {
        var S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25), ch = (e & f) ^ (~e & g), t1 = (h + S1 + ch + K[j] + w[j]) | 0;
        var S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22), mj = (a & b) ^ (a & c) ^ (b & c), t2 = (S0 + mj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0; H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map(function (x) { return ('00000000' + (x >>> 0).toString(16)).slice(-8); }).join('');
  }

  /* ── Registre des documents imprimés (synchronisé) ────────────────────── */
  var REG = [];
  try { REG = JSON.parse(localStorage.getItem(REG_KEY) || '[]'); if (!Array.isArray(REG)) REG = []; } catch (e) { REG = []; }
  function saveReg() { try { localStorage.setItem(REG_KEY, JSON.stringify(REG)); } catch (e) {} }
  function registerSync() {
    if (typeof window._gpRegisterModule === 'function') window._gpRegisterModule('docs_imprimes', { table: 'documents_imprimes', get: function () { return REG; }, afterSet: saveReg });
  }
  registerSync(); document.addEventListener('DOMContentLoaded', registerSync);

  function who() { try { return window.FIN ? FIN.who() : { login: (window.session && session.login) || '', nom: (window.session && (session.nom || session.login)) || '', role: (window.session && session.role) || '' }; } catch (e) { return { login: '', nom: '', role: '' }; } }
  function siteBase() {
    try { if (/^https?:$/.test(location.protocol) && !/^(localhost|127\.)/.test(location.hostname)) return location.origin + location.pathname.replace(/[^\/]*$/, ''); } catch (e) {}
    return SITE_FALLBACK;
  }
  function verifyUrl(id, h) { return siteBase() + 'verif.html?c=' + encodeURIComponent(id) + '&h=' + encodeURIComponent(h); }

  function registerDoc(info) {
    var full = sha256([info.type, info.ref, info.text, info.emisLogin].join('\u0001'));
    var id = 'AG-' + full.slice(0, 10).toUpperCase(), h = full.slice(10, 26);
    var now = new Date().toISOString(), rec = REG.find(function (r) { return r.id === id; });
    if (rec) { rec.impressions = (rec.impressions || 1) + 1; rec.derniere = now; }
    else {
      var c = cfg();
      rec = { id: id, hash: full, type: info.type, ref: info.ref, entreprise: c['prm-raison'] || 'AutoGarage Pro', emis_login: info.emisLogin, emis_nom: info.emisNom, emis_role: info.emisRole, date: now, derniere: now, impressions: 1 };
      if (info.montant != null && info.montant !== '') rec.montant = info.montant;
      REG.unshift(rec);
      if (REG.length > 5000) REG.length = 5000;
    }
    saveReg();
    try { if (typeof window.saveData === 'function') window.saveData(); } catch (e) {}
    return { id: id, h: h, hash: full, rec: rec };
  }

  /* ── Blocs HTML ───────────────────────────────────────────────────────── */
  var CSS = '.cph-logo{display:block;max-height:60px;max-width:190px;object-fit:contain;margin-bottom:6px}' +
    '.gp-sec{display:flex;gap:14px;align-items:center;margin-top:26px;padding:10px 12px;border:1px solid #9ca3af;border-radius:8px;page-break-inside:avoid;break-inside:avoid;font-family:Arial,Helvetica,sans-serif;color:#111;background:#fff}' +
    '.gp-sec-qr{flex:0 0 auto;width:92px;height:92px}.gp-sec-qr svg{width:92px;height:92px;display:block}' +
    '.gp-sec-txt{font-size:10.5px;line-height:1.55;color:#374151;min-width:0}.gp-sec-txt b{color:#111}.gp-sec-code{font-family:monospace;font-size:12px;font-weight:700;color:#111}' +
    '.gp-sec-url{word-break:break-all;color:#6b7280;font-size:9.5px}.gp-hdr-inj{margin-bottom:14px}';

  function logoImg() { var l = cfg()['prm-logo']; return validLogo(l) ? '<img class="cph-logo" alt="Logo" src="' + l + '">' : ''; }

  function qrSvg(url) {
    if (typeof qrcode !== 'function') return '';
    try { var q = qrcode(0, 'M'); q.addData(url); q.make(); return q.createSvgTag({ cellSize: 3, margin: 0, scalable: true }); } catch (e) { return ''; }
  }

  function secBlock(reg, info) {
    var url = verifyUrl(reg.id, reg.h), d = new Date(reg.rec.date);
    var when = d.toLocaleDateString('fr-FR') + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    return '<div class="gp-sec" data-gp-sec="' + esc(reg.id) + '" data-gp-url="' + esc(url) + '"><div class="gp-sec-qr">' + qrSvg(url) + '</div><div class="gp-sec-txt">' +
      '<div><b>Document authentifié</b> — n° <span class="gp-sec-code">' + esc(reg.id) + '</span></div>' +
      '<div>Émis le ' + when + (info.emisNom ? ' par <b>' + esc(info.emisNom) + '</b>' : '') + ' · Empreinte ' + esc(reg.hash.slice(0, 8).toUpperCase()) + '-' + esc(reg.hash.slice(8, 16).toUpperCase()) + '</div>' +
      '<div>Scannez le QR code pour vérifier l\'authenticité de ce document. Toute modification du contenu imprimé rend l\'empreinte invalide.</div>' +
      '<div class="gp-sec-url">' + esc(url.replace(/&h=.*$/, '')) + '…</div></div></div>';
  }

  /* ── Enveloppes de l'entête / du pied historiques ─────────────────────── */
  var LAST = { title: '', ref: '' };
  function wrapHeader() {
    var o = window.getCompanyPrintHeader; if (typeof o !== 'function' || o._gp) return;
    window.getCompanyPrintHeader = function (title, ref) {
      LAST = { title: title || '', ref: ref || '' };
      var r = o.apply(this, arguments), logo = logoImg();
      var css = (r.css || '') + CSS;
      var html = logo ? String(r.html).replace('<div class="cph-left">', '<div class="cph-left">' + logo) : r.html;
      return { css: css, html: html };
    };
    window.getCompanyPrintHeader._gp = true; window.getCompanyPrintHeader._orig = o;
  }

  /* ── Enrichissement d'un document (popup ou iframe) ───────────────────── */
  function enrich(win, opts) {
    opts = opts || {};
    var d = win && win.document; if (!d || !d.body || d.body.getAttribute('data-gp-done')) return false;
    if (!d.body.children.length && !String(d.body.textContent || '').trim()) return false;
    d.body.setAttribute('data-gp-done', '1');
    var dt = d.querySelector('.cph-doc-title');
    var title = ((dt && dt.textContent) || d.title || LAST.title || 'Document').replace(/\s*[—-]\s*AutoGarage Pro$/i, '').trim();
    var c = cfg();
    /* style commun */
    var st = d.createElement('style'); st.textContent = CSS; (d.head || d.documentElement).appendChild(st);
    /* entête entreprise */
    var hasStd = !!d.querySelector('.cph');
    if (!hasStd) {
      var logoEl = null, sel = '.inv-logo,.pdf-logo,.logo,.hdr .logo';
      var cands = d.querySelectorAll(sel);
      for (var i = 0; i < cands.length; i++) { if (/Auto\s*Garage/i.test(cands[i].textContent || '')) { logoEl = cands[i]; break; } }
      var rec = c['prm-raison'] || '', logoOk = validLogo(c['prm-logo']);
      if (logoEl) {
        if (logoOk || (rec && !/^AutoGarage Pro$/i.test(rec))) logoEl.innerHTML = (logoOk ? '<img class="cph-logo" alt="Logo" src="' + c['prm-logo'] + '">' : '') + (rec ? esc(rec) : '');
      } else if (typeof window.getCompanyPrintHeader === 'function') {
        try {
          var h = window.getCompanyPrintHeader(title, '');
          var wrap = d.createElement('div'); wrap.className = 'gp-hdr-inj'; wrap.innerHTML = '<style>' + h.css + '</style>' + h.html;
          d.body.insertBefore(wrap, d.body.firstChild);
        } catch (e) {}
      }
    }
    /* pied : QR de sécurité */
    if (opts.noQr || !qrOn() || d.body.querySelector('[data-gp-sec]')) return true;
    var refEl = d.querySelector('.cph-ref'), metaRef = d.querySelector('meta[name="gp-ref"]'), metaM = d.querySelector('meta[name="gp-montant"]');
    var ref = (metaRef && metaRef.content) || (refEl && refEl.textContent.trim()) || LAST.ref || '';
    var text = String(d.body.innerText || d.body.textContent || '').replace(/\s+/g, ' ').trim();
    var me = who();
    var info = { type: title, ref: ref, text: text, emisLogin: me.login, emisNom: me.nom, emisRole: me.role, montant: metaM ? metaM.content : null };
    var reg = registerDoc(info);
    var host = d.querySelector('.page') || d.body, box = d.createElement('div'); box.innerHTML = secBlock(reg, info);
    host.appendChild(box.firstChild);
    return true;
  }

  function hookWindow(w) {
    try {
      var d = w.document, ow = d.write.bind(d), oc = d.close.bind(d), t = null;
      var sched = function () { clearTimeout(t); t = setTimeout(function () { try { enrich(w); } catch (e) { console.warn('[Impression]', e); } }, 60); };
      d.write = function () { var r = ow.apply(null, arguments); sched(); return r; };
      d.writeln = function () { var r = ow.apply(null, arguments); sched(); return r; };
      d.close = function () { var r = oc(); sched(); return r; };
    } catch (e) {}
  }
  function wrapOpen() {
    var o = window.open; if (o._gp) return;
    window.open = function (url) {
      var w = o.apply(this, arguments);
      try { if (w && (!url || url === '' || url === 'about:blank')) hookWindow(w); } catch (e) {}
      return w;
    };
    window.open._gp = true;
  }

  /* ── Paramétrage : logo de l'entreprise et option QR ──────────────────── */
  function resizeLogo(file, cb) {
    var fr = new FileReader();
    fr.onload = function () {
      var img = new Image();
      img.onload = function () {
        var max = 420, k = Math.min(1, max / Math.max(img.width, img.height)), cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(img.width * k)); cv.height = Math.max(1, Math.round(img.height * k));
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        var out = cv.toDataURL('image/png');
        if (out.length > 180000) { var c2 = document.createElement('canvas'); c2.width = cv.width; c2.height = cv.height; var x = c2.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c2.width, c2.height); x.drawImage(cv, 0, 0); out = c2.toDataURL('image/jpeg', 0.82); }
        cb(out.length > 400000 ? null : out);
      };
      img.onerror = function () { cb(null); };
      img.src = String(fr.result);
    };
    fr.onerror = function () { cb(null); };
    fr.readAsDataURL(file);
  }
  function previewLogo() {
    var box = document.getElementById('gp-logo-prev'), v = (document.getElementById('prm-logo') || {}).value;
    if (!box) return;
    box.innerHTML = validLogo(v) ? '<img alt="Logo" src="' + v + '" style="max-height:64px;max-width:200px;object-fit:contain;background:#fff;border:1px solid var(--border);border-radius:6px;padding:4px">' : '<span class="fin-note">Aucun logo : le nom de l\'entreprise est imprimé seul.</span>';
  }
  function injectSettings() {
    if (document.getElementById('gp-logo-box')) return;
    var anchor = document.getElementById('prm-raison'); if (!anchor) return;
    var grp = anchor.closest('.form-group'); if (!grp) return;
    var box = document.createElement('div'); box.id = 'gp-logo-box'; box.className = 'form-group'; box.style.marginBottom = '12px';
    box.innerHTML = '<label class="form-label">Logo de l\'entreprise (imprimé sur tous les documents)</label>' +
      '<input type="hidden" id="prm-logo"><div id="gp-logo-prev" style="margin:6px 0"></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><button type="button" class="btn btn-secondary btn-sm" id="gp-logo-pick">🖼️ Choisir un logo…</button><button type="button" class="btn btn-secondary btn-sm" id="gp-logo-del">Retirer</button><input type="file" id="gp-logo-file" accept="image/png,image/jpeg,image/webp" style="display:none"></div>' +
      '<div class="fin-note" style="margin-top:6px">PNG ou JPG, fond clair de préférence. L\'image est réduite automatiquement.</div>' +
      '<label class="form-label" style="margin-top:12px">QR code de sécurité en pied de document</label>' +
      '<select id="prm-qr" class="form-control" style="max-width:320px"><option value="1">Activé (recommandé)</option><option value="0">Désactivé</option></select>' +
      '<div class="fin-note" style="margin-top:6px">Chaque document porte un numéro, une empreinte de son contenu et un QR code ; la page de vérification confirme qu\'il est authentique.</div>';
    grp.parentNode.insertBefore(box, grp);
    try { if (typeof PRM_FIELDS !== 'undefined') ['prm-logo', 'prm-qr'].forEach(function (f) { if (PRM_FIELDS.indexOf(f) < 0) PRM_FIELDS.push(f); }); } catch (e) {}
    var c = cfg(); if (c['prm-logo']) document.getElementById('prm-logo').value = c['prm-logo']; if (c['prm-qr']) document.getElementById('prm-qr').value = c['prm-qr'];
    previewLogo();
    document.getElementById('gp-logo-pick').onclick = function () { document.getElementById('gp-logo-file').click(); };
    document.getElementById('gp-logo-del').onclick = function () { document.getElementById('prm-logo').value = ''; previewLogo(); if (typeof saveParametrage === 'function') saveParametrage(); };
    document.getElementById('gp-logo-file').onchange = function () {
      var f = this.files && this.files[0]; if (!f) return;
      resizeLogo(f, function (data) {
        if (!data) { if (typeof toast === 'function') toast('Image illisible ou trop volumineuse.', 'error'); return; }
        document.getElementById('prm-logo').value = data; previewLogo(); if (typeof saveParametrage === 'function') saveParametrage();
      });
    };
  }
  window.addEventListener('gp-config-changed', function () { var c = cfg(), l = document.getElementById('prm-logo'); if (l) { l.value = c['prm-logo'] || ''; previewLogo(); } var q = document.getElementById('prm-qr'); if (q && c['prm-qr']) q.value = c['prm-qr']; });

  function init() { wrapHeader(); wrapOpen(); injectSettings(); }
  init(); document.addEventListener('DOMContentLoaded', function () { init(); setTimeout(init, 1500); });

  window.GPPrint = { sha256: sha256, enrich: enrich, registerDoc: registerDoc, verifyUrl: verifyUrl, registre: function () { return REG; }, logoImg: logoImg, qrSvg: qrSvg };
})();
