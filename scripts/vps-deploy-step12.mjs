/**
 * Деплой шагов 1–2: project_items snapshot, фильтры, группы стеллажа/фермы, patchLine.
 *   node scripts/vps-deploy-step12.mjs          — только загрузка файлов
 *   node scripts/vps-deploy-step12.mjs --apply  — загрузка + build на VPS + restart
 */
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

const uploadDirs = ["shared", "src", "backend/src", "backend/migrations"];

function collectFiles(dir, base = dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = path.relative(base, full).replace(/\\/g, "/");
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      out.push(...collectFiles(full, base));
    } else if (/\.(js|jsx|css|json|sql)$/.test(name)) {
      out.push(rel);
    }
  }
  return out;
}

const uploadFiles = [
  ...uploadDirs.flatMap((d) => collectFiles(path.join(root, d), path.join(root, d)).map((f) => `${d}/${f}`)),
  "backend/package.json",
  "package.json",
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
        if (!fs.existsSync(local)) {
          console.warn("Skip (missing):", rel);
          continue;
        }
        const remote = `${remoteRoot}/${rel.replace(/\\/g, "/")}`;
        await exec(conn, `mkdir -p $(dirname ${remote})`);
        await upload(s, local, remote);
        console.log("Uploaded", rel);
      }

      if (apply) {
        await exec(
          conn,
          `cd ${remoteRoot} && NODE_OPTIONS=--max-old-space-size=512 ${nodeBin}/npm run build && systemctl restart daogreen-spec && sleep 5 && curl -fsS http://127.0.0.1:3002/api/health && echo OK`
        );
      } else {
        console.log("\nFiles uploaded. Run with --apply to build and restart on VPS.");
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
