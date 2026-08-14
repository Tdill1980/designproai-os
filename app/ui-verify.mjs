/**
 * Render the live DesignProAI product in a real browser and check the UI
 * acceptance requirements. Chromium resolves the production hostnames at the
 * local TLS tunnel, so every byte on screen is the deployed artifact talking
 * to the live gateway.
 */
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";

const SHOTS = "/tmp/claude-0/-home-user-designproai-os/8e739e24-3b46-5fcc-b70a-7201a673aef2/scratchpad/ui";
mkdirSync(SHOTS, { recursive: true });
const EMAIL = process.env.OP_EMAIL;
const PASSWORD = process.env.OP_PASSWORD;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const MAP = [
  "MAP os.designproai.com 127.0.0.1:8443",
  "MAP designproai.com 127.0.0.1:8443",
  "MAP www.designproai.com 127.0.0.1:8443",
  "MAP wozyamlnygaddievzuwn.supabase.co 127.0.0.1:8443",
].join(", ");

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: [
    "--no-sandbox", "--disable-dev-shm-usage",
    `--host-resolver-rules=${MAP}`,
    "--ignore-certificate-errors", "--no-proxy-server",
  ],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();

const apiErrors = [];
page.on("response", (r) => {
  if (r.url().includes("/api/") && r.status() >= 400) apiErrors.push(`${r.status()} ${r.request().method()} ${r.url().replace(/^https:\/\/[^/]+/, "")}`);
});

const results = [];
async function visit(name, url, checks = {}) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(checks.wait || 4500);
  const text = await page.locator("body").innerText().catch(() => "");
  const title = await page.title();
  const file = `${SHOTS}/${name}.png`;
  await page.screenshot({ path: file, fullPage: Boolean(checks.full) }).catch(() => {});
  // RestylePro wordmarks are the acceptance failure; "RestyleLibrary" etc are
  // product names that must also be gone from the visible product.
  const rp = [...text.matchAll(/Restyle\s?Pro\s?AI|RestylePro|RestyleLibrary|ColorPro|GraphicsPro|LogoPro|ApprovePro|PatternPro/gi)].map((m) => m[0]);
  const row = { name, url, title, rpHits: [...new Set(rp)], chars: text.length, notFound: /Whoa, wrong turn|404/.test(text) };
  results.push(row);
  log(`${name.padEnd(18)} title="${title.slice(0, 46)}" rp=${row.rpHits.join(",") || "none"}${row.notFound ? "  ** 404 **" : ""}`);
  return text;
}

try {
  await visit("01-apex", "https://designproai.com/");
  await visit("02-os-root", "https://os.designproai.com/");
  await visit("03-login", "https://os.designproai.com/login");

  log("signing in…");
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(7000);
  log("  landed:", page.url());
  await page.screenshot({ path: `${SHOTS}/04-after-signin.png` });

  await visit("05-dashboard", "https://os.designproai.com/dashboard");
  await visit("06-jobs", "https://os.designproai.com/designpro/jobs", { full: true });
  await visit("07-generate", "https://os.designproai.com/designpro/generate", { full: true });
  await visit("08-genie-qc", "https://os.designproai.com/designpro/genie-qc");
  await visit("09-wrapbox", "https://os.designproai.com/designpro/wrapbox");
  await visit("10-revisions-new", "https://os.designproai.com/designpro/revisions/new", { full: true });

  // A completed generation: the views, regenerate controls and studio sections.
  const gen = process.env.GEN_ID;
  if (gen) await visit("11-job-detail", `https://os.designproai.com/designpro/jobs/${gen}`, { full: true, wait: 9000 });

  // Responsive: the shell must keep its mobile chrome.
  await page.setViewportSize({ width: 390, height: 844 });
  await visit("12-mobile-jobs", "https://os.designproai.com/designpro/jobs", { wait: 4000 });

  writeFileSync(`${SHOTS}/results.json`, JSON.stringify({ results, apiErrors }, null, 2));
  log("--- api errors ---");
  for (const e of [...new Set(apiErrors)].slice(0, 15)) log("   ", e);
  const branded = results.filter((r) => r.rpHits.length);
  log(branded.length ? `RESTYLEPRO STRINGS ON ${branded.length} PAGES` : "NO RESTYLEPRO STRINGS ON ANY PAGE");
  const notFound = results.filter((r) => r.notFound);
  log(notFound.length ? `404 PAGES: ${notFound.map((r) => r.name).join(", ")}` : "NO 404s");
} catch (err) {
  log("FAILED:", err.message.split("\n")[0]);
  await page.screenshot({ path: `${SHOTS}/failure.png` }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
