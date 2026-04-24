#!/usr/bin/env bash
# Sauvegarde datée de data/ et uploads/ — à planifier en cron hebdo :
#   0 3 * * 1  /home/memoire/memoire_des_cevennes/scripts/backup.sh
#
# Garde les 12 dernières sauvegardes, supprime les plus anciennes.
#
# Variables d'env :
#   BACKUP_DIR  répertoire de destination (défaut ~/backups/memoire-cevennes)
#   BACKUP_KEEP nombre de sauvegardes à conserver (défaut 12)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/memoire-cevennes}"
BACKUP_KEEP="${BACKUP_KEEP:-12}"

mkdir -p "$BACKUP_DIR"

STAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
ARCHIVE="$BACKUP_DIR/memoire-cevennes-${STAMP}.tar.gz"

cd "$ROOT"
tar czf "$ARCHIVE" \
  --exclude='uploads/.tmp-*' \
  data uploads 2>/dev/null || {
  # uploads/ peut être absent, on re-tente data seul
  tar czf "$ARCHIVE" data
}

echo "✓ sauvegarde : $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"

# Rotation : garde les N plus récents
ls -1t "$BACKUP_DIR"/memoire-cevennes-*.tar.gz 2>/dev/null \
  | tail -n +"$((BACKUP_KEEP + 1))" \
  | xargs -r rm -v
