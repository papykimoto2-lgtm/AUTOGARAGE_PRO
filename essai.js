/* AutoGarage Pro — essai gratuit de 30 jours.
   - Bandeau « X jours restants » tant que l'essai court.
   - À l'expiration : écran de verrouillage (export des données + contact), impossible à fermer.
   - Horloge : la dernière date vue est mémorisée, reculer l'heure de l'appareil ne prolonge pas l'essai.
   L'essai est local à l'appareil (aucune synchronisation cloud, voir cloud.js / sync.js). */
(function () {
  'use strict';

  var KEY = 'gp_trial';
  var DAY_MS = 86400000;
  var trial = null;
  try { trial = JSON.parse(localStorage.getItem(KEY)); } catch (x) {}
  if (!trial || !trial.end) return;

  function save() { try { localStorage.setItem(KEY, JSON.stringify(trial)); } catch (x) {} }

  function now() {
    var n = Math.max(Date.now(), trial.last || 0);
    if (n !== trial.last) { trial.last = n; save(); }
    return n;
  }

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function style() {
    if (document.getElementById('trial-css')) return;
    var s = document.createElement('style'); s.id = 'trial-css';
    s.textContent =
      '#trial-chip{position:fixed;left:14px;bottom:14px;z-index:9000;background:var(--yellow-soft,#2a2208);color:var(--yellow,#eab308);border:1px solid var(--yellow,#eab308);border-radius:999px;padding:7px 14px;font-size:12px}' +
      '#trial-chip.warn{background:#3b1212;color:#f87171;border-color:#f87171}' +
      '#trial-chip a{color:inherit;margin-left:8px;text-decoration:underline}' +
      '@media (max-width:599px){#trial-chip{bottom:70px;left:8px;right:8px;text-align:center;border-radius:12px}}' +
      '#trial-lock{position:fixed;inset:0;z-index:2147483647;background:#060b18;color:#f0f4ff;display:flex;align-items:center;justify-content:center;padding:20px;font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow:auto}' +
      '#trial-lock .box{max-width:460px;width:100%;background:#0e1528;border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:24px;text-align:center}' +
      '#trial-lock h1{font-size:21px;margin-bottom:8px}#trial-lock p{color:#8899bb;font-size:14px;margin:8px 0}' +
      '#trial-lock button,#trial-lock a.btn{display:block;width:100%;min-height:50px;line-height:50px;border:0;border-radius:11px;font:600 15px inherit;cursor:pointer;color:#fff;text-decoration:none;margin-top:12px;background:linear-gradient(135deg,#f97316,#f59e0b)}' +
      '#trial-lock button.sec{background:#131b30;border:1px solid rgba(255,255,255,.12)}' +
      '#trial-lock .who{margin-top:16px;font-size:13px;color:#f0f4ff}';
    document.head.appendChild(s);
  }

  /* ── Sauvegarde des données (fichier JSON) ─────────────────────────────── */
  function exportData() {
    var out = {};
    Object.keys(localStorage).forEach(function (k) { if (/^(gp_|sf_)/.test(k) && k !== 'gp_cloud_session') out[k] = localStorage.getItem(k); });
    var blob = new Blob([JSON.stringify({ app: 'AutoGarage Pro', garage: trial.garage, exporte_le: new Date().toISOString(), donnees: out })], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'autogarage-pro-sauvegarde-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function lock() {
    style();
    var chip = document.getElementById('trial-chip'); if (chip) chip.remove();
    if (document.getElementById('trial-lock')) return;
    var d = document.createElement('div');
    d.id = 'trial-lock'; d.setAttribute('role', 'alertdialog'); d.setAttribute('aria-modal', 'true');
    d.innerHTML =
      '<div class="box"><div style="font-size:40px">⏳</div>' +
      '<h1>Votre essai gratuit est terminé</h1>' +
      '<p>Merci d\'avoir testé AutoGarage Pro' + (trial.garage ? ' pour <b>' + esc(trial.garage) + '</b>' : '') + '.<br>Vos données sont conservées sur cet appareil : rien n\'est perdu.</p>' +
      '<p>Pour continuer à utiliser le logiciel, contactez-nous.</p>' +
      '<a class="btn" href="https://wa.me/2250779181075?text=' + encodeURIComponent('Bonjour, mon essai AutoGarage Pro est terminé, je souhaite continuer.') + '" target="_blank" rel="noopener">💬 Nous écrire sur WhatsApp</a>' +
      '<a class="btn" style="background:#131b30;border:1px solid rgba(255,255,255,.12)" href="tel:+2250779181075">📞 +225 07 79 18 10 75</a>' +
      '<button class="sec" type="button" id="trial-export">💾 Télécharger une sauvegarde de mes données</button>' +
      '<div class="who">SANIX AFRICA · Division Technologies<br>sanixafrica699@gmail.com</div></div>';
    document.body.appendChild(d);
    document.getElementById('trial-export').addEventListener('click', exportData);
  }

  function banner(left) {
    style();
    var c = document.getElementById('trial-chip');
    if (!c) { c = document.createElement('div'); c.id = 'trial-chip'; document.body.appendChild(c); }
    c.className = left <= 5 ? 'warn' : '';
    c.innerHTML = '⏳ <b>Essai gratuit</b> · ' + left + ' jour' + (left > 1 ? 's' : '') + ' restant' + (left > 1 ? 's' : '') +
      ' <a href="https://wa.me/2250779181075" target="_blank" rel="noopener">Continuer</a>';
  }

  function check() {
    if (!document.body) return;
    var n = now();
    if (n >= trial.end) { lock(); return; }
    banner(Math.max(1, Math.ceil((trial.end - n) / DAY_MS)));
  }

  function init() {
    check();
    setInterval(check, 60000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) check(); });
    /* L'écran de verrouillage ne peut pas être retiré depuis la console / les outils du navigateur */
    new MutationObserver(function () {
      if (now() >= trial.end && !document.getElementById('trial-lock')) lock();
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
