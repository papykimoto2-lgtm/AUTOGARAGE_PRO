/* AutoGarage Pro — installation de l'application (PWA) sur téléphone, tablette et ordinateur.
   - Chrome / Edge / Samsung Internet (Android, PC) : installation en un clic quand le navigateur la propose.
   - iPhone / iPad (Safari, Chrome, Edge…), Firefox, Safari Mac : mode d'emploi adapté à l'appareil.
   Expose : window._instOpen(), window._instIsInstalled(). */
(function () {
  'use strict';

  var deferred = null;

  function $(id) { return document.getElementById(id); }
  function toastMsg(m, t) { if (typeof toast === 'function') toast(m, t || 'info'); }

  /* ── Détection ────────────────────────────────────────────────────────── */
  var ua = navigator.userAgent || '';
  var touchMac = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;       /* iPadOS se présente comme un Mac */
  var isIOS = /iPad|iPhone|iPod/.test(ua) || touchMac;
  var isAndroid = /Android/i.test(ua);
  var isMobileOrTablet = isIOS || isAndroid;
  var isFirefox = /Firefox|FxiOS/i.test(ua);
  var isEdge = /Edg(e|A|iOS)?\//.test(ua);
  var isSamsung = /SamsungBrowser/i.test(ua);
  var isSafariDesktop = !isIOS && /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(ua);

  function installed() {
    try {
      return (window.matchMedia && (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: minimal-ui)').matches)) ||
             window.navigator.standalone === true;
    } catch (x) { return false; }
  }
  window._instIsInstalled = installed;

  window.addEventListener('beforeinstallprompt', function (ev) {
    ev.preventDefault();
    deferred = ev;
    var b = $('inst-now'); if (b) b.style.display = '';
  });
  window.addEventListener('appinstalled', function () {
    deferred = null;
    ['aj-install', 'inst-login'].forEach(function (id) { var e = $(id); if (e) e.style.display = 'none'; });
    close();
    toastMsg('✅ AutoGarage Pro est installé', 'success');
  });

  /* ── Mode d'emploi par appareil ───────────────────────────────────────── */
  function steps(kind) {
    var S = {
      ios: ['Ouvrez ce site dans <b>Safari</b> (ou Chrome / Edge : même menu).',
            'Touchez le bouton <b>Partager</b> <span class="inst-ico">⬆️</span> (carré avec une flèche vers le haut, en bas de l\'écran, ou en haut sur iPad).',
            'Faites défiler et touchez <b>« Sur l\'écran d\'accueil »</b>, puis <b>Ajouter</b>.',
            'L\'icône <b>AutoGarage</b> apparaît sur l\'écran d\'accueil : ouvrez-la, elle s\'affiche en plein écran.'],
      android: ['Ouvrez ce site dans <b>Chrome</b>.',
                'Touchez le menu <b>⋮</b> (en haut à droite).',
                'Touchez <b>« Installer l\'application »</b> (ou <b>« Ajouter à l\'écran d\'accueil »</b>), puis <b>Installer</b>.',
                'L\'icône apparaît sur l\'écran d\'accueil et dans la liste des applications.'],
      samsung: ['Ouvrez ce site dans <b>Samsung Internet</b>.',
                'Touchez le menu <b>☰</b> (en bas à droite).',
                'Touchez <b>« Ajouter la page à »</b> puis <b>« Écran d\'accueil »</b>.'],
      edge: ['Dans <b>Microsoft Edge</b>, cliquez sur le menu <b>⋯</b> (en haut à droite).',
             'Choisissez <b>Applications</b> puis <b>« Installer ce site en tant qu\'application »</b>.',
             'Confirmez avec <b>Installer</b> : une fenêtre dédiée s\'ouvre, avec une icône dans le menu Démarrer et la barre des tâches.'],
      chrome: ['Dans <b>Chrome</b>, cliquez sur l\'icône d\'installation <span class="inst-ico">⊕</span> à droite de la barre d\'adresse.',
               'Sinon : menu <b>⋮</b> → <b>« Diffuser, enregistrer et partager »</b> → <b>« Installer AutoGarage Pro »</b>.',
               'Confirmez avec <b>Installer</b> : une fenêtre dédiée s\'ouvre, avec une icône sur le bureau ou dans le menu Démarrer.'],
      safari: ['Dans <b>Safari</b> (macOS 14 ou plus récent), ouvrez le menu <b>Fichier</b>.',
               'Choisissez <b>« Ajouter au Dock… »</b> puis <b>Ajouter</b>.'],
      firefox: ['<b>Firefox</b> sur ordinateur ne permet pas d\'installer ce type d\'application.',
                'Ouvrez ce site avec <b>Chrome</b> ou <b>Microsoft Edge</b> pour l\'installer, ou ajoutez-le simplement aux marque-pages.']
    };
    return S[kind];
  }

  function detectedKind() {
    if (isIOS) return 'ios';
    if (isAndroid) return isSamsung ? 'samsung' : 'android';
    if (isFirefox) return 'firefox';
    if (isSafariDesktop) return 'safari';
    return isEdge ? 'edge' : 'chrome';
  }
  var LABELS = { ios: '📱 iPhone / iPad', android: '📱 Android (Chrome)', samsung: '📱 Samsung Internet', edge: '💻 PC · Microsoft Edge', chrome: '💻 PC / Mac · Chrome', safari: '💻 Mac · Safari', firefox: '💻 Firefox' };

  function list(kind) { return '<ol>' + steps(kind).map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</ol>'; }

  /* ── Fenêtre d'installation ───────────────────────────────────────────── */
  function close() { var m = $('inst-modal'); if (m) { m.remove(); document.removeEventListener('keydown', onKey, true); } }
  function onKey(ev) { if (ev.key === 'Escape') { ev.stopPropagation(); close(); } }

  function open() {
    if ($('inst-modal')) return;
    if (installed()) { toastMsg('AutoGarage Pro est déjà installé sur cet appareil', 'info'); return; }
    var mine = detectedKind();
    var others = ['ios', 'android', 'chrome', 'edge', 'safari'].filter(function (k) { return k !== mine; });
    var secure = window.isSecureContext !== false;
    var m = document.createElement('div');
    m.id = 'inst-modal';
    m.innerHTML =
      '<div class="inst-box" role="dialog" aria-modal="true" aria-label="Installer l\'application">' +
      '<div class="inst-head"><div class="inst-logo">🔧</div><div><div class="inst-title">Installer AutoGarage Pro</div>' +
      '<div class="inst-sub">Sur téléphone, tablette ou ordinateur · s\'ouvre en plein écran, même hors ligne</div></div>' +
      '<button class="inst-x" id="inst-close" aria-label="Fermer">✕</button></div>' +
      (secure ? '' : '<div class="inst-warn">⚠️ Cette page n\'est pas en connexion sécurisée (HTTPS) : l\'installation n\'est pas disponible.</div>') +
      '<button id="inst-now" class="inst-go" style="display:' + (deferred ? '' : 'none') + '">📲 Installer maintenant</button>' +
      '<div class="inst-sec"><div class="inst-h">' + LABELS[mine] + (deferred ? ' — ou manuellement' : '') + '</div>' + list(mine) + '</div>' +
      '<details class="inst-more"><summary>Autres appareils</summary>' +
      others.map(function (k) { return '<div class="inst-sec"><div class="inst-h">' + LABELS[k] + '</div>' + list(k) + '</div>'; }).join('') +
      '</details>' +
      '<div class="inst-foot">Une fois installée, l\'application se met à jour automatiquement à chaque connexion. Vos données restent sur l\'appareil et se synchronisent avec le cloud quand vous êtes connecté par e-mail.</div></div>';
    document.body.appendChild(m);
    m.addEventListener('click', function (ev) { if (ev.target === m) close(); });
    $('inst-close').onclick = close;
    $('inst-now').onclick = function () {
      if (!deferred) return;
      deferred.prompt();
      deferred.userChoice.then(function (r) { if (r && r.outcome === 'accepted') close(); deferred = null; });
    };
    document.addEventListener('keydown', onKey, true);
  }
  window._instOpen = open;

  /* ── Lien d'installation sur l'écran de connexion ─────────────────────── */
  function addLoginLink() {
    var box = document.querySelector('#login-screen .login-box');
    if (!box || $('inst-login') || installed()) return;
    var a = document.createElement('button');
    a.type = 'button'; a.id = 'inst-login';
    a.textContent = '📲 Installer l\'application';
    a.addEventListener('click', open);
    var btn = box.querySelector('.login-btn, button[onclick*="doLogin"]');
    if (btn && btn.parentNode) btn.parentNode.insertBefore(a, btn.nextSibling); else box.appendChild(a);
  }

  document.addEventListener('DOMContentLoaded', function () {
    addLoginLink();
    if (installed()) { var b = $('aj-install'); if (b) b.style.display = 'none'; }
    /* Les menus sont créés un peu après le chargement */
    var n = 0, t = setInterval(function () { var b = $('aj-install'); if (b && installed()) b.style.display = 'none'; if (b || ++n > 30) clearInterval(t); }, 500);
  });
})();
