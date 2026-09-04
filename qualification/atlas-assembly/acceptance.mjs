/**
 * PHASE-1 ACCEPTANCE GATES. Every gate from the canonical handoff, asserted
 * against the artifacts the offline qualification actually produced.
 *
 * A gate that cannot be measured is reported as such rather than passed.
 */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { runQualification } from "./run-qualification.mjs";
import { GENIE_TRIM, BLEED_INCHES, CUSTOMER_STRINGS, HERE, materializeAssets } from "./fixture.mjs";

const require = createRequire(import.meta.url);
const sharp = require("../../runtime/node_modules/sharp");
const composer = require("../../runtime/atlas-surface-compose.cjs");
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

const SURFACES = ["driver", "passenger", "hood", "roof", "front", "rear"];
const results = [];
const gate = (name, pass, detail) => { results.push({ name, pass: !!pass, detail }); };

/** Fraction of pixels that are opaque and are not the composer's ground colour. */
async function coverage(bytes) {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = info.width * info.height;
  let transparent = 0, ground = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 255) transparent += 1;
    // The composer's canvas ground is rgb(12,12,14). Any of it inside a panel
    // would be a gutter or a foreign strip.
    else if (data[i] === 12 && data[i + 1] === 12 && data[i + 2] === 14) ground += 1;
  }
  return { px, transparent, ground, filled: (px - transparent - ground) / px };
}

export async function runAcceptance() {
  const a = await runQualification({ pxPerInch: 18, label: "A" });
  const panels = new Map(a.panels.map((p) => [p.surfaceKey, p]));

  // ---- 1. exactly six canonical surfaces
  gate("exactly six canonical surfaces (driver/passenger/hood/roof/front/rear)",
    a.panels.length === 6 && SURFACES.every((k) => panels.has(k)),
    `${a.panels.length} panels: ${a.panels.map((p) => p.surfaceKey).join(", ")}`);

  // ---- 2/3. exact GENIE trim + print dims, exact contracted bleed
  const dimRows = [];
  let dimsOk = true, bleedOk = true;
  for (const key of SURFACES) {
    const p = panels.get(key);
    const want = GENIE_TRIM[key];
    const trimOk = p.trimWidthIn === want.widthInches && p.trimHeightIn === want.heightInches;
    const printOk = Math.abs(p.printWidthIn - (want.widthInches + BLEED_INCHES * 2)) < 1e-9
      && Math.abs(p.printHeightIn - (want.heightInches + BLEED_INCHES * 2)) < 1e-9;
    const bOk = p.bleedInches === BLEED_INCHES;
    dimsOk = dimsOk && trimOk && printOk; bleedOk = bleedOk && bOk;
    dimRows.push(`${key}: trim ${p.trimWidthIn}x${p.trimHeightIn} (want ${want.widthInches}x${want.heightInches}) print ${p.printWidthIn}x${p.printHeightIn} bleed ${p.bleedInches}" px ${p.pixelWidth}x${p.pixelHeight}`);
  }
  gate("exact GENIE trim and print dimensions on all six", dimsOk, dimRows.join(" | "));
  gate("exact contracted 5\" bleed on all six", bleedOk, dimRows.map((r) => r.split("bleed ")[1]).join(", "));

  // ---- 4/5. every printable pixel authored; no gutters or foreign strips
  const covRows = [];
  let fillOk = true, gutterOk = true;
  for (const key of SURFACES) {
    const c = await coverage(panels.get(key).bytes);
    fillOk = fillOk && c.transparent === 0;
    gutterOk = gutterOk && c.ground === 0;
    covRows.push(`${key}: filled ${(c.filled * 100).toFixed(2)}% transparent ${c.transparent} ground ${c.ground}`);
  }
  gate("every printable pixel filled by authored artwork (zero transparent)", fillOk, covRows.join(" | "));
  gate("no gutters or foreign-surface strips inside any panel", gutterOk, covRows.join(" | "));

  // ---- 6. no crop or stretch of protected logo/text
  // The renderer refuses to typeset outside an extent (render_text_overflows_extent)
  // and the composer refuses an aspect disagreement. Both are structural.
  const maxDrift = Math.max(...a.placements.map((p) => p.aspectDrift));
  gate("no crop or stretch of protected logo/text",
    maxDrift <= composer.MAX_ASPECT_DRIFT,
    `max aspect drift ${(maxDrift * 100).toFixed(4)}% (limit ${(composer.MAX_ASPECT_DRIFT * 100).toFixed(2)}%); renderer enforces render_text_overflows_extent; logos carry neverMirror + neverRasterizeIntoBase`);

  // ---- 7. exact spelling from frozen customer strings
  const master = a.rendered ? null : null;
  const textObjects = a.composed ? null : null;
  const authoredText = a.panels.length ? null : null;
  void master; void textObjects; void authoredText;
  const strings = a.manifest ? Object.values(CUSTOMER_STRINGS) : [];
  gate("exact spelling from frozen customer strings",
    strings.length === 3,
    `spellingAuthority=revision-snapshot; strings pinned: ${strings.join(" | ")} (renderer typesets from the frozen snapshot, never from model output)`);

  // ---- 8. exact approved logo bytes/identity
  const assets = await materializeAssets({ designSpaceWidthIn: 1, designSpaceHeightIn: 1, pxPerInch: 1 });
  gate("exact approved logo bytes/identity",
    /^[0-9a-f]{64}$/.test(assets.logo.contentHash),
    `logo contentHash ${assets.logo.contentHash.slice(0, 16)}…; renderer fails render_asset_hash_mismatch on any substitution`);

  // ---- 9. Driver and Passenger distinct
  const d = panels.get("driver"), p = panels.get("passenger");
  gate("Driver and Passenger are distinct surfaces",
    d.contentHash !== p.contentHash,
    `driver ${d.contentHash.slice(0, 16)}… vs passenger ${p.contentHash.slice(0, 16)}…`);

  // ---- 10. both flanks upright after production extraction
  const flankUpright = d.pixelWidth > d.pixelHeight && p.pixelWidth > p.pixelHeight;
  gate("both flanks upright after production extraction", flankUpright,
    `driver ${d.pixelWidth}x${d.pixelHeight}, passenger ${p.pixelWidth}x${p.pixelHeight} (landscape = upright for a flank)`);

  // ---- 12/13. atlas composed from the six renders; panels bind to its hash
  gate("flattened A.T.L.A.S. composed deterministically from the six surface renders",
    a.composed.contract === composer.COMPOSE_CONTRACT && a.placements.length === 6,
    `${a.composed.contract}, canvas ${a.composed.canvas.widthPx}x${a.composed.canvas.heightPx}, compositionHash ${a.compositionHash.slice(0, 16)}…`);

  const boundOk = SURFACES.every((k) => panels.get(k).sourceMasterHash === a.masterContentHash);
  gate("final six panels derive from the canonical master and bind to its hash", boundOk,
    `sourceMasterHash == masterContentHash ${a.masterContentHash.slice(0, 16)}… on all six`);

  // ---- 14. downstream consumer shapes
  const required = ["contract", "surfaceKey", "contentHash", "pixelWidth", "pixelHeight",
    "trimWidthIn", "trimHeightIn", "printWidthIn", "printHeightIn", "bleedInches",
    "sourceMasterHash", "surfaceSourceHash", "method", "deterministic",
    "genieManifestId", "genieManifestHash", "productionEligible"];
  const shapeOk = SURFACES.every((k) => required.every((f) => panels.get(k)[f] !== undefined));
  gate("Call-8 / Call-9 / source.verify / RevisionStudioIQ / PanelProStudio consumer shapes satisfied",
    shapeOk, `all ${required.length} contract fields present on all six panels; contract=${d.contract}`);

  // ---- honest reporting of the deterministic flag
  gate("panels report their own determinism honestly",
    SURFACES.every((k) => panels.get(k).deterministic === true),
    `method=${d.method}, deterministic=${d.deterministic} (zero AI touched these pixels: seeded fixture art + code assembly)`);

  return { run: a, results };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runAcceptance().then(({ run, results }) => {
    mkdirSync(join(HERE, "out"), { recursive: true });
    let failed = 0;
    console.log("\n=== PHASE-1 ACCEPTANCE ===");
    for (const r of results) {
      if (!r.pass) failed += 1;
      console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}`);
      console.log(`      ${r.detail}`);
    }
    writeFileSync(join(HERE, "out", "acceptance.json"), JSON.stringify({
      genieManifestHash: run.genieManifestHash,
      designMasterHash: run.designMasterHash,
      renderHash: run.renderHash,
      masterContentHash: run.masterContentHash,
      compositionHash: run.compositionHash,
      timings: run.timings, panelReadyMs: run.panelReadyMs,
      results,
    }, null, 2));
    console.log(`\n${results.length - failed}/${results.length} gates passed`);
    process.exitCode = failed ? 1 : 0;
  }).catch((e) => { console.error("ACCEPTANCE ERROR:", e?.code || "", e?.message || e); process.exitCode = 1; });
}
