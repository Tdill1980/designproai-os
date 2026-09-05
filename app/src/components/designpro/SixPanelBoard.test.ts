import { describe, expect, it } from "vitest";
import type { FlatAtlasCallOnePanel, FlatAtlasRevision } from "@/lib/designpro-api";
import { panelState } from "./SixPanelBoard";

/**
 * `Print panels 6/6` counted FILES. Arctic Air `63e6629a` cut six of them and
 * every one was unusable. These lock the distinction the board now draws: a
 * panel's state comes from what the server RECORDED about that surface, never
 * from the fact that an object exists.
 */
const panel = (over: Partial<FlatAtlasCallOnePanel> = {}): FlatAtlasCallOnePanel => ({
  surfaceKey: "driver",
  contentHash: "0af8ddf2ea06bbe20674b316960f8c76a70f928d7efd69b6d40c456a37b2e0ae",
  contentType: "image/png",
  byteSize: 11_652_897,
  pixelWidth: 4096,
  pixelHeight: 1221,
  trimWidthIn: 171.1,
  trimHeightIn: 44,
  printWidthIn: 181.1,
  printHeightIn: 54,
  bleedInches: 5,
  surfaceSqFt: 52.28,
  effectivePpi: 22.61,
  geometryPurpose: "calls-1-7-layout-only",
  sourceMasterHash: "10779204b1d30cb30252ba03804099d97742697d9fca422dd7c6339fc36d2918",
  ...over,
});

const revision = (qc: Partial<NonNullable<FlatAtlasRevision["qc"]>> = {}) =>
  ({ qc: { masterCutoutSurfaces: [], cutoutFillApplied: [], ...qc } } as unknown as FlatAtlasRevision);

describe("panelState", () => {
  it("reports Arctic Air's real density as below the print target, not as a pass", () => {
    // 22.61 PPI on the flanks, 16.35 on the front -- measured on the live run.
    const state = panelState(panel(), revision());
    expect(state.tone).toBe("warn");
    expect(state.label).toBe("below print density");
    expect(state.reason).toContain("22.61 PPI");
    expect(state.reason).toContain("150 PPI target");
  });

  it("surfaces a repaired cut-out with the measurement that convicted it", () => {
    const state = panelState(
      panel({ surfaceKey: "roof", effectivePpi: 200 }),
      revision({
        masterCutoutSurfaces: ["front", "roof"],
        cutoutFillApplied: [{ surfaceKey: "roof", pixels: 47_847, components: 3, zoneFraction: 0.037013, unresolvedPixels: 0 }],
      }),
    );
    expect(state.tone).toBe("warn");
    expect(state.label).toBe("repaired — human QC required");
    expect(state.reason).toContain("47,847");
    expect(state.reason).toContain("3 components");
    expect(state.reason).toContain("3.70%");
  });

  it("a repaired surface is never reported clean, however dense it is", () => {
    const dense = panelState(
      panel({ surfaceKey: "front", effectivePpi: 400 }),
      revision({ masterCutoutSurfaces: ["front"] }),
    );
    expect(dense.tone).not.toBe("ok");
  });

  it("only an unrepaired panel at print density reads as clean", () => {
    const state = panelState(panel({ effectivePpi: 150 }), revision());
    expect(state.tone).toBe("ok");
    expect(state.label).toBe("structurally clean");
  });

  it("treats a revision with no QC record as unproven rather than passing", () => {
    // A historical row carries no composition or cut-out metadata. It must not
    // be upgraded to "clean" by the absence of evidence -- the density check is
    // still real, and it is the one that fires.
    const state = panelState(panel(), { } as FlatAtlasRevision);
    expect(state.tone).toBe("warn");
  });
});
