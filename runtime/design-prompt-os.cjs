"use strict";

/**
 * Calls 1-7 DESIGN PROMPT CONTRACT.
 *
 * TRADE SECRET - CONFIDENTIAL. (c) LoopMighty Software Development LLC.
 *
 * The standalone had the frozen CAMERA contract (view-angles.cjs) but none of
 * the DESIGN contract that sits around it. `designBrief()` in the worker
 * assembled four descriptive lines and appended a camera angle, so every render
 * was an unstudioed, unbriefed, un-elevated image of a vehicle. The behaviours
 * ported here are the ones that decide what the wrap actually looks like, and
 * every one of them is live in restylepro-os today:
 *
 *   studio environment / lighting  <- _shared/studio-os.ts STUDIO_ENVIRONMENT
 *   wrap coverage rules            <- _shared/view-angles-os.ts WRAP_COVERAGE_RULES
 *   logo requirement               <- design-panel-ai-generate LOGO_REQUIREMENT
 *   photorealism gate              <- design-panel-ai-generate briefWantsPhoto
 *   depth / translation / judgment <- COMMERCIAL_DEPTH, COMMERCIAL_TRANSLATION,
 *                                     PROFESSIONAL_JUDGMENT, DESIGN AMPLIFICATION
 *   commercial vs restyle          <- design-panel-ai-generate mode branches
 *   VisionBoard grounding          <- visionBoardImages + visionboard_intent
 *   View 1 -> Views 2-7 contract   <- generate-color-render designpanelpro branch
 *
 * TWO PRODUCERS, ONE DESIGN. This is the architecture the source runs and the
 * thing the standalone was missing outright:
 *
 *   HERO (view 1, `side`)  ORIGINATES the design from the customer's brief.
 *   VIEWS 2-7              REPRODUCE that hero. They are still their own
 *                          generation - there is no mirror path, ever - but
 *                          they are conditioned on the hero image plus a
 *                          design-anchor description, and they are never asked
 *                          to invent. Independently invented views are seven
 *                          different wraps on one vehicle.
 *
 * PROMPT LENGTH IS A QUALITY CEILING. The source's hard-won lesson is that
 * Gemini image quality degrades with prompt bloat (~6,000 chars is the line).
 * Nothing here stacks blocks "for completeness": the elevation block is skipped
 * on reproduction views because they are not inventing, the studio text appears
 * once per prompt, and the anchor is bounded.
 *
 * DELIBERATE DIVERGENCES FROM THE SOURCE, RECORDED RATHER THAN INHERITED:
 *
 * 1. `WRAP_COVERAGE_RULES` is imported by design-panel-ai-generate and never
 *    used - the hero path's real coverage instruction is the one-line
 *    COVERAGE_LINE below. Only generate-color-render appends the full block.
 *    That split is ported as it actually runs, not as the imports imply.
 * 2. The source's secondary-view scene text is the RESTYLE wording ("No text,
 *    no logos, no branding") for every job, including commercial ones - so a
 *    commercial hood/roof is told to drop the branding the reference image
 *    plainly shows. Both scene texts exist in the source; this module selects
 *    the one matching the mode the HERO was designed under instead of
 *    hard-coding the restyle variant. No new wording was written.
 * 3. The source resizes the hero reference to 512px before attaching it - an
 *    edge-function memory workaround. This runtime is a Node worker with real
 *    memory, so the hero is attached at full resolution.
 */

const angles = require("./view-angles.cjs");

const PROMPT_CONTRACT = "designpro.calls-1-7-design-prompt.v1";

// The design anchor is a description, not a document.
//
// The source bounds it only by maxOutputTokens: 1024 - roughly 4,000 characters
// - and appends it to a prompt that is already ~5.4K. That lands a reproduction
// view near 9K, well past the point where this model's image quality falls off,
// and the source's own log line ("target <5000") shows it knows. The anchor is
// therefore asked for short and capped hard here: continuity needs the design
// described, not transcribed.
const MAX_ANCHOR_CHARS = 1200;

// PROMPT LENGTH CEILINGS, measured rather than aspirational.
//
// The source's lesson is that image quality degrades with prompt bloat - 15K
// once produced visibly blurry renders - and it puts the line at ~6,000 chars.
// The hero prompt clears that comfortably (~5.1K worst case here).
//
// A reproduction prompt cannot: it carries the full WRAP_COVERAGE_RULES block
// the hero path does not, plus the anchor. Trimming it under 6,000 would mean
// deleting ported behaviour. What was removed instead is everything the source
// says twice - the duplicated camera angle, the coverage one-liner under the
// coverage block, the placement line under the continuity lock - and the
// anchor is bounded. Net: the source's live reproduction prompt runs ~9-10K,
// this one runs ~6.1-6.8K. These constants freeze that so it cannot creep back.
const HERO_PROMPT_CHAR_CEILING = 6000;
const REPRODUCTION_PROMPT_CHAR_CEILING = 7000;

// ---------------------------------------------------------------------------
// STUDIO ENVIRONMENT - ported verbatim from _shared/studio-os.ts.
// The kernel. It never changes between camera angles; only the camera moves.
// Do not tune it here: it is the reason two views read as the same shoot.
// ---------------------------------------------------------------------------
const STUDIO_ENVIRONMENT = `
You are a professional automotive photographer shooting for a luxury car brand campaign.
Every shot is technically perfect — bright, clean, color-accurate, and photorealistic.
HIGH-END WRAP SHOP ENVIRONMENT:
- Premium automotive wrap installation studio
- The vehicle is the ONLY subject — nothing else in frame
- Even bright illumination across the full vehicle
- Wrap design is fully color-accurate — bright lighting enhances colors
- This studio is IDENTICAL in every camera angle — only the camera moves
FLOOR — DARK EPOXY WITH MIRROR REFLECTIONS:
- Dark charcoal epoxy floor (#1a1a1a to #2a2a2a) — high-gloss sealed finish
- Sharp, clear mirror reflection of the vehicle on the floor surface
- The wrap design and vehicle silhouette are visible in the floor reflection
- Reflection fades naturally with distance — sharp near the tires, soft at edges
- Clean, dust-free surface with professional shop finish
WALLS:
- Light cool gray walls (#d8d8d8 to #e8e8e8) — smooth with subtle concrete texture
- Neutral background that makes wrap colors pop
- Smooth natural gradient from dark floor up to lighter walls
LIGHTING — BRIGHT LINEAR LED STRIP LIGHTS:
- Overhead linear LED strip lights running the length of the studio
- Bright, clean, realistic specular highlight reflections on the body panels define every curve and make the vehicle look real and photographic
- Highlights fall on the clear-coat and metal so the vehicle still reads as real, while the printed wrap design stays crisp, color-accurate, and fully visible — no LED strip lines streak across or wash over the artwork
- White daylight-balanced LED lighting (5500K–6500K)
- Colors are vivid, accurate, and true-to-life
- The light fixtures are above frame and out of view — only their reflections visible
FRAMING:
- The vehicle is the ONLY subject — nothing else in frame
- Clean, uncluttered composition
- Canon EOS R5, 4K capture, studio editorial quality
`;

// ---------------------------------------------------------------------------
// WRAP COVERAGE RULES - ported verbatim from _shared/view-angles-os.ts.
// Live on the REPRODUCTION path only (see divergence 1). It is what keeps
// grille, glass, emblems and wheels factory on views the hero cannot show.
// ---------------------------------------------------------------------------
const WRAP_COVERAGE_RULES = `
WRAP COVERAGE — MANDATORY:
The vinyl wrap covers ONLY painted body panels. The following areas must remain UNWRAPPED and show their original factory appearance:
- Grille / front grille mesh — NOT wrapped, factory appearance
- Manufacturer emblems and badges (Ford, Chevy, RAM, etc.) — NOT wrapped, visible
- Windshield — NOT wrapped, clear glass
- Driver and passenger side windows — NOT wrapped, clear glass
- Rear window — NOT wrapped, clear glass
- Headlights and taillights — NOT wrapped, factory appearance
- Wheels, tires, wheel wells — NOT wrapped
- Door handles — NOT wrapped
- Side mirrors — NOT wrapped
- Chrome trim, rain gutters, antenna — NOT wrapped
TRUCK BED: on a pickup, the wrap covers the outer painted panels — cab, bed sides, and tailgate exterior; the open bed interior stays bare factory bedliner.
This is how real vehicle wraps work. Vinyl goes on painted body panels only.
`;

/** The hero path's actual coverage instruction - one line, not the block. */
const COVERAGE_LINE =
  "The wrap covers painted body panels only. Windows, lights, wheels, and trim stay factory.";

/** Appended with WRAP_COVERAGE_RULES on reproduction views: the same hood must
 *  be the same hood in the front view and the top-down view. */
const DESIGN_PLACEMENT =
  "DESIGN PLACEMENT: Design like a pro-level designer educated on correct wrap installation placement. Design must flow seamlessly across the vehicle. Every render must display the same cohesive design — if a hood design is created and the hood is visible in another view, it must show the same design.";

// THE LOGO REQUIREMENT - one literal, ported whole.
//
// Every version of this that prescribed a FORM converged: mandating "the company
// name in custom, distinctive lettering" gave three unrelated trades the same
// lettering lockup, and replacing it with a menu of forms was the same pressure
// wearing different clothes. Requiring that a logo EXIST names no form at all
// and hands the form decision back to the brief, which is the only input that
// differs between customers.
const LOGO_REQUIREMENT =
  "This business needs its own logo — decide its form from this brief alone.";

// DEPTH. Deleting this once flattened every commercial render to panels of flat
// colour. It describes what depth IS; it does not say what goes where.
const COMMERCIAL_DEPTH =
  "The design is built from layered elements — background color and texture flowing across the body lines, mid-ground graphic motion, and foreground accent detail — with real dimension rather than flat shapes on bare panel.";

// TRANSLATION. Turns a NAMED reference in the brief into actual design geometry.
// One worked example, not three: a list of examples is also a list of aesthetics
// handed to every customer.
const COMMERCIAL_TRANSLATION =
  "Translate anything the brief names into concrete design — color story, layout, graphic motifs, focal treatment (\"stealth bomber\" becomes angular faceted panels with sharp swept edges). What the client named should be obvious at a glance.";

// The quality floor a senior designer applies to any brief. The TREATMENT half
// that used to live here (mandated gradients/metallic sheens) is deliberately
// absent: applied to every trade it became one house style.
const PROFESSIONAL_JUDGMENT =
  "When the brief names a real subject (a home, building, product, landscape, or scene), render it with rich photographic realism — lifelike detail, natural light, depth, and dimension, crisp and high-resolution as if professionally photographed, then printed cleanly onto the vinyl.";

const DESIGN_AMPLIFICATION =
  "DESIGN AMPLIFICATION: Elevate and enhance the brief — fill in every decision the client left open with depth, flow, and layered thematic elements. A named subject (for example a vintage B-52 with a 1940s painted pin-up, or an anime hero) becomes a rich, multi-element composition with distressed texture, color harmony, and dimension, custom-designed at a $5,000 studio level — whether the client wrote two words or two paragraphs.";

// PHOTOGRAPHIC REALISM - appended ONLY when the customer explicitly asked. Kept
// in POSITIVE framing on purpose: Gemini over-indexes on negated words, so
// "not a cartoon" pushes it toward cartoon.
const PHOTO_REALISM_LOCK =
  "PHOTOGRAPHIC IMAGERY: the scene in this brief is an actual photograph — a real camera image with natural light, true-to-life colour, real depth of field, and real surface texture — occupying its own area of the wrap. Type and logo sit over it as crisp vector art.";

const FINISH_SPECS = Object.freeze({
  gloss: "GLOSS — wet-look surface, mirror-sharp specular highlights, deep saturated color, visible reflections in the body panels.",
  matte: "MATTE — flat, light-absorbing, no reflections or shine; soft diffuse shading only, chalky and velvety like a matte print.",
  satin: "SATIN — soft feathered sheen between matte and gloss; low reflection, studio lights show as soft glowing patches, never mirror-bright.",
  chrome: "CHROME — mirror-like reflections, maximum specularity, the body panel reflects the surroundings like a polished mirror.",
  brushed: "BRUSHED METAL — directional grain texture, anisotropic reflections that stretch along the brush direction.",
});

const SUBSTRATE_CONTEXT = Object.freeze({
  color_change_film: "SPECIALTY SUBSTRATE: This design is printed on a color-change specialty base film (metallic, pearl, or color-shift vinyl). The metallic/pearl base film shows through the printed ink layer, creating a luminous, color-shifting effect. Lighter print areas reveal more of the pearl/metallic base. Dark print areas remain opaque. This is printed vinyl with a specialty base layer — NOT chrome paint or automotive metallic paint.",
  chrome_film: "SPECIALTY SUBSTRATE: This design is printed on a mirror chrome base film. The chrome substrate shows through lighter and transparent areas of the printed design, creating a chrome-through-ink effect. Dark printed areas remain opaque over the chrome. This is printed vinyl on chrome film — NOT chrome paint.",
  satin_film: "SPECIALTY SUBSTRATE: This design is printed on a satin base film. The satin substrate provides a soft, silk-like sheen underneath the printed design, giving the artwork depth and luminosity. This is printed vinyl on satin film — NOT satin automotive paint.",
});

const CAMERA_SPEC_STANDARD =
  "Canon EOS R5, 35mm f/8, tack-sharp. 16:9 landscape. Razor-sharp details, perfect exposure, vibrant colors.";

// ---------------------------------------------------------------------------
// PHOTO REALISM IS EXPLICIT-REQUEST-ONLY.
//
// DesignPro ILLUSTRATES by default - a real designer's call. It switches to
// photographic realism only when the customer explicitly asks. Scene words
// alone (ranch, sunset, cabin) never trigger it: a customer can absolutely want
// a stylized ranch, and treating "sunset" as a photo request takes the decision
// away from them.
// ---------------------------------------------------------------------------
function briefWantsPhoto(raw) {
  const t = String(raw || "").toLowerCase();
  if (/\b(photo|photos|photograph|photographs|photographic|photo-?realistic|photorealism|photoreal)\b/.test(t)) return true;
  if (/\b(lifelike|true[-\s]to[-\s]life)\b/.test(t)) return true;
  // "realistic" only counts when it is clearly about an image, not "realistic flames".
  if (/\brealistic\b/.test(t) && /\b(photo|image|render|look|looking|scene|imagery)\b/.test(t)) return true;
  return false;
}

/**
 * Pickups have an OPEN cargo bed, and the recurring defect is the wrap flowing
 * INTO it - graphics smeared across the bed floor and inner walls, which then
 * smears the flattened 2D proof downstream. Empty for every other body style so
 * their prompt is byte-for-byte unchanged.
 */
function truckBedClause(vehicleDescriptor) {
  const v = String(vehicleDescriptor || "").toLowerCase();
  const isPickup = /\b(f[\s-]?[1234]50|silverado|sierra|ram|tundra|tacoma|colorado|canyon|ranger|maverick|frontier|titan|ridgeline|gladiator|dakota|pickup|crew cab)\b/.test(v);
  return isPickup
    ? " On this pickup, the wrap covers the cab, bed sides, and tailgate exterior; the open bed interior stays bare factory bedliner."
    : "";
}

function trimmed(value) {
  return String(value == null ? "" : value).trim();
}

function firstOf(input, fields) {
  for (const field of fields) {
    const value = trimmed(input?.[field]);
    if (value) return value;
  }
  return "";
}

function colorList(input) {
  if (Array.isArray(input?.colors)) return input.colors.map(trimmed).filter(Boolean);
  const single = trimmed(input?.colors);
  return single ? [single] : [];
}

/** The vehicle as the model should read it: "2022 Ford Transit (van)". */
function vehicleDescriptor(input) {
  const vehicle = input?.vehicle || {};
  return [vehicle.year, vehicle.make, vehicle.model].map(trimmed).filter(Boolean).join(" ")
    || "commercial vehicle";
}

/**
 * COMMERCIAL or RESTYLE - the same split the source makes, decided from the
 * request instead of from a client-supplied mode field.
 *
 * A job carrying a business identity is a fleet job and gets the sign-shop
 * designer, the logo requirement and the contact-bar discipline. A job without
 * one is a restyle and gets the show-car designer, whose scene text explicitly
 * keeps branding OFF the vehicle. Guessing this wrong in either direction is
 * visible on the finished wrap, so an explicit `input.mode` still wins when the
 * caller states it.
 */
function designMode(input) {
  const declared = trimmed(input?.mode).toLowerCase();
  if (declared === "commercial" || declared === "restyle") return declared;
  const business = firstOf(input, ["businessName", "business", "companyName"]);
  return business || trimmed(input?.industry) || trimmed(input?.phone) ? "commercial" : "restyle";
}

/** The customer's own words. Never rewritten, never templated, never pre-passed. */
function rawBrief(input) {
  return firstOf(input, ["brief", "designBrief", "description", "prompt"]);
}

function finishOf(input) {
  return trimmed(input?.finish) || "Gloss";
}

function finishSpecOf(input) {
  return FINISH_SPECS[finishOf(input).toLowerCase()] || FINISH_SPECS.gloss;
}

function finishLine(input) {
  const finish = finishOf(input);
  return `Finish: ${finish.toUpperCase()} — ${finishSpecOf(input)} The vinyl finish is ${finish.toLowerCase()} across ALL body panels — consistent finish on every surface.`;
}

function substrateLine(input) {
  const substrate = trimmed(input?.substrate);
  if (!substrate || substrate === "standard") return "";
  return SUBSTRATE_CONTEXT[substrate] || "";
}

/**
 * VisionBoard grounding. When the customer uploads an example to match, the
 * wrap follows it - it is never quietly ignored in favour of an invented
 * design, which is the single most-reported front-of-pipeline failure.
 *
 * `exact_reference` REPRODUCES (branding included, as part of the artwork).
 * `style_inspiration` TRANSFORMS (mood and colour into something original).
 */
function visionBoardImages(input) {
  const images = input?.visionBoardImages;
  if (!Array.isArray(images)) return [];
  return images
    .map((image) => ({
      slotLabel: trimmed(image?.slotLabel),
      storageUrl: trimmed(image?.storageUrl),
      contentType: trimmed(image?.contentType) || "image/png",
      bytes: Buffer.isBuffer(image?.bytes) ? image.bytes : null,
    }))
    .filter((image) => image.storageUrl || image.bytes);
}

function visionBoardIntent(input) {
  const intent = trimmed(input?.visionboard_intent || input?.visionBoardIntent).toLowerCase();
  return intent === "exact_reference" ? "exact_reference" : "style_inspiration";
}

function visionBoardBlock(input, vehicle) {
  if (!visionBoardImages(input).length) return "";
  if (visionBoardIntent(input) === "exact_reference") {
    return `EXACT REFERENCE (REPRODUCE, DO NOT REDESIGN): The provided reference is the customer's own approved wrap design. Reproduce it faithfully on the ${vehicle} — keep the exact colors, patterns, graphics, typography, layout, and composition true to the reference, adapting ONLY to fit the ${vehicle}'s body lines while preserving the design's identity, proportions, and visual hierarchy. Reproduce EVERY logo, wordmark, and line of text exactly once, in the same place and style as the reference — branding is PART of this design, never a separate layer to strip, relocate, duplicate, or reinvent. Do NOT redesign, reinterpret, recolor, simplify, or add elements; the ONLY thing that changes is the vehicle the design is applied to.`;
  }
  const descriptors = trimmed(input?.styleDescriptors);
  if (descriptors) {
    return `STYLE INSPIRATION: Transform the visual style from the client's reference images into an ORIGINAL wrap design. Style DNA:\n${descriptors}\nCreate something new that captures this energy — do not reproduce the references directly.`;
  }
  return "STYLE INSPIRATION: Transform the mood, colors, and artistic style of the provided reference images into an ORIGINAL wrap design for this vehicle. Use them as style inspiration only — create something new.";
}

// ---------------------------------------------------------------------------
// SCENES. One per view, per mode. These are the source's own strings; the only
// choice this module makes is which of the two existing sets to use, from the
// mode the hero was designed under (divergence 2).
// ---------------------------------------------------------------------------
function commercialScene(viewType, vehicle, wantsPhoto) {
  if (viewType === "hood_detail") {
    return `A photorealistic studio photograph looking down at the hood of a ${vehicle} with a premium commercial vehicle wrap. The wrap is real printed vinyl — the hood design is the hero, showing company branding and graphic elements across the hood surface.`;
  }
  if (viewType === "roof") {
    return `A photorealistic top-down studio photograph looking straight down at the roof of a ${vehicle} with a premium commercial vehicle wrap. Camera is DIRECTLY ABOVE the vehicle pointing straight down — orthographic flat top-down view, NOT a tilted or angled shot. The roof panel and its wrap design are the only subject. The wrap is real printed vinyl — the roof artwork shows company branding extending across the full roof surface from windshield to rear glass.`;
  }
  if (wantsPhoto) {
    return `A photorealistic studio photograph of a ${vehicle} with a premium commercial vehicle wrap fully installed — real printed vinyl, physically applied. Any real-world scene in the brief is a printed photograph on the vinyl, alongside the graphic elements. The company name reads clearly at a glance; how the branding is composed is your creative call.`;
  }
  return `A photorealistic studio photograph of a ${vehicle} with a premium commercial vehicle wrap fully installed — real printed vinyl, physically applied. ${COMMERCIAL_DEPTH} The company name reads clearly at a glance; how the branding is composed is your creative call.`;
}

function restyleScene(viewType, vehicle, wantsPhoto) {
  if (viewType === "hood_detail") {
    return `A photorealistic studio photograph looking down at the hood of a ${vehicle} with a premium artistic vehicle wrap. The wrap is real printed vinyl — the hood artwork is the hero, rich with layered detail and depth. No text, no logos, no branding.`;
  }
  if (viewType === "roof") {
    return `A photorealistic top-down studio photograph looking straight down at the roof of a ${vehicle} with a premium artistic vehicle wrap. Camera is DIRECTLY ABOVE the vehicle pointing straight down — orthographic flat top-down view, NOT a tilted or angled shot. The roof panel and its wrap artwork are the only subject. The wrap is real printed vinyl — rich layered roof artwork extending across the full roof surface from windshield to rear glass. No text, no logos, no branding.`;
  }
  if (wantsPhoto) {
    return `A photorealistic studio photograph of a ${vehicle} with a premium vehicle wrap fully installed — real printed vinyl, physically applied. The wrap reproduces the brief as a TRUE PHOTOGRAPHIC SCENE printed edge-to-edge across the body — real-world lighting, natural vivid color, atmospheric depth, and lifelike detail, as if a professional photograph were printed on the vinyl — conforming to the body lines, fender curves, and wheel-arch contours. Branding is added separately as its own layer.`;
  }
  return `A photorealistic studio photograph of a ${vehicle} with a premium artistic vehicle wrap fully installed — real printed vinyl, physically applied. The design elevates the brief into a bold, cohesive wrap built from multiple layered thematic elements — a hero focal point across the door panels, with supporting background atmosphere, mid-ground motion, and foreground accent detail — flowing with the body lines, fender curves, and wheel-arch contours, rich with distressed depth and texture. Branding is added separately as its own layer.`;
}

function sceneFor(mode, viewType, vehicle, wantsPhoto) {
  return mode === "commercial"
    ? commercialScene(viewType, vehicle, wantsPhoto)
    : restyleScene(viewType, vehicle, wantsPhoto);
}

const COMMERCIAL_IDENTITY =
  "You are the senior graphic designer at a sign and wrap company — 20 years of $5,000-per-vehicle commercial fleet graphics, printed on vinyl and installed on real trucks and vans. You amplify each brief into an original design built for this one business — premium, readable at a glance from across a parking lot, and worth what the customer paid.";

const RESTYLE_IDENTITY =
  "You are WePrintWraps.com Lead Vehicle Wrap Designer. You create both restyle and commercial wraps with depth and texture — your designs are seen in car shows around the world. You take a customer's order and create amazing, modern vehicle wrap designs that we sell to wrap shops who then print and install them on real vehicles. You amplify each customer's vision while staying true to their request — a chameleon who reads every brief, absorbs references, and creates something uniquely RIGHT.";

/**
 * HOOD / ROOF / FRONT CONTINUITY. The hood appears in the front view AND the
 * top-down hood view; rendered independently the model invents a different
 * layout each time. This is the "two different hoods" lock.
 */
function continuityBlock(viewType) {
  if (!["hood_detail", "hood", "roof", "front"].includes(viewType)) return "";
  const surface = viewType === "roof" ? "roof" : "hood";
  return `HOOD/ROOF CONTINUITY (NON-NEGOTIABLE): The ${surface} carries the SAME single continuous wrap design that flows onto it from the body in this exact wrap — identical colors, graphics, motif, and flow direction. The ${surface} is NOT a separate composition: do not invent, substitute, simplify, mirror, or redraw a different pattern for it. Across the front view and the top-down ${surface} view the ${surface} design must be one and the same — only the camera moves.`;
}

function join(sections) {
  return sections.map((section) => String(section || "").trim()).filter(Boolean).join("\n\n");
}

// ---------------------------------------------------------------------------
// THE HERO PROMPT (view 1). The only prompt that INVENTS.
// ---------------------------------------------------------------------------
function buildHeroPrompt({ input, sourceViewType, instruction = "" }) {
  angles.assertTextDirectionGuard(sourceViewType);
  const mode = designMode(input);
  const vehicle = vehicleDescriptor(input);
  const brief = rawBrief(input);
  const wantsPhoto = briefWantsPhoto(brief);
  const cameraAngle = angles.cameraAngle(sourceViewType);
  const note = trimmed(instruction);

  const sections = [];

  if (mode === "commercial") {
    sections.push(COMMERCIAL_IDENTITY);
    sections.push(`CAMERA ANGLE (LOCKED — read this FIRST):\n${cameraAngle.trim()}`);
    sections.push(sceneFor(mode, sourceViewType, vehicle, wantsPhoto));
    sections.push(STUDIO_ENVIRONMENT.trim());

    // THE CONCEPT. Nothing sits between the customer's words and the designer:
    // no brief rewriting, no template injection, no enhancer pre-pass. The
    // canned trade templates a pre-pass supplies ARE the slop they claim to
    // prevent - a plumbing template once deleted an explicit request for a
    // photo of a technician and substituted generic pipe icons.
    const clientBrief = [
      "THE CONCEPT — the heart of this design; build everything around it:",
      `Client's creative direction: "${brief || "Professional commercial vehicle wrap design."}"`,
      COMMERCIAL_TRANSLATION,
      "",
      "CLIENT BRIEF:",
    ];
    const business = firstOf(input, ["businessName", "business", "companyName"]);
    if (business) {
      clientBrief.push(`Business: ${business}.`);
      clientBrief.push(`Spell the business name exactly. ${LOGO_REQUIREMENT}`);
    } else {
      // The customer typed everything into the free brief. Read the business
      // name out of it rather than shipping a name-less, logo-less wrap. SAME
      // instruction as the field branch, deliberately: one artifact with two
      // producers is how a fix here keeps coming undone.
      clientBrief.push(`Identify the business name from the creative direction above. Spell it exactly as written in the brief. ${LOGO_REQUIREMENT}`);
    }
    const phone = trimmed(input?.phone);
    if (phone) {
      clientBrief.push(`Contact info (place in the contact bar): ${phone} — display this EXACT number, digit for digit. Never alter or invent any digits.`);
    } else {
      // An invented phone number is a real number belonging to someone else,
      // printed on a real vehicle. Silence is the only safe default.
      clientBrief.push("No phone number was provided — do NOT invent, fabricate, or display any phone number, website, email, or address anywhere on the vehicle. Show the company name only.");
    }
    const industry = trimmed(input?.industry);
    if (industry) clientBrief.push(`Industry: ${industry}`);
    const colors = colorList(input);
    if (colors.length) clientBrief.push(`Brand colors: ${colors.join(", ")} — build the entire design from this palette and do not introduce unrelated colors.`);
    const fontStyle = trimmed(input?.fontStyle);
    if (fontStyle) clientBrief.push(`Typography preference: ${fontStyle}.`);
    const style = trimmed(input?.style);
    if (style) clientBrief.push(`Style direction: ${style}.`);
    sections.push(clientBrief.join("\n"));
    sections.push(PROFESSIONAL_JUDGMENT);
  } else {
    sections.push(RESTYLE_IDENTITY);
    sections.push(`FINISH LOCK (LOCKED — read this FIRST, applies to every body panel):\n${finishOf(input).toUpperCase()} — ${finishSpecOf(input)}`);
    sections.push(`CAMERA ANGLE (LOCKED — read this FIRST):\n${cameraAngle.trim()}`);
    sections.push(sceneFor(mode, sourceViewType, vehicle, wantsPhoto));
    sections.push(STUDIO_ENVIRONMENT.trim());
    sections.push(`Wrap request: "${brief || "Premium artistic vehicle wrap."}"`);
    const colors = colorList(input);
    if (colors.length) sections.push(`Colour direction: ${colors.join(", ")}`);
    const style = trimmed(input?.style);
    if (style) sections.push(`Style: ${style}`);
    // Short brief -> MORE creative direction. Skipped only for an exact
    // recreate, where amplifying fights the copyist instruction.
    if (visionBoardIntent(input) !== "exact_reference" || !visionBoardImages(input).length) {
      sections.push(DESIGN_AMPLIFICATION);
      sections.push(PROFESSIONAL_JUDGMENT);
    }
  }

  sections.push(visionBoardBlock(input, vehicle));
  sections.push(continuityBlock(sourceViewType));
  if (wantsPhoto) sections.push(PHOTO_REALISM_LOCK);
  if (note) sections.push(`Revision requested for this view: ${note}`);
  sections.push(finishLine(input));
  sections.push(substrateLine(input));
  sections.push(`${COVERAGE_LINE}${truckBedClause(vehicle)}`);
  sections.push(CAMERA_SPEC_STANDARD);

  return join(sections);
}

// ---------------------------------------------------------------------------
// THE REPRODUCTION PROMPT (views 2-7). Never invents.
//
// The attached hero is a COMPLETED WRAP photographed from the driver side. This
// prompt asks for the same vehicle and the same wrap from a different camera
// position - the source's DesignIQ additional-view prompt.
//
// SECONDARY-VIEW EXCLUSIONS, PRESERVED FROM THE SOURCE: no studio
// reinforcement block (its stacked negatives produce the very cartoon they
// forbid), no elevation/amplification block (this view is not inventing), and
// no VisionBoard re-injection (the hero already absorbed the reference; feeding
// it again invites a second, different interpretation).
// ---------------------------------------------------------------------------
function buildReproductionPrompt({ input, sourceViewType, designAnchorText = "", instruction = "" }) {
  angles.assertTextDirectionGuard(sourceViewType);
  const mode = designMode(input);
  const vehicle = vehicleDescriptor(input);
  const wantsPhoto = briefWantsPhoto(rawBrief(input));
  const cameraAngle = angles.cameraAngle(sourceViewType);
  const viewLabel = angles.viewLabel(sourceViewType).toLowerCase();
  const anchor = trimmed(designAnchorText).slice(0, MAX_ANCHOR_CHARS);
  const note = trimmed(instruction);

  const sections = [
    `CAMERA ANGLE (LOCKED — read this FIRST):\n${cameraAngle.trim()}`,
    `${sceneFor(mode, sourceViewType, vehicle, wantsPhoto)} The attached reference image shows this EXACT wrap design photographed from the driver side. Render the SAME vehicle with the SAME wrap design from the ${viewLabel} angle.`,
    "The wrap is real printed vinyl — every color, pattern, graphic element, and design detail from the reference must appear consistently on this view. The design flows naturally with the vehicle body lines.",
  ];

  // The anchor is what survives when the model looks away from the image: a
  // structured description of the hero's colours, elements, typography and
  // flow. Without it, views drift into "similar but different".
  if (anchor) sections.push(`DESIGN CONTINUITY — match this driver-side description exactly:\n${anchor}`);
  const continuity = continuityBlock(sourceViewType);
  sections.push(continuity);
  if (note) sections.push(`Revision requested for this view: ${note}`);
  sections.push(finishLine(input));
  sections.push(substrateLine(input));
  sections.push(STUDIO_ENVIRONMENT.trim());
  sections.push(CAMERA_SPEC_STANDARD);
  if (wantsPhoto) sections.push(PHOTO_REALISM_LOCK);
  // The full coverage block supersedes the hero path's one-liner - saying the
  // same thing twice is the prompt-stacking the source warns against, and the
  // pickup clause is the only part of that line the block does not already
  // carry in its own words.
  sections.push(`${WRAP_COVERAGE_RULES.trim()}${truckBedClause(vehicle)}`);
  // DESIGN PLACEMENT and the hood/roof continuity lock make the same demand.
  // On the three views that carry the lock, the second copy is redundant.
  if (!continuity) sections.push(DESIGN_PLACEMENT);

  return join(sections);
}

/**
 * The prompt for one slot, as provider parts.
 *
 * The hero gets text only. A reproduction view gets the hero image FIRST - the
 * model reads the reference before the instruction - then the text. Reference
 * bytes are attached at full resolution (divergence 3).
 */
function promptPartsFor({ input, sourceViewType, instruction = "", heroReference = null, designAnchorText = "" }) {
  if (angles.reproducesHero(sourceViewType)) {
    if (!heroReference?.bytes?.length) {
      // A reproduction view without its hero would silently become a seventh
      // independent invention. Refuse instead.
      const error = new Error(`hero reference is required to reproduce ${sourceViewType}`);
      error.code = "hero_reference_missing";
      throw error;
    }
    return [
      {
        inlineData: {
          mimeType: heroReference.contentType || "image/png",
          data: Buffer.from(heroReference.bytes).toString("base64"),
        },
      },
      { text: buildReproductionPrompt({ input, sourceViewType, designAnchorText, instruction }) },
    ];
  }

  const parts = [];
  // VisionBoard references travel as real images when the caller resolved their
  // bytes; the grounding text alone cannot show the model a reference.
  for (const image of visionBoardImages(input)) {
    if (image.bytes?.length) {
      parts.push({ inlineData: { mimeType: image.contentType, data: Buffer.from(image.bytes).toString("base64") } });
    }
  }
  parts.push({ text: buildHeroPrompt({ input, sourceViewType, instruction }) });
  return parts;
}

// ---------------------------------------------------------------------------
// THE DESIGN ANCHOR. One text analysis of the accepted hero, reused by all six
// reproduction views. Non-fatal by design: a missing anchor weakens continuity,
// while a failed request produces nothing at all.
// ---------------------------------------------------------------------------
const DESIGN_ANCHOR_PROMPT = `Analyze this vehicle wrap render in precise detail. Your analysis will be used to ensure visual continuity when rendering the same wrap from different angles.

Describe:
1. COLORS: Every color present with approximate hex values and where each color appears on the vehicle
2. DESIGN ELEMENTS: All stripes, curves, gradients, shapes, geometric patterns — their exact position, size, direction of flow, and relationship to vehicle body lines
3. TYPOGRAPHY: Any text, fonts, and their exact placement (or state "No typography present" if text-free). Transcribe every string exactly as it appears, character for character.
4. COMPOSITION: Overall flow direction, symmetry type, focal points, and how the design interacts with the vehicle's contours
5. SCALE & COVERAGE: How the design maps to specific vehicle panels (doors, fenders, hood, roof), where it starts and ends, and any areas left unwrapped

Return JSON only, exactly: {"anchor":"<a single structured paragraph another AI could use to recreate this EXACT design on the same vehicle from any angle>"}

The paragraph must be at most 900 characters. Spend them on colour placement, element positions and exact lettering; drop anything a renderer could infer.`;

async function buildDesignAnchor({ provider, heroBytes, contentType = "image/png", signal, logger = () => {} }) {
  if (!provider?.generateSpecification || !heroBytes?.length) return "";
  try {
    const { specification } = await provider.generateSpecification({
      parts: [
        { text: DESIGN_ANCHOR_PROMPT },
        { inlineData: { mimeType: contentType, data: Buffer.from(heroBytes).toString("base64") } },
      ],
      temperature: 0,
      signal,
      label: "design anchor",
    });
    const anchor = trimmed(specification?.anchor).slice(0, MAX_ANCHOR_CHARS);
    logger(anchor ? `design anchor ready (${anchor.length} chars)` : "design anchor returned empty");
    return anchor;
  } catch (error) {
    // Non-critical, exactly as in the source: views 2-7 still render, with the
    // hero image alone carrying continuity.
    logger(`design anchor unavailable (${String(error?.message || error).slice(0, 160)})`);
    return "";
  }
}

module.exports = {
  CAMERA_SPEC_STANDARD,
  COMMERCIAL_DEPTH,
  COMMERCIAL_IDENTITY,
  COMMERCIAL_TRANSLATION,
  COVERAGE_LINE,
  DESIGN_AMPLIFICATION,
  DESIGN_PLACEMENT,
  FINISH_SPECS,
  HERO_PROMPT_CHAR_CEILING,
  LOGO_REQUIREMENT,
  MAX_ANCHOR_CHARS,
  PHOTO_REALISM_LOCK,
  PROFESSIONAL_JUDGMENT,
  PROMPT_CONTRACT,
  REPRODUCTION_PROMPT_CHAR_CEILING,
  RESTYLE_IDENTITY,
  STUDIO_ENVIRONMENT,
  SUBSTRATE_CONTEXT,
  WRAP_COVERAGE_RULES,
  briefWantsPhoto,
  buildDesignAnchor,
  buildHeroPrompt,
  buildReproductionPrompt,
  designMode,
  promptPartsFor,
  truckBedClause,
  vehicleDescriptor,
  visionBoardImages,
  visionBoardIntent,
};
