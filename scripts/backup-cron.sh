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
