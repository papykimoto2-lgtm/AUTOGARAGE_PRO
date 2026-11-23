/* AutoGarage Pro — masque la clé API et l'URL du cloud dans l'interface.
   Paramétrage → Synchronisation cloud, et carte « Connexion Supabase » : les champs (et l'œil 👁 qui
   affichait la clé) sont retirés ; seul un statut « Clé configurée » reste. Les boutons de synchronisation,
   de test et de diagnostic restent disponibles. La clé est intégrée à l'application (clé publique : la
   sécurité des données repose sur la RLS côté serveur, pas sur le secret de cette clé). */
(function () {
  'use strict';

  function group(id) {
    var el = document.getElementById(id);
    return el ? (el.closest('.form-group') || el.parentNode) : null;
  }

  function status(after, text) {
    if (!after || after.parentNode.querySelector('.cle-masquee')) return;
    var d = document.createElement('div');
    d.className = 'cle-masquee';
    d.style.cssText = 'font-size:12px;color:var(--text-sub);margin:0 0 10px';
    d.textContent = text;
    after.parentNode.insertBefore(d, after);
  }

  function hideBtn(sel) {
    document.querySelectorAll(sel).forEach(function (b) { b.style.display = 'none'; });
  }

  function apply() {
    var g1 = group('prm-supa-key');
    if (g1) { g1.style.display = 'none'; status(g1, '🔒 Clé API cloud : configurée et masquée'); }
    hideBtn('button[onclick="syncSaveKey()"]');

    var gu = group('db-supa-url'), gk = group('db-supa-key');
    if (gk) { gk.style.display = 'none'; status(gk, '🔒 Clé API : configurée et masquée'); }
    if (gu) gu.style.display = 'none';
    hideBtn('button[onclick="dbSaveConfig()"]');

    /* par sécurité : ne laisse aucune valeur pré-remplie dans les champs masqués */
    ['prm-supa-key', 'db-supa-key', 'db-supa-url'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) { el.value = ''; el.removeAttribute('value'); el.placeholder = ''; }
    });
  }

  function init() {
    apply();
    /* les scripts de paramétrage pré-remplissent les champs au chargement de la page : on repasse après */
    var n = 0, t = setInterval(function () { apply(); if (++n > 10) clearInterval(t); }, 1000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
