#!/usr/bin/env node
/**
 * TEST 17 — THE 2026-08-22 CALL-1 REQUEST, VERBATIM, ON TODAY'S MODEL. Harness only.
 *
 * Owner (Trish, 2026-09-11), holding the Flamingo Pools sheet: "It was working,
 * now it's code spaghetti." That sheet is generation 5b2eb96c, authored
 * 2026-08-22 05:53Z by the runtime at commit 0b8ddf99 (prompt version
 * `designpro-flat-first-atlas-20260822.v2`). CLAUDE.md said the v2 prompt text
 * was not in this repository; it is — the clone that wrote that line was
 * shallow. The six modules that assembled that request are vendored
 * byte-for-byte under `scripts/fixtures/atlas-v2-0b8ddf99/` (hashes in its
 * MANIFEST.json) and EXECUTED here, never re-typed.
 *
 * The request, exactly as Aug 22 sent it (`generateOrReuseFlatAtlas`, v2):
 *   1. the deterministic guide PNG, first image — the STORED guide bytes of the
 *      fixture generation, hash-verified (and the vendored renderer is run on
 *      the stored manifest to report whether it still reproduces them);
 *   2. `atlasPrompt(input, manifest)` — topology lock + zone map + the v2
 *      `buildFlatDesignIQDirection` creative direction;
 *   3. the Houdini paired flat-to-finished lesson (release assets, hash-pinned);
 *   4. verified customer logo, 5. verified customer references (none on Flamingo).
 *   `aspectRatio: "1:1"`, `imageSize: "4K"`, no temperature, one call, no gate.
 *
 * What differs from Aug 22 and cannot be undone here: the model weights behind
 * `gemini-3-pro-image` today, and the provider module (HEAD's
 * `generation-provider.cjs`, same `generateImage` call shape).
 *
 * Each raw return is normalized with the v2 normalizer (same canvas, same zone
 * mask), then measured with HEAD's gates — deterministic checks, the
 * colour-blind full-bleed metric, the output-class question — without any
 * gate deciding anything. Evidence, not a verdict.
 */
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fullBleedMetrics } from "./atlas-fullbleed-metrics.mjs";

const require_ = createRequire(join(process.cwd(), "runtime/"));
const V2_DIR = resolve(process.cwd(), "scripts/fixtures/atlas-v2-0b8ddf99");
const V2 = JSON.parse(readFileSync(join(V2_DIR, "MANIFEST.json"), "utf8"));

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) => (a.startsWith("--") ? [[a.slice(2), all[i + 1]]] : [])),
);
const OUT = args.out || "./ab-evidence";
mkdirSync(OUT, { recursive: true });
const sha = (v) => createHash("sha256").update(v).digest("hex");
const log = (m) => process.stdout.write(`  ${m}\n`);
const truthy = (v) => String(v).toLowerCase() === "true";
const pct = (v) => `${(Number(v) * 100).toFixed(1)}%`;

const FIXTURE_PATH = resolve(process.cwd(), args.fixture || join(V2_DIR, "flamingo-5b2eb96c.json"));
const DRAWS = Math.min(4, Math.max(1, Number(args.draws || 1)));
const CAPTURE_ONLY = truthy(args["capture-only"]);
const OFFLINE = truthy(args.offline);

// ── the vendored Aug 22 modules, verified before they run ─────────────────
for (const [file, hash] of Object.entries(V2.files)) {
  const actual = sha(readFileSync(join(V2_DIR, file)));
  if (actual !== hash) throw new Error(`vendored ${file} is not the ${V2.sourceCommit.slice(0, 8)} bytes (${actual.slice(0, 12)} != ${hash.slice(0, 12)})`);
}
// The vendored modules `require("sharp")` and read `./atlas-examples/houdini-*`
// relative to themselves. Both are provided by links, never by copies.
function ensureLink(linkPath, targetAbs) {
  try { lstatSync(linkPath); return; } catch { /* absent */ }
  symlinkSync(relative(dirname(linkPath), targetAbs), linkPath, "dir");
}
ensureLink(join(V2_DIR, "node_modules"), resolve(process.cwd(), "runtime/node_modules"));
ensureLink(join(V2_DIR, "atlas-examples"), resolve(process.cwd(), "runtime/atlas-examples"));

const v2 = require_(join(V2_DIR, "flat-first-atlas.cjs"));
const v2Examples = require_(join(V2_DIR, "flat-atlas-topology-examples.cjs"));
if (v2.PROMPT_VERSION !== V2.promptVersion) throw new Error(`vendored PROMPT_VERSION ${v2.PROMPT_VERSION} != ${V2.promptVersion}`);
const sharp = require_("sharp");
const qc = require_("./atlas-master-qc.cjs");
const outputClass = require_("./atlas-output-class.cjs");
const { createProvider } = require_("./generation-provider.cjs");
const { createClient } = require_("@supabase/supabase-js");

const PNG_OPTIONS = Object.freeze({ compressionLevel: 6, adaptiveFiltering: false, palette: false, force: true });

async function preview(bytes, file, width = 1600, quality = 84) {
  writeFileSync(join(OUT, file), await sharp(bytes, { limitInputPixels: false })
    .resize({ width, height: width, fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality }).toBuffer());
  return file;
}

/** Copied verbatim from the v2 module's `verifiedCustomerLogoPart` (not in its _test exports). */
async function v2LogoPart(supabase, input) {
  const asset = input?.logoAsset;
  if (!asset) return [];
  if (!supabase) throw new Error("the fixture carries a customer logo; --offline cannot send it");
  const storagePath = String(asset.storagePath || "").trim();
  const contentHash = String(asset.contentHash || "").trim().toLowerCase();
  const { data, error } = await supabase.storage.from("wrap-files").download(storagePath);
  if (error || !data) throw new Error(`logo download: ${error?.message || "missing"}`);
  const bytes = Buffer.from(await data.arrayBuffer());
  if (sha(bytes) !== contentHash) throw new Error("logo bytes do not match the verified request identity");
  const conditioned = await sharp(bytes, { limitInputPixels: v2.CUSTOMER_REFERENCE_MAX_PIXELS, density: 300 })
    .rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true, kernel: "lanczos3" })
    .png(PNG_OPTIONS).toBuffer();
  return [
    { text: "VERIFIED CUSTOMER-OWNED LOGO. This is a customer style/identity source, not a topology example." },
    { inlineData: { mimeType: "image/png", data: conditioned.toString("base64") } },
  ];
}

function zoneRow(z) {
  return `${z.surfaceKey}: edgeHole ${pct(z.edgeHoleRatio)} · largestCutout ${pct(z.largestCutoutComponentRatio)} · concentratedBlack ${pct(z.concentratedFlatBlackRatio)} · artwork ${pct(z.nonBlackFraction)}`;
}

async function main() {
  const fx = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
  const input = fx.requestInput;
  const manifest = fx.manifest;
  const supabase = OFFLINE ? null : (() => {
    const url = process.env.SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (or pass --offline true)");
    return createClient(url, key, { auth: { persistSession: false } });
  })();

  // ── identity of the fixture against the Aug 22 row ───────────────────────
  const manifestHash = sha(v2._test.canonicalBytes(manifest));
  if (manifestHash !== fx.manifestContentHash) throw new Error(`fixture manifest hashes ${manifestHash.slice(0, 12)}, the stored row says ${fx.manifestContentHash.slice(0, 12)}`);
  log(`fixture ${fx.generationId.slice(0, 8)} · manifest ${manifestHash.slice(0, 12)} MATCHES the stored revision`);

  const renderedGuide = await v2.renderAtlasGuide(manifest);
  const renderedGuideHash = sha(renderedGuide);
  let guideBytes = renderedGuide;
  let guideSource = "rendered-by-vendored-v2";
  if (supabase) {
    const { data, error } = await supabase.storage.from("wrap-files").download(fx.guideStoragePath);
    if (error || !data) throw new Error(`stored guide download: ${error?.message || "missing"}`);
    const stored = Buffer.from(await data.arrayBuffer());
    if (sha(stored) !== fx.guideContentHash) throw new Error("stored guide bytes do not match the revision row");
    guideBytes = stored; guideSource = "stored-aug-22-bytes";
  }
  const guideHash = sha(guideBytes);
  log(`guide: sending ${guideSource} ${guideHash.slice(0, 12)} · vendored renderer reproduces the Aug 22 bytes: ${renderedGuideHash === fx.guideContentHash ? "YES" : `NO (${renderedGuideHash.slice(0, 12)})`}`);
  writeFileSync(join(OUT, "guide.png"), guideBytes);

  // ── the request, in v2's exact part order ────────────────────────────────
  const prompt = v2._test.atlasPrompt(input, manifest);
  const example = v2Examples.loadBundledFlatToFinishedExample();
  const exampleParts = await v2._test.topologyExampleParts([example]);
  const logoParts = await v2LogoPart(supabase, input);
  const refParts = supabase ? await v2._test.verifiedCustomerReferenceParts(supabase, input) : (() => {
    if (Array.isArray(input.visionBoardImages) && input.visionBoardImages.length) throw new Error("fixture carries references; --offline cannot send them");
    return [];
  })();
  const parts = [
    { inlineData: { mimeType: "image/png", data: guideBytes.toString("base64") } },
    { text: prompt },
    ...exampleParts,
    ...logoParts,
    ...refParts,
  ];
  const partManifest = parts.map((p, i) => p.text
    ? { index: i, kind: "text", chars: p.text.length, sha256: sha(p.text), preview: p.text.slice(0, 90) }
    : { index: i, kind: "image", mimeType: p.inlineData.mimeType, bytes: Buffer.from(p.inlineData.data, "base64").length, sha256: sha(Buffer.from(p.inlineData.data, "base64")) });
  writeFileSync(join(OUT, "prompt.txt"), prompt);
  writeFileSync(join(OUT, "requests.json"), JSON.stringify({
    test: "17-v2-parity", sourceCommit: V2.sourceCommit, promptVersion: v2.PROMPT_VERSION,
    fixture: { generationId: fx.generationId, guideHash, guideSource, manifestHash, houdini: example.identity },
    generationConfig: { aspectRatio: "1:1", imageSize: "4K", temperature: "not sent" },
    promptChars: prompt.length, parts: partManifest,
  }, null, 2));
  const produced = ["guide.png", "prompt.txt", "requests.json"];
  log(`request: ${parts.length} parts (${partManifest.filter((p) => p.kind === "image").length} images), prompt ${prompt.length} chars`);
  if (CAPTURE_ONLY) { log("capture-only: no image call"); return finish(supabase, produced); }

  const provider = createProvider({ env: process.env });
  const results = [];
  let imageRequestsExecuted = 0;
  for (let draw = 1; draw <= DRAWS; draw += 1) {
    const label = `draw-${draw}`;
    const t0 = Date.now();
    try {
      log(`${label}: calling ${process.env.DESIGNPANEL_AUTHORING_MODEL || process.env.GOOGLE_IMAGE_MODEL || "configured model"} …`);
      const generated = await provider.generateImage({ parts, aspectRatio: "1:1", imageSize: "4K", label: `v2-parity ${label}` });
      imageRequestsExecuted += 1;
      const elapsedMs = Date.now() - t0;
      const delivered = await sharp(generated.bytes, { limitInputPixels: false }).metadata();
      const master = await v2.normalizeAtlasMaster(generated.bytes, manifest);
      const masterHash = sha(master);
      writeFileSync(join(OUT, `${label}-master.jpg`), await sharp(master, { limitInputPixels: false }).flatten({ background: "#000000" }).jpeg({ quality: 90 }).toBuffer());
      produced.push(`${label}-master.jpg`, await preview(generated.bytes, `${label}-raw-1600.jpg`), await preview(master, `${label}-master-1600.jpg`));
      for (const key of ["driver", "passenger"]) {
        const z = manifest.zones.find((zone) => zone.surfaceKey === key);
        const panel = await sharp(master, { limitInputPixels: false })
          .extract({ left: z.x, top: z.y, width: z.w, height: z.h }).rotate(Number(z.extraction?.outputRotationDegrees || 0)).png().toBuffer();
        produced.push(await preview(panel, `${label}-panel-${key}-1600.jpg`));
      }
      const checks = await qc.deterministicMasterChecks(master, manifest);
      const bleed = await fullBleedMetrics(master, manifest);
      let klass = null;
      try { klass = await outputClass.classifyAtlasCandidate({ provider, bytes: master }); }
      catch (err) { klass = { verdict: "unavailable", error: String(err?.message || err).slice(0, 120) }; }
      const record = {
        draw, ok: true, elapsedMs, model: generated.model || null, delivered: `${delivered.width}x${delivered.height}`, rawHash: sha(generated.bytes), masterHash,
        outputClass: klass?.verdict || klass?.outputClass || klass,
        accepted: checks.accepted, blockingFailures: checks.blockingFailures, cutoutSurfaces: [...new Set(checks.cutoutFindings.map((f) => f.surfaceKey))],
        zones: checks.zones.map((z) => ({ surfaceKey: z.surfaceKey, edgeHoleRatio: z.edgeHoleRatio, largestCutoutComponentRatio: z.largestCutoutComponentRatio, concentratedFlatBlackRatio: z.concentratedFlatBlackRatio, nonBlackFraction: z.nonBlackFraction, lumaStddev: z.lumaStddev })),
        fullBleed: Object.fromEntries(Object.entries(bleed.zones).map(([k, z]) => [k, { nonArtworkRatio: z.nonArtworkRatio, borderArtworkRatio: z.borderArtworkRatio, largestNonArtworkComponentRatio: z.largestNonArtworkComponentRatio }])),
      };
      results.push(record);
      log(`${label}: ${record.delivered} in ${(elapsedMs / 1000).toFixed(1)}s · class ${JSON.stringify(record.outputClass)} · gate ${checks.accepted ? "PASS" : `REFUSE ${checks.blockingFailures.length} blocking`} · cut-outs ${record.cutoutSurfaces.join(",") || "none"}`);
      for (const z of checks.zones) log(`  ${zoneRow(z)} · nonArtwork ${pct(bleed.zones[z.surfaceKey].nonArtworkRatio)} · border ${pct(bleed.zones[z.surfaceKey].borderArtworkRatio)}`);
    } catch (err) {
      results.push({ draw, ok: false, elapsedMs: Date.now() - t0, error: String(err?.message || err).slice(0, 300) });
      log(`${label}: FAILED — ${err.message}`);
    }
  }
  log(`gemini image requests executed: ${imageRequestsExecuted}`);

  const rows = results.map((r) => r.ok
    ? `| ${r.draw} | ${r.delivered} · ${(r.elapsedMs / 1000).toFixed(0)}s | ${typeof r.outputClass === "string" ? r.outputClass : JSON.stringify(r.outputClass)} | ${r.accepted ? "pass" : `REFUSE: ${r.blockingFailures.map((f) => String(f).split(" ")[0]).join("; ")}`} | ${r.cutoutSurfaces.join(", ") || "none"} | ${["driver", "passenger", "hood", "roof", "front", "rear"].map((k) => pct(r.fullBleed[k].nonArtworkRatio)).join(" / ")} | ${["driver", "passenger"].map((k) => pct(r.fullBleed[k].borderArtworkRatio)).join(" / ")} |`
    : `| ${r.draw} | FAILED ${r.error} | | | | | |`);
  const report = [
    `# Test 17 — the 2026-08-22 v2 Call-1 request, verbatim, on today's model (fixture ${fx.generationId.slice(0, 8)})`,
    "",
    `Vendored modules from \`${V2.sourceCommit.slice(0, 12)}\` (\`${v2.PROMPT_VERSION}\`), executed. Guide sent: ${guideSource} \`${guideHash.slice(0, 12)}\`; the vendored renderer ${renderedGuideHash === fx.guideContentHash ? "reproduces" : "does NOT reproduce"} the Aug 22 guide bytes. Parts: guide → prompt (${prompt.length} chars) → Houdini flat top-view → Houdini finished proof → target line${logoParts.length ? " → logo" : ""}${refParts.length ? " → references" : ""}. 1:1, 4K, one call per draw, no gate decides anything.`,
    "",
    "The Aug 22 accepted master measured (read-only, run 34615226749): driver/passenger largest dark shape 4.7% each, non-artwork 10.7% each; roof/front/rear non-artwork 17.9 / 30.2 / 22.4%; door seams and window outlines drawn on both flanks.",
    "",
    "| draw | delivered · time | output class | deterministic gate | cut-out surfaces | non-artwork D / P / H / R / F / Re | border artwork D / P |",
    "|---|---|---|---|---|---|---|",
    ...rows,
    "",
    "Files per draw: `-raw-1600` (as returned), `-master-1600` and `-master.jpg` (normalized, zone-masked), `-panel-driver-1600`, `-panel-passenger-1600` (zone crops, output rotation applied).",
  ].join("\n");
  writeFileSync(join(OUT, "REPORT.md"), report);
  writeFileSync(join(OUT, "results.json"), JSON.stringify({ test: "17-v2-parity", sourceCommit: V2.sourceCommit, promptVersion: v2.PROMPT_VERSION, fixture: fx.generationId, guideHash, guideSource, renderedGuideReproducesAug22: renderedGuideHash === fx.guideContentHash, imageRequestsExecuted, results }, null, 2));
  produced.push("REPORT.md", "results.json");
  return finish(supabase, produced);
}

async function finish(supabase, produced) {
  if (!supabase) { log(`offline: wrote ${produced.length} files to ${OUT}`); return; }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const prefix = `designiq-ab/${stamp}-v2-parity`;
  const urls = {};
  for (const file of produced) {
    try {
      const isText = /\.(txt|md|log)$/.test(file);
      const path = `${prefix}/${file}${isText ? ".json" : ""}`;
      const raw = readFileSync(join(OUT, file));
      const body = isText ? Buffer.from(JSON.stringify({ file, text: raw.toString("utf8") })) : raw;
      const contentType = file.endsWith(".png") ? "image/png" : file.endsWith(".jpg") ? "image/jpeg" : "application/json";
      const { error } = await supabase.storage.from("wrap-files").upload(path, body, { contentType, upsert: true });
      if (error) { log(`upload ${file}: ${error.message}`); continue; }
      const { data } = await supabase.storage.from("wrap-files").createSignedUrl(path, 60 * 60 * 24 * 7);
      if (data?.signedUrl) urls[file] = data.signedUrl;
    } catch (error) { log(`upload ${file}: ${error.message}`); }
  }
  writeFileSync(join(OUT, "signed-urls.json"), JSON.stringify({ prefix, urls }, null, 2));
  console.log("---AB-STORAGE-PREFIX---");
  console.log(prefix);
  console.log("---AB-SIGNED-URLS---");
  console.log(JSON.stringify(urls));
}

main().catch((err) => { console.error(`atlas-v2-parity-ab failed: ${err.stack || err}`); process.exit(1); });
