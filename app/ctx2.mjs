import { chromium } from "playwright-core";
const MAP = "MAP designproai.com 127.0.0.1:8443, MAP wozyamlnygaddievzuwn.supabase.co 127.0.0.1:8443";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox","--disable-dev-shm-usage",`--host-resolver-rules=${MAP}`,"--ignore-certificate-errors","--no-proxy-server"] });
const p = await (await b.newContext({ ignoreHTTPSErrors: true })).newPage();
await p.goto("https://designproai.com/", { waitUntil:"domcontentloaded", timeout:60000 });
await p.waitForTimeout(6000);
const t = (await p.locator("body").innerText()).replace(/\s+/g," ");
for (const m of t.matchAll(/(.{90})(ColorPro|PatternPro|ApprovePro)(.{60})/g)) console.log("…"+m[1]+" >>"+m[2]+"<< "+m[3]);
await b.close();
