/** Залить локальный dist/ на VPS и перезапустить сервис */
import { Client } from "ssh2";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const dist = path.join(root, "dist");

const host = process.env.VPS_HOST || "62.233.35.206";
const user = process.env.VPS_USER || "root";
const password = process.env.VPS_PASSWORD;
const remoteRoot = process.env.VPS_APP_ROOT || "/opt/daogreen-spec";
const nodeBin = "/opt/node-v22.16.0-linux-x64/bin";

if (!password) {
  console.error("Set VPS_PASSWORD");
  process.exit(1);
}
if (!fs.existsSync(dist)) {
  console.error("Run npm run build first");
  process.exit(1);
}

function walk(dir, base = dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) out.push(...walk(full, base));
    else out.push(path.relative(base, full).replace(/\\/g, "/"));
  }
  return out;
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

function sftp(conn) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, s) => (err ? reject(err) : resolve(s)));
  });
}

function upload(sftpClient, local, remote) {
  return new Promise((resolve, reject) => {
    sftpClient.fastPut(local, remote, (err) => (err ? reject(err) : resolve()));
  });
}

const files = walk(dist);

const conn = new Client();
conn
  .on("ready", async () => {
    try {
      const s = await sftp(conn);
      for (const rel of files) {
        const local = path.join(dist, rel);
        const remote = `${remoteRoot}/dist/${rel}`;
        await exec(conn, `mkdir -p $(dirname ${remote})`);
        await upload(s, local, remote);
        console.log("Uploaded dist/" + rel);
      }
      await exec(conn, `systemctl restart daogreen-spec && sleep 3 && curl -fsS http://127.0.0.1:3002/api/health && echo OK`);
      conn.end();
    } catch (e) {
      console.error(e.message);
      conn.end();
      process.exit(1);
    }
  })
  .on("error", (e) => {
    console.error(e.message);
    process.exit(1);
  })
  .connect({ host, port: 22, username: user, password, readyTimeout: 180000 });
