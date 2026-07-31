/** Файл изображения из буфера (Win+Shift+S → Ctrl+V) */
export function getClipboardImageFile(event) {
  const cd = event?.clipboardData;
  if (!cd?.items?.length) return null;

  for (const item of cd.items) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const blob = item.getAsFile();
    if (!blob) continue;
    const ext =
      item.type === "image/jpeg" ? "jpg" : item.type === "image/webp" ? "webp" : "png";
    return new File([blob], `screenshot-${Date.now()}.${ext}`, { type: item.type });
  }
  return null;
}

/** True when paste target is a text field — do not intercept. */
export function isEditablePasteTarget(event) {
  const t = event?.target;
  if (!t || typeof t !== "object") return false;
  const tag = String(t.tagName || "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (t.isContentEditable) return true;
  const closest = typeof t.closest === "function" ? t.closest("input, textarea, select, [contenteditable='true']") : null;
  return Boolean(closest);
}

/** Display / upload name for a pasted screenshot. */
export function screenshotDisplayName(date = new Date(), ext = "png") {
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}-${pad(date.getMinutes())}`;
  const safeExt = ext === "jpg" || ext === "jpeg" ? "jpg" : ext === "webp" ? "webp" : "png";
  return `Скриншот ${stamp}.${safeExt}`;
}

/** Rename clipboard File with a human display name (keeps type). */
export function renameClipboardImageFile(file, displayName) {
  if (!file) return null;
  const name = displayName || screenshotDisplayName(new Date(), (file.name || "").split(".").pop());
  return new File([file], name, { type: file.type || "image/png" });
}
