// Partage : ouvre un dialog avec le lien public + un QR code téléchargeable.
// Déclenché par le lien "📤 Partager" dans le footer.

(function () {
  const link = document.getElementById('footer-share');
  const dlg = document.getElementById('dlg-share');
  if (!link || !dlg) return;

  const urlInput = document.getElementById('share-url');
  const qrImg = document.getElementById('share-qr');
  const btnCopy = document.getElementById('share-copy');
  const btnDownload = document.getElementById('share-download');
  let highResDataUrl = null;

  const SHARE_URL = `${location.origin}/`;

  async function generateQRs() {
    if (!window.QRCode) return;
    const small = await QRCode.toDataURL(SHARE_URL, {
      width: 260, margin: 2, errorCorrectionLevel: 'M',
    });
    qrImg.src = small;
    highResDataUrl = await QRCode.toDataURL(SHARE_URL, {
      width: 1024, margin: 4, errorCorrectionLevel: 'H',
    });
  }

  link.addEventListener('click', async (e) => {
    e.preventDefault();
    urlInput.value = SHARE_URL;
    if (!qrImg.src) await generateQRs();
    dlg.showModal();
    setTimeout(() => urlInput.select(), 50);
  });

  btnCopy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(SHARE_URL);
      btnCopy.textContent = '✓ Copié';
      setTimeout(() => { btnCopy.textContent = 'Copier'; }, 1800);
    } catch {
      urlInput.select();
      document.execCommand('copy');
      btnCopy.textContent = '✓ Copié';
      setTimeout(() => { btnCopy.textContent = 'Copier'; }, 1800);
    }
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
