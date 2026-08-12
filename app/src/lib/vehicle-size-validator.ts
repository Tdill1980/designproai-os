/**
 * Vehicle Size Validation Engine - Phase 1 of ProductionFlow
 *
 * Compares selected universal panel sizes against actual vehicle dimensions
 * from the 198-vehicle measurement database. Returns zone-by-zone validation
 * with margin calculations, coverage status, and size recommendations.
 *
 * Usage:
 *   const result = validateSizeForVehicle("Ford", "F-150", "medium");
 *   // → { fits: false, recommendation: "large", zones: [...] }
 */

import {
  findVehicle,
  calculatePricingTier,
  mapToRoofSize,
  type VehicleMeasurement,
} from "@/data/vehicle-measurements";

import {
  SIDE_PANELS,
  ADDON_PANELS,
  ROOF_PANELS,
  TWO_PANEL_HEIGHT_THRESHOLD,
  type SidePanelSize,
  type RoofSize,
  type PanelSelection,
} from "@/lib/panelizer-config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ZoneStatus = "covers" | "tight" | "short";

export interface ZoneValidation {
  zone: string;
  label: string;
  vehicleDimension: number | null; // inches (width for sides, length for roof/hood)
  panelDimension: number;          // inches (selected panel width)
  marginInches: number;            // positive = overhang, negative = short
  status: ZoneStatus;
  message: string;
}

export interface SizeValidationResult {
  /** Does the selected size cover all zones with adequate margin? */
  fits: boolean;
  /** Overall status message */
  summary: string;
  /** Per-zone breakdown */
  zones: ZoneValidation[];
  /** Vehicle found in database? */
  vehicleFound: boolean;
  /** The vehicle record (null if not found) */
  vehicle: VehicleMeasurement | null;
  /** Recommended side size based on vehicle dimensions */
  recommendedSideSize: SidePanelSize | null;
  /** Recommended roof size based on vehicle dimensions */
  recommendedRoofSize: RoofSize | null;
  /** Does the selected size match the recommendation? */
  isOptimalSize: boolean;
  /** Vehicle needs two panels per side (upper + lower at body line break) */
  twoPanel: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum margin (inches) for a zone to be considered "covers" */
const GOOD_MARGIN = 2;

/** Below this margin, the zone is "tight" - it technically fits but risky */
const TIGHT_MARGIN = 0;

// ---------------------------------------------------------------------------
// Core Validation
// ---------------------------------------------------------------------------

/**
 * Validate that the selected panel sizes cover the given vehicle.
 *
 * @param make     - Vehicle make (e.g., "Ford")
 * @param model    - Vehicle model (e.g., "F-150")
 * @param selection - Panel selection (sideSize, addHood, roofSize, etc.)
 * @param year     - Optional year/range
 * @returns Full validation result with per-zone breakdown
 */
export function validateSizeForVehicle(
  make: string,
  model: string,
  selection: PanelSelection,
  year?: string,
): SizeValidationResult {
  const vehicle = findVehicle(make, model, year);

  if (!vehicle) {
    return {
      fits: true,
      summary: "Vehicle not in database - size validation unavailable.",
      zones: [],
      vehicleFound: false,
      vehicle: null,
      recommendedSideSize: null,
      recommendedRoofSize: null,
      isOptimalSize: true,
      twoPanel: false,
    };
  }

  const zones: ZoneValidation[] = [];
  const sidePanel = SIDE_PANELS[selection.sideSize];

  // Detect two-panel vehicle (tall vans with side height > threshold)
  const twoPanel = vehicle.sideH != null && vehicle.sideH > TWO_PANEL_HEIGHT_THRESHOLD;

  // --- Side panel validation ---
  if (vehicle.sideW != null) {
    const margin = sidePanel.widthInches - vehicle.sideW;

    if (twoPanel) {
      // Two-panel: 4 side zones (upper + lower per side), width check only.
      // Height is covered by stacking two 59.5" panels at the body line break.
      for (const side of ["Driver", "Passenger"] as const) {
        for (const zone of ["Upper", "Lower"] as const) {
          const zoneId = `${side.toLowerCase()}-${zone.toLowerCase()}`;
          zones.push({
            zone: zoneId,
            label: `${side} ${zone}`,
            vehicleDimension: vehicle.sideW,
            panelDimension: sidePanel.widthInches,
            marginInches: Math.round(margin * 10) / 10,
            status: getStatus(margin),
            message: getMarginMessage(`${side} ${zone}`, margin, sidePanel.widthInches, vehicle.sideW),
          });
        }
      }
    } else {
      // Standard: 2 side zones
      zones.push({
        zone: "driver-side",
        label: "Driver Side",
        vehicleDimension: vehicle.sideW,
        panelDimension: sidePanel.widthInches,
        marginInches: Math.round(margin * 10) / 10,
        status: getStatus(margin),
        message: getMarginMessage("Driver Side", margin, sidePanel.widthInches, vehicle.sideW),
      });

      zones.push({
        zone: "passenger-side",
        label: "Passenger Side",
        vehicleDimension: vehicle.sideW,
        panelDimension: sidePanel.widthInches,
        marginInches: Math.round(margin * 10) / 10,
        status: getStatus(margin),
        message: getMarginMessage("Passenger Side", margin, sidePanel.widthInches, vehicle.sideW),
      });
    }
  }

  // --- Hood validation ---
  if (selection.addHood && vehicle.hoodW != null) {
    const hoodPanel = ADDON_PANELS.hood;
    const margin = hoodPanel.widthInches - vehicle.hoodW;
    zones.push({
      zone: "hood",
      label: "Hood",
      vehicleDimension: vehicle.hoodW,
      panelDimension: hoodPanel.widthInches,
      marginInches: Math.round(margin * 10) / 10,
      status: getStatus(margin),
      message: getMarginMessage("Hood", margin, hoodPanel.widthInches, vehicle.hoodW),
    });
  }

  // --- Roof validation ---
  if (selection.roofSize !== "none" && vehicle.roofL != null) {
    const roofPanel = ROOF_PANELS[selection.roofSize];
    const margin = roofPanel.widthInches - vehicle.roofL;
    zones.push({
      zone: "roof",
      label: "Roof",
      vehicleDimension: vehicle.roofL,
      panelDimension: roofPanel.widthInches,
      marginInches: Math.round(margin * 10) / 10,
      status: getStatus(margin),
      message: getMarginMessage("Roof", margin, roofPanel.widthInches, vehicle.roofL),
    });
  }

  // --- Rear validation ---
  if (selection.addRearBumper && vehicle.backW != null) {
    const rearPanel = ADDON_PANELS.rear;
    const margin = rearPanel.widthInches - vehicle.backW;
    zones.push({
      zone: "rear",
      label: "Rear",
      vehicleDimension: vehicle.backW,
      panelDimension: rearPanel.widthInches,
      marginInches: Math.round(margin * 10) / 10,
      status: getStatus(margin),
      message: getMarginMessage("Rear", margin, rearPanel.widthInches, vehicle.backW),
    });
  }

  // --- Compute recommendation ---
  const recommendedSideSize = vehicle.sideW != null
    ? calculatePricingTier(vehicle.sideW).tier as SidePanelSize
    : null;

  const roofRec = mapToRoofSize(vehicle.roofL);
  const recommendedRoofSize: RoofSize | null = roofRec ? roofRec.size as RoofSize : null;

  const isOptimalSize = recommendedSideSize === selection.sideSize;
  const hasShort = zones.some(z => z.status === "short");
  const hasTight = zones.some(z => z.status === "tight");
  const fits = !hasShort;

  const sizeLabel = selection.sideSize.charAt(0).toUpperCase() + selection.sideSize.slice(1);

  let summary: string;
  if (hasShort) {
    const shortZones = zones.filter(z => z.status === "short");
    const worstShort = Math.min(...shortZones.map(z => z.marginInches));
    summary = `${sizeLabel} is ${Math.abs(worstShort)}" short on your ${vehicle.make} ${vehicle.model}`;
    if (recommendedSideSize && recommendedSideSize !== selection.sideSize) {
      summary += ` - recommend ${recommendedSideSize.charAt(0).toUpperCase() + recommendedSideSize.slice(1)}`;
    }
  } else if (twoPanel) {
    const bestMargin = zones.length > 0 ? Math.min(...zones.map(z => z.marginInches)) : 0;
    summary = `${sizeLabel} covers your ${vehicle.make} ${vehicle.model} - two panels per side at body line break (${bestMargin}" trim margin)`;
  } else if (hasTight) {
    summary = `${sizeLabel} covers your ${vehicle.make} ${vehicle.model} - tight fit, minimal trim margin`;
  } else {
    const bestMargin = zones.length > 0 ? Math.min(...zones.map(z => z.marginInches)) : 0;
    summary = `${sizeLabel} covers your ${vehicle.make} ${vehicle.model} with ${bestMargin}" trim margin`;
  }

  return {
    fits,
    summary,
    zones,
    vehicleFound: true,
    vehicle,
    recommendedSideSize,
    recommendedRoofSize,
    isOptimalSize,
    twoPanel,
  };
}

/**
 * Get the recommended size for a vehicle (without needing a selection).
 * Useful for auto-selecting the right size on vehicle change.
 */
export function getRecommendedSize(
  make: string,
  model: string,
  year?: string,
): { sideSize: SidePanelSize; roofSize: RoofSize; twoPanel: boolean; vehicle: VehicleMeasurement } | null {
  const vehicle = findVehicle(make, model, year);
  if (!vehicle || vehicle.sideW == null) return null;

  const side = calculatePricingTier(vehicle.sideW);
  const roof = mapToRoofSize(vehicle.roofL);
  const twoPanel = vehicle.sideH != null && vehicle.sideH > TWO_PANEL_HEIGHT_THRESHOLD;

  return {
    sideSize: side.tier as SidePanelSize,
    roofSize: roof ? roof.size as RoofSize : "none",
    twoPanel,
    vehicle,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStatus(marginInches: number): ZoneStatus {
  if (marginInches >= GOOD_MARGIN) return "covers";
  if (marginInches >= TIGHT_MARGIN) return "tight";
  return "short";
}

function getMarginMessage(
  zone: string,
  margin: number,
  panelDim: number,
  vehicleDim: number,
): string {
  const m = Math.abs(Math.round(margin * 10) / 10);
  if (margin >= GOOD_MARGIN) {
    return `${zone}: ${panelDim}" panel covers ${vehicleDim}" vehicle - ${m}" overhang`;
  }
  if (margin >= TIGHT_MARGIN) {
    return `${zone}: ${panelDim}" panel barely covers ${vehicleDim}" vehicle - only ${m}" margin`;
  }
  return `${zone}: ${panelDim}" panel is ${m}" short of ${vehicleDim}" vehicle`;
}
