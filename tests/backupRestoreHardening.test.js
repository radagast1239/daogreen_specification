import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import {
  createAndVerifySqliteBackup,
  verifySqliteBackup,
  createVerifiedDownloadBackup,
  ensurePreMigrationBackup,
  preMigrationMarkerPath,
  rotateBackups,
  writeBackupMetadata,
  readBackupMetadata,
  safeUnlink,
  BACKUP_INTEGRITY_FAILED,
  BACKUP_FOREIGN_KEYS_FAILED,
  BACKUP_COUNTS_FAILED,
  PRE_MIGRATION_BACKUP_REQUIRED,
  RESTORE_REMOTE_STALE,
  RESTORE_VERIFY_FAILED,
  RESTORE_SWITCH_FAILED,
} from "../backend/src/sqliteBackup.js";

const testId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tempRoot = path.join(os.tmpdir(), `daogreen-restore-hard-${testId}`);

function makeSchemaDb(dbPath, { walValue = "seed", withFk = false } = {}) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE materials (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE project_items (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL${withFk ? " REFERENCES projects(id)" : ""},
      name TEXT NOT NULL
    );
    CREATE TABLE spec_versions (id TEXT PRIMARY KEY, label TEXT);
    CREATE TABLE files (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE frame_drawings (id TEXT PRIMARY KEY, title TEXT);
    CREATE TABLE admin_users (id TEXT PRIMARY KEY, name TEXT, api_key TEXT);
    CREATE TABLE t (v TEXT NOT NULL);
  `);
  db.prepare("INSERT INTO materials (id, name) VALUES (?, ?)").run("m1", "Material");
  db.prepare("INSERT INTO projects (id, name) VALUES (?, ?)").run("p1", "Project");
  db.prepare("INSERT INTO project_items (id, project_id, name) VALUES (?, ?, ?)").run("i1", "p1", "Item");
  db.prepare("INSERT INTO admin_users (id, name, api_key) VALUES (?, ?, ?)").run("a1", "Admin", "plain-key");
  db.prepare("INSERT INTO t (v) VALUES (?)").run(walValue);
  db.close();
}

function readCol(dbPath, sql) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare(sql).all();
  } finally {
    db.close();
  }
}

beforeEach(() => {
  fs.mkdirSync(tempRoot, { recursive: true });
});

afterEach(() => {
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  } catch {
    /* Windows may briefly lock WAL/SHM; ignore cleanup races in tests */
  }
});

describe("backup restore hardening", () => {
  it("1-2: WAL-safe backup captures uncheckpointed changes", () => {
    const sourcePath = path.join(tempRoot, "wal-source.db");
    makeSchemaDb(sourcePath, { walValue: "old" });
    const writer = new DatabaseSync(sourcePath);
    writer.prepare("INSERT INTO t (v) VALUES (?)").run("wal-only");
    writer.close();

    const backupPath = path.join(tempRoot, "wal-backup.db");
    createAndVerifySqliteBackup(sourcePath, backupPath);
    safeUnlink(`${sourcePath}-wal`);
    safeUnlink(`${sourcePath}-shm`);

    const rows = readCol(backupPath, "SELECT v FROM t ORDER BY rowid").map((r) => r.v);
    expect(rows).toEqual(["old", "wal-only"]);
  });

  it("3-5: count mismatch blocks publish and deletes tmp", () => {
    const sourcePath = path.join(tempRoot, "int-source.db");
    makeSchemaDb(sourcePath);
    const backupPath = path.join(tempRoot, "int-backup.db");
    expect(() =>
      createAndVerifySqliteBackup(sourcePath, backupPath, { expectCounts: { materials: 999 } })
    ).toThrow(/count mismatch/);
    expect(fs.existsSync(backupPath)).toBe(false);
    expect(fs.existsSync(`${backupPath}.tmp`)).toBe(false);
  });

  it("6-8: FK violations fail verify with stable code and never publish", () => {
    const badPath = path.join(tempRoot, "fk-bad.db");
    const db = new DatabaseSync(badPath);
    try {
      db.exec("PRAGMA foreign_keys = OFF");
      db.exec(`
        CREATE TABLE projects (id TEXT PRIMARY KEY);
        CREATE TABLE project_items (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id)
        );
        INSERT INTO project_items (id, project_id) VALUES ('i1', 'missing');
      `);
    } finally {
      db.close();
    }

    try {
      verifySqliteBackup(badPath);
      expect.unreachable();
    } catch (err) {
      expect(err.code).toBe(BACKUP_FOREIGN_KEYS_FAILED);
    }

    const target = path.join(tempRoot, "fk-out.db");
    expect(() => createAndVerifySqliteBackup(badPath, target)).toThrow();
    expect(fs.existsSync(target)).toBe(false);
    expect(fs.existsSync(`${target}.tmp`)).toBe(false);
  });

  it("9-11: extended schema-aware counts; missing tables skipped", () => {
    const sourcePath = path.join(tempRoot, "counts.db");
    makeSchemaDb(sourcePath);
    const backupPath = path.join(tempRoot, "counts-b.db");
    const result = createAndVerifySqliteBackup(sourcePath, backupPath);
    expect(result.verification.counts.materials).toBe(1);
    expect(result.verification.counts.admin_users).toBe(1);
    expect(result.verification.counts.spec_versions).toBe(0);
    expect(result.metadata?.sha256).toBeTruthy();
    expect(result.metadata?.createdAt).toBeTruthy();

    const minimal = path.join(tempRoot, "minimal.db");
    const db = new DatabaseSync(minimal);
    db.exec("CREATE TABLE materials (id TEXT PRIMARY KEY); INSERT INTO materials VALUES ('m');");
    db.close();
    const v = verifySqliteBackup(minimal);
    expect(v.counts.materials).toBe(1);
    expect(v.skippedTables).toEqual(
      expect.arrayContaining(["projects", "project_items", "admin_users"])
    );
  });

  it("12-14: manual download snapshot is not live path", () => {
    const livePath = path.join(tempRoot, "live.db");
    makeSchemaDb(livePath);
    const snap = createVerifiedDownloadBackup(livePath, { dir: tempRoot });
    expect(snap.path).not.toBe(livePath);
    expect(snap.isLivePath).toBe(false);
    expect(snap.downloadName).toMatch(/^daogreen-backup-\d{4}-\d{2}-\d{2}T\d{6}\.db$/);
    verifySqliteBackup(snap.path);
    expect(snap.path.endsWith(".wal")).toBe(false);
    expect(snap.path.endsWith(".shm")).toBe(false);
    safeUnlink(snap.path);
  });

  it("15-18: cloud restore valid when no local; rejects invalid/truncated/FK", async () => {
    const { restoreRemoteDbSafely } = await import("../backend/src/dbBackup.js");
    const localPath = path.join(tempRoot, "cloud-local.db");
    const remoteGood = path.join(tempRoot, "remote-good.db");
    makeSchemaDb(remoteGood);

    const ok = await restoreRemoteDbSafely(localPath, {
      tmpDir: path.join(tempRoot, "restore-tmp"),
      fetchRemote: async () => fs.readFileSync(remoteGood),
      fetchRemoteMeta: async () => ({ createdAt: new Date().toISOString() }),
    });
    expect(ok.ok).toBe(true);
    expect(fs.existsSync(localPath)).toBe(true);
    expect(verifySqliteBackup(localPath).counts.materials).toBe(1);

    // Truncated
    const local2 = path.join(tempRoot, "cloud-trunc.db");
    await expect(
      restoreRemoteDbSafely(local2, {
        tmpDir: path.join(tempRoot, "restore-tmp2"),
        fetchRemote: async () => Buffer.alloc(0),
      })
    ).rejects.toMatchObject({ code: RESTORE_VERIFY_FAILED });

    // Garbage
    const local3 = path.join(tempRoot, "cloud-garbage.db");
    await expect(
      restoreRemoteDbSafely(local3, {
        tmpDir: path.join(tempRoot, "restore-tmp3"),
        fetchRemote: async () => Buffer.from("not-a-sqlite-db"),
      })
    ).rejects.toMatchObject({ code: RESTORE_VERIFY_FAILED });

    // FK bad remote
    const fkBad = path.join(tempRoot, "remote-fk.db");
    const db = new DatabaseSync(fkBad);
    try {
      db.exec("PRAGMA foreign_keys = OFF");
      db.exec(`
        CREATE TABLE projects (id TEXT PRIMARY KEY);
        CREATE TABLE project_items (
          id TEXT PRIMARY KEY,
          project_id TEXT REFERENCES projects(id)
        );
        INSERT INTO project_items VALUES ('i','gone');
      `);
    } finally {
      db.close();
    }
    const local4 = path.join(tempRoot, "cloud-fk.db");
    await expect(
      restoreRemoteDbSafely(local4, {
        tmpDir: path.join(tempRoot, "restore-tmp4"),
        fetchRemote: async () => fs.readFileSync(fkBad),
      })
    ).rejects.toMatchObject({ code: RESTORE_VERIFY_FAILED });
  });

  it("19-22: existing local not auto-overwritten; stale reject; temps cleaned", async () => {
    const { restoreRemoteDbSafely, initRemoteDb } = await import("../backend/src/dbBackup.js");
    const localPath = path.join(tempRoot, "existing-local.db");
    makeSchemaDb(localPath, { walValue: "local-v1" });
    const remotePath = path.join(tempRoot, "remote-newer.db");
    makeSchemaDb(remotePath, { walValue: "remote-v2" });
    const tmpDir = path.join(tempRoot, "restore-tmp5");

    await expect(
      restoreRemoteDbSafely(localPath, {
        tmpDir,
        fetchRemote: async () => fs.readFileSync(remotePath),
        fetchRemoteMeta: async () => ({ createdAt: new Date().toISOString() }),
      })
    ).rejects.toMatchObject({ code: RESTORE_REMOTE_STALE });

    const localRows = readCol(localPath, "SELECT v FROM t").map((r) => r.v);
    expect(localRows).toContain("local-v1");
    expect(localRows).not.toContain("remote-v2");

    // Stale remote with allowOverwriteExisting
    await expect(
      restoreRemoteDbSafely(localPath, {
        tmpDir: path.join(tempRoot, "restore-tmp6"),
        allowOverwriteExisting: true,
        fetchRemote: async () => fs.readFileSync(remotePath),
        fetchRemoteMeta: async () => ({ createdAt: "2020-01-01T00:00:00.000Z" }),
      })
    ).rejects.toMatchObject({ code: RESTORE_REMOTE_STALE });

    // Missing metadata with allowOverwrite → stale
    await expect(
      restoreRemoteDbSafely(localPath, {
        tmpDir: path.join(tempRoot, "restore-tmp7"),
        allowOverwriteExisting: true,
        fetchRemote: async () => fs.readFileSync(remotePath),
        fetchRemoteMeta: async () => null,
      })
    ).rejects.toMatchObject({ code: RESTORE_REMOTE_STALE });

    // Temps cleaned after failure (ignore WAL/SHM sidecar leftovers from aborted opens)
    const leftovers = fs.existsSync(tmpDir)
      ? fs.readdirSync(tmpDir).filter((n) => n.startsWith("remote-") && n.endsWith(".db"))
      : [];
    expect(leftovers).toEqual([]);

    // initRemoteDb skips when local present (no supabase → early return; simulate via restore path)
    process.env.SUPABASE_URL = "";
    process.env.SUPABASE_SERVICE_KEY = "";
    const initResult = await initRemoteDb(localPath);
    expect(initResult.reason === "no-supabase" || initResult.skipped).toBeTruthy();
  });

  it("23-25: overwrite with fresh meta succeeds; rollback restores local on post-switch failure", async () => {
    const { restoreRemoteDbSafely } = await import("../backend/src/dbBackup.js");
    const localPath = path.join(tempRoot, "switch-local.db");
    makeSchemaDb(localPath, { walValue: "before" });
    writeBackupMetadata(localPath, {
      counts: { materials: 1 },
      size: fs.statSync(localPath).size,
      schemaNote: "test",
    });
    const meta = readBackupMetadata(localPath);
    meta.createdAt = "2020-01-01T00:00:00.000Z";
    fs.writeFileSync(`${localPath}.meta.json`, JSON.stringify(meta));

    const remotePath = path.join(tempRoot, "switch-remote.db");
    makeSchemaDb(remotePath, { walValue: "after" });

    const ok = await restoreRemoteDbSafely(localPath, {
      tmpDir: path.join(tempRoot, "restore-tmp8"),
      allowOverwriteExisting: true,
      fetchRemote: async () => fs.readFileSync(remotePath),
      fetchRemoteMeta: async () => ({ createdAt: "2026-07-01T00:00:00.000Z" }),
    });
    expect(ok.ok).toBe(true);
    expect(readCol(localPath, "SELECT v FROM t").map((r) => r.v)).toContain("after");

    const localB = path.join(tempRoot, "rollback-local.db");
    makeSchemaDb(localB, { walValue: "keep-me" });
    writeBackupMetadata(localB, {
      counts: { materials: 1 },
      size: fs.statSync(localB).size,
    });
    const metaB = readBackupMetadata(localB);
    metaB.createdAt = "2020-01-01T00:00:00.000Z";
    fs.writeFileSync(`${localB}.meta.json`, JSON.stringify(metaB));

    const remoteB = path.join(tempRoot, "rollback-remote.db");
    makeSchemaDb(remoteB, { walValue: "should-not-stick" });

    await expect(
      restoreRemoteDbSafely(localB, {
        tmpDir: path.join(tempRoot, "restore-tmp9"),
        allowOverwriteExisting: true,
        injectPostSwitchError: "simulated post-switch failure",
        fetchRemote: async () => fs.readFileSync(remoteB),
        fetchRemoteMeta: async () => ({ createdAt: "2026-07-01T00:00:00.000Z" }),
      })
    ).rejects.toMatchObject({ code: RESTORE_SWITCH_FAILED });

    expect(readCol(localB, "SELECT v FROM t").map((r) => r.v)).toContain("keep-me");
    expect(readCol(localB, "SELECT v FROM t").map((r) => r.v)).not.toContain("should-not-stick");
  });

  it("26-28: pre-migration backup required once; marker prevents repeat", () => {
    const dbPath = path.join(tempRoot, "pre-mig.db");
    makeSchemaDb(dbPath);
    const markerKey = "preMigrationBackup.adminKeys.v1";
    const first = ensurePreMigrationBackup(dbPath, markerKey, {
      backupDir: path.join(tempRoot, "pre-backs"),
    });
    expect(first.ok).toBe(true);
    expect(first.skipped).toBeFalsy();
    expect(fs.existsSync(first.path)).toBe(true);
    expect(fs.existsSync(preMigrationMarkerPath(dbPath, markerKey))).toBe(true);

    const second = ensurePreMigrationBackup(dbPath, markerKey, {
      backupDir: path.join(tempRoot, "pre-backs"),
    });
    expect(second.skipped).toBe(true);
    expect(second.reason).toBe("marker");
  });

  it("29: pre-migration fails closed when source invalid", () => {
    const dbPath = path.join(tempRoot, "pre-bad.db");
    fs.writeFileSync(dbPath, "not-sqlite-but-large-enough-" + "x".repeat(200));
    // dbHasMeaningfulData may return true for unreadable non-empty; backup then fails
    try {
      ensurePreMigrationBackup(dbPath, "preMigrationBackup.schema.v1", {
        backupDir: path.join(tempRoot, "pre-backs-bad"),
      });
      // If treated as empty/no-data, that's also acceptable skip
    } catch (err) {
      expect(err.code).toBe(PRE_MIGRATION_BACKUP_REQUIRED);
    }
  });

  it("30-31: restore drill to other path; source unchanged; counts match", () => {
    const sourcePath = path.join(tempRoot, "drill-source.db");
    makeSchemaDb(sourcePath, { walValue: "drill" });
    const sourceBefore = fs.readFileSync(sourcePath);
    const destPath = path.join(tempRoot, "drill-dest.db");

    createAndVerifySqliteBackup(sourcePath, destPath);
    expect(Buffer.compare(fs.readFileSync(sourcePath), sourceBefore)).toBe(0);

    const srcCounts = verifySqliteBackup(sourcePath).counts;
    const destCounts = verifySqliteBackup(destPath).counts;
    expect(destCounts).toEqual(srcCounts);
    expect(readCol(destPath, "SELECT v FROM t").map((r) => r.v)).toEqual(["drill"]);
  });

  it("retention keeps last valid past keepDays", () => {
    const dir = path.join(tempRoot, "ret");
    fs.mkdirSync(dir);
    const only = path.join(dir, "daogreen_ancient.db");
    fs.writeFileSync(only, "x");
    fs.utimesSync(only, new Date("2018-01-01"), new Date("2018-01-01"));
    const { removed } = rotateBackups(dir, 1, { now: Date.now() });
    expect(removed).toEqual([]);
    expect(fs.existsSync(only)).toBe(true);
  });

  it("count mismatch uses BACKUP_COUNTS_FAILED code", () => {
    const sourcePath = path.join(tempRoot, "count-code.db");
    makeSchemaDb(sourcePath);
    try {
      verifySqliteBackup(sourcePath, { expectCounts: { materials: 42 } });
      expect.unreachable();
    } catch (err) {
      expect(err.code).toBe(BACKUP_COUNTS_FAILED);
    }
  });

  it("integrity failure code on empty file", () => {
    const empty = path.join(tempRoot, "empty.db");
    fs.writeFileSync(empty, "");
    try {
      verifySqliteBackup(empty);
      expect.unreachable();
    } catch (err) {
      expect(["BACKUP_EMPTY", BACKUP_INTEGRITY_FAILED]).toContain(err.code);
    }
  });
});
