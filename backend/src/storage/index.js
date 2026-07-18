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
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultLocalDir = path.join(__dirname, "../../uploads");

const driver = process.env.STORAGE_DRIVER || "local";

export function storageDriver() {
  return driver;
}

/** Resolve local uploads directory (respects UPLOAD_ROOT for shared/temp layouts). */
export function localUploadDir() {
  return process.env.UPLOAD_ROOT ? path.resolve(process.env.UPLOAD_ROOT) : defaultLocalDir;
}

/** Save buffer to storage; returns public URL path or absolute URL */
export async function saveFile(buffer, filename) {
  if (driver === "s3") {
    return saveS3(buffer, filename);
  }
  const localDir = localUploadDir();
  fs.mkdirSync(localDir, { recursive: true });
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!safe || safe.includes("..")) {
    throw new Error("Invalid upload filename");
  }
  const dest = path.join(localDir, safe);
  const root = path.resolve(localDir);
  const abs = path.resolve(dest);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (abs !== root && !abs.startsWith(rootWithSep)) {
    throw new Error("Upload path escapes upload root");
  }
  const publicUrl = `/uploads/${safe}`;
  if (fs.existsSync(dest)) {
    // Refuse overwrite of binaries pinned by a published release.
    const { assertCanDeleteOrOverwriteAsset } = await import("../services/publishedAssetRetention.js");
    assertCanDeleteOrOverwriteAsset({ url: publicUrl });
  }
  fs.writeFileSync(dest, buffer);
  const base = process.env.S3_PUBLIC_URL?.replace(/\/$/, "");
  return base ? `${base}/${safe}` : publicUrl;
}

async function saveS3(buffer, filename) {
  const bucket = process.env.S3_BUCKET;
  const region = process.env.S3_REGION || "ru-central1";
  if (!bucket || !process.env.S3_ACCESS_KEY) {
    throw new Error("S3 not configured: set S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY");
  }
  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
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
      Key: safe,
      Body: buffer,
      ContentType: mimeFromName(safe),
    })
  );
  const publicBase = process.env.S3_PUBLIC_URL?.replace(/\/$/, "");
  if (publicBase) return `${publicBase}/${safe}`;
  return `https://${bucket}.s3.${region}.amazonaws.com/${safe}`;
}

function mimeFromName(name) {
  const ext = path.extname(name).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}
