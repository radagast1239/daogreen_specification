import { Router } from "express";
import { loadProxyImage } from "../services/imageProxy.js";

const router = Router();

router.get("/image", async (req, res) => {
  try {
    const { buffer, contentType } = await loadProxyImage(req.query.url);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(buffer);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || "Image fetch failed" });
  }
});

export default router;
