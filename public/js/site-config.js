// Réglages du site éditables depuis l'admin (titre + tagline).
// Récupère /api/site-config et remplace :
//   - <h1 data-site-title>     → titre
//   - [data-site-tagline]      → tagline
//   - le mot "Mémoire des Cévennes" dans document.title
//
// Cache en localStorage pour éviter le flicker au chargement.

(function () {
  var STORAGE_KEY = 'mdc-site-config';
  var DEFAULTS = {
    title:   'Mémoire des Cévennes',
    tagline: 'Une carte pour recueillir les récits, les voix et les images de nos vallées.',
  };

  function apply(cfg) {
    if (!cfg) return;
    var title   = cfg.title   || DEFAULTS.title;
    var tagline = cfg.tagline || DEFAULTS.tagline;

    // <title> de l'onglet : on remplace toute occurrence du titre par défaut
    // par le titre dynamique. Robuste pour les variantes "X — Mémoire des
    // Cévennes" comme pour "Mémoire des Cévennes" tout court.
    if (document.title && title !== DEFAULTS.title) {
      document.title = document.title.split(DEFAULTS.title).join(title);
    }

    // <h1 data-site-title> : remplace tout le contenu textuel sauf les
    // <span> enfants (badge version par exemple).
    var titleEls = document.querySelectorAll('[data-site-title]');
    for (var i = 0; i < titleEls.length; i++) {
      replaceTextKeepChildren(titleEls[i], title);
    }

    // [data-site-tagline] : remplace le textContent en bloc.
    var tagEls = document.querySelectorAll('[data-site-tagline]');
    for (var j = 0; j < tagEls.length; j++) {
      tagEls[j].textContent = tagline;
    }
  }

  // Remplace les nœuds texte d'un élément par le nouveau texte, en préservant
  // les éléments enfants (utile pour <h1>Titre <span data-version></span></h1>
  // où on veut juste changer "Titre" sans toucher au span).
  function replaceTextKeepChildren(el, newText) {
    var firstNode = el.firstChild;
    // Si le premier nœud est du texte, on le remplace ; sinon on en insère un.
    if (firstNode && firstNode.nodeType === 3) {
      firstNode.nodeValue = newText + (firstNode.nextSibling ? ' ' : '');
    } else {
      el.insertBefore(document.createTextNode(newText + ' '), firstNode);
    }
    // Nettoie les autres nœuds texte qui auraient pu rester (anciens
    // espaces collés au mot-titre).
    var n = firstNode ? firstNode.nextSibling : null;
    while (n) {
      var next = n.nextSibling;
      if (n.nodeType === 3) el.removeChild(n);
      n = next;
    }
  }

  // 1) Applique tout de suite ce qui est en cache (si quelque chose).
  try {
    var cached = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (cached) apply(cached);
  } catch (_) { /* localStorage indispo, on ignore */ }

  // 2) Va chercher la version fraîche en réseau, met à jour cache + DOM.
  fetch('/api/site-config', { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (cfg) {
      if (!cfg) return;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); } catch (_) {}
      apply(cfg);
    })
    .catch(function () { /* serveur indispo (mode statique GitHub Pages) */ });
})();
