/** HTTPS на VPS без apt (certbot уже установлен) */
import { Client } from "ssh2";

const password = process.env.VPS_PASSWORD;
const DOMAIN = process.env.DOMAIN || "spec.nikita-daogreen.ru";
const EMAIL = process.env.LE_EMAIL || "admin@nikita-daogreen.ru";
const APP_DIR = "/opt/daogreen-spec";

if (!password) {
  console.error("Set VPS_PASSWORD");
  process.exit(1);
}

function exec(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      stream
        .on("close", (code) => (code ? reject(new Error(`exit ${code}: ${cmd.slice(0, 80)}`)) : resolve()))
        .on("data", (d) => process.stdout.write(d))
        .stderr.on("data", (d) => process.stderr.write(d));
    });
  });
}

const script = `set -euo pipefail
DOMAIN="${DOMAIN}"
EMAIL="${EMAIL}"
APP_DIR="${APP_DIR}"
NODE22="/opt/node-v22.16.0-linux-x64/bin"
SERVER_IP=$(curl -fsS ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
DNS_IP=$(dig +short "$DOMAIN" A | tail -1)
echo "Server IP: $SERVER_IP"
echo "DNS $DOMAIN -> $DNS_IP"
if [ "$DNS_IP" != "$SERVER_IP" ]; then
  echo "ERROR: DNS mismatch"
  exit 1
fi

NGINX_CONF="/etc/nginx/sites-available/daogreen-unified"
if ! grep -q "server_name.*$DOMAIN" "$NGINX_CONF" 2>/dev/null; then
  sed -i "s/server_name .*;/server_name $DOMAIN $SERVER_IP;/" "$NGINX_CONF"
  nginx -t
  systemctl reload nginx
fi

certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect

PUBLIC_URL="https://$DOMAIN/spec"
BACKEND_ENV="$APP_DIR/backend/.env"
if [ -f "$BACKEND_ENV" ]; then
  grep -q '^CORS_ORIGIN=' "$BACKEND_ENV" && sed -i '/^CORS_ORIGIN=/d' "$BACKEND_ENV" || true
  echo "CORS_ORIGIN=https://$DOMAIN,http://$SERVER_IP" >> "$BACKEND_ENV"
fi

mkdir -p /etc/daogreen
echo "DOMAIN=$DOMAIN" > /etc/daogreen/infra.env
echo "PUBLIC_URL=$PUBLIC_URL" >> /etc/daogreen/infra.env

export PATH="$NODE22:$PATH"
export VITE_BASE_PATH=/spec/
export VITE_PUBLIC_URL="$PUBLIC_URL"
cd "$APP_DIR"
npm run build
systemctl restart daogreen-spec
sleep 2
curl -fsS "https://$DOMAIN/spec/api/health"
echo ""
echo "HTTPS OK: $PUBLIC_URL/"
echo "Login:    $PUBLIC_URL/login"
`;

const conn = new Client();
conn
  .on("ready", async () => {
    try {
      await exec(conn, script);
      conn.end();
    } catch (e) {
      console.error(e.message);
      conn.end();
      process.exit(1);
    }
  })
  .on("error", (e) => {
    console.error(e);
    process.exit(1);
  })
  .connect({ host: "62.233.35.206", port: 22, username: "root", password, readyTimeout: 60000 });
