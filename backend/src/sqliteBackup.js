import fs from "fs";
import os from "os";
import path from "path";
import { createHash } from "crypto";
import { DatabaseSync } from "node:sqlite";

export const DEFAULT_BACKUP_TIMEOUT_MS = 120_000;
export const VALID_BACKUP_NAME_RE = /^daogreen_.+\.db$/;

/** Critical tables counted when present; missing tables are skipped (schema-aware). */
export const CRITICAL_COUNT_TABLES = [
  "materials",
  "projects",
  "project_items",
  "spec_versions",
  "files",
  "frame_drawings",
  "admin_users",
];

export const BACKUP_INTEGRITY_FAILED = "BACKUP_INTEGRITY_FAILED";
export const BACKUP_FOREIGN_KEYS_FAILED = "BACKUP_FOREIGN_KEYS_FAILED";
export const BACKUP_COUNTS_FAILED = "BACKUP_COUNTS_FAILED";
export const BACKUP_EMPTY = "BACKUP_EMPTY";
export const BACKUP_NOT_FOUND = "BACKUP_NOT_FOUND";
export const BACKUP_SOURCE_INVALID = "BACKUP_SOURCE_INVALID";
export const PRE_MIGRATION_BACKUP_REQUIRED = "PRE_MIGRATION_BACKUP_REQUIRED";
export const RESTORE_REMOTE_STALE = "RESTORE_REMOTE_STALE";
export const RESTORE_VERIFY_FAILED = "RESTORE_VERIFY_FAILED";
export const RESTORE_SWITCH_FAILED = "RESTORE_SWITCH_FAILED";

export function backupError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

export function quoteSqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Soft timeout via Promise.race — does NOT hard-kill a synchronous SQLite Backup/VACUUM.
 * If the backup finishes after the timer, work may still complete; the race only rejects
 * the awaited promise early as a warning/fail path when asyncTimeout is enabled.
 */
function runWithSoftTimeout(fn, timeoutMs) {
  if (!timeoutMs || timeoutMs <= 0) return fn();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(backupError("BACKUP_SOFT_TIMEOUT", `backup soft timeout after ${timeoutMs}ms`)),
      timeoutMs
    );
  });
  return Promise.race([Promise.resolve().then(fn), timeout]).finally(() => clearTimeout(timer));
}

function writeBackupFile(sourcePath, tmpPath) {
  if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    if (typeof source.backup === "function") {
      const dest = new DatabaseSync(tmpPath);
      try {
        source.backup(dest);
      } finally {
        dest.close();
      }
      return;
    }
    source.exec(`VACUUM INTO ${quoteSqlString(tmpPath)}`);
  } finally {
    source.close();
  }
}

function assertTmpBackup(tmpPath) {
  if (!fs.existsSync(tmpPath)) {
    throw backupError(BACKUP_NOT_FOUND, `backup tmp was not created: ${path.basename(tmpPath)}`);
  }
  const size = fs.statSync(tmpPath).size;
  if (size <= 0) {
    throw backupError(BACKUP_EMPTY, `backup tmp is empty: ${path.basename(tmpPath)}`);
  }
  return size;
}

export function safeUnlink(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    /* ignore cleanup errors */
  }
}

export function tableExists(db, tableName) {
  const row = db
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(String(tableName));
  return !!row;
}

export function sha256File(filePath) {
  const hash = createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

export function metadataSidecarPath(backupPath) {
  return `${backupPath}.meta.json`;
}

export function readBackupMetadata(backupPath) {
  const metaPath = metadataSidecarPath(backupPath);
  if (!fs.existsSync(metaPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(metaPath, "utf8"));
  } catch {
    return null;
  }
}

export function writeBackupMetadata(backupPath, verification) {
  const meta = {
    createdAt: new Date().toISOString(),
    counts: verification?.counts || {},
    schemaNote: verification?.schemaNote || "",
    sha256: sha256File(backupPath),
    size: verification?.size ?? fs.statSync(backupPath).size,
  };
  fs.writeFileSync(metadataSidecarPath(backupPath), JSON.stringify(meta, null, 2), "utf8");
  return meta;
}

export function publishSqliteBackup(tmpPath, targetPath) {
  assertTmpBackup(tmpPath);
  fs.renameSync(tmpPath, targetPath);
  return {
    ok: true,
    path: targetPath,
    size: fs.statSync(targetPath).size,
  };
}

export function createSqliteBackup(sourcePath, targetPath, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_BACKUP_TIMEOUT_MS;
  if (!sourcePath || !targetPath) {
    throw backupError(BACKUP_SOURCE_INVALID, "sourcePath and targetPath are required");
  }
  if (!fs.existsSync(sourcePath)) {
    throw backupError(BACKUP_SOURCE_INVALID, `source DB not found: ${path.basename(sourcePath)}`);
  }
  const sourceStat = fs.statSync(sourcePath);
  if (!sourceStat.isFile() || sourceStat.size <= 0) {
    throw backupError(BACKUP_SOURCE_INVALID, `source DB is empty or invalid: ${path.basename(sourcePath)}`);
  }

  const tmpPath = `${targetPath}.tmp`;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });

  const started = Date.now();
  const execute = () => {
    writeBackupFile(sourcePath, tmpPath);
    const size = assertTmpBackup(tmpPath);
    return {
      ok: true,
      tmpPath,
      targetPath,
      size,
      durationMs: Date.now() - started,
    };
  };

  try {
    if (options.asyncTimeout) {
      return runWithSoftTimeout(execute, timeoutMs);
    }
    return execute();
  } catch (error) {
    safeUnlink(tmpPath);
    throw error;
  }
}

/**
 * Verify a SQLite backup file: integrity_check, foreign_key_check, schema-aware counts.
 * Never publishes; caller must delete .tmp on failure.
 */
export function verifySqliteBackup(backupPath, options = {}) {
  if (!backupPath || !fs.existsSync(backupPath)) {
    throw backupError(BACKUP_NOT_FOUND, `backup not found: ${path.basename(backupPath || "")}`);
  }
  const size = fs.statSync(backupPath).size;
  if (size <= 0) {
    throw backupError(BACKUP_EMPTY, `backup is empty: ${path.basename(backupPath)}`);
  }

  let db;
  try {
    db = new DatabaseSync(backupPath, { readOnly: true });
  } catch (err) {
    throw backupError(BACKUP_INTEGRITY_FAILED, `backup open failed: ${err.message}`);
  }

  try {
    const integrity = db.prepare("PRAGMA integrity_check").get()?.integrity_check;
    if (integrity !== "ok") {
      throw backupError(BACKUP_INTEGRITY_FAILED, `integrity_check failed: ${integrity}`);
    }

    const fkRows = db.prepare("PRAGMA foreign_key_check").all();
    if (fkRows.length > 0) {
      throw backupError(
        BACKUP_FOREIGN_KEYS_FAILED,
        `foreign_key_check failed: ${fkRows.length} violation(s)`
      );
    }

    const counts = {};
    const skippedTables = [];
    const tables = options.countTables || CRITICAL_COUNT_TABLES;
    try {
      for (const table of tables) {
        if (!tableExists(db, table)) {
          skippedTables.push(table);
          continue;
        }
        counts[table] = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get()?.c ?? 0;
      }
    } catch (err) {
      throw backupError(BACKUP_COUNTS_FAILED, `counts failed: ${err.message}`);
    }

    const schemaNote =
      skippedTables.length > 0
        ? `skipped missing tables: ${skippedTables.join(", ")}`
        : "all critical tables present";

    const expectCounts = options.expectCounts || {};
    for (const [key, expected] of Object.entries(expectCounts)) {
      if (counts[key] !== expected) {
        throw backupError(
          BACKUP_COUNTS_FAILED,
          `${key} count mismatch: expected ${expected}, got ${counts[key]}`
        );
      }
    }

    return { ok: true, integrity, counts, size, schemaNote, skippedTables };
  } finally {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
}

export function createAndVerifySqliteBackup(sourcePath, targetPath, options = {}) {
  const writeMeta = options.writeMetadata !== false;
  const finalize = (created) => {
    try {
      const preVerify = verifySqliteBackup(created.tmpPath, options);
      const published = publishSqliteBackup(created.tmpPath, targetPath);
      const verification = verifySqliteBackup(targetPath, options);
      let metadata = null;
      if (writeMeta) {
        metadata = writeBackupMetadata(targetPath, verification);
      }
      return {
        ...published,
        durationMs: created.durationMs,
        verification,
        metadata,
        counts: verification.counts,
      };
    } catch (error) {
      safeUnlink(created.tmpPath);
      safeUnlink(targetPath);
      safeUnlink(metadataSidecarPath(targetPath));
      throw error;
    }
  };

  const created = createSqliteBackup(sourcePath, targetPath, options);
  if (created instanceof Promise) {
    return created.then(finalize);
  }
  return finalize(created);
}

/** Timestamped download name: daogreen-backup-YYYY-MM-DDTHHMMSS.db */
export function formatBackupDownloadName(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return `daogreen-backup-${y}-${m}-${d}T${hh}${mm}${ss}.db`;
}

/**
 * Create a verified WAL-safe snapshot for download. Never returns the live DB path.
 */
export function createVerifiedDownloadBackup(sourcePath, options = {}) {
  const dir = options.dir || os.tmpdir();
  fs.mkdirSync(dir, { recursive: true });
  const downloadName = options.downloadName || formatBackupDownloadName();
  const targetPath = path.join(dir, `${downloadName}.tmpbuild-${Date.now()}.db`);
  const result = createAndVerifySqliteBackup(sourcePath, targetPath, {
    ...options,
    writeMetadata: false,
  });
  if (result instanceof Promise) {
    return result.then((published) => ({
      ...published,
      downloadName,
      livePath: sourcePath,
      isLivePath: false,
    }));
  }
  return {
    ...result,
    downloadName,
    livePath: sourcePath,
    isLivePath: false,
  };
}

export function isValidBackupFilename(name) {
  return VALID_BACKUP_NAME_RE.test(name) && !name.includes(".tmp") && !name.includes(".INVALID");
}

/**
 * Retention: remove old valid backups past keepDays, but never delete the newest valid backup
 * (keep at least one valid file even if past keepDays).
 */
export function rotateBackups(backupDir, keepDays = 14, options = {}) {
  if (!backupDir || !fs.existsSync(backupDir)) return { removed: [] };
  const now = options.now ?? Date.now();
  const cutoff = now - keepDays * 86400000;
  const removed = [];

  const valid = [];
  for (const name of fs.readdirSync(backupDir)) {
    if (!isValidBackupFilename(name)) continue;
    const fullPath = path.join(backupDir, name);
    try {
      const stat = fs.statSync(fullPath);
      if (!stat.isFile() || stat.size <= 0) continue;
      valid.push({ name, fullPath, mtimeMs: stat.mtimeMs });
    } catch {
      /* ignore */
    }
  }

  valid.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const newestPath = valid[0]?.fullPath || null;

  for (const file of valid) {
    if (file.fullPath === newestPath) continue;
    if (file.mtimeMs >= cutoff) continue;
    try {
      fs.unlinkSync(file.fullPath);
      safeUnlink(metadataSidecarPath(file.fullPath));
      removed.push(file.fullPath);
    } catch {
      /* ignore single-file retention errors */
    }
  }

  return { removed, keptNewest: newestPath };
}

export function createBackupScheduler({ intervalMs, runBackup, runOnStart = true }) {
  let intervalId = null;
  let shutdownRequested = false;
  let locked = false;
  let running = null;

  async function tick() {
    if (shutdownRequested || locked) {
      return { ok: false, skipped: true, reason: locked ? "locked" : "shutdown" };
    }
    locked = true;
    const job = Promise.resolve().then(() => runBackup());
    running = job;
    try {
      return await job;
    } finally {
      locked = false;
      running = null;
    }
  }

  function start() {
    if (runOnStart) {
      tick().catch((error) => console.warn("DB backup:", error.code || "", error.message));
    }
    intervalId = setInterval(() => {
      tick().catch((error) => console.warn("DB backup:", error.code || "", error.message));
    }, intervalMs);
  }

  async function shutdown({ waitMs = 8000 } = {}) {
    shutdownRequested = true;
    if (intervalId) clearInterval(intervalId);
    intervalId = null;
    if (!running) return;
    await Promise.race([
      running.catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, waitMs)),
    ]);
  }

  return {
    start,
    shutdown,
    tick,
    get locked() {
      return locked;
    },
    get shutdownRequested() {
      return shutdownRequested;
    },
  };
}

function sanitizeMarkerKey(key) {
  return String(key || "default").replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function preMigrationMarkerPath(dbPath, markerKey) {
  return `${dbPath}.marker.${sanitizeMarkerKey(markerKey)}`;
}

export function dbHasMeaningfulData(dbPath) {
  if (!dbPath || !fs.existsSync(dbPath) || fs.statSync(dbPath).size <= 0) return false;
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    for (const table of CRITICAL_COUNT_TABLES) {
      if (!tableExists(db, table)) continue;
      const c = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get()?.c ?? 0;
      if (c > 0) return true;
    }
    // Any user table with rows counts as data
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all();
    for (const { name } of tables) {
      const c = db.prepare(`SELECT COUNT(*) AS c FROM ${quoteSqlIdent(name)}`).get()?.c ?? 0;
      if (c > 0) return true;
    }
    return false;
  } catch {
    // Unreadable but non-empty file — treat as having data so we still require backup
    return fs.statSync(dbPath).size > 100;
  } finally {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
  }
}

function quoteSqlIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

/**
 * Create a verified pre-migration backup once per marker key.
 * Fails closed with PRE_MIGRATION_BACKUP_REQUIRED if backup cannot be verified.
 */
export function ensurePreMigrationBackup(dbPath, markerKey, options = {}) {
  const key = markerKey || "preMigrationBackup.schema.v1";
  const marker = preMigrationMarkerPath(dbPath, key);
  if (fs.existsSync(marker)) {
    return { ok: true, skipped: true, reason: "marker" };
  }
  if (!dbPath || !fs.existsSync(dbPath) || fs.statSync(dbPath).size <= 0) {
    return { ok: true, skipped: true, reason: "no-db" };
  }
  if (!dbHasMeaningfulData(dbPath)) {
    fs.writeFileSync(marker, JSON.stringify({ at: new Date().toISOString(), skipped: "empty" }), "utf8");
    return { ok: true, skipped: true, reason: "empty" };
  }

  const destDir =
    options.backupDir ||
    path.join(path.dirname(dbPath), "pre-migration-backups");
  fs.mkdirSync(destDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dest = path.join(destDir, `daogreen_pre_${sanitizeMarkerKey(key)}_${stamp}.db`);

  try {
    const started = Date.now();
    console.log(
      `DB backup: pre-migration start reason=${key} file=${path.basename(dbPath)}`
    );
    const result = createAndVerifySqliteBackup(dbPath, dest, options);
    fs.writeFileSync(
      marker,
      JSON.stringify({
        at: new Date().toISOString(),
        backup: path.basename(dest),
        reason: key,
      }),
      "utf8"
    );
    console.log(
      `DB backup: pre-migration ok reason=${key} file=${path.basename(dest)} ` +
        `counts=${JSON.stringify(result.counts || result.verification?.counts || {})} ` +
        `durationMs=${result.durationMs ?? Date.now() - started}`
    );
    return { ok: true, path: dest, marker, result };
  } catch (err) {
    console.warn(
      `DB backup: pre-migration failed reason=${key} code=${err.code || "BACKUP_FAILED"} msg=${err.message}`
    );
    throw backupError(
      PRE_MIGRATION_BACKUP_REQUIRED,
      `pre-migration backup required but failed: ${err.message}`
    );
  }
}
