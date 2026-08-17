/**
 * non-auto-prompts.ts — Prompt builders for non-automotive render edge functions.
 *
 * Each builder produces a prompt string that Gemini 3 Pro can use to generate
 * a photorealistic render of a wrapped non-car vehicle. All builders import
 * STUDIO_ENVIRONMENT from the LOCKED _shared/studio-os.ts (importing is
 * permitted; modifying is not). The studio environment is vehicle-agnostic
 * enough to work for motorcycles, boats, buses, and RVs without changes.
 *
 * Design philosophy (matches generate-color-render):
 *   - Keep prompts SHORT. Long prompts degrade Gemini image quality.
 *   - Single clear instruction beats five redundant ones.
 *   - Say "photorealistic" ONCE.
 *   - No "photographer identity" or "award-winning" (triggers watermarks).
 *   - Positive framing only — no "do not" / "never" language.
 */

import { STUDIO_ENVIRONMENT } from "./studio-os.ts";
import { getMotorcycleView, getBoatView, getBusView, getRvView, getTrailerView } from "./non-auto-view-angles.ts";
import type { UniversalVehicleSpecs } from "./vehicle-specs-universal.ts";
import { formatSpecsForPrompt } from "./vehicle-specs-universal.ts";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface NonAutoPromptInput {
  vehicleYear: string;
  vehicleMake: string;
  vehicleModel: string;
  viewType: string;
  specs: UniversalVehicleSpecs;
  colorData: any;
  modeType: string;
  customStylingPrompt?: string;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function buildVehicleLine(input: NonAutoPromptInput): string {
  return `${input.vehicleYear} ${input.vehicleMake} ${input.vehicleModel}`.trim();
}

function buildColorLine(colorData: any): string {
  if (!colorData) return "";
  const parts: string[] = [];
  if (colorData.colorName) parts.push(`Color: ${colorData.colorName}`);
  if (colorData.hex) parts.push(`Hex: ${colorData.hex}`);
  if (colorData.finish) parts.push(`Finish: ${colorData.finish}`);
  if (colorData.manufacturer) parts.push(`Film: ${colorData.manufacturer}`);
  return parts.length > 0 ? parts.join(" — ") : "";
}

function buildStylingLine(colorData: any, customStylingPrompt?: string): string {
  const stylingPrompt = customStylingPrompt || colorData?.customStylingPrompt;
  return stylingPrompt ? `Wrap design: "${stylingPrompt}"` : "";
}

// ---------------------------------------------------------------------------
// Motorcycle
// ---------------------------------------------------------------------------

export function buildMotorcyclePrompt(input: NonAutoPromptInput): string {
  const vehicle = buildVehicleLine(input);
  const viewAngle = getMotorcycleView(input.viewType);
  const colorLine = buildColorLine(input.colorData);
  const stylingLine = buildStylingLine(input.colorData, input.customStylingPrompt);
  const specsLine = formatSpecsForPrompt(input.specs);

  return `A photorealistic studio photograph of a ${vehicle} motorcycle with a premium custom vinyl wrap. The wrap is real printed vinyl physically applied to the tank, fairings, tail section, and fenders — never digitally overlaid. Wheels, tires, exhaust, forks, handlebars, seat upholstery, mirrors, and lights remain factory and stay unwrapped.

${specsLine}

${stylingLine}
${colorLine}

${STUDIO_ENVIRONMENT}

${viewAngle}

The motorcycle is the only subject in frame. Canon EOS R5, tack-sharp, 16:9 landscape, perfect exposure, vivid accurate colors. Photorealistic studio render.

Before the image, output a single ORIGINAL creative wrap design name (2–4 words, no quotes).`.trim();
}

// ---------------------------------------------------------------------------
// Boat
// ---------------------------------------------------------------------------

export function buildBoatPrompt(input: NonAutoPromptInput): string {
  const vehicle = buildVehicleLine(input);
  const viewAngle = getBoatView(input.viewType);
  const colorLine = buildColorLine(input.colorData);
  const stylingLine = buildStylingLine(input.colorData, input.customStylingPrompt);
  const specsLine = formatSpecsForPrompt(input.specs);

  return `A photorealistic studio photograph of a ${vehicle} with a premium marine-grade vinyl wrap. The wrap is real printed marine vinyl physically applied to the hull sides above the waterline, topsides, and console or cabin walls — never digitally overlaid. Windows, lights, cleats, rails, outboard motor cowlings, and underwater surfaces remain factory and stay unwrapped.

${specsLine}

${stylingLine}
${colorLine}

${STUDIO_ENVIRONMENT}

${viewAngle}

The boat sits on a clean studio display stand (no water in frame). The boat is the only subject. Canon EOS R5, tack-sharp, 16:9 landscape, perfect exposure, vivid accurate colors. Photorealistic studio render.

Before the image, output a single ORIGINAL creative wrap design name (2–4 words, no quotes).`.trim();
}

// ---------------------------------------------------------------------------
// Bus
// ---------------------------------------------------------------------------

export function buildBusPrompt(input: NonAutoPromptInput): string {
  const vehicle = buildVehicleLine(input);
  const viewAngle = getBusView(input.viewType);
  const colorLine = buildColorLine(input.colorData);
  const stylingLine = buildStylingLine(input.colorData, input.customStylingPrompt);
  const specsLine = formatSpecsForPrompt(input.specs);

  return `A photorealistic studio photograph of a ${vehicle} with a full-length premium vinyl wrap livery. The wrap is real printed vinyl physically applied to the side panels, front cap, rear cap, and roof — never digitally overlaid. Windows, headlights, tail lights, mirrors, wheels, and door handles remain factory and stay unwrapped.

${specsLine}

${stylingLine}
${colorLine}

${STUDIO_ENVIRONMENT}

${viewAngle}

The bus is the only subject in frame. Canon EOS R5, tack-sharp, 16:9 landscape, perfect exposure, vivid accurate colors. Photorealistic studio render.

Before the image, output a single ORIGINAL creative wrap design name (2–4 words, no quotes).`.trim();
}

// ---------------------------------------------------------------------------
// RV
// ---------------------------------------------------------------------------

export function buildRvPrompt(input: NonAutoPromptInput): string {
  const vehicle = buildVehicleLine(input);
  const viewAngle = getRvView(input.viewType);
  const colorLine = buildColorLine(input.colorData);
  const stylingLine = buildStylingLine(input.colorData, input.customStylingPrompt);
  const specsLine = formatSpecsForPrompt(input.specs);

  return `A photorealistic studio photograph of a ${vehicle} motorhome with a full-length premium vinyl wrap. The wrap is real printed vinyl physically applied to the slab sides, front cap, and rear cap — never digitally overlaid. Windows, awnings, compartment doors, slide-out seams, roof accessories, and wheels remain factory and stay unwrapped.

${specsLine}

${stylingLine}
${colorLine}

${STUDIO_ENVIRONMENT}

${viewAngle}

The RV is the only subject in frame. Canon EOS R5, tack-sharp, 16:9 landscape, perfect exposure, vivid accurate colors. Photorealistic studio render.

Before the image, output a single ORIGINAL creative wrap design name (2–4 words, no quotes).`.trim();
}

// ---------------------------------------------------------------------------
// Trailer
// ---------------------------------------------------------------------------

export function buildTrailerPrompt(input: NonAutoPromptInput): string {
  const vehicle = buildVehicleLine(input);
  const viewAngle = getTrailerView(input.viewType);
  const colorLine = buildColorLine(input.colorData);
  const stylingLine = buildStylingLine(input.colorData, input.customStylingPrompt);
  const specsLine = formatSpecsForPrompt(input.specs);

  return `A photorealistic studio photograph of a ${vehicle} trailer with a full-length premium vinyl wrap. The wrap is real printed vinyl physically applied to the long flat side walls, rear door panel, and front wall (if enclosed) — never digitally overlaid. Wheels, tires, fenders, hitch/tongue, ramps, axles, vents, and any windows remain factory and stay unwrapped. Trailer sides are huge uninterrupted flat panels — render graphics that flow nearly full length without distortion. Trailer is shown alone (not towed by a vehicle).

${specsLine}

${stylingLine}
${colorLine}

${STUDIO_ENVIRONMENT}

${viewAngle}

The trailer is the only subject in frame. Canon EOS R5, tack-sharp, 16:9 landscape, perfect exposure, vivid accurate colors. Photorealistic studio render.

Before the image, output a single ORIGINAL creative wrap design name (2–4 words, no quotes).`.trim();
}
