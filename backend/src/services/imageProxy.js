import fs from "fs/promises";
import path from "path";
import { resolveUploadRoot } from "./uploadRoot.js";
import { uploadsRelativeFromUrl, resolvePathInsideUploadRoot } from "./uploadValidation.js";

const MAX_BYTES = 5 * 1024 * 1024;

const PRIVATE_PREFIXES = ["frame-drawings/", "releases/", "projects/"];

function isPrivateHost(hostname) {
  const h = String(hostname || "").toLowerCase();
  if (!h || h === "localhost" || h.endsWith(".local")) return true;
  if (h === "127.0.0.1" || h === "::1" || h === "0.0.0.0") return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [, a, b] = m.map(Number);
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function isPrivateUploadRel(rel) {
  const r = String(rel || "").replace(/\\/g, "/").replace(/^\/+/, "");
  return PRIVATE_PREFIXES.some((p) => r === p.slice(0, -1) || r.startsWith(p));
}

/**
 * @param {string} raw
 * @param {{ allowPrivate?: boolean }} [opts]
 *   allowPrivate — admin media may read private prefixes; client media must not.
 */
export function parseProxyImageUrl(raw, opts = {}) {
  const allowPrivate = !!opts.allowPrivate;
  const url = String(raw || "").trim();
  if (!url) return { error: "URL required" };
  if (url.startsWith("/uploads/")) {
    const rel = uploadsRelativeFromUrl(url);
    if (!rel) return { error: "Invalid upload path" };
    if (!allowPrivate && isPrivateUploadRel(rel)) {
      return { error: "URL not allowed" };
    }
    // Public catalog: only /uploads/public/... when not allowPrivate.
    // Legacy root material photos are no longer allowed via client media proxy.
    if (!allowPrivate) {
      const isPublic = rel === "public" || rel.startsWith("public/");
      if (!isPublic) {
        return { error: "URL not allowed" };
      }
    }
    try {
      const uploadDir = resolveUploadRoot();
      const filePath = resolvePathInsideUploadRoot(uploadDir, rel);
      return { kind: "local", filePath, rel };
    } catch {
      return { error: "Invalid upload path" };
    }
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { error: "Invalid URL" };
  }
  if (!["http:", "https:"].includes(parsed.protocol)) return { error: "Unsupported protocol" };
  if (isPrivateHost(parsed.hostname)) return { error: "URL not allowed" };
  return { kind: "remote", url: parsed.toString() };
}

export async function loadProxyImage(rawUrl, opts = {}) {
  const parsed = parseProxyImageUrl(rawUrl, opts);
  if (parsed.error) {
    const err = new Error(parsed.error);
    err.status = 400;
    throw err;
  }

  if (parsed.kind === "local") {
    const buf = await fs.readFile(parsed.filePath);
    if (buf.length > MAX_BYTES) {
      const err = new Error("Image too large");
      err.status = 413;
      throw err;
    }
    const ext = path.extname(parsed.filePath).toLowerCase();
    const type =
      ext === ".png"
        ? "image/png"
        : ext === ".webp"
          ? "image/webp"
          : ext === ".gif"
            ? "image/gif"
            : "image/jpeg";
    return { buffer: buf, contentType: type };
  }

  const res = await fetch(parsed.url, {
    redirect: "follow",
    headers: { "User-Agent": "DaogreenSpec/1.0" },
    // Keep short: PDF loads many photos; one slow CDN must not stall export.
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    const err = new Error(`Upstream HTTP ${res.status}`);
    err.status = 502;
    throw err;
  }
  const contentType = String(res.headers.get("content-type") || "").split(";")[0].trim();
  if (!contentType.startsWith("image/")) {
    const err = new Error("Not an image");
    err.status = 415;
    throw err;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) {
    const err = new Error("Image too large");
    err.status = 413;
    throw err;
  }
  return { buffer: buf, contentType };
}
