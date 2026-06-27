/** Типы окон и проёмов в стене (вид сверху). */

export const OPENING_KINDS = new Set([
  "window",
  "opening",
  "opening_vent",
  "opening_tech",
  "opening_serve",
  "opening_arch",
]);

export const OPENING_TYPES = {
  window: {
    label: "Окно",
    short: "Окно",
    color: "#5b7c9d",
    accent: "#8ab4d4",
    glass: true,
  },
  opening: {
    label: "Технический проём",
    short: "Проём",
    color: "#6b7d74",
    accent: "#9aa8a0",
    dash: true,
  },
  opening_vent: {
    label: "Вентиляционный проём",
    short: "Вент.",
    color: "#7a8a9c",
    accent: "#a8b8c8",
    dash: true,
    vents: true,
  },
  opening_tech: {
    label: "Технологическое окно",
    short: "Тех. окно",
    color: "#1f6f8b",
    accent: "#4a9cb8",
    glass: true,
  },
  opening_serve: {
    label: "Окно выдачи продукции",
    short: "Выдача",
    color: "#116355",
    accent: "#3d9a7a",
    glass: true,
    serve: true,
  },
  opening_arch: {
    label: "Арочный проём",
    short: "Арка",
    color: "#5b7c9d",
    accent: "#8ab4d4",
    arch: true,
  },
};

export function isOpeningKind(kind) {
  return OPENING_KINDS.has(kind);
}

export function openingStyle(kind) {
  return OPENING_TYPES[kind] || OPENING_TYPES.window;
}

export function defaultOpeningFields(kind) {
  const st = openingStyle(kind);
  return {
    openingHeightMm: kind === "opening_vent" ? 400 : 1200,
    openingSillMm: kind === "opening_serve" ? 1100 : kind === "opening_vent" ? 2200 : 900,
    openingShape: st.arch ? "arch" : "rect",
  };
}
