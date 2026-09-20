import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
  it("treats an active request limit as waiting before admission, without a new-run action", () => {
    const onReturnToBrief = vi.fn();
    const { html, onStartNew } = render({ errorCode: "generation_active_request_limit", error: "generation_active_request_limit", onReturnToBrief });
    expect(html).toContain("Another design is still generating");
    expect(html).toContain("Your brief is still here; this design has not started");
    expect(html).toContain("Return to your brief");
    expect(html).not.toMatch(/ATLAS generation did not complete|Start New ATLAS Run|Let&#x27;s try|generation_active_request_limit|refused candidates/);
    expect(onStartNew).not.toHaveBeenCalled();
  });
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

describe("DesignPro ATLAS failure UI — refused candidates", () => {
  const requestId = "bbb665ad-53cb-4e6c-919f-9bd338c7dfd0";
  const renderWithClient = (props: Partial<React.ComponentProps<typeof DesignGenerationFailure>>) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <StaticRouter location="/designpro/create">
          <DesignGenerationFailure isAtlas generationId={generationId} error={null} errorCode={null} onStartNew={vi.fn()} {...props} />
        </StaticRouter>
      </QueryClientProvider>,
    );
  };

  it("mounts the refused-candidate strip under the retry on a confirmed ATLAS refusal", () => {
    const html = renderWithClient({ requestId, errorCode: "flat_atlas_master_output_class_invalid", error: "refused" });
    expect(html).toContain("Start New ATLAS Run");
    expect(html).toContain("Loading the refused candidates");
  });

  it("never fetches candidates for an unconfirmed provider outcome, a non-ATLAS failure, or a bad request id", () => {
    expect(renderWithClient({ requestId, errorCode: "provider_outcome_unknown", error: "provider_outcome_unknown" }))
      .not.toContain("refused candidates");
    expect(renderWithClient({ requestId, isAtlas: false, errorCode: "generation_failed", error: "failed" }))
      .not.toContain("refused candidates");
    expect(renderWithClient({ requestId: "not-a-request", errorCode: "flat_atlas_unrepaired_cutout", error: "refused" }))
      .not.toContain("refused candidates");
  });
});
