import { chromium } from "playwright-core";
const MAP = "MAP os.designproai.com 127.0.0.1:8443, MAP designproai.com 127.0.0.1:8443, MAP wozyamlnygaddievzuwn.supabase.co 127.0.0.1:8443";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox","--disable-dev-shm-usage",`--host-resolver-rules=${MAP}`,"--ignore-certificate-errors","--no-proxy-server"] });
const p = await (await b.newContext({ ignoreHTTPSErrors: true })).newPage();
p.on("console", m => { if (m.type()==="error") console.log("CONSOLE:", m.text().slice(0,200)); });
p.on("response", async r => { const u=r.url(); if (u.includes("auth/v1")||u.includes("/api/")) console.log("NET:", r.status(), r.request().method(), u.replace(/^https:\/\/[^/]+/,"").slice(0,80)); });
await p.goto("https://os.designproai.com/login", { waitUntil:"domcontentloaded", timeout:60000 });
await p.waitForTimeout(3000);
await p.fill("#email", process.env.OP_EMAIL); await p.fill("#password", process.env.OP_PASSWORD);
await p.click('button[type="submit"]');
await p.waitForTimeout(9000);
console.log("URL after submit:", p.url());
const t = await p.locator("body").innerText();
console.log("VISIBLE:", t.replace(/\s+/g," ").slice(0,300));
await b.close();
