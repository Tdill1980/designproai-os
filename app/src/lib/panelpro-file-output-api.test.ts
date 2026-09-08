import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: { session: { access_token: "session-token" } },
      }),
    },
  },
}));
import {
  panelOutputApi,
  panelOutputHref,
  panelOutputIdentityFromSearch,
  withTemplateVehicleReview,
} from "./panelpro-file-output-api";
import { panelOutputBlockerCopy, panelOutputRevisionHref } from "./panelpro-file-output-view.mjs";
afterEach(() => vi.restoreAllMocks());

describe("PanelProFileOutput exact registered source transport", () => {
  it("requires a fresh explicit vehicle review and binds existing source and dimension identities", () => {
    const source = { sourceApp: "DesignPro", revisionId: "manufacturing-revision", dimensionManifestHash: "d".repeat(64), template: { geometryHash: "c".repeat(64) }, templateVehicleReview: { missingVariantsReviewed: true, reviewId: "imported" } };
    expect(withTemplateVehicleReview(source, { confirmed: false, reviewId: "" })).not.toHaveProperty("templateVehicleReview");
    expect(withTemplateVehicleReview(source, { confirmed: true, reviewId: "inspection-1" }).templateVehicleReview).toEqual({ reviewId: "inspection-1", revisionId: source.revisionId, geometryHash: source.template.geometryHash, dimensionManifestHash: source.dimensionManifestHash, missingVariantsReviewed: true });
    expect(() => withTemplateVehicleReview(source, { confirmed: true, reviewId: "" })).toThrow(/saved source revision/);
    expect(() => withTemplateVehicleReview({ ...source, dimensionManifestHash: null }, { confirmed: true, reviewId: "inspection-1" })).toThrow(/saved source revision/);
  });
  it("uses the authenticated template review routes and preserves exact candidate evidence", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "approved" }), { status: 200 }));
    const body = { candidateHash: "a".repeat(64), review: { reviewId: "review-1", approved: true as const, displayContentHash: "b".repeat(64), geometryHash: "c".repeat(64), cutGeometryReviewed: true as const, displayAlignmentReviewed: true as const, displayRegions: [{ pieceId: "driver", displayRegionPixels: { x: 0, y: 50, width: 400, height: 200 } }] } };
    await panelOutputApi.approveTemplateCandidate("candidate-1", body);
    expect(String(fetch.mock.calls[0][0])).toContain("/panelpro-file-output/templates/candidates/candidate-1/review");
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual(body);
    expect(fetch.mock.calls[0][1]?.headers).toMatchObject({ authorization: "Bearer session-token" });
  });
  it("keeps the returned source ID and input hash through preparation, URL handoff and create", async () => {
    const prepared = {
      sourceApp: "DesignPro" as const,
      sourceJobId: "existing-generation",
      generationId: "existing-generation",
      revisionId: "selected-revision",
      sourceId: "registered-placement-two",
      inputHash: "b".repeat(64),
    };
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify(prepared), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "created-run", ...prepared }), {
          status: 200,
        }),
      );
    const registration = await panelOutputApi.registerSource({
      template: { templateId: "reviewed-template" },
    });
    const query = new URL(panelOutputHref(registration), "https://app.test")
      .searchParams;
    const identity = panelOutputIdentityFromSearch(
      query,
      "DesignPro",
      "existing-generation",
    );
    await panelOutputApi.create(identity);
    expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).toEqual(prepared);
    expect(fetch.mock.calls[1][1]?.credentials).toBe("include");
    expect(fetch.mock.calls[1][1]?.headers).toMatchObject({
      authorization: "Bearer session-token",
    });
  });
  it("changing the source selection discards the prior job's placement and manufacturing IDs", () => {
    const query = new URLSearchParams({
      sourceApp: "DesignPro",
      sourceJobId: "old-generation",
      sourceId: "old-placement",
      inputHash: "a".repeat(64),
      revisionId: "old-revision",
      orderId: "old-order",
    });
    expect(
      panelOutputIdentityFromSearch(query, "RecreatePro", "new-artwork"),
    ).toEqual({ sourceApp: "RecreatePro", sourceJobId: "new-artwork" });
    expect(
      panelOutputIdentityFromSearch(query, "DesignPro", "new-generation"),
    ).toEqual({
      sourceApp: "DesignPro",
      sourceJobId: "new-generation",
      generationId: "new-generation",
    });
  });
  it("attaches only the explicitly selected production run and translates proof-refresh blockers", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            attached: true,
            productionRunId: "parent-production",
          }),
          { status: 200 },
        ),
      );
    await panelOutputApi.attach("physical-output", "parent-production");
    expect(String(fetch.mock.calls[0][0])).toContain(
      "/panelpro-file-output/runs/physical-output/attach",
    );
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({
      productionRunId: "parent-production",
    });
    expect(panelOutputBlockerCopy("panelprofile_proof_refresh_required")).toBe(
      "Artwork changed. Continue the existing RevisionStudio edit flow to regenerate matching panels and vehicle proofs before attaching this package.",
    );
  });
  it("keeps revision continuation on the exact saved child and source revision", () => {
    const continuation = { targetApp: "RevisionStudioIQ", href: "/revision-studio?id=generation&sourceRevisionId=atlas-current&panelOutputRunId=child&revisionInstruction=Review+placement",
      generationId: "generation", sourceRevisionId: "atlas-current", panelOutputRunId: "child", requiresAcceptedRevision: true, automaticPanelRegeneration: true, autoApply: false };
    expect(panelOutputRevisionHref(continuation, "generation", "child", "atlas-current")).toBe(continuation.href);
    expect(panelOutputRevisionHref({ ...continuation, href: "https://other.test/revision-studio?id=generation" }, "generation", "child", "atlas-current")).toBeNull();
    expect(panelOutputRevisionHref(continuation, "other-generation", "child", "atlas-current")).toBeNull();
    expect(panelOutputRevisionHref({ ...continuation, autoApply: true }, "generation", "child", "atlas-current")).toBeNull();
  });
  it("reserves the optional production join only through an explicit write", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            reserved: true,
            productionRunId: "chosen-production",
          }),
          { status: 200 },
        ),
      );
    await panelOutputApi.reserve("chosen-production");
    expect(String(fetch.mock.calls[0][0])).toContain(
      "/panelpro-file-output/production/chosen-production/reserve",
    );
    expect(fetch.mock.calls[0][1]?.method).toBe("POST");
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({});
  });
});
