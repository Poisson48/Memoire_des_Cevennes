// Empêche la mise en veille de l'appareil pendant la consultation du site.
// Utilise l'API Wake Lock (Chrome/Edge 84+, Safari 16.4+, Firefox Android 126+).
// Si le navigateur ne supporte pas, on ne fait rien (pas de fallback).
//
// Le navigateur libère le wake lock automatiquement quand l'onglet passe
// en arrière-plan ; on le reprend dès que l'onglet redevient visible.

(function () {
  'use strict';

  if (!('wakeLock' in navigator)) return;

  let wakeLock = null;

  async function request() {
    if (document.visibilityState !== 'visible') return;
    // Si on a déjà un verrou actif, ne pas en redemander un.
    if (wakeLock && !wakeLock.released) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
    } catch {
      // Échecs courants (silencieux) :
      //   NotAllowedError → mode économie batterie ou permission refusée
      //   SecurityError   → contexte non sécurisé
      //   AbortError      → onglet redevenu invisible entre-temps
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') request();
  });

  // Premier verrou dès que possible.
  request();
})();
