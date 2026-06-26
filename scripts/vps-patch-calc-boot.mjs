/** node scripts/vps-patch-calc-boot.mjs */
import { Client } from "ssh2";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const password = process.env.VPS_PASSWORD;
if (!password) {
  console.error("Set VPS_PASSWORD");
  process.exit(1);
}

function exec(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      stream.on("data", (d) => process.stdout.write(d));
      stream.stderr.on("data", (d) => process.stderr.write(d));
      stream.on("close", (code) => (code ? reject(new Error(`exit ${code}`)) : resolve()));
    });
  });
}

const conn = new Client();
conn.on("ready", async () => {
  const s = await new Promise((res, rej) => conn.sftp((e, sf) => (e ? rej(e) : res(sf))));
  const local = path.join(__dirname, "patch-calc-boot.py");
  const remote = "/tmp/patch-calc-boot.py";
  await new Promise((res, rej) => s.fastPut(local, remote, (e) => (e ? rej(e) : res())));
  await exec(conn, `python3 ${remote} && systemctl restart daogreen-calc`);
  conn.end();
});
conn.on("error", (e) => {
  console.error(e);
  process.exit(1);
});
conn.connect({ host: "62.233.35.206", port: 22, username: "root", password, readyTimeout: 60000 });
