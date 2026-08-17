/**
 * artboard-prompt.ts — Prompt builder for the Artboard-First production pipeline
 *
 * Two-pass system:
 *   Pass 1: Generate a Master Artboard showing all panels (for cohesion + approval)
 *   Pass 2: Generate individual high-res panels using the artboard as style reference
 *
 * Prompts stay UNDER 4,000 chars (golden config lesson: shorter = better quality).
 * Positive framing only — no "do not" instructions (Gemini best practice).
 */

import {
  lookupVehicle,
  SIDE_PANELS,
  ADDON_PANELS,
  ROOF_PANELS,
  type VehicleDimensions,
  type PanelSpec,
} from "./panelizer-os/constants.ts";

// ── Types ──────────────────────────────────────────────────────

export interface ArtboardPanel {
  key: string;
  label: string;
  widthInches: number;
  heightInches: number;
  zone: string;
}

export interface ArtboardParams {
  designDescription: string;
  companyName?: string;
  vehicleMake: string;
  vehicleModel: string;
  finish?: string;
  panels: ArtboardPanel[];
}

export interface SinglePanelParams {
  designDescription: string;
  companyName?: string;
  finish?: string;
  panel: ArtboardPanel;
  artboardContext?: string; // text description of the master artboard design
}

// ── Panel Builder ──────────────────────────────────────────────

/**
 * Build the panel list for a vehicle from the measurements database.
 * Returns panels appropriate for the vehicle's dimensions.
 */
export function buildPanelList(
  make: string,
  model: string,
  options: {
    sideSize?: string;
    addHood?: boolean;
    addRear?: boolean;
    addRoof?: boolean;
    roofSize?: string;
  } = {},
): { panels: ArtboardPanel[]; vehicle: VehicleDimensions } {
  const vehicle = lookupVehicle(make, model);

  // Auto-detect side size from vehicle width
  const sideSize = options.sideSize || autoSideSize(vehicle.bodyLengthInches);
  const side = SIDE_PANELS[sideSize] || SIDE_PANELS.medium;

  const panels: ArtboardPanel[] = [
    { key: "driver-side", label: "Driver Side", widthInches: side.widthInches, heightInches: side.heightInches, zone: "side" },
    { key: "passenger-side", label: "Passenger Side", widthInches: side.widthInches, heightInches: side.heightInches, zone: "side" },
  ];

  if (options.addHood !== false) {
    const hood = ADDON_PANELS.hood;
    panels.push({ key: "hood", label: "Hood", widthInches: hood.widthInches, heightInches: hood.heightInches, zone: "addon" });
  }

  if (options.addRear !== false) {
    const rear = ADDON_PANELS.rear;
    panels.push({ key: "rear", label: "Rear", widthInches: rear.widthInches, heightInches: rear.heightInches, zone: "addon" });
  }

  if (options.addRoof) {
    const roofSize = options.roofSize || autoRoofSize(vehicle.roofLengthInches);
    const roof = ROOF_PANELS[roofSize] || ROOF_PANELS.medium;
    panels.push({ key: "roof", label: "Roof", widthInches: roof.widthInches, heightInches: roof.heightInches, zone: "roof" });
  }

  return { panels, vehicle };
}

// ── Pass 1: Master Artboard Prompt ─────────────────────────────

/**
 * Build the system instruction for artboard generation.
 * Short and focused — tells Gemini exactly what role it plays.
 */
export function buildArtboardSystemInstruction(): string {
  return `You are a production file output specialist at WePrintWraps.com. You generate flat, print-ready panel artwork for professional vehicle wraps. Every output is a flat 2D artboard showing all panels as labeled rectangles. You never generate 3D renders, mockups, or vehicle shapes.`;
}

/**
 * Build the user prompt for Master Artboard generation.
 * This produces ONE image with all panels arranged on a single canvas.
 * Under 2,500 chars to stay well within the 4,000 char golden limit.
 */
export function buildArtboardPrompt(params: ArtboardParams): string {
  const { designDescription, companyName, vehicleMake, vehicleModel, finish, panels } = params;

  const panelList = panels.map(p =>
    `• ${p.label} (${p.widthInches}" × ${p.heightInches}")`
  ).join("\n");

  return `Generate a single cohesive MASTER ARTBOARD for a ${vehicleMake} ${vehicleModel} vehicle wrap.

PANELS TO INCLUDE:
${panelList}

DESIGN DIRECTION: "${designDescription}"
${companyName ? `COMPANY: ${companyName}` : ""}
${finish ? `FINISH: ${finish}` : ""}

LAYOUT: Arrange all panels as flat rectangular sections on one continuous canvas. Label each panel with its name and dimensions.

The design flows cohesively across all panels — colors, textures, and graphic elements connect as if the vehicle were a single canvas unwrapped flat.

Each panel is filled edge-to-edge. Text and logos are placed in clear safe zones, large and readable. High-contrast, dense textures throughout. Every pixel is filled — the design bleeds to all edges.

Generate the flat artboard image with all panels arranged in a clean grid layout.`;
}

// ── Pass 2: Individual Panel Prompt ────────────────────────────

/**
 * Build system instruction for individual panel generation.
 */
export function buildPanelSystemInstruction(): string {
  return `You are a production file output specialist at WePrintWraps.com. You generate flat, print-ready panel artwork for professional vehicle wraps. Each output is a single flat 2D rectangular panel — the raw vinyl artwork that will be printed on cast vinyl and physically applied to a real vehicle. No vehicle shapes, no 3D perspective, no mockup environment.`;
}

/**
 * Build the user prompt for generating a single high-res panel.
 * Uses the artboard design context for style consistency.
 * Under 2,000 chars.
 */
export function buildSinglePanelPrompt(params: SinglePanelParams): string {
  const { designDescription, companyName, finish, panel, artboardContext } = params;

  const ratio = panel.widthInches / panel.heightInches;
  const orientation = ratio > 2 ? "very wide horizontal" : ratio > 1.3 ? "wide horizontal" : ratio > 0.8 ? "roughly square" : "tall vertical";

  return `Generate a single flat 2D rectangular panel for a professional vehicle wrap.

PANEL: ${panel.label} — ${panel.widthInches}" wide × ${panel.heightInches}" tall (${orientation} rectangle)
DESIGN: "${designDescription}"
${companyName ? `COMPANY: ${companyName}` : ""}
${finish ? `FINISH: ${finish}` : ""}
${artboardContext ? `\nSTYLE REFERENCE: This panel is part of a cohesive vehicle wrap. ${artboardContext}` : ""}

Generate production-ready wrap art as a flat 2D rectangle. The design fills the entire panel edge-to-edge. Bold graphic energy, high contrast, dense textures optimized for large-format vinyl printing. The visual flow reads naturally left to right.

Generate only the panel image.`;
}

// ── Helpers ────────────────────────────────────────────────────

function autoSideSize(bodyLengthInches: number): string {
  if (bodyLengthInches <= 155) return "small";
  if (bodyLengthInches <= 186) return "medium";
  if (bodyLengthInches <= 220) return "large";
  return "xl";
}

function autoRoofSize(roofLengthInches: number): string {
  if (roofLengthInches <= 80) return "small";
  if (roofLengthInches <= 130) return "medium";
  return "large";
}
