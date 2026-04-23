// File d'attente et décisions de modération.
// Les admins partagent le même compte (ADMIN_TOKEN) — voir server.js pour la garde.
const places = require('./places');
const people = require('./people');
const stories = require('./stories');

const ENTITIES = { places, people, stories };

function queue({ type } = {}) {
  const out = [];
  for (const [name, repo] of Object.entries(ENTITIES)) {
    if (type && type !== name) continue;
    for (const item of repo.list({ status: 'pending' })) {
      out.push({ entityType: name, item });
    }
  }
  out.sort((a, b) => {
    const ta = a.item.submittedAt || '';
    const tb = b.item.submittedAt || '';
    return ta.localeCompare(tb);
  });
  return out;
}

async function approve(entityType, id, { reviewer = 'admin' } = {}) {
  const repo = ENTITIES[entityType];
  if (!repo) throw new Error(`type inconnu : ${entityType}`);
  return repo.patch(id, () => ({
    status: 'approved',
    reviewedAt: new Date().toISOString(),
    reviewedBy: reviewer,
    rejectionReason: undefined,
  }));
}

async function reject(entityType, id, { reviewer = 'admin', reason = '' } = {}) {
  const repo = ENTITIES[entityType];
  if (!repo) throw new Error(`type inconnu : ${entityType}`);
  return repo.patch(id, () => ({
    status: 'rejected',
    reviewedAt: new Date().toISOString(),
    reviewedBy: reviewer,
    rejectionReason: String(reason || '').slice(0, 2000),
  }));
}

function counts() {
  const out = {};
  for (const [name, repo] of Object.entries(ENTITIES)) {
    const all = repo.list({ status: 'all' });
    out[name] = {
      total: all.length,
      pending: all.filter(x => x.status === 'pending').length,
      approved: all.filter(x => x.status === 'approved').length,
      rejected: all.filter(x => x.status === 'rejected').length,
    };
  }
  return out;
}

module.exports = { queue, approve, reject, counts };
