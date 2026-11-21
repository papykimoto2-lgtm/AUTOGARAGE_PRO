/* AutoGarage Pro — aide intégrée (touche ? ou F1) et bandeau du mode démonstration.
   Autonome : ne dépend que de la présence de #app (application ouverte). */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function appOpen() { var a = $('app'); return !!(a && a.classList.contains('show')); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ── Contenu ──────────────────────────────────────────────────────────── */
  var SECTIONS = [
    { id: 'start', title: '🚀 Démarrer', items: [
      ['Se connecter', 'Saisissez votre <b>e-mail</b> et votre mot de passe : vos données sont alors synchronisées avec le cloud et votre rôle est vérifié par le serveur. Un <b>identifiant sans @</b> ouvre le mode <b>local hors ligne</b> : données de cet appareil uniquement, sans synchronisation.'],
      ['Le bloc « Aujourd\'hui »', 'En haut du tableau de bord, il liste ce qui demande votre attention : ordres de réparation en retard, travaux terminés non facturés, factures impayées depuis 15 jours, pièces en rupture ou sous le seuil, visites techniques qui expirent, rendez-vous du jour. Reportez une alerte avec « 2 h » ou « Demain ».'],
      ['Un parcours type', '<b>Client</b> → <b>Véhicule</b> → <b>Intervention</b> (ordre de réparation) → travaux → <b>Facture</b> → paiement en <b>Caisse</b>. Depuis une alerte « travaux terminés », le bouton <b>Facturer</b> ouvre la facture déjà remplie.'],
      ['Chercher partout', 'Touche <kbd>/</kbd> ou <kbd>Ctrl</kbd>+<kbd>K</kbd> : clients, plaques, n° d\'ordre, factures et pièces.']
    ]},
    { id: 'modules', title: '🧩 Les modules', items: [
      ['Tableau de bord', 'Interventions du jour, chiffre d\'affaires, véhicules en atelier, alertes de stock, activité récente.'],
      ['Clients · Véhicules · Flotte Entreprise', 'Fiches clients (particuliers et entreprises), véhicules avec historique, flottes d\'entreprise avec contrats, carburant et maintenance préventive.'],
      ['Interventions · Entretiens', 'Ordres de réparation suivis par statut (en attente, en cours, terminé), techniciens, dates de remise ; entretiens programmés.'],
      ['Diagnostic & Devis', 'Checklist de contrôle par catégorie avec prix main-d\'œuvre et pièces, génération du devis puis de la facture.'],
      ['Visite Technique', 'Suivi des dates d\'expiration, alertes et envoi de rappels par WhatsApp.'],
      ['Stock & Pièces · Outillage', 'Références, seuils d\'alerte, dépôts, mouvements, inventaire ; prêts et retours d\'outils.'],
      ['Facturation · Caisse · Dépenses · Fournisseurs', 'Factures (simples ou normalisées), règlements, sessions de caisse, dépenses par catégorie, commandes et dettes fournisseurs.'],
      ['Statistiques · Rapports · Agenda / RDV · Personnel', 'Indicateurs, rapports imprimables ou partagés par WhatsApp, planning des rendez-vous, équipe.'],
      ['Paramétrage', 'Informations de l\'entreprise, mentions de facture, utilisateurs et sécurité, sauvegarde et synchronisation.']
    ]},
    { id: 'roles', title: '👥 Rôles et droits', items: [
      ['Administrateur', 'Accès à tous les modules, gestion des utilisateurs et du paramétrage.'],
      ['Chef d\'atelier', 'Clients, véhicules, flotte, atelier, stock, outillage, fournisseurs, statistiques, agenda et personnel. Finances en lecture seule côté cloud.'],
      ['Mécanicien', 'Interventions, entretiens, diagnostic, stock et outillage.'],
      ['Caissier', 'Tableau de bord, facturation, caisse, dépenses et rapports.'],
      ['Qui décide ?', 'Avec une connexion par e-mail, le rôle est stocké dans le cloud et appliqué par le serveur : un utilisateur ne peut pas s\'attribuer plus de droits depuis son navigateur. Un administrateur crée les comptes dans Supabase puis leur profil.']
    ]},
    { id: 'tips', title: '💡 Astuces', items: [
      ['Hors ligne', 'L\'application continue de fonctionner sans connexion. La pastille « Synchronisé / Hors ligne » en haut indique l\'état ; les modifications sont envoyées au retour du réseau.'],
      ['Installer l\'application', 'Bouton « 📲 Installer l\'application » dans le menu (quand votre navigateur le propose) : icône sur l\'écran d\'accueil, ouverture plein écran.'],
      ['Couleur du thème', 'Les pastilles de couleur du menu changent l\'accent et les fonds ; le choix est mémorisé sur l\'appareil.'],
      ['Mobile et tablette', 'Menu ☰ en haut à gauche ou balayage depuis le bord gauche ; barre de navigation rapide en bas du téléphone.']
    ]},
    { id: 'help', title: '🛟 Dépannage', items: [
      ['« E-mail ou mot de passe incorrect »', 'Vérifiez l\'adresse (sans espace) et le mot de passe. Après plusieurs essais, attendez quelques minutes.'],
      ['« Compte non autorisé »', 'Le compte existe mais son profil est absent ou désactivé : contactez l\'administrateur.'],
      ['« Cloud injoignable »', 'Problème de réseau. Réessayez, ou travaillez en mode local avec un identifiant sans @ ; vos modifications seront synchronisées ensuite.'],
      ['Affichage figé ou ancien', 'Fermez l\'onglet, rouvrez l\'application ; sinon videz les données du site dans les paramètres du navigateur (l\'application garde une copie hors ligne).'],
      ['Données de démonstration', 'La page <a href="demo.html">demo.html</a> permet d\'essayer le logiciel avec des données fictives, sans rien envoyer au cloud.']
    ]}
  ];

  function render(filter) {
    var f = (filter || '').toLowerCase().trim();
    var html = '', total = 0;
    SECTIONS.forEach(function (s) {
      var rows = s.items.filter(function (it) { return !f || (it[0] + ' ' + it[1]).toLowerCase().indexOf(f) !== -1; });
      if (!rows.length) return;
      total += rows.length;
      html += '<section id="aide-' + s.id + '"><h3>' + s.title + '</h3>' + rows.map(function (it) {
        return '<details' + (f ? ' open' : '') + '><summary>' + it[0] + '</summary><div>' + it[1] + '</div></details>';
      }).join('') + '</section>';
    });
    $('aide-body').innerHTML = html || '<p class="aide-empty">Aucun résultat pour « ' + esc(filter) + ' ».</p>';
  }

  function close() { var m = $('aide-modal'); if (m) { m.remove(); document.removeEventListener('keydown', onKey, true); } }
  function onKey(ev) { if (ev.key === 'Escape') { ev.stopPropagation(); close(); } }

  function open() {
    if ($('aide-modal')) return;
    var m = document.createElement('div');
    m.id = 'aide-modal';
    m.innerHTML =
      '<div class="aide-box" role="dialog" aria-modal="true" aria-label="Aide">' +
      '<div class="aide-head"><div><div class="aide-title">❓ Aide — AutoGarage Pro</div><div class="aide-sub">Guide rapide, modules, rôles et dépannage</div></div>' +
      '<button class="aide-x" aria-label="Fermer" id="aide-close">✕</button></div>' +
      '<input id="aide-q" type="search" placeholder="Rechercher dans l\'aide…" autocomplete="off">' +
      '<div id="aide-nav">' + SECTIONS.map(function (s) { return '<a href="#aide-' + s.id + '" data-s="' + s.id + '">' + s.title + '</a>'; }).join('') + '</div>' +
      '<div id="aide-body"></div>' +
      '<div class="aide-foot">Développé par <b>SANIX AFRICA</b> · Division Technologies<br>📞 +225 07 79 18 10 75 · ✉️ sanixafrica699@gmail.com</div></div>';
    document.body.appendChild(m);
    render('');
    $('aide-close').onclick = close;
    m.addEventListener('click', function (ev) { if (ev.target === m) close(); });
    $('aide-q').addEventListener('input', function () { render(this.value); });
    $('aide-nav').addEventListener('click', function (ev) {
      var a = ev.target.closest('a[data-s]'); if (!a) return;
      ev.preventDefault();
      $('aide-q').value = ''; render('');
      var t = $('aide-' + a.getAttribute('data-s')); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    document.addEventListener('keydown', onKey, true);
    $('aide-q').focus();
  }
  window._aideOpen = open;

  document.addEventListener('keydown', function (ev) {
    var tag = (ev.target && ev.target.tagName) || '';
    var typing = /INPUT|TEXTAREA|SELECT/.test(tag) || (ev.target && ev.target.isContentEditable);
    if ((ev.key === 'F1' || (ev.key === '?' && !typing)) && appOpen()) { ev.preventDefault(); open(); }
  });

  /* ── Bouton dans le menu ──────────────────────────────────────────────── */
  function addButton() {
    var side = $('aj-side');
    if (!side || $('aide-btn')) return !!$('aide-btn');
    var b = document.createElement('button');
    b.id = 'aide-btn'; b.className = 'aj-side-btn'; b.innerHTML = '❓ Aide <kbd>?</kbd>';
    b.addEventListener('click', open);
    var search = side.querySelector('.aj-side-btn');
    if (search && search.nextSibling) side.insertBefore(b, search.nextSibling); else side.appendChild(b);
    return true;
  }

  /* ── Mode démonstration : bandeau permanent + sortie ──────────────────── */
  function demoBanner() {
    var demo = false; try { demo = localStorage.getItem('gp_demo') === '1'; } catch (x) {}
    if (!demo || $('demo-chip')) return;
    var c = document.createElement('div');
    c.id = 'demo-chip';
    c.innerHTML = '🧪 <b>Démonstration</b> · données fictives sur cet appareil <a href="demo.html#quitter">Quitter</a>';
    document.body.appendChild(c);
  }

  document.addEventListener('DOMContentLoaded', function () {
    demoBanner();
    var tries = 0, t = setInterval(function () { if (addButton() || ++tries > 40) clearInterval(t); }, 500);
  });
})();
