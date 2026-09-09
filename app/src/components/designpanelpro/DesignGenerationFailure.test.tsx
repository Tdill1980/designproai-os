import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DesignGenerationFailure } from "./DesignGenerationFailure";

const generationId = "e9babe2d-043e-4ce4-9b7f-5e93b2739b09";
const render = (props: Partial<React.ComponentProps<typeof DesignGenerationFailure>> = {}) => {
  const onStartNew = vi.fn();
  const html = renderToStaticMarkup(
    <StaticRouter location="/designpro/create">
      <DesignGenerationFailure
        isAtlas
        generationId={generationId}
        error="provider_outcome_unknown"
        errorCode="provider_outcome_unknown"
        onStartNew={onStartNew}
        {...props}
      />
    </StaticRouter>,
  );
  return { html, onStartNew };
};

describe("DesignPro ATLAS failure UI", () => {
  it("offers only saved-record navigation for an unconfirmed provider outcome", () => {
    const { html, onStartNew } = render();
    expect(html).toContain("ATLAS generation did not complete.");
    expect(html).toContain("image service response could not be confirmed");
    expect(html).toContain("DID-E9BABE2D");
    expect(html).toContain(`href="/designpro/studio-board?order=${generationId}"`);
    expect(html).toContain(`href="/revision-studio?generationId=${generationId}"`);
    expect(html).toContain("Reference: provider_outcome_unknown");
    expect(html).not.toMatch(/<button|Start New|Relaunch|Precision|paused|recovering/i);
    expect(onStartNew).not.toHaveBeenCalled();
  });

  it.each([null, "not-a-generation-id", "https://other.test/job"])(
    "does not fabricate a record link when the saved ID is %s", (id) => {
      const { html } = render({ generationId: id });
      expect(html).toContain('href="/revision-studio"');
      expect(html).not.toContain("studio-board?order=");
      expect(html).not.toContain("DID-");
      expect(html).not.toMatch(/<button|Start New|Relaunch/);
    },
  );

  it("retains an access refusal without suggesting that the failed run is still processing", () => {
    const { html } = render({ error: "Sign in again to inspect this saved design." });
    expect(html).toContain("Sign in again");
    expect(html).not.toMatch(/paused|recovering|generation is running/i);
    expect(html).not.toContain("<button");
  });

  it("keeps the explicit new-ATLAS action for a confirmed terminal failure", () => {
    const { html } = render({ errorCode: "flat_atlas_master_qc_failed", error: "This ATLAS master did not pass inspection." });
    expect(html).toContain("Start New ATLAS Run");
    expect(html).toContain("<button");
    expect(html).not.toContain("Precision");
    expect(html).not.toContain("response could not be confirmed");
  });

  it("preserves the existing non-ATLAS relaunch action", () => {
    const { html } = render({ isAtlas: false, errorCode: "generation_failed", error: "Design generation failed." });
    expect(html).toContain("Relaunch");
    expect(html).not.toContain("Start New ATLAS Run");
  });
});
