/**
 * REPAIR A SWAPPED VEHICLE IDENTITY INSTEAD OF REFUSING IT.
 *
 * GENIE requires a four-digit year and refuses anything else
 * (`genie_vehicle_identity_invalid`: "Universal GENIE requires class,
 * four-digit year, make and model"). Live on 2026-09-17, request 6fa29f9f
 * reached that refusal with `{year: "Chrysler", make: "2008"}` -- the two values
 * typed into each other's fields on a phone, where the three inputs stack and
 * the neighbouring field is one mistap away. The run died 2.2 seconds in on a
 * failure screen.
 *
 * Owner: "It should auto fix that if user mistyped clearly input name instead of
 * year or whatever." When the evidence is unambiguous the software should just
 * correct it -- so this swaps them back and reports that it did.
 *
 * THE CORRECTION IS DELIBERATELY NARROW, because a wrong guess here silently
 * designs for the wrong vehicle:
 *
 * - It acts ONLY when Year is not a plausible year AND Make is one. Two facts
 *   agreeing, not one field's shape.
 * - It NEVER reads a year out of the MODEL field. Real models are four digits:
 *   Ram 1500 / 2500 / 3500, Silverado 2500. `PLAUSIBLE_YEAR` excludes those by
 *   range, but the model field is not consulted at all, so no range argument has
 *   to hold for the artwork to be right.
 * - A make that is a bare number is not a make, so the swap cannot destroy real
 *   information: nothing is thrown away, the two values trade places.
 *
 * Anything it cannot resolve it leaves alone and reports as unrepaired, so the
 * caller still refuses rather than guessing.
 */

export const FOUR_DIGIT_YEAR = /^[0-9]{4}$/;

/** A model year, not a trim number. 1900 through two model years ahead. */
export function isPlausibleYear(value: string): boolean {
  const text = String(value ?? "").trim();
  if (!FOUR_DIGIT_YEAR.test(text)) return false;
  const year = Number(text);
  return year >= 1900 && year <= new Date().getFullYear() + 2;
}

export interface VehicleIdentityInput {
  year?: string | null;
  make?: string | null;
  model?: string | null;
}

export interface VehicleIdentityRepair {
  year: string;
  make: string;
  model: string;
  /** What was changed, for the notice the customer sees. Null when nothing was. */
  repaired: null | { kind: "year_make_swapped"; from: { year: string; make: string } };
  /** True when the result carries a year GENIE will accept. */
  yearValid: boolean;
}

export function repairVehicleIdentity(input: VehicleIdentityInput): VehicleIdentityRepair {
  const year = String(input.year ?? "").trim();
  const make = String(input.make ?? "").trim();
  const model = String(input.model ?? "").trim();

  if (!isPlausibleYear(year) && isPlausibleYear(make)) {
    return {
      year: make,
      make: year,
      model,
      repaired: { kind: "year_make_swapped", from: { year, make } },
      yearValid: true,
    };
  }
  return { year, make, model, repaired: null, yearValid: isPlausibleYear(year) };
}
