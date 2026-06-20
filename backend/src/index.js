import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { db } from "./db.js";
import { runSeedIfEmpty } from "./seed.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;
const ADMIN_KEY = process.env.ADMIN_KEY || "daogreen-admin-change-me";

runSeedIfEmpty();

const { default: materialsApi } = await import("./routes/materialsApi.js");
const { default: projectsApi, clientRouter } = await import("./routes/projects.js");
const { default: adminApi } = await import("./routes/admin.js");

const isProd = process.env.NODE_ENV === "production";
const corsOrigins = process.env.CORS_ORIGIN?.split(",").filter(Boolean);

const app = express();
app.use(
  cors({
    origin: corsOrigins?.length ? corsOrigins : isProd ? true : ["http://localhost:5173"],
    credentials: true,
  })
);
app.use(express.json({ limit: "10mb" }));
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

function adminAuth(req, res, next) {
  const key = req.headers["x-admin-key"] || req.query.adminKey;
  if (key !== ADMIN_KEY) return res.status(401).json({ error: "Unauthorized" });
  next();
}

app.get("/api/health", (_req, res) => {
  const mats = db.prepare("SELECT COUNT(*) as c FROM materials").get();
  const projs = db.prepare("SELECT COUNT(*) as c FROM projects").get();
  res.json({ ok: true, materials: mats.c, projects: projs.c });
});

app.use("/api/materials", adminAuth, materialsApi);
app.use("/api/projects", adminAuth, projectsApi);
app.use("/api/admin", adminAuth, adminApi);
app.use("/api/client", clientRouter);

if (isProd) {
  const distPath = path.join(__dirname, "../../dist");
  app.use(express.static(distPath));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/uploads")) return next();
    res.sendFile(path.join(distPath, "index.html"));
  });
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Server error" });
});

app.listen(PORT, () => {
  console.log(`Daogreen Spec API → http://localhost:${PORT}`);
  console.log(`Admin key: ${ADMIN_KEY.slice(0, 8)}…`);
});
