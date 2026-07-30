/**
 * Stream a file from UPLOAD_ROOT with safe headers (no path leakage).
 */
import fs from "fs";
import path from "path";
import {
  contentDisposition,
  mimeFromFilename,
  resolvePathInsideUploadRoot,
  UploadValidationError,
  UPLOAD_PATH_INVALID,
} from "./uploadValidation.js";
import { resolveUploadRoot } from "./uploadRoot.js";

export function sendSafeUploadFile(res, { url, filename, inline = false, cacheControl = "private, no-store" }) {
  let abs;
  try {
    abs = resolvePathInsideUploadRoot(resolveUploadRoot(), url);
  } catch (e) {
    if (e instanceof UploadValidationError) {
      return res.status(e.status || 400).json({ error: e.code || UPLOAD_PATH_INVALID, code: e.code });
    }
    return res.status(400).json({ error: "Invalid path", code: UPLOAD_PATH_INVALID });
  }

  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    return res.status(404).json({ error: "Not found" });
  }

  const name = filename || path.basename(abs);
  const type = mimeFromFilename(name);
  const stat = fs.statSync(abs);
  res.setHeader("Content-Type", type);
  res.setHeader("Content-Length", String(stat.size));
  res.setHeader("Content-Disposition", contentDisposition(name, { inline }));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", cacheControl);
  const stream = fs.createReadStream(abs);
  stream.on("error", () => {
    if (!res.headersSent) res.status(500).json({ error: "Read failed" });
    else res.end();
  });
  stream.pipe(res);
}
