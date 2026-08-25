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
    "flat-atlas-topology-examples.cjs",
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
    "server-grid-slice.cjs",        // deterministic surface extraction
  ]) {
    assert.ok(loaded.has(module), `runtime/index.js must load ${module}`);
  }

  // request → worker: the pipeline is chosen from the request's own contract,
  // not from an environment variable or a deploy-wide flag.
  assert.match(worker, /const isFlatFirst = flatFirstRequested\(claim\.input\)/);

  // worker → A.T.L.A.S. authoring → master QC.
  assert.match(worker, /flatAtlas = await generateOrReuseFlatAtlas\(\{/);
  assert.match(atlas, /require\("\.\/designiq-prompt\.cjs"\)/);
  assert.match(atlas, /require\("\.\/atlas-master-qc\.cjs"\)/);

  // accepted master → deterministic surface extraction. Pure geometry: the six
  // panels are cut, never re-authored.
  assert.match(atlas, /const callOnePanels = await cutCallOnePanels\(/);
  assert.match(atlas, /async function cutCallOnePanels\(/);

  // → server-native 3D proof provider, conditioned on the master's own bytes.
  assert.match(worker, /atlasProviderFactory = createAtlasDesignPanelProvider/);
  assert.match(worker, /conditioningIdentityFor: \(sourceViewType\) => viewAuthorityFor\(flatAtlas, sourceViewType\)/);
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
  assert.match(worker, /const atlasProvider = isFlatFirst \? atlasProviderFactory\(\{/);
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
