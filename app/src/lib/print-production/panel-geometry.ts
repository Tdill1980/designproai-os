/**
 * Print Production OS - Panel Geometry Engine
 *
 * Deterministic conversion from vehicle measurements to production panel geometry.
 * This is the core math engine that replaces 360° templates with calculated panels.
 *
 * Algorithm:
 * 1. Take raw vehicle dimensions from the 198-vehicle database
 * 2. Map to the closest Universal Panel size (with overhang for trim margin)
 * 3. Calculate exact pixel dimensions at specified DPI/scale
 * 4. Add bleed extensions to each panel edge
 * 5. Calculate overlap zones for adjacent panels
 *
 * Accuracy target: 99% - every dimension is derived from measured vehicle data,
 * rounded UP to the nearest Universal Panel size to ensure full coverage.
 */

import type {
  VehiclePanel,
  VehiclePanelSet,
  PanelZone,
  BleedSpec,
  Dimension2D,
  PixelDimension,
  Inches,
  SquareFeet,
  DPI,
} from './types';
import { STANDARD_BLEED, STANDARD_OVERLAP_INCHES, WRAP_DPI, SCALE_FACTORS } from './constants';
import {
  SIDE_PANELS,
  ADDON_PANELS,
  ROOF_PANELS,
  type SidePanelSize,
  type RoofSize,
  type PanelSelection,
} from '@/lib/panelizer-config';
import {
  findVehicle,
  calculatePricingTier,
  mapToRoofSize,
  type VehicleMeasurement,
} from '@/data/vehicle-measurements';

// ---------------------------------------------------------------------------
// Panel Geometry from Vehicle Measurements (Deterministic)
// ---------------------------------------------------------------------------

/**
 * Generate a complete vehicle panel set from vehicle measurements.
 * This is the deterministic core - NO AI, NO templates, pure math.
 *
 * @param make   Vehicle make
 * @param model  Vehicle model
 * @param year   Vehicle year (optional)
 * @param selection Panel selection (which zones to include)
 * @returns Full panel set with exact dimensions, or null if vehicle not found
 */
export function generatePanelSet(
  make: string,
  model: string,
  selection: PanelSelection,
  year?: string,
): VehiclePanelSet | null {
  const vehicle = findVehicle(make, model, year);
  if (!vehicle) return null;

  const panels: VehiclePanel[] = [];
  const sideTier = vehicle.sideW != null ? calculatePricingTier(vehicle.sideW) : null;
  const sidePanel = SIDE_PANELS[selection.sideSize];

  // --- Driver side ---
  panels.push({
    zone: 'driver-side',
    label: `Driver Side (${sidePanel.label} ${sidePanel.widthInches}" × ${sidePanel.heightInches}")`,
    widthInches: sidePanel.widthInches,
    heightInches: sidePanel.heightInches,
    sqFt: inchesToSqFt(sidePanel.widthInches, sidePanel.heightInches),
    mirrored: false,
    overlapInches: STANDARD_OVERLAP_INCHES,
  });

  // --- Passenger side (mirrored) ---
  panels.push({
    zone: 'passenger-side',
    label: `Passenger Side (${sidePanel.label} ${sidePanel.widthInches}" × ${sidePanel.heightInches}")`,
    widthInches: sidePanel.widthInches,
    heightInches: sidePanel.heightInches,
    sqFt: inchesToSqFt(sidePanel.widthInches, sidePanel.heightInches),
    mirrored: true,
    overlapInches: STANDARD_OVERLAP_INCHES,
  });

  // --- Hood ---
  if (selection.addHood) {
    const hood = ADDON_PANELS.hood;
    panels.push({
      zone: 'hood',
      label: `Hood (${hood.widthInches}" × ${hood.heightInches}")`,
      widthInches: hood.widthInches,
      heightInches: hood.heightInches,
      sqFt: inchesToSqFt(hood.widthInches, hood.heightInches),
      mirrored: false,
      overlapInches: STANDARD_OVERLAP_INCHES,
    });
  }

  // --- Front bumper ---
  if (selection.addFrontBumper) {
    const fb = ADDON_PANELS.frontBumper;
    panels.push({
      zone: 'front-bumper',
      label: `Front Bumper (${fb.widthInches}" × ${fb.heightInches}")`,
      widthInches: fb.widthInches,
      heightInches: fb.heightInches,
      sqFt: inchesToSqFt(fb.widthInches, fb.heightInches),
      mirrored: false,
      overlapInches: 0,
    });
  }

  // --- Rear ---
  if (selection.addRearBumper) {
    const rear = ADDON_PANELS.rear;
    panels.push({
      zone: 'rear',
      label: `Rear (${rear.widthInches}" × ${rear.heightInches}")`,
      widthInches: rear.widthInches,
      heightInches: rear.heightInches,
      sqFt: inchesToSqFt(rear.widthInches, rear.heightInches),
      mirrored: false,
      overlapInches: STANDARD_OVERLAP_INCHES,
    });

    const rb = ADDON_PANELS.rearBumper;
    panels.push({
      zone: 'rear-bumper',
      label: `Rear Bumper (${rb.widthInches}" × ${rb.heightInches}")`,
      widthInches: rb.widthInches,
      heightInches: rb.heightInches,
      sqFt: inchesToSqFt(rb.widthInches, rb.heightInches),
      mirrored: false,
      overlapInches: 0,
    });
  }

  // --- Roof ---
  if (selection.roofSize !== 'none') {
    const roof = ROOF_PANELS[selection.roofSize];
    panels.push({
      zone: 'roof',
      label: `Roof (${roof.widthInches}" × ${roof.heightInches}")`,
      widthInches: roof.widthInches,
      heightInches: roof.heightInches,
      sqFt: inchesToSqFt(roof.widthInches, roof.heightInches),
      mirrored: false,
      overlapInches: STANDARD_OVERLAP_INCHES,
    });
  }

  const totalSqFt = panels.reduce((sum, p) => sum + p.sqFt, 0);

  return {
    vehicleYear: vehicle.year,
    vehicleMake: vehicle.make,
    vehicleModel: vehicle.model,
    panels,
    totalSqFt: round2(totalSqFt),
    correctedSqFt: vehicle.corrSqFt || round2(totalSqFt),
  };
}

/**
 * Auto-detect optimal panel selection based on vehicle dimensions.
 */
export function autoSelectPanels(
  make: string,
  model: string,
  year?: string,
): PanelSelection | null {
  const vehicle = findVehicle(make, model, year);
  if (!vehicle || vehicle.sideW == null) return null;

  const sideTier = calculatePricingTier(vehicle.sideW);
  const roofMapping = mapToRoofSize(vehicle.roofL);

  return {
    sideSize: sideTier.tier as SidePanelSize,
    addHood: vehicle.hoodW != null && vehicle.hoodW > 0,
    addFrontBumper: false, // Opt-in only
    addRearBumper: vehicle.backW != null && vehicle.backW > 0,
    roofSize: (roofMapping?.size as RoofSize) || 'none',
  };
}

// ---------------------------------------------------------------------------
// Dimension Calculations (Deterministic Math)
// ---------------------------------------------------------------------------

/**
 * Calculate the total physical dimensions of a panel including bleed.
 */
export function panelWithBleed(
  panel: VehiclePanel,
  bleed: BleedSpec = STANDARD_BLEED,
): Dimension2D {
  return {
    width: panel.widthInches + bleed.leftInches + bleed.rightInches,
    height: panel.heightInches + bleed.topInches + bleed.bottomInches,
  };
}

/**
 * Calculate pixel dimensions for a panel at a given DPI and scale.
 *
 * The formula:
 *   pixels = physicalInches × scaleFactor × DPI
 *
 * At 10% scale / 150 DPI:
 *   172" panel → 172 × 0.10 × 150 = 2,580 px
 *
 * At full scale / 150 DPI:
 *   172" panel → 172 × 1.0 × 150 = 25,800 px
 */
export function panelPixelDimensions(
  widthInches: Inches,
  heightInches: Inches,
  dpi: DPI = WRAP_DPI,
  scale: string = '10%',
  bleed: BleedSpec = STANDARD_BLEED,
): { trim: PixelDimension; withBleed: PixelDimension; fullScale: PixelDimension } {
  const factor = SCALE_FACTORS[scale] || 0.10;

  return {
    trim: {
      width: Math.round(widthInches * factor * dpi),
      height: Math.round(heightInches * factor * dpi),
    },
    withBleed: {
      width: Math.round((widthInches + bleed.leftInches + bleed.rightInches) * factor * dpi),
      height: Math.round((heightInches + bleed.topInches + bleed.bottomInches) * factor * dpi),
    },
    fullScale: {
      width: Math.round(widthInches * dpi),
      height: Math.round(heightInches * dpi),
    },
  };
}

/**
 * Calculate overlap regions between adjacent panels.
 * Returns the overlap strip dimensions for cutting guides.
 */
export function calculateOverlapRegion(
  panelA: VehiclePanel,
  panelB: VehiclePanel,
  overlapInches: Inches = STANDARD_OVERLAP_INCHES,
): { width: Inches; height: Inches; description: string } {
  // Overlap is a vertical strip along the shared edge
  const sharedHeight = Math.min(panelA.heightInches, panelB.heightInches);
  return {
    width: overlapInches,
    height: sharedHeight,
    description: `${overlapInches}" overlap between ${panelA.zone} and ${panelB.zone}`,
  };
}

// ---------------------------------------------------------------------------
// Accuracy Validation
// ---------------------------------------------------------------------------

/**
 * Validate that a panel set covers the actual vehicle dimensions.
 * Returns accuracy percentage and any zones that are short.
 */
export function validateCoverage(
  panelSet: VehiclePanelSet,
  make: string,
  model: string,
  year?: string,
): { accuracy: number; issues: string[] } {
  const vehicle = findVehicle(make, model, year);
  if (!vehicle) return { accuracy: 100, issues: ['Vehicle not in database - cannot validate'] };

  const issues: string[] = [];
  let zonesChecked = 0;
  let zonesCovered = 0;

  // Check side coverage
  const driverSide = panelSet.panels.find(p => p.zone === 'driver-side');
  if (driverSide && vehicle.sideW != null) {
    zonesChecked++;
    if (driverSide.widthInches >= vehicle.sideW) {
      zonesCovered++;
    } else {
      issues.push(`Driver side: panel ${driverSide.widthInches}" is ${round2(vehicle.sideW - driverSide.widthInches)}" short of vehicle ${vehicle.sideW}"`);
    }
  }

  // Check hood coverage
  const hood = panelSet.panels.find(p => p.zone === 'hood');
  if (hood && vehicle.hoodW != null) {
    zonesChecked++;
    if (hood.widthInches >= vehicle.hoodW) {
      zonesCovered++;
    } else {
      issues.push(`Hood: panel ${hood.widthInches}" is ${round2(vehicle.hoodW - hood.widthInches)}" short of vehicle ${vehicle.hoodW}"`);
    }
  }

  // Check roof coverage
  const roof = panelSet.panels.find(p => p.zone === 'roof');
  if (roof && vehicle.roofL != null) {
    zonesChecked++;
    if (roof.widthInches >= vehicle.roofL) {
      zonesCovered++;
    } else {
      issues.push(`Roof: panel ${roof.widthInches}" is ${round2(vehicle.roofL - roof.widthInches)}" short of vehicle ${vehicle.roofL}"`);
    }
  }

  // Check rear coverage
  const rear = panelSet.panels.find(p => p.zone === 'rear');
  if (rear && vehicle.backW != null) {
    zonesChecked++;
    if (rear.widthInches >= vehicle.backW) {
      zonesCovered++;
    } else {
      issues.push(`Rear: panel ${rear.widthInches}" is ${round2(vehicle.backW - rear.widthInches)}" short of vehicle ${vehicle.backW}"`);
    }
  }

  const accuracy = zonesChecked > 0 ? round2((zonesCovered / zonesChecked) * 100) : 100;
  return { accuracy, issues };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function inchesToSqFt(w: Inches, h: Inches): SquareFeet {
  return round2((w * h) / 144);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
