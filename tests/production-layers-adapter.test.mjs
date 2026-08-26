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
 * WHICH MASTER DID THIS PROOF COME FROM.
 *
 * A proof that drifted from the master is the failure that cost the most: the
 * customer approves one design and the panels are cut from another. The runtime
 * already makes it impossible -- the provider refuses to render a proof whose
 * conditioning bytes do not hash to the master zone -- but none of that was
 * visible to the design team, who had to take it on trust. The board now shows
 * it, so this pins the whole path: the gateway must project the binding, and
 * the board must compare it against the master actually on screen.
 */
test("a proof carries the master it was rendered from, all the way to the board", () => {
  const gateway = readFileSync(new URL("../gateway/src/server.mjs", import.meta.url), "utf8");
  const board = readFileSync(new URL("../app/src/pages/designpro/PanelProStudioBoard.tsx", import.meta.url), "utf8");

  // The binding has to be read, or there is nothing to project. It comes from
  // the SECURITY DEFINER workspace read now: the view table itself is
  // service-role only, so the direct select this used to assert was refused for
  // every caller and the whole proof set was invisible in the studio.
  assert.match(gateway, /designpro_generation_workspace/);
  assert.match(gateway, /atlasMasterContentHash/);
  assert.match(gateway, /atlasBinding:/);
  for (const field of ["masterContentHash", "zoneContentHash", "zoneSurfaceKey", "anchoredToDriver", "deterministicMirror"]) {
    assert.match(gateway, new RegExp(field), `the gateway must project ${field}`);
  }
  // Null rather than a fabricated binding when the run has no master.
  assert.match(gateway, /:\s*null,\s*\n\s*\}\);/);

  assert.match(api, /atlasBinding:/);

  // The board compares against the master ON SCREEN, not any master, or the
  // badge would agree with itself while showing a different version.
  // `selected.master.contentHash`, not `selected.masterContentHash`. The board
  // read the flat spelling, which does not exist on FlatAtlasRevision, so the
  // comparison was undefined === undefined: it never matched, never drifted,
  // and reported "unknown" for every proof on every run. This assertion pinned
  // the wrong spelling and so froze the defect in place -- it names the real
  // field now, which is the only version of this check that can ever fire.
  assert.match(board, /binding!\.masterContentHash === selected\.master\.contentHash/);
  assert.match(board, /DIFFERENT MASTER/);
  // A Standard run and a pre-binding proof are not drifted proofs.
  assert.match(board, /no master binding/);
});

/**
 * One resolver, two surfaces. The card renders the same product wherever it is
 * mounted, so where its rows come from is decided once -- otherwise the job
 * page and RevisionStudio can disagree about what a run published.
 */
test("the live RevisionStudio resolves the standalone source through one hook", () => {
  const hook = readFileSync(new URL("../app/src/hooks/useStandaloneProductionLayers.ts", import.meta.url), "utf8");
  const jobPage = readFileSync(new URL("../app/src/pages/designpro/ProductionWorkflow.tsx", import.meta.url), "utf8");
  const studio = readFileSync(new URL("../app/src/components/revisioniq/ServerRevisionStudio.tsx", import.meta.url), "utf8");

  assert.match(hook, /export function useStandaloneProductionLayers/);
  assert.match(hook, /loadProductionLayers\(id\)/);
  // Null is the fallback signal: a design that is not a standalone run leaves
  // the card resolving for itself, exactly as it does today.
  assert.match(hook, /\.catch\(\(\) => \{ if \(live\) setLayers\(null\); \}\)/);
  assert.match(hook, /if \(!layers \|\| !id\) return null/);

  assert.match(jobPage, /useStandaloneProductionLayers/);
  assert.match(jobPage, /layersSource=\{layersSource\}/);
  assert.match(studio, /source=\{layersSource\}/);
  // The two products stay two checkouts.
  assert.match(hook, /checkout\("print_pack_entitlement"\)/);
  assert.match(hook, /checkout\("logo_pack"\)/);
});

/**
 * THE RIGHT COLUMN BEFORE ANYONE HAS PAID.
 *
 * `panels.build` is Call 9 and Call 9 lives after `await_purchase`, so reading
 * only that stage meant the customer's own six-panel column was empty for every
 * design nobody had ordered -- which is every design at the moment it matters.
 * Call 1 has already cut all six from the accepted master (RULE 0.21), and this
 * is the half of that fan-out RevisionStudio consumes.
 */
test("the entice column is fed by the Call-1 panels, not by an empty Call 9", () => {
  assert.match(adapter, /export function toAtlasEnticeLayers/);
  assert.match(adapter, /input\.revision\.callOnePanels/);
  // Six sides or nothing: five shown as a set is how a customer finds the
  // sixth at print time.
  assert.match(adapter, /SURFACE_ORDER\.some\(\(surface\) => !panels\.has\(surface\)\)\) return null/);
  // Every number is the one the server stamped. Nothing is recomputed here.
  for (const field of [
    "panel.trimWidthIn", "panel.trimHeightIn", "panel.printWidthIn",
    "panel.printHeightIn", "panel.bleedInches", "panel.surfaceSqFt",
    "panel.effectivePpi", "panel.sourceMasterHash",
  ]) {
    assert.ok(adapter.includes(field), `the entice row must publish ${field}`);
  }
  // Call 9 still wins when it exists: after purchase the branded panels are the
  // production artwork and the design-time cut is history, never a merge.
  assert.match(adapter, /if \(call9 && call9\.state === "complete"\)/);
  assert.match(adapter, /listJobFlatAtlasRevisions\(generationId\)/);
});

test("the entice set never claims production eligibility or a clean panel", () => {
  const enticeBlock = adapter.slice(adapter.indexOf("export function toAtlasEnticeLayers"));
  // GENIE resolves the validated production dimensions after purchase. Call 1's
  // geometry is the design size and says so.
  assert.match(enticeBlock, /production_eligible: false/);
  // Call 11 has not run, so there is no de-logoed duplicate. Reported as the
  // reasoned gap the card already knows how to display, never invented.
  assert.match(enticeBlock, /background_url: ""/);
  assert.match(enticeBlock, /separation_qc: \{/);
  assert.match(enticeBlock, /Call 11 has not run yet/);
  // Call 8 has not run either, so there is no 2D production proof to show.
  assert.match(enticeBlock, /proofUrl: null/);
  // The identity is the MASTER these six were cut from -- not a proof that does
  // not exist, and not an activated production pack this design has never had.
  assert.match(enticeBlock, /designpro:\/\/atlas-master\//);
  assert.match(enticeBlock, /activePack: null/);
});

/**
 * The six panels only reach the browser if the server publishes them, and only
 * safely if it proves them first. This pins the whole path: the RPC returns the
 * record, the gateway validates every panel against its own master and its own
 * arithmetic before signing, and the client type carries the geometry through.
 */
test("the Call-1 panels are published, validated and typed end to end", () => {
  const gateway = readFileSync(new URL("../gateway/src/server.mjs", import.meta.url), "utf8");
  const migration = readFileSync(new URL(
    "../supabase/migrations/20260826030000_designpro_revision_studio_surface.sql",
    import.meta.url,
  ), "utf8");

  assert.match(migration, /'callOnePanels',COALESCE\(r\.metadata->'callOnePanels','\[\]'::jsonb\)/);
  assert.match(gateway, /function validatedCallOnePanels/);
  // Print is trim plus the bleed on both edges. A panel that fails its own
  // arithmetic is one the installer cannot cut to.
  assert.match(gateway, /printWidthIn\) - \(Number\(panel\.trimWidthIn\) \+ 2 \* Number\(panel\.bleedInches\)\)/);
  // A panel cut from another master is the exact pairing failure PanelPro
  // exists to catch, so it must not reach a customer's screen either.
  assert.match(gateway, /sourceMasterHash \|\| ""\)\.toLowerCase\(\) !== masterContentHash/);
  // The private path never leaves the gateway.
  assert.match(gateway, /callOnePanels, \.\.\.base/);
  assert.match(api, /callOnePanels: FlatAtlasCallOnePanel\[\]/);
});

/**
 * REAL DESIGN PROOF ∥ PRINT PANEL — PROOF LEFT, PANEL RIGHT.
 *
 * RULE 0.21 states the row in those words: "Left is that surface's 3D proof.
 * Right is the deterministic A.T.L.A.S. extraction for that exact surfaceKey."
 * The card had them reversed, which reads as the panel being the thing and the
 * render a footnote. It is the other way round: the customer approved a design
 * on the vehicle, and the panel is what that approval produced -- so the eye
 * lands on what was approved, then on what will print. Both surfaces that draw
 * this pair must agree, or one order teaches a habit the other breaks.
 */
test("the approved proof is drawn before the panel, on both surfaces", () => {
  const card = readFileSync(
    new URL("../app/src/components/revisioniq/ProductionFlowLayersCard.tsx", import.meta.url),
    "utf8",
  );
  const board = readFileSync(
    new URL("../app/src/pages/designpro/PanelProStudioBoard.tsx", import.meta.url),
    "utf8",
  );

  // Production Layers: inside the two-column pair, the approved view comes
  // first in source order, which is what puts it in the left column.
  const pair = card.slice(card.indexOf('<div className={cn("grid gap-2", cols)}>'));
  const proofAt = pair.indexOf("Your approved design");
  const panelAt = pair.indexOf("url={panelUrl}");
  assert.ok(proofAt > -1 && panelAt > -1, "the pair must draw both halves");
  assert.ok(proofAt < panelAt, "the approved 3D proof must be the left column");

  // PanelPro Studio board: same order, same reason.
  const boardPair = board.slice(board.indexOf('<div className="grid gap-3 sm:grid-cols-2">'));
  const boardProofAt = boardPair.indexOf("Real design proof");
  const boardPanelAt = boardPair.indexOf("Panel with 5″ bleed");
  assert.ok(boardProofAt > -1 && boardPanelAt > -1);
  assert.ok(boardProofAt < boardPanelAt, "the board must draw the proof first too");

  // And the page actually routed at /designpro/jobs/:id/panelpro, which is the
  // third surface that draws this pair and the one the operator opens most.
  const routedBoard = readFileSync(
    new URL("../app/src/pages/AdminGeminiCompareStudio.tsx", import.meta.url),
    "utf8",
  );
  const routedPair = routedBoard.slice(
    routedBoard.indexOf('<div className="grid grid-cols-2 gap-3">'),
  );
  const routedProofAt = routedPair.indexOf("<span>Real design proof");
  const routedPanelAt = routedPair.indexOf("<span>Print Panel</span>");
  assert.ok(routedProofAt > -1 && routedPanelAt > -1);
  assert.ok(routedProofAt < routedPanelAt, "the routed board must draw the proof first too");

  // The trim overlay belongs to the panel, so it travels with it rather than
  // being positioned against a column that moved.
  assert.match(card, /overlay travels with the panel/);
});
