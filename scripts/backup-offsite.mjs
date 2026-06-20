#!/usr/bin/env node
/**
 * Upload latest local backup to Supabase Storage or S3-compatible bucket.
 * Env: SUPABASE_* or BACKUP_S3_* (see scripts/setup-backup-env.sh)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_DIR = process.env.BACKUP_LOCAL_DIR || "/opt/backups/daogreen";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 1) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
}

loadEnvFile("/etc/daogreen/backup.env");

function latestMatching(prefix, ext) {
  if (!fs.existsSync(LOCAL_DIR)) return null;
  const files = fs
    .readdirSync(LOCAL_DIR)
    .filter((f) => f.startsWith(prefix) && f.endsWith(ext))
    .map((f) => ({ f, m: fs.statSync(path.join(LOCAL_DIR, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  return files[0]?.f || null;
}

async function uploadSupabase(localPath, remoteName) {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_KEY;
  const bucket = process.env.DB_BACKUP_BUCKET || "daogreen-db";
  if (!url || !key) return false;

  const body = fs.readFileSync(localPath);
  const endpoint = `${url}/storage/v1/object/${bucket}/backups/${remoteName}`;
  let res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      "Content-Type": "application/octet-stream",
    },
    body,
  });
  if (!res.ok && res.status === 409) {
    res = await fetch(endpoint, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
        "Content-Type": "application/octet-stream",
      },
      body,
    });
  }
  if (!res.ok) {
    console.error("Supabase upload failed:", res.status, await res.text());
    return false;
  }
  console.log(`Supabase OK: backups/${remoteName} (${body.length} bytes)`);
  return true;
}

async function uploadS3(localPath, remoteName) {
  const bucket = process.env.BACKUP_S3_BUCKET || process.env.S3_BUCKET;
  const region = process.env.BACKUP_S3_REGION || process.env.S3_REGION || "ru-central1";
  if (!bucket || !process.env.S3_ACCESS_KEY) return false;

  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
  const client = new S3Client({
    region,
    endpoint: process.env.S3_ENDPOINT || process.env.BACKUP_S3_ENDPOINT || undefined,
    forcePathStyle: !!(process.env.S3_ENDPOINT || process.env.BACKUP_S3_ENDPOINT),
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY,
      secretAccessKey: process.env.S3_SECRET_KEY,
    },
  });
  const body = fs.readFileSync(localPath);
  const key = `backups/${remoteName}`;
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: "application/octet-stream",
    })
  );
  console.log(`S3 OK: ${key} (${body.length} bytes)`);
  return true;
}

async function main() {
  const dbFile = latestMatching("daogreen_", ".db");
  const uploadsFile = latestMatching("uploads_", ".tar.gz");
  if (!dbFile && !uploadsFile) {
    console.log("No local backups in", LOCAL_DIR);
    process.exit(0);
  }

  let ok = 0;
  if (dbFile) {
    const p = path.join(LOCAL_DIR, dbFile);
    if (await uploadSupabase(p, dbFile)) ok++;
    if (await uploadS3(p, dbFile)) ok++;
  }
  if (uploadsFile) {
    const p = path.join(LOCAL_DIR, uploadsFile);
    if (await uploadSupabase(p, uploadsFile)) ok++;
    if (await uploadS3(p, uploadsFile)) ok++;
  }

  if (!process.env.SUPABASE_URL && !process.env.S3_ACCESS_KEY) {
    console.log("Offsite backup skipped: set SUPABASE_* or S3_* in /etc/daogreen/backup.env");
    process.exit(0);
  }
  process.exit(ok > 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
