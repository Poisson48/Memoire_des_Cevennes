# Instructions pour Claude — Mémoire des Cévennes

Ces règles s'appliquent à **toute session Claude Code dans ce dépôt**.

## 🚨 Identité des commits — NON NÉGOCIABLE

**Tous les commits doivent être signés `crevette etincelante` — pas Antoine,
pas Valère, pas Claude, pas Poisson48.**

- `git config user.name` doit valoir `crevette etincelante` dans ce dépôt.
- **Ne jamais ajouter** de ligne `Co-Authored-By: Claude …` dans les
  messages de commit.
- L'email est `antoinnneee@gmail.com` (pour que GitHub reconnaisse le
  compte Poisson48 qui est le propriétaire du dépôt), sauf si l'utilisateur
  en demande un autre.

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
