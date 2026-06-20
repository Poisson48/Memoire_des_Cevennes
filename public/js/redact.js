// Mémoire des Cévennes : éditeur d'anonymisation / censure des récits.
//
// Reserve aux membres et admins (le bouton « 🕶️ Anonymiser » n'apparait que
// pour eux, cf. app.js renderStoryCard). On selectionne un passage du corps,
// on choisit le mode (anonymiser / censurer) et l'audience a qui le cacher.
// Effet immediat cote serveur (POST /api/stories/:id/redactions) : proteger
// la vie privee n'attend pas la moderation. Le retrait est reserve aux admins.
//
// Les offsets start/end sont en code units UTF-16 dans le body, comme les
// mentions (cf. tagger.js). Le serveur revalide que la portion ciblee
// correspond bien au texte selectionne (garde-fou d'integrite).

(function () {
  const dlg = document.getElementById('dlg-redact');
  if (!dlg) return;
  const form = document.getElementById('form-redact');
  const bodyEl = document.getElementById('redact-body');
  const selEl = document.getElementById('redact-selection');
  const submitBtn = document.getElementById('redact-submit');
  const replWrap = document.getElementById('redact-replacement-wrap');
  const existingEl = document.getElementById('redact-existing');

  let currentStoryId = null;
  let pending = null; // { start, end, text }

  dlg.querySelectorAll('[data-close]').forEach(b =>
    b.addEventListener('click', () => dlg.close('cancel'))
  );

  // Affiche/masque le champ "texte de remplacement" selon le mode.
  form.querySelectorAll('input[name="redact-mode"]').forEach(r =>
    r.addEventListener('change', syncModeUI)
  );
  function syncModeUI() {
    const mode = form.querySelector('input[name="redact-mode"]:checked').value;
    replWrap.style.display = mode === 'anonymize' ? '' : 'none';
  }

  // Ouverture : remplit le texte et la liste des redactions existantes.
  window.openRedactDialog = function (storyId) {
    const all = (typeof state !== 'undefined' && state.stories) || [];
    const story = all.find(s => s.id === storyId);
    if (!story) { alert('Récit introuvable.'); return; }
    currentStoryId = storyId;
    pending = null;
    // textContent : pas d'interpretation HTML, offsets = texte brut.
    bodyEl.textContent = story.body || '';
    selEl.textContent = '(rien sélectionné)';
    submitBtn.disabled = true;
    form.reset();
    syncModeUI();
    renderExisting(story);
    dlg.showModal();
  };

  // Selection dans la zone de texte du dialog -> calcule les offsets.
  bodyEl.addEventListener('mouseup', captureSelection);
  bodyEl.addEventListener('keyup', captureSelection);
  function captureSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    if (!bodyEl.contains(range.startContainer) || !bodyEl.contains(range.endContainer)) return;
    const text = sel.toString();
    if (!text.trim()) return;
    const pre = document.createRange();
    pre.selectNodeContents(bodyEl);
    pre.setEnd(range.startContainer, range.startOffset);
    const start = pre.toString().length;
    const end = start + text.length;
    pending = { start, end, text };
    selEl.textContent = text.length > 80 ? text.slice(0, 80) + '…' : text;
    submitBtn.disabled = false;
  }

  function renderExisting(story) {
    const reds = (story.redactions || []);
    const isAdmin = typeof hasRole === 'function' && hasRole('admin');
    if (!reds.length) { existingEl.innerHTML = ''; return; }
    existingEl.innerHTML = '<h3>Passages déjà masqués</h3>' +
      '<ul class="redact-list">' +
      reds.map(r => {
        const where = r.hideBelow === 'admin' ? 'public + membres' : 'public';
        const what = r.mode === 'censor' ? 'censuré' : ('anonymisé → « ' + (r.replacement || '[anonymisé]') + ' »');
        const label = `caractères ${r.start}–${r.end} · ${what} · caché à : ${where}`;
        const del = isAdmin
          ? `<button type="button" class="btn-ghost btn-inline redact-del" data-rid="${escAttr(r.id)}" title="Retirer ce masquage">🗑️</button>`
          : '';
        return `<li>${escHtml(label)} ${del}</li>`;
      }).join('') + '</ul>';
    existingEl.querySelectorAll('.redact-del').forEach(btn =>
      btn.addEventListener('click', () => removeRedaction(btn.dataset.rid))
    );
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!pending || !currentStoryId) return;
    const mode = form.querySelector('input[name="redact-mode"]:checked').value;
    const hideBelow = form.querySelector('input[name="redact-hide"]:checked').value;
    const payload = {
      start: pending.start,
      end: pending.end,
      text: pending.text,
      mode,
      hideBelow,
      replacement: form.querySelector('input[name="redact-replacement"]').value || '',
      reason: form.querySelector('input[name="redact-reason"]').value || '',
    };
    submitBtn.disabled = true;
    try {
      const res = await fetch(`/api/stories/${encodeURIComponent(currentStoryId)}/redactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      dlg.close('submit');
      alert('Passage masqué. La page va se recharger pour appliquer le changement.');
      location.reload();
    } catch (err) {
      alert('Erreur : ' + err.message);
      submitBtn.disabled = false;
    }
  });

  async function removeRedaction(rid) {
    if (!currentStoryId || !rid) return;
    if (!confirm('Retirer ce masquage ? Le passage redeviendra visible.')) return;
    try {
      const res = await fetch(
        `/api/stories/${encodeURIComponent(currentStoryId)}/redactions/${encodeURIComponent(rid)}`,
        { method: 'DELETE', credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      dlg.close('submit');
      location.reload();
    } catch (err) {
      alert('Erreur : ' + err.message);
    }
  }

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escAttr(s) { return escHtml(s).replace(/"/g, '&quot;'); }
})();
