import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  buildGenerationInput,
  buildGenerationRequestPayload,
  FLAT_FIRST_ATLAS_PIPELINE_MODE,
  type CreateGenerationRequestOptions,
} from "./designpro-api";
import {
  flatFirstAtlasRequestedBySearch,
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

  it("carries every existing DesignIQ control and only verified reference identity", () => {
    const identity = {
      storagePath: "designpro/user_1/refs/board.png",
      contentHash: "a".repeat(64),
      byteSize: 2048,
      contentType: "image/png",
    };
    expect(buildGenerationInput({
      ...base,
      brief: {
        ...base.brief,
        mode: "commercial",
        companyName: "Flamingo Pools",
        phone: "480-555-0182",
        website: "flamingopools.example",
        finish: "Satin",
        substrate: "color_change_film",
        mascot: "a confident flamingo",
        bulletPoints: ["Custom pools", "Outdoor living"],
        brandColors: "coral, aqua, charcoal",
        fontStyle: "clean geometric sans",
        qrEnabled: true,
        qrUrl: "https://flamingopools.example/quote",
        visionBoardImages: [identity],
        visionboardIntent: "exact_reference",
        textLayerPrompt: "Website: flamingopools.example",
        logoAsset: identity,
      },
    })).toMatchObject({
      mode: "commercial",
      companyName: "Flamingo Pools",
      phone: "480-555-0182",
      website: "flamingopools.example",
      finish: "Satin",
      substrate: "color_change_film",
      mascot: "a confident flamingo",
      bulletPoints: ["Custom pools", "Outdoor living"],
      brandColors: "coral, aqua, charcoal",
      fontStyle: "clean geometric sans",
      qrEnabled: true,
      qrUrl: "https://flamingopools.example/quote",
      visionBoardImages: [identity],
      visionboardIntent: "exact_reference",
      textLayerPrompt: "Website: flamingopools.example",
      logoAsset: identity,
    });
    const encoded = buildGenerationInput({
      ...base,
      brief: { ...base.brief, visionBoardImages: [identity] },
    });
    expect(JSON.stringify(encoded)).not.toContain("signedUrl");
    expect(JSON.stringify(encoded)).not.toContain("publicUrl");
  });

  it("requires A.T.L.A.S. in the outer envelope so an old gateway fails before enqueue", () => {
    const generationId = "90000000-0000-4000-8000-000000000010";
    expect(buildGenerationRequestPayload({
      ...base,
      pipelineMode: FLAT_FIRST_ATLAS_PIPELINE_MODE,
    }, generationId)).toMatchObject({
      generationId,
      requiredPipelineMode: FLAT_FIRST_ATLAS_PIPELINE_MODE,
      input: {
        contractVersion: "designpro.calls-1-7-input.v3",
        pipelineMode: FLAT_FIRST_ATLAS_PIPELINE_MODE,
      },
    });
    expect(buildGenerationRequestPayload(base, generationId)).not.toHaveProperty("requiredPipelineMode");
  });

  it("recognizes the dedicated A.T.L.A.S. test URL without treating cache keys as mode", () => {
    expect(flatFirstAtlasRequestedBySearch("?pipeline=atlas&release=abc1234")).toBe(true);
    expect(flatFirstAtlasRequestedBySearch("?pipeline=flat-first-atlas-v1")).toBe(true);
    expect(flatFirstAtlasRequestedBySearch("?release=abc1234")).toBe(false);
    expect(flatFirstAtlasRequestedBySearch("?pipeline=legacy")).toBe(false);
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
