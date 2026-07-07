/**
 * Read-only production DB count check over SSH.
 *
 * Usage:
 *   VPS_HOST=62.233.35.206 VPS_USER=root VPS_PASSWORD=... node scripts/vps-db-counts.mjs
 *
 * Safety:
 *   - read-only SQL only
 *   - does not write files on production
 *   - does not restart services
 *   - does not run deploy
 *   - does not print env contents
 *
 * Expected production counts:
 *   materials = 158
 *   projects = 6
 */
import { Client } from "ssh2";

const password = process.env.VPS_PASSWORD;
if (!password) {
  console.error("Set VPS_PASSWORD");
  process.exit(1);
}

const cmd = `python3 - <<'PY'
import sqlite3
c = sqlite3.connect("/opt/daogreen-spec/backend/data/daogreen.db")
for table in ("materials", "projects", "project_items"):
    n = c.execute(f"select count(*) from {table}").fetchone()[0]
    print(table, n)
PY`;

const conn = new Client();
conn
  .on("ready", () => {
    conn.exec(cmd, (err, stream) => {
      if (err) {
        console.error(err.message);
        conn.end();
        process.exit(1);
      }
      stream.on("data", (d) => process.stdout.write(d));
      stream.stderr.on("data", (d) => process.stderr.write(d));
      stream.on("close", (code) => {
        conn.end();
        process.exit(code || 0);
      });
    });
  })
  .on("error", (e) => {
    console.error(e.message);
    process.exit(1);
  })
  .connect({
    host: process.env.VPS_HOST || "62.233.35.206",
    port: 22,
    username: process.env.VPS_USER || "root",
    password,
    readyTimeout: 60000,
  });
