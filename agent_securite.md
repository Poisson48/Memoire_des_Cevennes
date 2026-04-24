Mission : Implémenter l'Option C via un sous-agent autonome
Ta mission immédiate
Tu ne codes pas l'Option C toi-même.
Tu dois :
Lire ce fichier et les fichiers clés du projet
Générer un script agent/run.js — un orchestrateur autonome Node.js
Installer ses dépendances
Le lancer via bash
Le sous-agent fait tout le travail de code, fichier par fichier, jusqu'à la fin
Ce que doit faire le sous-agent (agent/run.js)
Architecture du sous-agent
Le script appelle l'API Anthropic (claude-sonnet-4-20250514) en boucle agentique :
Il lit le contenu réel des fichiers du projet (fs.readFileSync)
Il envoie le contexte + la tâche courante à Claude
Il reçoit les modifications à apporter (fichier complet)
Il applique les modifications sur le disque
Il passe à l'étape suivante
Il recommence jusqu'à ce que toutes les étapes soient terminées
Il écrit un rapport final dans agent/rapport.md
Pattern de la boucle principale
Js
Fichiers injectés par étape
Étape
Fichiers à lire
install_deps
package.json
create_auth_module
src/storage.js, src/schema.js
create_middleware
src/auth.js
update_server_routes
server.js, src/auth.js, src/middleware.js
update_schema
src/schema.js, data/places.json, data/people.json, data/stories.json
update_storage
src/storage.js
filter_get_routes
server.js, src/middleware.js
update_post_routes
server.js, src/middleware.js
create_login_html
public/index.html
create_register_html
public/login.html
update_admin_html
public/admin.html, public/js/admin.js
update_app_js
public/js/app.js
write_rapport
agent/activity.log
Format de réponse JSON attendu de Claude
Le prompt système demande à Claude de répondre UNIQUEMENT en JSON :
Json
action: "create" → écrit le fichier complet (crée ou remplace)
shell → tableau de commandes exécutées via execSync après écriture des fichiers
next → loggé dans agent/activity.log
Prompt système du sous-agent
Code
Spécifications fonctionnelles Option C
Nouvelles dépendances npm
Code
Nouveaux fichiers de données
data/members.json → []
data/activity_log.json → []
src/auth.js
createMember(email, password, name) → hash bcrypt, status pending
approveMember(id) → status approved
setRole(id, role) → member | contributor | admin
login(email, password) → vérifie hash + status, retourne JWT signé
verifyToken(token) → décode JWT ou retourne null
src/middleware.js
requireAuth(minRole) → lit cookie token, vérifie JWT, vérifie rôle, sinon 401/403
optionalAuth() → attache req.member ou null, ne bloque jamais
Hiérarchie des rôles : member < contributor < admin
server.js
Ajouter cookie-parser
Routes : POST /api/auth/register, POST /api/auth/login, POST /api/auth/logout, GET /api/auth/me
optionalAuth() sur toutes les routes GET
requireAuth("contributor") sur toutes les routes POST de création
requireAuth("admin") sur toutes les routes /api/admin/*
Compatibilité X-Admin-Token maintenue sur les routes admin
Routes GET — filtrage visibility
req.member null → visibility: "public" uniquement, champs name/bio/aliases masqués sur people
req.member présent → tout le contenu approuvé
Routes POST création — vérifications
req.body.consentGiven !== true → 400
Logger dans activity_log.json : { memberId, action, entityType, entityId, timestamp, ip }
Schémas (src/schema.js)
Ajouter visibility: "public" | "members" à places, people, stories
Défaut : "members"
Routes admin membres
GET /api/admin/members
POST /api/admin/members/:id/approve
POST /api/admin/members/:id/role
GET /api/admin/activity
Frontend
public/login.html — formulaire email + mdp → POST /api/auth/login → redirect index
public/register.html — nom + email + mdp → POST /api/auth/register → message attente
public/js/app.js — GET /api/auth/me au chargement, redirect login si 401, afficher bouton ajout selon rôle, case consentement dans formulaire
public/admin.html — section membres en attente + membres actifs + log activité
Variables d'environnement
Code
Rapport final du sous-agent
agent/rapport.md doit contenir :
Fichiers créés et modifiés
Commandes npm exécutées
Variables d'environnement à configurer
Checklist de tests curl pour valider l'implémentation
Instructions pour toi (Claude Code)
Crée le dossier agent/
Génère agent/run.js complet selon les specs ci-dessus — utilise https natif Node 18+ (pas de node-fetch)
Lance node agent/run.js depuis la racine du repo
Surveille agent/activity.log en temps réel
Une fois terminé, lis agent/rapport.md et résume ce qui a été fait
