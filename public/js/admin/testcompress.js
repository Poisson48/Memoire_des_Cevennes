// Mémoire des Cévennes : admin / Test compression
// Onglet « Test compression » dans /admin.html. Permet à l'admin de
// rejouer dans son navigateur la même chaîne de compression que celle
// déclenchée par le formulaire d'ajout de récit (window.Compress de
// public/js/compress.js), sans rien envoyer au serveur. Affiche les
// tailles avant/après, le codec retenu, la durée d'encodage, et propose
// le téléchargement du fichier compressé pour vérification.

(function () {
  const fileInput = document.getElementById('tc-file');
  const pathSel   = document.getElementById('tc-path');
  const runBtn    = document.getElementById('tc-run');
  const statusEl  = document.getElementById('tc-status');
  const progEl    = document.getElementById('tc-progress');
  const resultEl  = document.getElementById('tc-result');
  const logsWrap  = document.getElementById('tc-logs-wrap');
  const logsEl    = document.getElementById('tc-logs');
  if (!fileInput || !runBtn) return;

  let lastUrl = null;

  fileInput.addEventListener('change', () => {
    runBtn.disabled = !fileInput.files || !fileInput.files[0];
    if (resultEl) resultEl.hidden = true;
    if (logsWrap) logsWrap.hidden = true;
    if (logsEl)   logsEl.textContent = '';
  });

  function fmtSize(n) {
    if (n < 1024) return n + ' o';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' Ko';
    return (n / 1024 / 1024).toFixed(2) + ' Mo';
  }

  function setStatus(msg) {
    statusEl.hidden = false;
    statusEl.textContent = msg;
  }

runBtn.addEventListener('click', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    runBtn.disabled = true;
    fileInput.disabled = true;
    resultEl.hidden = true;
    progEl.hidden = false;
    progEl.value = 0;
    logsWrap.hidden = true;
    logsEl.textContent = '';
    if (lastUrl) { try { URL.revokeObjectURL(lastUrl); } catch {} lastUrl = null; }

    const t0 = performance.now();
    let lastStatus = `Préparation… (source : ${file.name}, ${fmtSize(file.size)})`;
    setStatus(lastStatus);
    // Tick visible : libx265 en wasm peut tenir 10-20 min sans que la
    // barre de progression ne bouge (ffmpeg n'émet pas toujours
    // d'événement progress avant d'avoir traité une bonne partie de
    // l'input). Ce timer rassure : on voit que ce n'est pas figé.
    const tickEvery = 1000;
    const ticker = setInterval(() => {
      const dt = (performance.now() - t0) / 1000;
      statusEl.hidden = false;
      statusEl.textContent = `${lastStatus}  —  ${dt.toFixed(0)} s`;
    }, tickEvery);
    function setStatusKeep(msg) { lastStatus = msg; setStatus(msg); }

    try {
      // Buffer logs : on n'écrit dans le DOM qu'à 4 Hz max pour ne pas
      // saturer le navigateur sur les centaines de lignes de stderr que
      // ffmpeg crache au démarrage.
      let logBuf = '';
      let logFlushPending = false;
      function flushLogs() {
        if (!logBuf) { logFlushPending = false; return; }
        logsWrap.hidden = false;
        logsEl.textContent += logBuf;
        logBuf = '';
        logsEl.scrollTop = logsEl.scrollHeight;
        logFlushPending = false;
      }
      const forced = pathSel && pathSel.value !== 'auto' ? pathSel.value : undefined;
      const r = await window.Compress.compressIfNeeded(file, {
        forceVideoPath: forced,
        onStatus: (s) => setStatusKeep(s),
        onProgress: (p) => { progEl.value = Math.max(0, Math.min(1, p || 0)); },
        onLog: (type, message) => {
          logBuf += `[${type}] ${message}\n`;
          if (!logFlushPending) {
            logFlushPending = true;
            setTimeout(flushLogs, 250);
          }
        },
      });
      flushLogs();
      const dt = (performance.now() - t0) / 1000;
      progEl.value = 1;

      const lines = [];
      lines.push(`<h3>Résultat</h3>`);
      lines.push(`<dl class="tc-dl">`);
      lines.push(`<dt>Source</dt><dd>${escapeHtml(file.name)} — ${fmtSize(r.original)} (${escapeHtml(file.type || 'inconnu')})</dd>`);
      if (r.skipped) {
        lines.push(`<dt>Statut</dt><dd>SAUTÉ`);
        if (r.error) lines.push(` — erreur : ${escapeHtml(r.error)}`);
        else lines.push(` — la sortie n'aurait pas été plus petite (ou type non géré)`);
        lines.push(`</dd>`);
      } else {
        const ratio = ((1 - r.compressed / r.original) * 100).toFixed(1);
        lines.push(`<dt>Compressé</dt><dd>${escapeHtml(r.filename)} — ${fmtSize(r.compressed)} (${escapeHtml(r.mime)})</dd>`);
        lines.push(`<dt>Réduction</dt><dd>−${ratio}%</dd>`);
        if (r.codec) lines.push(`<dt>Codec</dt><dd>${escapeHtml(r.codec)}</dd>`);
        if (r.path)  lines.push(`<dt>Voie</dt><dd>${escapeHtml(r.path === 'native' ? 'native (MediaRecorder, encodeur du SoC)' : 'ffmpeg.wasm')}</dd>`);
      }
      lines.push(`<dt>Durée</dt><dd>${dt.toFixed(1)} s</dd>`);
      lines.push(`</dl>`);

      if (!r.skipped && r.blob) {
        lastUrl = URL.createObjectURL(r.blob);
        lines.push(`<p><a class="btn-primary" href="${lastUrl}" download="${escapeHtml(r.filename)}">⬇️ Télécharger le fichier compressé</a></p>`);
        if (r.mime.startsWith('video/')) {
          lines.push(`<video class="tc-preview" src="${lastUrl}" controls preload="metadata"></video>`);
        } else if (r.mime.startsWith('audio/')) {
          lines.push(`<audio class="tc-preview" src="${lastUrl}" controls preload="metadata"></audio>`);
        } else if (r.mime.startsWith('image/')) {
          lines.push(`<img class="tc-preview" src="${lastUrl}" alt="aperçu" />`);
        }
      }

      resultEl.innerHTML = lines.join('');
      resultEl.hidden = false;
      setStatus(r.skipped ? 'Compression non appliquée.' : 'Compression terminée.');
    } catch (err) {
      progEl.hidden = true;
      setStatus('Erreur : ' + (err && err.message ? err.message : String(err)));
      console.error('[testcompress]', err);
    } finally {
      clearInterval(ticker);
      runBtn.disabled = false;
      fileInput.disabled = false;
    }
  });

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }
})();
