import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";

export const DEFAULT_BACKUP_TIMEOUT_MS = 120_000;
export const VALID_BACKUP_NAME_RE = /^daogreen_.+\.db$/;

export function quoteSqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runWithTimeout(fn, timeoutMs) {
  if (!timeoutMs || timeoutMs <= 0) return fn();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`backup timeout after ${timeoutMs}ms`)), timeoutMs);
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
    throw new Error(`backup tmp was not created: ${tmpPath}`);
  }
  const size = fs.statSync(tmpPath).size;
  if (size <= 0) {
    throw new Error(`backup tmp is empty: ${tmpPath}`);
  }
  return size;
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
    throw new Error("sourcePath and targetPath are required");
  }
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`source DB not found: ${sourcePath}`);
  }
  const sourceStat = fs.statSync(sourcePath);
  if (!sourceStat.isFile() || sourceStat.size <= 0) {
    throw new Error(`source DB is empty or invalid: ${sourcePath}`);
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
      return runWithTimeout(execute, timeoutMs);
    }
    return execute();
  } catch (error) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      /* ignore cleanup errors */
    }
    throw error;
  }
}

export function verifySqliteBackup(backupPath, options = {}) {
  if (!backupPath || !fs.existsSync(backupPath)) {
    throw new Error(`backup not found: ${backupPath}`);
  }
  const size = fs.statSync(backupPath).size;
  if (size <= 0) {
    throw new Error(`backup is empty: ${backupPath}`);
  }

  const db = new DatabaseSync(backupPath, { readOnly: true });
  try {
    const integrity = db.prepare("PRAGMA integrity_check").get()?.integrity_check;
    if (integrity !== "ok") {
      throw new Error(`integrity_check failed: ${integrity}`);
    }

    const counts = {
      materials: db.prepare("SELECT COUNT(*) AS c FROM materials").get()?.c ?? 0,
      projects: db.prepare("SELECT COUNT(*) AS c FROM projects").get()?.c ?? 0,
      project_items: db.prepare("SELECT COUNT(*) AS c FROM project_items").get()?.c ?? 0,
    };

    const expectCounts = options.expectCounts || {};
    for (const [key, expected] of Object.entries(expectCounts)) {
      if (counts[key] !== expected) {
        throw new Error(`${key} count mismatch: expected ${expected}, got ${counts[key]}`);
      }
    }

    return { ok: true, integrity, counts, size };
  } finally {
    db.close();
  }
}

export function createAndVerifySqliteBackup(sourcePath, targetPath, options = {}) {
  const finalize = (created) => {
    try {
      verifySqliteBackup(created.tmpPath, options);
      const published = publishSqliteBackup(created.tmpPath, targetPath);
      return {
        ...published,
        durationMs: created.durationMs,
        verification: verifySqliteBackup(targetPath, options),
      };
    } catch (error) {
      try {
        if (fs.existsSync(created.tmpPath)) fs.unlinkSync(created.tmpPath);
      } catch {
        /* ignore cleanup errors */
      }
      throw error;
    }
  };

  const created = createSqliteBackup(sourcePath, targetPath, options);
  if (created instanceof Promise) {
    return created.then(finalize);
  }
  return finalize(created);
}

export function isValidBackupFilename(name) {
  return VALID_BACKUP_NAME_RE.test(name) && !name.includes(".tmp") && !name.includes(".INVALID");
}

export function rotateBackups(backupDir, keepDays = 14, options = {}) {
  if (!backupDir || !fs.existsSync(backupDir)) return { removed: [] };
  const now = options.now ?? Date.now();
  const cutoff = now - keepDays * 86400000;
  const removed = [];

  for (const name of fs.readdirSync(backupDir)) {
    if (!isValidBackupFilename(name)) continue;
    const fullPath = path.join(backupDir, name);
    try {
      const stat = fs.statSync(fullPath);
      if (!stat.isFile() || stat.size <= 0) continue;
      if (stat.mtimeMs >= cutoff) continue;
      fs.unlinkSync(fullPath);
      removed.push(fullPath);
    } catch {
      /* ignore single-file retention errors */
    }
  }

  return { removed };
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
      tick().catch((error) => console.warn("DB backup:", error.message));
    }
    intervalId = setInterval(() => {
      tick().catch((error) => console.warn("DB backup:", error.message));
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

  return { start, shutdown, tick, get locked() { return locked; }, get shutdownRequested() { return shutdownRequested; } };
}
