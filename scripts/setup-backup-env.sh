#!/bin/bash
# Configure cloud backup for VPS
# Usage:
#   SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_KEY=eyJ... ./scripts/setup-backup-env.sh
# Or edit /etc/daogreen/backup.env manually
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/daogreen-spec}"
ENV_DIR="/etc/daogreen"
ENV_FILE="$ENV_DIR/backup.env"
mkdir -p "$ENV_DIR"

if [ -f "$ENV_FILE" ] && [ -z "${SUPABASE_URL:-}" ] && [ -z "${S3_ACCESS_KEY:-}" ]; then
  echo "Using existing $ENV_FILE"
else
  cat > "$ENV_FILE" <<EOF
# Cloud backup — Supabase Storage (free tier) or S3-compatible
# Supabase: bucket "daogreen-db" (private), folder backups/
SUPABASE_URL=${SUPABASE_URL:-}
SUPABASE_SERVICE_KEY=${SUPABASE_SERVICE_KEY:-}
DB_BACKUP_BUCKET=${DB_BACKUP_BUCKET:-daogreen-db}

# Optional S3 (Yandex Object Storage, AWS, Backblaze B2)
# BACKUP_S3_BUCKET=
# S3_ACCESS_KEY=
# S3_SECRET_KEY=
# S3_ENDPOINT=https://storage.yandexcloud.net
# S3_REGION=ru-central1
EOF
  chmod 600 "$ENV_FILE"
  echo "Wrote $ENV_FILE"
fi

# Merge Supabase into backend .env for live DB sync (every minute)
BACKEND_ENV="$APP_DIR/backend/.env"
if [ -f "$BACKEND_ENV" ] && [ -n "${SUPABASE_URL:-}" ] && [ -n "${SUPABASE_SERVICE_KEY:-}" ]; then
  grep -q '^SUPABASE_URL=' "$BACKEND_ENV" 2>/dev/null && sed -i '/^SUPABASE_URL=/d;/^SUPABASE_SERVICE_KEY=/d;/^DB_BACKUP_BUCKET=/d' "$BACKEND_ENV" || true
  cat >> "$BACKEND_ENV" <<EOF
SUPABASE_URL=${SUPABASE_URL}
SUPABASE_SERVICE_KEY=${SUPABASE_SERVICE_KEY}
DB_BACKUP_BUCKET=${DB_BACKUP_BUCKET:-daogreen-db}
EOF
  systemctl restart daogreen-spec
  echo "Backend: live DB sync to Supabase enabled"
fi

chmod +x "$APP_DIR/scripts/backup-offsite.mjs" 2>/dev/null || true
echo "Test: $APP_DIR/scripts/backup-cron.sh && node $APP_DIR/scripts/backup-offsite.mjs"
