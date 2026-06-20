#!/bin/bash
# Let's Encrypt — run on VPS with domain pointed to server
# Usage: DOMAIN=spec.example.com EMAIL=you@mail.ru ./setup-ssl.sh
set -euo pipefail
DOMAIN="${DOMAIN:?set DOMAIN}"
EMAIL="${EMAIL:?set EMAIL}"
apt-get update && apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL"
echo "HTTPS enabled for $DOMAIN"
