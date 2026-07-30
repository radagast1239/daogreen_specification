import "dotenv/config";
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { initRemoteDb, startDbBackupLoop, startLocalBackupLoop, backupStatus } from "./dbBackup.js";
import { initDb, db } from "./db.js";
import { getAdminAccessMode } from "./adminSession.js";
import { applySecurityMiddleware } from "./middleware/security.js";
import { ensurePreMigrationBackup } from "./sqliteBackup.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;

const dbPath = path.resolve(
  process.env.DATABASE_PATH || path.join(__dirname, "../data/daogreen.db")
);
process.env.DATABASE_PATH = dbPath;

// 1) remote restore only if local absent  2) pre-migration backup  3) initDb  4) auth migrate
await initRemoteDb(dbPath);
try {
  if (fs.existsSync(dbPath) && fs.statSync(dbPath).size > 0) {
    ensurePreMigrationBackup(dbPath, "preMigrationBackup.schema.v1");
  }
} catch (err) {
  console.error(`[startup] ${err.code || "PRE_MIGRATION_BACKUP_REQUIRED"}: ${err.message}`);
  process.exit(1);
}
initDb();
// Import auth AFTER initRemoteDb/initDb so migrateAdminKeys does not create an empty local DB
// before a cloud restore, and so pre-migration backup can run first.
const { adminAuthMiddleware } = await import("./auth.js");
const { initActivityLog } = await import("./services/activityLog.js");
initActivityLog();

const { loadPublishRulesConfig } = await import("./services/publishRules.js");
loadPublishRulesConfig();

const { runSeedIfEmpty } = await import("./seed.js");
runSeedIfEmpty();
const stopBackupLoop =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
    ? startDbBackupLoop(dbPath)
    : startLocalBackupLoop(dbPath);

const { default: materialsApi } = await import("./routes/materialsApi.js");
const { default: projectsApi, clientRouter } = await import("./routes/projects.js");
const { default: adminApi } = await import("./routes/admin.js");
const { default: presetsApi } = await import("./routes/presets.js");
const { default: suppliersApi } = await import("./routes/suppliersApi.js");
const { default: mediaApi } = await import("./routes/media.js");
const { default: frameDrawingsApi } = await import("./routes/frameDrawings.js");
const { default: authApi } = await import("./routes/authApi.js");

const isProd = process.env.NODE_ENV === "production";
const corsOrigins = process.env.CORS_ORIGIN?.split(",").map((s) => s.trim()).filter(Boolean);
const defaultProdOrigins = ["https://spec.nikita-daogreen.ru"];
const defaultDevOrigins = ["http://localhost:5173", "http://localhost:4173", "http://127.0.0.1:5173", "http://127.0.0.1:4173"];
const corsOriginList = isProd ? defaultProdOrigins : corsOrigins?.length ? corsOrigins : defaultDevOrigins;

const app = express();
if (isProd) app.set("trust proxy", "loopback");
applySecurityMiddleware(app, { isProd });
app.use(
  cors({
    origin: corsOriginList,
    credentials: true,
  })
);
app.use(express.json({ limit: "10mb" }));
const { assertUploadRootForStartup } = await import("./services/uploadRoot.js");
let uploadRoot;
try {
  uploadRoot = assertUploadRootForStartup();
} catch (err) {
  console.error(`[startup] ${err.code || "UPLOAD_ROOT"}: ${err.message}`);
  process.exit(1);
}
// Public catalog only (material photos, branding). Project/release/frame files are private.
app.use("/uploads/public", express.static(path.join(uploadRoot, "public")));

function adminAuth(req, res, next) {
  adminAuthMiddleware(req, res, next);
}

app.get("/api/health", (_req, res) => {
  const mats = db.prepare("SELECT COUNT(*) as c FROM materials").get();
  const projs = db.prepare("SELECT COUNT(*) as c FROM projects").get();
  const backup = backupStatus();
  res.json({
    ok: true,
    materials: mats.c,
    projects: projs.c,
    dbBackup: backup.ok,
    backup,
  });
});

// Magic-link exchange + logout — no admin middleware (sets/clears session cookie).
app.use("/api/auth", authApi);

app.use("/api/materials", adminAuth, materialsApi);
app.use("/api/projects", adminAuth, projectsApi);
app.use("/api/presets", adminAuth, presetsApi);
app.use("/api/suppliers", adminAuth, suppliersApi);
app.use("/api/admin", adminAuth, adminApi);
app.use("/api/media", adminAuth, mediaApi);
app.use("/api/frame-drawings", adminAuth, frameDrawingsApi);
app.use("/api/client", clientRouter);

if (isProd) {
  const distPath = path.join(__dirname, "../../dist");
  app.use(
    express.static(distPath, {
      setHeaders(res, filePath) {
        if (
          filePath.endsWith(`${path.sep}index.html`) ||
          filePath.endsWith("sw.js") ||
          filePath.endsWith("manifest.webmanifest")
        ) {
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        }
      },
    })
  );
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/uploads")) return next();
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.sendFile(path.join(distPath, "index.html"));
  });
}

app.use((err, _req, res, _next) => {
  console.error(err);
  const message = isProd ? "Server error" : err.message || "Server error";
  res.status(err.status || 500).json({ error: message });
});

const server = app.listen(PORT, () => {
  console.log(`Daogreen Spec API → http://localhost:${PORT}`);
  const mode = getAdminAccessMode();
  console.log(
    mode === "magic-link"
      ? "Admin authentication configured: magic-link"
      : "Admin authentication configured: key fallback"
  );
});

async function gracefulShutdown(signal) {
  console.log(`Graceful shutdown: ${signal}`);
  try {
    if (typeof stopBackupLoop === "function") {
      await stopBackupLoop();
    }
  } catch (err) {
    console.warn("Backup loop shutdown:", err.message);
  }
  server.close((err) => {
    if (err) console.warn("HTTP close:", err.message);
    process.exit(err ? 1 : 0);
  });
  setTimeout(() => {
    console.warn("Forced exit after graceful shutdown timeout");
    process.exit(1);
  }, 12000).unref();
}

process.once("SIGTERM", () => {
  gracefulShutdown("SIGTERM");
});
process.once("SIGINT", () => {
  gracefulShutdown("SIGINT");
});
