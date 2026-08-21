import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  buildGenerationInput,
  FLAT_FIRST_ATLAS_PIPELINE_MODE,
  type CreateGenerationRequestOptions,
} from "./designpro-api";
import {
  flatFirstAtlasSupportedVehicleType,
  inlineRevisionEnabledForPipeline,
  myVehiclePhotoFlowEnabledForPipeline,
  normalizeDesignProVehicleType,
} from "./designpro-flat-first";

const base: CreateGenerationRequestOptions = {
  designName: "Flamingo Pools",
  vehicle: { year: "2024", make: "Ford", model: "F-250", type: "truck" },
  brief: { brief: "A bright pool-service wrap" },
};

describe("flat-first generation input", () => {
  it("leaves the legacy v2 input unchanged when no opt-in is present", () => {
    expect(buildGenerationInput(base)).toEqual({
      contractVersion: "designpro.calls-1-7-input.v2",
      vehicle: base.vehicle,
      brief: base.brief.brief,
      designName: base.designName,
    });
  });

  it("also keeps explicit legacy on v2 and sends no pipelineMode field", () => {
    const input = buildGenerationInput({ ...base, pipelineMode: "legacy" });
    expect(input.contractVersion).toBe("designpro.calls-1-7-input.v2");
    expect(input).not.toHaveProperty("pipelineMode");
  });

  it("uses v3 only for the explicit flat-first atlas diagnostic", () => {
    expect(buildGenerationInput({
      ...base,
      pipelineMode: FLAT_FIRST_ATLAS_PIPELINE_MODE,
    })).toMatchObject({
      contractVersion: "designpro.calls-1-7-input.v3",
      pipelineMode: "flat-first-atlas-v1",
      vehicle: base.vehicle,
      brief: base.brief.brief,
      designName: base.designName,
    });
  });

  it("fails closed instead of sending a flat-first edit through the legacy revision handler", () => {
    expect(inlineRevisionEnabledForPipeline(FLAT_FIRST_ATLAS_PIPELINE_MODE)).toBe(false);
    expect(inlineRevisionEnabledForPipeline("legacy")).toBe(true);
  });

  it("normalizes unified Home vehicle labels to the API enum", () => {
    expect(normalizeDesignProVehicleType("Truck")).toBe("truck");
    expect(normalizeDesignProVehicleType("SUV")).toBe("suv");
    expect(normalizeDesignProVehicleType("not-a-vehicle")).toBe("car");
  });

  it("fails closed when MyVehicle photos would bypass the atlas master", () => {
    expect(myVehiclePhotoFlowEnabledForPipeline(FLAT_FIRST_ATLAS_PIPELINE_MODE)).toBe(false);
    expect(myVehiclePhotoFlowEnabledForPipeline("legacy")).toBe(true);
  });

  it("admits only vehicle classes with a bounded A.T.L.A.S. proof topology", () => {
    for (const type of ["car", "truck", "suv", "van"]) {
      expect(flatFirstAtlasSupportedVehicleType(type)).toBe(true);
    }
    for (const type of ["motorcycle", "boat", "bus", "rv", "trailer", "aircraft", "heavy_equipment"]) {
      expect(flatFirstAtlasSupportedVehicleType(type)).toBe(false);
    }
  });
});
