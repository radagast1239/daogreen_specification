import { Router } from "express";
import { db } from "../db.js";
import { uid } from "../services/buildItems.js";

const router = Router();

function rowToSupplier(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    phone: row.phone || "",
    site: row.site || "",
    note: row.note || "",
  };
}

const LIST = db.prepare("SELECT * FROM suppliers ORDER BY name");
const GET = db.prepare("SELECT * FROM suppliers WHERE id = ?");
const INSERT = db.prepare(`
  INSERT INTO suppliers (id, name, phone, site, note) VALUES (@id, @name, @phone, @site, @note)
`);
const UPDATE = db.prepare(`
  UPDATE suppliers SET name=@name, phone=@phone, site=@site, note=@note WHERE id=@id
`);
const DELETE = db.prepare("DELETE FROM suppliers WHERE id = ?");

router.get("/", (_req, res) => {
  const mats = db.prepare("SELECT supplier, COUNT(*) as c FROM materials WHERE supplier != '' GROUP BY supplier").all();
  const countMap = new Map(mats.map((r) => [r.supplier, r.c]));
  res.json(
    LIST.all().map((r) => ({
      ...rowToSupplier(r),
      materialCount: countMap.get(r.name) || 0,
    }))
  );
});

router.post("/", (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!name) return res.status(400).json({ error: "name required" });
  const id = uid("sup");
  try {
    INSERT.run({
      id,
      name,
      phone: req.body.phone || "",
      site: req.body.site || "",
      note: req.body.note || "",
    });
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) return res.status(400).json({ error: "Поставщик уже есть" });
    throw e;
  }
  res.status(201).json(rowToSupplier(GET.get(id)));
});

router.patch("/:id", (req, res) => {
  const cur = rowToSupplier(GET.get(req.params.id));
  if (!cur) return res.status(404).json({ error: "Not found" });
  const merged = { ...cur, ...req.body, id: cur.id };
  try {
    UPDATE.run({
      id: cur.id,
      name: String(merged.name || "").trim() || cur.name,
      phone: merged.phone || "",
      site: merged.site || "",
      note: merged.note || "",
    });
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) return res.status(400).json({ error: "Имя занято" });
    throw e;
  }
  res.json(rowToSupplier(GET.get(cur.id)));
});

router.delete("/:id", (req, res) => {
  DELETE.run(req.params.id);
  res.status(204).end();
});

export default router;
