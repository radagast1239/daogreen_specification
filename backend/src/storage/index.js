/**
 * File storage: local disk (default) or S3-compatible (MinIO, AWS, Yandex Object Storage).
 *
 * Env:
 *   STORAGE_DRIVER=local|s3  (default local)
 *   S3_BUCKET, S3_REGION, S3_ENDPOINT (optional for MinIO)
 *   S3_ACCESS_KEY, S3_SECRET_KEY
 *   S3_PUBLIC_URL — CDN/public base for URLs (else /uploads/)
 */
import fs from "fs";
import path from "path";
import { resolveUploadRoot } from "../services/uploadRoot.js";
import { sanitizeUploadBasename, mimeFromFilename } from "../services/uploadValidation.js";

const driver = process.env.STORAGE_DRIVER || "local";

export function storageDriver() {
  return driver;
}

/** Resolve local uploads directory (respects UPLOAD_ROOT for shared/temp layouts). */
export function localUploadDir() {
  return resolveUploadRoot();
}

/**
 * Save buffer to storage; returns URL path under /uploads/...
 * @param {Buffer} buffer
 * @param {string} filename basename (sanitized)
 * @param {{ visibility?: "public"|"private", subdir?: string }} [options]
 *   - visibility "public" (default): writes under public/ → /uploads/public/...
 *   - visibility "private": writes under subdir (required) → /uploads/{subdir}/...
 */
export async function saveFile(buffer, filename, options = {}) {
  const visibility = options.visibility || "public";
  const subdirRaw = options.subdir != null ? String(options.subdir).replace(/\\/g, "/") : "";
  let subdir;
  if (visibility === "public") {
    subdir = subdirRaw ? `public/${subdirRaw.replace(/^\/+|\/+$/g, "")}` : "public";
  } else {
    subdir = subdirRaw.replace(/^\/+|\/+$/g, "");
    if (!subdir || subdir.includes("..")) {
      throw new Error("Private uploads require a safe subdir");
    }
  }
  const safe = sanitizeUploadBasename(filename, "file");
  const rel = `${subdir}/${safe}`.replace(/\\/g, "/");

  if (driver === "s3") {
    return saveS3(buffer, rel);
  }

  const root = resolveUploadRoot();
  const dest = path.join(root, ...rel.split("/"));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) {
    const { assertCanDeleteOrOverwriteAsset } = await import("../services/publishedAssetRetention.js");
    assertCanDeleteOrOverwriteAsset({ url: `/uploads/${rel}` });
  }
  fs.writeFileSync(dest, buffer);
  const base = process.env.S3_PUBLIC_URL?.replace(/\/$/, "");
  return base ? `${base}/${rel}` : `/uploads/${rel}`;
}

async function saveS3(buffer, relKey) {
  const bucket = process.env.S3_BUCKET;
  const region = process.env.S3_REGION || "ru-central1";
  if (!bucket || !process.env.S3_ACCESS_KEY) {
    throw new Error("S3 not configured: set S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY");
  }
  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
  const client = new S3Client({
    region,
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: !!process.env.S3_ENDPOINT,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY,
      secretAccessKey: process.env.S3_SECRET_KEY,
    },
  });
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: relKey,
      Body: buffer,
      ContentType: mimeFromFilename(relKey),
    }),
  );
  const publicBase = process.env.S3_PUBLIC_URL?.replace(/\/$/, "");
  if (publicBase) return `${publicBase}/${relKey}`;
  return `https://${bucket}.s3.${region}.amazonaws.com/${relKey}`;
}
