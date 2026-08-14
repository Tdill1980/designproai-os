import { chromium } from "playwright-core";
const MAP = "MAP os.designproai.com 127.0.0.1:8443, MAP designproai.com 127.0.0.1:8443, MAP wozyamlnygaddievzuwn.supabase.co 127.0.0.1:8443";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox","--disable-dev-shm-usage",`--host-resolver-rules=${MAP}`,"--ignore-certificate-errors","--no-proxy-server"] });
const p = await (await b.newContext({ ignoreHTTPSErrors: true })).newPage();
const RX = /ColorPro|PatternPro|ApprovePro|RestyleLibrary|GraphicsPro/;
async function dump(label, url, signIn) {
  if (signIn) {
    await p.goto("https://os.designproai.com/login", { waitUntil:"domcontentloaded", timeout:60000 });
    await p.waitForTimeout(2500);
    await p.fill("#email", process.env.OP_EMAIL); await p.fill("#password", process.env.OP_PASSWORD);
    await p.click('button[type="submit"]'); await p.waitForTimeout(7000);
  }
  await p.goto(url, { waitUntil:"domcontentloaded", timeout:60000 });
  await p.waitForTimeout(5000);
  console.log("=====", label);
  const hits = await p.evaluate((src) => {
    const rx = new RegExp(src);
    const out = [];
    document.querySelectorAll("body *").forEach(el => {
      if (el.children.length) return;
      const t = (el.textContent||"").trim();
      if (t && rx.test(t)) {
        let path = [], n = el;
        for (let i=0;i<4 && n;i++,n=n.parentElement) path.push(n.tagName.toLowerCase()+(n.className&&typeof n.className==="string"?"."+n.className.split(/\s+/).slice(0,2).join("."):""));
        out.push(t.slice(0,80) + "   <<< " + path.join(" < ").slice(0,150));
      }
    });
    return [...new Set(out)];
  }, RX.source);
  hits.slice(0,12).forEach(h => console.log("  ", h));
}
await dump("HOMEPAGE", "https://designproai.com/");
await dump("DASHBOARD", "https://os.designproai.com/dashboard", true);
await b.close();
