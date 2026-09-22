import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DesignIDBadge } from "./DesignIDBadge";

const generationId = "e9babe2d-043e-4ce4-9b7f-5e93b2739b09";
const source = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

// THE ID LADDER (owner ruling): Generation ID at Call 1; Design ID and Order ID
// when the Production Pack is purchased. The badge on a pre-purchase surface
// carries the Generation ID and nothing else; a DID appears only when a
// purchase minted one.
describe("DesignIDBadge", () => {
  it("shows the Generation ID, and no DID, on a pre-purchase render", () => {
    const html = renderToStaticMarkup(
      <DesignIDBadge toolName="DesignProAI™" designName="Crimson Ronin Edge" generationId={generationId} />,
    );
    expect(html).toContain("Generation ID E9BABE2D");
    expect(html).toContain('data-identity="Generation ID"');
    expect(html).not.toContain("DID-");
  });

  it("shows the purchase-minted Design ID once a purchase exists", () => {
    const html = renderToStaticMarkup(
      <DesignIDBadge toolName="DesignProAI™" did="DID-E9BABE2D" generationId={generationId} />,
    );
    expect(html).toContain("DID-E9BABE2D");
    expect(html).toContain('data-identity="Design ID"');
    expect(html).not.toContain("Generation ID");
  });

  it("shows no identity chip when there is neither", () => {
    const html = renderToStaticMarkup(<DesignIDBadge toolName="DesignProAI™" />);
    expect(html).not.toContain("data-identity");
    expect(html).not.toContain("DID-");
  });
});

describe("pre-purchase customer surfaces carry the Generation ID", () => {
  it("VehiclePro (/designpro/create) never derives a DID for its badges", () => {
    // The page is pre-purchase by construction: Order Production Pack leaves
    // for Stripe and returns to /productionflow. It used to pass
    // `did={formatDid(generationIdRef.current) || renderDid}`, printing a DID
    // the purchase had not minted.
    const page = source("../pages/DesignPanelProPremium.tsx");
    expect(page).not.toMatch(/did=\{formatDid\(/);
    expect(page).not.toMatch(/import \{[^}]*formatDid[^}]*\} from "@\/lib\/designId"/);
    expect((page.match(/generationId=\{generationIdRef\.current \|\| undefined\}/g) || []).length).toBe(2);
  });

  it("the generation failure screen names the Generation ID, not a DID", () => {
    const failure = source("./designpanelpro/DesignGenerationFailure.tsx");
    expect(failure).not.toMatch(/formatDid/);
    expect(failure).toMatch(/Generation ID \{shortGenerationId\(savedGenerationId\)\}/);
  });
});
