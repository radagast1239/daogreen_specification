/** Токен клиента: из URL (ссылка) или заголовка (API без утечки в Referer). */

export function clientTokenFromRequest(req) {
  let param = String(req.params?.token || "").trim();
  if (!param) {
    const parts = String(req.path || "")
      .split("/")
      .filter(Boolean);
    if (parts[0] === "p" && parts[1]) param = decodeURIComponent(parts[1]);
    else if (parts[0] && parts[0] !== "items") param = decodeURIComponent(parts[0]);
  }
  const header = String(req.headers["x-client-token"] || "").trim();
  const bearer = String(req.headers.authorization || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  const fromHeader = header || bearer;
  if (fromHeader && param && fromHeader !== param) {
    const err = new Error("Token mismatch");
    err.status = 403;
    throw err;
  }
  return fromHeader || param;
}

export function clientAuthMiddleware(req, res, next) {
  try {
    const token = clientTokenFromRequest(req);
    if (!token) return res.status(401).json({ error: "Client token required" });
    req.clientToken = token;
    next();
  } catch (e) {
    res.status(e.status || 403).json({ error: e.message || "Forbidden" });
  }
}
