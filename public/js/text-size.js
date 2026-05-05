// Confort de lecture : 4 tailles de texte (sm / md / lg / xl), persistées
// en localStorage. Applique la taille immédiatement (avant render) puis
// injecte deux UIs au DOMContentLoaded :
//   1. un widget compact dans la topbar de toutes les pages
//   2. un encart proéminent sur la page d'accueil uniquement (présence de
//      #map), masquable par l'utilisateur (sans pour autant désactiver
//      le réglage : on cache juste l'encart, pas le widget topbar).

(function () {
  const KEY_SIZE = 'mdc-text-size';
  const KEY_BANNER_DISMISSED = 'mdc-text-size-banner-dismissed';
  const SIZES = ['sm', 'md', 'lg', 'xl'];
  const DEFAULT_SIZE = 'md';

  function getSize() {
    try {
      const v = localStorage.getItem(KEY_SIZE);
      if (SIZES.includes(v)) return v;
    } catch {}
    return DEFAULT_SIZE;
  }

  function setSize(s) {
    if (!SIZES.includes(s)) s = DEFAULT_SIZE;
    document.documentElement.dataset.textSize = s;
    try { localStorage.setItem(KEY_SIZE, s); } catch {}
    refreshUI();
  }

  // Application immédiate (le script est chargé dans <head>, donc ça
  // arrive avant le premier paint sur la grande majorité des navigateurs).
  document.documentElement.dataset.textSize = getSize();

  function refreshUI() {
    const cur = getSize();
    document.querySelectorAll('[data-text-size-btn]').forEach(b => {
      b.setAttribute('aria-pressed', b.dataset.textSizeBtn === cur ? 'true' : 'false');
    });
  }

  function buildCompactWidget() {
    const wrap = document.createElement('span');
    wrap.className = 'text-size-widget';
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', 'Taille du texte');
    wrap.innerHTML = `
      <span class="text-size-widget-label">Texte</span>
      <button type="button" data-text-size-btn="sm" class="ts-a-small"  title="Petit"     aria-label="Petit">A</button>
      <button type="button" data-text-size-btn="md" class="ts-a-medium" title="Normal"    aria-label="Normal">A</button>
      <button type="button" data-text-size-btn="lg" class="ts-a-large"  title="Grand"     aria-label="Grand">A</button>
      <button type="button" data-text-size-btn="xl" class="ts-a-xlarge" title="Très grand" aria-label="Très grand">A</button>
    `;
    wrap.addEventListener('click', e => {
      const b = e.target.closest('[data-text-size-btn]');
      if (b) setSize(b.dataset.textSizeBtn);
    });
    return wrap;
  }

  function buildBanner() {
    const div = document.createElement('div');
    div.className = 'text-size-banner';
    div.setAttribute('role', 'region');
    div.setAttribute('aria-label', 'Confort de lecture');
    div.innerHTML = `
      <span class="text-size-banner-label">🔍 Confort de lecture</span>
      <span class="text-size-banner-hint">Le texte est trop petit ? Choisis une taille.</span>
      <span class="text-size-banner-controls">
        <button type="button" data-text-size-btn="sm">Petit</button>
        <button type="button" data-text-size-btn="md">Normal</button>
        <button type="button" data-text-size-btn="lg">Grand</button>
        <button type="button" data-text-size-btn="xl">Très grand</button>
      </span>
      <button type="button" class="text-size-banner-close" aria-label="Masquer ce bandeau" title="Masquer">×</button>
    `;
    div.addEventListener('click', e => {
      const b = e.target.closest('[data-text-size-btn]');
      if (b) { setSize(b.dataset.textSizeBtn); return; }
      if (e.target.classList.contains('text-size-banner-close')) {
        try { localStorage.setItem(KEY_BANNER_DISMISSED, '1'); } catch {}
        div.remove();
      }
    });
    return div;
  }

  function inject() {
    // 1. Widget compact dans la topbar (toutes les pages avec <header.topbar>)
    const actions = document.querySelector('header.topbar .topbar-actions');
    if (actions && !actions.querySelector('.text-size-widget')) {
      actions.appendChild(buildCompactWidget());
    }

    // 2. Encart proéminent sur la page d'accueil (= présence de #map),
    //    sauf si l'utilisateur l'a déjà masqué.
    const isHome = !!document.getElementById('map');
    let dismissed = false;
    try { dismissed = localStorage.getItem(KEY_BANNER_DISMISSED) === '1'; } catch {}
    if (isHome && !dismissed) {
      const header = document.querySelector('header.topbar');
      if (header && !document.querySelector('.text-size-banner')) {
        header.insertAdjacentElement('afterend', buildBanner());
      }
    }

    refreshUI();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
