/**
 * generate-graphics-pro — Edge function for GraphicsPro V1
 * Handles surface generation and mockup rendering for cut vinyl graphics.
 *
 * Actions:
 *   - "generate_surface"  → Gemini generates a photorealistic empty surface
 *   - "generate_mockup"   → Gemini renders cut vinyl graphics on a surface photo
 *   - "generate_flat"     → Gemini renders flat production artwork (design mode only)
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";
import { emitRenderEvent, canonicalizeVehicle } from "../_shared/render-events.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const GEMINI_MODEL = "gemini-3-pro-image-preview";
const GEMINI_TIMEOUT = 120_000;

// ── Surface prompt builder ─────────────────────────────────────────

interface SurfaceParams {
  type: string;
  year?: string;
  make?: string;
  model?: string;
  area?: string;
  indoor?: boolean;
  wallTexture?: string;
  glassType?: string;
  glassMount?: string;
  glassTint?: string;
  surfaceCategory?: string;
  floorType?: string;
  signageType?: string;
}

function buildSurfacePrompt(s: SurfaceParams): string {
  const parts: string[] = ["Photorealistic"];

  if (s.type === "vehicle") {
    // Canonicalize make/model so Gemini sees the proper-noun model name
    // ("Tesla Cybertruck", not "tesla cyber truck") and locks geometry correctly.
    const canonical = canonicalizeVehicle(s.make, s.model, s.year);
    parts.push([s.year || "", canonical || `${s.make || ""} ${s.model || ""}`].filter(Boolean).join(" ").trim());
    if (s.area) {
      const areaMap: Record<string, string> = {
        door: "driver side door",
        tailgate: "tailgate",
        hood: "hood",
        "rear-window": "rear window",
        "side-panel": "full side panel",
      };
      parts.push(`${areaMap[s.area] || s.area} view`);
    }
    // Neutral light base so the AI-generated vehicle is a clean studio vehicle,
    // NOT an arbitrary black truck. The wrap/graphics render on top of this.
    parts.push("clean glossy white factory paint");
  } else if (s.type === "wall") {
    parts.push(s.indoor ? "interior" : "exterior");
    const textureMap: Record<string, string> = {
      studio: "clean studio wall, neutral light gray",
      smooth: "smooth painted drywall",
      "semi-smooth": "orange peel textured drywall",
      textured: "red brick wall with mortar joints",
    };
    parts.push(textureMap[s.wallTexture || ""] || "painted wall");
  } else if (s.type === "glass") {
    const glassMap: Record<string, string> = {
      storefront: "glass storefront window, downtown retail strip",
      office: "office window, commercial building interior",
      vehicle: "vehicle rear window",
    };
    parts.push(glassMap[s.glassType || ""] || "glass window");
    if (s.glassTint && s.glassTint !== "clear") parts.push(`${s.glassTint} tint`);
  } else if (s.type === "surface") {
    if (s.surfaceCategory === "floor") {
      const floorMap: Record<string, string> = {
        concrete: "polished concrete floor",
        tile: "large format tile floor",
        carpet: "commercial carpet",
        wood: "hardwood floor",
        tradeshow: "trade show carpet floor",
      };
      parts.push(floorMap[s.floorType || ""] || "floor surface");
    } else if (s.surfaceCategory === "signage") {
      const signMap: Record<string, string> = {
        "a-frame": "A-frame sidewalk sign",
        monument: "monument sign base",
        banner: "hanging banner",
        awning: "storefront awning",
        "yard-sign": "yard sign on metal stake",
      };
      parts.push(signMap[s.signageType || ""] || "signage surface");
    }
  }

  if (s.type === "wall" || s.type === "glass" || s.type === "surface") {
    parts.push(s.indoor ? "interior lighting, professional environment" : "natural daylight, commercial setting");
  } else {
    // Vehicles render in the SAME studio the fill-in angles use
    // (generate-color-render's STUDIO_ENVIRONMENT) so the hero proof and the six
    // studio angles match — seamless light-gray backdrop, dark charcoal floor,
    // bright even studio lighting. NOT an outdoor parking lot, which left the
    // hero looking like a different shoot than the studio angle set.
    parts.push("clean professional photography studio, seamless light gray backdrop, dark charcoal floor, bright even studio lighting");
  }

  parts.push(
    "Straight-on camera angle. Clean surface with no existing graphics, decals, or signage. Ready for vinyl application."
  );

  return parts.join(", ");
}

// ── Mockup render prompt builder ───────────────────────────────────

interface MockupParams {
  surfaceType: string;
  surfaceTexture?: string;
  vinylFinish: string;
  graphicMode: string;
  designPrompt?: string;
  designStyle?: string;
  businessName?: string;
  businessPhone?: string;
  businessWebsite?: string;
  businessIndustry?: string;
  businessTagline?: string;
  businessFont?: string;
  businessCopyText?: string;
  generateLogo?: boolean;
  restylePrompt?: string;
  logoRecreatePrompt?: string;
  hasUserPhoto?: boolean;
  // Window/Storefront-only render mode. 'day' = bright daylight (default).
  // 'night' = realistic nighttime with interior store glow + streetlight.
  // 'headlights' = reflective vinyl demo lit by simulated headlight beam
  // (the killer mode for reflective wraps — fire/EMS/tow/plows/buses).
  renderMode?: 'day' | 'night' | 'headlights';
  // Tells the prompt how to render reflective vinyl. 'cut' = solid color
  // cut letters/shapes (3M Scotchlite cut sheet, Oracal 5750 RA). 'printed'
  // = full-color print on reflective substrate (3M 780mC, Avery RR1100).
  // Both glow under headlights but differently — cut letters glow as flat
  // shapes, printed wrap glows with the printed colors visible plus the
  // white substrate edges shining.
  vinylSubstrate?: 'cut' | 'printed';
  // When true, the customer uploaded a reference design AND asked to match /
  // clone / recreate it. We then reproduce that EXACT design instead of
  // inventing a new one (GraphicsPro behaves like RecreatePro on request).
  cloneReference?: boolean;
}

function buildMockupPrompt(p: MockupParams): string {
  const isWall = p.surfaceType === "wall";
  const surfaceLabel = p.surfaceType === "vehicle" ? "vehicle" :
    isWall ? `${p.surfaceTexture || "painted"} wall` :
    p.surfaceType === "glass" ? "glass window" : "surface";

  const finishMap: Record<string, string> = {
    glossy: "high-gloss reflective vinyl with mirror-like sheen",
    matte: "flat matte vinyl with zero reflection, velvety surface",
    satin: "satin semi-gloss vinyl with soft directional sheen",
    reflective: "3M high-visibility reflective vinyl that glows under direct light",
  };
  const finishDesc = finishMap[p.vinylFinish] || "glossy vinyl";

  // Style elevation map — translates style tags into design language
  const styleMap: Record<string, string> = {
    modern: "Clean geometric lines, bold sans-serif typography, generous whitespace, minimal color palette (2-3 colors max). Think Apple-level restraint — every element earns its place.",
    classic: "Timeless serif or slab-serif typography, established brand feel, traditional layout hierarchy. Gold/silver accents acceptable. Think law firm or heritage brand.",
    bold: "Maximum impact, oversized typography, high-contrast colors, aggressive angles. The design should be readable from 50+ feet. Think monster truck or construction fleet.",
    elegant: "Refined thin-weight fonts, subtle color palette, luxurious spacing. Metallic or pearl finishes. Think high-end real estate or luxury auto dealer.",
    playful: "Rounded friendly fonts, bright saturated colors, dynamic angles, energetic composition. Think food truck or kids' party business.",
    minimalist: "Absolute minimum elements. One font, one or two colors, maximum negative space. Logo and name only — less is more.",
    industrial: "Stencil or condensed fonts, utilitarian feel, dark colors (black, gray, safety yellow/orange). Think heavy equipment or contractor fleet.",
    retro: "Vintage-inspired fonts, nostalgic color palette, distressed or hand-painted feel. Think classic Americana or barbershop.",
  };
  const styleDirection = styleMap[p.designStyle || "modern"] || styleMap.modern;

  let graphicDesc = "";
  if (p.cloneReference) {
    // CLONE MODE — the customer uploaded an existing design and asked to match
    // it. Faithfully reproduce that design on this surface; do NOT redesign or
    // "elevate" it. This is the RecreatePro-style behavior on demand. No style
    // map here on purpose — fidelity to the attached design is the only goal.
    graphicDesc = `CLONE THE ATTACHED DESIGN — EXACT REPRODUCTION (NOT a new design):
The uploaded reference image(s) show an EXISTING wrap/graphic design. Reproduce that SAME design on this ${surfaceLabel}. This is a copy job, not a redesign.
- Reproduce every element faithfully: the same graphics, shapes, patterns, stripes, layout, composition, color palette, and typography as the attached reference.
- Keep ALL text/wording EXACTLY as shown in the reference — business name, phone number, tagline, license #, badges and logos — same spelling, same fonts, same colors, same relative placement.
- Match the reference's exact colors (e.g. the specific orange, black, and white), not approximations.
- Adapt ONLY to fit this surface's panels and proportions (reposition so the design wraps cleanly across doors, bed, hood, etc.). Do NOT restyle, simplify, modernize, re-letter, recolor, or add/remove elements that aren't in the reference.
- Do NOT apply any generic creative "style elevation." Visual fidelity to the attached design is the entire objective.${p.designPrompt ? `\n\nCustomer note: ${p.designPrompt}` : ""}`;
  } else if (p.graphicMode === "design") {
    graphicDesc = `DESIGN BRIEF: ${p.designPrompt || "custom graphic design"}

STYLE DIRECTION — ${(p.designStyle || "modern").toUpperCase()}:
${styleDirection}`;
  } else if (p.graphicMode === "commercial") {
    const info: string[] = [];
    if (p.businessName) info.push(`Business: "${p.businessName}"`);
    if (p.businessIndustry) info.push(`Industry: ${p.businessIndustry}`);
    if (p.businessPhone) info.push(`Phone: ${p.businessPhone}`);
    if (p.businessWebsite) info.push(`Web: ${p.businessWebsite}`);
    if (p.businessTagline) info.push(`Tagline: "${p.businessTagline}"`);
    if (p.businessFont) info.push(`Font: ${p.businessFont}`);
    if (p.businessCopyText) info.push(`Extra copy: ${p.businessCopyText}`);

    graphicDesc = `COMMERCIAL VEHICLE GRAPHICS PACKAGE:
${info.join(" | ")}

${p.generateLogo ? "GENERATE A LOGO: Design a bold, simple icon that represents this industry. Make it vinyl-cuttable (no gradients, max 3 colors, clean edges).\n" : ""}${p.designPrompt ? `CUSTOMER DIRECTION: ${p.designPrompt}\n` : ""}
STYLE DIRECTION — ${(p.designStyle || "modern").toUpperCase()}:
${styleDirection}

LAYOUT RULES FOR COMMERCIAL GRAPHICS:
- Business name is the HERO element — largest, most prominent, readable from distance
- Phone and website are SECONDARY — clearly readable but not competing with name
- Logo supports the name, never overpowers it
- All text must be spelled correctly and positioned for real-world readability
- Design should look cohesive across ALL zones — same style language, same color palette
- Each zone gets appropriate content based on its size and location`;
  } else if (p.graphicMode === "restyle") {
    graphicDesc = `RESTYLE the uploaded graphic: ${p.restylePrompt || "modernize and improve the design"}
${p.businessCopyText ? `Include text: ${p.businessCopyText}` : ""}
${p.businessFont ? `Font: ${p.businessFont}` : ""}

STYLE DIRECTION — ${(p.designStyle || "modern").toUpperCase()}:
${styleDirection}`;
  } else if (p.graphicMode === "logo") {
    graphicDesc = `LOGO RECREATION FOR CUT VINYL:
${p.designPrompt ? `Customer notes: ${p.designPrompt}` : "Recreate the uploaded logo exactly as it appears."}

LOGO RECREATION RULES:
- Recreate the uploaded logo as CLEAN, SHARP cut vinyl on the surface
- Every letter, shape, and element must be PRECISE and READABLE
- Maintain original colors, proportions, and layout exactly
- Show plotter-cut vinyl edges — each color is a separate layer of vinyl
- All text must be spelled EXACTLY as shown in the source logo
- No gradients — convert any gradients to solid color vinyl layers
- Clean vector-quality edges suitable for a plotter/cutter
${p.restylePrompt ? `\nMODIFICATIONS: ${p.restylePrompt}` : ""}`;
  } else {
    graphicDesc = `Apply the uploaded artwork as cut vinyl graphics. Maintain original design integrity.

STYLE DIRECTION — ${(p.designStyle || "modern").toUpperCase()}:
${styleDirection}`;
  }

  const isGlass = p.surfaceType === "glass";
  const renderMode = p.renderMode || 'day';
  const substrate = p.vinylSubstrate || 'cut';

  // CLONE MODE short-circuit — the surface-specific prompts below all carry
  // "creative elevation" language (reinterpret icons, $10k-agency restyling,
  // style maps) that pushes Gemini to REINVENT the design. That is exactly what
  // makes "match the attached design" come back as a new, different design.
  // When the customer asked to clone an uploaded reference, skip all of that and
  // lead with faithful reproduction — the same approach RecreatePro uses.
  if (p.cloneReference) {
    const nightClone = renderMode === 'night'
      ? `\nLIGHTING: realistic nighttime — warm streetlight from the upper-front-left, colors stay saturated and readable (not desaturated), faint wet-pavement reflection.\n`
      : '';
    return `You are reproducing an EXISTING, approved ${surfaceLabel === 'vehicle' ? 'vehicle wrap' : surfaceLabel + ' graphic'} design onto a ${surfaceLabel}. This is a FAITHFUL COPY of the attached reference image — not a redesign, not an "improved" or "elevated" version.

SURFACE: ${surfaceLabel}
VINYL: ${finishDesc}

${graphicDesc}

EXECUTION:
- Apply the reference design as real installed vinyl on the ${surfaceLabel}, conforming to its panels, body lines, and contours.
- Reproduce the reference's exact colors, graphics, patterns, stripes, logos, and text/wording — same layout, same proportions, same hierarchy. Do NOT add, remove, restyle, re-letter, recolor, or "clean up" anything.
- Keep every word of text spelled exactly as in the reference (business name, phone, tagline, license #, badges).
- Show realistic vinyl edges and finish so it reads as a true installation, not a digital paint-over.

CAMERA & FRAMING:
- Show the FULL ${surfaceLabel} from a natural 3/4 angle at a comfortable distance — entire subject in frame, with ground plane and environment visible for realism.
${nightClone}
OUTPUT: Photorealistic photograph of the installed wrap that reproduces the attached design EXACTLY. No watermarks, no text overlays, no digital artifacts.`;
  }

  // Production-method directive — drives whether the AI is allowed to be
  // creative with color/gradient/photographic detail (Print & Cut) or
  // must constrain itself to flat solid-color layers from real
  // manufacturer film SKUs (Manufacture Film Cut). The mockup is the
  // CUSTOMER-FACING preview, so it needs to look like what production
  // can actually deliver.
  const substrateDirective = substrate === 'printed'
    ? `PRODUCTION METHOD — PRINT & CUT (full creative freedom):
- This is FULL-COLOR DIGITAL PRINT on cast vinyl with a contour-cut outline.
- You may use photo-real imagery, gradients, soft shading, drop shadows, glows, halftones, painted textures, and unlimited colors.
- Multi-color illustrations, photographic detail, layered transparency, color blends — all valid.
- If the customer requests a printable specialty substrate (mirror chrome print film like Arlon DPF 6000XRP, brushed-metallic print, holographic, glitter, glow-in-dark), render the visual effect of that substrate showing through the print.
- Treat the artwork like a printed magazine spread that happens to be contour-cut to shape. Be bold with color and composition.`
    : `PRODUCTION METHOD — MANUFACTURE FILM CUT (strict material constraint):
- This graphic is PLOTTER-CUT from sheets of manufactured cast vinyl film (Avery SW900, 3M 1080, Oracal 970, Avery 950SF, Hexis HX20000). Each color is a SEPARATE layer of solid film stacked on the surface.
- Use FLAT SOLID COLORS only — one Pantone-equivalent color per layer. NO gradients. NO photo-real imagery. NO soft shading or drop shadows. NO halftones.
- Limit the design to 2–4 film layers maximum. Each layer is one color the installer weeds and applies separately.
- If the customer requests a SPECIALTY FILM, render the real manufactured material exactly as it looks: chrome (Avery Chrome SF, 3M 1080 Chrome — mirror specular), brushed metallic (Avery Brushed, 3M 1080-BR), color-shift (Avery ColorFlow, 3M Gloss Flip), carbon fiber (3M 2080-CF), matte black (3M 1080-M12), fluorescent (Oracal 6510), satin, textured leather, etc. These are real catalog SKUs — render their physical material appearance, not a printed approximation.
- Edges must be plotter-cuttable: no hairline strokes thinner than ~1/8 inch, no isolated tiny detail that would not weed cleanly.
- Show the layered-vinyl look: visible registration between layers, very slight thickness at each color edge.
- This is NOT printed artwork. It is layered manufactured film. Composition follows from what real film can physically do.`;

  // ── Window / Storefront branch ─────────────────────────────────
  // Storefronts are notoriously hard for human designers (perspective,
  // glass reflection, day/night, see-through perforated vs cut vs frosted)
  // and exactly the case where AI can crush it — IF the prompt is specific.
  // Generic "at night" gives you "moody dusk." We spell out time of day,
  // light source, sky, atmospheric detail, and saturation explicitly.
  if (isGlass) {
    const photoNote = p.hasUserPhoto
      ? "The uploaded photo shows the ACTUAL storefront. Apply the graphic onto this exact glass. Keep the building, sidewalk, and surroundings recognizable. Correct any perspective distortion in the source photo so the graphic sits flat on the glass plane."
      : "";

    // Vinyl style description — drives how light passes through the glass.
    const finishGlassMap: Record<string, string> = {
      glossy: "high-gloss cut vinyl applied to the exterior of the glass, opaque solid colors with mirror-like sheen",
      matte: "matte cut vinyl, opaque solid colors with zero glare from the glass",
      satin: "satin semi-gloss cut vinyl, soft directional sheen on the glass",
      reflective: substrate === 'printed'
        ? "PRINTED REFLECTIVE WRAP on glass (3M Scotchlite Print Wrap film 780mC or Avery RR1100 substrate). Full-color printed graphics on a reflective base layer. The printed colors stay vibrant during the day; at night the substrate glows back at light sources while the printed colors remain readable."
        : "CUT REFLECTIVE VINYL on glass (3M Scotchlite cut sheet or Oracal 5750 RA). Solid-color plotter-cut letters and shapes. Daytime: looks like normal opaque vinyl. Headlight illumination at night: the cut letters glow back as bright high-visibility shapes.",
    };
    const finishGlassDesc = finishGlassMap[p.vinylFinish] || finishGlassMap.glossy;

    // Render-mode block — the heaviest lift in the prompt.
    let lightingBlock = "";
    if (renderMode === 'night') {
      lightingBlock = `LIGHTING & ATMOSPHERE — REALISTIC NIGHTTIME (CRITICAL):
- Time of day: 9:00 PM. Sky is fully DARK (deep navy to black, no sun, no orange dusk glow).
- Primary light source: warm interior store lights spilling outward through the storefront windows, casting a soft yellow-orange wash on the sidewalk.
- Secondary light: a streetlight a few feet away providing rim light on the storefront edges and a slight specular highlight on the glass.
- Sidewalk: visible, slightly wet (recent light rain) so streetlight reflects faintly on the pavement — adds depth and convinces the viewer this is a real night photo.
- The vinyl graphic colors stay SATURATED and READABLE — do NOT desaturate the design. Light hitting the vinyl surface remains true to brand colors.
- Subtle storefront window reflection: a hint of streetlight or a parked car visible in the glass, but the graphic remains the dominant visible element.
- Avoid: bright skies, daytime light leak, sun rays, fake-looking moon, neon overload. This is a real photograph at night.`;
    } else if (renderMode === 'headlights') {
      lightingBlock = `LIGHTING & ATMOSPHERE — REFLECTIVE HEADLIGHT DEMO (CRITICAL):
- Time of day: 9:00 PM. Sky is fully DARK (deep navy to black). Streetlights are off or very dim so the reflective vinyl is the dominant light source.
- Primary light source: a SIMULATED CAR HEADLIGHT BEAM hitting the storefront from the foreground at a slight downward angle (camera height ~5 feet, beam axis hitting the graphic centered).
- The reflective vinyl graphic GLOWS BRIGHTLY back at the camera — this is the entire point of reflective film. ${substrate === 'printed' ? "Because it's a PRINTED reflective wrap, the printed COLORS remain visible on the glowing graphic — viewer sees the actual design in vivid color, with a halo of bright reflected light around the edges and a subtle sparkle from the embedded glass beads in the substrate." : "Because it's CUT reflective vinyl, the cut letters and shapes glow back as bright SOLID white-yellow shapes — like they're internally lit. The vinyl color shifts toward white-cyan under the headlight (real reflective behavior). Background glass and store interior are MUCH darker than the glowing vinyl."}
- The unreflective surfaces (storefront frame, sidewalk, building beyond the beam) are mostly DARK — only ambient streetlight catches them faintly.
- Subtle visible: small specular sparkles on the reflective film mimicking the glass-bead structure of real reflective vinyl.
- Avoid: glowing the entire storefront uniformly, generic bloom effects, disco-ball look. The glow is sharply focused on the vinyl graphic, everything else stays night-dark.
- This mockup is a SAFETY/VISIBILITY DEMO for emergency vehicle, fleet, school bus, construction, or tow truck customers. The "wow" comes from the contrast of bright glowing graphic against the dark background.`;
    } else {
      lightingBlock = `LIGHTING & ATMOSPHERE — DAYLIGHT:
- Time of day: midday to early afternoon. Bright natural daylight, soft shadows.
- Sun is overhead-left, casting a soft directional shadow consistent with the storefront geometry.
- Sky visible above the storefront if the framing includes it: pale blue with a few light clouds.
- Subtle reflection on the glass: a hint of the sidewalk and any parked car opposite, but the graphic remains the dominant visible element.
- The vinyl colors are saturated and clearly readable, no glare washing them out.
- Sidewalk and exterior look natural — no harsh contrast, no time-of-day ambiguity.`;
    }

    return `You are a top-tier storefront and architectural-glass graphics designer. Your work appears on retail flagships, restaurant fronts, dealership showrooms, and corporate offices. You handle perspective, glass, and light better than human designers because you actually understand how vinyl interacts with glass and how light behaves through transparent surfaces.

SURFACE: storefront window / architectural glass
${photoNote}

VINYL FINISH: ${finishGlassDesc}

${substrateDirective}

${graphicDesc}

${lightingBlock}

GLASS GRAPHIC EXECUTION — CRITICAL:
- The graphic is applied to the EXTERIOR face of the glass (most common storefront install).
- Show the glass surface itself: subtle thickness, slight reflectivity, mullions/dividers if present.
- Mullions, frames, and dividers MUST be respected — the graphic breaks at the frame edge, never paints over hardware.
- ${p.vinylFinish === 'reflective' ? 'For reflective vinyl, light interaction is the entire point — see the lighting block above.' : 'Show realistic vinyl edges (~3-4 mil thickness) where the cut/printed graphic meets the glass.'}
- If the storefront is dimensional (rounded corner, multiple panes, awning), the graphic respects each plane individually — no warp across separate glass panes.
- Slight sub-millimeter thickness shadow under the vinyl edges proves it's a real installation, not a digital paint-over.

CAMERA & FRAMING:
- Shot from sidewalk-level perspective (camera height ~5 feet) angled slightly upward and across — the natural angle a passing customer sees the storefront from.
- Show the FULL storefront window with surrounding architecture (door, brick, signage above) for context and scale.
- Include sidewalk in the foreground — minimum 4-6 feet of pavement visible — so the viewer feels like they're standing across from the shop.
- Aspect ratio is 16:9 landscape.

DESIGN COHESION:
- Typography readable from across a 2-lane street (about 30 feet).
- ${renderMode === 'headlights' ? 'For the headlight demo, the design should be SIMPLE and BOLD — chunky letterforms work best. Reflective vinyl glows back hardest with broad shapes, not thin strokes.' : 'Letter weight chosen for daylight legibility on glass — avoid hairline strokes that disappear at distance.'}

OUTPUT: Photorealistic photograph of the storefront vinyl installation taken at the time of day described above. No watermarks, no text overlays, no digital artifacts. This should look like it was shot for a glass-graphics portfolio that closes high-end retail clients.`;
  }

  // Wall-specific prompt — large-format printed wall wraps/murals
  if (isWall) {
    const photoNote = p.hasUserPhoto
      ? "The uploaded photo shows the ACTUAL wall. Apply the graphic ONTO this exact wall. Keep the room, furniture, and surroundings visible."
      : "";

    return `You are a top-tier environmental graphics designer who creates premium wall wraps, wall murals, and large-format printed graphics for commercial spaces. Your work appears in retail stores, gyms, offices, restaurants, and corporate lobbies.

SURFACE: ${surfaceLabel}
${photoNote}

${substrateDirective}

${graphicDesc}

WALL WRAP EXECUTION — THIS IS CRITICAL:
- The graphic is a LARGE-FORMAT PRINTED wall wrap or contour-cut vinyl mural applied directly to the wall
- Show the graphic at REALISTIC SCALE on the wall — as a person standing in the room would see it
- The wall wrap should cover a significant portion of the wall but leave some wall visible around the edges
- Frame the shot from a comfortable viewing distance (6-10 feet back) so the full wall and surrounding space are visible
- Include floor, ceiling edges, and nearby objects to give SCALE CONTEXT — the viewer should understand this is a real room
- For photographic/lifestyle wraps: show the printed image with slight surface texture from the wall material showing through
- For contour-cut text/graphics: show clean die-cut vinyl letters and shapes applied to the wall with precise edges
- The design should look professionally installed — no bubbles, wrinkles, or misalignment

CREATIVE ELEVATION:
- Typography: bold, readable from across a room. Letter spacing and weight matter.
- Use MAXIMUM 2-3 colors for cut vinyl. Printed wraps can use full color.
- Every element should look like it was designed by a professional signage company.

${renderMode === 'night' ? `LIGHTING & ATMOSPHERE — NIGHT (CRITICAL):
- Time of day: evening / after-hours. Overhead room lighting dimmed; the primary light source is a warm accent or track light directed at the wall wrap.
- The wrap colors stay SATURATED and READABLE — do NOT desaturate. The light hits the wrap as a soft directional wash with realistic falloff into the shadows at the edges of the wall.
- Surrounding environment is darker than the wall — the wrap should be the brightest, most-readable element in the frame.
- Avoid: pitch-black voids, blown-out highlights, fake moonlight. This is a real after-hours photo of a lit-up wall graphic.\n` : ''}OUTPUT: Photorealistic photograph of the wall wrap installation, shot from a natural viewing distance. Show the full wall and surrounding environment. No watermarks, no text overlays. This should look like a professional installation photo for a portfolio.`;
  }

  return `You are a top-tier vehicle graphics designer who creates $3,000–$5,000 commercial vinyl packages for fleet clients. Your work appears in Sign & Digital Graphics magazine. You NEVER produce clipart, stock icons, or amateur-looking designs.

SURFACE: ${surfaceLabel}
VINYL: ${finishDesc}

${substrateDirective}

${graphicDesc}

CREATIVE ELEVATION — THIS IS CRITICAL:
- The customer describes WHAT they want. YOUR job is to make it look PROFESSIONAL.
- "hard hat icon" → DON'T render a literal clipart hard hat. Instead: abstract geometric construction silhouette, angular faceted shapes suggesting heavy equipment, or a bold monogram mark.
- "water drop" → DON'T render a generic teardrop. Instead: sleek negative-space water form, or fluid geometric curves that suggest flow.
- "lightning bolt" → DON'T render a cartoon zigzag. Instead: sharp angular power mark, dynamic energy symbol with depth.
- Every icon/symbol should look like it was designed by a $10,000 branding agency, not pulled from a free clipart site.
- Typography is 70% of the design. Letter spacing, weight, and hierarchy matter more than any icon.
- ${substrate === 'printed' ? 'Color is unlimited — use gradients, photo-real detail, and rich color blends if the design calls for it.' : 'Use MAXIMUM 2-3 film colors. Restraint is professional. More layers = harder to weed and apply.'}

${substrate === 'printed' ? `PRINT & CUT EXECUTION:
- The graphic is full-color digital print on cast vinyl with a contour-cut outline
- Show the printed graphic with crisp edges and rich color reproduction
- Slight thickness at the contour cut edge (~3-4 mil) where the vinyl meets the surface` : `CUT VINYL EXECUTION:
- Every element is a SEPARATE piece of plotter-cut manufactured film
- Show precise cut edges where each film layer meets the surface (~3-4 mil thickness)
- Clean plotter-cut precision on vehicle body contours, visible registration between layered colors`}

CAMERA & FRAMING:
- Show the FULL vehicle from a natural 3/4 front viewing angle at a comfortable distance
- The entire vehicle should be visible in frame — do NOT crop too close to a single panel
- Set in a clean professional photography studio: seamless light gray backdrop, dark charcoal floor, bright even studio lighting — matching the studio angle set. No outdoor scenery, street, sky, or parking lot.

DESIGN COHESION:
- All zones must feel like ONE unified design — same design language everywhere
- Visual hierarchy: business name dominates, contact info supports, icon accents
- Negative space is your friend — don't fill every inch

${renderMode === 'night' ? `LIGHTING & ATMOSPHERE — NIGHT (CRITICAL):
- Time of day: 9:00 PM. Sky is fully DARK (deep navy to black, no sun, no dusk glow).
- Primary light: warm streetlight or parking-lot lamp casting directional light across the vehicle from upper-front-left. Soft falloff into the shadows on the far side.
- Secondary: subtle ambient bounce from the wet/dry pavement and any nearby building lights. Headlights and tail lights of the vehicle itself are subtly visible (not blown-out beams — just lit).
- The vinyl wrap colors stay SATURATED and READABLE — do NOT desaturate the design. Light hitting the wrap remains true to brand colors. Glossy finishes show realistic specular highlights from the light source.
- Ground plane: slightly wet asphalt or concrete so streetlight reflects faintly, adding depth and selling the night photo.
- Avoid: bright daylight skies, sun rays, fake moonlight, neon overload. This is a real photograph taken at night.\n` : ''}OUTPUT: Photorealistic photograph of a premium vinyl installation. No watermarks, no text overlays, no digital artifacts. This should look like it was shot for a fleet graphics portfolio.`;
}

// ── Flat production prompt ─────────────────────────────────────────

function buildFlatPrompt(designPrompt: string, designStyle: string): string {
  return `You are a production file specialist for cut vinyl graphics.

TASK: Create the graphic design described below as a flat production-ready artwork.

DESIGN: ${designPrompt}
STYLE: ${designStyle}

REQUIREMENTS:
1. Solid white background — no texture, no gradient, no shadows
2. Graphic elements rendered completely flat — no perspective, no surface mapping
3. All design elements at full opacity with clean, crisp edges
4. No environmental effects — no shadows, reflections, lighting effects
5. Colors must be solid and print-accurate
6. Each separate design element should have clear spacing
7. Output at the highest resolution possible

This file will be used for vinyl cutting. Clean edges are critical.`;
}

// ── Gemini call helper ─────────────────────────────────────────────

async function callGeminiOnce(
  prompt: string,
  refImages: Array<{ mimeType: string; data: string }>,
  aspectRatio: string,
): Promise<{ imageBase64: string | null; imageMimeType: string; textResponse: string | null; finishReason: string | null; error: string | null }> {
  const apiKey = getGeminiKey();
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    { text: prompt },
  ];

  for (const img of refImages) {
    parts.push({ inlineData: img });
  }

  let response: Response;
  try {
    response = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
          imageConfig: { aspectRatio, imageSize: "4K" },
        },
      }),
      signal: AbortSignal.timeout(GEMINI_TIMEOUT),
    });
  } catch (err: any) {
    console.error("Gemini fetch error:", err?.message);
    return { imageBase64: null, imageMimeType: "image/png", textResponse: null, finishReason: null, error: `Gemini timeout or network error: ${err?.message}` };
  }

  if (!response.ok) {
    const errText = await response.text();
    console.error("Gemini API error:", response.status, errText);
    return { imageBase64: null, imageMimeType: "image/png", textResponse: null, finishReason: null, error: `Gemini API error ${response.status}` };
  }

  const result = await response.json();
  const candidate = result.candidates?.[0];
  const responseParts = candidate?.content?.parts;
  const finishReason: string | null = candidate?.finishReason || null;

  let imageBase64: string | null = null;
  let imageMimeType = "image/png";
  let textResponse: string | null = null;

  if (responseParts && Array.isArray(responseParts)) {
    for (const part of responseParts) {
      if (part.inlineData) {
        imageBase64 = part.inlineData.data;
        imageMimeType = part.inlineData.mimeType || "image/png";
      }
      if (part.text) {
        textResponse = part.text;
      }
    }
  }

  return { imageBase64, imageMimeType, textResponse, finishReason, error: null };
}

// Trim a long prompt to its first N chars at a sentence/line boundary so the
// NO_IMAGE retry fits well under Gemini's quality cliff (~6,000 chars).
function shortenPrompt(prompt: string, maxLen = 2000): string {
  if (prompt.length <= maxLen) return prompt;
  const slice = prompt.slice(0, maxLen);
  const cut = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf(". "));
  return cut > maxLen * 0.6 ? slice.slice(0, cut + 1) : slice;
}

async function callGemini(
  prompt: string,
  refImages: Array<{ mimeType: string; data: string }>,
  aspectRatio: string = "16:9",
): Promise<{ imageBase64: string | null; imageMimeType: string; textResponse: string | null; error: string | null }> {
  const first = await callGeminiOnce(prompt, refImages, aspectRatio);
  if (first.imageBase64 || first.error) {
    return { imageBase64: first.imageBase64, imageMimeType: first.imageMimeType, textResponse: first.textResponse, error: first.error };
  }

  // finishReason === "NO_IMAGE" means Gemini chose text over image — not a
  // safety refusal. Retry once with a shortened prompt before failing.
  if (first.finishReason === "NO_IMAGE") {
    console.warn(`[callGemini] NO_IMAGE on first attempt (prompt ${prompt.length} chars). Retrying with shortened prompt.`);
    const retry = await callGeminiOnce(shortenPrompt(prompt), refImages, aspectRatio);
    if (retry.imageBase64) {
      return { imageBase64: retry.imageBase64, imageMimeType: retry.imageMimeType, textResponse: retry.textResponse, error: null };
    }
    return {
      imageBase64: null,
      imageMimeType: "image/png",
      textResponse: retry.textResponse ?? first.textResponse,
      error: retry.error || `Gemini returned no image (finishReason=${retry.finishReason || "NO_IMAGE"})`,
    };
  }

  return {
    imageBase64: null,
    imageMimeType: "image/png",
    textResponse: first.textResponse,
    error: `Gemini returned no image (finishReason=${first.finishReason || "unknown"})`,
  };
}

// ── Image fetch helper ─────────────────────────────────────────────

// Reference photos (uploaded surface shots, vision-board examples, logos) come
// straight off the customer's phone — often 12–20MP / 10–20MB each. The worker
// base64-encodes EVERY reference into memory at once and then renders a 4K
// output, so a few full-res photos blow past the 256MB Deno worker limit and
// the worker dies with a bodyless non-2xx ("edge fail"). Route Supabase storage
// URLs through the server-side image transform so they arrive pre-downscaled —
// Gemini's effective input ceiling is ~1568px anyway, so this costs no quality.
function boundStorageImage(url: string, maxWidth = 1600): string {
  try {
    if (!url.includes("/storage/v1/object/public/")) return url; // external/non-storage — leave as-is
    if (url.includes("/render/image/")) return url;               // already a transform URL
    const transformed = url.replace("/storage/v1/object/public/", "/storage/v1/render/image/public/");
    // quality 92 (not 80): the references drive DESIGN fidelity, and aggressive
    // JPEG compression bands smooth gradients and softens crisp patterns (e.g.
    // star fields read as blurry dots), which the model then faithfully copies.
    // width 1600 already bounds memory well under the worker limit.
    return `${transformed}${transformed.includes("?") ? "&" : "?"}width=${maxWidth}&resize=contain&quality=92`;
  } catch {
    return url;
  }
}

async function fetchImageAsBase64(url: string): Promise<{ mimeType: string; data: string } | null> {
  try {
    const bounded = boundStorageImage(url);
    let resp = await fetch(bounded, {
      headers: { "User-Agent": "Deno/1.0" },
      signal: AbortSignal.timeout(15_000),
    });
    // If the project doesn't have image transforms enabled the transform URL
    // 4xx's — fall back to the original so we never silently drop a reference
    // (especially the surface photo the mockup is built on).
    if (!resp.ok && bounded !== url) {
      resp = await fetch(url, {
        headers: { "User-Agent": "Deno/1.0" },
        signal: AbortSignal.timeout(15_000),
      });
    }
    if (!resp.ok) return null;

    const contentType = resp.headers.get("content-type") || "image/jpeg";
    const buffer = await resp.arrayBuffer();
    const uint8 = new Uint8Array(buffer);

    let binaryString = "";
    const chunkSize = 8192;
    for (let i = 0; i < uint8.length; i += chunkSize) {
      const chunk = uint8.subarray(i, Math.min(i + chunkSize, uint8.length));
      binaryString += String.fromCharCode.apply(null, Array.from(chunk));
    }

    return { mimeType: contentType, data: btoa(binaryString) };
  } catch (err) {
    console.warn("Image fetch failed:", err);
    return null;
  }
}

// ── Upload image to storage ────────────────────────────────────────

async function uploadImage(
  supabase: any,
  base64: string,
  mimeType: string,
  userId: string,
  subfolder: string
): Promise<string | null> {
  const binaryString = atob(base64);
  const imageData = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    imageData[i] = binaryString.charCodeAt(i);
  }

  const ext = mimeType.includes("png") ? "png" : "jpg";
  const fileName = `renders/${userId}/GraphicsProV1/${subfolder}/${Date.now()}_vinyl.${ext}`;

  const { error } = await supabase.storage
    .from("wrap-files")
    .upload(fileName, imageData, { contentType: mimeType, upsert: true });

  if (error) {
    console.error("Storage upload error:", error);
    return null;
  }

  const { data: { publicUrl } } = supabase.storage.from("wrap-files").getPublicUrl(fileName);
  return publicUrl;
}

// ── Main handler ───────────────────────────────────────────────────
// Uses built-in Deno.serve (no remote http/server import) so boot can't
// hang on a stale deno.land/std fetch. Previously a 150s OPTIONS preflight
// 504 was happening because the worker stalled before the handler ran.

Deno.serve(async (req) => {
  // CORS preflight must answer immediately, before any auth / import work
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    if (!hasGeminiKey()) {
      return new Response(
        JSON.stringify({ error: "No GOOGLE_AI_API_KEY configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const { action } = body;

    // Auth
    const authHeader = req.headers.get("authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    let userId: string | null = null;
    let userEmailFromAuth: string | null = null;
    if (authHeader) {
      const authClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await authClient.auth.getUser();
      userId = user?.id || null;
      userEmailFromAuth = user?.email ?? null;
    }
    const reqStart = Date.now();

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // ─── ACTION: generate_logo ──────────────────────────────────
    if (action === "generate_logo") {
      const { businessName, businessIndustry, businessTagline } = body;

      console.log(`[generate_logo] Generating logo for: ${businessName}`);

      const logoPrompt = `Create a professional business logo for "${businessName}".${businessIndustry ? ` Industry: ${businessIndustry}.` : ""}${businessTagline ? ` Tagline: "${businessTagline}".` : ""}

REQUIREMENTS:
- Clean, modern, professional logo design
- Simple enough to work as cut vinyl (no gradients, no fine details that won't cut well)
- Bold, recognizable silhouette or icon that represents the business
- Solid colors only — maximum 3 colors
- No text in the logo — just the icon/symbol
- Transparent or solid white background
- Vector-style clean edges suitable for vinyl cutting
- Professional quality, like a real brand logo`;

      const logoResult = await callGemini(logoPrompt, [], "1:1");

      if (logoResult.error || !logoResult.imageBase64) {
        return new Response(
          JSON.stringify({ error: logoResult.error || "Failed to generate logo" }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const logoUrl = await uploadImage(supabase, logoResult.imageBase64, logoResult.imageMimeType, userId!, "logos");
      if (!logoUrl) {
        return new Response(
          JSON.stringify({ error: "Failed to save logo" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({ logoUrl }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ─── ACTION: lookup_dimensions ─────────────────────────────
    // Google Search fallback (same as DesignPro panelizer-step-validate).
    // Uses Gemini + google_search tool to find real vehicle specs online.
    if (action === "lookup_dimensions") {
      const { make, model, year, area } = body;
      const yearStr = year ? `${year} ` : "";
      const vehicleName = `${yearStr}${make} ${model}`.trim();

      console.log(`[lookup_dimensions] Searching Google for: ${vehicleName}`);

      const searchKey = getGeminiKey();
      const searchResp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${searchKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{
              role: "user",
              parts: [{
                text: `Look up the real vehicle specifications for a ${vehicleName}. I need ACTUAL measurements from manufacturer specs or trusted automotive sources (edmunds.com, caranddriver.com, motortrend.com, manufacturer websites).

Find these measurements and convert all to INCHES:
- Wheelbase
- Overall length
- Overall width (without mirrors)
- Overall height
- Cargo/bed length (if truck)

Then CALCULATE these vinyl wrap panel dimensions using the formulas:
- sideWidth = overall length minus front/rear overhang (approximately wheelbase × 1.45)
- sideHeight = overall height minus ground clearance minus roof rail height (typically overall height × 0.55 to 0.65)
- hoodWidth = overall width × 0.85
- hoodLength = front overhang (overall length - wheelbase - rear overhang, typically 35-45 inches)
- roofWidth = overall width × 0.80
- roofLength = wheelbase × 0.60
- backWidth = overall width × 0.85
- backHeight = overall height × 0.45

Return ONLY valid JSON, no markdown, no explanation:
{
  "wheelbase": <inches>,
  "overallLength": <inches>,
  "overallWidth": <inches>,
  "overallHeight": <inches>,
  "sideWidth": <calculated panel width in inches>,
  "sideHeight": <calculated panel height in inches>,
  "hoodWidth": <inches>,
  "hoodLength": <inches>,
  "roofWidth": <inches>,
  "roofLength": <inches>,
  "backWidth": <inches>,
  "backHeight": <inches>,
  "totalSqFt": <total wrap coverage both sides + hood + roof + rear in square feet>
}`,
              }],
            }],
            tools: [{ google_search: {} }],
          }),
          signal: AbortSignal.timeout(30_000),
        },
      );

      if (!searchResp.ok) {
        console.warn(`[lookup_dimensions] Google Search API error: ${searchResp.status}`);
        return new Response(
          JSON.stringify({ error: "Google Search failed", found: false }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const searchResult = await searchResp.json();
      const rawText = searchResult?.candidates?.[0]?.content?.parts
        ?.filter((p: any) => p.text)
        ?.map((p: any) => p.text)
        ?.join("") || "";

      try {
        const clean = rawText.replace(/```json?\s*/g, "").replace(/```/g, "").trim();
        const parsed = JSON.parse(clean);

        const sideW = Number(parsed.sideWidth);
        const sideH = Number(parsed.sideHeight);

        // Sanity checks — reject obviously wrong data
        if (!sideW || !sideH || sideW < 80 || sideW > 350 || sideH < 25 || sideH > 120) {
          console.warn(`[lookup_dimensions] Dims out of range: side ${sideW}"×${sideH}" — rejecting`);
          return new Response(
            JSON.stringify({ error: "Dimensions out of range", found: false }),
            { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        // Ensure width > height for side panels
        const finalSideW = Math.max(sideW, sideH);
        const finalSideH = Math.min(sideW, sideH);

        // Map area to the right dimensions
        let w = 0, h = 0;
        if (area === "door" || area === "side-panel") {
          w = Math.round(area === "door" ? finalSideW * 0.5 : finalSideW);
          h = Math.round(finalSideH);
        } else if (area === "hood") {
          w = Math.round(Number(parsed.hoodWidth) || finalSideW * 0.37);
          h = Math.round(Number(parsed.hoodLength) || 38);
        } else if (area === "tailgate") {
          w = Math.round(Number(parsed.backWidth) || 66);
          h = Math.round(Number(parsed.backHeight) || 42);
        } else if (area === "rear-window") {
          w = Math.round(Number(parsed.backWidth) || 66);
          h = Math.round(Number(parsed.backHeight) || 42);
        }

        console.log(`[lookup_dimensions] Found: ${vehicleName} ${area} → ${w}"×${h}" (source: google_search)`);

        return new Response(
          JSON.stringify({
            found: true,
            source: "google_search",
            widthInches: w,
            heightInches: h,
            allDimensions: {
              sideWidth: Math.round(finalSideW),
              sideHeight: Math.round(finalSideH),
              hoodWidth: Math.round(Number(parsed.hoodWidth) || finalSideW * 0.37),
              hoodLength: Math.round(Number(parsed.hoodLength) || 38),
              roofWidth: Math.round(Number(parsed.roofWidth) || finalSideW * 0.35),
              roofLength: Math.round(Number(parsed.roofLength) || 66),
              backWidth: Math.round(Number(parsed.backWidth) || 66),
              backHeight: Math.round(Number(parsed.backHeight) || 42),
              totalSqFt: Math.round(Number(parsed.totalSqFt) || 0),
            },
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      } catch (parseErr) {
        console.warn(`[lookup_dimensions] Parse error: ${parseErr}`);
        return new Response(
          JSON.stringify({ error: "Failed to parse search results", found: false }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // ─── ACTION: create_logo_job ─────────────────────────────────
    // Utility flow: user uploads a logo, we create a job record with the
    // logo as the flat production artwork and skip the mockup step.
    // Frontend will then invoke run_production to generate cutpath files.
    if (action === "create_logo_job") {
      const { logoUrl, logoTargetWidth, logoTargetHeight, logoRecreatePrompt } = body;

      if (!logoUrl) {
        return new Response(
          JSON.stringify({ error: "logoUrl required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`[create_logo_job] Creating job for logo: ${logoUrl}`);

      const { data: job, error: jobError } = await supabase
        .from("graphics_pro_jobs")
        .insert({
          user_id: userId,
          mode: "logo",
          surface_type: null,  // logo utility has no surface — column is nullable
          design_prompt: logoRecreatePrompt || "Logo recreation — cutpath utility",
          mockup_render_url: logoUrl,
          flat_production_url: logoUrl,
          status: "approved",
        })
        .select("id")
        .single();

      if (jobError || !job?.id) {
        console.error("[create_logo_job] Insert error:", jobError);
        return new Response(
          JSON.stringify({ error: jobError?.message || "Failed to create job" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          jobId: job.id,
          logoUrl,
          targetWidth: logoTargetWidth || 0,
          targetHeight: logoTargetHeight || 0,
          success: true,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── ACTION: generate_surface ────────────────────────────────
    if (action === "generate_surface") {
      const { surfaceParams } = body;
      const prompt = buildSurfacePrompt(surfaceParams);
      console.log("[generate_surface] Prompt:", prompt);

      const { imageBase64, imageMimeType, error } = await callGemini(prompt, [], "16:9");
      if (error || !imageBase64) {
        return new Response(
          JSON.stringify({ error: error || "No image generated" }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const publicUrl = await uploadImage(supabase, imageBase64, imageMimeType, userId, "surfaces");
      if (!publicUrl) {
        return new Response(
          JSON.stringify({ error: "Failed to save surface image" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      await emitRenderEvent({
        userId,
        email: userEmailFromAuth,
        tool: "graphicspro",
        mode: "generate_surface",
        geminiModel: GEMINI_MODEL,
        geminiFinishReason: "STOP",
        vehicleYear: surfaceParams?.year || null,
        vehicleMake: surfaceParams?.make || null,
        vehicleModel: surfaceParams?.model || null,
        viewType: surfaceParams?.area || null,
        enhancedPrompt: prompt,
        renderUrl: publicUrl,
        success: true,
        latencyMs: Date.now() - reqStart,
      });

      return new Response(
        JSON.stringify({ surfaceUrl: publicUrl, success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── ACTION: generate_mockup ─────────────────────────────────
    if (action === "generate_mockup") {
      const {
        surfaceImageUrl,
        surfaceType,
        surfaceTexture,
        vinylFinish,
        graphicMode,
        vehicleYear,
        vehicleMake,
        vehicleModel,
        designPrompt,
        designStyle,
        businessName,
        businessPhone,
        businessWebsite,
        businessIndustry,
        businessTagline,
        businessFont,
        businessCopyText,
        restylePrompt,
        uploadedArtworkUrls,
        businessLogoUrl,
        generateLogo,
        restyleSourceUrl,
        logoSourceUrl,
        logoRecreatePrompt,
        visionBoardUrls,
        visionBoardIntent,
        vinylZones,
        hasUserPhoto,
        renderMode,
        vinylSubstrate,
        surfaceImageWithZonesUrl,
      } = body;

      // Collect URLs first (needed for prompt building)
      const artworkUrls = uploadedArtworkUrls || [];
      const vbUrls = visionBoardUrls || [];

      // CLONE-INTENT DETECTION — if the customer uploaded a reference design
      // AND asked (in plain English) to match/clone/recreate it, reproduce that
      // EXACT design instead of inventing a new one. This makes GraphicsPro act
      // like RecreatePro on request. Only triggers when a reference image is
      // actually present, so normal "create a design" prompts are unaffected.
      const hasReferenceArtwork = artworkUrls.length > 0 || vbUrls.length > 0 || !!restyleSourceUrl;
      const cloneIntentText = `${designPrompt || ""} ${restylePrompt || ""} ${businessCopyText || ""}`;
      const cloneIntentRe = /\b(match|clone|copy|recreate|reproduce|replicate|duplicate|identical|same\s+(as|design)|exact(ly)?\s+(like|the same|match))\b/i;
      const cloneReference =
        hasReferenceArtwork &&
        (visionBoardIntent === "exact_reference" || cloneIntentRe.test(cloneIntentText));
      if (cloneReference) console.log("[generate_mockup] CLONE intent detected — reproducing the attached design");

      let prompt = buildMockupPrompt({
        surfaceType,
        surfaceTexture,
        vinylFinish,
        graphicMode,
        cloneReference,
        designPrompt,
        designStyle,
        businessName,
        businessPhone,
        businessWebsite,
        businessIndustry,
        businessTagline,
        businessFont,
        businessCopyText,
        restylePrompt: graphicMode === "logo" ? logoRecreatePrompt : restylePrompt,
        generateLogo,
        logoRecreatePrompt,
        hasUserPhoto: !!hasUserPhoto,
        renderMode,
        vinylSubstrate,
      });

      // Append VisionBoardIQ instruction if reference images provided
      if (vbUrls.length > 0) {
        const intentText = visionBoardIntent === "exact_reference"
          ? "VISIONBOARD (EXACT REFERENCE): Incorporate the specific elements, colors, layout, and design language from the uploaded reference images into this graphic."
          : "VISIONBOARD (STYLE INSPIRATION): Use the mood, color palette, and artistic style from the uploaded reference images as creative inspiration for this graphic.";
        prompt += `\n\n${intentText}`;
      }

      // Vinyl zone masking — translate zone pill selections into clear AI instructions
      const ZONE_CONTENT_MAP: Record<string, string> = {
        "logo + name": "Place the business LOGO and BUSINESS NAME prominently. Name should be the largest text element.",
        "phone + website": "Display PHONE NUMBER and WEBSITE URL clearly. Secondary text size, readable from 10 feet.",
        "website only": "Display WEBSITE URL large and centered. Single clean text element, easy to read at distance.",
        "logo only": "Place the business LOGO centered. No text — icon/symbol only, sized to fill the zone.",
        "tagline": "Display the TAGLINE or SLOGAN. Medium text, supporting the main brand message.",
        "full contact": "Display ALL contact info: phone, website, and any additional copy. Organized layout, clear hierarchy.",
        "license + certs": "Display LICENSE NUMBER and CERTIFICATIONS. Small professional text, builds trust.",
        "accent stripe": "Apply a DECORATIVE ACCENT — stripe, pinstripe, geometric element, or design flourish. No text.",
      };

      if (vinylZones && Array.isArray(vinylZones) && vinylZones.length > 0) {
        const zoneDescs = vinylZones.map((z: any, idx: number) => {
          const parts = [`- ${z.label || `Zone ${idx + 1}`}`];
          if (z.location) parts.push(`(${z.location})`);
          if (z.widthInches > 0 && z.heightInches > 0) parts.push(`[${z.widthInches}" × ${z.heightInches}"]`);
          // Bounding box as percentage of image (left/top/right/bottom)
          if (typeof z.x === "number" && typeof z.y === "number" && typeof z.width === "number" && typeof z.height === "number") {
            const x1 = Math.round(z.x);
            const y1 = Math.round(z.y);
            const x2 = Math.round(z.x + z.width);
            const y2 = Math.round(z.y + z.height);
            parts.push(`@bbox[x:${x1}%-${x2}%, y:${y1}%-${y2}%]`);
          }
          const contentInstruction = ZONE_CONTENT_MAP[z.designPrompt] || z.designPrompt;
          if (contentInstruction) parts.push(`→ ${contentInstruction}`);
          // Film color — Manufacture Film Cut mode lets the customer pin
          // each layer to a real vinyl SKU (Avery SW900-101, 3M 1080
          // Chrome, "Carbon Fiber Black", "Reflective Yellow", etc.).
          // Pass it through so Gemini renders the exact material for that
          // zone instead of guessing a color.
          if (z.filmColor && z.filmColor !== "__custom__") {
            parts.push(`→ Film: ${z.filmColor}`);
          }
          return parts.join(" ");
        }).join("\n");

        const overlayClause = surfaceImageWithZonesUrl
          ? `\n\nThe FIRST reference image is the surface photo with the customer's vinyl zones drawn on it as colored rectangles with cyan outlines and labels (Zone 1, Zone 2, …). Treat these rectangles as HARD MASKS. Graphics for each zone MUST be placed INSIDE its rectangle ONLY — matching the same shape, position, and size. Do NOT exceed the rectangle bounds, do NOT scale up beyond the rectangle, do NOT place anything outside any rectangle. In the FINAL rendered image, do NOT show the cyan outlines or labels — they are guidance only.`
          : "";

        // If any zone specifies a film color, add a brief reminder so the
        // AI treats "→ Film: …" as a hard material spec, not a hint. Only
        // matters in Manufacture Film Cut mode (Print & Cut has no layer
        // films), but harmless if the customer pre-picks colors and then
        // switches mode.
        const anyFilm = vinylZones.some((z: any) => z.filmColor && z.filmColor !== "__custom__");
        const filmClause = anyFilm
          ? `\n\nFILM COLORS — When a zone lists "→ Film: <name>", render that zone in the EXACT material named. Names like "Chrome (Mirror)", "Brushed Aluminum", "Carbon Fiber Black", "Holographic Silver", "Reflective Yellow", "Glow-in-the-Dark", or any specific catalog SKU (Avery SW900-xxx, 3M 1080-xxx, Oracal 970-xxx, Avery ColorFlow, Inozetek, Hexis) are REAL manufactured films — render their physical material appearance (specularity, sheen, weave, glow), not a flat approximation.`
          : "";

        prompt += `${overlayClause}${filmClause}\n\nZONE ASSIGNMENTS — Each zone gets SPECIFIC content within its EXACT bounding box. Follow these exactly:\n${zoneDescs}\n\nAreas NOT listed above stay clean — no graphics outside assigned zones.`;
      }

      console.log("[generate_mockup] Mode:", graphicMode, "Prompt length:", prompt.length);

      // Collect reference images
      const refImages: Array<{ mimeType: string; data: string }> = [];

      // Surface photo with zones burned in — MUST go first so Gemini reads
      // the cyan-outlined bounding boxes as its primary spatial reference.
      if (surfaceImageWithZonesUrl) {
        const overlayImg = await fetchImageAsBase64(surfaceImageWithZonesUrl);
        if (overlayImg) refImages.push(overlayImg);
      }

      // Surface photo (clean — for color/texture/lighting fidelity)
      if (surfaceImageUrl) {
        const surfImg = await fetchImageAsBase64(surfaceImageUrl);
        if (surfImg) refImages.push(surfImg);
      }

      // Artwork references
      for (const url of artworkUrls.slice(0, 3)) {
        const artImg = await fetchImageAsBase64(url);
        if (artImg) refImages.push(artImg);
      }

      // Business logo
      if (businessLogoUrl) {
        const logoImg = await fetchImageAsBase64(businessLogoUrl);
        if (logoImg) refImages.push(logoImg);
      }

      // Restyle source
      if (restyleSourceUrl) {
        const restyleImg = await fetchImageAsBase64(restyleSourceUrl);
        if (restyleImg) refImages.push(restyleImg);
      }

      // Logo source (logo recreation mode)
      if (logoSourceUrl) {
        const logoSrcImg = await fetchImageAsBase64(logoSourceUrl);
        if (logoSrcImg) refImages.push(logoSrcImg);
      }

      // VisionBoardIQ reference images
      for (const url of vbUrls.slice(0, 4)) {
        const vbImg = await fetchImageAsBase64(url);
        if (vbImg) refImages.push(vbImg);
      }

      const { imageBase64, imageMimeType, error } = await callGemini(prompt, refImages, "16:9");
      if (error || !imageBase64) {
        return new Response(
          JSON.stringify({ error: error || "No mockup image generated" }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const publicUrl = await uploadImage(supabase, imageBase64, imageMimeType, userId, "mockups");
      if (!publicUrl) {
        return new Response(
          JSON.stringify({ error: "Failed to save mockup image" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Create or update job record
      const { data: job, error: jobError } = await supabase
        .from("graphics_pro_jobs")
        .insert({
          user_id: userId,
          mode: graphicMode,
          // Persist the vehicle so the job isn't "Unknown Vehicle" in
          // RevisionStudio (and so downstream angle/proof steps have a vehicle
          // to work from). surface.year is a string; coerce to int for the column.
          vehicle_year: vehicleYear ? (Number(vehicleYear) || null) : null,
          vehicle_make: vehicleMake || null,
          vehicle_model: vehicleModel || null,
          surface_type: surfaceType,
          surface_texture: surfaceTexture,
          surface_image_url: surfaceImageUrl,
          surface_source: surfaceImageUrl ? "upload" : "generated",
          design_prompt: designPrompt,
          design_style: designStyle,
          business_name: businessName,
          business_phone: businessPhone,
          business_website: businessWebsite,
          business_industry: businessIndustry,
          business_tagline: businessTagline,
          business_logo_url: businessLogoUrl,
          uploaded_artwork_urls: artworkUrls.length > 0 ? artworkUrls : null,
          restyle_prompt: restylePrompt,
          vinyl_finish: vinylFinish,
          mockup_render_url: publicUrl,
          // Persist the zone data + cyan-outlined overlay so RevisionStudio
          // can show the customer what zones they drew alongside the render,
          // and so a revision can re-feed Gemini the exact same masks.
          vinyl_zones: vinylZones && vinylZones.length > 0 ? vinylZones : null,
          zone_overlay_url: surfaceImageWithZonesUrl || null,
          status: "mockup_ready",
        })
        .select("id")
        .single();

      if (jobError) {
        console.warn("Job insert error (non-fatal):", jobError.message);
      }

      await emitRenderEvent({
        userId,
        email: userEmailFromAuth,
        tool: "graphicspro",
        mode: "generate_mockup",
        geminiModel: GEMINI_MODEL,
        geminiFinishReason: "STOP",
        viewType: surfaceType || null,
        finish: vinylFinish || null,
        rawPrompt: designPrompt || null,
        enhancedPrompt: prompt,
        renderUrl: publicUrl,
        success: true,
        latencyMs: Date.now() - reqStart,
        sourceTable: "graphics_pro_jobs",
        sourceId: job?.id || null,
      });

      return new Response(
        JSON.stringify({
          mockupUrl: publicUrl,
          jobId: job?.id || null,
          success: true,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── ACTION: generate_flat ───────────────────────────────────
    if (action === "generate_flat") {
      const { designPrompt, designStyle, jobId } = body;

      const prompt = buildFlatPrompt(designPrompt || "", designStyle || "modern");
      console.log("[generate_flat] Prompt length:", prompt.length);

      const { imageBase64, imageMimeType, error } = await callGemini(prompt, [], "1:1");
      if (error || !imageBase64) {
        return new Response(
          JSON.stringify({ error: error || "No flat artwork generated" }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const publicUrl = await uploadImage(supabase, imageBase64, imageMimeType, userId, "flat-production");
      if (!publicUrl) {
        return new Response(
          JSON.stringify({ error: "Failed to save flat artwork" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Update job if provided
      if (jobId) {
        await supabase
          .from("graphics_pro_jobs")
          .update({ flat_production_url: publicUrl, status: "approved" })
          .eq("id", jobId);
      }

      await emitRenderEvent({
        userId,
        email: userEmailFromAuth,
        tool: "graphicspro",
        mode: "generate_flat",
        geminiModel: GEMINI_MODEL,
        geminiFinishReason: "STOP",
        rawPrompt: designPrompt || null,
        enhancedPrompt: prompt,
        renderUrl: publicUrl,
        success: true,
        latencyMs: Date.now() - reqStart,
        sourceTable: "graphics_pro_jobs",
        sourceId: jobId || null,
      });

      return new Response(
        JSON.stringify({ flatUrl: publicUrl, success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── ACTION: run_production ────────────────────────────────
    // REAL production pipeline using existing cut-map, generate-cut-files,
    // and quick-prep-pdf-export for 100% commercial cutter compatibility
    // (Roland, Graphtec, Summa, VersaWorks, Onyx, Caldera, Flexi, SAi, EFI Fiery)
    if (action === "run_production") {
      const { jobId, flatArtworkUrl, materialType = "avery", markupPercentage = 100, lineItems, surface, graphic } = body;

      if (!jobId || !flatArtworkUrl) {
        return new Response(
          JSON.stringify({ error: "jobId and flatArtworkUrl required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const updateJob = async (updates: Record<string, any>) => {
        // Surface write failures — a silently-failed update (e.g. an unmigrated
        // column, 42703) loses EVERY field in the batch, which is how jobs got
        // stuck "processing" with finished files nobody could see.
        const { error } = await supabase.from("graphics_pro_jobs").update(updates).eq("id", jobId);
        if (error) console.error(`[run_production] job update failed (${Object.keys(updates).join(", ")}): ${error.message}`);
      };

      try {
        // ── Stage 1: Upscale via ESRGAN ─────────────────────────
        await updateJob({ stage: "upscale", progress: 5, status: "processing" });
        console.log("[run_production] Stage 1: ESRGAN Upscale");

        let upscaledUrl = flatArtworkUrl;
        try {
          const imgResp = await fetch(flatArtworkUrl, { signal: AbortSignal.timeout(15_000) });
          if (imgResp.ok) {
            const imgBytes = new Uint8Array(await imgResp.arrayBuffer());
            const imgMime = imgResp.headers.get("content-type") || "image/png";

            const { upscaleImageBytes } = await import("../_shared/topaz-upscale.ts");
            const upscaleResult = await upscaleImageBytes(imgBytes, imgMime, supabase, {
              userId,
              scale: 2,
              passes: 1,
              label: "graphics-pro",
              timeoutMs: 90_000,
            });

            if (upscaleResult.upscaled) {
              const ext = imgMime.includes("png") ? "png" : "jpg";
              const upPath = `renders/${userId}/GraphicsProV1/upscaled/${Date.now()}.${ext}`;
              const { error: upErr } = await supabase.storage
                .from("wrap-files")
                .upload(upPath, upscaleResult.imageBytes, { contentType: imgMime, upsert: true });

              if (!upErr) {
                const { data: { publicUrl } } = supabase.storage.from("wrap-files").getPublicUrl(upPath);
                upscaledUrl = publicUrl;
              }
            }
          }
        } catch (upscaleErr) {
          console.warn("[run_production] Upscale failed (non-fatal):", upscaleErr);
        }

        await updateJob({ flat_production_url: upscaledUrl, progress: 20 });

        // ── Stage 2: CUT-MAP™ — Contour cut path ───────────────
        // Generates magenta #FF00FF CutContour spot color SVG
        // with 1/16" offset from edge (industry standard)
        await updateJob({ stage: "cut_paths", progress: 25 });
        console.log("[run_production] Stage 2: CUT-MAP™ contour cut path");

        let cutSvgUrl: string | null = null;
        let cutContourOverlayUrl: string | null = null;
        try {
          const cutResp = await supabase.functions.invoke("cut-map", {
            body: {
              user_id: userId,
              file_url: upscaledUrl,
              file_name: "graphics-pro-artwork.png",
              cut_mode: "contour",           // Silhouette cut around design
              offset_inches: 0.0625,         // 1/16" industry standard offset
              bleed_inches: 0.125,           // 1/8" bleed extension
            },
          });

          cutSvgUrl = cutResp.data?.svg_url || null;
          cutContourOverlayUrl = cutResp.data?.output_url || null;
          console.log(`[run_production] CUT-MAP: ${cutResp.data?.contour_points || 0} contour points, mode=${cutResp.data?.cut_mode}`);

          if (cutSvgUrl) {
            await updateJob({ cut_path_svg_url: cutSvgUrl, progress: 40 });
          }
        } catch (cutErr) {
          console.warn("[run_production] CUT-MAP failed (non-fatal):", cutErr);
        }

        // ── Stage 3: Generate Cut Files — Element extraction + vectorization ──
        // Uses Gemini to isolate text/logo elements → imagetracerjs vectorization
        // → SVG with 1/4" bleed + magenta dashed trim line → ZIP
        await updateJob({ stage: "cut_files", progress: 45 });
        console.log("[run_production] Stage 3: Generate cut files (element extraction + vectorization)");

        let cutFilesZipUrl: string | null = null;
        let extractedElementCount = 0;
        let vectorizedCount = 0;
        try {
          const vehicleYear = surface?.year || "";
          const vehicleMake = surface?.make || "";
          const vehicleModel = surface?.model || "";
          const designName = graphic?.designPrompt || graphic?.businessName || "GraphicsPro Design";

          const cutFilesResp = await supabase.functions.invoke("generate-cut-files", {
            body: {
              renderUrl: upscaledUrl,
              designName,
              vehicleYear,
              vehicleMake,
              vehicleModel,
              visualizationId: jobId,
            },
          });

          cutFilesZipUrl = cutFilesResp.data?.downloadUrl || null;
          extractedElementCount = cutFilesResp.data?.elementCount || 0;
          vectorizedCount = cutFilesResp.data?.vectorizedCount || 0;
          console.log(`[run_production] Cut files: ${extractedElementCount} elements, ${vectorizedCount} vectorized`);

          if (cutFilesZipUrl) {
            await updateJob({ cut_files_zip_url: cutFilesZipUrl, progress: 65 });
          }
        } catch (cutFilesErr) {
          console.warn("[run_production] Generate cut files failed (non-fatal):", cutFilesErr);
        }

        // ── Stage 4: Production PDF — RIP-compatible with CutContour layer ──
        // Embeds artwork + CutContour spot color layer in production PDF
        // Compatible with VersaWorks, Onyx, Caldera, Flexi, SAi, EFI Fiery
        await updateJob({ stage: "production_pdf", progress: 70 });
        console.log("[run_production] Stage 4: Production PDF export");

        let productionPdfUrl: string | null = null;
        try {
          // Use the cut SVG (which has CutContour layer) or fall back to upscaled PNG
          const pdfSourceUrl = cutSvgUrl || upscaledUrl;
          const pdfResp = await supabase.functions.invoke("quick-prep-pdf-export", {
            body: {
              user_id: userId,
              file_url: pdfSourceUrl,
              file_name: `GraphicsPro-${jobId}`,
            },
          });

          productionPdfUrl = pdfResp.data?.output_url || pdfResp.data?.file_url || null;
          const hasCutLayer = pdfResp.data?.has_cut_layer || false;
          console.log(`[run_production] Production PDF: ${hasCutLayer ? "with" : "without"} CutContour layer`);

          if (productionPdfUrl) {
            await updateJob({ cut_path_pdf_url: productionPdfUrl, progress: 80 });
          }
        } catch (pdfErr) {
          console.warn("[run_production] PDF export failed (non-fatal):", pdfErr);
        }

        // ── Stage 5: Pricing ────────────────────────────────────
        await updateJob({ stage: "pricing", progress: 85 });
        console.log("[run_production] Stage 5: Pricing");

        // Read pixel dimensions WITHOUT decoding. The old full Image.decode of
        // the upscaled (post-ESRGAN, 8K-class) artwork blew the edge worker's
        // memory limit — the isolate died mid-run, completion never executed,
        // and jobs hung at "processing 85%" forever (verified live). Header
        // parse only: PNG IHDR at byte 16, JPEG SOF marker scan; first 256KB.
        const PRODUCTION_DPI = 150;
        let nestedWidth = 0;
        let nestedHeight = 0;
        try {
          const dimResp = await fetch(upscaledUrl, { headers: { Range: "bytes=0-262143" }, signal: AbortSignal.timeout(15_000) });
          if (dimResp.ok || dimResp.status === 206) {
            const b = new Uint8Array(await dimResp.arrayBuffer());
            const be32 = (o: number) => (((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0);
            let pw = 0, ph = 0;
            if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
              pw = be32(16); ph = be32(20); // PNG IHDR
            } else if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
              let o = 2; // JPEG: scan SOF0-3/5-7/9-11/13-15
              while (o + 9 < b.length) {
                if (b[o] !== 0xff) { o++; continue; }
                const marker = b[o + 1];
                if (marker === 0xff) { o++; continue; }
                if (marker >= 0xd0 && marker <= 0xd9) { o += 2; continue; }
                const len = (b[o + 2] << 8) | b[o + 3];
                if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
                  ph = (b[o + 5] << 8) | b[o + 6]; pw = (b[o + 7] << 8) | b[o + 8];
                  break;
                }
                o += 2 + len;
              }
            }
            if (pw > 0 && ph > 0) {
              nestedWidth = Math.round((pw / PRODUCTION_DPI) * 100) / 100;
              nestedHeight = Math.round((ph / PRODUCTION_DPI) * 100) / 100;
              console.log(`[run_production] Image: ${pw}x${ph}px → ${nestedWidth}"x${nestedHeight}" at ${PRODUCTION_DPI} DPI (header parse, no decode)`);
            }
          }
        } catch (dimErr) {
          console.warn("[run_production] Dimension detection failed, using defaults:", dimErr);
        }

        // Look up pricing from DB (fall back to hardcoded if table doesn't exist yet)
        let wholesaleRate = materialType === "3m" ? 6.92 : 6.32;
        try {
          const matKey = materialType === "3m" ? "3m_cut_contour" : "avery_cut_contour";
          const { data: priceRow } = await supabase
            .from("graphics_pro_pricing")
            .select("wholesale_price_sqft")
            .eq("material_type", matKey)
            .single();
          if (priceRow?.wholesale_price_sqft) {
            wholesaleRate = Number(priceRow.wholesale_price_sqft);
          }
        } catch {
          // Use hardcoded fallback
        }

        // Look up shop markup
        let effectiveMarkup = markupPercentage;
        try {
          const { data: shopConfig } = await supabase
            .from("shop_pricing_config")
            .select("default_markup_percentage, minimum_order_price")
            .eq("user_id", userId)
            .single();
          if (shopConfig?.default_markup_percentage != null) {
            effectiveMarkup = Number(shopConfig.default_markup_percentage);
          }
        } catch {
          // Use passed-in markup
        }

        const LAMINATION_ADDER = 1.50; // $/sqft additional for lamination

        let totalSqft: number;
        let wholesalePrice: number;
        let retailPrice: number;

        if (lineItems && Array.isArray(lineItems) && lineItems.length > 0) {
          // Multi-line item pricing from frontend
          totalSqft = 0;
          wholesalePrice = 0;
          for (const item of lineItems) {
            const itemSqft = ((item.width || 0) * (item.height || 0)) / 144;
            const qty = Math.max(item.qty || 1, 1);
            const materialCost = itemSqft * wholesaleRate;
            const lamCost = item.laminated ? itemSqft * LAMINATION_ADDER : 0;
            totalSqft += itemSqft * qty;
            wholesalePrice += (materialCost + lamCost) * qty;
          }
          wholesalePrice = Math.max(wholesalePrice, 25);
          retailPrice = Math.max(wholesalePrice * (1 + effectiveMarkup / 100), 25);
        } else {
          // Single-item fallback from image dimensions
          totalSqft = (nestedWidth * nestedHeight) / 144;
          wholesalePrice = Math.max(totalSqft * wholesaleRate, 25);
          retailPrice = Math.max(wholesalePrice * (1 + effectiveMarkup / 100), 25);
        }

        await updateJob({
          nested_width_inches: nestedWidth,
          nested_height_inches: nestedHeight,
          total_sqft: totalSqft,
          material_type: materialType,
          wholesale_price: wholesalePrice,
          retail_price: retailPrice,
        });

        // Stage 6: Package & Complete
        await updateJob({ stage: "packaging", progress: 95 });
        console.log("[run_production] Stage 6: Package & Complete");

        // Extended file columns FIRST and on their own (best-effort — a missing
        // column must never poison the batch), THEN the status flip separately so
        // the job ALWAYS reaches complete. Bundling these was the bug: one
        // unmigrated column 42703'd the whole update and jobs hung "processing"
        // with finished files nobody could see.
        await updateJob({
          cut_files_zip_url: cutFilesZipUrl,
          cut_contour_overlay_url: cutContourOverlayUrl,
          extracted_element_count: extractedElementCount,
          vectorized_count: vectorizedCount,
        });
        await updateJob({
          stage: "complete",
          progress: 100,
          status: "complete",
        });

        // BUILD ASSETS PARITY — persist the production layers to the shared
        // per-side vault (production_flow_assets) keyed by this job id, the same
        // record DesignPro's Build Assets writes. RevisionStudio / Design Assets /
        // ProductionFlow surfaces then show GraphicsPro output the same way:
        // background = flat print artwork, branding = cut-contour overlay (a REAL
        // overlay here), final pack = the RIP-ready CutContour PDF. Non-fatal.
        let parityWarn: string | null = null;
        try {
          const dims: Record<string, number> = {};
          if (Number(nestedWidth) > 0) dims.w = Math.round(Number(nestedWidth) * 10) / 10;
          if (Number(nestedHeight) > 0) dims.h = Math.round(Number(nestedHeight) * 10) / 10;
          const { error: delErr } = await supabase.from("production_flow_assets").delete().eq("job_id", jobId).eq("version", "v1");
          if (delErr) parityWarn = `delete: ${delErr.message}`;
          const { error: pfaErr } = await supabase.from("production_flow_assets").insert({
            job_id: jobId,
            side: "GRAPHICS",
            version: "v1",
            dimensions_inches: dims,
            background_url: upscaledUrl || "",
            branding_url: cutContourOverlayUrl || upscaledUrl || "",
            depth_mask_url: "",
            final_pack_url: productionPdfUrl || "",
          });
          if (pfaErr) parityWarn = `insert: ${pfaErr.message}`;
        } catch (e) {
          parityWarn = `threw: ${e}`;
        }
        // Surfaced in the response so a silent vault miss is diagnosable
        // without log access; non-fatal to the job itself.
        if (parityWarn) console.warn(`[run_production] production_flow_assets persist failed — ${parityWarn}`);

        // Fetch final job data
        const { data: finalJob } = await supabase
          .from("graphics_pro_jobs")
          .select("*")
          .eq("id", jobId)
          .single();

        console.log("[run_production] ✅ COMPLETE — Production files ready");
        console.log(`  Print file:     ${upscaledUrl ? "✓" : "✗"}`);
        console.log(`  CutContour SVG: ${cutSvgUrl ? "✓" : "✗"}`);
        console.log(`  Cut files ZIP:  ${cutFilesZipUrl ? "✓" : "✗"} (${extractedElementCount} elements, ${vectorizedCount} vectorized)`);
        console.log(`  Production PDF: ${productionPdfUrl ? "✓" : "✗"}`);

        return new Response(
          JSON.stringify({
            success: true,
            job: finalJob,
            parityWarn,
            files: {
              mockup: finalJob?.mockup_render_url,
              flatProduction: upscaledUrl,
              cutPathSvg: cutSvgUrl,
              cutContourOverlay: cutContourOverlayUrl,
              cutFilesZip: cutFilesZipUrl,
              productionPdf: productionPdfUrl,
            },
            production: {
              extractedElements: extractedElementCount,
              vectorizedElements: vectorizedCount,
              cutMode: "contour",
              offsetInches: 0.0625,
              bleedInches: 0.125,
              spotColor: "CutContour (#FF00FF Magenta)",
              ripCompatible: ["VersaWorks", "Onyx", "Caldera", "Flexi", "SAi", "EFI Fiery"],
              cutterCompatible: ["Roland", "Graphtec", "Summa", "Mimaki"],
            },
            pricing: {
              material: materialType === "3m" ? "3M Cut Contour Vinyl Graphics" : "Avery Cut Contour Vinyl Graphics",
              nestedWidth,
              nestedHeight,
              totalSqft,
              wholesalePrice,
              retailPrice,
              lineItems: lineItems || null,
              includes: ["weeding", "masking", "cut paths", "print file", "production PDF", "install guide"],
            },
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

      } catch (prodErr: any) {
        console.error("[run_production] Pipeline error:", prodErr);
        await updateJob({ status: "failed", error_message: prodErr?.message });
        return new Response(
          JSON.stringify({ error: prodErr?.message || "Production pipeline failed" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    console.error("generate-graphics-pro error:", err);
    return new Response(
      JSON.stringify({ error: err?.message || "Unexpected failure" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
