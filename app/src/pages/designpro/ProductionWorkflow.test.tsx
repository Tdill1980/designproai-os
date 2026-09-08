import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: {} } }));
import { PanelProfileQcSummary } from "./ProductionWorkflow";
const runId = "11111111-1111-4111-8111-111111111111";
const output = { runId, artifactSetHash: "a".repeat(64), snapshotHash: "b".repeat(64), fileCount: 24, qcApproved: true as const, reviewUrl: `/panelpro-file-output/runs/${runId}` };
const render = (row = output) => renderToStaticMarkup(<StaticRouter location="/designpro/jobs/generation"><PanelProfileQcSummary outputs={[row]} /></StaticRouter>);
describe("final production QC includes the exact physical child", () => {
  it("shows the recorded child hash and its review link before final approval", () => {
    const html = render();
    expect(html).toContain("24 files");
    expect(html).toContain(output.reviewUrl);
    expect(html).toContain("Physical panel QC recorded");
    expect(html).toContain(output.artifactSetHash);
    expect(html).not.toContain("QC approved for delivery");
  });
  it("does not open a different child or an unverified hash supplied as a review URL", () => {
    expect(render({ ...output, reviewUrl: "/panelpro-file-output/runs/other" })).toBe("");
    expect(render({ ...output, reviewUrl: "https://other.test/files" })).toBe("");
    expect(render({ ...output, artifactSetHash: "unverified" })).toBe("");
    expect(renderToStaticMarkup(<PanelProfileQcSummary outputs={undefined} />)).toBe("");
  });
});
