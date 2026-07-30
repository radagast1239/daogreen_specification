/**
 * Опциональная синхронизация файла SQLite с Supabase Storage (бесплатный тариф).
 * Нужно для Render Free: без диска база сбрасывается при редеплое.
 *
 * Переменные:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY, DB_BACKUP_BUCKET (default: daogreen-db)
 *
 * Restore is fail-closed: never silently overwrite an existing local DB.
 * Downloads land on a temp path, pass integrity+FK+counts, then atomic switch
 * with rollback. Stale/unknown remote freshness refuses overwrite.
 */
import fs from "fs";
import path from "path";
import os from "os";
import {
  createAndVerifySqliteBackup,
  createBackupScheduler,
  rotateBackups,
  verifySqliteBackup,
  readBackupMetadata,
  writeBackupMetadata,
  metadataSidecarPath,
  safeUnlink,
  backupError,
  RESTORE_REMOTE_STALE,
  RESTORE_VERIFY_FAILED,
  RESTORE_SWITCH_FAILED,
} from "./sqliteBackup.js";

const BUCKET = process.env.DB_BACKUP_BUCKET || "daogreen-db";
const REMOTE_FILE = "daogreen.db";
const REMOTE_META = "daogreen.db.meta.json";
const LOCAL_BACKUP_DIR =
  process.env.LOCAL_BACKUP_DIR ||
  (process.platform === "win32" ? null : "/opt/backups/daogreen");
const LOCAL_BACKUP_KEEP_DAYS = Number(process.env.LOCAL_BACKUP_KEEP_DAYS) || 14;
const LOCAL_BACKUP_TIMEOUT_MS = Number(process.env.LOCAL_BACKUP_TIMEOUT_MS) || 120_000;
const SHUTDOWN_BACKUP_WAIT_MS = Number(process.env.SHUTDOWN_BACKUP_WAIT_MS) || 8000;

function supabaseCfg() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return { url, key };
}

function localDbExists(localPath) {
  try {
    return !!(localPath && fs.existsSync(localPath) && fs.statSync(localPath).size > 0);
  } catch {
    return false;
  }
}

export function hasLocalBackupDir() {
  if (!LOCAL_BACKUP_DIR) return false;
  try {
    if (!fs.existsSync(LOCAL_BACKUP_DIR)) return false;
    return fs.readdirSync(LOCAL_BACKUP_DIR).some((f) => f.endsWith(".db") && !f.endsWith(".tmp"));
  } catch {
    return false;
  }
}

function buildLocalBackupPath() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return path.join(LOCAL_BACKUP_DIR, `daogreen_${stamp}.db`);
}

export function createLocalBackup(localPath, options = {}) {
  if (!LOCAL_BACKUP_DIR) {
    return { ok: false, reason: "LOCAL_BACKUP_DIR not configured" };
  }
  if (!localPath || !fs.existsSync(localPath)) {
    return { ok: false, reason: "source DB missing" };
  }

  const dest = options.targetPath || buildLocalBackupPath();
  const started = Date.now();
  console.log(`DB backup: scheduled start file=${path.basename(localPath)}`);

  try {
    const result = createAndVerifySqliteBackup(localPath, dest, {
      timeoutMs: options.timeoutMs ?? LOCAL_BACKUP_TIMEOUT_MS,
      expectCounts: options.expectCounts,
    });

    const finalize = (payload) => {
      rotateBackups(LOCAL_BACKUP_DIR, LOCAL_BACKUP_KEEP_DAYS);
      const log = {
        ok: true,
        type: "scheduled-local",
        path: dest,
        file: path.basename(dest),
        size: payload.size,
        durationMs: Date.now() - started,
        counts: payload.verification?.counts || payload.counts,
      };
      console.log(
        `DB backup: scheduled success ${JSON.stringify({
          ok: log.ok,
          type: log.type,
          file: log.file,
          size: log.size,
          durationMs: log.durationMs,
          counts: log.counts,
        })}`
      );
      return log;
    };

    if (result instanceof Promise) {
      return result.then(finalize).catch((err) => {
        console.warn(
          `DB backup: scheduled failure file=${path.basename(dest)} code=${err.code || "BACKUP_FAILED"} msg=${err.message}`
        );
        throw err;
      });
    }
    return finalize(result);
  } catch (err) {
    console.warn(
      `DB backup: scheduled failure file=${path.basename(dest)} code=${err.code || "BACKUP_FAILED"} msg=${err.message}`
    );
    throw err;
  }
}

/** @deprecated use createLocalBackup */
export function copyLocalBackup(localPath) {
  const result = createLocalBackup(localPath);
  if (result instanceof Promise) {
    return result.then((payload) => payload.ok).catch(() => false);
  }
  return result.ok;
}

export function startLocalBackupLoop(localPath, intervalMs = 60 * 60 * 1000) {
  if (!LOCAL_BACKUP_DIR) {
    console.log("DB backup: LOCAL_BACKUP_DIR не задан — только основной файл БД");
    return async () => {};
  }

  const scheduler = createBackupScheduler({
    intervalMs,
    runBackup: () => createLocalBackup(localPath),
  });

  const shutdown = async () => {
    await scheduler.shutdown({ waitMs: SHUTDOWN_BACKUP_WAIT_MS });
  };

  scheduler.start();
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  return shutdown;
}

export function backupStatus() {
  const cloud = !!supabaseCfg();
  const local = hasLocalBackupDir();
  return { cloud, local, ok: cloud || local };
}

async function storage(pathname, { method = "GET", body, contentType } = {}) {
  const cfg = supabaseCfg();
  if (!cfg) return null;
  const endpoint = `${cfg.url}/storage/v1/object/${BUCKET}/${pathname}`;
  const res = await fetch(endpoint, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.key}`,
      apikey: cfg.key,
      ...(contentType ? { "Content-Type": contentType } : {}),
    },
    body,
  });
  return res;
}

export async function ensureBucket() {
  const cfg = supabaseCfg();
  if (!cfg) return false;
  const res = await fetch(`${cfg.url}/storage/v1/bucket`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.key}`,
      apikey: cfg.key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }),
  });
  if (res.ok || res.status === 409) return true;
  console.warn("Supabase bucket:", await res.text());
  return false;
}

/**
 * Compare remote vs local freshness using metadata sidecars when available.
 * Fail-closed: if local exists and remote freshness is unknown or older → stale.
 */
export function assertRemoteNotStale(localPath, remoteMeta, options = {}) {
  if (!localDbExists(localPath)) return { ok: true, reason: "no-local" };
  if (!remoteMeta || !remoteMeta.createdAt) {
    throw backupError(
      RESTORE_REMOTE_STALE,
      "remote metadata missing — refuse to overwrite existing local DB"
    );
  }
  const localMeta = options.localMeta ?? readBackupMetadata(localPath);
  const remoteCreated = Date.parse(remoteMeta.createdAt);
  if (!Number.isFinite(remoteCreated)) {
    throw backupError(RESTORE_REMOTE_STALE, "remote createdAt unparseable — refuse overwrite");
  }
  let localCreated = localMeta?.createdAt ? Date.parse(localMeta.createdAt) : NaN;
  if (!Number.isFinite(localCreated)) {
    try {
      localCreated = fs.statSync(localPath).mtimeMs;
    } catch {
      localCreated = Date.now();
    }
  }
  if (remoteCreated < localCreated) {
    throw backupError(
      RESTORE_REMOTE_STALE,
      "remote backup is older than local DB — refuse overwrite"
    );
  }
  return { ok: true, reason: "remote-fresh" };
}

/**
 * Safe cloud restore: download to temp → verify → optional stale check →
 * backup local to rollback → atomic rename → re-verify → rollback on failure.
 * Never writes remote bytes directly onto localPath.
 */
export async function restoreRemoteDbSafely(localPath, options = {}) {
  const started = Date.now();
  const tmpDir = options.tmpDir || path.join(os.tmpdir(), "daogreen-restore");
  fs.mkdirSync(tmpDir, { recursive: true });
  const stamp = Date.now();
  const remoteTmp = path.join(tmpDir, `remote-${stamp}.db`);
  const rollbackPath = path.join(tmpDir, `rollback-${stamp}.db`);
  const fetchRemote = options.fetchRemote;
  const fetchRemoteMeta = options.fetchRemoteMeta;

  const cleanupTemps = () => {
    safeUnlink(remoteTmp);
    safeUnlink(`${remoteTmp}-wal`);
    safeUnlink(`${remoteTmp}-shm`);
    safeUnlink(metadataSidecarPath(remoteTmp));
    if (!options.keepRollback) {
      safeUnlink(rollbackPath);
      safeUnlink(`${rollbackPath}-wal`);
      safeUnlink(`${rollbackPath}-shm`);
    }
    safeUnlink(metadataSidecarPath(rollbackPath));
  };

  try {
    console.log(`DB backup: restore start target=${path.basename(localPath)}`);

    let buf;
    let remoteMeta = null;
    if (typeof fetchRemote === "function") {
      buf = await fetchRemote();
      if (typeof fetchRemoteMeta === "function") {
        remoteMeta = await fetchRemoteMeta();
      }
    } else {
      const res = await storage(REMOTE_FILE);
      if (!res) return { ok: false, reason: "no-supabase" };
      if (res.status === 404) {
        console.log("DB backup: нет файла в облаке — будет создана новая база");
        return { ok: false, reason: "not-found" };
      }
      if (!res.ok) {
        console.warn("DB backup download failed:", res.status);
        return { ok: false, reason: "download-failed" };
      }
      buf = Buffer.from(await res.arrayBuffer());
      try {
        const metaRes = await storage(REMOTE_META);
        if (metaRes?.ok) {
          remoteMeta = JSON.parse(Buffer.from(await metaRes.arrayBuffer()).toString("utf8"));
        }
      } catch {
        remoteMeta = null;
      }
    }

    if (!buf || buf.length <= 0) {
      throw backupError(RESTORE_VERIFY_FAILED, "remote backup empty");
    }

    fs.writeFileSync(remoteTmp, buf);
    let verification;
    try {
      verification = verifySqliteBackup(remoteTmp, options.verifyOptions || {});
    } catch (err) {
      throw backupError(RESTORE_VERIFY_FAILED, err.message);
    }

    const localExists = localDbExists(localPath);
    if (localExists) {
      // Fail-closed: existing local is never auto-overwritten without fresh metadata.
      if (options.allowOverwriteExisting === true) {
        assertRemoteNotStale(localPath, remoteMeta, options);
      } else {
        throw backupError(
          RESTORE_REMOTE_STALE,
          "local DB exists — refuse silent remote overwrite"
        );
      }
    }

    fs.mkdirSync(path.dirname(localPath), { recursive: true });

    if (localExists) {
      try {
        createAndVerifySqliteBackup(localPath, rollbackPath, {
          writeMetadata: true,
          timeoutMs: LOCAL_BACKUP_TIMEOUT_MS,
        });
      } catch (err) {
        throw backupError(
          RESTORE_SWITCH_FAILED,
          `could not create rollback backup: ${err.message}`
        );
      }
      try {
        safeUnlink(localPath);
        safeUnlink(`${localPath}-wal`);
        safeUnlink(`${localPath}-shm`);
        fs.renameSync(remoteTmp, localPath);
      } catch (err) {
        // Rollback
        try {
          if (fs.existsSync(rollbackPath)) {
            safeUnlink(localPath);
            fs.copyFileSync(rollbackPath, localPath);
          }
        } catch {
          /* ignore */
        }
        throw backupError(RESTORE_SWITCH_FAILED, `atomic switch failed: ${err.message}`);
      }
    } else {
      fs.renameSync(remoteTmp, localPath);
    }

    try {
      if (typeof options.injectPostSwitchError === "string") {
        throw new Error(options.injectPostSwitchError);
      }
      verifySqliteBackup(localPath, options.verifyOptions || {});
      if (remoteMeta) {
        writeBackupMetadata(localPath, { ...verification, ...remoteMeta, size: verification.size });
      } else {
        writeBackupMetadata(localPath, verification);
      }
    } catch (err) {
      if (fs.existsSync(rollbackPath)) {
        safeUnlink(localPath);
        fs.copyFileSync(rollbackPath, localPath);
      }
      throw backupError(RESTORE_SWITCH_FAILED, `post-switch verify failed: ${err.message}`);
    }

    const log = {
      ok: true,
      type: "cloud-restore",
      file: path.basename(localPath),
      size: buf.length,
      counts: verification.counts,
      durationMs: Date.now() - started,
      hadLocal: localExists,
    };
    console.log(`DB backup: restore success ${JSON.stringify(log)}`);
    cleanupTemps();
    return log;
  } catch (err) {
    cleanupTemps();
    console.warn(
      `DB backup: restore failure file=${path.basename(localPath)} code=${err.code || "RESTORE_FAILED"} msg=${err.message}`
    );
    throw err;
  }
}

/**
 * @deprecated Prefer restoreRemoteDbSafely. Kept for callers; never writes onto existing local.
 */
export async function downloadDb(localPath) {
  if (localDbExists(localPath)) {
    console.log(
      `DB backup: local DB present (${path.basename(localPath)}) — skip remote download`
    );
    return false;
  }
  try {
    const result = await restoreRemoteDbSafely(localPath);
    return !!(result && result.ok);
  } catch (err) {
    console.warn(`DB backup download failed: ${err.code || ""} ${err.message}`);
    return false;
  }
}

export async function uploadDb(localPath) {
  const cfg = supabaseCfg();
  if (!cfg || !fs.existsSync(localPath)) return false;

  const tmpPath = path.join(path.dirname(localPath), `.upload-${Date.now()}.db`);
  const started = Date.now();
  try {
    console.log(`DB backup: upload start file=${path.basename(localPath)}`);
    const verified = createAndVerifySqliteBackup(localPath, tmpPath, {
      timeoutMs: LOCAL_BACKUP_TIMEOUT_MS,
    });
    const body = fs.readFileSync(tmpPath);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const archivePath = `backups/daogreen-${stamp}.db`;
    const metaBody = JSON.stringify(
      verified.metadata ||
        writeBackupMetadata(tmpPath, verified.verification || { counts: verified.counts, size: body.length }),
      null,
      2
    );

    async function put(pathname, payload, contentType) {
      let res = await storage(pathname, {
        method: "POST",
        body: payload,
        contentType,
      });
      if (!res.ok) {
        res = await storage(pathname, {
          method: "PUT",
          body: payload,
          contentType,
        });
      }
      return res.ok;
    }

    const archived = await put(archivePath, body, "application/x-sqlite3");
    const latest = await put(REMOTE_FILE, body, "application/x-sqlite3");
    if (!latest) {
      console.warn("DB backup upload failed for latest copy");
      return false;
    }
    await put(REMOTE_META, metaBody, "application/json");
    await put(`backups/daogreen-${stamp}.db.meta.json`, metaBody, "application/json");
    console.log(
      `DB backup: upload success bytes=${body.length} durationMs=${Date.now() - started}` +
        (archived ? ` archive=${archivePath}` : "")
    );
    return true;
  } catch (err) {
    console.warn(`DB backup upload failure code=${err.code || ""} msg=${err.message}`);
    return false;
  } finally {
    safeUnlink(tmpPath);
    safeUnlink(metadataSidecarPath(tmpPath));
  }
}

export function startDbBackupLoop(localPath, intervalMs = 60_000) {
  if (!supabaseCfg()) {
    console.log("DB backup: Supabase не настроен — данные только локально (на Render Free сбросятся при редеплое)");
    return async () => {};
  }

  const scheduler = createBackupScheduler({
    intervalMs,
    runBackup: () => uploadDb(localPath),
  });

  const shutdown = async () => {
    await scheduler.shutdown({ waitMs: SHUTDOWN_BACKUP_WAIT_MS });
  };

  scheduler.start();
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  return shutdown;
}

/**
 * On startup: restore from remote ONLY when local DB is absent.
 * Never silently overwrite an existing local file.
 * Runs before initDb (caller must not open the DB first).
 */
export async function initRemoteDb(localPath) {
  if (!supabaseCfg()) return { ok: false, reason: "no-supabase" };
  await ensureBucket();
  if (localDbExists(localPath)) {
    console.log(
      `DB backup: local DB present (${path.basename(localPath)}) — skip remote restore`
    );
    return { ok: true, skipped: true, reason: "local-present" };
  }
  try {
    return await restoreRemoteDbSafely(localPath);
  } catch (err) {
    console.warn(
      `DB backup: initRemoteDb failed code=${err.code || ""} msg=${err.message}`
    );
    return { ok: false, reason: err.code || "restore-failed" };
  }
}

export {
  createAndVerifySqliteBackup as createSqliteBackup,
  verifySqliteBackup,
  rotateBackups,
  createBackupScheduler,
  restoreRemoteDbSafely as restoreRemoteDb,
};
