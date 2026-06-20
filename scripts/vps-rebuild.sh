#!/bin/bash
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/daogreen-spec}"
export PATH="/opt/node-v22.16.0-linux-x64/bin:${PATH}"
cd "$APP_DIR"
export VITE_BASE_PATH="${VITE_BASE_PATH:-/spec/}"
npm run build
systemctl restart daogreen-spec
sleep 2
curl -fsS "http://127.0.0.1:3002/api/health"
grep -E 'src=|href=' dist/index.html | head -3
