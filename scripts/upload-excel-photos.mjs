import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Client } from "ssh2";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const [,, host, user, password, sourceDirArg] = process.argv;
if (!host || !user || !password) {
  console.error("Usage: node upload-excel-photos.mjs <host> <user> <password> [sourceDir]");
  process.exit(1);
}

const sourceDir = sourceDirArg || path.join(__dirname, "../..");
const remoteDir = "/opt/daogreen-spec/import-sources";

const patterns = [
  /закуп.*ферм/i,
  /подтоплен/i,
  /проточк/i,
  /аэропоник/i,
];

const files = fs.readdirSync(sourceDir).filter((f) => {
  if (!/\.xlsx$/i.test(f)) return false;
  const lower = f.toLowerCase();
  return patterns.some((p) => p.test(lower));
});

if (!files.length) {
  console.error("Не найдены xlsx в", sourceDir);
  process.exit(1);
}

console.log("Загрузка файлов:", files.join(", "));

const conn = new Client();

conn
  .on("ready", () => {
    conn.exec(`mkdir -p ${remoteDir}`, (err) => {
      if (err) {
        console.error(err.message);
        conn.end();
        process.exit(1);
      }
      conn.sftp((sftpErr, sftp) => {
        if (sftpErr) {
          console.error(sftpErr.message);
          conn.end();
          process.exit(1);
        }

        let pending = files.length;
        for (const file of files) {
          const local = path.join(sourceDir, file);
          const remote = `${remoteDir}/${file}`;
          sftp.fastPut(local, remote, (putErr) => {
            if (putErr) console.error("Ошибка", file, putErr.message);
            else console.log("↑", file);
            pending--;
            if (pending === 0) {
              const cmd =
                "cd /opt/daogreen-spec && git pull --ff-only && " +
                "/opt/node-v22.16.0-linux-x64/bin/npm run photos:excel --prefix /opt/daogreen-spec/backend";
              conn.exec(cmd, (execErr, stream) => {
                if (execErr) {
                  console.error(execErr.message);
                  conn.end();
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
            }
          });
        }
      });
    });
  })
  .on("error", (e) => {
    console.error(e.message);
    process.exit(1);
  })
  .connect({ host, port: 22, username: user, password, readyTimeout: 60000 });
