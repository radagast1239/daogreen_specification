import { Client } from "ssh2";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const host = process.env.VPS_HOST || "62.233.35.206";
const user = process.env.VPS_USER || "root";
const password = process.env.VPS_PASSWORD;
const remoteRoot = process.env.VPS_APP_ROOT || "/opt/daogreen-spec";
const apply = process.argv.includes("--apply");

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
      const localXlsx = path.join(root, "import/daogreen_materials_naming_map_client_subsections.xlsx");
      const remoteXlsx = `${remoteRoot}/import/daogreen_materials_naming_map_client_subsections.xlsx`;
      await exec(conn, `mkdir -p ${remoteRoot}/import`);
      await upload(s, localXlsx, remoteXlsx);
      console.log("Uploaded Excel");

      const mode = apply ? "--apply" : "--dry-run";
      await exec(
        conn,
        `cd ${remoteRoot} && git pull --ff-only 2>/dev/null || true && cd backend && npm run import:materials-map -- ${mode} ../import/daogreen_materials_naming_map_client_subsections.xlsx`
      );
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
  .connect({ host, port: 22, username: user, password, readyTimeout: 120000 });
