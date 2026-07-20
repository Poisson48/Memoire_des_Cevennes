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

// Rend l'objet `details` (metadata libre) en une ligne lisible.
function activityDetails(d) {
  if (!d || typeof d !== 'object') return '';
  const parts = [];
  for (const [k, v] of Object.entries(d)) {
    if (v === null || v === undefined || v === '') continue;
    const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
    parts.push(`${escapeHtml(k)} : ${escapeHtml(val.slice(0, 300))}`);
  }
  return parts.join(' · ');
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
    const qs = new URLSearchParams({ limit: String(activityLimit) });
    if (activityFilter) qs.set('action', activityFilter);
    const data = await fetchJson('/api/admin/activity?' + qs.toString(), authFetchOpts());
    const activity = data.activity || [];

    const countEl = document.getElementById('activity-count');
    if (countEl) {
      countEl.textContent = data.matched === data.total
        ? `${data.total} entrée${data.total > 1 ? 's' : ''} au journal`
        : `${data.matched} sur ${data.total} entrées`;
    }

    if (!activity.length) {
      el.innerHTML = '<p class="empty">Aucune entrée pour ce filtre.</p>';
      return;
    }

    el.innerHTML = activity.map(a => {
      const known = ACTIVITY_LABELS[a.action];
      const icon  = known ? known[0] : '•';
      const label = known ? known[1] : (a.action || '(action inconnue)');
      const when = a.timestamp ? new Date(a.timestamp).toLocaleString('fr-FR') : '';
      const who = a.memberName
        ? escapeHtml(a.memberName)
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
            ${a.entityId && a.entityId !== '-' ? `<code>${escapeHtml(a.entityId)}</code>` : ''}
            ${activityLink(a)}
          </div>
          <div class="activity-meta">
            <time>${escapeHtml(when)}</time> · par ${who}
            ${a.ip && a.ip !== 'unknown' ? ` · ${escapeHtml(a.ip)}` : ''}
            · <span class="activity-code">${escapeHtml(a.action || '')}</span>
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

  const sel = document.createElement('select');
  sel.id = 'activity-filter';
  sel.setAttribute('aria-label', 'Filtrer par type d’action');
  sel.innerHTML = ACTIVITY_FAMILIES
    .map(([v, label]) => `<option value="${v}">${label}</option>`).join('');
  sel.addEventListener('change', () => { activityFilter = sel.value; refreshActivity(); });

  const lim = document.createElement('select');
  lim.id = 'activity-limit';
  lim.setAttribute('aria-label', 'Nombre d’entrées');
  lim.innerHTML = [200, 500, 1000, 5000]
    .map(n => `<option value="${n}">${n} dernières</option>`).join('');
  lim.addEventListener('change', () => { activityLimit = Number(lim.value); refreshActivity(); });

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-ghost btn-inline';
  btn.textContent = '↻ Rafraîchir';
  btn.addEventListener('click', refreshActivity);

  const count = document.createElement('span');
  count.id = 'activity-count';
  count.className = 'activity-count';

  wrap.append(sel, lim, btn, count);
})();
