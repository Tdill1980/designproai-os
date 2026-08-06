import http from "node:http";
const req = http.get("http://127.0.0.1:8787/healthz", { timeout: 4000 }, (res) => {
  res.resume();
  res.on("end", () => process.exit(res.statusCode === 200 ? 0 : 1));
});
req.on("timeout", () => req.destroy());
req.on("error", () => process.exit(1));

