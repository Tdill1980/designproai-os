#!/usr/bin/env node
/**
 * TEST 15 — FROM THE PRE-MIGRATION 3D HERO TO THE FLAT FIELD. Harness only.
 *
 * Owner (Trish, 2026-09-11): "the 3D design portion must be coded like we had
 * prior to migration — it worked 99% accuracy, we did over 500 designs." The
 * pre-migration design step was the driver-side 3D hero, composed ON the
 * vehicle by the golden persona in one pass. What never worked reliably was
 * getting six flat print files out of it (RestylePro's own count, 2026-07-30:
 * 72 branded flat artboards from 148 designs).
 *
 * This test takes FOUR real pre-migration heroes (the actual July/August
 * renders from the RestylePro database, `scripts/fixtures/premigration-heroes.json`)
 * and measures the two ways of turning an approved 3D design into the one
 * continuous flat field that the code then cuts into six panels:
 *
 *   R — REPRODUCE: the one-field Call 1 exactly as the edge assembles it when
 *       the request carries `visionboardIntent: exact_reference` and the hero
 *       as the verified reference image. The persona becomes the
 *       "vehicle wrap REPRODUCTION specialist" and the tail is the v3 field
 *       tail. 1:1 4K, gated, classified and cut on the field territories
 *       exactly as production would.
 *   E — EDIT: the pre-migration request, verbatim from RestylePro
 *       `generate-2d-proof/index.ts` (brandedTiers[0]): edit the hero, remove
 *       every vehicle part, keep the design and every logo exactly, extend it
 *       to all four edges. 21:9 at 2K, the July first attempt. Classified and
 *       measured whole (it is a strip, not a 4096² field).
 *
 * One image call per hero per arm: at most 8. The owner's eye on the raw
 * outputs beside the hero decides; the numbers are telemetry.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fullBleedMetrics } from "./atlas-fullbleed-metrics.mjs";

const require_ = (await import("node:module")).createRequire(join(process.cwd(), "runtime/"));
const { createClient } = require_("@supabase/supabase-js");
const sharp = require_("sharp");
const atlas = require_("./flat-first-atlas.cjs");
const genie = require_("./genie-universal-resolver.cjs");
const qc = require_("./atlas-master-qc.cjs");
const outputClass = require_("./atlas-output-class.cjs");
const { buildFieldTerritories, FIELD_TOPOLOGY } = require_("./atlas-field-territories.cjs");
const { createProvider } = require_("./generation-provider.cjs");

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) => (a.startsWith("--") ? [[a.slice(2), all[i + 1]]] : [])),
);
const OUT = args.out || "./ab-evidence";
mkdirSync(OUT, { recursive: true });
const sha = (v) => createHash("sha256").update(v).digest("hex");
const log = (m) => process.stdout.write(`  ${m}\n`);
const truthy = (v) => String(v).toLowerCase() === "true";
const pct = (v) => `${(v * 100).toFixed(1)}%`;
const HASH_RE = /^[a-f0-9]{64}$/;

const FIXTURE = args.heroes || "./scripts/fixtures/premigration-heroes.json";
const ARMS = String(args.arms || "R,E").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
for (const arm of ARMS) if (!["R", "E"].includes(arm)) throw new Error(`unknown arm ${arm}; arms are R,E`);
const HERO_LIMIT = Math.min(4, Math.max(1, Number(args.draws || 4)));

const FIELD_CONFIG = { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: "1:1", imageSize: "4K" } };
// The July first attempt for a flank: the nearest supported ratio to the GENIE
// side inches (21:9 for every flank in the fixture) at 2K.
const EDIT_CONFIG = { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: "21:9", imageSize: "2K" } };

// VERBATIM: restylepro-os supabase/functions/generate-2d-proof/index.ts, brandedTiers[0]
// (commit a3e4917, 2026-07-30). Not edited here; a harness citation of the working request.
export const JULY_BRANDED_EDIT_PROMPT = "Take the attached image and EDIT it — do NOT redraw, restyle, or reinvent anything. COMPLETELY remove every vehicle part: body, cab, windows and glass, wheels, tires, bumpers, mirrors, lights, the ground, and the studio background — 100% gone, zero remaining outline or shadow of any vehicle part. KEEP the ENTIRE wrap design EXACTLY as shown — identical colors, shards, gradients, and flow, AND every logo, company name, phone number, website, and line of text in its exact position, size, and style, fully opaque and legible. If it contains a flag, preserve that EXACT flag. The result must be flat, solid, and fully opaque everywhere the vehicle used to be — no ghosting, no partial transparency, no visible remnant of the vehicle. Fill and extend the real design seamlessly out to all four edges, so the result is ONE continuous flat rectangle of the COMPLETE branded artwork — no vehicle, no empty space, and nothing removed from the design itself.";
export const JULY_SOURCE_LABEL = "SIDE SOURCE IMAGE — edit THIS image and keep its exact pixels:";

async function conditionReference(bytes) {
  // Same conditioning as runtime verifiedCustomerReferenceParts: 1600 px inside, PNG.
  return sharp(bytes, { limitInputPixels: false, density: 300 })
    .rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true, kernel: "lanczos3" })
    .png().toBuffer();
}

async function fetchBytes(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`hero download ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function borderRing(rawBytes) {
  const S = 512;
  const { data, info } = await sharp(rawBytes, { limitInputPixels: false }).resize(S, S, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const ring = Math.max(2, Math.round(S * 0.02));
  const luma = [];
  for (let y = 0; y < info.height; y += 1) for (let x = 0; x < info.width; x += 1) {
    if (x < ring || y < ring || x >= info.width - ring || y >= info.height - ring) {
      const i = (y * info.width + x) * info.channels;
      luma.push(Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]));
    }
  }
  const mean = luma.reduce((t, v) => t + v, 0) / luma.length;
  const std = Math.sqrt(luma.reduce((t, v) => t + (v - mean) ** 2, 0) / luma.length);
  const sorted = [...luma].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return { lumaStd: Number(std.toFixed(2)), median, nearMedianShare: Number((luma.filter((v) => Math.abs(v - median) <= 6).length / luma.length).toFixed(4)) };
}

async function preview(bytes, file, width = 1600) {
  writeFileSync(join(OUT, file), await sharp(bytes, { limitInputPixels: false })
    .resize({ width, height: width, fit: "inside" }).flatten({ background: "#ffffff" }).jpeg({ quality: 84 }).toBuffer());
  return file;
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const keyPool = String(process.env.GOOGLE_AI_API_KEY_POOL || process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY || "")
    .split(",").map((k) => k.trim()).filter(Boolean);
  if (!supabaseUrl || !serviceKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const captureOnly = truthy(args["capture-only"]);
  if (!captureOnly && !keyPool.length) throw new Error("no Google AI key configured");
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const provider = createProvider({ env: process.env });
  const call1 = await import(new URL(args.call1 || "./atlas-call1-build/atlas-call1-prompt.mjs", `file://${process.cwd()}/`).href);

  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));
  const heroes = fixture.heroes.slice(0, HERO_LIMIT);
  const produced = [];
  const results = [];
  let imageRequestsExecuted = 0;

  for (const hero of heroes) {
    const record = { label: hero.label, generationId: hero.generationId, companyName: hero.companyName, vehicle: hero.vehicle, arms: {} };
    results.push(record);
    let heroBytes;
    try {
      heroBytes = await fetchBytes(hero.sideUrl);
    } catch (error) {
      log(`${hero.label}: hero download failed — ${error.message}`);
      record.error = String(error.message);
      continue;
    }
    const heroMeta = await sharp(heroBytes, { limitInputPixels: false }).metadata();
    record.hero = { sha256: sha(heroBytes), width: heroMeta.width, height: heroMeta.height, preview: await preview(heroBytes, `${hero.label}-hero-1600.jpg`) };
    produced.push(record.hero.preview);
    const conditioned = await conditionReference(heroBytes);
    const heroB64 = conditioned.toString("base64");

    // ── GENIE geometry and the field territories for THIS vehicle ───────────
    let fieldManifest = null;
    try {
      const dimensionRow = await genie.resolveFlatAtlasPreviewDimensions(supabase, hero.vehicle, provider);
      const surfaces = genie.expectedSurfacesFromRow(dimensionRow);
      const six = atlas.buildAtlasManifest(surfaces, dimensionRow.proofGeometryAuthority, hero.vehicle.type);
      const geometryResolution = dimensionRow.geometryResolution || null;
      if (!geometryResolution || !HASH_RE.test(String(geometryResolution.genieManifestHash || ""))) throw new Error("GENIE manifest identity absent");
      six.geometryResolution = geometryResolution;
      fieldManifest = buildFieldTerritories(six);
      fieldManifest.geometryResolution = geometryResolution;
      if (fieldManifest.topology !== FIELD_TOPOLOGY) throw new Error("field territories did not produce the field topology");
      record.geometry = { state: geometryResolution.state, genieManifestHash: geometryResolution.genieManifestHash };
    } catch (error) {
      log(`${hero.label}: GENIE resolve failed — ${error.message}`);
      record.error = String(error.message);
      continue;
    }

    // ── ARM R: the one-field Call 1 with the hero as the exact reference ────
    if (ARMS.includes("R")) {
      const input = {
        contractVersion: "designpro.calls-1-7-input.v3", pipelineMode: "flat-first-atlas-v1",
        vehicle: hero.vehicle, brief: hero.brief, designName: `${hero.label} hero-to-field`, mode: "commercial",
        ...(hero.companyName ? { companyName: hero.companyName } : {}), finish: "Gloss",
        visionboardIntent: "exact_reference",
      };
      const body = atlas._test.atlasEdgeRequestBody(input, fieldManifest, { referenceImagesBase64: [heroB64] });
      if (body.fieldContract !== atlas.ATLAS_FIELD_PROMPT_CONTRACT || body.teachingProofStoragePath || body.guideStoragePath) {
        throw new Error("the field request must carry the field contract and no structural images");
      }
      const assembled = call1.buildAtlasCall1Prompt(body);
      const prompt = assembled.prompt;
      // Commercial mode carries the exact-reference clause ("EXACT REFERENCE: The
      // provided reference is the customer's approved artwork authority ...
      // across the whole continuous field"); the "REPRODUCTION specialist"
      // identity is the restyle-mode form. Run 34567668316 failed on that
      // mismatch before any image call was spent.
      if (!/EXACT REFERENCE: The provided reference is the customer's approved artwork authority/.test(prompt)) {
        throw new Error("exact_reference did not select the exact-reference clause");
      }
      if (assembled.references.length !== 1) throw new Error(`expected the hero as the one reference, got ${assembled.references.length}`);
      const parts = [{ text: prompt }, ...assembled.references.map((data) => ({ inlineData: { mimeType: "image/png", data } }))];
      writeFileSync(join(OUT, `${hero.label}-R-prompt.txt`), prompt);
      produced.push(`${hero.label}-R-prompt.txt`);
      const arm = { contract: body.fieldContract, promptChars: prompt.length, promptSha256: sha(prompt), parts: parts.length, images: 1, generationConfig: FIELD_CONFIG };
      record.arms.R = arm;
      if (!captureOnly) {
        const started = Date.now();
        try {
          log(`${hero.label} R: calling ${call1.AUTHORING_MODEL} (reproduce the hero as one field) …`);
          imageRequestsExecuted += 1;
          const result = await provider.generateRaw({ model: call1.AUTHORING_MODEL, body: { contents: [{ role: "user", parts }], generationConfig: FIELD_CONFIG }, timeoutMs: 300_000, label: `hero-to-field R ${hero.label}` });
          const cparts = result.payload?.candidates?.[0]?.content?.parts || [];
          const image = cparts.filter((p) => p?.inlineData?.data).pop();
          if (!image) throw new Error(`no image (${result.payload?.candidates?.[0]?.finishReason || result.payload?.promptFeedback?.blockReason || "unknown"})`);
          const raw = Buffer.from(image.inlineData.data, "base64");
          writeFileSync(join(OUT, `${hero.label}-R-raw-master.png`), raw); produced.push(`${hero.label}-R-raw-master.png`);
          produced.push(await preview(raw, `${hero.label}-R-raw-master-1600.jpg`));
          const normalized = await atlas.normalizeAtlasMaster(raw, fieldManifest);
          const masterHash = sha(normalized.bytes);
          const checks = await qc.deterministicMasterChecks(normalized.bytes, fieldManifest);
          const klass = await outputClass.classifyAtlasCandidate({ provider, bytes: normalized.bytes });
          const panels = await atlas.cutCallOnePanels(normalized.bytes, fieldManifest, masterHash);
          for (const p of panels) {
            if (p.surfaceKey === "driver" || p.surfaceKey === "passenger" || p.surfaceKey === "hood") {
              produced.push(await preview(p.bytes, `${hero.label}-R-panel-${p.surfaceKey}-1600.jpg`));
            }
          }
          Object.assign(arm, {
            ok: true, elapsedMs: Date.now() - started, rawSha256: sha(raw), normalizedHash: masterHash,
            deterministic: { accepted: checks.accepted, blockingFailures: checks.blockingFailures, cutoutFindings: (checks.cutoutFindings || []).map((f) => f.finding || f) },
            outputClass: { disposition: klass.disposition, blocking: klass.blocking, evidence: klass.evidence },
            borderRing: await borderRing(raw),
          });
          log(`${hero.label} R: ${checks.accepted ? "gates PASS" : "gates REFUSE"} (${(checks.cutoutFindings || []).length} cut-out) · class ${klass.disposition} · ring std ${arm.borderRing.lumaStd}`);
        } catch (error) {
          Object.assign(arm, { ok: false, error: String(error.message).slice(0, 500) });
          log(`${hero.label} R: FAILED — ${error.message}`);
        }
      }
    }

    // ── ARM E: the pre-migration edit, verbatim ─────────────────────────────
    if (ARMS.includes("E")) {
      const parts = [{ text: JULY_BRANDED_EDIT_PROMPT }, { text: JULY_SOURCE_LABEL }, { inlineData: { mimeType: "image/png", data: heroB64 } }];
      const arm = { contract: "restylepro generate-2d-proof brandedTiers[0] @ a3e4917", promptChars: JULY_BRANDED_EDIT_PROMPT.length, parts: parts.length, images: 1, generationConfig: EDIT_CONFIG };
      record.arms.E = arm;
      if (!captureOnly) {
        const started = Date.now();
        try {
          log(`${hero.label} E: calling ${call1.AUTHORING_MODEL} (July edit: remove the vehicle, keep the design) …`);
          imageRequestsExecuted += 1;
          const result = await provider.generateRaw({ model: call1.AUTHORING_MODEL, body: { contents: [{ role: "user", parts }], generationConfig: EDIT_CONFIG }, timeoutMs: 300_000, label: `hero-to-field E ${hero.label}` });
          const cparts = result.payload?.candidates?.[0]?.content?.parts || [];
          const image = cparts.filter((p) => p?.inlineData?.data).pop();
          if (!image) throw new Error(`no image (${result.payload?.candidates?.[0]?.finishReason || result.payload?.promptFeedback?.blockReason || "unknown"})`);
          const raw = Buffer.from(image.inlineData.data, "base64");
          const meta = await sharp(raw, { limitInputPixels: false }).metadata();
          writeFileSync(join(OUT, `${hero.label}-E-raw-strip.png`), raw); produced.push(`${hero.label}-E-raw-strip.png`);
          produced.push(await preview(raw, `${hero.label}-E-raw-strip-1600.jpg`));
          const whole = await fullBleedMetrics(raw, { zones: [{ surfaceKey: "driver", rect: { x: 0, y: 0, w: meta.width, h: meta.height } }] });
          const klass = await outputClass.classifyAtlasCandidate({ provider, bytes: raw });
          Object.assign(arm, {
            ok: true, elapsedMs: Date.now() - started, rawSha256: sha(raw), width: meta.width, height: meta.height,
            fullBleed: whole.zones?.[0] || whole,
            outputClass: { disposition: klass.disposition, blocking: klass.blocking, evidence: klass.evidence },
            borderRing: await borderRing(raw),
          });
          log(`${hero.label} E: ${meta.width}x${meta.height} · class ${klass.disposition} · ring std ${arm.borderRing.lumaStd}`);
        } catch (error) {
          Object.assign(arm, { ok: false, error: String(error.message).slice(0, 500) });
          log(`${hero.label} E: FAILED — ${error.message}`);
        }
      }
    }
  }

  log(`gemini image requests executed: ${imageRequestsExecuted}`);
  const rows = [];
  for (const r of results) {
    for (const k of ARMS) {
      const a = r.arms[k];
      if (!a) continue;
      rows.push(a.ok === false
        ? `| ${r.label} | ${k} | FAILED | ${a.error} | | |`
        : a.ok
          ? `| ${r.label} | ${k} | ${k === "R" ? (a.deterministic.accepted ? "pass" : `REFUSE (${a.deterministic.blockingFailures.length} blocking)`) + (a.deterministic.cutoutFindings.length ? ` · ${a.deterministic.cutoutFindings.length} cut-out` : "") : `${a.width}×${a.height}`} | ${a.outputClass.disposition}${a.outputClass.evidence ? ` — ${a.outputClass.evidence}` : ""} | ${a.borderRing.lumaStd} / ${pct(a.borderRing.nearMedianShare)} | ${(a.elapsedMs / 1000).toFixed(1)}s |`
          : `| ${r.label} | ${k} | captured | | | |`);
    }
  }
  const report = [
    "# Test 15 — from the pre-migration 3D hero to the flat field",
    "",
    `Model \`${call1.AUTHORING_MODEL}\`. R: the one-field Call 1 with the hero as \`exact_reference\` (${JSON.stringify(FIELD_CONFIG.imageConfig)}). E: the July edit request verbatim (${JSON.stringify(EDIT_CONFIG.imageConfig)}).`,
    "",
    "| hero | arm | gates / size | output class | border ring std / near-median | time |",
    "|---|---|---|---|---|---|",
    ...rows,
    "",
    "Heroes: " + results.map((r) => `${r.label} (${r.generationId.slice(0, 8)}, ${r.vehicle.year} ${r.vehicle.make} ${r.vehicle.model})`).join(" · "),
    "",
    "## The July edit prompt (verbatim)",
    "", "```text", JULY_BRANDED_EDIT_PROMPT, "```", "",
  ].join("\n");
  writeFileSync(join(OUT, "REPORT.md"), report);
  writeFileSync(join(OUT, "results.json"), JSON.stringify({ arms: ARMS, imageRequestsExecuted, fixture: FIXTURE, results }, null, 2));
  produced.push("REPORT.md", "results.json");
  return finish(supabase, produced);
}

async function finish(supabase, produced) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const prefix = `designiq-ab/${stamp}-hero-to-field`;
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

if (process.argv[1] && process.argv[1].endsWith("atlas-hero-to-field-ab.mjs")) {
  main().catch((error) => {
    console.error(`atlas-hero-to-field-ab failed: ${error?.stack || error}`);
    process.exit(1);
  });
}
