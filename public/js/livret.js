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

  // Chrome Android et Safari iOS ne savent pas imprimer une iframe : leur
  // dialogue d'impression retombe sur le document principal, et on obtient un
  // PDF de la page livret au lieu du livret. Sur mobile on ouvre donc le
  // livret dans un vrai onglet, qui déclenche lui-même son impression.
  const IS_MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));

  // Script + bouton injectés dans le document du livret : l'impression est
  // déclenchée depuis l'onglet lui-même (seul cas fiable sur mobile), et le
  // bouton permet de relancer si le dialogue a été fermé ou bloqué.
  function withPrintTrigger(html) {
    const extra = `
<style>
  #livret-print-bar{position:fixed;left:0;right:0;bottom:0;padding:12px;
    background:#fff;border-top:1px solid #ccc;text-align:center;z-index:9999;
    font-family:system-ui,sans-serif}
  #livret-print-bar button{font:inherit;font-size:1.05rem;padding:.6em 1.4em;
    border:0;border-radius:8px;background:#7a4b2a;color:#fff}
  @media print{#livret-print-bar{display:none !important}}
</style>
<div id="livret-print-bar">
  <button type="button" onclick="window.print()">🖨️ Enregistrer au format PDF</button>
</div>
<script>
  window.addEventListener('load', function () {
    setTimeout(function () { try { window.print(); } catch (e) {} }, 300);
  });
<\/script>`;
    return html.replace(/<\/body>/i, extra + '</body>');
  }

  // Onglet dédié (mobile) : la fenêtre est ouverte en amont, dans le geste de
  // clic, sinon les bloqueurs de pop-up la refusent.
  function printInWindow(win, html) {
    const blobUrl = URL.createObjectURL(
      new Blob([withPrintTrigger(html)], { type: 'text/html' }));
    win.location.replace(blobUrl);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
  }

  // Rend le HTML dans un iframe isolé puis ouvre le dialogue d'impression du
  // navigateur (« Enregistrer au format PDF »). Tout se passe côté client :
  // aucune puissance serveur consommée, sans dépendance Chromium/Playwright.
  function printHtml(html) {
    return new Promise((resolve) => {
      const blobUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      const iframe = document.createElement('iframe');
      iframe.setAttribute('aria-hidden', 'true');
      iframe.style.cssText =
        'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';

      let done = false;
      const cleanup = () => {
        if (done) return;
        done = true;
        // Laisser le dialogue se fermer avant de retirer l'iframe.
        setTimeout(() => { iframe.remove(); URL.revokeObjectURL(blobUrl); resolve(); }, 500);
      };

      iframe.onload = async () => {
        // Un iframe fraîchement inséré charge d'abord about:blank : on ignore
        // ce premier onload et on n'agit que sur le document blob (le livret).
        if (!/^blob:/.test(iframe.contentWindow.location.href)) return;
        try {
          const win = iframe.contentWindow;
          // Attendre le chargement des images (data-URI : quasi instantané).
          const imgs = [...iframe.contentDocument.images];
          await Promise.all(imgs.map(img => img.complete ? null
            : new Promise(res => { img.onload = img.onerror = res; })));
          win.focus();
          // afterprint : nettoyage une fois le dialogue clos ; filet de
          // sécurité si l'évènement ne se déclenche pas (certains mobiles).
          win.addEventListener('afterprint', cleanup, { once: true });
          setTimeout(cleanup, 60000);
          win.print();
        } catch (e) {
          cleanup();
        }
      };

      document.body.appendChild(iframe);
      iframe.src = blobUrl;
    });
  }

  async function generate() {
    // Retour visuel immédiat : préparer le livret puis ouvrir l'impression.
    // Sur mobile, l'onglet doit être ouvert MAINTENANT (dans le geste de clic)
    // pour ne pas être bloqué comme pop-up ; il affiche le livret dès que le
    // HTML est prêt.
    const win = IS_MOBILE ? window.open('', '_blank') : null;
    const label = genBtn.textContent;
    genBtn.disabled = true;
    genBtn.classList.add('is-loading');
    genBtn.innerHTML = '<span class="livret-spinner" aria-hidden="true"></span> Préparation…';
    statusEl.hidden = false;
    statusEl.className = 'livret-status is-working';
    statusEl.innerHTML = '<span class="livret-spinner" aria-hidden="true"></span> Préparation du livret… la fenêtre d\'impression va s\'ouvrir. Choisis « Enregistrer au format PDF ».';
    try {
      const payload = {
        ...selectionPayload(),
        title: titleEl.value || 'Mémoire des Cévennes',
        includeImages: imagesEl.checked,
      };
      const r = await fetch('/api/livret/html', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || r.statusText);
      }
      const html = await r.text();
      if (win) {
        printInWindow(win, html);
        statusEl.className = 'livret-status is-done';
        statusEl.textContent = '✅ Livret ouvert dans un nouvel onglet : choisis « Enregistrer au format PDF » dans le dialogue d\'impression.';
      } else if (IS_MOBILE) {
        // Pop-up bloquée : on retombe sur un téléchargement du livret, que le
        // navigateur pourra ouvrir puis imprimer.
        const blobUrl = URL.createObjectURL(
          new Blob([withPrintTrigger(html)], { type: 'text/html' }));
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = (payload.title || 'livret').replace(/[^\w\s-]/g, '') + '.html';
        a.click();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
        statusEl.className = 'livret-status is-done';
        statusEl.textContent = '✅ Livret téléchargé. Autorise les fenêtres surgissantes pour l\'imprimer directement, ou ouvre le fichier puis « Imprimer ».';
      } else {
        await printHtml(html);
        statusEl.className = 'livret-status is-done';
        statusEl.textContent = '✅ Livret prêt : dans la fenêtre d\'impression, choisis « Enregistrer au format PDF ».';
      }
    } catch (e) {
      if (win) win.close();
      statusEl.className = 'livret-status is-error';
      statusEl.textContent = '⚠️ Erreur : ' + e.message;
    } finally {
      genBtn.disabled = false;
      genBtn.classList.remove('is-loading');
      genBtn.textContent = label;
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
