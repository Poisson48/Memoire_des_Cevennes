# Rapport de l'agent autonome — Implémentation Option C

**Branche** : `feature/auth-option-c`
**Date** : 2026-04-24
**Modèle** : `claude-sonnet-4-6` (via `claude --print`, OAuth Max, pas de facturation API)

## Résultat de la boucle : 10 OK / 3 KO

| # | Étape | Statut | Notes |
|---|---|---|---|
| 1 | `install_deps`          | ✓ | package.json + `npm install bcryptjs jsonwebtoken cookie-parser` |
| 2 | `create_auth_module`    | ✓ | `src/auth.js`, `data/members.json`, `data/activity_log.json` |
| 3 | `create_middleware`     | ✓ | `src/middleware.js` (requireAuth/optionalAuth + compat X-Admin-Token) |
| 4 | `update_schema`         | ✖ | Claude CLI a planté (probablement `--max-budget-usd 0.30` dépassé) |
| 5 | `update_storage`        | ✓ | `src/storage.js` + migration auto `visibility="members"` au boot |
| 6 | `update_server_routes`  | ✓ | `server.js` (cookie-parser + montage) + `src/routes/auth.js` |
| 7 | `filter_get_routes`     | ✓ | Filtrage visibility dans places/people/stories routers |
| 8 | `update_post_routes`    | ✓ | Ajout `consentGiven` + `logActivity` + `src/activityLog.js` |
| 9 | `create_login_html`     | ✓ | `public/login.html` (134 lignes) |
| 10 | `create_register_html` | ✓ | `public/register.html` (196 lignes, consent checkbox) |
| 11 | `update_admin_html`    | ✖ | Claude CLI planté (même cause) |
| 12 | `update_app_js`        | ✓ | `public/js/app.js` réécrit (26 Kb) |
| 13 | `write_rapport`        | ✖ | Réponse tronquée — rapport écrit manuellement (ce fichier) |

**Coût observé** : ~$1.10 équivalent API sur 10 appels réussis. Sous abonnement Max OAuth → **zéro facturation**, uniquement du quota.

## Corrections manuelles appliquées après la boucle

### Dettes techniques des étapes KO

- **Étape 4 (update_schema)** : `src/schema.js` — ajout du champ `visibility` dans `makePlace`, `makePerson`, `makeStory` avec défaut `"members"`. `makePerson` honore aussi `isLiving: true` qui force `visibility="members"`.
- **Étape 11 (update_admin_html)** : `public/admin.html` + `public/js/admin.js` — ajout de deux onglets (Membres, Journal d'activité), `refreshMembers()` / `refreshActivity()`, actions approuver + changer rôle.

### Bugs introduits par l'agent

- **Format `data/members.json`** et **`data/activity_log.json`** : `src/storage.js` les créait en wrapper `{members:[],updatedAt:...}` alors que `src/auth.js` et `src/activityLog.js` les lisent en tableau plat. → Retiré `ensureFile` pour ces deux fichiers dans `storage.js`, et reformaté les fichiers en `[]`.
- **JWT payload** : l'agent signait `{ sub, email, name, role }` mais les routes référençaient `req.member.id`. → Ajout de `normalizeMember()` dans `src/middleware.js` qui expose `.id = .sub`.
- **Route admin membres manquante** : pas de `GET /api/admin/members`, `POST approve`, `POST role`, `GET activity`. → Ajoutées dans `src/routes/admin.js`.
- **Charte acceptée non tracée** : `createMember` n'enregistrait pas le `charterAcceptedVersion` / `charterAcceptedAt`. → Ajouté dans `src/auth.js` et l'inscription rejette le body sans `consentGiven:true`.

## Fichiers créés ou modifiés

### Créés par l'agent
```
data/members.json        data/activity_log.json
src/auth.js              src/activityLog.js
src/routes/auth.js
public/login.html        public/register.html
```

### Créés manuellement après
```
data/reports.json
src/routes/reports.js
scripts/seed-admin.js    scripts/backup.sh    scripts/rgpd-delete.js
public/signaler.html
public/legal/mentions.html            public/legal/confidentialite.html
public/legal/charte-contributeur.html public/legal/consentement-temoin.html
public/css/legal.css
docs/registre-traitements.md
docs/deploy-vps.md
.env.example   .env (local, git-ignoré)
agent/run.js   agent/rapport.md   agent/activity.log   agent/transcripts/
```

### Modifiés
```
server.js            (cookie-parser + auth router + reports router + optionalAuth global)
src/middleware.js    (normalizeMember, requireAuth, optionalAuth)
src/storage.js       (migration visibility + retrait ensureFile members/activity_log)
src/schema.js        (champ visibility + isLiving)
src/routes/places.js src/routes/people.js src/routes/stories.js (filtrage + consent)
src/routes/admin.js  (routes membres + activité)
public/js/app.js     (sensiblement étendu par l'agent, non relu manuellement)
public/admin.html    public/js/admin.js (onglets membres + activité)
public/index.html    public/login.html  public/register.html (footer légal)
package.json         package-lock.json  (bcryptjs, jsonwebtoken, cookie-parser)
```

## Commandes npm exécutées

```bash
npm install
npm install --save bcryptjs jsonwebtoken cookie-parser
```

## Variables d'environnement

Voir `.env.example`. En prod :

- `JWT_SECRET` — OBLIGATOIRE. Généré via `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.
- `ADMIN_TOKEN` — Token partagé pour les routes admin. À régénérer en prod.
- `COOKIE_SECURE=true` en prod (HTTPS uniquement).
- `PORT=3003` par défaut.

## Checklist curl

```bash
# Boot
curl -sf http://localhost:3003/api/places

# Inscription
curl -X POST http://localhost:3003/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"name":"X","email":"x@y.fr","password":"password123","consentGiven":true}'

# Admin approve (nécessite ADMIN_TOKEN)
MID=$(node -e "console.log(JSON.parse(require('fs').readFileSync('data/members.json')).find(m=>m.email==='x@y.fr').id)")
curl -X POST http://localhost:3003/api/admin/members/$MID/approve -H 'X-Admin-Token: dev'
curl -X POST http://localhost:3003/api/admin/members/$MID/role     -H 'X-Admin-Token: dev' -H 'Content-Type: application/json' -d '{"role":"contributor"}'

# Connexion
curl -c c.txt -X POST http://localhost:3003/api/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"x@y.fr","password":"password123"}'

# Profil
curl -b c.txt http://localhost:3003/api/auth/me

# Création (doit passer, req.member.id doit être défini)
curl -b c.txt -X POST http://localhost:3003/api/places \
  -H 'Content-Type: application/json' \
  -d '{"primaryName":"Test","lat":44,"lng":3.8,"consentGiven":true,"submittedBy":{"name":"X"}}'

# Création anonyme (doit 401)
curl -X POST http://localhost:3003/api/places \
  -H 'Content-Type: application/json' \
  -d '{"primaryName":"Nope","lat":44,"lng":3.8}'

# Signalement
curl -X POST http://localhost:3003/api/reports \
  -H 'Content-Type: application/json' \
  -d '{"target":"x","category":"privacy","description":"test"}'
```

Tous ces tests ont été exécutés avec succès avant la publication du rapport.

## Ce qui reste à faire (humain)

- Finir la constitution de l'association (RNA en préfecture du Gard).
- Remplir les `<span data-todo>...</span>` dans les pages légales avec les vraies informations (RNA, adresse, nom du président, hébergeur, email de contact).
- Faire signer un formulaire de consentement papier aux témoins enregistrés (cf. `public/legal/consentement-temoin.html`, imprimable).
- Mettre en place les sauvegardes hors VPS (rsync périodique vers un disque perso).
- Relecture de `public/js/app.js` — le fichier a été réécrit par l'agent (de 571 à 663 lignes), je n'ai pas passé chaque changement en revue.
