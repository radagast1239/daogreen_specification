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
DB_TMP="${DB_BACKUP}.tmp"

cleanup_tmp() {
  rm -f "$DB_TMP"
}
trap cleanup_tmp EXIT

if [ ! -s "$DB_PATH" ]; then
  echo "ERROR: source DB missing or empty: $DB_PATH" >&2
  exit 1
fi

if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB_PATH" ".backup '$DB_TMP'"
elif [ -x "$NODE" ]; then
  DB_PATH="$DB_PATH" DB_TMP="$DB_TMP" "$NODE" <<'NODE'
const { DatabaseSync } = require("node:sqlite");

const source = process.env.DB_PATH;
const target = process.env.DB_TMP;
if (!source || !target) {
  throw new Error("DB_PATH and DB_TMP are required");
}

const quoteSqlString = (value) => `'${String(value).replace(/'/g, "''")}'`;
const db = new DatabaseSync(source, { readOnly: true });
try {
  if (typeof db.backup === "function") {
    const dest = new DatabaseSync(target);
    try {
      db.backup(dest);
    } finally {
      dest.close();
    }
  } else {
    db.exec(`VACUUM INTO ${quoteSqlString(target)}`);
  }
} finally {
  db.close();
}
NODE
else
  echo "ERROR: neither sqlite3 nor Node is available for SQLite backup" >&2
  exit 1
fi

if [ ! -s "$DB_TMP" ]; then
  echo "ERROR: backup tmp is missing or empty: $DB_TMP" >&2
  exit 1
fi

if [ -x "$NODE" ]; then
  DB_TMP="$DB_TMP" "$NODE" <<'NODE'
const { DatabaseSync } = require("node:sqlite");

const target = process.env.DB_TMP;
const db = new DatabaseSync(target, { readOnly: true });
const integrity = db.prepare("PRAGMA integrity_check").get()?.integrity_check;
const counts = {
  materials: db.prepare("SELECT COUNT(*) AS c FROM materials").get()?.c ?? 0,
  projects: db.prepare("SELECT COUNT(*) AS c FROM projects").get()?.c ?? 0,
  project_items: db.prepare("SELECT COUNT(*) AS c FROM project_items").get()?.c ?? 0,
};
db.close();
if (integrity !== "ok") {
  throw new Error(`SQLite backup integrity failed: ${integrity}`);
}
console.log(JSON.stringify({ integrity, counts }));
NODE
elif command -v sqlite3 >/dev/null 2>&1; then
  test "$(sqlite3 "$DB_TMP" "PRAGMA integrity_check;")" = "ok"
  sqlite3 "$DB_TMP" "SELECT COUNT(*) FROM materials;"
  sqlite3 "$DB_TMP" "SELECT COUNT(*) FROM projects;"
  sqlite3 "$DB_TMP" "SELECT COUNT(*) FROM project_items;"
fi

mv "$DB_TMP" "$DB_BACKUP"
trap - EXIT

tar -czf "$DEST/uploads_${STAMP}.tar.gz" -C "$APP_DIR/backend" uploads 2>/dev/null || true
find "$DEST" -type f -name 'daogreen_*.db' -size 0 -delete
find "$DEST" -type f -name 'daogreen_*.db.tmp' -delete
find "$DEST" -type f -name 'daogreen_*.db' -mtime +14 -delete
echo "Backup OK: $STAMP -> $DB_BACKUP"

# Optional cloud upload (Supabase / S3)
if [ -x "$NODE" ] && [ -f "$APP_DIR/scripts/backup-offsite.mjs" ]; then
  "$NODE" "$APP_DIR/scripts/backup-offsite.mjs" >> /var/log/daogreen-backup.log 2>&1 || true
fi
