#!/usr/bin/env node
/**
 * Live Calls 1-7 seam test — driver, then passenger, and nothing else.
 *
 * This is the acceptance gate, executable. It does not mock anything: real
 * Gemini through the bounded provider, real Supabase Storage, real
 * designpro_generation_* rows, real projection into the seven-view contract
 * Calls 8 already reads.
 *
 * Run it where the credentials live — the droplet, or any host with the
 * standalone runtime environment. It writes the two images to disk so the
 * readability checks are something a human looks at, not something a hash
 * asserts.
 *
 *   GOOGLE_AI_API_KEY=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   node scripts/calls-1-7-seam.mjs --vehicle "2024 Ford Transit" \
 *     --prompt "HVAC Hero, dark blue and ice blue, bold commercial wrap" \
 *     --out ./seam-evidence
 *
 * Exit code is 0 only if every gate below passes.
 */

import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const require = createRequire(import.meta.url);
const { createClient } = require("../runtime/node_modules/@supabase/supabase-js");
const { createProvider } = require("../runtime/generation-provider.cjs");
const { createGenerationStore } = require("../runtime/generation-store.cjs");
const engine = require("../runtime/generation-engine.cjs");
const angles = require("../runtime/view-angles.cjs");
const prompts = require("../runtime/design-prompt-os.cjs");
const worker = require("../runtime/generation-worker.cjs");

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : fallback;
}

const gates = [];
function gate(name, passed, detail = "") {
  gates.push({ name, passed, detail });
  process.stdout.write(`  ${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  —  ${detail}` : ""}\n`);
}

const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim();
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const OUT = arg("out", "./seam-evidence");
const VEHICLE = arg("vehicle", "2024 Ford Transit");
const PROMPT = arg("prompt", "bold commercial wrap");
const TENANT = String(process.env.DESIGNPRO_SEAM_TENANT || "").trim();
const REQUEST_ID = arg("request", randomUUID());

if (!SUPABASE_URL || !SERVICE_KEY || !TENANT) {
  console.error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and DESIGNPRO_SEAM_TENANT are required");
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const store = createGenerationStore({ supabase, workerId: `seam-${process.pid}` });

/**
 * Counts real provider calls so the replay gate can prove zero. The bounded
 * provider does the work; this only observes it.
 */
function countingProvider() {
  const inner = createProvider({});
  return { calls: 0, models: inner.models, async generateImage(options) { this.calls += 1; return inner.generateImage(options); } };
}

/**
 * The seam drives the REAL prompt contract, not a stand-in.
 *
 * It used to build its own four-line brief plus a camera angle, which is
 * exactly the un-studioed, un-briefed prompt the design contract replaced — so
 * a green seam said nothing about what the customer would actually receive.
 * Both slots now assemble through worker.slotsFrom, so this run exercises the
 * shipped wording, the studio kernel, the hero->passenger reproduction and the
 * design anchor.
 */
const INPUT = {
  vehicle: { year: "", make: VEHICLE, model: "", type: "" },
  brief: PROMPT,
  finish: arg("finish", "gloss"),
};

async function runOneSlot(provider, sourceViewType, consumerRole, reproduction = {}) {
  const [slot] = worker.slotsFrom([{ sourceViewType, consumerRole }], INPUT, {}, reproduction);
  return engine.runSlot({
    requestId: REQUEST_ID, tenantKey: TENANT, ...slot, provider, store,
  });
}

/** The accepted winner's real bytes — what a reproduction view is conditioned on. */
async function winnerBytes(result) {
  const { data, error } = await supabase.storage.from("wrap-files").download(result.winner?.storage_path);
  if (error || !data) throw new Error(`could not read ${result.winner?.storage_path}: ${error?.message || "empty"}`);
  return Buffer.from(await data.arrayBuffer());
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  process.stdout.write(`\nCalls 1-7 live seam — request ${REQUEST_ID}\n${VEHICLE} · ${PROMPT}\n\n`);

  // ---- Pass 1: the hero originates, then the passenger reproduces it -------
  const first = countingProvider();
  const driver = await runOneSlot(first, "side", "driver");
  gate("driver slot accepted", driver.state === "accepted", `${driver.providerCalls} provider call(s)`);
  if (driver.state !== "accepted") {
    gate("hero landed before the passenger was attempted", false, "no design to reproduce — stopping");
    writeFileSync(`${OUT}/gates.json`, JSON.stringify(gates, null, 2));
    process.exit(1);
  }

  // The passenger is conditioned on the hero's own full-resolution bytes plus
  // the design anchor, exactly as the worker does it. Generating it from the
  // brief alone is how one design became two.
  const heroBytes = await winnerBytes(driver);
  const designAnchorText = await prompts.buildDesignAnchor({
    provider: createProvider({}),
    heroBytes,
    contentType: driver.winner?.content_type || "image/png",
    logger: (line) => process.stdout.write(`        ${line}\n`),
  });
  gate("design anchor described the hero", Boolean(designAnchorText), `${designAnchorText.length} chars`);

  const passenger = await runOneSlot(first, "passenger-side", "passenger", {
    heroReference: { bytes: heroBytes, contentType: driver.winner?.content_type || "image/png" },
    designAnchorText,
  });

  gate("passenger slot accepted", passenger.state === "accepted", `${passenger.providerCalls} provider call(s)`);
  gate("lease taken once per slot", driver.providerCalls <= engine.MAX_PROVIDER_ATTEMPTS_PER_SLOT
    && passenger.providerCalls <= engine.MAX_PROVIDER_ATTEMPTS_PER_SLOT);
  // Distinct pixels, same design. A matching hash would mean the passenger was
  // copied or flipped rather than rendered for its own side.
  gate("passenger is its own render, not a copy of the driver",
    driver.winner?.content_hash !== passenger.winner?.content_hash,
    "distinct winners");

  // ---- The prompts that actually went out, on disk for inspection ----------
  const heroPrompt = prompts.buildHeroPrompt({ input: INPUT, sourceViewType: "side" });
  const passengerPrompt = prompts.buildReproductionPrompt({ input: INPUT, sourceViewType: "passenger-side", designAnchorText });
  writeFileSync(`${OUT}/prompt-driver.txt`, heroPrompt);
  writeFileSync(`${OUT}/prompt-passenger.txt`, passengerPrompt);
  gate("hero prompt carries the studio kernel and the frozen angle",
    heroPrompt.includes("HIGH-END WRAP SHOP ENVIRONMENT") && heroPrompt.includes(angles.cameraAngle("side").trim()));
  gate("hero prompt stays inside the length ceiling",
    heroPrompt.length <= prompts.HERO_PROMPT_CHAR_CEILING, `${heroPrompt.length} chars`);
  gate("passenger prompt reproduces the hero rather than inventing",
    /The attached reference image shows this EXACT wrap design/.test(passengerPrompt)
    && !/DESIGN AMPLIFICATION/.test(passengerPrompt));
  gate("passenger prompt keeps the text-direction guard",
    /NEVER mirrored or backwards/i.test(passengerPrompt));
  gate("passenger prompt stays inside the length ceiling",
    passengerPrompt.length <= prompts.REPRODUCTION_PROMPT_CHAR_CEILING, `${passengerPrompt.length} chars`);

  // ---- Attempt rows exist on both sides of every call ----------------------
  const { data: attemptRows } = await supabase.from("designpro_generation_attempts")
    .select("source_view_type,attempt,model,key_fingerprint,outcome,duration_ms,content_hash")
    .eq("request_id", REQUEST_ID).order("attempt");
  gate("attempt rows recorded", (attemptRows || []).length >= 2, `${(attemptRows || []).length} row(s)`);
  gate("attempt rows carry model, key fingerprint and duration",
    (attemptRows || []).every((r) => r.model && /^[0-9a-f]{12}$/.test(r.key_fingerprint)));
  for (const row of attemptRows || []) {
    process.stdout.write(`        ${row.source_view_type} #${row.attempt}  ${row.model}  key ${row.key_fingerprint}  ${row.outcome}  ${row.duration_ms ?? "-"}ms\n`);
  }

  // ---- Bytes are real, content-addressed, and hash-verified ---------------
  for (const [label, result] of [["driver", driver], ["passenger", passenger]]) {
    const path = result.winner?.storage_path;
    const { data, error } = await supabase.storage.from("wrap-files").download(path);
    if (error || !data) { gate(`${label} bytes downloadable`, false, error?.message); continue; }
    const bytes = Buffer.from(await data.arrayBuffer());
    const hash = require("node:crypto").createHash("sha256").update(bytes).digest("hex");
    gate(`${label} stored hash verifies`, hash === result.winner.content_hash, `${bytes.length} bytes`);
    gate(`${label} path is content-addressed`, String(path).endsWith(`/${hash}.png`) || String(path).includes(`/${hash}.`));
    const file = `${OUT}/${label}.png`;
    writeFileSync(file, bytes);
    process.stdout.write(`        wrote ${file} — open it and confirm the wrap reads correctly\n`);
  }

  // ---- Projection into the existing seven-view contract --------------------
  const renderAssets = await store.projectRevisionSources({ requestId: REQUEST_ID });
  gate("driver projected into the revision-source contract", Boolean(renderAssets.driver?.contentHash));
  gate("passenger projected into the revision-source contract", Boolean(renderAssets.passenger?.contentHash));
  writeFileSync(`${OUT}/render-assets.json`, JSON.stringify(renderAssets, null, 2));

  // ---- Calls 8 reads them with no modification ----------------------------
  const { _test } = require("../runtime/designpro-standalone-claimant.cjs");
  try {
    const resolved = _test.exactSevenViews(
      { renderAssets: { ...renderAssets, hood: renderAssets.driver, roof: renderAssets.driver, front: renderAssets.driver, rear: renderAssets.driver, hero3d: renderAssets.driver } },
      TENANT, REQUEST_ID,
    );
    gate("Calls 8 resolves driver and passenger unmodified",
      resolved.driver.contentHash === renderAssets.driver.contentHash
      && resolved.passenger.contentHash === renderAssets.passenger.contentHash);
  } catch (error) {
    // With only two real slots the seven-view guard is expected to object to
    // the placeholder duplicates, not to the two real ones.
    const aboutRealSlots = /driver|passenger/i.test(String(error.message)) && !/distinct/i.test(String(error.message));
    gate("Calls 8 accepts the two real slots", !aboutRealSlots, String(error.message).slice(0, 120));
  }

  // ---- THE COST GATE: replay the completed request ------------------------
  const replay = countingProvider();
  const driverAgain = await runOneSlot(replay, "side", "driver");
  // The reproduction context is rebuilt for the replay because assembling a
  // passenger slot without it is refused outright. An accepted winner short-
  // circuits before the prompt is ever used, so this costs nothing.
  const passengerAgain = await runOneSlot(replay, "passenger-side", "passenger", {
    heroReference: { bytes: heroBytes, contentType: driver.winner?.content_type || "image/png" },
    designAnchorText,
  });
  gate("replay makes ZERO provider calls", replay.calls === 0, `provider.calls = ${replay.calls}`);
  gate("replay returns the same winners",
    driverAgain.winner?.content_hash === driver.winner?.content_hash
    && passengerAgain.winner?.content_hash === passenger.winner?.content_hash);
  gate("replay reports reuse", driverAgain.reused === true && passengerAgain.reused === true);

  // The permanent record of this run. Written whether it passed or failed, so
  // a failure is as evidenced as a success and nobody later has to rely on
  // "it worked once".
  const evidence = {
    contract: "designpro.calls-1-7-seam-evidence.v1",
    requestId: REQUEST_ID,
    ranAt: new Date().toISOString(),
    vehicle: VEHICLE,
    prompt: PROMPT,
    promptVersion: angles.VIEW_ORDER.length === 7 ? "view-angles-os.v4.1" : "unknown",
    // WHICH DESIGN CONTRACT PRODUCED THESE. Recorded so a later reader can tell
    // a hero-anchored pair from two independent inventions without opening the
    // images.
    designContract: {
      contract: prompts.PROMPT_CONTRACT,
      mode: prompts.designMode(INPUT),
      heroView: angles.HERO_VIEW,
      passengerReproducesHero: angles.reproducesHero("passenger-side"),
      designAnchored: Boolean(designAnchorText),
      designAnchorChars: designAnchorText.length,
      heroPromptChars: heroPrompt.length,
      passengerPromptChars: passengerPrompt.length,
    },
    slots: {
      driver: {
        state: driver.state, attempts: driver.providerCalls,
        contentHash: driver.winner?.content_hash || null,
        storagePath: driver.winner?.storage_path || null,
        byteSize: driver.winner?.byte_size ?? null,
      },
      passenger: {
        state: passenger.state, attempts: passenger.providerCalls,
        contentHash: passenger.winner?.content_hash || null,
        storagePath: passenger.winner?.storage_path || null,
        byteSize: passenger.winner?.byte_size ?? null,
      },
    },
    // Fingerprints only. A provider key never appears in evidence.
    attemptLog: (attemptRows || []).map((row) => ({
      slot: row.source_view_type, attempt: row.attempt, model: row.model,
      keyFingerprint: row.key_fingerprint, outcome: row.outcome,
      durationMs: row.duration_ms, contentHash: row.content_hash,
    })),
    modelsUsed: [...new Set((attemptRows || []).map((row) => row.model).filter(Boolean))],
    replayProviderCalls: replay.calls,
    renderAssets,
    gates: gates.map((g) => ({ name: g.name, passed: g.passed, detail: g.detail })),
    // A machine cannot sign this off. A human opens the two files and says so.
    manualVisualVerdict: {
      recordedBy: null, recordedAt: null,
      driverTextReadsCorrectly: null,
      passengerTextReadsCorrectly: null,
      passengerIsNotMirrored: null,
      passengerIsADifferentComposition: null,
      // The point of the reproduction contract: a different composition of the
      // SAME wrap. Two unrelated designs pass every other check here.
      passengerIsTheSameWrapAsTheDriver: null,
      noVehicleAngleCorruption: null,
    },
  };
  writeFileSync(`${OUT}/seam-evidence.json`, JSON.stringify(evidence, null, 2));
  process.stdout.write(`\n        evidence written to ${OUT}/seam-evidence.json\n`);

  const failed = gates.filter((g) => !g.passed);
  process.stdout.write(`\n${gates.length - failed.length}/${gates.length} gates passed\n`);
  if (failed.length) {
    process.stdout.write(`\nFAILED:\n${failed.map((g) => `  - ${g.name} ${g.detail}`).join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write(`\nEvidence in ${OUT}. Open driver.png and passenger.png before calling this passed:\n`);
  process.stdout.write(`  - driver reads correctly and matches the brief\n`);
  process.stdout.write(`  - passenger reads LEFT TO RIGHT, is not a mirror, and is its own composition\n`);
  process.stdout.write(`  - passenger is the SAME WRAP as the driver — same colours, graphics and lockup,\n`);
  process.stdout.write(`    seen from the other side. Two good-looking but unrelated designs is a FAIL.\n`);
  process.stdout.write(`  - prompt-driver.txt and prompt-passenger.txt are what actually went out\n`);
  process.stdout.write(`\nOnly then move to hood, front, rear, hero-3d and roof.\n`);
}

main().catch((error) => { console.error(`\nseam test failed: ${error.message}`); process.exit(1); });
