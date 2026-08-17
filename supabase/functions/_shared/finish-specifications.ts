export function getFinishSpecification(finish: string | object | null | undefined): string {
  // Handle null/undefined
  if (!finish) return '';

  // Handle object (finish_profile from DB is JSONB)
  let finishString: string;
  if (typeof finish === 'object') {
    // Extract type from finish_profile object like {"type": "chrome", ...}
    finishString = (finish as any).type || '';
  } else {
    finishString = String(finish);
  }

  if (!finishString) return '';
  const f = finishString.toLowerCase().trim();

  // ============================================================
  // SPECIALTY FINISH DETECTION (substring match — checked FIRST)
  //
  // The manufacturer_colors table has finishes like "Matte Metallic",
  // "Satin Flip Ghost Pearl", "Iridescent", "Chameleon", "Shift Effect",
  // "Diamond", "Rainbow", "High Gloss" that previously fell through to
  // the default gloss block. Each gets a dedicated set of instructions
  // so Gemini renders the actual film characteristics.
  // ============================================================

  // Ghost Flip / Satin Flip / Ghost Pearl — pearl-based color-flip films
  // (3M "Satin Flip Ghost Pearl", any "Ghost" or "Flip" finish variant)
  if (f.includes('ghost') || f.includes('flip')) {
    return `GHOST FLIP / SATIN FLIP / PEARL FLIP FINISH — COLOR-SHIFTING PEARLESCENT VINYL WRAP

CRITICAL: This is a GHOST FLIP / SATIN FLIP / PEARL FLIP color-changing vinyl.
The film is SUBTLE at flat angles and EXPLODES with shifting color on curves and under direct light.
DO NOT render as a single flat color — this film has DYNAMIC pearl color-shift effects.

MANDATORY GHOST/FLIP CHARACTERISTICS:
- The base color is the QUIET state — visible on flat angled body panels at oblique viewing
- Pearl/mica particles embedded in the film create a SECOND color under direct light
- On hood, roof, and panels facing the camera/light: the FLIP color reveals itself
- On door sides facing away from light: the BASE color dominates with subtle pearl ghosting
- Highlights along body lines show the FULL color shift (often complementary or analogous to base)
- Soft satin sheen — NOT mirror, NOT chrome, NOT high gloss
- Fine pearlescent flake catches light at every curvature change
- "Ghost" means the effect is barely visible at neutral angles and dramatic at oblique angles

VISIBLE COLOR-SHIFT MAPPING:
- Direct light surfaces (hood center, roof center, fender tops): SHIFTED color (the "flip")
- Side panels in neutral light: BASE color with pearl ghost
- Shadow zones: deepest base color with subtle pearl glow
- Curved transitions: smooth blend between base and flip across the gradient

VISUAL REFERENCE:
3M Satin Flip Ghost Pearl, Inozetek Ghost series, KPMF Ghost Series — premium satin pearl
films where the color appears different from every angle. Think "color sliding across the
panel as you walk around the vehicle."

CRITICAL: If the vehicle appears as ONE solid color with no pearl shift, render FAILS.
The defining feature of this film is that color VISIBLY changes across panels — not flat paint.`;
  }

  // Iridescent — rainbow-spectrum pearl shift (Hexis HX30 Special, Avery oil-slick)
  if (f.includes('iridescent')) {
    return `IRIDESCENT FINISH — RAINBOW PEARL COLOR-SHIFT VINYL WRAP

CRITICAL: Iridescent film shifts through MULTIPLE colors across the spectrum as the angle changes.
DO NOT render as a single color — the iridescent base shows different hues on every panel.

MANDATORY IRIDESCENT CHARACTERISTICS:
- Oil-slick / soap-bubble appearance — shifts through cool-to-warm spectrum
- Different body panels show DIFFERENT hues (blue → teal → purple → magenta sequence)
- Smooth angular color sweep along curved surfaces
- Pearl/dichroic flake substrate creating the rainbow effect
- Satin-to-gloss sheen with high color saturation in the shifted hue
- Color appears to "flow" across the body as the viewing angle changes
- NO single dominant color — the spectrum is the point

COLOR SWEEP MAPPING:
- Hood facing camera: primary spectrum point (e.g. teal-blue)
- Fenders angled: next spectrum step (e.g. purple)
- Doors: shifted further (e.g. magenta)
- Rear quarter: spectrum endpoint (e.g. amber-gold)
- All transitions are smooth gradients between adjacent spectrum colors

VISUAL REFERENCE:
Hexis HX30 Special Iridescent series, Avery oil-slick films — rainbow shimmer like beetle wings
or hummingbird feathers.

CRITICAL: If the vehicle appears as one solid color, the render FAILS. Spectrum shift across
panels is the defining feature of iridescent film.`;
  }

  // Chameleon — strong dual/tri-color shift (Hexis HX20000, KPMF chameleon)
  if (f.includes('chameleon')) {
    return `CHAMELEON FINISH — STRONG DUAL-COLOR-SHIFT VINYL WRAP

CRITICAL: Chameleon film shifts BETWEEN TWO DISTINCT COLORS (e.g. blue ↔ purple, green ↔ gold)
based on viewing angle. The shift is dramatic and immediately visible across the vehicle body.
DO NOT render as a single color.

MANDATORY CHAMELEON CHARACTERISTICS:
- TWO clear dominant colors visible simultaneously on different panels
- High-saturation pigment shift driven by interference flake
- Sharp transition along curvature — body lines show the full hue swing
- Mid-gloss to satin sheen with deep saturated color
- Different from iridescent: chameleon has TWO endpoints, iridescent sweeps the spectrum
- Panel orientation determines which color shows — light-facing = one, angled = the other

COLOR SHIFT MAPPING (e.g. Chameleon Blue Purple):
- Hood facing forward into light: deep BLUE
- Fenders at 45°: blue-purple transition zone
- Door panels: dominant PURPLE
- Rear angled away: deepest PURPLE
- All transitions are smooth but the two endpoint colors are saturated and distinct

VISUAL REFERENCE:
Hexis HX20000 Chameleon Blue Purple / Green Gold / Grey series — high-pigment color-shift
films popular on show cars.

CRITICAL: A single solid color = render FAILS. Both endpoint colors must appear on the same
vehicle, with the transition driven by panel angle to camera/light.`;
  }

  // Shift Effect / Color Shift — generic flip film
  if (f.includes('shift effect') || f.includes('color shift') || f.includes('colorshift')) {
    return `SHIFT EFFECT FINISH — COLOR-SHIFTING VINYL WRAP

CRITICAL: Color-shifting film with dynamic hue variation based on viewing angle.
DO NOT render as a single solid color.

MANDATORY SHIFT EFFECT CHARACTERISTICS:
- Visible color difference between light-facing and angled panels
- High-pigment color-shift flake or pearl substrate
- Saturated primary color with secondary color revealing on curves
- Mid-to-high gloss sheen showing the shift clearly
- Different hues on hood, doors, fenders, and rear panels
- Smooth blend across body lines, not abrupt zones

VISUAL REFERENCE:
Premium color-shift wrap films — Inozetek, Teckwrap, KPMF shift series.

CRITICAL: Render fails if vehicle appears one flat color. The shift IS the product.`;
  }

  // Rainbow / Psychedelic — full-spectrum prismatic shift
  if (f.includes('rainbow') || f.includes('psychedelic')) {
    return `RAINBOW / PSYCHEDELIC FINISH — FULL-SPECTRUM PRISMATIC VINYL WRAP

CRITICAL: Rainbow film shows the FULL VISIBLE SPECTRUM across the vehicle body.
DO NOT render as a single color or even a dual-shift — the entire rainbow appears.

MANDATORY RAINBOW CHARACTERISTICS:
- Prismatic spectrum: red → orange → yellow → green → blue → violet across the body
- Each panel displays a DIFFERENT spectrum band
- Smooth color sweep following body lines and curves
- Dichroic prism flake creating the rainbow split
- High-gloss to satin sheen, high color saturation throughout
- Direct light intensifies the prism effect on hood and roof

SPECTRUM SWEEP MAPPING:
- Front nose / hood front: red-orange range
- Hood center / windshield base: yellow-green range
- Doors: green-blue range
- Rear quarter / trunk: blue-violet range
- Side body lines: visible spectrum gradients between adjacent zones

VISUAL REFERENCE:
3M 2080 Flip Psychedelic, prismatic dichroic films — the full visible spectrum on one car.

CRITICAL: A single color or only two colors = render FAILS. The full rainbow IS the film.`;
  }

  // Diamond — large-flake sparkle finish (Avery Diamond series)
  if (f.includes('diamond')) {
    return `DIAMOND FINISH — LARGE-FLAKE METALLIC SPARKLE VINYL WRAP

CRITICAL: Diamond finish has LARGE visible metallic flakes (bigger than Sparkle) creating
a brilliant jeweled sparkle effect across the vehicle. Each flake catches light individually.

MANDATORY DIAMOND CHARACTERISTICS:
- Visible large metallic flakes (LARGER than Sparkle, smaller than chunky glitter)
- Each flake creates a pinpoint highlight under direct light
- Base color visible between flakes — flakes do not blanket the color
- Mid-gloss sheen with significant flake-driven specular response
- Flakes catch studio lights creating multiple bright points across panels
- More dramatic than Metallic, more refined than Glitter
- Premium "jewel-tone" automotive appearance

FLAKE BEHAVIOR:
- Direct light: brilliant pinpoint sparkles across the entire panel
- Angled light: flakes still visible as subtle texture
- Shadow zones: flakes still catch ambient light with dimmer sparkle
- Curved surfaces: full diamond brilliance along body lines

VISUAL REFERENCE:
Avery Dennison Diamond series (Amber, Blue, Purple, Red, Silver, White) — premium
heavy-flake automotive films with high-end jeweled sparkle.

CRITICAL: A flat-looking surface without visible individual flakes = render FAILS.
The flake brilliance defines this finish.`;
  }

  // Matte Metallic — matte sheen with metallic particles (Avery's signature family)
  if (f.includes('matte metallic') || f.includes('matte-metallic') || f.includes('metallic matte')) {
    return `MATTE METALLIC FINISH — REALISTIC AUTOMOTIVE VINYL WRAP

CRITICAL: Matte base with embedded metallic particles. NOT shiny, NOT flat — sits between
satin and matte with visible metallic sparkle particles. Avery Dennison's signature family.

MANDATORY MATTE METALLIC CHARACTERISTICS:
- Flat matte topcoat (no gloss, no specular highlights, no wet look)
- Metallic flake particles VISIBLE through the matte topcoat
- Particles create soft sparkle without sharp reflections
- Pattern: matte surface with sparkle depth underneath
- NO mirror reflections, NO crisp highlights, NO glossy shine
- Sparkle visible mainly on direct-light surfaces (hood, roof tops)
- Less sparkle than Metallic finish, more sparkle than plain Matte
- Premium "stealth metallic" appearance — flat surface but dimensional underneath

VISUAL REFERENCE:
Avery Dennison Matte Metallic series (Anthracite, Brilliant Blue, Cosmic Rose, Eclipse,
Garnet Red, etc.) — flat surfaces with visible metallic depth and subtle particle sparkle.

CRITICAL: If the surface looks GLOSSY or has SHARP REFLECTIONS, render FAILS.
If the surface looks completely FLAT WITHOUT ANY SPARKLE, also FAILS.
The defining feature is matte sheen WITH visible metallic particles.`;
  }

  // High Gloss — extra-shiny gloss (PPF, Avery Supreme series)
  if (f.includes('high gloss') || f.includes('high-gloss') || f === 'supercast') {
    return `HIGH GLOSS / SUPERCAST FINISH — PREMIUM ULTRA-GLOSSY AUTOMOTIVE VINYL WRAP

CRITICAL: High Gloss is the wettest, shiniest finish — wetter than standard Gloss.
Surface must look like fresh-clearcoat with mirror-quality reflections.

MANDATORY HIGH GLOSS CHARACTERISTICS:
- Wet-look surface with crisp mirror-quality reflections of studio lights
- Sharper highlights than standard Gloss
- Glass-like clarity — no orange peel, no haze
- Premium PPF / Supercast lamination depth
- Studio lights and floor reflections appear cleanly
- Most reflective non-chrome finish

VISUAL REFERENCE:
Avery Dennison Supreme High Gloss, Hexis Supercast, 3M PPF High Gloss — wet-look
factory paint quality with extra depth and clarity.

CRITICAL: If the surface looks like a regular gloss (some shine), render FAILS.
High Gloss must be visibly wetter and more reflective than standard gloss.`;
  }

  // Texture / Textured — physical surface texture (alligator, carbon, leather)
  if (f.includes('texture') || f.includes('textured')) {
    return `TEXTURED FINISH — PHYSICAL-TEXTURE AUTOMOTIVE VINYL WRAP

CRITICAL: Textured film has visible 3D surface relief (alligator, leather, brushed,
carbon weave, woven pattern, snake skin, etc.). The texture must be visible at all
viewing angles and casts micro-shadows.

MANDATORY TEXTURED CHARACTERISTICS:
- Visible 3D surface pattern with micro-shadows in the relief
- Texture catches light at oblique angles showing depth
- Pattern follows body panels naturally without distortion
- Matte-to-satin base sheen depending on texture type
- High tactile appearance — looks like you could feel it

VISUAL REFERENCE:
3M 2080 Brushed / Carbon / Leather variants, Hexis Texture series — automotive
vinyls with embossed surface patterns.

CRITICAL: If the surface looks flat without 3D relief, render FAILS.`;
  }

  // ============================================================
  // EXACT-MATCH FINISH BLOCKS (preserved from prior behavior)
  // ============================================================

  if (f === 'gloss') {
    return `GLOSS FINISH - REALISTIC GLOSSY AUTOMOTIVE VINYL WRAP

CRITICAL: Real glossy vinyl wrap with lamination - MUST LOOK SHINY AND GLOSSY!
Pattern must be visible but surface MUST be SHINY with good reflections.

MANDATORY GLOSS CHARACTERISTICS:
- Surface MUST look GLOSSY and SHINY - this is a gloss finish!
- Pattern remains visible but with beautiful glossy shine over it
- Smooth reflective surface with professional automotive shine
- Good light reflections showing glossy quality
- Highlights where light hits curved surfaces
- Reflections should be present but soft enough to see pattern
- Professional vinyl wrap with glossy clear coat lamination
- Fresh installation with excellent shine and depth
- Think high-end glossy vinyl wrap - shiny but not pure mirror
- Clearly MUCH shinier than satin or matte finishes
- Balance: glossy shiny appearance with pattern visible underneath

VISUAL REFERENCE:
Professional glossy vinyl wrap on luxury/exotic car - obviously shiny and glossy with good reflections, pattern visible through the gloss.

CRITICAL: Must look GLOSSY and SHINY - if it looks flat or dull, render FAILS.`;
  }
  
  if (f === 'satin') {
    return `SATIN FINISH - REALISTIC SATIN AUTOMOTIVE VINYL WRAP

CRITICAL: Real satin vinyl wrap - soft sheen, NOT glossy, NOT flat.
Pattern must be clearly visible with subtle sophisticated sheen.

MANDATORY SATIN CHARACTERISTICS:
- Soft subtle sheen - between matte and gloss
- Silk-like eggshell appearance
- Pattern clearly visible with gentle sheen
- NO sharp reflections or glossy shine
- Light creates soft diffused glow
- Semi-matte professional appearance
- Gentle light bloom on curves
- Some light interaction but NO crisp highlights
- CLEARLY less reflective than gloss
- CLEARLY more sheen than matte
- Professional satin vinyl lamination

VISUAL REFERENCE:
Professional satin vinyl wrap - eggshell finish, sophisticated subtle sheen.

CRITICAL: If glossy/shiny OR completely flat, render FAILS.`;
  }
  
  if (f === 'matte' || f === 'flat') {
    return `MATTE FINISH - REALISTIC MATTE AUTOMOTIVE VINYL WRAP

CRITICAL: Real matte vinyl wrap - completely flat, NO shine whatsoever.
Pattern must be clearly visible with zero reflections.

MANDATORY MATTE CHARACTERISTICS:
- Completely flat NON-REFLECTIVE surface
- Absolutely ZERO shine, sheen, or reflections
- Pattern fully visible with flat appearance
- Light absorbed and diffused completely
- Flat like premium matte wall paint
- Professional matte vinyl texture
- NO wet look, NO shine, NO gloss
- DRAMATICALLY different from gloss
- Think premium flat finish

VISUAL REFERENCE:
Professional matte vinyl wrap - completely flat, no shine.

CRITICAL: If ANY shine or reflection visible, render FAILS.`;
  }
  
  if (f === 'chrome' || f === 'mirror') {
    return `CHROME FINISH - REALISTIC MIRROR-LIKE AUTOMOTIVE VINYL WRAP

CRITICAL: Real chrome vinyl wrap - MUST be MIRROR-LIKE with high reflectivity.
Surface must reflect studio environment sharply and clearly.

MANDATORY CHROME CHARACTERISTICS:
- Mirror-like reflective surface - this is CHROME!
- High-polish specular highlights
- Sharp reflections of studio lights and floor
- Zero diffusion - crisp clear reflections
- Polished metallic depth with hard reflections
- Reflects surrounding environment clearly
- High-contrast metallic appearance
- Think polished mirror chrome finish
- Surface should act like a curved mirror
- Dramatically more reflective than gloss

VISUAL REFERENCE:
Professional chrome vinyl wrap - mirror-like finish reflecting studio environment sharply.

CRITICAL: If surface looks dull, painted, or non-reflective, render FAILS.`;
  }
  
  if (f === 'brushed' || f === 'brushed metal') {
    return `BRUSHED METAL FINISH - REALISTIC BRUSHED AUTOMOTIVE VINYL WRAP

CRITICAL: Real brushed metal vinyl wrap - directional linear texture.
Surface must show anisotropic metallic streaking.

MANDATORY BRUSHED METAL CHARACTERISTICS:
- Linear directional texture (anisotropic)
- Visible metallic streak pattern in ONE direction
- Medium contrast reflections following grain direction
- NOT mirror-like - softer than chrome
- NOT glossy - metallic but textured
- Highlights stretch along grain direction
- Brushed aluminum or steel appearance
- Professional brushed metal vinyl texture
- Think brushed stainless steel appliance

VISUAL REFERENCE:
Professional brushed metal vinyl wrap - linear grain texture with directional reflections.

CRITICAL: If surface looks smooth/glossy without linear texture, render FAILS.`;
  }
  
  if (f === 'carbon' || f === 'carbon fiber') {
    return `CARBON FIBER FINISH - REALISTIC CARBON FIBER AUTOMOTIVE VINYL WRAP

CRITICAL: Real carbon fiber vinyl wrap - visible woven pattern with clearcoat.
Surface must show high-frequency weave structure with subtle gloss.

MANDATORY CARBON FIBER CHARACTERISTICS:
- Visible woven 2x2 twill pattern
- High-frequency weave detail preserved
- Subtle clearcoat reflection over weave
- NOT mirror-like - weave texture visible
- Slight metallic reflectance in fibers
- Professional carbon fiber realism
- Woven structure clearly visible at all angles
- Think high-end dry carbon with clearcoat
- Pattern scales correctly on vehicle surfaces

VISUAL REFERENCE:
Professional carbon fiber vinyl wrap - visible weave pattern with subtle clearcoat gloss.

CRITICAL: If weave pattern not visible or looks like plain black, render FAILS.`;
  }
  
  if (f === 'metallic') {
    return `METALLIC FINISH - REALISTIC METALLIC AUTOMOTIVE VINYL WRAP

CRITICAL: Real metallic vinyl wrap - visible sparkle/flake depth.
Surface must show metallic particle reflections under light.

MANDATORY METALLIC CHARACTERISTICS:
- Metallic flake/sparkle clearly visible
- Deep reflective color with particle depth
- Gloss or satin base with embedded flakes
- Flakes catch light at different angles
- Professional metallic vinyl appearance
- NOT flat paint - depth and dimension required
- Sparkle particles must be visible
- Think automotive metallic paint with clearcoat
- Color-shifting sparkle under studio lights

VISUAL REFERENCE:
Professional metallic vinyl wrap - visible sparkle particles with depth and dimension.

CRITICAL: If surface looks flat without visible metallic particles, render FAILS.`;
  }
  
  if (f === 'sparkle') {
    return `SPARKLE LAMINATE FINISH - REALISTIC METALLIC SPARKLE OVER VINYL WRAP

CRITICAL: Real sparkle laminate overlay - fine metallic flakes visible ONLY in highlights.
This is a SUBTLE sparkle effect, NOT chrome, NOT glitter, NOT color-shift.

MANDATORY SPARKLE LAMINATE CHARACTERISTICS:
- FINE metallic flake particles (very small, not chunky glitter)
- Sparkle visible ONLY where light hits curved surfaces and highlights
- Base color remains fully visible and unchanged
- Flake density: LOW to MEDIUM (35-40% coverage)
- Reflectivity: SUBTLE (0.3-0.4) - NOT mirror-like
- Sparkle appears as tiny pinpoint reflections, not broad shine
- Color underneath MUST remain true and unaffected
- NO rainbow effect, NO color shifting
- NO chrome appearance, NO mirror reflections
- Think: premium pearlescent clear coat with fine sparkle
- Sparkle enhances the color, does not replace it

PROHIBITED EFFECTS (RENDER FAILS IF PRESENT):
- Chrome or mirror-like reflections
- Chunky glitter or large flakes
- Rainbow/prismatic color shifting
- Washed-out or altered base color
- Over-bright sparkle that dominates the color

VISUAL REFERENCE:
Professional sparkle laminate overlay on vinyl wrap - subtle fine metallic flakes catch light on curves and edges while base color remains pure and prominent.

CRITICAL: If sparkle looks like chrome, glitter, or alters the base color, render FAILS.`;
  }
  
  // Default fallback for unknown finishes - treat as gloss
  return `GLOSS FINISH (DEFAULT) - REALISTIC GLOSSY AUTOMOTIVE VINYL WRAP
Surface MUST be GLOSSY and SHINY with good light reflections.
Professional vinyl wrap appearance with glossy lamination.`;
}

// ============================================================================
// STUDIO RE-EXPORTS — single source of truth is studio-os.ts
// ============================================================================
import { STUDIO_ENVIRONMENT as BASE_STUDIO, STUDIO_REINFORCEMENT } from "./studio-os.ts";
import { SOFT_DIFFUSION_STUDIO, HARD_LIGHT_STUDIO, getStudioEnvironment, selectStudioForFinish, selectStudioForZones } from "./studio-environments.ts";

// Re-export studio system for easy access
export { SOFT_DIFFUSION_STUDIO, HARD_LIGHT_STUDIO, getStudioEnvironment, selectStudioForFinish, selectStudioForZones };

// Use the SAME base studio as generate-color-render and design-panel-ai-generate.
// Previously this was SOFT_DIFFUSION_STUDIO which added ~700 chars of extra lighting/camera
// instructions that created a DIFFERENT studio look vs the other tools.
export const STUDIO_ENVIRONMENT = BASE_STUDIO;
