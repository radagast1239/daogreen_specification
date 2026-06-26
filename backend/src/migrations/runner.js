import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "../../migrations");

/** Версионированные SQL-миграции (дополняют migrateDb в db.js). */
export function runSqlMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  if (!fs.existsSync(MIGRATIONS_DIR)) return;

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const id = file.replace(/\.sql$/i, "");
    const applied = db.prepare("SELECT 1 FROM schema_migrations WHERE id = ?").get(id);
    if (applied) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8").trim();
    if (!sql) {
      db.prepare("INSERT INTO schema_migrations (id) VALUES (?)").run(id);
      continue;
    }
    const run = db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (id) VALUES (?)").run(id);
    });
    run();
    console.log(`[migrate] applied ${id}`);
  }
}
