/**
 * PHASE 1B — the smallest offline proof.
 *
 *   one continuous overscanned creative field   (frozen fixture, no provider call)
 *     -> six distinct GENIE-proportioned windows (arithmetic, pure crop)
 *     -> exact logo + customer lettering         (code, at exact size)
 *     -> canonical flattened A.T.L.A.S.          (1:1 paste, rotation 0)
 *     -> six panels                              (the EXISTING extractor)
 *
 * Preview resolution only. No 150-PPI render. No provider call, no database
 * write, no deployment, nothing wired into the product path.
 */
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { buildFixture, contentPlan, genieSurfaces, GENIE_TRIM, BLEED_INCHES, VEHICLE } from "./fixture.mjs";

const require = createRequire(import.meta.url);
const atlas = require("../../runtime/flat-first-atlas.cjs");
const territoriesOf = require("../../runtime/atlas-field-territories.cjs");
const compiler = require("./atlas-window-compiler.cjs");

const sha256 = (b) => createHash("sha256").update(b).digest("hex");
export const OUT = join(import.meta.dirname, "out");

export async function compileOnce({ writeArtifacts = true } = {}) {
  const t = {};
  const t0 = Date.now();

  // The frozen stand-in for the one Gemini call.
  const fx = await buildFixture();
  t.fieldFixtureMs = Date.now() - t0;

  // GENIE geometry, unchanged: the production manifest, then the existing
  // rotation-0 code-only territories from main.
  const tGeom = Date.now();
  const legacyManifest = atlas.buildAtlasManifest(genieSurfaces(), null, VEHICLE.type);
  const territories = territoriesOf.buildFieldTerritories(legacyManifest);
  const genieManifestHash = sha256(Buffer.from(JSON.stringify(genieSurfaces())));
  territories.geometryResolution = {
    contract: "designpro.genie-manifest.v1",
    genieManifestId: genieManifestHash.slice(0, 32),
    genieManifestHash,
    state: "validated",
  };
  t.genieMs = Date.now() - tGeom;

  // Windows, placement, flattened master.
  const tCompile = Date.now();
  const compiled = await compiler.compileAtlas({
    fieldBytes: fx.fieldBytes,
    territories,
    content: contentPlan({ logoBytes: fx.logoBytes, logoHash: fx.logoHash }),
    fontBytes: fx.fontBytes,
  });
  t.atlasCompileMs = Date.now() - tCompile;

  // The EXISTING production extractor. Unchanged, unmodified, pure crop.
  const tCut = Date.now();
  const panelReadyMs = {};
  const panels = await atlas.cutCallOnePanels(compiled.bytes, territories, compiled.masterContentHash, {
    onPanel: (p) => { panelReadyMs[p.surfaceKey] = Date.now() - t0; },
  });
  t.panelExtractionMs = Date.now() - tCut;
  t.totalMs = Date.now() - t0;

  if (writeArtifacts) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, "atlas-master.png"), compiled.bytes);
    writeFileSync(join(OUT, "creative-field.png"), fx.fieldBytes);
    for (const p of panels) writeFileSync(join(OUT, `panel-${p.surfaceKey}.png`), p.bytes);
  }

  return { fx, legacyManifest, territories, compiled, panels, timings: t, panelReadyMs, genieManifestHash };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  compileOnce().then((r) => {
    console.log("=== OPERATIONS (exact, in order) ===");
    for (const op of r.compiled.operations) console.log("  " + op);
    console.log("\n=== HASHES ===");
    console.log("  genieManifestHash :", r.genieManifestHash);
    console.log("  creative field    :", r.compiled.field.sourceHash, `(${r.compiled.field.width}x${r.compiled.field.height}, overscan margin ${r.compiled.field.overscanMarginPx}px)`);
    console.log("  masterContentHash :", r.compiled.masterContentHash);
    console.log("\n=== SIX WINDOWS ===");
    console.log("  surface     window px      printAsp  windowAsp   aspErr   preview PPI");
    for (const s of r.compiled.surfaces) {
      const err = Math.abs(s.printAspect - s.windowAspect) / s.printAspect;
      console.log("  " + s.surfaceKey.padEnd(11) + `${s.source.width}x${s.source.height}`.padEnd(14) +
        s.printAspect.toFixed(4).padStart(8) + s.windowAspect.toFixed(4).padStart(11) +
        (err * 100).toFixed(3).padStart(8) + "%" + String(s.effectivePpi).padStart(11));
    }
    console.log("\n=== PANELS (existing extractor) ===");
    for (const p of r.panels) {
      console.log("  " + p.surfaceKey.padEnd(11) + `${p.pixelWidth}x${p.pixelHeight}`.padEnd(13) +
        `trim ${p.trimWidthIn}x${p.trimHeightIn}in  bleed ${p.bleedInches}"  ppi ${p.effectivePpi}  ` +
        `sourceMasterHash ${String(p.sourceMasterHash).slice(0, 12)}`);
    }
    console.log("\n=== RESAMPLING ===", JSON.stringify(r.compiled.resampling));
    console.log("=== COVERAGE ===", JSON.stringify(r.compiled.coverage));
    console.log("=== TIMINGS ms ===", JSON.stringify(r.timings));
    console.log("=== PANEL READY ms ===", JSON.stringify(r.panelReadyMs));
  }).catch((e) => { console.error("FAILED:", e?.code || "", e?.message || e); process.exitCode = 1; });
}
