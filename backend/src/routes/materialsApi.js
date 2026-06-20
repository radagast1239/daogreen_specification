import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { nanoid } from "nanoid";
import {
  listMaterials,
  getMaterial,
  createMaterial,
  updateMaterial,
  deleteMaterial,
  bulkUpsertMaterials,
  listModules,
  upsertModule,
} from "./materials.js";
import { parseExcelBuffer } from "../services/excelImport.js";
import { bulkMatchUploads, importPhotosFromDir } from "../services/photoImport.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.join(__dirname, "../../uploads");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, `${nanoid(12)}${path.extname(file.originalname)}`),
});

const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } });
const memUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const router = Router();

router.get("/", (req, res) => {
  res.json(
    listMaterials({
      module: req.query.module,
      category: req.query.category,
      q: req.query.q,
    })
  );
});

router.get("/modules", (_req, res) => res.json(listModules()));

router.get("/:id", (req, res) => {
  const m = getMaterial(req.params.id);
  if (!m) return res.status(404).json({ error: "Not found" });
  res.json(m);
});

router.post("/", (req, res) => {
  try {
    res.status(201).json(createMaterial(req.body));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.patch("/:id", (req, res) => {
  const m = updateMaterial(req.params.id, req.body);
  if (!m) return res.status(404).json({ error: "Not found" });
  res.json(m);
});

router.delete("/:id", (req, res) => {
  deleteMaterial(req.params.id);
  res.status(204).end();
});

router.post("/import/excel", memUpload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file" });
  const moduleName = req.body.module || "Импорт";
  const mode = req.body.mode || "merge";
  const result = parseExcelBuffer(req.file.buffer, moduleName);
  const count = bulkUpsertMaterials(result.materials, mode);
  res.json({ ...result, imported: count });
});

router.post("/upload-photo", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file" });
  const url = `/uploads/${req.file.filename}`;
  res.json({ url, filename: req.file.filename });
});

router.post("/bulk-photos", memUpload.array("files", 500), (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: "No files" });
  const result = bulkMatchUploads(req.files, uploadDir);
  res.json(result);
});

router.post("/import-photos-folder", (_req, res) => {
  const sourceDir = path.join(__dirname, "../../../materials-photos");
  const result = importPhotosFromDir(sourceDir, uploadDir);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

router.post("/modules", (req, res) => {
  upsertModule(req.body);
  res.json(req.body);
});

export default router;
