import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
for (const name of fs.readdirSync(root)) {
  if (/\.xlsx$/i.test(name)) console.log(name);
}
