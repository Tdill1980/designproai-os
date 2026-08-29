// THE FOUR TRANSITIONS MUST KEEP CARRYING THE JOB IDENTITY.
//
// Owner (Trish 2026-08-29): "I should never have to copy/paste a Generation ID."
//
// Each assertion below is anchored on a break that was real. The most
// expensive one — `navigate("/revision-studio")` with no id — was a single
// missing argument that sent the owner back to the design library to find, by
// eye, the design she had just generated. It read as correct in review for
// weeks because the destination WAS right; only the identity was missing.
//
// These are source assertions rather than rendered-DOM ones on purpose: the
// hosts are 7,500 and 4,400 lines, and what has to hold is that the id reaches
// the URL, which is a property of the call site.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const generate = read("pages/DesignPanelProPremium.tsx");
const revisionStudio = read("pages/RevisionStudioIQ.tsx");
const panelPro = read("pages/designpro/PanelProStudioBoard.tsx");
const wrapbox = read("pages/designpro/WrapBoxDelivery.tsx");
const jobView = read("pages/designpro/ProductionWorkflow.tsx");
const qcPanel = read("components/designpro/FullQcPanel.tsx");

describe("the workflow carries one job identity across the five existing screens", () => {
  it("DESIGN → REVISE hands RevisionStudio the generation id", () => {
    // The exact regression: a bare `/revision-studio` opens the LIBRARY.
    expect(generate).toMatch(/\/revision-studio\?id=\$\{encodeURIComponent\(id\)\}/);
    expect(generate).toContain("Open in RevisionStudio");
  });

  it("REVISE → PANELS routes to PanelPro on the same generation", () => {
    expect(revisionStudio).toMatch(
      /\/designpro\/jobs\/\$\{encodeURIComponent\(productionLayersId\)\}\/panelpro\/surfaces/,
    );
    expect(revisionStudio).toContain("Approve Design &amp; Build Print Panels");
  });

  it("PANELS → QC runs the report in place, over this job's own revision", () => {
    expect(panelPro).toContain("<FullQcPanel");
    expect(panelPro).toMatch(/generationId=\{generationId\}/);
    // The panels checked are the ones on screen, not a re-fetch that could drift.
    expect(panelPro).toMatch(/revision=\{atlasRevisions\[atlasVersion\]/);
  });

  it("QC → WRAPBOX appears only on a pass, and carries the job", () => {
    // A failing report must not offer the next door — that is the same lie as
    // navigating away from a failure.
    expect(qcPanel).toMatch(/\{report\.passed && \(/);
    expect(qcPanel).toMatch(/\/designpro\/wrapbox\?job=\$\{encodeURIComponent\(generationId\)\}/);
    expect(qcPanel).toContain("Create WrapBox");
  });

  it("WrapBox resolves the job by designId, since a pack carries no generationId", () => {
    expect(wrapbox).toContain('searchParams.get("job")');
    expect(wrapbox).toMatch(/pack\.designId === job\.designId/);
    // And it must be honest when no pack exists rather than fabricating a
    // preview — the entitlement gate is real.
    expect(wrapbox).toContain("No delivered pack yet for this design");
  });

  it("every screen in the path mounts the same header, with its own stage", () => {
    const mounted: Array<[string, string, string]> = [
      ["generate page", generate, "design"],
      ["job view", jobView, "design"],
      ["RevisionStudioIQ", revisionStudio, "revise"],
      ["PanelPro board", panelPro, "panels"],
      ["WrapBox", wrapbox, "wrapbox"],
    ];
    for (const [name, source, stage] of mounted) {
      expect(source, `${name} must mount JobWorkflowHeader`).toContain("<JobWorkflowHeader");
      expect(source, `${name} must declare current="${stage}"`).toContain(`current="${stage}"`);
    }
  });

  it("no screen invents a second QC verdict of its own", () => {
    // One report, computed once, passed to the header. A page recomputing
    // `passed` from its own rules is how PanelPro and RevisionStudio came to
    // disagree about one design (RULE 0.27 §4).
    expect(panelPro).toContain("qcPassed={Boolean(qcReport?.passed)}");
    expect((panelPro.match(/buildPanelQcReport/g) || []).length).toBe(0);
  });
});
