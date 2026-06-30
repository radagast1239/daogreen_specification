/** Залить clean-скрипты и применить очистку каталогов в SQLite на VPS */
import { Client } from "ssh2";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const password = process.env.VPS_PASSWORD;
const host = process.env.VPS_HOST || "62.233.35.206";
const remoteRoot = process.env.VPS_APP_ROOT || "/opt/daogreen-spec";
const nodeBin = "/opt/node-v22.16.0-linux-x64/bin/node";
const apply = process.argv.includes("--apply");

if (!password) {
  console.error("Set VPS_PASSWORD");
  process.exit(1);
}

const files = [
  "shared/orphanMaterialRemap.js",
  "shared/cleanStellageCatalogs.js",
  "shared/cleanFarmSectionCatalogs.js",
  "backend/scripts/cleanStellageCatalogs.mjs",
  "backend/scripts/cleanFarmSectionCatalogs.mjs",
  "backend/scripts/remapOrphanMaterialIds.mjs",
];

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

const conn = new Client();
conn
  .on("ready", async () => {
    try {
      const s = await sftp(conn);
      for (const rel of files) {
        const local = path.join(root, rel);
        const remote = `${remoteRoot}/${rel}`;
        await exec(conn, `mkdir -p $(dirname ${remote})`);
        await upload(s, local, remote);
        console.log("Uploaded", rel);
      }
      const flag = apply ? " --apply" : "";
      for (const script of [
        "backend/scripts/cleanStellageCatalogs.mjs",
        "backend/scripts/cleanFarmSectionCatalogs.mjs",
        "backend/scripts/remapOrphanMaterialIds.mjs",
      ]) {
        await exec(conn, `cd ${remoteRoot} && ${nodeBin} ${script}${flag}`);
      }
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
  .connect({ host, port: 22, username: "root", password, readyTimeout: 180000 });
