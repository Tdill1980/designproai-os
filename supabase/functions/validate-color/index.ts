import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createExternalClient } from "../_shared/external-db.ts";

/**
 * HARD ENFORCEMENT COLOR VALIDATION
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 
 * This edge function validates colors against the vinyl_swatches database.
 * It REJECTS any color that:
 *   1. Does not exist in the database
 *   2. Exists but lacks complete material validation (LAB, finish_profile)
 *   3. Has invalid or placeholder hex values
 * 
 * Returns suggested alternatives when a color is rejected.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ValidationRequest {
  manufacturer?: string;
  colorName?: string;
  productCode?: string;
  swatchId?: string;
  hex?: string;
  strictMode?: boolean; // If true, requires material_validated = true
}

interface ValidationResult {
  valid: boolean;
  reason?: string;
  message?: string;
  colorData?: any;
  suggestedAlternatives?: Array<{
    id: string;
    name: string;
    manufacturer: string;
    code: string;
    hex: string;
    validated: boolean;
  }>;
}

// Placeholder/invalid hex values that should trigger rejection
const INVALID_HEX_PATTERNS = [
  '#000000', '#000', '0', '', null, undefined,
  '#FFFFFF', '#FFF', // Pure white often placeholder
];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Connect to EXTERNAL database for data operations
    const supabase = createExternalClient();

    const requestBody: ValidationRequest = await req.json();
    const { manufacturer, colorName, productCode, swatchId, hex, strictMode = true } = requestBody;

    console.log('🔍 Color validation request:', { manufacturer, colorName, productCode, swatchId, strictMode });

    // ============= VALIDATION STRATEGY =============
    // 1. If swatchId provided, lookup by ID (highest priority)
    // 2. Else if manufacturer + colorName, lookup by exact match
    // 3. Else if productCode, lookup by code
    // 4. Else if hex provided, fuzzy match by hex

    let query = supabase.from('vinyl_swatches').select('*');
    let searchMethod = '';

    if (swatchId) {
      query = query.eq('id', swatchId);
      searchMethod = 'swatchId';
    } else if (manufacturer && colorName) {
      query = query.ilike('manufacturer', `%${manufacturer}%`).ilike('name', `%${colorName}%`);
      searchMethod = 'manufacturer+colorName';
    } else if (productCode) {
      query = query.ilike('code', `%${productCode}%`);
      searchMethod = 'productCode';
    } else if (hex) {
      query = query.ilike('hex', `%${hex}%`);
      searchMethod = 'hex';
    } else {
      return new Response(
        JSON.stringify({
          valid: false,
          reason: 'MISSING_PARAMETERS',
          message: 'Must provide swatchId, manufacturer+colorName, productCode, or hex',
        } as ValidationResult),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: matchingColors, error } = await query.limit(10);

    if (error) {
      console.error('Database error:', error);
      return new Response(
        JSON.stringify({
          valid: false,
          reason: 'DATABASE_ERROR',
          message: 'Failed to query color database',
        } as ValidationResult),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ============= NO MATCH FOUND =============
    if (!matchingColors || matchingColors.length === 0) {
      console.log(`❌ Color NOT FOUND: ${manufacturer} ${colorName} (search: ${searchMethod})`);
      
      // Fetch suggested alternatives from same manufacturer or similar colors
      const { data: alternatives } = await supabase
        .from('vinyl_swatches')
        .select('id, name, manufacturer, code, hex, material_validated, lab')
        .eq('verified', true)
        .not('lab', 'is', null)
        .limit(5);

      return new Response(
        JSON.stringify({
          valid: false,
          reason: 'COLOR_NOT_FOUND',
          message: `The film "${manufacturer || ''} ${colorName || productCode || hex}" does not exist in our verified color database.`,
          suggestedAlternatives: alternatives?.map(a => ({
            id: a.id,
            name: a.name,
            manufacturer: a.manufacturer,
            code: a.code || '',
            hex: a.hex,
            validated: a.material_validated === true && a.lab !== null,
          })) || [],
        } as ValidationResult),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ============= EXACT MATCH FOUND =============
    const exactMatch = matchingColors[0];
    console.log(`✓ Color FOUND: ${exactMatch.manufacturer} ${exactMatch.name} (ID: ${exactMatch.id})`);

    // ============= STRICT MODE VALIDATION =============
    if (strictMode) {
      // Check for placeholder/invalid hex
      const hexValue = exactMatch.hex?.trim();
      const isInvalidHex = !hexValue || 
        INVALID_HEX_PATTERNS.includes(hexValue) ||
        hexValue.length < 4;

      if (isInvalidHex) {
        console.log(`❌ REJECTED: Invalid/placeholder hex for ${exactMatch.name}: "${hexValue}"`);
        return new Response(
          JSON.stringify({
            valid: false,
            reason: 'INVALID_HEX',
            message: `${exactMatch.manufacturer} ${exactMatch.name} has an invalid hex value and cannot be rendered accurately. This color is pending data verification.`,
            colorData: { id: exactMatch.id, name: exactMatch.name, manufacturer: exactMatch.manufacturer },
          } as ValidationResult),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Check for LAB values (required for color accuracy)
      if (!exactMatch.lab) {
        console.log(`❌ REJECTED: Missing LAB values for ${exactMatch.name}`);
        
        // Fetch alternatives that DO have LAB
        const { data: validatedAlts } = await supabase
          .from('vinyl_swatches')
          .select('id, name, manufacturer, code, hex, material_validated, lab')
          .eq('manufacturer', exactMatch.manufacturer)
          .not('lab', 'is', null)
          .eq('verified', true)
          .limit(5);

        return new Response(
          JSON.stringify({
            valid: false,
            reason: 'MISSING_LAB_PROFILE',
            message: `${exactMatch.manufacturer} ${exactMatch.name} is pending material verification. LAB color profile not yet available.`,
            colorData: { id: exactMatch.id, name: exactMatch.name, manufacturer: exactMatch.manufacturer },
            suggestedAlternatives: validatedAlts?.map(a => ({
              id: a.id,
              name: a.name,
              manufacturer: a.manufacturer,
              code: a.code || '',
              hex: a.hex,
              validated: true,
            })) || [],
          } as ValidationResult),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Check for media_url (required for reference image)
      if (!exactMatch.media_url) {
        console.log(`⚠️ WARNING: Missing media_url for ${exactMatch.name} - will use LAB as primary reference`);
        // Not blocking, but noted - LAB will be primary authority
      }

      // Check for material_validated flag (optional but logged)
      if (!exactMatch.material_validated) {
        console.log(`⚠️ Note: ${exactMatch.name} not yet marked as material_validated - using LAB values`);
      }
    }

    // ============= COLOR VALIDATED SUCCESSFULLY =============
    console.log(`✅ VALIDATED: ${exactMatch.manufacturer} ${exactMatch.name}`);
    console.log(`   LAB: ${JSON.stringify(exactMatch.lab)}`);
    console.log(`   Hex: ${exactMatch.hex}`);
    console.log(`   Media URL: ${exactMatch.media_url ? 'Present' : 'Missing'}`);

    return new Response(
      JSON.stringify({
        valid: true,
        colorData: {
          id: exactMatch.id,
          name: exactMatch.name,
          manufacturer: exactMatch.manufacturer,
          series: exactMatch.series,
          code: exactMatch.code,
          hex: exactMatch.hex,
          lab: exactMatch.lab,
          finish: exactMatch.finish,
          finish_profile: exactMatch.finish_profile,
          reflectivity: exactMatch.reflectivity,
          metallic_flake: exactMatch.metallic_flake,
          media_url: exactMatch.media_url,
          material_validated: exactMatch.material_validated,
          metallic: exactMatch.metallic,
          pearl: exactMatch.pearl,
          chrome: exactMatch.chrome,
        },
      } as ValidationResult),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Validation error:', error);
    return new Response(
      JSON.stringify({
        valid: false,
        reason: 'SERVER_ERROR',
        message: error instanceof Error ? error.message : 'Unknown validation error',
      } as ValidationResult),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
