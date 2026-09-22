import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { ProductionProofSourceCard } from "./ProductionProofSourceCard";

// The card holds no query of its own; the one reader it wraps loads the API
// module on demand, and a static render never resolves it.
vi.mock("@/lib/designpro-api", () => ({ dpApi: { getAtlasPanelProof: vi.fn(() => new Promise(() => {})) } }));

function render(node: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

describe("ProductionProofSourceCard", () => {
  it("presents the three-zone proof as the source, named with its version", () => {
    const html = render(<ProductionProofSourceCard requestId="10000000-0000-4000-8000-000000000001" revisionId="r1" version={3} />);
    expect(html).toContain("Production Panel Proof · V3");
    expect(html).toContain("the source of every print panel below");
    // The wrapped reader is mounted (pending on a static render), not replaced.
    expect(html).toContain("Loading your TriZone™ Production Panel Proof");
    // The word a customer must never read.
    expect(html).not.toMatch(/atlas|topolog/i);
  });

  it("drops the version suffix when the server has not numbered the revision yet", () => {
    for (const version of [undefined, null, 0]) {
      const html = render(<ProductionProofSourceCard requestId="10000000-0000-4000-8000-000000000001" version={version} />);
      expect(html).toContain("Production Panel Proof");
      expect(html).not.toMatch(/Production Panel Proof · V/);
    }
  });
});
