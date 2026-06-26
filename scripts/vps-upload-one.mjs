/** Upload one local file to VPS */
import { Client } from "ssh2";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const [rel, remoteRel] = process.argv.slice(2);
if (!rel) {
  console.error("Usage: node vps-upload-one.mjs <localRel> [remoteRel]");
  process.exit(1);
}

const password = process.env.VPS_PASSWORD;
if (!password) {
  console.error("Set VPS_PASSWORD");
  process.exit(1);
}
const host = process.env.VPS_HOST || "62.233.35.206";
const remoteRoot = process.env.VPS_APP_ROOT || "/opt/daogreen-spec";
const local = path.join(root, rel);
const remote = `${remoteRoot}/${(remoteRel || rel).replace(/\\/g, "/")}`;

function exec(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      stream.on("close", (code) => (code ? reject(new Error(`exit ${code}`)) : resolve()));
    });
  });
}

const conn = new Client();
conn
  .on("ready", async () => {
    const s = await new Promise((resolve, reject) => conn.sftp((e, sf) => (e ? reject(e) : resolve(sf))));
    await exec(conn, `mkdir -p $(dirname ${remote})`);
    await new Promise((resolve, reject) => s.fastPut(local, remote, (e) => (e ? reject(e) : resolve())));
    console.log("Uploaded", rel, "->", remote);
    conn.end();
  })
  .on("error", (e) => {
    console.error(e.message);
    process.exit(1);
  })
  .connect({ host, port: 22, username: "root", password, readyTimeout: 60000 });
