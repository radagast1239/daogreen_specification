import http from "http";

function request(opts, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

const payload = JSON.stringify({ login: "daogreen", password: process.argv[2] || "" });
const login = await request(
  {
    hostname: "127.0.0.1",
    port: 8080,
    path: "/.netlify/functions/auth-login",
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
  },
  payload
);
console.log("login", login.status, login.body);
const cookie = login.headers["set-cookie"]?.[0]?.split(";")[0] || "";
const calc = await request({
  hostname: "127.0.0.1",
  port: 8080,
  path: "/js/planting-calc-core.js",
  method: "GET",
  headers: cookie ? { Cookie: cookie } : {},
});
console.log("calc", calc.status, calc.body.slice(0, 40));
