// Mémoire des Cévennes — admin / page d'accueil
// Édition du markdown affiché dans le modal d'accueil de la home. Aperçu
// live via le parseur partagé public/js/markdown.js.

const welcomeMd       = document.getElementById('welcome-md');
const welcomePreview  = document.getElementById('welcome-preview');
const welcomeMeta     = document.getElementById('welcome-meta');
const welcomeFeedback = document.getElementById('welcome-feedback');
const btnWelcomeSave  = document.getElementById('btn-welcome-save');
const btnWelcomeReset = document.getElementById('btn-welcome-reset');

let _welcomeOriginal = '';

function showWelcomeFeedback(msg, level = 'info') {
  if (!welcomeFeedback) return;
  welcomeFeedback.textContent = msg;
  welcomeFeedback.className = `backup-feedback level-${level}`;
  welcomeFeedback.hidden = false;
  if (level !== 'error') {
    setTimeout(() => { welcomeFeedback.hidden = true; }, 5000);
  }
}

function refreshWelcomePreview() {
  if (!welcomePreview) return;
  const md = welcomeMd ? welcomeMd.value : '';
  welcomePreview.innerHTML = window.MdcMarkdown
    ? window.MdcMarkdown.render(md)
    : escapeHtml(md);
}

async function refreshWelcome() {
  if (!welcomeMd) return;
  welcomeMd.value = '— chargement —';
  try {
    // /api/welcome est public, pas besoin d'auth headers
    const res = await fetch('/api/welcome', { credentials: 'same-origin' });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    welcomeMd.value = data.content || '';
    _welcomeOriginal = welcomeMd.value;
    if (welcomeMeta) {
      const when = data.updatedAt ? new Date(data.updatedAt).toLocaleString('fr-FR') : '— jamais modifié —';
      welcomeMeta.textContent = `Dernière modif : ${when}${data.updatedBy ? ` par ${data.updatedBy}` : ''}`;
    }
    refreshWelcomePreview();
  } catch (err) {
    showWelcomeFeedback('Erreur chargement : ' + err.message, 'error');
  }
}

if (welcomeMd) {
  welcomeMd.addEventListener('input', refreshWelcomePreview);
}

if (btnWelcomeSave) {
  btnWelcomeSave.addEventListener('click', async () => {
    btnWelcomeSave.disabled = true;
    showWelcomeFeedback('Enregistrement…', 'info');
    try {
      const out = await fetchJson('/api/admin/welcome', authFetchOpts({
        method: 'PUT',
        body: JSON.stringify({ content: welcomeMd.value }),
      }));
      _welcomeOriginal = welcomeMd.value;
      if (welcomeMeta) {
        welcomeMeta.textContent = `Dernière modif : ${new Date(out.updatedAt).toLocaleString('fr-FR')}${out.updatedBy ? ` par ${out.updatedBy}` : ''}`;
      }
      showWelcomeFeedback('✓ Page d\'accueil enregistrée.', 'success');
    } catch (err) {
      showWelcomeFeedback('Erreur : ' + err.message, 'error');
    } finally {
      btnWelcomeSave.disabled = false;
    }
  });
}

if (btnWelcomeReset) {
  btnWelcomeReset.addEventListener('click', () => {
    if (!confirm('Restaurer le contenu par défaut (Bienvenue sur Mémoire des Cévennes…) ? Ne sera enregistré qu\'après clic sur « Enregistrer ».')) return;
    welcomeMd.value = `# Bienvenue sur Mémoire des Cévennes

Cette carte vivante rassemble les **lieux**, les **personnes** et les **histoires** de Saint-Roman-de-Codières et de ses alentours.

## Comment ça marche

- 📍 **Explore la carte** : clique sur les pastilles pour découvrir lieux et récits.
- 📖 **Lis les fiches** : chaque lieu peut contenir des photos, des audios, des témoignages.
- ✍️ **Contribue** : crée un compte pour ajouter tes propres souvenirs (modérés par l'association).

## Rejoindre l'aventure

Pour aller plus loin, [crée un compte membre](register.html) ou [consulte le tutoriel](aide.html).

*Bonne visite !*
`;
    refreshWelcomePreview();
  });
}
