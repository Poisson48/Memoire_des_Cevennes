// Heartbeat anonyme pour le compteur de visites.
// Envoie un sessionId stocké en localStorage à /api/visits/heartbeat
// toutes les 2 min tant que l'onglet est visible. Aucune IP n'est conservée
// côté serveur, juste un compteur quotidien.
(function () {
  const KEY = 'mdc-visit-id';
  const INTERVAL_MS = 2 * 60 * 1000;
  let timer = null;

  function getId() {
    try {
      let id = localStorage.getItem(KEY);
      if (!id || !/^[a-zA-Z0-9_-]{8,64}$/.test(id)) {
        id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2))
          .replace(/-/g, '').slice(0, 24);
        localStorage.setItem(KEY, id);
      }
      return id;
    } catch (_) { return null; }
  }

  function ping() {
    const sessionId = getId();
    fetch('/api/visits/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
      keepalive: true,
    }).then(r => r.ok ? r.json() : null)
      .then(j => {
        if (j && j.sessionId && j.sessionId !== sessionId) {
          try { localStorage.setItem(KEY, j.sessionId); } catch (_) {}
        }
      })
      .catch(() => { /* silencieux */ });
  }

  function start() {
    stop();
    ping();
    timer = setInterval(() => {
      if (!document.hidden) ping();
    }, INTERVAL_MS);
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) ping();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
