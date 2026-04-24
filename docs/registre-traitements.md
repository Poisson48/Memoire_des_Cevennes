# Registre des traitements de données personnelles

Document interne — à conserver avec les statuts de l'association. À présenter
en cas de contrôle CNIL (article 30 du RGPD).

## Coordonnées

- **Responsable de traitement** : association _[nom]_ (à compléter après
  dépôt en préfecture), RNA : _[W30XXXXXXX]_.
- **Siège social** : _[adresse]_.
- **Point de contact RGPD** : _[email]_.

## Traitements

### 1. Gestion des membres

| Champ | Valeur |
|---|---|
| Finalité | Administration de l'association (adhésion, authentification, communication) |
| Base légale | Exécution du contrat d'adhésion (art. 6-1-b RGPD) |
| Catégories de personnes | Membres actifs et anciens membres |
| Données | Nom, adresse e-mail, mot de passe (haché bcrypt), rôle, horodatages, charte acceptée |
| Destinataires | Membres du bureau de l'association (administrateurs du site) |
| Durée de conservation | Durée de l'adhésion + 5 ans (prescription comptable) |
| Transferts hors UE | Aucun |
| Mesures de sécurité | HTTPS, cookies httpOnly, mots de passe bcrypt (12 rounds), JWT signé HS256 |

### 2. Fiches patrimoniales (lieux, personnes, récits)

| Champ | Valeur |
|---|---|
| Finalité | Constitution d'un fonds patrimonial numérique sur la mémoire des Cévennes |
| Base légale | Intérêt légitime (art. 6-1-f RGPD) — documentation historique associative |
| Catégories de personnes | Habitants, anciens habitants, témoins, parents et grands-parents cités |
| Données | Nom, alias, dates de naissance/décès, biographie, relations familiales, coordonnées géographiques |
| Destinataires | Public (fiches `visibility: public`) ou membres connectés (fiches `visibility: members`) |
| Durée de conservation | Durée de vie de l'association |
| Personnes vivantes | Visibilité `members` obligatoire ; publication nominative uniquement sur consentement explicite |
| Mineurs | Consentement écrit des parents obligatoire avant publication |

### 3. Médias (photographies, enregistrements sonores, vidéo)

| Champ | Valeur |
|---|---|
| Finalité | Illustrer et documenter les récits patrimoniaux |
| Base légale | Consentement explicite du témoin (art. 6-1-a RGPD) |
| Catégories de personnes | Témoins enregistrés, personnes photographiées |
| Données | Voix, image, textes associés (transcriptions, légendes) |
| Conservation du consentement | Formulaire papier signé, archivé dans les dossiers de l'association |
| Durée de conservation | Durée de vie de l'association, sauf retrait à la demande du témoin |
| Retrait | Sur simple demande — traitement sous 30 jours |

### 4. Journal d'activité

| Champ | Valeur |
|---|---|
| Finalité | Traçabilité des contributions, prévention des abus |
| Base légale | Intérêt légitime (art. 6-1-f RGPD) — sécurité du service |
| Données | ID membre, action, type d'entité, horodatage, adresse IP |
| Destinataires | Administrateurs du site |
| Durée de conservation | 12 mois glissants |

### 5. Signalements de contenu

| Champ | Valeur |
|---|---|
| Finalité | Traitement des demandes de retrait de contenu |
| Base légale | Obligation légale (LCEN article 6-I-5) + intérêt légitime |
| Données | URL signalée, nature du problème, description, identité déclarée (facultative), IP, horodatage |
| Délai de traitement cible | 72 heures ouvrées |
| Durée de conservation | 3 ans à compter de la clôture du signalement |

## Droits des personnes

Toute personne concernée peut exercer ses droits d'accès, de rectification, de
suppression, de portabilité, de limitation et d'opposition en écrivant à
_[email de contact]_. Délai de réponse : 30 jours maximum.

Le script `scripts/rgpd-delete.js <email>` opère la suppression + anonymisation
des contributions d'un membre. Chaque exécution doit être documentée ci-dessous.

## Journal des demandes RGPD

| Date | Personne | Nature de la demande | Traitement | Responsable |
|---|---|---|---|---|
|  |  |  |  |  |

---

_Document à mettre à jour à chaque évolution significative des traitements.
Version courante : 1.0 (avril 2026)._
