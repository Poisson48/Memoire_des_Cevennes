// Boîte de dialogue de confirmation simple, réutilisable.
// Usage : const ok = await window.MdcConfirm('Message ?');
// Boutons « Valider » / « Annuler » personnalisables via opts.

(function () {
  'use strict';

  function ensureDialog() {
    let dlg = document.getElementById('mdc-confirm-dialog');
    if (dlg) return dlg;
    dlg = document.createElement('dialog');
    dlg.id = 'mdc-confirm-dialog';
    dlg.className = 'mdc-confirm-dialog';
    dlg.innerHTML = `
      <form method="dialog" class="mdc-confirm-form">
        <p class="mdc-confirm-message"></p>
        <div class="actions">
          <button type="button" class="btn-ghost" data-action="cancel">Annuler</button>
          <button type="submit" class="btn-primary" value="ok" data-action="ok">Valider</button>
        </div>
      </form>
    `;
    document.body.appendChild(dlg);
    return dlg;
  }

  function confirmDialog(message, opts) {
    opts = opts || {};
    return new Promise(resolve => {
      const dlg = ensureDialog();
      dlg.querySelector('.mdc-confirm-message').textContent = message;
      const okBtn     = dlg.querySelector('[data-action="ok"]');
      const cancelBtn = dlg.querySelector('[data-action="cancel"]');
      okBtn.textContent     = opts.okLabel     || 'Valider';
      cancelBtn.textContent = opts.cancelLabel || 'Annuler';
      cancelBtn.onclick = () => { dlg.close('cancel'); };
      const onClose = () => {
        dlg.removeEventListener('close', onClose);
        resolve(dlg.returnValue === 'ok');
      };
      dlg.addEventListener('close', onClose);
      try { dlg.showModal(); }
      catch { dlg.setAttribute('open', ''); }
    });
  }

  window.MdcConfirm = confirmDialog;
})();
