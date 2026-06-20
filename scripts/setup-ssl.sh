#!/bin/bash
# Let's Encrypt HTTPS on VPS
# Prerequisites: DNS A-record DOMAIN -> server IP (check: dig +short $DOMAIN)
#
# Usage:
#   DOMAIN=spec.nikita-daogreen.ru EMAIL=you@mail.ru ./scripts/setup-ssl.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/daogreen-spec}"
DOMAIN="${DOMAIN:?set DOMAIN, e.g. spec.nikita-daogreen.ru}"
EMAIL="${EMAIL:?set EMAIL for Let's Encrypt notifications}"
NODE22="/opt/node-v22.16.0-linux-x64/bin"

echo "=== Check DNS ==="
SERVER_IP=$(curl -fsS ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
DNS_IP=$(dig +short "$DOMAIN" A | tail -1)
echo "Server IP: $SERVER_IP"
echo "DNS $DOMAIN -> ${DNS_IP:-<empty>}"
if [ "$DNS_IP" != "$SERVER_IP" ]; then
  echo "ERROR: Add DNS A-record: $DOMAIN -> $SERVER_IP"
  echo "Then re-run this script."
  exit 1
fi

echo "=== Install certbot ==="
apt-get update -qq
apt-get install -y certbot python3-certbot-nginx

echo "=== Nginx server_name ==="
NGINX_CONF="/etc/nginx/sites-available/daogreen-unified"
if ! grep -q "server_name $DOMAIN" "$NGINX_CONF" 2>/dev/null; then
  sed -i "s/server_name _;/server_name $DOMAIN $SERVER_IP;/" "$NGINX_CONF"
  nginx -t
  systemctl reload nginx
fi

echo "=== Certbot ==="
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect

echo "=== Update app URLs ==="
PUBLIC_URL="https://$DOMAIN/spec"
BACKEND_ENV="$APP_DIR/backend/.env"
if [ -f "$BACKEND_ENV" ]; then
  grep -q '^CORS_ORIGIN=' "$BACKEND_ENV" && sed -i '/^CORS_ORIGIN=/d' "$BACKEND_ENV" || true
  echo "CORS_ORIGIN=https://$DOMAIN,http://$SERVER_IP" >> "$BACKEND_ENV"
fi

ENV_DIR="/etc/daogreen"
mkdir -p "$ENV_DIR"
echo "DOMAIN=$DOMAIN" > "$ENV_DIR/infra.env"
echo "PUBLIC_URL=$PUBLIC_URL" >> "$ENV_DIR/infra.env"

export PATH="$NODE22:$PATH"
export VITE_BASE_PATH=/spec/
export VITE_PUBLIC_URL="$PUBLIC_URL"
cd "$APP_DIR"
npm run build
systemctl restart daogreen-spec

echo ""
echo "HTTPS OK: $PUBLIC_URL/"
echo "Login:    $PUBLIC_URL/login"
