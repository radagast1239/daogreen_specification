import { db, loadProjectItems } from "../db.js";
import { projectTotals } from "./buildItems.js";

const DONE = ["bought", "delivered", "have"];

export function getAnalytics() {
  const projects = db.prepare("SELECT * FROM projects WHERE status != 'archived'").all();
  const materials = db.prepare("SELECT * FROM materials").all();

  const noPhoto = materials.filter((m) => !m.photo_url).length;
  const noPrice = materials.filter((m) => !m.base_price).length;
  const noLink = materials.filter((m) => !m.link).length;

  const byType = new Map();
  const costPerM2 = [];
  const timelines = [];

  for (const p of projects) {
    const items = loadProjectItems(p.id);
    const t = projectTotals(items);
    const type = p.type || "проточка";
    if (!byType.has(type)) byType.set(type, { count: 0, budgetSum: 0 });
    const bt = byType.get(type);
    bt.count += 1;
    bt.budgetSum += t.budget;

    const sow = Number(p.sowing_area) || 0;
    if (sow > 0) {
      costPerM2.push({
        projectId: p.id,
        name: p.name,
        client: p.client,
        type: p.type,
        sowingArea: sow,
        budget: t.budget,
        perM2: Math.round(t.budget / sow),
      });
    }

    const prof = db
      .prepare("SELECT * FROM client_profiles WHERE client_key = ?")
      .get((p.client || "Без имени").trim().toLowerCase().replace(/\s+/g, " "));

    const purchaseStart = p.purchase_started_at || prof?.purchase_started_at;
    const installEnd = p.installation_done_at || prof?.installation_done_at;

    if (purchaseStart && installEnd) {
      const days = Math.round(
        (new Date(installEnd).getTime() - new Date(purchaseStart).getTime()) / 86400000
      );
      timelines.push({
        projectId: p.id,
        name: p.name,
        client: p.client,
        days,
        purchaseStartedAt: purchaseStart,
        installationDoneAt: installEnd,
      });
    }
  }

  const avgBudgetByType = [...byType.entries()].map(([type, v]) => ({
    type,
    count: v.count,
    avgBudget: Math.round(v.budgetSum / v.count),
  }));

  return {
    materialsReport: { noPhoto, noPrice, noLink, total: materials.length },
    avgBudgetByType,
    costPerM2: costPerM2.sort((a, b) => a.perM2 - b.perM2),
    purchaseToInstallDays: timelines.sort((a, b) => b.days - a.days),
  };
}
