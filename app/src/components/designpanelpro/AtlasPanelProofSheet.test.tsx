import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AtlasPanelProofSheet } from "./AtlasPanelProofSheet";
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
    // editable layers or vector cut files. Zone 3 is drawn marks; the contour
    // is produced downstream.
    const html = renderToStaticMarkup(<AtlasPanelProofSheet proof={proof()} status="success" />);
    expect(html).not.toMatch(/editable layer/i);
    expect(html).not.toMatch(/vector file|\.svg|\.eps/i);
    expect(html).toContain("Plotter-ready contours are produced in the production pack");
  });

  it("renders nothing for a run with no three-zone document, and nothing on error", () => {
    // A six-surface / field / hero-driver revision is a real design with no
    // panel proof. That is routing, not failure, and must not print a warning.
    expect(renderToStaticMarkup(
      <AtlasPanelProofSheet proof={{ requestId: "r", revisionId: null, panelProof: false }} status="success" />,
    )).toBe("");
    expect(renderToStaticMarkup(<AtlasPanelProofSheet proof={undefined} status="error" />)).toBe("");
  });

  it("keeps the panels when the sheet itself cannot be previewed", () => {
    const p = proof({ sheet: { contentHash: "1".repeat(64) } });
    const html = renderToStaticMarkup(<AtlasPanelProofSheet proof={p} status="success" />);
    expect(html).toContain("The panels below are unaffected");
    expect(html).toContain("https://signed.example/clean/driver");
  });
});
