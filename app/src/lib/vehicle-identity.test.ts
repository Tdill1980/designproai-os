import { describe, expect, it } from "vitest";
import { isPlausibleYear, repairVehicleIdentity } from "./vehicle-identity";

describe("repairVehicleIdentity", () => {
  it("repairs the live 2026-09-17 failure: Year and Make typed into each other", () => {
    // request 6fa29f9f, which GENIE refused with genie_vehicle_identity_invalid
    const out = repairVehicleIdentity({ year: "Chrysler", make: "2008", model: "Town and Country" });
    expect(out).toMatchObject({ year: "2008", make: "Chrysler", model: "Town and Country", yearValid: true });
    expect(out.repaired).toEqual({ kind: "year_make_swapped", from: { year: "Chrysler", make: "2008" } });
  });

  it("leaves a correct identity completely untouched and claims no repair", () => {
    const out = repairVehicleIdentity({ year: "2022", make: "Ford", model: "F250" });
    expect(out).toEqual({ year: "2022", make: "Ford", model: "F250", repaired: null, yearValid: true });
  });

  it("NEVER pulls the year out of a four-digit MODEL — a Ram 1500 is not a 1500 Ram", () => {
    for (const model of ["1500", "2500", "3500"]) {
      const out = repairVehicleIdentity({ year: "", make: "Ram", model });
      expect(out.model).toBe(model);
      expect(out.year).toBe("");
      expect(out.repaired).toBeNull();
      expect(out.yearValid).toBe(false);
    }
  });

  it("refuses to guess when neither field is a plausible year", () => {
    const out = repairVehicleIdentity({ year: "Chrysler", make: "Town and Country", model: "" });
    expect(out.repaired).toBeNull();
    expect(out.yearValid).toBe(false);
    expect(out.year).toBe("Chrysler");
  });

  it("does not treat a trim number or a far-future year as a model year", () => {
    expect(isPlausibleYear("3500")).toBe(false);
    expect(isPlausibleYear("1500")).toBe(false);
    expect(isPlausibleYear("1899")).toBe(false);
    expect(isPlausibleYear("2008")).toBe(true);
    expect(isPlausibleYear(String(new Date().getFullYear() + 1))).toBe(true);
    expect(isPlausibleYear(String(new Date().getFullYear() + 5))).toBe(false);
  });

  it("trims without inventing, and reports an empty year as invalid", () => {
    const out = repairVehicleIdentity({ year: "  2019 ", make: " Ford ", model: " Transit " });
    expect(out).toMatchObject({ year: "2019", make: "Ford", model: "Transit", yearValid: true });
    expect(repairVehicleIdentity({}).yearValid).toBe(false);
  });
});
