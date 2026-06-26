/** node scripts/vps-patch-calc-fix.mjs — fix hung calculator loading */
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

async function upload(sftp, local, remote) {
  await new Promise((res, rej) => sftp.fastPut(local, remote, (e) => (e ? rej(e) : res())));
}

const conn = new Client();
conn.on("ready", async () => {
  const s = await new Promise((res, rej) => conn.sftp((e, sf) => (e ? rej(e) : res(sf))));
  for (const name of ["patch-calc-disable-asset-protect.py", "patch-calc-boot-fix.py"]) {
    await upload(s, path.join(__dirname, name), `/tmp/${name}`);
    await exec(conn, `python3 /tmp/${name}`);
  }
  await exec(conn, "systemctl restart daogreen-calc && sleep 2 && curl -fsS -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/vf-cultivars.js && echo");
  conn.end();
});
conn.on("error", (e) => {
  console.error(e);
  process.exit(1);
});
conn.connect({ host: "62.233.35.206", port: 22, username: "root", password, readyTimeout: 60000 });
