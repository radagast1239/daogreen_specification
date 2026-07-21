/** Helpers for project scheme / floor-plan media (image + PDF). */

export const SCHEME_FILE_ACCEPT = "image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf";

export function isPdfScheme(schemeOrMime, url = "") {
  if (schemeOrMime && typeof schemeOrMime === "object") {
    const mime = String(schemeOrMime.mimeType || "").toLowerCase();
    const u = String(schemeOrMime.url || url || "");
    return mime.includes("pdf") || /\.pdf(?:$|\?)/i.test(u);
  }
  const mime = String(schemeOrMime || "").toLowerCase();
  return mime.includes("pdf") || /\.pdf(?:$|\?)/i.test(String(url || ""));
}

export function schemeOpenRel() {
  return "noopener noreferrer";
}
