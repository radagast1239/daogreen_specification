import { Client } from "ssh2";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const rel = process.argv[2];
if (!rel) {
  console.error("Usage: node vps-upload-b64.mjs <localRel>");
  process.exit(1);
}

const password = process.env.VPS_PASSWORD;
if (!password) {
  console.error("Set VPS_PASSWORD");
  process.exit(1);
}

const local = path.join(root, rel);
const remoteRoot = process.env.VPS_APP_ROOT || "/opt/daogreen-spec";
const remote = `${remoteRoot}/${rel.replace(/\\/g, "/")}`;
const b64 = fs.readFileSync(local).toString("base64");
const cmd = `mkdir -p $(dirname ${remote}) && echo ${b64} | base64 -d > ${remote} && wc -c ${remote}`;

const conn = new Client();
conn
  .on("ready", () => {
    conn.exec(cmd, (err, stream) => {
      if (err) {
        console.error(err.message);
        process.exit(1);
      }
      stream
        .on("close", (code) => {
          conn.end();
          process.exit(code ?? 0);
        })
        .on("data", (d) => process.stdout.write(d))
        .stderr.on("data", (d) => process.stderr.write(d));
    });
  })
  .on("error", (e) => {
    console.error(e.message);
    process.exit(1);
  })
  .connect({ host: "62.233.35.206", port: 22, username: "root", password, readyTimeout: 60000 });
