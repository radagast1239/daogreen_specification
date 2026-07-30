export const SPECIFICATION_COLUMN_PRESETS = {
  main: {
    label: "Основное",
    columns: ["select", "photo", "name", "unit", "qty", "price", "sum", "supplier", "purchaseStatus", "clientVisibility", "details"],
  },
  purchase: {
    label: "Закупка",
    columns: ["select", "photo", "name", "unit", "qty", "price", "sum", "supplier", "links", "purchaseStatus", "deliveryDays", "comments", "details"],
  },
  client: {
    label: "Клиент",
    columns: ["select", "photo", "name", "qty", "price", "sum", "clientVisibility", "hidden", "included", "group", "details"],
  },
  all: { label: "Все поля", columns: ["*"] },
};

export const DEFAULT_SPECIFICATION_COLUMN_PRESET = "main";

export function specificationPresetHasColumn(preset, column) {
  const columns = SPECIFICATION_COLUMN_PRESETS[preset]?.columns || SPECIFICATION_COLUMN_PRESETS.main.columns;
  return columns.includes("*") || columns.includes(column);
}
