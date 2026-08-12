/**
 * GRAPHICSPRO - Senior-Level Wrap Designer Engine
 * Handles: multi-zone color, accents, stripes, chrome, satin, matte, cut-contour graphics.
 * 
 * This is a dedicated prompt engine for GraphicsPro that provides wrap shop expertise
 * and vehicle zone understanding for professional-grade wrap visualizations.
 */

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

export interface FilmInfo {
  finish: string;
  mfg: string;
  desc: string;
}

/** Film type inference from user color text */
export function resolveFilm(colorText: string): FilmInfo {
  const txt = colorText.toLowerCase();

  if (txt.includes("chrome")) return { finish: "chrome", mfg: "Avery Chrome", desc: "mirror-reflective chrome with perfect reflections" };
  if (txt.includes("satin")) return { finish: "satin", mfg: "3M Satin", desc: "soft satin sheen with diffused light reflection" };
  if (txt.includes("matte")) return { finish: "matte", mfg: "Avery Matte", desc: "flat matte non-reflective surface" };
  if (txt.includes("metallic")) return { finish: "metallic", mfg: "3M Metallic", desc: "subtle fine metallic sparkle flakes" };
  if (txt.includes("pearl")) return { finish: "pearl", mfg: "3M Pearl", desc: "light-reactive pearlescent color shift" };
  if (txt.includes("carbon") || txt.includes("carbon fiber")) return { finish: "carbon", mfg: "3M Carbon Fiber", desc: "woven carbon fiber texture with gloss clear" };
  if (txt.includes("gloss")) return { finish: "gloss", mfg: "Avery Gloss", desc: "deep gloss clearcoat shine" };

  // Default fallback: gloss vinyl
  return { finish: "gloss", mfg: "Avery Gloss", desc: "standard gloss vinyl wrap" };
}

/** Identify what zones user referenced in their prompt */
export function extractVehicleZones(prompt: string): string[] {
  const zonesFound: string[] = [];
  const promptLower = prompt.toLowerCase();
  
  VEHICLE_ZONES.forEach((zone) => {
    if (promptLower.includes(zone.toLowerCase())) {
      zonesFound.push(zone);
    }
  });
  
  // Check for common multi-word phrases
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
  if (promptLower.includes("lowrider")) zonesFound.push("lowrider graphic");
  if (promptLower.includes("dart")) zonesFound.push("dart graphic");
  if (promptLower.includes("number plate")) zonesFound.push("number plate");
  
  return [...new Set(zonesFound)]; // Remove duplicates
}

/** Check if prompt requires chrome/hard light studio */
export function requiresHardLightStudio(prompt: string): boolean {
  const txt = prompt.toLowerCase();
  return txt.includes("chrome") || 
         txt.includes("mirror") || 
         txt.includes("brushed") ||
         txt.includes("metallic") ||
         txt.includes("carbon fiber");
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
• Must follow rocker geometry - never floating or crooked

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
• NEVER distort OEM shapes - keep true to real-world vinyl geometry

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

export interface GraphicsProPromptOptions {
  userPrompt: string;
  vehicle: string;
  viewType?: string;
  revisionPrompt?: string | null;
}

/** Build the complete GraphicsPro AI prompt */
export function buildGraphicsProPrompt(options: GraphicsProPromptOptions): string {
  const { userPrompt, vehicle, viewType = 'side', revisionPrompt } = options;
  const zones = extractVehicleZones(userPrompt);
  const useHardLight = requiresHardLightStudio(userPrompt);
  const layerInfo = detectMultiLayerDesign(userPrompt);

  const studioEnvironment = useHardLight
    ? `HARD LIGHT STUDIO - Light gray walls (#4a4a4a to #3a3a3a), dark charcoal polished concrete floor (#2a2a2a to #1a1a1a), visible rectangular softbox reflections, high-contrast lighting for mirror-chrome surfaces`
    : `SOFT DIFFUSION STUDIO - Light gray walls (#4a4a4a to #3a3a3a), dark charcoal floor (#2a2a2a to #1a1a1a), diffused lighting, soft shadow transitions`;

  // Inject multi-layer engine based on detection
  let multiLayerBlock = '';
  if (layerInfo.layers === 3) {
    multiLayerBlock = MULTI_LAYER_VINYL_ENGINE_V2;
  } else if (layerInfo.layers === 2) {
    multiLayerBlock = MULTI_LAYER_VINYL_ENGINE_V1;
  }

  const systemPrompt = `
=== GRAPHICSPRO - SENIOR AUTOMOTIVE WRAP DESIGN ENGINE ===

You are a senior-level wrap designer with 15+ years experience specializing in:
• Multi-color zone wraps (two-tone, tri-tone)
• Chrome, satin, matte, gloss, metallic, pearl films
• Pinstripes, racing stripes, rally stripes, chevrons
• Layered accent vinyl
• Cut-contour vector graphics
• Premium partial wraps and accent packages
• Chrome delete packages
• Brake caliper color (visible through wheels)

VEHICLE ZONE EXPERTISE:
You MUST understand all vehicle zones: ${VEHICLE_ZONES.join(", ")}

When the user references a body part:
- Apply the color or film ONLY to that zone
- Maintain clean separation lines between zones
- Ensure vinyl realism (chrome = mirror reflections, satin = diffused light, matte = flat, gloss = reflective)

=== STUDIO ENVIRONMENT ===
${studioEnvironment}

=== OUTPUT QUALITY (CRITICAL) ===
Ultra-high resolution 4K output (3840×2160px minimum)
Tack-sharp detail on all body panels
HDR dynamic range for maximum contrast
No soft focus, no blur, no diffusion
Professional DSLR automotive photography quality
Every reflection crisp and defined

=== ANGLE LOCK ===
Do NOT change perspective, crop, vehicle geometry, or viewing angle.
Maintain exact camera position throughout any revisions.
`;

  const negativePrompt = `
=== NEGATIVE PROMPT (DO NOT INCLUDE) ===
NO angle changes, NO new reflections that weren't requested,
NO distortions, NO unrealistic graphics, NO floating shapes,
NO fake decals unless requested, NO neon glow unless asked,
NO fisheye lens, NO cartoon style, NO illustration style,
NO CGI appearance, NO soft focus, NO blur, NO low resolution.
`;

  const revisionBlock = revisionPrompt 
    ? `\n=== REVISION INSTRUCTIONS ===\nUser requested modification: "${revisionPrompt}"\nApply ONLY this change. Preserve all other design elements exactly.\n`
    : '';

  return `
${systemPrompt}
${multiLayerBlock}
${SHAPE_LIBRARY_V1}
${RACING_STRIPES_ENGINE_V1}
${AREA_TARGETING_ENGINE_V1}
${OEM_STRIPE_INTELLIGENCE_V1}
${OEM_CUTOUT_ENGINE_V1}
${OEM_AUTO_DETECTION_V1}
${FULL_VEHICLE_SEGMENTATION_V1}
${TOP_BOTTOM_HARD_ZONING_V3}
${DEMO_SAFE_MODE_V1}
${CUT_PATH_ENGINE_V1}
${PRINT_SCALING_ENGINE_V1}
${AUTO_TILING_ENGINE_V1}

=== VEHICLE ===
${vehicle}

=== USER DESIGN REQUEST ===
"${userPrompt}"

=== VEHICLE ZONES DETECTED ===
${zones.length > 0 ? zones.join(", ") : "None specified (apply design globally)"}

=== LAYER ANALYSIS ===
Detected: ${layerInfo.layers}-layer design (${layerInfo.type})

=== INTERPRETATION RULES ===
• Identify each requested color and apply ONLY to described zones
• For multi-color instructions (two-tone), split the body cleanly at the beltline or specified boundary
• For pinstripes/accents, follow true cut-contour placement with precise edges
• Maintain vinyl realism based on film type
• Generate ${viewType.toUpperCase()} VIEW

=== CRITICAL - NEVER WRAP THESE ===
❌ WINDSHIELD - NEVER WRAP - must remain 100% transparent clear glass
❌ ALL WINDOWS - front, rear, side glass MUST remain transparent
❌ Headlights, taillights - remain functional clear lights
❌ Wheels, tires, rims - remain original finish
❌ Grilles - remain chrome/black original
🚨 If windshield or any glass appears wrapped, the render FAILS.
${revisionBlock}
${negativePrompt}

=== GENERATE NOW ===
Create a hyper-photorealistic render of this ${vehicle} with the exact wrap design specified.
PRESERVE ANGLE. PRESERVE GEOMETRY. APPLY GRAPHICS PRECISELY.
`;
}

/** Parse two-tone prompts into zone definitions */
export function parseTwoTonePrompt(prompt: string): { topColor: string; bottomColor: string } | null {
  const twoTonePattern = /(?:top\s+half|upper\s+half|upper)\s+(.+?)\s*[,;]?\s*(?:bottom\s+half|lower\s+half|lower)\s+(.+)/i;
  const match = prompt.match(twoTonePattern);
  
  if (match) {
    return {
      topColor: match[1].trim(),
      bottomColor: match[2].trim()
    };
  }
  
  // Try reverse pattern
  const reversePattern = /(.+?)\s+(?:top|upper).*[,;]?\s*(.+?)\s+(?:bottom|lower)/i;
  const reverseMatch = prompt.match(reversePattern);
  
  if (reverseMatch) {
    return {
      topColor: reverseMatch[1].trim(),
      bottomColor: reverseMatch[2].trim()
    };
  }
  
  return null;
}
