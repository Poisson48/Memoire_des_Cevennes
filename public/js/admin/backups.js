// Mémoire des Cévennes — admin / sauvegardes & stockage
// Création / liste / téléchargement / restauration / suppression / import.
// Toutes les routes sont sous /api/admin/* — protégées par requireAdmin
// côté serveur. L'export se fait par lien direct (création + download).

const backupsList    = document.getElementById('backups-list');
const backupFeedback = document.getElementById('backup-feedback');
const btnBackupCreate = document.getElementById('btn-backup-create');
const inputBackupImport = document.getElementById('input-backup-import');

function showBackupFeedback(msg, level = 'info') {
  if (!backupFeedback) return;
  backupFeedback.textContent = msg;
  backupFeedback.className = `backup-feedback level-${level}`;
  backupFeedback.hidden = false;
  if (level === 'info' || level === 'success') {
    setTimeout(() => { backupFeedback.hidden = true; }, 6000);
  }
}

function backupKindLabel(kind) {
  return ({
    manual: 'Manuelle',
    auto: 'Auto',
    'pre-restore': 'Pré-restauration',
    export: 'Export',
    import: 'Import',
  })[kind] || (kind || '—');
}

async function refreshBackups() {
  if (!backupsList) return;
  backupsList.innerHTML = '<p class="empty">Chargement…</p>';
  // En parallèle : la liste des archives + les stats de stockage.
  const [listRes, storageRes] = await Promise.allSettled([
    fetchJson('/api/admin/backups', authFetchOpts()),
    fetchJson('/api/admin/storage', authFetchOpts()),
  ]);
  if (listRes.status === 'fulfilled') {
    const data = listRes.value;
    renderBackups(data.backups || [], data.schemaVersion, data.encryptionEnabled);
  } else {
    backupsList.innerHTML = `<p class="empty">Erreur : ${escapeHtml(listRes.reason.message)}</p>`;
  }
  if (storageRes.status === 'fulfilled') {
    renderStoragePanel(storageRes.value);
  } else {
    const el = document.getElementById('storage-panel');
    if (el) el.innerHTML = `<p class="empty">Stockage indisponible.</p>`;
  }
}

function renderStoragePanel(s) {
  const el = document.getElementById('storage-panel');
  if (!el) return;
  const dataB    = s.data    && s.data.bytes    || 0;
  const upB      = s.uploads && s.uploads.bytes || 0;
  const bkB      = s.backups && s.backups.bytes || 0;
  const localTotal = dataB + upB + bkB;

  let diskBar = '';
  if (s.disk && s.disk.totalBytes) {
    const used = s.disk.usedBytes;
    const total = s.disk.totalBytes;
    const pct = Math.min(100, Math.round(100 * used / total));
    const free = s.disk.freeBytes;
    const lowDisk = free < 1024 * 1024 * 1024; // < 1 Go libre
    diskBar = `
      <div class="storage-disk ${lowDisk ? 'low' : ''}">
        <div class="storage-disk-label">
          <strong>Disque serveur</strong> :
          ${escapeHtml(formatSize(used))} utilisés / ${escapeHtml(formatSize(total))}
          (${escapeHtml(formatSize(free))} libres)
          ${lowDisk ? " ⚠ peu d'espace" : ''}
        </div>
        <div class="storage-bar"><span style="width:${pct}%"></span></div>
      </div>`;
  }

  const kindRow = (kind, info) => `
    <span class="storage-kind kind-badge backup-kind backup-kind-${escapeAttr(kind)}">
      ${escapeHtml(backupKindLabel(kind))} : ${info.count} (${escapeHtml(formatSize(info.bytes))})
    </span>`;
  const kindRows = s.backups && s.backups.byKind
    ? Object.entries(s.backups.byKind).map(([k, v]) => kindRow(k, v)).join('')
    : '';

  el.innerHTML = `
    <div class="storage-grid">
      <div class="storage-card">
        <div class="storage-label">Données JSON</div>
        <div class="storage-value">${escapeHtml(formatSize(dataB))}</div>
        <div class="storage-sub">${s.data.fileCount || 0} fichier${(s.data.fileCount || 0) > 1 ? 's' : ''}</div>
      </div>
      <div class="storage-card">
        <div class="storage-label">Médias (uploads/)</div>
        <div class="storage-value">${escapeHtml(formatSize(upB))}</div>
        <div class="storage-sub">${s.uploads.fileCount || 0} fichier${(s.uploads.fileCount || 0) > 1 ? 's' : ''}</div>
      </div>
      <div class="storage-card">
        <div class="storage-label">Sauvegardes</div>
        <div class="storage-value">${escapeHtml(formatSize(bkB))}</div>
        <div class="storage-sub">${s.backups.count} archive${s.backups.count > 1 ? 's' : ''}${s.encryptionEnabled ? ' · 🔒 chiffrées' : ' · 🔓 en clair'}</div>
      </div>
      <div class="storage-card storage-total">
        <div class="storage-label">Total occupé</div>
        <div class="storage-value">${escapeHtml(formatSize(localTotal))}</div>
        <div class="storage-sub">schéma v${escapeHtml(String(s.schemaVersion))}</div>
      </div>
    </div>
    ${kindRows ? `<div class="storage-kinds">${kindRows}</div>` : ''}
    ${diskBar}
  `;
}

function renderBackups(items, serverSchema, serverEncryption) {
  if (!items.length) {
    backupsList.innerHTML = '<p class="empty">— aucune sauvegarde —</p>';
    return;
  }
  backupsList.innerHTML = items.map(b => {
    const m = b.manifest || {};
    const broken = !!m.error;
    const date = m.createdAt
      ? new Date(m.createdAt).toLocaleString('fr-FR')
      : b.id;
    const filesCount = m.files ? Object.keys(m.files).length : 0;
    const uploads = m.uploads || {};
    const versionWarn = (typeof m.schemaVersion === 'number' && serverSchema && m.schemaVersion > serverSchema)
      ? `<span class="schema-warn">⚠ schéma v${m.schemaVersion} > serveur v${serverSchema}</span>`
      : '';
    const encBadge = b.encrypted
      ? `<span class="enc-badge" title="Archive chiffrée AES-256-GCM">🔒 chiffrée</span>`
      : '';
    if (broken) {
      return `
        <article class="queue-item backup-item backup-broken" data-id="${escapeAttr(b.id)}">
          <header class="backup-head">
            <span class="kind-badge backup-kind backup-kind-misc">Illisible</span>
            <strong>${escapeHtml(b.id)}</strong>
            ${encBadge}
          </header>
          <div class="backup-meta">
            ${escapeHtml(formatSize(b.sizeBytes))} · ${escapeHtml(m.error || 'erreur inconnue')}
          </div>
          <div class="item-actions">
            <a class="btn-ghost" href="/api/admin/backups/${encodeURIComponent(b.id)}/download" download>⬇️ Télécharger</a>
            <button type="button" class="btn-ghost btn-delete" data-backup-action="delete">🗑️ Supprimer</button>
          </div>
        </article>
      `;
    }
    return `
      <article class="queue-item backup-item" data-id="${escapeAttr(b.id)}">
        <header class="backup-head">
          <span class="kind-badge backup-kind backup-kind-${escapeAttr(m.kind || 'misc')}">${escapeHtml(backupKindLabel(m.kind))}</span>
          <strong>${escapeHtml(date)}</strong>
          ${m.label ? `<span class="backup-label">${escapeHtml(m.label)}</span>` : ''}
          ${encBadge}
          ${versionWarn}
        </header>
        <div class="backup-meta">
          <code>${escapeHtml(b.id)}</code>
          · ${escapeHtml(formatSize(b.sizeBytes))}
          · app v${escapeHtml(m.appVersion || '?')}
          · schéma v${escapeHtml(String(m.schemaVersion ?? '?'))}
          · ${filesCount} fichier${filesCount > 1 ? 's' : ''} JSON
          ${uploads.fileCount ? ` · ${uploads.fileCount} média${uploads.fileCount > 1 ? 's' : ''} (${escapeHtml(formatSize(uploads.totalSize))})` : ''}
          ${m.createdBy ? ` · par ${escapeHtml(m.createdBy)}` : ''}
        </div>
        ${m.note ? `<div class="backup-note">${escapeHtml(m.note)}</div>` : ''}
        <div class="item-actions">
          <a class="btn-ghost" href="/api/admin/backups/${encodeURIComponent(b.id)}/download" download>⬇️ Télécharger</a>
          <button type="button" class="btn-ghost" data-backup-action="restore">↩️ Restaurer</button>
          <button type="button" class="btn-ghost btn-delete" data-backup-action="delete">🗑️ Supprimer</button>
        </div>
      </article>
    `;
  }).join('');
  backupsList.querySelectorAll('[data-backup-action]').forEach(btn => {
    const card = btn.closest('[data-id]');
    btn.addEventListener('click', () => handleBackupAction(card.dataset.id, btn.dataset.backupAction));
  });
}

async function handleBackupAction(id, action) {
  if (action === 'delete') {
    if (!confirm(`Supprimer définitivement ${id} ? L'archive sera retirée du disque.`)) return;
    try {
      await fetchJson(`/api/admin/backups/${encodeURIComponent(id)}`,
        authFetchOpts({ method: 'DELETE' }));
      showBackupFeedback('Sauvegarde supprimée.', 'success');
      refreshBackups();
    } catch (err) { showBackupFeedback('Erreur : ' + err.message, 'error'); }
    return;
  }
  if (action === 'restore') {
    if (!confirm(
      `Restaurer ${id} ?\n\n` +
      `Toutes les données actuelles (lieux, personnes, récits, médias, ` +
      `comptes membres) seront REMPLACÉES par celles de cette sauvegarde.\n\n` +
      `Un snapshot pre-restore sera créé automatiquement avant l'opération, ` +
      `tu pourras donc revenir en arrière depuis la liste.`,
    )) return;
    showBackupFeedback('Restauration en cours…', 'info');
    try {
      const out = await fetchJson(`/api/admin/backups/${encodeURIComponent(id)}/restore`,
        authFetchOpts({ method: 'POST', body: JSON.stringify({}) }));
      const preId = out.preRestore && out.preRestore.id;
      showBackupFeedback(
        `✓ Restaurée (${out.restored.label || id}).` +
        (preId ? ` Snapshot pre-restore : ${preId}.` : ''),
        'success',
      );
      refreshBackups();
    } catch (err) { showBackupFeedback('Erreur restauration : ' + err.message, 'error'); }
  }
}

if (btnBackupCreate) {
  btnBackupCreate.addEventListener('click', async () => {
    const label = prompt('Libellé pour cette sauvegarde (facultatif) :', '');
    if (label === null) return; // annulé
    btnBackupCreate.disabled = true;
    showBackupFeedback('Création en cours…', 'info');
    try {
      const out = await fetchJson('/api/admin/backups', authFetchOpts({
        method: 'POST',
        body: JSON.stringify({ label }),
      }));
      showBackupFeedback(`✓ Sauvegarde créée : ${out.id} (${formatSize(out.sizeBytes)})`, 'success');
      refreshBackups();
    } catch (err) {
      showBackupFeedback('Erreur : ' + err.message, 'error');
    } finally {
      btnBackupCreate.disabled = false;
    }
  });
}

if (inputBackupImport) {
  inputBackupImport.addEventListener('change', async () => {
    const file = inputBackupImport.files && inputBackupImport.files[0];
    if (!file) return;
    if (!confirm(
      `Importer "${file.name}" (${formatSize(file.size)}) ?\n\n` +
      `Cette opération REMPLACE toutes les données actuelles. ` +
      `Un snapshot pre-restore sera créé avant l'import (annulable).`,
    )) {
      inputBackupImport.value = '';
      return;
    }
    const fd = new FormData();
    fd.append('archive', file);
    showBackupFeedback('Import en cours… (peut prendre du temps selon la taille)', 'info');
    try {
      // Pas de Content-Type explicite : le navigateur ajoute le boundary multipart.
      const res = await fetch('/api/admin/import', {
        method: 'POST',
        credentials: 'same-origin',
        headers: mode() === 'token' ? { 'X-Admin-Token': token() } : {},
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `${res.status}`);
      const preId = json.preRestore && json.preRestore.id;
      showBackupFeedback(
        `✓ Import réussi (importé sous ${json.importedAs}).` +
        (preId ? ` Snapshot pre-restore : ${preId}.` : ''),
        'success',
      );
      refreshBackups();
    } catch (err) {
      showBackupFeedback('Erreur import : ' + err.message, 'error');
    } finally {
      inputBackupImport.value = '';
    }
  });
}

// L'export passe par <a href> direct mais on doit injecter le token
// partagé pour les admins en mode "token" (pas de cookie). En mode JWT,
// le cookie httpOnly est envoyé automatiquement → rien à faire.
const btnBackupExport = document.getElementById('btn-backup-export');
if (btnBackupExport) {
  btnBackupExport.addEventListener('click', async (e) => {
    if (mode() !== 'token') return; // cookie JWT suffit
    e.preventDefault();
    showBackupFeedback('Préparation de l\'archive…', 'info');
    try {
      const res = await fetch('/api/admin/export', {
        headers: { 'X-Admin-Token': token() },
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `${res.status}`);
      }
      const blob = await res.blob();
      const dispo = res.headers.get('content-disposition') || '';
      const m = dispo.match(/filename="([^"]+)"/);
      const filename = m ? m[1] : `mdc-export-${Date.now()}.tar.gz`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(a.href);
      showBackupFeedback('✓ Export téléchargé.', 'success');
      refreshBackups();
    } catch (err) {
      showBackupFeedback('Erreur export : ' + err.message, 'error');
    }
  });
}
