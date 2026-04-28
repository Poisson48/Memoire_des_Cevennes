'use strict';

// Sauvegardes / exports / imports — archives .tar.gz contenant
//   manifest.json   (version app, version schéma, sha256 des fichiers)
//   data/*.json     (places, people, stories, edits, members, reports, activity_log)
//   uploads/        (médias attachés aux récits)
//
// Le format est conçu pour être déplaçable d'un serveur à un autre :
// l'import vérifie l'intégrité (sha256) et la compatibilité de schéma
// avant d'écraser quoi que ce soit. Avant tout restore/import, un snapshot
// "pre-restore" est créé pour pouvoir annuler.
//
// Versionnage :
//   SCHEMA_VERSION = entier qui décrit le format des JSON. À bumper quand
//   on change la forme d'une entité (renommage de champ, etc.). Les
//   migrations vivent dans MIGRATIONS (un objet { fromVersion: fn(data) }).
//   L'import refuse une archive de version supérieure à celle du serveur,
//   et applique les migrations pour les versions inférieures.

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileP = promisify(execFile);

const REPO_ROOT   = path.join(__dirname, '..');
const DATA_DIR    = path.join(REPO_ROOT, 'data');
const UPLOADS_DIR = path.join(REPO_ROOT, 'uploads');
const BACKUPS_DIR = path.join(REPO_ROOT, 'backups');

// Fichiers JSON sauvegardés. data/seeds/ est volontairement exclu (vit
// dans le repo, restauré par git, pas par les backups utilisateur).
const DATA_FILES = [
  'places.json',
  'people.json',
  'stories.json',
  'edits.json',
  'members.json',
  'reports.json',
  'activity_log.json',
  'password_resets.json',
];

const SCHEMA_VERSION = 1;

// Migrations de schéma : clé = version SOURCE, valeur = fonction qui
// reçoit l'objet { 'data/foo.json': parsedJson, ... } et le mute pour
// le faire passer à version+1. Chaîner naturellement vers SCHEMA_VERSION.
//
// Aujourd'hui : aucune migration (v1 = baseline). Exemple futur :
//   1: (files) => {
//     // Renommer un champ dans toutes les places
//     for (const p of files['data/places.json'].places) p.newField = p.oldField;
//   },
const MIGRATIONS = {};

// ─── Chiffrement ──────────────────────────────────────────────────────
// Si BACKUP_PASSPHRASE est défini dans l'env, toutes les archives sont
// chiffrées AES-256-GCM (extension .tar.gz.enc). Format binaire :
//   [4]   magic        "MDCB"
//   [1]   version      (entier, 1)
//   [16]  salt         (scrypt → clé)
//   [12]  IV           (AES-GCM)
//   […]   ciphertext
//   [16]  auth tag     (GCM)
//
// scrypt avec N=2^14 = recommandation OWASP minimum, tient dans la
// maxmem par défaut de Node (32 Mo). Suffisant pour ralentir le brute
// force sur une passphrase humaine.
//
// Le passphrase doit être stable : si on perd la valeur de
// BACKUP_PASSPHRASE, les anciennes archives chiffrées deviennent
// illisibles. Stocker la passphrase ailleurs (gestionnaire de mots de
// passe), pas seulement dans .env du serveur.

const ENC_MAGIC = Buffer.from('MDCB', 'utf8');
const ENC_VERSION = 1;
const ENC_HEADER_LEN = ENC_MAGIC.length + 1 + 16 + 12; // 33 bytes
const ENC_TAG_LEN = 16;
const SCRYPT_N = 1 << 14; // 16384

function getPassphrase() {
  const p = process.env.BACKUP_PASSPHRASE;
  return p && p.length ? p : null;
}

function encryptionEnabled() {
  return !!getPassphrase();
}

function encryptFile(srcPath, dstPath, passphrase) {
  const data = fs.readFileSync(srcPath);
  const salt = crypto.randomBytes(16);
  const iv   = crypto.randomBytes(12);
  const key  = crypto.scryptSync(passphrase, salt, 32, { N: SCRYPT_N });
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  const header = Buffer.concat([ENC_MAGIC, Buffer.from([ENC_VERSION]), salt, iv]);
  fs.writeFileSync(dstPath, Buffer.concat([header, ciphertext, tag]));
}

function decryptFile(srcPath, dstPath, passphrase) {
  const data = fs.readFileSync(srcPath);
  if (data.length < ENC_HEADER_LEN + ENC_TAG_LEN) {
    throw new Error('Archive chiffrée trop courte ou corrompue');
  }
  if (!data.slice(0, 4).equals(ENC_MAGIC)) {
    throw new Error('Magic bytes invalides — archive non chiffrée ou format inconnu');
  }
  const version = data[4];
  if (version !== ENC_VERSION) {
    throw new Error(`Version de chiffrement v${version} non supportée (attendu v${ENC_VERSION})`);
  }
  const salt = data.slice(5, 21);
  const iv   = data.slice(21, 33);
  const tag  = data.slice(data.length - ENC_TAG_LEN);
  const ciphertext = data.slice(ENC_HEADER_LEN, data.length - ENC_TAG_LEN);

  const key = crypto.scryptSync(passphrase, salt, 32, { N: SCRYPT_N });
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  let plaintext;
  try {
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (e) {
    // .final() jette si le tag GCM ne valide pas → passphrase erronée
    // ou archive altérée.
    throw new Error('Déchiffrement impossible : passphrase erronée ou archive altérée');
  }
  fs.writeFileSync(dstPath, plaintext);
}

function isEncryptedFile(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    return buf.equals(ENC_MAGIC);
  } catch { return false; }
}

// Quand on a besoin du fichier .tar.gz "en clair" pour le passer à tar,
// on le déchiffre dans un fichier temporaire et on retourne son chemin.
// Le caller doit appeler le `cleanup()` retourné quand il a fini.
function materializePlainArchive(archivePath) {
  if (!isEncryptedFile(archivePath)) {
    return { plainPath: archivePath, cleanup: () => {} };
  }
  const passphrase = getPassphrase();
  if (!passphrase) {
    throw new Error(
      'Archive chiffrée mais BACKUP_PASSPHRASE non défini sur ce serveur. ' +
      'Ajoute la passphrase dans .env (la même qui a servi à chiffrer) puis relance.',
    );
  }
  const tmp = path.join(os.tmpdir(), `mdc-decrypt-${crypto.randomBytes(4).toString('hex')}.tar.gz`);
  decryptFile(archivePath, tmp, passphrase);
  return { plainPath: tmp, cleanup: () => { try { fs.unlinkSync(tmp); } catch {} } };
}

// ID d'archive : backup-YYYYMMDD-HHmmss-<8 hex>
function newBackupId() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const ts =
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) + '-' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds());
  return `backup-${ts}-${crypto.randomBytes(4).toString('hex')}`;
}

function appVersion() {
  try { return require('../package.json').version; }
  catch { return 'unknown'; }
}

function ensureDirs() {
  if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  if (!fs.existsSync(DATA_DIR))    fs.mkdirSync(DATA_DIR, { recursive: true });
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

// Parcourt récursivement un dossier et renvoie la liste des fichiers
// (chemins relatifs au dossier) avec leur taille. Sert à inventorier
// uploads/ dans le manifest.
function walkDir(rootDir, relPrefix = '') {
  const out = [];
  if (!fs.existsSync(rootDir)) return out;
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const abs = path.join(rootDir, entry.name);
    const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...walkDir(abs, rel));
    } else if (entry.isFile()) {
      const stat = fs.statSync(abs);
      out.push({ rel, size: stat.size });
    }
  }
  return out;
}

function buildManifest({ kind, label, note, createdBy }) {
  const files = {};
  for (const f of DATA_FILES) {
    const abs = path.join(DATA_DIR, f);
    if (fs.existsSync(abs)) {
      const stat = fs.statSync(abs);
      files[`data/${f}`] = {
        size: stat.size,
        sha256: sha256File(abs),
      };
    }
  }
  const uploads = walkDir(UPLOADS_DIR);
  const totalUploadsSize = uploads.reduce((acc, u) => acc + u.size, 0);
  return {
    schemaVersion: SCHEMA_VERSION,
    appVersion: appVersion(),
    createdAt: new Date().toISOString(),
    kind: kind || 'manual',
    label: label || '',
    note: note || '',
    createdBy: createdBy || 'admin',
    files,
    uploads: {
      fileCount: uploads.length,
      totalSize: totalUploadsSize,
    },
  };
}

// ─── Création d'une archive ───────────────────────────────────────────
async function createBackup({ kind, label, note, createdBy } = {}) {
  ensureDirs();
  const id = newBackupId();
  const passphrase = getPassphrase();
  const finalPath = path.join(BACKUPS_DIR, passphrase ? `${id}.tar.gz.enc` : `${id}.tar.gz`);
  // tar produit toujours un .tar.gz "en clair" ; si chiffrement requis,
  // on chiffre ce fichier intermédiaire vers le finalPath, puis on rm.
  const tarPath = passphrase
    ? path.join(os.tmpdir(), `mdc-backup-${id}.tar.gz`)
    : finalPath;

  const manifest = buildManifest({ kind, label, note, createdBy });
  manifest.encrypted = !!passphrase;

  // Stage : on écrit le manifest dans un dossier temporaire, puis on tar
  // ensemble manifest.json + les fichiers de data/ + uploads/. On utilise
  // plusieurs `-C` pour ne pas avoir à recopier les uploads (qui peuvent
  // peser lourd) avant l'archivage.
  const stage = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mdc-backup-'));
  try {
    fs.writeFileSync(
      path.join(stage, 'manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n',
    );

    const args = ['-czf', tarPath];
    args.push('-C', stage, 'manifest.json');
    args.push('-C', REPO_ROOT);
    for (const f of DATA_FILES) {
      if (fs.existsSync(path.join(DATA_DIR, f))) args.push(`data/${f}`);
    }
    if (fs.existsSync(UPLOADS_DIR)) args.push('uploads');

    await execFileP('tar', args);

    if (passphrase) {
      encryptFile(tarPath, finalPath, passphrase);
    }
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
    if (passphrase && fs.existsSync(tarPath)) {
      try { fs.unlinkSync(tarPath); } catch {}
    }
  }

  const stat = fs.statSync(finalPath);
  return { id, manifest, sizeBytes: stat.size, path: finalPath };
}

// ─── Lecture du manifest sans extraction complète ─────────────────────
async function readManifestFromArchive(archivePath) {
  // tar -xOzf : extrait UN fichier vers stdout, sans toucher au disque.
  // On capture stdout et on parse en JSON. --wildcards pour matcher aussi
  // bien `manifest.json` (nos archives) que `./manifest.json` (produites
  // par `tar -C dir .` côté admin qui réempaquette à la main).
  // Si l'archive est chiffrée, on la déchiffre dans un fichier temporaire
  // avant de questionner tar.
  let plain;
  try { plain = materializePlainArchive(archivePath); }
  catch (e) { throw new Error(`Lecture impossible : ${e.message}`); }
  try {
    const { stdout } = await execFileP(
      'tar', ['--wildcards', '-xOzf', plain.plainPath, '*manifest.json'],
      { maxBuffer: 4 * 1024 * 1024 },
    );
    if (!stdout.trim()) {
      throw new Error('manifest.json absent');
    }
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(`Manifest illisible : ${err.message}`);
  } finally {
    plain.cleanup();
  }
}

// ─── Liste des backups disponibles ────────────────────────────────────
async function listBackups() {
  ensureDirs();
  const entries = fs.readdirSync(BACKUPS_DIR)
    .filter(f => f.endsWith('.tar.gz') || f.endsWith('.tar.gz.enc'))
    .map(f => path.join(BACKUPS_DIR, f));

  const out = [];
  for (const archivePath of entries) {
    const base = path.basename(archivePath);
    const id = base.endsWith('.tar.gz.enc')
      ? base.slice(0, -'.tar.gz.enc'.length)
      : base.slice(0, -'.tar.gz'.length);
    const encrypted = base.endsWith('.enc');
    const stat = fs.statSync(archivePath);
    let manifest = null;
    try { manifest = await readManifestFromArchive(archivePath); }
    catch (e) { manifest = { error: e.message, encrypted }; }
    if (manifest && !manifest.encrypted) manifest.encrypted = encrypted;
    out.push({ id, manifest, sizeBytes: stat.size, path: archivePath, encrypted });
  }
  // Plus récent en premier (par createdAt si dispo, sinon mtime).
  out.sort((a, b) => {
    const ta = a.manifest && a.manifest.createdAt ? a.manifest.createdAt : '';
    const tb = b.manifest && b.manifest.createdAt ? b.manifest.createdAt : '';
    return tb.localeCompare(ta);
  });
  return out;
}

// ─── Récupération d'un backup par ID ──────────────────────────────────
// Cherche d'abord un .tar.gz.enc (chiffré), puis .tar.gz (en clair).
// Retourne null si aucun n'existe.
function backupPath(id) {
  // Anti-traversal : l'id ne doit contenir que des caractères safes.
  if (!/^backup-[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error('ID de backup invalide');
  }
  const enc   = path.join(BACKUPS_DIR, `${id}.tar.gz.enc`);
  const clear = path.join(BACKUPS_DIR, `${id}.tar.gz`);
  if (fs.existsSync(enc))   return enc;
  if (fs.existsSync(clear)) return clear;
  return null;
}

async function getBackup(id) {
  const p = backupPath(id);
  if (!p) return null;
  const stat = fs.statSync(p);
  const manifest = await readManifestFromArchive(p);
  return { id, manifest, sizeBytes: stat.size, path: p, encrypted: p.endsWith('.enc') };
}

function deleteBackup(id) {
  const p = backupPath(id);
  if (!p) return false;
  fs.unlinkSync(p);
  return true;
}

// ─── Vérification d'intégrité après extraction ────────────────────────
function verifyExtractedAgainstManifest(extractDir, manifest) {
  const errors = [];
  for (const [relPath, info] of Object.entries(manifest.files || {})) {
    const abs = path.join(extractDir, relPath);
    if (!fs.existsSync(abs)) {
      errors.push(`${relPath} : absent de l'archive`);
      continue;
    }
    const got = sha256File(abs);
    if (got !== info.sha256) {
      errors.push(`${relPath} : sha256 incorrect (attendu ${info.sha256.slice(0, 12)}…, obtenu ${got.slice(0, 12)}…)`);
    }
  }
  return errors;
}

// ─── Migrations de schéma à appliquer après extraction ────────────────
function applyMigrations(extractDir, fromVersion) {
  if (fromVersion === SCHEMA_VERSION) return;
  if (fromVersion > SCHEMA_VERSION) {
    throw new Error(
      `Archive en schéma v${fromVersion} mais ce serveur ne gère que jusqu'à v${SCHEMA_VERSION}. Mets à jour le serveur avant d'importer.`,
    );
  }

  // Charge tous les JSON en mémoire, applique chaque migration en chaîne,
  // puis ré-écrit. Les migrations mutent l'objet { 'data/foo.json': … }.
  const files = {};
  for (const f of DATA_FILES) {
    const abs = path.join(extractDir, 'data', f);
    if (fs.existsSync(abs)) {
      try { files[`data/${f}`] = JSON.parse(fs.readFileSync(abs, 'utf8')); }
      catch (e) { throw new Error(`JSON invalide après extraction : data/${f} (${e.message})`); }
    }
  }

  let v = fromVersion;
  while (v < SCHEMA_VERSION) {
    const migrate = MIGRATIONS[v];
    if (typeof migrate !== 'function') {
      throw new Error(`Migration manquante : v${v} → v${v + 1}`);
    }
    migrate(files);
    v += 1;
  }

  for (const [relPath, data] of Object.entries(files)) {
    const abs = path.join(extractDir, relPath);
    fs.writeFileSync(abs, JSON.stringify(data, null, 2) + '\n');
  }
}

// ─── Restauration depuis une archive sur disque ───────────────────────
// archivePath : chemin absolu vers le .tar.gz à restaurer.
// reviewer    : libellé pour l'audit (nom de l'admin qui restaure).
//
// Étapes :
//   1. Snapshot pre-restore (sauf si skipPreRestore=true)
//   2. Extraction dans un dossier temporaire
//   3. Vérification sha256 + version + migrations
//   4. Remplacement atomique des fichiers data/ + reset uploads/
async function restoreFromArchive(archivePath, { reviewer, skipPreRestore, sourceLabel } = {}) {
  if (!fs.existsSync(archivePath)) {
    throw new Error(`Archive introuvable : ${archivePath}`);
  }
  ensureDirs();

  // 1. Pré-validation : on lit le manifest sans extraction complète,
  // pour détecter une archive incompatible/malformée AVANT de créer un
  // snapshot pre-restore inutile.
  const earlyManifest = await readManifestFromArchive(archivePath);
  if (typeof earlyManifest.schemaVersion !== 'number') {
    throw new Error('Manifest sans schemaVersion — archive non reconnue');
  }
  if (earlyManifest.schemaVersion > SCHEMA_VERSION) {
    throw new Error(
      `Archive en schéma v${earlyManifest.schemaVersion}, ce serveur supporte jusqu'à v${SCHEMA_VERSION}. Mets à jour avant d'importer.`,
    );
  }

  // 2. Pre-restore snapshot
  let preRestore = null;
  if (!skipPreRestore) {
    preRestore = await createBackup({
      kind: 'pre-restore',
      label: `Avant restauration de ${sourceLabel || path.basename(archivePath)}`,
      createdBy: reviewer || 'admin',
    });
  }

  // 3. Extraction temporaire (déchiffrement préalable si nécessaire)
  const plain = materializePlainArchive(archivePath);
  const extractDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mdc-restore-'));
  try {
    // --no-same-owner / --no-same-permissions évitent les surprises de droits
    // si l'archive vient d'un autre user. tar refuse les chemins absolus et
    // les `..` en sortie de boîte (GNU tar ≥ 1.32).
    await execFileP('tar', [
      '-xzf', plain.plainPath,
      '-C', extractDir,
      '--no-same-owner',
      '--no-same-permissions',
    ]);

    // 4. Manifest + sha256 + migrations
    const manifestPath = path.join(extractDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error('Archive sans manifest.json — pas un backup Mémoire des Cévennes valide');
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    const integrityErrors = verifyExtractedAgainstManifest(extractDir, manifest);
    if (integrityErrors.length) {
      throw new Error(`Intégrité compromise : ${integrityErrors.join(' ; ')}`);
    }

    applyMigrations(extractDir, manifest.schemaVersion);

    // 4. Remplacement des fichiers data/ (atomique : copie .tmp puis rename).
    // Si une entrée n'est pas dans l'archive mais existe dans data/, on la
    // supprime pour avoir un état strictement égal à celui sauvegardé.
    const archiveDataFiles = new Set(
      Object.keys(manifest.files || {})
        .filter(k => k.startsWith('data/'))
        .map(k => k.slice('data/'.length)),
    );
    for (const f of DATA_FILES) {
      const src = path.join(extractDir, 'data', f);
      const dst = path.join(DATA_DIR, f);
      if (archiveDataFiles.has(f) && fs.existsSync(src)) {
        const tmp = dst + '.tmp';
        fs.copyFileSync(src, tmp);
        fs.renameSync(tmp, dst);
      } else if (fs.existsSync(dst)) {
        fs.rmSync(dst);
      }
    }

    // Remplacement uploads/ (vidage + recopie depuis l'extraction).
    // On ne touche PAS au .gitkeep ni à la racine elle-même pour ne pas
    // casser les middlewares Express qui ont déjà ouvert le dossier.
    for (const entry of fs.readdirSync(UPLOADS_DIR)) {
      if (entry === '.gitkeep') continue;
      fs.rmSync(path.join(UPLOADS_DIR, entry), { recursive: true, force: true });
    }
    const srcUploads = path.join(extractDir, 'uploads');
    if (fs.existsSync(srcUploads)) {
      for (const entry of fs.readdirSync(srcUploads)) {
        fs.cpSync(
          path.join(srcUploads, entry),
          path.join(UPLOADS_DIR, entry),
          { recursive: true },
        );
      }
    }

    return { manifest, preRestore };
  } finally {
    fs.rmSync(extractDir, { recursive: true, force: true });
    plain.cleanup();
  }
}

async function restoreBackup(id, opts = {}) {
  const p = backupPath(id);
  if (!fs.existsSync(p)) throw new Error(`Backup introuvable : ${id}`);
  return restoreFromArchive(p, { ...opts, sourceLabel: id });
}

// ─── Import d'une archive externe (uploadée par l'admin) ──────────────
// Workflow : l'archive uploadée n'est PAS conservée comme backup officiel ;
// après vérification + restauration, on copie l'archive dans backups/ avec
// kind="import" pour garder une trace.
async function importArchive(archivePath, { reviewer } = {}) {
  // restoreFromArchive lit le manifest et valide schemaVersion AVANT
  // de créer un snapshot pre-restore — pas besoin de redoubler ici.
  const result = await restoreFromArchive(archivePath, { reviewer, sourceLabel: 'import externe' });

  // Conserver l'archive importée dans backups/ pour audit, en gardant
  // l'extension .enc si elle est chiffrée.
  ensureDirs();
  const importId = newBackupId();
  const ext = isEncryptedFile(archivePath) ? '.tar.gz.enc' : '.tar.gz';
  const importPath = path.join(BACKUPS_DIR, `${importId}${ext}`);
  fs.copyFileSync(archivePath, importPath);

  return {
    manifest: result.manifest,
    preRestore: result.preRestore,
    importedAs: importId,
  };
}

// ─── Politique de rétention ───────────────────────────────────────────
// Garde les N plus récents par catégorie (manual + auto + pre-restore + import).
// N=20 par défaut suffit largement pour notre volume.
async function pruneBackups({ keep = 20 } = {}) {
  const all = await listBackups();
  if (all.length <= keep) return { removed: [] };
  const toRemove = all.slice(keep);
  const removed = [];
  for (const b of toRemove) {
    try { fs.unlinkSync(b.path); removed.push(b.id); }
    catch (e) { /* ignore */ }
  }
  return { removed };
}

// Variante : garder les N plus récents *par kind* (utilisé pour cadrer
// la croissance de "auto" et "pre-restore" séparément). Ne touche pas
// aux autres kinds.
async function pruneByKind(kind, keep) {
  const all = await listBackups();
  const matching = all.filter(b => b.manifest && b.manifest.kind === kind);
  if (matching.length <= keep) return { removed: [] };
  const toRemove = matching.slice(keep);
  const removed = [];
  for (const b of toRemove) {
    try { fs.unlinkSync(b.path); removed.push(b.id); }
    catch (e) { /* ignore */ }
  }
  return { removed };
}

// ─── Sauvegardes périodiques ──────────────────────────────────────────
// Démarre un timer qui crée un backup kind="auto" toutes les
// `intervalHours` heures, puis applique la rétention (N derniers `auto`).
// Laisse intacts les manuels, exports, pre-restore.
//
// Variables d'environnement consommées (lues au démarrage) :
//   BACKUP_AUTO_INTERVAL_HOURS  ex. 24       (entier > 0 ; absent = désactivé)
//   BACKUP_AUTO_KEEP            ex. 14       (par défaut 14)
//   BACKUP_AUTO_PRE_RESTORE_KEEP ex. 10      (par défaut 10)
//
// Retourne un handle { stop } pour pouvoir arrêter le timer (utile en test).

let _autoTimer = null;
function startAutoBackups({ intervalHours, keep = 14, preRestoreKeep = 10 } = {}) {
  if (!intervalHours || intervalHours <= 0) return { stop: () => {} };
  if (_autoTimer) clearInterval(_autoTimer);
  const ms = Math.floor(intervalHours * 3600 * 1000);

  const tick = async () => {
    try {
      await createBackup({
        kind: 'auto',
        label: `Sauvegarde automatique (toutes les ${intervalHours} h)`,
        createdBy: 'system',
      });
      await pruneByKind('auto', keep);
      // Les pre-restore peuvent s'accumuler aussi → on les borne.
      await pruneByKind('pre-restore', preRestoreKeep);
    } catch (err) {
      console.warn('[backup auto] échec :', err.message);
    }
  };

  _autoTimer = setInterval(tick, ms);
  // Ne pas tenir le process en vie juste pour ça (utile pour les tests
  // et pour les `kill` propres).
  if (_autoTimer.unref) _autoTimer.unref();

  console.log(`▸ Backups auto : 1 toutes les ${intervalHours} h, ${keep} dernières conservées` +
    (encryptionEnabled() ? ' (chiffrées)' : ' (en clair)'));

  return { stop: () => { if (_autoTimer) { clearInterval(_autoTimer); _autoTimer = null; } } };
}

// ─── Statistiques de stockage ─────────────────────────────────────────
// Donne une vue synthétique pour l'admin : tailles de data/, uploads/,
// backups/ (avec ventilation par kind), espace libre du disque.

function dirStats(rootDir) {
  if (!fs.existsSync(rootDir)) return { bytes: 0, fileCount: 0 };
  let bytes = 0;
  let fileCount = 0;
  const stack = [rootDir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); }
    catch { continue; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const p = path.join(cur, entry.name);
      if (entry.isDirectory()) {
        stack.push(p);
      } else if (entry.isFile()) {
        try { bytes += fs.statSync(p).size; fileCount++; } catch {}
      }
    }
  }
  return { bytes, fileCount };
}

async function getStorageStats() {
  ensureDirs();
  const dataS    = dirStats(DATA_DIR);
  const uploadsS = dirStats(UPLOADS_DIR);
  const backups  = await listBackups();

  const byKind = {};
  let backupBytes = 0;
  for (const b of backups) {
    backupBytes += b.sizeBytes;
    const k = (b.manifest && b.manifest.kind) || 'misc';
    if (!byKind[k]) byKind[k] = { count: 0, bytes: 0 };
    byKind[k].count++;
    byKind[k].bytes += b.sizeBytes;
  }

  // Espace disque sur la partition qui héberge le repo. fs.statfs
  // existe à partir de Node 18.15. Si indispo, on retourne null.
  let disk = null;
  try {
    const s = await fs.promises.statfs(REPO_ROOT);
    disk = {
      totalBytes: Number(s.blocks) * Number(s.bsize),
      freeBytes:  Number(s.bavail) * Number(s.bsize),
      usedBytes:  (Number(s.blocks) - Number(s.bfree)) * Number(s.bsize),
    };
  } catch { /* statfs indisponible — on s'en passe */ }

  return {
    data:    dataS,
    uploads: uploadsS,
    backups: { count: backups.length, bytes: backupBytes, byKind },
    disk,
    encryptionEnabled: encryptionEnabled(),
    schemaVersion: SCHEMA_VERSION,
  };
}

module.exports = {
  SCHEMA_VERSION,
  BACKUPS_DIR,
  DATA_FILES,
  createBackup,
  listBackups,
  getBackup,
  deleteBackup,
  restoreBackup,
  importArchive,
  pruneBackups,
  pruneByKind,
  readManifestFromArchive,
  backupPath,
  encryptionEnabled,
  startAutoBackups,
  getStorageStats,
};
