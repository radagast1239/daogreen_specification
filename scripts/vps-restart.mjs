/** Перезапуск API + nginx reload (без build на VPS) */
import { Client } from "ssh2";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const password = process.env.VPS_PASSWORD;
const remoteRoot = process.env.VPS_APP_ROOT || "/opt/daogreen-spec";

if (!password) {
  console.error("Set VPS_PASSWORD");
  process.exit(1);
}

function exec(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      stream
        .on("close", (code) => (code ? reject(new Error(`exit ${code}`)) : resolve()))
        .on("data", (d) => process.stdout.write(d))
        .stderr.on("data", (d) => process.stderr.write(d));
    });
  });
}

function upload(conn, local, remote) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      sftp.fastPut(local, remote, (e) => (e ? reject(e) : resolve()));
    });
  });
}

const nginxLocal = path.join(__dirname, "nginx-daogreen-unified.conf");
const conn = new Client();
conn
  .on("ready", async () => {
    try {
      await upload(conn, nginxLocal, "/etc/nginx/sites-available/daogreen-unified.conf");
      await exec(
        conn,
        `ln -sf /etc/nginx/sites-available/daogreen-unified.conf /etc/nginx/sites-enabled/daogreen-unified.conf
if [ -f /etc/letsencrypt/live/spec.nikita-daogreen.ru/fullchain.pem ]; then
  certbot --nginx -d spec.nikita-daogreen.ru --non-interactive --agree-tos -m admin@nikita-daogreen.ru --redirect || true
fi
nginx -t && systemctl reload nginx
systemctl restart daogreen-spec
sleep 3
curl -fsS http://127.0.0.1:3002/api/health
echo
curl -fsS https://spec.nikita-daogreen.ru/spec/api/health || echo HTTPS_CHECK_FAILED
echo
head -5 ${remoteRoot}/dist/index.html`
      );
      conn.end();
    } catch (e) {
      console.error(e.message);
      conn.end();
      process.exit(1);
    }
  })
  .connect({ host: "62.233.35.206", port: 22, username: "root", password, readyTimeout: 60000 });
