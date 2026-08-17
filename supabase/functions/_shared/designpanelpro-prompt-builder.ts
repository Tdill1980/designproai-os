import { ASPECT_RATIO_REQUIREMENT } from "./aspect-ratio-requirement.ts";
import { PHOTOREALISM_REQUIREMENT } from "./photorealism-prompt.ts";
import { FORBIDDEN_TEXT_WATERMARK_INSTRUCTIONS } from "./forbidden-text-instructions.ts";
import { getFinishSpecification, STUDIO_ENVIRONMENT } from "./finish-specifications.ts";

export function buildDesignPanelProPrompt(params: {
  vehicle: string;
  colorData: any;
  finish: string;
  cameraAngle: string;
}): string {
  const { vehicle, colorData, finish, cameraAngle } = params;
  const glossFinish = getFinishSpecification(finish);

  return `${ASPECT_RATIO_REQUIREMENT}

${PHOTOREALISM_REQUIREMENT}

🚨🚨🚨 ABSOLUTE PHOTOREALISM MANDATE - ZERO TOLERANCE FOR CGI/CARTOON APPEARANCE 🚨🚨🚨

THIS IS NOT A 3D RENDER OR CGI IMAGE. This must be an ACTUAL PHOTOGRAPH of a REAL vehicle.

CRITICAL PHOTOREALISM REQUIREMENTS:
- Output MUST be indistinguishable from a real photograph taken by a professional automotive photographer
- Use REAL professional DSLR camera characteristics: Canon EOS R5, 85mm f/1.4 lens, shallow depth of field
- REAL studio environment with professional three-point lighting setup
- REAL vinyl wrap material texture - you can see the actual vinyl material surface
- REAL reflections of studio lights and environment on vehicle paint/wrap surfaces
- REAL shadows with soft natural falloff on polished concrete studio floor
- REAL depth and dimension - the vehicle has genuine three-dimensional presence
- REAL color science - automotive magazine quality color grading

ABSOLUTELY FORBIDDEN (ANY OF THESE = FAILURE):
❌ NO cartoon or illustrated appearance whatsoever
❌ NO flat shading or cel-shaded look
❌ NO CGI/3D render appearance
❌ NO synthetic or artificial lighting
❌ NO video game graphics quality
❌ NO plastic or toy-like vehicle appearance
❌ NO unrealistic perfect gradients
❌ NO absence of natural imperfections in lighting/reflections

The vehicle must look like you could walk up and touch it. Real metal, real vinyl, real glass, real tires.
Think automotive magazine cover photo quality - Porsche, Ferrari, or BMW official press photo quality.

${FORBIDDEN_TEXT_WATERMARK_INSTRUCTIONS}

🚫 CRITICAL: IGNORE ALL TEXT IN THE DESIGN PANEL IMAGE 🚫
The uploaded design panel may contain watermarks, sponsor text, company names, or placeholder text like "TRUCK SPONSORSHIP", "YOUR LOGO HERE", "COMPANY NAME", etc.
YOU MUST COMPLETELY IGNORE ALL TEXT in the source design file.
ONLY extract and apply the VISUAL DESIGN ELEMENTS: colors, stripes, curves, gradients, geometric patterns.
DO NOT replicate ANY text, logos, or words from the design panel onto the vehicle render.
The final 3D render must show ONLY the abstract design pattern applied as vinyl wrap - ZERO text from source file.

🎨 DESIGN PANEL APPLICATION INSTRUCTIONS 🎨

You are provided with a 2D VEHICLE WRAP DESIGN PANEL image. This is a FLAT rectangular graphic design that must be applied as a FULL-BODY WRAP on the ${vehicle}.

STEP 1 - ANALYZE THE PROVIDED DESIGN PANEL (IGNORE TEXT):
- Study the design panel image carefully
- SKIP any text, watermarks, logos, or words - these are NOT part of the wrap design
- Identify ONLY the pattern elements: curves, stripes, gradients, colors
- Note the flow direction: typically designs flow from rear (darker) to front (lighter) or vice versa
- Understand the color scheme and how elements transition

STEP 2 - APPLY DESIGN AS FULL-BODY VEHICLE WRAP:
The design panel shows a SCALED pattern intended to cover an ENTIRE VEHICLE from bumper to bumper.
- The design flows seamlessly across ALL body panels
- Think of it like wrapping a gift - the pattern covers everything continuously
- The design should look like the reference example: https://example.com (a van with curved blue/white stripes flowing from rear to front)

CRITICAL FULL WRAP APPLICATION - MANDATORY:
⚠️ This is a FULL VEHICLE WRAP covering ALL exterior painted body panels.
⚠️ The design from the panel image MUST be visible and recognizable on the wrapped vehicle.

DESIGN FLOW DIRECTION (Typical):
- REAR of vehicle: Usually darker colors / end of design pattern
- MIDDLE of vehicle: Transition elements, curves, stripes
- FRONT of vehicle: Usually lighter colors / beginning of design pattern
- The design wraps AROUND the vehicle continuously

COMPLETE COVERAGE REQUIRED - EVERY PANEL MUST BE WRAPPED:
✓ HOOD: Design wraps completely across entire hood from front bumper edge to windshield base
✓ ROOF: Design continues seamlessly over entire roof panel from windshield to rear glass
✓ DRIVER SIDE: Full coverage from front fender through doors to rear quarter panel - design flows along vehicle length
✓ PASSENGER SIDE: Full coverage from front fender through doors to rear quarter panel - mirror of driver side
✓ FRONT BUMPER: Design wraps around entire front bumper face, sides, and lower grille area
✓ REAR BUMPER: Design wraps across rear bumper, trunk lid, tailgate, and lower rear fascia
✓ FRONT FENDERS: Both front fenders fully wrapped with seamless design flow
✓ REAR FENDERS: Both rear fenders and quarter panels fully wrapped
✓ SIDE MIRRORS: Side mirrors wrapped to match body design
✓ ALL CURVED SURFACES: Seamless design flow over all body contours, edges, and character lines
✓ DOOR PANELS: All doors (driver, passenger, rear) fully wrapped with continuous design

🚨🚨🚨 CRITICAL - NEVER WRAP THESE ELEMENTS (Keep Original) 🚨🚨🚨
✗ WINDSHIELD - ABSOLUTELY NEVER WRAP - must remain 100% transparent clear glass
✗ ALL WINDOWS - front, rear, side windows - NEVER wrap, must remain transparent
✗ ALL GLASS SURFACES - must remain completely clear and transparent
✗ Headlights/taillights/turn signals - remain clear functional lights
✗ Wheels, tires, rims - remain original black/factory finish
✗ Chrome trim/emblems/badges - remain original
✗ Exhaust pipes - remain original metal finish
✗ Door handles - remain original

⚠️ GLASS TRANSPARENCY IS MANDATORY - If any glass appears wrapped or tinted, the render FAILS.

DESIGN CONTINUITY & PROFESSIONAL QUALITY:
- The provided design panel pattern flows continuously and seamlessly across ALL body panels
- No visible seams, breaks, or gaps between adjacent wrapped panels
- Design scales appropriately to fit the ${vehicle} body size
- Professional installer-grade application quality - looks factory-applied
- Zero bubbles, zero wrinkles, zero lifting edges
- Perfect adhesion to all curves, contours, and body lines
- Design wraps around edges and into panel gaps naturally
- Color consistency and pattern alignment maintained across all surfaces
- The wrapped vehicle should clearly display the same design as the 2D panel image

CAMERA ANGLE: ${cameraAngle}

${STUDIO_ENVIRONMENT}

${glossFinish}

🚫 NO TEXT RULE 🚫
DO NOT add ANY text, watermarks, logos, or branding to this image.
The render must be completely text-free.

FINAL OUTPUT REQUIREMENTS:
- REAL PHOTOGRAPH quality - this must look like an actual photo taken in a professional studio
- NOT a 3D render, NOT CGI, NOT an illustration, NOT a video game screenshot
- Professional automotive magazine cover quality (think Car and Driver, Motor Trend level)
- Real vinyl wrap texture visible on vehicle surfaces with proper light reflection
- Real studio environment with polished concrete floor and soft gradient background
- Real three-point lighting with visible catchlights and natural shadow falloff
- The ${vehicle} must look like a real physical vehicle you could touch

OUTPUT: HYPER-PHOTOREALISTIC PHOTOGRAPH (not render) of ${vehicle} with PROVIDED DESIGN PANEL applied as COMPLETE FULL-BODY WRAP. Design clearly visible on all wrapped surfaces in ${finish} finish. EXACTLY 16:9 landscape (1792x1008 or 1920x1080). MUST be indistinguishable from real automotive photography.`;
}
