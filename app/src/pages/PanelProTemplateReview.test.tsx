import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: {} } }));
import { TemplateCandidateOverlay, TemplateCandidateReview, validTemplateRegions } from "./PanelProTemplateReview";
import type { TemplateCandidate } from "@/lib/panelpro-file-output-api";
const candidate: TemplateCandidate = {
  contractVersion: "designpro.panelpro-template-service.v1", candidateId: "11111111-1111-4111-8111-111111111111", sourceId: "22222222-2222-4222-8222-222222222222", ownerId: "33333333-3333-4333-8333-333333333333",
  templateId: "camaro-2020-coupe", version: "1", vehicle: { make: "Chevrolet", model: "Camaro", year: "2020" }, status: "waiting_review", customerVisible: false, canReview: true, fitToleranceInches: 0.125,
  geometryHash: "a".repeat(64), candidateHash: "b".repeat(64), displayContentHash: "c".repeat(64), displayMetadata: { width: 400, height: 250, headerHeight: 50 },
  geometry: { contractVersion: "designpro.vehicle-template-geometry.v1", units: "in", vehicle: {}, pieces: [{ pieceId: "driver", widthInches: 20, heightInches: 10, outlineInches: [[0, 0], [20, 0], [20, 10], [0, 10]], cutAreas: [{ areaId: "window", pointsInches: [[4, 2], [10, 2], [10, 4], [4, 4]] }] }] },
  previews: [{ role: "branded-template-candidate", contentHash: "c".repeat(64), signedUrl: "https://files.test/branded.png", customerVisible: false }], template: null, stages: [{ key: "template.recreate", state: "completed" }, { key: "template.overlay-review", state: "waiting" }], error: null, updatedAt: "2026-09-08T20:00:00Z",
};
describe("internal measured template review", () => {
  it("requires every measured piece within the image and below the branded header", () => {
    const driver = { x: 0, y: 50, width: 400, height: 200 };
    expect(validTemplateRegions(candidate, { driver })).toBe(true);
    expect(validTemplateRegions(candidate, {})).toBe(false);
    expect(validTemplateRegions(candidate, { driver: { ...driver, y: 49 } })).toBe(false);
    expect(validTemplateRegions(candidate, { driver: { ...driver, width: 401 } })).toBe(false);
    expect(validTemplateRegions(candidate, { driver: { ...driver, width: 0 } })).toBe(false);
    expect(validTemplateRegions(candidate, { driver: { ...driver, x: 0.5 } })).toBe(false);
    expect(validTemplateRegions(candidate, { driver, extra: driver })).toBe(false);
  });
  it("overlays measured outlines and cut areas without punching holes in the candidate", () => {
    const html = renderToStaticMarkup(<TemplateCandidateOverlay candidate={candidate} regions={{ driver: { x: 0, y: 50, width: 400, height: 200 } }} />);
    expect(html).toContain('href="https://files.test/branded.png"');
    expect(html).toContain('points="80,90 200,90 200,130 80,130"');
    expect(html).toContain("inspection overlays");
    expect(html).not.toContain("clipPath");
    expect(html).not.toContain("<mask");
  });
  it("refuses an image that does not match the saved candidate hash", () => {
    const html = renderToStaticMarkup(<TemplateCandidateOverlay candidate={{ ...candidate, displayContentHash: "d".repeat(64) }} regions={{}} />);
    expect(html).not.toContain("branded.png");
  });
  it("starts with unchecked review gates and never derives approval from completed image generation", () => {
    const html = renderToStaticMarkup(<TemplateCandidateReview candidate={candidate} />);
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
    expect(html).not.toContain('checked=""');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Approve and bank this exact template/);
    expect(html).not.toContain("saved in the template bank");
  });
});
