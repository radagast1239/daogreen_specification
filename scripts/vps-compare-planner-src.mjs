/** Сравнить исходники планировщика локально vs VPS. */
import { Client } from "ssh2";
import fs from "fs";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

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

function walk(dir, base = dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) out.push(...walk(full, base));
    else if (/\.(js|jsx|css)$/.test(name)) out.push(path.relative(base, full).replace(/\\/g, "/"));
  }
  return out;
}

function md5File(file) {
  const h = crypto.createHash("md5");
  h.update(fs.readFileSync(file));
  return h.digest("hex");
}

const plannerDir = path.join(root, "src/planner");
const planPage = path.join(root, "src/pages/admin/PlanPage.jsx");
const plannerHub = path.join(root, "src/pages/admin/PlannerHubPage.jsx");

const relFiles = [
  ...walk(plannerDir, plannerDir).map((f) => `src/planner/${f}`),
  "src/pages/admin/PlanPage.jsx",
];
if (fs.existsSync(plannerHub)) relFiles.push("src/pages/admin/PlannerHubPage.jsx");

const testsDir = path.join(root, "tests");
if (fs.existsSync(testsDir)) {
  for (const name of fs.readdirSync(testsDir)) {
    if (/planner|wall|rack|room|grid|structural|serviceZone/i.test(name) && name.endsWith(".test.js")) {
      relFiles.push(`tests/${name}`);
    }
  }
}

const local = {};
for (const rel of relFiles) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) continue;
  local[rel] = md5File(full);
}

function exec(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = "";
      stream.on("data", (d) => { out += d; });
      stream.stderr.on("data", (d) => process.stderr.write(d));
      stream.on("close", (code) => (code ? reject(new Error(`exit ${code}`)) : resolve(out)));
    });
  });
}

const conn = new Client();
conn
  .on("ready", async () => {
    try {
      const remotePaths = Object.keys(local).map((r) => `${remoteRoot}/${r}`).join(" ");
      const out = await exec(
        conn,
        `for f in ${remotePaths}; do if [ -f "$f" ]; then md5sum "$f"; else echo "MISSING $f"; fi; done`,
      );

      const missing = [];
      const diff = [];
      const ok = [];

      for (const line of out.trim().split("\n")) {
        if (line.startsWith("MISSING ")) {
          const rel = line.slice(8).replace(`${remoteRoot}/`, "");
          missing.push(rel);
          continue;
        }
        const m = line.match(/^([a-f0-9]{32})\s+(.+)$/);
        if (!m) continue;
        const rel = m[2].replace(`${remoteRoot}/`, "");
        if (!local[rel]) continue;
        if (local[rel] === m[1]) ok.push(rel);
        else diff.push(rel);
      }

      console.log(`Checked ${Object.keys(local).length} planner source files\n`);
      console.log("=== OK ===", ok.length);
      console.log("=== MISSING on server ===");
      missing.forEach((f) => console.log(" ", f));
      console.log("=== DIFFERENT on server ===");
      diff.forEach((f) => console.log(" ", f));

      console.log("\nTO_UPLOAD=" + [...missing, ...diff].join(","));
      conn.end();
    } catch (e) {
      console.error(e.message);
      conn.end();
      process.exit(1);
    }
  })
  .connect({ host, port: 22, username: user, password, readyTimeout: 180000 });
