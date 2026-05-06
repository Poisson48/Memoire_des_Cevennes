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
      // ffmpeg.wasm servi depuis notre origine pour éviter les soucis
      // CORS sur les Workers cross-origin (depuis ~Chrome 95) et
      // l'instabilité des résolutions blob: dans @ffmpeg/ffmpeg 0.12.x.
      // Les fichiers vivent dans public/vendor/ffmpeg/ :
      //   ffmpeg.js + 814.ffmpeg.js  (@ffmpeg/ffmpeg@0.12.15)
      //   util.js                    (@ffmpeg/util@0.12.1, UMD stable)
      //   ffmpeg-core.js + .wasm     (@ffmpeg/core@0.12.10)
      // ffmpeg.js (UMD build) découvre automatiquement son chunk
      // 814.ffmpeg.js via webpack publicPath = currentScript.src. Donc
      // le simple fait de charger ffmpeg.js depuis /vendor/ffmpeg/
      // fait que le Worker chunk se charge aussi depuis cette URL,
      // sans qu'on ait besoin de passer classWorkerURL (qui force
      // type: 'module' et casse l'importScripts du chunk UMD).
      const VENDOR = `${location.origin}/vendor/ffmpeg`;
      await loadScript(`${VENDOR}/ffmpeg.js`);
      await loadScript(`${VENDOR}/util.js`);

      const { FFmpeg } = window.FFmpegWASM;
      const ffmpeg = new FFmpeg();
      await ffmpeg.load({
        coreURL: `${VENDOR}/ffmpeg-core.js`,
        wasmURL: `${VENDOR}/ffmpeg-core.wasm`,
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
  async function compressAudio(file, { onProgress, onStatus, onLog } = {}) {
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
    let audioLogListener = null;
    if (onLog) {
      audioLogListener = ({ type, message }) => {
        try { onLog(type, message); } catch {}
      };
      ffmpeg.on('log', audioLogListener);
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
      if (audioLogListener) ffmpeg.off('log', audioLogListener);
      if (progHandler) ffmpeg.off('progress', progHandler);
      try { await ffmpeg.deleteFile(inputName); } catch {}
      try { await ffmpeg.deleteFile(outputName); } catch {}
    }
  }

  // ── Vidéo : voie native (MediaRecorder) ─────────────────────────
  // Pourquoi cette voie en premier : ffmpeg.wasm utilise un cœur, sans
  // SIMD, sans accélération matérielle (1 % du potentiel d'un téléphone).
  // MediaRecorder, lui, branche le pipeline navigateur → encodeur du SoC
  // (HEVC/H.264 sur Pixel/iPhone récents). C'est *real-time bounded*
  // (encoder une vidéo de 30 s prend au moins 30 s, le temps de la lire),
  // mais ça consomme peu de batterie et ça fonctionne sur les téléphones
  // de notre public.
  //
  // Pipeline : <video> source → drawImage canvas redimensionné →
  // canvas.captureStream(fps) + audio tracks de video.captureStream() →
  // MediaRecorder → Blob.
  //
  // Choix du conteneur / codec :
  //   1. video/mp4;codecs=hvc1     (HEVC, Safari iOS récent)
  //   2. video/webm;codecs=vp9     (Chrome/Firefox, ratio ~30 % > h264)
  //   3. video/mp4;codecs=avc1...  (H.264, fallback universel)
  //   4. video/webm;codecs=vp8     (vieux Firefox)
  //
  // Limites connues :
  // - certains navigateurs (Safari < 14, vieux Firefox) ne supportent
  //   pas HTMLMediaElement.captureStream() → on lève et on tombe sur
  //   ffmpeg.wasm.
  // - sources sans bande audio : on ne combine pas de piste audio.
  // - sources sans rotation appliquée : <video> applique la rotation
  //   automatiquement, donc videoWidth/videoHeight reflètent l'affichage.
  function pickRecorderMime() {
    if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return null;
    const candidates = [
      'video/mp4;codecs=hvc1,mp4a.40.2',
      'video/mp4;codecs=hvc1',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp9',
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4;codecs=avc1.42E01E',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=vp8',
    ];
    for (const t of candidates) {
      try { if (MediaRecorder.isTypeSupported(t)) return t; } catch {}
    }
    return null;
  }

  async function compressVideoNative(file, { onProgress, onStatus, onLog } = {}) {
    const mime = pickRecorderMime();
    if (!mime) throw new Error('MediaRecorder indisponible ou aucun codec supporté');

    onLog && onLog('info', `[native] mime retenu : ${mime}`);
    onStatus && onStatus('vidéo (natif) : analyse de la source…');

    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.src = url;
    video.muted = false;       // garde l'audio dans captureStream
    video.volume = 0;          // mais inaudible pour l'utilisateur
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';

    try {
      await new Promise((resolve, reject) => {
        const onErr = () => reject(new Error('lecture vidéo impossible (format non supporté par le navigateur)'));
        video.addEventListener('loadedmetadata', resolve, { once: true });
        video.addEventListener('error', onErr, { once: true });
      });
      // Force la lecture jusqu'à dispo de la première frame avant de
      // configurer le canvas (videoWidth peut rester à 0 sans ça sur
      // certains conteneurs).
      await new Promise((resolve, reject) => {
        if (video.readyState >= 2) return resolve();
        video.addEventListener('loadeddata', resolve, { once: true });
        video.addEventListener('error', () => reject(new Error('lecture vidéo impossible')), { once: true });
      });

      const srcW = video.videoWidth;
      const srcH = video.videoHeight;
      if (!srcW || !srcH) throw new Error('dimensions vidéo introuvables');
      const dur = isFinite(video.duration) ? video.duration : 0;

      const ratio = Math.min(1, VIDEO_MAX_HEIGHT / srcH);
      // Multiple de 2 pour rester compatible avec les encodeurs du SoC.
      const dstW = Math.max(2, Math.round(srcW * ratio / 2) * 2);
      const dstH = Math.max(2, Math.round(srcH * ratio / 2) * 2);
      onLog && onLog('info', `[native] source ${srcW}×${srcH} (${dur.toFixed(2)} s) → sortie ${dstW}×${dstH}`);

      const canvas = document.createElement('canvas');
      canvas.width = dstW;
      canvas.height = dstH;
      const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });

      const FPS = 30;
      if (typeof canvas.captureStream !== 'function') {
        throw new Error('canvas.captureStream indisponible');
      }
      const videoStream = canvas.captureStream(FPS);

      let audioTracks = [];
      if (typeof video.captureStream === 'function') {
        try {
          const vStream = video.captureStream();
          audioTracks = vStream.getAudioTracks();
        } catch (e) {
          onLog && onLog('warn', `[native] video.captureStream a échoué : ${e.message} (sortie sans audio)`);
        }
      } else {
        onLog && onLog('warn', '[native] HTMLMediaElement.captureStream non supporté (sortie sans audio)');
      }
      const stream = new MediaStream([
        ...videoStream.getVideoTracks(),
        ...audioTracks,
      ]);

      const chunks = [];
      const recorder = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: 1500_000,
        audioBitsPerSecond: 96_000,
      });
      recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

      const stopped = new Promise((resolve, reject) => {
        recorder.onstop = resolve;
        recorder.onerror = (e) => reject(e.error || new Error('erreur MediaRecorder'));
      });

      onStatus && onStatus(`vidéo (natif) : encodage ${mime.split(';')[0]}…`);
      recorder.start(500);

      // Boucle de dessin : préfère requestVideoFrameCallback pour ne
      // dessiner qu'à la cadence des frames effectivement décodées
      // (sinon RAF dessine à 60 Hz et MediaRecorder duplique des frames).
      let drawing = true;
      const drawFrame = () => {
        if (!drawing) return;
        try { ctx.drawImage(video, 0, 0, dstW, dstH); } catch {}
        if (onProgress && dur > 0) {
          onProgress(Math.min(1, video.currentTime / dur));
        }
      };
      const useRfvc = typeof video.requestVideoFrameCallback === 'function';
      if (useRfvc) {
        const rfvc = (now, meta) => {
          drawFrame();
          if (drawing) video.requestVideoFrameCallback(rfvc);
        };
        video.requestVideoFrameCallback(rfvc);
      } else {
        const tick = () => {
          drawFrame();
          if (drawing) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }

      const ended = new Promise((resolve, reject) => {
        video.addEventListener('ended', resolve, { once: true });
        video.addEventListener('error', () => reject(new Error('lecture interrompue')), { once: true });
      });

      await video.play();
      await ended;
      drawing = false;
      // Une dernière frame pour ne pas perdre la dernière image.
      try { ctx.drawImage(video, 0, 0, dstW, dstH); } catch {}

      if (recorder.state !== 'inactive') recorder.stop();
      await stopped;

      const containerMime = mime.split(';')[0];
      const ext = containerMime === 'video/mp4' ? 'mp4' : 'webm';
      const blob = new Blob(chunks, { type: containerMime });
      onLog && onLog('info', `[native] terminé : ${(blob.size/1024/1024).toFixed(2)} Mo`);
      return {
        blob,
        mime: containerMime,
        ext,
        codec: mime,
        path: 'native',
      };
    } finally {
      try { video.pause(); } catch {}
      try { video.removeAttribute('src'); video.load(); } catch {}
      URL.revokeObjectURL(url);
    }
  }

  // ── Vidéo : HEVC > VP9 > H.264, container adapté au codec ────────
  // Voie ffmpeg.wasm — fallback. Beaucoup plus lente (1 cœur, no-asm,
  // pas d'accélération matérielle) mais marche partout. On y passe
  // uniquement si la voie native (compressVideoNative) a échoué.
  //   libx265    → MP4, audio AAC. Tag hvc1 pour la lecture iOS.
  //   libvpx-vp9 → WebM, audio Opus. CRF de référence + bitrate libre.
  //   libx264    → MP4, audio AAC. Cap maxrate pour éviter le no-op.
  async function compressVideoWasm(file, { onProgress, onStatus, onLog } = {}) {
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

    // Capture les logs ffmpeg : si l'exec échoue silencieusement
    // (codec inconnu, erreur de lecture du conteneur…), on remonte la
    // dernière ligne de log dans l'erreur retournée.
    let lastErrorLine = '';
    const logListener = ({ type, message }) => {
      if (type === 'stderr' && /error|invalid|unsupported|fatal/i.test(message)) {
        lastErrorLine = message;
      }
      if (onLog) {
        try { onLog(type, message); } catch {}
      }
    };
    ffmpeg.on('log', logListener);

    try {
      onStatus && onStatus('vidéo : import…');
      await ffmpeg.writeFile(inputName, await fetchFile(file));
      onStatus && onStatus(`vidéo : encodage ${codec}…`);

      // Construction des arguments par codec.
      //
      // Filtre vidéo :
      //   1. cap résolution à VIDEO_MAX_HEIGHT en gardant le ratio
      //      (min() protège contre l'upscale d'une source déjà plus petite).
      //   2. round-to-even : libx264/265 refusent les dimensions impaires
      //      avec yuv420p (« Error while opening encoder […] maybe incorrect
      //      parameters such as width or height »). On force chaque côté
      //      à un multiple de 2.
      //   3. format=yuv420p : certaines sources téléphone (Pixel TopShot,
      //      HDR…) sont en 10 bits ou en yuvj420p ; les codecs grand public
      //      refusent ces pix_fmt sans flag de profil. On normalise.
      const args = [
        '-i', inputName,
        '-vf', `scale='min(iw,iw*${VIDEO_MAX_HEIGHT}/ih)':'min(ih,${VIDEO_MAX_HEIGHT})':flags=lanczos,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`,
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

      const exitCode = await ffmpeg.exec(args);
      if (exitCode !== 0) {
        throw new Error(`ffmpeg exit ${exitCode}${lastErrorLine ? ' : ' + lastErrorLine : ''}`);
      }
      const data = await ffmpeg.readFile(outputName);
      if (!data || !data.buffer || data.buffer.byteLength === 0) {
        throw new Error('ffmpeg a produit un fichier vide');
      }
      return {
        blob: new Blob([data.buffer], { type: outMime }),
        mime: outMime,
        ext: outExt,
        codec,
        path: 'wasm',
      };
    } finally {
      ffmpeg.off('log', logListener);
      if (progHandler) ffmpeg.off('progress', progHandler);
      try { await ffmpeg.deleteFile(inputName); } catch {}
      try { await ffmpeg.deleteFile(outputName); } catch {}
    }
  }

  // Dispatcher vidéo : tente la voie native (MediaRecorder → encodeur du
  // SoC) en premier, retombe sur ffmpeg.wasm si elle n'est pas dispo ou
  // qu'elle échoue. L'option `forceVideoPath: 'native' | 'wasm'` court-
  // circuite ce choix (utile pour A/B tester depuis l'admin).
  async function compressVideo(file, opts = {}) {
    const force = opts.forceVideoPath;
    if (force === 'wasm') return compressVideoWasm(file, opts);
    if (force === 'native') return compressVideoNative(file, opts);
    try {
      return await compressVideoNative(file, opts);
    } catch (err) {
      opts.onLog && opts.onLog('warn', `[native] échec, fallback ffmpeg.wasm : ${err.message}`);
      return compressVideoWasm(file, opts);
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
      path: result.path,
    };
  }

  window.Compress = { compressIfNeeded };
})();
