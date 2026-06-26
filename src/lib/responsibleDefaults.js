const CATEGORY_TO_RESPONSIBLE = {
  "Полив и сантехника": "plumber",
  "Электрика и свет": "electrician",
  "Каркас и крепёж": "installer",
  "Климат и вентиляция": "installer",
  Расходники: "consumables",
  "Работы и доставка": "client",
  Прочее: "general",
};

export function defaultResponsible(category, mat = {}) {
  if (mat.isConsumable || category === "Расходники") return "consumables";
  return CATEGORY_TO_RESPONSIBLE[category] || "general";
}
