// Page de composition du livret PDF (public/livret.html).
// Charge les lieux et personnes (deja filtres par audience cote serveur),
// laisse cocher des sujets, montre un apercu du nombre de recits, puis
// telecharge le PDF genere par /api/livret.

(function () {
  const listPlaces = document.getElementById('list-places');
  const listPeople = document.getElementById('list-people');
  const filterPlaces = document.getElementById('filter-places');
  const filterPeople = document.getElementById('filter-people');
  const countEl = document.getElementById('livret-count');
  const statusEl = document.getElementById('livret-status');
  const genBtn = document.getElementById('livret-generate');
  const clearBtn = document.getElementById('livret-clear');
  const titleEl = document.getElementById('livret-title');
  const imagesEl = document.getElementById('livret-images');

  const selected = { places: new Set(), people: new Set() };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function fetchJson(url) {
    const r = await fetch(url, { credentials: 'include', cache: 'no-store' });
    if (!r.ok) throw new Error(url + ' : ' + r.status);
    return r.json();
  }

  function aliasText(item) {
    const al = (item.aliases || []).map(a => a.name).filter(Boolean);
    return al.length ? 'alias : ' + al.join(', ') : '';
  }

  function renderList(ul, items, kind) {
    ul.innerHTML = items.map(it => {
      const sub = aliasText(it);
      return `<li data-name="${esc((it.primaryName || '') + ' ' + (it.aliases || []).map(a => a.name).join(' ')).toLowerCase()}">
        <label>
          <input type="checkbox" value="${esc(it.id)}" data-kind="${kind}" ${selected[kind].has(it.id) ? 'checked' : ''}/>
          <span>${esc(it.primaryName || it.id)}${sub ? ` <span class="sub">${esc(sub)}</span>` : ''}</span>
        </label></li>`;
    }).join('');
    ul.querySelectorAll('input[type=checkbox]').forEach(cb =>
      cb.addEventListener('change', () => {
        const set = selected[cb.dataset.kind];
        if (cb.checked) set.add(cb.value); else set.delete(cb.value);
        refreshPreview();
      })
    );
  }

  function applyFilter(ul, q) {
    const needle = q.trim().toLowerCase();
    ul.querySelectorAll('li').forEach(li => {
      li.style.display = !needle || li.dataset.name.includes(needle) ? '' : 'none';
    });
  }

  let previewTimer = null;
  function refreshPreview() {
    const total = selected.places.size + selected.people.size;
    genBtn.disabled = total === 0;
    if (total === 0) { countEl.textContent = 'Coche des sujets pour composer le livret.'; return; }
    countEl.textContent = 'Calcul…';
    clearTimeout(previewTimer);
    previewTimer = setTimeout(async () => {
      try {
        const data = await postJson('/api/livret/preview', selectionPayload());
        countEl.textContent = `${data.count} récit${data.count > 1 ? 's' : ''} dans le livret`;
        genBtn.disabled = data.count === 0;
      } catch (e) {
        countEl.textContent = 'Aperçu indisponible.';
      }
    }, 250);
  }

  function selectionPayload() {
    return { placeIds: [...selected.places], personIds: [...selected.people] };
  }

  async function postJson(url, body) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(d.error || r.statusText);
    }
    return r.json();
  }

  async function generate() {
    genBtn.disabled = true;
    statusEl.textContent = 'Génération du PDF… (cela peut prendre quelques secondes)';
    try {
      const payload = {
        ...selectionPayload(),
        title: titleEl.value || 'Mémoire des Cévennes',
        includeImages: imagesEl.checked,
      };
      const r = await fetch('/api/livret', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || r.statusText);
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'livret-memoire-cevennes.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      statusEl.textContent = 'PDF téléchargé.';
    } catch (e) {
      statusEl.textContent = 'Erreur : ' + e.message;
    } finally {
      genBtn.disabled = false;
    }
  }

  filterPlaces.addEventListener('input', () => applyFilter(listPlaces, filterPlaces.value));
  filterPeople.addEventListener('input', () => applyFilter(listPeople, filterPeople.value));
  genBtn.addEventListener('click', generate);
  clearBtn.addEventListener('click', () => {
    selected.places.clear(); selected.people.clear();
    document.querySelectorAll('.tag-list input[type=checkbox]').forEach(cb => { cb.checked = false; });
    refreshPreview();
  });

  (async function init() {
    try {
      const [p, pe] = await Promise.all([
        fetchJson('/api/places').catch(() => ({ places: [] })),
        fetchJson('/api/people').catch(() => ({ people: [] })),
      ]);
      const places = (p.places || []).sort((a, b) => (a.primaryName || '').localeCompare(b.primaryName || ''));
      const people = (pe.people || []).sort((a, b) => (a.primaryName || '').localeCompare(b.primaryName || ''));
      renderList(listPlaces, places, 'places');
      renderList(listPeople, people, 'people');
    } catch (e) {
      countEl.textContent = 'Impossible de charger les sujets.';
    }
  })();
})();
