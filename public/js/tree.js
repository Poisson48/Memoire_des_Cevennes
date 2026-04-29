// Mémoire des Cévennes — arbre généalogique SVG
//
// API :
//   FamilyTree.render(el, focusId, peopleMap, { onNavigate, compact })
//
// Dessine un arbre pédigrée centré sur `focusId`. Les cartes sont cliquables
// (re-centrent l'arbre via `onNavigate(personId)`).
//
// Couvre par défaut :
//   - grands-parents (paternels + maternels, 0-4)
//   - parents (0-2)
//   - focus + fratrie (même parent) + conjoint(s)
//   - enfants
//
// `compact: true` retire la ligne des grands-parents — utile pour un aperçu
// dans un panneau latéral.

(function() {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const W = 150;  // largeur d'une carte
  const H = 72;   // hauteur (assez pour 2 lignes de nom + dates + meta)
  const GX = 18;  // écart horizontal entre cartes
  const GY = 72;  // écart vertical entre rangées
  const NAME_PAD = 8; // marge intérieure horizontale réservée au texte

  // Mesure réelle de la largeur (font Georgia 13px bold) — permet de
  // décider si un nom déborde. Lazy : créé à la première mesure pour ne
  // pas casser les tests headless qui n'ont pas de canvas.
  let _measureFn = null;
  function measureName(s) {
    if (!_measureFn) {
      try {
        const ctx = document.createElement('canvas').getContext('2d');
        ctx.font = '600 13px Georgia, "Iowan Old Style", serif';
        _measureFn = (t) => ctx.measureText(t).width;
      } catch (_) {
        // Fallback grossier : ~7.5px/char en Georgia 13px bold.
        _measureFn = (t) => t.length * 7.5;
      }
    }
    return _measureFn(s);
  }

  // Coupe un nom en 1 ou 2 lignes pour tenir dans `maxW` pixels.
  // Stratégie :
  //  - Si ça rentre tel quel → 1 ligne.
  //  - Sinon, on cherche la coupure (sur un espace ou un trait d'union)
  //    qui minimise la largeur de la ligne la plus longue.
  //  - Si aucune coupure ne marche (mot unique trop long), on tronque
  //    avec ellipsis.
  //  - Si même en 2 lignes ça déborde, on tronque la 2ᵉ.
  function wrapName(name, maxW) {
    const s = String(name || '');
    if (!s) return [''];
    if (measureName(s) <= maxW) return [s];

    // Points de coupure possibles : après un espace ou un trait d'union,
    // mais on conserve le tiret avec la 1ʳᵉ ligne.
    const points = [];
    for (let i = 1; i < s.length; i++) {
      if (s[i - 1] === ' ') points.push({ at: i, drop: 1 });
      else if (s[i - 1] === '-' && s[i] !== ' ') points.push({ at: i, drop: 0 });
    }
    if (points.length === 0) {
      // Mot unique trop long → ellipsis.
      let t = s;
      while (t.length > 1 && measureName(t + '…') > maxW) t = t.slice(0, -1);
      return [t + '…'];
    }
    let best = null;
    for (const p of points) {
      const l1 = s.slice(0, p.drop ? p.at - 1 : p.at);
      const l2 = s.slice(p.at);
      const w1 = measureName(l1);
      const w2 = measureName(l2);
      if (w1 <= maxW && w2 <= maxW) {
        const score = Math.max(w1, w2);
        if (!best || score < best.score) best = { lines: [l1, l2], score };
      }
    }
    if (best) return best.lines;
    // Pas de coupe propre : prends la coupure la plus proche du milieu et
    // tronque la 2ᵉ ligne.
    const mid = s.length / 2;
    const fallback = points.reduce(
      (acc, p) => Math.abs(p.at - mid) < Math.abs(acc.at - mid) ? p : acc,
      points[0],
    );
    const l1 = s.slice(0, fallback.drop ? fallback.at - 1 : fallback.at);
    let l2 = s.slice(fallback.at);
    while (l2.length > 1 && measureName(l2 + '…') > maxW) l2 = l2.slice(0, -1);
    return [l1, l2 + '…'];
  }

  function ns(tag, attrs = {}, text) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (text != null) el.textContent = text;
    return el;
  }

  function orderParents(ids, peopleMap) {
    const ps = ids.map(id => peopleMap.get(id)).filter(Boolean);
    const score = (p) => p.gender === 'M' ? 0 : p.gender === 'F' ? 1 : 2;
    return [...ps].sort((a, b) => score(a) - score(b));
  }

  function cluster(focusId, peopleMap, { compact = false } = {}) {
    const focus = peopleMap.get(focusId);
    if (!focus) return null;

    const parentIds = (focus.parents || []).map(p => p.id);
    const [p1, p2] = orderParents(parentIds, peopleMap);

    const patGP = !compact && p1 ? orderParents((p1.parents || []).map(x => x.id), peopleMap).slice(0, 2) : [];
    const matGP = !compact && p2 ? orderParents((p2.parents || []).map(x => x.id), peopleMap).slice(0, 2) : [];

    const myParentIds = new Set(parentIds);
    const siblings = myParentIds.size === 0 ? [] :
      [...peopleMap.values()].filter(p =>
        p.id !== focusId &&
        (p.parents || []).some(par => myParentIds.has(par.id))
      );

    const spouses = (focus.spouses || [])
      .map(s => ({ person: peopleMap.get(s.id), start: s.start, end: s.end }))
      .filter(x => x.person);

    const children = [...peopleMap.values()].filter(c =>
      (c.parents || []).some(par => par.id === focusId)
    );
    // Tri par naissance si dispo
    children.sort((a, b) => (a.birth?.year || 9999) - (b.birth?.year || 9999));

    return { focus, p1, p2, patGP, matGP, siblings, spouses, children };
  }

  function eventLabel(ev) {
    if (!ev) return '';
    return ev.year ? String(ev.year) : '';
  }

  function personDates(p) {
    const b = eventLabel(p.birth);
    const d = eventLabel(p.death);
    if (b && d) return `${b} – ${d}`;
    if (b) return `° ${b}`;
    if (d) return `† ${d}`;
    return '';
  }

  // Largeur d'un groupe de 0/1/2 cartes.
  function groupWidth(n) { return n === 0 ? 0 : n * W + (n - 1) * GX; }

  function layout(c) {
    // Row Y positions
    const rows = [];
    const hasGP = c.patGP.length > 0 || c.matGP.length > 0;
    const hasParents = !!(c.p1 || c.p2);
    if (hasGP) rows.push('gp');
    if (hasParents) rows.push('parents');
    rows.push('focus');
    if (c.children.length) rows.push('children');
    const Y = {};
    rows.forEach((r, i) => { Y[r] = i * (H + GY); });

    // ── Positions relatives autour d'un origine 0 (rendez-vous final : on
    //    translate tout pour que le minX soit à margin=40 sur le SVG).

    // 1. Compute parent centers (around x=0)
    //    If both parents present AND both have GPs: spread them far enough to
    //    fit the GP groups below without overlap.
    let p1CX = null, p2CX = null;
    if (c.p1 && c.p2) {
      const patGPW = groupWidth(c.patGP.length);
      const matGPW = groupWidth(c.matGP.length);
      const minDist = Math.max(
        W + GX,                               // mariage standard
        (patGPW + matGPW) / 2 + GX            // pas de chevauchement GP
      );
      p1CX = -minDist / 2;
      p2CX =  minDist / 2;
    } else if (c.p1) {
      p1CX = 0;
    } else if (c.p2) {
      p2CX = 0;
    }

    // 2. Compute focus-row pivot.
    //    Focus is centered on parents midpoint when both exist, else on the
    //    single parent, else on 0.
    let focusCX;
    if (p1CX !== null && p2CX !== null) focusCX = (p1CX + p2CX) / 2;
    else if (p1CX !== null) focusCX = p1CX;
    else if (p2CX !== null) focusCX = p2CX;
    else focusCX = 0;

    // 3. Compute children pivot (midpoint of focus + first spouse if any).
    const firstSpouseOffset = c.spouses.length > 0 ? (W + GX) : 0;
    const childrenPivot = focusCX + firstSpouseOffset / 2;

    // ── Build node list around origin 0
    const nodes = [];
    const edges = [];

    // Focus row
    const sibsSorted = [...c.siblings].sort((a, b) => (a.birth?.year || 9999) - (b.birth?.year || 9999));
    // focus card center = focusCX
    const focusX = focusCX - W / 2;
    nodes.push({ person: c.focus, x: focusX, y: Y.focus, focus: true });
    sibsSorted.forEach((s, i) => {
      nodes.push({ person: s, x: focusX - (W + GX) * (i + 1), y: Y.focus, kind: 'sibling' });
    });
    c.spouses.forEach((sp, i) => {
      const x = focusX + (W + GX) * (i + 1);
      nodes.push({ person: sp.person, x, y: Y.focus, kind: 'spouse', meta: sp });
      edges.push({
        kind: 'marriage',
        x1: focusX + W, y1: Y.focus + H / 2,
        x2: x,          y2: Y.focus + H / 2,
      });
    });

    // Parents row
    if (c.p1) {
      nodes.push({ person: c.p1, x: p1CX - W / 2, y: Y.parents, kind: 'parent' });
    }
    if (c.p2) {
      nodes.push({ person: c.p2, x: p2CX - W / 2, y: Y.parents, kind: 'parent' });
    }
    if (c.p1 && c.p2) {
      // ligne de mariage des parents
      edges.push({
        kind: 'marriage',
        x1: p1CX + W / 2, y1: Y.parents + H / 2,
        x2: p2CX - W / 2, y2: Y.parents + H / 2,
      });
    }

    // Lien parents → focus row (via un point médian).
    if (hasParents) {
      const midY = (Y.parents + H + Y.focus) / 2;
      // Point de "descente" : milieu parental si deux, sinon le parent unique
      const descX = (p1CX !== null && p2CX !== null)
        ? (p1CX + p2CX) / 2
        : (p1CX !== null ? p1CX : p2CX);
      edges.push({ kind: 'line', x1: descX, y1: Y.parents + H, x2: descX, y2: midY });
      // Barre horizontale + verticales pour chaque enfant (focus + siblings)
      const focusKin = nodes.filter(n => n.y === Y.focus && n.kind !== 'spouse');
      const kinCenters = focusKin.map(n => n.x + W / 2);
      const left = Math.min(descX, ...kinCenters);
      const right = Math.max(descX, ...kinCenters);
      if (kinCenters.length > 0) {
        edges.push({ kind: 'line', x1: left, y1: midY, x2: right, y2: midY });
        focusKin.forEach(n => {
          edges.push({
            kind: 'line',
            x1: n.x + W / 2, y1: midY,
            x2: n.x + W / 2, y2: Y.focus,
          });
        });
      }
    }

    // Grandparents row — chaque groupe centré sur son parent
    function placeGP(list, parentCX) {
      if (list.length === 0 || parentCX === null) return;
      const totalW = groupWidth(list.length);
      const startX = parentCX - totalW / 2;
      list.forEach((gp, i) => {
        nodes.push({
          person: gp,
          x: startX + (W + GX) * i,
          y: Y.gp,
          kind: 'grandparent',
        });
      });
      if (list.length === 2) {
        edges.push({
          kind: 'marriage',
          x1: startX + W,      y1: Y.gp + H / 2,
          x2: startX + W + GX, y2: Y.gp + H / 2,
        });
        edges.push({ kind: 'line', x1: parentCX, y1: Y.gp + H / 2, x2: parentCX, y2: Y.parents });
      } else {
        edges.push({ kind: 'line', x1: parentCX, y1: Y.gp + H, x2: parentCX, y2: Y.parents });
      }
    }
    placeGP(c.patGP, c.p1 ? p1CX : null);
    placeGP(c.matGP, c.p2 ? p2CX : null);

    // Children row
    if (c.children.length) {
      const childY = Y.children;
      const totalW = groupWidth(c.children.length);
      const startX = childrenPivot - totalW / 2;
      c.children.forEach((ch, i) => {
        nodes.push({
          person: ch,
          x: startX + (W + GX) * i,
          y: childY,
          kind: 'child',
        });
      });
      const midY = (Y.focus + H + childY) / 2;
      edges.push({
        kind: 'line',
        x1: childrenPivot, y1: Y.focus + H,
        x2: childrenPivot, y2: midY,
      });
      if (c.children.length > 1) {
        const leftX = startX + W / 2;
        const rightX = startX + totalW - W / 2;
        edges.push({ kind: 'line', x1: leftX, y1: midY, x2: rightX, y2: midY });
      }
      c.children.forEach((_, i) => {
        const x = startX + (W + GX) * i + W / 2;
        edges.push({ kind: 'line', x1: x, y1: midY, x2: x, y2: childY });
      });
    }

    // ── Recadrer le tout vers un repère (margin, margin).
    const margin = 40;
    const minX = Math.min(
      ...nodes.map(n => n.x),
      ...edges.map(e => Math.min(e.x1, e.x2)),
    );
    const maxX = Math.max(
      ...nodes.map(n => n.x + W),
      ...edges.map(e => Math.max(e.x1, e.x2)),
    );
    const shift = margin - minX;
    nodes.forEach(n => { n.x += shift; });
    edges.forEach(e => { e.x1 += shift; e.x2 += shift; });

    const canvasW = (maxX - minX) + 2 * margin;
    const lastY = c.children.length ? Y.children : Y.focus;
    const canvasH = lastY + H + 20;

    return { nodes, edges, canvasW, canvasH };
  }

  function drawCard(svg, node, onNavigate, focusId) {
    const g = ns('g', { class: 'tree-card' + (node.person.id === focusId ? ' focus' : '') });
    g.setAttribute('transform', `translate(${node.x} ${node.y})`);
    g.style.cursor = 'pointer';

    const kind = node.kind || 'focus';
    g.setAttribute('data-kind', kind);

    const rect = ns('rect', {
      width: W, height: H, rx: 6, ry: 6,
      class: 'card-bg',
    });
    g.appendChild(rect);

    const primary = node.person.primaryName || '';
    const lines = wrapName(primary, W - 2 * NAME_PAD);
    const name = ns('text', {
      x: W / 2, 'text-anchor': 'middle',
      class: 'card-name',
    });
    // y de la 1ʳᵉ ligne : décalé vers le haut quand on a 2 lignes pour
    // laisser respirer les dates en dessous.
    const firstY = lines.length === 1 ? 24 : 18;
    lines.forEach((line, i) => {
      const tspan = ns('tspan', { x: W / 2, y: firstY + i * 14 });
      tspan.textContent = line;
      name.appendChild(tspan);
    });
    g.appendChild(name);

    // Position verticale des dates : juste en dessous du dernier tspan.
    const datesY = firstY + (lines.length - 1) * 14 + 16;
    const sub = personDates(node.person);
    if (sub) {
      const dt = ns('text', {
        x: W / 2, y: datesY, 'text-anchor': 'middle',
        class: 'card-dates',
      });
      dt.textContent = sub;
      g.appendChild(dt);
    }

    // Spouse meta (dates de mariage)
    if (node.meta && (node.meta.start || node.meta.end)) {
      const meta = ns('text', {
        x: W / 2, y: H - 6, 'text-anchor': 'middle',
        class: 'card-meta',
      });
      meta.textContent = [node.meta.start, node.meta.end].filter(Boolean).join(' – ');
      g.appendChild(meta);
    }

    g.addEventListener('click', (e) => {
      e.stopPropagation();
      if (onNavigate) onNavigate(node.person.id);
    });
    g.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && onNavigate) {
        e.preventDefault();
        onNavigate(node.person.id);
      }
    });
    g.setAttribute('tabindex', 0);
    g.setAttribute('role', 'button');
    g.setAttribute('aria-label', `${primary} — ouvrir la fiche`);

    svg.appendChild(g);
  }

  function drawEdge(svg, edge) {
    if (edge.kind === 'marriage') {
      const line = ns('line', {
        x1: edge.x1, y1: edge.y1, x2: edge.x2, y2: edge.y2,
        class: 'edge edge-marriage',
      });
      svg.appendChild(line);
    } else {
      const line = ns('line', {
        x1: edge.x1, y1: edge.y1, x2: edge.x2, y2: edge.y2,
        class: 'edge edge-line',
      });
      svg.appendChild(line);
    }
  }

  function render(el, focusId, peopleMap, opts = {}) {
    const c = cluster(focusId, peopleMap, opts);
    if (!c) {
      el.innerHTML = '<p class="tree-empty">Personne introuvable.</p>';
      return;
    }

    // Aucune relation connue → message explicite plutôt qu'une carte seule
    const hasRels = c.p1 || c.p2 || c.siblings.length || c.spouses.length || c.children.length;
    if (!hasRels) {
      el.innerHTML = '<p class="tree-empty">Aucune relation familiale enregistrée pour cette personne.</p>';
      return;
    }

    const { nodes, edges, canvasW, canvasH } = layout(c, { focusId });

    el.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'tree-wrap';
    el.appendChild(wrap);

    const svg = ns('svg', {
      viewBox: `0 0 ${canvasW} ${canvasH}`,
      width: canvasW,
      height: canvasH,
      class: 'tree-svg',
      xmlns: SVG_NS,
    });
    // Edges d'abord (derrière)
    edges.forEach(e => drawEdge(svg, e));
    nodes.forEach(n => drawCard(svg, n, opts.onNavigate, focusId));
    wrap.appendChild(svg);
  }

  window.FamilyTree = { render };
})();
