// Résolution du contributeur d'une soumission.
//
// Règles (partagées par tous les flux : nouveau lieu, nouveau récit,
// complétion, édit, tag…) :
//
// - Si le contributeur a choisi son nom dans l'autocomplétion de la base,
//   submittedBy.personId est déjà rempli → on le garde tel quel, pas de
//   création.
// - Sinon, si submittedBy.name est fourni, on cherche un match par
//   résolution d'alias (comme /api/resolve) ; le premier match Personne
//   au score suffisamment haut est utilisé pour lier.
// - Sinon (name tapé libre, aucun match), on crée une Personne pending
//   dans le graphe avec le nom + les champs optionnels newPerson (année
//   de naissance, parents, bio) — elle passe par la modération comme
//   toute nouvelle entité. Le submittedBy.personId pointe vers cette
//   nouvelle fiche, si bien que le nom du contributeur est cliquable et
//   apparaît dans l'arbre, les mentions, etc.
//
// L'idée : chaque fois qu'une personne contribue, le graphe l'accueille
// avec son nom et ses liens, au lieu de collectionner des chaînes
// orphelines sans lien entre elles.

const people = require('./people');
const { resolve } = require('./resolve');

const STRONG_MATCH_SCORE = 100;  // nom exact uniquement

async function resolveContributor({ submittedBy, newPerson }) {
  if (!submittedBy || !submittedBy.name) return submittedBy || null;
  // Déjà lié par l'autocomplétion côté client.
  if (submittedBy.personId) {
    const existing = people.get(submittedBy.personId);
    if (existing) return submittedBy;
    // personId invalide → on nettoie et on retombe dans le flow suivant.
    const copy = { ...submittedBy };
    delete copy.personId;
    submittedBy = copy;
  }
  // Match exact sur un nom existant (y compris via alias) — évite de
  // créer un doublon si l'auto-complete a été zappée.
  const hits = resolve(submittedBy.name).filter(r => r.type === 'person');
  const strong = hits.find(h => h.score >= STRONG_MATCH_SCORE);
  if (strong) {
    return { ...submittedBy, personId: strong.id };
  }
  // Création à la volée d'une Personne pending.
  const input = {
    primaryName: submittedBy.name,
    submittedBy,
  };
  if (newPerson) {
    if (newPerson.birth)   input.birth   = newPerson.birth;
    if (newPerson.parents) input.parents = newPerson.parents;
    if (newPerson.bio)     input.bio     = newPerson.bio;
  }
  const created = await people.create(input);
  return { ...submittedBy, personId: created.id };
}

module.exports = { resolveContributor };
