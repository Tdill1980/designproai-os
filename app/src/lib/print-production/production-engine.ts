/**
 * Print Production OS - Production Engine (Orchestrator)
 *
 * This is the main entry point that ties all subsystems together:
 * 1. Panel Geometry Engine → calculates panel dimensions from vehicle data
 * 2. Nesting Engine → optimally arranges panels on roll media
 * 3. Color Engine → converts/validates colors for print
 * 4. Print Marks → adds crop marks, registration, labels
 * 5. File Output → generates production-ready files
 *
 * The pipeline is 100% deterministic and runs entirely client-side.
 * No AI is used in the production file generation - every pixel is calculated.
 *
 * Usage:
 *   const engine = new ProductionEngine();
 *   const result = await engine.runJob(jobSpec);
 *   // result.files → downloadable production files
 *   // result.rollLayout → panel nesting visualization
 *   // result.summary → job metrics
 */

import type {
  PrintJobSpec,
  ProductionResult,
  ProductionFile,
  ProductionSummary,
  VehiclePanelSet,
  BleedSpec,
  PrintMarks,
  MediaSpec,
  OutputSpec,
  DesignSource,
  RollLayout,
} from './types';
import { DEFAULT_MEDIA } from './types';
import {
  STANDARD_BLEED,
  FULL_PRINT_MARKS,
  WRAP_DPI,
  COLOR_PROFILES,
  PRINT_SPEED_SQFT_PER_HOUR,
  JOB_SETUP_MINUTES,
} from './constants';
import { generatePanelSet, autoSelectPanels, validateCoverage } from './panel-geometry';
import { nestPanelsOnRoll, splitIntoRolls, estimatePrintTime, calculateRollsRequired } from './nesting-engine';
import { rgbToCmyk, checkGamut, hexToRgb, formatCmyk } from './color-engine';
import { generatePanelPNG, generatePanelPDF, generateProductionPackPDF, generateRollLayoutSheet } from './file-output';
import type { PanelSelection } from '@/lib/panelizer-config';

// ---------------------------------------------------------------------------
// Production Engine
// ---------------------------------------------------------------------------

export class ProductionEngine {
  /**
   * Run a complete production job.
   *
   * @param spec  Full job specification
   * @returns Production result with files, layout, and summary
   */
  async runJob(spec: PrintJobSpec): Promise<ProductionResult> {
    const { vehiclePanels, media, bleed, marks, output, designSource } = spec;

    // Step 1: Nest panels on roll
    const rollLayout = nestPanelsOnRoll(vehiclePanels, media, bleed);

    // Step 2: Check if we need multiple rolls
    const rolls = splitIntoRolls(rollLayout, media.maxLengthInches);
    const rollsRequired = rolls.length;

    // Step 3: Load design image (if provided)
    let designImage: HTMLImageElement | string | undefined;
    if (designSource.imageUrl) {
      designImage = designSource.imageUrl;
    }

    // Step 4: Generate production files for each panel
    const files: ProductionFile[] = [];
    const scale = output.scale;
    const dpi = output.dpi;

    for (const panel of vehiclePanels.panels) {
      let file: ProductionFile;

      if (output.format === 'pdf') {
        file = await generatePanelPDF(panel, designImage, marks, bleed, dpi, scale, spec.id);
      } else {
        file = await generatePanelPNG(panel, designImage, marks, bleed, dpi, scale, spec.id);
      }

      files.push(file);
    }

    // Step 5: Generate roll layout sheet
    const rollLayoutFile = await generateRollLayoutSheet(rollLayout, spec.id);

    // Step 6: Generate production pack PDF (all panels in one file)
    let packFile: ProductionFile | undefined;
    if (output.format === 'pdf' && vehiclePanels.panels.length > 1) {
      packFile = await generateProductionPackPDF(
        vehiclePanels.panels, designImage, marks, bleed, dpi, scale, spec.id,
      );
      files.push(packFile);
    }

    // Step 7: Calculate summary
    const printTime = estimatePrintTime(rollLayout);
    const summary: ProductionSummary = {
      totalPanels: vehiclePanels.panels.length,
      totalSqFt: vehiclePanels.correctedSqFt || vehiclePanels.totalSqFt,
      mediaUsedFeet: rollLayout.totalLengthFeet,
      wastePercent: rollLayout.wastePercent,
      estimatedPrintTime: printTime.display,
      rollsRequired,
    };

    return {
      jobSpec: spec,
      rollLayout,
      files,
      rollLayoutFile,
      summary,
    };
  }

  /**
   * Create a job spec from user inputs.
   * This is the primary entry point for the UI layer.
   */
  createJobSpec(params: {
    make: string;
    model: string;
    year?: string;
    selection: PanelSelection;
    designImageUrl?: string;
    finish?: string;
    mediaPreset?: string;
    outputFormat?: 'pdf' | 'png';
    outputScale?: string;
    includeMarks?: boolean;
  }): PrintJobSpec | null {
    const panelSet = generatePanelSet(
      params.make,
      params.model,
      params.selection,
      params.year,
    );

    if (!panelSet) return null;

    const media = params.mediaPreset
      ? (MEDIA_PRESETS_IMPORT[params.mediaPreset] || DEFAULT_MEDIA)
      : DEFAULT_MEDIA;

    const marks = params.includeMarks !== false ? FULL_PRINT_MARKS : {
      cropMarks: false,
      registrationMarks: false,
      colorBars: false,
      foldMarks: false,
      panelLabels: true,
      dimensionLabels: false,
    };

    const designSource: DesignSource = {
      type: params.designImageUrl ? 'custom-upload' : 'solid-color',
      imageUrl: params.designImageUrl,
      finish: (params.finish as any) || 'gloss',
    };

    return {
      id: generateJobId(),
      createdAt: new Date().toISOString(),
      vehiclePanels: panelSet,
      media,
      bleed: STANDARD_BLEED,
      overlap: { seamOverlapInches: 0.5, side: 'both' },
      marks,
      output: {
        format: params.outputFormat || 'png',
        dpi: WRAP_DPI,
        scale: (params.outputScale as any) || '10%',
        colorProfile: COLOR_PROFILES.srgb,
        embedFonts: true,
      },
      designSource,
    };
  }

  /**
   * Quick validation - check if panels will cover the vehicle.
   */
  validateJob(
    make: string,
    model: string,
    selection: PanelSelection,
    year?: string,
  ): { accuracy: number; issues: string[] } | null {
    const panelSet = generatePanelSet(make, model, selection, year);
    if (!panelSet) return null;
    return validateCoverage(panelSet, make, model, year);
  }

  /**
   * Get auto-selected panels for a vehicle.
   */
  getAutoSelection(make: string, model: string, year?: string) {
    return autoSelectPanels(make, model, year);
  }

  /**
   * Pre-flight check for design colors.
   */
  preflightColor(hex: string) {
    const rgb = hexToRgb(hex);
    const cmyk = rgbToCmyk(rgb);
    const gamut = checkGamut(rgb);
    return { rgb, cmyk, cmykFormatted: formatCmyk(cmyk), gamut };
  }

  /**
   * Estimate material and cost for a vehicle.
   */
  estimateMaterial(
    make: string,
    model: string,
    selection: PanelSelection,
    year?: string,
    media: MediaSpec = DEFAULT_MEDIA,
  ) {
    const panelSet = generatePanelSet(make, model, selection, year);
    if (!panelSet) return null;

    const rollLayout = nestPanelsOnRoll(panelSet, media);
    const printTime = estimatePrintTime(rollLayout);
    const rolls = calculateRollsRequired(rollLayout.totalLengthInches, media.maxLengthInches);

    return {
      panelSet,
      rollLayout,
      printTime: printTime.display,
      rollsRequired: rolls,
      totalSqFt: panelSet.correctedSqFt || panelSet.totalSqFt,
      linearFeet: rollLayout.totalLengthFeet,
      wastePercent: rollLayout.wastePercent,
    };
  }
}

// Import media presets
import { MEDIA_PRESETS as MEDIA_PRESETS_IMPORT } from './constants';

// ---------------------------------------------------------------------------
// Job ID Generation
// ---------------------------------------------------------------------------

function generateJobId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `PPS-${timestamp}-${random}`.toUpperCase();
}

// ---------------------------------------------------------------------------
// Singleton Export
// ---------------------------------------------------------------------------

/** Global production engine instance */
export const productionEngine = new ProductionEngine();
