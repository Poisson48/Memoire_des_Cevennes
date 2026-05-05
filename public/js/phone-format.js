// Helpers de formatage des numéros de téléphone.
// Stockage serveur : forme normalisée (+33XXXXXXXXX, +CC...).
// Affichage : groupes de 2 chiffres séparés par des points, + repassage
// au format national (06.12.34.56.78) pour les numéros français.

(function () {
  'use strict';

  function formatPhone(raw) {
    if (raw === undefined || raw === null) return '';
    const s = String(raw).trim();
    if (!s) return '';

    if (s.startsWith('+33')) {
      const local = '0' + s.slice(3).replace(/\D/g, '');
      return (local.match(/.{1,2}/g) || []).join('.');
    }
    if (s.startsWith('+')) {
      const m = s.match(/^(\+\d{1,3})(\d+)$/);
      if (!m) return s;
      const groups = m[2].match(/.{1,2}/g) || [];
      return m[1] + '.' + groups.join('.');
    }
    const digits = s.replace(/\D/g, '');
    return (digits.match(/.{1,2}/g) || []).join('.');
  }

  window.MdcPhone = { format: formatPhone };
})();
