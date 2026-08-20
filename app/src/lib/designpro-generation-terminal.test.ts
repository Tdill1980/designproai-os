import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { terminalGenerationFailureCode } from "./designpanelpro-standalone-adapter";
import type { GenerationRequestState } from "./designpro-api";

const state = (partial: Partial<GenerationRequestState>): GenerationRequestState => ({
  requestId: "request-1",
  generationId: "generation-1",
  state: "queued",
  inputHash: "input",
  engineContractHash: "contract",
  ...partial,
});

describe("terminalGenerationFailureCode", () => {
  it("stops a stale retryable row that needs operator-validated geometry", () => {
    expect(terminalGenerationFailureCode(state({
      state: "retryable",
      failureCode: "genie_dimension_validation_required",
    }))).toBe("genie_dimension_validation_required");
  });

  it("continues polling a genuinely transient retry", () => {
    expect(terminalGenerationFailureCode(state({
      state: "retryable",
      failureCode: "provider_exhausted",
    }))).toBeNull();
  });

  it("returns terminal database states and never rejects completed output", () => {
    expect(terminalGenerationFailureCode(state({ state: "failed" }))).toBe("generation_failed");
    expect(terminalGenerationFailureCode(state({ state: "cancelled" }))).toBe("generation_cancelled");
    expect(terminalGenerationFailureCode(state({
      state: "outputs_ready",
      failureCode: "stale_code_must_not_win",
    }))).toBeNull();
  });
});
