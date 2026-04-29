// Mémoire des Cévennes — admin / membres
// Création de comptes par invitation (clé d'usage unique générée serveur),
// approbation des inscriptions en attente, changement de rôle.

// Formulaire de création directe d'un compte (admin seulement, route protégée)
const formCreateMember = document.getElementById('form-create-member');
if (formCreateMember) {
  formCreateMember.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('create-member-error');
    const okEl  = document.getElementById('create-member-success');
    errEl.hidden = true; okEl.hidden = true;
    const fd = new FormData(formCreateMember);
    try {
      const res = await fetch('/api/admin/members', authFetchOpts({
        method: 'POST',
        body: JSON.stringify({
          name:  fd.get('name'),
          email: fd.get('email'),
          role:  fd.get('role'),
        }),
      }));
      const j = await res.json();
      if (!res.ok) {
        errEl.textContent = j.error || 'Erreur';
        errEl.hidden = false;
        return;
      }
      okEl.textContent = `✓ Compte créé : ${j.member.email} (${j.member.role}). Transmets la clé au membre.`;
      okEl.hidden = false;
      formCreateMember.reset();
      // Affiche la clé une seule fois — l'admin doit la copier maintenant.
      // (Elle reste réaffichable depuis l'onglet Mots de passe oubliés
      // tant que l'invitation est "approved".)
      showResetKeyDialog(j.key, { member: j.member });
      refreshMembers();
      refreshResets();
    } catch (err) {
      errEl.textContent = 'Serveur injoignable : ' + err.message;
      errEl.hidden = false;
    }
  });
}

async function refreshMembers() {
  document.getElementById('members-pending').innerHTML = '<p class="empty">Chargement…</p>';
  document.getElementById('members-active').innerHTML  = '';
  try {
    const { members } = await fetchJson('/api/admin/members', authFetchOpts());
    const pending = members.filter(m => m.status !== 'active');
    const active  = members.filter(m => m.status === 'active');
    renderMembers(document.getElementById('members-pending'), pending, true);
    renderMembers(document.getElementById('members-active'),  active,  false);
  } catch (err) {
    document.getElementById('members-pending').innerHTML =
      `<p class="empty">Erreur : ${escapeHtml(err.message)}</p>`;
  }
}

function renderMembers(container, members, showApprove) {
  if (!members.length) {
    container.innerHTML = '<p class="empty">— aucun —</p>';
    return;
  }
  container.innerHTML = members.map(m => `
    <article class="queue-item" data-member-id="${escapeAttr(m.id)}">
      <header>
        <strong>${escapeHtml(m.name || '(sans nom)')}</strong>
        · <code>${escapeHtml(m.email)}</code>
        · <span class="status">${escapeHtml(m.status)}</span>
        · rôle : <strong>${escapeHtml(m.role)}</strong>
      </header>
      <p class="meta">
        inscrit le ${escapeHtml(new Date(m.createdAt).toLocaleString('fr-FR'))}
        ${m.approvedAt ? ` · approuvé le ${escapeHtml(new Date(m.approvedAt).toLocaleString('fr-FR'))}` : ''}
      </p>
      <div class="actions">
        ${showApprove ? `<button type="button" class="btn-primary" data-member-action="approve">✓ Approuver</button>` : ''}
        <select data-member-action="role" aria-label="Rôle">
          <option value="member"       ${m.role === 'member' ? 'selected' : ''}>Membre</option>
          <option value="contributor"  ${m.role === 'contributor' ? 'selected' : ''}>Contributeur</option>
          <option value="admin"        ${m.role === 'admin' ? 'selected' : ''}>Admin</option>
        </select>
      </div>
    </article>
  `).join('');
  container.querySelectorAll('[data-member-action]').forEach(el => {
    const card = el.closest('[data-member-id]');
    const id = card.dataset.memberId;
    if (el.tagName === 'BUTTON' && el.dataset.memberAction === 'approve') {
      el.addEventListener('click', () => handleMemberApprove(id, card));
    } else if (el.tagName === 'SELECT') {
      el.addEventListener('change', () => handleMemberRole(id, el.value, card));
    }
  });
}

async function handleMemberApprove(id, card) {
  try {
    await fetchJson(`/api/admin/members/${encodeURIComponent(id)}/approve`,
      { method: 'POST', headers: authHeaders() });
    card.style.opacity = '0.5';
    setTimeout(refreshMembers, 300);
  } catch (err) { alert('Erreur : ' + err.message); }
}

async function handleMemberRole(id, role, card) {
  try {
    await fetchJson(`/api/admin/members/${encodeURIComponent(id)}/role`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ role }),
    });
  } catch (err) { alert('Erreur : ' + err.message); refreshMembers(); }
}
