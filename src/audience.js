// Audience et confidentialite : un seul endroit qui decide « qui voit quoi ».
//
// Trois audiences, par rang croissant de privilege :
//   public (0)  : visiteur non connecte
//   member (1)  : compte connecte
//   admin  (2)  : compte admin
//
// Deux mecanismes de confidentialite, complementaires :
//
//  1. Visibilite au niveau ENREGISTREMENT (`visibility: public|members`),
//     deja en place dans les routes. `visibleStories/Places/People` la
//     reprend de facon centralisee pour les usages hors-route (PDF, TTS).
//
//  2. Redactions au niveau TEXTE (`story.redactions[]`), nouveau. Un membre
//     ou un admin marque explicitement un passage du `body` a anonymiser
//     (remplacer par un libelle neutre) ou a censurer (masquer), avec un
//     seuil d'audience. C'est volontairement MANUEL et auditable : pas de
//     detection automatique fragile. `applyRedactions` rend le texte adapte
//     a l'audience qui lit.
//
// Les offsets `start`/`end` des redactions sont en code units UTF-16 dans
// `body`, exactement comme les `mentions` (cf. src/schema.js).

'use strict';

const RANK = { public: 0, member: 1, admin: 2 };

function roleRank(audience) {
  return RANK[audience] != null ? RANK[audience] : 0;
}

// Determine l'audience d'une requete Express a partir de req.member (peuple
// par optionalAuth) ou du header/cookie admin partage (compat ADMIN_TOKEN).
function audienceOf(req) {
  const role = req && req.member && req.member.role;
  if (role === 'admin') return 'admin';
  if (req && req.member) return 'member';
  // Compat bootstrap : ADMIN_TOKEN partage via header X-Admin-Token.
  const tok = req && (req.get ? req.get('x-admin-token') : null);
  if (tok && process.env.ADMIN_TOKEN && tok === process.env.ADMIN_TOKEN) {
    return 'admin';
  }
  return 'public';
}

// Un enregistrement est-il visible pour cette audience ?
// public ne voit que `visibility==='public'`; member/admin voient tout.
// On exige aussi status==='approved' (le contenu en moderation n'est pas
// diffuse, meme a l'admin, dans les exports/lectures publiques).
function isVisible(record, audience) {
  if (!record) return false;
  if (record.status && record.status !== 'approved') return false;
  if (record.visibility === 'public') return true;
  return roleRank(audience) >= RANK.member;
}

function visibleStories(stories, audience) {
  return (stories || []).filter(s => isVisible(s, audience));
}
function visiblePlaces(places, audience) {
  return (places || []).filter(p => isVisible(p, audience));
}
function visiblePeople(people, audience) {
  return (people || []).filter(p => isVisible(p, audience));
}

// Une redaction s'applique-t-elle pour cette audience ?
// `hideBelow` = rang minimal pour voir le texte ORIGINAL. Les audiences
// strictement en dessous voient la version redigee.
//   hideBelow='member' -> public voit redige, member+admin voient l'original
//   hideBelow='admin'  -> public+member voient redige, seul admin voit l'original
function redactionApplies(redaction, audience) {
  const threshold = RANK[redaction.hideBelow] != null ? RANK[redaction.hideBelow] : RANK.member;
  return roleRank(audience) < threshold;
}

function replacementFor(redaction) {
  if (redaction.mode === 'censor') return '[passage masqué]';
  const r = String(redaction.replacement || '').trim();
  return r || '[anonymisé]';
}

// Applique les redactions au texte selon l'audience. Ne modifie jamais la
// donnee source : renvoie une nouvelle chaine. Traite les spans de droite a
// gauche pour garder les offsets valides. Ignore les spans hors bornes ou
// qui se chevauchent (on garde le premier rencontre, par ordre de debut).
function applyRedactions(body, redactions, audience) {
  const text = String(body == null ? '' : body);
  if (!Array.isArray(redactions) || redactions.length === 0) return text;

  const active = redactions
    .filter(r => r && Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start)
    .filter(r => r.start >= 0 && r.end <= text.length)
    .filter(r => redactionApplies(r, audience))
    .sort((a, b) => a.start - b.start);

  // Retire les chevauchements (garde le span le plus a gauche).
  const kept = [];
  let lastEnd = -1;
  for (const r of active) {
    if (r.start >= lastEnd) { kept.push(r); lastEnd = r.end; }
  }

  // Applique de droite a gauche.
  let out = text;
  for (let i = kept.length - 1; i >= 0; i--) {
    const r = kept[i];
    out = out.slice(0, r.start) + replacementFor(r) + out.slice(r.end);
  }
  return out;
}

// Pratique pour le rendu : renvoie le body d'un recit adapte a l'audience.
function redactedBody(story, audience) {
  return applyRedactions(story && story.body, story && story.redactions, audience);
}

// Renvoie une copie du recit prete a etre exposee a cette audience :
// - `body` avec les passages masques selon les redactions applicables,
// - `redactions` reduit aux seules entrees NON appliquees (on ne divulgue
//   ni le texte masque ni les offsets/raisons des passages caches a cette
//   audience). Les membres/admins qui ont le droit de voir l'original
//   recoivent donc le body brut et la liste complete (pour l'editeur).
function viewStory(story, audience) {
  if (!story) return story;
  const reds = Array.isArray(story.redactions) ? story.redactions : [];
  if (reds.length === 0) return story;
  const body = applyRedactions(story.body, reds, audience);
  if (body === story.body) return story; // rien n'est masque pour cette audience
  const visibleReds = reds.filter(r => !redactionApplies(r, audience));
  return { ...story, body, redactions: visibleReds };
}

module.exports = {
  RANK,
  roleRank,
  audienceOf,
  isVisible,
  visibleStories,
  visiblePlaces,
  visiblePeople,
  redactionApplies,
  applyRedactions,
  redactedBody,
  viewStory,
};
