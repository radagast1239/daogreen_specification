/** Потолочные ригели, бордюры, колонны — конструктивные элементы плана. */

export const STRUCTURAL_KINDS = {
  beam: {
    label: "Ригель",
    defaultWidth: 200,
    blocksPlacement: true,
    stroke: "#3d4540",
    fill: "rgba(90, 95, 92, 0.35)",
  },
  border: {
    label: "Бордюр",
    defaultWidth: 500,
    blocksPlacement: true,
    stroke: "#6a5a48",
    fill: "rgba(122, 106, 90, 0.42)",
  },
  column: {
    label: "Колонна",
    defaultWidth: 400,
    blocksPlacement: true,
    stroke: "#4a4a4a",
    fill: "rgba(74, 74, 74, 0.38)",
  },
};

export function defaultStructuralFields(kind, width) {
  const meta = STRUCTURAL_KINDS[kind] || STRUCTURAL_KINDS.beam;
  return {
    kind,
    width: width ?? meta.defaultWidth,
    label: meta.label,
  };
}

export function structuralKindLabel(kind) {
  return STRUCTURAL_KINDS[kind]?.label || kind;
}

/** Бордюры шире порога — блокируют установку оборудования. */
export function structuralBlocksPlacement(s) {
  return STRUCTURAL_KINDS[s?.kind]?.blocksPlacement !== false;
}

export const LARGE_BORDER_WIDTH_MM = 350;

export function isLargeBorder(s) {
  return s?.kind === "border" && (s.width || 0) >= LARGE_BORDER_WIDTH_MM;
}
