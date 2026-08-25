import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const studio = readFileSync(
  new URL("../app/src/components/revisioniq/ServerRevisionStudio.tsx", import.meta.url),
  "utf8",
);
const intake = readFileSync(
  new URL("../app/src/pages/designpro/NewRevisionSource.tsx", import.meta.url),
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

test("a revision is a new immutable source, never a browser-side rerun", () => {
  assert.match(studio, /Create new revision source/);
  assert.match(studio, /does not rerun production or mutate approved files/);
  assert.match(studio, /\/designpro\/revisions\/new\?source=/);
  assert.match(intake, /sourceGenerationId/);
  assert.match(intake, /original server-owned job remains unchanged/);
  assert.match(intake, /defaultValue=\{requestedInstruction\}/);
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
  assert.match(routes, /path="\/designpro\/jobs\/:generationId\/panel-studio"[\s\S]{0,120}<DesignProStudio \/>/);
  assert.match(routes, /path="\/designpro\/jobs\/:generationId\/panelpro"[\s\S]{0,120}<PanelProStudioBoard \/>/);

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
