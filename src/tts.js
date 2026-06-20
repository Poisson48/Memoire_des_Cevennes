// Synthese vocale locale via Piper (voix neuronale FR) + conversion MP3.
//
// 100% local : le binaire Piper et la voix fr_FR-siwis-medium sont vendorises
// dans vendor/piper/ par scripts/setup-ocr-tts.sh. Piper produit du WAV ; on
// convertit en MP3 (plus leger pour le navigateur) via ffmpeg, deja present et
// utilise par src/audio-normalize.js. Fallback WAV si ffmpeg absent.
//
// Cache disque sous uploads/tts/, cle = sha256(voix + texte). Le texte change
// (correction, redaction differente) => nouvelle cle => regeneration auto.
// Concurrence bornee (Piper est CPU-bound) + dedup des requetes identiques.

'use strict';

const { spawn, execFile, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PIPER_DIR = path.join(__dirname, '..', 'vendor', 'piper', 'piper');
const PIPER_BIN = path.join(PIPER_DIR, 'piper');
const VOICES_DIR = path.join(__dirname, '..', 'vendor', 'piper', 'voices');
const DEFAULT_VOICE = 'fr_FR-siwis-medium';
const CACHE_DIR = path.join(__dirname, '..', 'uploads', 'tts');

const MAX_CHARS = 20000;       // borne CPU : ~plusieurs minutes d'audio max
const PIPER_TIMEOUT = 180_000;
const MAX_CONCURRENT = 2;

let toolsCache = null;
function checkTools() {
  if (toolsCache !== null) return toolsCache;
  const out = { piper: false, voice: false, ffmpeg: false };
  out.piper = fs.existsSync(PIPER_BIN);
  out.voice = fs.existsSync(path.join(VOICES_DIR, DEFAULT_VOICE + '.onnx'));
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); out.ffmpeg = true; } catch {}
  if (!out.piper) console.warn('[tts] binaire Piper absent : lancer scripts/setup-ocr-tts.sh');
  if (!out.voice) console.warn('[tts] voix FR absente : lancer scripts/setup-ocr-tts.sh');
  toolsCache = out;
  return out;
}

function available() {
  const t = checkTools();
  return t.piper && t.voice;
}

function ext() {
  return checkTools().ffmpeg ? 'mp3' : 'wav';
}

function contentType() {
  return checkTools().ffmpeg ? 'audio/mpeg' : 'audio/wav';
}

// Normalise un texte pour la lecture vocale : retire le markdown et les
// symboles que Piper prononcerait betement (asterisques, parentheses,
// guillemets, tirets entre nombres lus comme « tiret »…). On garde le
// contenu, on remplace les parentheses par une virgule (petite pause).
function cleanForSpeech(text) {
  let t = String(text || '');
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');   // liens markdown [txt](url) -> txt
  t = t.replace(/https?:\/\/\S+/g, ' ');            // URLs brutes
  t = t.replace(/[*_`#~>]/g, ' ');                  // emphase / titres markdown
  t = t.replace(/[«»"“”]/g, ' ');                   // guillemets
  t = t.replace(/(\d)\s*[-–—]\s*(\d)/g, '$1 à $2'); // 1568-1629 -> 1568 à 1629
  t = t.replace(/[()\[\]{}]/g, ', ');               // parentheses/crochets -> pause
  t = t.replace(/^\s*[-•]\s+/gm, '');               // puces de liste
  t = t.replace(/\s*,(\s*,)+/g, ',');               // virgules en double
  t = t.replace(/\s+([,.;:!?])/g, '$1');            // espace avant ponctuation
  t = t.replace(/,(\s*[.;:!?])/g, '$1');            // virgule collee a une autre ponctuation
  t = t.replace(/[ \t]{2,}/g, ' ');
  t = t.replace(/\n{2,}/g, '\n');
  return t.trim();
}

function cacheKey(text, voice) {
  return crypto.createHash('sha256').update(voice + '\n' + text).digest('hex').slice(0, 32);
}

function cachePath(text, voice = DEFAULT_VOICE) {
  return path.join(CACHE_DIR, `${cacheKey(text, voice)}.${ext()}`);
}

// ── Concurrence bornee ───────────────────────────────────────────────────
let active = 0;
const queue = [];
const inFlight = new Map(); // cacheKey -> Promise (dedup)

function acquire() {
  if (active < MAX_CONCURRENT) { active++; return Promise.resolve(); }
  return new Promise(resolve => queue.push(resolve));
}
function release() {
  active--;
  const next = queue.shift();
  if (next) { active++; next(); }
}

function runPiper(text, voicePath, wavPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(PIPER_BIN, ['--model', voicePath, '--output_file', wavPath], {
      env: { ...process.env, LD_LIBRARY_PATH: PIPER_DIR + (process.env.LD_LIBRARY_PATH ? ':' + process.env.LD_LIBRARY_PATH : '') },
      cwd: PIPER_DIR,
    });
    let stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Piper timeout')); }, PIPER_TIMEOUT);
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      reject(new Error('Piper a echoue : ' + String(stderr).slice(0, 300)));
    });
    child.stdin.write(text);
    child.stdin.end();
  });
}

function toMp3(wavPath, mp3Path) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error',
      '-i', wavPath, '-codec:a', 'libmp3lame', '-qscale:a', '4', mp3Path],
      { timeout: 120_000 }, (err) => err ? reject(err) : resolve());
  });
}

// Synthetise le texte et renvoie le chemin du fichier audio en cache.
// @returns {Promise<{ path, contentType }>}
async function synthesize(text, { voice = DEFAULT_VOICE } = {}) {
  if (!available()) {
    const err = new Error('Synthèse vocale indisponible sur ce serveur.');
    err.statusCode = 503;
    throw err;
  }
  const clean = cleanForSpeech(text).slice(0, MAX_CHARS);
  if (!clean) {
    const err = new Error('Rien à lire.');
    err.statusCode = 400;
    throw err;
  }

  const out = cachePath(clean, voice);
  if (fs.existsSync(out) && fs.statSync(out).size > 0) {
    return { path: out, contentType: contentType() };
  }

  const key = cacheKey(clean, voice) + '.' + ext();
  if (inFlight.has(key)) return inFlight.get(key);

  const job = (async () => {
    await acquire();
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const voicePath = path.join(VOICES_DIR, voice + '.onnx');
    const wavTmp = out.replace(/\.(mp3|wav)$/, '') + '.tmp.wav';
    try {
      await runPiper(clean, voicePath, wavTmp);
      if (ext() === 'mp3') {
        await toMp3(wavTmp, out);
        try { fs.unlinkSync(wavTmp); } catch {}
      } else {
        fs.renameSync(wavTmp, out);
      }
      return { path: out, contentType: contentType() };
    } catch (e) {
      try { fs.unlinkSync(wavTmp); } catch {}
      try { fs.unlinkSync(out); } catch {}
      throw e;
    } finally {
      release();
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, job);
  return job;
}

module.exports = { synthesize, available, checkTools, DEFAULT_VOICE, contentType, cleanForSpeech };
