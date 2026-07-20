// Mémoire des Cévennes : admin / journal d'activité
// Affiche le journal d'audit (data/activity_log.json) : qui a fait quoi,
// quand, sur quoi. Le journal ne stocke qu'un UUID de membre et un code
// d'action : on traduit les deux ici pour que ce soit lisible.

// Libellé lisible + pictogramme par code d'action. Toute action absente
// de cette table s'affiche telle quelle (aucune perte d'information).
const ACTIVITY_LABELS = {
  // Contenu
  'create':                  ['➕', 'Création'],
  'update':                  ['✏️', 'Modification'],
  'delete':                  ['🗑️', 'Suppression'],
  'place.move':              ['📍', 'Lieu déplacé'],
  'place.aliases.update':    ['🏷️', 'Alias d’un lieu modifiés'],
  'person.aliases.update':   ['🏷️', 'Alias d’une personne modifiés'],
  'redact':                  ['🕶️', 'Passage masqué'],
  'unredact':                ['👁️', 'Masquage retiré'],
  'edit.submit':             ['📝', 'Proposition de modification'],
  // Modération
  'moderation.approve':      ['✅', 'Contenu validé'],
  'moderation.reject':       ['⛔', 'Contenu refusé'],
  'moderation.delete':       ['🔥', 'Contenu supprimé définitivement'],
  'edit.approve':            ['✅', 'Proposition acceptée'],
  'edit.reject':             ['⛔', 'Proposition refusée'],
  'completion.approve':      ['✅', 'Complétion acceptée'],
  'completion.reject':       ['⛔', 'Complétion refusée'],
  'completion.delete':       ['🗑️', 'Complétion supprimée'],
  // Comptes et connexions
  'member.register':         ['🆕', 'Inscription'],
  'member.invite':           ['🎫', 'Invitation créée'],
  'member.approve':          ['✅', 'Compte validé'],
  'member.reject':           ['⛔', 'Compte refusé'],
  'member.role-change':      ['⚠️', 'Changement de rôle'],
  'member.self-update':      ['👤', 'Profil modifié par le membre'],
  'member.password-change':  ['🔑', 'Mot de passe changé'],
  'member.login':            ['🔓', 'Connexion membre'],
  'member.login-failed':     ['🚫', 'Échec de connexion'],
  'member.logout':           ['🔒', 'Déconnexion'],
  'admin.login':             ['🛡️', 'Connexion administrateur'],
  'admin.login-failed':      ['🚫', 'Échec de connexion admin'],
  'admin.member-update':     ['👥', 'Membre modifié par l’admin'],
  'admin.member-delete':     ['🗑️', 'Membre supprimé'],
  // Mots de passe oubliés
  'password-reset.request':  ['📨', 'Demande de mot de passe'],
  'password-reset.approve':  ['✅', 'Demande approuvée'],
  'password-reset.reject':   ['⛔', 'Demande refusée'],
  'password-reset.consume':  ['🔑', 'Nouveau mot de passe défini'],
  // Site
  'welcome.update':          ['📄', 'Page d’accueil modifiée'],
  'site-config.update':      ['⚙️', 'Réglages du site modifiés'],
  // Sauvegardes
  'backup.create':           ['💾', 'Sauvegarde créée'],
  'backup.download':         ['⬇️', 'Sauvegarde téléchargée'],
  'backup.restore':          ['♻️', 'Restauration d’une sauvegarde'],
  'backup.delete':           ['🗑️', 'Sauvegarde supprimée'],
  'backup.export':           ['📦', 'Export complet'],
  'backup.import':           ['📥', 'Import d’archive'],
  // Bugs et signalements
  'bug.create':              ['🐞', 'Bug ou remarque signalé'],
  'bug.update':              ['🐞', 'Bug : statut ou réponse'],
  'bug.delete':              ['🗑️', 'Bug supprimé'],
  'report.create':           ['🚨', 'Signalement de contenu'],
};

// Familles proposées dans le menu du filtre (préfixe envoyé au serveur).
const ACTIVITY_FAMILIES = [
  ['',                'Tout'],
  ['moderation',      'Modération du contenu'],
  ['member',          'Comptes et connexions'],
  ['admin',           'Actions admin'],
  ['edit',            'Propositions de modification'],
  ['completion',      'Complétions'],
  ['password-reset',  'Mots de passe oubliés'],
  ['backup',          'Sauvegardes'],
  ['bug',             'Bugs et remarques'],
  ['report',          'Signalements'],
  ['site-config',     'Réglages du site'],
  ['welcome',         'Page d’accueil'],
];

const ENTITY_LABELS = {
  place: 'lieu', person: 'personne', story: 'récit', edit: 'proposition',
  completion: 'complétion', media: 'média', member: 'membre',
  backup: 'sauvegarde', bug: 'bug', report: 'signalement',
  welcome: 'accueil', 'site-config': 'réglages',
  'password-reset': 'mot de passe', auth: 'session',
};

let activityFilter = '';
let activityLimit  = 200;
let activityQuery  = '';
let activitySort   = 'recent';
let activityFrom   = '';
let activityTo     = '';
let activityRows   = [];      // dernier lot recu, pour l'export CSV

// Surligne le terme recherché dans un fragment DÉJÀ échappé.
function activityHighlight(safeHtml) {
  if (!activityQuery) return safeHtml;
  const needle = escapeHtml(activityQuery).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return safeHtml.replace(new RegExp(needle, 'gi'), m => `<mark>${m}</mark>`);
}

// Rend l'objet `details` (metadata libre) en une ligne lisible.
function activityDetails(d) {
  if (!d || typeof d !== 'object') return '';
  const parts = [];
  for (const [k, v] of Object.entries(d)) {
    if (v === null || v === undefined || v === '') continue;
    const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
    parts.push(`${escapeHtml(k)} : ${escapeHtml(val.slice(0, 300))}`);
  }
  return activityHighlight(parts.join(' · '));
}

// Lien vers la fiche concernée quand l'entité est encore consultable.
function activityLink(a) {
  const routes = { place: 'lieu', person: 'personne', story: 'recit' };
  const seg = routes[a.entityType];
  if (!seg || !a.entityId || a.entityId === '-') return '';
  if (String(a.action || '').includes('delete')) return '';  // entité détruite
  return ` <a href="/#/${seg}/${encodeURIComponent(a.entityId)}" target="_blank" rel="noopener">ouvrir</a>`;
}

async function refreshActivity() {
  const el = document.getElementById('activity-list');
  if (!el) return;
  el.innerHTML = '<p class="empty">Chargement…</p>';
  try {
    const qs = new URLSearchParams({ limit: String(activityLimit), sort: activitySort });
    if (activityFilter) qs.set('action', activityFilter);
    if (activityQuery)  qs.set('q', activityQuery);
    if (activityFrom)   qs.set('from', activityFrom);
    if (activityTo)     qs.set('to', activityTo);
    const data = await fetchJson('/api/admin/activity?' + qs.toString(), authFetchOpts());
    const activity = data.activity || [];
    activityRows = activity;

    const countEl = document.getElementById('activity-count');
    if (countEl) {
      countEl.textContent = data.matched === data.total
        ? `${data.total} entrée${data.total > 1 ? 's' : ''} au journal`
        : `${data.matched} sur ${data.total} entrées`;
    }

    if (!activity.length) {
      el.innerHTML = activityQuery
        ? `<p class="empty">Aucune entrée ne correspond à « ${escapeHtml(activityQuery)} ».</p>`
        : '<p class="empty">Aucune entrée pour ce filtre.</p>';
      return;
    }

    el.innerHTML = activity.map(a => {
      const known = ACTIVITY_LABELS[a.action];
      const icon  = known ? known[0] : '•';
      const label = known ? known[1] : (a.action || '(action inconnue)');
      const when = a.timestamp ? new Date(a.timestamp).toLocaleString('fr-FR') : '';
      const who = a.memberName
        ? activityHighlight(escapeHtml(a.memberName))
        : `<code title="compte supprimé ou visiteur">${escapeHtml(a.memberId || '?')}</code>`;
      const ent = ENTITY_LABELS[a.entityType] || a.entityType || '';
      const det = activityDetails(a.details);
      const danger = /delete|reject|failed|restore|role-change/.test(a.action || '');
      return `
        <div class="activity-row${danger ? ' is-sensitive' : ''}">
          <div class="activity-main">
            <span class="activity-icon" aria-hidden="true">${icon}</span>
            <strong>${escapeHtml(label)}</strong>
            ${ent ? `<span class="activity-entity">${escapeHtml(ent)}</span>` : ''}
            ${a.entityId && a.entityId !== '-' ? `<code>${activityHighlight(escapeHtml(a.entityId))}</code>` : ''}
            ${activityLink(a)}
          </div>
          <div class="activity-meta">
            <time>${escapeHtml(when)}</time> · par ${who}
            ${a.ip && a.ip !== 'unknown' ? ` · ${activityHighlight(escapeHtml(a.ip))}` : ''}
            · <span class="activity-code">${activityHighlight(escapeHtml(a.action || ''))}</span>
          </div>
          ${det ? `<div class="activity-details">${det}</div>` : ''}
        </div>`;
    }).join('');
  } catch (err) {
    el.innerHTML = `<p class="empty">Erreur : ${escapeHtml(err.message)}</p>`;
  }
}

// Barre de filtres, construite une seule fois au chargement de la page.
(function initActivityControls() {
  const wrap = document.getElementById('activity-controls');
  if (!wrap) return;

  function select(id, label, options, onChange) {
    const el = document.createElement('select');
    el.id = id;
    el.setAttribute('aria-label', label);
    el.innerHTML = options.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
    el.addEventListener('change', () => { onChange(el.value); refreshActivity(); });
    return el;
  }

  // Recherche libre. Debounce : on ne relance pas une requete a chaque
  // frappe, sinon le journal complet est relu 15 fois par mot tape.
  const search = document.createElement('input');
  search.type = 'search';
  search.id = 'activity-search';
  search.placeholder = 'Rechercher : nom, IP, identifiant, motif…';
  search.setAttribute('aria-label', 'Rechercher dans le journal');
  let debounce;
  search.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      activityQuery = search.value.trim();
      refreshActivity();
    }, 300);
  });

  const dateFrom = document.createElement('input');
  dateFrom.type = 'date';
  dateFrom.id = 'activity-from';
  dateFrom.setAttribute('aria-label', 'À partir du');
  dateFrom.addEventListener('change', () => { activityFrom = dateFrom.value; refreshActivity(); });

  const dateTo = document.createElement('input');
  dateTo.type = 'date';
  dateTo.id = 'activity-to';
  dateTo.setAttribute('aria-label', "Jusqu'au");
  dateTo.addEventListener('change', () => { activityTo = dateTo.value; refreshActivity(); });

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'btn-ghost btn-inline';
  reset.textContent = '✕ Tout effacer';
  reset.addEventListener('click', () => {
    activityFilter = ''; activityQuery = ''; activityFrom = ''; activityTo = '';
    activitySort = 'recent'; activityLimit = 200;
    search.value = ''; dateFrom.value = ''; dateTo.value = '';
    wrap.querySelector('#activity-filter').value = '';
    wrap.querySelector('#activity-sort').value = 'recent';
    wrap.querySelector('#activity-limit').value = '200';
    refreshActivity();
  });

  const refresh = document.createElement('button');
  refresh.type = 'button';
  refresh.className = 'btn-ghost btn-inline';
  refresh.textContent = '↻ Rafraîchir';
  refresh.addEventListener('click', refreshActivity);

  // Export CSV de ce qui est affiché : pratique pour archiver un incident
  // ou trier dans un tableur.
  const csv = document.createElement('button');
  csv.type = 'button';
  csv.className = 'btn-ghost btn-inline';
  csv.textContent = '⬇️ CSV';
  csv.addEventListener('click', () => {
    if (!activityRows.length) return;
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['date', 'action', 'membre', 'type', 'identifiant', 'ip', 'details']
      .map(cell).join(';')];
    for (const a of activityRows) {
      lines.push([
        a.timestamp || '', a.action || '', a.memberName || a.memberId || '',
        a.entityType || '', a.entityId || '', a.ip || '',
        a.details ? JSON.stringify(a.details) : '',
      ].map(cell).join(';'));
    }
    // BOM UTF-8 : sans lui, Excel massacre les accents.
    const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'journal-activite.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });

  const count = document.createElement('span');
  count.id = 'activity-count';
  count.className = 'activity-count';

  const row1 = document.createElement('div');
  row1.className = 'activity-controls-row';
  row1.append(
    search,
    select('activity-filter', 'Filtrer par type d’action', ACTIVITY_FAMILIES,
      v => { activityFilter = v; }),
    select('activity-sort', 'Trier', [
      ['recent', 'Plus récentes d’abord'],
      ['ancien', 'Plus anciennes d’abord'],
      ['action', 'Par type d’action'],
      ['membre', 'Par membre'],
    ], v => { activitySort = v; }),
  );

  const row2 = document.createElement('div');
  row2.className = 'activity-controls-row';
  const dateLabel = document.createElement('span');
  dateLabel.className = 'activity-dates-label';
  dateLabel.textContent = 'Du';
  const dateLabel2 = document.createElement('span');
  dateLabel2.className = 'activity-dates-label';
  dateLabel2.textContent = 'au';
  row2.append(
    dateLabel, dateFrom, dateLabel2, dateTo,
    select('activity-limit', 'Nombre d’entrées',
      [200, 500, 1000, 5000].map(n => [String(n), `${n} max`]),
      v => { activityLimit = Number(v); }),
    refresh, csv, reset, count,
  );

  wrap.append(row1, row2);
})();
