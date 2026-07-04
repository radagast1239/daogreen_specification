#!/bin/bash
# Cron: 0 3 * * * /opt/daogreen-spec/scripts/backup-cron.sh
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/daogreen-spec}"
NODE="${NODE:-/opt/node-v22.16.0-linux-x64/bin/node}"
DEST="/opt/backups/daogreen"
mkdir -p "$DEST"
STAMP=$(date +%Y%m%d_%H%M)
DB_PATH="$APP_DIR/backend/data/daogreen.db"
DB_BACKUP="$DEST/daogreen_${STAMP}.db"

if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB_PATH" ".backup '$DB_BACKUP'"
elif [ -x "$NODE" ]; then
  DB_PATH="$DB_PATH" DB_BACKUP="$DB_BACKUP" "$NODE" <<'NODE'
const { DatabaseSync } = require("node:sqlite");

const source = process.env.DB_PATH;
const target = process.env.DB_BACKUP;
if (!source || !target) {
  throw new Error("DB_PATH and DB_BACKUP are required");
}

const quoteSqlString = (value) => `'${String(value).replace(/'/g, "''")}'`;
const db = new DatabaseSync(source, { readOnly: true });
db.exec(`VACUUM INTO ${quoteSqlString(target)}`);
db.close();
NODE
else
  echo "ERROR: neither sqlite3 nor Node is available for SQLite backup" >&2
  exit 1
fi

if [ -x "$NODE" ]; then
  DB_BACKUP="$DB_BACKUP" "$NODE" <<'NODE'
const { DatabaseSync } = require("node:sqlite");

const target = process.env.DB_BACKUP;
const db = new DatabaseSync(target, { readOnly: true });
const row = db.prepare("PRAGMA integrity_check").get();
db.close();
if (!row || row.integrity_check !== "ok") {
  throw new Error(`SQLite backup integrity failed: ${JSON.stringify(row)}`);
}
NODE
elif command -v sqlite3 >/dev/null 2>&1; then
  test "$(sqlite3 "$DB_BACKUP" "PRAGMA integrity_check;")" = "ok"
fi

tar -czf "$DEST/uploads_${STAMP}.tar.gz" -C "$APP_DIR/backend" uploads 2>/dev/null || true
find "$DEST" -type f -mtime +14 -delete
echo "Backup OK: $STAMP"

# Optional cloud upload (Supabase / S3)
if [ -x "$NODE" ] && [ -f "$APP_DIR/scripts/backup-offsite.mjs" ]; then
  "$NODE" "$APP_DIR/scripts/backup-offsite.mjs" >> /var/log/daogreen-backup.log 2>&1 || true
fi
