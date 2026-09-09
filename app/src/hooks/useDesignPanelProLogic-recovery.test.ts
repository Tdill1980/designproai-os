import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Exercise the actual asynchronous hook handlers and resulting display state.
// State cells let us render again without a DOM; queries/effects stay inactive
// so no unrelated background reads or production work can enter this test.
const cells = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0 }));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useEffect: vi.fn(),
  useState: (initial: unknown) => {
    const index = cells.cursor++;
    if (index === cells.values.length) {
      cells.values.push(typeof initial === "function" ? initial() : initial);
    }
    return [cells.values[index], (update: unknown) => {
      cells.values[index] = typeof update === "function" ? update(cells.values[index]) : update;
    }];
  },
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: undefined, isLoading: false }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useSubscriptionLimits", () => ({
  useSubscriptionLimits: () => ({ checkCanGenerate: async () => true }),
}));
vi.mock("@/contexts/OrganizationContext", () => ({ useOrganization: () => ({ currentShop: null }) }));
vi.mock("@/lib/designpanelpro-standalone-adapter", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/designpanelpro-standalone-adapter")>(),
  startStandaloneGeneration: vi.fn(),
  waitForGeneration: vi.fn(),
  listDesignPanelViews: vi.fn(),
  handoffGeneration: vi.fn(),
}));

import { useDesignPanelProLogic } from "./useDesignPanelProLogic";
import {
  handoffGeneration, listDesignPanelViews, startStandaloneGeneration, waitForGeneration,
} from "@/lib/designpanelpro-standalone-adapter";
import { ApiError, FLAT_FIRST_ATLAS_PIPELINE_MODE, type GenerationRequestState, type GenerationView } from "@/lib/designpro-api";
import type { DesignIQParams } from "@/lib/designiq-engine";

const driver: GenerationView = {
  sourceViewType: "side", consumerRole: "driver", contentHash: "a".repeat(64),
  byteSize: 1024, contentType: "image/png", signedUrl: "https://files.test/saved-driver.png",
};
const accepted: GenerationRequestState = {
  requestId: "accepted-request", generationId: "accepted-generation", state: "leased",
  pipelineMode: FLAT_FIRST_ATLAS_PIPELINE_MODE, inputHash: "input", engineContractHash: "contract",
  shotsComplete: 1, shotsTotal: 7, views: [driver],
};
const renderHook = () => { cells.cursor = 0; return useDesignPanelProLogic(); };

beforeEach(() => {
  cells.values = [];
  cells.cursor = 0;
  vi.mocked(startStandaloneGeneration).mockResolvedValue(accepted);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); });

async function observeThenRecover(originalError: Error, recoveryError: Error, showDriver = true) {
  vi.mocked(waitForGeneration).mockImplementationOnce(async (_requestId, options) => {
    options?.onState?.(accepted);
    if (showDriver) await options?.onViews?.([driver]);
    throw originalError;
  });
  vi.mocked(listDesignPanelViews).mockRejectedValueOnce(recoveryError);
  const result = await renderHook().generateFromPrompt(
    { generationId: accepted.generationId, prompt: "Saved wrap" } as DesignIQParams,
    { year: "2024", make: "Ford", model: "Transit" },
    FLAT_FIRST_ATLAS_PIPELINE_MODE,
  );
  expect(startStandaloneGeneration).toHaveBeenCalledTimes(1);
  expect(waitForGeneration).toHaveBeenCalledTimes(1);
  expect(listDesignPanelViews).toHaveBeenCalledExactlyOnceWith(accepted.requestId);
  expect(handoffGeneration).not.toHaveBeenCalled();
  return { result, display: renderHook() };
}

describe("DesignPro recovery respects the latest owner-read refusal", () => {
  it.each(["flat_first_atlas_new_run_required", "generation_atlas_lineage_invalid"])(
    "clears previously displayed Driver when recovery refuses %s after a 503",
    async (code) => {
      const { result, display } = await observeThenRecover(
        new ApiError(503, "gateway_unavailable"), new ApiError(409, code),
      );
      expect(result.generationId).toBeNull();
      expect(result.directRender).toBe(false);
      expect(result.renderUrl).toBeUndefined();
      expect(result.error).toContain("This saved proof set cannot be reused");
      expect(display.generatedImageUrl).toBeNull();
      expect(display.visualizationId).toBeNull();
      expect(display.allViews).toEqual([]);
      expect(display.generationRequestState).toBeNull();
      expect(display.personaHeroUrl).toBeNull();
      expect(display.personaGenerationId).toBeNull();
      expect(display.personaAllViews).toEqual({});
    },
  );

  it("does not restore cached Driver when the original read refused lineage and recovery fails transiently", async () => {
    const { result, display } = await observeThenRecover(
      new ApiError(409, "flat_first_atlas_new_run_required"), new ApiError(503, "gateway_unavailable"),
    );
    expect(result.generationId).toBeNull();
    expect(result.directRender).toBe(false);
    expect(display.generatedImageUrl).toBeNull();
    expect(display.allViews).toEqual([]);
  });

  it("preserves verified Driver when both reads fail transiently without withdrawing lineage", async () => {
    const { result, display } = await observeThenRecover(
      new ApiError(503, "gateway_unavailable"), new ApiError(503, "gateway_unavailable"),
    );
    expect(result.generationId).toBe(accepted.generationId);
    expect(result.directRender).toBe(true);
    expect(display.generatedImageUrl).toBe(driver.signedUrl);
    expect(display.personaAllViews).toEqual({ side: driver.signedUrl });
    expect(display.generationError).toContain("Still waiting for Passenger side");
    expect(display.generationError).not.toContain("cannot be reused");
  });

  it.each([
    { status: 401, showDriver: true, originalError: new ApiError(503, "gateway_unavailable") },
    { status: 403, showDriver: true, originalError: new ApiError(503, "gateway_unavailable") },
    { status: 401, showDriver: false, originalError: new Error("generation_timeout") },
    { status: 403, showDriver: false, originalError: new Error("generation_timeout") },
  ])("reports recovery access status $status with Driver=$showDriver", async ({ status, showDriver, originalError }) => {
    const { result, display } = await observeThenRecover(
      originalError, new ApiError(status, "authentication_required"), showDriver,
    );
    expect(result.error).toMatch(status === 401 ? /Sign in again/ : /do not have access/);
    expect(display.generationError).toBe(result.error);
    expect(display.generationError).not.toMatch(/Still waiting|taking longer|latest status could not be refreshed/);
    expect(result.directRender).toBe(showDriver);
    expect(display.generatedImageUrl).toBe(showDriver ? driver.signedUrl : null);
  });
});
