// QC MUST NAME THE PANEL AND THE CHECK, AND MUST NEVER PASS A CONTRADICTION.
//
// Owner (Trish 2026-08-29): "If QC fails, keep me in PanelProStudio and tell me
// exactly which panel/check failed." So every failing row carries its
// surfaceKey, and the report publishes `failedSurfaces` for the board to flag.
//
// The fixtures below are the real defect shapes this pipeline has produced:
// a panel bound to a different master, six surfaces sharing one set of bytes,
// a bleed that is declared but not present in the print geometry.
import { describe, expect, it } from "vitest";
import { buildPanelQcReport } from "./designpro-panel-qc";
import type { FlatAtlasCallOnePanel, FlatAtlasRevision } from "./designpro-api";
// Value import from the dependency-free module — importing it from the API
// barrel would construct a Supabase client (and read `localStorage`) just to
// get six strings, which is the coupling this module was split to remove.
import { PRODUCTION_SURFACES } from "./designpro-surfaces";

const MASTER = "a".repeat(64);
const hashFor = (index: number) => String(index).repeat(64).slice(0, 64);

function panel(
  surfaceKey: string,
  index: number,
  overrides: Partial<FlatAtlasCallOnePanel> = {},
): FlatAtlasCallOnePanel {
  return {
    surfaceKey: surfaceKey as never,
    contentHash: hashFor(index),
    contentType: "image/png",
    byteSize: 4_194_304,
    // The pixel aspect MUST match the print aspect (269.8 / 67.6 = 3.991), or
    // every panel legitimately fails panelization — which is the check doing
    // its job, and was the first thing this fixture got wrong.
    pixelWidth: 2395,
    pixelHeight: 600,
    trimWidthIn: 259.8,
    trimHeightIn: 57.6,
    printWidthIn: 269.8,
    printHeightIn: 67.6,
    bleedInches: 5,
    surfaceSqFt: 103.9,
    effectivePpi: 8.9,
    geometryPurpose: "calls-1-7-layout-only",
    sourceMasterHash: MASTER,
    signedUrl: "https://example.invalid/signed.png",
    ...overrides,
  } as FlatAtlasCallOnePanel;
}

function revision(panels: FlatAtlasCallOnePanel[]): FlatAtlasRevision {
  return {
    id: "atlas-rev-1",
    generationId: "gen-1",
    revisionSequence: 1,
    parentRevisionId: null,
    guide: { contentHash: "b".repeat(64), contentType: "image/png", byteSize: 1, widthPx: 4096, heightPx: 4096 },
    manifest: { contentHash: "c".repeat(64), contentType: "application/json", byteSize: 1 },
    master: { contentHash: MASTER, contentType: "image/png", byteSize: 1, widthPx: 4096, heightPx: 4096, effectivePpi: 16 },
    projection: { contentHash: "d".repeat(64), contentType: "image/jpeg", byteSize: 1 },
    model: "gemini-3-pro-image",
    promptVersion: "atlas-artboard-designiq.20260828.v8-clean",
    qc: { masterQcPassed: true, masterAuthoringAttempts: 1, masterCutoutSurfaces: [] },
    affectedSurfaces: [],
    panelMap: [],
    callOnePanels: panels,
  } as unknown as FlatAtlasRevision;
}

const sixGood = () => PRODUCTION_SURFACES.map((key, index) => panel(key, index + 1));

// The published artifacts a healthy job carries: six Call-9 panels promoted
// byte-for-byte from the flat surfaces, and one Call-8 proof naming those same
// six hashes. Both are DESCENDANTS — neither carries bytes of its own.
const publishedFor = (panels: FlatAtlasCallOnePanel[]) => [
  ...panels.map((panel) => ({
    kind: "panel",
    surfaceKey: panel.surfaceKey as string,
    contentHash: panel.contentHash,
    metadata: { source: "atlas-call1-panel", promotedFrom: "atlas-call1", deterministic: true },
  })),
  {
    kind: "flat-proof",
    surfaceKey: "",
    contentHash: "f".repeat(64),
    metadata: {
      assembledFrom: "atlas-call1-panels",
      deterministic: true,
      sourcePanelHashes: Object.fromEntries(panels.map((p) => [p.surfaceKey, p.contentHash])),
    },
  },
];

const report = (
  panels: FlatAtlasCallOnePanel[],
  artifacts: ReturnType<typeof publishedFor> = publishedFor(panels),
) => buildPanelQcReport({ generationId: "gen-1", revision: revision(panels), artifacts });

describe("full panel QC", () => {
  it("passes a clean six-panel set and reports every required check", () => {
    const result = report(sixGood());
    expect(result.passed).toBe(true);
    expect(result.failures).toHaveLength(0);
    expect(result.failedSurfaces).toEqual([]);
    const ids = result.checks.map((row) => row.id);
    for (const required of [
      "job.six-surfaces", "job.master", "job.master-qc", "job.distinct-panels",
      "job.cutout-repair", "job.production-proof", "job.call9-panels",
    ]) expect(ids).toContain(required);
    for (const surface of PRODUCTION_SURFACES) {
      for (const suffix of ["ancestry", "hash", "readable", "dimensions", "bleed", "resolution", "panelization"]) {
        expect(ids).toContain(`${surface}.${suffix}`);
      }
    }
  });

  it("an empty panel set is PRODUCTION PANELS NOT CREATED, in those words", () => {
    const result = report([], []);
    expect(result.passed).toBe(false);
    expect(result.checks.find((row) => row.id === "job.six-surfaces")!.detail)
      .toMatch(/PRODUCTION PANELS NOT CREATED/);
  });

  it("a panel from another master fails ancestry and names the surface", () => {
    const panels = sixGood();
    panels[2] = panel("hood", 3, { sourceMasterHash: "9".repeat(64) });
    const result = report(panels);
    expect(result.passed).toBe(false);
    expect(result.failedSurfaces).toEqual(["hood"]);
    const failure = result.failures.find((row) => row.id === "hood.ancestry")!;
    expect(failure.surfaceKey).toBe("hood");
    expect(failure.label).toBe("Master ancestry");
    expect(failure.detail).toContain(MASTER.slice(0, 12));
  });

  it("six surfaces sharing one set of bytes is caught, though each panel is individually fine", () => {
    // This is the failure mode that would print the driver's artwork on every
    // side of the vehicle while passing every per-panel check.
    const shared = PRODUCTION_SURFACES.map((key) => panel(key, 1));
    const result = report(shared);
    expect(result.passed).toBe(false);
    const distinct = result.failures.find((row) => row.id === "job.distinct-panels")!;
    expect(distinct.detail).toMatch(/share only 1 distinct/);
  });

  it("a declared bleed that the print geometry contradicts is a failure", () => {
    const panels = sixGood();
    // Says 5" but the print size is only trim + 1" per edge.
    panels[0] = panel("driver", 1, { printWidthIn: 261.8, printHeightIn: 59.6 });
    const result = report(panels);
    expect(result.passed).toBe(false);
    const bleed = result.failures.find((row) => row.id === "driver.bleed")!;
    expect(bleed.detail).toMatch(/not 5"/);
  });

  it("a wrong bleed value is a failure even when the geometry agrees with it", () => {
    const panels = sixGood();
    panels[1] = panel("passenger", 2, {
      bleedInches: 2, printWidthIn: 263.8, printHeightIn: 61.6,
    });
    const result = report(panels);
    expect(result.failures.some((row) => row.id === "passenger.bleed")).toBe(true);
  });

  it("a stretched crop is caught by panelization, not excused as resolution", () => {
    const panels = sixGood();
    panels[3] = panel("roof", 4, { pixelWidth: 600, pixelHeight: 600 });
    const result = report(panels);
    expect(result.failures.some((row) => row.id === "roof.panelization")).toBe(true);
  });

  it("an unsignable or empty asset fails readability", () => {
    const panels = sixGood();
    panels[4] = panel("front", 5, { signedUrl: undefined });
    expect(report(panels).failures.some((row) => row.id === "front.readable")).toBe(true);
  });

  it("working resolution WARNS and never blocks — print res comes from the upscale", () => {
    const result = report(sixGood());
    const resolution = result.checks.find((row) => row.id === "driver.resolution")!;
    expect(resolution.outcome).toBe("pass");
    expect(resolution.detail).toMatch(/Working resolution/);
    // Even a genuinely tiny panel only warns, so a correct architecture is
    // never convicted by a check that misunderstands it.
    const tiny = sixGood();
    tiny[0] = panel("driver", 1, { effectivePpi: 2 });
    const tinyReport = report(tiny);
    expect(tinyReport.checks.find((row) => row.id === "driver.resolution")!.outcome).toBe("warn");
    expect(tinyReport.passed).toBe(true);
  });

  it("colour mode reports its stage instead of claiming CMYK over an RGB panel", () => {
    const colour = report(sixGood()).checks.find((row) => row.id === "driver.colour")!;
    expect(colour.outcome).toBe("not_applicable_yet");
    expect(colour.detail).toMatch(/CMYK is produced by the post-purchase print build/);
  });

  it("a repaired cut-out warns for template review and does not block", () => {
    const base = revision(sixGood());
    const result = buildPanelQcReport({
      generationId: "gen-1",
      revision: { ...base, qc: { ...base.qc, masterCutoutSurfaces: ["driver", "passenger"] } } as FlatAtlasRevision,
      artifacts: publishedFor(sixGood()),
    });
    expect(result.passed).toBe(true);
    expect(result.warnings.some((row) => row.id === "job.cutout-repair")).toBe(true);
  });

  it("a missing 2D proof warns — it is a later artifact and does not gate panels", () => {
    const result = report(sixGood(), []);
    expect(result.passed).toBe(true);
    expect(result.warnings.some((row) => row.id === "job.production-proof")).toBe(true);
    // Same for unpublished panels: before Call 9 there is nothing to convict.
    expect(result.warnings.some((row) => row.id === "job.call9-panels")).toBe(true);
  });

  // ── THE LINEAGE ROWS ─────────────────────────────────────────────────────
  // Owner (Trish 2026-08-30): "make both Call 8 proof and Call 9 panels
  // descendants of those same six hashes." These two are what turn that
  // sentence into something the report can be wrong about.

  it("a production panel that is not the flat surface's own bytes FAILS, and is named", () => {
    // The exact shape of the defect: a panel published under the right
    // surfaceKey, carrying every other marking, cut from something else.
    const panels = sixGood();
    const artifacts = publishedFor(panels);
    artifacts[2] = { ...artifacts[2], contentHash: "e".repeat(64) };
    const result = report(panels, artifacts);
    expect(result.passed).toBe(false);
    const row = result.failures.find((r) => r.id === "job.call9-panels")!;
    expect(row.detail).toContain("hood");
  });

  it("a production panel that does not declare the Call-1 source FAILS even on matching bytes", () => {
    const panels = sixGood();
    const artifacts = publishedFor(panels);
    artifacts[0] = { ...artifacts[0], metadata: { source: "proof-region" } };
    const result = report(panels, artifacts);
    expect(result.failures.some((r) => r.id === "job.call9-panels")).toBe(true);
  });

  it("a panel published for a surface this revision never cut has no flat source, and FAILS", () => {
    const panels = sixGood().slice(0, 5);
    const artifacts = publishedFor(sixGood());
    const result = report(panels, artifacts);
    expect(result.failures.find((r) => r.id === "job.call9-panels")!.detail)
      .toContain("no flat surface on this revision");
  });

  it("a 2D proof assembled from anything but the six flat surfaces FAILS", () => {
    const panels = sixGood();
    const artifacts = publishedFor(panels);
    artifacts[6] = { ...artifacts[6], metadata: { assembledFrom: "gemini-flat-surface" } };
    const result = report(panels, artifacts);
    expect(result.passed).toBe(false);
    expect(result.failures.find((r) => r.id === "job.production-proof")!.detail)
      .toContain("gemini-flat-surface");
  });

  it("a 2D proof naming different bytes for one surface FAILS, and says which", () => {
    const panels = sixGood();
    const artifacts = publishedFor(panels);
    const claimed = { ...(artifacts[6].metadata as Record<string, unknown>) };
    claimed.sourcePanelHashes = {
      ...(claimed.sourcePanelHashes as Record<string, string>), roof: "e".repeat(64),
    };
    artifacts[6] = { ...artifacts[6], metadata: claimed };
    const result = report(panels, artifacts);
    expect(result.failures.find((r) => r.id === "job.production-proof")!.detail).toContain("roof");
  });
});
