import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const adapter = readFileSync(new URL("../app/src/lib/designpro-production-layers.ts", import.meta.url), "utf8");
const api = readFileSync(new URL("../app/src/lib/designpro-api.ts", import.meta.url), "utf8");
const SIDES = ["driver", "passenger", "hood", "roof", "front", "rear"];

/**
 * Production Layers is the customer's six-side surface. It was written against
 * `production_flow_assets`, which this system does not have; restoring that
 * table to satisfy an old read is exactly what the boundary forbids.
 */
test("the layers come from dpApi, never from a legacy table", () => {
  assert.match(adapter, /from "@\/lib\/designpro-api"/);
  // Comments stripped: the prose names the retired table in order to explain
  // why it is not read, and a rule must not fail on its own statement.
  const code = adapter.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  for (const legacy of [
    "production_flow_assets", "color_visualizations", "designiq_generations",
    "panelizer_jobs", "supabase.from", "functions.invoke",
  ]) {
    assert.ok(!code.includes(legacy), `the adapter must not reach for ${legacy}`);
  }
});

test("each call maps to the layer it produced, and only that one", () => {
  assert.match(adapter, /bySurface\("panel"\)/, "Call 9 branded panels");
  assert.match(adapter, /bySurface\("qc-panel"\)/, "Call 11 de-logoed duplicates");
  assert.match(adapter, /artifact\.kind === "logo"/, "Call 10 separated assets");
  assert.match(adapter, /branding_url: panel\.signedUrl/, "the branded panel is what the customer is owed");
  assert.match(adapter, /background_url: separationGap \? "" : duplicate!\.signedUrl/);
});

/** A side Call 11 honestly refused still owes its branded panel. */
test("an honest separation gap never removes the branded panel", () => {
  assert.match(adapter, /removedCount === 0/);
  assert.match(adapter, /separation_qc: separationGap/);
  assert.match(adapter, /reason: duplicate/);
});

test("the pack is identified by the proof it was bound to", () => {
  assert.match(adapter, /export function packIdentity\(proofContentHash: string\)/);
  assert.match(adapter, /version: `v2:\$\{hash\.slice\(0, 24\)\}`/, "the version prefix must be the source hash's own first 24");
  assert.match(adapter, /designpro:\/\/proof\/\$\{hash\}/, "a signed URL expires; the content hash is the identity");
  assert.match(adapter, /bound !== identity\.sourceHash\) return null/, "a panel bound to another sheet fails the pack");
});

test("a pack missing any of the six sides is not a pack", () => {
  assert.match(adapter, /SURFACE_ORDER\.some\(\(surface\) => !branded\.has\(surface\)\) \) return null|SURFACE_ORDER\.some\(\(surface\) => !branded\.has\(surface\)\)\) return null/);
  for (const side of SIDES) assert.match(adapter, new RegExp(`${side}:`), `${side} must be an addressable surface`);
});

test("each panel is paired with its own approved 3D view", () => {
  assert.match(api, /listApprovedViews: \(generationId: string\)/);
  assert.match(api, /\/approved-views/);
  assert.match(adapter, /designViews\[viewType\] = view\.signedUrl/);
  assert.match(adapter, /view\.sourceViewType \|\| SOURCE_VIEW_TYPE_FOR_ROLE/);
});

/**
 * One resolver, two surfaces. The card renders the same product wherever it is
 * mounted, so where its rows come from is decided once -- otherwise the job
 * page and RevisionStudio can disagree about what a run published.
 */
test("both surfaces resolve the standalone source through one hook", () => {
  const hook = readFileSync(new URL("../app/src/hooks/useStandaloneProductionLayers.ts", import.meta.url), "utf8");
  const jobPage = readFileSync(new URL("../app/src/pages/designpro/ProductionWorkflow.tsx", import.meta.url), "utf8");
  const studio = readFileSync(new URL("../app/src/pages/RevisionStudioIQ.tsx", import.meta.url), "utf8");

  assert.match(hook, /export function useStandaloneProductionLayers/);
  assert.match(hook, /loadProductionLayers\(id\)/);
  // Null is the fallback signal: a design that is not a standalone run leaves
  // the card resolving for itself, exactly as it does today.
  assert.match(hook, /\.catch\(\(\) => \{ if \(live\) setLayers\(null\); \}\)/);
  assert.match(hook, /if \(!layers \|\| !id\) return null/);

  for (const [name, page] of [["the job page", jobPage], ["RevisionStudio", studio]]) {
    assert.match(page, /useStandaloneProductionLayers/, `${name} must use the shared resolver`);
  }
  assert.match(studio, /source=\{standaloneProductionLayers\}/);
  assert.match(jobPage, /source=\{layersSource\}/);
  // The two products stay two checkouts.
  assert.match(hook, /checkout\("print_pack_entitlement"\)/);
  assert.match(hook, /checkout\("logo_pack"\)/);
});
