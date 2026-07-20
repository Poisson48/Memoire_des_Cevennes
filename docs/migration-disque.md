# Plan de migration vers le second disque

Document de préparation. **Rien n'a été exécuté.** Relevé fait le 2026-07-20.

## 1. Constat

| Disque | Montage | Taille | Utilisé | Libre | Occupation |
|---|---|---|---|---|---|
| `nvme1n1p2` | `/` | 116 Go | 103 Go | **7,2 Go** | **94%** |
| `nvme0n1p1` | `/data` | 234 Go | 12 Go | **211 Go** | 6% |

`/data` est monté depuis `/etc/fstab` (`UUID=14c42b82-…`, options `defaults,nofail`),
donc le montage survit au redémarrage.

### Ce que pèse vraiment Mémoire des Cévennes

```
975 Mo au total
  515 Mo  data/          dont 515 Mo pour data/import (lot de travail, non versionné)
  136 Mo  vendor/        binaires OCR + TTS (Piper, tessdata)
  126 Mo  .git/
   65 Mo  docs/          captures d'écran
   44 Mo  backups/       archives .tar.gz
   32 Mo  public/
   26 Mo  uploads/       34 fichiers, médias des récits
   22 Mo  node_modules/
```

### Ce qui remplit réellement la racine

```
39 Go  /home        dont camera-tapo 22 Go, leo 13 Go, meow-server 5,6 Go
10 Go  /var         dont /var/lib 8,2 Go, /var/log 1,7 Go
9,2 Go /usr
1,6 Go /opt
```

Dans `/home/leo` (13 Go) : `claude_workspace` 4,6 Go, `leo` 3,6 Go, `src` 2,0 Go,
`.local` 1,3 Go.

> **Point important à trancher avant de lancer quoi que ce soit.**
> Notre projet représente **975 Mo sur 103 Go**, soit **moins de 1%** de
> l'occupation. Le déplacer fera passer l'espace libre de 7,2 à environ
> 8,2 Go : cela **ne résout pas la saturation**. Les vrais postes sont
> `camera-tapo` (22 Go) et le reste de `/home/leo`, qui ne relèvent pas de
> ce projet.
>
> La migration reste justifiée, mais pour une autre raison : **la
> croissance à venir**. Les uploads (photos, audio, vidéo des témoignages)
> et les sauvegardes automatiques sont les seuls postes du projet destinés
> à grossir sans limite. Les mettre sur un disque à 211 Go libres évite
> qu'un jour un contributeur ne remplisse la racine et fasse tomber
> l'ensemble de la machine, pas seulement le site.

## 2. Cohabitation : ce qu'il ne faut surtout pas toucher

`/data` ne nous appartient pas :

```
drwxr-xr-x  meow-server:meow-server  /data
drwx--x---  root:root                /data/docker      <-- CRITIQUE
drwx------  root:root                /data/lost+found
drwxr-xr-x  valou:root               /data/pomme
```

- **`/data/docker` est un point de montage bind** vers
  `/var/snap/docker/common/var-lib-docker` (déclaré dans `/etc/fstab`).
  Toutes les images et volumes Docker de la machine vivent là. Y toucher,
  même en lecture récursive maladroite, peut casser tous les conteneurs.
  **On ne descend jamais dans ce répertoire.**
- **`/data/pomme`** appartient à `valou`. Hors de notre périmètre.
- `/data` étant en `755` et détenu par `meow-server`, l'utilisateur `leo`
  **ne peut pas y créer de répertoire lui-même**. Il faudra un `sudo` pour
  la création initiale, puis on rend le répertoire à `leo`.

Règle de conduite : on crée **un seul** répertoire, `/data/memoires-cevenoles`,
on le met en `leo:leo` mode `750`, et on ne sort jamais de cette
arborescence.

## 3. Contrainte technique déterminante

Le code résout **tous** ses chemins en relatif depuis son propre
emplacement (`path.join(__dirname, …)`), sur une vingtaine de points :

```
server.js:30            DATA_DIR    = __dirname/data
src/upload.js:8         UPLOADS_DIR = __dirname/../uploads
src/backup.js:30-32     DATA_DIR, UPLOADS_DIR, BACKUPS_DIR = REPO_ROOT/…
src/auth.js:9-10        members.json, activity_log.json
src/routes/*.js         reports.json, bugs.json, …
```

**Aucun de ces chemins n'est pilotable par variable d'environnement.**
Conséquence : déplacer le projet entier ne demande aucune modification de
code, alors que déplacer seulement `data/` et `uploads/` demanderait soit
des liens symboliques, soit un refactor pour centraliser les chemins.

Une seule référence absolue existe hors du dépôt :
`/etc/systemd/system/memoires-cevenoles.service`
(`WorkingDirectory=` et `Documentation=`). Aucun cron, aucun autre service.

## 4. Deux stratégies

### Stratégie A : déplacer tout le projet (recommandée)

`/home/leo/leo/memoire_des_cevennes` devient `/data/memoires-cevenoles/app`.

**Pour** : aucun changement de code, les chemins relatifs restent valides,
une seule ligne de systemd à changer, rollback trivial (on remet le
répertoire en place). Le dépôt git, les données, les médias et les
sauvegardes restent d'un seul tenant, donc les sauvegardes continuent de
fonctionner à l'identique.

**Contre** : le répertoire de travail change, donc les habitudes aussi. Et
surtout, voir le point 6 sur la mémoire de Claude Code.

### Stratégie B : ne déplacer que les données lourdes

On garde le code sur la racine (environ 380 Mo) et on déporte `data/`,
`uploads/` et `backups/` (environ 585 Mo) via liens symboliques ou montages
bind.

**Pour** : le chemin du projet ne bouge pas.

**Contre** : trois points de montage à maintenir au lieu d'un ; risque
d'échec des écritures atomiques si un `rename()` traverse une frontière de
système de fichiers (erreur `EXDEV`) ; le module de sauvegarde archive des
répertoires devenus des liens, ce qui demanderait de vérifier le
comportement de `tar` ; et l'ensemble devient plus difficile à
comprendre pour la personne qui reprendra la machine.

**Recommandation : stratégie A.** La B n'a d'intérêt que si on tient
absolument à ne pas bouger le chemin du projet.

## 5. Déroulé proposé (stratégie A)

Durée estimée : 20 à 30 minutes, dont environ **2 minutes d'interruption
du site**. À faire à un moment creux.

### Étape 0 : filet de sécurité

```bash
# Sauvegarde complète AVANT toute manipulation, depuis l'admin du site
# (onglet Sauvegardes -> « Exporter tout ») ou en ligne de commande.
# Copier l'archive obtenue AILLEURS que sur cette machine.
```

Vérifier aussi que le dépôt est propre et poussé :

```bash
cd /home/leo/leo/memoire_des_cevennes
git status --short          # doit être vide (hors fichiers ignorés)
git log origin/main..HEAD   # doit être vide
```

### Étape 1 : préparer l'emplacement sur le second disque

```bash
sudo mkdir -p /data/memoires-cevenoles
sudo chown leo:leo /data/memoires-cevenoles
chmod 750 /data/memoires-cevenoles
# Contrôle : on n'a rien touché d'autre
ls -la /data/
```

Attendu : `docker`, `lost+found` et `pomme` strictement inchangés.

### Étape 2 : copier (sans supprimer l'original)

```bash
sudo systemctl stop memoires-cevenoles.service

rsync -aHAX --info=progress2 \
  /home/leo/leo/memoire_des_cevennes/ \
  /data/memoires-cevenoles/app/

# Vérification d'intégrité : aucune différence attendue
rsync -aHAXn --delete --itemize-changes \
  /home/leo/leo/memoire_des_cevennes/ \
  /data/memoires-cevenoles/app/
```

On **copie**, on ne déplace pas : l'original reste intact comme filet
jusqu'à validation complète.

### Étape 3 : pointer le service sur le nouvel emplacement

```bash
sudo sed -i 's#/home/leo/leo/memoire_des_cevennes#/data/memoires-cevenoles/app#g' \
  /etc/systemd/system/memoires-cevenoles.service
sudo systemctl daemon-reload
sudo systemctl start memoires-cevenoles.service
systemctl status memoires-cevenoles.service --no-pager -n 20
```

### Étape 4 : vérifications fonctionnelles

À faire dans l'ordre, en s'arrêtant au premier échec :

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:18542/          # 200
curl -s http://localhost:18542/api/places | head -c 200                    # données présentes
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:18542/data/members.json  # 404 attendu
```

Puis dans un navigateur, sur le domaine public :

- la carte s'affiche avec ses marqueurs ;
- une fiche de lieu s'ouvre et **les photos s'affichent** (vérifie
  `uploads/`) ;
- connexion membre, puis dépôt d'une entrée dans « Bug trouvé ! »
  (vérifie l'écriture dans `data/`) ;
- console admin : le journal d'activité se charge, et l'onglet Sauvegardes
  affiche l'aperçu de stockage, qui doit maintenant refléter le second
  disque ;
- **créer une sauvegarde manuelle** depuis l'admin et vérifier qu'elle
  apparaît dans la liste (vérifie `backups/` en écriture).

### Étape 5 : garder l'ancien chemin fonctionnel

Une fois tout validé, remplacer l'ancien répertoire par un lien
symbolique, pour que les habitudes et toute référence oubliée continuent
de fonctionner :

```bash
mv /home/leo/leo/memoire_des_cevennes /home/leo/leo/memoire_des_cevennes.ancien
ln -s /data/memoires-cevenoles/app /home/leo/leo/memoire_des_cevennes
```

### Étape 6 : ne supprimer l'original qu'après plusieurs jours

```bash
# Après une semaine de fonctionnement normal, et pas avant :
rm -rf /home/leo/leo/memoire_des_cevennes.ancien
```

C'est cette étape, et elle seule, qui libère l'espace sur la racine.

## 6. Points de vigilance

1. **La mémoire de Claude Code est indexée sur le chemin du projet.**
   Elle vit dans `~/.claude/projects/-home-leo-leo-memoire-des-cevennes/`.
   Si le chemin change, les sessions suivantes ne la retrouveront pas. Le
   lien symbolique de l'étape 5 peut suffire si on continue d'ouvrir
   l'ancien chemin ; sinon il faudra renommer ce répertoire de mémoire en
   `-data-memoires-cevenoles-app`. À décider au moment de la bascule.

2. **`CLAUDE.md` mentionne le chemin** dans plusieurs sections. À mettre à
   jour dans le même commit que la migration.

3. **Le `Documentation=` de l'unité systemd** pointe vers le CLAUDE.md par
   son chemin absolu. Le `sed` de l'étape 3 le corrige au passage.

4. **Permissions après rsync** : vérifier que tout appartient bien à
   `leo:leo` et que `uploads/` reste inscriptible par le service.

5. **Le fichier `.env` n'est pas versionné** : s'assurer qu'il a bien été
   copié (`ls -la /data/memoires-cevenoles/app/.env`). Sans lui, le service
   démarre sans `JWT_SECRET` et l'authentification est désactivée.

6. **`vendor/` n'est pas versionné non plus** (binaires OCR et TTS, 136 Mo).
   S'il manquait, il faudrait relancer `scripts/setup-ocr-tts.sh`.

7. **Ne jamais faire de `rsync` ni de `du` récursif sur `/data/docker`.**

## 7. Rollback

Tant que l'étape 6 n'a pas été faite, le retour en arrière est immédiat :

```bash
sudo systemctl stop memoires-cevenoles.service
rm /home/leo/leo/memoire_des_cevennes                      # le lien symbolique
mv /home/leo/leo/memoire_des_cevennes.ancien /home/leo/leo/memoire_des_cevennes
sudo sed -i 's#/data/memoires-cevenoles/app#/home/leo/leo/memoire_des_cevennes#g' \
  /etc/systemd/system/memoires-cevenoles.service
sudo systemctl daemon-reload && sudo systemctl start memoires-cevenoles.service
```

Le seul cas non couvert est celui de données écrites sur le nouveau
disque entre la bascule et le rollback (un récit déposé entre-temps).
D'où l'intérêt de faire la bascule à un moment creux et de vérifier
rapidement.

## 8. Pistes complémentaires pour la saturation

Indépendantes de cette migration, et bien plus efficaces à court terme :

| Piste | Gain estimé | Remarque |
|---|---|---|
| `/home/camera-tapo` | jusqu'à 22 Go | Pas notre projet. À voir avec qui l'exploite. |
| `/home/leo/claude_workspace` | jusqu'à 4,6 Go | Fichiers de travail, à trier. |
| `journalctl --vacuum-time=30d` | environ 1 Go | `/var/log` pèse 1,7 Go. |
| `docker system prune` | variable | Attention : impacte les autres projets, à ne pas lancer sans concertation. |
| `data/import` du projet | 515 Mo | Lot de travail des Cahiers du Haut-Vidourle. Archivable ailleurs une fois l'import terminé. |

À noter : `du` en tant que `leo` ne voit que 65 Go des 103 Go occupés, le
reste étant dans des répertoires illisibles sans privilèges. Un
`sudo du -xh -d1 /` donnerait l'image complète et permettrait peut-être de
trouver un poste plus gros que tous ceux listés ici.
