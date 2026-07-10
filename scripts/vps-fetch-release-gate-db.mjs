/**
 * WAL-safe production DB fetch for release gate (read-only on server except backup file).
 *
 * Usage:
 *   VPS_PASSWORD=... node scripts/vps-fetch-release-gate-db.mjs
 *
 * Downloads to server-debug/backend/data/daogreen.db
 * Immutable copy: server-debug/backend/data/daogreen_before_release_gate.db
 */
import { Client } from "ssh2";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { DatabaseSync } from "node:sqlite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const password = process.env.VPS_PASSWORD;
const host = process.env.VPS_HOST || "62.233.35.206";
const user = process.env.VPS_USER || "root";

if (!password) {
  console.error("Set VPS_PASSWORD");
  process.exit(1);
}

const outDir = path.join(__dirname, "../server-debug/backend/data");
const localDb = path.join(outDir, "daogreen.db");
const localBefore = path.join(outDir, "daogreen_before_release_gate.db");
const remoteBackup = "/tmp/daogreen_prod_release_gate.db";

const discoverCmd = `set -euo pipefail
echo "=== SYSTEMD UNIT ==="
systemctl cat daogreen-spec 2>/dev/null || true
echo "=== ENV DATABASE_PATH ==="
grep -E 'DATABASE|Environment' /etc/systemd/system/daogreen-spec.service 2>/dev/null || true
PID=$(systemctl show -p MainPID --value daogreen-spec 2>/dev/null || echo 0)
echo "MAINPID=$PID"
if [ "$PID" != "0" ] && [ -n "$PID" ]; then
  echo "=== OPEN DB FILES ==="
  ls -l /proc/$PID/fd 2>/dev/null | grep -E '\\.db' || true
fi
echo "=== HEALTH ==="
curl -fsS http://127.0.0.1:3002/api/health || true
echo
`;

const backupCmd = `set -euo pipefail
UNIT_FILE="/etc/systemd/system/daogreen-spec.service"
DB=""
if [ -f "$UNIT_FILE" ]; then
  DB=$(grep -oE 'DATABASE_PATH=[^ "]+' "$UNIT_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true)
fi
if [ -z "$DB" ] && [ -f /opt/daogreen-spec/backend/.env ]; then
  DB=$(grep -E '^DATABASE_PATH=' /opt/daogreen-spec/backend/.env | head -1 | cut -d= -f2- || true)
fi
if [ -z "$DB" ]; then
  DB="/opt/daogreen-spec/backend/data/daogreen.db"
fi
case "$DB" in
  ./*) DB="/opt/daogreen-spec/backend/$DB" ;;
  data/*) DB="/opt/daogreen-spec/backend/$DB" ;;
esac
echo "RESOLVED_DATABASE_PATH=$DB"
if [ ! -f "$DB" ]; then echo "DB file missing"; exit 2; fi
rm -f '${remoteBackup}'
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB" ".backup '${remoteBackup}'"
else
  python3 - <<PY
import sqlite3
src = sqlite3.connect("$DB")
dst = sqlite3.connect("${remoteBackup}")
src.backup(dst)
dst.close()
src.close()
PY
fi
python3 - <<PY
import sqlite3
c = sqlite3.connect("${remoteBackup}")
ic = c.execute("pragma integrity_check").fetchone()[0]
m = c.execute("select count(*) from materials").fetchone()[0]
p = c.execute("select count(*) from projects").fetchone()[0]
print("integrity_check", ic)
print("materials", m)
print("projects", p)
PY
ls -la '${remoteBackup}'
`;

function exec(conn, cmd) {
  return new Promise((resolve, reject) => {
    let out = "";
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      stream.on("data", (d) => {
        out += d.toString();
        process.stdout.write(d);
      });
      stream.stderr.on("data", (d) => process.stderr.write(d));
      stream.on("close", (code) => {
        if (code !== 0) reject(new Error(`exit ${code}`));
        else resolve(out);
      });
    });
  });
}

function sftpGet(conn, remote, local) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      fs.mkdirSync(path.dirname(local), { recursive: true });
      sftp.fastGet(remote, local, (e) => (e ? reject(e) : resolve()));
    });
  });
}

function localInspect(dbPath) {
  const db = new DatabaseSync(dbPath, { readonly: true });
  const integrity = db.prepare("PRAGMA integrity_check").get()["integrity_check"];
  const journal = db.prepare("PRAGMA journal_mode").get().journal_mode;
  const materials = db.prepare("SELECT COUNT(*) c FROM materials").get().c;
  const projects = db.prepare("SELECT COUNT(*) c FROM projects").get().c;
  db.close();
  return { integrity, journal, materials, projects };
}

const conn = new Client();
conn
  .on("ready", async () => {
    try {
      console.log("\n--- DISCOVER ---\n");
      await exec(conn, discoverCmd);
      console.log("\n--- WAL-SAFE BACKUP ---\n");
      await exec(conn, backupCmd);
      console.log("\n--- DOWNLOAD ---\n");
      await sftpGet(conn, remoteBackup, localDb);
      fs.copyFileSync(localDb, localBefore);
      const local = localInspect(localDb);
      console.log("\nLOCAL COPY:", localDb);
      console.log(JSON.stringify(local, null, 2));
      if (local.materials !== 165 || local.projects !== 7) {
        console.error(`CHECKPOINT MISMATCH: expected materials=165 projects=7, got ${local.materials}/${local.projects}`);
        process.exit(3);
      }
      conn.exec(`rm -f '${remoteBackup}'`, () => conn.end());
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
