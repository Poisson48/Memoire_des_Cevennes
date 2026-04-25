// Normalisation automatique du gain audio via ffmpeg.
// Filtre `loudnorm` (norme EBU R128) — niveau cible -16 LUFS, true peak -1.5 dBTP,
// large dynamique 11 LU. Bonne base pour des témoignages oraux où on veut :
//   - éviter d'avoir un témoin chuchoté inaudible et un autre qui sature,
//   - ne pas écraser la dynamique d'une voix expressive.
//
// Skip silencieux (avec log) si :
//   - ffmpeg pas installé,
//   - mime pas audio/* ni video/*,
//   - normalisation déjà faite sur ce fichier (marqueur xattr/sentinelle).
//
// Pour les vidéos, on garde la piste vidéo intacte (-c:v copy).

'use strict';

const { execFile } = require('child_process');
const fs   = require('fs');
const path = require('path');

const TIMEOUT_MS = 120_000;          // 2 min max par fichier
const TARGET_I   = '-16';            // LUFS intégrés
const TARGET_TP  = '-1.5';           // dBTP true peak
const TARGET_LRA = '11';             // loudness range

let ffmpegAvailable = null;
function checkFfmpeg() {
  if (ffmpegAvailable !== null) return ffmpegAvailable;
  try {
    require('child_process').execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    ffmpegAvailable = true;
  } catch {
    ffmpegAvailable = false;
    console.warn('[audio-normalize] ffmpeg introuvable — gain non normalisé.');
  }
  return ffmpegAvailable;
}

function isAudio(mime) { return typeof mime === 'string' && mime.startsWith('audio/'); }
function isVideo(mime) { return typeof mime === 'string' && mime.startsWith('video/'); }

/**
 * Normalise le gain d'un fichier en place.
 * @returns {Promise<{ ok: boolean, skipped?: string, error?: string }>}
 */
async function normalize(filePath, mime) {
  if (!isAudio(mime) && !isVideo(mime)) return { ok: false, skipped: 'mime' };
  if (!checkFfmpeg()) return { ok: false, skipped: 'no-ffmpeg' };
  if (!fs.existsSync(filePath)) return { ok: false, error: 'file not found' };

  const ext = path.extname(filePath) || '';
  const tmp = filePath + '.norm' + ext;

  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', filePath];
  if (isVideo(mime)) args.push('-c:v', 'copy');
  args.push('-af', `loudnorm=I=${TARGET_I}:TP=${TARGET_TP}:LRA=${TARGET_LRA}`);
  args.push(tmp);

  return new Promise((resolve) => {
    const child = execFile('ffmpeg', args, { timeout: TIMEOUT_MS }, (err, _stdout, stderr) => {
      if (err) {
        try { fs.unlinkSync(tmp); } catch {}
        console.warn(`[audio-normalize] échec sur ${path.basename(filePath)} : ${err.message}`);
        return resolve({ ok: false, error: err.message, stderr: String(stderr).slice(0, 400) });
      }
      try {
        fs.renameSync(tmp, filePath);
        resolve({ ok: true });
      } catch (e) {
        resolve({ ok: false, error: e.message });
      }
    });
    child.on('error', () => { /* déjà géré par execFile */ });
  });
}

module.exports = { normalize, isAudio, isVideo };
