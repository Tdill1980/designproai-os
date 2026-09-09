import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/designpro-api", () => ({ dpApi: {} }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: {} } }));
import { PanelOutputRunView } from "./PanelProFileOutput";
import type { PanelOutputRun } from "@/lib/panelpro-file-output-api";

const base: PanelOutputRun = {
  id: "run-1",
  sourceApp: "DesignPro",
  sourceJobId: "saved-job",
  generationId: "saved-job",
  designId: "DID-12345678",
  revisionId: "existing-revision",
  status: "waiting",
  stages: [
    { key: "source.verify", state: "complete", dependsOn: [] },
    {
      key: "panelprofileoutput.fit",
      state: "waiting",
      dependsOn: ["source.verify"],
    },
  ],
  pieces: [],
  previews: [],
  blockers: ["panelprofile_template_missing"],
};
const render = (run: PanelOutputRun) =>
  renderToStaticMarkup(
    <StaticRouter location="/panelpro-file-output">
      <PanelOutputRunView run={run} />
    </StaticRouter>,
  );

describe("PanelProFileOutput recorded-state view", () => {
  it("shows a blocked real run and keeps the existing studios reachable", () => {
    const html = render(base);
    expect(html).toContain("1 of 2 reported steps complete");
    expect(html).toContain("A validated template is needed");
    expect(html).toContain("/designpro/jobs/saved-job/panelpro");
    expect(html).toContain("/revision-studio?generationId=saved-job");
    expect(html).not.toContain("QC approved");
    expect(html).not.toContain('src="');
  });
  it("offers a controlled resume for a failed graph without inventing approval", () => {
    const html = render({ ...base, status: "failed" });
    expect(html).toContain("Resume eligible failed steps");
    expect(html).not.toContain("QC approved");
    expect(render({ ...base, status: "completed" })).not.toContain("Resume eligible failed steps");
  });
  it("renders verified overlay with exact reported print dimensions while preserving continuous background explanation", () => {
    const html = render({
      ...base,
      blockers: [],
      previews: [
        {
          id: "p1",
          role: "template-overlay",
          signedUrl: "https://example.test/overlay.png",
          contentHash: "a".repeat(64),
          profileHash: "b".repeat(64),
          approvedDisplay: true,
          geometryValidated: true,
          provenance: "generated-branded",
        },
      ],
      pieces: [
        {
          id: "hood",
          label: "Hood",
          state: "waiting",
          trimWidthIn: 64,
          trimHeightIn: 53,
          printWidthIn: 74,
          printHeightIn: 63,
          bleedInches: 5,
        },
      ],
    });
    expect(html).toContain('src="https://example.test/overlay.png"');
    expect(html).toContain("74″ × 63″");
    expect(html).toContain("5″ each outside edge");
    expect(html).toContain("Cut areas remain covered with background artwork");
  });
  it("does not show an unreviewed original template or make up progress with no stage events", () => {
    const html = render({
      ...base,
      stages: [],
      previews: [
        {
          id: "raw",
          role: "branded-template",
          signedUrl: "https://example.test/private-template.png",
          contentHash: "a".repeat(64),
          approvedDisplay: false,
        },
      ],
    });
    expect(html).not.toContain("private-template.png");
    expect(html).not.toContain('role="progressbar"');
    expect(html).toContain("No execution steps have been recorded yet");
  });
  it("exposes physical-file review only to a server-authorized reviewer, with every checkbox initially unticked", () => {
    const file = {
      id: "file-1",
      filename: "hood.tiff",
      signedUrl: "https://files.test/hood.tiff",
      contentHash: "a".repeat(64),
    };
    const customer = render({
      ...base,
      files: [file],
      artifactSetHash: "b".repeat(64),
      canReview: false,
    });
    expect(customer).not.toContain("hood.tiff");
    expect(customer).not.toContain("Record physical panel QC approval");
    const reviewer = render({
      ...base,
      files: [file],
      artifactSetHash: "b".repeat(64),
      canReview: true,
    });
    expect(reviewer).toContain("hood.tiff");
    expect(reviewer.match(/type="checkbox"/g)).toHaveLength(8);
    expect(reviewer).not.toContain('checked=""');
    expect(reviewer).toMatch(
      /<button[^>]*disabled=""[^>]*>Record physical panel QC approval/,
    );
    expect(reviewer).toContain("Wait for PanelProFileOutput");
    expect(reviewer).toContain(
      "Pause this DesignPro production run at file verification",
    );
    expect(customer).not.toContain("Wait for PanelProFileOutput");
  });
  it("offers attachment only for a completed DesignPro child and preserves its recorded physical review", () => {
    const completed = {
      ...base,
      status: "completed",
      canReview: true,
      stages: [
        {
          key: "await_panelpro_preflight_qc",
          state: "completed",
          dependsOn: [],
        },
      ],
    };
    const html = render(completed);
    expect(html).toContain("Physical panel review recorded");
    expect(html).toContain("Include with production review");
    expect(html).not.toContain('type="checkbox"');
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*>Include with production review/,
    );
    expect(render({ ...completed, canReview: false })).not.toContain(
      "Include with production review",
    );
    expect(render({ ...completed, status: "running" })).not.toContain(
      "Include with production review",
    );
    expect(render({ ...completed, sourceApp: "WallPro" })).not.toContain(
      "Include with production review",
    );
  });
});
