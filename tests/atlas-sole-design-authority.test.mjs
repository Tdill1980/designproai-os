/**
 * A.T.L.A.S. IS THE ONLY DESIGN AUTHORITY, AND NOTHING MAY RECONNECT A SECOND ONE.
 *
 * This is not a checklist of the migration. It is the condition that has to
 * stay true for the migration to still be finished tomorrow.
 *
 * The failure it exists to prevent is specific and has happened before: a
 * session reads that `design-panel-ai-generate` is the design brain, finds the
 * Edge function still sitting in `supabase/functions/`, and reconnects it --
 * or flips the Edge transport back on, or restores a browser-side render call,
 * or wires the dormant Design Master cluster into the runtime entrypoint.
 * Every one of those produces artwork that looks like a design and is bound to
 * no master, and none of them announces itself as a regression. The system
 * simply acquires a second producer and stops being able to say which one made
 * the panel that printed.
 *
 * So this pins two properties.
 *
 * ACTIVE PATH -- the A.T.L.A.S. chain is wired end to end in the server-native
 * runtime: request → worker → DesignIQ/A.C.E. → A.T.L.A.S. authoring → master
 * QC → deterministic surface extraction → server 3D proof provider → canonical
 * angles/studio/photorealism → proof QC → persistence → gateway.
 *
 * ZERO FALLBACK -- no new-generation path can reach the Edge provider, the two
 * historical Edge functions, the browser's legacy render module, or any
 * browser-side 3D-first producer.
 *
 * WHAT IS DELIBERATELY ALLOWED. The historical sources stay in the repository.
 * `supabase/functions/design-panel-ai-generate` and `generate-color-render`
 * are the parity references the runtime port was measured against, and
 * deleting them would destroy the only record of what the port had to match.
 * `designpanel-edge-provider.cjs` stays as an explicit operator rollback for
 * the STANDARD pipeline. What this test forbids is any of them becoming
 * reachable from a new A.T.L.A.S. generation.
 *
 * AND THE DORMANT CLUSTER. Fourteen Design Master modules ship in the release
 * and nothing requires them -- a complete parallel design architecture that is
 * not wired to `runtime/index.js`. That is the safe state and this test keeps
 * it: wiring one of them into the entrypoint's require graph would give the
 * system a second design authority, which is the exact thing A.T.L.A.S. being
 * canonical rules out.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const RUNTIME = resolve(import.meta.dirname, "..", "runtime");
const APP = resolve(import.meta.dirname, "..", "app", "src");

const read = (path) => readFileSync(path, "utf8");
const runtime = (name) => read(join(RUNTIME, name));

/**
 * Every module the runtime entrypoint actually pulls in, by walking `require`
 * from `runtime/index.js`. This is the difference between a file being shipped
 * and a file being part of the pipeline -- a distinction the filesystem cannot
 * make and the one that decides whether a second producer exists.
 */
function requireClosure() {
  const seen = new Set();
  const walk = (file) => {
    const rel = file.replace(`${RUNTIME}/`, "");
    if (seen.has(rel)) return;
    seen.add(rel);
    if (!existsSync(file)) return;
    for (const match of read(file).matchAll(/require\(\s*"(\.\/[^"]+)"\s*\)/g)) {
      walk(resolve(dirname(file), match[1]));
    }
  };
  walk(join(RUNTIME, "index.js"));
  return seen;
}

test("the A.T.L.A.S. design chain is wired end to end in the server-native runtime", () => {
  const loaded = requireClosure();
  const worker = runtime("generation-worker.cjs");
  const atlas = runtime("flat-first-atlas.cjs");
  const provider = runtime("designpanel-server-provider.cjs");

  // Every stage of the chain has to be a module the process actually loads.
  // A stage that is only present on disk is not a stage.
  for (const module of [
    "designiq-prompt.cjs",          // A.C.E. / DesignIQ creative intelligence
    "flat-first-atlas.cjs",         // A.T.L.A.S. authoring
    "atlas-field-territories.cjs",  // the six code-only territories the field is cut into (owner ruling 2026-09-02)
    "atlas-master-qc.cjs",          // master QC
    "atlas-cutout-fill.cjs",
    "atlas-proof-qc.cjs",           // proof QC
    "designpanel-server-provider.cjs", // server-native 3D proof provider
    "view-angles.cjs",              // canonical camera geometry
    "studio-os.cjs",                // studio lighting
    "photorealism-prompt.cjs",      // photography lock
    "generation-worker.cjs",        // orchestration
    "generation-engine.cjs",
    "generation-store.cjs",         // persistence
    "generation-provider.cjs",
    // `server-grid-slice.cjs` left this list on 2026-08-29. It was the
    // deterministic slicer Call 8/9 ran over the GEMINI-FLATTENED 3D PROOFS --
    // honest pixel math on a dishonest input. Call 1 cuts the six panels from
    // the accepted master, Call 8 composes them, Call 9 promotes them, so the
    // runtime entry has nothing left to slice. The module itself is untouched.
    "proof-sheet.cjs",              // deterministic Call-8 sheet assembly
    "call8-proof-material.cjs",     // the Call-8 material identity, no model
  ]) {
    assert.ok(loaded.has(module), `runtime/index.js must load ${module}`);
  }
  assert.match(atlas, /const manifest = buildFieldTerritories\(legacyManifest\)/,
    "Call 1 serializes ONE field onto the six code-only territories; no example image reaches the model");
  assert.doesNotMatch(atlas, /loadBundledAtlasTeachingProof/,
    "the labeled teaching proof is no longer a Call-1 input (owner ruling 2026-09-02)");

  // request → worker: the pipeline is chosen from the request's own contract,
  // not from an environment variable or a deploy-wide flag.
  assert.match(worker, /const isFlatFirst = flatFirstRequested\(claim\.input\)/);

  // worker → A.T.L.A.S. authoring → master QC.
  assert.match(worker, /flatAtlas = await generateOrReuseFlatAtlas\(\{/);
  assert.match(atlas, /require\("\.\/designiq-prompt\.cjs"\)/);
  assert.match(atlas, /require\("\.\/atlas-master-qc\.cjs"\)/);

  // accepted master → deterministic surface extraction. Pure geometry: the six
  // panels are cut, never re-authored.
  // The three positional arguments are the load-bearing part -- the repaired
  // sheet's bytes, the manifest, and the ACCEPTED master hash as lineage. The
  // call also takes per-panel callbacks now (the streaming graph publishes each
  // panel as it lands), so the assertion pins the arguments, not the closing
  // parenthesis.
  //
  // ⚠️ INVERTED 2026-08-31: this pinned `masterHash`, the PRE-repair sheet,
  // under the retired two-master model. After post-repair re-validation the
  // repaired bytes are the accepted canonical master, so the lineage argument
  // is `acceptedMasterHash` -- identical to `masterHash` whenever the fill
  // changed nothing.
  assert.match(atlas, /cutCallOnePanels\(surfaceSourceBytes, manifest, acceptedMasterHash[,)]/);
  assert.match(atlas, /async function cutCallOnePanels\(/);

  // → server-native 3D proof provider, conditioned on the canonical master's
  // own per-surface panel bytes as soon as that panel becomes durable.
  assert.match(worker, /atlasProviderFactory = createAtlasDesignPanelProvider/);
  assert.match(worker, /conditioningIdentityFor: \(view\) => viewAuthorityFor\(atlas, view\)/);
  assert.match(worker, /panelFor: \(view\) => atlasPanelForProofView\(atlas, view\)/);
  // The gate that makes "conditioned on the master" a fact rather than a claim.
  assert.match(atlas, /function viewAuthorityFor\(/);

  // → canonical angles, studio and photorealism, from the locked contracts.
  assert.match(provider, /require\("\.\/view-angles\.cjs"\)/);
  assert.match(provider, /require\("\.\/studio-os\.cjs"\)/);
  assert.match(provider, /require\("\.\/photorealism-prompt\.cjs"\)/);

  // → persistence, and the gateway serving it to both product surfaces.
  assert.match(worker, /createGenerationStore\(\{ supabase, workerId \}\)/);
  assert.match(runtime("generation-store.cjs"), /designpro_generation_views/);
  assert.match(
    read(resolve(import.meta.dirname, "..", "gateway", "src", "server.mjs")),
    /designpro_artifacts\?select=/,
  );
});

test("no new A.T.L.A.S. generation can reach a legacy or browser-side design producer", () => {
  const worker = runtime("generation-worker.cjs");

  // 1. THE EDGE PROVIDER IS UNREACHABLE ON THIS BRANCH.
  //
  // It stays in the tree as an explicit operator rollback for the STANDARD
  // pipeline, so its presence is not the violation. The violation would be the
  // A.T.L.A.S. branch acquiring a way to select it. Two things forbid that: the
  // standard provider is hardcoded null when the request is flat-first, and the
  // atlas factory has no environment switch at all.
  assert.match(worker, /const standardProvider = isFlatFirst \? null : standardProviderFactory\(\{/);
  assert.match(worker, /const atlasProvider = atlasProviderFactory\(\{/);
  const transportGate = worker.slice(
    worker.indexOf("function standardProviderFactoryFor"),
    worker.indexOf("function standardProviderFactoryFor") + 400,
  );
  assert.match(transportGate, /DESIGNPRO_STANDARD_TRANSPORT/);
  // The atlas factory's default must never become the edge provider.
  assert.match(worker, /atlasProviderFactory = createAtlasDesignPanelProvider/);
  assert.doesNotMatch(
    worker,
    /atlasProviderFactory\s*=\s*[^,\n]*[Ee]dge/,
    "the A.T.L.A.S. provider must never default to the Edge transport",
  );

  // 2. THE HISTORICAL EDGE FUNCTIONS ARE NOT SHIPPED TO THE RUNTIME.
  //
  // They remain in supabase/functions as parity references. The image copies
  // only runtime/, so the container physically cannot invoke them -- and that
  // is the property worth pinning, because a name can be reused as a stage
  // label (it is, inside the server provider) without any transport behind it.
  const dockerfile = read(resolve(import.meta.dirname, "..", "ops", "Dockerfile.runtime"));
  assert.doesNotMatch(dockerfile, /^COPY\s+supabase/m,
    "the runtime image must not ship the historical Edge functions");
  assert.match(dockerfile, /^COPY runtime\/ \.\/$/m);

  // No runtime module may invoke a Supabase Edge function for generation.
  for (const file of requireClosure()) {
    if (!file.endsWith(".cjs") && !file.endsWith(".js")) continue;
    const source = runtime(file);
    assert.doesNotMatch(
      source,
      /functions\.invoke\(/,
      `${file} must not call a Supabase Edge function`,
    );
  }

  // 3. THE BROWSER SUBMITS AND OBSERVES; IT NEVER PRODUCES.
  const api = read(join(APP, "lib", "designpro-api.ts"));
  for (const forbidden of [
    "design-panel-ai-generate",
    "generate-color-render",
    "legacyRenderFunctions",
    "functions.invoke",
  ]) {
    assert.ok(
      !api.includes(forbidden),
      `the browser gateway client must never reference ${forbidden}`,
    );
  }
  // The customer-path seam gate walks every routed surface's import closure for
  // the same names. Its route list is what makes that coverage real, so a
  // future session cannot quietly narrow it.
  const seam = read(resolve(import.meta.dirname, "designpro-customer-path-seam.test.mjs"));
  for (const route of [
    "pages/DesignPanelProPremium.tsx",
    "pages/RevisionStudioIQ.tsx",
    "pages/designpro/PanelProStudioBoard.tsx",
    "pages/AdminGeminiCompareStudio.tsx",
  ]) {
    assert.ok(seam.includes(route), `the seam gate must still cover ${route}`);
  }
  for (const fn of ["design-panel-ai-generate", "generate-color-render", "revise-render"]) {
    assert.ok(seam.includes(fn), `the seam gate must still forbid ${fn}`);
  }
});

test("the dormant Design Master cluster stays out of the active runtime", () => {
  // FOURTEEN MODULES SHIP AND NOTHING LOADS THEM.
  //
  // They are a complete parallel design architecture -- authoring, rendering,
  // revision, proof derivation, its own proof sheet and vehicle plates -- that
  // is not wired to runtime/index.js. Dormant is the correct state: A.T.L.A.S.
  // is the canonical and only design authority, and a second one reachable from
  // the entrypoint would mean the system could no longer say which producer
  // made the panel that printed.
  //
  // This is not a request to delete them. They are history, and history is
  // worth keeping. It is a fence: connecting one to the entrypoint has to be a
  // deliberate act that fails this test, not a quiet import somebody adds while
  // fixing something else.
  const loaded = requireClosure();
  for (const dormant of [
    "creative-authoring.cjs",
    "design-master.cjs",
    "design-master-author.cjs",
    "design-master-renderer.cjs",
    "design-master-revision.cjs",
    "design-revision-cycle.cjs",
    "designpro-master-cycle.cjs",
    "master-derived-3d-proof.cjs",
    "vehicle-proof-template.cjs",
    "vehicle-view-plate.cjs",
    "proof-band-fit.cjs",
    "master-proof-sheet.cjs",
    "procedural-view-plates.cjs",
    "mesh-warp.cjs",
    "opentype-outline.cjs",
  ]) {
    assert.ok(
      !loaded.has(dormant),
      `${dormant} is a dormant Design Master module and must not be wired into runtime/index.js — A.T.L.A.S. is the only design authority`,
    );
  }
});

/**
 * THE 2D PRODUCTION PROOF MAY NEVER GATE MANUFACTURING AGAIN.
 *
 * A.T.L.A.S. is the manufacturing authority: the accepted master is cut into
 * the six panels at Call 1, each bound to that master's hash at GENIE
 * dimensions with the five-inch bleed, and those panels are what prints. The 2D
 * Production Proof is drawn afterwards from the same lineage, as documentation
 * the customer signs.
 *
 * It sat second in the stage list, so it gated everything. The production
 * database showed what that cost: proof.build failed 8 of 11 attempts, and
 * because a failed stage stops the run, NOTHING downstream had ever executed --
 * no PanelPro gate, no enhancement, not one output file, no ZIP, no WrapBox
 * delivery, in the entire history of the system. A documentation artifact held
 * the whole manufacturing chain hostage, and source.verify demanded that same
 * artifact to certify the panels it documents, which is backwards.
 *
 * This pins both halves of the correction. A Call 8 failure on an A.T.L.A.S.
 * run is recorded and deferred, never fatal. And production source
 * completeness is the actual authority -- master, six panels, surface keys,
 * master binding, GENIE trim and print inches, exactly five inches of bleed,
 * byte integrity -- with the proof carried when present and never required.
 *
 * A run with no A.T.L.A.S. panel set still fails hard on both, because there
 * the proof genuinely is the source Call 9 cuts from.
 */
test("the 2D Production Proof never gates A.T.L.A.S. manufacturing", () => {
  const claimant = readFileSync(
    resolve(import.meta.dirname, "..", "runtime", "designpro-standalone-claimant.cjs"),
    "utf8",
  );

  // Call 8 defers rather than failing, and only for a run A.T.L.A.S. cut.
  assert.match(claimant, /const atlasPanels = await callOnePanelSet\(sb, run\)\.catch\(\(\) => null\)/);
  assert.match(claimant, /deferred: true/);
  assert.match(claimant, /productionAuthority: "atlas-master"/);
  // A lost lease is still a lease loss, not a deferred proof.
  assert.match(claimant, /error\?\.code === "stage_lease_lost" \|\| error\?\.retryable === true\) throw error/);
  // A run with no atlas panels still runs Call 8 fatally -- the call outside the
  // try/catch, so nothing defers it. (The argument list gained baseUrl/secret on
  // 2026-08-28: the extraction that created buildCall8Proof left them behind in
  // executeEntice's scope, so every entice run threw ReferenceError 200ms in and
  // the deferral recorded it as a proof-service outage. What this asserts is the
  // undeferred call, not the arity.)
  assert.match(claimant, /return buildCall8Proof\(sb, baseUrl, secret, run, stage, runtimeConfig, input\);/);

  // source.verify certifies the manufacturing authority, not the documentation.
  const verify = claimant.slice(claimant.indexOf('stage.stage_key === "source.verify"'));
  assert.match(verify, /const atlasRun = String\(call9\.receipt\?\.promotedFrom \|\| ""\) === "atlas-call1"/);
  for (const check of [
    "production_atlas_master_binding_invalid",   // one master behind all six
    "production_atlas_master_mismatch",          // and it is the accepted one
    "production_atlas_dimensions_missing",       // GENIE trim + print inches
    "production_atlas_bleed_invalid",            // exactly 5" on four edges
    "production_atlas_bleed_geometry_invalid",   // print == trim + 5" per edge
    "production_atlas_panel_changed",            // bytes still hash true
  ]) {
    assert.ok(verify.includes(check), `source.verify must enforce ${check}`);
  }
  // The proof is optional on an atlas run and carried when present.
  assert.match(verify, /const customerProof = sourceProofs\.find[\s\S]{0,90}\|\| null;/);
  assert.match(verify, /if \(customerProof\) \{/);
  assert.match(verify, /\} else if \(!customerProof \|\| sourceProofs\.length !== 1\) \{/);

  // And the seam still holds: manufacturing reads the snapshot, never the
  // generation-side tables, for the master it must verify against.
  assert.match(verify, /const snapshotPanels = await callOnePanelSet\(sb, run\);/);
  assert.doesNotMatch(claimant, /designpro_flat_atlas_revisions/);
});

/**
 * THE SIX CALL-1 PANELS HAVE TO CROSS THE SEAM, OR NOTHING DOWNSTREAM EXISTS.
 *
 * A.T.L.A.S. cuts the panels from the accepted master and records them on the
 * atlas revision row. Manufacturing may not read that row -- the frozen seam
 * makes the immutable revision snapshot its only interface -- so something has
 * to carry them over.
 *
 * Nothing did. Every revision snapshot in production had an empty
 * callOnePanels, so Call 9 never took its promotion path, source.verify never
 * saw an A.T.L.A.S. panel set, and the whole manufacturing chain sat unbuilt
 * behind a bridge that was never laid. The panels existed; the crossing did not.
 *
 * A partial set is deliberately treated as none. The snapshot is immutable, so
 * freezing four of six panels produces a revision that can never be repaired --
 * worse than one that falls back to the existing path.
 */
test("the six Call-1 panels reach the immutable revision snapshot", () => {
  const gateway = readFileSync(
    resolve(import.meta.dirname, "..", "gateway", "src", "server.mjs"),
    "utf8",
  );
  const claimant = readFileSync(
    resolve(import.meta.dirname, "..", "runtime", "designpro-standalone-claimant.cjs"),
    "utf8",
  );

  // The bridge exists and runs when a revision is frozen.
  assert.match(gateway, /async function atlasCallOnePanels\(/);
  assert.match(gateway, /const callOnePanels = await atlasCallOnePanels\(/);
  assert.match(gateway, /\.\.\.\(callOnePanels\.length \? \{ callOnePanels \} : \{\}\)/);

  // All six surfaces, each with a usable identity, or none at all.
  assert.match(gateway, /panels\.length !== CALL_ONE_SURFACES\.length\) return \[\]/);
  assert.match(gateway, /usable\.length !== CALL_ONE_SURFACES\.length\) return \[\]/);
  assert.match(gateway, /new Set\(usable\.map\(\(panel\) => panel\.surfaceKey\)\)\.size !== CALL_ONE_SURFACES\.length/);
  // An explicit snapshot set wins, so a replayed revision freezes the same panels.
  assert.match(gateway, /if \(Array\.isArray\(snapshot\?\.callOnePanels\) && snapshot\.callOnePanels\.length\)/);

  // And the far side reads exactly that field, from the snapshot alone.
  assert.match(claimant, /snapshot\?\.callOnePanels/);
  assert.match(claimant, /from\("designpro_revision_sources"\)/);
});
