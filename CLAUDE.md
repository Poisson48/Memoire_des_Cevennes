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

## 🔄 Preview GitHub Pages — pousser souvent

Le workflow `.github/workflows/pages.yml` redéploie à chaque push sur
`main`. L'utilisateur s'en sert comme aperçu visuel — **pusher après
chaque étape significative**, pas attendre de grouper 10 commits.

Preview : <https://poisson48.github.io/Memoire_des_Cevennes/>

## 🧭 Focale géographique

Le projet est **centré sur Saint-Roman-de-Codières** (44.0027, 3.7786, OSM) et
ses alentours dans le premier temps. Une ouverture plus large sur
l'ensemble des Cévennes viendra plus tard. Ne pas re-centrer la carte sur
un autre point sauf demande explicite.

## 🛡️ Modération — principes

- Toute création (Lieu / Personne / Récit) atterrit en `status: pending`.
- Toute proposition de modification (fichier `data/edits.json`) entre
  aussi en file.
- Authentification admin : deux chemins acceptés par `requireAdmin`.
  1. **Préféré** : compte membre avec `role: "admin"` connecté via
     `/admin.html` (login email + mot de passe → cookie `admin_jwt`,
     route `POST /api/auth/admin-login`).
  2. **Compatibilité** : `ADMIN_TOKEN` partagé en env, transmis par
     header `X-Admin-Token` ou cookie `admin_token`. Utile pour bootstrap
     sans compte, à éviter quand un compte admin existe.
- Modèle inspiré de Wikipédia : diff avant/après, note de modification,
  audit avec horodatage et reviewer.

## 🎫 Création de comptes — par invitation, jamais de mot de passe en clair

**Règle dure** : aucun mot de passe ne doit être généré, transmis ou
affiché par l'admin (ni par Claude). Toute création de compte (membre,
contributeur, admin) passe par une **clé d'usage unique** (format
`XXXX-XXXX-XXXX`, valable 7 jours, alphabet sans 0/O/1/I/L) que
l'admin transmet de la main à la main. Le titulaire choisit lui-même son
mot de passe sur `/reset.html` en saisissant la clé.

- API : `POST /api/admin/members` ne prend plus que `name`, `email`,
  `role`. Elle crée le membre avec `passwordHash: ""` puis génère
  l'invitation et renvoie `{ member, key, expiresAt }`.
- Code : `auth.createInvitedMember` + `passwordResets.createInvite`
  (champ `kind: "invite"` dans `data/password_resets.json`, mécanisme
  identique aux resets côté `consume()`).
- UI admin : formulaire dans l'onglet « Membres », clé affichée une
  seule fois dans la modale, réaffichable depuis l'onglet « Mots de
  passe oubliés » tant que l'invitation est `approved`.
- Pour un compte créé en CLI, ne sortir QUE la clé (pas le hash, pas
  un mdp inventé).

## 🧱 Stack et conventions

- Node 18+ / Express 4 / Multer 2.
- Frontend vanilla (pas de build step), Leaflet pour la carte.
- Données dans `data/*.json`, médias dans `uploads/` (git-ignored).
- Tests Playwright en place sur `tests/contribution-flow.test.js`
  (parcours contributeur). À étendre quand de nouvelles routes critiques
  apparaissent.
- Le port par défaut documenté dans `.env` est `3003`. **Mais** l'instance
  live que l'utilisateur teste dans le navigateur tourne sur **18542**
  (voir section ci-dessous).

## 🌐 Déploiement live — port 18542

L'utilisateur accède au site via **<http://78.122.112.36:18542/>** depuis
l'extérieur. La box ne fait pas de translation de port : `18542` externe
↔ `18542` interne en direct. Donc :

- **Lancer le serveur sur `PORT=18542`** quand on veut que l'utilisateur
  puisse tester depuis son navigateur, même si `.env` dit 3003 :
  ```bash
  set -a && . ./.env && set +a; PORT=18542 node server.js
  ```
  (laisser tourner en background — ne pas killer en fin de tâche).

- **Cette machine n'a pas de NAT loopback.** Donc `curl 78.122.112.36:18542`
  *depuis cette machine* échoue toujours, même quand le service est joignable
  depuis l'extérieur. Ce n'est pas un signe de panne. Pour vérifier la
  disponibilité publique, utiliser **check-host.net** :
  ```bash
  REQ=$(curl -sS "https://check-host.net/check-tcp?host=78.122.112.36:18542&max_nodes=4" -H "Accept: application/json")
  ID=$(echo "$REQ" | grep -oE '"request_id":"[^"]+"' | cut -d'"' -f4)
  sleep 8
  curl -sS "https://check-host.net/check-result/$ID" -H "Accept: application/json"
  ```

- ⚠ **Ne jamais utiliser `pkill -f "node server.js"` ni `pkill node`.** La
  machine héberge plusieurs autres projets Node (meownopoly, loto-dofus,
  AgentDVR…), parfois sous un autre user (`uid 1000` / `meow-server`). Pour
  arrêter notre serveur, cibler le PID exact (renvoyé par `Bash
  run_in_background`) ou `lsof -ti :18542 | xargs -r kill -9` si on est
  sûr·e que c'est notre process. Pour les scripts de capture/test internes,
  un port non usuel (`3199`) évite les collisions.

## 📸 Captures d'écran

`scripts/screenshots.js` capture 13 vues (desktop, mobile, admin, dialogs,
tagger, complétions…) via Playwright. À relancer quand l'UI change
visiblement, avant de pousser :

```bash
PORT=3199 ADMIN_TOKEN=dev node server.js &
sleep 2
PORT=3199 ADMIN_TOKEN=dev node scripts/screenshots.js
```

Le script utilise un port dédié (`3199`) pour ne pas perturber le serveur
live sur `18542`.

`scripts/capture-tuto.js` regénère uniquement les captures de la page
tutoriel (`14-tutoriel-{pc,mobile}.png`).

Les captures vivent dans `docs/screenshots/` et sont référencées par le
README et par `aide.html` (qui les charge depuis `/screenshots/`,
servi par `server.js` et copié dans `_site/screenshots/` par le workflow
GitHub Pages).

## 💾 Sauvegardes / Export / Import

Le module `src/backup.js` produit des archives `.tar.gz` autoporteuses
(données + médias + manifest avec sha256). Stockées dans `backups/`
(git-ignoré). UI dans l'onglet « Sauvegardes » de `/admin.html`, API sous
`/api/admin/backups`, `/api/admin/export`, `/api/admin/import`.

**Format de l'archive** :
- `manifest.json` à la racine : `schemaVersion`, `appVersion`, `createdAt`,
  `kind` (`manual` / `pre-restore` / `export` / `import`), `files` (sha256
  par fichier JSON), inventaire `uploads`.
- `data/*.json` (places, people, stories, edits, members, reports,
  activity_log, password_resets, site_config) — `data/seeds/` exclu.
  La liste exacte est `DATA_FILES` dans `src/backup.js`, à mettre à jour
  quand on ajoute un fichier de données.
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
