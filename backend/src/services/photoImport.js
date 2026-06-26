import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";
import { listMaterials, updateMaterial } from "../routes/materials.js";
import { localUploadDir, saveFile, storageDriver } from "../storage/index.js";

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

export function slugify(name) {
  return (name || "")
    .toLowerCase()
    .replace(/[\\/"']/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^a-zа-яё0-9_]/gi, "")
    .slice(0, 80);
}

/** m001.jpg → m001, иначе slug по имени файла */
export function fileKey(filename) {
  const base = path.basename(filename, path.extname(filename)).toLowerCase();
  if (/^m\d{3,}$/i.test(base)) return base;
  return slugify(base);
}

export function matchMaterialByFile(materials, filename) {
  const key = fileKey(filename);
  const byId = materials.find((m) => m.id.toLowerCase() === key);
  if (byId) return byId;
  const bySlug = materials.find((m) => slugify(m.name) === key);
  if (bySlug) return bySlug;
  const partial = materials.filter((m) => {
    const sn = slugify(m.name);
    return sn && (sn.includes(key) || key.includes(sn));
  });
  if (partial.length === 1) return partial[0];
  return null;
}

function resolveUploadDir(uploadDir) {
  return uploadDir || localUploadDir();
}

export function importPhotosFromDir(sourceDir, uploadDir, { copy = true } = {}) {
  if (!fs.existsSync(sourceDir)) {
    return { matched: [], unmatched: [], error: `Папка не найдена: ${sourceDir}` };
  }

  const destDir = resolveUploadDir(uploadDir);
  if (storageDriver() === "local") fs.mkdirSync(destDir, { recursive: true });

  const materials = listMaterials();
  const matched = [];
  const unmatched = [];

  const files = fs.readdirSync(sourceDir).filter((f) => IMAGE_EXT.has(path.extname(f).toLowerCase()));

  for (const file of files) {
    const mat = matchMaterialByFile(materials, file);
    if (!mat) {
      unmatched.push(file);
      continue;
    }

    const ext = path.extname(file).toLowerCase();
    const destName = `${mat.id}${ext}`;
    const srcPath = path.join(sourceDir, file);

    if (storageDriver() === "local") {
      const destPath = path.join(destDir, destName);
      if (copy) fs.copyFileSync(srcPath, destPath);
      else fs.renameSync(srcPath, destPath);
      const url = `/uploads/${destName}`;
      updateMaterial(mat.id, { imageUrl: url, photoUrl: url });
      matched.push({ file, materialId: mat.id, name: mat.name, url });
    } else {
      unmatched.push(file);
    }
  }

  if (storageDriver() === "s3" && files.length) {
    return {
      matched,
      unmatched: files,
      total: files.length,
      error: "Импорт из папки при STORAGE_DRIVER=s3 — загрузите файлы через bulk-photos",
    };
  }

  return { matched, unmatched, total: files.length };
}

export async function saveUploadedPhoto(file, uploadDir) {
  const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
  const destName = `${nanoid(12)}${ext}`;
  return saveFile(file.buffer, destName);
}

export async function bulkMatchUploads(files, uploadDir) {
  const materials = listMaterials();
  const matched = [];
  const unmatched = [];

  for (const file of files) {
    const mat = matchMaterialByFile(materials, file.originalname);
    if (!mat) {
      unmatched.push(file.originalname);
      continue;
    }

    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    const destName = `${mat.id}${ext}`;
    const url = await saveFile(file.buffer, destName);

    updateMaterial(mat.id, { imageUrl: url, photoUrl: url });
    matched.push({ file: file.originalname, materialId: mat.id, name: mat.name, url });
  }

  return { matched, unmatched, total: files.length };
}
