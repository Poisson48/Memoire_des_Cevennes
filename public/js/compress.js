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

  // ── Annulation ───────────────────────────────────────────────────
  // Toutes les voies acceptent un AbortSignal dans opts.signal. Quand
  // il s'enclenche, le pipeline en cours doit s'interrompre et lever
  // une AbortError. Le caller (forms.js) traite ça comme « l'utilisateur
  // a renoncé », pas comme une erreur à afficher.
  function makeAbortError() {
    const e = new Error('Compression annulée');
    e.name = 'AbortError';
    return e;
  }
  function throwIfAborted(signal) {
    if (signal && signal.aborted) throw makeAbortError();
  }
  // Branche un signal d'annulation sur un ffmpeg.wasm en cours. Sur abort
  // on appelle ffmpeg.terminate() (rejette l'exec actif) et on invalide
  // le singleton mémoïsé : le worker est détruit, le prochain compression
  // rechargera ffmpeg.
  function hookFfmpegAbort(ffmpeg, signal) {
    if (!signal) return () => {};
    throwIfAborted(signal);
    const onAbort = () => {
      try { ffmpeg.terminate(); } catch { /* déjà terminé */ }
      ffmpegPromise = null;
      preferredVideoCodec = null;
    };
    signal.addEventListener('abort', onAbort, { once: true });
    return () => signal.removeEventListener('abort', onAbort);
  }

  // ── Image → WebP (Canvas) ────────────────────────────────────────
  async function compressImage(file, { onStatus, signal } = {}) {
    throwIfAborted(signal);
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

  // ── Audio : voie WebCodecs (rapide) ─────────────────────────────
  // Décodage natif via AudioContext.decodeAudioData (rapide), puis
  // encodage via WebCodecs AudioEncoder (codec opus), puis muxing dans
  // un container WebM via webm-muxer (vendored). Vitesse typique 10-30×
  // realtime sur desktop, 3-10× sur téléphone récent.
  //
  // Limite RAM : decodeAudioData charge tout le PCM décodé en mémoire.
  // 48 kHz stéréo float32 = ~23 Mo/min. Le dispatcher (pickAudioOrder)
  // ne choisit cette voie que si l'estimation tient dans le budget RAM.
  let webmMuxerPromise = null;
  function loadWebmMuxer() {
    if (webmMuxerPromise) return webmMuxerPromise;
    webmMuxerPromise = loadScript(`${location.origin}/vendor/webm-muxer/webm-muxer.min.js`);
    return webmMuxerPromise;
  }

  async function compressAudioWebCodecs(file, { onProgress, onStatus, onLog, signal } = {}) {
    throwIfAborted(signal);
    if (typeof window.AudioEncoder === 'undefined') {
      throw new Error('WebCodecs AudioEncoder indisponible');
    }
    const support = await window.AudioEncoder.isConfigSupported({
      codec: 'opus',
      sampleRate: 48000,
      numberOfChannels: 2,
      bitrate: 64000,
    }).catch(() => ({ supported: false }));
    if (!support.supported) {
      throw new Error('AudioEncoder ne supporte pas opus 48 kHz stéréo sur ce navigateur');
    }

    await loadWebmMuxer();
    if (!window.WebMMuxer || !window.WebMMuxer.Muxer) {
      throw new Error('webm-muxer absent ou non chargé');
    }

    onLog && onLog('info', '[webcodecs] décodage natif via AudioContext…');
    onStatus && onStatus('audio (rapide) : décodage…');
    const arrayBuffer = await file.arrayBuffer();
    throwIfAborted(signal);

    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    let audioBuffer;
    try {
      audioBuffer = await new Promise((resolve, reject) => {
        // Forme à callbacks : compatible Safari < 14.1, et plus robuste
        // sur les conteneurs exotiques que la version Promise.
        ctx.decodeAudioData(arrayBuffer, resolve, (e) => reject(e || new Error('decodeAudioData a échoué')));
      });
    } finally {
      try { await ctx.close(); } catch {}
    }
    throwIfAborted(signal);

    const targetRate = 48000;
    const targetChannels = Math.min(2, audioBuffer.numberOfChannels);
    onLog && onLog('info', `[webcodecs] décodé : ${audioBuffer.duration.toFixed(1)} s, ${audioBuffer.sampleRate} Hz, ${audioBuffer.numberOfChannels} canal(aux) → cible ${targetRate} Hz / ${targetChannels} ch`);

    let processed = audioBuffer;
    if (audioBuffer.sampleRate !== targetRate || audioBuffer.numberOfChannels !== targetChannels) {
      onStatus && onStatus(`audio (rapide) : ré-échantillonnage ${audioBuffer.sampleRate} → ${targetRate} Hz…`);
      const offline = new OfflineAudioContext(targetChannels, Math.ceil(audioBuffer.duration * targetRate), targetRate);
      const src = offline.createBufferSource();
      src.buffer = audioBuffer;
      src.connect(offline.destination);
      src.start();
      processed = await offline.startRendering();
      throwIfAborted(signal);
    }

    onStatus && onStatus('audio (rapide) : encodage Opus via WebCodecs…');

    const { Muxer, ArrayBufferTarget } = window.WebMMuxer;
    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      audio: {
        codec: 'A_OPUS',
        sampleRate: targetRate,
        numberOfChannels: targetChannels,
      },
      type: 'webm',
    });

    let firstError = null;
    let chunksWritten = 0;
    const encoder = new AudioEncoder({
      output: (chunk, meta) => {
        try {
          muxer.addAudioChunk(chunk, meta);
          chunksWritten++;
        } catch (e) {
          firstError = e;
        }
      },
      error: (e) => { firstError = e; },
    });
    encoder.configure({
      codec: 'opus',
      sampleRate: targetRate,
      numberOfChannels: targetChannels,
      bitrate: 64000,
    });

    // Frames de 20 ms = 960 échantillons à 48 kHz. C'est la taille de
    // frame opus standard en mode CELT, et la plupart des encodeurs
    // WebCodecs l'attendent comme unité d'entrée.
    const FRAME_SIZE = 960;
    const totalSamples = processed.length;
    const channels = [];
    for (let ch = 0; ch < targetChannels; ch++) channels.push(processed.getChannelData(ch));

    let abortListener = null;
    if (signal) {
      abortListener = () => { firstError = makeAbortError(); };
      signal.addEventListener('abort', abortListener, { once: true });
    }

    try {
      for (let offset = 0; offset < totalSamples; offset += FRAME_SIZE) {
        if (firstError) throw firstError;
        const numFrames = Math.min(FRAME_SIZE, totalSamples - offset);
        const interleaved = new Float32Array(numFrames * targetChannels);
        for (let ch = 0; ch < targetChannels; ch++) {
          const cd = channels[ch];
          for (let i = 0; i < numFrames; i++) {
            interleaved[i * targetChannels + ch] = cd[offset + i];
          }
        }
        const audioData = new AudioData({
          format: 'f32',
          sampleRate: targetRate,
          numberOfFrames: numFrames,
          numberOfChannels: targetChannels,
          timestamp: Math.round((offset / targetRate) * 1_000_000),
          data: interleaved,
        });
        encoder.encode(audioData);
        audioData.close();

        if (onProgress) onProgress(offset / totalSamples);

        // Backpressure : éviter de saturer la file d'attente de l'encodeur.
        if (encoder.encodeQueueSize > 30) {
          await new Promise((resolve) => {
            const wait = () => {
              if (encoder.encodeQueueSize <= 10 || firstError) resolve();
              else setTimeout(wait, 5);
            };
            wait();
          });
        }
      }
      if (firstError) throw firstError;
      await encoder.flush();
      if (firstError) throw firstError;
    } finally {
      try { encoder.close(); } catch {}
      if (abortListener && signal) signal.removeEventListener('abort', abortListener);
    }

    muxer.finalize();
    const buffer = muxer.target.buffer;
    if (!buffer || buffer.byteLength === 0) {
      throw new Error('webm-muxer a produit un buffer vide');
    }
    onLog && onLog('info', `[webcodecs] terminé : ${(buffer.byteLength/1024/1024).toFixed(2)} Mo, ${chunksWritten} frames`);

    return {
      blob: new Blob([buffer], { type: 'audio/webm' }),
      mime: 'audio/webm',
      ext: 'webm',
      codec: 'opus (WebCodecs)',
      path: 'webcodecs',
    };
  }

  // ── Audio : voie native (MediaRecorder) ─────────────────────────
  // Pourquoi en premier : ffmpeg.wasm en mono-thread alloue tout en RAM
  // et s'effondre (OOM silencieuse) au-delà de quelques minutes d'audio.
  // Sur les interviews longues (1h+, parfois 5h), c'est inutilisable.
  // MediaRecorder branche le décodeur natif du navigateur en streaming :
  // pas d'OOM, indépendant de la durée. Real-time bounded (un fichier de
  // N minutes prend ≥ N min à encoder), accélérable via playbackRate
  // quand le navigateur le supporte sans déformer la sortie.
  function pickAudioRecorderMime() {
    if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return null;
    const candidates = [
      'audio/webm;codecs=opus',     // Chrome / Firefox / Edge
      'audio/webm',
      'audio/mp4;codecs=mp4a.40.2', // Safari
      'audio/mp4',
      'audio/ogg;codecs=opus',
    ];
    for (const t of candidates) {
      try { if (MediaRecorder.isTypeSupported(t)) return t; } catch {}
    }
    return null;
  }

  async function compressAudioNative(file, { onProgress, onStatus, onLog, signal } = {}) {
    throwIfAborted(signal);
    const mime = pickAudioRecorderMime();
    if (!mime) throw new Error('MediaRecorder audio indisponible ou aucun codec supporté');

    onLog && onLog('info', `[native-audio] mime retenu : ${mime}`);
    onStatus && onStatus('audio (natif) : analyse de la source…');

    const url = URL.createObjectURL(file);
    const audio = document.createElement('audio');
    audio.src = url;
    audio.muted = false;     // garde l'audio dans captureStream
    audio.volume = 0;        // mais inaudible côté utilisateur
    audio.preload = 'auto';
    audio.crossOrigin = 'anonymous';

    let progressInterval = null;
    let abortListener = null;

    try {
      await new Promise((resolve, reject) => {
        audio.addEventListener('loadedmetadata', resolve, { once: true });
        audio.addEventListener('error', () => reject(new Error('lecture audio impossible (format non supporté par le navigateur)')), { once: true });
      });

      const dur = isFinite(audio.duration) ? audio.duration : 0;
      onLog && onLog('info', `[native-audio] durée source : ${dur.toFixed(2)} s`);

      if (typeof audio.captureStream !== 'function') {
        throw new Error('audio.captureStream indisponible');
      }
      const stream = audio.captureStream();
      const audioTracks = stream.getAudioTracks();
      if (!audioTracks.length) {
        throw new Error('aucune piste audio détectée dans le fichier');
      }

      const chunks = [];
      const recorder = new MediaRecorder(stream, {
        mimeType: mime,
        audioBitsPerSecond: 64_000, // voix très intelligible, marge sur 48 kbps
      });
      recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

      const stopped = new Promise((resolve, reject) => {
        recorder.onstop = resolve;
        recorder.onerror = (e) => reject(e.error || new Error('erreur MediaRecorder audio'));
      });

      onStatus && onStatus(`audio (natif) : encodage ${mime.split(';')[0]}…`);
      recorder.start(1000);

      let abortRejecter = null;
      const abortPromise = new Promise((_, reject) => { abortRejecter = reject; });
      if (signal) {
        abortListener = () => {
          try { if (recorder.state !== 'inactive') recorder.stop(); } catch {}
          try { audio.pause(); } catch {}
          if (abortRejecter) abortRejecter(makeAbortError());
        };
        signal.addEventListener('abort', abortListener, { once: true });
      }

      if (onProgress && dur > 0) {
        progressInterval = setInterval(() => {
          onProgress(Math.min(1, audio.currentTime / dur));
        }, 500);
      }

      const ended = new Promise((resolve, reject) => {
        audio.addEventListener('ended', resolve, { once: true });
        audio.addEventListener('error', () => reject(new Error('lecture interrompue')), { once: true });
      });

      await audio.play();
      if (signal) await Promise.race([ended, abortPromise]);
      else await ended;

      if (recorder.state !== 'inactive') recorder.stop();
      await stopped;

      const containerMime = mime.split(';')[0];
      const ext = containerMime === 'audio/mp4' ? 'm4a'
                : containerMime === 'audio/ogg' ? 'ogg'
                : 'webm';
      const blob = new Blob(chunks, { type: containerMime });
      onLog && onLog('info', `[native-audio] terminé : ${(blob.size/1024/1024).toFixed(2)} Mo`);
      if (blob.size === 0) throw new Error('audio (natif) : sortie vide');

      return {
        blob,
        mime: containerMime,
        ext,
        codec: mime,
        path: 'native',
      };
    } finally {
      if (progressInterval) clearInterval(progressInterval);
      if (abortListener && signal) signal.removeEventListener('abort', abortListener);
      try { audio.pause(); } catch {}
      try { audio.removeAttribute('src'); audio.load(); } catch {}
      URL.revokeObjectURL(url);
    }
  }

  // ── Audio → Opus/WebM (ffmpeg.wasm) ──────────────────────────────
  // Voie de repli, fiable uniquement sur des fichiers courts (< 10 min
  // typiquement). Au-delà, OOM silencieuse du worker wasm.
  async function compressAudioWasm(file, { onProgress, onStatus, onLog, signal } = {}) {
    throwIfAborted(signal);
    onStatus && onStatus('audio : chargement de ffmpeg (~25 Mo, une seule fois)…');
    const ffmpeg = await loadFfmpeg();
    const unhookAbort = hookFfmpegAbort(ffmpeg, signal);
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

    // Capture stderr pour remonter une cause précise quand exec échoue
    // silencieusement (codec inconnu, conteneur cassé, paramètres refusés…).
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
      onStatus && onStatus('audio : import…');
      await ffmpeg.writeFile(inputName, await fetchFile(file));
      onStatus && onStatus('audio : encodage Opus (48 kbps)…');
      // -application audio : profil générique, correct pour la voix comme
      // pour la musique. (L'ancien 'voip' était calibré uniquement pour
      // la voix et certaines sources le faisaient échouer silencieusement.)
      const exitCode = await ffmpeg.exec([
        '-i', inputName,
        '-vn',                      // pas de piste vidéo
        '-c:a', 'libopus',
        '-b:a', AUDIO_BITRATE,
        '-application', 'audio',
        outputName,
      ]);
      if (exitCode !== 0) {
        throw new Error(`ffmpeg exit ${exitCode}${lastErrorLine ? ' : ' + lastErrorLine : ''}`);
      }
      const data = await ffmpeg.readFile(outputName);
      if (!data || !data.buffer || data.buffer.byteLength === 0) {
        throw new Error('ffmpeg a produit un fichier audio vide');
      }
      return {
        blob: new Blob([data.buffer], { type: 'audio/webm' }),
        mime: 'audio/webm',
        ext: 'webm',
        codec: 'libopus',
      };
    } catch (err) {
      // Si l'utilisateur a abort, ffmpeg.terminate() rejette l'exec en
      // cours avec un message générique : on remap en AbortError.
      if (signal && signal.aborted) throw makeAbortError();
      throw err;
    } finally {
      unhookAbort();
      ffmpeg.off('log', logListener);
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

  async function compressVideoNative(file, { onProgress, onStatus, onLog, signal } = {}) {
    throwIfAborted(signal);
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

      // Branche l'annulation : sur abort, on stoppe le recorder et la
      // lecture pour libérer le SoC et débloquer les awaits suivants.
      let abortListener = null;
      let abortRejecter = null;
      const abortPromise = new Promise((_, reject) => { abortRejecter = reject; });
      if (signal) {
        abortListener = () => {
          try { if (recorder.state !== 'inactive') recorder.stop(); } catch {}
          try { video.pause(); } catch {}
          if (abortRejecter) abortRejecter(makeAbortError());
        };
        signal.addEventListener('abort', abortListener, { once: true });
      }

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
      // Race avec l'annulation : si signal.abort, abortPromise rejette
      // avec AbortError et on quitte sans attendre la fin de la vidéo.
      if (signal) await Promise.race([ended, abortPromise]);
      else await ended;
      drawing = false;
      if (abortListener) signal.removeEventListener('abort', abortListener);
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
  // Voie ffmpeg.wasm : fallback. Beaucoup plus lente (1 cœur, no-asm,
  // pas d'accélération matérielle) mais marche partout. On y passe
  // uniquement si la voie native (compressVideoNative) a échoué.
  //   libx265    → MP4, audio AAC. Tag hvc1 pour la lecture iOS.
  //   libvpx-vp9 → WebM, audio Opus. CRF de référence + bitrate libre.
  //   libx264    → MP4, audio AAC. Cap maxrate pour éviter le no-op.
  async function compressVideoWasm(file, { onProgress, onStatus, onLog, signal } = {}) {
    throwIfAborted(signal);
    onStatus && onStatus('vidéo : chargement de ffmpeg (~25 Mo, une seule fois)…');
    const ffmpeg = await loadFfmpeg();
    const unhookAbort = hookFfmpegAbort(ffmpeg, signal);
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
    } catch (err) {
      // Voir compressAudio : si abort en cours, on remap.
      if (signal && signal.aborted) throw makeAbortError();
      throw err;
    } finally {
      unhookAbort();
      ffmpeg.off('log', logListener);
      if (progHandler) ffmpeg.off('progress', progHandler);
      try { await ffmpeg.deleteFile(inputName); } catch {}
      try { await ffmpeg.deleteFile(outputName); } catch {}
    }
  }

  // Dispatcher vidéo : tente la voie native (MediaRecorder → encodeur du
  // SoC) en premier, retombe sur ffmpeg.wasm si elle n'est pas dispo ou
  // qu'elle échoue. L'option `forceVideoPath: 'native' | 'wasm'` (alias
  // `forcePath`) court-circuite ce choix (utile pour A/B tester depuis
  // l'admin).
  async function compressVideo(file, opts = {}) {
    const force = opts.forcePath || opts.forceVideoPath;
    if (force === 'wasm') return compressVideoWasm(file, opts);
    if (force === 'native') return compressVideoNative(file, opts);
    try {
      return await compressVideoNative(file, opts);
    } catch (err) {
      // L'utilisateur a annulé : on ne tente pas le fallback ffmpeg.wasm.
      if (err.name === 'AbortError') throw err;
      opts.onLog && opts.onLog('warn', `[native] échec, fallback ffmpeg.wasm : ${err.message}`);
      return compressVideoWasm(file, opts);
    }
  }

  // Dispatcher audio : choix automatique selon durée, RAM, format.
  //
  // Trois voies, du plus rapide au plus universel :
  //   webcodecs  → AudioContext.decodeAudioData + AudioEncoder + webm-muxer.
  //                10-30× realtime, mais charge tout le PCM en RAM.
  //                Disponible Chrome 94+, Edge 94+, Firefox 130+, Safari 16.4+.
  //   native     → <audio>.captureStream + MediaRecorder.
  //                Real-time strict mais aucune limite de durée (streaming).
  //                Disponible partout sauf Safari très ancien.
  //   wasm       → ffmpeg.wasm. Universel mais OOM silencieuse > 10 min.
  //
  // Heuristique :
  //   PCM décodé estimé = durée × 384 ko/s (48 kHz × 2 ch × 4 octets).
  //   Si PCM tient dans 25 % de la RAM device → webcodecs viable.
  //   Sinon → native (real-time mais sans limite).
  //   Si webcodecs et native indispos → wasm (sera lent et instable mais
  //   vaut mieux que rien).
  function pickAudioOrder({ duration }) {
    const hasWC = typeof window.AudioEncoder !== 'undefined' &&
                  typeof window.AudioData !== 'undefined' &&
                  typeof window.OfflineAudioContext !== 'undefined';
    const hasMR = typeof MediaRecorder !== 'undefined' && pickAudioRecorderMime() !== null;
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '');
    // navigator.deviceMemory n'existe pas sur Safari ; valeur par défaut
    // prudente (3 Go mobile, 8 Go desktop).
    const ramGB = navigator.deviceMemory || (isMobile ? 3 : 8);
    const ramBudgetBytes = ramGB * 1024 * 1024 * 1024 * 0.25;
    const pcmBytes = duration && isFinite(duration) ? duration * 384_000 : Infinity;

    const order = [];
    if (hasWC && pcmBytes < ramBudgetBytes) order.push('webcodecs');
    if (hasMR) order.push('native');
    order.push('wasm');
    return { order, hasWC, hasMR, ramGB, pcmMB: pcmBytes === Infinity ? null : pcmBytes / 1024 / 1024 };
  }

  // Sonde rapide de durée via <audio>.preload="metadata" : on ne lit
  // que les premiers octets du conteneur, suffisant pour la durée.
  // Timeout 5 s pour ne pas bloquer si le format est exotique.
  function probeAudioDuration(file) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (val) => { if (!done) { done = true; resolve(val); } };
      const url = URL.createObjectURL(file);
      const audio = document.createElement('audio');
      audio.preload = 'metadata';
      audio.src = url;
      const cleanup = () => {
        try { audio.removeAttribute('src'); audio.load(); } catch {}
        URL.revokeObjectURL(url);
      };
      audio.addEventListener('loadedmetadata', () => {
        const d = isFinite(audio.duration) ? audio.duration : null;
        cleanup();
        finish(d);
      }, { once: true });
      audio.addEventListener('error', () => { cleanup(); finish(null); }, { once: true });
      setTimeout(() => { cleanup(); finish(null); }, 5000);
    });
  }

  async function compressAudio(file, opts = {}) {
    const force = opts.forcePath || opts.forceAudioPath;
    if (force === 'wasm') return compressAudioWasm(file, opts);
    if (force === 'native') return compressAudioNative(file, opts);
    if (force === 'webcodecs') return compressAudioWebCodecs(file, opts);

    opts.onStatus && opts.onStatus('audio : analyse de la source…');
    const duration = await probeAudioDuration(file);
    const { order, hasWC, hasMR, ramGB, pcmMB } = pickAudioOrder({ duration });
    opts.onLog && opts.onLog('info',
      `[dispatch-audio] durée=${duration ? Math.round(duration) + 's' : '?'}, ` +
      `RAM=${ramGB}Go, PCM~${pcmMB ? Math.round(pcmMB) + 'Mo' : '?'}, ` +
      `WebCodecs=${hasWC ? 'oui' : 'non'}, MediaRecorder=${hasMR ? 'oui' : 'non'} ` +
      `→ ordre : ${order.join(' > ')}`
    );

    const fns = {
      webcodecs: compressAudioWebCodecs,
      native: compressAudioNative,
      wasm: compressAudioWasm,
    };
    let lastErr = null;
    for (const path of order) {
      try {
        return await fns[path](file, opts);
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        lastErr = err;
        opts.onLog && opts.onLog('warn', `[${path}] échec : ${err.message}`);
      }
    }
    throw lastErr || new Error('aucune voie audio disponible');
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
      // L'annulation utilisateur doit remonter au caller pour qu'il
      // arrête tout le pipeline (au lieu d'envoyer le fichier original
      // comme on le fait pour les vraies erreurs de compression).
      if (err.name === 'AbortError') throw err;
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
