/** Залить исходники планировщика на VPS (только src/planner + PlanPage). */
import { Client } from "ssh2";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const host = process.env.VPS_HOST || "62.233.35.206";
const user = process.env.VPS_USER || "root";
const password = process.env.VPS_PASSWORD;
const remoteRoot = process.env.VPS_APP_ROOT || "/opt/daogreen-spec";

if (!password) {
  console.error("Set VPS_PASSWORD");
  process.exit(1);
}

const toUpload = execSync("node scripts/vps-compare-planner-src.mjs", {
  cwd: root,
  env: { ...process.env, VPS_PASSWORD: password },
  encoding: "utf8",
})
  .split("\n")
  .find((l) => l.startsWith("TO_UPLOAD="))
  ?.slice("TO_UPLOAD=".length)
  .split(",")
  .filter(Boolean) || [];

if (!toUpload.length) {
  console.log("Nothing to upload (sources already match).");
  process.exit(0);
}

console.log(`Uploading ${toUpload.length} planner source files...`);

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
      for (const rel of toUpload) {
        const local = path.join(root, rel);
        if (!fs.existsSync(local)) {
          console.warn("Skip missing local:", rel);
          continue;
        }
        const remote = `${remoteRoot}/${rel.replace(/\\/g, "/")}`;
        await exec(conn, `mkdir -p $(dirname ${remote})`);
        await upload(s, local, remote);
        console.log("Uploaded", rel);
      }
      conn.end();
      console.log("Done.");
    } catch (e) {
      console.error(e.message);
      conn.end();
      process.exit(1);
    }
  })
  .connect({ host, port: 22, username: user, password, readyTimeout: 180000 });
