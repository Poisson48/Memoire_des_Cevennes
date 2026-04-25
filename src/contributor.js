// Résolution du contributeur d'une soumission.
//
// Règle (anti-bordel) :
// - Si le contributeur a choisi son nom dans l'autocomplétion (personId
//   transmis et toujours valide), on le garde lié à la fiche.
// - Sinon, on tente UN match exact dans le graphe (score 100, alias compris).
//   Si trouvé : on lie au personId existant.
// - Sinon : on stocke le nom comme texte libre dans submittedBy.name,
//   sans créer de fiche. Pas de doublons "mehdi-1, mehdi-2, mehdi-3"
//   à chaque saisie de nom inconnu. La création explicite d'une fiche
//   passe par le formulaire dédié (newPerson + flag explicite).
//
// La création à la volée n'est plus autorisée que si l'option `newPerson`
// est fournie ET contient un flag `confirmCreate: true` (sécurité).

const people = require('./people');
const { resolve } = require('./resolve');

const STRONG_MATCH_SCORE = 100;  // nom exact uniquement

async function resolveContributor({ submittedBy, newPerson }) {
  if (!submittedBy || !submittedBy.name) return submittedBy || null;

  // Déjà lié par l'autocomplétion côté client.
  if (submittedBy.personId) {
    const existing = people.get(submittedBy.personId);
    if (existing) return submittedBy;
    // personId invalide (entité supprimée par exemple) → on nettoie.
    const copy = { ...submittedBy };
    delete copy.personId;
    submittedBy = copy;
  }

  // Match exact sur un nom existant (alias compris) — lie sans créer.
  const hits = resolve(submittedBy.name).filter(r => r.type === 'person');
  const strong = hits.find(h => h.score >= STRONG_MATCH_SCORE);
  if (strong) {
    return { ...submittedBy, personId: strong.id };
  }

  // Création à la volée UNIQUEMENT si l'utilisateur l'a explicitement
  // demandée via le formulaire « Nouvelle fiche ».
  if (newPerson && newPerson.confirmCreate === true) {
    const input = {
      primaryName: submittedBy.name,
      submittedBy,
    };
    if (newPerson.birth)   input.birth   = newPerson.birth;
    if (newPerson.parents) input.parents = newPerson.parents;
    if (newPerson.bio)     input.bio     = newPerson.bio;
    const created = await people.create(input);
    return { ...submittedBy, personId: created.id };
  }

  // Cas par défaut : pas de personId, juste le nom en texte libre.
  return submittedBy;
}

module.exports = { resolveContributor };
