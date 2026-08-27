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
 *                 legacy FLAT branch, so the flattened comparison is apples to
 *                 apples.
 *   B   SERVER    A.T.L.A.S. Call 1, assembled by the real runtime — since the
 *                 owner's 2026-08-26 canonical directive this IS the real
 *                 design-panel-ai-generate builder in atlasTopology mode: real
 *                 GENIE preview geometry, the real deterministic authoring
 *                 guide, the real storage-loaded topology and gold-standard
 *                 examples.
 *   C   ARTWORK   DPAG craft aimed at ONE flat banner; code composes the six
 *                 zones afterwards (atlas-artwork-compose).
 *   B-configured  only when the droplet's configured image model differs from
 *                 the pinned authoring model — one extra call so the model is
 *                 never a confound.
 *
 * `--arms A,B` executes only the named arms (all captures are still written).
 * The OWNER ACCEPTANCE RUN is `--arms B`: exactly ONE Gemini image request,
 * and the executed request count is printed in the summary.
 *
 * The control implementation is NOT modified. `scripts/build-control-prompt.mjs`
 * transpiles its prompt builders verbatim, and this script refuses to run if
 * the SLICED CONTROL SOURCE does not hash to the pinned value. The guard is
 * payload-independent on purpose: it used to hash the ASSEMBLED prompt, which
 * embeds the brief and the vehicle, so pointing the harness at any other
 * payload tripped "control drift" — conflating "the control code drifted" with
 * "you changed the payload" and blocking every non-default run.
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
const ace = require_("./designiq-prompt.cjs");
const { composeAtlasFromArtwork } = require_("./atlas-artwork-compose.cjs");

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) => (a.startsWith("--") ? [[a.slice(2), all[i + 1]]] : [])),
);
const CANARY_OWNER_ID = "b940320d-cb5a-4b60-b280-32d12ef4d6a6"; // canary-operator@designproai.com
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
// What Call 1 pins for authoring. Read from the runtime rather than repeated
// here, so the harness cannot report a model production no longer uses.
const AUTHORING_MODEL = require_("./designiq-prompt.cjs").DESIGNPANEL_AUTHORING_MODEL;
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

async function callGemini({ label, model, key, parts, generationConfig, file, systemInstruction }) {
  log(`${label}: calling ${model} …`);
  const started = Date.now();
  const response = await fetch(CONTROL_ENDPOINT(model, key), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      // designpro-artboard delivers its persona as a real system instruction
      // (index.ts:110). A.T.L.A.S. Call 1 has never sent one at all.
      ...(systemInstruction ? { system_instruction: { parts: [{ text: systemInstruction }] } } : {}),
      contents: [{ parts }],
      generationConfig,
    }),
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

  // ── CONTROL-DRIFT GUARD — SOURCE-BASED AND UNCONDITIONAL ────────────────
  // Hash the sliced control SOURCE (`control-prompt.ts`, written beside the
  // bundle by build-control-prompt.mjs), never the assembled prompt: the
  // assembled prompt embeds the brief and vehicle, so hashing it made every
  // non-default payload read as "control drift" while real drift on a
  // non-default payload went undetected. A drifted control is not a control,
  // so the expectation is REQUIRED — omitting the flag no longer skips the
  // guard.
  const controlSourcePath = controlPath.replace(/control-prompt\.mjs$/, "control-prompt.ts");
  const controlSourceHash = sha(readFileSync(new URL(controlSourcePath, `file://${process.cwd()}/`)));
  log(`control sliced source sha ${controlSourceHash.slice(0, 16)}`);
  if (!args["expect-control-hash"]) {
    throw new Error("--expect-control-hash is required — a run with no pinned control is not a controlled run");
  }
  if (controlSourceHash !== args["expect-control-hash"] && !controlSourceHash.startsWith(args["expect-control-hash"])) {
    throw new Error(
      `the vendored control source no longer matches the pinned slice `
      + `(${controlSourceHash.slice(0, 16)} != ${args["expect-control-hash"]}) — the control has drifted and is not a control`,
    );
  }

  // ── A / A2: THE CONTROL REQUESTS ────────────────────────────────────────
  const controlCommercialPrompt = control.buildDesignIQPrompt(CONTROL_PARAMS);
  log(`control commercial prompt ${controlCommercialPrompt.length} chars, sha ${sha(controlCommercialPrompt).slice(0, 16)}`);

  // ── B: THE SERVER REQUEST, ASSEMBLED BY THE REAL RUNTIME ────────────────
  log("resolving GENIE preview dimensions …");
  const dimensionRow = await genie.resolveFlatAtlasPreviewDimensions(supabase, VEHICLE, provider);
  const surfaces = genie.expectedSurfacesFromRow(dimensionRow);
  const manifest = atlas.buildAtlasManifest(surfaces, dimensionRow.proofGeometryAuthority);

  // Examples load BEFORE the prompt is assembled: the prompt's quality-bar
  // clause follows the gold-standard attachment count, so building it first
  // reproduced the "prompt cites attachments the request does not carry"
  // defect inside the harness itself.
  const [topologyExamples, artboardQualityExamples] = await Promise.all([
    examples.loadActiveFlatAtlasTopologyExamples(supabase),
    examples.loadDesignPanelArtboardExamples(supabase),
  ]);
  log(`${topologyExamples.length} topology example(s), ${artboardQualityExamples.length} gold-standard artboard(s)`);

  // B IS THE PRODUCT PATH (owner directive 2026-08-27): the runtime assembles
  // no creative text — it POSTs this body to the deployed
  // design-panel-ai-generate edge function, which executes the real Persona-2
  // builder and makes the one Gemini image request itself.
  const authoringGuideBytes = await atlas.renderAtlasAuthoringGuide(manifest);
  const topologyParts = await atlas._test.topologyExampleParts(topologyExamples);
  const structuralImage = topologyParts.find((part) => part?.inlineData?.data);
  // The harness stages the same two inputs the product stages, so arm B is the
  // product request byte for byte (owner directive 2026-08-27).
  const stage = async (bytes, contentType) => {
    const path = `atlas-call1-inputs/${sha(bytes)}.${contentType === "image/jpeg" ? "jpg" : "png"}`;
    const { error } = await supabase.storage.from("wrap-files").upload(path, bytes, { contentType, upsert: true });
    if (error) throw new Error(`staging ${path} failed: ${error.message}`);
    return path;
  };
  const structuralBytes = structuralImage?.inlineData?.data
    ? Buffer.from(structuralImage.inlineData.data, "base64")
    : null;
  const structuralMime = structuralImage?.inlineData?.mimeType || "image/jpeg";
  const bEdgeBody = atlas._test.atlasEdgeRequestBody(V3_INPUT, manifest, {
    guideStoragePath: await stage(authoringGuideBytes, "image/png"),
    structuralReferenceStoragePath: structuralBytes ? await stage(structuralBytes, structuralMime) : undefined,
    structuralReferenceMime: structuralMime,
  });
  log(`atlas edge request ${(JSON.stringify(bEdgeBody).length / 1024).toFixed(0)}KB, authoring guide ${(authoringGuideBytes.length / 1024).toFixed(0)}KB`);

  // ── C: THE ARTWORK+COMPOSE PATH ────────────────────────────────────────
  // DPAG craft aimed at ONE flat banner; code owns the geometry afterwards.
  // No topology guide, no zone map, and a real system instruction.
  const artworkPrompt = ace.buildAtlasArtworkDirection(V3_INPUT, {
    artboardQualityExampleCount: artboardQualityExamples.length,
  });
  const cParts = [
    { text: artworkPrompt },
    ...(await atlas._test.artboardQualityExampleParts(artboardQualityExamples)),
  ];
  log(`artwork prompt ${artworkPrompt.length} chars + ${ace.ATLAS_ARTWORK_SYSTEM_INSTRUCTION.length}-char system instruction`);

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
    B: {
      label: "B — THE PRODUCT CALL 1: POST /functions/v1/design-panel-ai-generate mode:atlas-artboard",
      endpoint: "/functions/v1/design-panel-ai-generate",
      requestBody: bEdgeBody,
      attempts: "harness executes exactly 1 edge request; the edge function makes exactly 1 Gemini image request (its response proves the count)",
      notes: [
        `runtime prompt-identity version ${atlas.PROMPT_VERSION}`,
        "the creative prompt is assembled INSIDE the deployed edge function — the real Persona-2 buildDesignerPrompt, executed (owner directive 2026-08-27)",
      ],
    },
    C: describe("C — ARTWORK+COMPOSE (DPAG craft, code geometry)", {
      model: AUTHORING_MODEL,
      modelFallback: "none",
      parts: cParts,
      systemInstruction: ace.ATLAS_ARTWORK_SYSTEM_INSTRUCTION,
      generationConfig: { temperature: 1, responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: "16:9", imageSize: "4K" } },
      attempts: "1 (harness)",
      notes: [
        "the model is never told there is a vehicle, a panel, an opening or a zone",
        "the six zones are composed by runtime/atlas-artwork-compose.cjs after the call",
        "branding is NOT composited yet - that is the next deterministic layer",
      ],
    }),
  };
  writeFileSync(join(OUT, "requests.json"), JSON.stringify(requests, null, 2));
  writeFileSync(join(OUT, "C-artwork.prompt.txt"), artworkPrompt);
  writeFileSync(join(OUT, "C-artwork.system.txt"), ace.ATLAS_ARTWORK_SYSTEM_INSTRUCTION);
  writeFileSync(join(OUT, "A-control-commercial.prompt.txt"), controlCommercialPrompt);
  writeFileSync(join(OUT, "A2-control-artboard.prompt.txt"), controlArtboardPrompt);
  writeFileSync(join(OUT, "B-atlas-call1.request.json"), JSON.stringify(bEdgeBody, null, 2));
  writeFileSync(join(OUT, "B-authoring-guide.png"), authoringGuideBytes);
  log(`requests captured → ${OUT}/requests.json`);

  if (args["capture-only"] === "true") return finish(supabase, requests, []);

  // ── EXECUTE ────────────────────────────────────────────────────────────
  // `--arms B` runs the owner-acceptance shape: one arm, one image request.
  const armFilter = String(args.arms || "").split(",").map((a) => a.trim()).filter(Boolean);
  const armAllowed = (name) => !armFilter.length || armFilter.includes(name);
  const key = keyPool[0];
  const results = {};
  const produced = [];
  let imageRequestsExecuted = 0;
  for (const [name, spec] of [
    ["A", { parts: [{ text: controlCommercialPrompt }], model: CONTROL_MODEL, cfg: requests.A.generationConfig, file: "A-control-commercial.png" }],
    ["A2", { parts: a2Parts, model: CONTROL_MODEL, cfg: requests.A2.generationConfig, file: "A2-control-artboard.png" }],
    ["B", { edge: true, file: "B-atlas-master.png" }],
    ["C", { parts: cParts, model: AUTHORING_MODEL, cfg: requests.C.generationConfig, file: "C-artwork-banner.png", systemInstruction: ace.ATLAS_ARTWORK_SYSTEM_INSTRUCTION, compose: true }],
  ]) {
    if (!armAllowed(name)) {
      results[name] = { ok: null, skipped: true, reason: `not in --arms ${armFilter.join(",")}` };
      continue;
    }
    try {
      if (spec.edge) {
        // THE PRODUCT PATH: one edge request; the response carries the proof
        // fields (requestId, sourceCommit, promptVersion, model,
        // imageRequestCount, masterSha256).
        // The edge function authenticates the server caller by resolving a
        // real owner id with Auth Admin privilege (designpro-internal-call).
        // The acceptance run names the canary operator, never a customer.
        const ownerId = process.env.AB_OWNER_ID || CANARY_OWNER_ID;
        const out = await atlas._test.callAtlasArtboardEdge(bEdgeBody, { logger: log, ownerId });
        imageRequestsExecuted += out.provenance.imageRequestCount;
        writeFileSync(join(OUT, spec.file), out.bytes);
        // The owner proof contract: the six deterministic crop hashes, cut by
        // the same cutCallOnePanels geometry production uses (sharp.extract,
        // no AI), from the same normalized master bytes.
        const normalized = await atlas.normalizeAtlasMaster(out.bytes, manifest);
        const crops = await atlas.cutCallOnePanels(normalized.bytes, manifest, out.provenance.masterSha256);
        const cropHashes = {};
        for (const crop of crops) {
          cropHashes[crop.surfaceKey] = crop.contentHash;
          writeFileSync(join(OUT, `B-panel-${crop.surfaceKey}.png`), crop.bytes);
          produced.push(`B-panel-${crop.surfaceKey}.png`);
        }
        results[name] = {
          ok: true, file: spec.file, bytes: out.bytes.length,
          contentHash: out.provenance.masterSha256, ...out.provenance,
          panelCropHashes: cropHashes,
        };
        produced.push(spec.file);
        continue;
      }
      imageRequestsExecuted += 1;
      const out = await callGemini({
        label: name, model: spec.model, key, parts: spec.parts,
        generationConfig: spec.cfg, file: join(OUT, spec.file),
        systemInstruction: spec.systemInstruction,
      });
      results[name] = { ok: true, file: spec.file, contentHash: out.contentHash, bytes: out.bytes.length, model: out.model, elapsedMs: out.elapsedMs };
      produced.push(spec.file);
      if (spec.compose) {
        const composed = await composeAtlasFromArtwork({ artworkBytes: out.bytes, manifest });
        writeFileSync(join(OUT, "C-atlas-composed.png"), composed.bytes);
        results[name].composed = {
          file: "C-atlas-composed.png",
          contract: composed.contract,
          zones: composed.zonesComposed,
          bytes: composed.bytes.length,
          contentHash: sha(composed.bytes),
        };
        produced.push("C-atlas-composed.png");
        log(`${name}: composed ${composed.zonesComposed} zones -> C-atlas-composed.png`);
      }
    } catch (error) {
      log(`${name}: FAILED — ${error.message}`);
      results[name] = { ok: false, error: String(error.message).slice(0, 500) };
    }
  }
  // Owner protection #5: report exactly how many Gemini image requests this
  // run actually made — a claimed "one call" is proven by this number, not by
  // prose.
  log(`gemini image requests executed: ${imageRequestsExecuted}`);
  writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));
  return finish(supabase, { ...requests, results, imageRequestsExecuted }, produced);
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
  for (const file of [...produced, "requests.json", "A-control-commercial.prompt.txt", "A2-control-artboard.prompt.txt", "B-atlas-call1.prompt.txt", "C-artwork.prompt.txt"]) {
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
    imageRequestsExecuted: manifestValue.imageRequestsExecuted ?? null,
    results: manifestValue.results || null,
  }, null, 2));
}

main().catch((error) => {
  console.error(`designiq-ab-precision failed: ${error?.stack || error}`);
  process.exit(1);
});
