/**
 * GRAPHICSPRO — Dedicated Prompt Builder for Edge Function
 * Handles multi-zone wrap designs, two-tone, stripes, chrome delete, accents
 */

import { HARD_LIGHT_STUDIO, SOFT_DIFFUSION_STUDIO } from './studio-environments.ts';

// === FAMOUS RACING LIVERY ENGINE v1 ===
export interface FamousLivery {
  key: string;
  name: string;
  searchQueries: string[];  // For DataForSEO
  rules: string;            // Detailed AI instructions
  colors: string[];
  stripeConfig: string;
  baseColor: string;        // Required base vehicle color
}

/**
 * Detect canonical racing livery requests that require visual grounding
 * These are famous, well-documented liveries that AI often gets wrong without references
 */
export function detectFamousLivery(prompt: string): FamousLivery | null {
  const p = prompt.toLowerCase();
  
  if (p.includes("martini")) {
    return {
      key: "martini",
      name: "Martini Racing Livery",
      searchQueries: [
        "Porsche Martini Racing livery side view",
        "Porsche 911 Martini stripes profile",
        "Martini Racing livery classic stripes"
      ],
      rules: `=== MARTINI RACING LIVERY (MANDATORY RULES) ===

THIS IS THE FAMOUS MARTINI RACING LIVERY - A WELL-DOCUMENTED MOTORSPORT DESIGN.

STRIPE CONFIGURATION - YOU MUST RENDER ALL OF THESE:
• MULTIPLE HORIZONTAL STRIPES running LENGTHWISE from front to rear
• Stripe colors (from top to bottom):
  1. LIGHT BLUE / CYAN outer stripes (thin)
  2. DARK BLUE / NAVY inner stripes (medium width)
  3. RED center stripe (widest stripe in the middle)
• Stripes flow HORIZONTALLY across the entire vehicle body
• Stripes run continuously across: hood → doors → quarters → rear

STRIPE WIDTH RATIOS:
• Light blue outer lines: ~15% of total stripe band width
• Dark blue inner lines: ~25% of total stripe band width  
• Red center stripe: ~35% of total stripe band width
• Thin dark blue pinstripes separate colors: ~5% each

ABSOLUTE REQUIREMENTS:
🚨 THREE OR MORE DISTINCT COLORED STRIPES - NEVER A SINGLE STRIPE
🚨 Colors must be: Light Blue (Cyan), Dark Blue (Navy), Red
🚨 Stripes run HORIZONTALLY along vehicle body
🚨 Base vehicle MUST be WHITE or SILVER

=== END MARTINI LIVERY RULES ===`,
      colors: ["Light Blue (Cyan)", "Dark Blue (Navy)", "Red"],
      stripeConfig: "MULTIPLE HORIZONTAL STRIPES - cyan, navy, red bands running lengthwise",
      baseColor: "WHITE or SILVER"
    };
  }
  
  if (p.includes("gulf")) {
    return {
      key: "gulf",
      name: "Gulf Racing Livery",
      searchQueries: [
        "Gulf Racing livery Ford GT40 side view",
        "Gulf livery Porsche 917 profile",
        "Gulf Racing orange blue classic"
      ],
      rules: `=== GULF RACING LIVERY (MANDATORY RULES) ===

BODY COLOR:
• Base: GULF BLUE (#7ABADD light powder blue) - ENTIRE body

STRIPE CONFIGURATION:
• ORANGE STRIPE (#F26722 Gulf Orange) running horizontally mid-body
• Stripe height: at belt-line / door handle level
• Stripe runs from front fender through doors to rear quarter

ORANGE STRIPE MUST BE VISIBLE AND PROMINENT
Base blue covers entire body except for the orange accent stripe

=== END GULF LIVERY RULES ===`,
      colors: ["Gulf Blue (#7ABADD)", "Gulf Orange (#F26722)"],
      stripeConfig: "POWDER BLUE BODY with ORANGE HORIZONTAL STRIPE at mid-body",
      baseColor: "GULF BLUE (#7ABADD)"
    };
  }
  
  if (p.includes("rothmans")) {
    return {
      key: "rothmans",
      name: "Rothmans Racing Livery",
      searchQueries: [
        "Rothmans Porsche 956 livery side",
        "Rothmans racing livery profile",
        "Rothmans blue gold white stripes"
      ],
      rules: `=== ROTHMANS RACING LIVERY ===

BASE: WHITE body
PRIMARY STRIPE: DARK BLUE (#003087) - bold band across body
ACCENT: GOLD/YELLOW (#FFCC00) - thin pinstripe accents

Configuration: White base with bold blue band wrapping around mid-body, gold accent lines

=== END ROTHMANS LIVERY RULES ===`,
      colors: ["White", "Dark Blue (#003087)", "Gold (#FFCC00)"],
      stripeConfig: "WHITE BASE with BOLD BLUE BAND and GOLD PINSTRIPE accents",
      baseColor: "WHITE"
    };
  }
  
  if (p.includes("bmw m") || (p.includes("bmw") && p.includes("motorsport"))) {
    return {
      key: "bmw_m",
      name: "BMW M Motorsport Stripes",
      searchQueries: [
        "BMW M stripes livery side view",
        "BMW Motorsport triple stripe"
      ],
      rules: `=== BMW M MOTORSPORT STRIPES ===

THREE DIAGONAL STRIPES (from top to bottom):
1. Light Blue
2. Dark Blue  
3. Red

Placement: typically on lower bumper or rocker area
Angle: 45 degrees diagonal
Each stripe same width, evenly spaced

=== END BMW M LIVERY RULES ===`,
      colors: ["Light Blue", "Dark Blue", "Red"],
      stripeConfig: "THREE DIAGONAL STRIPES - light blue, dark blue, red",
      baseColor: "ANY (typically white)"
    };
  }
  
  if (p.includes("jagermeister") || p.includes("jägermeister") || p.includes("jaeger")) {
    return {
      key: "jagermeister",
      name: "Jägermeister Racing Livery",
      searchQueries: [
        "Jagermeister racing livery side view",
        "Jagermeister orange race car"
      ],
      rules: `=== JÄGERMEISTER RACING LIVERY ===

FULL BODY: Jägermeister Orange (#FF6600 deep orange)
This is a FULL-BODY single color wrap in deep orange.
Minimal to no accent stripes.

=== END JÄGERMEISTER LIVERY RULES ===`,
      colors: ["Jägermeister Orange (#FF6600)"],
      stripeConfig: "FULL BODY ORANGE wrap",
      baseColor: "JÄGERMEISTER ORANGE (#FF6600)"
    };
  }
  
  if (p.includes("castrol")) {
    return {
      key: "castrol",
      name: "Castrol Racing Livery",
      searchQueries: [
        "Castrol racing livery side view",
        "Castrol Toyota Supra livery"
      ],
      rules: `=== CASTROL RACING LIVERY ===

THREE-COLOR STRIPE BAND:
1. RED (#CC0000) - top stripe
2. WHITE - middle stripe
3. GREEN (#008F00) - bottom stripe

Stripes run horizontally along body mid-section

=== END CASTROL LIVERY RULES ===`,
      colors: ["Red (#CC0000)", "White", "Green (#008F00)"],
      stripeConfig: "THREE-COLOR STRIPE BAND (red-white-green) horizontal",
      baseColor: "WHITE or vehicle color with stripe band overlay"
    };
  }
  
  return null;
}

export const VEHICLE_ZONES = [
  "hood", "roof", "trunk", "tailgate", "front bumper", "rear bumper",
  "fenders", "front fender", "rear fender", "quarter panel", "doors",
  "front door", "rear door", "rocker panel", "side skirt",
  "pillars", "A pillar", "B pillar", "C pillar",
  "mirrors", "spoiler", "wing", "diffuser",
  "lower fascia", "grille", "sunroof", "window trim",
  "door handles", "badges", "exhaust tips", "roof rails",
  "calipers", "brake calipers", "wheel wells"
];

/** Film type inference */
export function resolveFilm(colorText: string) {
  const txt = colorText.toLowerCase();

  if (txt.includes("chrome")) return { finish: "chrome", mfg: "Avery Chrome", desc: "mirror-reflective chrome" };
  if (txt.includes("satin")) return { finish: "satin", mfg: "3M Satin", desc: "soft satin sheen" };
  if (txt.includes("matte")) return { finish: "matte", mfg: "Avery Matte", desc: "flat matte non-reflective" };
  if (txt.includes("metallic")) return { finish: "metallic", mfg: "3M Metallic", desc: "subtle fine metallic sparkle" };
  if (txt.includes("pearl")) return { finish: "pearl", mfg: "3M Pearl", desc: "light-reactive pearlescent glow" };
  if (txt.includes("carbon")) return { finish: "carbon", mfg: "3M Carbon Fiber", desc: "woven carbon fiber pattern" };
  if (txt.includes("gloss")) return { finish: "gloss", mfg: "Avery Gloss", desc: "deep gloss clearcoat" };

  return { finish: "gloss", mfg: "Avery Gloss", desc: "standard gloss vinyl wrap" };
}

/** Identify what zones user referenced */
export function extractVehicleZones(prompt: string): string[] {
  const zonesFound: string[] = [];
  const promptLower = prompt.toLowerCase();
  
  VEHICLE_ZONES.forEach((zone) => {
    if (promptLower.includes(zone.toLowerCase())) zonesFound.push(zone);
  });
  
  // Multi-word phrase detection
  if (promptLower.includes("chrome delete")) zonesFound.push("chrome delete package");
  if (promptLower.includes("top half")) zonesFound.push("upper body");
  if (promptLower.includes("bottom half") || promptLower.includes("lower half")) zonesFound.push("lower body");
  if (promptLower.includes("racing stripe") || promptLower.includes("rally stripe")) zonesFound.push("center stripe");
  
  // Multi-layer graphic detection
  if (promptLower.includes("pinstripe")) zonesFound.push("accent pinstripe");
  if (promptLower.includes("rocker stripe")) zonesFound.push("rocker stripe");
  if (promptLower.includes("bedside")) zonesFound.push("bedside graphic");
  if (promptLower.includes("scallop")) zonesFound.push("scallop graphic");
  if (promptLower.includes("swoosh")) zonesFound.push("swoosh graphic");
  if (promptLower.includes("hood graphic")) zonesFound.push("hood graphic");
  // Lowrider detection - both spellings
  if (promptLower.includes("lowrider") || promptLower.includes("low rider")) {
    if (promptLower.includes("stripe")) {
      zonesFound.push("lowrider stripe");
    } else {
      zonesFound.push("lowrider graphic");
    }
  }
  if (promptLower.includes("dart")) zonesFound.push("dart graphic");
  if (promptLower.includes("number plate")) zonesFound.push("number plate");
  
  return [...new Set(zonesFound)];
}

/** Check if prompt requires hard light studio */
export function requiresHardLightStudio(prompt: string): boolean {
  const txt = prompt.toLowerCase();
  return txt.includes("chrome") || txt.includes("mirror") || 
         txt.includes("brushed") || txt.includes("metallic") || txt.includes("carbon");
}

/** Detect if prompt requests multi-layer vinyl design */
export function detectMultiLayerDesign(prompt: string): { layers: number; type: string } {
  const txt = prompt.toLowerCase();

  // 3-layer detection
  if (txt.match(/tri[- ]?tone|3[- ]?(layer|color)|three[- ]?(color|layer)|triple[- ]?stripe/)) {
    return { layers: 3, type: 'tri-tone' };
  }

  // 2-layer detection  
  if (txt.match(/two[- ]?(tone|color|layer)|dual[- ]?color|layered|outline|accent/)) {
    return { layers: 2, type: 'two-tone' };
  }

  // Color counting (more than 2 distinct colors = multi-layer)
  const colors = txt.match(/(black|white|red|blue|gold|silver|chrome|gray|green|yellow|purple|orange|teal|navy|pink)/gi);
  const uniqueColors = [...new Set(colors || [])];
  if (uniqueColors.length >= 3) return { layers: 3, type: 'multi-color' };
  if (uniqueColors.length === 2) return { layers: 2, type: 'two-color' };

  return { layers: 1, type: 'single' };
}

// --- MULTI-LAYER CUT VINYL ENGINE v1 (2-LAYER MODE) ---
const MULTI_LAYER_VINYL_ENGINE_V1 = `
=== MULTI-LAYER CUT VINYL ENGINE v1 (2-LAYER MODE) ===

When the user requests ANY vinyl design involving TWO colors or materials:

• ALWAYS treat each color as a separate vinyl layer
• NEVER blend layers unless user explicitly requests fade/gradient
• Bottom layer = base shape/silhouette defining main geometry
• Top layer = accent sitting cleanly on top with crisp cut lines
• Maintain perfectly sharp edges between colors (NO feathering)

LAYER ORDER RULES (2-Layer):
• Dark/neutral colors → BASE LAYER (black, gray, navy, satin)
• Bright/metallic colors → ACCENT LAYER (chrome, red, gold, white)
• Chrome ALWAYS becomes TOP/ACCENT layer unless specified otherwise
• Matte/satin finishes → BASE layer, never top outline

GEOMETRY RULES:
• Both layers MUST share identical base geometry
• Accent layer follows exact same silhouette with consistent inset
• Maintain proportional spacing between layers
• All body panels must show identical layering in ALL render angles

SHAPE CONSISTENCY:
• DO NOT reinterpret or distort shapes between render angles
• The exact same layered shape MUST appear in all views
• Angles must stay consistent across all body panels

Two-color designs:
• Use a base color layer that defines the main shape
• Apply the second color as a top accent layer following the same geometry
• Ensure visible layering similar to real cut vinyl applications

Multi-zone color layouts:
• Keep colors separated by clean vinyl cut boundaries
• Never overlap colors unless user specifies layered or stacked design

Geometric / swoosh / angled stripes:
• Maintain installer-style linear precision
• Angles must stay consistent across all body panels and render angles

Hood graphics:
• Stack colors with underlay + overlay structure
• Keep symmetry perfect unless user requests asymmetry

Side graphics:
• Follow the natural vehicle shoulder line or rocker line
• Top layer sits exactly atop the base layer with uniform spacing

=== END 2-LAYER ENGINE ===
`;

// --- MULTI-LAYER CUT VINYL ENGINE v2 (3-LAYER MODE) ---
const MULTI_LAYER_VINYL_ENGINE_V2 = `
=== MULTI-LAYER CUT VINYL ENGINE v2 (3-LAYER MODE) ===

When the user specifies THREE colors, "tri-tone", "3-layer", "three color", or similar:

• Treat ALL three colors as independent vinyl layers
• NEVER blend layers. NEVER fade layers. NEVER watercolor edges
• Maintain razor-sharp cut boundaries between all colors

LAYER ORDER (Industry Standard):
1. BASE LAYER = darkest/neutral color (black, dark gray, navy, satin)
2. MID LAYER = main accent color (red, blue, yellow, purple, teal)
3. TOP LAYER = brightest/metallic outline (chrome, silver, white, gold)

Examples:
- Black base → Red accent → Chrome outline
- Navy base → White accent → Silver outline  
- Satin black base → Teal accent → Gloss white outline

BASE LAYER RULES:
• Defines the full silhouette of the vinyl shape
• Follows all body geometry (shoulder line, rocker line, hood curvature)

MID LAYER RULES:
• Slightly smaller shape stacked on top of base
• Follows exact same silhouette, inset consistently
• Maintain proportional spacing between layers

TOP LAYER RULES:
• Thin outline or small accent
• High contrast or metallic color
• MUST remain extremely crisp and thin
• Absolutely NO fill or bleed

ANGLE CONSISTENCY (CRITICAL):
• All three layers MUST appear identically in ALL render angles
• NO geometry drifting between views
• NO repositioning between angles
• NO scaling changes

If user does NOT specify layer order:
• Use standard (dark → mid → bright) rule

If user mentions chrome:
• Chrome automatically becomes TOP LAYER unless explicitly stated

If user mentions matte or satin:
• These become BASE or MID layers, NEVER top outline layers

Overlay Behavior:
• Stack layers visibly with clean vinyl cut separation
• DO NOT simulate printing
• DO NOT blend colors

=== END 3-LAYER ENGINE ===
`;

// --- SHAPE LIBRARY v1 ---
const SHAPE_LIBRARY_V1 = `
=== SHAPE LIBRARY v1 ===

When a user requests ANY vinyl shape by name or description, interpret using these installer-accurate categories:

DART SHAPES:
• Long, tapering graphics pointing forward or backward
• Used on muscle cars, trucks, sport compacts
• Maintain sharp points and symmetrical thickness

SCALLOPS:
• Rounded leading edges with tapered ends
• Used in hot rod, lowrider, retro car designs
• Maintain clean curvature and layered highlights

SWOOSH / WAVE STRIPES:
• Flowing graphics that follow body lines
• Must remain smooth with consistent arc geometry

OEM HERITAGE STRIPES:
• GT stripes, ZL1-style, Roush stripes, Boss 302
• Camaro shoulder stripes, Mopar bumblebee stripes
• Use correct symmetry and period-relevant proportions

NUMBER PLATE / RACE PANEL:
• Rectangular or oval panel areas for numbers
• Placed on doors, hood, or trunk per user prompt
• Maintain crisp edges and centered alignment

HOOD ACCENTS:
• Spear shapes, dagger shapes, centerline accents, arrow tips
• Always centered unless user requests offset

SIDE ROCKER STRIPES:
• Horizontal stripes along lower door or rocker panel
• Must follow rocker geometry — never floating or crooked

WHEEL ARCH ACCENTS:
• Stripes that trace wheel arch curvature
• Must be perfectly smooth and follow arch radius

TAILGATE GRAPHICS:
• Centerline stripes or symmetrical designs on trucks
• Must not wrap onto bumper unless user requests

For ANY shape not explicitly listed, infer closest style using real-world vinyl installer knowledge.

=== END SHAPE LIBRARY v1 ===
`;

// --- RACING STRIPES ENGINE v1 ---
const RACING_STRIPES_ENGINE_V1 = `
=== RACING STRIPES ENGINE v1 ===

When user requests "racing stripes," "center stripes," "dual stripes," "rally stripes," or any variation:

• ALWAYS use two parallel stripes unless user specifies single stripe
• Stripes must run continuously from:
    - front bumper → hood → roof → trunk → rear bumper
  unless user limits placement

• Maintain consistent width across all panels
• Maintain consistent gap width between stripes
• Stripes MUST appear identical across all render views

Single wide stripe:
• Must remain centered unless user specifies offset

Offset racing stripes:
• Must maintain fixed distance from vehicle centerline

Hood-only stripes:
• Must follow hood curvature and body lines

Color Rules:
• Base stripe color = user's primary color
• Outline stripe (if requested) = contrast color
• Top highlight (if 3-layer) = brightest color

• NO blending, NO fading (unless requested), NO distortions

=== END RACING STRIPES ENGINE v1 ===
`;

// --- AREA TARGETING ENGINE v1 ---
const AREA_TARGETING_ENGINE_V1 = `
=== AREA TARGETING ENGINE v1 ===

Interpret all location-based instructions using installer-standard spatial logic:

"top half" / "upper half" / "upper body":
• Apply graphics ONLY above the belt line / shoulder line

"bottom half" / "lower half":
• Apply graphics ONLY below the belt line

"driver side only" or "left side only":
• Apply graphics ONLY to the vehicle's left exterior panels

"passenger side only" or "right side only":
• Apply graphics ONLY to the vehicle's right exterior panels

"front only":
• Apply graphics to bumper, hood, fenders, and A-pillars only

"rear only":
• Apply graphics to trunk/tailgate, quarter panels, bumper, and rear glass area

"hood only":
• Graphics apply ONLY to the hood, do not spill onto fenders

"roof only":
• Apply stripes or graphics ONLY on the roof panel

"doors only":
• Apply vinyl exclusively within door panel boundaries

"bedside only" (for trucks):
• Apply to left and right bedsides, respecting wheel arch boundaries

"tailgate only":
• Apply vinyl exclusively to the tailgate
• Keep centered unless user specifies offset

GENERAL RULE:
All area-based targeting MUST be maintained identically across all render angles with NO drift.

=== END AREA TARGETING ENGINE v1 ===
`;

// --- VERTICAL TWO-TONE ENGINE v1 ---
const VERTICAL_TWO_TONE_ENGINE_V1 = `
=== VERTICAL TWO-TONE ENGINE v1 ===

When user requests LEFT/RIGHT vertical two-tone wrap:

TRIGGER PHRASES:
• "left side [COLOR] right side [COLOR]"
• "left half [COLOR] right half [COLOR]"  
• "driver side [COLOR] passenger side [COLOR]"
• "driver's side [COLOR] passenger's side [COLOR]"
• "split down the middle" with two colors

VERTICAL SPLIT LINE:
• The dividing line runs DOWN THE CENTER of the vehicle (front to back)
• Split follows the vehicle's centerline: center of hood, center of roof, center of trunk/tailgate
• Creates a clean vertical division between left and right halves

LEFT SIDE (Driver Side in US):
• Entire left exterior: left half of hood, left fender, left doors, left quarter panel, left half of roof, left half of trunk
• Apply specified color/finish to ALL left-facing panels

RIGHT SIDE (Passenger Side in US):
• Entire right exterior: right half of hood, right fender, right doors, right quarter panel, right half of roof, right half of trunk
• Apply specified color/finish to ALL right-facing panels

CENTER STRIPE WITH SIDE SPLIT:
If user requests center stripe with left/right colors:
• Apply left color to left side
• Apply right color to right side
• Apply stripe color as a CENTER STRIPE running hood → roof → trunk
• Stripe sits ON TOP of the color split line

MULTI-VIEW CONSISTENCY (CRITICAL):
• Side view shows ONE color prominently (the visible side)
• Front view shows BOTH colors split at center with clean dividing line
• Rear view shows BOTH colors split at center with clean dividing line
• Top view (if rendered) shows the split line running front to back

=== END VERTICAL TWO-TONE ENGINE v1 ===
`;

// --- OEM STRIPE INTELLIGENCE ENGINE v1 ---
const OEM_STRIPE_INTELLIGENCE_V1 = `
=== OEM STRIPE INTELLIGENCE ENGINE v1 ===

When user references "OEM stripes", "factory stripes", "heritage stripes", or specific model graphics:

MUSTANG OEM STRIPES:
• GT Dual Stripes: twin wide stripes, equal width, narrow center gap, bumper → hood → roof → trunk
• Rocker Stripes: horizontal along lower door, following rocker curvature
• Boss 302 Side Stripe: upper-body horizontal stripe with forward-facing block
• Mach 1 Hood Stripe: centered rectangular hood panel stripe with thin outline

CAMARO OEM / HERITAGE:
• Heritage Hockey Stripes: angled stripes on front fenders tapering rearward
• ZL1 / SS Hood Stripes: centered, wide, rectangular with vents respected
• Shoulder Line Stripes: follow Camaro's distinctive upper body crease

CHALLENGER / CHARGER OEM:
• Bumblebee Stripe: vertical tail stripe wrapping around rear quarter panels
• R/T Classic Stripe: fender-to-door arc stripe with circular cut
• T/A Hood Stripe: matte black hood panel with scoop outline
• Scat Pack Bee Stripe: wide band across rear quarter aligned perfectly

CORVETTE / C7 / C8:
• Stingray Spear Stripes: flowing spear shapes on front fenders
• Dual Hood Stripes: narrow paired racing stripes with thinner proportions
• Side Intake Accents: small blade accents above side intakes

BMW M STRIPES:
• Triple diagonal stripes (light blue, dark blue, red)
• Placed on lower driver side of bumper or rocker area
• Maintain correct angle and spacing

PORSCHE / GT / RS PACKAGE:
• GT3 / RS Door Stripes: horizontal stripe along lower doors with centered break
• Hood spear accents: optional narrow centerline accents

JEEP WRANGLER OEM:
• Rubicon-style hood decals (centered or offset)
• Side hood spear stripes following hood crease

PICKUP TRUCK OEM:
• Silverado Rally Stripes: hood + tailgate dual stripes with center gap
• F150 FX4 / Sport lower rocker stripes: long, horizontal, low-profile
• Ram bedside stripes: rocker-aligned sweeping stripes

GENERAL OEM RULES:
• Follow OEM-correct geometry, thickness, shape curvature, placement
• DO NOT invent new shapes unless user requests custom
• Maintain perfect consistency across all render angles
• Respect hood vents, door gaps, panel breaks
• NEVER distort OEM shapes — keep true to real-world vinyl geometry

=== END OEM STRIPE INTELLIGENCE v1 ===
`;

// --- OEM CUTOUT ENGINE v1 ---
const OEM_CUTOUT_ENGINE_V1 = `
=== OEM CUTOUT ENGINE v1 ===

For ANY wrap, stripe, partial wrap, or vinyl graphic, automatically respect OEM cutout areas:

DO NOT place vinyl over:
• Hood vents, heat extractors, air scoops
• Fender vents and side intakes
• Door handles (unless user requests wrap)
• Mirror caps (wrap only if user specifies)
• Headlights, taillights, DRLs, fog lights
• Sensors, radar modules, parking sensors
• Rear diffusers and exhaust openings
• Emblems or badges (cover only if user requests "delete badge")
• Windshield, windows, and glass areas
• License plate areas (wrap only if user specifies)
• Chrome trim pieces (wrap only if user requests blackout)

CUTOUT BEHAVIOR:
• Graphics must "flow around" vents and intakes, not over them
• Maintain clean, realistic vinyl edges around all openings
• Keep striping continuous but correctly interrupted by cutouts
• On trucks, DO NOT wrap over tie-down points or cargo hooks
• On SUVs, respect rear hatch creases and wiper bases

ANGLE CONSISTENCY:
• Cutout logic MUST be identical in all render angles
• No drifting of stripe termination around vents
• No covering vents in angle 1 but not angle 3

If user explicitly says "wrap vents" or "cover handles," override default behavior.

=== END OEM CUTOUT ENGINE v1 ===
`;

// --- PANEL STRIPE SEMANTICS ENGINE v1 ---
const PANEL_STRIPE_SEMANTICS_V1 = `
=== PANEL STRIPE SEMANTICS ENGINE v1 ===

When user requests body-line stripes, use these EXACT placement definitions:

🚨 CRITICAL STRIPE-ONLY RULE:
When user requests a STRIPE (beltline stripe, rocker stripe, racing stripe, etc.):
• The VEHICLE BODY COLOR REMAINS UNCHANGED (original color or user-specified base color)
• ONLY the STRIPE ITSELF gets the specified color(s)
• DO NOT repaint the entire vehicle
• DO NOT create multi-zone wraps unless explicitly requested
• Stripes are THIN ACCENT LINES on top of the base vehicle paint

Example: "red and gold beltline stripe on green car"
• Vehicle body = GREEN (stays green everywhere)
• Beltline stripe ONLY = red with gold accent/outline
• Result: Green car with a thin red/gold stripe along the beltline

ROCKER STRIPE:
• Placement: Horizontal stripe along LOWER BODY, 8-14 inches from ground
• Follows rocker panel contour continuously from front fender to rear quarter
• MUST NOT rise above door crease line
• Typical width: 2-6 inches
• Boundaries: Starts behind front wheel arch, ends at rear wheel arch

BELTLINE STRIPE:
• Placement: Mid-body stripe along BELT LINE CREASE (window sill height)
• Follows natural body character line at window bottom edge
• MUST follow door panel break points naturally
• Typical width: 1-4 inches
• Boundaries: Front fender behind headlight to rear quarter behind door
• THIS IS A THIN HORIZONTAL LINE, NOT A FULL BODY WRAP

SHOULDER STRIPE:
• Placement: Upper body stripe JUST BELOW window line
• Sits on the shoulder crease above doors
• MUST NOT touch window glass
• Typical width: 2-4 inches
• Boundaries: A-pillar area to C-pillar or quarter panel

QUARTER PANEL ACCENT:
• Placement: Rear quarter panel sweep from door edge to tail
• Flows along rear wheel arch and quarter panel shape
• Can wrap around to taillight area
• Typical width: 3-8 inches
• Boundaries: Rear door edge to taillight

FENDER-TO-QUARTER SWEEP (SWOOSH):
• Placement: Continuous flowing stripe from front fender to rear quarter
• Follows vehicle's upper body line in smooth arc
• MUST maintain smooth continuous curve
• Typical width: 4-10 inches
• Boundaries: Front fender behind headlight to rear quarter at taillight

MULTI-VIEW CONSISTENCY (CRITICAL):
• Stripe placement MUST be IDENTICAL in all render views
• Stripe width MUST be consistent across all panels
• Stripe color MUST match exactly in all angles
• NO drift, NO repositioning, NO scaling between views

=== END PANEL STRIPE SEMANTICS v1 ===
`;

// --- STRIPE AUTO-DETECTION ENGINE v1 ---
const STRIPE_AUTO_DETECTION_V1 = `
=== STRIPE AUTO-DETECTION ENGINE v1 ===

INTERPRET USER LANGUAGE AND MAP TO PANEL STRIPE TYPES:

If user says:
  "lower stripe", "bottom stripe", "rocker stripe", "lower accent", "lower body stripe":
      → Use ROCKER STRIPE geometry (8-14" from ground)

If user says:
  "middle stripe", "mid stripe", "beltline stripe", "body line stripe", "character line stripe":
      → Use BELTLINE STRIPE geometry (window sill height)

If user says:
  "upper stripe", "top stripe", "shoulder stripe", "upper accent", "high stripe":
      → Use SHOULDER STRIPE geometry (below window line)

If user says:
  "quarter stripe", "rear sweep", "wraparound stripe", "quarter accent":
      → Use QUARTER PANEL ACCENT geometry (door to tail)

If user says:
  "fender to quarter", "swoosh", "body swoosh", "full sweep", "front to rear stripe":
      → Use FENDER-TO-QUARTER SWEEP geometry (continuous arc)

If user says:
  "lowrider stripe", "low rider stripe", "lowrider side stripe", "low rider graphics":
      → Use LOWRIDER STRIPE geometry (see LOWRIDER STRIPE ENGINE)
      → This is a SPECIFIC stripe type, NOT just a style modifier
      → Apply flowing curves with scalloped/wavy edges along sides

If user specifies:
  "door only", "doors only":
      → Apply stripe ONLY inside door boundaries

If user specifies:
  "hood stripe", "hood accent":
      → Use hood-specific placement (do NOT continue to roof)

ALL MAPPED REGIONS MUST REMAIN IDENTICAL ACROSS ALL 3 VIEWS.
DO NOT place stripes outside defined panel areas.
DO NOT interpret "stripe" as racing stripes unless user explicitly says "racing stripe" or "center stripe".

=== END STRIPE AUTO-DETECTION v1 ===
`;

// --- USER GEOMETRY OVERRIDE ENGINE v1 ---
const USER_GEOMETRY_OVERRIDE_V1 = `
=== USER GEOMETRY OVERRIDE ENGINE v1 ===

When ANY of these phrases appear in user prompt, USER GEOMETRY takes HIGHEST PRIORITY:

USER_OVERRIDE_PHRASES:
• "top half", "bottom half", "upper half", "lower half"
• "front half", "rear half"
• "hood only", "roof only", "sides only", "doors only"
• "driver side only", "passenger side only"
• "bedside only", "rocker only", "lower doors only"
• "quarters only", "trunk only", "tailgate only"
• "split", "two tone", "two-tone"
• "beltline", "shoulder line"
• "custom geometry", "my layout"

WHEN USER OVERRIDE DETECTED:
1. IGNORE all preset geometry definitions
2. IGNORE all OEM geometry definitions
3. APPLY user's geometric specification EXACTLY
4. Style reference modifies APPEARANCE only, NOT placement

PRIORITY ORDER:
1. USER GEOMETRY → highest priority (if override phrase detected)
2. OEM GEOMETRY → second priority (maintains vehicle-specific placement)
3. STYLE REFERENCE → modifies style ONLY (line weight, curves, flourishes)
4. PRESET SUGGESTIONS → lowest priority

=== END USER GEOMETRY OVERRIDE v1 ===
`;

// --- STYLE VS OEM PRIORITY ENGINE v1 ---
const STYLE_VS_OEM_PRIORITY_V1 = `
=== STYLE VS OEM PRIORITY ENGINE v1 ===

STYLE REFERENCES MODIFY APPEARANCE, NOT PLACEMENT:

When user provides a style reference (lowrider, hot rod, JDM, etc.):
• Apply reference's LINE LANGUAGE (curve flow, flourishes)
• Apply reference's STROKE WEIGHT (thin, thick, tapered)
• Apply reference's ACCENT BEHAVIOR (pinstripes, outlines)
• DO NOT apply reference's geometric placement

OEM GEOMETRY STAYS ACCURATE:
• Mustang GT stripes stay in Mustang GT positions
• Camaro hockey stripes stay in Camaro positions
• Porsche door stripes stay at Porsche height
• Style reference cannot move stripes to different panels

EXAMPLE:
User: "Mustang GT stripes with lowrider styling"
• Apply Mustang GT stripe PLACEMENT (hood to trunk)
• Apply lowrider STYLE (thicker lines, chrome outline, scalloped edges)
• DO NOT move stripes to lowrider positions

This prevents style references from destroying OEM accuracy.

=== END STYLE VS OEM PRIORITY v1 ===
`;

// --- LOWRIDER STRIPE ENGINE v1 ---
const LOWRIDER_STRIPE_ENGINE_V1 = `
=== LOWRIDER STRIPE ENGINE v1 ===

When user requests "lowrider stripe", "low rider stripe", "lowrider graphics", or "lowrider side stripe":
THIS IS A SPECIFIC STRIPE TYPE, NOT A STYLE MODIFIER.

LOWRIDER STRIPE CHARACTERISTICS:
• Flowing, organic curves along the vehicle sides
• Scalloped or wavy edges (not straight geometric lines)
• Often multi-layered with outline + fill
• Classic hot rod / custom car aesthetic
• Placement: typically mid-body along doors and quarters

LOWRIDER STRIPE GEOMETRY:
• Primary band: 6-12 inches wide, flowing curve from front fender to rear quarter
• Edge style: scalloped, flame-inspired, or flowing wave pattern
• Position: mid-body height (between rocker and beltline)
• May include accent pinstripe outline (1/4" chrome or contrasting color)

LAYERING (if multi-color specified):
• Base layer: main color, defines flowing shape
• Accent layer: contrasting outline following scalloped edges
• Optional chrome pinstripe: thin highlight on outer edge

REFERENCE IMAGE HANDLING:
• If user uploads a reference image, MATCH THE EXACT STYLE from the image
• Copy the curve flow, scallop pattern, and edge treatment from reference
• Adapt the reference pattern to fit the specific vehicle's proportions
• DO NOT ignore reference images - they define the exact stripe style wanted

TYPICAL COLOR COMBINATIONS:
• Gold/tan scallops with chrome outline
• Metallic flake with pinstripe accent
• Two-tone flowing curves (light over dark or dark over light)

MULTI-VIEW CONSISTENCY:
• Flowing curves MUST be identical across all render views
• Scalloped edges must maintain exact same pattern in all angles
• NO drifting or repositioning between views

=== END LOWRIDER STRIPE ENGINE v1 ===
`;

// --- AUTOMATIC OEM DETECTION ENGINE v1 ---
const OEM_AUTO_DETECTION_V1 = `
=== AUTOMATIC OEM DETECTION ENGINE v1 ===

Automatically detect the vehicle's make and model from input parameters and apply OEM-correct geometry, stripe proportions, cutouts, and styling rules without requiring user specification.

OEM DETECTION RULES:

FORD MUSTANG:
• GT dual stripes: wide, equal width, narrow center gap
• Rocker stripes follow rocker contour
• Boss 302: side block stripe with forward slash
• Mach 1 hood panel stripe: matte center section with outline

CHEVROLET CAMARO:
• Heritage Hockey Stripes: fender tapering backward
• ZL1 hood stripe: centered rectangular panel
• Shoulder-line graphics follow the upper crease

DODGE CHALLENGER:
• Bumblebee stripe wraps quarter panel horizontally
• R/T stripe with circle emblem shape
• T/A hood blackout panel

DODGE CHARGER:
• Scat Pack Bee quarter-panel stripe
• Hood stripes run over air inlets but avoid vents

CHEVROLET CORVETTE:
• Stingray spear graphics on front fenders
• Hood stripes must be thinner and more aerodynamic
• Door and quarter shapes follow aerodynamic curvature

PORSCHE 911 / GT / RS:
• Lower door stripe aligned slightly above rocker line
• Hood spear accents extremely narrow
• Respect all scoop and vent cutouts

BMW M SERIES:
• Triple diagonal stripe pattern (light blue, dark blue, red)
• Align to lower bumper or rocker panel depending on model

JEEP WRANGLER:
• Hood offset stripes follow hood contour
• Side hood spears follow character crease

RAM / F150 / SILVERADO:
• Bedside stripes follow bedside line or wheel arch
• Rally stripes apply to hood + tailgate with matched spacing
• FX4/Sport rocker stripes sit low and horizontal

TESLA MODEL S/X/3/Y:
• Clean minimalist graphics following Tesla's aerodynamic lines
• No hood vents to avoid, but respect sensor placements
• Smooth flowing stripes matching EV aesthetics

OEM CUTOUTS (AUTO):
• Avoid vents, scoops, intakes, sensors, handles, glass, and emblem surfaces automatically

OEM ALIGNMENT:
• Align all stripes and shapes to OEM body creases, shoulder lines, and rocker lines
• Maintain correct symmetry across panels

OEM CONSISTENCY:
• OEM-correct shapes MUST remain identical across all render angles
• No drift, distortion, or re-interpretation allowed

If user explicitly says "custom," override OEM patterns.

=== END AUTOMATIC OEM DETECTION ENGINE v1 ===
`;

// --- FULL VEHICLE SEGMENTATION ENGINE v1 ---
const FULL_VEHICLE_SEGMENTATION_V1 = `
=== FULL VEHICLE SEGMENTATION ENGINE v1 ===

The vehicle is automatically segmented into the following installer-accurate zones:

GLOBAL ZONES:
  1. Top Zone (above the shoulder line / belt line)
  2. Mid Zone (between shoulder line and door midline)
  3. Bottom Zone (below midline to rocker panels)
  4. Hood Zone
  5. Roof Zone
  6. Front End Zone (bumper, grille area, hood front)
  7. Rear End Zone (trunk/tailgate, rear bumper)
  8. Driver Side Zone (left exterior)
  9. Passenger Side Zone (right exterior)
  10. Window/Glass Zone (NEVER wrap unless explicitly stated)

PANEL-SPECIFIC ZONES:
  • Front Bumper
  • Rear Bumper
  • Hood
  • Roof
  • Front Fenders
  • Rear Quarter Panels
  • Front Doors
  • Rear Doors (if applicable)
  • Rocker Panels
  • Wheel Arches (front/rear)
  • Bedside Upper (trucks)
  • Bedside Lower (trucks)
  • Tailgate (trucks)
  • Bed Floor / Bed Rail (if user asks)

SEGMENT RULES:
• Graphics MUST apply ONLY to zones explicitly referenced by user instructions.

• If user says:
      "top half only" → Apply graphics to Top Zone ONLY.
      "bottom half only" → Apply to Bottom Zone ONLY.
      "front end" → Apply ONLY to bumper + hood zone.
      "rear only" → Apply ONLY to trunk/tailgate + rear bumper.
      "driver side only" → Apply graphics only to LEFT vehicle zones.
      "passenger side only" → Apply graphics only to RIGHT vehicle zones.
      "hood only" → Graphics must NOT spill onto fenders.
      "doors only" → Lock graphics to door panels ONLY.
      "fenders only" → Apply graphics ONLY to fender panels and follow fender curvature.
      "bedside only" → Apply to truck bedside zones, respecting wheel arch and cutouts.
      "tailgate only" → Center graphics on tailgate panel.

• MULTI-VIEW CONSISTENCY:
    All segmentation must remain EXACTLY identical in:
      - front 3/4 view
      - side profile
      - rear 3/4 view
    NO DRIFT. NO RE-INTERPRETATION.

• SHAPE INTERACTION WITH SEGMENTS:
    - Shapes must clip cleanly to zone boundaries.
    - Shapes may NOT bleed into adjacent zones unless user allows it.
    - Multi-layer vinyl MUST respect segmentation boundaries.

• OEM CUTOUT INTEGRATION:
    - After segmentation, remove vinyl from vents, intakes, handles, lights,
      sensors, badges unless user overrides.

=== END FULL VEHICLE SEGMENTATION ENGINE v1 ===
`;

// --- TOP/BOTTOM HARD ZONING v3 ---
const TOP_BOTTOM_HARD_ZONING_V3 = `
=== TOP/BOTTOM HARD ZONING v3 ===

When the user requests "top half", "upper half", or similar:
    • DEFINE the top zone as the UPPER 40% of vehicle height.
    • This zone STARTS above the OEM shoulder line (belt line).
    • This applies consistently to hood, doors, fenders, and quarter panels.
    • This boundary MUST remain straight and level across all 3 views.
    • NO variation, NO sagging, NO diagonal unless user requests.

When the user requests "bottom half", "lower half":
    • DEFINE the bottom zone as LOWER 60% of vehicle height.
    • This zone starts at the shoulder line and extends down to rocker line.
    • This MUST remain constant across all angles.

COLOR LOCK:
    • Apply the first color ONLY IN THE TOP ZONE.
    • Apply the second color ONLY IN THE BOTTOM ZONE.
    • Colors MUST NOT bleed across the boundary.
    • Colors MUST NOT invert or shift between angles.

GEOMETRY LOCK:
    • Once zones are calculated for the first view, REUSE the SAME boundary
      coordinates for view 2 and view 3 to prevent drift.

CONSISTENCY:
    • The boundary line MUST appear in the exact same position relative
      to wheels, door handles, glass line, and body creases across ALL views.

=== END TOP/BOTTOM HARD ZONING v3 ===
`;

// --- DEMO SAFE MODE v1 ---
const DEMO_SAFE_MODE_V1 = `
=== DEMO SAFE MODE v1 ===

In demo mode, enforce maximum stability and predictability:

DETERMINISTIC INTERPRETATION:
    • Disable stochastic randomness in spatial calculations
    • Force deterministic interpretation of all spatial terms
    • Lock segmentation boundaries EARLY in processing
    • Lock layer ordering EARLY before rendering

GEOMETRIC RIGIDITY:
    • Reduce compositional freedom to zero
    • Increase geometric precision to maximum
    • Zone boundaries are IMMUTABLE once calculated
    • NO creative reinterpretation of user instructions

REPRODUCIBILITY:
    • Same prompt MUST produce visually identical results
    • Multiple runs of same request = identical output
    • Zone positions, colors, boundaries must match exactly

GOAL: Produce stable, predictable, identical results on repeated prompts for professional filming and demonstrations.

=== END DEMO SAFE MODE v1 ===
`;

// --- CUT PATH ENGINE v1 (Print-Ready Vector Extraction) ---
const CUT_PATH_ENGINE_V1 = `
=== CUT PATH ENGINE v1 (Print-Ready Vector Extraction) ===

PURPOSE: Generate renders with clean, extractable boundaries for production cut files.

BOUNDARY DEFINITION RULES:
    • ALL color zone boundaries must be SHARP and WELL-DEFINED
    • NO soft gradients, NO feathered edges at zone transitions
    • Zone boundaries follow vehicle body lines precisely
    • Boundaries align to natural panel seams where possible

CONTRAST MAXIMIZATION:
    • Adjacent zones must have MAXIMUM color contrast at boundaries
    • Boundary lines must be visually distinct and traceable
    • NO color bleeding or soft transitions between zones

PANEL-ALIGNED CUTS:
    • Hood boundary follows hood edge precisely
    • Door boundaries align to door panel edges
    • Fender boundaries follow fender contours
    • Rocker boundaries align to rocker panel edges
    • Roof boundaries follow roof edge/drip rail

STRIPE & SHAPE BOUNDARIES:
    • Racing stripes have PIXEL-SHARP edges
    • All shapes have clean, hard contours
    • Multi-layer vinyl boundaries are distinct and separable
    • Each layer boundary is independently traceable

PRODUCTION-READY OUTPUT:
    • Render quality suitable for AI-assisted vector tracing
    • Zone colors are SOLID (no internal gradients unless requested)
    • Reflections/highlights do NOT obscure zone boundaries
    • Shadows do NOT blend zone edges

CUT FILE EXTRACTION GUIDANCE:
    • Zone 1 (primary color) = extractable as single path
    • Zone 2 (secondary color) = extractable as single path
    • Stripe elements = extractable as independent paths
    • Accent elements = extractable as independent paths

GOAL: Every color zone boundary in the render can be traced into a production-ready vector cut path for vinyl plotter output.

=== END CUT PATH ENGINE v1 ===
`;

// --- PRINT SCALING ENGINE v1 (Real-World Vehicle Dimensions) ---
const PRINT_SCALING_ENGINE_V1 = `
=== PRINT SCALING ENGINE v1 (Real-World Vehicle Dimensions) ===

PURPOSE: Convert AI masks to real-world vehicle dimensions for production-ready output.

SCALING RULES:
    • For every panel (hood, door, fender, quarter, bedside):
      - Match the graphic's mask size to real physical dimensions
      - Use vehicle dimension database (length, width, height in mm)
    
    • Panel-specific scaling factors:
      - Hood: typically 48-60" wide × 36-48" deep
      - Doors: typically 36-42" wide × 24-32" tall
      - Fenders: typically 24-30" wide × 18-24" tall
      - Quarter panels: typically 36-48" wide × 20-28" tall
      - Bedsides (trucks): typically 72-96" long × 18-24" tall
      - Roof: typically 48-60" wide × 60-84" long

    • Conversion formula:
      realWidthInches = (panelPixelWidth / renderPixelWidth) * vehicleRealWidthInches
      realHeightInches = (panelPixelHeight / renderPixelHeight) * vehicleRealHeightInches

    • Aspect ratio MUST be maintained exactly
    • NO stretching, warping, or distortion allowed
    • Output MUST match RestyleProAI print-ready requirements

VEHICLE CLASS REFERENCES:
    • Compact sedan: ~180" L × 70" W × 55" H
    • Mid-size sedan: ~195" L × 73" W × 57" H
    • Full-size truck: ~230" L × 80" W × 78" H
    • SUV: ~190" L × 76" W × 70" H
    • Sports car: ~175" L × 75" W × 50" H

=== END PRINT SCALING ENGINE v1 ===
`;

// --- AUTO TILING ENGINE v1 (Print Panel Segmentation) ---
const AUTO_TILING_ENGINE_V1 = `
=== AUTO TILING ENGINE v1 (Print Panel Segmentation) ===

PURPOSE: Automatically tile scaled vector graphics into print-ready panels.

TILING RULES:
    • Printer max width = 60 inches (or 53 inches for specific films)
    • Add 0.5 inch overlap bleed between panels
    • Maintain perfect graphic continuity across panel breaks
    • Slice vinyl design vertically into sequential tiles:
      PANEL_01, PANEL_02, PANEL_03, etc.

PANEL REQUIREMENTS:
    • Each SVG tile must:
      - Be exactly the print width (minus margins)
      - Contain only the portion of design within that panel
      - Include correct registration edge for installers
    
    • All tiled panels MUST align perfectly when reassembled
    • Include alignment marks at panel edges
    • Mark overlap zones clearly

ORIENTATION RULES:
    • Horizontal tiling for long bedside graphics
    • Vertical tiling for full-body wraps or long swooshes
    • Respect vinyl grain direction for metallic/chrome films

PRODUCTION OUTPUT:
    • NEVER distort graphics when slicing
    • NEVER shift or offset shapes between panels
    • Panel files remain production-accurate
    • Include panel numbering and orientation markers
    • Mark "THIS SIDE UP" for directional films

BLEED SPECIFICATIONS:
    • Standard bleed: 0.5 inch overlap
    • Chrome/metallic: 0.75 inch overlap (seam hiding)
    • Printed patterns: 1.0 inch overlap (pattern matching)

=== END AUTO TILING ENGINE v1 ===
`;

// --- STYLE REFERENCE ENGINES v2 ---
const STYLE_BLEND_ENGINE_V1 = `
=== STYLE BLEND ENGINE v1 ===

If the user provides one or more style reference images:

• Extract style DNA from EACH reference.
• Identify shared style characteristics:
    - line weight
    - layering structure
    - curvature flow
    - symmetry patterns
    - accent stroke behavior
    - pinstripe vs flourish geometry
    - complexity level

• Blend styles into a single unified "STYLE PROFILE."

• If conflict exists:
      PRIORITIZE the dominant style from reference #1
      and use references #2 and #3 as secondary influences.

• Apply the blended STYLE PROFILE consistently to:
      hood graphics,
      side graphics,
      rocker graphics,
      quarter panel graphics,
      roof accents,
      tailgate accents.

• NEVER copy the exact reference image.
• ALWAYS recreate the style language uniquely on the vehicle.

=== END STYLE BLEND ENGINE v1 ===
`;

const STYLE_COLOR_PALETTE_ENGINE_V1 = `
=== STYLE COLOR PALETTE ENGINE v1 ===

If the style reference includes color:

• Extract:
    - Primary color
    - Secondary color
    - Highlight color
    - Shadow/neutral color
• Maintain same color pairings (ex: orange + white, silver + purple)
• Map these colors to vinyl film selections logically:
    - primary color → base stripe color
    - secondary color → mid-layer accent
    - highlight color → pinstripe or outline layer

If NO color desired:
• Preserve only stylistic geometry, not color.

=== END STYLE COLOR PALETTE ENGINE v1 ===
`;

const SYMMETRY_ENGINE_V1 = `
=== SYMMETRY ENGINE v1 ===

For hood, trunk, and central graphics:

• Style MUST be perfectly symmetrical left-to-right.
• Use reflection-based geometry rules.
• No drifting or uneven strokes.
• Follow curvature of hood/trunk panel.
• NEVER create asymmetric graphics unless user explicitly requests.

=== END SYMMETRY ENGINE v1 ===
`;

const STYLE_PLACEMENT_ENGINE_V1 = `
=== STYLE PLACEMENT ENGINE v1 ===

If the reference image shows placement (hood, center, side, etc.):

• Deduce intended placement.
• Example:
    - Hood pinstripes → place on hood centerline.
    - Side swooshes → apply from door to rear quarter.
    - Dagger shapes → place at front of hood tapering backward.
    - Lowrider graphics → apply flowing curves on hood and sides.

• Convert artistic placement to correct vehicle zones.
• Apply consistently across all render views.

=== END STYLE PLACEMENT ENGINE v1 ===
`;

const PRESET_MERGER_ENGINE_V1 = `
=== PRESET + USER PROMPT MERGER ENGINE v1 ===

When the user selects a preset AND adds their own modifications:

MERGE RULES:
• PRESERVE the preset's geometry, shape, and placement exactly
• APPLY user's color modifications to the preset shapes
• APPLY user's finish modifications (chrome, matte, satin)
• APPLY user's outline/accent additions

Example Interpretation:
- Preset: "Mustang GT dual racing stripes"
- User adds: "make them blue with chrome outline"
- Result: Mustang GT stripe GEOMETRY + blue color + chrome outline layer

PRIORITY ORDER:
1. Preset geometry (LOCKED, never change)
2. User color preferences (APPLIED)
3. User finish preferences (APPLIED)
4. User outline/accent additions (ADDED)

OEM PRESET HANDLING:
• When OEM preset is detected, use OEM STRIPE INTELLIGENCE rules
• Apply OEM-correct proportions, spacing, and placement
• User modifications affect COLOR/FINISH only, not geometry

=== END PRESET + USER PROMPT MERGER ENGINE v1 ===
`;

const MULTI_VIEW_STYLE_CONSISTENCY_V1 = `
=== MULTI-VIEW STYLE CONSISTENCY ENGINE v1 ===

Style MUST remain identical in:
• front 3/4 view
• side profile view
• rear 3/4 view
• top view

No drift in:
• line weight
• symmetry
• flourish geometry
• style intensity
• contrast
• placement
• color values

All views must look like the SAME vehicle with the SAME design.

=== END MULTI-VIEW STYLE CONSISTENCY ENGINE v1 ===
`;

export interface GraphicsProPromptOptions {
  userPrompt: string;
  vehicle: string;
  viewType?: string;
  cameraPositioning?: string;
  revisionPrompt?: string | null;
  styleDescription?: string | null;
  selectedPreset?: string | null;
  hasReferenceImage?: boolean;
  presetCategory?: string | null; // 'bodylines' triggers stripe mode
}

/** Apply entire GraphicsPro prompt engine */
export function buildGraphicsProPrompt(options: GraphicsProPromptOptions): string {
  const { userPrompt, vehicle, viewType = 'side', cameraPositioning, revisionPrompt, styleDescription, selectedPreset, hasReferenceImage, presetCategory } = options;
  const promptLower = userPrompt.toLowerCase();
  
  // ============= STRIPE MODE v2 - EARLY DETECTION & BYPASS =============
  // Detect stripe-only requests FIRST - these MUST bypass all two-tone/multi-zone engines
  // NOW also checks presetCategory === 'bodylines' for 100% accurate detection
  const stripeIntent = (
    presetCategory === 'bodylines' || // Body Lines tab selected = ALWAYS stripe mode
    selectedPreset?.toLowerCase().includes('stripe') ||
    selectedPreset?.toLowerCase().includes('beltline') ||
    selectedPreset?.toLowerCase().includes('rocker') ||
    selectedPreset?.toLowerCase().includes('shoulder') ||
    selectedPreset?.toLowerCase().includes('sweep') ||
    /stripe|rocker|beltline|shoulder|swoosh|accent|panel sweep|panel stripe|body line|pinstripe|quarter sweep/i.test(promptLower)
  ) && !(
    // NOT a two-tone request
    promptLower.includes('two tone') ||
    promptLower.includes('two-tone') ||
    (promptLower.includes('top half') && promptLower.includes('bottom half')) ||
    (promptLower.includes('upper half') && promptLower.includes('lower half')) ||
    (promptLower.includes('left side') && promptLower.includes('right side')) ||
    (promptLower.includes('left half') && promptLower.includes('right half'))
  );

  // Detect base vehicle color from "on [color] car" pattern  
  let detectedBaseColor = '';
  const baseColorMatch = promptLower.match(/\bon\s+(\w+)\s+(?:car|vehicle|truck|suv)/i);
  if (baseColorMatch) {
    detectedBaseColor = baseColorMatch[1].charAt(0).toUpperCase() + baseColorMatch[1].slice(1);
  }

  // ============= STRIPE MODE EARLY RETURN - BYPASSES ALL OTHER ENGINES =============
  if (stripeIntent) {
    const studioEnv = HARD_LIGHT_STUDIO;

    const cameraBlock = cameraPositioning || `${viewType.toUpperCase()} VIEW - Professional automotive photography angle`;

    const revisionBlock = revisionPrompt
      ? `\n=== REVISION INSTRUCTIONS ===\nApply this modification ONLY to the STRIPE: "${revisionPrompt}"\nDO NOT modify vehicle body color. DO NOT add shapes. DO NOT reinterpret.\n`
      : '';
    
    // STRIPE-ONLY PROMPT - Clean, minimal, no conflicting engines
    return `
=== GRAPHICSPRO STRIPE MODE — VINYL STRIPES ONLY ===

You are generating VINYL STRIPES on a vehicle. NOT a full-body wrap.
This is NOT a two-tone wrap. This is NOT a multi-zone color split.

=== VEHICLE ===
${vehicle}

=== STUDIO ENVIRONMENT ===
${studioEnv}

=== CAMERA POSITION ===
${cameraBlock}

=== OUTPUT QUALITY ===
Ultra-high resolution 4K output (3840×2160px minimum)
Tack-sharp detail on all body panels
Professional DSLR automotive photography quality

=== USER STRIPE REQUEST ===
"${userPrompt}"

=== STRIPE-ONLY RULES (CRITICAL) ===

1. VEHICLE BODY COLOR MUST REMAIN UNCHANGED
   ${detectedBaseColor ? `• Base vehicle color: ${detectedBaseColor.toUpperCase()} - the ENTIRE car body stays this color` : '• Keep the vehicle in its original factory/base color'}
   • Hood, doors, fenders, quarters, roof - ALL stay the BASE COLOR
   • Do NOT repaint ANY body panels

2. APPLY STRIPE COLORS ONLY TO THE STRIPE LINE ITSELF
   • A stripe is a THIN ACCENT LINE (1-6 inches wide typically)
   • Only the stripe geometry gets the user's specified colors
   • The stripe sits ON TOP of the base body color

3. STRIPE TYPE DEFINITIONS:
   • ROCKER STRIPE: Horizontal line along lower body (8-14" from ground)
   • BELTLINE STRIPE: Mid-body line at window sill height (2-4" wide)
   • SHOULDER STRIPE: Upper body line just below window line
   • QUARTER PANEL SWEEP: Flowing accent on rear quarter panels
   • FENDER-TO-QUARTER SWOOSH: Continuous arc from front fender to rear

4. MULTI-COLOR STRIPE INTERPRETATION:
   • "Red and gold stripe" = Red stripe WITH gold accent/outline, NOT two car halves
   • Primary color = main stripe body
   • Secondary color = outline/accent layer on the stripe

=== WHAT THIS IS NOT ===
❌ NOT a two-tone wrap (car painted two different colors)
❌ NOT a multi-zone split (top half/bottom half)
❌ NOT large color blocks or panels
❌ NOT a full-body recolor

=== WHAT THIS IS ===
✅ A thin decorative stripe line on an otherwise single-color car
✅ Clean vinyl installer-style stripe geometry
✅ Colors apply ONLY to the stripe, not the vehicle body

=== STRIPE GEOMETRY MUST BE IDENTICAL IN ALL VIEWS ===
• Same width, same placement, same colors across all render angles
• NO drift between views

=== IGNORE PRESET IMAGE COLORS (CRITICAL) ===
• DO NOT copy any colors from preset thumbnail images
• DO NOT add neon, glow, backlight, illumination, or lighting effects
• DO NOT add purple, blue, or orange glow halos from preset previews
• Preset images are GEOMETRY DIAGRAMS ONLY - ignore their colors completely
• Use ONLY the colors explicitly specified by the user
• If user does NOT specify colors, use neutral white/black vinyl for the stripe

=== DO NOT DO THESE THINGS ===
• DO NOT create full-body two-tone sections
• DO NOT paint half the car one color and half another
• DO NOT create diagonal color blocks
• DO NOT add random shapes or logos
• DO NOT recolor the vehicle body
• DO NOT apply preset two-tone patterns
• DO NOT apply OEM two-tone logic
• DO NOT apply style DNA that changes body colors
• DO NOT add neon glow or lighting effects
• DO NOT copy colors from any reference or preset images
${revisionBlock}

=== NEGATIVE PROMPT ===
NO two-tone body wraps, NO multi-zone color splits, NO full-body recolors,
NO diagonal blocks, NO half-car painting, NO top/bottom splits,
NO random shapes, NO logos unless requested, NO neon, NO glow,
NO backlight effects, NO illumination, NO purple/blue/orange halos.

=== GENERATE NOW ===
Create hyper-photorealistic render of ${vehicle} with ONLY the requested STRIPE.
Vehicle body color remains UNCHANGED. Only the stripe line gets the specified colors.
Use clean solid vinyl with NO glow or lighting effects.
`.trim();
  }

  // ============= STANDARD FULL-BODY / TWO-TONE MODE =============
  const zones = extractVehicleZones(userPrompt);
  const useHardLight = requiresHardLightStudio(userPrompt);
  const layerInfo = detectMultiLayerDesign(userPrompt);
  const hasLowriderStripe = promptLower.includes('lowrider') || promptLower.includes('low rider');
  const hasVerticalTwoTone = (
    (promptLower.includes('left') && promptLower.includes('right')) ||
    promptLower.includes('driver side') || 
    promptLower.includes("driver's side") ||
    promptLower.includes('passenger side') ||
    promptLower.includes("passenger's side")
  );

  const studioEnv = useHardLight ? HARD_LIGHT_STUDIO : SOFT_DIFFUSION_STUDIO;

  const cameraBlock = cameraPositioning || `${viewType.toUpperCase()} VIEW - Professional automotive photography angle`;

  const revisionBlock = revisionPrompt 
    ? `\n=== REVISION INSTRUCTIONS ===\nApply this modification: "${revisionPrompt}"\nChange ONLY what is requested. Preserve all other design elements.\n`
    : '';

  // Reference image instruction block
  const referenceImageBlock = hasReferenceImage ? `
=== 🎯 REFERENCE IMAGE PROVIDED (CRITICAL) ===

A reference image has been uploaded showing the EXACT style wanted.

YOU MUST:
• STUDY the reference image carefully
• MATCH the exact curve flow, scallop pattern, edge treatment
• REPLICATE the stripe style, width, and placement from the reference
• ADAPT the design to fit the target vehicle's proportions
• MAINTAIN the same visual language (thick/thin lines, flowing curves, layered effects)

DO NOT:
• Ignore the reference image
• Create a generic design instead
• Change the style significantly from the reference

The reference image is your PRIMARY source of design direction.
=== END REFERENCE IMAGE INSTRUCTIONS ===
` : '';

  // Note: Stripe-only requests are handled via early return above - no stripeOnlyBlock needed here

  // Inject multi-layer engine based on detection
  let multiLayerBlock = '';
  if (layerInfo.layers === 3) {
    multiLayerBlock = MULTI_LAYER_VINYL_ENGINE_V2;
  } else if (layerInfo.layers === 2) {
    multiLayerBlock = MULTI_LAYER_VINYL_ENGINE_V1;
  }

  // Style DNA block if provided
  const styleDNABlock = styleDescription ? `
=== STYLE DNA (VISUAL REFERENCE) ===
Apply the following extracted artistic style consistently:
${styleDescription}

This style must influence:
• Hood graphics
• Side stripes
• Door + quarter flows
• Accent lines
• Multi-layer cut vinyl geometry

DO NOT copy the reference image directly.
Only recreate the style language (curves, strokes, flow).
=== END STYLE DNA ===
` : '';

  // Preset context block
  const presetBlock = selectedPreset ? `
=== SELECTED PRESET: ${selectedPreset} ===
Apply OEM geometry for this preset EXACTLY as defined.
User modifications affect COLOR/FINISH only.
NEVER override preset geometry with user text.
=== END PRESET CONTEXT ===
` : '';

  const systemPrompt = `
=== GRAPHICSPRO — SENIOR AUTOMOTIVE WRAP DESIGN ENGINE ===

You are a senior-level wrap designer with 15+ years experience specializing in:
• Multi-color zone wraps (two-tone, tri-tone)
• Chrome, satin, matte, gloss, metallic, pearl films
• Pinstripes, racing stripes, rally stripes, chevrons
• Layered accent vinyl and cut-contour graphics
• Premium partial wraps and accent packages
• Chrome delete packages
• Brake caliper coloring (visible through wheel spokes)

=== VEHICLE ZONE KNOWLEDGE ===
You MUST understand all vehicle zones: ${VEHICLE_ZONES.join(", ")}

When the user references a body part:
- Apply the color or film ONLY to that zone
- Maintain clean separation lines between zones
- Ensure vinyl realism (chrome = mirror, satin = diffused, matte = flat)

=== STUDIO ENVIRONMENT ===
${studioEnv}

=== CAMERA POSITION ===
${cameraBlock}

=== OUTPUT QUALITY (CRITICAL) ===
Ultra-high resolution 4K output (3840×2160px minimum)
Tack-sharp detail on all body panels
HDR dynamic range for maximum contrast
No soft focus, no blur, no diffusion
Professional DSLR automotive photography quality
Every reflection crisp and defined

=== ANGLE LOCK ===
Do NOT change perspective, crop, vehicle geometry, or angle.
`;

  const negPrompt = `
=== NEGATIVE PROMPT ===
NO angle changes, NO new reflections, NO distortions,
NO unrealistic graphics, NO floating shapes,
NO fake decals unless requested, NO neon glow unless asked,
NO fisheye, NO cartoon style, NO CGI appearance,
NO soft focus, NO blur, NO low resolution.
`;

  return `
${systemPrompt}
${multiLayerBlock}
${SHAPE_LIBRARY_V1}
${RACING_STRIPES_ENGINE_V1}
${AREA_TARGETING_ENGINE_V1}
${hasVerticalTwoTone ? VERTICAL_TWO_TONE_ENGINE_V1 : ''}
${PANEL_STRIPE_SEMANTICS_V1}
${STRIPE_AUTO_DETECTION_V1}
${USER_GEOMETRY_OVERRIDE_V1}
${STYLE_VS_OEM_PRIORITY_V1}
${hasLowriderStripe ? LOWRIDER_STRIPE_ENGINE_V1 : ''}
${OEM_STRIPE_INTELLIGENCE_V1}
${OEM_CUTOUT_ENGINE_V1}
${OEM_AUTO_DETECTION_V1}
${FULL_VEHICLE_SEGMENTATION_V1}
${TOP_BOTTOM_HARD_ZONING_V3}
${DEMO_SAFE_MODE_V1}
${CUT_PATH_ENGINE_V1}
${PRINT_SCALING_ENGINE_V1}
${AUTO_TILING_ENGINE_V1}
${styleDNABlock ? STYLE_BLEND_ENGINE_V1 : ''}
${styleDNABlock ? STYLE_COLOR_PALETTE_ENGINE_V1 : ''}
${styleDNABlock ? SYMMETRY_ENGINE_V1 : ''}
${styleDNABlock ? STYLE_PLACEMENT_ENGINE_V1 : ''}
${selectedPreset ? PRESET_MERGER_ENGINE_V1 : ''}
${MULTI_VIEW_STYLE_CONSISTENCY_V1}
${presetBlock}
${styleDNABlock}
${referenceImageBlock}

=== VEHICLE ===
${vehicle}

=== USER DESIGN REQUEST ===
"${userPrompt}"

=== VEHICLE ZONES DETECTED ===
${zones.length > 0 ? zones.join(", ") : "None specified (apply global logic)"}

=== LAYER ANALYSIS ===
Detected: ${layerInfo.layers}-layer design (${layerInfo.type})

=== INTERPRETATION RULES ===
• Identify each requested color and apply ONLY to described zones
• For multi-color instructions, split the body cleanly
• For pinstripes/accents, follow true cut-contour placement
• Maintain vinyl realism based on film type
• Generate ${viewType.toUpperCase()} VIEW FIRST

=== CRITICAL - NEVER WRAP THESE ===
❌ WINDSHIELD - NEVER WRAP - must remain 100% transparent clear glass
❌ ALL WINDOWS - front, rear, side glass MUST remain transparent
❌ Headlights, taillights - remain functional clear lights
❌ Wheels, tires, rims - remain original finish
❌ Grilles - remain chrome/black original
🚨 If windshield or any glass appears wrapped, the render FAILS.
${revisionBlock}
${negPrompt}

${vehicle.toLowerCase().includes('raptor') || vehicle.toLowerCase().includes('f-150') || vehicle.toLowerCase().includes('f150') || vehicle.toLowerCase().includes('silverado') || vehicle.toLowerCase().includes('ram') || vehicle.toLowerCase().includes('truck') ? `
=== TRUCK ZONE CALIBRATION (HIGH BELTLINE VEHICLES) ===
Trucks have elevated belt lines. For top/bottom two-tone splits:
• TOP ZONE (gold chrome) = upper 30-35% of vehicle body height
• BOTTOM ZONE (satin black) = lower 65-70% of vehicle body height
• The belt line on trucks is HIGHER than sedans
• Apply this ratio consistently across all angles and panels
• Include bedside panels in proper zone allocation
=== END TRUCK CALIBRATION ===
` : ''}

=== FINAL GEOMETRY OVERRIDE (MANDATORY - OVERRIDES ALL PRIOR RULES) ===

⚠️ IGNORE any conflicting instructions from presets, OEM patterns, style engines, or templates.

YOU MUST APPLY THIS EXACT GEOMETRY:

• If user specified "GOLD CHROME TOP HALF" or similar → Apply ONLY to top half of vehicle body
• If user specified "SATIN BLACK BOTTOM HALF" or similar → Apply ONLY to bottom half of vehicle body

DEFINITIONS:
• "Top Half" = all panels ABOVE the shoulder line (belt line):
    - upper doors
    - upper fenders  
    - upper quarters
    - upper bedside (trucks)
    - A-pillars
    - roof (if visible)

• "Bottom Half" = all panels BELOW the shoulder line:
    - lower doors
    - rocker zones
    - lower fenders
    - lower quarters
    - lower bedside

ABSOLUTE RULES:
• DO NOT allow top-half color to enter lower-body zones
• DO NOT allow bottom-half color to rise above upper-body zones
• The split MUST be perfectly horizontal — NO fade, NO diagonal, NO angle
• The split MUST be IDENTICAL across ALL render views
• DO NOT reinterpret layout in different frames
• DO NOT merge preset geometry into user's split definition

🔴 THIS IS FINAL AND OVERRIDES ALL PREVIOUS RULES 🔴

=== GENERATE NOW ===
Create hyper-photorealistic render of ${vehicle} with exact wrap design specified.
PRESERVE ANGLE. PRESERVE GEOMETRY. APPLY USER'S TOP/BOTTOM SPLIT PRECISELY.
`;
}
