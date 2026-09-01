/**
 * THE CANONICAL 3D PROOF CONTRACT. (owner ruling, Trish 2026-09-01)
 *
 *   OS AUTHORITIES          Vehicle · Surface · Camera · Studio · Lighting
 *   ARTWORK AUTHORITY       the canonical A.T.L.A.S. surface panel
 *   MODEL INSTRUCTION       three fixed sentences, identical for every proof
 *
 * Owner: "A.T.L.A.S. designs. GENIE maps. Anchors control camera/studio/
 * lighting. The proof renderer photographs." And: "nothing from Call 1's
 * creative brain follows it downstream."
 *
 * This file convicts the failure that keeps recurring: creative prose leaking
 * back into the proof request, where it competes with the panel and lets the
 * renderer redesign the wrap (DID-134FC3CA). It executes the builder rather
 * than reading it, because both defects found on 2026-09-01 -- a doubled
 * finish label and 900 characters of duplicated coverage rules -- were
 * invisible in the source and obvious in the assembled string.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODULE_PATH = join(ROOT, "supabase/functions/_shared/atlas-proof-presentation.ts");
const MODULE = readFileSync(MODULE_PATH, "utf8");
const PHOTOGRAPHER = readFileSync(join(ROOT, "supabase/functions/persona-photographer-render/index.ts"), "utf8");

/** The module is Deno TypeScript, so it is bundled and EXECUTED. */
let bundled = null;
async function mod() {
  if (bundled) return bundled;
  const out = join(mkdtempSync(join(tmpdir(), "atlas-proof-")), "m.mjs");
  execFileSync(join(ROOT, "app/node_modules/.bin/esbuild"),
    ["--bundle", "--format=esm", `--outfile=${out}`, MODULE_PATH], { stdio: "pipe" });
  bundled = await import(out);
  return bundled;
}

/** Strip comments: this file and the module both NAME forbidden things in
 *  prose in order to forbid them. */
function codeOnly(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .map((l) => l.replace(/\s\/\/.*$/, "")).join("\n");
}

test("the model instruction is exactly the three owner-specified sentences", async () => {
  const { ATLAS_PROOF_INSTRUCTION } = await mod();
  assert.equal(ATLAS_PROOF_INSTRUCTION,
`Apply the supplied canonical wrap panel exactly to its corresponding surface on the specified vehicle.

The supplied panel is finished, locked artwork. Preserve it exactly.

Render the wrapped vehicle as a photorealistic automotive photograph using the supplied camera, studio, and lighting anchors.`);
});

test("the instruction is IDENTICAL for all seven proofs", async () => {
  const { buildAtlasProofPresentationPrompt: build, ATLAS_SHOT_SURFACES, ATLAS_PROOF_INSTRUCTION } = await mod();
  // Only the OS inputs change: the surface's own panel and its view anchor.
  for (const [shot, surface] of Object.entries(ATLAS_SHOT_SURFACES)) {
    const p = build({ vehicle: "2022 Porsche 911 Turbo", viewType: shot, surfaceKey: surface || "driver", finish: "Gloss" });
    assert.ok(p.includes(ATLAS_PROOF_INSTRUCTION), `${shot} does not carry the canonical instruction verbatim`);
  }
});

/**
 * THE DESIGN IS NEVER DESCRIBED TO GEMINI. Every token here is one that
 * previously leaked in, or that Call 1's creative brain owns. The panel is
 * the description; a second description is a second interpretation channel.
 */
test("no creative direction reaches the proof request", async () => {
  const { buildAtlasProofPresentationPrompt: build, ATLAS_SHOT_SURFACES } = await mod();
  const forbidden = [
    "distressed", "weathering", "vintage", "Martini",
    "colors, patterns", "composition", "lettering", "logo", "branding",
    "creative director", "senior graphic designer", "designer",
    "elevate", "amplify", "wow factor", "gallery-worthy", "premium artistic",
    "do not redesign", "never", "body line", "fender curve", "wheel arch",
  ];
  for (const [shot, surface] of Object.entries(ATLAS_SHOT_SURFACES)) {
    const p = build({ vehicle: "2022 Porsche 911 Turbo", viewType: shot, surfaceKey: surface || "driver", finish: "Gloss", isPickup: true });
    // Scoped to the part THIS MODULE authors: the OS header and the
    // instruction. The camera and studio anchors below are pinned bytes the
    // owner keeps deliberately -- STUDIO_ENVIRONMENT legitimately says
    // "Clean, uncluttered composition", and forbidding a word because the
    // anchor contains it would convict the anchor, not creative leakage.
    // The FINISH value comes from the shared table and is excluded for the
    // same reason.
    const authored = p.slice(0, p.indexOf("\nCAMERA ANCHOR:"))
      .split("\n").filter((l) => !l.startsWith("FINISH:")).join("\n");
    for (const word of forbidden) {
      assert.ok(!authored.toLowerCase().includes(word.toLowerCase()),
        `${shot} prompt contains creative direction: "${word}"`);
    }
  }
  // And the anchors ARE the pinned bytes, consumed not paraphrased.
  const studio = readFileSync(join(ROOT, "supabase/functions/_shared/studio-os.ts"), "utf8");
  const full = build({ vehicle: "v", viewType: "side", surfaceKey: "driver", finish: "Gloss" });
  assert.ok(full.includes("Clean, uncluttered composition"),
    "the studio anchor is not reaching the prompt intact");
  assert.ok(studio.includes("Clean, uncluttered composition"),
    "that line must come from the pinned studio anchor, not from this module");
});

test("the module itself carries no creative authority", () => {
  for (const symbol of [
    "buildDesignIQPrompt", "buildDesignerPrompt", "buildPhotographerPrompt",
    "COMMERCIAL_TRANSLATION", "COMMERCIAL_DEPTH", "LOGO_REQUIREMENT",
    "visionBoard", "designName", "companyName", "brief", "industry",
  ]) {
    assert.ok(!codeOnly(MODULE).includes(symbol),
      `${symbol} is in the proof contract module — it may not author design`);
  }
});

test("the OS authorities are structured inputs, never inferred", async () => {
  const { buildAtlasProofPresentationPrompt: build } = await mod();
  const p = build({ vehicle: "2022 Porsche 911 Turbo", viewType: "side", surfaceKey: "driver", finish: "Satin" });
  // Vehicle and surface are STATED. Gemini is not asked to read them off the
  // panel: the panel owns artwork, GENIE owns vehicle and surface geometry.
  assert.match(p, /^VEHICLE: 2022 Porsche 911 Turbo\nSURFACE: DRIVER\n/);
  assert.match(p, /^FINISH: SATIN — soft feathered sheen/m);
  assert.match(p, /\nCAMERA ANCHOR:\n/);
  assert.match(p, /\nSTUDIO AND LIGHTING ANCHOR:\n/);
});

test("the anchors are consumed from the pinned modules, never restated", () => {
  assert.match(MODULE, /import \{ STUDIO_ENVIRONMENT \} from "\.\/studio-os\.ts"/);
  assert.match(MODULE, /getCameraAngle/);
  // If the room or the light were retyped here they would drift from the pin.
  assert.ok(!MODULE.includes("LED strip"), "lighting is restated instead of consumed");
  assert.ok(!MODULE.includes("epoxy floor"), "the studio is restated instead of consumed");
});

test("the finish label is printed exactly once, for every finish", async () => {
  const { buildAtlasProofPresentationPrompt: build } = await mod();
  for (const [finish, opening] of Object.entries({
    Gloss: "FINISH: GLOSS — wet-look", Matte: "FINISH: MATTE — flat,",
    Satin: "FINISH: SATIN — soft feathered", Chrome: "FINISH: CHROME — mirror-like",
    Brushed: "FINISH: BRUSHED METAL — directional",
  })) {
    const line = build({ vehicle: "v", viewType: "side", surfaceKey: "driver", finish })
      .split("\n").find((l) => l.startsWith("FINISH:"));
    assert.ok(line.startsWith(opening), `${finish} printed: ${line.slice(0, 70)}`);
    assert.ok(!/^FINISH: ([A-Z ]+) — \1 — /.test(line), `${finish} stutters its label`);
  }
  for (const finish of [null, undefined, "nonsense"]) {
    const line = build({ vehicle: "v", viewType: "side", surfaceKey: "driver", finish })
      .split("\n").find((l) => l.startsWith("FINISH:"));
    assert.ok(line.startsWith("FINISH: GLOSS — wet-look"));
  }
});

test("the truck bed clause is a pickup-only OS input, sliced from the pin", async () => {
  const { buildAtlasProofPresentationPrompt: build } = await mod();
  const base = { vehicle: "2024 Ford F-250", viewType: "side", surfaceKey: "driver", finish: "Gloss" };
  assert.ok(!build(base).includes("COVERAGE:"), "a non-pickup carries the bed clause");
  const truck = build({ ...base, isPickup: true });
  assert.match(truck, /^COVERAGE: TRUCK BED: on a pickup/m);
  const angles = readFileSync(join(ROOT, "supabase/functions/_shared/view-angles-os.ts"), "utf8");
  const pinned = angles.split("\n").map((l) => l.trim()).find((l) => l.startsWith("TRUCK BED:"));
  assert.ok(truck.includes(pinned), "the bed clause drifted from the pinned block");
  // The other fifteen lines of the coverage block stay OUT.
  assert.ok(!truck.includes("WRAP COVERAGE — MANDATORY:"));
});

test("every shot builds a prompt in the anchors-only size band", async () => {
  const { buildAtlasProofPresentationPrompt: build, ATLAS_SHOT_SURFACES } = await mod();
  for (const [shot, surface] of Object.entries(ATLAS_SHOT_SURFACES)) {
    const p = build({ vehicle: "2022 Porsche 911 Turbo", viewType: shot, surfaceKey: surface || "driver", finish: "Gloss" });
    // ~2.9-3.5K, and nearly all of it is the two anchors: STUDIO_ENVIRONMENT
    // (1,927) plus the view angle (~500-900). The instruction is 299 chars.
    // The ceiling is what stops creative prose creeping back one clause at a
    // time -- the shape RULE 0.29 convicted at 13K.
    assert.ok(p.length > 2_500 && p.length < 4_000,
      `${shot} prompt is ${p.length} chars — outside the anchors-only band`);
  }
});

test("design-panel-ai-generate is pure Call-1 authoring again", () => {
  const dpag = readFileSync(join(ROOT, "supabase/functions/design-panel-ai-generate/index.ts"), "utf8");
  // The proof branch that OOM'd on a 5.2MB panel is gone; Call 1 is the only
  // thing this function does. Proofs live in the renderer that already carries
  // multi-megabyte panels in production.
  assert.ok(!dpag.includes('mode === "atlas-proof"'), "the proof branch is back in the authoring function");
  assert.ok(!dpag.includes("handleAtlasProofPresentation"));
  assert.ok(!dpag.includes("atlas-proof-presentation.ts"));
  assert.match(dpag, /mode === "atlas-artboard"/, "Call 1 authoring is gone");
});

test("both proof surfaces agree on one shot to surface map", () => {
  // The map lives in the shared module now, and the photographer imports it —
  // one home, so there is nothing to drift.
  assert.match(PHOTOGRAPHER, /ATLAS_SHOT_SURFACES,?\n?\s*\}? from "\.\.\/_shared\/atlas-proof-presentation\.ts"|ATLAS_SHOT_SURFACES/);
  assert.ok(!/const ATLAS_SHOT_SURFACES\s*[:=]/.test(PHOTOGRAPHER),
    "the photographer re-declares the map instead of importing it");
});
