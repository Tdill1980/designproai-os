const http = require("node:http");
const expected = process.env.GIT_SHA;
const workerId = process.env.DESIGNPRO_WORKER_ID;
const req = http.get("http://127.0.0.1:3001/health", { timeout: 4000 }, (res) => {
  let body = "";
  res.on("data", (chunk) => { body += chunk; });
  res.on("end", () => {
    try {
      const health = JSON.parse(body);
      const dependencies = health.dependencies || {};
      process.exit(
        res.statusCode === 200 &&
        health.ready === true &&
        health.commit === expected &&
        health.workerId === workerId &&
        dependencies.ready === true &&
        dependencies.contract === "designpro.runtime-readiness.v2" ? 0 : 1,
      );
    } catch { process.exit(1); }
  });
});
req.on("timeout", () => req.destroy());
req.on("error", () => process.exit(1));
