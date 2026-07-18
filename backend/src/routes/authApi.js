import express from "express";
import rateLimit from "express-rate-limit";
import {
  getAdminAccessMode,
  isMagicLinkConfigured,
  getMagicLinkConfigurationError,
  validateMagicLinkToken,
  createAdminSessionToken,
  serializeAdminSessionCookie,
  clearAdminSessionCookie,
} from "../adminSession.js";

const MAGIC_TOKEN_MAX = 512;
const PRODUCTION_ORIGIN = "https://spec.nikita-daogreen.ru";
const PRODUCTION_HOST = "spec.nikita-daogreen.ru";
const isProd = () => process.env.NODE_ENV === "production";

function publicUnauthorized(res) {
  return res.status(401).json({ error: "Unauthorized" });
}

function publicDisabled(res) {
  return res.status(404).json({ error: "Not found" });
}

function publicMisconfigured(res) {
  return res.status(503).json({ error: getMagicLinkConfigurationError() || "Magic-link authentication is unavailable" });
}

function readAllowedOrigins() {
  const isProduction = isProd();
  const corsOrigins = process.env.CORS_ORIGIN?.split(",").map((s) => s.trim()).filter(Boolean);
  const defaultProdOrigins = [PRODUCTION_ORIGIN];
  return isProduction
    ? defaultProdOrigins
    : corsOrigins?.length
    ? corsOrigins
    : ["http://localhost:5173", "http://localhost:4173", "http://127.0.0.1:5173", "http://127.0.0.1:4173"];
}

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin || origin === "null") return !isProd();
  if (isProd() && origin !== PRODUCTION_ORIGIN) return false;
  const allowed = readAllowedOrigins();
  if (allowed.includes(origin)) return true;
  // Local smoke helpers
  if (!isProd()) {
    try {
      const u = new URL(origin);
      if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return true;
    } catch {
      return false;
    }
  }
  return false;
}

function hostAllowed(req) {
  const host = String(req.headers.host || "").toLowerCase();
  if (isProd()) return host === PRODUCTION_HOST || host === `${PRODUCTION_HOST}:443`;
  try {
    const parsed = new URL(`http://${host}`);
    return (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") && /^\d+$/.test(parsed.port);
  } catch {
    return false;
  }
}

function isJsonPost(req) {
  if (req.method !== "POST") return false;
  const ct = String(req.headers["content-type"] || "").toLowerCase();
  return ct.includes("application/json");
}

const magicLinkLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isProd() ? 20 : 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests" },
});

const router = express.Router();

router.post("/magic-link", magicLinkLimiter, (req, res) => {
  if (getAdminAccessMode() !== "magic-link") {
    return publicDisabled(res);
  }
  if (!isJsonPost(req)) {
    return publicUnauthorized(res);
  }
  if (!originAllowed(req) || !hostAllowed(req)) {
    return publicUnauthorized(res);
  }
  if (!isMagicLinkConfigured()) {
    return publicMisconfigured(res);
  }

  const token = req.body?.token;
  if (typeof token !== "string" || !token || token.length > MAGIC_TOKEN_MAX) {
    return publicUnauthorized(res);
  }
  if (!validateMagicLinkToken(token)) {
    return publicUnauthorized(res);
  }

  const sessionToken = createAdminSessionToken();
  if (!sessionToken) {
    return publicUnauthorized(res);
  }

  res.setHeader("Set-Cookie", serializeAdminSessionCookie(sessionToken, { isProd: isProd() }));
  return res.status(200).json({ ok: true });
});

router.get("/magic-link", (_req, res) => publicDisabled(res));
router.put("/magic-link", (_req, res) => publicDisabled(res));
router.patch("/magic-link", (_req, res) => publicDisabled(res));
router.delete("/magic-link", (_req, res) => publicDisabled(res));

router.post("/logout", (req, res) => {
  res.setHeader("Set-Cookie", clearAdminSessionCookie({ isProd: isProd() }));
  return res.status(200).json({ ok: true });
});

export default router;
