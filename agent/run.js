#!/usr/bin/env node
// Orchestrateur autonome — implémente "Option C" (authentification membres,
// rôles, visibilité) en plusieurs étapes en dialoguant avec Claude via la
// CLI `claude` en mode non-interactif (réutilise l'OAuth de l'abonnement
// Max, pas besoin de clé API séparée).
//
// Usage :
//   node agent/run.js
//
// Variables d'environnement :
//   AGENT_MODEL         (optionnel — défaut : "sonnet", alias dernier Sonnet)
//   AGENT_DRY_RUN       (si "1", n'écrit rien et n'exécute pas de shell)
//   AGENT_BUDGET_USD    (optionnel — cap par appel Claude, défaut : 0.30)

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const AGENT_DIR = __dirname;
const LOG_PATH = path.join(AGENT_DIR, 'activity.log');
const REPORT_PATH = path.join(AGENT_DIR, 'rapport.md');
const TRANSCRIPT_DIR = path.join(AGENT_DIR, 'transcripts');

const MODEL = process.env.AGENT_MODEL || 'sonnet';
const DRY_RUN = process.env.AGENT_DRY_RUN === '1';
const BUDGET_USD = process.env.AGENT_BUDGET_USD || '0.30';

// Vérifie que la CLI claude est disponible.
try {
  execSync('claude --version', { stdio: 'pipe' });
} catch (e) {
  console.error('✖ CLI `claude` introuvable. Installe Claude Code ou ajoute-la au PATH.');
  process.exit(1);
}

// ── Étapes ────────────────────────────────────────────────────────────
const STEPS = [
  { id: 'install_deps',       files: ['package.json'] },
  { id: 'create_auth_module', files: ['src/storage.js', 'src/schema.js'] },
  { id: 'create_middleware',  files: ['src/auth.js', 'src/middleware.js'] },
  { id: 'update_schema',      files: ['src/schema.js', 'data/places.json', 'data/people.json', 'data/stories.json'] },
  { id: 'update_storage',     files: ['src/storage.js'] },
  { id: 'update_server_routes', files: ['server.js', 'src/auth.js', 'src/middleware.js'] },
  { id: 'filter_get_routes',  files: ['server.js', 'src/middleware.js'] },
  { id: 'update_post_routes', files: ['server.js', 'src/middleware.js'] },
  { id: 'create_login_html',  files: ['public/index.html'] },
  { id: 'create_register_html', files: ['public/login.html'] },
  { id: 'update_admin_html',  files: ['public/admin.html', 'public/js/admin.js'] },
  { id: 'update_app_js',      files: ['public/js/app.js'] },
  { id: 'write_rapport',      files: ['agent/activity.log'] },
];

// ── Utilitaires ───────────────────────────────────────────────────────
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(LOG_PATH, line);
  process.stdout.write(line);
}

function readFile(rel) {
  const full = path.join(ROOT, rel);
  try {
    const stat = fs.statSync(full);
    if (stat.size > 200_000) return `[FICHIER TROP LOURD (${stat.size} octets) : ${rel}]`;
    return fs.readFileSync(full, 'utf8');
  } catch (e) {
    return `[FICHIER INEXISTANT : ${rel}]`;
  }
}

function callClaude(systemPrompt, userMessage) {
  // Invoque `claude --print` — stdin = user message, --system-prompt remplace
  // le prompt par défaut de Claude Code. --max-budget-usd plafonne le coût
  // par étape.
  const args = [
    '--print',
    '--model', MODEL,
    '--output-format', 'json',
    '--no-session-persistence',
    '--max-budget-usd', BUDGET_USD,
    '--system-prompt', systemPrompt,
  ];
  const res = spawnSync('claude', args, {
    input: userMessage,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 300_000,
  });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`claude a renvoyé code ${res.status} : ${(res.stderr || '').slice(0, 800)}`);
  }
  let envelope;
  try { envelope = JSON.parse(res.stdout); }
  catch (e) {
    throw new Error('Envelope JSON invalide : ' + e.message + ' — sortie brute : ' + res.stdout.slice(0, 400));
  }
  if (envelope.is_error || envelope.subtype !== 'success') {
    throw new Error('Claude a renvoyé une erreur : ' + (envelope.error || envelope.subtype));
  }
  return { text: envelope.result || '', costUsd: envelope.total_cost_usd || 0 };
}

function extractJSON(text) {
  // Claude enveloppe parfois sa réponse dans ```json ... ``` malgré l'instruction.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const raw = fenced ? fenced[1] : text;
  return JSON.parse(raw.trim());
}

// ── Prompt système ────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Tu es un sous-agent d'implémentation pour le projet "Mémoire des Cévennes"
(Node 18+ / Express / Multer v2 / frontend vanilla + Leaflet, données JSON,
médias en uploads/, port 3003, admin via X-Admin-Token).

Tu implémentes l'Option C — authentification membres, rôles, visibilité
"public | members" — étape par étape, sans jamais casser la compatibilité
du flux admin via X-Admin-Token.

À chaque étape, on te fournit :
 - un id d'étape (ex. "create_auth_module")
 - le contenu RÉEL des fichiers pertinents

Tu réponds UNIQUEMENT par un objet JSON valide, SANS préambule, SANS bloc
markdown, SANS commentaire, de la forme exacte :

{
  "actions": [
    { "type": "create", "path": "chemin/relatif/depuis/racine", "content": "contenu complet du fichier" }
  ],
  "shell": ["npm install --save bcryptjs jsonwebtoken cookie-parser"],
  "next": "courte phrase sur la prochaine étape"
}

Règles impératives :
- action "create" CRÉE OU ÉCRASE le fichier.
- shell[] est une liste de commandes exécutées via execSync APRÈS l'écriture
  des fichiers ; ne mets que ce qui est pertinent à l'étape courante.
- Ne touche QUE les fichiers mentionnés dans l'étape, ou les nouveaux fichiers
  dont la spec autorise la création à cette étape.
- Pour l'étape "write_rapport", écris UN seul fichier "agent/rapport.md" en
  markdown (fichiers touchés, commandes npm, variables d'env, checklist curl).
- Préserve l'indentation et le style du projet (2 espaces).
- N'introduis pas de dépendance de build : vanilla JS, pas de bundler.
- Les mots de passe sont toujours hachés avec bcryptjs.
- JWT signé HS256 avec JWT_SECRET (variable d'env) ; cookie httpOnly,
  sameSite=lax, Path=/, 7 jours.
- Hiérarchie des rôles : member < contributor < admin.
- Compat admin : X-Admin-Token (valeur = ADMIN_TOKEN env) continue d'autoriser
  l'accès aux routes /api/admin/* sans JWT.
- Visibilité :
   * places/people/stories reçoivent un champ visibility ∈ {"public","members"},
     défaut "members".
   * req.member null → ne rend que les entités visibility="public", et masque
     name/bio/aliases sur people.
- Création POST : si req.body.consentGiven !== true → 400 "consentement requis".
   Log dans data/activity_log.json : { memberId, action, entityType, entityId,
   timestamp, ip }.

Spécifications Option C (référence) :
- deps npm : bcryptjs, jsonwebtoken, cookie-parser.
- data/members.json → [] (init), data/activity_log.json → [] (init).
- src/auth.js : createMember(email,password,name) → hash bcrypt, status "pending" ;
  approveMember(id) ; setRole(id,role) ; login(email,password) → JWT ou null ;
  verifyToken(token) → payload ou null.
- src/middleware.js : requireAuth(minRole), optionalAuth(). Les fonctions
  lisent le cookie "token".
- server.js : ajouter cookie-parser ; routes POST /api/auth/register,
  POST /api/auth/login, POST /api/auth/logout, GET /api/auth/me ;
  optionalAuth sur GET, requireAuth("contributor") sur POST création,
  requireAuth("admin") sur /api/admin/*. Maintenir compat X-Admin-Token.
- Frontend : public/login.html (email+mdp), public/register.html (nom+email+mdp),
  app.js qui GET /api/auth/me au boot et affiche le bouton ajout selon rôle,
  case à cocher "consentGiven" dans les formulaires de création,
  admin.html avec sections : membres en attente, membres actifs, log activité.
- Variables d'env : JWT_SECRET (obligatoire en prod), ADMIN_TOKEN, COOKIE_SECURE.

Qualité :
- N'écris JAMAIS de secret en dur ; lis process.env.
- Ne perds JAMAIS les données existantes : pour update_schema / update_storage,
  migre en ajoutant visibility="members" par défaut sur les entrées existantes.`;

// ── Boucle principale ─────────────────────────────────────────────────
function runStep(step, idx, total) {
  log(`━━━ étape ${idx+1}/${total} : ${step.id} ━━━`);
  const context = step.files.map(f => {
    const content = readFile(f);
    return `=== FICHIER : ${f} ===\n${content}`;
  }).join('\n\n');

  const userMsg = [
    `Étape courante : "${step.id}"`,
    '',
    'Fichiers fournis :',
    '',
    context,
    '',
    'Produis maintenant ton JSON de réponse.',
  ].join('\n');

  let text, costUsd;
  try {
    const r = callClaude(SYSTEM_PROMPT, userMsg);
    text = r.text;
    costUsd = r.costUsd;
    log(`  ☁ Claude a répondu (coût : $${costUsd.toFixed(4)})`);
  } catch (e) {
    log(`  ✖ ERREUR Claude : ${e.message}`);
    return { ok: false, error: e.message };
  }


  // Archive brut pour audit
  fs.mkdirSync(TRANSCRIPT_DIR, { recursive: true });
  fs.writeFileSync(path.join(TRANSCRIPT_DIR, `${String(idx+1).padStart(2,'0')}-${step.id}.txt`), text);

  let payload;
  try { payload = extractJSON(text); }
  catch (e) {
    log(`  ✖ JSON invalide : ${e.message}`);
    log(`  (réponse brute archivée dans transcripts/${String(idx+1).padStart(2,'0')}-${step.id}.txt)`);
    return { ok: false, error: 'JSON invalide' };
  }

  for (const action of (payload.actions || [])) {
    if (action.type !== 'create') {
      log(`  ⚠ action non supportée : ${action.type}`);
      continue;
    }
    if (!action.path || typeof action.content !== 'string') {
      log(`  ⚠ action malformée : ${JSON.stringify(action).slice(0,120)}`);
      continue;
    }
    const full = path.join(ROOT, action.path);
    if (!full.startsWith(ROOT)) {
      log(`  ✖ chemin hors racine refusé : ${action.path}`);
      continue;
    }
    if (DRY_RUN) {
      log(`  [dry-run] écrirait : ${action.path} (${action.content.length} car)`);
    } else {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, action.content);
      log(`  ✎ écrit : ${action.path} (${action.content.length} car)`);
    }
  }

  for (const cmd of (payload.shell || [])) {
    if (typeof cmd !== 'string') continue;
    if (DRY_RUN) {
      log(`  [dry-run] shell : ${cmd}`);
    } else {
      log(`  $ ${cmd}`);
      try {
        execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
      } catch (e) {
        log(`  ✖ ERREUR shell : ${e.message}`);
      }
    }
  }

  if (payload.next) log(`  → next : ${payload.next}`);
  return { ok: true };
}

function main() {
  fs.writeFileSync(LOG_PATH, '');
  log(`Démarrage — modèle : ${MODEL}${DRY_RUN ? ' [DRY RUN]' : ''}`);
  log(`Racine projet : ${ROOT}`);
  let ok = 0, ko = 0;
  for (let i = 0; i < STEPS.length; i++) {
    const res = runStep(STEPS[i], i, STEPS.length);
    if (res.ok) ok++; else ko++;
  }
  log(`━━━ fin de la boucle — ${ok} OK / ${ko} KO ━━━`);
  if (fs.existsSync(REPORT_PATH)) {
    log(`Rapport final : ${REPORT_PATH}`);
  } else {
    log('Aucun rapport.md produit par la dernière étape.');
  }
}

main();
