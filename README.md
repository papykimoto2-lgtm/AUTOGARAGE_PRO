# AutoGarage Pro

Logiciel de gestion de garage automobile : clients, véhicules, ordres de réparation, diagnostic et devis, stock, facturation, caisse, flotte d'entreprise, visites techniques et rapports. Fonctionne **sur ordinateur, tablette et téléphone**, **hors ligne**, avec synchronisation cloud et rôles par utilisateur.

Développé par **SANIX AFRICA — Division Technologies** · 📞 +225 07 79 18 10 75 · ✉️ sanixafrica699@gmail.com

**En ligne :** https://autogarage-pro.vercel.app · **Essai sans risque :** `/demo.html` (données fictives, rien n'est envoyé au cloud)

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
| Paramétrage | Entreprise, utilisateurs et sécurité, sauvegarde, synchronisation |

Aides intégrées : recherche globale (`/` ou `Ctrl+K`), **aide** (`?` ou `F1`), **mode jour / nuit / auto** (bouton ☀️/🌙 en haut, choix dans le menu) et six couleurs d'accent, installation comme application (PWA). Le mode jour utilise des couleurs foncées pour rester lisible en plein soleil (contraste vérifié automatiquement sur toutes les pages).

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
| Personnalisé | Liste de modules choisie par l'administrateur |

## Connexion et données

- **E-mail + mot de passe** : session **Supabase Auth**. Le rôle est lu dans la table `profiles` et **appliqué par le serveur** (RLS) : un utilisateur ne peut pas s'accorder plus de droits depuis son navigateur.
- **Identifiant sans `@`** : mode **local hors ligne**, données de l'appareil uniquement, sans synchronisation.
- Les données sont d'abord enregistrées **sur l'appareil**, puis synchronisées vers le cloud (pastille *Synchronisé / Hors ligne* en haut). Première connexion : envoi des données locales ; ensuite : envoi des modifications puis réception.
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
| `install.js` / `install.css` | Installation de l'application : un clic (Chrome, Edge, Samsung Internet) ou mode d'emploi par appareil (iPhone/iPad, Mac, Firefox) |
| `sw.js`, `manifest.webmanifest`, `icon*.png`, `apple-touch-icon.png`, `icon.svg` | Fonctionnement hors ligne, installation (PWA) et icônes |

### Base de données (Supabase)

- 30 tables « document » : `id` (texte) + `data` (JSON de l'enregistrement) + `updated_at` ; plus la table `profiles` (`login`, `nom`, `role`, `pages`, `statut`).
- **RLS activée partout**, aucun accès pour un visiteur non connecté ; droits par rôle (atelier, commercial, clients/véhicules, finance, personnel) via la fonction `app_role()`.
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
