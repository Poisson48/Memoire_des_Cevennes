// OCR local via Tesseract (binaire systeme) + pre-traitement ImageMagick.
//
// 100% local, aucune API tierce. La langue francaise (`fra.traineddata`) est
// vendorisee dans vendor/tessdata/ par scripts/setup-ocr-tts.sh ; on pointe
// tesseract dessus via --tessdata-dir, donc aucun `sudo`/apt requis.
//
// Pre-traitement (convert) : niveaux de gris + normalisation de contraste +
// redressement (deskew), ce qui ameliore nettement l'OCR sur des scans de
// documents anciens (Cahiers du Haut-Vidourle, etc.).
//
// Skip propre (erreur explicite) si un binaire manque, dans le meme esprit
// que src/audio-normalize.js.

'use strict';

const { execFile, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');

const TESSDATA_DIR = path.join(__dirname, '..', 'vendor', 'tessdata');
const TIMEOUT_MS = 60_000;
const MAX_BYTES = 25 * 1024 * 1024; // 25 Mo : large pour un scan, borne l'abus

let toolsCache = null;
function checkTools() {
  if (toolsCache !== null) return toolsCache;
  const out = { tesseract: false, convert: false, fra: false };
  try { execFileSync('tesseract', ['--version'], { stdio: 'ignore' }); out.tesseract = true; } catch {}
  try { execFileSync('convert', ['-version'], { stdio: 'ignore' }); out.convert = true; } catch {}
  out.fra = fs.existsSync(path.join(TESSDATA_DIR, 'fra.traineddata'));
  if (!out.tesseract) console.warn('[ocr] tesseract introuvable : OCR desactive.');
  if (!out.fra) console.warn('[ocr] vendor/tessdata/fra.traineddata absent : lancer scripts/setup-ocr-tts.sh');
  toolsCache = out;
  return out;
}

function available() {
  const t = checkTools();
  return t.tesseract && t.fra;
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, ...opts },
      (err, stdout, stderr) => {
        if (err) { err.stderr = String(stderr || '').slice(0, 600); return reject(err); }
        resolve(stdout);
      });
  });
}

// Pre-traite l'image vers un PNG temporaire optimise pour l'OCR.
// Retourne le chemin du PNG (a supprimer par l'appelant) ou l'original si
// ImageMagick n'est pas dispo.
async function preprocess(srcPath, workDir) {
  if (!checkTools().convert) return srcPath;
  const out = path.join(workDir, 'pre.png');
  try {
    await run('convert', [
      srcPath,
      '-auto-orient',
      '-colorspace', 'Gray',
      '-normalize',
      '-deskew', '40%',
      '+repage',
      out,
    ]);
    return fs.existsSync(out) ? out : srcPath;
  } catch (e) {
    console.warn('[ocr] pre-traitement echoue, image brute utilisee :', e.message);
    return srcPath;
  }
}

// Reconnait le texte d'une image fournie en Buffer.
// @returns {Promise<{ text: string }>}
async function recognize(buffer, { lang = 'fra', mime = '' } = {}) {
  if (!available()) {
    const err = new Error('OCR indisponible sur ce serveur (tesseract ou langue fra manquant).');
    err.statusCode = 503;
    throw err;
  }
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    const err = new Error('Image vide ou invalide.');
    err.statusCode = 400;
    throw err;
  }
  if (buffer.length > MAX_BYTES) {
    const err = new Error('Image trop volumineuse pour l’OCR.');
    err.statusCode = 413;
    throw err;
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-'));
  const ext = (mime && mime.includes('png')) ? '.png'
    : (mime && mime.includes('webp')) ? '.webp'
    : '.jpg';
  const srcPath = path.join(workDir, 'src' + ext);
  try {
    fs.writeFileSync(srcPath, buffer);
    const pre = await preprocess(srcPath, workDir);
    // --psm 6 : bloc de texte uniforme, bon defaut pour une page scannee.
    const stdout = await run('tesseract', [
      pre, 'stdout',
      '-l', lang,
      '--tessdata-dir', TESSDATA_DIR,
      '--psm', '6',
    ]);
    const text = String(stdout || '')
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return { text };
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
  }
}

module.exports = { recognize, available, checkTools, TESSDATA_DIR };
