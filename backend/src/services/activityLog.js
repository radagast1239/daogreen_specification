import { db } from "../db.js";
import { uid } from "./buildItems.js";
import { lineVisibleToClient } from "../../../shared/itemTypes.js";

const STATUS_LABELS = {
  not_bought: "Не куплено",
  searching: "В поиске",
  ordered: "Заказано",
  bought: "Куплено",
  delivered: "Доставлено",
  have: "Уже есть",
  need_help: "Нужна помощь",
  not_fit: "Не подошло",
  replacement_check: "Замена на проверке",
};

const FIELD_META = {
  status: { label: "Статус", clientVisible: true, format: (v) => STATUS_LABELS[v] || v },
  actualPrice: { label: "Факт. цена", clientVisible: true, format: (v) => `${v} ₽` },
  clientComment: { label: "Комментарий клиента", clientVisible: true },
  price: { label: "Цена", clientVisible: true, format: (v) => `${v} ₽` },
  qty: { label: "Количество", clientVisible: true },
  clientNote: { label: "Сообщение Daogreen", clientVisible: true },
  link: { label: "Ссылка", clientVisible: true },
  name: { label: "Название", clientVisible: true },
  supplier: { label: "Поставщик", clientVisible: true },
  category: { label: "Клиентский раздел", clientVisible: true },
  clientSection: { label: "Клиентский раздел", clientVisible: true },
  module: { label: "Раздел фермы", clientVisible: false },
  subcategory: { label: "Подраздел фермы", clientVisible: false },
  itemType: { label: "Тип строки", clientVisible: false },
  roomId: { label: "Помещение", clientVisible: true },
  vatRate: { label: "НДС", clientVisible: true, format: (v) => `${v}%` },
  comment: { label: "Комментарий", clientVisible: false },
  visible: { label: "Видимость клиенту", clientVisible: true, format: (v) => (v ? "показано" : "скрыто") },
  visibleToClient: { label: "Видимость клиенту", clientVisible: true, format: (v) => (v ? "показано" : "скрыто") },
  includedInProject: { label: "В проекте", clientVisible: false, format: (v) => (v ? "да" : "нет") },
  internalNote: { label: "Внутр. заметка", clientVisible: false },
  deliveryDays: { label: "Срок поставки", clientVisible: true, format: (v) => `${v} дн.` },
  safetyFactor: { label: "Запасной коэфф.", clientVisible: true },
  unit: { label: "Ед. изм.", clientVisible: true },
  imageUrl: { label: "Фото", clientVisible: true, format: (v) => (v ? "обновлено" : "удалено") },
  photoUrl: { label: "Фото", clientVisible: true, format: (v) => (v ? "обновлено" : "удалено") },
};

export function initActivityLog() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_activity (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      item_id TEXT DEFAULT '',
      item_name TEXT DEFAULT '',
      actor TEXT NOT NULL,
      field TEXT DEFAULT '',
      summary TEXT NOT NULL,
      client_visible INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_activity_project ON project_activity(project_id, created_at DESC);
  `);
}

export function logItemPatch({ projectId, itemId, itemName, actor, before, patch }) {
  if (!before || !patch) return;
  for (const [field, newVal] of Object.entries(patch)) {
    const meta = FIELD_META[field];
    if (!meta) continue;
    const oldVal = before[field];
    if (oldVal === newVal) continue;
    if (newVal === undefined) continue;
    const fmt = meta.format || ((v) => String(v ?? ""));
    const oldS = oldVal != null && oldVal !== "" ? fmt(oldVal) : "—";
    const newS = fmt(newVal);
    const who = actor === "client" ? "Клиент" : "Daogreen";
    const summary = `${who}: ${itemName || "Позиция"} — ${meta.label}: ${oldS} → ${newS}`;
    db.prepare(`
      INSERT INTO project_activity (id, project_id, item_id, item_name, actor, field, summary, client_visible)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(uid("act"), projectId, itemId || "", itemName || "", actor, field, summary, meta.clientVisible ? 1 : 0);
  }
}

export function logProjectEvent({ projectId, actor, summary, clientVisible = true }) {
  db.prepare(`
    INSERT INTO project_activity (id, project_id, item_id, item_name, actor, field, summary, client_visible)
    VALUES (?, ?, '', '', ?, '', ?, ?)
  `).run(uid("act"), projectId, actor, summary, clientVisible ? 1 : 0);
}

export function listActivity(projectId, { clientOnly = false, limit = 80 } = {}) {
  const rows = clientOnly
    ? db
        .prepare(
          `SELECT id, item_id as itemId, item_name as itemName, actor, field, summary, created_at as createdAt
           FROM project_activity WHERE project_id = ? AND client_visible = 1
           ORDER BY created_at DESC LIMIT ?`
        )
        .all(projectId, limit)
    : db
        .prepare(
          `SELECT id, item_id as itemId, item_name as itemName, actor, field, summary, client_visible as clientVisible, created_at as createdAt
           FROM project_activity WHERE project_id = ?
           ORDER BY created_at DESC LIMIT ?`
        )
        .all(projectId, limit);
  return rows.map((r) => ({ ...r, clientVisible: r.clientVisible !== 0 }));
}

/** Убрать поля, которые клиент не должен видеть */
export function sanitizeItemForClient(it) {
  const { internalNote, techNote, materialId, ...safe } = it;
  return safe;
}

export function sanitizeProjectForClient(project) {
  const items = (project.items || [])
    .filter((it) => lineVisibleToClient(it))
    .map(sanitizeItemForClient);
  const {
    clientToken,
    selectedModules,
    stellageConfigs,
    zones,
    purchaseStartedAt,
    installationDoneAt,
    ...safe
  } = project;
  return { ...safe, items };
}
