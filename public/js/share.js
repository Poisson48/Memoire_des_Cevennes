// Partage : ouvre un dialog avec un lien et un QR code téléchargeable.
// API publique : `window.openShare({ url, label, intro })` — utilisable
// depuis n'importe quel module (panneau lieu/personne, récit, footer).
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
    // Haute résolution pour le download.
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

  function open(opts) {
    const url   = (opts && opts.url)   || `${location.origin}/`;
    const label = (opts && opts.label) || 'le site';
    const intro = (opts && opts.intro) || `Envoie ce lien à quelqu'un ou fais-lui scanner le QR code.`;
    currentUrl = url;
    currentLabel = label;
    if (titleEl) titleEl.textContent = `📤 Partager ${label}`;
    if (introEl) introEl.textContent = intro;
    urlInput.value = url;
    renderQRs(url);
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
      const a = document.createElement('a');
      a.href = highResDataUrl;
      const slug = (currentLabel || 'partage').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      a.download = `qr-${slug || 'partage'}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
  }

  dlg.querySelectorAll('[data-close]').forEach((b) => {
    b.addEventListener('click', () => dlg.close());
  });

  window.openShare = open;
})();
