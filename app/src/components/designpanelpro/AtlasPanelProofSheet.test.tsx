import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AtlasPanelProofSheet, panelProofBelongsToOtherRevision, panelProofRefreshInterval } from "./AtlasPanelProofSheet";
import type { AtlasPanelProof, PanelProofPanel } from "@/lib/designpro-api";

const SURFACES = ["driver", "passenger", "hood", "roof", "front", "rear"];
const CUT_SLOTS = ["logo", "tagline", "contact", "promo", "icons"];

function panel(over: Partial<PanelProofPanel> & Pick<PanelProofPanel, "surfaceKey" | "role">): PanelProofPanel {
  return {
    byteSize: 90000,
    fit: 0.98,
    widthIn: 163.2,
    heightIn: 66.1,
    persisted: true,
    signedUrl: `https://signed.example/${over.role}/${over.surfaceKey}`,
    ...over,
  };
}

function proof(over: Partial<AtlasPanelProof> = {}): AtlasPanelProof {
  return {
    requestId: "10000000-0000-4000-8000-000000000001",
    revisionId: "70000000-0000-4000-8000-000000000001",
    panelProof: true,
    sheet: { contentHash: "1".repeat(64), signedUrl: "https://signed.example/sheet", expiresIn: 300 },
    quadrants: {
      branded: SURFACES.map((surfaceKey) => panel({ surfaceKey, role: "branded", signedUrl: undefined })),
      clean: SURFACES.map((surfaceKey) => panel({ surfaceKey, role: "clean" })),
      cutGraphics: CUT_SLOTS.map((surfaceKey) => panel({
        // A cut graphic is sized at the plotter, so it has NO inches.
        surfaceKey, role: "cut-graphic", widthIn: null, heightIn: null, fit: 0.24,
      })),
    },
    ...over,
  };
}

describe("AtlasPanelProofSheet", () => {
  it("shows a completed three-zone proof before any accepted revision or 3D view", () => {
    const early = proof({ revisionId: null, masterContentHash: null });
    const html = renderToStaticMarkup(<AtlasPanelProofSheet proof={early} status="success" />);
    expect(html).toContain("https://signed.example/sheet");
    expect(html).toContain("Zone 1 — print panels");
    expect(html).toContain("Zone 2 — panels without type or logos");
    expect(html).toContain("Zone 3 — logo, text and graphic elements");
    expect(html).not.toContain("These are what get printed");
    expect(panelProofRefreshInterval({ ...early, panelProof: false }, true)).toBe(1_000);
    expect(panelProofRefreshInterval(early, true)).toBe(240_000);
    expect(panelProofRefreshInterval(undefined, false)).toBe(false);
  });

  it("shows branded panels using bounded regions of their own composed sheet", () => {
    const p = proof();
    p.sheet!.geometry = { width: 1536, height: 1024 };
    p.quadrants!.branded = SURFACES.map((surfaceKey) => panel({ surfaceKey, role: "branded", signedUrl: undefined,
      sheetRect: { left: 30, top: 140, width: 250, height: 90 } }));
    const html = renderToStaticMarkup(<AtlasPanelProofSheet proof={p} status="success" />);
    expect((html.match(/viewBox="30 140 250 90"/g) || [])).toHaveLength(6);
    expect((html.match(/<image href="https:\/\/signed.example\/sheet"/g) || [])).toHaveLength(6);
    expect(html).not.toContain("Shown on the master sheet above");
    p.quadrants!.branded[0].sheetRect!.left = 1500;
    const invalid = renderToStaticMarkup(<AtlasPanelProofSheet proof={p} status="success" />);
    expect((invalid.match(/<image href=/g) || [])).toHaveLength(5);
    expect(invalid).toContain("Shown on the master sheet above");
  });

  it("shows all three zones from the one sheet, with the sheet itself", () => {
    const html = renderToStaticMarkup(<AtlasPanelProofSheet proof={proof()} status="success" />);
    expect(html).toContain("https://signed.example/sheet");
    expect(html).toContain("Zone 1 — print panels");
    expect(html).toContain("Zone 2 — panels without type or logos");
    expect(html).toContain("Zone 3 — logo, text and graphic elements");
    // Every Zone 2 panel and every Zone 3 element is present and named.
    for (const surfaceKey of SURFACES) {
      expect(html).toContain(`https://signed.example/clean/${surfaceKey}`);
    }
    expect(html).toContain("Primary logo");
    expect(html).toContain("Icons / service graphics");
    for (const surfaceKey of CUT_SLOTS) {
      expect(html).toContain(`https://signed.example/cut-graphic/${surfaceKey}`);
    }
  });

  it("never prints a dimension a cut graphic does not have", () => {
    // A Zone 3 slot carries widthIn/heightIn null BY CONTRACT. The bug this
    // pins is the one already found one layer down in the gateway: Number(null)
    // is 0, so a naive reader reports every cut graphic as 0" x 0" and a UI
    // prints it as a real size.
    const html = renderToStaticMarkup(<AtlasPanelProofSheet proof={proof()} status="success" />);
    expect(html).not.toContain('0" × 0"');
    expect(html).not.toContain("0&quot; × 0&quot;");
    // The panels that DO have inches still state them.
    expect(html).toContain("163.2");
  });

  it("states why an unstored panel has no image instead of showing a gap", () => {
    // The quadrant write fails soft on purpose (Zone 1 is an accepted master by
    // then). A silent gap would read as a broken design.
    const p = proof();
    p.quadrants!.clean[0] = panel({
      surfaceKey: "driver", role: "clean", persisted: false,
      reason: "storage_quota_exceeded", signedUrl: undefined,
    });
    const html = renderToStaticMarkup(<AtlasPanelProofSheet proof={p} status="success" />);
    expect(html).toContain("storage_quota_exceeded");
    expect(html).toContain("not saved");
  });

  it("does not promise a vector cut file for a raster element", () => {
    // The owner's instruction, verbatim: do not represent raster crops as
    // editable layers or vector cut files. Original raster uploads remain raster;
    // production contours still require downstream validation.
    const html = renderToStaticMarkup(<AtlasPanelProofSheet proof={proof()} status="success" />);
    expect(html).not.toMatch(/editable layer/i);
    expect(html).not.toMatch(/vector file|\.svg|\.eps/i);
    expect(html).toContain("Plotter-ready contours are validated in the production pack");
  });

  it("renders nothing for a run with no three-zone document, and nothing on error", () => {
    // A six-surface / field / hero-driver revision is a real design with no
    // panel proof. That is routing, not failure, and must not print a warning.
    expect(renderToStaticMarkup(
      <AtlasPanelProofSheet proof={{ requestId: "r", revisionId: null, panelProof: false }} status="success" />,
    )).toBe("");
    expect(renderToStaticMarkup(<AtlasPanelProofSheet proof={undefined} status="error" />)).toBe("");
  });

  it("treats an unbound proof (revisionId null) as this request's, never as another revision's", () => {
    // The RPC's `call1_graph` branch answers `panelProof: true, revisionId: null`
    // before the revision row lands. A revision is its own generation request,
    // so `requestId` already names it; only a NON-NULL id naming another
    // revision is a mismatch. The old guard compared null !== "70…01" and printed
    // "The production proof belongs to a different revision." over a live proof.
    const pinned = "70000000-0000-4000-8000-000000000001";
    expect(panelProofBelongsToOtherRevision(proof({ revisionId: null }), pinned)).toBe(false);
    expect(panelProofBelongsToOtherRevision(proof({ revisionId: pinned }), pinned)).toBe(false);
    expect(panelProofBelongsToOtherRevision(proof({ revisionId: "70000000-0000-4000-8000-000000000002" }), pinned)).toBe(true);
    // Nothing pinned, or no proof yet: nothing to mismatch.
    expect(panelProofBelongsToOtherRevision(proof({ revisionId: "70000000-0000-4000-8000-000000000002" }), undefined)).toBe(false);
    expect(panelProofBelongsToOtherRevision(undefined, pinned)).toBe(false);
    expect(panelProofBelongsToOtherRevision({ panelProof: false, revisionId: "x" }, pinned)).toBe(false);
  });

  it("keeps the panels when the sheet itself cannot be previewed", () => {
    const p = proof({ sheet: { contentHash: "1".repeat(64) } });
    const html = renderToStaticMarkup(<AtlasPanelProofSheet proof={p} status="success" />);
    expect(html).toContain("The panels below are unaffected");
    expect(html).toContain("https://signed.example/clean/driver");
  });
});
