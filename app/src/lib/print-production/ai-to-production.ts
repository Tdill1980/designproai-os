/**
 * Print Production OS - AI → Production Bridge (Orchestrator)
 *
 * Connects AI flat-panel generation output to the ProductionOS pipeline.
 * This is the glue layer that:
 *
 * 1. Takes a raw Gemini AI-generated flat panel image
 * 2. Runs it through the post-process bridge (validate → upscale → resize → sharpen → bleed)
 * 3. Returns a ProductionOS-compatible DesignSource for the production engine
 *
 * The bridge does NOT modify the AI generation prompt or the ProductionOS modules.
 * It sits between them, transforming AI output format into production input format.
 *
 * Flow:
 *   Gemini AI (flat panel @ correct aspect ratio)
 *     → Post-Process Bridge (upscale → resize → sharpen → bleed)
 *       → DesignSource { type: 'ai-generated', imageUrl: blobUrl }
 *         → ProductionEngine.runJob(jobSpec)
 */

import type {
  DesignSource,
  VehiclePanel,
  VehiclePanelSet,
  BleedSpec,
  DPI,
} from './types';
import { WRAP_DPI, STANDARD_BLEED, SCALE_FACTORS } from './constants';
import {
  getAspectRatio,
  getAspectRatioEntry,
  getAspectRatiosForSelection,
  type AspectRatioEntry,
} from './aspect-ratios';
import {
  processPanel,
  type PanelProcessConfig,
  type ProcessedPanel,
} from './post-process-bridge';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface BridgeConfig {
  /** Enable Real-ESRGAN 4× upscale (default: true) */
  upscaleEnabled: boolean;
  /** Sharpen strength 0.0–1.0 (default: 0.3) */
  sharpenAmount: number;
  /** Bleed per edge in inches (default: 0.5) */
  bleedInches: number;
  /** Output DPI (default: 150) */
  dpi: DPI;
  /** Output scale (default: '10%') */
  scale: string;
  /** Aspect ratio validation tolerance (default: 0.05 = 5%) */
  aspectRatioTolerance: number;
}

export const DEFAULT_BRIDGE_CONFIG: BridgeConfig = {
  upscaleEnabled: true,
  sharpenAmount: 0.3,
  bleedInches: 0.5,
  dpi: WRAP_DPI,
  scale: '10%',
  aspectRatioTolerance: 0.05,
};

// ---------------------------------------------------------------------------
// Bridge Result Types
// ---------------------------------------------------------------------------

export interface BridgeResult {
  /** ProductionOS-compatible design source */
  designSource: DesignSource;
  /** Processed panel data */
  processedPanel: ProcessedPanel;
  /** Panel configuration used */
  panelConfig: PanelProcessConfig;
}

export interface PanelSetBridgeResult {
  /** Map of panel zone → bridge result */
  panels: Map<string, BridgeResult>;
  /** Panels that failed processing */
  failures: Array<{ panelKey: string; error: string }>;
  /** Total processing time in ms */
  totalDurationMs: number;
  /** Summary log */
  log: string[];
}

// ---------------------------------------------------------------------------
// Single Panel Bridge
// ---------------------------------------------------------------------------

/**
 * Bridge a single AI-generated panel image to a ProductionOS DesignSource.
 *
 * Takes the raw AI output (Blob), runs it through the full post-processing
 * pipeline, and returns a DesignSource that can be passed directly to
 * ProductionEngine.createJobSpec().
 *
 * @param aiPanelBlob   Raw AI-generated flat panel image
 * @param panelType     Panel type: 'side' | 'hood' | 'front-bumper' | 'rear' | 'rear-bumper' | 'roof'
 * @param size          Size variant for side/roof panels (e.g., 'large', 'medium')
 * @param config        Optional bridge configuration overrides
 * @returns Bridge result with DesignSource + processed panel data
 */
export async function bridgeAiToProduction(
  aiPanelBlob: Blob,
  panelType: string,
  size?: string,
  config: Partial<BridgeConfig> = {},
): Promise<BridgeResult> {
  const cfg = { ...DEFAULT_BRIDGE_CONFIG, ...config };

  // Look up the aspect ratio entry for this panel
  const entry = getAspectRatioEntry(panelType, size);
  if (!entry) {
    throw new Error(`Unknown panel type: ${panelType}${size ? ':' + size : ''}`);
  }

  // Build process config
  const panelConfig: PanelProcessConfig = {
    widthInches: entry.widthInches,
    heightInches: entry.heightInches,
    expectedRatio: entry.ratio,
    label: entry.label,
    upscaleEnabled: cfg.upscaleEnabled,
    sharpenAmount: cfg.sharpenAmount,
    bleedInches: cfg.bleedInches,
    dpi: cfg.dpi,
    scale: cfg.scale,
  };

  // Run through the post-process pipeline
  const processedPanel = await processPanel(aiPanelBlob, panelConfig);

  // Create ProductionOS-compatible DesignSource
  const designSource: DesignSource = {
    type: 'ai-generated',
    imageUrl: processedPanel.blobUrl,
    finish: 'gloss', // Default - can be overridden by caller
  };

  return {
    designSource,
    processedPanel,
    panelConfig,
  };
}

// ---------------------------------------------------------------------------
// Panel Set Bridge (All Panels)
// ---------------------------------------------------------------------------

/**
 * Process all panels in a vehicle panel set from AI-generated images.
 *
 * Takes a map of panelKey → Blob (one AI-generated image per panel zone)
 * and processes each through the bridge pipeline. Returns results for all
 * panels that can be fed into ProductionEngine.
 *
 * Panels are processed sequentially to avoid memory pressure from
 * concurrent Canvas operations.
 *
 * @param panelBlobs    Map of panel key → AI-generated image blob
 *                      Keys: 'driver-side', 'passenger-side', 'hood', etc.
 * @param selection     Panel selection (determines which panels to process)
 * @param config        Optional bridge configuration overrides
 */
export async function processPanelSet(
  panelBlobs: Map<string, Blob>,
  selection: {
    sideSize: string;
    addHood: boolean;
    addFrontBumper: boolean;
    addRearBumper: boolean;
    roofSize: string;
  },
  config: Partial<BridgeConfig> = {},
): Promise<PanelSetBridgeResult> {
  const startMs = Date.now();
  const log: string[] = [];
  const panels = new Map<string, BridgeResult>();
  const failures: Array<{ panelKey: string; error: string }> = [];

  // Get the expected aspect ratios for all panels in the selection
  const ratios = getAspectRatiosForSelection(selection);
  log.push(`[Bridge] Processing ${ratios.length} panels`);

  for (const { panelKey, entry } of ratios) {
    const blob = panelBlobs.get(panelKey);
    if (!blob) {
      // For passenger-side, try the driver-side blob (it'll be mirrored in production)
      if (panelKey === 'passenger-side') {
        const driverBlob = panelBlobs.get('driver-side');
        if (driverBlob) {
          log.push(`[Bridge] ${panelKey}: using driver-side image (will be mirrored)`);
          try {
            const result = await bridgeAiToProduction(
              driverBlob,
              'side',
              selection.sideSize,
              config,
            );
            panels.set(panelKey, result);
            log.push(`[Bridge] ${panelKey}: OK (${result.processedPanel.metadata.durationMs}ms)`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            failures.push({ panelKey, error: msg });
            log.push(`[Bridge] ${panelKey}: FAILED - ${msg}`);
          }
          continue;
        }
      }

      log.push(`[Bridge] ${panelKey}: no input blob provided, skipping`);
      continue;
    }

    try {
      // Determine panelType and size from the key
      const { panelType, size } = parsePanelKey(panelKey, selection);
      const result = await bridgeAiToProduction(blob, panelType, size, config);
      panels.set(panelKey, result);
      log.push(`[Bridge] ${panelKey}: OK (${result.processedPanel.metadata.durationMs}ms)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push({ panelKey, error: msg });
      log.push(`[Bridge] ${panelKey}: FAILED - ${msg}`);
    }
  }

  const totalDurationMs = Date.now() - startMs;
  log.push(`[Bridge] Complete: ${panels.size} panels processed, ${failures.length} failures, ${totalDurationMs}ms total`);

  return { panels, failures, totalDurationMs, log };
}

// ---------------------------------------------------------------------------
// Convenience: Get Aspect Ratio for Gemini API Call
// ---------------------------------------------------------------------------

/**
 * Get the aspect ratio string to pass to the Gemini API when generating
 * a flat panel for a specific panel type and size.
 *
 * This is the value that goes into:
 *   generationConfig.imageConfig.aspectRatio
 *
 * Usage in edge function:
 *   const ratio = getGeminiAspectRatio('side', 'large'); // "40:12"
 *   imageConfig: { imageSize: "4K", aspectRatio: ratio }
 *
 * @param panelType  'side' | 'hood' | 'front-bumper' | 'rear' | 'rear-bumper' | 'roof'
 * @param size       Size for side/roof panels
 * @returns Aspect ratio string or null if unknown panel
 */
export function getGeminiAspectRatio(panelType: string, size?: string): string | null {
  return getAspectRatio(panelType, size);
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * Revoke blob URLs from bridge results to free memory.
 * Call this when the results are no longer needed.
 */
export function cleanupBridgeResults(result: PanelSetBridgeResult): void {
  result.panels.forEach((bridgeResult) => {
    if (bridgeResult.processedPanel.blobUrl) {
      URL.revokeObjectURL(bridgeResult.processedPanel.blobUrl);
    }
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a panel key into panelType + size for the aspect ratio lookup.
 */
function parsePanelKey(
  panelKey: string,
  selection: { sideSize: string; roofSize: string },
): { panelType: string; size?: string } {
  switch (panelKey) {
    case 'driver-side':
    case 'passenger-side':
      return { panelType: 'side', size: selection.sideSize };
    case 'hood':
      return { panelType: 'hood' };
    case 'front-bumper':
      return { panelType: 'front-bumper' };
    case 'rear':
      return { panelType: 'rear' };
    case 'rear-bumper':
      return { panelType: 'rear-bumper' };
    case 'roof':
      return { panelType: 'roof', size: selection.roofSize };
    default:
      return { panelType: panelKey };
  }
}
