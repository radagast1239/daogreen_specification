/**
 * PHASE 2F1 — the real-mouse fixture set, as permanent tests.
 *
 * The user's video established that CONSTRUCTION PATH matters: walls made by
 * helper commands could be dragged through other walls, while a wall drawn by
 * hand clipped at the first host. This file guards the invariant that keeps
 * that distinction meaningful: the real-mouse harness builds geometry with
 * pointer input only — no commitDrawnWall, no wallCommands, no plan writes.
 *
 * Self-contained: it reads only repository sources, so it asserts everywhere.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUILD_SCRIPT = path.join(REPO, "scripts", "run-planner-phase2f1-real-mouse-build.mjs");
const MOUSE_LIB = path.join(REPO, "scripts", "lib", "phase2f1RealMouse.mjs");

/**
 * Comments explain WHY these scripts avoid the helper commands, so they name
 * them. The guard must look at executable code only.
 */
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("PHASE 2F1 — fixtures are built by real pointer input", () => {
  const buildSrc = fs.readFileSync(BUILD_SCRIPT, "utf8");
  const libSrc = fs.readFileSync(MOUSE_LIB, "utf8");
  const combined = `${buildSrc}\n${libSrc}`;

  it("1. the constructor drives real mouse and keyboard events", () => {
    for (const gesture of ["mouse.down(", "mouse.move(", "mouse.up(", "mouse.wheel("]) {
      expect(combined, `missing real gesture ${gesture}`).toContain(gesture);
    }
    // Tool selection goes through the visible buttons.
    expect(libSrc).toContain('getByRole("button"');
  });

  it("2. the constructor never mutates the plan directly", () => {
    const code = stripComments(`${buildSrc}\n${libSrc}`);
    const buildCode = stripComments(buildSrc);
    const forbidden = [
      "commitDrawnWall",
      "commitDrawnWallLegacy",
      "commitWallThroughCanonicalDrawPath",
      "wallCommands",
      "moveWallSegment",
      "moveLogicalWallChain",
      "e2eMoveWallSegment",
      "e2eMoveLogicalWallChain",
      "e2eMoveWallNode",
      "setPlan",
      "replacePlan",
    ];
    for (const token of forbidden) {
      expect(code, `constructor must not call ${token}`).not.toContain(token);
    }
    // The only project write is creating an EMPTY project; no plan payload.
    expect(buildCode).not.toMatch(/method:\s*["']PUT["']/);
    expect(buildCode).not.toMatch(/body:\s*JSON\.stringify\(\{[^}]*walls/);
  });

  it("the acceptance script also avoids plan-mutation hooks", () => {
    const acceptance = fs.readFileSync(
      path.join(REPO, "scripts", "run-planner-phase2f1-real-mouse-acceptance.mjs"), "utf8",
    );
    const acceptanceCode = stripComments(acceptance);
    for (const token of ["e2eMoveWallSegment", "e2eMoveLogicalWallChain", "e2eMoveWallNode", "setPlan"]) {
      expect(acceptanceCode, `acceptance must not use ${token}`).not.toContain(token);
    }
    expect(acceptance).toContain("mouse.down(");
  });
});

// The second describe block ("what the real mouse produced") was removed here.
// Every one of its cases read scheme-manifest/final-topology/acceptance JSON
// from C:/tmp/phase2f1-real-mouse-fixtures and began with `if (!have) return;`,
// so on any machine without that build artefact it reported PASS while
// asserting nothing. Those contracts belong to the live real-mouse acceptance
// run (scripts/run-planner-phase2f1-real-mouse-acceptance.mjs) and to the final
// mega-test, not to the always-on unit suite. The original file is archived at
// C:\tmp\phase2f1-reconciliation\archived-tools\trimmed-originals\.
