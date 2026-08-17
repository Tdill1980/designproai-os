import { ASPECT_RATIO_REQUIREMENT } from "./aspect-ratio-requirement.ts";
import { PHOTOREALISM_REQUIREMENT } from "./photorealism-prompt.ts";
import { FORBIDDEN_TEXT_WATERMARK_INSTRUCTIONS } from "./forbidden-text-instructions.ts";
import { getFinishSpecification } from "./finish-specifications.ts";
import { getStudioEnvironment, selectStudioForZones, selectStudioForFinish, StudioType } from "./studio-environments.ts";
import { buildCompleteHardEnforcement } from "./hard-enforcement-blocks.ts";

// ============================================================================
// RESTYLEPRO EXCLUSIVE BRANDING HEADER
// This prevents AI from referencing any competitor brands or watermarks
// ============================================================================
const RESTYLEPRO_HEADER = `
═══════════════════════════════════════════════════════════════════════════════
🏢 RESTYLEPRO™ VISUALIZER SUITE - EXCLUSIVE IMAGE GENERATION
═══════════════════════════════════════════════════════════════════════════════

You are generating images EXCLUSIVELY for the RestylePro™ Visualizer Suite.
This is a professional automotive wrap visualization platform.

🚨 CRITICAL BRANDING RULES:
- NEVER reference any other brand, company, tool, watermark, or competitor label
- NEVER generate text such as "WRAPSTOCK", "DESIGN TOOL", or any third-party names
- NEVER place ANY text inside the rendered image unless explicitly specified
- Render ONLY the vehicle and its applied vinyl graphics
- All branding will be added as overlays AFTER generation - do NOT add any text

Your output must be a clean, professional automotive photograph with NO watermarks,
NO corner text, NO labels, NO logos - just the beautifully wrapped vehicle.
═══════════════════════════════════════════════════════════════════════════════
`;

// ============================================================================
// EXPERT WRAP DESIGNER SYSTEM PROMPT
// This teaches the AI professional vinyl wrap shop knowledge
// ============================================================================
const EXPERT_WRAP_DESIGNER_PROMPT = `
═══════════════════════════════════════════════════════════════════════════════
👔 SENIOR AUTOMOTIVE WRAP DESIGNER - 15+ YEARS PROFESSIONAL EXPERIENCE
═══════════════════════════════════════════════════════════════════════════════

You are a SENIOR AUTOMOTIVE WRAP DESIGNER with extensive professional experience.
You understand every type of wrap shop request and know EXACTLY how to execute them.

🎓 YOUR EXPERTISE INCLUDES:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. PINSTRIPES (Ultra-thin accent lines):
   • Width: 1/8" to 1/4" (3mm-6mm) MAXIMUM - VERY THIN!
   • MUST follow the natural body lines and curves of the vehicle
   • Parallel to door edges, fender lines, or body creases
   • ALWAYS consistent width throughout - no tapering
   • Clean, crisp edges - CUT VINYL, not painted
   • Common placements: along door panels, fender edges, hood creases, trunk edges
   • "Pinstripes along sides" = thin lines running horizontally along door panels

2. RACING STRIPES (Bold parallel lines):
   • Width: 4" to 12" (10-30cm) per stripe
   • Run from front to back of vehicle (hood → roof → trunk)
   • Can be single, dual (two parallel), or triple stripes
   • Centered on vehicle or offset (Le Mans style)
   • "Rally stripes" = same as racing stripes
   • Colors typically contrast with base wrap (white on blue, black on gold, etc.)

3. ACCENT GRAPHICS (Decorative elements on specific panels):
   • "Hood accent" = graphic element on the hood (stripe, tribal, geometric shape)
   • "Side accent" = graphic along door panels or rocker area
   • "Roof accent" = graphic on roof panel
   • Accents are DECORATIVE elements that enhance the design
   • Always CUT VINYL - single solid colors with hard edges

4. SIDE GRAPHICS (Graphics running along vehicle sides):
   • "Side stripes" = horizontal lines along doors from front fender to rear quarter
   • "Rocker stripes" = stripes along the bottom rocker panels
   • "Door graphics" = decorative elements on door panels specifically

5. GRAPHIC COLORS:
   • When user specifies colors like "silver and white pinstripes" = TWO pinstripe colors
   • Silver pinstripe + white pinstripe running parallel
   • Multi-color stripes are stacked or parallel, never blended

6. BODY LINE FOLLOWING:
   • ALL graphics MUST follow OEM body lines and creases
   • Curves with the vehicle contours
   • Professional tape-line precision
   • No floating or disconnected graphics

7. CHROME DELETE (Converting OEM chrome trim to color):
   • "Chrome delete" = wrap ALL factory chrome trim in specified color
   • Typical chrome delete targets:
     - Window surrounds/trim (around ALL windows)
     - Front grille bars and inserts
     - Roof rails
     - Door handles
     - Side mirror housings
     - Badges and emblems
     - Exhaust tips (visual only)
   • Most common colors: Matte Black, Gloss Black, Satin Black, or body color match
   • "Blackout" = same as chrome delete with black vinyl
   • "Murdered out" = all chrome deleted + black body + black wheels + tinted lights
   • 🚨 Chrome delete does NOT change body color - only chrome/silver trim pieces

8. BRAKE CALIPER COLORING:
   • Calipers are visible through wheel spokes on ALL FOUR WHEELS
   • Popular colors: Red (performance), Yellow (exotic), Blue (sport), Black (stealth)
   • Must show CONSISTENTLY on ALL four wheels
   • High-gloss finish typical for calipers
   • "Red calipers" = all four brake calipers painted/wrapped red
   • Calipers are the clamp mechanisms behind the wheel - NOT the rotors

═══════════════════════════════════════════════════════════════════════════════
🚨 CRITICAL RULES FOR ALL GRAPHICS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• ALL graphics are CUT VINYL - crisp hard edges, NO gradients, NO airbrush
• NO printing - solid color vinyl only
• NO painted effects - this is VINYL not paint
• Graphics sit ON TOP of the base wrap layer
• Each graphic color is a separate piece of vinyl
• THIN pinstripes (3-6mm) vs WIDE racing stripes (10-30cm) - know the difference!
• When in doubt, follow the natural body lines of the vehicle
• Chrome delete = ONLY chrome trim, NOT the entire vehicle body

═══════════════════════════════════════════════════════════════════════════════
`;

/**
 * Centralized ColorPro Prompt Builder
 * 
 * This is the SINGLE SOURCE OF TRUTH for all ColorPro rendering prompts.
 * All color accuracy, material profile, camera positioning, and finish logic is consolidated here.
 * 
 * DO NOT add inline prompt construction in generate-color-render. All changes should be made here.
 */
export function buildColorProPrompt(params: {
  vehicle: string;
  colorName: string;
  manufacturer: string;
  hex: string;
  finish: string;
  cameraAngle: string;
  viewType?: string;
  validatedColorData?: any;
  colorIntelligence?: any;
  isColorFlipFilm?: boolean;
  webReferenceImages?: string[];
  // Material profile fields for accurate rendering
  lab?: { L: number; a: number; b: number };
  reflectivity?: number;
  metallic_flake?: number;
  finish_profile?: {
    highlight_softness?: number;
    shadow_saturation_falloff?: number;
    anisotropy?: number;
    texture?: string;
  };
  materialValidated?: boolean;
  // GraphicsPro zone instructions (appended to prompt)
  graphicsProZoneBlock?: string;
  // Zones for multi-zone renders (used for studio selection)
  zones?: Array<{ finish_profile?: string; finish?: string }>;
  // Tool branding override (for GraphicsPro vs ColorPro)
  toolBranding?: string;
}): string {
  const {
    vehicle, colorName, manufacturer, hex, finish, cameraAngle, viewType = 'front',
    validatedColorData, colorIntelligence,
    isColorFlipFilm: isColorFlipFilmFromUpstream, webReferenceImages,
    lab, reflectivity, metallic_flake, finish_profile, materialValidated,
    graphicsProZoneBlock,
    zones,
    toolBranding = 'ColorPro™'
  } = params;

  // ColorPro upstream detects color-flip by COLOR NAME keywords only — it misses
  // films where the flip signal lives in the FINISH column (e.g. Avery "Diamond
  // Red", Hexis "Austral Sea" with finish="Iridescent", 3M "Satin Flip Ghost
  // Pearl" with finish="Satin"). Re-run the detection on the finish string and
  // OR with the upstream flag so the colorFlipBlock fires whenever either layer
  // identifies a color-shifting film.
  const finishLower = (typeof finish === 'string' ? finish : '').toLowerCase();
  const isColorFlipFromFinish =
    finishLower.includes('ghost') ||
    finishLower.includes('flip') ||
    finishLower.includes('iridescent') ||
    finishLower.includes('chameleon') ||
    finishLower.includes('shift effect') ||
    finishLower.includes('color shift') ||
    finishLower.includes('colorshift') ||
    finishLower.includes('rainbow') ||
    finishLower.includes('psychedelic') ||
    finishLower.includes('diamond');
  const isColorFlipFilm = Boolean(isColorFlipFilmFromUpstream) || isColorFlipFromFinish;
  if (isColorFlipFromFinish && !isColorFlipFilmFromUpstream) {
    console.log(`🌈 COLOR-FLIP DETECTED VIA FINISH: "${finish}" (color: ${colorName})`);
  }

  // ============= DYNAMIC STUDIO SELECTION =============
  // Chrome/metallic finishes REQUIRE hard light studio for proper reflections
  let studioType: StudioType = 'soft_diffusion';
  if (zones && zones.length > 0) {
    studioType = selectStudioForZones(zones);
  } else {
    studioType = selectStudioForFinish(finish);
  }
  const studioEnvironment = getStudioEnvironment(studioType);
  console.log(`🏭 Studio selected: ${studioType} (finish: ${finish}, zones: ${zones?.length || 0})`);
  
  const glossFinish = getFinishSpecification(finish);
  
  // ============= COLOR VALIDATION SECTION =============
  let colorValidationBlock = '';
  if (validatedColorData && validatedColorData.confidence >= 0.7) {
    colorValidationBlock = `
COLOR VALIDATION FROM REAL PHOTOS:
- Validated Hex: ${validatedColorData.hexCode}
- Confidence: ${(validatedColorData.confidence * 100).toFixed(0)}%
- Metallic Flakes: ${validatedColorData.hasMetallicFlakes ? 'YES' : 'NO'}
- ${validatedColorData.description || validatedColorData.reasoning || ''}`;
  }
  
  if (colorIntelligence && colorIntelligence.confidence >= 0.7) {
    colorValidationBlock += `

COLOR INTELLIGENCE:
- ${colorIntelligence.description || ''}
- Detected Finish: ${colorIntelligence.detectedFinish || 'N/A'}`;
  }
  
  // ============= HARD ENFORCEMENT MODE (CRITICAL FOR ACCURACY) =============
  // When LAB values are present, use the complete hard enforcement system
  let hardEnforcementBlock = '';
  let materialProfileBlock = '';
  
  if (lab) {
    // Use HARD ENFORCEMENT MODE with all locks
    hardEnforcementBlock = buildCompleteHardEnforcement({
      manufacturer: manufacturer || 'Custom',
      colorName: colorName,
      productCode: validatedColorData?.code,
      hex: hex,
      lab: lab,
      finish: finish,
      reflectivity: reflectivity,
      metallic_flake: metallic_flake,
      finish_profile: finish_profile,
      metallic: validatedColorData?.metallic,
      pearl: validatedColorData?.pearl,
      chrome: finish?.toLowerCase().includes('chrome') || validatedColorData?.chrome,
      texture: finish_profile?.texture,
    });
    
    console.log('🔐 HARD ENFORCEMENT MODE ACTIVE for:', manufacturer, colorName);
  } else {
    // Fallback for colors without LAB (legacy behavior with warning)
    materialProfileBlock = `
⚠️ WARNING: This color lacks verified LAB values - accuracy may vary ⚠️

COLOR: ${colorName}
MANUFACTURER: ${manufacturer || 'Custom'}
HEX: ${hex}
FINISH: ${finish}

${reflectivity !== undefined ? `Reflectivity: ${reflectivity.toFixed(2)}` : ''}
${metallic_flake !== undefined ? `Metallic Flake: ${metallic_flake.toFixed(2)}` : ''}

Match the hex color ${hex} as closely as possible.
This color is pending LAB verification for guaranteed accuracy.`;
    
    console.log('⚠️ NON-VALIDATED COLOR (no LAB):', manufacturer, colorName);
  }
  
  // ============= COLOR-FLIP FILM SECTION =============
  let colorFlipBlock = '';
  if (isColorFlipFilm) {
    colorFlipBlock = `
🌈🌈🌈 CRITICAL: COLOR-SHIFTING/FLIP FILM RENDERING 🌈🌈🌈
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
THIS IS "${colorName}" - A COLOR-SHIFTING VINYL FILM
DO NOT render this as a single flat color! This film has DYNAMIC color-shift effects.

🚨 MANDATORY COLOR-SHIFT REQUIREMENTS 🚨
1. The film MUST show VISIBLE COLOR VARIATION across body panels
2. Panels facing direct light should show ONE color (e.g., copper/gold/warm tones)
3. Panels angled away should show a DIFFERENT color (e.g., purple/blue/cool tones)
4. Hood, fenders, doors, and rear panels should each display DIFFERENT hues
5. The color transition must be smooth and follow surface curves naturally
6. Include visible METALLIC/PEARL PARTICLES that shift color with viewing angle

COLOR SHIFT MAPPING BY SURFACE ANGLE:
- Direct light surfaces (hood center, roof center): Primary color shift tone
- Angled surfaces (fenders, door panels): Secondary color shift tone
- Shadow/edge areas: Tertiary/deepest color shift tone
- Curved transitions: Smooth blend between all color shift tones

🎯 THIS IS NOT A SINGLE HEX COLOR - The hex ${hex} is just a BASE reference.
The ACTUAL appearance varies dramatically across the vehicle based on viewing angle.
Study the reference images to understand the FULL color-shift range.

🚨 IF THE VEHICLE APPEARS AS ONE SOLID COLOR, THE RENDER FAILS COMPLETELY 🚨
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
  }
  
  // ============= REFERENCE IMAGES SECTION =============
  let referenceImagesBlock = '';
  if (webReferenceImages && webReferenceImages.length > 0) {
    referenceImagesBlock = `
🎯🎯🎯 OFFICIAL MANUFACTURER SWATCH & REFERENCE IMAGES (${webReferenceImages.length} total) 🎯🎯🎯
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚨🚨🚨 CRITICAL COLOR AUTHORITY 🚨🚨🚨

THE FIRST IMAGE IS THE OFFICIAL MANUFACTURER SWATCH - THIS IS THE EXACT COLOR YOU MUST MATCH.
• Image 1 = OFFICIAL ${manufacturer || 'MANUFACTURER'} swatch for "${colorName}"
• This is the REAL vinyl film color - NOT an approximation
• MATCH THIS COLOR EXACTLY - it is more accurate than any hex value

${validatedColorData ? `✅ AI VALIDATED COLOR ANALYSIS:
- Validated Hex: ${validatedColorData.hexCode}
- Finish: ${validatedColorData.finish}
- Metallic Flakes: ${validatedColorData.hasMetallicFlakes ? 'YES - Visible metallic particles' : 'NO'}
- Confidence: ${(validatedColorData.confidence * 100).toFixed(0)}%` : ''}

🎯 YOUR MISSION:
1. LOOK AT THE FIRST IMAGE - that IS the color you must render
2. Match the exact hue, saturation, and lightness from that swatch
3. Additional images show texture/finish for confirmation only
4. The hex value "${hex}" is an APPROXIMATION - trust the swatch image MORE

⚠️ IF YOUR RENDER COLOR DOESN'T MATCH THE SWATCH IMAGE, THE RENDER FAILS ⚠️
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
  }
  
  // ============= WRAP COVERAGE RULES =============
  const wrapCoverageBlock = `
🚨 CRITICAL - WHAT TO WRAP VS WHAT NOT TO WRAP 🚨
WRAP THESE BODY PANELS ONLY:
✓ Hood
✓ Roof
✓ Trunk/Deck lid
✓ Front fenders
✓ Doors
✓ Rear quarter panels
✓ Front bumper cover (painted plastic part)
✓ Rear bumper cover (painted plastic part)

NEVER EVER WRAP THESE COMPONENTS:
❌ WINDSHIELD - ABSOLUTELY NEVER WRAP - must remain 100% transparent clear glass
❌ ALL WINDOWS - front, rear, side glass MUST remain completely transparent
❌ Metal grilles/grills (front or rear) - MUST stay BLACK/CHROME/SILVER
❌ Headlights and headlight housings - MUST stay CLEAR/BLACK
❌ Taillights and taillight housings - MUST stay RED/CLEAR/BLACK
❌ Wheels and rims - MUST stay BLACK/SILVER/CHROME
❌ Tires - MUST stay BLACK rubber
❌ Door handles (unless painted body color originally)
❌ Side mirrors (unless painted body color originally)
❌ Chrome trim and badges
❌ Exhaust tips
❌ License plate area

🚨 GLASS TRANSPARENCY IS MANDATORY - If windshield or any window appears wrapped, tinted, or colored, the render FAILS.
CRITICAL: If vinyl wrap appears on ANY grille, headlight, taillight, wheel, tire, or glass surface, the render FAILS COMPLETELY.`;

  // ============= COLOR RENDERING RULES =============
  const colorRenderingRules = `
🚨 MANDATORY COLOR RENDERING RULES 🚨
1. PINK/LIGHT COLORS (hex starting with #FF, #F, light colors):
   - These are BRIGHT, VIBRANT, PASTEL colors
   - DO NOT darken or desaturate them
   - Pink like #FFC0CB is BABY PINK / LIGHT PINK - render it as a soft, bright, cheerful pink
   - Keep full brightness and saturation from the hex code

2. STUDIO LIGHTING FOR COLOR ACCURACY:
   - Professional studio with textured DARK polished concrete floor
   - Medium-dark neutral gray wall with gentle vertical gradient
   - Neutral daylight-balanced lighting (5500K-6500K)
   - Multiple large diffused softboxes positioned off-camera
   - Lighting must REVEAL the true color without blowing out highlights

3. COLOR MATCHING STANDARD:
   ${isColorFlipFilm 
     ? `- Study the reference images showing the FULL color-shift range
   - Replicate the color variation visible at different angles
   - The hex ${hex} is just a starting point - the REAL appearance is multi-colored`
     : materialValidated 
     ? `- LAB values are the PRIMARY source of truth - match EXACTLY
   - HEX ${hex} is secondary reference only
   - Do NOT override with "training data" assumptions`
     : `- The rendered vinyl MUST EXACTLY match hex code ${hex}
   - DO NOT use "internal knowledge" to override the hex code
   - Match the EXACT brightness, saturation, and hue from the hex code ONLY`}`;

  // ============= BRANDING OVERLAY SECTION (VIEW-SPECIFIC) =============
  const brandingBlock = viewType === 'hood_detail' 
    ? `
🎨 BRANDING OVERLAY (HOOD DETAIL VIEW - MINIMAL) 🎨
TOP-LEFT CORNER:
- Text: "${toolBranding}"
- Font: Inter, 6px, regular weight, pure black #000000, 100% opacity
- Position: 12px from top edge, 12px from left edge
- NO shadows, NO effects - flat black text only

BOTTOM-RIGHT CORNER:
- Text: "${vehicle} | ${manufacturer || 'Custom'} ${colorName}"
- Font: Inter, 6px, regular weight, pure black #000000, 100% opacity
- Position: 12px from bottom edge, 12px from right edge
- NO shadows, NO effects - flat black text only`
    : `
🎨 BRANDING OVERLAY 🎨
TOP-LEFT CORNER (Tool Badge):
- Text: "${toolBranding}"
- Font: Inter, 10px, semi-bold, pure black #000000, 100% opacity
- Position: 15px from top edge, 15px from left edge
- NO shadows, NO effects - flat black text only

BOTTOM-RIGHT CORNER (Vehicle + Color):
- Text: "${vehicle} | ${manufacturer || 'Custom'} ${colorName}"
- Font: Inter, 10px, semi-bold, pure black #000000, 100% opacity
- Position: 15px from bottom edge, 15px from right edge
- NO shadows, NO effects - flat black text only`;

  // ============= ASSEMBLE FINAL PROMPT =============
  // RESTYLEPRO header goes FIRST to establish exclusive branding
  // Then expert designer knowledge, then aspect ratio, then zone instructions
  return `${RESTYLEPRO_HEADER}

${EXPERT_WRAP_DESIGNER_PROMPT}

${ASPECT_RATIO_REQUIREMENT}

${graphicsProZoneBlock ? `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎨 MULTI-ZONE STYLING (GRAPHICSPRO™) - HIGHEST PRIORITY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${graphicsProZoneBlock}
` : ''}

${PHOTOREALISM_REQUIREMENT}

${FORBIDDEN_TEXT_WATERMARK_INSTRUCTIONS}

${hardEnforcementBlock ? hardEnforcementBlock : `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎨 COLOR ACCURACY REQUIREMENTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COLOR: ${colorName}
MANUFACTURER: ${manufacturer || 'Custom'}
HEX: ${hex}
FINISH: ${finish}
${colorValidationBlock}

${materialProfileBlock}
`}

${colorFlipBlock}

${referenceImagesBlock}

${colorRenderingRules}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚗 VEHICLE & CAMERA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Vehicle: ${vehicle}
Camera Angle: ${cameraAngle}

${studioEnvironment}

${glossFinish}

${wrapCoverageBlock}

${brandingBlock}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📸 FINAL OUTPUT REQUIREMENTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT: Ultra-photorealistic professional automotive photography showing ${vehicle} in ${colorName} vinyl wrap with ${finish} finish${isColorFlipFilm ? ' showing visible color-shift effect across body panels' : ''}.

MANDATORY SPECIFICATIONS:
✓ EXACTLY 16:9 landscape format (1920×1080px or 1792×1008px)
✓ VERIFY: width ÷ height = 1.777
✓ Dark concrete floor with gray gradient wall - SAME studio environment for ALL renders
✓ Must be INDISTINGUISHABLE from a real photograph
✓ INCLUDES BRANDING OVERLAYS baked into image

QUALITY CHECK - ALL MUST BE YES:
- Does this look like a REAL photograph from professional studio?
- Is the image EXACTLY 16:9 LANDSCAPE?
- Is the ${finish} finish unmistakably correct?
- Is the color ${colorName} accurately represented?
- Are grilles, lights, wheels, tires in their ORIGINAL colors (NOT wrapped)?
- Does the vehicle look REAL, not CGI or AI-generated?

If ANY answer is NO, the render FAILS completely.`;
}
