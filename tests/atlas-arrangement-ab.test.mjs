// TEST 12 — ARRANGEMENT A/B, LOCKED.
//
// Without a provider call these convict every way the arrangement test could
// quietly stop being an arrangement test: a band rotated, a surface's inches
// drifting from production, two rectangles touching, the model-facing guide
// growing furniture, the creative assembly changing by anything other than the
// five reversible tail swaps, anatomy vocabulary or a negative entering through
// a swap, the teaching proof entering either arm, the guide instruction
// differing between arms, and the real gate or the real extractor refusing the
// bands manifest.
//
// It also pins the harness plumbing: the workflow must offer the test, ship
// both scripts to the droplet, and pass the runtime an ALLOWLIST of named
// variables rather than the whole env file, with no Gemini credential at all
// on a capture-only run.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ARRANGEMENT_SWAPS,
  ARRANGEMENT_TOPOLOGY,
  BAND_PLACEMENT,
  BAND_ROWS,
  FORBIDDEN_IN_ADDED_TEXT,
  applyArrangementSwaps,
  assertAddedTextClean,
  buildArrangementPrompt,
  buildArrangementRequests,
  buildBandsManifest,
  reverseArrangementSwaps,
} from "../scripts/atlas-arrangement-contract.mjs";

const require = createRequire(import.meta.url);
const sharp = require("../runtime/node_modules/sharp");
const atlas = require("../runtime/flat-first-atlas.cjs");
const qc = require("../runtime/atlas-master-qc.cjs");
const sha256 = (v) => createHash("sha256").update(v).digest("hex");

const surface = (k, w, h) => ({ surfaceKey: k, widthInches: w, heightInches: h, surfaceSqFt: Math.round((w * h / 144) * 100) / 100, bleed: { top: 5, right: 5, bottom: 5, left: 5 } });
// The LIVE GENIE row for "2022 Ford F250 Crew Cab" and the catalog fixture the
// v1 locks use — the same two sets `atlas-field-recovery-v2.test.mjs` pins.
const LIVE = [surface("driver", 153, 56), surface("passenger", 153, 56), surface("hood", 71.5, 56), surface("roof", 74.3, 54.8), surface("front", 129, 34), surface("rear", 76, 54)];
const CATALOG = [surface("driver", 251, 60), surface("passenger", 251, 60), surface("hood", 64, 40), surface("roof", 60, 58), surface("front", 64, 30), surface("rear", 64, 23)];
const legacy = (set = LIVE) => atlas.buildAtlasManifest(set, null, "truck");
const bands = (set = LIVE) => buildBandsManifest(legacy(set), { atlas });

const DEPLOYED_PROMPT = readFileSync(new URL("../docs/ab/object-model-33595250518-prompt-A.txt", import.meta.url), "utf8");
const WORKFLOW = readFileSync(new URL("../.github/workflows/atlas-teaching-proof-ab.yml", import.meta.url), "utf8");

test("the deployed-prompt fixture is the one the edge sends", () => {
  assert.equal(DEPLOYED_PROMPT.length, 4587);
  assert.equal(sha256(DEPLOYED_PROMPT), "dcb73e9eae229cd88af6bcdb4a3874e1050b266fa98a55b79fee65d0b7e610b2");
});

// ── THE BANDS MANIFEST ──────────────────────────────────────────────────────

test("stacked bands: driver on top, passenger beneath, rear→roof→hood→front along the bottom, nothing rotated", () => {
  for (const set of [LIVE, CATALOG]) {
    const b = bands(set);
    assert.equal(b.topology, ARRANGEMENT_TOPOLOGY);
    assert.equal(b.zones.length, 6);
    const z = (k) => b.zones.find((q) => q.surfaceKey === k);
    for (const zone of b.zones) {
      assert.equal(zone.rotationDegrees, 0, `${zone.surfaceKey} must be drawn in its native orientation`);
      assert.equal(zone.extraction.outputRotationDegrees, 0);
      assert.equal(zone.placement, BAND_PLACEMENT[zone.surfaceKey]);
    }
    // Rows, top to bottom.
    assert.ok(z("driver").y + z("driver").h < z("passenger").y, "driver band sits above the passenger band");
    for (const k of BAND_ROWS[2]) assert.ok(z("passenger").y + z("passenger").h < z(k).y, `${k} sits below the passenger band`);
    // The bottom row, left to right, in the manifest's own centre order.
    const row = BAND_ROWS[2].map(z);
    for (let i = 1; i < row.length; i += 1) assert.ok(row[i - 1].x + row[i - 1].w < row[i].x, `${row[i - 1].surfaceKey} is left of ${row[i].surfaceKey}`);
    assert.deepEqual(BAND_ROWS[2], [...atlas.CENTER_ORDER]);
    // The two flanks are twins: same rectangle size, so the mirror check has a
    // like-for-like comparison.
    assert.equal(z("driver").w, z("passenger").w);
    assert.equal(z("driver").h, z("passenger").h);
  }
});

test("every band keeps its production inches, bleed and proof dependencies — only the rectangle moves", () => {
  for (const set of [LIVE, CATALOG]) {
    const l = legacy(set);
    const b = bands(set);
    for (const zone of b.zones) {
      const source = l.zones.find((q) => q.surfaceKey === zone.surfaceKey);
      for (const field of ["trimWidthIn", "trimHeightIn", "printWidthIn", "printHeightIn", "surfaceSqFt"]) {
        assert.equal(zone[field], source[field], `${zone.surfaceKey}.${field} drifted`);
      }
      assert.deepEqual(zone.bleedIn, source.bleedIn);
      assert.deepEqual(zone.proofDependencies, source.proofDependencies);
      assert.equal(zone.guideFill, source.guideFill);
      // The rectangle is the print rectangle's own aspect, so the panel cut from
      // it is the printed sheet's shape.
      const aspect = zone.w / zone.h;
      const printAspect = zone.printWidthIn / zone.printHeightIn;
      assert.ok(Math.abs(aspect - printAspect) / printAspect < 0.01, `${zone.surfaceKey} aspect ${aspect} vs print ${printAspect}`);
      assert.ok(zone.effectivePpi > 0);
    }
    assert.equal(b.totalTrimSqFt, l.totalTrimSqFt);
  }
});

test("no two bands touch, and all six sit inside the canvas", () => {
  for (const set of [LIVE, CATALOG]) {
    const b = bands(set);
    for (const zone of b.zones) {
      assert.ok(zone.x >= 0 && zone.y >= 0 && zone.x + zone.w <= atlas.CANVAS.widthPx && zone.y + zone.h <= atlas.CANVAS.heightPx, `${zone.surfaceKey} in bounds`);
    }
    for (let i = 0; i < b.zones.length; i += 1) {
      for (let j = i + 1; j < b.zones.length; j += 1) {
        const a = b.zones[i]; const c = b.zones[j];
        const separate = a.x + a.w < c.x || c.x + c.w < a.x || a.y + a.h < c.y || c.y + c.h < a.y;
        assert.ok(separate, `${a.surfaceKey} and ${c.surfaceKey} must be separated by a gutter`);
      }
    }
  }
});

test("a manifest that is not the production six-zone manifest is refused", () => {
  assert.throws(() => buildBandsManifest({ zones: legacy().zones.slice(0, 5) }, { atlas }), /six-zone/);
  assert.throws(() => buildBandsManifest(null, { atlas }), /six-zone/);
});

test("the model-facing bands guide renders as six plain masks and differs from the unroll guide", async () => {
  const a = await atlas.renderAtlasAuthoringGuide(legacy());
  const b = await atlas.renderAtlasAuthoringGuide(bands());
  assert.notEqual(sha256(a), sha256(b));
  const meta = await sharp(b).metadata();
  assert.equal(meta.width, atlas.CANVAS.widthPx);
  assert.equal(meta.height, atlas.CANVAS.heightPx);
  // Six masks and nothing else: the guard inside renderAtlasAuthoringGuide
  // would have thrown on any text, stroke or dashed trim.
  const svg = atlas._test.authoringGuideSvg(bands()).toString("utf8");
  assert.equal((svg.match(/<rect /g) || []).length, 7, "background plus exactly six masks");
  assert.doesNotMatch(svg, /<text|stroke=|stroke-dasharray|<line|<path/);
});

test("the production gate and the production extractor both accept the bands manifest", async () => {
  const b = bands();
  const master = await sharp({ create: { width: atlas.CANVAS.widthPx, height: atlas.CANVAS.heightPx, channels: 3, noise: { type: "gaussian", mean: 128, sigma: 40 } } }).png().toBuffer();
  const normalized = await atlas.normalizeAtlasMaster(master, b);
  const checks = await qc.deterministicMasterChecks(normalized.bytes, b);
  assert.equal(checks.zones.length, 6);
  assert.equal(checks.accepted, true, JSON.stringify(checks.blockingFailures));

  b.geometryResolution = { genieManifestHash: "f".repeat(64), state: "measured" };
  const panels = await atlas.cutCallOnePanels(normalized.bytes, b, sha256(normalized.bytes));
  assert.equal(panels.length, 6);
  assert.equal(new Set(panels.map((p) => p.contentHash)).size, 6);
  for (const panel of panels) {
    const zone = b.zones.find((q) => q.surfaceKey === panel.surfaceKey);
    assert.equal(panel.pixelWidth, zone.w, `${panel.surfaceKey} is cut at the drawn width — nothing rotated`);
    assert.equal(panel.pixelHeight, zone.h);
    assert.equal(panel.method, "deterministic_atlas_crop");
  }
});

// ── THE PROMPT ──────────────────────────────────────────────────────────────

test("exactly five arrangement phrases change, each once, and the swaps reverse to the deployed tail byte for byte", () => {
  const built = buildArrangementPrompt(DEPLOYED_PROMPT);
  assert.equal(ARRANGEMENT_SWAPS.length, 5);
  assert.equal(built.creative + built.deployedTail, DEPLOYED_PROMPT);
  assert.equal(built.prompt, built.creative + built.arrangementTail);
  assert.equal(reverseArrangementSwaps(built.arrangementTail), built.deployedTail);
  assert.equal(applyArrangementSwaps(built.deployedTail), built.arrangementTail);
  assert.equal(built.reverseProof, true);
  // The creative assembly is the same 2,622 characters production sends.
  assert.equal(built.creative.length, 2622);
  assert.ok(built.prompt.startsWith(built.creative));
  // Each source phrase occurs exactly once in the deployed tail, so a swap can
  // never silently match twice or not at all.
  for (const [from] of ARRANGEMENT_SWAPS) {
    assert.equal(built.deployedTail.split(from).length - 1, 1, `"${from.slice(0, 40)}…" must appear exactly once`);
    assert.equal(built.arrangementTail.includes(from), false, `"${from.slice(0, 40)}…" must not survive into B`);
  }
});

test("the B tail names the bands top to bottom and carries no unroll wording", () => {
  const { arrangementTail } = buildArrangementPrompt(DEPLOYED_PROMPT);
  const driver = arrangementTail.indexOf("• DRIVER SIDE — the long panel across the top");
  const passenger = arrangementTail.indexOf("• PASSENGER SIDE — the long panel directly beneath it");
  const row = arrangementTail.indexOf("• REAR, then ROOF, then HOOD, then FRONT — the row of four along the bottom, left to right");
  assert.ok(driver >= 0 && passenger > driver && row > passenger, "bullets read in the order the bands are stacked");
  assert.doesNotMatch(arrangementTail, /tall panel|centre column|center column|left and right flanks/);
  assert.match(arrangementTail, /ONE CONNECTED WRAP UNWRAPPED FLAT/);
});

test("no anatomy word and no negative enters through a swap", () => {
  for (const [, to] of ARRANGEMENT_SWAPS) assertAddedTextClean(to);
  for (const { word } of FORBIDDEN_IN_ADDED_TEXT) {
    assert.throws(() => assertAddedTextClean(`the long panel with a ${word} in it`), new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
  assert.throws(() => assertAddedTextClean("paint through the wheel arch"), /wheel/);
  // The guard reports the first forbidden word it meets; either is a conviction.
  assert.throws(() => assertAddedTextClean("Do not draw a window"), /window|do not/i);
  assert.throws(() => assertAddedTextClean("Do not draw a shape"), /do not/i);
});

test("a prompt without the deployed output-contract header is refused", () => {
  assert.throws(() => buildArrangementPrompt("You are the senior vehicle-wrap designer. Paint something."), /pinned header/);
});

// ── THE REQUESTS ────────────────────────────────────────────────────────────

const GUIDE_TEXT = "CURRENT TARGET GUIDE — this final neutral mask alone controls the requested output layout.";
const TEACHING_SHA = "684534d27f8e7d70771f4931d9d1119ec73d2a28db774abcc4e343eb6e5e3ded";

test("both arms are three parts and one guide image; the guide instruction is shared; the teaching proof is in neither", () => {
  const arrangement = buildArrangementPrompt(DEPLOYED_PROMPT);
  const { requests, partsA, partsB } = buildArrangementRequests({
    deployedPrompt: DEPLOYED_PROMPT, arrangement, targetGuideText: GUIDE_TEXT,
    guideBytesA: Buffer.from("guide-A"), guideBytesB: Buffer.from("guide-B"), model: "gemini-3-pro-image", teachingProofSha256: TEACHING_SHA,
  });
  for (const arm of ["A", "B"]) {
    assert.equal(requests[arm].partCount, 3);
    assert.equal(requests[arm].modelInputImageCount, 1);
    assert.equal(requests[arm].parts[1].kind, "text");
  }
  assert.equal(requests.A.parts[1].sha256, requests.B.parts[1].sha256);
  assert.equal(requests.A.promptSha256, sha256(DEPLOYED_PROMPT), "arm A is the deployed prompt");
  assert.equal(requests.B.promptSha256, sha256(arrangement.prompt));
  assert.notEqual(requests.A.parts[2].sha256, requests.B.parts[2].sha256);
  assert.equal(partsA[0].text, DEPLOYED_PROMPT);
  assert.equal(partsB[0].text, arrangement.prompt);
  assert.ok(!partsA.some((p) => p.inlineData && sha256(Buffer.from(p.inlineData.data, "base64")) === TEACHING_SHA));
});

test("the request guards convict a teaching proof, an identical guide, or an identical prompt", () => {
  const arrangement = buildArrangementPrompt(DEPLOYED_PROMPT);
  const base = { deployedPrompt: DEPLOYED_PROMPT, arrangement, targetGuideText: GUIDE_TEXT, guideBytesA: Buffer.from("a"), guideBytesB: Buffer.from("b"), model: "m", teachingProofSha256: TEACHING_SHA };
  assert.throws(() => buildArrangementRequests({ ...base, guideBytesB: Buffer.from("a") }), /guide images are identical/);
  assert.throws(() => buildArrangementRequests({ ...base, teachingProofSha256: sha256("a") }), /teaching proof/);
  assert.throws(() => buildArrangementRequests({ ...base, arrangement: { ...arrangement, prompt: DEPLOYED_PROMPT, arrangementTail: arrangement.deployedTail } }), /identical|nothing is being tested/);
  assert.throws(() => buildArrangementRequests({ ...base, targetGuideText: "not the guide text" }), /target-guide instruction/);
});

// ── THE HARNESS PLUMBING ────────────────────────────────────────────────────

test("the workflow offers test 12 and ships both scripts to the droplet", () => {
  assert.match(WORKFLOW, /- 12-arrangement-ab\n/);
  assert.match(WORKFLOW, /12-arrangement-ab\)\s+runner=scripts\/atlas-arrangement-ab\.mjs/);
  assert.match(WORKFLOW, /scripts\/atlas-arrangement-ab\.mjs \\/);
  assert.match(WORKFLOW, /scripts\/atlas-arrangement-contract\.mjs \\/);
  assert.match(WORKFLOW, /scripts\/atlas-print-media-contract\.mjs \\/);
  assert.match(WORKFLOW, /scripts\/atlas-fullbleed-metrics\.mjs \\/);
});

test("the harness receives an allowlist of named variables, never the whole env file, and no Gemini credential on a capture-only run", () => {
  assert.doesNotMatch(WORKFLOW, /--env-file/, "the runtime env file must not be handed to the harness wholesale");
  // The allowlist is spelled out, by name, in the workflow.
  for (const name of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "GOOGLE_IMAGE_MODEL"]) {
    assert.match(WORKFLOW, new RegExp(`HARNESS_ENV_ALWAYS=\\([^)]*\\b${name}\\b`), `${name} must be in the always-passed allowlist`);
  }
  for (const name of ["GOOGLE_AI_API_KEY_POOL", "GOOGLE_AI_API_KEY", "GEMINI_API_KEY"]) {
    assert.match(WORKFLOW, new RegExp(`HARNESS_ENV_PROVIDER=\\([^)]*\\b${name}\\b`), `${name} must be in the provider-only allowlist`);
    assert.doesNotMatch(WORKFLOW, new RegExp(`HARNESS_ENV_ALWAYS=\\([^)]*\\b${name}\\b`), `${name} must never be passed unconditionally`);
  }
  // Provider variables are exported only when the run is not capture-only.
  assert.match(WORKFLOW, /if \[ "\$AB_CAPTURE_ONLY" != "true" \]; then\n\s+for name in "\$\{HARNESS_ENV_PROVIDER\[@\]\}"/);
  // Names are logged; values never are.
  assert.match(WORKFLOW, /environment passed to the harness \(names only\)/);
});
