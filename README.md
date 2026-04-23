# Mémoire des Cévennes

Carte interactive pour **préserver la mémoire vivante des Cévennes** : photos,
témoignages (écrits et audio), récits, dessins et notes attachés à des lieux
précis de la carte.

Le projet a pour but de **recueillir la parole des anciens** autant que les
histoires contemporaines, et de les rattacher géographiquement à la vallée, au
hameau, au mazet ou au chemin où elles prennent sens.

## 👀 Aperçu en ligne

Preview du design, **lecture seule** (pas d'ajout, pas d'upload) :

👉 **<https://poisson48.github.io/Memoire_des_Cevennes/>**

La version complète (création de lieux, upload de photos/audio/vidéo…)
tourne sur serveur Node — voir *Démarrer en local* ci-dessous.

---

## Démarrer en local

Prérequis : Node 18+, git, un navigateur.

```bash
./run.sh            # lance le serveur sur le port 3003
PORT=3005 ./run.sh  # port personnalisé
./run.sh --no-pull  # skip git pull
./run.sh --no-open  # ne lance pas le navigateur
```

Ou à la main :

```bash
npm install
npm start           # node server.js
```

Puis ouvre <http://localhost:3003>.

## Ce que tu peux faire aujourd'hui (v0.1)

- Voir la carte des Cévennes avec les lieux déjà enregistrés.
- Cliquer sur un marqueur pour afficher le lieu, sa description et tous ses
  contenus (photos, audio, textes).
- **Ajouter un lieu** : bouton « + Ajouter un lieu » puis clic sur la carte.
- **Ajouter un contenu** à un lieu :
  - Histoire / témoignage écrit
  - Photo (JPG/PNG/WebP/GIF)
  - Enregistrement audio (MP3/WAV/OGG/WebM/M4A)
  - Dessin (image)
  - Note courte
  - PDF (pour documents scannés, lettres…)

## Arborescence

```
memoire_des_cevennes/
├── server.js             # Express + Multer
├── package.json
├── run.sh                # pull + install + start + open
├── data/
│   └── places.json       # lieux + contenus (texte), versionné dans git
├── uploads/              # médias binaires, NON versionnés (voir plus bas)
├── public/               # frontend vanilla (HTML + Leaflet)
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
├── src/
│   └── data-manager.js   # lecture/écriture de places.json
└── tests/                # playwright (à venir)
```

## Stockage

- **`data/places.json`** : structure du site — lieux (lat/lng, titre,
  description) et contenus texte. Versionné dans git, on peut donc suivre
  l'évolution de la collection dans l'historique.
- **`uploads/`** : fichiers binaires (photos, audio, PDF…). **Ignorés par git**
  par défaut pour éviter de gonfler le dépôt. Stratégies possibles pour la
  suite :
  - sauvegarde manuelle (`rsync`, disque externe)
  - passage à Git LFS
  - ou un bucket externe (S3 / Backblaze / OVH) avec URL publique.

## Pourquoi ce projet

Les Cévennes sont riches de mémoires qui risquent de se perdre : récits de la
guerre, vie pastorale, châtaigneraies, crues, magnanaries, petits métiers,
toponymes oubliés. L'idée : un outil simple pour que **n'importe qui puisse
épingler un lieu et y déposer un souvenir**, une photo de famille ou la voix
d'un ancien.

## Contribuer

Le projet est volontairement minimaliste. Les idées, retours, récits et
contributions techniques sont bienvenus — ouvre une issue ou une PR.

## Licence

À définir (probablement CC-BY-SA pour les contenus, MIT pour le code).

---

*Un petit outil pour que les pierres des Cévennes continuent de raconter
leur monde.*
