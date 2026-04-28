// Partage : ouvre un dialog avec le lien public + un QR code téléchargeable.
// Déclenché par le lien "📤 Partager" dans le footer. Utilise la lib
// qrcodejs (davidshimjs) chargée depuis cdnjs : `new QRCode(el, opts)`
// rend un <canvas> et un <img> dans `el`.

(function () {
  const link = document.getElementById('footer-share');
  const dlg = document.getElementById('dlg-share');
  if (!link || !dlg) return;

  const urlInput = document.getElementById('share-url');
  const qrContainer = document.getElementById('share-qr');
  const btnCopy = document.getElementById('share-copy');
  const btnDownload = document.getElementById('share-download');
  let highResDataUrl = null;
  let rendered = false;

  const SHARE_URL = `${location.origin}/`;

  function renderQRs() {
    if (!window.QRCode || rendered) return;
    rendered = true;
    qrContainer.innerHTML = '';
    new window.QRCode(qrContainer, {
      text: SHARE_URL,
      width: 260,
      height: 260,
      correctLevel: window.QRCode.CorrectLevel.M,
    });
    // Version haute résolution pour le download : on rend dans un div caché.
    const hidden = document.createElement('div');
    hidden.style.display = 'none';
    document.body.appendChild(hidden);
    new window.QRCode(hidden, {
      text: SHARE_URL,
      width: 1024,
      height: 1024,
      correctLevel: window.QRCode.CorrectLevel.H,
    });
    const canvas = hidden.querySelector('canvas');
    if (canvas) highResDataUrl = canvas.toDataURL('image/png');
    hidden.remove();
  }

  link.addEventListener('click', (e) => {
    e.preventDefault();
    urlInput.value = SHARE_URL;
    renderQRs();
    dlg.showModal();
    setTimeout(() => urlInput.select(), 50);
  });

  btnCopy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(SHARE_URL);
    } catch {
      urlInput.select();
      document.execCommand('copy');
    }
    btnCopy.textContent = '✓ Copié';
    setTimeout(() => { btnCopy.textContent = 'Copier'; }, 1800);
  });

  btnDownload.addEventListener('click', () => {
    if (!highResDataUrl) return;
    const a = document.createElement('a');
    a.href = highResDataUrl;
    a.download = 'memoires-cevenoles-qrcode.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
  });

  dlg.querySelectorAll('[data-close]').forEach((b) => {
    b.addEventListener('click', () => dlg.close());
  });
})();
