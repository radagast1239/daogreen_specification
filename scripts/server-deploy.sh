#!/bin/bash
set -euo pipefail

APP_DIR=/opt/daogreen-spec
NODE22=/opt/node-v22.16.0-linux-x64
PORT=3002
ADMIN_KEY="dg-spec-$(openssl rand -hex 16)"
REPO=https://github.com/radagast1239/daogreen_specification.git

echo "=== Install Node 22 (separate, not replacing system node) ==="
if [ ! -x "$NODE22/bin/node" ]; then
  curl -fsSL https://nodejs.org/dist/v22.16.0/node-v22.16.0-linux-x64.tar.xz -o /tmp/node22.tar.xz
  tar -xJf /tmp/node22.tar.xz -C /opt/
fi
"$NODE22/bin/node" -v

echo "=== Clone / update app ==="
if [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR" && git pull --ff-only
else
  git clone "$REPO" "$APP_DIR"
  cd "$APP_DIR"
fi

echo "=== Install & build ==="
export PATH="$NODE22/bin:$PATH"
npm install --include=dev
npm run build
npm install --prefix backend

echo "=== Configure env ==="
mkdir -p backend/data backend/uploads materials-photos
cat > backend/.env <<EOF
PORT=$PORT
NODE_ENV=production
ADMIN_KEY=$ADMIN_KEY
DATABASE_PATH=./data/daogreen.db
CORS_ORIGIN=http://62.233.35.206:$PORT
EOF

echo "=== systemd service ==="
cat > /etc/systemd/system/daogreen-spec.service <<EOF
[Unit]
Description=Daogreen Spec API + frontend
After=network.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR/backend
Environment=NODE_ENV=production
EnvironmentFile=$APP_DIR/backend/.env
ExecStart=$NODE22/bin/node src/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable daogreen-spec
systemctl restart daogreen-spec

sleep 2
if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null; then
  echo "HEALTH_OK"
else
  echo "HEALTH_FAIL"
  journalctl -u daogreen-spec -n 30 --no-pager
  exit 1
fi

# optional firewall
if command -v ufw >/dev/null && ufw status | grep -q inactive; then
  true
elif command -v ufw >/dev/null; then
  ufw allow "$PORT/tcp" || true
fi

echo "=== DONE ==="
echo "URL=http://62.233.35.206:$PORT"
echo "LOGIN=http://62.233.35.206:$PORT/login"
echo "ADMIN_KEY=$ADMIN_KEY"
