import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { initRemoteDb, startDbBackupLoop, startLocalBackupLoop, backupStatus } from "./dbBackup.js";
import { initDb, db, getDbPath } from "./db.js";
import { adminAuthMiddleware } from "./auth.js";
import { applySecurityMiddleware } from "./middleware/security.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;

const dbPath = path.resolve(
  process.env.DATABASE_PATH || path.join(__dirname, "../data/daogreen.db")
);
process.env.DATABASE_PATH = dbPath;

await initRemoteDb(dbPath);
initDb();
const { initActivityLog } = await import("./services/activityLog.js");
initActivityLog();

const { loadPublishRulesConfig } = await import("./services/publishRules.js");
loadPublishRulesConfig();

const { runSeedIfEmpty } = await import("./seed.js");
runSeedIfEmpty();
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
  startDbBackupLoop(dbPath);
} else {
  startLocalBackupLoop(dbPath);
}

const { default: materialsApi } = await import("./routes/materialsApi.js");
const { default: projectsApi, clientRouter } = await import("./routes/projects.js");
const { default: adminApi } = await import("./routes/admin.js");
const { default: presetsApi } = await import("./routes/presets.js");
const { default: suppliersApi } = await import("./routes/suppliersApi.js");

const isProd = process.env.NODE_ENV === "production";
const corsOrigins = process.env.CORS_ORIGIN?.split(",").map((s) => s.trim()).filter(Boolean);
const defaultProdOrigins = [
  "http://62.233.35.206",
  "https://62.233.35.206",
  "http://spec.nikita-daogreen.ru",
  "https://spec.nikita-daogreen.ru",
];
const corsOriginList = corsOrigins?.length ? corsOrigins : isProd ? defaultProdOrigins : ["http://localhost:5173", "http://localhost:4173"];

const app = express();
if (isProd) app.set("trust proxy", 1);
applySecurityMiddleware(app, { isProd });
app.use(
  cors({
    origin: corsOriginList,
    credentials: true,
  })
);
app.use(express.json({ limit: "10mb" }));
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

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

app.use("/api/materials", adminAuth, materialsApi);
app.use("/api/projects", adminAuth, projectsApi);
app.use("/api/presets", adminAuth, presetsApi);
app.use("/api/suppliers", adminAuth, suppliersApi);
app.use("/api/admin", adminAuth, adminApi);
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

app.listen(PORT, () => {
  console.log(`Daogreen Spec API → http://localhost:${PORT}`);
  const keyHint = process.env.ADMIN_KEY || "(multi-key mode)";
  console.log(`Admin key: ${typeof keyHint === "string" && keyHint.length > 8 ? `${keyHint.slice(0, 8)}…` : keyHint}`);
});
