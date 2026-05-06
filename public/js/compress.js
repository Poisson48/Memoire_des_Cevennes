// Mémoire des Cévennes : compression côté client.
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
// ffmpeg.wasm est chargé *à la demande* (~25 Mo) : uniquement quand on
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
  // Vidéo : le preset 'ultrafast' produit des fichiers ~5-10× plus gros
  // que 'fast' à CRF égal (libx264). On préfère 'veryfast', plus lent en
  // wasm mais beaucoup plus économique. En complément, un maxrate borne
  // la sortie pour les sources déjà bien compressées qui résistent au
  // CRF (sinon le fichier compressé peut faire la même taille que
  // l'original ou plus).
  const VIDEO_CRF = '28';                // qualité visuelle visée
  const VIDEO_PRESET = 'veryfast';       // libx264/265 ; meilleur que ultrafast à taille égale
  const VIDEO_MAX_HEIGHT = 720;          // on redescend à 720p max
  const VIDEO_MAX_BITRATE = '1500k';     // cap pour 720p typique
  const VIDEO_BUFSIZE     = '3000k';     // buffer 2× maxrate
  const SKIP_THRESHOLD_BYTES = 200 * 1024; // < 200 Ko : pas la peine

  // ── ffmpeg.wasm : lazy load ──────────────────────────────────────
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

  // Choix d'encodeur vidéo, du plus efficace (storage) au moins :
  //   libx265   (HEVC)   : ~50 % plus petit que H.264, mais souvent
  //                        absent du build wasm par défaut (license).
  //   libvpx-vp9 (VP9)   : ~30 % plus petit que H.264, généralement
  //                        présent dans @ffmpeg/core. Container WebM,
  //                        audio Opus. Lecture OK Chrome/Firefox/Edge,
  //                        Safari iOS 14+ et macOS Big Sur+.
  //   libx264   (H.264)  : compat universelle, fallback ultime.
  async function detectVideoCodec(ffmpeg) {
    if (preferredVideoCodec) return preferredVideoCodec;
    let out = '';
    const listener = ({ message }) => { out += message + '\n'; };
    ffmpeg.on('log', listener);
    try {
      await ffmpeg.exec(['-hide_banner', '-encoders']);
    } catch {}
    ffmpeg.off('log', listener);
    if (out.includes('libx265')) preferredVideoCodec = 'libx265';
    else if (out.includes('libvpx-vp9')) preferredVideoCodec = 'libvpx-vp9';
    else preferredVideoCodec = 'libx264';
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

  // ── Vidéo : HEVC > VP9 > H.264, container adapté au codec ────────
  // Objectif : minimiser la taille serveur. HEVC et VP9 compressent
  // ~30-50 % mieux que H.264 à qualité égale.
  //   libx265    → MP4, audio AAC. Tag hvc1 pour la lecture iOS.
  //   libvpx-vp9 → WebM, audio Opus. CRF de référence + bitrate libre.
  //   libx264    → MP4, audio AAC. Cap maxrate pour éviter le no-op.
  async function compressVideo(file, { onProgress, onStatus } = {}) {
    onStatus && onStatus('vidéo : chargement de ffmpeg (~25 Mo, une seule fois)…');
    const ffmpeg = await loadFfmpeg();
    const { fetchFile } = window.FFmpegUtil;
    const codec = await detectVideoCodec(ffmpeg);
    const isVp9  = codec === 'libvpx-vp9';
    const isH265 = codec === 'libx265';
    const inputName  = 'in' + guessExt(file, 'mp4');
    const outputName = isVp9 ? 'out.webm' : 'out.mp4';
    const outMime    = isVp9 ? 'video/webm' : 'video/mp4';
    const outExt     = isVp9 ? 'webm' : 'mp4';

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
      onStatus && onStatus(`vidéo : encodage ${codec}…`);

      // Construction des arguments par codec.
      const args = [
        '-i', inputName,
        // Cap résolution : on ne dépasse jamais VIDEO_MAX_HEIGHT, on
        // garde le ratio. Si la source est déjà plus petite, on ne la
        // pousse pas vers le haut (le min protège contre l'upscale).
        '-vf', `scale='min(iw,iw*${VIDEO_MAX_HEIGHT}/ih)':'min(ih,${VIDEO_MAX_HEIGHT})':flags=lanczos`,
        '-c:v', codec,
      ];

      if (isVp9) {
        // VP9 en mode "constant quality" + cap bitrate. cpu-used 4
        // (max=5 pour libvpx-vp9) tient en wasm sans devenir interminable.
        args.push(
          '-crf', '32',
          '-b:v', VIDEO_MAX_BITRATE,
          '-deadline', 'good',
          '-cpu-used', '4',
          '-c:a', 'libopus',
          '-b:a', '96k',
        );
      } else if (isH265) {
        // HEVC : CRF un cran plus bas (qualité comparable à x264 + 4),
        // tag hvc1 indispensable pour la lecture iOS / QuickTime.
        args.push(
          '-crf', '26',
          '-preset', VIDEO_PRESET,
          '-tag:v', 'hvc1',
          '-maxrate', VIDEO_MAX_BITRATE,
          '-bufsize', VIDEO_BUFSIZE,
          '-c:a', 'aac',
          '-b:a', '96k',
        );
      } else {
        // H.264 (libx264) : fallback universel.
        args.push(
          '-crf', VIDEO_CRF,
          '-preset', VIDEO_PRESET,
          '-maxrate', VIDEO_MAX_BITRATE,
          '-bufsize', VIDEO_BUFSIZE,
          '-c:a', 'aac',
          '-b:a', '96k',
        );
      }

      // faststart pour MP4 uniquement (WebM ne le connaît pas).
      if (!isVp9) args.push('-movflags', '+faststart');
      args.push(outputName);

      await ffmpeg.exec(args);
      const data = await ffmpeg.readFile(outputName);
      return {
        blob: new Blob([data.buffer], { type: outMime }),
        mime: outMime,
        ext: outExt,
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
    // On loggue pour debug : si ça arrive sur des vidéos, c'est qu'il
    // faut soit augmenter le CRF soit baisser maxrate.
    if (result.blob.size >= original) {
      console.info(`Compress: sortie ${result.blob.size} ≥ source ${original} (${type}), on garde l'original.`);
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
