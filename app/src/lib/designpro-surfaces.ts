/**
 * THE SIX CANONICAL PRINTED SURFACES — the one definition, with no dependencies.
 *
 * This lived in `designpro-api.ts`, which is the right home for the CONTRACT
 * but the wrong one for a constant, because that module constructs the Supabase
 * client at import time. So any pure domain module that needed the surface list
 * — the panel QC report, for one — pulled a live client and a `localStorage`
 * read in with it, and could not be reasoned about or tested on its own.
 *
 * `designpro-api.ts` re-exports these, so every existing importer is unchanged
 * and there is still exactly one definition of the six.
 */

export type GenieSurfaceKey = "driver" | "passenger" | "hood" | "roof" | "front" | "rear";

/** The six printed surfaces, in the order the production layers are cut. */
export const PRODUCTION_SURFACES: GenieSurfaceKey[] = [
  "driver",
  "passenger",
  "hood",
  "roof",
  "front",
  "rear",
];

export const SURFACE_LABELS: Record<GenieSurfaceKey, string> = {
  driver: "Driver side",
  passenger: "Passenger side",
  hood: "Hood",
  roof: "Roof",
  front: "Front",
  rear: "Rear",
};
