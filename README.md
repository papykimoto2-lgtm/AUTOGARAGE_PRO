# AutoGarage Pro

Logiciel de gestion de garage automobile : clients, véhicules, ordres de réparation, diagnostic et devis, stock, facturation, caisse, flotte d'entreprise, visites techniques et rapports. Fonctionne **sur ordinateur, tablette et téléphone**, **hors ligne**, avec synchronisation cloud et rôles par utilisateur.

Développé par **SANIX AFRICA — Division Technologies** · 📞 +225 07 79 18 10 75 · ✉️ sanixafrica699@gmail.com

**En ligne :** https://autogarage-pro.vercel.app · **Essai sans risque :** `/demo.html` (données fictives, rien n'est envoyé au cloud)

**Essai gratuit de 30 jours pour un prospect :** envoyer le lien `https://autogarage-pro.vercel.app/essai.html`. Le prospect crée son garage vide (nom, identifiant, mot de passe), travaille avec ses propres données stockées sur son appareil (pas de cloud), voit un bandeau « X jours restants », et l'accès se verrouille au bout de 30 jours (export de sauvegarde + contact). Un seul essai par appareil (`essai.html`, `essai.js`).

## Modules

| Menu | Contenu |
|---|---|
| Tableau de bord | Indicateurs du jour et bloc **Aujourd'hui** (alertes actionnables) |
| Clients · Véhicules · Flotte Entreprise | Fiches, historique, contrats, carburant, maintenance préventive |
| Interventions · Entretiens | Ordres de réparation par statut, techniciens, dates de remise |
| Diagnostic & Devis | Checklist de contrôle chiffrée, devis puis facture |
| Visite Technique | Dates d'expiration, alertes, rappels WhatsApp |
| Stock & Pièces · Outillage | Références, seuils, dépôts, mouvements, inventaire, prêts d'outils |
| Facturation · Caisse · Dépenses · Fournisseurs | Factures simples ou normalisées, règlements, sessions de caisse, achats |
| Statistiques · Rapports · Agenda / RDV · Personnel | Pilotage, impressions et partages, planning, équipe |
| Validations | Boîte unique de la hiérarchie : bons de caisse, dépenses, visas de clôture, remises à confirmer, écritures à viser, historique motivé |
| Pilotage | Tableau de bord de la direction : écarts, délais de validation, rejets, trésorerie |
| Comptabilité | Plan SYSCOHADA simplifié, journaux VT/AC/CA/BQ/OD/AN, écritures automatiques, grand livre, balance, résultat et bilan, TVA, export FEC |
| Paramétrage | Entreprise, utilisateurs et sécurité, sauvegarde, synchronisation |

**Pagination automatique** des listes longues (tableaux 10/25/50/100/Tout, grilles de cartes, colonnes d'interventions « Afficher plus »), sans modifier les modules (`pagination.js`). Aides intégrées : recherche globale (`/` ou `Ctrl+K`), **aide** (`?` ou `F1`), **mode jour / nuit / auto** (bouton ☀️/🌙 en haut, choix dans le menu) et six couleurs d'accent, installation comme application (PWA). Le mode jour utilise des couleurs foncées pour rester lisible en plein soleil (contraste vérifié automatiquement sur toutes les pages).

## Installer l'application (téléphone, tablette, ordinateur)

Bouton **« 📲 Installer l'application »** sur l'écran de connexion et dans le menu.

| Appareil | Comment |
|---|---|
| **Android** (Chrome) | Installation en un clic, ou menu ⋮ → *Installer l'application* |
| **PC / Mac** (Chrome, Edge) | Installation en un clic, ou icône d'installation dans la barre d'adresse |
| **iPhone / iPad** | *Partager* → *Sur l'écran d'accueil* (iOS ne propose pas l'installation en un clic) |
| **Mac** (Safari 17+) | *Fichier* → *Ajouter au Dock* |
| **Firefox (ordinateur)** | Non pris en charge : utiliser Chrome ou Edge |

Prérequis : site servi en **HTTPS** (Vercel le fait). L'application installée s'ouvre en plein écran, fonctionne hors ligne et se met à jour à chaque connexion.

## Rôles

| Rôle | Accès |
|---|---|
| Administrateur | Tous les modules, utilisateurs, paramétrage |
| Chef d'atelier | Clients, véhicules, flotte, atelier, stock, outillage, fournisseurs, statistiques, agenda, personnel |
| Mécanicien | Interventions, entretiens, diagnostic, stock, outillage |
| Caissier | Tableau de bord, facturation, caisse, dépenses, rapports |
| Comptable | Comptabilité (saisie des écritures), Validations (écritures à viser selon droits), facturation et rapports en lecture |
| Personnalisé | Liste de modules choisie par l'administrateur |

## Connexion et données

- **E-mail + mot de passe** : session **Supabase Auth**. Le rôle est lu dans la table `profiles` et **appliqué par le serveur** (RLS) : un utilisateur ne peut pas s'accorder plus de droits depuis son navigateur.
- **Identifiant sans `@`** : mode **local hors ligne**, données de l'appareil uniquement, sans synchronisation.
- Les données sont d'abord enregistrées **sur l'appareil**, puis synchronisées vers le cloud (pastille *Synchronisé / Hors ligne* en haut).
- Jeton renouvelé automatiquement ; déconnexion propre.
- **Afficher le mot de passe** (œil) et **Se souvenir de moi** sur l'écran de connexion : coché, l'e-mail est pré-rempli et la session reste ouverte (reconnexion automatique, y compris hors ligne grâce au profil mis en cache) ; décoché, la session est limitée au navigateur ouvert. Le mot de passe n'est jamais stocké par l'application. Une session révoquée ou un compte désactivé ramène à l'écran de connexion.

## Architecture

Application web **statique**, sans étape de compilation.

| Fichier | Rôle |
|---|---|
| `index.html` | Application principale (interface, modules, moteur de synchronisation) |
| `aujourdhui.js` / `.css` | Bloc *Aujourd'hui*, recherche globale, thème, installation |
| `cloud.js` / `login.css` | Connexion Supabase Auth, profil et rôle, jeton, mot de passe visible, « se souvenir de moi », reconnexion automatique, première synchronisation, mode démonstration |
| `aide.js` / `aide.css` | Aide intégrée et bandeau de démonstration |
| `demo.html` | Page de démonstration (données fictives, sauvegarde puis restauration du poste) |
| `integrite.js` / `.css` | Suppressions en cascade avec impact, modifications répercutées, contrôle des orphelins |
| `pagination.js` / `.css` | Pagination automatique des tableaux, grilles et colonnes (aucun module à modifier) |
| `install.js` / `install.css` | Installation de l'application : un clic (Chrome, Edge, Samsung Internet) ou mode d'emploi par appareil (iPhone/iPad, Mac, Firefox) |
| `sw.js`, `manifest.webmanifest`, `icon*.png`, `apple-touch-icon.png`, `icon.svg` | Fonctionnement hors ligne, installation (PWA) et icônes |

### Synchronisation (`sync.js`)

Moteur **ligne par ligne**, testé sur les 30 tables :

- Pour chaque table, une **base** (empreinte de chaque ligne au dernier échange réussi) permet de ne **renvoyer que les lignes modifiées** et de **propager les suppressions**.
- La **réception fusionne** : une ligne modifiée localement n'est jamais écrasée, une ligne supprimée sur un autre appareil est retirée. Réception **incrémentale** (`updated_at`) avec une sonde légère quand rien n'a changé, et **pagination** (le serveur plafonne à 1000 lignes par requête).
- **Conflits** (même identifiant créé en même temps sur deux appareils, ou ligne modifiée des deux côtés) : le cloud ou la version locale est gardé selon le cas et **la copie divergente est conservée** (menu → ⚠️ conflits → *Restaurer ma version*). Aucun écrasement silencieux.
- Garde-fous : une suppression massive (> 20 lignes et > 50 % d'une table) demande confirmation ; une table en lecture seule pour le rôle n'est pas renvoyée en boucle.
- Rythme : envoi 3 s après un enregistrement, cycle complet toutes les 90 s, à la reprise de l'onglet et au retour du réseau.
- Numérotation des factures : le compteur repart du plus grand numéro existant (plus de doublons après un rechargement).
- Le **paramétrage** de l'entreprise est synchronisé (table `config`, écriture réservée à l'administrateur).

### Intégrité des données (`integrite.js`)

- **Suppression en cascade avec impact** : supprimer un client, un véhicule, un ordre de réparation, une facture, une pièce ou un fournisseur affiche ce qui y est lié et propose d'annuler ou de tout supprimer (plus de fiches orphelines). Les éléments **financiers** (factures, encaissements, commandes fournisseur) exigent le rôle **administrateur** et une case de confirmation. Sans lien, le parcours d'origine est inchangé.
- **Modifications répercutées** : renommer un client ou changer une plaque / marque met à jour les copies (ordres de réparation, entretiens, visites techniques, rendez-vous, caisse, diagnostics).
- **Contrôle de cohérence** : détecte les orphelins (y compris ceux créés par la synchronisation entre appareils) ; bouton « 🧹 » dans le menu ; nettoyage au choix, jamais automatique pour les factures.
- Les suppressions en cascade se propagent au cloud par le moteur de synchronisation.

### Caisse, validation hiérarchique et comptabilité (`finance.js`, `caisse.js`, `compta.js`, `validations.js`)

- **Bons de caisse** (entrée, sortie, remise en banque, remise à la direction, réapprovisionnement) : saisis par le caissier, ils **ne comptent qu'une fois validés** par la hiérarchie. Les remises et réapprovisionnements ajustent le fond de caisse sans fausser le chiffre d'affaires ni les dépenses.
- **Validation par la hiérarchie** : plafond par rôle (vide = illimité, 0 = aucun pouvoir), **séparation des tâches** (personne ne valide sa propre demande, administrateur compris ; désactivable pour une très petite structure), décisions **définitives**, **motif obligatoire** en cas de rejet, remises **confirmées par une autre personne** avec la référence de la preuve. Réglages : Validations → « Habilitations et plafonds » (administrateur).
- **Caisse contrôlée** : PIN personnel à l'ouverture, une seule session ouverte, clôture avec comptage, explication de l'écart, mention des mouvements en attente et **visa de la hiérarchie** si l'écart dépasse la tolérance. Dépenses et paiements fournisseurs passent par la validation.
- **Comptabilité SYSCOHADA** : écritures automatiques (ventes, encaissements, dépenses validées, factures fournisseurs, écarts, remises) régénérées sans doublon, saisie manuelle équilibrée, **visa**, levée de visa (administrateur, motif tracé), **contre-passation**, clôture et réouverture d'exercice avec à-nouveaux, états et **export FEC**.
- **Pièces imprimables** (onglet *Caisse → Pièces*, `etats.js`) : journal de caisse du jour, **état de clôture signé** (fonds, comptage, écart, explication, visa, signatures) et **bordereau de remise** banque/direction, à imprimer ou enregistrer en PDF.
- **Pilotage** (menu *Pilotage*, `pilotage.js`, admin / chef / comptable) : écarts par caissier, délais et taux de rejet de la validation, demandes en attente, motifs de rejet, trésorerie (caisse, remises en transit) et flux journaliers ; export CSV.
- **Côté serveur** : `supabase/migrations/20261123_caisse_compta.sql` applique les mêmes règles par triggers et RLS (45 tests dans `supabase/tests/caisse_compta.test.sql`).

### Moteur d'impression et QR de sécurité (`impression.js`, `qr.js`, `verif.html`)

- **Entête entreprise** sur tous les documents imprimés : **logo** (Paramétrage → Identité de l'entreprise), raison sociale, coordonnées, RCCM/CC. Les impressions existantes en bénéficient sans modification (le moteur enveloppe `getCompanyPrintHeader`, `getCompanyPrintFooter` et `window.open`).
- **QR code de sécurité en pied de document** : numéro `AG-XXXXXXXXXX`, empreinte SHA-256 du contenu imprimé, émetteur et date. Un même contenu garde le même numéro (le compteur d'impressions augmente) ; un contenu modifié change de numéro. Option désactivable dans Paramétrage.
- **Vérification publique** : le QR ouvre `verif.html`, qui interroge la fonction SQL `verifier_document` (identifiant + partie secrète de l'empreinte) et affiche type, référence, date et émetteur à comparer avec le papier. Les documents sont enregistrés dans la table synchronisée `documents_imprimes` (immuable côté serveur : `supabase/migrations/20261124_documents_imprimes.sql`, 16 tests dans `supabase/tests/documents_imprimes.test.sql`).
- Un document imprimé hors ligne n'est vérifiable qu'après synchronisation. `qr.js` est la bibliothèque *qrcode-generator* de Kazuhiko Arase (licence MIT).

### Base de données (Supabase)

- 30 tables « document » : `id` (texte) + `data` (JSON de l'enregistrement) + `updated_at` ; plus la table `profiles` (`login`, `nom`, `role`, `pages`, `statut`).
- **RLS activée partout**, aucun accès pour un visiteur non connecté ; droits par rôle (atelier, commercial, clients/véhicules, finance, personnel) via la fonction `app_role()`.
- Migrations SQL dans `supabase/migrations/` (à exécuter dans *SQL Editor* ; la table `config` et les index de réception incrémentale s'y trouvent).
- Le projet est configuré dans `index.html` (`_SUPA_URL`, `_SUPA_KEY`). La clé est **publique** (*publishable*) : la sécurité repose sur la RLS, jamais sur le secret de cette clé.

## Mise en ligne

Déploiement continu sur **Vercel** depuis la branche `main` (aucune compilation). Pour publier : proposer les changements par *Pull Request*, puis fusionner.

**Créer un utilisateur** : Supabase → *Authentication → Users → Add user* (e-mail + mot de passe, *Auto Confirm User*), puis ajouter sa ligne dans `profiles` avec son `role` (`admin`, `chef`, `meca`, `caissier`, `custom`) et `statut = 'actif'`. Désactiver les inscriptions libres : *Authentication → Sign In / Providers → Email*.

## Essayer en local

```bash
python3 -m http.server 8000     # puis ouvrir http://localhost:8000
```

Le service worker et la connexion sécurisée (`crypto.subtle`) demandent `localhost` ou HTTPS.

## Limites connues

- Côté serveur, le rôle **Personnalisé** peut lire et écrire l'atelier, le commercial, les clients/véhicules et les finances, mais **pas le personnel** ; la liste de modules choisie ne restreint que les menus affichés.
- En mode local (identifiant sans `@`), la protection repose sur le navigateur de l'appareil : à réserver à un poste de confiance.
- Les modules Flotte et Diagnostic conservent leurs données dans le stockage du navigateur ; après une réception cloud, la page se recharge une fois pour les afficher.
- Aucun test automatisé n'est encore intégré au dépôt.
