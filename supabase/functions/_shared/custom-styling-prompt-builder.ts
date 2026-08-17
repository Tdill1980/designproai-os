// =========================================================
// CUSTOM STYLING PROMPT BUILDER — SENIOR DESIGNER EDITION
// Hybrid Studio System + Pinstripe Precision + Finish Enforcement
// =========================================================

import { PHOTOREALISM_REQUIREMENT } from "./photorealism-prompt.ts";
import { FORBIDDEN_TEXT_WATERMARK_INSTRUCTIONS } from "./forbidden-text-instructions.ts";
import { ASPECT_RATIO_REQUIREMENT } from "./aspect-ratio-requirement.ts";
import { getFinishSpecification } from "./finish-specifications.ts";
import { getStudioEnvironment, selectStudioForZones, StudioType } from "./studio-environments.ts";
import { interpretCustomStyling, ParsedZone } from "./graphic-and-zone-interpreter.ts";
import { calculateMaterialForZone } from "./material-calculator.ts";

export interface ColorZoneData {
  zone: string;
  colorName: string;
  manufacturer: string;
  hex: string;
  finish: string;
  finish_profile?: string; // DATABASE AUTHORITATIVE - chrome, satin, matte, brushed, carbon, metallic
  lab?: { L: number; a: number; b: number };
  reflectivity?: number;
  metallic_flake?: number;
  materialValidated?: boolean;
}

export interface CustomStylingParams {
  vehicle: string;
  customStylingPrompt: string;
  referenceImageUrl?: string | null;
  referenceDescription?: string;
  viewType?: string;
  cameraPositioning?: string;
  parsedColorZones?: ColorZoneData[];
}

// ===========================================================
// SENIOR AUTOMOTIVE WRAP DESIGNER ROLE (MANDATORY)
// ===========================================================
const SENIOR_DESIGNER_ROLE = `
═══════════════════════════════════════════════════════
👔 SENIOR AUTOMOTIVE WRAP DESIGNER ROLE
═══════════════════════════════════════════════════════

YOU ARE A SENIOR AUTOMOTIVE WRAP DESIGNER with 15+ years of experience.

You specialize in:
- High-end color-change films (3M, Avery Dennison, KPMF, Inozetek)
- Chrome, metallic, satin, matte, carbon fiber, brushed metal finishes
- Ultra-precise cut-vinyl graphics and pinstripes
- Contour-following striping aligned to OEM body lines
- Multi-layer vinyl (outline + fill, drop shadow layering)
- Accurate wrap installer practices

YOU MUST OBEY THESE RULES:
1. finish_profile is ALWAYS authoritative — never override database values
2. All graphics (stripes, pinstripes, shapes) must be CUT VINYL, NOT painted
3. Chrome MUST behave as mirror metal (strong reflections, high contrast)
4. Satin MUST show soft highlight roll-off, absolutely no gloss
5. Matte MUST show zero reflections — completely flat
6. Brushed MUST show anisotropic directional streak texture
7. Carbon fiber MUST show woven 2x2 twill pattern with subtle clearcoat
8. NEVER wrap lights, glass, rubber, plastic trim, wheels
9. Vinyl graphics ALWAYS sit on top of base wrap layer
10. Maintain true automotive proportions across ALL views
`;

// ===========================================================
// EXPERT WRAP DESIGNER VEHICLE ZONE GLOSSARY
// ===========================================================
const EXPERT_ZONE_GLOSSARY = `
═══════════════════════════════════════════════════════
🚗 EXPERT WRAP DESIGNER - VEHICLE ZONE GLOSSARY
═══════════════════════════════════════════════════════

As a SENIOR WRAP DESIGNER, you MUST understand ALL vehicle zones:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BODY HALVES (for two-tone wraps):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• TOP HALF = Hood + Roof + Upper doors (ABOVE character line) + A/B/C pillars
• BOTTOM HALF = Rockers + Lower doors (BELOW character line) + Lower fenders + Lower bumpers
• LEFT HALF = Entire driver side (left hood, left doors, left quarter panel, left fender)
• RIGHT HALF = Entire passenger side (right hood, right doors, right quarter, right fender)
• UPPER BODY = Same as TOP HALF
• LOWER BODY = Same as BOTTOM HALF

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MAJOR BODY PANELS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• HOOD (bonnet) = Front panel covering engine
• ROOF = Top panel over cabin
• TRUNK (boot, decklid, tailgate, liftgate) = Rear storage panel
• FENDERS (front wings) = Panels over front wheels
• QUARTER PANELS (rear fenders) = Panels over rear wheels
• DOORS = Front and rear side access panels
• ROCKER PANELS (side skirts) = Lower body panels below doors, between wheel wells

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PILLARS (window frame supports):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• A-PILLAR = Windshield frame pillars (left & right of windshield)
• B-PILLAR = Center pillar between front & rear doors
• C-PILLAR = Rear pillar (sedans: behind rear door, coupes: behind rear window)
• D-PILLAR = Furthest rear pillar (SUVs, wagons only)
• SAIL PANEL = Triangle area at base of C-pillar

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TRIM & CHROME AREAS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• WINDOW TRIM/SURROUNDS = Chrome or painted trim around all windows
• GRILLE = Front air intake (often chrome)
• BADGES/EMBLEMS = Manufacturer logos and model names
• DOOR HANDLES = Entry handles on each door
• MIRROR CAPS = Outer housings of side mirrors
• ROOF RAILS = Cargo rails on top of SUVs/wagons
• BELT LINE = Horizontal trim line where windows meet body
• CHARACTER LINE = Horizontal body crease running along sides (KEY DIVIDER FOR TWO-TONE)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AERODYNAMIC COMPONENTS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• FRONT SPLITTER (chin spoiler, lip) = Low front aero piece
• REAR SPOILER (wing, duckbill) = Rear aero piece on trunk/roof
• SIDE SKIRTS (ground effects) = Lower side aero pieces
• REAR DIFFUSER = Under-rear aero panel
• CANARDS (dive planes) = Small aero fins on bumpers
• FENDER FLARES = Extended wheel arch covers (widebody)
• HOOD VENTS/SCOOPS = Functional or decorative hood openings

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WHEELS & BRAKES:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• BRAKE CALIPERS = Visible through wheel spokes (all 4 wheels)
• WHEEL WELLS (wheel arches) = Inner fender area around wheels
• FENDER LIPS = Outer edge of wheel arches

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BUMPERS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• FRONT BUMPER (front fascia) = Entire front bumper assembly
• REAR BUMPER (rear fascia) = Entire rear bumper assembly

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TRUCK-SPECIFIC:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• BED (truck bed, cargo bed) = Open rear cargo area
• TAILGATE = Rear bed access panel
• BED RAILS/CAPS = Rails along top of bed sides
• TONNEAU = Bed cover
• CAB = Passenger cabin area (crew cab, extended cab)
• BULL BAR (grille guard) = Front protective bar

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
VEHICLE ZONE DIAGRAM (Side View):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

        A-PILLAR    B-PILLAR    C-PILLAR
            |           |           |
    ┌───────────────────────────────────────┐
    │          R O O F                      │ ← TOP HALF
    ├───────────────────────────────────────┤
    │    │  FRONT  │    REAR    │           │
    │    │  DOOR   │    DOOR    │ QUARTER   │ ← ABOVE CHARACTER LINE
    │    │         │            │  PANEL    │
═════════════════════════════════════════════ ← CHARACTER LINE (SPLIT)
    │    │         │            │           │
    │    │  DOOR   │    DOOR    │ QUARTER   │ ← BELOW CHARACTER LINE  
    │    │ LOWER   │   LOWER    │  LOWER    │
    ├────┴─────────┴────────────┴───────────┤
    │         R O C K E R   P A N E L       │ ← BOTTOM HALF
    └───────────────────────────────────────┘
         🔴            🔴            🔴
       CALIPER      CALIPER       CALIPER


You MUST apply wraps to the CORRECT zones based on this knowledge.
`;


// ===========================================================
// CUT VINYL & PINSTRIPE PRECISION RULES
// ===========================================================
const CUT_VINYL_RULES = `
═══════════════════════════════════════════════════════
✂️ CUT VINYL REQUIREMENTS (MANDATORY)
═══════════════════════════════════════════════════════

🚨 ALL GRAPHICS MUST BE CUT VINYL — NO PRINTING ALLOWED 🚨

- All graphics are contour-cut vinyl placed ON TOP of wrap
- NO gradients, NO airbrush, NO paint-like effects
- NO camouflage, NO marble, NO galaxy, NO photo textures
- NO printing of ANY kind

PINSTRIPE PRECISION (CRITICAL):
- Pinstripes MUST be extremely thin:
  * 1/8" (3mm) - standard pinstripe
  * 1/4" (6mm) - maximum width
- Stripe thickness MUST NOT increase beyond 6mm
- Pinstripes MUST follow the natural curvature and body lines
- Lines must be PARALLEL and CONSISTENT width throughout
- Sharp edges ONLY — absolutely no soft blur or feathering

MULTI-LAYER VINYL ALLOWED:
- Outline + fill combinations
- Drop shadow effects (separate cut layer)
- Each layer is a single solid color
- Hard contour edges on all layers
`;

// ===========================================================
// ZONE INTERPRETER + CUT VINYL GRAPHICS + MATERIAL CALCULATOR
// ===========================================================

export interface EnhancedZone extends ParsedZone {
  materialSqft: number;
  materialYards: number;
  materialNotes: string;
}

/**
 * Parse manufacturer colors from a styling prompt
 */
export function parseColorsFromPrompt(prompt: string): Array<{
  rawText: string;
  manufacturer: string;
  colorName: string;
  finish: string;
  zone: string;
}> {
  const colors: Array<{
    rawText: string;
    manufacturer: string;
    colorName: string;
    finish: string;
    zone: string;
  }> = [];
  
  const promptLower = prompt.toLowerCase();
  
  const manufacturers = [
    { name: '3M', patterns: ['3m', '3m®', '3m™'] },
    { name: 'Avery Dennison', patterns: ['avery', 'avery dennison'] },
    { name: 'Hexis', patterns: ['hexis'] },
    { name: 'KPMF', patterns: ['kpmf'] },
    { name: 'Inozetek', patterns: ['inozetek'] },
    { name: 'Oracal', patterns: ['oracal'] },
    { name: 'Arlon', patterns: ['arlon'] },
    { name: 'TeckWrap', patterns: ['teckwrap', 'teck wrap'] },
    { name: 'VViViD', patterns: ['vvivid'] },
  ];
  
  const finishes = [
    { name: 'Chrome', patterns: ['chrome', 'mirror'] },
    { name: 'Satin', patterns: ['satin'] },
    { name: 'Matte', patterns: ['matte', 'flat'] },
    { name: 'Gloss', patterns: ['gloss', 'glossy'] },
    { name: 'Brushed', patterns: ['brushed'] },
    { name: 'Carbon Fiber', patterns: ['carbon fiber', 'carbon'] },
    { name: 'Metallic', patterns: ['metallic'] },
  ];
  
  const zones = [
    { name: 'top', patterns: ['top', 'roof', 'hood', 'upper', 'above'] },
    { name: 'bottom', patterns: ['bottom', 'lower', 'rocker', 'below', 'sides'] },
    { name: 'accent', patterns: ['accent', 'stripe', 'trim', 'pinstripe'] },
    { name: 'full', patterns: ['full', 'entire', 'whole', 'body'] },
  ];
  
  const segments = prompt.split(/(?:and|,|;|\.|with)/i).map(s => s.trim()).filter(Boolean);
  
  for (const segment of segments) {
    const segmentLower = segment.toLowerCase();
    
    let foundManufacturer = '';
    for (const mfr of manufacturers) {
      if (mfr.patterns.some(p => segmentLower.includes(p))) {
        foundManufacturer = mfr.name;
        break;
      }
    }
    
    let foundFinish = 'Gloss';
    for (const fin of finishes) {
      if (fin.patterns.some(p => segmentLower.includes(p))) {
        foundFinish = fin.name;
        break;
      }
    }
    
    let foundZone = 'full';
    for (const zone of zones) {
      if (zone.patterns.some(p => segmentLower.includes(p))) {
        foundZone = zone.name;
        break;
      }
    }
    
    let colorName = segment;
    for (const mfr of manufacturers) {
      for (const pattern of mfr.patterns) {
        const regex = new RegExp(pattern, 'gi');
        colorName = colorName.replace(regex, '');
      }
    }
    for (const zone of zones) {
      for (const pattern of zone.patterns) {
        const regex = new RegExp(`\\b(on\\s+)?(the\\s+)?${pattern}\\b`, 'gi');
        colorName = colorName.replace(regex, '');
      }
    }
    colorName = colorName.replace(/^\s*[-–—]\s*/, '').trim();
    colorName = colorName.replace(/\s+/g, ' ').trim();
    
    if (colorName && (foundManufacturer || foundFinish !== 'Gloss')) {
      colors.push({
        rawText: segment,
        manufacturer: foundManufacturer,
        colorName: colorName,
        finish: foundFinish,
        zone: foundZone,
      });
    }
  }
  
  if (colors.length === 0) {
    const basicColors = ['black', 'white', 'gold', 'silver', 'red', 'blue', 'green', 'purple', 'orange', 'yellow', 'pink', 'bronze', 'copper'];
    for (const color of basicColors) {
      if (promptLower.includes(color)) {
        let zone = 'full';
        if (promptLower.includes(`${color}`) && promptLower.includes('top')) zone = 'top';
        if (promptLower.includes(`${color}`) && promptLower.includes('bottom')) zone = 'bottom';
        
        colors.push({
          rawText: color,
          manufacturer: '',
          colorName: color.charAt(0).toUpperCase() + color.slice(1),
          finish: promptLower.includes('chrome') ? 'Chrome' : 
                  promptLower.includes('satin') ? 'Satin' : 
                  promptLower.includes('matte') ? 'Matte' : 'Gloss',
          zone,
        });
      }
    }
  }
  
  return colors;
}

/**
 * Enhances parsed color zones with material calculations
 */
export function enhanceCustomStylingZones(
  stylingPrompt: string,
  vehicleName: string
): EnhancedZone[] {
  const zones = interpretCustomStyling(stylingPrompt);

  const enhanced = zones.map((z) => {
    const material = calculateMaterialForZone(
      z.zone,
      vehicleName,
      z.finish,
      z.manufacturer
    );

    return {
      ...z,
      materialSqft: material.sqft,
      materialYards: material.yards,
      materialNotes: material.notes || "",
    };
  });

  return enhanced;
}

/**
 * Get finish-specific rendering enforcement rules
 */
function getFinishEnforcement(finish: string | object | null | undefined): string {
  // Handle null/undefined
  if (!finish) return '';
  
  // Handle object (finish_profile from DB is JSONB)
  let finishString: string;
  if (typeof finish === 'object') {
    finishString = (finish as any).type || '';
  } else {
    finishString = String(finish);
  }
  
  if (!finishString) return '';
  const f = finishString.toLowerCase().trim();
  
  if (f === 'chrome' || f === 'mirror') {
    return `
🔥 CHROME RENDERING RULES (CRITICAL):
- MUST be MIRROR-LIKE — this is CHROME, not glossy paint!
- MUST show strong reflections of studio light panels
- High-contrast metallic specular highlights with sharp edges
- 0% diffusion — crisp, clear reflections
- Polished metal behavior required
- Light panels MUST BE VISIBLE in reflections
- If not mirror-like with visible panel reflections, render FAILS`;
  }
  
  if (f === 'satin') {
    return `
🔥 SATIN RENDERING RULES:
- Soft, diffused highlight roll-off
- Absolutely NO gloss-level reflections
- Smooth sheen with controlled specularity
- Eggshell appearance — never shiny
- Gentle light wrap around body curves`;
  }
  
  if (f === 'matte' || f === 'flat') {
    return `
🔥 MATTE RENDERING RULES:
- ZERO reflections — completely flat
- Fully diffused surface with no shine
- No gloss, no sheen, no specular highlights
- Powder-coat appearance
- If ANY shine visible, render FAILS`;
  }
  
  if (f === 'brushed' || f === 'brushed metal') {
    return `
🔥 BRUSHED METAL RULES:
- Linear anisotropic streak reflections REQUIRED
- Metallic directional texture visible
- Do NOT render as gloss or chrome-like mirror
- Visible grain direction following body lines
- Highlights stretch along brush direction`;
  }
  
  if (f === 'carbon' || f === 'carbon fiber') {
    return `
🔥 CARBON FIBER RULES:
- 2x2 twill weave pattern MUST be clearly visible
- Subtle clearcoat reflection only
- High-frequency weave detail required
- Fiber direction follows body contours
- If weave pattern not visible, render FAILS`;
  }
  
  if (f === 'metallic') {
    return `
🔥 METALLIC RULES:
- Sparkle/flake reflections MUST be visible
- Metallic depth with dynamic highlight behavior
- Embedded particles catch light at angles
- Deep reflective color with particle depth
- If looks flat without visible particles, render FAILS`;
  }
  
  if (f === 'gloss') {
    return `
🔥 GLOSS RENDERING RULES:
- High-shine reflective surface
- Clear, defined reflections
- Deep wet-look appearance
- Strong specular highlights`;
  }
  
  return '';
}

/**
 * Builds an AI prompt for Custom Styling Mode - multi-zone, multi-color vehicle wraps
 * Uses hybrid studio system with automatic hard/soft light selection
 */
export function buildCustomStylingPrompt(params: CustomStylingParams): string {
  const {
    vehicle,
    customStylingPrompt,
    referenceImageUrl,
    referenceDescription,
    viewType = 'side',
    cameraPositioning = 'DRIVER SIDE FULL VEHICLE',
    parsedColorZones = [],
  } = params;

  // ============= ENHANCED ZONE INTERPRETATION =============
  const enhancedZones = enhanceCustomStylingZones(customStylingPrompt, vehicle);

  // ============= STUDIO AUTO-SELECTION =============
  // Chrome/brushed/metallic/carbon → HARD LIGHT STUDIO
  // Gloss/satin/matte → SOFT DIFFUSION STUDIO
  const allZonesForStudio = [
    ...enhancedZones,
    ...parsedColorZones.map(z => ({ finish_profile: z.finish_profile, finish: z.finish }))
  ];
  const studioType = selectStudioForZones(allZonesForStudio);
  const studioEnvironment = getStudioEnvironment(studioType, undefined, allZonesForStudio);

  // ============= BUILD ZONE SPECIFICATIONS =============
  let zoneSpecsBlock = '';
  
  if (enhancedZones.length > 0) {
    // Create a summary line for multi-zone renders
    const zoneSummary = enhancedZones.length > 1 
      ? `\n🎯 THIS VEHICLE HAS ${enhancedZones.length} DISTINCT COLOR ZONES - EACH ZONE MUST BE A DIFFERENT COLOR:\n` +
        enhancedZones.map((z, idx) => `   → Zone ${idx + 1} (${z.zone.toUpperCase()}): ${z.color} ${z.finish}`).join('\n') + '\n'
      : '';
    
    zoneSpecsBlock = `
═══════════════════════════════════════════════════════
🎨 MULTI-ZONE VEHICLE WRAP SPECIFICATIONS
═══════════════════════════════════════════════════════
${zoneSummary}
${enhancedZones.map((z, idx) => {
  const realFinish = (z as any).finish_profile || z.finish;
  const finishSpec = getFinishSpecification(realFinish);
  const finishEnforcement = getFinishEnforcement(realFinish);
  
  return `
🔹 ZONE ${idx + 1}: ${z.zone.toUpperCase()} ← WRAP THIS AREA IN ${z.color.toUpperCase()} ${realFinish.toUpperCase()}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Film: ${z.manufacturer}
Color: ${z.color} (EXACT COLOR REQUIRED)
Finish: ${realFinish} (AUTHORITATIVE - CANNOT BE CHANGED)

${finishSpec}
${finishEnforcement}

Material Estimate:
- ${z.materialSqft.toFixed(1)} sq ft → ${z.materialYards} yard(s)
${z.materialNotes ? `- Note: ${z.materialNotes}` : ''}

${z.graphic ? `
CUT VINYL GRAPHIC:
- Keyword: ${z.graphic.keyword}
- Layers: ${z.graphic.layers}
- MUST follow OEM body lines precisely
- Pinstripes (if present) MUST be 1/8"–1/4" (3–6mm) MAXIMUM
- Crisp, contour-cut vinyl ONLY
- ABSOLUTELY NO painted or printed effects
` : ''}`;
}).join('\n')}

${enhancedZones.length > 1 ? `
🚨 ZONE SEPARATION MANDATORY 🚨
Each zone listed above MUST be wrapped in its specified color.
If all zones appear as the same color, the render FAILS.
` : ''}
`;
  }

  // ============= DATABASE-VALIDATED COLOR ZONES =============
  let validatedColorSpecs = '';
  if (parsedColorZones.length > 0) {
    validatedColorSpecs = `
═══════════════════════════════════════════════════════
🎨 VERIFIED COLOR SPECIFICATIONS (DATABASE-VALIDATED)
═══════════════════════════════════════════════════════
${parsedColorZones.map((zone, idx) => {
  // Extract finish string - finish_profile may be object or string, finish is always string
  const rawFinish = zone.finish_profile || zone.finish;
  const realFinish = typeof rawFinish === 'object' ? ((rawFinish as any).type || zone.finish || '') : (rawFinish || '');
  const finishSpec = getFinishSpecification(realFinish);
  const finishEnforcement = getFinishEnforcement(realFinish);
  
  let materialBlock = '';
  if (zone.materialValidated && zone.lab) {
    materialBlock = `
  ✅ VERIFIED MATERIAL PROFILE:
  - LAB: L*=${zone.lab.L.toFixed(1)}, a*=${zone.lab.a.toFixed(1)}, b*=${zone.lab.b.toFixed(1)}
  ${zone.reflectivity !== undefined ? `- Reflectivity: ${zone.reflectivity.toFixed(2)}` : ''}
  ${zone.metallic_flake !== undefined ? `- Metallic Flake: ${zone.metallic_flake.toFixed(2)}` : ''}
  🚨 Match these LAB values EXACTLY. Do NOT reinterpret.`;
  }
  
  return `
ZONE ${idx + 1}: ${zone.zone.toUpperCase()}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Manufacturer: ${zone.manufacturer || 'Custom'}
- Color: ${zone.colorName}
- HEX: ${zone.hex}
- Finish: ${realFinish} (DATABASE AUTHORITATIVE)
${materialBlock}

${finishEnforcement}

${finishSpec}
`;
}).join('\n')}

🚨 CRITICAL ZONE SEPARATION RULES 🚨
- Each zone MUST be a DISTINCT, SEPARATE color
- Boundaries between zones follow natural body lines/creases
- HARD LINE transition - NO gradient, NO fade, NO blending
- Professional tape-line appearance at zone boundaries
`;
  }

  // ============= TWO-TONE DETECTION =============
  const lowerPrompt = customStylingPrompt.toLowerCase();
  const isTwoTone = lowerPrompt.includes('two-tone') || lowerPrompt.includes('two tone') || 
    (lowerPrompt.includes('top') && lowerPrompt.includes('bottom')) ||
    (lowerPrompt.includes('upper') && lowerPrompt.includes('lower')) ||
    (lowerPrompt.includes('top half') || lowerPrompt.includes('bottom half'));

  // Log for debugging
  console.log('🎯 Two-tone detected:', isTwoTone);
  console.log('🎯 Enhanced zones:', JSON.stringify(enhancedZones, null, 2));

  const twoToneInstructions = isTwoTone ? `
🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨
═══════════════════════════════════════════════════════
🎯 CRITICAL: TWO-TONE WRAP - THIS IS NOT A SINGLE COLOR VEHICLE
═══════════════════════════════════════════════════════

🚨 THE VEHICLE MUST HAVE TWO DIFFERENT COLORS - NOT ONE COLOR 🚨

This is a TWO-TONE design meaning the vehicle is wrapped in TWO DISTINCT, SEPARATE COLORS.
If you render a single color on the entire vehicle, the render COMPLETELY FAILS.

ZONE DEFINITION FOR TWO-TONE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TOP ZONE (Color 1 - typically hood, roof, upper body):
✓ Hood - ENTIRE hood surface
✓ Roof - ENTIRE roof surface
✓ A-pillars, B-pillars, C-pillars (window frames)
✓ Upper portion of doors ABOVE the horizontal body crease line

BOTTOM ZONE (Color 2 - typically rockers, lower doors, bumpers):
✓ Lower portion of doors BELOW the horizontal body crease line
✓ Rocker panels (side skirts below doors)
✓ Lower front bumper area
✓ Lower rear bumper area
✓ Lower fender sections

BOUNDARY LINE (CRITICAL):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- The boundary follows the natural HORIZONTAL BODY LINE CREASE on the vehicle
- This is the factory character line that runs along the sides of most vehicles
- It is a HARD, CLEAN, TAPE-LINE separation - NOT a gradient, NOT a fade, NOT a blend
- Think professional vinyl installer tape line - sharp and precise

VERIFICATION CHECKLIST:
□ Are there TWO DISTINCT COLORS visible on the vehicle? (REQUIRED)
□ Is the top portion (hood, roof) one color?
□ Is the bottom portion (rockers, lower doors) a DIFFERENT color?
□ Is the boundary a clean horizontal line, not a gradient?

🚨 IF THE ENTIRE VEHICLE IS ONE SINGLE COLOR, THE RENDER FAILS COMPLETELY 🚨
🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨
` : '';

  // ============= REFERENCE IMAGE SECTION =============
  const referenceSection = referenceImageUrl ? `
═══════════════════════════════════════════════════════
📸 REFERENCE IMAGE PROVIDED
═══════════════════════════════════════════════════════
${referenceDescription ? `User notes: "${referenceDescription}"` : ''}

Use reference for PLACEMENT IDEA only.
DO NOT sample colors from reference — use DATABASE VALUES.
` : '';

  // ============= WRAP COVERAGE RULES =============
  const wrapCoverageBlock = `
═══════════════════════════════════════════════════════
🚨 WRAP COVERAGE RULES (MANDATORY)
═══════════════════════════════════════════════════════
WRAP THESE BODY PANELS ONLY:
✓ Hood, Roof, Trunk/Deck lid
✓ Front fenders, Doors, Rear quarter panels
✓ Front/Rear bumper covers (painted parts)
✓ Side mirrors (if body-colored)
✓ A/B/C pillars

NEVER WRAP (must stay factory):
❌ Grilles - BLACK/CHROME/SILVER
❌ Headlights/Taillights - CLEAR/BLACK/RED
❌ Windows/Glass - CLEAR/TINTED
❌ Wheels/Tires - factory colors
❌ Chrome trim, badges, door handles
❌ Exhaust tips, license plate area
❌ Rubber seals, plastic trim

If vinyl appears on ANY grille, headlight, taillight, wheel, or tire = RENDER FAILS`;

  // ============= NO TEXT/BRANDING =============
  const brandingBlock = `
═══════════════════════════════════════════════════════
🚫 NO TEXT RULE
═══════════════════════════════════════════════════════
DO NOT add ANY text, watermarks, logos, or branding to this image.
The render must be completely text-free.`;

  // ============= FINAL OUTPUT REQUIREMENTS =============
  const outputRequirements = `
═══════════════════════════════════════════════════════
📸 FINAL OUTPUT REQUIREMENTS
═══════════════════════════════════════════════════════
OUTPUT: Ultra-photorealistic professional automotive photography

STUDIO: ${studioType === 'hard_light' ? 'HARD LIGHT AUTOMOTIVE STUDIO (chrome-compatible)' : 'SOFT DIFFUSION STUDIO'}

MANDATORY CHECKS:
✓ EXACTLY 16:9 landscape format (1920×1080px or 1792×1008px)
✓ Correct studio environment with proper floor reflections
✓ Each color zone DISTINCT with HARD boundaries
✓ Finishes match specification EXACTLY (chrome=mirror, satin=soft, matte=flat)
✓ Pinstripes are THIN (3-6mm maximum width)
✓ Graphics are CUT VINYL only — NO PRINTING
✓ Factory parts NOT wrapped (grilles, lights, wheels)
✓ Must be INDISTINGUISHABLE from real photograph

QUALITY VERIFICATION:
- Does chrome show mirror-like panel reflections?
- Are pinstripes following body lines at correct width?
- Are zone boundaries hard tape-lines?
- Is the studio lighting appropriate for the finishes?

If ANY answer is NO, render FAILS completely.`;

  // ============= CRITICAL TWO-TONE HEADLINE =============
  // This MUST be at the very top of the prompt for AI to prioritize it
  const twoToneHeadline = isTwoTone && enhancedZones.length >= 2 ? `
🚨🚨🚨 MANDATORY TWO-TONE: ${enhancedZones[0]?.color?.toUpperCase() || 'COLOR 1'} ${enhancedZones[0]?.finish?.toUpperCase() || ''} ON TOP HALF + ${enhancedZones[1]?.color?.toUpperCase() || 'COLOR 2'} ${enhancedZones[1]?.finish?.toUpperCase() || ''} ON BOTTOM HALF 🚨🚨🚨

DO NOT RENDER A SINGLE COLOR VEHICLE. THIS IS A TWO-TONE WRAP:
- TOP HALF (hood, roof, upper doors): ${enhancedZones[0]?.color || 'Color 1'} ${enhancedZones[0]?.finish || ''}
- BOTTOM HALF (rockers, lower doors, lower bumpers): ${enhancedZones[1]?.color || 'Color 2'} ${enhancedZones[1]?.finish || ''}

THE VEHICLE MUST SHOW TWO DISTINCTLY DIFFERENT COLORS - NOT ONE COLOR!
` : '';

  // ============= ASSEMBLE FINAL PROMPT =============
  return `${twoToneHeadline}

${ASPECT_RATIO_REQUIREMENT}

${PHOTOREALISM_REQUIREMENT}

${FORBIDDEN_TEXT_WATERMARK_INSTRUCTIONS}

${SENIOR_DESIGNER_ROLE}

${EXPERT_ZONE_GLOSSARY}

═══════════════════════════════════════════════════════
🎨 CUSTOM STYLING MODE - MULTI-ZONE VEHICLE WRAP
═══════════════════════════════════════════════════════

VEHICLE: ${vehicle}
VIEW TYPE: ${viewType}

📝 USER'S STYLING REQUEST:
"${customStylingPrompt}"

${twoToneInstructions}

${zoneSpecsBlock}

${CUT_VINYL_RULES}

${validatedColorSpecs}

${referenceSection}

${studioEnvironment}

📸 CAMERA POSITIONING:
${cameraPositioning}

${wrapCoverageBlock}

${brandingBlock}

${outputRequirements}
`.trim();
}

/**
 * Legacy export for parsing color zones from response
 */
export function parseColorZonesFromPrompt(stylingPrompt: string): Array<{
  zone: string;
  color: string;
  finish: string;
}> {
  const parsed = parseColorsFromPrompt(stylingPrompt);
  return parsed.map(p => ({
    zone: p.zone,
    color: p.colorName,
    finish: p.finish,
  }));
}
