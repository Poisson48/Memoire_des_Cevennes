# Instructions pour Claude — Mémoire des Cévennes

Ces règles s'appliquent à **toute session Claude Code dans ce dépôt**.

## 🚨 Identité des commits — NON NÉGOCIABLE

**Tous les commits doivent être signés `crevette etincelante` — pas Antoine,
pas Valère, pas Claude, pas Poisson48.**

- `git config user.name` doit valoir `crevette etincelante` dans ce dépôt.
- **Ne jamais ajouter** de ligne `Co-Authored-By: Claude …` dans les
  messages de commit.
- L'email est `leohaize@etik.com`, sauf si l'utilisateur en demande un
  autre.

Avant tout commit, vérifier :
```bash
git config user.name     # doit afficher : crevette etincelante
```

Si ce n'est pas le cas : `git config user.name "crevette etincelante"`.

## 🔐 Push — clé SSH Poisson48

Le dépôt distant `Poisson48/Memoire_des_Cevennes` utilise la clé SSH dédiée.
Toujours pusher via :

```bash
GIT_SSH_COMMAND='ssh -i ~/.ssh/id_ed25519_poisson48 -o IdentitiesOnly=yes' git push
```

L'alias `github-poisson48` est configuré dans `~/.ssh/config` — le remote
`origin` pointe déjà sur `git@github-poisson48:Poisson48/Memoire_des_Cevennes.git`.

## 🔢 Versioning — semver, à incrémenter à chaque commit

Le numéro de version dans `package.json` reflète l'état du programme,
pas un calendrier de release. Convention :

- **Patch** (`0.4.0` → `0.4.1`) : bug fix, correction de doc, chore,
  régénération de captures, ajustement mineur d'UI.
- **Minor** (`0.4.0` → `0.5.0`) : nouvelle fonctionnalité visible
  utilisateur (nouvelle section, nouveau bouton, nouvelle API).
- **Major** (`0.x.y` → `1.0.0`) : refonte importante ou changement
  cassant (incompatible avec les versions précédentes).

À chaque commit :
1. Bumper `package.json` (clé `version`) selon la nature du change.
2. Préfixer le sujet du commit avec `vX.Y.Z :` (ex.
   `v0.7.0 : page d'accueil personnalisable`).

Le changelog `/api/changelog` lit les sujets de commits matchant
`^v[0-9]+\.[0-9]+` et les présente à l'utilisateur — un commit non
préfixé n'apparaît pas.

## 🔄 Preview GitHub Pages — pousser souvent

Le workflow `.github/workflows/pages.yml` redéploie à chaque push sur
`main`. L'utilisateur s'en sert comme aperçu visuel — **pusher après
chaque étape significative**, pas attendre de grouper 10 commits.

Preview : <https://poisson48.github.io/Memoire_des_Cevennes/>

## 🧭 Focale géographique

Le projet est **centré sur Saint-Roman-de-Codières** (43.9881, 3.7439) et
ses alentours dans le premier temps. Une ouverture plus large sur
l'ensemble des Cévennes viendra plus tard. Ne pas re-centrer la carte sur
un autre point sauf demande explicite.

## 🛡️ Modération — principes

- Toute création (Lieu / Personne / Récit) atterrit en `status: pending`.
- Toute proposition de modification (fichier `data/edits.json`) entre
  aussi en file.
- L'admin (token partagé `ADMIN_TOKEN`) valide depuis `/admin.html` ou
  via `/api/admin/*`.
- Modèle inspiré de Wikipédia : diff avant/après, note de modification,
  audit avec horodatage et reviewer.

## 🧱 Stack et conventions

- Node 18+ / Express / Multer (v2).
- Frontend vanilla (pas de build step), Leaflet pour la carte.
- Données dans `data/*.json`, médias dans `uploads/` (git-ignored).
- Tests Playwright prévus mais non en place.
- Le port par défaut est `3003`. Pour les scripts (ex. captures), préférer
  un port non usuel (`3199`) pour éviter les collisions avec d'autres
  projets locaux.

## 📸 Captures d'écran

`scripts/screenshots.js` capture 9 vues (desktop, mobile, admin,
dialogs…) via Playwright. À relancer quand l'UI change visiblement,
avant de pousser :

```bash
PORT=3199 ADMIN_TOKEN=dev node server.js &
sleep 2
PORT=3199 ADMIN_TOKEN=dev node scripts/screenshots.js
```

Les captures vivent dans `docs/screenshots/` et sont référencées par le
README.

## 💾 Sauvegardes / Export / Import

Le module `src/backup.js` produit des archives `.tar.gz` autoporteuses
(données + médias + manifest avec sha256). Stockées dans `backups/`
(git-ignoré). UI dans l'onglet « Sauvegardes » de `/admin.html`, API sous
`/api/admin/backups`, `/api/admin/export`, `/api/admin/import`.

**Format de l'archive** :
- `manifest.json` à la racine : `schemaVersion`, `appVersion`, `createdAt`,
  `kind` (`manual` / `pre-restore` / `export` / `import` / `auto`),
  `files` (sha256 par fichier JSON), inventaire `uploads`, flag
  `encrypted`.
- `data/*.json` (places, people, stories, edits, members, reports,
  activity_log) — `data/seeds/` exclu.
- `uploads/` — médias attachés aux récits.

**Versionnage** : `SCHEMA_VERSION` est un entier dans `src/backup.js`. Le
**bumper** (et ajouter une migration dans l'objet `MIGRATIONS`) à chaque
fois qu'on change la forme d'une entité (renommage de champ, etc.). Les
migrations sont chaînées de la version source vers la version courante au
moment du restore. Un import en schéma supérieur au serveur est refusé
(message clair : « Mets à jour le serveur avant d'importer »).

**Sécurités** :
- Avant chaque restore/import, snapshot `pre-restore` automatique (sauf si
  l'archive est invalide → on n'en crée pas).
- Vérification sha256 de chaque fichier JSON avant écrasement.
- Path traversal bloqué (regex sur l'ID, options tar conservatrices).
- Toutes les opérations journalisées dans `data/activity_log.json`.

**Migrer le site sur un autre serveur** : onglet Sauvegardes →
« Exporter tout » → copier le `.tar.gz(.enc)` sur la nouvelle machine →
« Importer une archive… » sur la nouvelle instance admin. Si l'archive
est chiffrée, la nouvelle instance doit avoir la **même
`BACKUP_PASSPHRASE`** dans son `.env`.

**Chiffrement** : si `BACKUP_PASSPHRASE` est défini, toutes les archives
créées sont chiffrées AES-256-GCM (extension `.tar.gz.enc`, scrypt N=2¹⁴).
Conserver la passphrase ailleurs (gestionnaire de mots de passe) — sans
elle, les archives chiffrées sont irrécupérables.

**Sauvegardes périodiques** : `BACKUP_AUTO_INTERVAL_HOURS` active un timer
qui crée un backup `kind="auto"` toutes les N heures. `BACKUP_AUTO_KEEP`
borne combien on en garde (par défaut 14). Les snapshots `pre-restore`
sont eux bornés par `BACKUP_AUTO_PRE_RESTORE_KEEP` (défaut 10).

**Aperçu stockage** : `GET /api/admin/storage` → tailles `data/`,
`uploads/`, `backups/` (ventilation par kind) + espace libre du disque
via `fs.statfs`. Affiché en haut de l'onglet Sauvegardes avec une barre
de remplissage qui passe au rouge en dessous d'1 Go libre.
