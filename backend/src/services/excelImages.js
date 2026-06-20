import fs from "fs";
import path from "path";
import JSZip from "jszip";

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

function findImageForRow(images, sheetName, row) {
  return images.find(
    (img) =>
      img.sheetName === sheetName &&
      (img.row === row || img.row === row - 1 || img.row === row + 1)
  );
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

const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

/** Фото из Excel → существующие материалы по модулю (лист) + названию + строке */
export function linkImagesToExistingMaterials(parsedRows, images, materials, uploadDir, updateMaterial) {
  let linked = 0;
  const unmatched = [];

  for (const row of parsedRows) {
    const img = findImageForRow(images, row._sheet, row._row);
    if (!img) continue;

    const mat =
      materials.find((m) => m.module === row.module && norm(m.name) === norm(row.name)) ||
      materials.find((m) => m.module === row.module && norm(m.name).includes(norm(row.name).slice(0, 20)));

    if (!mat) {
      unmatched.push({ name: row.name, sheet: row._sheet, row: row._row });
      continue;
    }
    const url = saveMaterialImage(mat.id, img.buffer, img.ext, uploadDir);
    updateMaterial(mat.id, { imageUrl: url, photoUrl: url });
    linked++;
  }

  return { linked, imagesFound: images.length, unmatched };
}
