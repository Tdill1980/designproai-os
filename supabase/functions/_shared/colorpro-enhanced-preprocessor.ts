/**
 * ColorPro Enhanced Pre-Processor
 * 
 * This layer handles multi-zone color changes and cut-vinyl graphics
 * WITHOUT touching ColorPro's core prompt builder.
 * 
 * It parses zone instructions, looks up film data, calculates material estimates,
 * and returns an enhanced profile that ColorPro can optionally consume.
 */

import { interpretCustomStyling, ParsedZone, ParsedGraphic } from "./graphic-and-zone-interpreter.ts";
import { calculateMaterialForZone, ZoneMaterialEstimate } from "./material-calculator.ts";

export type MaterialEstimate = ZoneMaterialEstimate;

export interface EnhancedFilmZone {
  zone: string;
  colorName: string;
  manufacturer: string;
  hex: string;
  finish: string;
  finish_profile: string;
  lab?: { L: number; a: number; b: number };
  reflectivity?: number;
  metallic_flake?: number;
  materialValidated?: boolean;
  materialSqft?: number;
  materialYards?: number;
  graphic?: ParsedGraphic;
}

export interface EnhancedGraphic {
  zone: string;
  type: "cut_vinyl";
  keyword: string;
  layers: number;
  color?: string;
  finish?: string;
}

export interface ColorProEnhancedProfile {
  overrideFilmZones: EnhancedFilmZone[];
  overrideGraphics: EnhancedGraphic[];
  revisionPrompt: string | null;
  materialEstimates: MaterialEstimate[];
  multiFilmInfo: Array<{
    zone: string;
    manufacturer: string;
    colorName: string;
    finish: string;
    yards?: number;
  }>;
}

/**
 * Format enhanced film zones into prompt text for ColorPro
 */
export function formatEnhancedFilmZones(zones: EnhancedFilmZone[]): string {
  if (!zones || zones.length === 0) return '';
  
  let prompt = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎨 MULTI-ZONE WRAP INSTRUCTIONS (ColorPro Enhanced)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This vehicle has MULTIPLE color zones. Apply EACH zone exactly as specified:

`;

  for (let i = 0; i < zones.length; i++) {
    const z = zones[i];
    const zoneNumber = i + 1;
    
    // Get finish-specific rendering instructions
    const finishInstructions = getFinishRenderingInstructions(z.finish_profile || z.finish);
    // Get zone-specific rendering instructions (for special zones like calipers, chrome_delete)
    const zoneInstructions = getZoneRenderingInstructions(z.zone);
    
    prompt += `
ZONE ${zoneNumber}: ${z.zone.toUpperCase()}
═══════════════════════════════════════════════════
• Film: ${z.manufacturer} ${z.colorName}
• Hex: ${z.hex}
• Finish: ${z.finish} (${z.finish_profile || z.finish})
${z.lab && z.lab.L != null && z.lab.a != null && z.lab.b != null ? `• LAB: L=${z.lab.L.toFixed(1)}, a=${z.lab.a.toFixed(1)}, b=${z.lab.b.toFixed(1)}` : ''}
${z.reflectivity != null ? `• Reflectivity: ${z.reflectivity.toFixed(2)}` : ''}
${z.metallic_flake != null && z.metallic_flake > 0 ? `• Metallic Flake: ${z.metallic_flake.toFixed(2)} - MUST show visible sparkle` : ''}
${z.materialValidated ? '• ✅ VERIFIED MATERIAL PROFILE' : ''}

${finishInstructions}
${zoneInstructions}
`;
  }

  prompt += `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚨🚨🚨 MANDATORY TWO-TONE SPLIT - THIS IS NOT OPTIONAL 🚨🚨🚨
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ CRITICAL: This vehicle has ${zones.length} DIFFERENT colors. You MUST show BOTH colors.
⚠️ If the entire vehicle appears as ONE solid color, the render FAILS COMPLETELY.

ZONE DEFINITIONS (READ CAREFULLY - "TOP" AND "BOTTOM" ZONES):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

"TOP" or "TOP HALF" ZONE = Upper 50% of the vehicle body:
  ✓ Hood (entire hood panel)
  ✓ Roof (entire roof panel)  
  ✓ A-pillars, B-pillars, C-pillars
  ✓ Upper portions of doors (ABOVE the door handle line / beltline)
  ✓ Upper fenders and upper quarter panels
  → This MUST visually cover approximately HALF the vehicle from the TOP DOWN

"BOTTOM" or "BOTTOM HALF" ZONE = Lower 50% of the vehicle body:
  ✓ Lower portions of doors (BELOW the door handle line / beltline)
  ✓ Lower fenders and lower quarter panels
  ✓ All rocker panels (side skirts)
  ✓ Lower portions of front and rear bumpers
  → This MUST visually cover approximately HALF the vehicle from the BOTTOM UP
  → ⚠️ This is NOT just rocker panels - it is 50% of the entire vehicle body!

🎯 VISUAL REQUIREMENT FOR TWO-TONE:
The split line should be at the BELTLINE (horizontal line running along door handles).
- Everything ABOVE the beltline = TOP zone color
- Everything BELOW the beltline = BOTTOM zone color
- The transition should be a CLEAN HORIZONTAL LINE, NOT a gradient

🚨 FAILURE CONDITIONS:
❌ If the entire vehicle is one solid color = RENDER FAILS
❌ If only the roof is different = RENDER FAILS (need full upper 50%)
❌ If zones blend together = RENDER FAILS (need sharp color separation)

• "ROOF" = only the roof panel
• "HOOD" = only the hood panel  
• "CALIPERS" = brake calipers visible through wheels
• "MIRRORS" = side mirror housings only
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

  return prompt;
}

/**
 * Get finish-specific rendering instructions
 */
function getFinishRenderingInstructions(finish: string): string {
  const f = (finish || 'gloss').toLowerCase();
  
  if (f.includes('chrome')) {
    return `CHROME FINISH REQUIREMENTS:
    - Mirror-like reflections showing environment
    - Sharp, crisp highlights with high contrast
    - Polished metal appearance, NOT glossy paint
    - Visible light source reflections on curved surfaces
    - Maximum reflectivity (0.95+)`;
  }
  
  if (f.includes('satin')) {
    return `SATIN FINISH REQUIREMENTS:
    - Soft, silky sheen - NOT sharp reflections
    - Diffused highlights, no mirror effects
    - Eggshell-like appearance
    - Subtle light interaction without gloss`;
  }
  
  if (f.includes('matte')) {
    return `MATTE FINISH REQUIREMENTS:
    - Completely flat, ZERO shine
    - No reflections whatsoever
    - Light absorbed and diffused
    - Flat like premium wall paint`;
  }
  
  if (f.includes('brushed')) {
    return `BRUSHED METAL FINISH REQUIREMENTS:
    - Directional anisotropic highlights
    - Visible grain/brush direction
    - Soft metallic sheen following brush pattern
    - Highlights streak along brush direction`;
  }
  
  if (f.includes('carbon')) {
    return `CARBON FIBER FINISH REQUIREMENTS:
    - Visible woven carbon fiber pattern
    - 3D depth in the weave
    - Subtle gloss on weave highlights
    - Authentic carbon fiber texture`;
  }
  
  if (f.includes('metallic')) {
    return `METALLIC FINISH REQUIREMENTS:
    - Visible metallic flake/sparkle
    - Glitter effect in direct light
    - Deep, rich color with metallic depth
    - Sparkle concentrated on highlight areas`;
  }
  
  // Default to gloss
  return `GLOSS FINISH REQUIREMENTS:
    - High-gloss wet look
    - Strong specular highlights
    - Mirror-like reflections on curves
    - Crisp, sharp light catchlights`;
}

/**
 * Get zone-specific rendering instructions for special zones
 */
function getZoneRenderingInstructions(zone: string): string {
  const z = zone.toLowerCase();
  
  if (z === 'calipers') {
    return `
🔴 BRAKE CALIPER RENDERING INSTRUCTIONS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Calipers MUST be visible through wheel spokes on ALL FOUR WHEELS
• High-gloss finish with clean, painted appearance
• Consistent color across front AND rear calipers
• Calipers are the brake clamp mechanisms - NOT the rotors (silver discs)
• Must be clearly visible, not hidden by wheel design
• Color should "pop" against the wheel and rotor
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
  }
  
  if (z === 'chrome_delete' || z === 'window_trim' || z === 'grille' || z === 'badges' || z === 'door_handles' || z === 'mirror_caps') {
    return `
🔧 CHROME DELETE RENDERING INSTRUCTIONS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• ALL factory chrome/silver trim MUST be replaced with the specified color
• Chrome delete targets include:
  - Window surrounds (trim around ALL windows)
  - Front grille bars/inserts (NOT the entire grille housing)
  - Door handles
  - Side mirror housings
  - Badges and emblems
  - Roof rails (if applicable)
• Clean, professional vinyl wrap appearance on trim
• NO chrome visible on specified delete areas
• ⚠️ Chrome delete does NOT change the main body color!
• The vehicle BODY stays its original/wrapped color
• Only the TRIM pieces are wrapped in the delete color
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
  }
  
  return '';
}

/**
 * Format enhanced graphics into prompt text
 * ENHANCED: Professional wrap shop instructions for pinstripes, racing stripes, accents
 */
export function formatEnhancedGraphics(graphics: EnhancedGraphic[]): string {
  if (!graphics || graphics.length === 0) return '';
  
  let prompt = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✂️ CUT VINYL GRAPHICS - PROFESSIONAL WRAP SHOP SPECIFICATIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚨 CRITICAL: You are a SENIOR AUTOMOTIVE WRAP DESIGNER executing these graphics.
Apply your 15+ years of professional experience to create ACCURATE vinyl graphics.

`;

  for (const g of graphics) {
    const keyword = g.keyword.toLowerCase();
    const isPinstripe = keyword.includes('pinstripe') || keyword.includes('thin') || keyword.includes('accent line');
    const isRacingStripe = keyword.includes('racing') || keyword.includes('rally') || keyword.includes('dual') || keyword.includes('triple');
    
    if (isPinstripe) {
      prompt += `
📍 PINSTRIPE GRAPHIC - ${g.zone.toUpperCase()}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Type: PINSTRIPE (ultra-thin accent line)
Color: ${g.color || 'Silver'}
Finish: ${g.finish || 'Gloss'}
Layers: ${g.layers > 1 ? `${g.layers} parallel lines` : 'Single line'}

🎯 PINSTRIPE SPECIFICATIONS:
• WIDTH: 1/8" to 1/4" (3mm-6mm) MAXIMUM - VERY THIN!
• These are EXTREMELY thin lines, NOT wide stripes
• Must be UNIFORM width throughout - no tapering
• MUST follow natural body lines and curves
• Clean, crisp edges - CUT VINYL appearance
• Placement: ${g.zone === 'sides' ? 'Horizontal lines along door panels, parallel to door edges' : 
              g.zone === 'hood' ? 'Follow hood creases or edge lines' : 
              'Follow natural body panel lines'}

⚠️ IF PINSTRIPES ARE WIDER THAN 6mm, THE RENDER FAILS!
`;
    } else if (isRacingStripe) {
      prompt += `
🏁 RACING STRIPE GRAPHIC - ${g.zone.toUpperCase()}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Type: RACING/RALLY STRIPE (wide bold stripe)
Color: ${g.color || 'White'}
Finish: ${g.finish || 'Gloss'}
Layers: ${keyword.includes('dual') ? '2 parallel stripes' : keyword.includes('triple') ? '3 parallel stripes' : 'Single wide stripe'}

🎯 RACING STRIPE SPECIFICATIONS:
• WIDTH: 4" to 12" (10-30cm) per stripe - WIDE and BOLD
• Run from FRONT to BACK (hood → roof → trunk)
• ${keyword.includes('dual') ? 'Two parallel stripes with gap between' : 
   keyword.includes('triple') ? 'Three parallel stripes' : 
   'Single centered stripe'}
• Centered on vehicle OR offset (Le Mans style)
• Continuous from front to rear of vehicle
• Bold contrast against base wrap color

`;
    } else {
      prompt += `
✂️ ACCENT GRAPHIC - ${g.zone.toUpperCase()}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Type: ${g.keyword.toUpperCase()} (cut vinyl accent)
Color: ${g.color || 'Custom'}
Finish: ${g.finish || 'Gloss'}
Layers: ${g.layers > 1 ? 'Multi-layer (outline + fill)' : 'Single layer'}

🎯 ACCENT GRAPHIC SPECIFICATIONS:
• Cut vinyl with HARD, CRISP edges
• Sits ON TOP of base wrap color
• Follows natural body lines and contours
• Professional placement and proportions

`;
    }
  }

  prompt += `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚨 MANDATORY GRAPHIC RULES:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• ALL graphics are CUT VINYL - HARD edges, NO gradients, NO blur, NO airbrush
• NO painted effects - this is VINYL not paint
• Each color is a SEPARATE piece of vinyl
• Graphics sit ON TOP of the base wrap layer
• MUST follow natural body lines and curves
• Professional tape-line precision
• PINSTRIPES = THIN (3-6mm) | RACING STRIPES = WIDE (10-30cm)

⚠️ If graphics look painted, blurred, or wrong size, the render FAILS COMPLETELY!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

  return prompt;
}

/**
 * Main pre-processor function
 * Takes a custom styling prompt and returns an enhanced profile for ColorPro
 */
export async function runColorProEnhancedPreProcessor(
  customStylingPrompt: string,
  vehicle: string,
  revisionPrompt: string | null,
  supabase: any
): Promise<ColorProEnhancedProfile> {
  console.log('🚀 ColorPro Enhanced Pre-Processor Started');
  console.log('📝 Styling prompt:', customStylingPrompt);
  
  // 1. Parse zones and graphics from natural language
  const parsedZones = interpretCustomStyling(customStylingPrompt);
  console.log('🔍 Parsed zones:', JSON.stringify(parsedZones, null, 2));
  
  // 2. Enrich zones with database lookups
  const enrichedZones: EnhancedFilmZone[] = [];
  const graphics: EnhancedGraphic[] = [];
  
  for (const zone of parsedZones) {
    console.log(`🔎 Looking up: ${zone.manufacturer} ${zone.color} (finish: ${zone.finish})`);
    
    let swatchData = null;
    
    // Improved lookup logic - prioritize exact matches
    // Try exact color+finish match first (e.g., "Chrome Gold", "Satin Black")
    if (zone.finish && zone.color) {
      const searchTerms = [
        `${zone.finish} ${zone.color}`,  // "Chrome Gold"
        `${zone.color} ${zone.finish}`,  // "Gold Chrome"
        zone.color                        // Just "Gold"
      ];
      
      for (const term of searchTerms) {
        if (swatchData) break;
        
        const { data: match } = await supabase
          .from('vinyl_swatches')
          .select('*')
          .ilike('name', `%${term}%`)
          .eq('verified', true)
          // Exclude compound colors like "Rose Gold" when searching for "Gold"
          .not('name', 'ilike', '%Rose%')
          .not('name', 'ilike', '%Champagne%')
          .limit(1)
          .maybeSingle();
        
        if (match) {
          swatchData = match;
          console.log(`✅ Found match for "${term}": ${match.manufacturer} ${match.name} (${match.hex})`);
        }
      }
    }
    
    // Fallback: manufacturer-specific search
    if (!swatchData && zone.manufacturer && zone.manufacturer !== 'Custom') {
      const { data: manuMatch } = await supabase
        .from('vinyl_swatches')
        .select('*')
        .ilike('manufacturer', `%${zone.manufacturer}%`)
        .ilike('name', `%${zone.color}%`)
        .eq('verified', true)
        .limit(1)
        .maybeSingle();
      
      if (manuMatch) {
        swatchData = manuMatch;
        console.log(`✅ Found manufacturer match: ${manuMatch.manufacturer} ${manuMatch.name} (${manuMatch.hex})`);
      }
    }
    
    // Build enriched zone data
    const enrichedZone: EnhancedFilmZone = {
      zone: zone.zone,
      colorName: swatchData?.name || zone.color,
      manufacturer: swatchData?.manufacturer || zone.manufacturer || 'Custom',
      hex: swatchData?.hex || '#888888',
      finish: swatchData?.finish || zone.finish,
      finish_profile: swatchData?.finish_profile?.type || swatchData?.finish_profile || zone.finish_profile || zone.finish.toLowerCase(),
      materialValidated: swatchData?.material_validated || false,
    };
    
    // Add material profile if available
    if (swatchData?.lab) {
      enrichedZone.lab = swatchData.lab;
    }
    if (swatchData?.reflectivity !== undefined) {
      enrichedZone.reflectivity = swatchData.reflectivity;
    }
    if (swatchData?.metallic_flake !== undefined) {
      enrichedZone.metallic_flake = swatchData.metallic_flake;
    }
    
    console.log(`📊 Enriched zone "${zone.zone}": ${enrichedZone.manufacturer} ${enrichedZone.colorName} (${enrichedZone.hex}) [finish_profile: ${enrichedZone.finish_profile}]`);
    enrichedZones.push(enrichedZone);
    
    // Extract graphics if present
    if (zone.graphic) {
      graphics.push({
        zone: zone.zone,
        type: zone.graphic.type,
        keyword: zone.graphic.keyword,
        layers: zone.graphic.layers,
        color: zone.color,
        finish: zone.finish,
      });
    }
  }
  
  // 3. Calculate material estimates for each zone
  const materialEstimates: MaterialEstimate[] = enrichedZones.map(z => 
    calculateMaterialForZone(z.zone, vehicle, z.finish, `${z.manufacturer} ${z.colorName}`)
  );
  
  // Update zones with material estimates
  for (let i = 0; i < enrichedZones.length; i++) {
    enrichedZones[i].materialSqft = materialEstimates[i].sqft;
    enrichedZones[i].materialYards = materialEstimates[i].yards;
  }
  
  // 4. Build multi-film info for UI consumption
  const multiFilmInfo = enrichedZones.map(z => ({
    zone: z.zone,
    manufacturer: z.manufacturer,
    colorName: z.colorName,
    finish: z.finish,
    yards: z.materialYards,
  }));
  
  console.log('✅ ColorPro Enhanced Pre-Processor Complete');
  console.log(`   - ${enrichedZones.length} film zones`);
  console.log(`   - ${graphics.length} graphics`);
  console.log(`   - Multi-film info:`, JSON.stringify(multiFilmInfo));
  
  return {
    overrideFilmZones: enrichedZones,
    overrideGraphics: graphics,
    revisionPrompt,
    materialEstimates,
    multiFilmInfo,
  };
}
