/**
 * Аудит ссылок на товар (link/linkAlt/clientNote) у материалов из шаблонов.
 * Usage: node scripts/auditCatalogMaterialLinks.js
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseStellageModuleCatalogs } from "../src/lib/stellageCatalogConfig.js";
import { parseSettingsJson } from "../shared/cleanStellageCatalogs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const materials = JSON.parse(fs.readFileSync(path.join(root, "backend/data/materials-live.json"), "utf8"));
const settings = JSON.parse(fs.readFileSync(path.join(root, "backend/data/settings-live.json"), "utf8"));
const byId = new Map(materials.map((m) => [m.id, m]));

const HTTP = /^https?:\/\//i;

function extractUrls(text) {
  return (String(text || "").match(/https?:\/\/[^\s<>"']+/gi) || []).map((u) => u.replace(/[),.;]+$/, ""));
}

function linkAudit(mat) {
  const link = (mat.link || "").trim();
  const alt = (mat.linkAlt || "").trim();
  const note = mat.clientNote || "";
  const urls = [...new Set([...extractUrls(link), ...extractUrls(alt), ...extractUrls(note)])];
  if (urls.length) return { status: "ok", urls, primary: link || alt || urls[0] };
  if (link || alt || note.trim()) return { status: "text_only", urls: [], primary: link || alt || note.slice(0, 60) };
  return { status: "empty", urls: [], primary: "" };
}

const st = parseStellageModuleCatalogs(settings.stellageModuleCatalogs);
const farm = parseSettingsJson(settings.farmSectionCatalogs);
const catalogIds = new Set();
for (const lines of Object.values(st)) for (const ln of lines) if (ln.materialId) catalogIds.add(ln.materialId);
for (const lines of Object.values(farm)) for (const ln of lines) if (ln.materialId) catalogIds.add(ln.materialId);

const rows = [];
for (const id of catalogIds) {
  const mat = byId.get(id);
  if (!mat) {
    rows.push({ id, name: "—", status: "missing_in_db", category: "" });
    continue;
  }
  const audit = linkAudit(mat);
  rows.push({
    id,
    name: mat.name,
    category: mat.category,
    supplier: mat.supplier || "",
    status: audit.status,
    primary: audit.primary,
    urlCount: audit.urls.length,
    urls: audit.urls,
  });
}

const stats = { ok: 0, text_only: 0, empty: 0, missing_in_db: 0 };
for (const r of rows) stats[r.status] = (stats[r.status] || 0) + 1;

console.log("=== Ссылки на товар в материалах шаблонов (стеллажи + ферма) ===");
console.log(`Уникальных materialId в шаблонах: ${catalogIds.size}`);
console.log("Статус link:", stats);

const problems = rows.filter((r) => r.status !== "ok").sort((a, b) => a.category.localeCompare(b.category));
console.log(`\nБез нормальной URL (${problems.length}):`);
for (const r of problems) {
  console.log(`  [${r.status}] ${r.id} | ${r.name}`);
  if (r.primary) console.log(`         → ${r.primary}`);
}

console.log("\n=== Краб-системы и каркас (ссылки) ===");
for (const r of rows.filter((r) => /краб|профил|болт|саморез|шайб|окраск/i.test(r.name))) {
  console.log(`${r.id} | ${r.status} | ${r.name}`);
  if (r.urls[0]) console.log(`   ${r.urls[0]}`);
  else if (r.primary) console.log(`   (${r.primary})`);
  else console.log("   (пусто)");
}

// compare seed
let seed = [];
try {
  const seedText = fs.readFileSync(path.join(root, "src/data/seedMaterials.js"), "utf8");
  const m = seedText.match(/export const seedMaterials = (\[[\s\S]*?\n\]);/);
  if (m) seed = eval(`(${m[1]})`);
} catch {
  /* ignore */
}
const seedByName = new Map(seed.filter((s) => s.link).map((s) => [s.name.toLowerCase().trim(), s.link]));

console.log("\n=== Сид с metallist, но в базе пусто/другое ===");
for (const r of rows) {
  const seedLink = [...seedByName.entries()].find(([n]) => r.name.toLowerCase().includes(n.slice(0, 12)) || n.includes(r.name.toLowerCase().slice(0, 12)));
  if (!seedLink) continue;
  const [, sLink] = seedLink;
  if (!sLink.includes("metallist")) continue;
  const hasMetallist = r.urls.some((u) => u.includes("metallist.org"));
  if (!hasMetallist) {
    console.log(`${r.id} ${r.name}`);
    console.log(`  seed: ${sLink}`);
    console.log(`  live: ${r.primary || "(пусто)"}`);
  }
}
