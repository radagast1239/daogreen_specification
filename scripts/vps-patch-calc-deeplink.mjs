/**
 * Патч калькулятора на VPS: автооткрытие вкладки «Экономика» по #economics
 *   node scripts/vps-patch-calc-deeplink.mjs
 */
import { Client } from "ssh2";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const host = process.env.VPS_HOST || "62.233.35.206";
const user = process.env.VPS_USER || "root";
const password = process.env.VPS_PASSWORD;

if (!password) {
  console.error("Set VPS_PASSWORD env var");
  process.exit(1);
}

function exec(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = "";
      stream
        .on("close", (code) => (code ? reject(new Error(`exit ${code}: ${out}`)) : resolve(out)))
        .on("data", (d) => {
          process.stdout.write(d);
          out += d;
        })
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

const conn = new Client();
conn
  .on("ready", async () => {
    try {
      const s = await sftp(conn);
      const local = path.join(__dirname, "patch-calc-deeplink.py");
      const remote = "/tmp/patch-calc-deeplink.py";
      await upload(s, local, remote);
      await exec(conn, `python3 ${remote}`);
      conn.end();
    } catch (e) {
      console.error(e);
      conn.end();
      process.exit(1);
    }
  })
  .on("error", (e) => {
    console.error(e);
    process.exit(1);
  })
  .connect({ host, port: 22, username: user, password });
