import { describe, expect, it } from "vitest";
import type { FlatAtlasCallOnePanel, FlatAtlasRevision } from "@/lib/designpro-api";
import { panelState } from "./SixPanelBoard";

/**
 * `Print panels 6/6` counted FILES. Arctic Air `63e6629a` cut six of them and
 * four were unusable. These lock the distinction the board now draws: a panel's
 * state comes from what the server RECORDED about that surface, never from the
 * fact that an object exists.
 *
 * The fixtures are that run's real verdict — `runtime/atlas-panel-qc.cjs` over
 * its own master, panels and manifest (`docs/ATLAS-PANEL-QC.md` §5).
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

/** Arctic Air's own verdict, per surface. */
const CHECKED = { panelQcContract: "designpro.atlas-panel-qc.v1" };
const DRIVER_CLEAN = {
  ...CHECKED,
  panelQcFailingSurfaces: ["roof", "hood", "front", "rear"],
  panelQcSurfaces: [
    { surfaceKey: "driver", ok: true, elementsIntact: ["yeti shield lockup"], findings: [] },
  ],
};
const REAR_SEVERED = {
  ...CHECKED,
  panelQcFailingSurfaces: ["roof", "hood", "front", "rear"],
  panelQcSurfaces: [
    {
      surfaceKey: "rear",
      ok: false,
      elementsIntact: [],
      elementsSevered: ["www.arcticair.com contact banner"],
      findings: [{
        code: "atlas_panel_element_severed",
        surfaceKey: "rear",
        element: "www.arcticair.com contact banner",
        edges: ["left", "top"],
        acrossSurfaces: ["hood", "front", "rear"],
        detail: "the element is cut across 3 surfaces (hood, front, rear)",
      }],
    },
  ],
};

describe("panelState", () => {
  it("refuses to call a revision that was never panel-checked clean", () => {
    // The overclaim this replaces: sufficient PPI and no recorded cut-out
    // repair once returned "structurally clean" without ever asking whether the
    // customer's wordmark survived the cut.
    const state = panelState(panel({ effectivePpi: 400 }), revision());
    expect(state.tone).toBe("warn");
    expect(state.label).toBe("not panel-checked");
  });

  it("never reports a pass when the locator was unavailable", () => {
    const state = panelState(
      panel({ effectivePpi: 400 }),
      revision({ ...DRIVER_CLEAN, panelQcUnavailable: "provider unreachable" }),
    );
    expect(state.tone).toBe("warn");
    expect(state.label).toBe("not panel-checked");
    expect(state.reason).toContain("provider unreachable");
  });

  it("fails the rear panel by name, naming the element and the edges — Arctic Air's real defect", () => {
    const state = panelState(panel({ surfaceKey: "rear", effectivePpi: 400 }), revision(REAR_SEVERED));
    expect(state.tone).toBe("fail");
    expect(state.label).toBe("element cut off");
    expect(state.reason).toContain("www.arcticair.com contact banner");
    expect(state.reason).toContain("left and top");
  });

  it("a severed element outranks every structural signal, however good they are", () => {
    // 400 PPI and no cut-out repair. Structure is perfect and the panel still
    // reads `ticAir.com`.
    const state = panelState(
      panel({ surfaceKey: "rear", effectivePpi: 400 }),
      revision({ ...REAR_SEVERED, masterCutoutSurfaces: [] }),
    );
    expect(state.tone).toBe("fail");
  });

  it("reports Arctic Air's real density as below the print target once the elements are intact", () => {
    const state = panelState(panel(), revision(DRIVER_CLEAN));
    expect(state.tone).toBe("warn");
    expect(state.label).toBe("below print density");
    expect(state.reason).toContain("22.61 PPI");
  });

  it("surfaces a repaired cut-out with the measurement that convicted it", () => {
    const state = panelState(
      panel({ surfaceKey: "roof", effectivePpi: 200 }),
      revision({
        ...CHECKED,
        panelQcSurfaces: [{ surfaceKey: "roof", ok: true, elementsIntact: [], findings: [] }],
        masterCutoutSurfaces: ["front", "roof"],
        cutoutFillApplied: [{ surfaceKey: "roof", pixels: 47_847, components: 3, zoneFraction: 0.037013, unresolvedPixels: 0 }],
      }),
    );
    expect(state.tone).toBe("warn");
    expect(state.label).toBe("repaired — human QC required");
    expect(state.reason).toContain("47,847");
    expect(state.reason).toContain("3.70%");
  });

  it("a bare surface reads as clean when nothing was cut — it is not a defect on its own", () => {
    // RULE 0.28: not every surface must carry a mark. What must never happen is
    // a mark HALF on it.
    const state = panelState(
      panel({ surfaceKey: "front", effectivePpi: 400 }),
      revision({ ...CHECKED, panelQcSurfaces: [{ surfaceKey: "front", ok: true, elementsIntact: [], findings: [] }] }),
    );
    expect(state.tone).toBe("ok");
    expect(state.label).toBe("ground only — clean");
  });

  it("only a checked, uncut, dense panel reads as intact", () => {
    const state = panelState(panel({ effectivePpi: 150 }), revision(DRIVER_CLEAN));
    expect(state.tone).toBe("ok");
    expect(state.label).toBe("elements intact");
    expect(state.reason).toContain("yeti shield lockup");
  });

  it("a panel cut to the wrong shape fails even with every element intact", () => {
    const state = panelState(
      panel({ effectivePpi: 400 }),
      revision({
        ...CHECKED,
        panelQcSurfaces: [{
          surfaceKey: "driver", ok: false, elementsIntact: ["yeti shield lockup"],
          findings: [{ code: "atlas_panel_print_aspect_mismatch", surfaceKey: "driver", detail: "the panel is 0.30:1 and driver prints 3.35:1" }],
        }],
      }),
    );
    expect(state.tone).toBe("fail");
    expect(state.label).toBe("wrong shape for this surface");
  });
});
