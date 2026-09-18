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
const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
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
  { local: "runtime/atlas-examples/panel-production-proof-example.png", remote: "atlas-examples/panel-production-proof-example.png" },
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

(async () => {
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

  // The COMPLETE assembled request, so a disagreement about the design is
  // settled on the request rather than on impressions of the output.
  writeFileSync(path.join(outDir, "prompt.txt"), payload.prompt);
  writeFileSync(path.join(outDir, "evidence.json"), JSON.stringify({
    contract: payload.contract, model: payload.model,
    proofSha256: payload.proofSha256, proofByteSize: payload.proofByteSize,
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
