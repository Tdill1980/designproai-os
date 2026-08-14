/**
 * Print Production OS - Public API
 *
 * This barrel export provides the complete print production system.
 * Import from '@/lib/print-production' for all print production functionality.
 */

// Core types
export type {
  Inches,
  Pixels,
  SquareFeet,
  DPI,
  Dimension2D,
  PixelDimension,
  BoundingBox,
  CMYKColor,
  RGBColor,
  ColorSpace,
  SpotColor,
  ColorProfile,
  MediaType,
  LaminateType,
  MediaSpec,
  PanelZone,
  VehiclePanel,
  VehiclePanelSet,
  BleedSpec,
  OverlapSpec,
  PrintMarks,
  OutputFormat,
  OutputScale,
  OutputSpec,
  PrintJobSpec,
  DesignSource,
  DesignSourceType,
  GradientSpec,
  NestedPanel,
  RollLayout,
  ProductionFile,
  ProductionResult,
  ProductionSummary,
} from './types';

// Constants
export {
  WRAP_DPI,
  DETAIL_DPI,
  OUTPUT_SCALE_FACTOR,
  SCALE_FACTORS,
  STANDARD_BLEED,
  WRAP_EDGE_BLEED,
  STANDARD_OVERLAP_INCHES,
  VINYL_HEIGHT,
  MEDIA_PRESETS,
  FULL_PRINT_MARKS,
  MINIMAL_PRINT_MARKS,
  NO_PRINT_MARKS,
  COLOR_PROFILES,
  CROP_MARK_LENGTH,
  CROP_MARK_OFFSET,
} from './constants';

// Panel Geometry
export {
  generatePanelSet,
  autoSelectPanels,
  panelWithBleed,
  panelPixelDimensions,
  calculateOverlapRegion,
  validateCoverage,
} from './panel-geometry';

// Nesting Engine
export {
  nestPanelsOnRoll,
  splitIntoRolls,
  estimatePrintTime,
  calculateRollsRequired,
} from './nesting-engine';

// Color Engine
export {
  rgbToCmyk,
  cmykToRgb,
  calculateInkCoverage,
  applyInkLimiting,
  checkGamut,
  hexToRgb,
  rgbToHex,
  formatCmyk,
  resolveSpotColor,
  SPOT_COLORS,
} from './color-engine';

// File Output
export {
  generatePanelPNG,
  generatePanelPDF,
  generateProductionPackPDF,
  generateRollLayoutSheet,
} from './file-output';

// Production Engine (Orchestrator)
export { ProductionEngine, productionEngine } from './production-engine';

// Aspect Ratios (AI → Production Bridge)
export type { AspectRatioEntry } from './aspect-ratios';
export {
  WPW_ASPECT_RATIOS,
  getAspectRatio,
  getAspectRatioEntry,
  getTargetPixels,
  getTargetPixelsWithBleed,
  validateAspectRatio,
  getAspectRatiosForSelection,
} from './aspect-ratios';

// Post-Process Bridge
export type {
  PanelProcessConfig,
  ProcessedPanel,
  ValidationResult,
} from './post-process-bridge';
export {
  validateAiOutput,
  upscale4x,
  resizeToExactWpw,
  sharpen,
  addBleed,
  processPanel,
} from './post-process-bridge';

// AI → Production Orchestrator
export type {
  BridgeConfig,
  BridgeResult,
  PanelSetBridgeResult,
} from './ai-to-production';
export {
  DEFAULT_BRIDGE_CONFIG,
  bridgeAiToProduction,
  processPanelSet,
  getGeminiAspectRatio,
  cleanupBridgeResults,
} from './ai-to-production';
