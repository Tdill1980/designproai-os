/**
 * PROOF GENERATOR SERVICE
 * 
 * Centralized service for generating all 6 proof images across RestylePro tools.
 * Uses the locked PROOF_CONFIG for consistent angle generation.
 * 
 * GENERATION ORDER:
 * 1. Roof (first) - establishes color/design reference
 * 2. Front, Driver, Passenger, Rear, Detail (parallel) - use roof as consistency reference
 *
 * BACKWARD COMPATIBILITY:
 * - Accepts both old and new view type keys
 * - Normalizes output to use new keys (roof, front, driver, passenger, rear, detail)
 * - UI components use getRenderUrlWithFallback() to read both old and new
 */

import { supabase } from "@/integrations/supabase/client";
import { 
  PROOF_CONFIG, 
  getAngleIds, 
  normalizeRenderUrls,
  convertLegacyViewType,
  type ProofAngle 
} from "@/config/proofAngles";

/**
 * Color/design data passed to render generation
 */
export interface ColorData {
  colorName?: string;
  hex?: string;
  finish?: string;
  colorLibrary?: string;
  manufacturer?: string;
  productCode?: string;
  verified?: boolean;
  swatchImageUrl?: string;
  swatchId?: string;
  isVerifiedMatch?: boolean;
  materialProfile?: Record<string, any>;
  customStylingPrompt?: string;
  referenceImageUrl?: string;
}

/**
 * Vehicle data for render generation
 */
export interface VehicleData {
  year: string;
  make: string;
  model: string;
}

/**
 * Options for proof generation
 */
export interface ProofGenerationOptions {
  vehicle: VehicleData;
  colorData: ColorData;
  modeType: 'ColorPro' | 'GraphicsPro' | 'FadeWraps' | 'ApprovePro' | 'PatternPro' | 'DesignPanelPro';
  userEmail?: string;
  /** Generate hero first, then others in parallel (default: true) */
  heroFirst?: boolean;
  /** Callback for progress updates */
  onProgress?: (completed: number, total: number, currentAngle: string) => void;
  /** Callback when individual view completes */
  onViewComplete?: (angleId: string, url: string) => void;
}

/**
 * Result of proof generation
 */
export interface ProofGenerationResult {
  success: boolean;
  /** Render URLs keyed by NEW angle IDs (hero, front, driver, passenger, rear, detail) */
  renderUrls: Record<string, string>;
  /** Number of successful renders */
  completedCount: number;
  /** Any errors that occurred */
  errors: Array<{ angleId: string; error: string }>;
  /** Hero render ID for database reference */
  heroRenderId?: string;
}

/**
 * Generate a single view render
 */
async function generateSingleView(
  vehicle: VehicleData,
  colorData: ColorData,
  modeType: string,
  viewType: string,
  userEmail?: string,
  consistencyReferenceUrl?: string,
  skipLookups?: boolean
): Promise<{ success: boolean; url?: string; renderId?: string; error?: string }> {
  try {
    const payload: Record<string, any> = {
      vehicleYear: vehicle.year,
      vehicleMake: vehicle.make,
      vehicleModel: vehicle.model,
      colorData: { ...colorData },
      modeType,
      viewType,
      userEmail,
    };

    // Add consistency reference for non-hero views
    if (consistencyReferenceUrl) {
      payload.consistencyReferenceUrl = consistencyReferenceUrl;
    }

    // Skip redundant lookups for additional views
    if (skipLookups) {
      payload.skipLookups = true;
    }

    const { data, error } = await supabase.functions.invoke('generate-color-render', {
      body: payload
    });

    if (error) {
      console.error(`❌ Proof generator error (${viewType}):`, error);
      return { success: false, error: error.message };
    }

    if (data?.renderUrl) {
      return { 
        success: true, 
        url: data.renderUrl,
        renderId: data.renderId 
      };
    }

    return { success: false, error: 'No render URL returned' };
  } catch (err: any) {
    console.error(`❌ Proof generator exception (${viewType}):`, err);
    return { success: false, error: err.message };
  }
}

/**
 * Map new angle ID to edge function viewType
 * The edge function currently accepts both old and new keys
 */
function angleIdToViewType(angleId: string): string {
  // New angle IDs map directly - edge function will handle both
  // This allows us to start using new keys while maintaining backward compat
  const mapping: Record<string, string> = {
    'roof': 'roof',
    'front': 'front',
    'driver': 'side',         // Edge function still uses 'side' for now
    'passenger': 'passenger-side',
    'rear': 'rear',
    'detail': 'hood_detail'   // Edge function uses 'hood_detail' for close-up
  };
  return mapping[angleId] || angleId;
}

/**
 * Generate all 6 proof images
 * 
 * Strategy:
 * 1. Generate ROOF first (establishes color reference)
 * 2. Generate remaining 5 views in parallel (using roof as consistency reference)
 */
export async function generateProofImages(
  options: ProofGenerationOptions
): Promise<ProofGenerationResult> {
  const { vehicle, colorData, modeType, userEmail, onProgress, onViewComplete } = options;
  const heroFirst = options.heroFirst !== false; // Default true

  const result: ProofGenerationResult = {
    success: false,
    renderUrls: {},
    completedCount: 0,
    errors: []
  };

  const angleIds = getAngleIds(); // ['roof', 'front', 'driver', 'passenger', 'rear', 'detail']
  const totalViews = angleIds.length;

  console.log('🎬 Starting proof generation:', { 
    modeType, 
    vehicle: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
    angles: angleIds 
  });

  try {
    let heroUrl: string | undefined;

    if (heroFirst) {
      // Step 1: Generate hero first
      onProgress?.(0, totalViews, 'roof');
      
      const heroResult = await generateSingleView(
        vehicle,
        colorData,
        modeType,
        angleIdToViewType('roof'),
        userEmail
      );

      if (heroResult.success && heroResult.url) {
        result.renderUrls['roof'] = heroResult.url;
        result.heroRenderId = heroResult.renderId;
        result.completedCount++;
        heroUrl = heroResult.url;
        onViewComplete?.('roof', heroResult.url);
        console.log('✅ Hero view generated');
      } else {
        result.errors.push({ angleId: 'roof', error: heroResult.error || 'Unknown error' });
        console.error('❌ Hero generation failed:', heroResult.error);
        // Continue anyway - some views are better than none
      }

      onProgress?.(1, totalViews, 'front');

      // Step 2: Generate remaining views in parallel
      const remainingAngles = angleIds.filter(id => id !== 'roof');
      
      const parallelResults = await Promise.allSettled(
        remainingAngles.map(async (angleId, index) => {
          const viewType = angleIdToViewType(angleId);
          
          const viewResult = await generateSingleView(
            vehicle,
            colorData,
            modeType,
            viewType,
            userEmail,
            heroUrl, // Pass hero as consistency reference
            true     // Skip redundant lookups
          );

          // Report progress as each completes
          onProgress?.(result.completedCount + 1, totalViews, angleId);

          return { angleId, ...viewResult };
        })
      );

      // Process parallel results
      for (const promiseResult of parallelResults) {
        if (promiseResult.status === 'fulfilled') {
          const { angleId, success, url, error } = promiseResult.value;
          if (success && url) {
            result.renderUrls[angleId] = url;
            result.completedCount++;
            onViewComplete?.(angleId, url);
            console.log(`✅ ${angleId} view generated`);
          } else {
            result.errors.push({ angleId, error: error || 'Unknown error' });
            console.error(`❌ ${angleId} generation failed:`, error);
          }
        } else {
          // Promise rejected
          const error = promiseResult.reason?.message || 'Promise rejected';
          console.error('❌ Parallel generation rejected:', error);
        }
      }
    } else {
      // Generate all views in parallel (no hero-first priority)
      const allResults = await Promise.allSettled(
        angleIds.map(async (angleId) => {
          const viewType = angleIdToViewType(angleId);
          onProgress?.(result.completedCount, totalViews, angleId);
          
          const viewResult = await generateSingleView(
            vehicle,
            colorData,
            modeType,
            viewType,
            userEmail
          );

          return { angleId, ...viewResult };
        })
      );

      for (const promiseResult of allResults) {
        if (promiseResult.status === 'fulfilled') {
          const { angleId, success, url, error, renderId } = promiseResult.value;
          if (success && url) {
            result.renderUrls[angleId] = url;
            result.completedCount++;
            if (angleId === 'roof') result.heroRenderId = renderId;
            onViewComplete?.(angleId, url);
          } else {
            result.errors.push({ angleId, error: error || 'Unknown error' });
          }
        }
      }
    }

    // Determine overall success (at least hero + 2 others)
    result.success = result.completedCount >= 3;

    console.log('🎬 Proof generation complete:', {
      success: result.success,
      completed: result.completedCount,
      errors: result.errors.length
    });

    return result;
  } catch (err: any) {
    console.error('❌ Proof generation fatal error:', err);
    result.errors.push({ angleId: 'system', error: err.message });
    return result;
  }
}

/**
 * Generate a single additional view for an existing proof
 * Useful for regenerating failed views or adding views to old proofs
 */
export async function generateSingleProofView(
  vehicle: VehicleData,
  colorData: ColorData,
  modeType: string,
  angleId: string,
  userEmail?: string,
  heroReferenceUrl?: string
): Promise<{ success: boolean; url?: string; error?: string }> {
  // Convert new angle ID to edge function viewType
  const viewType = angleIdToViewType(angleId);
  
  return generateSingleView(
    vehicle,
    colorData,
    modeType,
    viewType,
    userEmail,
    heroReferenceUrl,
    !!heroReferenceUrl // Skip lookups if we have a reference
  );
}

/**
 * Validate that a proof has all required views
 * Returns missing angle IDs
 */
export function validateProofCompleteness(
  renderUrls: Record<string, string> | null
): { isComplete: boolean; missingAngles: string[] } {
  if (!renderUrls) {
    return { isComplete: false, missingAngles: getAngleIds() };
  }

  const requiredAngles = getAngleIds();
  const missingAngles: string[] = [];

  for (const angleId of requiredAngles) {
    // Check both new and legacy keys
    const hasNew = !!renderUrls[angleId];
    const legacyKey = angleIdToViewType(angleId);
    const hasLegacy = !!renderUrls[legacyKey];
    
    if (!hasNew && !hasLegacy) {
      missingAngles.push(angleId);
    }
  }

  return {
    isComplete: missingAngles.length === 0,
    missingAngles
  };
}

/**
 * Get the proof configuration for UI display
 */
export function getProofConfig() {
  return PROOF_CONFIG;
}

/**
 * Get angle information for a specific position (1-6)
 */
export function getAngleForPosition(position: number): ProofAngle | undefined {
  return PROOF_CONFIG.angles.find(a => a.position === position);
}
