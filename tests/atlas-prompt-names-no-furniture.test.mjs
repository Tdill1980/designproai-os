// THE MODEL PAINTS WHAT THE PROMPT NAMES. SO THE PROMPT NAMES NO FURNITURE.
//
// Four separate live failures are the same defect at different depths, and
// each was fixed narrowly enough that the next one still got through:
//
//   2026-08-25  eb7835a8  surface names centred ON the containers -> the words
//               HOOD and ROOF came back painted; three attempts refused,
//               zero masters. Fixed by splitting the guide by consumer.
//   2026-08-27  f3eb40c1  captions legal inside the 5" bleed band -> "PASSENGER
//               SIDE and dimensions" cut into the panel handed to the proof
//               judge as artwork authority. Fixed by moving the guard's
//               boundary from zone.trim to zone.extraction.
//   2026-08-28  8555be2f  the PROMPT listed each panel as
//               `DS — DRIVER SIDE — … — 231.3" x 90"` and described the
//               sheet's captions, Surface IDs, pixel sizes, dashed outlines,
//               title band, footer, silhouette and grid before saying not to
//               reproduce them. Four dimension strings and four surface IDs
//               came back lettered onto the artwork and were cut into all six
//               print panels.
//   2026-08-29  c3269f4d  same prompt, no callouts -- and a dashed rectangle
//               through every one of the six panels, because the authoring
//               guide still DREW the trim inset inside each container and the
//               prompt still named it.
//
// The pattern is one rule: anything the model is shown inside a container, or
// told about in words, is something it may paint. Geometry it needs. An
// inventory of marks it must not make is not geometry -- it is a shopping list,
// and this repo's own RULE 0.15 records that Gemini over-indexes on negatives.
//
// These assertions are the rule, made mechanical. Do not relax one to get a
// wording change through; the wording is the defect.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const edge = readFileSync(join(root, "supabase/functions/design-panel-ai-generate/index.ts"), "utf8");
const runtime = readFileSync(join(root, "runtime/flat-first-atlas.cjs"), "utf8");

/** The ATLAS output-format contract, sliced from its own template literal. */
function atlasContractText() {
  const start = edge.indexOf("OUTPUT FORMAT \\u2014 ONE FLAT PRODUCTION MASTER");
  assert.notEqual(start, -1, "the ATLAS flat-master contract template must still be findable");
  const end = edge.indexOf("`;", start);
  assert.notEqual(end, -1, "the ATLAS contract template must terminate");
  return edge.slice(start, end);
}

test("the contract hands the model no measurement", () => {
  const contract = atlasContractText();
  // `231.3" x 90"` is what generation 8555be2f lettered onto the sheet.
  assert.doesNotMatch(
    contract,
    /\$\{p\.widthInches\}|\$\{p\.heightInches\}|widthInches.*heightInches/,
    "panel lines must not interpolate inches; the model letters the numbers it is given",
  );
  // The builder itself must not compose a size fragment at all.
  const builder = edge.slice(edge.indexOf("function atlasFlatMasterContract"), edge.indexOf("function buildDesignIQPrompt"));
  assert.doesNotMatch(
    builder,
    /const size\s*=/,
    "atlasFlatMasterContract must not build a dimension fragment for the prompt",
  );
});

test("the contract hands the model no surface code", () => {
  const builder = edge.slice(edge.indexOf("function atlasFlatMasterContract"), edge.indexOf("function buildDesignIQPrompt"));
  assert.doesNotMatch(
    builder,
    /\$\{p\.surfaceId\}/,
    "panel lines must not carry the Surface ID; HD, RF, RR and FR came back painted from exactly this",
  );
});

test("the contract describes none of the sheet's own furniture", () => {
  const contract = atlasContractText();
  // Each of these was named in the prompt and then came back in the artwork.
  for (const named of ["CAPTIONED", "Surface ID", "pixel size", "DASHED", "title band", "footer", "silhouette", "grid"]) {
    assert.ok(
      !contract.toLowerCase().includes(named.toLowerCase()),
      `the contract must not name "${named}" — naming a mark is how the model learns to draw it`,
    );
  }
});

test("the fill rule is positive, not an inventory of forbidden vehicle parts", () => {
  const contract = atlasContractText();
  assert.ok(contract.includes("FILL EVERY CONTAINER EDGE TO EDGE"), "the positive fill rule must survive");
  // The ten-item enumeration. Naming them is what produced flanks drawn as
  // vehicle elevations with the arches punched out.
  for (const forbidden of ["door seam", "wheel arch", "windows", "glass", "handles", "bumpers", "cut-out"]) {
    assert.ok(
      !contract.toLowerCase().includes(forbidden),
      `the contract must not enumerate "${forbidden}" — say what to paint, never what not to`,
    );
  }
});

test("the authoring guide draws nothing inside a container", () => {
  const authoring = runtime.slice(runtime.indexOf("function authoringGuideSvg"), runtime.indexOf("function guideSvg"));
  assert.ok(
    authoring.includes("guideContainersSvg"),
    "the model's guide must use the containers-only renderer",
  );
  assert.ok(
    !authoring.includes("guideGeometrySvg"),
    "the model's guide must not use the renderer that insets a dashed trim rectangle",
  );
  const containers = runtime.slice(runtime.indexOf("function guideContainersSvg"), runtime.indexOf("function guideGeometrySvg"));
  assert.ok(
    !containers.includes("stroke-dasharray"),
    "no dashed mark may be drawn inside a container the model is told to fill",
  );
  // The human map keeps it — losing that would blind the QC inspector.
  const human = runtime.slice(runtime.indexOf("function guideGeometrySvg"), runtime.indexOf("function authoringGuideSvg"));
  assert.ok(
    human.includes("stroke-dasharray"),
    "the installer map must keep the printable-area inset; the design team reads it",
  );
});

test("both homes of the artboard contract version agree", () => {
  const edgeVersion = edge.match(/ATLAS_ARTBOARD_PROMPT_VERSION = "([^"]+)"/)?.[1];
  const runtimeVersion = runtime.match(/ATLAS_ARTBOARD_EDGE_PROMPT_VERSION = "([^"]+)"/)?.[1];
  assert.ok(edgeVersion, "the edge function must pin an artboard contract version");
  assert.equal(
    runtimeVersion,
    edgeVersion,
    "the version is folded into the Call-1 promptHash; a mismatch reuses masters authored against the old contract",
  );
});
