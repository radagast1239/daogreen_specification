/**
 * PHASE 2E — renderer contract for the wall-mass outline (RC2).
 *
 * mass.boundaryEdges is a set of INDEPENDENT segments, one <line> each. With
 * strokeLinecap="round" every one of them painted half a stroke width of ink
 * BEYOND its endpoint, so at high zoom each corner bulged into a round blob
 * and, where two caps overlapped at an outside corner, the joint read as a
 * bevel or a clipped end. Polygon tests cannot see this at all — the polygons
 * were fine — so it needs its own test on what is actually emitted.
 *
 * These tests render the shipped WallMassLayer and read the markup; they also
 * read wallRender.jsx itself, because "no round cap ANYWHERE on the wall mass"
 * is a statement about the source, not about one rendered fixture.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WallMassLayer } from "../src/planner/wallRender.jsx";
import { buildWallGeometry, wallGeometryMap } from "../src/planner/buildWallGeometry.js";
import { buildWallMassGeometry } from "../src/planner/core/walls/wallMass.js";
import { geometryFingerprint, P } from "./helpers/wallPolygonAssertions.js";

const SRC = fileURLToPath(new URL("../src/planner/wallRender.jsx", import.meta.url));
const source = readFileSync(SRC, "utf8");

const BASE = { role: "partition", kind: "new", thicknessSide: "center", height: 3000, material: "" };
const wall = (id, pts, thk = 100) => ({ ...BASE, id, thk, pts });
const room = { w: 30000, h: 20000, wallThk: 100, height: 3000 };

/** A rectangle plus a T branch — corners and a junction in one fixture. */
const fixture = () => [
  wall("t", [P(0, 0), P(6000, 0)]), wall("r", [P(6000, 0), P(6000, 4000)]),
  wall("b", [P(6000, 4000), P(0, 4000)]), wall("l", [P(0, 4000), P(0, 0)]),
  wall("br", [P(3000, 4000), P(3000, 8000)]),
];

const render = (walls) => renderToStaticMarkup(
  React.createElement(WallMassLayer, { walls, room, k: 1 }),
);

/** The `<g data-ui="wall-mass">` subtree only. */
function massMarkup(walls) {
  const html = render(walls);
  const i = html.indexOf('data-ui="wall-mass"');
  expect(i, "WallMassLayer did not render its own group").toBeGreaterThanOrEqual(0);
  return html;
}

describe("PHASE 2E renderer contract — the mass boundary uses butt caps", () => {
  it("every boundary <line> is emitted with stroke-linecap=\"butt\"", () => {
    const html = massMarkup(fixture());
    const lines = html.match(/<line[^>]*>/g) || [];
    expect(lines.length, "no boundary segments rendered").toBeGreaterThan(0);
    for (const line of lines) {
      expect(line, `boundary segment without a butt cap: ${line}`).toContain('stroke-linecap="butt"');
    }
  });

  it("no round cap survives anywhere in the rendered wall mass", () => {
    expect(massMarkup(fixture())).not.toContain('stroke-linecap="round"');
    expect(massMarkup(fixture())).not.toContain('stroke-linejoin="round"');
  });

  it("WallMassLayer's source contains no round cap or round join", () => {
    const start = source.indexOf("export function WallMassLayer");
    expect(start).toBeGreaterThan(0);
    const body = source.slice(start);
    expect(body).not.toMatch(/strokeLinecap\s*=\s*["{]?\s*"?round/);
    expect(body).not.toMatch(/strokeLinejoin\s*=\s*["{]?\s*"?round/);
    expect(body).toContain('strokeLinecap="butt"');
  });

  it("no wall renderer anywhere in the file asks for a round cap", () => {
    const caps = [...source.matchAll(/strokeLinecap\s*[=:]\s*"([a-z]+)"/g)].map((m) => m[1]);
    expect(caps.length).toBeGreaterThan(0);
    expect(caps).not.toContain("round");
  });
});

describe("PHASE 2E renderer contract — unrelated strokes are untouched", () => {
  it("the door/window jamb keeps its square cap", () => {
    // WallSlabHatch's jambs are deliberately square-capped so a jamb tick
    // reads as a full-thickness stop; PHASE 2E must not have touched it.
    const jamb = source.slice(source.indexOf("{jambs.map"), source.indexOf("{bridges.map"));
    expect(jamb).toContain('strokeLinecap="square"');
  });

  it("WallFaceOutlines keeps butt + mitered joins with its miter limit", () => {
    const block = source.slice(source.indexOf("const lineProps = {"));
    expect(block).toContain('strokeLinecap: "butt"');
    expect(block).toContain('strokeLinejoin: "miter"');
    expect(block).toContain("strokeMiterlimit: 8");
  });

  it("only three stroke caps exist in the file — square (jambs), butt, butt", () => {
    const caps = [...source.matchAll(/strokeLinecap\s*[=:]\s*"([a-z]+)"/g)].map((m) => m[1]);
    expect(caps.sort()).toEqual(["butt", "butt", "square"]);
  });
});

describe("PHASE 2E renderer contract — fill and outline come from one geometry", () => {
  it("the layer derives both from the same geom.polygons", () => {
    const body = source.slice(source.indexOf("export function WallMassLayer"));
    // one call to the canonical builder, one call to the mass builder fed by it
    expect(body).toContain("wallGeometryMap(walls, room)");
    expect(body).toContain("buildWallMassGeometry(geom.polygons");
    expect(body).toContain("d={mass.fillPath}");
    expect(body).toContain("mass.boundaryEdges.map");
  });

  it("the rendered fill path and boundary segments match the builder output exactly", () => {
    const walls = fixture();
    const geom = wallGeometryMap(walls, room);
    const masses = buildWallMassGeometry(geom.polygons, geom.expandedWalls || walls);
    const html = massMarkup(walls);
    for (const mass of masses) {
      expect(html, "fill path is not the one the builder produced").toContain(`d="${mass.fillPath}"`);
      for (const e of mass.boundaryEdges) {
        expect(html, `boundary edge missing: ${JSON.stringify(e)}`)
          .toContain(`x1="${e.a.x}" y1="${e.a.y}" x2="${e.b.x}" y2="${e.b.y}"`);
      }
    }
  });

  it("the outline draws no segment the fill geometry does not contain", () => {
    const walls = fixture();
    const geom = wallGeometryMap(walls, room);
    const masses = buildWallMassGeometry(geom.polygons, geom.expandedWalls || walls);
    const rendered = (massMarkup(walls).match(/<line[^>]*>/g) || []).length;
    const expected = masses.reduce((s, m) => s + m.boundaryEdges.length, 0);
    expect(rendered).toBe(expected);
  });
});

describe("PHASE 2E renderer contract — nothing is classified by array or DOM order", () => {
  // The contract is the painted RESULT, not the document order. Boundary
  // segments are independent <line>s with identical stroke settings and the
  // fill is one nonzero-rule path of disjoint subpaths, so emitting them in a
  // different sequence paints the same picture. What must not change is the
  // SET of primitives — if array order leaked into host/branch classification
  // the set itself would differ.
  const lineSet = (walls) => (massMarkup(walls).match(/<line[^>]*>/g) || []).sort();
  const fillSet = (walls) => (massMarkup(walls).match(/ d="([^"]*)"/g) || [])
    .flatMap((d) => d.split("M").filter(Boolean).map((s) => `M${s.trim()}`)).sort();

  it("reversing the wall array paints exactly the same primitives", () => {
    const walls = fixture();
    expect(lineSet([...walls].reverse())).toEqual(lineSet(walls));
    expect(fillSet([...walls].reverse())).toEqual(fillSet(walls));
  });

  it("host and branch are not decided by position in the array", () => {
    // the T branch declared FIRST must produce the same geometry as last
    const walls = fixture();
    const branchFirst = [walls[4], ...walls.slice(0, 4)];
    expect(geometryFingerprint(buildWallGeometry(branchFirst, room).polygons))
      .toBe(geometryFingerprint(buildWallGeometry(walls, room).polygons));
    expect(lineSet(branchFirst)).toEqual(lineSet(walls));
    expect(fillSet(branchFirst)).toEqual(fillSet(walls));
  });

  it("every rotation of the array paints the same primitives", () => {
    const walls = fixture();
    const base = lineSet(walls);
    for (let i = 1; i < walls.length; i++) {
      const rotated = [...walls];
      rotated.push(...rotated.splice(0, i));
      expect(lineSet(rotated), `rotation ${i}`).toEqual(base);
    }
  });

  it("the layer never mutates the walls it renders", () => {
    const walls = fixture();
    const before = JSON.stringify(walls);
    render(walls);
    expect(JSON.stringify(walls)).toBe(before);
  });
});
