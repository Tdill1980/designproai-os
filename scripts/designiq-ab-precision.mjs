#!/usr/bin/env node
/**
 * DesignPanelAI ↔ A.T.L.A.S. Call 1 creative-parity A/B.
 *
 * ONE QUESTION: what does the proven `design-panel-ai-generate` implementation
 * send to Gemini for a given payload, what does A.T.L.A.S. Call 1 send for the
 * SAME creative inputs, and what is the factual difference between the two
 * assembled requests?
 *
 * It runs where the credentials are (the droplet), captures BOTH complete
 * pre-Gemini requests, executes both, and hands the images and the diff back.
 *
 *   A   CONTROL   design-panel-ai-generate, mode "commercial" — the branch that
 *                 authored the designs this system's design quality is judged
 *                 against. Its own pinned model, its own generationConfig.
 *   A2  CONTROL   design-panel-ai-generate, mode "artboard" — the control's own
 *                 FLAT branch, so the flattened comparison is apples to apples.
 *   B   SERVER    A.T.L.A.S. Call 1, assembled by the real runtime: real GENIE
 *                 preview geometry, the real deterministic authoring guide, the
 *                 real storage-loaded topology and gold-standard examples.
 *
 * The control implementation is NOT modified. `scripts/build-control-prompt.mjs`
 * transpiles its prompt builders verbatim, and this script fails the run if the
 * assembled control prompt does not hash to the value captured from the
 * restylepro-os checkout.
 *
 * It reads nothing from and writes nothing to the generation tables. No
 * request, revision, view or artifact row is created; the only writes are the
 * evidence objects under `designiq-ab/`.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Everything resolves through the runtime's own require root, so the harness
// runs against the release's modules and the release's supabase-js rather than
// whatever a bare ESM specifier would find beside the script.
const require_ = (await import("node:module")).createRequire(join(process.cwd(), "runtime/"));
const { createClient } = require_("@supabase/supabase-js");
const atlas = require_("./flat-first-atlas.cjs");
const genie = require_("./genie-universal-resolver.cjs");
const examples = require_("./flat-atlas-topology-examples.cjs");
const { createProvider } = require_("./generation-provider.cjs");

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) => (a.startsWith("--") ? [[a.slice(2), all[i + 1]]] : [])),
);
const OUT = args.out || "./ab-evidence";
mkdirSync(OUT, { recursive: true });

const sha = (v) => createHash("sha256").update(v).digest("hex");
const log = (m) => process.stdout.write(`  ${m}\n`);

// ── THE PRECISION CLIMATE SOLUTIONS PAYLOAD ────────────────────────────────
// Verbatim from scripts/production-canary.mjs — the payload that produced the
// server comparison under review. Overridable so the same harness can be
// pointed at another brief, never so this one silently drifts.
const BRIEF = args.brief
  || "Bold commercial HVAC wrap for Precision Climate Solutions: deep blue base with "
  + "sunrise-orange airflow ribbons sweeping front to rear, clean modern sans-serif "
  + "company name, high contrast and legible at highway distance.";
const VEHICLE = {
  type: args["vehicle-type"] || "truck",
  year: args["vehicle-year"] || "2022",
  make: args["vehicle-make"] || "Ford",
  model: args["vehicle-model"] || "F250 Crew Cab",
};
const V3_INPUT = {
  contractVersion: "designpro.calls-1-7-input.v3",
  pipelineMode: "flat-first-atlas-v1",
  vehicle: VEHICLE,
  brief: BRIEF,
  designName: args["design-name"] || "Precision Climate Solutions — July 24 canary",
  mode: "commercial",
  industry: args.industry || "HVAC and climate control",
  colors: (args.colors || "deep blue,sunrise orange").split(",").map((c) => c.trim()),
  style: args.style || "modern commercial",
};

// The SAME creative inputs on design-panel-ai-generate's own request body.
// `colors` → brandColors and `industry` → industryType are the control's names
// for the same fields; `style` and `designName` have no control field at all.
const CONTROL_PARAMS = {
  mode: "commercial",
  prompt: BRIEF,
  finish: "Gloss",
  industryType: V3_INPUT.industry,
  brandColors: V3_INPUT.colors.join(", "),
  vehicleYear: VEHICLE.year,
  vehicleMake: VEHICLE.make,
  vehicleModel: VEHICLE.model,
  visionBoardImages: [],
  visionboard_intent: "style_inspiration",
  viewType: "side",
};

// design-panel-ai-generate/index.ts:1320 — one pinned model, no fallback.
const CONTROL_MODEL = "gemini-3-pro-image-preview";
const CONTROL_ENDPOINT = (model, key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

function partSummary(part, index) {
  if (part.text != null) {
    return { index, kind: "text", chars: part.text.length, sha256: sha(part.text), preview: part.text.slice(0, 90).replace(/\s+/g, " ") };
  }
  const data = part.inlineData?.data || "";
  const bytes = Buffer.from(data, "base64");
  return { index, kind: "image", mimeType: part.inlineData?.mimeType, bytes: bytes.length, sha256: sha(bytes) };
}

function describe(label, { model, modelFallback, parts, generationConfig, systemInstruction, attempts, notes }) {
  return {
    label, model, modelFallback,
    endpointShape: `POST https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    systemInstruction: systemInstruction || null,
    generationConfig,
    serverAttempts: attempts,
    partCount: parts.length,
    textParts: parts.filter((p) => p.text != null).length,
    imageParts: parts.filter((p) => p.inlineData).length,
    totalTextChars: parts.reduce((n, p) => n + (p.text?.length || 0), 0),
    totalImageBytes: parts.reduce((n, p) => n + (p.inlineData ? Buffer.from(p.inlineData.data, "base64").length : 0), 0),
    parts: parts.map(partSummary),
    notes: notes || [],
  };
}

async function callGemini({ label, model, key, parts, generationConfig, file }) {
  log(`${label}: calling ${model} …`);
  const started = Date.now();
  const response = await fetch(CONTROL_ENDPOINT(model, key), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts }], generationConfig }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 400);
    throw new Error(`${label} HTTP ${response.status}: ${detail}`);
  }
  const payload = await response.json();
  const image = (payload?.candidates?.[0]?.content?.parts || []).find((p) => p?.inlineData?.data);
  if (!image) {
    const reason = payload?.candidates?.[0]?.finishReason || payload?.promptFeedback?.blockReason || "unknown";
    throw new Error(`${label} returned no image (${reason})`);
  }
  const bytes = Buffer.from(image.inlineData.data, "base64");
  writeFileSync(file, bytes);
  log(`${label}: ${(bytes.length / 1024).toFixed(0)}KB in ${((Date.now() - started) / 1000).toFixed(1)}s → ${file}`);
  return { bytes, contentHash: sha(bytes), model, mimeType: image.inlineData.mimeType, elapsedMs: Date.now() - started };
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const keyPool = String(process.env.GOOGLE_AI_API_KEY_POOL || process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY || "")
    .split(",").map((k) => k.trim()).filter(Boolean);
  if (!supabaseUrl || !serviceKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  if (!keyPool.length) throw new Error("no Google AI key configured");
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const provider = createProvider({ env: process.env });

  const controlPath = args.control || "./control-build/control-prompt.mjs";
  const control = await import(new URL(controlPath, `file://${process.cwd()}/`).href);

  // ── A / A2: THE CONTROL REQUESTS ────────────────────────────────────────
  const controlCommercialPrompt = control.buildDesignIQPrompt(CONTROL_PARAMS);
  const controlHash = sha(controlCommercialPrompt);
  log(`control commercial prompt ${controlCommercialPrompt.length} chars, sha ${controlHash.slice(0, 16)}`);
  if (args["expect-control-hash"] && !controlHash.startsWith(args["expect-control-hash"])) {
    throw new Error(
      `the vendored control no longer reproduces the restylepro-os control prompt `
      + `(${controlHash.slice(0, 16)} != ${args["expect-control-hash"]}) — the control has drifted and is not a control`,
    );
  }

  // ── B: THE SERVER REQUEST, ASSEMBLED BY THE REAL RUNTIME ────────────────
  log("resolving GENIE preview dimensions …");
  const dimensionRow = await genie.resolveFlatAtlasPreviewDimensions(supabase, VEHICLE, provider);
  const surfaces = genie.expectedSurfacesFromRow(dimensionRow);
  const manifest = atlas.buildAtlasManifest(surfaces, dimensionRow.proofGeometryAuthority);
  const atlasPromptText = atlas._test.atlasPrompt(V3_INPUT, manifest);
  const authoringGuideBytes = await atlas.renderAtlasAuthoringGuide(manifest);
  log(`atlas prompt ${atlasPromptText.length} chars, authoring guide ${(authoringGuideBytes.length / 1024).toFixed(0)}KB`);

  const [topologyExamples, artboardQualityExamples] = await Promise.all([
    examples.loadActiveFlatAtlasTopologyExamples(supabase),
    examples.loadDesignPanelArtboardExamples(supabase),
  ]);
  log(`${topologyExamples.length} topology example(s), ${artboardQualityExamples.length} gold-standard artboard(s)`);

  const bParts = [
    { inlineData: { mimeType: "image/png", data: authoringGuideBytes.toString("base64") } },
    { text: atlasPromptText },
    ...(await atlas._test.topologyExampleParts(topologyExamples)),
    ...(await atlas._test.artboardQualityExampleParts(artboardQualityExamples)),
  ];

  // A2 attaches the control's own example artboards — the same bucket
  // `loadArtboardExamples` reads — as raw image parts after the prompt, which
  // is the control's own ordering.
  const controlArtboardPrompt = control.buildDesignIQPrompt({
    ...CONTROL_PARAMS,
    mode: "artboard",
    panels: surfaces.map((s) => ({
      label: { driver: "DRIVER SIDE", passenger: "PASSENGER SIDE", hood: "HOOD", roof: "ROOF", front: "FRONT", rear: "REAR" }[s.surfaceKey],
      widthInches: s.widthInches,
      heightInches: s.heightInches,
    })),
  });
  const a2Parts = [
    { text: controlArtboardPrompt },
    ...artboardQualityExamples.map((e) => ({ inlineData: { mimeType: e.contentType, data: e.bytes.toString("base64") } })),
  ];

  const requests = {
    contract: "designpro.designiq-ab-precision.v1",
    ranAt: new Date().toISOString(),
    payload: { brief: BRIEF, vehicle: VEHICLE, v3Input: V3_INPUT, controlParams: CONTROL_PARAMS },
    atlasPromptVersion: atlas.PROMPT_VERSION,
    designPanelArtboardPortVersion: require_("./designiq-prompt.cjs").DESIGNPANEL_ARTBOARD_PORT_VERSION,
    droplet: {
      GOOGLE_IMAGE_MODEL: process.env.GOOGLE_IMAGE_MODEL || null,
      DESIGNPRO_IMAGE_MODELS: process.env.DESIGNPRO_IMAGE_MODELS || null,
      resolvedImageModels: provider.models,
    },
    A: describe("A — CONTROL design-panel-ai-generate mode:commercial", {
      model: CONTROL_MODEL,
      modelFallback: "none — one pinned model (index.ts:1320)",
      parts: [{ text: controlCommercialPrompt }],
      generationConfig: { temperature: 1.0, responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: "16:9", imageSize: "4K" } },
      attempts: "MAX_IMAGE_ATTEMPTS = 2",
      notes: [
        "studioAnchorParts is empty by design (image anchor disabled, index.ts:1310)",
        "originalRenderParts empty — no originalRenderUrl in this payload",
        "visionBoardParts empty — no references in this payload",
        "artboardExampleParts empty — commercial mode does not load them",
      ],
    }),
    A2: describe("A2 — CONTROL design-panel-ai-generate mode:artboard", {
      model: CONTROL_MODEL,
      modelFallback: "none — one pinned model",
      parts: a2Parts,
      generationConfig: { temperature: 1.0, responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: "16:9", imageSize: "4K" } },
      attempts: "MAX_IMAGE_ATTEMPTS = 2",
      notes: ["the control's own flat branch — the apples-to-apples flattened control"],
    }),
    B: describe("B — SERVER A.T.L.A.S. Call 1", {
      model: provider.models[0],
      modelFallback: "none — Call 1 passes lockModel:true",
      parts: bParts,
      generationConfig: { temperature: 1, responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: "1:1", imageSize: "4K" } },
      attempts: "MAX_MASTER_AUTHORING_ATTEMPTS = 3 (corrective re-roll on QC refusal)",
      notes: [
        "the deterministic authoring guide is the FIRST part, ahead of the prompt text",
        `atlas prompt version ${atlas.PROMPT_VERSION}`,
      ],
    }),
  };
  writeFileSync(join(OUT, "requests.json"), JSON.stringify(requests, null, 2));
  writeFileSync(join(OUT, "A-control-commercial.prompt.txt"), controlCommercialPrompt);
  writeFileSync(join(OUT, "A2-control-artboard.prompt.txt"), controlArtboardPrompt);
  writeFileSync(join(OUT, "B-atlas-call1.prompt.txt"), atlasPromptText);
  writeFileSync(join(OUT, "B-atlas-creative-half.txt"), atlas._test.atlasCreativeRules(V3_INPUT));
  writeFileSync(join(OUT, "B-authoring-guide.png"), authoringGuideBytes);
  log(`requests captured → ${OUT}/requests.json`);

  if (args["capture-only"] === "true") return finish(supabase, requests, []);

  // ── EXECUTE ────────────────────────────────────────────────────────────
  const key = keyPool[0];
  const results = {};
  const produced = [];
  for (const [name, spec] of [
    ["A", { parts: [{ text: controlCommercialPrompt }], model: CONTROL_MODEL, cfg: requests.A.generationConfig, file: "A-control-commercial.png" }],
    ["A2", { parts: a2Parts, model: CONTROL_MODEL, cfg: requests.A2.generationConfig, file: "A2-control-artboard.png" }],
    ["B", { parts: bParts, model: provider.models[0], cfg: requests.B.generationConfig, file: "B-atlas-master.png" }],
  ]) {
    try {
      const out = await callGemini({
        label: name, model: spec.model, key, parts: spec.parts,
        generationConfig: spec.cfg, file: join(OUT, spec.file),
      });
      results[name] = { ok: true, file: spec.file, contentHash: out.contentHash, bytes: out.bytes.length, model: out.model, elapsedMs: out.elapsedMs };
      produced.push(spec.file);
    } catch (error) {
      log(`${name}: FAILED — ${error.message}`);
      results[name] = { ok: false, error: String(error.message).slice(0, 500) };
    }
  }
  writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));
  return finish(supabase, { ...requests, results }, produced);
}

/**
 * Hand the evidence back as signed URLs. The bytes also travel home in the
 * workflow's tar stream; the URLs exist so the images can be opened without
 * downloading an artifact.
 */
async function finish(supabase, manifestValue, produced) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const prefix = `designiq-ab/${stamp}`;
  const urls = {};
  for (const file of [...produced, "requests.json", "A-control-commercial.prompt.txt", "A2-control-artboard.prompt.txt", "B-atlas-call1.prompt.txt"]) {
    try {
      const path = `${prefix}/${file}`;
      const body = readFileSync(join(OUT, file));
      const contentType = file.endsWith(".png") ? "image/png" : file.endsWith(".json") ? "application/json" : "text/plain";
      const { error } = await supabase.storage.from("wrap-files").upload(path, body, { contentType, upsert: true });
      if (error) { log(`upload ${file}: ${error.message}`); continue; }
      const { data } = await supabase.storage.from("wrap-files").createSignedUrl(path, 60 * 60 * 24 * 7);
      if (data?.signedUrl) urls[file] = data.signedUrl;
    } catch (error) { log(`upload ${file}: ${error.message}`); }
  }
  writeFileSync(join(OUT, "signed-urls.json"), JSON.stringify(urls, null, 2));
  console.log("---AB-SIGNED-URLS---");
  console.log(JSON.stringify(urls));
  console.log("---AB-SUMMARY---");
  console.log(JSON.stringify({
    atlasPromptVersion: manifestValue.atlasPromptVersion,
    droplet: manifestValue.droplet,
    A: { chars: manifestValue.A.totalTextChars, parts: manifestValue.A.partCount, images: manifestValue.A.imageParts, model: manifestValue.A.model },
    A2: { chars: manifestValue.A2.totalTextChars, parts: manifestValue.A2.partCount, images: manifestValue.A2.imageParts, model: manifestValue.A2.model },
    B: { chars: manifestValue.B.totalTextChars, parts: manifestValue.B.partCount, images: manifestValue.B.imageParts, model: manifestValue.B.model },
    results: manifestValue.results || null,
  }, null, 2));
}

main().catch((error) => {
  console.error(`designiq-ab-precision failed: ${error?.stack || error}`);
  process.exit(1);
});
