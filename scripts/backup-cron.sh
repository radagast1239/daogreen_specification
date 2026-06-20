#!/bin/bash
# Cron: 0 3 * * * /opt/daogreen-spec/scripts/backup-cron.sh
set -euo pipefail
DEST="/opt/backups/daogreen"
mkdir -p "$DEST"
STAMP=$(date +%Y%m%d_%H%M)
cp /opt/daogreen-spec/backend/data/daogreen.db "$DEST/daogreen_${STAMP}.db"
tar -czf "$DEST/uploads_${STAMP}.tar.gz" -C /opt/daogreen-spec/backend uploads 2>/dev/null || true
find "$DEST" -type f -mtime +14 -delete
echo "Backup OK: $STAMP"

# Optional cloud upload (Supabase / S3)
APP_DIR="${APP_DIR:-/opt/daogreen-spec}"
NODE="${NODE:-/opt/node-v22.16.0-linux-x64/bin/node}"
if [ -x "$NODE" ] && [ -f "$APP_DIR/scripts/backup-offsite.mjs" ]; then
  "$NODE" "$APP_DIR/scripts/backup-offsite.mjs" >> /var/log/daogreen-backup.log 2>&1 || true
fi
