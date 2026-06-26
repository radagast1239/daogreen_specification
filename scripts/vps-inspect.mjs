import { Client } from "ssh2";

const password = process.env.VPS_PASSWORD;
if (!password) {
  console.error("Set VPS_PASSWORD");
  process.exit(1);
}

const cmd = process.argv.slice(2).join(" ") || "head -80 /var/www/daogreen-calc/js/app-profile.js";

const conn = new Client();
conn
  .on("ready", () => {
    conn.exec(cmd, (err, stream) => {
      if (err) throw err;
      stream.on("data", (d) => process.stdout.write(d));
      stream.stderr.on("data", (d) => process.stderr.write(d));
      stream.on("close", () => conn.end());
    });
  })
  .connect({ host: "62.233.35.206", port: 22, username: "root", password, readyTimeout: 60000 });
