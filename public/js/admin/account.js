// Mémoire des Cévennes : admin / mon compte (changer son mot de passe)

const formAccountPwd     = document.getElementById('form-account-password');
const accountTokenNotice = document.getElementById('account-token-notice');
const accountIdentity    = document.getElementById('account-identity');
const accountPwdError    = document.getElementById('account-password-error');
const accountPwdSuccess  = document.getElementById('account-password-success');

async function refreshAccount() {
  if (!formAccountPwd) return;
  accountPwdError.hidden = true;
  accountPwdSuccess.hidden = true;

  // En mode token partagé, pas de compte personnel : on cache le formulaire.
  if (mode() === 'token') {
    formAccountPwd.hidden = true;
    if (accountTokenNotice) accountTokenNotice.hidden = false;
    if (accountIdentity) accountIdentity.textContent = '';
    return;
  }

  formAccountPwd.hidden = false;
  if (accountTokenNotice) accountTokenNotice.hidden = true;

  try {
    const me = await fetchJson('/api/auth/me', { credentials: 'same-origin' });
    if (accountIdentity && me && me.member) {
      const role = me.member.role || 'member';
      accountIdentity.textContent =
        `Connecté·e en tant que ${me.member.name || me.member.email} (${role}).`;
    }
  } catch {
    if (accountIdentity) accountIdentity.textContent = '';
  }
}

if (formAccountPwd) {
  formAccountPwd.addEventListener('submit', async (e) => {
    e.preventDefault();
    accountPwdError.hidden = true;
    accountPwdSuccess.hidden = true;

    const fd = new FormData(formAccountPwd);
    const oldPassword     = fd.get('oldPassword');
    const newPassword     = fd.get('newPassword');
    const confirmPassword = fd.get('confirmPassword');

    if (newPassword !== confirmPassword) {
      accountPwdError.textContent = 'Les deux nouveaux mots de passe ne correspondent pas.';
      accountPwdError.hidden = false;
      return;
    }
    if (String(newPassword).length < 8) {
      accountPwdError.textContent = 'Le nouveau mot de passe doit faire 8 caractères minimum.';
      accountPwdError.hidden = false;
      return;
    }

    try {
      const res = await fetch('/api/auth/me/password', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPassword, newPassword }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        accountPwdError.textContent = json.error || `Erreur ${res.status}`;
        accountPwdError.hidden = false;
        return;
      }
      formAccountPwd.reset();
      accountPwdSuccess.textContent = 'Mot de passe mis à jour. Reste connecté·e ; pense à le noter dans ton gestionnaire.';
      accountPwdSuccess.hidden = false;
    } catch (err) {
      accountPwdError.textContent = 'Serveur injoignable : ' + err.message;
      accountPwdError.hidden = false;
    }
  });
}
