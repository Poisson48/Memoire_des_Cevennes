#!/usr/bin/env bash
# Redémarre (ou démarre) le serveur Mémoire des Cévennes.
# Géré par systemd : memoires-cevenoles.service (port 18542).
# Demande le mot de passe sudo une fois.

set -euo pipefail

SERVICE=memoires-cevenoles.service

echo "→ daemon-reload (au cas où le fichier unit a changé)"
sudo systemctl daemon-reload

if systemctl is-active --quiet "$SERVICE"; then
  echo "→ service déjà actif, restart"
  sudo systemctl restart "$SERVICE"
else
  echo "→ service arrêté, start"
  sudo systemctl start "$SERVICE"
fi

echo
echo "→ status"
systemctl status "$SERVICE" --no-pager -n 5

echo
echo "→ test local (http://localhost:18542) : attente que le port s'ouvre"
for i in {1..20}; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 2 http://localhost:18542/ || true)
  if [ "$code" != "000" ] && [ -n "$code" ]; then
    echo "✓ serveur répond (HTTP $code) après ${i}×0.5s"
    exit 0
  fi
  sleep 0.5
done

echo "✗ pas de réponse après 10s : vérifier les logs :"
echo "  journalctl -u $SERVICE -n 50"
exit 1
