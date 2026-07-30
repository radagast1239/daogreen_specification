import { Router } from "express";
import { loadProxyImage } from "../services/imageProxy.js";

const router = Router();

router.get("/image", async (req, res) => {
  try {
    // Admin auth is applied on mount — still no arbitrary remote SSRF.
    const { buffer, contentType } = await loadProxyImage(req.query.url, {
      allowPrivate: true,
      allowRemote: false,
    });
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(buffer);
  } catch (e) {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const status = e.status || 500;
    // Do not reflect request URL in errors.
    const safe =
      status === 413
        ? "Image too large"
        : status === 415
          ? "Not an image"
          : status === 400
            ? "URL not allowed"
            : "Image fetch failed";
    res.status(status).json({ error: safe });
  }
});

export default router;
