#!/bin/bash
# Let's Encrypt — run on VPS when domain A-record points to server
# Usage: DOMAIN=spec.nikita-daogreen.ru EMAIL=you@mail.ru ./scripts/setup-ssl.sh
set -euo pipefail
DOMAIN="${DOMAIN:?set DOMAIN}"
EMAIL="${EMAIL:?set EMAIL}"
apt-get update && apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect
echo "HTTPS enabled for $DOMAIN — nginx reloaded with SSL"
