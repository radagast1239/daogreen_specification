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
const nodeBin = "/opt/node-v22.16.0-linux-x64/bin";

if (!password) {
  console.error("Set VPS_PASSWORD env var");
  process.exit(1);
}

const uploadFiles = [
  "shared/clientSections.js",
  "backend/scripts/importMaterialsNamingMap.js",
  "backend/src/db.js",
  "backend/package.json",
  "package.json",
  "src/pages/admin/MaterialsPage.jsx",
  "src/store/helpers.js",
  "import/daogreen_materials_naming_map_client_subsections.xlsx",
];

function exec(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = "";
      stream
        .on("close", (code) => (code ? reject(new Error(`exit ${code}`)) : resolve(out)))
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
    fs.mkdirSync(path.dirname(local), { recursive: true });
    sftpClient.fastPut(local, remote, (err) => (err ? reject(err) : resolve()));
  });
}

const conn = new Client();
conn
  .on("ready", async () => {
    try {
      const s = await sftp(conn);
      for (const rel of uploadFiles) {
        const local = path.join(root, rel);
        const remote = `${remoteRoot}/${rel.replace(/\\/g, "/")}`;
        await exec(conn, `mkdir -p $(dirname ${remote})`);
        await upload(s, local, remote);
        console.log("Uploaded", rel);
      }

      const mode = apply ? "--apply" : "--dry-run";
      await exec(
        conn,
        `cd ${remoteRoot}/backend && ${nodeBin}/node scripts/importMaterialsNamingMap.js ${mode} ../import/daogreen_materials_naming_map_client_subsections.xlsx`
      );

      if (apply) {
        await exec(
          conn,
          `cd ${remoteRoot} && ${nodeBin}/npm run build && systemctl restart daogreen-spec && sleep 2 && curl -fsS http://127.0.0.1:3002/api/health && echo OK`
        );
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
  .connect({ host, port: 22, username: user, password, readyTimeout: 180000 });
