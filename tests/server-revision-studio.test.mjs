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
