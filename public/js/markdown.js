// Mini parseur markdown maison — pas de dépendance externe.
// Sortie HTML rendue dans innerHTML, donc on prend la sécurité au sérieux :
//   1. Tout le texte source est échappé HTML AVANT d'appliquer les
//      transformations (titres, gras, liens…).
//   2. Les liens [texte](url) ne sont autorisés que pour les protocoles
//      http://, https://, mailto: ou les chemins relatifs (sans :).
//
// Couvre : titres (#, ##, ###), gras (**…**), italique (*…*),
// code inline (`…`), liens [t](u), listes - et 1., paragraphes,
// lignes vides comme séparateurs. Pas de tableaux ni de blocs de code
// — pas le besoin pour la page d'accueil.
(function (global) {
  'use strict';

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  function safeHref(url) {
    const u = String(url).trim();
    // Protocoles autorisés ou chemin relatif/ancre
    if (/^(https?:\/\/|mailto:|#|\/)/i.test(u)) return u;
    if (!/:/.test(u)) return u; // chemin relatif sans schéma
    return '#'; // tout le reste (javascript:, data:…) → neutralisé
  }

  // Transformations inline (gras, italique, code, liens) sur du texte
  // déjà échappé. On utilise des regex prudentes pour éviter les
  // chevauchements.
  function inline(text) {
    let html = text;
    // Liens [texte](url)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
      const safe = escapeHtml(safeHref(url));
      return `<a href="${safe}">${label}</a>`;
    });
    // Code inline `texte`
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Gras **texte**
    html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    // Italique *texte* (après le gras pour ne pas bouffer ses étoiles)
    html = html.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    return html;
  }

  function render(md) {
    const escaped = escapeHtml(md || '');
    const lines = escaped.split('\n');
    const out = [];
    let listMode = null;     // 'ul' | 'ol' | null
    let para = [];

    function flushPara() {
      if (para.length) {
        out.push('<p>' + inline(para.join(' ')) + '</p>');
        para = [];
      }
    }
    function flushList() {
      if (listMode) {
        out.push(`</${listMode}>`);
        listMode = null;
      }
    }

    for (const raw of lines) {
      const line = raw.replace(/\s+$/, '');

      // Titres
      const h = line.match(/^(#{1,3})\s+(.+)$/);
      if (h) {
        flushPara(); flushList();
        const lvl = h[1].length;
        out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`);
        continue;
      }

      // Liste à puces
      const li = line.match(/^[-*]\s+(.+)$/);
      if (li) {
        flushPara();
        if (listMode !== 'ul') { flushList(); out.push('<ul>'); listMode = 'ul'; }
        out.push(`<li>${inline(li[1])}</li>`);
        continue;
      }

      // Liste numérotée
      const nli = line.match(/^\d+\.\s+(.+)$/);
      if (nli) {
        flushPara();
        if (listMode !== 'ol') { flushList(); out.push('<ol>'); listMode = 'ol'; }
        out.push(`<li>${inline(nli[1])}</li>`);
        continue;
      }

      // Ligne vide = séparateur de paragraphe
      if (!line.trim()) {
        flushPara(); flushList();
        continue;
      }

      // Ligne normale → on accumule en paragraphe
      flushList();
      para.push(line);
    }
    flushPara(); flushList();
    return out.join('\n');
  }

  global.MdcMarkdown = { render, escapeHtml };
})(window);
