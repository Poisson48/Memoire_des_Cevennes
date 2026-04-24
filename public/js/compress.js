// Mémoire des Cévennes — compression côté client.
//
// Pourquoi : les témoignages vidéo/audio/photo sortent des téléphones en
// gros (une vidéo 4K fait vite 100 Mo). On réduit *avant* upload pour ne
// pas saturer le serveur ni la bande passante des contributeurs.
//
//   - Images → WebP via Canvas (natif navigateur, rapide, pas de lib).
//   - Audio  → Opus 48 kbps dans container WebM (ffmpeg.wasm). Qualité
//              voix très correcte, taille ~1 Mo / 3 min.
//   - Vidéo  → H.265 (libx265) si dispo dans le build ffmpeg.wasm, sinon
//              fallback H.264 (libx264). Container MP4, CRF 28, preset
//              ultrafast côté encodeur pour limiter le temps de calcul.
//
// ffmpeg.wasm est chargé *à la demande* (~25 Mo) — uniquement quand on
// rencontre un audio/vidéo pour la première fois. Le load est mémoïsé.
//
// API exposée sur `window.Compress` :
//   await Compress.compressIfNeeded(file, { onProgress, onStatus })
//     → { blob, filename, mime, original, compressed, skipped? }
//
// `skipped: true` est renvoyé si la compression ne vaut pas le coup
// (déjà compact, format inconnu…). Le fichier original est réutilisé.

(function() {
  const IMAGE_QUALITY = 0.82;
  const IMAGE_MAX_DIM = 2560;            // côté le plus long, en px
  const AUDIO_BITRATE = '48k';           // voix humaine en opus
  const VIDEO_CRF = '28';                // qualité visuelle vs taille
  const VIDEO_MAX_HEIGHT = 720;          // on redescend à 720p max
  const SKIP_THRESHOLD_BYTES = 200 * 1024; // < 200 Ko : pas la peine

  // ── ffmpeg.wasm — lazy load ──────────────────────────────────────
  let ffmpegPromise = null;
  let preferredVideoCodec = null; // résolu au premier appel vidéo

  async function loadFfmpeg() {
    if (ffmpegPromise) return ffmpegPromise;
    ffmpegPromise = (async () => {
      // Charge d'abord les UMD scripts depuis CDN.
      await loadScript('https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/umd/ffmpeg.js');
      await loadScript('https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/umd/index.js');

      const { FFmpeg } = window.FFmpegWASM;
      const { toBlobURL } = window.FFmpegUtil;
      const ffmpeg = new FFmpeg();
      const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd';
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      return ffmpeg;
    })();
    return ffmpegPromise;
  }

  function loadScript(url) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${url}"]`)) return resolve();
      const s = document.createElement('script');
      s.src = url;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`Échec chargement ${url}`));
      document.head.appendChild(s);
    });
  }

  // Détecte si libx265 est dispo dans le build courant — sinon on
  // basculera sur libx264.
  async function detectVideoCodec(ffmpeg) {
    if (preferredVideoCodec) return preferredVideoCodec;
    let out = '';
    const listener = ({ message }) => { out += message + '\n'; };
    ffmpeg.on('log', listener);
    try {
      await ffmpeg.exec(['-hide_banner', '-encoders']);
    } catch {}
    ffmpeg.off('log', listener);
    preferredVideoCodec = out.includes('libx265') ? 'libx265' : 'libx264';
    return preferredVideoCodec;
  }

  // ── Image → WebP (Canvas) ────────────────────────────────────────
  async function compressImage(file, { onStatus } = {}) {
    onStatus && onStatus('image : décodage…');
    const img = await loadImage(file);
    const { width, height } = scaled(img.width, img.height, IMAGE_MAX_DIM);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);
    onStatus && onStatus('image : encodage WebP…');
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('encodage WebP impossible')),
                    'image/webp', IMAGE_QUALITY);
    });
    return { blob, mime: 'image/webp', ext: 'webp' };
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }
  function scaled(w, h, maxSide) {
    const longest = Math.max(w, h);
    if (longest <= maxSide) return { width: w, height: h };
    const ratio = maxSide / longest;
    return { width: Math.round(w * ratio), height: Math.round(h * ratio) };
  }

  // ── Audio → Opus/WebM (ffmpeg.wasm) ──────────────────────────────
  async function compressAudio(file, { onProgress, onStatus } = {}) {
    onStatus && onStatus('audio : chargement de ffmpeg (~25 Mo, une seule fois)…');
    const ffmpeg = await loadFfmpeg();
    const { fetchFile } = window.FFmpegUtil;
    const inputName = 'in' + guessExt(file, 'webm');
    const outputName = 'out.webm';

    let progHandler = null;
    if (onProgress) {
      progHandler = ({ progress }) => {
        onProgress(Math.min(1, Math.max(0, progress || 0)));
      };
      ffmpeg.on('progress', progHandler);
    }

    try {
      onStatus && onStatus('audio : import…');
      await ffmpeg.writeFile(inputName, await fetchFile(file));
      onStatus && onStatus('audio : encodage Opus (48 kbps)…');
      await ffmpeg.exec([
        '-i', inputName,
        '-vn',                      // pas de piste vidéo
        '-c:a', 'libopus',
        '-b:a', AUDIO_BITRATE,
        '-application', 'voip',     // optimise pour la voix
        outputName,
      ]);
      const data = await ffmpeg.readFile(outputName);
      return {
        blob: new Blob([data.buffer], { type: 'audio/webm' }),
        mime: 'audio/webm',
        ext: 'webm',
      };
    } finally {
      if (progHandler) ffmpeg.off('progress', progHandler);
      try { await ffmpeg.deleteFile(inputName); } catch {}
      try { await ffmpeg.deleteFile(outputName); } catch {}
    }
  }

  // ── Vidéo → H.265 ou H.264 / MP4 (ffmpeg.wasm) ───────────────────
  async function compressVideo(file, { onProgress, onStatus } = {}) {
    onStatus && onStatus('vidéo : chargement de ffmpeg (~25 Mo, une seule fois)…');
    const ffmpeg = await loadFfmpeg();
    const { fetchFile } = window.FFmpegUtil;
    const codec = await detectVideoCodec(ffmpeg);
    const inputName = 'in' + guessExt(file, 'mp4');
    const outputName = 'out.mp4';

    let progHandler = null;
    if (onProgress) {
      progHandler = ({ progress }) => {
        onProgress(Math.min(1, Math.max(0, progress || 0)));
      };
      ffmpeg.on('progress', progHandler);
    }

    try {
      onStatus && onStatus('vidéo : import…');
      await ffmpeg.writeFile(inputName, await fetchFile(file));
      onStatus && onStatus(`vidéo : encodage ${codec} (CRF ${VIDEO_CRF})…`);
      await ffmpeg.exec([
        '-i', inputName,
        '-vf', `scale='min(iw,iw*${VIDEO_MAX_HEIGHT}/ih)':'min(ih,${VIDEO_MAX_HEIGHT})':flags=lanczos`,
        '-c:v', codec,
        '-crf', VIDEO_CRF,
        '-preset', 'ultrafast',
        '-c:a', 'aac',
        '-b:a', '96k',
        '-movflags', '+faststart',
        outputName,
      ]);
      const data = await ffmpeg.readFile(outputName);
      return {
        blob: new Blob([data.buffer], { type: 'video/mp4' }),
        mime: 'video/mp4',
        ext: 'mp4',
        codec,
      };
    } finally {
      if (progHandler) ffmpeg.off('progress', progHandler);
      try { await ffmpeg.deleteFile(inputName); } catch {}
      try { await ffmpeg.deleteFile(outputName); } catch {}
    }
  }

  function guessExt(file, fallback) {
    const m = (file.name || '').match(/\.([a-z0-9]+)$/i);
    return m ? '.' + m[1].toLowerCase() : '.' + fallback;
  }

  // ── API publique ────────────────────────────────────────────────
  async function compressIfNeeded(file, opts = {}) {
    const original = file.size;
    const type = (file.type || '').toLowerCase();

    // Fichier déjà petit → on laisse tel quel (perte de temps).
    if (original < SKIP_THRESHOLD_BYTES) {
      return { blob: file, filename: file.name, mime: type, original, compressed: original, skipped: true };
    }

    let result = null;
    try {
      if (type.startsWith('image/') && type !== 'image/webp' && type !== 'image/gif') {
        result = await compressImage(file, opts);
      } else if (type.startsWith('audio/')) {
        result = await compressAudio(file, opts);
      } else if (type.startsWith('video/')) {
        result = await compressVideo(file, opts);
      }
    } catch (err) {
      console.warn('compression échouée, upload du fichier original :', err);
      return { blob: file, filename: file.name, mime: type, original, compressed: original, skipped: true, error: err.message };
    }

    if (!result) {
      // Type non pris en charge (PDF, GIF…) : passe tel quel.
      return { blob: file, filename: file.name, mime: type, original, compressed: original, skipped: true };
    }

    // Si la compression a rendu le fichier PLUS GROS (cas rare mais
    // possible pour de petits fichiers déjà compacts), on garde l'original.
    if (result.blob.size >= original) {
      return { blob: file, filename: file.name, mime: type, original, compressed: original, skipped: true };
    }

    const base = (file.name || 'fichier').replace(/\.[^.]+$/, '');
    return {
      blob: result.blob,
      filename: `${base}.${result.ext}`,
      mime: result.mime,
      original,
      compressed: result.blob.size,
      codec: result.codec,
    };
  }

  window.Compress = { compressIfNeeded };
})();
