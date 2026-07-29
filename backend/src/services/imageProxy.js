/**
 * Image load for admin /api/media/image and (legacy) client /media after allowlisting.
 *
 * Remote fetch is disabled by default (allowRemote: false).
 * When allowRemote is explicitly enabled, fetch uses manual redirects, DNS checks,
 * and pinned addresses — never redirect: "follow".
 */
import fs from "fs/promises";
import path from "path";
import dns from "dns/promises";
import net from "net";
import { resolveUploadRoot } from "./uploadRoot.js";
import {
  uploadsRelativeFromUrl,
  resolvePathInsideUploadRoot,
  detectImageMagic,
  looksLikeSvg,
} from "./uploadValidation.js";

export const PROXY_MAX_BYTES = 5 * 1024 * 1024;
export const PROXY_TIMEOUT_MS = 5000;
export const PROXY_MAX_REDIRECTS = 3;

const PRIVATE_PREFIXES = ["frame-drawings/", "releases/", "projects/"];

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
]);

function normalizeIp(address) {
  return String(address || "")
    .trim()
    .toLowerCase()
    .split("%")[0];
}

/** Unwrap IPv4-mapped IPv6 (:ffff:a.b.c.d) to plain IPv4 when present. */
export function unwrapIpAddress(address) {
  const a = normalizeIp(address);
  if (!a) return null;
  if (a.startsWith("::ffff:")) {
    const mapped = a.slice("::ffff:".length);
    if (net.isIPv4(mapped)) return { family: 4, address: mapped };
    const hex = mapped.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    if (hex) {
      const hi = parseInt(hex[1], 16);
      const lo = parseInt(hex[2], 16);
      const ipv4 = `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
      if (net.isIPv4(ipv4)) return { family: 4, address: ipv4 };
    }
  }
  if (net.isIPv4(a)) return { family: 4, address: a };
  if (net.isIPv6(a)) return { family: 6, address: a };
  return null;
}

function ipv4ToInt(ip) {
  const parts = String(ip).split(".").map((x) => Number(x));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return null;
  }
  return ((parts[0] << 24) >>> 0) + ((parts[1] << 16) >>> 0) + ((parts[2] << 8) >>> 0) + (parts[3] >>> 0);
}

export function isBlockedIPv4(ip) {
  const n = ipv4ToInt(ip);
  if (n == null) return true;
  if (n >>> 24 === 0) return true; // 0.0.0.0/8
  if (n >>> 24 === 10) return true;
  if (n >>> 24 === 127) return true;
  if (n >>> 16 === 0xa9fe) return true; // 169.254.0.0/16 (metadata)
  if (n >>> 16 >= 0xac10 && n >>> 16 <= 0xac1f) return true; // 172.16/12
  if (n >>> 16 === 0xc0a8) return true; // 192.168/16
  if (n >>> 22 === 0x64400000 >>> 22) return true; // 100.64/10 CGNAT
  if (n >>> 28 === 0xe) return true; // multicast
  if (n >>> 28 === 0xf) return true; // reserved
  return false;
}

function parseIpv6Groups(ip) {
  const a = normalizeIp(ip);
  if (!a || !net.isIPv6(a)) return null;
  const [head, tail] = a.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail ? tail.split(":") : [];
  if (a.includes("::")) {
    const missing = 8 - headParts.length - tailParts.length;
    if (missing < 0) return null;
    const full = [...headParts, ...Array(missing).fill("0"), ...tailParts];
    if (full.length !== 8) return null;
    return full.map((g) => parseInt(g || "0", 16));
  }
  const parts = a.split(":");
  if (parts.length !== 8) return null;
  return parts.map((g) => parseInt(g || "0", 16));
}

export function isBlockedIPv6(ip) {
  const groups = parseIpv6Groups(ip);
  if (!groups) return true;
  if (groups.every((g) => g === 0)) return true;
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true;
  if ((groups[0] & 0xfe00) === 0xfc00) return true; // ULA
  if ((groups[0] & 0xffc0) === 0xfe80) return true; // link-local
  if ((groups[0] & 0xff00) === 0xff00) return true; // multicast
  if ((groups[0] & 0xffc0) === 0xfec0) return true; // site-local
  if (groups[0] === 0x2001 && groups[1] === 0xdb8) return true;
  return false;
}

export function isBlockedIpAddress(address) {
  const unwrapped = unwrapIpAddress(address);
  if (!unwrapped) return true;
  if (unwrapped.family === 4) return isBlockedIPv4(unwrapped.address);
  return isBlockedIPv6(unwrapped.address);
}

/** Hostname denylist + IP literals. DNS hostnames still need resolve checks. */
export function isPrivateHost(hostname) {
  const h = String(hostname || "")
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (!h || BLOCKED_HOSTNAMES.has(h) || h.endsWith(".local") || h.endsWith(".localhost")) {
    return true;
  }
  if (net.isIP(h)) return isBlockedIpAddress(h);
  return false;
}

function isPrivateUploadRel(rel) {
  const r = String(rel || "").replace(/\\/g, "/").replace(/^\/+/, "");
  return PRIVATE_PREFIXES.some((p) => r === p.slice(0, -1) || r.startsWith(p));
}

function deny(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  err.code = "PROXY_DENIED";
  return err;
}

export async function assertPublicDnsAddresses(hostname, lookupFn = dns.lookup.bind(dns)) {
  const host = String(hostname || "")
    .trim()
    .replace(/^\[|\]$/g, "");
  if (!host) throw deny("URL not allowed");
  if (isPrivateHost(host)) throw deny("URL not allowed");

  let results;
  try {
    results = await lookupFn(host, { all: true, verbatim: true });
  } catch {
    throw deny("DNS resolution failed", 502);
  }
  const list = Array.isArray(results) ? results : results ? [results] : [];
  if (!list.length) throw deny("DNS resolution failed", 502);
  for (const entry of list) {
    const address = entry?.address ?? entry;
    if (isBlockedIpAddress(address)) throw deny("URL not allowed");
  }
  return list.map((entry) => ({
    address: entry?.address ?? entry,
    family: entry?.family || (net.isIPv6(entry?.address ?? entry) ? 6 : 4),
  }));
}

function validateRemoteUrlObject(parsed) {
  if (!parsed || parsed.protocol !== "https:") {
    return { error: "URL not allowed" };
  }
  if (parsed.username || parsed.password) {
    return { error: "URL not allowed" };
  }
  const port = parsed.port ? Number(parsed.port) : 443;
  if (port !== 443) {
    return { error: "URL not allowed" };
  }
  if (isPrivateHost(parsed.hostname)) {
    return { error: "URL not allowed" };
  }
  return null;
}

/**
 * @param {string} raw
 * @param {{
 *   allowPrivate?: boolean,
 *   allowRemote?: boolean,
 *   allowReleaseProjectId?: string,
 *   allowLegacyCatalogRoot?: boolean,
 * }} [opts]
 */
export function parseProxyImageUrl(raw, opts = {}) {
  const allowPrivate = !!opts.allowPrivate;
  const allowRemote = !!opts.allowRemote;
  const allowReleaseProjectId = String(opts.allowReleaseProjectId || "").trim();
  const allowLegacyCatalogRoot = !!opts.allowLegacyCatalogRoot;
  const url = String(raw || "").trim();
  if (!url) return { error: "URL required" };

  if (url.startsWith("/uploads/")) {
    const rel = uploadsRelativeFromUrl(url);
    if (!rel) return { error: "Invalid upload path" };

    const releaseOk =
      allowReleaseProjectId &&
      (rel === `releases/${allowReleaseProjectId}` ||
        rel.startsWith(`releases/${allowReleaseProjectId}/`));

    if (!allowPrivate && !releaseOk && isPrivateUploadRel(rel)) {
      return { error: "URL not allowed" };
    }
    if (!allowPrivate && !releaseOk) {
      const isPublic = rel === "public" || rel.startsWith("public/");
      if (!isPublic && !allowLegacyCatalogRoot) {
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

  // Prefer ban remote entirely; opt-in only for explicit callers/tests.
  if (!allowRemote) {
    return { error: "URL not allowed" };
  }

  if (parsed.protocol === "http:") {
    return { error: "URL not allowed" };
  }
  const remoteErr = validateRemoteUrlObject(parsed);
  if (remoteErr) return remoteErr;
  return { kind: "remote", url: parsed.toString(), hostname: parsed.hostname };
}

function contentTypeFromExt(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

function assertSafeImageBuffer(buf, contentTypeHint = "") {
  if (looksLikeSvg(buf, { mime: contentTypeHint })) {
    throw deny("SVG not allowed", 415);
  }
  const magic = detectImageMagic(buf);
  if (!magic) {
    throw deny("Not an image", 415);
  }
  const type =
    magic === "png" ? "image/png" : magic === "webp" ? "image/webp" : "image/jpeg";
  return type;
}

async function readBodyLimited(res, maxBytes, timeoutMs) {
  const reader = res.body?.getReader?.();
  if (!reader) {
    const ab = await res.arrayBuffer();
    const buf = Buffer.from(ab);
    if (buf.length > maxBytes) throw deny("Image too large", 413);
    return buf;
  }
  const chunks = [];
  let total = 0;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (Date.now() > deadline) throw deny("Upstream timeout", 504);
    const { done, value } = await reader.read();
    if (done) break;
    if (value?.length) {
      total += value.length;
      if (total > maxBytes) throw deny("Image too large", 413);
      chunks.push(Buffer.from(value));
    }
  }
  return Buffer.concat(chunks, total);
}

/**
 * Safe remote fetch with manual redirects and DNS pinning.
 * @param {string} startUrl
 * @param {object} deps
 */
export async function fetchRemoteImageSafe(startUrl, deps = {}) {
  const fetchFn = deps.fetch || globalThis.fetch;
  const lookupFn = deps.lookup || dns.lookup.bind(dns);
  const maxRedirects = deps.maxRedirects ?? PROXY_MAX_REDIRECTS;
  const maxBytes = deps.maxBytes ?? PROXY_MAX_BYTES;
  const timeoutMs = deps.timeoutMs ?? PROXY_TIMEOUT_MS;

  let current = String(startUrl);
  const seen = new Set();

  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (seen.has(current)) throw deny("Redirect loop", 400);
    seen.add(current);

    let parsed;
    try {
      parsed = new URL(current);
    } catch {
      throw deny("Invalid URL");
    }
    const err = validateRemoteUrlObject(parsed);
    if (err) throw deny(err.error);

    // Local /uploads redirect target: stop remote fetch; caller may handle.
    if (parsed.pathname.startsWith("/uploads/")) {
      throw deny("URL not allowed");
    }

    const addresses = await assertPublicDnsAddresses(parsed.hostname, lookupFn);
    // Pin first validated public address for this hop (DNS rebinding guard).
    const pinned = addresses[0];
    const connectHost = pinned.address;
    const headers = {
      "User-Agent": "DaogreenSpec/1.0",
      Host: parsed.hostname,
      Accept: "image/*",
    };

    // Prefer undici-style dispatcher pin when available; else hostname literal URL.
    let fetchUrl = parsed.toString();
    let fetchOpts = {
      redirect: "manual",
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    };

    if (typeof deps.buildPinnedRequest === "function") {
      const built = deps.buildPinnedRequest(parsed, pinned);
      fetchUrl = built.url;
      fetchOpts = { ...fetchOpts, ...built.init };
    } else if (net.isIP(connectHost)) {
      // Rewrite to literal IP while keeping Host header (Node fetch supports this).
      const pinnedUrl = new URL(parsed.toString());
      pinnedUrl.hostname = connectHost.includes(":") ? `[${connectHost}]` : connectHost;
      fetchUrl = pinnedUrl.toString();
    }

    let res;
    try {
      res = await fetchFn(fetchUrl, fetchOpts);
    } catch (e) {
      if (e?.name === "TimeoutError" || e?.name === "AbortError") {
        throw deny("Upstream timeout", 504);
      }
      throw deny("Upstream fetch failed", 502);
    }

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get("location");
      if (!loc) throw deny("Invalid redirect", 502);
      let next;
      try {
        next = new URL(loc, parsed).toString();
      } catch {
        throw deny("Invalid redirect", 502);
      }
      const nextParsed = new URL(next);
      if (nextParsed.protocol !== "https:") throw deny("URL not allowed");
      // Redirect into local upload path: do not remote-follow.
      if (nextParsed.pathname.startsWith("/uploads/") || String(loc).startsWith("/uploads/")) {
        throw deny("URL not allowed");
      }
      current = next;
      continue;
    }

    if (!res.ok) throw deny("Upstream HTTP error", 502);

    const contentType = String(res.headers.get("content-type") || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (!contentType.startsWith("image/") || contentType.includes("svg")) {
      throw deny("Not an image", 415);
    }

    const buf = await readBodyLimited(res, maxBytes, timeoutMs);
    const type = assertSafeImageBuffer(buf, contentType);
    return { buffer: buf, contentType: type };
  }

  throw deny("Too many redirects", 400);
}

/**
 * @param {string} rawUrl
 * @param {{ allowPrivate?: boolean, allowRemote?: boolean }} [opts]
 * @param {object} [deps] — inject fetch/lookup/readFile for tests
 */
export async function loadProxyImage(rawUrl, opts = {}, deps = {}) {
  const parsed = parseProxyImageUrl(rawUrl, opts);
  if (parsed.error) {
    const err = new Error(parsed.error);
    err.status = 400;
    err.code = "PROXY_DENIED";
    throw err;
  }

  const readFile = deps.readFile || fs.readFile;

  if (parsed.kind === "local") {
    const buf = await readFile(parsed.filePath);
    if (buf.length > PROXY_MAX_BYTES) {
      throw deny("Image too large", 413);
    }
    if (looksLikeSvg(buf, { filename: parsed.filePath })) {
      throw deny("SVG not allowed", 415);
    }
    // Local catalog photos: prefer magic; fall back to extension for tiny fixtures.
    const magic = detectImageMagic(buf);
    const contentType = magic
      ? magic === "png"
        ? "image/png"
        : magic === "webp"
          ? "image/webp"
          : "image/jpeg"
      : contentTypeFromExt(parsed.filePath);
    if (!magic && contentType === "image/gif") {
      // allow legacy gif by extension only for local
      return { buffer: buf, contentType };
    }
    if (!magic && !/\.(jpe?g|png|webp|gif)$/i.test(parsed.filePath)) {
      throw deny("Not an image", 415);
    }
    return { buffer: buf, contentType };
  }

  return fetchRemoteImageSafe(parsed.url, deps);
}
