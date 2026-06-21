import fs from "fs";
import path from "path";
import JSZip from "jszip";
import XLSX from "xlsx";
import { parseExcelBuffer } from "./excelImport.js";
import { materialInModule } from "../../../shared/materialModules.js";

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".emf", ".wmf"]);

function parseDrawingAnchors(xml) {
  const anchors = [];
  const blocks = xml.split(/<xdr:(?:twoCellAnchor|oneCellAnchor)/g).slice(1);
  for (const block of blocks) {
    const from = block.match(/<xdr:from>[\s\S]*?<xdr:col>(\d+)<\/xdr:col>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>/);
    if (!from) continue;
    const embed = block.match(/r:embed="([^"]+)"/);
    if (!embed) continue;
    anchors.push({ col: Number(from[1]), row: Number(from[2]), embedId: embed[1] });
  }
  return anchors;
}

function parseRels(xml) {
  const map = new Map();
  const re = /Relationship[^>]+Id="([^"]+)"[^>]+Target="([^"]+)"/g;
  let m;
  while ((m = re.exec(xml))) {
    let target = m[2].replace(/^\.\.\//, "");
    if (!target.startsWith("xl/")) target = `xl/${target}`;
    map.set(m[1], target);
  }
  return map;
}

export async function extractExcelImages(buffer, sheetNames = []) {
  const zip = await JSZip.loadAsync(buffer);
  const media = new Map();
  for (const [p, entry] of Object.entries(zip.files)) {
    if (!p.startsWith("xl/media/") || entry.dir) continue;
    const ext = p.slice(p.lastIndexOf(".")).toLowerCase();
    if (!IMAGE_EXT.has(ext)) continue;
    media.set(p, { buffer: await entry.async("nodebuffer"), ext });
  }
  if (!media.size) return [];

  const out = [];
  for (let si = 1; si <= Math.max(sheetNames.length, 30); si++) {
    const sheetFile = `xl/worksheets/sheet${si}.xml`;
    const relsFile = `xl/worksheets/_rels/sheet${si}.xml.rels`;
    if (!zip.files[sheetFile]) continue;

    const sheetXml = await zip.files[sheetFile].async("string");
    const drawingRef = sheetXml.match(/<drawing[^>]+r:id="([^"]+)"/);
    if (!drawingRef || !zip.files[relsFile]) continue;

    const sheetRels = parseRels(await zip.files[relsFile].async("string"));
    const drawingPath = sheetRels.get(drawingRef[1]);
    if (!drawingPath || !zip.files[drawingPath]) continue;

    const drawingRelsPath = drawingPath.replace("drawings/", "drawings/_rels/") + ".rels";
    if (!zip.files[drawingRelsPath]) continue;

    const drawingRels = parseRels(await zip.files[drawingRelsPath].async("string"));
    const anchors = parseDrawingAnchors(await zip.files[drawingPath].async("string"));

    for (const a of anchors) {
      const target = drawingRels.get(a.embedId);
      const file = target ? media.get(target) : null;
      if (!file) continue;
      out.push({
        sheetIndex: si - 1,
        sheetName: sheetNames[si - 1] || `Sheet${si}`,
        row: a.row,
        col: a.col,
        buffer: file.buffer,
        ext: file.ext === ".jpeg" ? ".jpg" : file.ext,
      });
    }
  }
  return out;
}

export function saveMaterialImage(materialId, buffer, ext, uploadDir) {
  const safeExt = IMAGE_EXT.has(ext) ? ext : ".png";
  const destName = `${materialId}${safeExt}`;
  fs.mkdirSync(uploadDir, { recursive: true });
  fs.writeFileSync(path.join(uploadDir, destName), buffer);
  return `/uploads/${destName}`;
}

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[\\/.,"'«»!?]/g, "")
    .replace(/\s+/g, " ")
    .trim();

function namesMatch(a, b) {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const minLen = Math.min(na.length, nb.length);
  if (minLen >= 10 && (na.includes(nb) || nb.includes(na))) return true;
  return false;
}

function findImageForRow(images, sheetName, row) {
  const candidates = images.filter(
    (img) =>
      img.sheetName === sheetName &&
      (img.row === row || img.row === row - 1 || img.row === row + 1)
  );
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    const ar = a.row === row ? 0 : Math.abs(a.row - row);
    const br = b.row === row ? 0 : Math.abs(b.row - row);
    if (ar !== br) return ar - br;
    return a.col - b.col;
  });
  return candidates[0];
}

function findMaterialForRow(materials, row, moduleHint) {
  const pool = moduleHint ? materials.filter((m) => materialInModule(m, moduleHint)) : materials;

  let mat = pool.find((m) => namesMatch(m.name, row.name));
  if (mat) return mat;

  const fuzzy = pool.filter((m) => {
    const na = norm(m.name);
    const nb = norm(row.name);
    return na.length >= 8 && nb.length >= 8 && (na.includes(nb.slice(0, 18)) || nb.includes(na.slice(0, 18)));
  });
  if (fuzzy.length === 1) return fuzzy[0];

  const global = materials.filter((m) => namesMatch(m.name, row.name));
  if (global.length === 1) return global[0];

  return null;
}

/** Привязка фото к импортируемым материалам по листу и строке */
export function attachImagesToMaterials(materials, images, uploadDir) {
  let linked = 0;
  for (const mat of materials) {
    const img = findImageForRow(images, mat._sheet, mat._row);
    if (!img) continue;
    const url = saveMaterialImage(mat.id, img.buffer, img.ext, uploadDir);
    mat.imageUrl = url;
    mat.photoUrl = url;
    linked++;
  }
  for (const mat of materials) {
    delete mat._sheet;
    delete mat._row;
  }
  return linked;
}

/** Фото из Excel → существующие материалы по модулю + названию + строке */
export function linkImagesToExistingMaterials(parsedRows, images, materials, uploadDir, updateMaterial) {
  let linked = 0;
  const unmatched = [];
  const linkedIds = new Set();

  for (const row of parsedRows) {
    const img = findImageForRow(images, row._sheet, row._row);
    if (!img) continue;

    const mat = findMaterialForRow(materials, row, row.module);
    if (!mat) {
      unmatched.push({ name: row.name, module: row.module, sheet: row._sheet, row: row._row });
      continue;
    }
    if (linkedIds.has(mat.id)) continue;
    const url = saveMaterialImage(mat.id, img.buffer, img.ext, uploadDir);
    updateMaterial(mat.id, { imageUrl: url, photoUrl: url });
    linkedIds.add(mat.id);
    linked++;
  }

  return { linked, imagesFound: images.length, unmatched };
}

/** Имя файла → модуль в базе */
export function moduleFromExcelFilename(filename) {
  const base = path.basename(filename).toLowerCase();
  if (/закуп.*ферм|всю ферму/.test(base)) return "Общая закупка на ферму";
  if (/подтоплен/.test(base)) return "Стеллаж подтопление";
  if (/проточк/.test(base)) return "Стеллаж проточка";
  if (/аэропоник|aeropon/.test(base)) return "Стеллаж аэропоника";
  if (/клубник/.test(base)) return "Стеллаж клубника";
  return null;
}

/** Один .xlsx (буфер или путь) → фото в материалы */
export async function importPhotosFromExcelBuffer(
  buffer,
  filename,
  materials,
  uploadDir,
  updateMaterial,
  moduleOverride
) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const moduleName = moduleOverride || moduleFromExcelFilename(filename) || "Импорт";
  const parsed = parseExcelBuffer(buffer, moduleName);
  const images = await extractExcelImages(buffer, wb.SheetNames);
  const result = linkImagesToExistingMaterials(parsed.materials, images, materials, uploadDir, updateMaterial);
  return { file: path.basename(filename), module: moduleName, ...result };
}

export async function importPhotosFromExcelFile(filePath, materials, uploadDir, updateMaterial, moduleOverride) {
  const buffer = fs.readFileSync(filePath);
  return importPhotosFromExcelBuffer(
    buffer,
    path.basename(filePath),
    materials,
    uploadDir,
    updateMaterial,
    moduleOverride
  );
}
