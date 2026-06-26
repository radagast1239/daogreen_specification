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
const frontendOnly = process.argv.includes("--frontend-only");
const nodeBin = "/opt/node-v22.16.0-linux-x64/bin";

if (!password) {
  console.error("Set VPS_PASSWORD env var");
  process.exit(1);
}

const uploadFiles = [
  "shared/materialModules.js",
  "shared/materialFarmSections.js",
  "shared/materialQualityCheck.js",
  "backend/scripts/applyMaterialsModuleMap.js",
  "backend/src/db.js",
  "backend/src/routes/materials.js",
  "backend/src/services/farmSectionCatalogs.js",
  "backend/src/services/syncMaterialFarmSectionCatalog.js",
  "backend/package.json",
  "package.json",
  "src/components/SpecPickerTable.jsx",
  "src/components/MaterialModulesEditor.jsx",
  "src/components/MaterialFarmSectionsEditor.jsx",
  "src/components/Layout.jsx",
  "src/pages/admin/MaterialsPage.jsx",
  "src/pages/admin/MaterialsQualityPage.jsx",
  "src/pages/admin/ModulesPage.jsx",
  "src/pages/admin/ProjectBuilderPage.jsx",
  "src/lib/projectBuilder.js",
  "src/lib/stellageCatalogConfig.js",
  "src/styles/theme.css",
];

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

      if (!frontendOnly) {
        const mode = apply ? "--apply" : "--dry-run";
        await exec(conn, `cd ${remoteRoot}/backend && ${nodeBin}/node scripts/applyMaterialsModuleMap.js ${mode}`);
      }

      if (apply) {
        await exec(
          conn,
          `cd ${remoteRoot} && NODE_OPTIONS=--max-old-space-size=512 ${nodeBin}/npm run build && systemctl restart daogreen-spec && sleep 5 && curl -fsS http://127.0.0.1:3002/api/health && echo OK`
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
