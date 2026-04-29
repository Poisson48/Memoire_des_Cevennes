// Mémoire des Cévennes — admin / mots de passe oubliés (et invitations)
// Demandes de réinitialisation publiques (/forgot.html) + invitations
// créées par l'admin sont gérées ici. Une approbation génère une clé
// d'usage unique réaffichable tant que la demande est `approved`.

async function refreshResets() {
  const pendingEl  = document.getElementById('resets-pending');
  const approvedEl = document.getElementById('resets-approved');
  const archiveEl  = document.getElementById('resets-archive');
  pendingEl.innerHTML  = '<p class="empty">Chargement…</p>';
  approvedEl.innerHTML = '';
  archiveEl.innerHTML  = '';
  try {
    const { requests } = await fetchJson('/api/admin/password-resets', authFetchOpts());
    const pending  = requests.filter(r => r.status === 'pending');
    const approved = requests.filter(r => r.status === 'approved');
    const archive  = requests.filter(r => r.status !== 'pending' && r.status !== 'approved');
    renderResets(pendingEl,  pending,  'pending');
    renderResets(approvedEl, approved, 'approved');
    renderResets(archiveEl,  archive,  'archive');
  } catch (err) {
    pendingEl.innerHTML = `<p class="empty">Erreur : ${escapeHtml(err.message)}</p>`;
  }
}

function renderResets(container, items, kind) {
  if (!items.length) {
    container.innerHTML = '<p class="empty">— aucune —</p>';
    return;
  }
  container.innerHTML = items.map(r => {
    const memberLine = r.member
      ? `<strong>${escapeHtml(r.member.name || '(sans nom)')}</strong> · <code>${escapeHtml(r.member.email)}</code> · rôle ${escapeHtml(r.member.role)}`
      : `<em>Aucun compte ne correspond à <code>${escapeHtml(r.emailRequested || '?')}</code></em>`;
    const submittedAt = r.requestedAt ? new Date(r.requestedAt).toLocaleString('fr-FR') : '—';
    const expiresAt   = r.expiresAt   ? new Date(r.expiresAt).toLocaleString('fr-FR')   : null;
    const reviewedAt  = r.reviewedAt  ? new Date(r.reviewedAt).toLocaleString('fr-FR')  : null;

    let actionsHtml = '';
    if (kind === 'pending') {
      const canApprove = Boolean(r.memberId);
      actionsHtml = `
        <div class="actions">
          <button type="button" class="btn-primary" data-reset-action="approve"
                  ${canApprove ? '' : 'disabled title="Aucun compte trouvé pour cet email — refuser plutôt"'}>
            ✓ Approuver
          </button>
          <button type="button" class="btn-ghost" data-reset-action="reject">✕ Refuser</button>
        </div>`;
    } else if (kind === 'approved') {
      actionsHtml = `
        <div class="actions">
          <button type="button" class="btn-ghost" data-reset-action="show-key">🔑 Réafficher la clé</button>
        </div>`;
    }

    const statusLabel = ({
      pending:   'en attente',
      approved:  'approuvée',
      rejected:  'refusée',
      consumed:  'utilisée',
      expired:   'expirée',
    })[r.status] || r.status;
    const kindLabel = r.kind === 'invite' ? '🎫 invitation' : '🔄 réinitialisation';
    const submittedLine = r.kind === 'invite'
      ? `créée le ${escapeHtml(submittedAt)}${r.reviewerName ? ' par ' + escapeHtml(r.reviewerName) : ''}`
      : `demandé le ${escapeHtml(submittedAt)}${r.requestedFromIp ? ` <small>(IP ${escapeHtml(r.requestedFromIp)})</small>` : ''}`;

    return `
      <article class="queue-item" data-reset-id="${escapeAttr(r.id)}" data-key-plain="${escapeAttr(r.keyPlain || '')}">
        <header>
          <span class="status" style="margin-right:0.4rem;">${escapeHtml(kindLabel)}</span>
          ${memberLine}
          · <span class="status">${escapeHtml(statusLabel)}</span>
        </header>
        <p class="meta">${submittedLine}</p>
        ${r.name    ? `<p class="meta">Nom donné : <strong>${escapeHtml(r.name)}</strong></p>` : ''}
        ${r.message ? `<p class="meta" style="white-space:pre-wrap;">${escapeHtml(r.message)}</p>` : ''}
        ${reviewedAt ? `<p class="meta">Modéré le ${escapeHtml(reviewedAt)}${r.reviewerName ? ' par ' + escapeHtml(r.reviewerName) : ''}</p>` : ''}
        ${kind === 'approved' && expiresAt ? `<p class="meta">Clé valide jusqu'au <strong>${escapeHtml(expiresAt)}</strong>${r.keyHint ? ` · indice : <code>${escapeHtml(r.keyHint)}</code>` : ''}</p>` : ''}
        ${r.rejectedReason ? `<p class="meta">Raison du refus : ${escapeHtml(r.rejectedReason)}</p>` : ''}
        ${actionsHtml}
      </article>`;
  }).join('');
  container.querySelectorAll('[data-reset-action]').forEach(btn => {
    const card = btn.closest('[data-reset-id]');
    btn.addEventListener('click', () => handleResetAction(btn.dataset.resetAction, card));
  });
}

async function handleResetAction(action, card) {
  const id = card.dataset.resetId;
  if (action === 'approve') {
    if (!confirm('Approuver cette demande ? Tu vas générer une clé à transmettre au membre.')) return;
    try {
      const out = await fetchJson(`/api/admin/password-resets/${encodeURIComponent(id)}/approve`,
        authFetchOpts({ method: 'POST', body: '{}' }));
      showResetKeyDialog(out.key, out.request);
      refreshResets();
    } catch (err) { alert('Erreur : ' + err.message); }
    return;
  }
  if (action === 'reject') {
    const reason = prompt('Raison du refus (optionnel — pour l\'audit) :', '');
    if (reason === null) return; // annulé
    try {
      await fetchJson(`/api/admin/password-resets/${encodeURIComponent(id)}/reject`,
        authFetchOpts({ method: 'POST', body: JSON.stringify({ reason }) }));
      refreshResets();
    } catch (err) { alert('Erreur : ' + err.message); }
    return;
  }
  if (action === 'show-key') {
    const key = card.dataset.keyPlain;
    if (!key) { alert('Clé non disponible (déjà consommée ou expirée).'); return; }
    showResetKeyDialog(key, null);
  }
}

function showResetKeyDialog(key, request) {
  const dlg     = document.getElementById('reset-key-dialog');
  const valueEl = document.getElementById('reset-key-value');
  const metaEl  = document.getElementById('reset-key-meta');
  valueEl.textContent = key;
  if (request && request.member) {
    metaEl.textContent = `Pour ${request.member.name || ''} <${request.member.email}>`;
  } else {
    metaEl.textContent = '';
  }
  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.setAttribute('open', '');
}

document.getElementById('btn-close-reset-dialog')?.addEventListener('click', () => {
  const dlg = document.getElementById('reset-key-dialog');
  if (typeof dlg.close === 'function') dlg.close();
  else dlg.removeAttribute('open');
});

document.getElementById('btn-copy-reset-key')?.addEventListener('click', async () => {
  const txt = document.getElementById('reset-key-value').textContent;
  try {
    await navigator.clipboard.writeText(txt);
    const btn = document.getElementById('btn-copy-reset-key');
    const old = btn.textContent;
    btn.textContent = '✓ Copié';
    setTimeout(() => { btn.textContent = old; }, 1500);
  } catch {
    alert('Copie impossible — sélectionne le texte manuellement.');
  }
});
