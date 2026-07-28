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
import {
  attachImagesToMaterials,
  extractExcelImages,
  importPhotosFromExcelBuffer,
} from "../services/excelImages.js";
import { bulkMatchUploads, importPhotosFromDir } from "../services/photoImport.js";
import { findDuplicateGroups, mergeMaterials } from "../services/materialMerge.js";
import { getPriceHistory } from "../services/priceHistory.js";
import { saveFile } from "../storage/index.js";
import { MaterialCatalogError, assertReplaceAllowed } from "../services/materialReferenceGuard.js";
import { resolveUploadRoot } from "../services/uploadRoot.js";
import {
  assertValidImageUpload,
  UploadValidationError,
} from "../services/uploadValidation.js";
import { multerFileFilter } from "../services/uploadFilter.js";
import XLSX from "xlsx";

function sendMaterialCatalogError(res, e) {
  if (e instanceof MaterialCatalogError) {
    return res.status(e.status || 409).json({
      error: e.code,
      code: e.code,
      message: e.message,
      ...(e.references ? { references: e.references } : {}),
    });
  }
  return null;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.join(resolveUploadRoot(), "public");
fs.mkdirSync(uploadDir, { recursive: true });

const memUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: multerFileFilter(),
});
const memUploadDocs = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: multerFileFilter({ allowDocs: true }),
});

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

router.get("/meta/duplicates", (_req, res) => res.json(findDuplicateGroups()));

router.post("/merge", (req, res) => {
  try {
    res.json(mergeMaterials(req.body.keepId, req.body.duplicateId));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/:id/price-history", (req, res) => {
  res.json(getPriceHistory(req.params.id));
});

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
  try {
    const existing = getMaterial(req.params.id);
    if (!existing) return res.status(404).json({ error: "Not found" });
    deleteMaterial(req.params.id);
    res.status(204).end();
  } catch (e) {
    if (sendMaterialCatalogError(res, e)) return;
    res.status(400).json({ error: e.message });
  }
});

router.post("/import/excel", memUploadDocs.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file" });
  const moduleName = req.body.module || "Импорт";
  const mode = req.body.mode || "merge";
  const withPhotos = req.body.photos !== "false";
  try {
    // Fail closed before parsing / photo side effects when replace is requested.
    assertReplaceAllowed(mode);
    const result = parseExcelBuffer(req.file.buffer, moduleName);
    let photosLinked = 0;
    if (withPhotos) {
      const wb = XLSX.read(req.file.buffer, { type: "buffer" });
      const images = await extractExcelImages(req.file.buffer, wb.SheetNames);
      photosLinked = await attachImagesToMaterials(result.materials, images, uploadDir);
    }
    const count = bulkUpsertMaterials(result.materials, mode);
    res.json({ ...result, imported: count, photosLinked });
  } catch (e) {
    if (sendMaterialCatalogError(res, e)) return;
    res.status(400).json({ error: e.message });
  }
});

router.post("/import/excel-photos", memUpload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file" });
  try {
    const moduleName = req.body.module || undefined;
    const materials = listMaterials();
    const result = await importPhotosFromExcelBuffer(
      req.file.buffer,
      req.file.originalname || "import.xlsx",
      materials,
      uploadDir,
      updateMaterial,
      moduleName
    );
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/upload-photo", memUpload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file" });
  try {
    assertValidImageUpload(req.file);
    const ext = path.extname(req.file.originalname).toLowerCase() || ".jpg";
    const filename = `${nanoid(12)}${ext}`;
    const url = await saveFile(req.file.buffer, filename, { visibility: "public" });
    res.json({ url, filename });
  } catch (e) {
    if (e instanceof UploadValidationError) {
      return res.status(e.status || 400).json({ error: e.code, code: e.code, message: e.message });
    }
    res.status(500).json({ error: e.message });
  }
});

router.post("/bulk-photos", memUpload.array("files", 500), async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: "No files" });
  try {
    const result = await bulkMatchUploads(req.files, uploadDir);
    res.json(result);
  } catch (e) {
    if (e instanceof UploadValidationError) {
      return res.status(e.status || 400).json({ error: e.code, code: e.code, message: e.message });
    }
    res.status(500).json({ error: e.message });
  }
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
