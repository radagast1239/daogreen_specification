import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { describe, expect, it } from "vitest";

const root = path.resolve(".");
const stepScript = path.join(root, "scripts/run-material-translations-deploy-step.mjs");
const dataFile = path.join(root, "backend/data/materialTranslations.en.json");

describe("material translations deploy step", () => {
  it("script and data file exist with 177 records", () => {
    expect(fs.existsSync(stepScript)).toBe(true);
    expect(fs.existsSync(dataFile)).toBe(true);
    const payload = JSON.parse(fs.readFileSync(dataFile, "utf8"));
    expect(payload.translations).toHaveLength(177);
  });

  it("vps-deploy-step12 uploads translation data and runs deploy step before start", () => {
    const src = fs.readFileSync(path.join(root, "scripts/vps-deploy-step12.mjs"), "utf8");
    expect(src).toContain("backend/data/materialTranslations.en.json");
    expect(src).toContain("run-material-translations-deploy-step.mjs");
    expect(src).toContain("systemctl stop daogreen-spec");
    expect(src.indexOf("run-material-translations-deploy-step")).toBeLessThan(
      src.indexOf("systemctl start daogreen-spec"),
    );
  });

  it("dry-run-only exits 0 against rehearsal DB when available", () => {
    const rehearsal = path.join(
      os.tmpdir(),
      "dg-tr-review-rehearsal-20260729",
      "data",
      "daogreen.db",
    );
    if (!fs.existsSync(rehearsal)) {
      expect(true).toBe(true);
      return;
    }
    const r = spawnSync(process.execPath, [stepScript, "--dry-run-only"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, DATABASE_PATH: rehearsal },
    });
    expect(r.status, r.stderr || r.stdout).toBe(0);
  });
});
