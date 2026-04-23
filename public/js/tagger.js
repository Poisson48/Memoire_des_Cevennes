// Mémoire des Cévennes — post-tagging des mentions
//
// Dans un récit affiché, on peut sélectionner un bout de texte (« Suzette »,
// « chez Marie »…) et le lier à une Personne ou un Lieu existant. La
// proposition est envoyée en file de modération via /api/stories/:id/edits
// (système style Wikipédia déjà en place) — l'admin valide.
//
// Principes :
// - On ne laisse proposer un tag que sur des récits rendus dans un
//   panneau (live mode uniquement). En mode statique (GitHub Pages),
//   aucun endpoint d'écriture — le widget se cache.
// - Les offsets `start` / `end` sont calculés en code units UTF-16 dans
//   le `body` original, en comparant les positions dans le textContent
//   de l'élément .body rendu.
// - On refuse le chevauchement avec une mention existante (simple sécurité).

const tagPopover = document.getElementById('tag-popover');
const tagBtn = document.getElementById('tag-btn');
const dlgTag = document.getElementById('dlg-tag');
const formTag = document.getElementById('form-tag');
const tagSelectionEl = document.getElementById('tag-selection');
const tagSearchEl = document.getElementById('tag-search');
const tagResultsEl = document.getElementById('tag-results');
const tagChosenEl = document.getElementById('tag-chosen');
const tagSubmit = document.getElementById('tag-submit');

dlgTag.querySelectorAll('[data-close]').forEach(b =>
  b.addEventListener('click', () => dlgTag.close('cancel'))
);

let pendingTag = null;       // { storyId, start, end, text, bodyEl }
let chosenEntity = null;     // { type, id, name } ou null

// ── Détection de la sélection ─────────────────────────────────────────
document.addEventListener('selectionchange', () => {
  // En mode statique : pas d'écriture possible, on masque le widget.
  if (state && state.mode === 'static') {
    tagPopover.hidden = true;
    return;
  }
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) {
    tagPopover.hidden = true;
    return;
  }
  const range = sel.getRangeAt(0);
  const anchor = range.startContainer;
  const storyEl = findStoryArticle(anchor);
  if (!storyEl) { tagPopover.hidden = true; return; }
  const bodyEl = storyEl.querySelector('.body');
  if (!bodyEl || !bodyEl.contains(range.startContainer) || !bodyEl.contains(range.endContainer)) {
    tagPopover.hidden = true;
    return;
  }
  const text = sel.toString().trim();
  if (text.length === 0 || text.length > 160) {
    tagPopover.hidden = true;
    return;
  }

  // Calcul des offsets start/end dans le texte brut de bodyEl.
  const [start, end] = offsetsOf(range, bodyEl);

  const storyId = storyEl.dataset.storyId;
  if (!storyId) { tagPopover.hidden = true; return; }

  const story = state.stories.find(s => s.id === storyId);
  if (!story) { tagPopover.hidden = true; return; }

  // Refuse si la sélection chevauche une mention existante.
  const overlaps = (story.mentions || []).some(m =>
    !(end <= m.start || start >= m.end)
  );
  pendingTag = { storyId, start, end, text, overlaps };

  // Positionne le popover au-dessus de la sélection.
  const rect = range.getBoundingClientRect();
  tagPopover.style.top = `${window.scrollY + rect.top - 44}px`;
  tagPopover.style.left = `${window.scrollX + rect.left}px`;
  tagPopover.hidden = false;
  tagBtn.textContent = overlaps
    ? '⚠️ Chevauche une mention existante'
    : '🏷️ Tagger cette sélection';
  tagBtn.disabled = overlaps;
});

function findStoryArticle(node) {
  let el = node && (node.nodeType === 1 ? node : node.parentElement);
  while (el && !(el.classList && el.classList.contains('story'))) {
    el = el.parentElement;
  }
  return el;
}

function offsetsOf(range, bodyEl) {
  const pre = document.createRange();
  pre.selectNodeContents(bodyEl);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  const end = start + range.toString().length;
  return [start, end];
}

// ── Ouverture du dialog ───────────────────────────────────────────────
tagBtn.addEventListener('click', () => {
  if (!pendingTag || pendingTag.overlaps) return;
  tagSelectionEl.textContent = pendingTag.text;
  tagSearchEl.value = pendingTag.text;
  tagChosenEl.hidden = true;
  chosenEntity = null;
  tagSubmit.disabled = true;
  runSearch(pendingTag.text);
  tagPopover.hidden = true;
  // Supprime la sélection pour libérer l'UI derrière le dialog.
  const sel = window.getSelection();
  if (sel) sel.removeAllRanges();
  dlgTag.showModal();
  // Focus sur le champ de recherche pour corrections rapides.
  setTimeout(() => tagSearchEl.focus(), 50);
});

// ── Recherche avec debounce + appel /api/resolve ──────────────────────
let searchTimer = null;
tagSearchEl.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = tagSearchEl.value.trim();
  searchTimer = setTimeout(() => runSearch(q), 200);
});

formTag.querySelectorAll('input[name="tag-type"]').forEach(r => {
  r.addEventListener('change', () => runSearch(tagSearchEl.value.trim()));
});

async function runSearch(q) {
  tagResultsEl.innerHTML = '';
  if (!q) {
    tagResultsEl.innerHTML = '<li class="tag-result-empty">Tape au moins une lettre.</li>';
    return;
  }
  const wantType = formTag.querySelector('input[name="tag-type"]:checked').value;
  try {
    const res = await fetch(`/api/resolve?q=${encodeURIComponent(q)}&limit=20`);
    if (!res.ok) throw new Error('réseau');
    const data = await res.json();
    const filtered = (data.results || []).filter(r => r.type === wantType);
    if (filtered.length === 0) {
      tagResultsEl.innerHTML = `<li class="tag-result-empty">Aucun·e ${wantType === 'person' ? 'personne' : 'lieu'} ne correspond. (création d'une nouvelle fiche : à venir)</li>`;
      return;
    }
    tagResultsEl.innerHTML = filtered.map(r => `
      <li data-type="${r.type}" data-id="${escapeAttr(r.id)}" data-name="${escapeAttr(r.name)}">
        <strong>${escapeHtml(r.name)}</strong>
        ${r.source === 'alias' && r.alias ? `<span class="alias-hint"> — alias « ${escapeHtml(r.matched)} »${r.alias.context ? ' (' + escapeHtml(r.alias.context) + ')' : ''}</span>` : ''}
      </li>
    `).join('');
    tagResultsEl.querySelectorAll('li[data-id]').forEach(li => {
      li.addEventListener('click', () => {
        tagResultsEl.querySelectorAll('li.selected').forEach(x => x.classList.remove('selected'));
        li.classList.add('selected');
        chosenEntity = {
          type: li.dataset.type,
          id: li.dataset.id,
          name: li.dataset.name,
        };
        tagChosenEl.textContent = `→ Cette sélection pointera vers « ${chosenEntity.name} ».`;
        tagChosenEl.hidden = false;
        tagSubmit.disabled = false;
      });
    });
  } catch (err) {
    tagResultsEl.innerHTML = `<li class="tag-result-empty">Erreur : ${escapeHtml(err.message)}</li>`;
  }
}

// ── Soumission : envoie un edit proposal avec mentions mises à jour ──
formTag.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!pendingTag || !chosenEntity) return;
  const story = state.stories.find(s => s.id === pendingTag.storyId);
  if (!story) return;

  const newMention = {
    start: pendingTag.start,
    end: pendingTag.end,
    type: chosenEntity.type,
    entityId: chosenEntity.id,
  };
  const updated = [...(story.mentions || []), newMention]
    .sort((a, b) => a.start - b.start);

  const fd = new FormData(formTag);
  const payload = {
    changes: { mentions: updated },
    note: `Tag « ${pendingTag.text} » → ${chosenEntity.type === 'person' ? 'personne' : 'lieu'} « ${chosenEntity.name} »`,
    submittedBy: fd.get('pseudo') ? { pseudo: fd.get('pseudo') } : undefined,
  };

  try {
    const res = await fetch(`/api/stories/${encodeURIComponent(story.id)}/edits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    dlgTag.close('submit');
    alert(data.message || 'Proposition de tag envoyée — en attente de validation.');
  } catch (err) {
    alert('Erreur : ' + err.message);
  }
});
