import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { composeRenderWithLayers } from "./logo-composite";
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("layer edit references never silently omit an asset", () => {
  it("rejects an invalid placement before reading or drawing artwork", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    await expect(composeRenderWithLayers("https://files.test/base.png", [{ id: "logo", cleanedUrl: "https://files.test/logo.png", xPct: Number.NaN, yPct: 0.5, size: "md" }], { strict: true })).rejects.toThrow(/position or size/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("fails a composition when an essential layer cannot load instead of exporting only the background", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(new Blob(["base"], { type: "image/png" }))).mockRejectedValueOnce(new Error("asset unavailable"));
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 100, height: 60, close: vi.fn() }));
    const toBlob = vi.fn();
    vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }), toBlob }) });
    await expect(composeRenderWithLayers("https://files.test/base.png", [{ id: "original-logo", cleanedUrl: "https://files.test/logo.png", xPct: 0.5, yPct: 0.5, size: "md" }], { strict: true })).rejects.toThrow(/original-logo could not be drawn/);
    expect(toBlob).not.toHaveBeenCalled();
  });
});
