import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const studio = readFileSync(
  new URL("../app/src/components/revisioniq/ServerRevisionStudio.tsx", import.meta.url),
  "utf8",
);
const initialDesignPage = readFileSync(
  new URL("../app/src/pages/DesignPanelProPremium.tsx", import.meta.url),
  "utf8",
);
const panelStudio = readFileSync(
  new URL("../app/src/pages/DesignProStudio.tsx", import.meta.url),
  "utf8",
);

test("RevisionStudio exposes the complete verified review workspace", () => {
  assert.match(studio, /RevisionStudioIQ/);
  assert.match(studio, /listApprovedViews\(generationId\)/);
  assert.match(studio, /selectCustomerProof\(artifacts\)/);
  assert.match(studio, /value="approved"/);
  assert.match(studio, /value="proof"/);
  assert.match(studio, /value="layers"/);
  assert.match(studio, /ROLE_ORDER\.map/);
  assert.match(studio, /trimWidthInches/);
  assert.match(studio, /printHeightInches/);
  assert.match(studio, /ProductionFlowLayersCard/);
});

test("Call 8 is viewable immediately after the seven generated views", () => {
  assert.match(initialDesignPage, /displayedAllViews\.length >= requiredViewCount/);
  assert.match(initialDesignPage, /8 · 2D Proof/);
  assert.match(initialDesignPage, /8 · 2D Production Proof/);
  assert.match(initialDesignPage, /proofToShow/);
});

test("PanelProStudio is backed by the same server artifacts", () => {
  assert.match(studio, /Entice logo assets/);
  assert.match(studio, /Open in PanelProStudio/);
  assert.match(panelStudio, /dpApi\.listArtifacts\(generationId\)/);
  assert.match(panelStudio, /dpApi\.listApprovedViews\(generationId\)/);
  assert.match(panelStudio, /artifact\.kind === "panel"/);
  assert.match(panelStudio, /artifact\.kind === "logo"/);
  assert.match(panelStudio, /Server production panel/);
});

test("a revision starts a new current A.T.L.A.S. run, never the obsolete manual source form", () => {
  assert.match(studio, /Start new A\.T\.L\.A\.S\. design/);
  assert.match(studio, /new current-architecture A\.T\.L\.A\.S\. run/);
  assert.doesNotMatch(studio, /\/designpro\/revisions\/new\?source=/);
});

// THE CUSTOMER-FACING EDITOR IS MOUNTED, NOT MERELY IMPORTED.
//
// LayerLiftRevisionStudio sat imported-but-unrendered here: the viewport had
// been replaced with a plain <img> when LayerLiftIQ was ripped out of the render
// tree over the pink transform handles it painted over the design. The import
// surviving is exactly why that looked wired. These assert the mount, and the
// gate that made restoring it safe.
test("The intended RevisionStudio editor renders in the customer design flow", () => {
  const canvas = readFileSync(
    new URL("../app/src/components/LayerLiftCanvas.tsx", import.meta.url),
    "utf8",
  );

  assert.match(initialDesignPage, /<LayerLiftRevisionStudio/, "the editor must be mounted, not just imported");
  assert.doesNotMatch(initialDesignPage, /LAYERLIFT UI REMOVED/);

  // The floor is the server's approved view. Flooring on the plaid-inpainted
  // scrub is the documented smear, and it must never come back as the base.
  assert.match(initialDesignPage, /backgroundUrl=\{effectiveDisplayUrl\}/);
  assert.doesNotMatch(initialDesignPage, /backgroundUrl=\{scrubbedBg\}/);

  // Only the customer's own verified upload rides on top, so the brand mark has
  // exactly one source and cannot double against the authored render.
  assert.match(initialDesignPage, /initialOverlays=\{uploadedOverlays\}/);

  // Editing is opt-in. While it is off the canvas is a viewer.
  assert.match(initialDesignPage, /tools=\{revising\}/);
  assert.match(initialDesignPage, /Revise with LayerLiftIQ/);
  assert.match(initialDesignPage, /Layer Stack/);

  // THE FIX THAT REPLACED THE REMOVAL. Selection, the Transformer and drag are
  // all gated on toolsActive; keyed off `tool === "select"` alone they fired on
  // a viewer-mode canvas and painted #d946ef handles over the render.
  assert.match(canvas, /if \(!toolsActive \|\| tool !== "select" \|\| autoSelectedRef\.current\) return;/);
  assert.match(canvas, /if \(toolsActive && selectedId && tool === "select"\)/);
  assert.match(canvas, /draggable=\{toolsActive && tool === "select"\}/);

  // The editor observes and repositions. It never starts a design producer.
  assert.doesNotMatch(
    initialDesignPage,
    /<LayerLiftRevisionStudio[\s\S]{0,1200}?onPromptAt=/,
    "the restored viewport must not carry an AI fill hook",
  );
});

// SIX-ONE AND SIX-TWO ARE DIFFERENT SURFACES AND MUST STAY NAMED APART.
//
// The branded editor (DesignProStudio, /panel-studio) composes; the production
// board (PanelProStudioBoard, /panelpro) validates and holds the human preflight
// gate. RevisionStudio carried ONE button labelled "Open in PanelProStudio" that
// opened the editor, and no route to the board at all — so the board's name led
// to the surface that cannot approve anything.
test("The branded panel editor and the PanelPro production board stay distinct", () => {
  const board = readFileSync(
    new URL("../app/src/pages/designpro/PanelProStudioBoard.tsx", import.meta.url),
    "utf8",
  );
  const routes = readFileSync(new URL("../app/src/App.tsx", import.meta.url), "utf8");

  // Each canonical route resolves to its own component.
  //
  // THE PANELPRO ROUTE IS THE ADMIN STUDIO. The full production workspace was
  // routed at /designpro/studio-board -- a URL nobody asked for -- while
  // /panelpro, the URL the design team actually opens, kept the per-surface
  // validator. The workspace was therefore deployed and unreachable in
  // practice, which is indistinguishable from not having built it.
  //
  // The validator is not lost; it has its own path one level down. What this
  // still pins is the thing it always pinned: three distinct surfaces, each on
  // its own route, none of them standing in for another.
  assert.match(routes, /path="\/designpro\/jobs\/:generationId\/panel-studio"[\s\S]{0,120}<DesignProStudio \/>/);
  assert.match(routes, /path="\/designpro\/jobs\/:generationId\/panelpro"[\s\S]{0,160}<AdminGeminiCompareStudio \/>/);
  assert.match(routes, /path="\/designpro\/jobs\/:generationId\/panelpro\/surfaces"[\s\S]{0,120}<PanelProStudioBoard \/>/);
  // And the Admin Studio opens the job the URL names, rather than a search box.
  const adminStudio = readFileSync(
    new URL("../app/src/pages/AdminGeminiCompareStudio.tsx", import.meta.url),
    "utf8",
  );
  assert.match(adminStudio, /const \{ generationId: routeGenerationId \} = useParams\(\);/);
  assert.match(adminStudio, /loadJob\(String\(routeGenerationId\)\)/);
  // AND IT RE-READS THE SERVER WHILE THE RUN IS STILL LIVE.
  //
  // The loader used to bail out whenever a job was already in state, so a route
  // change reused the previous generation and a run still authoring its master
  // rendered once -- empty -- and never updated. Progressive publication (RULE
  // 0.23) means panels and proofs land one at a time, so a board that reads once
  // shows a permanently blank job and cannot be told apart from a stale one.
  assert.doesNotMatch(adminStudio, /if \(job\) return;/,
    "the board must not skip the server read because it already holds a job");
  assert.match(adminStudio, /setTimeout\([\s\S]{0,80}poll\(\)/,
    "the board must keep re-reading the server while the run is unsettled");
  assert.match(adminStudio, /\["complete", "failed", "cancelled"\]\.includes\(state\)/,
    "polling must stop only at a terminal state");

  // Both routes are reachable from RevisionStudio, each under its own name.
  assert.match(studio, /panel-studio`\}>Open in DesignPro Studio</);
  assert.match(studio, /panelpro`\}>Open PanelPro Studio board</);
  assert.doesNotMatch(studio, /Open in PanelProStudio</, "the editor must not carry the board's name");

  // The editor reaches its production counterpart directly.
  assert.match(panelStudio, /to=\{`\/designpro\/jobs\/\$\{generationId\}\/panelpro`\}/);

  // Both bind the same generation and read the same server-owned artifacts.
  for (const source of [panelStudio, board]) {
    assert.match(source, /const \{ generationId = "" \} = useParams\(\);/);
    assert.match(source, /dpApi\.listArtifacts\(generationId\)/);
  }

  // The board validates. It is never a second panel producer.
  assert.doesNotMatch(board, /dpApi\.(regenerateView|createGenerationRequest|handoffGeneration)/);
  assert.match(board, /dpApi\.approvePreflight\(/);
});

// A PROOF AND ITS PANEL MUST BE THE SAME DESIGN, AND THE BOARD MUST SAY SO.
//
// A.T.L.A.S. authors one flattened master; the six panels are deterministic
// extractions of it and each proof is conditioned on that same surface's region.
// The runtime enforces the proof half -- viewAuthorityFor throws unless the
// authority's sourceMasterHash equals the master's contentHash. But the two
// halves of a side card arrive from different endpoints, and nothing compared
// them at the pairing: a panel cut from a different master, or an earlier
// revision, would sit beside its proof looking normal.
//
// Both sides already publish the binding, so the check is a comparison. This is
// the acceptance rule stated as a test: same generationId, same surfaceKey, same
// A.T.L.A.S. parent hash -- or the side cannot be approved.
test("PanelPro pairs a proof with a panel only when they share one master", () => {
  const board = readFileSync(
    new URL("../app/src/pages/designpro/PanelProStudioBoard.tsx", import.meta.url),
    "utf8",
  );

  // Both bindings are read, from the fields the server actually publishes.
  assert.match(board, /view\?\.atlasBinding\?\.masterContentHash/);
  assert.match(board, /panel\?\.metadata\?\.sourceMasterHash/);
  assert.match(board, /lineageMatches\s*=\s*lineageKnown && proofMaster === panelMaster/);

  // A real disagreement is named, and an absent binding is not called drift.
  assert.match(board, /DIFFERENT MASTERS/);
  assert.match(board, /No master binding on this pair/);

  // And it is a gate, not a label: this approval releases artwork to print.
  assert.match(board, /disabled=\{!panel \|\| \(lineageKnown && !lineageMatches\)\}/);

  // The board stays a validator: no browser-era panel GENERATION. The server
  // already holds the panel bytes cut from the accepted master, so a control
  // that makes a panel in the browser is a second producer.
  //
  // "Upload panel" is deliberately NOT on this list. A designer who checks a
  // panel against the real vehicle template and finds it does not fit must be
  // able to correct it and upload the corrected production artifact back into
  // the same surface/revision lineage. That is an authorized human production
  // correction with an audit trail, not a second AI producer, and forbidding it
  // would strip a required production function -- which an earlier version of
  // this very test did.
  //
  // Checked against CODE lines only. The file's own header names the generation
  // controls while explaining that it deliberately does not carry them, and a
  // gate that cannot tell a comment from a button would forbid documenting the
  // decision.
  const boardCode = board
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*");
    })
    .join("\n");
  for (const generationControl of ["Pull panel", "Mirror from driver"]) {
    assert.ok(
      !boardCode.includes(generationControl),
      `PanelPro must not reintroduce browser-era panel generation: ${generationControl}`,
    );
  }
  assert.match(board, /The server produces this panel at Call 9\. It is never hand-built here\./);
});

test("the canonical RevisionStudio is the routed one, and it produces nothing", () => {
  const routes = readFileSync(new URL("../app/src/App.tsx", import.meta.url), "utf8");

  // THE PRODUCT PAGE, NOT A STATUS PAGE. /revision-studio redirected to the job
  // list for as long as RevisionStudioIQ's data layer still read RestylePro
  // tables, which is how a server-artifact viewer came to stand in for the
  // product editor. The route is the proof that it does not any more.
  assert.match(
    routes,
    /<Route path="\/revision-studio" element=\{<RequireAuth><RevisionStudioIQ \/><\/RequireAuth>\} \/>/,
    "/revision-studio must render the migrated RevisionStudioIQ",
  );

  const page = readFileSync(
    new URL("../app/src/pages/RevisionStudioIQ.tsx", import.meta.url),
    "utf8",
  );
  const code = page
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*");
    })
    .join("\n");

  // Its data comes from the server-owned adapters and nowhere else.
  assert.match(code, /from "@\/lib\/revisionstudio-source"/);
  assert.match(code, /from "@\/lib\/revisionstudio-flow"/);

  // THE BROWSER STOPPED PRODUCING. Every one of these was a generative call
  // this page made against a 3D proof and wrote back as the new design. Under
  // A.T.L.A.S. a proof is a projection of the accepted master, so repainting one
  // cannot change the design -- it can only leave that view disagreeing with the
  // master the six print panels were cut from.
  for (const producer of [
    "revise-render",
    "edit-vehicle-photo",
    "design-panel-ai-generate",
    "generate-color-render",
    "extract-logo-elements",
    "layerlift-engine",
  ]) {
    assert.ok(
      !code.includes(`"${producer}"`) && !code.includes(`'${producer}'`),
      `RevisionStudio must not call ${producer} from the browser`,
    );
  }

  // A revision is authored by A.T.L.A.S. against the same design lineage, and
  // the previous version is preserved rather than overwritten.
  assert.match(code, /submitDesignRevision/);
});

test("a corrected panel is recorded against what it corrects, and never replaces it", () => {
  const migration = readFileSync(
    new URL("../supabase/migrations/20260825000000_designpro_panelpro_corrected_panels.sql", import.meta.url),
    "utf8",
  );

  // Its own kind, so the branded Call 9 set stays exactly six "panel" rows and
  // source.verify's exactly-six-distinct assertion is untouched.
  assert.match(migration, /'flat-proof','panel','qc-panel','corrected-panel','upscaled-panel'/);

  // Bound to the panel it corrects, with a reason, by a named human, at a time.
  for (const field of ["correctedFromPath", "correctedFromHash", "sourceMasterHash", "correctedBy", "correctedAt", "'reason', v_reason"]) {
    assert.ok(migration.includes(field), `a correction must record ${field}`);
  }
  // A correction with nothing to correct is refused rather than admitted as an
  // unattributed image entering the production set.
  assert.match(migration, /corrected_panel_source_missing/);
  assert.match(migration, /corrected_panel_reason_required/);
  // And it is additive: re-uploading the same bytes is the same correction.
  assert.match(migration, /ON CONFLICT \(run_id, artifact_kind, surface_key, content_hash\) DO NOTHING/);

  const claimant = readFileSync(
    new URL("../runtime/designpro-standalone-claimant.cjs", import.meta.url),
    "utf8",
  );
  // CALL 12 ENHANCES THE ACTIVE ARTIFACT. Enhancing the panel the team rejected
  // while the correction sat unused in the vault would make the human QC gate
  // decorative -- it would pass, and the wrong artwork would print.
  assert.match(claimant, /const corrections = await artifacts\(sb, run\.id, \["corrected-panel"\]\)/);
  assert.match(claimant, /humanCorrectedSurfaces: correctedSurfaces/);
  // The branded panel set is still what the six-distinct check reads.
  assert.match(claimant, /const brandedPanels = await artifacts\(sb, run\.id, \["panel"\]\)/);
  assert.match(claimant, /brandedPanelHash: activeSource\.brandedPanel\.content_hash/);

  const board = readFileSync(
    new URL("../app/src/pages/designpro/PanelProStudioBoard.tsx", import.meta.url),
    "utf8",
  );
  // The board offers the correction, keeps the original downloadable beside it,
  // and shows the whole history rather than only the active file.
  assert.match(board, /Upload corrected panel/);
  assert.match(board, /Download corrected panel/);
  assert.match(board, /Correction history/);
  assert.match(board, /uploadCorrectedPanel/);
});

test("the customer is asked before six more proofs are rendered", () => {
  const page = readFileSync(
    new URL("../app/src/pages/DesignPanelProPremium.tsx", import.meta.url),
    "utf8",
  );
  // A.T.L.A.S. renders Driver first and hash-verifies it before projecting the
  // other six, so the customer sees a real look at their design about a minute
  // before the set finishes. The question belongs at that moment: making them
  // wait out six proofs before they can say "change it" spends six renders on a
  // design they have already rejected.
  assert.match(page, /Do you want to see all sides of this design, or revise it\?/);
  assert.match(page, /See All Views/);
  // Renamed by the owner on 2026-08-29; the decision point the rule protects is
  // unchanged, only its wording.
  assert.match(page, /Open in RevisionStudio/);
  // ⛔ THIS LOCK USED TO ASSERT `navigate("/revision-studio")` -- THE DEFECT.
  //
  // A bare `/revision-studio` opens the design LIBRARY, not the design the
  // customer just generated, so the one moment the app held the id was exactly
  // where it discarded it and the owner had to find her own job by eye. The
  // destination was right, which is why it read as correct for weeks; only the
  // identity was missing. The lock now requires the identity to travel.
  assert.match(page, /\/revision-studio\?id=\$\{encodeURIComponent\(id\)\}/);
  assert.doesNotMatch(page, /navigate\("\/revision-studio"\)/);
});

/**
 * RUN UPSCALE IS THE PRODUCTION UPSCALE, NOT A STAND-IN FOR IT.
 *
 * The whole value of an admin-triggered enhancement is that it exercises the
 * real path before anyone trusts it to run unattended. A button that resized an
 * image in the browser, or called a second enhancement written for testing,
 * would prove nothing and would quietly become a second producer of production
 * artwork -- so this pins the one property that makes it worth having: the
 * admin route calls the same `enhancePanel` from topaz-upscale.cjs that Call 12
 * calls, behind the same readiness gate.
 *
 * And it pins the two rules the source has to keep. The active artifact is the
 * newest human correction when one exists and the branded Call 9 panel
 * otherwise -- the same rule Call 12 enhances by, because enhancing the panel
 * the team rejected would make their QC decorative. The source is read,
 * hash-verified and left alone; the enhancement is a NEW artifact at its own
 * material-addressed path.
 */
test("RUN UPSCALE invokes the production enhancement and never overwrites its source", () => {
  const runtime = readFileSync(new URL("../runtime/index.js", import.meta.url), "utf8");
  const gateway = readFileSync(new URL("../gateway/src/server.mjs", import.meta.url), "utf8");
  const api = readFileSync(new URL("../app/src/lib/designpro-api.ts", import.meta.url), "utf8");
  const board = readFileSync(
    new URL("../app/src/pages/designpro/PanelProStudioBoard.tsx", import.meta.url),
    "utf8",
  );

  // The real implementation, from the module Call 12 uses, behind its own gate.
  assert.match(runtime, /require\("\.\/topaz-upscale\.cjs"\)/);
  assert.match(runtime, /app\.post\("\/internal\/panels\/upscale", authMiddleware/);
  assert.match(runtime, /await enhancePanel\(\{/);
  assert.match(runtime, /topazReadiness\(process\.env\)/);
  // Same target geometry as Call 12: trim plus the 5" bleed at 150 PPI.
  assert.match(runtime, /\(trimWidthIn \+ 10\) \* 150/);
  assert.match(runtime, /\(trimHeightIn \+ 10\) \* 150/);
  // The active artifact, by Call 12's rule.
  assert.match(runtime, /\.in\("artifact_kind", \["panel", "corrected-panel"\]\)/);
  assert.match(runtime, /artifact_kind === "corrected-panel"\) \|\| branded/);
  // Read, verified, and left where it is. The derivative is its own row.
  assert.match(runtime, /panel_upscale_source_changed/);
  assert.match(runtime, /artifact_kind: "upscaled-panel"/);
  assert.match(runtime, /sourcePanelHash: source\.content_hash/);
  assert.match(runtime, /adminTriggered: true/);
  assert.doesNotMatch(runtime, /upsert:\s*true/,
    "an enhancement must never overwrite an object");

  // The browser holds no service role, so the write travels the internal
  // channel with the caller's own id as the owner fence.
  assert.match(gateway, /upscalePanelThroughRuntime/);
  assert.match(gateway, /\/internal\/panels\/upscale/);
  assert.match(gateway, /cfg\.workerSecret\.length < 32/);
  assert.match(gateway, /panels\\\/\(\[a-z\]\{4,9\}\)\\\/upscale/);

  assert.match(api, /runPanelUpscale/);
  assert.match(board, /dpApi\.runPanelUpscale/);
  // The four figures the team reads before deciding a panel needs enhancing.
  for (const label of ["Source resolution", "Final physical size", "Effective DPI", "Upscale status"]) {
    assert.ok(board.includes(label), `the board must show ${label}`);
  }
  assert.match(board, /Run upscale/);
  assert.match(board, /Download upscaled/);
  // Original and derivative together, and a stale one readable as stale.
  assert.match(board, /Upscale stale/);
  assert.match(board, /Upscaled derivative/);
});

/**
 * ONE VERSION HISTORY, READ BY BOTH SURFACES.
 *
 * RevisionStudio is the revision workspace and PanelPro is the production
 * record, and they are looking at the same job -- so V2 has to mean the same
 * thing on both. It did not. RevisionStudio read `design_version_commits`, a
 * separate table with its own version_number, its own prompt column and a
 * browser-side writer; PanelPro read the server's A.T.L.A.S. revision lineage.
 * Two histories of one job, numbered independently: a revision made in
 * RevisionStudio had no reason to appear in PanelPro at all, and V2 in one was
 * not necessarily V2 in the other.
 *
 * This pins the property that fixes it: exactly one reader, whose numbering is
 * the server's own revision sequence and whose prompt text is the customer's
 * words verbatim. A surface that reads revisions another way is the drift.
 */
test("RevisionStudio and PanelPro read one canonical version and prompt history", () => {
  const history = readFileSync(new URL("../app/src/lib/design-version-history.ts", import.meta.url), "utf8");
  const revisionSource = readFileSync(new URL("../app/src/lib/revisionstudio-source.ts", import.meta.url), "utf8");
  const panelSource = readFileSync(new URL("../app/src/lib/panelpro-studio-source.ts", import.meta.url), "utf8");
  const studio = readFileSync(new URL("../app/src/pages/RevisionStudioIQ.tsx", import.meta.url), "utf8");
  const board = readFileSync(
    new URL("../app/src/pages/designpro/PanelProStudioBoard.tsx", import.meta.url),
    "utf8",
  );

  // The version number is the server's revision sequence, never recomputed.
  assert.match(history, /version:\s*revision\.revisionSequence/);
  // V1's words are the run's brief; a later version's are its own instruction.
  assert.match(history, /isOriginal \? \(brief \|\| instruction \|\| null\) : \(instruction \|\| null\)/);
  // Membership in a version is the master hash, not a timestamp guess.
  assert.match(history, /artifactMaster\(artifact\) === master/);
  assert.match(history, /viewMaster\(view\) === master/);
  // The A.T.L.A.S. master is admin-only and must not reach the customer
  // timeline's "View master artboard" link.
  assert.match(history, /master_artboard_url: null/);

  // Both surfaces call the one reader.
  assert.match(revisionSource, /loadDesignVersionHistory/);
  assert.match(panelSource, /designVersionsFrom\(\{/);
  assert.match(studio, /revisionStudioVersionCommits/);
  assert.match(board, /designVersionsFrom\(\{/);

  // And neither reaches the second store any more.
  assert.doesNotMatch(studio, /getVersionCommits/,
    "RevisionStudio must not read the separate design_version_commits history");

  // Selecting a version switches the whole PanelPro workspace to that
  // revision's assets, which is the only thing that makes a version switchable.
  assert.match(board, /assetsForVersion\(selectedVersion, allArtifacts, allViews\)/);
  // The prompt is shown verbatim on both, and labelled for which kind it is.
  assert.match(board, /selectedVersion\.promptKind === "original-brief"/);
  assert.match(board, /whitespace-pre-wrap/);
  assert.match(studio, /presentation\.revisionNotes/);
});

test("PanelPro indexes generations so every accepted A.T.L.A.S. is discoverable before purchase", () => {
  const panelSource = readFileSync(
    new URL("../app/src/lib/panelpro-studio-source.ts", import.meta.url),
    "utf8",
  );
  const list = panelSource.slice(
    panelSource.indexOf("export async function listPanelProStudioJobs"),
    panelSource.indexOf("export async function findPanelProStudioJob"),
  );
  assert.match(list, /dpApi\.listDesignLibrary\(\)/);
  assert.match(list, /design\.state === "outputs_ready"[\s\S]{0,80}\? "complete"/,
    "a fully persisted A.T.L.A.S. must display as complete in PanelPro");
  assert.doesNotMatch(list, /dpApi\.listJobs\(\)/,
    "a production-run index hides A.T.L.A.S. until purchase/handoff");
  assert.match(list, /design\.generationId/);
  assert.match(list, /design\.designId/);
  assert.match(list, /design\.production\?\.orderNumber \|\| ""/,
    "order identity is allowed to remain unbound before purchase");
  assert.match(panelSource, /dpApi\.getStatus\(id\)/,
    "a generation selected from the index must open through the pre-handoff status projection");
  assert.match(panelSource, /dpApi\.listJobFlatAtlasRevisions\(job\.generationId\)/,
    "PanelPro must load the A.T.L.A.S. master and history by Generation ID");
});

/**
 * THE PANELPRO ADMIN STUDIO IS A COMPLETE PRODUCTION RECORD, OR IT IS DECORATION.
 *
 * A board that shows six panels and a QC button looks finished and is not. The
 * design team cannot release an order from it without the brand assets they
 * have to hand a printer, a per-surface verdict they can read at a glance, and
 * a record of what happened to the order and who caused it. This pins those
 * three, plus the two properties that make the rest safe: the release gate and
 * the checklist compute PASS with ONE function, and the print files are built
 * from the artifact the team actually approved.
 */
test("the PanelPro Admin Studio carries logos, per-surface verdicts, and an audit trail", () => {
  const studio = readFileSync(new URL("../app/src/pages/AdminGeminiCompareStudio.tsx", import.meta.url), "utf8");
  const claimant = readFileSync(
    new URL("../runtime/designpro-standalone-claimant.cjs", import.meta.url),
    "utf8",
  );
  const gateway = readFileSync(new URL("../gateway/src/server.mjs", import.meta.url), "utf8");

  // 1. Extracted logos, per version, individually downloadable.
  assert.match(studio, /function LogoGallery/);
  assert.match(studio, /Extracted logos &amp; brand assets/);
  // A brand asset from another version is reported, never shown as this one's.
  assert.match(studio, /unattributed/);
  // Call 10 has to carry the master forward or nothing can attribute a logo.
  assert.match(claimant, /sourceMasterHash: masterBySurface\.get\(targetSurfaceKey\)/);

  // 2. The human checklist, per surface, PERSISTED AGAINST ONE EXACT FILE.
  //
  // It used to be React state: a reload erased it, a second person could not
  // see it, and the release receipt recorded six ticked boxes with nothing
  // about what was looked at. The row is keyed by the panel's content hash, so
  // a corrected panel -- different bytes, different hash, no row -- starts an
  // empty checklist and cannot inherit the replaced file's approval. That is a
  // property of the key, not of reset logic somebody has to remember to call.
  assert.match(studio, /function SurfaceQcPanel/);
  assert.match(studio, /NEEDS CORRECTION/);
  assert.match(studio, /dpApi\.recordSurfaceQc/);
  assert.match(studio, /dpApi\.listSurfaceQc/);
  assert.match(studio, /records\[`\$\{surfaceKey\}:\$\{hash\}`\]/);
  // APPROVE SURFACE needs the checklist AND the identity facts: the panel must
  // belong to the selected A.T.L.A.S. version and share a master with its proof.
  // The button reflects that; the SERVER re-proves it from the artifacts, so a
  // caller that skips the browser gets the same refusal.
  assert.match(studio, /disabled=\{!row\.approvable \|\| busy === id\}/);
  assert.match(studio, /row\.evidence\?\.derived\.version === true/);
  assert.match(studio, /row\.evidence\?\.derived\.lineage === true/);
  assert.match(gateway, /surface_qc_incomplete/);
  // The identity proof must actually RUN on an approval, not merely exist in
  // the file: this pins the guard that arms it.
  assert.match(
    gateway,
    /let verifiedLineage = \{ atlasMasterHash: null, artifactId: null \};\s*\n\s*if \(approved\) \{/,
  );
  assert.match(gateway, /surface_qc_stale_artifact/);
  assert.match(gateway, /surface_qc_atlas_version_mismatch/);
  assert.match(gateway, /surface_qc_lineage_mismatch/);
  // The identity an approval is STORED under is the one the server proved,
  // never the one the caller sent.
  assert.match(gateway, /p_atlas_master_hash: verifiedLineage\.atlasMasterHash/);
  // Effective DPI is NOT a surface-approval blocker: upscale runs after the
  // preflight gate, so gating approval on print resolution would deadlock the
  // workflow. It is enforced where it can be satisfied -- every enhanced panel
  // is conformed to the GENIE print target at 150 PPI and geometry drift throws.
  assert.doesNotMatch(gateway, /surface_qc_dpi/);
  assert.match(claimant, /const targetWidthPx = Math\.round\(\(Number\(dims\.widthInches\) \+ 10\) \* 150\)/);
  assert.match(claimant, /enhance_winner_geometry_drift/);
  assert.match(gateway, /SURFACE_QC_CHECKLIST\.map\(\(key\) => \[key, claimed\[key\] === true\]\)/);
  // The thirteen are one list, shared by the board and the gateway.
  for (const check of [
    "template", "surface", "version", "fit", "safeArea", "openings", "trimDims",
    "printDims", "bleed", "dpi", "customerText", "artworkIntact", "finalFileInspected",
  ]) {
    assert.match(gateway, new RegExp(`"${check}"`), `gateway lost the ${check} check`);
  }
  // The machine checks stay evidence, never a tick: they are computed from the
  // artifacts and are deliberately absent from the checklist a person fills in.
  assert.match(studio, /function surfaceQcVerdicts/);
  assert.match(studio, /MACHINE EVIDENCE ONLY/);
  // A surface counts as passed only while the SERVER holds an approval for the
  // file that is active right now.
  assert.match(studio, /surfaceQcRecords\[`\$\{surfaceKey\}:\$\{hash\}`\]\?\.approved/);
  // And an unresolved surface blocks release.
  assert.match(studio, /qcOutstanding\.length === 0/);

  // 3. Activity and audit history, from the server's record.
  assert.match(studio, /function ActivityHistory/);
  assert.match(studio, /Activity &amp; audit history/);
  assert.match(studio, /panel corrected/);
  assert.match(studio, /adminTriggered === true \? "design team" : "server"/);

  // 4. Version switching reaches the six-surface workspace, not just the badge.
  assert.match(studio, /const source = versionedJob \|\| job;/);
  assert.match(studio, /\(versionedJob \|\| job\)\?\.concept_json\?\.qc_side_panels/);

  // 6. Print files come from the enhanced ACTIVE panel, which the runtime
  // enforces: output.build reads upscaled-panel and nothing else.
  assert.match(claimant, /const panels = await artifacts\(sb, run\.id, \["upscaled-panel"\]\)/);
  assert.match(claimant, /enhanced_panel_receipt_mismatch/);
  // The per-surface row still distinguishes a human correction from the branded
  // panel — the labels moved onto the download links themselves (2026-08-27),
  // so assert the distinction rather than one rendering of it.
  assert.match(studio, /correction \? "corrected" : "branded"/);
  assert.match(studio, /correction \? "Corrected panel" : "Source panel"/);
});

/**
 * TRIM AND BLEED ARE THE SAME ARTIFACT, SHOWN TWO WAYS.
 *
 * The production contract asks for `PANEL WITH 5" BLEED` and `PANEL WITHOUT
 * BLEED / TRIM`, and the tempting way to deliver the second is to cut a new
 * image -- which would put a panel producer back in the browser, bound to
 * nothing, indistinguishable on screen from the one Call 9 cut.
 *
 * There is no need. The panel already IS trim plus exactly 5 inches on every
 * edge, so the trim view is that same artifact displayed without its margin,
 * and the bleed view draws the cut line on top of it. What the installer cuts
 * to becomes visible instead of imagined, and no file is created.
 *
 * The inset comes from the panel's own stamped inches. When the panel does not
 * state both, no cut line is drawn -- a guessed inset would put the line in the
 * wrong place, and a wrong cut line is worse than none.
 */
test("the panel shows its trim and its bleed without producing a second file", () => {
  const board = readFileSync(
    new URL("../app/src/pages/designpro/PanelProStudioBoard.tsx", import.meta.url),
    "utf8",
  );
  assert.match(board, /Panel with 5″ bleed/);
  assert.match(board, /Panel · trim, no bleed/);
  assert.match(board, /Show trim/);
  assert.match(board, /Show bleed/);
  // The inset is derived from the artifact's own geometry, both axes.
  assert.match(board, /geometry\.printWidthIn - geometry\.trimWidthIn\) \/ 2 \/ geometry\.printWidthIn/);
  assert.match(board, /geometry\.printHeightIn - geometry\.trimHeightIn\) \/ 2 \/ geometry\.printHeightIn/);
  // No geometry, no cut line.
  assert.match(board, /trimInsetPct &&/);
  // And the trim figure is stated, not only drawn.
  assert.match(board, /Trim \(no bleed\)/);
  // Display only: the trim view is a transform on the same <img>, never a
  // canvas that would author a new image.
  assert.doesNotMatch(board, /toDataURL|createElement\("canvas"\)|toBlob/,
    "the board must never author panel pixels in the browser");
});

// ---------------------------------------------------------------------------
// REVISIONSTUDIOIQ OPENS ON A GENERATION, AND SHOWS WHAT THAT GENERATION HAS
// ---------------------------------------------------------------------------

const revisionStudio = readFileSync(
  new URL("../app/src/pages/RevisionStudioIQ.tsx", import.meta.url),
  "utf8",
);
const versionCard = readFileSync(
  new URL("../app/src/components/revisioniq/DesignVersionRecordCard.tsx", import.meta.url),
  "utf8",
);
const panelProBoard = readFileSync(
  new URL("../app/src/pages/designpro/PanelProStudioBoard.tsx", import.meta.url),
  "utf8",
);

/**
 * A DEEP LINK RESOLVES AGAINST THE SERVER, NOT AGAINST ONE PAGE OF A FEED.
 *
 * `?id=` used to match only rows already fetched into the caller's own grid,
 * after the grid's "a card needs an image" rule had filtered it. So three
 * ordinary situations opened a blank studio on a design that exists: a design
 * past the first page, a design whose proofs are still rendering, and -- the
 * one that was actually reported -- a design-team member following a link to a
 * customer's job, which is never in their feed at all.
 */
test("a RevisionStudio deep link opens a design the feed cannot answer for", () => {
  assert.match(revisionStudio, /readRevisionStudioDesign\(deepLinkId\)/);
  // The feed match stays first: when the row is in hand it is the same object
  // the grid renders, and reusing it keeps selection and list in sync.
  assert.match(revisionStudio, /const found = renders\.find/);
  // One fetch per id, never a loop.
  assert.match(revisionStudio, /deepLinkFetchedRef\.current === deepLinkId/);
  // An id this account cannot open is answered, never left spinning.
  assert.match(revisionStudio, /setDeepLinkMissing\(true\)/);
  assert.match(revisionStudio, /That design could not be opened/);
});

/**
 * ⛔ THE A.T.L.A.S. MASTER IS NEVER SHOWN TO A CLIENT. (Trish 2026-08-26)
 *
 * RevisionStudioIQ is review / revise / approve / buy. The flattened master is
 * the production authority and lives in PanelPro Studio, under the A.T.L.A.S.
 * generation id, because PanelPro is the internal control room where the thing
 * everything else descends from is inspected and QC'd.
 *
 * A session rendered the master in the customer's workspace, on the reading
 * that a person deciding what to change needs to see the sheet the change is
 * made to. That argument is plausible enough to be made again, which is why
 * this is a test and not a comment.
 *
 * What DOES stay on the customer surface is the design's own history -- every
 * version, the words that produced it, when -- and the identity trio.
 */
test("RevisionStudio shows the version record and never the A.T.L.A.S. master", () => {
  // The card itself is UNMOUNTED from the customer studio (owner, 2026-08-26):
  // Generation ID, Design ID and order number are production identities and
  // live in PanelPro Studio. The component remains for any internal surface,
  // and the assertions below still pin what it may never carry.
  assert.ok(!revisionStudio.includes("<DesignVersionRecordCard"),
    "the version record card must not be mounted on the customer studio");

  // The master, its hash and its guide are absent from the customer surface.
  for (const atlasInternal of ["masterUrl", "guideUrl", "masterContentHash", "master.contentHash"]) {
    assert.ok(
      !versionCard.includes(atlasInternal),
      `the customer's surface must never carry ${atlasInternal}`,
    );
  }
  assert.match(versionCard, /NEVER SHOWN HERE/);

  // One canonical history, the same one PanelPro reads. No second numbering
  // and no prompt store of its own.
  assert.match(versionCard, /loadDesignVersionHistory/);
  assert.ok(!versionCard.includes("design_version_commits"));
  assert.ok(!versionCard.includes("supabase.from"));

  // Every version, never only the newest.
  assert.match(versionCard, /versions\.map\(\(version\) => \{/);
  assert.match(versionCard, /exactTimestamp\(selected\.createdAt\)/);
  // The customer's own words, labelled for which kind they are: reading the
  // original brief as a revision instruction is how a design gets rebuilt
  // against text nobody typed.
  assert.match(versionCard, /promptKind === "original-brief"/);
  assert.match(versionCard, /Original customer brief/);
  // Not a producer. Selecting a version changes what is displayed, nothing else.
  for (const producer of ["Pull panel", "Mirror from driver", "regenerate", "generate("]) {
    assert.ok(!versionCard.includes(producer), `the version card must not offer ${producer}`);
  }
});

/**
 * ONE JOB, NAMEABLE FROM EITHER SCREEN.
 *
 * The A.T.L.A.S. generation id, the Design ID and the Design Order number must
 * appear in RevisionStudioIQ AND in PanelPro Studio, so a person on the phone
 * can identify the same job from whichever surface they are looking at.
 */
test("the identity trio appears on both surfaces", () => {
  const routedBoard = readFileSync(
    new URL("../app/src/pages/AdminGeminiCompareStudio.tsx", import.meta.url),
    "utf8",
  );

  // The customer's surface.
  assert.match(versionCard, /Generation ID/);
  assert.match(versionCard, /Design ID/);
  assert.match(versionCard, /Order number/);

  // The QC board.
  assert.match(panelProBoard, /job\?\.designId/);
  assert.match(panelProBoard, /job\.orderNumber/);
  assert.match(panelProBoard, /generationId/);

  // And the board actually routed at /designpro/jobs/:id/panelpro.
  assert.match(routedBoard, /Generation ID/);
  assert.match(routedBoard, /"Design ID", job\.design_id/);
  assert.match(routedBoard, /"Design Order #", job\.order_number/);
});

/**
 * RULE 0.21: two parallel consumers of one lineage, never two workflows. Each
 * has to be reachable from the other on the same generation id, or a reviewer
 * who finds a problem on the board has no route to the surface that fixes it.
 */
test("RevisionStudio and PanelPro reach each other on the same generation", () => {
  assert.match(panelProBoard, /\/revision-studio\?id=\$\{encodeURIComponent\(generationId\)\}/);
  assert.match(studio, /\/revision-studio\?id=\$\{encodeURIComponent\(generationId\)\}/);
  assert.match(versionCard, /\/designpro\/jobs\/\$\{encodeURIComponent\(id\)\}\/panelpro/);
});
