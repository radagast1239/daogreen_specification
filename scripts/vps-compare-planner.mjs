/** Сравнить локальный dist планировщика с VPS и вывести расхождения. */
import { Client } from "ssh2";
import fs from "fs";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const dist = path.join(root, "dist");

const host = process.env.VPS_HOST || "62.233.35.206";
const user = process.env.VPS_USER || "root";
const password = process.env.VPS_PASSWORD;
const remoteRoot = process.env.VPS_APP_ROOT || "/opt/daogreen-spec";

if (!password) {
  console.error("Set VPS_PASSWORD");
  process.exit(1);
}

function md5File(file) {
  const h = crypto.createHash("md5");
  h.update(fs.readFileSync(file));
  return h.digest("hex");
}

function collectPlannerAssets() {
  const assetsDir = path.join(dist, "assets");
  if (!fs.existsSync(assetsDir)) {
    console.error("Run npm run build first");
    process.exit(1);
  }
  const names = fs.readdirSync(assetsDir);
  const direct = names.filter((n) =>
    /^(planner|PlanPage|PlannerHub)/i.test(n),
  );
  const files = new Set(direct.map((n) => `assets/${n}`));

  // index chunk содержит lazy-map на PlanPage
  const indexChunk = names.find((n) => /^index-.*\.js$/.test(n));
  if (indexChunk) files.add(`assets/${indexChunk}`);

  // Зависимости PlanPage (из import строки бандла)
  const planPage = names.find((n) => /^PlanPage-.*\.js$/.test(n));
  if (planPage) {
    const src = fs.readFileSync(path.join(assetsDir, planPage), "utf8");
    for (const m of src.matchAll(/from"\.\/([^"]+\.js)"/g)) {
      files.add(`assets/${m[1]}`);
    }
  }

  const hub = names.find((n) => /^PlannerHubPage-.*\.js$/.test(n));
  if (hub) {
    const src = fs.readFileSync(path.join(assetsDir, hub), "utf8");
    for (const m of src.matchAll(/from"\.\/([^"]+\.js)"/g)) {
      files.add(`assets/${m[1]}`);
    }
  }

  if (fs.existsSync(path.join(dist, "index.html"))) files.add("index.html");

  return [...files].sort();
}

function exec(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = "";
      stream.on("data", (d) => { out += d; });
      stream.stderr.on("data", (d) => process.stderr.write(d));
      stream.on("close", (code) => (code ? reject(new Error(`exit ${code}: ${out}`)) : resolve(out)));
    });
  });
}

const relFiles = collectPlannerAssets();
console.log("Planner bundle files to check:", relFiles.length);

const local = {};
for (const rel of relFiles) {
  const full = path.join(dist, rel);
  if (!fs.existsSync(full)) continue;
  local[rel] = { size: fs.statSync(full).size, md5: md5File(full) };
}

const conn = new Client();
conn
  .on("ready", async () => {
    try {
      const remotePaths = relFiles.map((r) => `${remoteRoot}/dist/${r}`).join(" ");
      const out = await exec(
        conn,
        `for f in ${remotePaths}; do if [ -f "$f" ]; then md5sum "$f"; else echo "MISSING $f"; fi; done`,
      );

      const remote = {};
      for (const line of out.trim().split("\n")) {
        if (line.startsWith("MISSING ")) {
          const p = line.slice(8);
          const rel = p.replace(`${remoteRoot}/dist/`, "");
          remote[rel] = null;
          continue;
        }
        const m = line.match(/^([a-f0-9]{32})\s+(.+)$/);
        if (!m) continue;
        const rel = m[2].replace(`${remoteRoot}/dist/`, "");
        remote[rel] = { md5: m[1] };
      }

      const missing = [];
      const diff = [];
      const ok = [];

      for (const rel of relFiles) {
        if (!local[rel]) continue;
        if (!remote[rel]) {
          missing.push(rel);
        } else if (remote[rel].md5 !== local[rel].md5) {
          diff.push(rel);
        } else {
          ok.push(rel);
        }
      }

      // Старые PlanPage/PlannerHub на сервере
      const staleOut = await exec(
        conn,
        `ls -1 ${remoteRoot}/dist/assets/ 2>/dev/null | grep -E '^(PlanPage|PlannerHub|planner)-' || true`,
      );
      const localNames = new Set(relFiles.map((r) => r.replace("assets/", "")));
      const stale = staleOut
        .trim()
        .split("\n")
        .filter(Boolean)
        .filter((n) => !localNames.has(n));

      console.log("\n=== OK (identical) ===");
      ok.forEach((f) => console.log(" ", f));

      console.log("\n=== MISSING on server ===");
      missing.forEach((f) => console.log(" ", f));

      console.log("\n=== DIFFERENT on server ===");
      diff.forEach((f) => console.log(" ", f));

      if (stale.length) {
        console.log("\n=== STALE on server (old hashes, safe to ignore if index updated) ===");
        stale.forEach((f) => console.log(" ", f));
      }

      const toUpload = [...missing, ...diff];
      console.log("\nTO_UPLOAD=" + toUpload.join(","));
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
