import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [] }) }) }) }) }) } }));
import { DesignPipelineProgress } from "./DesignPipelineProgress";

// Owner, Trish 2026-09-16: "Show the driver panel as early as it's ready."
// On her Martini run the sheet was accepted at 1:45 and the proofs landed at
// 2:25; the design existed for forty seconds while the screen spun.
const request = { requestId: "r", generationId: "g", state: "leased", inputHash: "", engineContractHash: "", phase: "photographer", shotsComplete: 2, shotsTotal: 7 } as any;

describe("the accepted driver panel is shown the moment it exists", () => {
  it("renders the driver panel above the progress surface while the proofs render", () => {
    const html = renderToStaticMarkup(
      <DesignPipelineProgress stage="finishing" elapsed={110} requestState={request} isAtlas atlasReady
        designPreview={{ url: "https://signed.example/driver.png", vehicleLabel: "2022 Porsche 911 Turbo" }} />,
    );
    expect(html).toContain('data-testid="design-preview"');
    expect(html).toContain('src="https://signed.example/driver.png"');
    expect(html).toContain("Your design is in");
    expect(html).toContain("Photographing it on your 2022 Porsche 911 Turbo");
    expect(html).toContain("2 of 7 proof views ready");
    expect(html).toContain("Driver side · print panel · accepted");
  });
  it("shows the plain progress surface until the panel exists, and never on the legacy pipeline", () => {
    const atlas = renderToStaticMarkup(<DesignPipelineProgress stage="rendering" elapsed={30} requestState={request} isAtlas />);
    expect(atlas).not.toContain('data-testid="design-preview"');
    expect(atlas).toContain("Creating your precision design");
    const legacy = renderToStaticMarkup(
      <DesignPipelineProgress stage="rendering" elapsed={30} requestState={request} designPreview={{ url: "https://signed.example/driver.png" }} />,
    );
    expect(legacy).not.toContain('data-testid="design-preview"');
  });
});
