import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import {
  createSqliteBackup,
  createAndVerifySqliteBackup,
  verifySqliteBackup,
  publishSqliteBackup,
  rotateBackups,
  createBackupScheduler,
  isValidBackupFilename,
} from "../backend/src/sqliteBackup.js";

function safeUnlink(filePath) {
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

const testId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tempRoot = path.join(os.tmpdir(), `daogreen-dbbackup-${testId}`);

function makeDb(dbPath, { walValue = "old" } = {}) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec(`
    CREATE TABLE materials (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE project_items (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL);
    CREATE TABLE t (v TEXT NOT NULL);
  `);
  db.prepare("INSERT INTO materials (id, name) VALUES (?, ?)").run("m1", "Material");
  db.prepare("INSERT INTO projects (id, name) VALUES (?, ?)").run("p1", "Project");
  db.prepare("INSERT INTO project_items (id, project_id, name) VALUES (?, ?, ?)").run("i1", "p1", "Item");
  db.prepare("INSERT INTO t (v) VALUES (?)").run(walValue);
  db.close();
}

beforeEach(() => {
  fs.mkdirSync(tempRoot, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("sqliteBackup", () => {
  it("captures uncheckpointed WAL changes in standalone backup", () => {
    const sourcePath = path.join(tempRoot, "source.db");
    makeDb(sourcePath, { walValue: "old" });

    const writer = new DatabaseSync(sourcePath);
    writer.prepare("INSERT INTO t (v) VALUES (?)").run("wal-only");
    writer.close();

    const backupPath = path.join(tempRoot, "backup.db");
    createAndVerifySqliteBackup(sourcePath, backupPath, {
      expectCounts: { materials: 1, projects: 1, project_items: 1 },
    });

    safeUnlink(`${sourcePath}-wal`);
    safeUnlink(`${sourcePath}-shm`);

    const backup = new DatabaseSync(backupPath, { readOnly: true });
    const rows = backup.prepare("SELECT v FROM t ORDER BY rowid").all().map((r) => r.v);
    backup.close();
    expect(rows).toEqual(["old", "wal-only"]);
  });

  it("preserves materials/projects/project_items counts", () => {
    const sourcePath = path.join(tempRoot, "counts.db");
    makeDb(sourcePath);
    const backupPath = path.join(tempRoot, "counts-backup.db");
    createAndVerifySqliteBackup(sourcePath, backupPath, {
      expectCounts: { materials: 1, projects: 1, project_items: 1 },
    });
    const verification = verifySqliteBackup(backupPath, {
      expectCounts: { materials: 1, projects: 1, project_items: 1 },
    });
    expect(verification.integrity).toBe("ok");
  });

  it("does not publish backup when verification fails", () => {
    const sourcePath = path.join(tempRoot, "fail-source.db");
    makeDb(sourcePath);
    const backupPath = path.join(tempRoot, "fail-backup.db");
    const previousPath = path.join(tempRoot, "previous-backup.db");
    createAndVerifySqliteBackup(sourcePath, previousPath);

    expect(() =>
      createAndVerifySqliteBackup(sourcePath, backupPath, { expectCounts: { materials: 999 } })
    ).toThrow(/materials count mismatch/);

    expect(fs.existsSync(backupPath)).toBe(false);
    expect(fs.existsSync(`${backupPath}.tmp`)).toBe(false);
    expect(fs.existsSync(previousPath)).toBe(true);
  });

  it("serializes parallel backup attempts via scheduler lock", async () => {
    let active = 0;
    let maxActive = 0;
    const scheduler = createBackupScheduler({
      intervalMs: 60_000,
      runOnStart: false,
      runBackup: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
        return { ok: true };
      },
    });

    const [a, b] = await Promise.all([scheduler.tick(), scheduler.tick()]);
    expect(maxActive).toBe(1);
    expect(a.ok || a.skipped).toBeTruthy();
    expect(b.ok || b.skipped).toBeTruthy();
  });

  it("rejects missing or empty source DB immediately", () => {
    expect(() =>
      createSqliteBackup(path.join(tempRoot, "missing.db"), path.join(tempRoot, "out.db"))
    ).toThrow(/not found/);

    const emptyPath = path.join(tempRoot, "empty.db");
    fs.writeFileSync(emptyPath, "");
    expect(() => createSqliteBackup(emptyPath, path.join(tempRoot, "empty-out.db"))).toThrow(/empty/);
  });

  it("shutdown waits for running backup but does not start a new one", async () => {
    let started = 0;
    const scheduler = createBackupScheduler({
      intervalMs: 60_000,
      runOnStart: false,
      runBackup: async () => {
        started += 1;
        await new Promise((resolve) => setTimeout(resolve, 30));
        return { ok: true };
      },
    });

    const running = scheduler.tick();
    await scheduler.shutdown({ waitMs: 100 });
    const afterStop = await scheduler.tick();
    await running;

    expect(started).toBe(1);
    expect(afterStop.skipped).toBe(true);
    expect(afterStop.reason).toBe("shutdown");
  });

  it("retention removes only valid old backups and keeps latest valid file", () => {
    const dir = path.join(tempRoot, "retention");
    fs.mkdirSync(dir, { recursive: true });
    const oldValid = path.join(dir, "daogreen_old.db");
    const latestValid = path.join(dir, "daogreen_new.db");
    fs.writeFileSync(oldValid, "valid-old");
    fs.writeFileSync(latestValid, "valid-new");
    fs.writeFileSync(path.join(dir, "daogreen_bad.tmp"), "tmp");
    fs.writeFileSync(path.join(dir, "daogreen_zero.db"), "");
    fs.utimesSync(oldValid, new Date("2020-01-01"), new Date("2020-01-01"));

    const { removed } = rotateBackups(dir, 14, { now: Date.now() });
    expect(removed).toEqual([oldValid]);
    expect(fs.existsSync(latestValid)).toBe(true);
    expect(fs.existsSync(path.join(dir, "daogreen_bad.tmp"))).toBe(true);
    expect(isValidBackupFilename("daogreen_2026.db")).toBe(true);
    expect(isValidBackupFilename("daogreen_2026.db.tmp")).toBe(false);
  });
});

describe("dbBackup local integration", () => {
  it("createLocalBackup writes verified standalone backup", async () => {
    const backupDir = path.join(tempRoot, "backups");
    const sourcePath = path.join(tempRoot, "live.db");
    makeDb(sourcePath, { walValue: "live" });

    process.env.LOCAL_BACKUP_DIR = backupDir;
    vi.resetModules();
    const { createLocalBackup } = await import("../backend/src/dbBackup.js");

    const result = createLocalBackup(sourcePath);
    const payload = result instanceof Promise ? await result : result;
    expect(payload.ok).toBe(true);
    expect(fs.existsSync(payload.path)).toBe(true);

    safeUnlink(`${sourcePath}-wal`);
    safeUnlink(`${sourcePath}-shm`);
    verifySqliteBackup(payload.path, {
      expectCounts: { materials: 1, projects: 1, project_items: 1 },
    });
  });
});
