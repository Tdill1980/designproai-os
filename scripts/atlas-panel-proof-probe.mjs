#!/usr/bin/env node
/**
 * PANEL PRODUCTION PROOF PROBE — one sheet for the owner's eye, before
 * anything is wired.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner ruling, Trish 2026-09-18. A CONTROLLED RUN, NOT A PRODUCT RUN.
 *
 * WHAT IT WRITES: the two pinned multimodal inputs into wrap-files under
 * content-addressed example paths (idempotent, hash-verified, skipped when
 * already correct), and the returned proof under its own sha256. NO generation
 * request row, no revision, no view, no artifact -- unlike the hero-driver
 * probe, this endpoint is not the provider-cache path, so it needs no harness
 * lease at all. Nothing routes to it and no flag changes.
 *
 * WHAT IT COSTS: exactly one gemini-3-pro-image request.
 *
 * WHAT IT ANSWERS, and why each matters more than a green check:
 *
 *   1. Six full-bleed panels, or the die-cut layout drawing again? Every
 *      documented Call-1 experiment changed the ASK and kept the OBJECT a bare
 *      artboard. This asks for the object a print shop receives.
 *   2. Are the customer's exact strings reproduced? The element graph exists
 *      because a diffusion model could not be trusted with a phone number.
 *      If that premise has expired on this model, mechanical typesetting is
 *      solving a problem that no longer exists.
 *   3. Do branded / artwork-only / cut-proof come back cohesive because one
 *      designer drew all three?
 *
 * NONE OF THAT IS DECIDED BY THIS SCRIPT. It hands over the sheet and the
 * complete assembled request. The owner looks at the pixels -- which is the
 * standing rule this repo keeps relearning: "Do not report A.T.L.A.S. status
 * from receipts. Open the export before calling a run good."
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createClient } = require("../runtime/node_modules/@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OWNER_ID = process.env.PANEL_PROOF_OWNER_ID;
const BUCKET = "wrap-files";

// NO WORKER SECRET. This probe used to require one and send an
// `x-designpro-worker-secret` header, and the function never reads it:
// `resolveDesignProInternalCaller` authenticates on the `apikey` header plus
// `x-designpro-owner-id`, by RESOLVING that owner through auth admin. That IS
// the privilege check -- a publishable key cannot resolve a user by id. A
// required variable nothing consumes is a blocker invented out of nothing, and
// this one held the probe up for three exchanges.
if (!SUPABASE_URL || !SERVICE_KEY || !OWNER_ID) {
  console.error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and PANEL_PROOF_OWNER_ID are required");
  process.exit(2);
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
// BOTH FORMS. This accepted only `--name=value`, and the workflow passes
// `--name value` -- so on the first successful run EVERY argument silently fell
// back to its default, including `--out`. The payload happened to match the
// defaults so the sheet was correct, but the evidence was written to a
// directory the tar never collected and the cleanup trap then deleted it. A
// 6.58 MB proof was generated and thrown away by an argument parser.
const arg = (name, fallback) => {
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const at = process.argv.indexOf(`--${name}`);
  if (at !== -1 && at + 1 < process.argv.length && !process.argv[at + 1].startsWith("--")) {
    return process.argv[at + 1];
  }
  return fallback;
};

const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// Set once the harness lease exists, so the finally below can always cancel it.
let releaseLease = null;
// `--out` so the workflow can collect the evidence from a bind mount, exactly
// as atlas-hero-driver-probe.mjs does.
const outDir = path.resolve(arg("out", path.join(process.cwd(), "panel-proof-probe")));
mkdirSync(outDir, { recursive: true });

/**
 * The two pinned inputs, staged idempotently.
 *
 * Hash-verified BOTH ways: the local bytes are hashed before upload, and an
 * object already in place is downloaded and compared rather than trusted. A
 * silently-different teaching input is exactly how canary 33389124918 taught
 * wheel wells back into the source rectangles.
 */
const PINNED = [
  { local: "runtime/atlas-examples/panel-proof-zones-filled.png", remote: "atlas-examples/panel-proof-zones-filled.png" },
  { local: "runtime/atlas-examples/installer-one-panel-per-side.png", remote: "atlas-examples/installer-one-panel-per-side.png" },
];

/**
 * THE CONTAINER IS RENDERED FOR THIS VEHICLE, NOT PINNED.
 *
 * It was a fixed PNG carrying the Prius's own 165.7" x 49.6" flanks, so every
 * other vehicle would have been shown a template dimensioned for a car it is
 * not -- silently, because a pinned hash verifies only that the bytes are the
 * ones we pinned, never that they are the ones this request needs. A derived
 * artifact cannot be pinned by hash once it legitimately varies.
 *
 * What replaces the byte pin is the RULE 0.39 discipline the hero view already
 * proved: the renderer is deterministic and locked, the object is named by its
 * own sha256 so a swapped one cannot keep its name, and the edge re-reads the
 * bytes and checks they hash to what this caller claimed. Three checks, and
 * none of them can be satisfied by an object nobody in this request rendered.
 */
async function stageContainerTemplate(rows, { companyName, vehicle }) {
  const { parsePanelRows, renderContainerTemplate } =
    require("../runtime/atlas-proof-container-template.cjs");
  const manifest = parsePanelRows(rows);
  if (manifest.zones.length !== 6) {
    throw new Error(`container_template_rows_unparsed:${manifest.zones.length}/6`);
  }
  const bytes = await renderContainerTemplate({ manifest, companyName, vehicle, bleedInches: 5 });
  const digest = sha256(bytes);
  // The edge's own allowlist shape: a Call-1 input is named by its content.
  const remote = `atlas-call1-inputs/${digest}.png`;
  const { data } = await svc.storage.from(BUCKET).download(remote);
  if (!data) {
    const { error } = await svc.storage.from(BUCKET)
      .upload(remote, bytes, { contentType: "image/png", upsert: false });
    if (error && !/exists/i.test(String(error.message))) throw error;
  }
  console.log(`  container rendered for ${vehicle} (${digest.slice(0, 12)}, ${bytes.length} B)`);
  return { containerStoragePath: remote, containerContentHash: digest, containerByteSize: bytes.length };
}

async function stagePinnedInputs() {
  for (const item of PINNED) {
    const bytes = readFileSync(item.local);
    const expected = sha256(bytes);
    const { data } = await svc.storage.from(BUCKET).download(item.remote);
    if (data) {
      const actual = sha256(Buffer.from(await data.arrayBuffer()));
      if (actual === expected) { console.log(`  pinned ${item.remote} already staged (${expected.slice(0, 12)})`); continue; }
      throw new Error(`pinned input ${item.remote} holds DIFFERENT bytes (${actual.slice(0, 12)} != ${expected.slice(0, 12)})`);
    }
    const { error } = await svc.storage.from(BUCKET)
      .upload(item.remote, bytes, { contentType: "image/png", upsert: false });
    if (error && !/exists/i.test(String(error.message))) throw error;
    console.log(`  staged ${item.remote} (${expected.slice(0, 12)}, ${bytes.length} B)`);
  }
}

/**
 * GENIE trim rows for the probe vehicle, in INCHES (never normalized).
 *
 * A 2019 Ford Transit 250 high roof, which is a DIFFERENT SHAPE from the Prius
 * these were written for — a tall cargo van, so the flanks are nearly square
 * rather than long and shallow, and the roof is the largest panel on the sheet
 * instead of one of the smallest. That matters beyond realism: the container is
 * laid out from these proportions, so a sheet that still looks like the Prius
 * template is a sheet that ignored its own template.
 */
function panelRows() {
  const raw = arg("panels", [
    "DRIVER: 141.0\" wide x 78.0\" high",
    "PASSENGER: 141.0\" wide x 78.0\" high",
    "HOOD: 66.0\" wide x 42.0\" high",
    "ROOF: 148.0\" wide x 68.0\" high",
    "FRONT: 74.0\" wide x 36.0\" high",
    "REAR: 70.0\" wide x 80.0\" high",
  ].join("|"));
  return String(raw).split("|").map((s) => s.trim()).filter(Boolean);
}

async function measure(bytes) {
  try {
    const sharp = require("../runtime/node_modules/sharp");
    const m = await sharp(bytes).metadata();
    return { width: m.width, height: m.height,
      megapixels: Number(((m.width * m.height) / 1e6).toFixed(2)),
      aspect: Number((m.width / m.height).toFixed(3)) };
  } catch { return null; }
}

(async () => {
  // REUSE: collect a sheet this probe already generated instead of paying for
  // another one. The image is the expensive part and it is already in storage.
  const reuse = arg("reuse", "");
  if (reuse) {
    const { data, error } = await svc.storage.from(BUCKET).download(reuse);
    if (error || !data) throw new Error(`could not read ${reuse}: ${error?.message || "missing"}`);
    const bytes = Buffer.from(await data.arrayBuffer());
    writeFileSync(path.join(outDir, "panel-production-proof.png"), bytes);
    const returned = await measure(bytes);
    writeFileSync(path.join(outDir, "evidence.json"), JSON.stringify(
      { reusedFrom: reuse, proofSha256: sha256(bytes), proofByteSize: bytes.length, returned }, null, 2));
    console.log(`reused ${reuse} (${bytes.length} B)`);
    if (returned) console.log(`${returned.width}x${returned.height}, ${returned.megapixels} MP, aspect ${returned.aspect}`);
    return;
  }

  // PROMOTE: adopt a sheet this probe generated as a pinned example, by copying
  // it inside the bucket. The owner's ruling is that the empty three-zone sheet
  // is the CONTAINER TEMPLATE and belongs in the system instruction beside the
  // filled one. Copying server-side keeps the original bytes exactly -- a
  // re-encode would break the hash pin, which is the whole point of pinning.
  const promote = arg("promote", "");
  if (promote) {
    const target = arg("as", "atlas-examples/panel-proof-container-template.png");
    const { data, error } = await svc.storage.from(BUCKET).download(promote);
    if (error || !data) throw new Error(`could not read ${promote}: ${error?.message || "missing"}`);
    const bytes = Buffer.from(await data.arrayBuffer());
    const digest = sha256(bytes);
    const { error: copyErr } = await svc.storage.from(BUCKET)
      .upload(target, bytes, { contentType: "image/png", upsert: true });
    if (copyErr) throw copyErr;
    const meta = await measure(bytes);
    writeFileSync(path.join(outDir, "promoted.json"), JSON.stringify(
      { source: promote, target, sha256: digest, byteSize: bytes.length, ...meta }, null, 2));
    console.log(`promoted ${promote}\n  -> ${target}\n  sha256 ${digest}\n  ${bytes.length} B`
      + (meta ? `, ${meta.width}x${meta.height}, ${meta.megapixels} MP, aspect ${meta.aspect}` : ""));
    return;
  }

  console.log("staging pinned multimodal inputs");
  await stagePinnedInputs();

  // ═══════════════════════════════════════════════════════════════════════
  // THE PROBE SENDS A RAW CUSTOMER MESSAGE, NOT A FILLED-IN FORM.
  //
  // Owner ruling, Trish 2026-09-18: "you shouldn't test it by giving it the
  // same design prompt as the example. How are we supposed to validate that it
  // can design if it's just recreating from the system example."
  //
  // She is right, and the old default was worse than that. It read "Bright
  // Smiles Dental — clean flowing blue and teal wave design, a custom tooth
  // logo, the tagline HEALTHY SMILES BRIGHTER LIVES, and a professional
  // photograph of a smiling dental patient in a clinical chair inlaid into the
  // rear three-quarter of each side panel" — a DESCRIPTION OF THE PINNED
  // EXAMPLE SHEET, which was attached to the same request as the standard to
  // match. A model handed a picture and a description of that picture returns
  // the picture, whether or not there is a designer behind it. That test could
  // not fail, so it proved nothing.
  //
  // EVERYTHING IS DIFFERENT NOW, ON PURPOSE. A different vehicle class (a high-
  // roof cargo van, not a compact hatchback), a different trade, a different
  // palette, different imagery, a different promotional line. If the sheet
  // comes back with blue waves and a tooth, the design is coming from the
  // attachment and not from the brief — and that is now visible instead of
  // being hidden by a brief that asked for the attachment.
  const customerPrompt = arg("customer-prompt",
    "need a wrap for my 2019 ford transit 250 high roof - company is Cedar & Stone Tree Care, "
    + "we do tree removal, stump grinding and storm cleanup. want it rugged and outdoorsy, "
    + "deep forest green with a weathered wood grain texture and a big pine silhouette down "
    + "the side, kind of like a national park sign. phone 520-555-0192 and cedarandstonetree.com, "
    + "put FREE ESTIMATES on there");

  // NOTHING ELSE IS SENT. No companyName, no tagline, no services, no promo, no
  // year/make/model and no creativeDirection — the edge's intake node parses
  // all of it out of that one sentence, which is the thing being tested. A
  // field set here would be a field intake never had to find.
  // ── THE HARNESS LEASE, MINTED BY THE DATABASE ─────────────────────────────
  //
  // This file's banner said the probe "needs no harness lease either, because
  // this endpoint is not the provider-cache path". That stopped being true at
  // 1601ba7 ("scope the request-scoped provider slot to the proof path only"),
  // and nothing updated the probe. Four runs then failed in sequence, each
  // before one image request, each at the next gate:
  //
  //   provider_request_identity_invalid (400) — requestId/generationId absent
  //   provider_claim_invalid (403)            — no leased row, no claim token
  //   permission denied ... calls_1_7_asset_paths_bound   — the insert trigger
  //   permission denied ... calls_1_7_engine_contract     — the CHECK constraint
  //
  // The last two are why a hand-written row can never work: the table requires
  // `engine_contract` to EQUAL a private function's exact value (seven source
  // blob hashes and a source commit) and `request_input` to satisfy the v3
  // validator, and both functions are executable by postgres alone. A literal
  // cannot equal the first and a `{customerPrompt}` object cannot satisfy the
  // second. `atlas-hero-driver-probe.mjs` forges the same row and is broken in
  // exactly the same way.
  //
  // So the row is minted by `mint_designpro_harness_lease`, a SECURITY DEFINER
  // function that runs as its owner: the private validators EXECUTE and enforce
  // themselves on the harness row rather than being stepped around. It returns
  // the lease token it minted, so nothing here invents one, and it creates the
  // row already `leased` — never queued, so no live worker can claim it and it
  // cannot hand this probe somebody else's generation.
  // The SAME deterministic parser the edge runs, read once and reused below for
  // the fallback container, so the lease and the container cannot name two
  // different trucks.
  const { extractDeterministic } = require("../runtime/atlas-intake-parse.cjs");
  const seen = extractDeterministic(customerPrompt);
  const harnessVehicle = {
    year: seen.vehicleYear || "2019", make: seen.vehicleMake || "Ford",
    model: seen.vehicleModel || "Transit 250 High Roof", type: seen.vehicleType || "van",
  };
  const { data: lease, error: leaseError } = await svc.rpc("mint_designpro_harness_lease", {
    p_owner_id: OWNER_ID,
    p_brief: customerPrompt,
    p_design_name: "panel-proof probe (harness)",
    p_vehicle: harnessVehicle,
    p_harness: "panel-proof-probe",
  });
  if (leaseError || !lease?.requestId) {
    throw new Error(`harness lease failed: ${leaseError?.message || "no lease returned"}`);
  }
  const { requestId, generationId, claimToken } = lease;
  releaseLease = async () => {
    await svc.from("designpro_generation_requests")
      .update({ state: "cancelled", lease_owner: null, lease_token: null, lease_expires_at: null })
      .eq("id", requestId);
  };

  const request = {
    customerPrompt,
    requestId,
    generationId,
    providerRequest: { requestId, generationId, claimToken },
    proofDate: arg("proof-date", new Date().toISOString().slice(0, 10)),
    orderNumber: arg("order", "CS-2019TRANSIT-01"),
    designer: arg("designer", "A.L."),
    proofVersion: arg("proof-version", "1.0"),
    panelRows: panelRows(),
  };
  // THE FALLBACK CONTAINER IS DRAWN FROM THE DETERMINISTIC HALF OF INTAKE, the
  // same parser the edge runs. The edge draws its own container from its own
  // parse; this one exists only for a cold isolate that cannot fetch the wasm,
  // and it must name the same vehicle or the fallback would teach a different
  // truck than the one requested.
  const vehicle = [seen.vehicleYear, seen.vehicleMake, seen.vehicleModel].filter(Boolean).join(" ");
  Object.assign(request, await stageContainerTemplate(request.panelRows, {
    companyName: "", vehicle,
  }));
  console.log(`calling production-panel-proof with a RAW customer message (${customerPrompt.length} chars)`);
  console.log(`  deterministic parse: ${vehicle} | ${seen.phone} | ${seen.website}`);

  const started = Date.now();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/production-panel-proof`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      "content-type": "application/json",
      "x-designpro-owner-id": OWNER_ID,
    },
    body: JSON.stringify(request),
  });
  const payload = await res.json().catch(() => ({ error: "unparseable response" }));
  if (!res.ok || !payload?.success) {
    writeFileSync(path.join(outDir, "evidence.json"), JSON.stringify({ request, payload }, null, 2));
    console.error(`panel proof FAILED (HTTP ${res.status}): ${payload?.error || "unknown"}`);
    process.exit(1);
  }

  // Hash-verify the returned sheet against what the function said it wrote --
  // the same discipline every other artifact in this system carries.
  const { data, error } = await svc.storage.from(BUCKET).download(payload.proofStoragePath);
  if (error || !data) throw new Error(`could not read the proof: ${error?.message || "missing"}`);
  const bytes = Buffer.from(await data.arrayBuffer());
  const actual = sha256(bytes);
  if (actual !== payload.proofSha256) throw new Error(`proof hash mismatch ${actual} != ${payload.proofSha256}`);
  writeFileSync(path.join(outDir, "panel-production-proof.png"), bytes);

  // WHAT SIZE DID 3:2 AT 4K ACTUALLY RETURN? Google publishes the aspect-ratio
  // list but no pixel table, so this is measured rather than assumed -- and it
  // is what tells us whether the panel cells carry enough pixels for the
  // lettering to be legible, which is the whole question the sheet answers.
  let returned = null;
  try {
    const sharp = require("../runtime/node_modules/sharp");
    const meta = await sharp(bytes).metadata();
    returned = { width: meta.width, height: meta.height,
      megapixels: Number(((meta.width * meta.height) / 1e6).toFixed(2)),
      aspect: Number((meta.width / meta.height).toFixed(3)) };
    console.log(`returned ${meta.width}x${meta.height} (${returned.megapixels} MP, aspect ${returned.aspect})`);
  } catch (error) {
    console.log(`could not measure the returned sheet: ${String(error?.message || error)}`);
  }

  // ── THE DOCUMENT IS COMPOSITED, NEVER PROMPTED ──────────────────────────
  //
  // The model returns ARTWORK in three bands; every caption, figure, note and
  // legend is drawn here from this request's own manifest. Live 35393135814 is
  // why: one 141 x 78 request came back reading 195.7 x 89.6 in Zone 1,
  // 155.7 x 49.6 in Zone 2 and 105.7 x 49.6 in its own reference table, with
  // template notes reading "Drop-impertanli zlomadte onteed". Baking the figures
  // into the attached container had already shipped and did not help — that
  // container carried "141.0" ten times — because the model redraws the document
  // rather than filling it. A number the model never types cannot come back
  // wrong. RestylePro reached the same answer and states it: the sheet's
  // furniture is DRAWN, "so they cannot be hallucinated".
  //
  // It fails SOFT. The raw sheet is already written and hash-verified above; a
  // compositor fault must cost the document, never the run whose design is the
  // thing being judged.
  let composed = null;
  try {
    const { composeProofChrome } = require("../runtime/atlas-proof-compose.cjs");
    const { parsePanelRows } = require("../runtime/atlas-proof-container-template.cjs");
    const parsed = payload.intake || seen;
    const out = await composeProofChrome({
      proofBytes: bytes,
      manifest: parsePanelRows(request.panelRows),
      companyName: parsed?.companyName || "",
      vehicle: [parsed?.vehicleYear, parsed?.vehicleMake, parsed?.vehicleModel]
        .filter(Boolean).join(" ") || vehicle,
      bleedInches: 5,
      job: { date: request.proofDate, order: request.orderNumber,
        designer: request.designer, version: request.proofVersion },
      sharp: require("../runtime/node_modules/sharp"),
    });
    writeFileSync(path.join(outDir, "panel-production-proof-composed.png"), out.bytes);
    composed = { contract: out.contract, width: out.width, height: out.height,
      designAspect: out.designAspect, sheetAspect: out.sheetAspect };
    console.log(`document composited at ${out.width}x${out.height} `
      + `(chrome authored at ${out.designAspect}, sheet came back ${out.sheetAspect})`);
  } catch (error) {
    composed = { failed: String(error?.message || error).slice(0, 200) };
    console.log(`document NOT composited: ${composed.failed}`);
  }

  // The COMPLETE assembled request, so a disagreement about the design is
  // settled on the request rather than on impressions of the output.
  writeFileSync(path.join(outDir, "prompt.txt"), payload.prompt);
  writeFileSync(path.join(outDir, "evidence.json"), JSON.stringify({
    contract: payload.contract, model: payload.model,
    proofSha256: payload.proofSha256, proofByteSize: payload.proofByteSize, returned, composed,
    promptChars: payload.promptChars, attachedInputs: payload.attachedInputs,
    thoughtSignatureCount: payload.thoughtSignatureCount,
    elapsedMs: payload.elapsedMs, totalMs: Date.now() - started, request,
    intake: payload.intake || null,
  }, null, 2));

  console.log(`proof ${payload.proofSha256.slice(0, 16)} (${payload.proofByteSize} B) in ${payload.elapsedMs} ms`);
  console.log(`prompt ${payload.promptChars} chars, ${payload.attachedInputs.length} pinned inputs, `
    + `${payload.thoughtSignatureCount} thought signature(s) returned`);

  // WHICH HALF DREW THE CONTAINER, SAID OUT LOUD. The studio renders its own
  // and falls back to the one this script staged; the two are indistinguishable
  // in the sheet, so the only place the answer exists is the receipt. Reporting
  // a fallback as the contract is how this seam has already been wrong twice.
  const container = (payload.attachedInputs || []).find((a) => a.role === "container");
  if (container?.origin === "studio") {
    console.log(`container DRAWN BY THE EDGE for this vehicle `
      + `(${container.sha256.slice(0, 12)}, ${container.byteSize} B, ${container.svgChars} SVG chars)`);
  } else if (container) {
    console.log(`container FELL BACK to the staged copy: ${container.studioRenderFailed || "no reason recorded"}`);
  }
  // ═══════════════════════════════════════════════════════════════════════
  // THE INSPECTOR GATE, RUN ON THE PIXELS BEFORE ANYTHING IS CALLED GOOD.
  //
  // Owner: the slicer must be an active enforcement gate, not a stub. This is
  // the half that can honestly execute — it needs sharp, which lives here and
  // not in Deno, which is why it runs on the runtime rather than in the edge.
  //
  // It answers ONE question, the one the last live sheet failed: did the model
  // draw a panel as a picture of the vehicle, with the windows cut out of it?
  // Measured 0 convicting shapes on 35387642102 and 4 on 35389031759.
  const { detectDieCut } = require("../runtime/atlas-proof-diecut.cjs");
  const { PROOF_REGIONS } = require("../runtime/atlas-panel-proof-contract.cjs");
  const verdicts = {};
  for (const zone of ["zone1", "zone2"]) {
    try {
      verdicts[zone] = await detectDieCut({ proofBytes: bytes, band: PROOF_REGIONS[zone] });
    } catch (error) {
      verdicts[zone] = { error: String(error?.message || error) };
    }
  }
  writeFileSync(path.join(outDir, "diecut.json"), JSON.stringify(verdicts, null, 2));
  const cut = Object.entries(verdicts).filter(([, v]) => v.dieCut);
  if (cut.length) {
    // LOUD, AND STILL EXPORTED. The sheet is the evidence; hiding it would
    // leave the owner judging a verdict instead of pixels.
    console.log("\n⚠️  DIE-CUT PANELS — the model drew the vehicle's shape into the print artwork.");
    for (const [zone, v] of cut) {
      console.log(`    ${zone}: ${v.holes.length} enclosed opening(s), largest ${v.largestHoleFraction} `
        + `of the band, boxes ${v.holes.slice(0, 3).map((h) => `${h.w}x${h.h}`).join(" ")}`);
    }
    console.log("    RULE 0.32: the entire rectangular region is printable artwork.");
  } else {
    console.log("\ndie-cut gate: clean — no page-coloured opening enclosed by artwork in either panel zone");
  }

  // THE CUTTER, ON THE SHEET THE MODEL ACTUALLY RETURNED.
  //
  // This is now the live Call-1 route (DESIGNPRO_ATLAS_PANEL_PROOF=on), and the
  // cut is what turns the document into the artifacts production consumes — so
  // the probe is the only place it faces real returned pixels rather than a
  // fixture. A fixture laxer than the real thing cannot catch a defect of the
  // real thing, which this file's own history records five times over.
  //
  // `fit` is the share of each cell that carries paint. It is the number the
  // topology pass refuses on, because an EMPTY cell is a blank print panel and
  // every hole predicate in this repo is a darkness test — white is not dark.
  try {
    const { cutProofPanels, QUADRANTS } = require("../runtime/atlas-proof-panels.cjs");
    const { parsePanelRows } = require("../runtime/atlas-proof-container-template.cjs");
    const panels = await cutProofPanels({
      proofBytes: bytes, manifest: parsePanelRows(request.panelRows),
      sharp: require("../runtime/node_modules/sharp"),
    });
    if (panels.refused) {
      console.log(`\n⚠️  THE CUTTER REFUSED THE SHEET: ${panels.refused}`);
    } else {
      const cutDir = path.join(outDir, "panels");
      mkdirSync(cutDir, { recursive: true });
      for (const panel of panels.panels) {
        writeFileSync(path.join(cutDir, `${panel.zone}-${panel.surfaceKey}.png`), panel.bytes);
      }
      writeFileSync(path.join(outDir, "panels.json"), JSON.stringify({
        contract: panels.contract, sheet: panels.sheet, quadrants: QUADRANTS,
        panels: panels.panels.map(({ bytes: _b, ...receipt }) => receipt),
      }, null, 2));
      const fitOf = (zone) => panels.panels.filter((p) => p.zone === zone)
        .map((p) => `${p.surfaceKey}=${p.fit}`).join(" ");
      console.log(`\ncut ${panels.panels.length} artifacts from the returned sheet`);
      console.log(`  zone 1 (branded): ${fitOf("zone1")}`);
      console.log(`  zone 2 (clean):   ${fitOf("zone2")}`);
      console.log(`  zone 3 (cut):     ${fitOf("zone3")}`);
      const unfilled = panels.panels.filter((p) => p.zone !== "zone3" && p.fit < 0.5);
      if (unfilled.length) {
        console.log(`  ⚠️  UNFILLED CELLS — the live route refuses this sheet: `
          + unfilled.map((p) => `${p.zone}:${p.surfaceKey}`).join(" "));
      }
    }
  } catch (error) {
    // The cut is evidence, not the probe's purpose: a failure here must not
    // discard the sheet the owner is here to look at.
    console.log(`\ncutter did not run: ${String(error?.message || error).slice(0, 200)}`);
  }

  // AND NAME THE COMPOSITED ONE FIRST, because it is the deliverable. The raw
  // sheet stays beside it: it is what the model actually drew, which is the only
  // thing that answers "is the design good" — and it is what the die-cut gate
  // above measured, since the chrome would cover part of what it looks at.
  console.log(`\nJUDGE THE SHEET, NOT THIS LOG.`);
  console.log(`  delivered: panel-proof-probe/panel-production-proof-composed.png`);
  console.log(`  as drawn:  panel-proof-probe/panel-production-proof.png`);
})().catch((error) => {
  console.error(String(error?.message || error));
  process.exitCode = 1;
}).finally(async () => {
  // A CRASHED PROBE MUST NOT LEAVE A LEASED ROW BEHIND. The lease is 45
  // minutes; without this, a failure between the insert and the end of the run
  // parks a harness row in `leased` for all of it.
  if (typeof releaseLease === "function") {
    try { await releaseLease(); } catch (error) {
      console.error(`harness lease release failed: ${String(error?.message || error)}`);
    }
  }
});
