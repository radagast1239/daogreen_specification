import { Client } from "ssh2";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const password = process.env.VPS_PASSWORD;
const remote = "/opt/daogreen-spec/backend/data/daogreen.db";
const local = path.join(__dirname, "../backend/data/daogreen.db");

if (!password) {
  console.error("Set VPS_PASSWORD");
  process.exit(1);
}

fs.mkdirSync(path.dirname(local), { recursive: true });

const conn = new Client();
conn
  .on("ready", () => {
    conn.sftp((err, sftp) => {
      if (err) throw err;
      sftp.fastGet(remote, local, (e) => {
        conn.end();
        if (e) {
          console.error(e.message);
          process.exit(1);
        }
        console.log("Downloaded to", local);
      });
    });
  })
  .on("error", (e) => {
    console.error(e.message);
    process.exit(1);
  })
  .connect({ host: "62.233.35.206", port: 22, username: "root", password, readyTimeout: 120000 });
