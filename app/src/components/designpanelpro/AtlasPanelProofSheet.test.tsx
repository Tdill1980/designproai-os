import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AtlasPanelProofSheet, PROOF_DISPLAY_SIZE, fitProofPanel,
  PANEL_PROOF_POLL_MS, PANEL_PROOF_URL_REFRESH_MS,
  panelProofBelongsToOtherRevision, panelProofRefreshInterval,
  panelProofRendered, panelProofStillLanding,
} from "./AtlasPanelProofSheet";
import type { AtlasPanelProof, PanelProofPanel } from "@/lib/designpro-api";

const SURFACES = ["driver", "passenger", "hood", "roof", "front", "rear"];
const CUT_SLOTS = ["logo", "tagline", "contact", "promo", "icons"];
function panel(over: Partial<PanelProofPanel> & Pick<PanelProofPanel, "surfaceKey" | "role">): PanelProofPanel {
  return { byteSize: 90000, fit: 0.98, widthIn: 163.2, heightIn: 66.1, persisted: true,
    signedUrl: `https://signed.example/${over.role}/${over.surfaceKey}`, ...over };
}
function proof(over: Partial<AtlasPanelProof> = {}): AtlasPanelProof {
  return {
    requestId: "10000000-0000-4000-8000-000000000001",
    revisionId: "70000000-0000-4000-8000-000000000001", panelProof: true,
    sheet: { contentHash: "1".repeat(64), signedUrl: "https://signed.example/sheet", expiresIn: 300,
      geometry: { width: 1536, height: 1024 } },
    quadrants: {
      branded: SURFACES.map((surfaceKey, i) => panel({ surfaceKey, role: "branded", signedUrl: undefined,
        sheetRect: { left: 30 + i * 240, top: 140, width: 230, height: 90 } })),
      clean: SURFACES.map(surfaceKey => panel({ surfaceKey, role: "clean" })),
      cutGraphics: CUT_SLOTS.map(surfaceKey => panel({ surfaceKey, role: "cut-graphic", widthIn: null, heightIn: null, fit: 0.24 })),
    }, ...over,
  };
}
const htmlFor = (p: AtlasPanelProof | undefined, status: "pending" | "success" | "error" = "success") =>
  renderToStaticMarkup(<AtlasPanelProofSheet proof={p} status={status} />);

describe("AtlasPanelProofSheet", () => {
  it("shows one 16:9 three-zone proof before any accepted revision or 3D view", () => {
    const html = htmlFor(proof({ revisionId: null, masterContentHash: null }));
    expect(PROOF_DISPLAY_SIZE.width / PROOF_DISPLAY_SIZE.height).toBe(16 / 9);
    expect((html.match(/viewBox="0 0 1600 900"/g) || [])).toHaveLength(1);
    expect((html.match(/data-proof-panel=/g) || [])).toHaveLength(17);
    for (const label of ["Zone 1 — print panels", "Zone 2 — panels without type or logos", "Zone 3 — logo, text and graphic elements"])
      expect((html.split(label).length - 1)).toBe(1);
    expect(html).not.toMatch(/<ul|<li/);
    expect(html).toContain("https://signed.example/sheet");
  });

  it("fits real physical panel ratios without changing dimensions or artwork", () => {
    for (const [w, h] of [[233, 67.46], [79.28, 75.43], [142.5, 44]]) {
      const fit = fitProofPanel(w, h, 410, 174)!;
      expect(fit.width / fit.height).toBeCloseTo(w / h, 10);
      expect(fit.width).toBeLessThanOrEqual(410);
      expect(fit.height).toBeLessThanOrEqual(174);
    }
    const roof = fitProofPanel(79.28, 75.43, 164, 174)!;
    expect(roof.width).toBeGreaterThan(roof.height);
    for (const bad of [null, undefined, 0, -1, NaN, Infinity]) expect(fitProofPanel(bad, 60, 410, 174)).toBeNull();
    const p = proof(), before = JSON.stringify(p); htmlFor(p); expect(JSON.stringify(p)).toBe(before);
  });

  it("keeps one-second landing and five-minute signed-link renewal behavior", () => {
    expect(PANEL_PROOF_POLL_MS).toBe(1_000);
    for (const state of ["queued", "leased", "retryable"]) expect(panelProofStillLanding(state)).toBe(true);
    for (const state of ["outputs_ready", "failed", "cancelled", "", null, undefined]) expect(panelProofStillLanding(state)).toBe(false);
    expect(panelProofRefreshInterval(undefined, true)).toBe(PANEL_PROOF_POLL_MS);
    expect(panelProofRefreshInterval({ requestId: "r", revisionId: null, panelProof: false }, true)).toBe(PANEL_PROOF_POLL_MS);
    expect(panelProofRefreshInterval(undefined, false)).toBe(false);
    expect(panelProofRendered(proof())).toBe(true);
    expect(panelProofRendered({ ...proof(), sheet: { contentHash: "1".repeat(64) } })).toBe(false);
    expect(panelProofRefreshInterval(proof(), true)).toBe(PANEL_PROOF_URL_REFRESH_MS);
    expect(panelProofRefreshInterval(proof(), false)).toBe(PANEL_PROOF_URL_REFRESH_MS);
    expect(PANEL_PROOF_URL_REFRESH_MS).toBeLessThan(300_000);
  });

  it("every mount bounds polling to its live generation and uses the same reader", () => {
    const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
    const loader = read("./AtlasPanelProofSheet.tsx");
    expect(loader).toMatch(/dpApi\.getAtlasPanelProof\(requestId\)/);
    expect(loader).toMatch(/refetchInterval: q => panelProofRefreshInterval\(q\.state\.data, pollWhilePending\)/);
    expect(read("../../pages/DesignPanelProPremium.tsx")).toMatch(/pollWhilePending=\{pipelineActive \|\| panelProofStillLanding\(generationRequestState\.state\)\}/);
    expect(read("../../pages/RevisionStudioIQ.tsx")).toMatch(/pollWhilePending=\{Boolean\(render\?\._revisionRequest\) && panelProofStillLanding\(render\?\._revisionState \?\? "queued"\)\}/);
    const board = read("../../pages/designpro/PanelProStudioBoard.tsx");
    expect(board).toMatch(/pollWhilePending=\{job\?\.state === "queued" \|\| job\?\.state === "running"\}/);
    expect(board).not.toMatch(/pollWhilePending\s*\n/);
    expect(read("../../pages/AdminGeminiCompareStudio.tsx")).toMatch(/pollWhilePending=\{job\.state === "queued" \|\| job\.state === "running"\}/);
  });

  it("uses bounded regions of the same source sheet, never guessed crops", () => {
    const p = proof();
    const html = htmlFor(p);
    expect((html.match(/<image href="https:\/\/signed.example\/sheet"/g) || [])).toHaveLength(6);
    for (let i = 0; i < 6; i++) expect(html).toContain(`viewBox="${30 + i * 240} 140 230 90"`);
    p.quadrants!.branded[0].sheetRect!.left = 1500;
    const invalid = htmlFor(p);
    expect((invalid.match(/<image href="https:\/\/signed.example\/sheet"/g) || [])).toHaveLength(5);
    expect(invalid).toContain("Preview not available");
  });

  it("retains every saved background and cut element without extra galleries", () => {
    const html = htmlFor(proof());
    for (const surface of SURFACES) expect(html).toContain(`https://signed.example/clean/${surface}`);
    for (const slot of CUT_SLOTS) expect(html).toContain(`https://signed.example/cut-graphic/${slot}`);
    expect(html).toContain("Primary logo"); expect(html).toContain("Icons / service graphics");
    expect(html).not.toContain('0&quot; × 0&quot;'); expect(html).not.toContain('0″ × 0″');
    expect(html).toContain("163.2");
  });

  it("retains the reason an unstored panel has no image", () => {
    const p = proof(); p.quadrants!.clean[0] = panel({ surfaceKey: "driver", role: "clean", persisted: false,
      reason: "storage_quota_exceeded", signedUrl: undefined });
    const html = htmlFor(p); expect(html).toContain("storage_quota_exceeded"); expect(html).toContain("Not saved");
  });

  it("does not claim raster previews are editable vector cut files", () => {
    const html = htmlFor(proof());
    expect(html).not.toMatch(/editable layer|vector file|\.svg|\.eps/i);
    expect(html).toContain("Plotter-ready contours are validated in the production pack");
  });

  it("keeps the same cached proof visible during transport errors", () => {
    expect(htmlFor(proof(), "error")).toContain('viewBox="0 0 1600 900"');
    expect(htmlFor(proof(), "error")).toContain("Your saved proof remains visible");
    expect(htmlFor(undefined, "error")).toBe("");
    expect(htmlFor({ requestId: "r", revisionId: null, panelProof: false })).toBe("");
  });

  it("treats an unbound proof as this request and refuses a different named revision", () => {
    const pinned = "70000000-0000-4000-8000-000000000001";
    expect(panelProofBelongsToOtherRevision(proof({ revisionId: null }), pinned)).toBe(false);
    expect(panelProofBelongsToOtherRevision(proof({ revisionId: pinned }), pinned)).toBe(false);
    expect(panelProofBelongsToOtherRevision(proof({ revisionId: "other" }), pinned)).toBe(true);
    expect(panelProofBelongsToOtherRevision(proof(), undefined)).toBe(false);
    expect(panelProofBelongsToOtherRevision(undefined, pinned)).toBe(false);
    expect(panelProofBelongsToOtherRevision({ panelProof: false, revisionId: "x" }, pinned)).toBe(false);
  });

  it("keeps saved panels when the original sheet URL is unavailable", () => {
    const p = proof({ sheet: { contentHash: "1".repeat(64) } });
    expect(htmlFor(p)).toContain("https://signed.example/clean/driver");
    expect(htmlFor(p)).toContain('viewBox="0 0 1600 900"');
  });

  it("preserves historical whole-sheet-only previews once, without inventing regions", () => {
    const p = proof(); p.quadrants!.branded.forEach(panel => { delete panel.sheetRect; });
    const html = htmlFor(p);
    expect((html.match(/<img /g) || [])).toHaveLength(1);
    expect(html).toContain("object-contain");
    expect(html).not.toContain("data-proof-panel=");
  });
});
