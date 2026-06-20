import { DatabaseSync } from "node:sqlite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, "../data/daogreen.db");

let dbInstance = null;

function connect() {
  if (dbInstance) return dbInstance;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  dbInstance = new DatabaseSync(dbPath);
  dbInstance.exec("PRAGMA journal_mode = WAL");
  dbInstance.exec("PRAGMA foreign_keys = ON");
  return dbInstance;
}

/** Прокси: подключение к SQLite при первом обращении */
export const db = new Proxy(
  {},
  {
    get(_t, prop) {
      const d = connect();
      const v = d[prop];
      return typeof v === "function" ? v.bind(d) : v;
    },
  }
);

export function getDbPath() {
  return dbPath;
}

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS modules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'general',
      tech TEXT DEFAULT '',
      section TEXT DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS materials (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT 'шт.',
      base_price REAL NOT NULL DEFAULT 0,
      default_qty REAL NOT NULL DEFAULT 1,
      module TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'Прочее',
      subcategory TEXT DEFAULT '',
      item_type TEXT NOT NULL DEFAULT 'material',
      supplier TEXT DEFAULT '',
      link TEXT DEFAULT '',
      link_alt TEXT DEFAULT '',
      photo_url TEXT DEFAULT '',
      vat_rate REAL DEFAULT 0,
      vat_included INTEGER NOT NULL DEFAULT 0,
      client_note TEXT DEFAULT '',
      tech_note TEXT DEFAULT '',
      internal_note TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      needs_approval INTEGER NOT NULL DEFAULT 0,
      is_consumable INTEGER NOT NULL DEFAULT 0,
      is_spare_part INTEGER NOT NULL DEFAULT 0,
      client_visible_default INTEGER NOT NULL DEFAULT 1,
      responsible TEXT DEFAULT 'general',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      client TEXT DEFAULT '',
      city TEXT DEFAULT '',
      area REAL DEFAULT 0,
      height REAL DEFAULT 0,
      sowing_area REAL DEFAULT 0,
      type TEXT DEFAULT 'проточка',
      currency TEXT DEFAULT '₽',
      vat INTEGER NOT NULL DEFAULT 0,
      comment TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      client_token TEXT NOT NULL UNIQUE,
      selected_modules TEXT NOT NULL DEFAULT '[]',
      zones TEXT NOT NULL DEFAULT '[]',
      stellage_configs TEXT NOT NULL DEFAULT '[]',
      manual_params TEXT NOT NULL DEFAULT '{}',
      version INTEGER NOT NULL DEFAULT 1,
      last_client_activity_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS project_items (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      material_id TEXT,
      module TEXT NOT NULL,
      section TEXT DEFAULT '',
      name TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT 'шт.',
      category TEXT NOT NULL DEFAULT 'Прочее',
      supplier TEXT DEFAULT '',
      link TEXT DEFAULT '',
      link_alt TEXT DEFAULT '',
      photo_url TEXT DEFAULT '',
      client_note TEXT DEFAULT '',
      tech_note TEXT DEFAULT '',
      qty REAL NOT NULL DEFAULT 0,
      price REAL NOT NULL DEFAULT 0,
      vat_rate REAL DEFAULT 0,
      visible INTEGER NOT NULL DEFAULT 1,
      approved INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      needs_approval INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'not_bought',
      actual_price REAL,
      client_comment TEXT DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      responsible TEXT DEFAULT 'general'
    );

    CREATE INDEX IF NOT EXISTS idx_items_project ON project_items(project_id);
    CREATE INDEX IF NOT EXISTS idx_materials_module ON materials(module);
    CREATE INDEX IF NOT EXISTS idx_projects_token ON projects(client_token);

    CREATE TABLE IF NOT EXISTS spec_versions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by TEXT DEFAULT 'admin',
      summary TEXT NOT NULL DEFAULT '{}',
      snapshot TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      item_id TEXT,
      material_id TEXT,
      type TEXT NOT NULL DEFAULT 'photo',
      filename TEXT NOT NULL,
      url TEXT NOT NULL,
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  migrateDb();
}

function migrateDb() {
  const addCol = (table, col, def) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.some((c) => c.name === col)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    }
  };
  addCol("materials", "responsible", "TEXT DEFAULT 'general'");
  addCol("project_items", "responsible", "TEXT DEFAULT 'general'");

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS spec_presets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      preset_type TEXT NOT NULL,
      module_id TEXT DEFAULT '',
      module_name TEXT DEFAULT '',
      section_id TEXT DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      items_json TEXT NOT NULL DEFAULT '[]',
      note TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  try {
    db.exec(`ALTER TABLE materials ADD COLUMN farm_section_id TEXT DEFAULT ''`);
  } catch {
    /* column exists */
  }
}

export function rowToMaterial(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    unit: row.unit,
    basePrice: row.base_price,
    defaultQty: row.default_qty,
    module: row.module,
    category: row.category,
    subcategory: row.subcategory,
    farmSectionId: row.farm_section_id || "",
    itemType: row.item_type,
    supplier: row.supplier,
    link: row.link,
    linkAlt: row.link_alt,
    photoUrl: row.photo_url,
    imageUrl: row.photo_url || "",
    vatRate: row.vat_rate,
    vatIncluded: !!row.vat_included,
    clientNote: row.client_note,
    techNote: row.tech_note,
    internalNote: row.internal_note,
    status: row.status,
    needsApproval: !!row.needs_approval,
    isConsumable: !!row.is_consumable,
    isSparePart: !!row.is_spare_part,
    clientVisibleDefault: !!row.client_visible_default,
    responsible: row.responsible || "general",
    comment: row.client_note || row.tech_note,
  };
}

export function rowToModule(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    tech: row.tech,
    section: row.section,
    active: !!row.active,
    sortOrder: row.sort_order,
  };
}

export function rowToItem(row) {
  if (!row) return null;
  return {
    id: row.id,
    materialId: row.material_id,
    module: row.module,
    section: row.section,
    name: row.name,
    unit: row.unit,
    category: row.category,
    supplier: row.supplier,
    link: row.link,
    linkAlt: row.link_alt,
    photoUrl: row.photo_url,
    imageUrl: row.photo_url || "",
    comment: row.client_note || row.tech_note,
    clientNote: row.client_note,
    techNote: row.tech_note,
    qty: row.qty,
    price: row.price,
    vatRate: row.vat_rate,
    visible: !!row.visible,
    approved: !!row.approved,
    enabled: !!row.enabled,
    needsApproval: !!row.needs_approval,
    status: row.status,
    actualPrice: row.actual_price,
    clientComment: row.client_comment,
    responsible: row.responsible || "general",
  };
}

export function rowToProject(row, items = []) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    client: row.client,
    city: row.city,
    area: row.area,
    height: row.height,
    sowingArea: row.sowing_area,
    type: row.type,
    currency: row.currency,
    vat: !!row.vat,
    comment: row.comment,
    status: row.status,
    clientToken: row.client_token,
    selectedModules: JSON.parse(row.selected_modules || "[]"),
    zones: JSON.parse(row.zones || "[]"),
    stellageConfigs: JSON.parse(row.stellage_configs || "[]"),
    manualParams: JSON.parse(row.manual_params || "{}"),
    version: row.version,
    lastClientActivityAt: row.last_client_activity_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items,
  };
}

export function loadProjectItems(projectId) {
  return db
    .prepare("SELECT * FROM project_items WHERE project_id = ? ORDER BY sort_order, module, name")
    .all(projectId)
    .map(rowToItem);
}

export function loadProject(id) {
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  if (!row) return null;
  return rowToProject(row, loadProjectItems(id));
}

export function loadProjectByToken(token) {
  const row = db.prepare("SELECT * FROM projects WHERE client_token = ?").get(token);
  if (!row) return null;
  return rowToProject(row, loadProjectItems(row.id));
}
