import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { ApiError, dpApi, type GenerationRequestState, type GenerationView } from "./designpro-api";
import { incompleteGenerationMessage, waitForGeneration } from "./designpanelpro-standalone-adapter";

const requestId = "request-under-observation";
const views: GenerationView[] = [
  ["side", "driver"], ["passenger-side", "passenger"], ["hood_detail", "hood"],
  ["front", "front"], ["rear", "rear"], ["close-up", "closeup"], ["roof", "roof"],
].map(([sourceViewType, consumerRole], index) => ({
  sourceViewType, consumerRole, contentHash: String(index + 1).repeat(64),
  byteSize: 1024, contentType: "image/png", signedUrl: `https://files.test/${sourceViewType}.png`,
}));
const state = (count: number, extra: Partial<GenerationRequestState> = {}): GenerationRequestState => ({
  requestId, generationId: "existing-generation", state: "leased", inputHash: "input",
  engineContractHash: "contract", shotsComplete: count, shotsTotal: 7,
  views: views.slice(0, count), ...extra,
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("saved generation observation survives transient reads", () => {
  it.each([
    new ApiError(503, "gateway_unavailable"),
    new TypeError("Failed to fetch"),
  ])("retains Driver through %s and receives the remaining proofs without generation", async (readError) => {
    const completed = state(7, { state: "outputs_ready", handoffReady: true });
    const readStatus = vi.spyOn(dpApi, "getGenerationRequest")
      .mockResolvedValueOnce(state(1)).mockRejectedValueOnce(readError).mockResolvedValue(completed);
    const readViews = vi.spyOn(dpApi, "listGenerationViews")
      .mockResolvedValueOnce(views.slice(0, 1)).mockResolvedValue(views);
    const create = vi.spyOn(dpApi, "createGenerationRequest");
    const regenerate = vi.spyOn(dpApi, "regenerateView");
    const handoff = vi.spyOn(dpApi, "handoffGeneration");
    const connection = vi.fn();
    const shown: GenerationView[][] = [];
    const watching = waitForGeneration(requestId, {
      onViews: (value) => { shown.push(value); }, onConnectionState: connection,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(shown).toEqual([views.slice(0, 1)]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(connection).toHaveBeenLastCalledWith("reconnecting");
    expect(shown).toEqual([views.slice(0, 1)]);
    await vi.advanceTimersByTimeAsync(2000);

    await expect(watching).resolves.toEqual(completed);
    expect(shown).toEqual([views.slice(0, 1), views]);
    expect(connection.mock.calls.map(([value]) => value)).toEqual(["connected", "reconnecting", "connected"]);
    expect(readStatus).toHaveBeenCalledTimes(3);
    expect(readStatus.mock.calls.every(([id]) => id === requestId)).toBe(true);
    expect(readViews).toHaveBeenCalledTimes(2);
    expect(create).not.toHaveBeenCalled();
    expect(regenerate).not.toHaveBeenCalled();
    expect(handoff).not.toHaveBeenCalled();
  });

  it.each([401, 403])("stops on status %s without treating missing views as refused", async (status) => {
    const denied = new ApiError(status, "authentication_required");
    const readStatus = vi.spyOn(dpApi, "getGenerationRequest")
      .mockResolvedValueOnce(state(1)).mockRejectedValue(denied);
    vi.spyOn(dpApi, "listGenerationViews").mockResolvedValue(views.slice(0, 1));
    const connection = vi.fn();
    const shown = vi.fn();
    const watching = waitForGeneration(requestId, { onViews: shown, onConnectionState: connection });
    const failed = expect(watching).rejects.toBe(denied);
    await vi.advanceTimersByTimeAsync(2000);
    await failed;
    expect(readStatus).toHaveBeenCalledTimes(2);
    expect(shown).toHaveBeenCalledTimes(1);
    expect(connection).not.toHaveBeenCalledWith("reconnecting");
    const message = incompleteGenerationMessage({ state: state(1), error: denied, availableViews: 1,
      missingViews: [{ sourceViewType: "passenger-side", label: "Passenger side" }] });
    expect(message).toMatch(status === 401 ? /Sign in again/ : /do not have access/);
    expect(message).not.toMatch(/refused|failed|Still waiting/);
  });

  it("does not swallow an authentication failure from signed-view reads", async () => {
    vi.spyOn(dpApi, "getGenerationRequest").mockResolvedValue(state(1));
    const readViews = vi.spyOn(dpApi, "listGenerationViews").mockRejectedValue(new ApiError(403, "forbidden"));
    await expect(waitForGeneration(requestId, { onViews: vi.fn() })).rejects.toMatchObject({ status: 403 });
    expect(readViews).toHaveBeenCalledTimes(1);
  });

  it("stops retrying at the original watcher deadline and preserves the last available views", async () => {
    const readStatus = vi.spyOn(dpApi, "getGenerationRequest")
      .mockResolvedValueOnce(state(1)).mockRejectedValue(new ApiError(503, "gateway_unavailable"));
    vi.spyOn(dpApi, "listGenerationViews").mockResolvedValue(views.slice(0, 1));
    const shown = vi.fn();
    const watching = waitForGeneration(requestId, { timeoutMs: 8000, onViews: shown });
    const failed = expect(watching).rejects.toThrow("generation_timeout");
    await vi.advanceTimersByTimeAsync(8000);
    await failed;
    const pollsAtDeadline = readStatus.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(readStatus).toHaveBeenCalledTimes(pollsAtDeadline);
    expect(shown).toHaveBeenCalledExactlyOnceWith(views.slice(0, 1));
  });

  it("bounds a never-returning status GET by the watcher deadline", async () => {
    const readStatus = vi.spyOn(dpApi, "getGenerationRequest").mockReturnValue(new Promise(() => {}));
    const watching = waitForGeneration(requestId, { timeoutMs: 1000 });
    const failed = expect(watching).rejects.toThrow("generation_timeout");
    await vi.advanceTimersByTimeAsync(1000);
    await failed;
    expect(readStatus).toHaveBeenCalledTimes(1);
  });

  it("honors cancellation while waiting to reconnect without another read", async () => {
    const readStatus = vi.spyOn(dpApi, "getGenerationRequest").mockRejectedValue(new ApiError(503, "gateway_unavailable"));
    const controller = new AbortController();
    const watching = waitForGeneration(requestId, { signal: controller.signal });
    const failed = expect(watching).rejects.toThrow("generation_watch_aborted");
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await failed;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(readStatus).toHaveBeenCalledTimes(1);
  });

  it("retains actual failedShots and reports only those missing views as failed", async () => {
    const recorded = state(1, { state: "failed", failureCode: "generation_slots_failed",
      failedShots: [{ sourceViewType: "passenger-side", consumerRole: "passenger", reason: "provider_attempts_exhausted" }] });
    vi.spyOn(dpApi, "getGenerationRequest").mockResolvedValueOnce(state(1)).mockResolvedValue(recorded);
    vi.spyOn(dpApi, "listGenerationViews").mockResolvedValue(views.slice(0, 1));
    const observed = vi.fn();
    const watching = waitForGeneration(requestId, { onState: observed, onViews: vi.fn() });
    const failed = expect(watching).rejects.toThrow("generation_slots_failed");
    await vi.advanceTimersByTimeAsync(2000);
    await failed;
    expect(observed).toHaveBeenLastCalledWith(recorded);
    const message = incompleteGenerationMessage({ state: recorded, error: new Error("generation_slots_failed"), availableViews: 1,
      missingViews: [{ sourceViewType: "passenger-side", label: "Passenger side" }, { sourceViewType: "roof", label: "Roof" }] });
    expect(message).toContain("Passenger side could not be completed");
    expect(message).toContain("Roof is not yet available");
    expect(message).not.toContain("refused by proof review");
  });

  it("describes an interrupted live run as pending rather than a review rejection", () => {
    const message = incompleteGenerationMessage({ state: state(1), error: new ApiError(503, "gateway_unavailable"), availableViews: 1,
      missingViews: [{ sourceViewType: "passenger-side", label: "Passenger side" }] });
    expect(message).toContain("Still waiting for Passenger side");
    expect(message).toContain("latest status could not be refreshed");
    expect(message).not.toMatch(/refused|as failed/);
  });
});
