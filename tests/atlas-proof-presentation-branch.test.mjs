/**
 * THE RESTORED LEGACY 3D PRESENTATION BRANCH — STRUCTURAL ISOLATION.
 *
 * Owner safety amendment, 2026-09-01: "Step 1 must not alter the existing
 * A.T.L.A.S. authoring branch inside design-panel-ai-generate. If
 * design-panel-ai-generate is reused for proof rendering, implement the
 * restored proof behavior as an isolated presentation-only branch/module with
 * an explicit mode discriminator and an early return, so the existing Call-1
 * A.T.L.A.S. assembly is byte-identical … no new presentation-only prompt text
 * can execute when the request is an A.T.L.A.S. authoring request."
 *
 * That last clause is what this file exists to prove, by SOURCE STRUCTURE
 * rather than by running Deno: the presentation prompt lives in its own module,
 * the authoring handler never references it, and the proof discriminator
 * returns before the creative destructuring that Call 1 depends on.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The presentation module is Deno TypeScript, so it is bundled with the
 * repo's own esbuild and EXECUTED. Reading the source would not have caught
 * either of the two defects the tests below lock -- both only appear in the
 * assembled string.
 */
let bundled = null;
async function bundledModule() {
  if (bundled) return bundled;
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const out = join(mkdtempSync(join(tmpdir(), "atlas-proof-")), "presentation.mjs");
  execFileSync(join(ROOT, "app/node_modules/.bin/esbuild"), [
    "--bundle", "--format=esm", `--outfile=${out}`,
    join(ROOT, "supabase/functions/_shared/atlas-proof-presentation.ts"),
  ], { stdio: "pipe" });
  bundled = await import(out);
  return bundled;
}
const DPAG = readFileSync(join(ROOT, "supabase/functions/design-panel-ai-generate/index.ts"), "utf8");
const MODULE = readFileSync(join(ROOT, "supabase/functions/_shared/atlas-proof-presentation.ts"), "utf8");
const PHOTOGRAPHER = readFileSync(join(ROOT, "supabase/functions/persona-photographer-render/index.ts"), "utf8");

/**
 * Strip comments before asserting a symbol is absent. These files NAME the
 * forbidden symbols in prose in order to forbid them — asserting on raw source
 * would convict the documentation that keeps the rule readable.
 */
function codeOnly(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
    .map((line) => line.replace(/\s\/\/.*$/, ""))
    .join("\n");
}

/** The `handleAtlasArtboard` body — the whole Call-1 code path in this file. */
function atlasArtboardBody() {
  const start = DPAG.indexOf("async function handleAtlasArtboard");
  assert.ok(start > 0, "handleAtlasArtboard is gone");
  // Brace-match from the opening brace of the function.
  let i = DPAG.indexOf("{", start);
  let depth = 0;
  for (let j = i; j < DPAG.length; j += 1) {
    if (DPAG[j] === "{") depth += 1;
    else if (DPAG[j] === "}") {
      depth -= 1;
      if (depth === 0) return DPAG.slice(start, j + 1);
    }
  }
  throw new Error("handleAtlasArtboard is unterminated");
}

test("the proof discriminator returns before any creative assembly", () => {
  const proofBranch = DPAG.indexOf('body?.mode === "atlas-proof"');
  const creativeDestructure = DPAG.indexOf("    const {\n      mode,\n      prompt,\n      style,");
  assert.ok(proofBranch > 0, "the atlas-proof discriminator is gone");
  assert.ok(creativeDestructure > 0, "the creative destructuring anchor moved — re-derive this test");
  assert.ok(proofBranch < creativeDestructure,
    "an atlas-proof request can reach the creative assembly");
  // And it must actually RETURN, not fall through.
  const branch = DPAG.slice(proofBranch, creativeDestructure);
  assert.match(branch, /return await handleAtlasProofPresentation\(body\)/);
});

test("the Call-1 authoring handler never touches presentation prompt text", () => {
  const body = atlasArtboardBody();
  for (const symbol of [
    "buildAtlasProofPresentationPrompt",
    "ATLAS_PROOF_PRESENTATION_CONTRACT",
    "handleAtlasProofPresentation",
    "atlas-proof-presentation",
  ]) {
    assert.ok(!codeOnly(body).includes(symbol),
      `handleAtlasArtboard references ${symbol} — the two branches are no longer isolated`);
  }
});

test("the presentation branch is internal-only, exactly as authoring is", () => {
  const proofBranch = DPAG.indexOf('body?.mode === "atlas-proof"');
  const branch = DPAG.slice(proofBranch, proofBranch + 600);
  assert.match(branch, /atlas_proof_internal_only/);
  assert.match(branch, /!internalCaller\.internal/);
});

/**
 * ZERO ARTWORK AUTHORITY. The canonical Call-1 panel is the wrap; this module
 * decides only how it is photographed. Every symbol below is a creative one —
 * if any of them appears here, the proof stage has become a second designer.
 */
test("the presentation module carries no creative authority", () => {
  for (const symbol of [
    "buildDesignIQPrompt",
    "buildDesignerPrompt",
    "COMMERCIAL_TRANSLATION",
    "COMMERCIAL_DEPTH",
    "LOGO_REQUIREMENT",
    "visionBoard",
    "designName",
    "companyName",
    "elevation",
    "senior creative director",
    "senior graphic designer",
  ]) {
    assert.ok(!codeOnly(MODULE).includes(symbol),
      `${symbol} is in the proof presentation module — it may not author design`);
  }
});

test("the presentation module carries the contract's required presentation authority", () => {
  assert.match(MODULE, /getCameraAngle/, "camera angle authority is missing");
  assert.match(MODULE, /STUDIO_ENVIRONMENT/, "studio and lighting authority is missing");
  assert.match(MODULE, /WRAP_COVERAGE_RULES/, "coverage rules are missing");
  assert.match(MODULE, /16:9 landscape/, "the 16:9 camera spec is missing");
  // The DCA that triggered this restoration returned wheels with no tires.
  assert.match(MODULE, /all four wheels mounted with full rubber tires/,
    "complete factory vehicle geometry including TIRES is missing");
  // ARTWORK IS LOCKED is the model-facing principle the contract requires.
  assert.match(MODULE, /ARTWORK IS LOCKED/);
  assert.match(MODULE, /The artwork is not\./);
});

test("the presentation handler pins temperature 1.0, 16:9 4K, and never falls back to Flash", () => {
  const start = DPAG.indexOf("async function handleAtlasProofPresentation");
  assert.ok(start > 0, "the presentation handler is gone");
  const body = DPAG.slice(start, DPAG.indexOf("// Edge function handler"));
  assert.match(body, /temperature: 1\.0/, "the legacy stack pinned temperature 1.0");
  assert.match(body, /imageConfig: \{ imageSize: "4K", aspectRatio: "16:9" \}/);
  assert.ok(!codeOnly(body).includes("FALLBACK_IMAGE_MODEL"),
    "the presentation path drops to Flash — a proof rendered on a different model is not evidence");
  assert.ok(!codeOnly(DPAG).includes("FALLBACK_IMAGE_MODEL"),
    "FALLBACK_IMAGE_MODEL is imported into design-panel-ai-generate");
  // The panel rides EVERY attempt — a text-only retry loses the artwork.
  assert.match(body, /const parts = \[panelPart, \{ text: prompt \}\]/);
  assert.ok(!/parts:\s*\[\{\s*text/.test(body), "a text-only retry is back");
  // RULE 0.29: the Driver continuity reference is ruled out by name.
  assert.match(body, /atlas_proof_hero_forbidden/);
  // The panel travels as a private storage path plus sha256, verified on arrival.
  assert.match(body, /atlas_proof_panel_hash_mismatch/);
});

/**
 * TWO DEFECTS CAUGHT BY EXECUTING THE BUILDER, NOT BY READING IT.
 *
 * 1. `Finish: SATIN — SATIN — soft feathered sheen…`. The legacy DPP table had
 *    no labels so the legacy line prefixed one; this table is DPAG's, whose
 *    entries already open with "GLOSS — ". `brushed` is the case a name-based
 *    strip still gets wrong, because its entry opens "BRUSHED METAL — ".
 * 2. ~900 characters of duplicated coverage rules. The full
 *    `WRAP_COVERAGE_RULES` block restates what the legacy one-line sentence
 *    already says; only the TRUCK BED clause is new, and only on a pickup.
 *
 * Both are locked here because both are the kind of defect a prompt file
 * accumulates silently.
 */
test("the finish label is printed exactly once, for every finish in the table", async () => {
  const { buildAtlasProofPresentationPrompt } = await bundledModule();
  const expected = {
    Gloss: "Finish: GLOSS — wet-look",
    Matte: "Finish: MATTE — flat,",
    Satin: "Finish: SATIN — soft feathered",
    Chrome: "Finish: CHROME — mirror-like",
    Brushed: "Finish: BRUSHED METAL — directional",
  };
  for (const [finish, opening] of Object.entries(expected)) {
    const line = buildAtlasProofPresentationPrompt({
      vehicle: "2022 Porsche 911", viewType: "side", surfaceKey: "driver", finish,
    }).split("\n").find((l) => l.startsWith("Finish:"));
    assert.ok(line.startsWith(opening), `${finish} printed: ${line.slice(0, 80)}`);
    // The stutter, stated directly: no label may appear twice.
    assert.ok(!/^Finish: ([A-Z ]+) — \1 — /.test(line), `${finish} stutters its label`);
  }
  // An unknown or absent finish falls through to gloss, as the legacy path does.
  for (const finish of [null, undefined, "nonsense"]) {
    const line = buildAtlasProofPresentationPrompt({
      vehicle: "v", viewType: "side", surfaceKey: "driver", finish,
    }).split("\n").find((l) => l.startsWith("Finish:"));
    assert.ok(line.startsWith("Finish: GLOSS — wet-look"));
  }
});

test("the truck bed clause appears only on a pickup, and is sliced from the pin", async () => {
  const { buildAtlasProofPresentationPrompt } = await bundledModule();
  const base = { vehicle: "2024 Ford F-250", viewType: "side", surfaceKey: "driver", finish: "Gloss" };
  const car = buildAtlasProofPresentationPrompt(base);
  const truck = buildAtlasProofPresentationPrompt({ ...base, isPickup: true });
  assert.ok(!car.includes("TRUCK BED:"), "a non-pickup proof carries the bed clause");
  assert.match(truck, /TRUCK BED: on a pickup, the wrap covers the outer painted panels/);
  // The clause is DERIVED, not re-typed: it must be byte-identical to the pin's.
  const angles = readFileSync(join(ROOT, "supabase/functions/_shared/view-angles-os.ts"), "utf8");
  const pinned = angles.split("\n").map((l) => l.trim()).find((l) => l.startsWith("TRUCK BED:"));
  assert.ok(truck.includes(pinned), "the bed clause has drifted from the pinned block");
  // And the other fifteen lines of the block stay OUT — ~900 chars of the
  // legacy sentence restated is exactly the bloat this file must not grow.
  assert.ok(!truck.includes("WRAP COVERAGE — MANDATORY:"),
    "the full coverage block is back, duplicating the legacy one-line sentence");
  assert.match(truck, /The wrap covers painted body panels only\. Windows, lights, wheels, and trim stay factory\./);
});

test("every shot builds a prompt in the proven size band", async () => {
  const { buildAtlasProofPresentationPrompt, ATLAS_SHOT_SURFACES } = await bundledModule();
  for (const [shot, surface] of Object.entries(ATLAS_SHOT_SURFACES)) {
    const prompt = buildAtlasProofPresentationPrompt({
      vehicle: "2022 Porsche 911", viewType: shot, surfaceKey: surface || "driver", finish: "Satin",
    });
    // STUDIO_ENVIRONMENT alone is ~1.3K and the owner ordered it restored, so
    // this band is a consequence of the recovered stack, not drift. The ceiling
    // is what stops the 13K reconstruction RULE 0.29 convicted from creeping
    // back one clause at a time.
    assert.ok(prompt.length > 3_000 && prompt.length < 6_000,
      `${shot} prompt is ${prompt.length} chars — outside the proven band`);
    // The camera angle is stated first AND last. That repetition is in the
    // proven prompt: the studio block sits between the two statements.
    assert.match(prompt, /^CAMERA ANGLE \(LOCKED — read this FIRST\):/);
  }
});

/**
 * TWO HOMES FOR ONE ROUTING CONTRACT, SO THEY ARE CHECKED AGAINST EACH OTHER.
 *
 * `persona-photographer-render` is a byte-pinned adaptation (RULE 0.29), so the
 * map is re-declared in the shared module rather than exported from it. This
 * parses the photographer's literal and fails the moment the two disagree.
 */
test("both proof producers enforce the same shot to surface map", () => {
  const parse = (source, name) => {
    const start = source.indexOf(`${name}: Record<string, string`);
    assert.ok(start > 0, `${name} not found`);
    const open = source.indexOf("{", start);
    const close = source.indexOf("};", open);
    const literal = source.slice(open, close + 1);
    const map = {};
    for (const [, shot, surface] of literal.matchAll(/"([a-z_-]+)":\s*(?:"([a-z]+)"|null)/g)) {
      map[shot] = surface ?? null;
    }
    return map;
  };
  const shared = parse(MODULE, "ATLAS_SHOT_SURFACES");
  const pinned = parse(PHOTOGRAPHER, "ATLAS_SHOT_SURFACES");
  assert.deepEqual(shared, pinned,
    "the shot→surface maps have drifted — a proof could be handed the wrong surface's panel");
  assert.deepEqual(shared, {
    "side": "driver",
    "passenger-side": "passenger",
    "hood_detail": "hood",
    "front": "front",
    "rear": "rear",
    "roof": "roof",
    // Close-up must NAME its surface; it may never silently inherit Driver.
    "close-up": null,
  });
});

test("persona-photographer-render still renders the other six shots", () => {
  const provider = readFileSync(join(ROOT, "runtime/designpanel-server-provider.cjs"), "utf8");
  assert.match(provider, /ATLAS_PRESENTATION_RESTORED_SHOTS = new Set\(\["side"\]\)/,
    "the restoration must stay Driver-only until Driver passes canonical fidelity");
  assert.match(provider, /const proofFunction = restored \? ATLAS_PRESENTATION_FUNCTION : ATLAS_PROOF_STAGE/);
});
