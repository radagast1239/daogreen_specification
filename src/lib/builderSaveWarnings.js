/**
 * Admin-facing text for structured builder-save warnings.
 *
 * The server contract is the warning `code`; this module only renders it.
 * Item ids are never shown to the user — only counts and, when the saved
 * project already carries them, a couple of item names.
 */
import { PROCUREMENT_ACTIVE_ITEMS_PRESERVED } from "../../shared/reconcileBuilderProjectSave.js";

const MAX_NAMES = 2;

function pluralRu(n, one, few, many) {
  const mod100 = Math.abs(n) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

function namesFor(itemIds = [], items = []) {
  if (!Array.isArray(items) || !items.length) return [];
  const wanted = new Set(itemIds.map(String));
  const names = [];
  for (const it of items) {
    if (!wanted.has(String(it?.id))) continue;
    const name = String(it?.name || "").trim();
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * @param {object} savedProject project returned by the save call
 * @returns {string} message to show, or "" when there is nothing to report
 */
export function formatBuilderSaveWarning(savedProject) {
  const warnings = savedProject?.builderSaveMeta?.warnings;
  if (!Array.isArray(warnings) || !warnings.length) return "";
  const w = warnings.find((x) => x?.code === PROCUREMENT_ACTIVE_ITEMS_PRESERVED);
  const count = Number(w?.count) || 0;
  if (!count) return "";

  const noun = pluralRu(count, "позиция", "позиции", "позиций");
  const verb = pluralRu(count, "не удалена", "не удалены", "не удалены");
  const pronoun = pluralRu(count, "её", "их", "их");

  const names = namesFor(w.itemIds || [], savedProject?.items).slice(0, MAX_NAMES);
  let shown = "";
  if (names.length) {
    const rest = count - names.length;
    shown = rest > 0 ? ` (${names.join(", ")} и ещё ${rest})` : ` (${names.join(", ")})`;
  }

  return `Проект сохранён, но ${count} ${noun} ${verb}${shown}: по ним уже есть закупочная активность. `
    + `Проверьте ${pronoun} в спецификации.`;
}
