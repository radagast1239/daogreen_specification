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
