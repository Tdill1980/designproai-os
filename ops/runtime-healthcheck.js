const http = require("node:http");
const expected = process.env.GIT_SHA;
const req = http.get("http://127.0.0.1:3001/health", { timeout: 4000 }, (res) => {
  let body = "";
  res.on("data", (chunk) => { body += chunk; });
  res.on("end", () => {
    try {
      const health = JSON.parse(body);
      process.exit(res.statusCode === 200 && health.ready === true && health.commit === expected ? 0 : 1);
    } catch { process.exit(1); }
  });
});
req.on("timeout", () => req.destroy());
req.on("error", () => process.exit(1));

