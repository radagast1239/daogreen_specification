#!/bin/bash
# Apply unified nginx, cron backup, health monitor on VPS
# Run as root from /opt/daogreen-spec after git pull
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/daogreen-spec}"
BASE_PATH="${VITE_BASE_PATH:-/spec/}"

echo "=== Build frontend (base $BASE_PATH) ==="
export PATH="/opt/node-v22.16.0-linux-x64/bin:$PATH"
cd "$APP_DIR"
export VITE_BASE_PATH="$BASE_PATH"
npm run build

echo "=== Nginx unified config ==="
cp "$APP_DIR/scripts/nginx-daogreen-unified.conf" /etc/nginx/sites-available/daogreen-unified
ln -sf /etc/nginx/sites-available/daogreen-unified /etc/nginx/sites-enabled/daogreen-unified
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
nginx -t
systemctl reload nginx

echo "=== Cron: backup 03:00, health every 5 min ==="
chmod +x "$APP_DIR/scripts/backup-cron.sh" "$APP_DIR/scripts/health-monitor.sh"
CRON_FILE="/etc/cron.d/daogreen-spec"
cat > "$CRON_FILE" <<EOF
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
0 3 * * * root $APP_DIR/scripts/backup-cron.sh >> /var/log/daogreen-backup.log 2>&1
*/5 * * * * root HEALTH_URL=http://127.0.0.1:3002/api/health $APP_DIR/scripts/health-monitor.sh || true
EOF
chmod 644 "$CRON_FILE"

mkdir -p /opt/backups/daogreen
systemctl restart daogreen-spec
sleep 2
curl -fsS http://127.0.0.1:3002/api/health
echo ""
echo "OK: http://SERVER/spec/  |  backup cron  |  health monitor"
