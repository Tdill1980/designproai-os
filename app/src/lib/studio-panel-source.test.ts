import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
const api = vi.hoisted(() => ({
  getStatus: vi.fn(),
  listArtifacts: vi.fn(),
  listApprovedViews: vi.fn(),
  listJobFlatAtlasRevisions: vi.fn(),
}));
vi.mock("@/lib/designpro-api", () => ({
  dpApi: api,
  SOURCE_VIEW_TYPE_FOR_ROLE: {
    driver: "side",
    passenger: "passenger-side",
    hood: "hood_detail",
    roof: "roof",
    front: "front",
    rear: "rear",
  },
  ROLE_FOR_SOURCE_VIEW_TYPE: {
    side: "driver",
    "passenger-side": "passenger",
    hood_detail: "hood",
    roof: "roof",
    front: "front",
    rear: "rear",
  },
}));
import { loadProductionLayers } from "./designpro-production-layers";
import { historicalStudioProofs, readRevisionStudioDesign, revisionStudioVersionCommits } from "./revisionstudio-source";
import { buildRevisionVersionTimeline } from "./revision-version-surfaces";
import { loadPanelProVersionViews, panelProJobAtVersion, studioJobFrom } from "./panelpro-studio-source";
import type {
  ApprovedGenerationView,
  FlatAtlasRevision,
  WorkflowArtifact,
  WorkflowStatus,
} from "./designpro-api";
import type { DesignVersion } from "./design-version-history";
import { ProductionFlowLayersCard } from "@/components/revisioniq/ProductionFlowLayersCard";

const surfaces = ["driver", "passenger", "hood", "roof", "front", "rear"];
const master = "a".repeat(64);
const revision = {
  id: "atlas-2",
  generationId: "generation",
  revisionSequence: 2,
  master: { contentHash: master },
  affectedSurfaces: [],
  callOnePanels: surfaces.map((surfaceKey, i) => ({
    surfaceKey,
    sourceMasterHash: master,
    contentHash: String(i + 1).repeat(64),
    signedUrl: `https://files.test/${surfaceKey}`,
    trimWidthIn: 50,
    trimHeightIn: 40,
    printWidthIn: 60,
    printHeightIn: 50,
    bleedInches: 5,
  })),
} as FlatAtlasRevision;
const oldRevision = {
  ...revision,
  id: "atlas-1",
  revisionSequence: 1,
  master: { ...revision.master, contentHash: "b".repeat(64) },
  callOnePanels: revision.callOnePanels.map((panel) => ({
    ...panel,
    sourceMasterHash: "b".repeat(64),
    signedUrl: `https://files.test/old-${panel.surfaceKey}`,
  })),
};
const views = [
  {
    id: "driver-proof",
    generationId: "generation",
    surfaceKey: "driver",
    sourceViewType: "side",
    contentHash: "c".repeat(64),
    signedUrl: "https://files.test/driver-proof",
    atlasBinding: { masterContentHash: master, revisionId: revision.id },
  },
] as ApprovedGenerationView[];
const panels = revision.callOnePanels.map((panel) => ({
  id: `panel-${panel.surfaceKey}`,
  kind: "panel",
  surfaceKey: panel.surfaceKey,
  contentHash: panel.contentHash,
  signedUrl: panel.signedUrl,
  storagePath: `designpro/test/panels/${panel.surfaceKey}.png`,
  byteSize: 100,
  expiresIn: 300,
  metadata: {
    sourceMasterHash: master,
    revisionId: "manufacturing-2",
    trimWidthIn: 50,
    trimHeightIn: 40,
    printWidthIn: 60,
    printHeightIn: 50,
    bleedInches: 5,
  },
})) as WorkflowArtifact[];
const proof = {
  id: "call8",
  kind: "flat-proof",
  surfaceKey: "",
  contentHash: "d".repeat(64),
  signedUrl: "https://files.test/call8.png",
  storagePath: "designpro/test/proof.png",
  byteSize: 100,
  expiresIn: 300,
  metadata: {
    role: "customer-2d-production-proof",
    sourcePanelHashes: Object.fromEntries(
      panels.map((panel) => [panel.surfaceKey, panel.contentHash]),
    ),
  },
} as WorkflowArtifact;
const job = {
  generationId: "generation",
  designId: "DID-12345678",
  orderNumber: "order-1",
  revisionId: "manufacturing-2",
  revision: 2,
  stages: [{ key: "panels.build", state: "complete" }],
  state: "running",
} as WorkflowStatus;

beforeEach(() => {
  vi.clearAllMocks();
  api.getStatus.mockResolvedValue(job);
  api.listArtifacts.mockResolvedValue([...panels, proof]);
  api.listApprovedViews.mockResolvedValue(views);
  api.listJobFlatAtlasRevisions.mockResolvedValue([revision, oldRevision]);
});
describe("studio source handoff", () => {
  it("renders the real Call 8 sheet and keeps checkout reachable before final human QC", async () => {
    const layers = await loadProductionLayers("generation");
    const html = renderToStaticMarkup(React.createElement(ProductionFlowLayersCard, {
      generationId: "generation",
      source: { canonicalId: "generation", ...layers!, onOrderProductionPack: async () => {}, entitlements: { productionPack: false, logoPack: false } },
    }));
    expect(html).toContain('src="https://files.test/call8.png"');
    expect(html).not.toContain('src="designpro://');
    expect(html).toContain("Order Production Pack");
    expect(html).not.toContain("This production pack has completed human QC");
  });
  it("retains the real Call 8 signed image separately from the immutable binding and does not invent QC", async () => {
    const result = await loadProductionLayers("generation");
    expect(result?.proofUrl).toBe("https://files.test/call8.png");
    expect(result?.activePack?.proof_artifact?.url).toBe(
      `designpro://proof/${proof.contentHash}`,
    );
    expect(result?.rows[0].meta_metrics?.qc?.pass).toBe(false);
    expect(result?.rows[0].branding_url).toBe("https://files.test/driver");
  });
  it("an old selected ATLAS revision shows its own panels and no current driver proof", async () => {
    const result = await loadProductionLayers("generation", oldRevision.id);
    expect(result?.rows[0].branding_url).toBe("https://files.test/old-driver");
    expect(result?.designViews.side).toBeUndefined();
    expect(result?.proofUrl).toBeNull();
    expect(
      await loadProductionLayers("generation", "missing-revision"),
    ).toBeNull();
  });
  it("loads all seven older proof cameras and matching right-side panels from the exact saved version", async () => {
    const cameras = ["side", "passenger-side", "hood_detail", "roof", "front", "rear", "close-up"];
    const oldViews = cameras.map((camera, index) => ({ ...views[0], id: `old-${camera}`,
      sourceViewType: camera, surfaceKey: surfaces[index] || "hero3d",
      signedUrl: `https://files.test/old-proof-${camera}`,
      atlasBinding: { revisionId: oldRevision.id, masterContentHash: oldRevision.master.contentHash } }));
    api.listApprovedViews.mockImplementation(async (_generationId, revisionId) => revisionId === oldRevision.id ? oldViews : views);
    const [row, layers, commits] = await Promise.all([
      readRevisionStudioDesign("generation", oldRevision.id),
      loadProductionLayers("generation", oldRevision.id),
      revisionStudioVersionCommits("generation", oldRevision.id),
    ]);
    const history = buildRevisionVersionTimeline({ commits, legacyRows: [row!] });
    const selected = history.find((entry) => entry.key === `commit:${oldRevision.id}`)!;
    expect(api.listApprovedViews).toHaveBeenCalledWith("generation", oldRevision.id);
    expect(api.listApprovedViews.mock.calls.every((call) => call[1] === oldRevision.id)).toBe(true);
    expect(row?.atlas_revision_id).toBe(oldRevision.id);
    expect(row?.revision).toBe(1);
    expect(row?.generation_status).toBe("completed");
    expect(row?.render_urls.side).toBe("https://files.test/old-proof-side");
    expect(selected.currentUrls["close-up"]).toBe("https://files.test/old-proof-close-up");
    expect(Object.keys(selected.currentUrls)).toHaveLength(7);
    expect(selected.thumbnailUrl).toBe("https://files.test/old-proof-side");
    expect(selected.commit?.master_artboard_url).toBeNull();
    expect(JSON.stringify(selected.currentUrls)).not.toContain("https://files.test/driver-proof");
    expect(layers?.rows[0].branding_url).toBe("https://files.test/old-driver");
    expect(layers?.designViews.side).toBe("https://files.test/old-proof-side");
    expect(layers?.proofUrl).toBeNull();
  });
  it("resolves the default saved revision before requesting views and leaves unknown history empty", async () => {
    const row = await readRevisionStudioDesign("generation");
    expect(row?.atlas_revision_id).toBe(revision.id);
    expect(api.listApprovedViews).toHaveBeenCalledWith("generation", revision.id);
    api.listApprovedViews.mockClear();
    expect(await readRevisionStudioDesign("generation", "missing-revision")).toBeNull();
    const commits = await revisionStudioVersionCommits("generation", "missing-revision");
    expect(commits.every((commit) => commit.angle_renders_json.length === 0)).toBe(true);
    expect(api.listApprovedViews).not.toHaveBeenCalled();
  });
  it("compares a branched revision with its saved parent rather than the previous version number", async () => {
    const branch = { ...revision, id: "atlas-3", revisionSequence: 3, parentRevisionId: oldRevision.id };
    api.listJobFlatAtlasRevisions.mockResolvedValue([oldRevision, revision, branch]);
    api.listApprovedViews.mockImplementation(async (_generationId, revisionId) => [{ ...views[0],
      signedUrl: `https://files.test/proof-${revisionId}`,
      atlasBinding: { revisionId, masterContentHash: revisionId === oldRevision.id ? oldRevision.master.contentHash : master } }]);
    const commits = await revisionStudioVersionCommits("generation", branch.id);
    const selected = buildRevisionVersionTimeline({ commits }).find((entry) => entry.commit?.id === branch.id)!;
    expect(selected.previousKey).toBe(`commit:${oldRevision.id}`);
    expect(selected.previousUrl).toBe(`https://files.test/proof-${oldRevision.id}`);
    expect(selected.currentUrl).toBe(`https://files.test/proof-${branch.id}`);
    expect(api.listApprovedViews.mock.calls.map((call) => call[1]).sort()).toEqual([branch.id, oldRevision.id].sort());
  });
  it("PanelPro refuses the previous unbound-artifact fallback when browsing a named ATLAS revision", () => {
    const unboundPanel = {
      ...panels[0],
      id: "legacy",
      signedUrl: "https://files.test/legacy",
      metadata: {},
    };
    const initial = studioJobFrom({
      job,
      views,
      artifacts: [unboundPanel, ...panels, proof],
      atlasRevisions: [oldRevision, revision],
    });
    const selected = panelProJobAtVersion(initial, {
      revision,
      masterContentHash: master,
      version: 2,
    } as DesignVersion);
    expect(selected.concept_json.qc_side_panels.driver_side.gemini_url).toBe(
      "https://files.test/driver",
    );
    expect(selected.raw_artifacts.some((item) => item.id === "legacy")).toBe(
      false,
    );
    expect(selected.concept_json.flat_proof_url).toBe(
      "https://files.test/call8.png",
    );
  });
  it("PanelPro pairs a selected older panel with that version's independently loaded vehicle proof", async () => {
    const oldView = { ...views[0], signedUrl: "https://files.test/old-driver-proof",
      atlasBinding: { revisionId: oldRevision.id, masterContentHash: oldRevision.master.contentHash } };
    api.listApprovedViews.mockResolvedValue([oldView, ...views]);
    const version = { revisionId: oldRevision.id, generationId: "generation", revision: oldRevision,
      masterContentHash: oldRevision.master.contentHash, version: 1 } as DesignVersion;
    const exactViews = await loadPanelProVersionViews("generation", version);
    expect(api.listApprovedViews).toHaveBeenCalledWith("generation", oldRevision.id);
    const oldPanels = panels.map((panel) => ({ ...panel, id: `old-${panel.id}`,
      signedUrl: `https://files.test/old-${panel.surfaceKey}`,
      metadata: { ...panel.metadata, sourceMasterHash: oldRevision.master.contentHash, revisionId: "manufacturing-1" } }));
    const initial = studioJobFrom({ job, views, artifacts: [...panels, ...oldPanels, proof], atlasRevisions: [oldRevision, revision] });
    const selected = panelProJobAtVersion({ ...initial, raw_views: exactViews }, version);
    expect(selected.raw_views).toEqual([oldView]);
    expect(selected.concept_json.qc_side_panels.driver_side.gemini_url).toBe("https://files.test/old-driver");
    expect(JSON.stringify(selected.all_view_urls)).toContain("https://files.test/old-driver-proof");
    expect(JSON.stringify(selected.all_view_urls)).not.toContain('"https://files.test/driver-proof"');
    expect(await loadPanelProVersionViews("another-generation", version)).toEqual([]);
  });
  it("retains a historical hero as an explicitly read-only proof without relabelling it Close-Up", async () => {
    api.listApprovedViews.mockResolvedValue([{ ...views[0], sourceViewType: "hero-3d", surfaceKey: "hero3d",
      signedUrl: "https://files.test/saved-hero",
      atlasBinding: { revisionId: oldRevision.id, masterContentHash: oldRevision.master.contentHash } }]);
    const row = await readRevisionStudioDesign("generation", oldRevision.id);
    const commits = await revisionStudioVersionCommits("generation", oldRevision.id);
    const selected = buildRevisionVersionTimeline({ commits }).find((entry) => entry.commit?.id === oldRevision.id)!;
    const expected = [{ key: "hero-3d", url: "https://files.test/saved-hero", label: "Historical 3D proof", readOnly: true }];
    expect(historicalStudioProofs(row?.render_urls)).toEqual(expected);
    expect(historicalStudioProofs(selected.currentUrls)).toEqual(expected);
    expect(row?.render_urls["close-up"]).toBeUndefined();
    expect(selected.currentUrls["close-up"]).toBeUndefined();
    expect(historicalStudioProofs({ "hero-3d": "one", hero3d: "different" })).toEqual([]);
  });
});
