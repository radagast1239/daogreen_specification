/**
 * Topology-valid browser-gate fixture for connected wall movement.
 *
 * The earlier gate seeded a copy of the real project, which carried a ~49 mm
 * kink left over from a pre-fix session AND lacked the chainId values the
 * acceptance script's host-straightness assertion keys on
 * (chainId "left-host" / "right-host"). It therefore failed before any gesture.
 *
 * This fixture keeps the same topology CLASSES as the real plan while being
 * clean at rest — every diagnostic is zero before the first drag:
 *
 *   left-host-a / left-host-b   collinear host chain, junction at `lj`
 *   right-host-a / right-host-b collinear host chain, junction at `rj`
 *   selected                    T-branch spanning both junctions (tee/tee)
 *   top / bottom                close the envelope so rooms are detected
 *   free-a                      isolated free/free wall
 *   x_n / x_s / x_w / x_e       degree-4 cross, for the fail-closed path
 *
 * `selected` is the T-branch case; `bottom-host-a` is the host-half case;
 * `free-a` is the free case; `x_n` is the ambiguous degree-4 case.
 */
const W = {
  // Browser gate opens on the Architecture/room layer, so the fixture walls
  // deliberately use the same `outer` role as the sanitized live topology.
  thk: 100, role: "outer", kind: "new",
  thicknessSide: "center", height: 3000, material: "",
};

export const CLEAN_NODES = {
  lt: { x: 0, y: 0 },
  lj: { x: 0, y: 2000 },
  lb: { x: 0, y: 4000 },
  rt: { x: 4000, y: 0 },
  rj: { x: 4000, y: 2000 },
  rb: { x: 4000, y: 4000 },
  bj: { x: 2000, y: 4000 },
  bd: { x: 2000, y: 6000 },
  fa: { x: 7000, y: 5200 },
  fb: { x: 9000, y: 5200 },
  x0: { x: 8000, y: 1000 },
  xw: { x: 6600, y: 1000 },
  xe: { x: 9400, y: 1000 },
  xn: { x: 8000, y: -400 },
  xs: { x: 8000, y: 2400 },
};

export const CLEAN_WALLS = [
  { id: "left-host-a", a: "lt", b: "lj", chainId: "left-host", ...W },
  { id: "left-host-b", a: "lj", b: "lb", chainId: "left-host", ...W },
  { id: "right-host-a", a: "rt", b: "rj", chainId: "right-host", ...W },
  { id: "right-host-b", a: "rj", b: "rb", chainId: "right-host", ...W },
  { id: "selected", a: "lj", b: "rj", chainId: "selected", ...W },
  { id: "top", a: "lt", b: "rt", chainId: "envelope", ...W },
  // Horizontal host chain + branch, so a host half can be dragged along the
  // screen Y axis (the acceptance script drags vertically).
  { id: "bottom-host-a", a: "lb", b: "bj", chainId: "bottom-host", ...W },
  { id: "bottom-host-b", a: "bj", b: "rb", chainId: "bottom-host", ...W },
  { id: "bottom-branch", a: "bj", b: "bd", chainId: "bottom-branch", ...W },
  { id: "free-a", a: "fa", b: "fb", chainId: "free", ...W },
  { id: "x_w", a: "xw", b: "x0", chainId: "cross-we", ...W },
  { id: "x_e", a: "x0", b: "xe", chainId: "cross-we", ...W },
  { id: "x_n", a: "x0", b: "xn", chainId: "cross-ns", ...W },
  { id: "x_s", a: "x0", b: "xs", chainId: "cross-ns", ...W },
];

/**
 * Browser-gate contract. Keeping the ids and host geometry beside the fixture
 * prevents an acceptance script from silently validating only the two hosts it
 * happened to know about when it was first written.
 */
export const CLEAN_WALL_FIXTURE = Object.freeze({
  wallIds: Object.freeze({
    free: "free-a",
    teeBranch: "selected",
    hostHalf: "bottom-host-a",
    ambiguous: "x_n",
  }),
  hostChains: Object.freeze([
    Object.freeze({ chainId: "left-host", axis: "x", coordinate: 0 }),
    Object.freeze({ chainId: "right-host", axis: "x", coordinate: 4000 }),
    Object.freeze({ chainId: "bottom-host", axis: "y", coordinate: 4000 }),
    Object.freeze({ chainId: "cross-we", axis: "y", coordinate: 1000 }),
    Object.freeze({ chainId: "cross-ns", axis: "x", coordinate: 8000 }),
  ]),
});

// Exact deterministic result of the production room detector for the closed
// envelope split by `selected`. Seeding these rooms keeps browser/API baseline
// fingerprints equal without relying on derived room sync to autosave.
const roomRecord = ({ id, name, contourId, polygon, labelPosition }) => ({
  id,
  type: "room",
  name,
  category: "other",
  contourId,
  polygon,
  areaMm2: 8_000_000,
  areaM2: 8,
  heightMm: 3000,
  labelPosition: { ...labelPosition, external: false },
  fillColor: "#edf1ee",
  visible: true,
  locked: false,
  climateZone: null,
  sanitationZone: null,
  productionZone: null,
  targetTemperatureC: null,
  targetRh: null,
  targetCo2Ppm: null,
  targetAirChanges: null,
  targetAirVelocityMs: null,
  notes: "",
});

export const CLEAN_ROOMS = [
  roomRecord({
    id: "rm-205-105-8000-2194360",
    name: "Помещение 1",
    contourId: "contour-1",
    polygon: [
      { x: 50, y: 50 }, { x: 4050, y: 50 },
      { x: 4050, y: 2050 }, { x: 50, y: 2050 },
    ],
    labelPosition: { x: 2050, y: 1050 },
  }),
  roomRecord({
    id: "rm-204-325-8000-121355057",
    name: "Помещение 2",
    contourId: "contour-2",
    polygon: [
      { x: 50, y: 2050 }, { x: 4050, y: 2050 }, { x: 4050, y: 4050 },
      { x: 2000, y: 4050 }, { x: 50, y: 4050 },
    ],
    labelPosition: { x: 2040, y: 3250 },
  }),
];

const zoneFromRoom = (room) => {
  const xs = room.polygon.map((point) => point.x);
  const ys = room.polygon.map((point) => point.y);
  return {
    id: room.id,
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
    name: room.name,
    category: room.category,
    polygon: room.polygon.map((point) => ({ ...point })),
    auto: true,
    height: room.heightMm,
    heightMm: room.heightMm,
    areaMm2: room.areaMm2,
    areaM2: room.areaM2,
    fillColor: room.fillColor,
    zoneColor: room.fillColor,
    labelPosition: { ...room.labelPosition },
    visible: room.visible,
    locked: room.locked,
    climateZone: room.climateZone,
    sanitationZone: room.sanitationZone,
    productionZone: room.productionZone,
    targetTemperatureC: room.targetTemperatureC,
    targetRh: room.targetRh,
    targetCo2Ppm: room.targetCo2Ppm,
    targetAirChanges: room.targetAirChanges,
    targetAirVelocityMs: room.targetAirVelocityMs,
    notes: room.notes,
    showName: true,
    showArea: true,
    showHeight: true,
  };
};

export const CLEAN_ZONES = CLEAN_ROOMS.map(zoneFromRoom);

export function cleanWallPlan() {
  return {
    nodes: JSON.parse(JSON.stringify(CLEAN_NODES)),
    walls: CLEAN_WALLS.map((w) => ({ ...w })),
    items: [], rooms: CLEAN_ROOMS.map((room) => ({
      ...room,
      polygon: room.polygon.map((point) => ({ ...point })),
    })), zones: CLEAN_ZONES.map((zone) => ({
      ...zone,
      polygon: zone.polygon.map((point) => ({ ...point })),
      labelPosition: { ...zone.labelPosition },
    })), links: [], labels: [], lines: [],
    dimensions: [], validationWarnings: [],
    room: { w: 20000, h: 15000, wallThk: 100, height: 3000 },
  };
}
