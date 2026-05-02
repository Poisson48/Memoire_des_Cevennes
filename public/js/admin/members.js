// Mémoire des Cévennes — admin / membres
// Création de comptes par invitation (clé d'usage unique générée serveur),
// approbation des inscriptions en attente, changement de rôle, édition
// du profil (nom / email / téléphone) et signalement des doublons.

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
          phone: (fd.get('phone') || '').trim() || null,
          role:  fd.get('role'),
        }),
      }));
      const j = await res.json();
      if (!res.ok) {
        errEl.textContent = j.error || 'Erreur';
        errEl.hidden = false;
        return;
      }
      let msg = `✓ Compte créé : ${j.member.email} (${j.member.role}). Transmets la clé au membre.`;
      if (j.duplicates) {
        const dupBits = [];
        if (j.duplicates.phone && j.duplicates.phone.length) {
          dupBits.push('téléphone identique à : ' + j.duplicates.phone.map(d => `${d.name} (${d.email})`).join(', '));
        }
        if (j.duplicates.name && j.duplicates.name.length) {
          dupBits.push('même nom que : ' + j.duplicates.name.map(d => `${d.name} (${d.email})`).join(', '));
        }
        if (dupBits.length) msg += ' ⚠ Doublon possible — ' + dupBits.join(' ; ');
      }
      okEl.textContent = msg;
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

function dupBadge(member) {
  if (!member.duplicateHints || !member.duplicateHints.length) return '';
  const labels = member.duplicateHints.map(h => {
    if (h.kind === 'phone') return 'téléphone';
    if (h.kind === 'name')  return 'nom';
    return h.kind;
  });
  return `<span class="status" title="Un autre membre partage : ${labels.join(', ')}" style="background:#fff3cd;color:#856404;border:1px solid #ffe082;padding:0.05rem 0.4rem;border-radius:3px;">⚠ doublon ${labels.join(' / ')}</span>`;
}

function renderMembers(container, members, showApprove) {
  if (!members.length) {
    container.innerHTML = '<p class="empty">— aucun —</p>';
    return;
  }
  container.innerHTML = members.map(m => `
    <article class="queue-item" data-member-id="${escapeAttr(m.id)}">
      <header>
        <strong class="m-name">${escapeHtml(m.name || '(sans nom)')}</strong>
        · <code class="m-email">${escapeHtml(m.email)}</code>
        ${m.phone ? `· <span class="m-phone">${escapeHtml(m.phone)}</span>` : ''}
        · <span class="status">${escapeHtml(m.status)}</span>
        · rôle : <strong>${escapeHtml(m.role)}</strong>
        ${dupBadge(m)}
      </header>
      <p class="meta">
        inscrit le ${escapeHtml(new Date(m.createdAt).toLocaleString('fr-FR'))}
        ${m.approvedAt ? ` · approuvé le ${escapeHtml(new Date(m.approvedAt).toLocaleString('fr-FR'))}` : ''}
        ${m.updatedAt  ? ` · modifié le ${escapeHtml(new Date(m.updatedAt).toLocaleString('fr-FR'))}` : ''}
      </p>
      <div class="actions">
        ${showApprove ? `<button type="button" class="btn-primary" data-member-action="approve">✓ Approuver</button>` : ''}
        <button type="button" class="btn-ghost" data-member-action="edit">✏️ Éditer</button>
        <select data-member-action="role" aria-label="Rôle">
          <option value="member"       ${m.role === 'member' ? 'selected' : ''}>Membre</option>
          <option value="contributor"  ${m.role === 'contributor' ? 'selected' : ''}>Contributeur</option>
          <option value="admin"        ${m.role === 'admin' ? 'selected' : ''}>Admin</option>
        </select>
      </div>
      <div class="member-edit-form" hidden></div>
    </article>
  `).join('');
  container.querySelectorAll('[data-member-action]').forEach(el => {
    const card = el.closest('[data-member-id]');
    const id = card.dataset.memberId;
    if (el.tagName === 'BUTTON' && el.dataset.memberAction === 'approve') {
      el.addEventListener('click', () => handleMemberApprove(id, card));
    } else if (el.tagName === 'BUTTON' && el.dataset.memberAction === 'edit') {
      const m = members.find(x => x.id === id);
      el.addEventListener('click', () => openEdit(card, m));
    } else if (el.tagName === 'SELECT') {
      el.addEventListener('change', () => handleMemberRole(id, el.value, card));
    }
  });
}

function openEdit(card, m) {
  const slot = card.querySelector('.member-edit-form');
  if (!slot) return;
  if (!slot.hidden) { slot.hidden = true; slot.innerHTML = ''; return; }
  slot.hidden = false;
  slot.innerHTML = `
    <form class="legal-form" style="margin-top:0.6rem;border-top:1px solid var(--border);padding-top:0.6rem;">
      <label>Nom et prénom
        <input type="text" name="name" required maxlength="120" value="${escapeAttr(m.name || '')}" />
      </label>
      <label>Adresse e-mail
        <input type="email" name="email" required maxlength="160" value="${escapeAttr(m.email || '')}" />
      </label>
      <label>Téléphone
        <input type="tel" name="phone" maxlength="32" value="${escapeAttr(m.phone || '')}" placeholder="06 12 34 56 78" />
      </label>
      <div class="auth-error edit-err" hidden></div>
      <div class="hint edit-ok" style="color:#2a6e40;" hidden></div>
      <div class="actions">
        <button type="submit" class="btn-primary">Enregistrer</button>
        <button type="button" class="btn-ghost" data-action="cancel">Annuler</button>
      </div>
    </form>
  `;
  const form = slot.querySelector('form');
  const errEl = slot.querySelector('.edit-err');
  const okEl  = slot.querySelector('.edit-ok');
  slot.querySelector('[data-action="cancel"]').addEventListener('click', () => {
    slot.hidden = true; slot.innerHTML = '';
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.hidden = true; okEl.hidden = true;
    const fd = new FormData(form);
    try {
      const res = await fetch(`/api/admin/members/${encodeURIComponent(m.id)}`, authFetchOpts({
        method: 'PATCH',
        body: JSON.stringify({
          name:  fd.get('name'),
          email: fd.get('email'),
          phone: (fd.get('phone') || '').trim() || null,
        }),
      }));
      const j = await res.json();
      if (!res.ok) {
        errEl.textContent = j.error || 'Erreur';
        errEl.hidden = false;
        return;
      }
      okEl.textContent = '✓ Profil mis à jour.';
      okEl.hidden = false;
      setTimeout(refreshMembers, 400);
    } catch (err) {
      errEl.textContent = 'Serveur injoignable : ' + err.message;
      errEl.hidden = false;
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
