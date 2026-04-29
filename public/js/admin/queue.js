// Mémoire des Cévennes — admin / file de modération
// Liste les contributions en attente : créations (lieu/personne/récit),
// modifications proposées (diff), complétions de récit. Un clic sur
// approve/reject/delete frappe l'API correspondante.

let lastQueue = [];

async function refresh() {
  queueEl.innerHTML = '<p class="empty">Chargement…</p>';
  try {
    const data = await fetchJson('/api/admin/queue', authFetchOpts());
    lastQueue = data.queue;
    renderCounts(data.counts);
    renderQueue(data.queue);
  } catch (err) {
    queueEl.innerHTML = `<p class="empty">Erreur : ${escapeHtml(err.message)}</p>`;
  }
}

function renderCounts(counts) {
  if (!counts) { countsEl.innerHTML = ''; return; }
  const rows = [
    ['Lieux',         counts.places],
    ['Personnes',     counts.people],
    ['Récits',        counts.stories],
    ['Modifications', counts.edits],
    ['Complétions',   counts.completions],
  ];
  countsEl.innerHTML = rows.map(([label, c]) => c ? `
    <div class="count-card">
      ${label} : <strong>${c.pending || 0}</strong> en attente
      <small>· ${c.approved || 0} approuvés · ${c.rejected || 0} refusés</small>
    </div>
  ` : '').join('');
}

function renderQueue(items) {
  const filtered = items.filter(i => {
    if (currentFilter === 'all') return true;
    if (currentFilter === 'edit') return i.kind === 'edit' || i.kind === 'completion';
    return i.kind === currentFilter;
  });
  if (filtered.length === 0) {
    queueEl.innerHTML = '<p class="empty">✨ Rien à modérer — tout est à jour.</p>';
    return;
  }
  queueEl.innerHTML = filtered.map(renderItem).join('');

  // branch les boutons
  queueEl.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => handleAction(btn));
  });
}

function renderItem(qi) {
  if (qi.kind === 'edit') return renderEdit(qi);
  if (qi.kind === 'completion') return renderCompletion(qi);
  return renderCreate(qi);
}

function renderCompletion(qi) {
  const comp = qi.item;
  const who = comp.submittedBy || {};
  const whoLine = [
    who.name ? `<strong>${escapeHtml(who.name)}</strong>` : '<em>Anonyme</em>',
    who.writtenFrom ? `depuis ${escapeHtml(who.writtenFrom)}` : null,
    who.relationship ? `<em>(${escapeHtml(who.relationship)})</em>` : null,
  ].filter(Boolean).join(' · ');
  const date = comp.submittedAt ? new Date(comp.submittedAt).toLocaleString('fr-FR') : '';
  return `
    <article class="queue-item kind-edit" data-kind="completion" data-story-id="${escapeAttr(qi.storyId)}" data-id="${escapeAttr(comp.id)}">
      <div class="item-head">
        <span class="kind-badge edit">Complétion</span>
        <span class="kind-badge type">Récit</span>
        <h3>sur « ${escapeHtml(qi.storyTitle || qi.storyId)} »</h3>
        <span class="item-meta">${whoLine} · ${date}</span>
      </div>
      <div class="item-preview">
        <div class="story-body">${renderBodyWithMentions(comp.body, comp.mentions || [])}</div>
      </div>
      ${renderActions()}
    </article>
  `;
}

function renderCreate(qi) {
  const item = qi.item;
  const type = qi.entityType;
  const sub = item.submittedBy ? `par ${escapeHtml(item.submittedBy.pseudo || item.submittedBy.email || '?')} · ` : '';
  const date = item.submittedAt ? new Date(item.submittedAt).toLocaleString('fr-FR') : '';

  let preview = '';
  if (type === 'places') {
    preview = `
      <div><strong>${escapeHtml(item.primaryName)}</strong> · ${item.lat?.toFixed?.(4)}, ${item.lng?.toFixed?.(4)}</div>
      ${item.description ? `<div>${escapeHtml(item.description)}</div>` : ''}
      ${item.aliases?.length ? `<div class="item-meta">alias : ${item.aliases.map(a => escapeHtml(a.name)).join(' · ')}</div>` : ''}
    `;
  } else if (type === 'people') {
    preview = `
      <div><strong>${escapeHtml(item.primaryName)}</strong>${item.maidenName ? ` (née ${escapeHtml(item.maidenName)})` : ''}</div>
      ${item.bio ? `<div>${escapeHtml(item.bio)}</div>` : ''}
      <div class="item-meta">
        ${item.birth?.year ? `né·e ${item.birth.year}` : ''}
        ${item.death?.year ? ` · † ${item.death.year}` : ''}
      </div>
    `;
  } else if (type === 'stories') {
    preview = `
      ${item.title ? `<div><strong>${escapeHtml(item.title)}</strong></div>` : ''}
      <div class="story-body">${renderBodyWithMentions(item.body || '', item.mentions || [])}</div>
      ${renderMediaFiles(item.mediaFiles || [])}
      <div class="item-meta">
        type : <strong>${escapeHtml(item.type || 'text')}</strong>
        · ancré sur <code>${escapeHtml(item.placeId)}</code>
        ${item.memoryDate ? ` · ${escapeHtml(item.memoryDate)}` : ''}
        ${item.mentions?.length ? ` · ${item.mentions.length} mention${item.mentions.length>1?'s':''}` : ''}
      </div>
    `;
  }

  return `
    <article class="queue-item kind-create" data-kind="create" data-type="${type}" data-id="${escapeAttr(item.id)}">
      <div class="item-head">
        <span class="kind-badge">Nouveau</span>
        <span class="kind-badge type">${typeLabel(type)}</span>
        <h3>${escapeHtml(item.primaryName || item.title || item.id)}</h3>
        <span class="item-meta">${sub}${date}</span>
      </div>
      <div class="item-preview">${preview}</div>
      ${renderActions()}
    </article>
  `;
}

function renderEdit(qi) {
  const edit = qi.item;
  const target = qi.diff?.target;
  const rows = qi.diff?.rows || [];
  const sub = edit.submittedBy ? `par ${escapeHtml(edit.submittedBy.pseudo || edit.submittedBy.email || '?')} · ` : '';
  const date = edit.submittedAt ? new Date(edit.submittedAt).toLocaleString('fr-FR') : '';
  const targetName = target
    ? (target.primaryName || target.title || target.id)
    : edit.targetId;

  const diffHtml = rows.length ? `
    <table class="diff">
      <thead>
        <tr><th class="field">Champ</th><th>Avant</th><th>Après</th></tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td class="field">${escapeHtml(r.field)}</td>
            <td class="before">${formatValue(r.before)}</td>
            <td class="after">${formatValue(r.after)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  ` : '<p class="item-meta">Aucun diff calculable (cible introuvable ?)</p>';

  return `
    <article class="queue-item kind-edit" data-kind="edit" data-type="edits" data-id="${escapeAttr(edit.id)}">
      <div class="item-head">
        <span class="kind-badge edit">Modif</span>
        <span class="kind-badge type">${typeLabel(edit.targetType)}</span>
        <h3>${escapeHtml(targetName)}</h3>
        <span class="item-meta">${sub}${date}</span>
      </div>
      ${edit.note ? `<div class="edit-note">✏️ ${escapeHtml(edit.note)}</div>` : ''}
      ${diffHtml}
      ${renderActions()}
    </article>
  `;
}

function renderActions() {
  return `
    <div class="item-actions">
      <button type="button" class="btn-ghost btn-delete"  data-action="delete">🗑️ Supprimer</button>
      <button type="button" class="btn-ghost btn-reject"  data-action="reject">✗ Refuser</button>
      <button type="button" class="btn-primary btn-approve" data-action="approve">✓ Approuver</button>
    </div>
  `;
}

async function handleAction(btn) {
  const card = btn.closest('.queue-item');
  const kind = card.dataset.kind;
  const type = card.dataset.type;
  const id = card.dataset.id;
  const action = btn.dataset.action;

  let reason = '';
  if (action === 'reject') {
    reason = prompt('Motif du refus (sera visible dans les archives) :', '');
    if (reason === null) return;
  }
  if (action === 'delete') {
    if (!confirm('Suppression DÉFINITIVE — cette contribution sera retirée de la base et ses médias effacés du serveur. Continuer ?')) return;
  }

  let url, method = 'POST';
  if (action === 'delete') {
    method = 'DELETE';
    if (kind === 'completion') {
      url = `/api/admin/stories/${encodeURIComponent(card.dataset.storyId)}/completions/${encodeURIComponent(id)}`;
    } else if (kind === 'edit') {
      // Pour les propositions de modification, "supprimer" = "rejeter" sans motif.
      url = `/api/admin/edits/${encodeURIComponent(id)}/reject`;
      method = 'POST';
    } else {
      url = `/api/admin/${type}/${encodeURIComponent(id)}`;
    }
  } else if (kind === 'edit') {
    url = `/api/admin/edits/${encodeURIComponent(id)}/${action}`;
  } else if (kind === 'completion') {
    url = `/api/admin/stories/${encodeURIComponent(card.dataset.storyId)}/completions/${encodeURIComponent(id)}/${action}`;
  } else {
    url = `/api/admin/${type}/${encodeURIComponent(id)}/${action}`;
  }

  try {
    await fetchJson(url, authFetchOpts({
      method,
      body: method === 'DELETE' ? undefined : JSON.stringify({ reviewer: reviewer(), reason }),
    }));
    card.style.opacity = '0.5';
    setTimeout(refresh, 300);
  } catch (err) {
    alert('Erreur : ' + err.message);
  }
}

// Rend le corps d'un récit avec les mentions surlignées et cliquables.
// Les offsets `start`/`end` correspondent à la chaîne en code units UTF-16.
function renderBodyWithMentions(body, mentions) {
  if (!body) return '<em>(vide)</em>';
  const sorted = [...mentions]
    .filter(m => m && typeof m.start === 'number' && typeof m.end === 'number')
    .sort((a, b) => a.start - b.start);
  if (!sorted.length) return escapeHtml(body).replace(/\n/g, '<br>');
  let out = '';
  let cursor = 0;
  for (const m of sorted) {
    if (m.start < cursor || m.end > body.length) continue;
    out += escapeHtml(body.slice(cursor, m.start));
    const label = body.slice(m.start, m.end);
    const href = m.type === 'place' ? `#/lieu/${m.entityId}` : `#/personne/${m.entityId}`;
    const icon = m.type === 'place' ? '📍' : '👤';
    out += `<a class="mention-link" href="${escapeAttr(href)}" target="_blank" rel="noopener" title="${escapeHtml(m.type)} : ${escapeHtml(m.entityId)}">${icon} ${escapeHtml(label)}</a>`;
    cursor = m.end;
  }
  out += escapeHtml(body.slice(cursor));
  return out.replace(/\n/g, '<br>');
}

// Rend les médias attachés à un récit pour relecture en file de modération.
// Inline preview pour images/audio/vidéo, lien pour le reste.
function renderMediaFiles(files) {
  if (!Array.isArray(files) || !files.length) return '';
  const items = files.map(f => {
    if (!f || !f.url) return '';
    const url = escapeAttr(f.url);
    const cap = f.caption ? `<figcaption>${escapeHtml(f.caption)}</figcaption>` : '';
    if (f.mime?.startsWith('image/')) {
      return `<figure class="qmedia"><img src="${url}" alt="${escapeAttr(f.caption || 'média')}" loading="lazy">${cap}</figure>`;
    }
    if (f.mime?.startsWith('audio/')) {
      return `<figure class="qmedia"><audio controls preload="metadata" src="${url}"></audio>${cap}</figure>`;
    }
    if (f.mime?.startsWith('video/')) {
      return `<figure class="qmedia"><video controls preload="metadata" src="${url}" style="max-width:100%;max-height:280px"></video>${cap}</figure>`;
    }
    return `<div class="qmedia"><a href="${url}" target="_blank" rel="noopener">📎 ${escapeHtml(f.url.split('/').pop())}</a>${cap}</div>`;
  }).join('');
  return `<div class="qmedia-list">${items}</div>`;
}
