import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ listJobFlatAtlasRevisions: vi.fn(), createGenerationRevision: vi.fn(), uploadRevisionAsset: vi.fn(), getGenerationRequest: vi.fn(), listGenerationViews: vi.fn(), listFlatAtlasRevisions: vi.fn(), createGenerationRequest: vi.fn(), getStatus: vi.fn(), listArtifacts: vi.fn() }));
const compose = vi.hoisted(() => vi.fn());
vi.mock("@/lib/designpro-api", () => ({ dpApi: api, ROLE_FOR_SOURCE_VIEW_TYPE: { side: "driver", "passenger-side": "passenger", hood_detail: "hood", roof: "roof", front: "front", rear: "rear", "close-up": "closeup", "hero-3d": "hero3d" } }));
vi.mock("@/lib/logo-composite", () => ({ composeRenderWithLayers: compose }));
import { getDesignBuildStatus, pendingRevisionNotes, layerRevisionReferenceFiles, readDesignAfterEdit, readSubmittedRevision, revisionParent, submitDesignRevision } from "./revisionstudio-flow";
import type { FlatAtlasRevision, GenerationRevisionReceipt } from "./designpro-api";
const parent = { id: "atlas-v2", generationId: "existing-generation", revisionSequence: 2, parentRevisionId: "atlas-v1", master: { contentHash: "a".repeat(64) } } as FlatAtlasRevision;
const current = { ...parent, id: "atlas-v4", revisionSequence: 4, master: { ...parent.master, contentHash: "b".repeat(64) } };
const receipt = { generationId: parent.generationId, requestId: "request-v5", parentAtlasRevisionId: parent.id, revisionSequence: 5, state: "queued" } as GenerationRevisionReceipt;
const input = () => ({ source: { id: parent.generationId, atlas_revision_id: parent.id, vehicle_year: "2020", vehicle_make: "Chevrolet", vehicle_model: "Camaro" }, instruction: "Move the supplied logo away from the door seam.", vehicle: { year: "2020", make: "Chevrolet", model: "Camaro" }, designName: "Existing design" });
beforeEach(() => { vi.clearAllMocks(); api.listJobFlatAtlasRevisions.mockResolvedValue([current, parent]); api.createGenerationRevision.mockResolvedValue(receipt); api.uploadRevisionAsset.mockResolvedValue({ contentHash: "c".repeat(64), storagePath: "owned/reference.png", byteSize: 3, contentType: "image/png" }); });
afterEach(() => vi.restoreAllMocks());
describe("existing RevisionStudio history and automatic regeneration handoff", () => {
  it("keeps the previous saved proof out of a pending revision even when the old production run is complete", async () => {
    api.getStatus.mockResolvedValue({ generationId: parent.generationId, state: "complete" });
    api.getGenerationRequest.mockResolvedValue(receipt);
    api.listArtifacts.mockResolvedValue([{ id: "old-call8", kind: "flat-proof", surfaceKey: "", contentHash: "c".repeat(64), signedUrl: "https://files.test/old-proof.png", metadata: { role: "customer-2d-production-proof", sourceMasterHash: parent.master.contentHash } }]);
    const pending = await getDesignBuildStatus({ generationId: parent.generationId, revisionRequest: receipt });
    expect(pending.proofUrl).toBeNull();
    expect(pending.workflowRun?.workflow_status).toBe("running");
    api.getGenerationRequest.mockResolvedValue({ ...receipt, state: "outputs_ready", revisionHandoffError: { code: "private SQL text" } });
    const stalled = await getDesignBuildStatus({ generationId: parent.generationId, revisionRequest: receipt });
    expect(stalled.workflowRun?.workflow_status).toBe("failed");
    expect(JSON.stringify(stalled)).not.toContain("private SQL text");
    const historical = await getDesignBuildStatus({ generationId: parent.generationId, atlasRevisionId: parent.id });
    expect(historical.proofUrl).toBe("https://files.test/old-proof.png");
    expect(JSON.parse(pendingRevisionNotes({ original_prompt: "Saved brief", flat_proof_url: "old", logo_pack: ["old"], logo_layers: { old: true }, ai_edit_summary: "Old change" }))).toEqual({ original_prompt: "Saved brief" });
  });
  it("revises an older selected parent as the server's next version on the same GenerationID", async () => {
    expect(await submitDesignRevision({ ...input(), affectedSurfaces: ["driver"], panelOutputRunId: "physical-child" })).toEqual(receipt);
    expect(api.createGenerationRevision).toHaveBeenCalledWith({ generationId: parent.generationId, parentAtlasRevisionId: parent.id, parentMasterContentHash: parent.master.contentHash, instruction: input().instruction, affectedSurfaces: ["driver"], panelOutputRunId: "physical-child" });
    expect(api.createGenerationRequest).not.toHaveBeenCalled();
  });
  it("refuses an unknown named parent and a receipt for another design, without starting a fresh generation", async () => {
    expect(() => revisionParent([current, parent], parent.generationId, "missing")).toThrow(/selected ATLAS/);
    api.createGenerationRevision.mockResolvedValue({ ...receipt, generationId: "other" });
    await expect(submitDesignRevision(input())).rejects.toThrow(/existing design and parent/);
    expect(api.createGenerationRequest).not.toHaveBeenCalled();
  });
  it("does not revise a different vehicle or silently choose a parent while artwork is pending", async () => {
    await expect(submitDesignRevision({ ...input(), vehicle: { ...input().vehicle, model: "Corvette" } })).rejects.toThrow(/verified vehicle/);
    await expect(submitDesignRevision({ ...input(), source: { ...input().source, atlas_revision_id: null, _revisionRequest: receipt } })).rejects.toThrow(/accepted/);
    expect(api.createGenerationRevision).not.toHaveBeenCalled();
  });
  it("uploads the edited image as a reference and clears old previews until matching regenerated artifacts arrive", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Blob(["edit"], { type: "image/png" })));
    const result = await readDesignAfterEdit({ render: { ...input().source, render_urls: { side: "https://files.test/old.png" } }, renderUrls: { side: "https://files.test/edited.png" }, trigger: "precise_edit", change: { type: "edit", viewKeys: ["side"], prompt: "Keep this logo clear of the cut area." } });
    expect(result.render_urls).toEqual({});
    expect(result.revisionReceipt).toEqual(receipt);
    expect(api.uploadRevisionAsset).toHaveBeenCalledWith(parent.id, "attachment", expect.any(File));
    expect(api.createGenerationRevision.mock.calls[0][0]).toMatchObject({ instruction: "Keep this logo clear of the cut area.", affectedSurfaces: ["driver"], editAssets: [{ purpose: "reference", contentHash: "c".repeat(64) }] });
    expect(api.createGenerationRevision.mock.calls[0][0]).not.toHaveProperty("renderUrls");
  });
  it("refuses incomplete references rather than submit the text alone", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("missing", { status: 404 }));
    await expect(submitDesignRevision({ ...input(), referenceUrls: ["https://files.test/missing.png"] })).rejects.toThrow(/could not be read/);
    expect(api.createGenerationRevision).not.toHaveBeenCalled();
  });
  it("preserves placed layers in a strict composition reference and uploads exact reference bytes", async () => {
    compose.mockResolvedValue(new Blob(["composite"], { type: "image/png" }));
    const layers = [{ id: "original-logo", cleanedUrl: "https://files.test/logo.png", xPct: 0.25, yPct: 0.4, size: "md" as const, rotationDeg: 5 }];
    const files = await layerRevisionReferenceFiles([{ viewKey: "side", backgroundUrl: "https://files.test/clean-panel.png", layers }]);
    expect(compose).toHaveBeenCalledWith("https://files.test/clean-panel.png", layers, { strict: true });
    expect(await files[0].text()).toBe("composite");
    await submitDesignRevision({ ...input(), referenceFiles: files });
    expect(api.uploadRevisionAsset).toHaveBeenCalledWith(parent.id, "attachment", files[0]);
  });
  it("does not replace a failed layer with a partial reference or a fresh generation", async () => {
    compose.mockRejectedValue(new Error("Layer not available"));
    await expect(layerRevisionReferenceFiles([{ viewKey: "side", backgroundUrl: "https://files.test/panel.png", layers: [] }])).rejects.toThrow("Layer not available");
    expect(api.createGenerationRevision).not.toHaveBeenCalled();
  });
  it("observes only the submitted child and counts camera identities once, without old fallback images", async () => {
    api.getGenerationRequest.mockResolvedValue({ ...receipt, state: "leased" });
    api.listGenerationViews.mockResolvedValue([{ sourceViewType: "side", consumerRole: "driver", signedUrl: "https://files.test/new-side.png", contentHash: "d".repeat(64) }]);
    api.listFlatAtlasRevisions.mockResolvedValue([parent]);
    expect((await readSubmittedRevision(receipt)).renderUrls).toEqual({});
    const child = { ...current, id: "atlas-v5", parentRevisionId: parent.id, revisionSequence: 5 };
    api.listFlatAtlasRevisions.mockResolvedValue([child]);
    const result = await readSubmittedRevision(receipt);
    expect(result.proofCount).toBe(1);
    expect(result.renderUrls).toEqual({ side: "https://files.test/new-side.png", driver: "https://files.test/new-side.png" });
    expect(api.listGenerationViews).toHaveBeenCalledWith(receipt.requestId);
    api.getGenerationRequest.mockResolvedValue({ ...receipt, requestId: "other-request" });
    await expect(readSubmittedRevision(receipt)).rejects.toThrow(/did not match/);
  });
});
