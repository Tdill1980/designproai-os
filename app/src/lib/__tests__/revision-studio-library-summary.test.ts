/**
 * REVISION STUDIO: AN INDEX ROW IS NOT A VIEW SET (2026-09-25, generation 9999ec65).
 *
 * The studio opened the design-library index row, whose `render_urls` holds
 * only the driver thumbnail by construction, and showed "Generate 6 Missing
 * Views" on a design with all seven. It also re-signed and re-downloaded every
 * view on each 15 s poll. These lock the fix.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const api = vi.hoisted(() => ({
  listDesignLibrary: vi.fn(),
  getStatus: vi.fn(),
  listArtifacts: vi.fn(),
  listApprovedViews: vi.fn(),
  listJobFlatAtlasRevisions: vi.fn(),
}));
vi.mock("@/lib/designpro-api", () => ({
  dpApi: api,
  SOURCE_VIEW_TYPE_FOR_ROLE: { driver: "side", passenger: "passenger-side", hood: "hood_detail", roof: "roof", front: "front", rear: "rear" },
  ROLE_FOR_SOURCE_VIEW_TYPE: { side: "driver", "passenger-side": "passenger", hood_detail: "hood", roof: "roof", front: "front", rear: "rear" },
}));
import { keepLiveSignedUrls, listRevisionStudioDesigns, readRevisionStudioDesign } from "../revisionstudio-source";

const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const page = strip(readFileSync(fileURLToPath(new URL("../../pages/RevisionStudioIQ.tsx", import.meta.url)), "utf8"));

const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
const signed = (path: string, exp: number) =>
  `https://p.supabase.co/storage/v1/object/sign/wrap-files/${path}?token=${b64({ alg: "HS256" })}.${b64({ exp })}.sig`;
const NOW = 1_800_000_000_000;

describe("library index rows", () => {
  beforeEach(() => vi.clearAllMocks());

  it("are marked as summaries and carry the server's real view count", async () => {
    api.listDesignLibrary.mockResolvedValue([{
      generationId: "9999ec65-a0ab-468a-927b-0eb72a98758d", designId: "DID-1", state: "outputs_ready",
      viewCount: 7, thumbnailUrl: "https://p.supabase.co/storage/v1/render/image/sign/wrap-files/side.jpg?token=t",
      createdAt: "2026-09-25T21:19:33Z", pipeline: "atlas", vehicle: null, production: null,
    }]);
    const [row] = await listRevisionStudioDesigns();
    expect(row._librarySummary).toBe(true);
    expect(row._viewCount).toBe(7);
    expect(Object.keys(row.render_urls).sort()).toEqual(["driver", "side"]);
    expect(row.generation_status).toBe("completed");
  });

  it("a hydrated re-read is not a summary", async () => {
    api.getStatus.mockResolvedValue({ generationId: "g", designId: "DID-g", orderNumber: "", revision: 1, state: "outputs_ready", currentStage: "x" });
    api.listArtifacts.mockResolvedValue([]);
    api.listJobFlatAtlasRevisions.mockResolvedValue([]);
    api.listApprovedViews.mockResolvedValue([]);
    const row = await readRevisionStudioDesign("g");
    expect(row?._librarySummary).toBe(false);
  });
});

describe("the studio page", () => {
  it("counts no missing views, offers no generate button and allows no production order from an index row", () => {
    const body = page.slice(page.indexOf("function getMissingViews("));
    expect(body.slice(0, 200)).toContain("if (render?._librarySummary) return [];");
    expect(page).toMatch(/productionProofsReady = [\s\S]{0,200}!selectedInspectionRender\?\._librarySummary/);
  });
  it("gallery counters read the index's own view count", () => {
    expect(page).toContain("summaryViewCount ?? views.length");
    expect(page).toMatch(/render\._librarySummary\s*\?\s*Math\.min\(Number\(render\._viewCount\)/);
  });
  it("the 15 s poll keeps still-valid view URLs", () => {
    expect(page).toContain("render_urls: keepLiveSignedUrls(previous.render_urls, fresh.render_urls)");
  });
});

describe("keepLiveSignedUrls", () => {
  it("keeps a same-path URL whose token has more than a minute left", () => {
    const old = signed("a/side.jpg", NOW / 1000 + 200);
    const fresh = signed("a/side.jpg", NOW / 1000 + 300);
    expect(keepLiveSignedUrls({ side: old }, { side: fresh }, NOW)).toEqual({ side: old });
  });
  it("takes the new URL when the old token is about to lapse, the path changed, or the token is unreadable", () => {
    const fresh = signed("a/side.jpg", NOW / 1000 + 300);
    expect(keepLiveSignedUrls({ side: signed("a/side.jpg", NOW / 1000 + 30) }, { side: fresh }, NOW).side).toBe(fresh);
    expect(keepLiveSignedUrls({ side: signed("b/side.jpg", NOW / 1000 + 900) }, { side: fresh }, NOW).side).toBe(fresh);
    expect(keepLiveSignedUrls({ side: "https://p.supabase.co/storage/v1/object/sign/wrap-files/a/side.jpg?token=junk" }, { side: fresh }, NOW).side).toBe(fresh);
  });
  it("never adds or drops views", () => {
    const fresh = { side: signed("a/side.jpg", NOW / 1000 + 300), roof: signed("a/roof.jpg", NOW / 1000 + 300) };
    expect(Object.keys(keepLiveSignedUrls({ hood_detail: "x" }, fresh, NOW)).sort()).toEqual(["roof", "side"]);
    expect(keepLiveSignedUrls(undefined, fresh, NOW)).toBe(fresh);
  });
});
