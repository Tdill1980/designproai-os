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
  const composed = { composeContract: "designpro.atlas-compose-master.v1", elementPlanContract: "designpro.atlas-element-plan.v1" };
  const placed = [{ surfaceKey: "driver", kind: "wordmark", elementId: "wordmark@driver" }];

  it("refuses to call a pre-composition revision clean", () => {
    // The overclaim this replaces: sufficient PPI and no recorded cut-out
    // repair once returned "structurally clean" without ever asking whether the
    // customer's name landed on the panel.
    const state = panelState(panel({ effectivePpi: 400 }), revision());
    expect(state.tone).toBe("warn");
    expect(state.label).toBe("not composition-checked");
  });

  it("fails every panel when requested artwork could not be produced", () => {
    const state = panelState(
      panel({ effectivePpi: 400 }),
      revision({ ...composed, elementPlacements: placed, elementsReceipt: { unresolved: [{ reason: "atlas_elements_call_failed" }] } }),
    );
    expect(state.tone).toBe("fail");
    expect(state.label).toBe("requested artwork missing");
  });

  it("names an element the layout had to leave off, with the number that decided it", () => {
    const state = panelState(
      panel({ effectivePpi: 400 }),
      revision({ ...composed, elementPlacements: placed, elementPlacementsSkipped: [{ surfaceKey: "driver", kind: "tagline", reason: "below_minimum_legible_height", heightIn: 0.9, minHeightIn: 1.5 }] }),
    );
    expect(state.tone).toBe("warn");
    expect(state.reason).toContain("0.9″");
    expect(state.reason).toContain("1.5″");
  });

  it("reports Arctic Air's real density as below the print target", () => {
    const state = panelState(panel(), revision({ ...composed, elementPlacements: placed }));
    expect(state.tone).toBe("warn");
    expect(state.label).toBe("below print density");
    expect(state.reason).toContain("22.61 PPI");
  });

  it("surfaces a repaired cut-out with the measurement that convicted it", () => {
    const state = panelState(
      panel({ surfaceKey: "roof", effectivePpi: 200 }),
      revision({
        ...composed,
        elementPlacements: [{ surfaceKey: "roof", kind: "wordmark", elementId: "wordmark@roof" }],
        masterCutoutSurfaces: ["front", "roof"],
        cutoutFillApplied: [{ surfaceKey: "roof", pixels: 47_847, components: 3, zoneFraction: 0.037013, unresolvedPixels: 0 }],
      }),
    );
    expect(state.tone).toBe("warn");
    expect(state.label).toBe("repaired — human QC required");
    expect(state.reason).toContain("47,847");
    expect(state.reason).toContain("3.70%");
  });

  it("calls out a structurally perfect panel that carries nothing — Arctic Air's front", () => {
    const state = panelState(
      panel({ surfaceKey: "front", effectivePpi: 400 }),
      revision({ ...composed, elementPlacements: placed }),
    );
    expect(state.tone).toBe("warn");
    expect(state.label).toBe("ground only");
  });

  it("only a composed, dressed, dense, unrepaired panel reads as clean", () => {
    const state = panelState(panel({ effectivePpi: 150 }), revision({ ...composed, elementPlacements: placed }));
    expect(state.tone).toBe("ok");
    expect(state.label).toBe("composed and clean");
    expect(state.reason).toContain("1 element placed");
  });
});
