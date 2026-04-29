// Mémoire des Cévennes — admin / réglages du site (titre, tagline)

const formSettings = document.getElementById('form-settings');
const settingsFeedback = document.getElementById('settings-feedback');
const settingsMeta = document.getElementById('settings-meta');
const SITE_DEFAULTS = {
  title:   'Mémoire des Cévennes',
  tagline: 'Une carte pour recueillir les récits, les voix et les images de nos vallées.',
};

async function refreshSettings() {
  if (!formSettings) return;
  try {
    const cfg = await fetchJson('/api/admin/site-config', authFetchOpts());
    formSettings.elements.title.value   = cfg.title   || '';
    formSettings.elements.tagline.value = cfg.tagline || '';
    if (settingsMeta) {
      settingsMeta.textContent = cfg.updatedAt
        ? `Dernière mise à jour : ${new Date(cfg.updatedAt).toLocaleString('fr-FR')}${cfg.updatedBy ? ' par ' + cfg.updatedBy : ''}`
        : 'Pas encore modifié — valeurs par défaut affichées.';
    }
  } catch (err) {
    if (settingsFeedback) {
      settingsFeedback.textContent = 'Erreur : ' + err.message;
      settingsFeedback.className = 'backup-feedback level-error';
      settingsFeedback.hidden = false;
    }
  }
}

if (formSettings) {
  formSettings.addEventListener('submit', async (e) => {
    e.preventDefault();
    settingsFeedback.hidden = true;
    const fd = new FormData(formSettings);
    try {
      const out = await fetchJson('/api/admin/site-config', authFetchOpts({
        method: 'PUT',
        body: JSON.stringify({
          title:   fd.get('title'),
          tagline: fd.get('tagline'),
        }),
      }));
      settingsFeedback.textContent = '✓ Réglages enregistrés. Recharge une page pour les voir.';
      settingsFeedback.className = 'backup-feedback level-success';
      settingsFeedback.hidden = false;
      // Force un refresh local du cache pour que les pages admin elles-mêmes
      // reflètent les nouvelles valeurs au prochain reload.
      try { localStorage.setItem('mdc-site-config', JSON.stringify(out)); } catch (_) {}
      refreshSettings();
    } catch (err) {
      settingsFeedback.textContent = 'Erreur : ' + err.message;
      settingsFeedback.className = 'backup-feedback level-error';
      settingsFeedback.hidden = false;
    }
  });

  document.getElementById('btn-settings-reset')?.addEventListener('click', () => {
    if (!confirm('Restaurer les valeurs par défaut (« Mémoire des Cévennes » et la tagline d\'origine) ?')) return;
    formSettings.elements.title.value   = SITE_DEFAULTS.title;
    formSettings.elements.tagline.value = SITE_DEFAULTS.tagline;
  });
}
