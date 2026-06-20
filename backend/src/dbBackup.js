/**
 * Опциональная синхронизация файла SQLite с Supabase Storage (бесплатный тариф).
 * Нужно для Render Free: без диска база сбрасывается при редеплое.
 *
 * Переменные:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY, DB_BACKUP_BUCKET (default: daogreen-db)
 */
import fs from "fs";
import path from "path";

const BUCKET = process.env.DB_BACKUP_BUCKET || "daogreen-db";
const REMOTE_FILE = "daogreen.db";

function supabaseCfg() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return { url, key };
}

async function storage(pathname, { method = "GET", body, contentType } = {}) {
  const cfg = supabaseCfg();
  if (!cfg) return null;
  const endpoint = `${cfg.url}/storage/v1/object/${BUCKET}/${pathname}`;
  const res = await fetch(endpoint, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.key}`,
      apikey: cfg.key,
      ...(contentType ? { "Content-Type": contentType } : {}),
    },
    body,
  });
  return res;
}

export async function ensureBucket() {
  const cfg = supabaseCfg();
  if (!cfg) return false;
  const res = await fetch(`${cfg.url}/storage/v1/bucket`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.key}`,
      apikey: cfg.key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }),
  });
  if (res.ok || res.status === 409) return true;
  console.warn("Supabase bucket:", await res.text());
  return false;
}

export async function downloadDb(localPath) {
  const cfg = supabaseCfg();
  if (!cfg) return false;
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  const res = await storage(REMOTE_FILE);
  if (!res) return false;
  if (res.status === 404) {
    console.log("DB backup: нет файла в облаке — будет создана новая база");
    return false;
  }
  if (!res.ok) {
    console.warn("DB backup download failed:", res.status, await res.text());
    return false;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(localPath, buf);
  console.log(`DB backup: загружено ${buf.length} байт из Supabase`);
  return true;
}

export async function uploadDb(localPath) {
  const cfg = supabaseCfg();
  if (!cfg || !fs.existsSync(localPath)) return false;
  const body = fs.readFileSync(localPath);
  const res = await storage(REMOTE_FILE, {
    method: "POST",
    body,
    contentType: "application/x-sqlite3",
  });
  if (!res.ok) {
    const alt = await storage(REMOTE_FILE, {
      method: "PUT",
      body,
      contentType: "application/x-sqlite3",
    });
    if (!alt.ok) {
      console.warn("DB backup upload failed:", await alt.text());
      return false;
    }
  }
  console.log(`DB backup: сохранено ${body.length} байт в Supabase`);
  return true;
}

export function startDbBackupLoop(localPath, intervalMs = 60_000) {
  if (!supabaseCfg()) {
    console.log("DB backup: Supabase не настроен — данные только локально (на Render Free сбросятся при редеплое)");
    return () => {};
  }

  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await uploadDb(localPath);
    } catch (e) {
      console.warn("DB backup:", e.message);
    } finally {
      busy = false;
    }
  };

  const id = setInterval(tick, intervalMs);
  const onStop = async () => {
    clearInterval(id);
    await uploadDb(localPath);
  };
  process.on("SIGTERM", onStop);
  process.on("SIGINT", onStop);

  return onStop;
}

export async function initRemoteDb(localPath) {
  if (!supabaseCfg()) return;
  await ensureBucket();
  await downloadDb(localPath);
}
