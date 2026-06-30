/** Типы snap для планировщика. */

export const SNAP_TYPES = {
  GRID: "grid",
  VERTEX: "vertex",
  WALL_END: "wall-end",
  WALL_MID: "wall-mid",
  WALL_LINE: "wall-line",
  WALL_EXTENSION: "wall-extension",
  PERPENDICULAR: "perpendicular",
  PARALLEL: "parallel",
  ANGLE: "angle",
  OBJECT_EDGE: "object-edge",
  OBJECT_CENTER: "object-center",
  CLOSE: "close",
};

export const SNAP_COLORS = {
  primary: "#116355",
  guide: "#1a9e78",
  extension: "rgba(17, 99, 85, 0.55)",
};

export function snapVisualHint(type) {
  switch (type) {
    case SNAP_TYPES.VERTEX:
    case SNAP_TYPES.WALL_END:
      return "circle";
    case SNAP_TYPES.WALL_LINE:
    case SNAP_TYPES.WALL_MID:
      return "point-on-wall";
    case SNAP_TYPES.WALL_EXTENSION:
      return "extension-dash";
    case SNAP_TYPES.PERPENDICULAR:
      return "right-angle";
    case SNAP_TYPES.ANGLE:
    case SNAP_TYPES.PARALLEL:
      return "guide-line";
    case SNAP_TYPES.GRID:
    default:
      return "none";
  }
}
