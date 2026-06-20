import { db } from "./db.js";
import { bulkUpsertMaterials, upsertModule } from "./routes/materials.js";
import { seedMaterials } from "../../src/data/seedMaterials.js";
import { seedModules } from "../../src/data/modules.js";

export const FULL_MODULES = [
  ...seedModules,
  { id: "mod_klimat", name: "Климат и вентиляция", type: "general", tech: "—", section: "Климат" },
  { id: "mod_elektrika", name: "Электрика", type: "general", tech: "—", section: "Электрика" },
  { id: "mod_vodopodgotovka", name: "Водоподготовка", type: "general", tech: "—", section: "Водоподготовка" },
  { id: "mod_raskhodniki", name: "Расходники", type: "general", tech: "—", section: "Расходники" },
  { id: "mod_raboty", name: "Монтажные работы и запуск", type: "general", tech: "—", section: "Работы" },
  { id: "mod_okhlazhdenie", name: "Охлаждение", type: "general", tech: "—", section: "Климат" },
  { id: "mod_otoplenie", name: "Отопление", type: "general", tech: "—", section: "Климат" },
  { id: "mod_vlazhnost", name: "Влажность", type: "general", tech: "—", section: "Климат" },
  { id: "mod_osveshchenie", name: "Освещение", type: "general", tech: "—", section: "Освещение" },
  { id: "mod_poliv", name: "Полив", type: "general", tech: "—", section: "Полив" },
  { id: "mod_nasosy", name: "Насосы", type: "general", tech: "—", section: "Насосная группа" },
  { id: "mod_emkosti", name: "Ёмкости", type: "general", tech: "—", section: "Ёмкости" },
  { id: "mod_avtomaty", name: "Автоматы", type: "general", tech: "—", section: "Электрика" },
  { id: "mod_kabel", name: "Кабель", type: "general", tech: "—", section: "Электрика" },
  { id: "mod_zapusk", name: "Запуск", type: "general", tech: "—", section: "Запуск" },
];

/** Всегда дополняет справочник модулей (клубника, рассадное и т.д.) */
export function ensureModules() {
  let order = 0;
  for (const mod of FULL_MODULES) {
    upsertModule({ ...mod, section: mod.section || mod.name, sortOrder: order++ });
  }
}

export function runSeedIfEmpty() {
  ensureModules();
  const count = db.prepare("SELECT COUNT(*) as c FROM materials").get().c;
  if (count > 0) return;

  console.log("Seeding database…");

  const materials = seedMaterials.map((m) => {
    const dq = Number(m.defaultQty) || 0;
    return {
      id: m.id,
      name: m.name,
      unit: m.unit,
      basePrice: m.basePrice,
      defaultQty: dq,
      module: m.module,
      category: m.category,
      link: m.link || "",
      imageUrl: m.imageUrl || "",
      clientNote: m.comment || "",
      techNote: "",
      vatRate: 0,
      status: m.status || "active",
      clientVisibleDefault: dq > 0,
    };
  });

  bulkUpsertMaterials(materials, "merge");
  console.log(`Seeded ${materials.length} materials`);
}

if (process.argv[1]?.endsWith("seed.js")) {
  db.prepare("DELETE FROM project_items").run();
  db.prepare("DELETE FROM spec_versions").run();
  db.prepare("DELETE FROM projects").run();
  db.prepare("DELETE FROM materials").run();
  db.prepare("DELETE FROM modules").run();
  runSeedIfEmpty();
  console.log("Seed complete.");
}
