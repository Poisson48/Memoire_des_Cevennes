// Partage : ouvre un dialog avec un lien, un QR code, et la possibilité
// de générer une affiche imprimable (titre + QR + légende).
// API publique : `window.openShare({ url, label, intro, caption })`.
// Lib QR : qrcodejs (vendored dans /js/vendor/qrcode.min.js).

(function () {
  const dlg = document.getElementById('dlg-share');
  if (!dlg) return;

  const titleEl    = dlg.querySelector('h2');
  const introEl    = dlg.querySelector('.share-intro');
  const urlInput   = document.getElementById('share-url');
  const qrContainer = document.getElementById('share-qr');
  const btnCopy    = document.getElementById('share-copy');
  const btnDownload = document.getElementById('share-download');
  const btnNative  = document.getElementById('share-native');
  const inputPosterTitle = document.getElementById('share-poster-title');
  const inputPosterCaption = document.getElementById('share-poster-caption');
  const btnPosterDownload = document.getElementById('share-poster-download');
  const btnPosterPreview = document.getElementById('share-poster-preview-btn');
  const previewBox = document.getElementById('share-poster-preview');
  if (!urlInput || !qrContainer) return;

  let highResDataUrl = null;
  let currentUrl = null;
  let currentLabel = null;

  function renderQRs(url) {
    if (!window.QRCode) return;
    qrContainer.innerHTML = '';
    new window.QRCode(qrContainer, {
      text: url,
      width: 260,
      height: 260,
      correctLevel: window.QRCode.CorrectLevel.M,
    });
    // Haute résolution pour le download / l'affiche.
    const hidden = document.createElement('div');
    hidden.style.display = 'none';
    document.body.appendChild(hidden);
    new window.QRCode(hidden, {
      text: url,
      width: 1024,
      height: 1024,
      correctLevel: window.QRCode.CorrectLevel.H,
    });
    const canvas = hidden.querySelector('canvas');
    highResDataUrl = canvas ? canvas.toDataURL('image/png') : null;
    hidden.remove();
  }

  // ── Composition de l'affiche (canvas) ────────────────────────
  // Format A5 portrait à ~150 DPI : 1240×1748.
  const POSTER_W = 1240;
  const POSTER_H = 1748;

  function wrapText(ctx, text, maxWidth) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (const w of words) {
      const tryLine = line ? `${line} ${w}` : w;
      if (ctx.measureText(tryLine).width > maxWidth && line) {
        lines.push(line);
        line = w;
      } else {
        line = tryLine;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  function drawWrapped(ctx, text, x, yStart, maxWidth, lineHeight, maxLines) {
    const lines = wrapText(ctx, text, maxWidth);
    const shown = maxLines ? lines.slice(0, maxLines) : lines;
    if (maxLines && lines.length > maxLines) {
      // Tronque proprement la dernière ligne avec une ellipse.
      let last = shown[shown.length - 1];
      while (ctx.measureText(last + '…').width > maxWidth && last.length > 1) {
        last = last.slice(0, -1).trim();
      }
      shown[shown.length - 1] = last + '…';
    }
    shown.forEach((l, i) => ctx.fillText(l, x, yStart + i * lineHeight));
    return shown.length * lineHeight;
  }

  async function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  async function composePoster({ url, title, caption }) {
    const c = document.createElement('canvas');
    c.width = POSTER_W;
    c.height = POSTER_H;
    const ctx = c.getContext('2d');

    // Fond crème
    ctx.fillStyle = '#fbf7ef';
    ctx.fillRect(0, 0, POSTER_W, POSTER_H);

    // Bandeau supérieur (couleur accent)
    ctx.fillStyle = '#8c5a2b';
    ctx.fillRect(0, 0, POSTER_W, 110);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = 'bold 42px Georgia, "Iowan Old Style", serif';
    const siteTitle = (document.querySelector('[data-site-title]')?.textContent
      || 'Mémoire des Cévennes').trim();
    ctx.fillText('📜 ' + siteTitle, POSTER_W / 2, 70);

    // Sous-titre
    ctx.fillStyle = '#6d6a63';
    ctx.font = 'italic 26px Georgia, serif';
    ctx.fillText('Scanne pour découvrir ce lieu et ses récits', POSTER_W / 2, 165);

    // Titre principal (auto-wrap, max 3 lignes)
    ctx.fillStyle = '#2b2a27';
    ctx.font = 'bold 60px Georgia, serif';
    const titleHeight = drawWrapped(ctx, title || '', POSTER_W / 2, 245, POSTER_W - 160, 70, 3);

    // QR centré, ~880px
    const qrSize = 880;
    const qrY = 245 + titleHeight + 40;
    if (highResDataUrl) {
      const img = await loadImage(highResDataUrl);
      // Cadre blanc + ombre légère autour du QR
      const pad = 24;
      ctx.fillStyle = '#fff';
      ctx.fillRect((POSTER_W - qrSize) / 2 - pad, qrY - pad, qrSize + pad * 2, qrSize + pad * 2);
      ctx.strokeStyle = '#d9cfbd';
      ctx.lineWidth = 2;
      ctx.strokeRect((POSTER_W - qrSize) / 2 - pad, qrY - pad, qrSize + pad * 2, qrSize + pad * 2);
      ctx.drawImage(img, (POSTER_W - qrSize) / 2, qrY, qrSize, qrSize);
    }

    // URL sous le QR
    const urlY = qrY + qrSize + 60;
    ctx.fillStyle = '#6a4420';
    ctx.font = '22px "Courier New", monospace';
    let displayUrl = url || '';
    while (ctx.measureText(displayUrl).width > POSTER_W - 120 && displayUrl.length > 10) {
      displayUrl = displayUrl.slice(0, -1);
    }
    ctx.fillText(displayUrl, POSTER_W / 2, urlY);

    // Légende (auto-wrap, max 4 lignes)
    if (caption) {
      ctx.fillStyle = '#2b2a27';
      ctx.font = '28px Georgia, serif';
      drawWrapped(ctx, caption, POSTER_W / 2, urlY + 60, POSTER_W - 160, 38, 4);
    }

    // Pied de page
    ctx.fillStyle = '#6d6a63';
    ctx.font = '20px Georgia, serif';
    ctx.fillText(location.host, POSTER_W / 2, POSTER_H - 40);

    return c;
  }

  function downloadDataUrl(dataUrl, filename) {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function slugify(s) {
    return String(s || 'partage').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'partage';
  }

  function open(opts) {
    const url   = (opts && opts.url)   || `${location.origin}/`;
    const label = (opts && opts.label) || 'le site';
    const intro = (opts && opts.intro) || `Envoie ce lien à quelqu'un ou fais-lui scanner le QR code.`;
    const caption = (opts && opts.caption) || '';
    currentUrl = url;
    currentLabel = label;
    if (titleEl) titleEl.textContent = `📤 Partager ${label}`;
    if (introEl) introEl.textContent = intro;
    urlInput.value = url;
    if (inputPosterTitle) inputPosterTitle.value = label;
    if (inputPosterCaption) inputPosterCaption.value = caption;
    if (previewBox) { previewBox.hidden = true; previewBox.innerHTML = ''; }
    renderQRs(url);
    if (btnNative) btnNative.hidden = typeof navigator.share !== 'function';
    dlg.showModal();
    setTimeout(() => urlInput.select(), 50);
  }

  // Lien footer historique : URL du site (page courante hash inclus si présent).
  const footerLink = document.getElementById('footer-share');
  if (footerLink) {
    footerLink.addEventListener('click', (e) => {
      e.preventDefault();
      open({
        url: `${location.origin}${location.pathname}${location.hash || ''}`,
        label: 'cette page',
      });
    });
  }

  if (btnCopy) {
    btnCopy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(currentUrl);
      } catch {
        urlInput.select();
        document.execCommand('copy');
      }
      btnCopy.textContent = '✓ Copié';
      setTimeout(() => { btnCopy.textContent = 'Copier'; }, 1800);
    });
  }

  if (btnDownload) {
    btnDownload.addEventListener('click', () => {
      if (!highResDataUrl) return;
      downloadDataUrl(highResDataUrl, `qr-${slugify(currentLabel)}.png`);
    });
  }

  if (btnPosterDownload) {
    btnPosterDownload.addEventListener('click', async () => {
      const title   = (inputPosterTitle?.value || currentLabel || '').trim();
      const caption = (inputPosterCaption?.value || '').trim();
      btnPosterDownload.disabled = true;
      btnPosterDownload.textContent = '⏳ Génération…';
      try {
        const canvas = await composePoster({ url: currentUrl, title, caption });
        downloadDataUrl(canvas.toDataURL('image/png'), `affiche-${slugify(title)}.png`);
      } catch (err) {
        console.error('compose poster failed', err);
        alert("Désolé, la génération de l'affiche a échoué. " + (err?.message || ''));
      } finally {
        btnPosterDownload.disabled = false;
        btnPosterDownload.textContent = "⬇ Télécharger l'affiche (PNG)";
      }
    });
  }

  if (btnPosterPreview) {
    btnPosterPreview.addEventListener('click', async () => {
      const title   = (inputPosterTitle?.value || currentLabel || '').trim();
      const caption = (inputPosterCaption?.value || '').trim();
      btnPosterPreview.disabled = true;
      try {
        const canvas = await composePoster({ url: currentUrl, title, caption });
        if (previewBox) {
          previewBox.innerHTML = '';
          const img = document.createElement('img');
          img.src = canvas.toDataURL('image/png');
          img.alt = "Aperçu de l'affiche";
          previewBox.appendChild(img);
          previewBox.hidden = false;
        }
      } catch (err) {
        console.error('preview poster failed', err);
      } finally {
        btnPosterPreview.disabled = false;
      }
    });
  }

  if (btnNative) {
    btnNative.addEventListener('click', async () => {
      if (typeof navigator.share !== 'function' || !currentUrl) return;
      try {
        await navigator.share({
          title: currentLabel ? `Mémoire des Cévennes : ${currentLabel}` : 'Mémoire des Cévennes',
          text: currentLabel ? `Découvre ${currentLabel} sur Mémoire des Cévennes` : 'Mémoire des Cévennes',
          url: currentUrl,
        });
      } catch (err) {
        // L'utilisateur a annulé : pas d'erreur visible.
        if (err && err.name !== 'AbortError') {
          console.warn('navigator.share a échoué', err);
        }
      }
    });
  }

  dlg.querySelectorAll('[data-close]').forEach((b) => {
    b.addEventListener('click', () => dlg.close());
  });

  window.openShare = open;
})();
