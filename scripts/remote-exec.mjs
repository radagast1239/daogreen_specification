import { Client } from "ssh2";

const [,, host, user, password, ...cmdParts] = process.argv;
const cmd = cmdParts.join(" ");
if (!host || !user || !password || !cmd) {
  console.error("Usage: node remote-exec.mjs <host> <user> <password> <command>");
  process.exit(1);
}

const conn = new Client();
conn
  .on("ready", () => {
    conn.exec(cmd, (err, stream) => {
      if (err) {
        console.error(err.message);
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
  })
  .on("error", (e) => {
    console.error(e.message);
    process.exit(1);
  })
  .connect({ host, port: 22, username: user, password, readyTimeout: 120000, keepaliveInterval: 10000 });
