export function isPresetFrameContext(context) {
  return context?.sourceType === "preset";
}

export function presetFramePlannerCopy(context) {
  if (!isPresetFrameContext(context)) return null;
  return {
    heading: context?.drawingId ? "Схема шаблона:" : "Создание схемы для:",
    name: String(context?.rackLabel || "Шаблон стеллажа").trim(),
    returnLabel: "К шаблонам стеллажей",
  };
}
