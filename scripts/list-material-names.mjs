import { DatabaseSync } from "node:sqlite";

const dbPath = process.argv[2] || "/opt/daogreen-spec/backend/data/daogreen.db";
const db = new DatabaseSync(dbPath);
const rows = db.prepare("SELECT id, name FROM materials ORDER BY name").all();
console.log(JSON.stringify(rows, null, 0));
