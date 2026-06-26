/** Удалить на VPS устаревшие hashed-файлы из dist/assets (оставить только текущий билд). */
import { Client } from "ssh2";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const password = process.env.VPS_PASSWORD;
const remoteRoot = process.env.VPS_APP_ROOT || "/opt/daogreen-spec";

if (!password) {
  console.error("Set VPS_PASSWORD");
  process.exit(1);
}

const localAssetsDir = path.join(root, "dist/assets");
const keep = new Set(fs.readdirSync(localAssetsDir));
const keepList = [...keep].map((f) => `'${f.replace(/'/g, `'\\''`)}'`).join(" ");

function exec(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = "";
      stream
        .on("close", (code) => (code ? reject(new Error(`exit ${code}: ${out}`)) : resolve(out)))
        .on("data", (d) => {
          out += d;
          process.stdout.write(d);
        })
        .stderr.on("data", (d) => process.stderr.write(d));
    });
  });
}

const conn = new Client();
conn
  .on("ready", async () => {
    try {
      const cmd = `
cd ${remoteRoot}/dist/assets || exit 1
KEEP=(${keepList})
keep_file() {
  local f="$1"
  for k in "\${KEEP[@]}"; do
    [ "$f" = "$k" ] && return 0
  done
  return 1
}
removed=0
for f in *; do
  [ -f "$f" ] || continue
  keep_file "$f" && continue
  rm -f "$f" && removed=$((removed+1)) && echo "removed $f"
done
echo "Kept \${#KEEP[@]} refs, removed $removed files"
ls -la | head -20
`;
      await exec(conn, cmd);
      conn.end();
    } catch (e) {
      console.error(e.message);
      conn.end();
      process.exit(1);
    }
  })
  .on("error", (e) => {
    console.error(e.message);
    process.exit(1);
  })
  .connect({ host: "62.233.35.206", port: 22, username: "root", password, readyTimeout: 60000 });
