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

import { createHash } from "node:crypto";
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
  { local: "runtime/atlas-examples/panel-proof-container-template.png", remote: "atlas-examples/panel-proof-container-template.png" },
  { local: "runtime/atlas-examples/panel-production-proof-three-version.png", remote: "atlas-examples/panel-production-proof-three-version.png" },
  { local: "runtime/atlas-examples/installer-one-panel-per-side.png", remote: "atlas-examples/installer-one-panel-per-side.png" },
];

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

/** GENIE trim rows for the probe vehicle, in INCHES (never normalized). */
function panelRows() {
  const raw = arg("panels", [
    "DRIVER: 165.7\" wide x 49.6\" high",
    "PASSENGER: 165.7\" wide x 49.6\" high",
    "HOOD: 50\" wide x 41\" high",
    "ROOF: 43\" wide x 56\" high",
    "FRONT: 50\" wide x 22\" high",
    "REAR: 58\" wide x 40\" high",
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

  const request = {
    companyName: arg("company", "Bright Smiles Dental"),
    // Every literal the wrap carries rides in the exact-text block, not only the
    // contact bar -- a string the contract does not state is a string the model
    // invents, which is the premise this probe exists to retest.
    tagline: arg("tagline", "HEALTHY SMILES BRIGHTER LIVES"),
    phone: arg("phone", "(520) 555-0192"),
    website: arg("website", "brightsmiles.com"),
    services: arg("services", "General Dentistry|Cosmetic|Implants|Emergency Care").split("|"),
    promo: arg("promo", "NEW PATIENTS WELCOME"),
    vehicleYear: arg("year", "2012"),
    vehicleMake: arg("make", "Toyota"),
    vehicleModel: arg("model", "Prius"),
    // The header job block the reference sheet carries top-right.
    proofDate: arg("proof-date", new Date().toISOString().slice(0, 10)),
    orderNumber: arg("order", "BS-2012PRIUS-01"),
    designer: arg("designer", "A.L."),
    proofVersion: arg("proof-version", "1.0"),
    creativeDirection: arg("brief",
      "Bright Smiles Dental — clean flowing blue and teal wave design, a custom tooth logo, the tagline "
      + "HEALTHY SMILES BRIGHTER LIVES, and a professional photograph of a smiling dental patient in a "
      + "clinical chair inlaid into the rear three-quarter of each side panel."),
    panelRows: panelRows(),
  };
  console.log(`calling production-panel-proof for the ${request.vehicleYear} ${request.vehicleMake} ${request.vehicleModel}`);

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

  // The COMPLETE assembled request, so a disagreement about the design is
  // settled on the request rather than on impressions of the output.
  writeFileSync(path.join(outDir, "prompt.txt"), payload.prompt);
  writeFileSync(path.join(outDir, "evidence.json"), JSON.stringify({
    contract: payload.contract, model: payload.model,
    proofSha256: payload.proofSha256, proofByteSize: payload.proofByteSize, returned,
    promptChars: payload.promptChars, attachedInputs: payload.attachedInputs,
    thoughtSignatureCount: payload.thoughtSignatureCount,
    elapsedMs: payload.elapsedMs, totalMs: Date.now() - started, request,
  }, null, 2));

  console.log(`proof ${payload.proofSha256.slice(0, 16)} (${payload.proofByteSize} B) in ${payload.elapsedMs} ms`);
  console.log(`prompt ${payload.promptChars} chars, ${payload.attachedInputs.length} pinned inputs, `
    + `${payload.thoughtSignatureCount} thought signature(s) returned`);
  console.log(`\nJUDGE THE SHEET, NOT THIS LOG. panel-proof-probe/panel-production-proof.png`);
})().catch((error) => {
  console.error(String(error?.message || error));
  process.exit(1);
});
