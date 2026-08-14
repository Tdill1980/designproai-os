"use strict";

/**
 * DesignIQ prompt construction — the creative brain, ported from
 * restylepro-os @ 532a7d56, blob 4df3a9741c4f0721afb00b4db823fe7022147aa6
 * (supabase/functions/design-panel-ai-generate/index.ts, buildDesignIQPrompt
 * and the constants it reads), plus canonicalizeVehicle from
 * _shared/render-events.ts.
 *
 * TRADE SECRET - CONFIDENTIAL. (c) LoopMighty Software Development LLC.
 *
 * WHY THIS EXISTS. The engine contract has listed design-panel-ai-generate as a
 * frozen source blob since Calls 1-7 shipped, but the standalone worker never
 * ran any of it. What it ran instead was a thirty-line field concatenation:
 * brief, business, industry, colours, style, vehicle, camera angle. Every piece
 * of judgment this file carries — the designer identity and its quality bar,
 * the studio, the finish and substrate physics, layered depth, the translation
 * of a named reference into geometry, VisionBoard grounding, logo direction,
 * hood/roof continuity, the photographic-realism lock, wrap coverage, the
 * camera body — was absent. The views came back framed correctly and designed
 * generically, which is exactly what a camera contract without a design brain
 * produces.
 *
 * WHAT IS DELIBERATELY NOT PORTED. Every comment in the source records a
 * regression that was paid for in production, so the text is carried verbatim
 * rather than paraphrased. Two things are left behind on purpose:
 *
 *   - The negated "NOT a cartoon / illustration / clip-art" lines. PR #3380
 *     removed all five because Gemini over-indexes on negated words and they
 *     produced more slop, not less. The affirmative PHOTO_REALISM_LOCK is the
 *     replacement and it is here.
 *   - elevate-prompt (the GENIE prompt enhancer). The pipeline specification
 *     states it is removed from the auto-render path and must not be re-added.
 *
 * The prompt text must not surface in any published artifact.
 */

const { STUDIO_ENVIRONMENT } = require("./studio-os.cjs");
const angles = require("./view-angles.cjs");

// ---------------------------------------------------------------- vehicle name
// Canonicalise make/model so the image model sees the proper-noun model name
// ("Tesla Cybertruck", not "tesla cyber truck") and locks geometry correctly.
const MAKE_ALIASES = Object.freeze({
  tesla: "Tesla", chevy: "Chevrolet", chevrolet: "Chevrolet", gmc: "GMC",
  vw: "Volkswagen", volkswagen: "Volkswagen", bmw: "BMW",
  mercedes: "Mercedes-Benz", "mercedes-benz": "Mercedes-Benz",
  "mercedes benz": "Mercedes-Benz", mb: "Mercedes-Benz",
  ford: "Ford", ram: "RAM", dodge: "Dodge", toyota: "Toyota", honda: "Honda",
  nissan: "Nissan", porsche: "Porsche", audi: "Audi", lexus: "Lexus",
  kia: "Kia", hyundai: "Hyundai", subaru: "Subaru", jeep: "Jeep",
  cadillac: "Cadillac", buick: "Buick", rivian: "Rivian", lucid: "Lucid",
  polestar: "Polestar",
});

// Only the normalisations that matter for vehicle SHAPE, so the render gets the
// correct geometry.
const MODEL_ALIASES = Object.freeze({
  Tesla: {
    "cyber truck": "Cybertruck", cybertruck: "Cybertruck", "cyber-truck": "Cybertruck",
    ct: "Cybertruck", "model s": "Model S", "model 3": "Model 3",
    "model x": "Model X", "model y": "Model Y", roadster: "Roadster", semi: "Semi",
  },
  Chevrolet: {
    silverado: "Silverado 1500", "silverado 1500": "Silverado 1500",
    "silverado 2500": "Silverado 2500 HD", "silverado 3500": "Silverado 3500 HD",
    corvette: "Corvette", camaro: "Camaro", tahoe: "Tahoe", suburban: "Suburban",
  },
  Ford: {
    f150: "F-150", "f 150": "F-150", "f-150": "F-150",
    f250: "F-250", "f-250": "F-250", f350: "F-350", "f-350": "F-350",
    mustang: "Mustang", bronco: "Bronco",
  },
  RAM: { 1500: "1500", 2500: "2500", 3500: "3500", trx: "1500 TRX" },
  GMC: {
    sierra: "Sierra 1500", "sierra 1500": "Sierra 1500",
    yukon: "Yukon", "hummer ev": "Hummer EV",
  },
});

function titleCase(value) {
  return String(value || "")
    .split(/\s+/)
    .map((word) => (word.length === 0 ? word : word[0].toUpperCase() + word.slice(1)))
    .join(" ");
}

function canonicalizeVehicle(make, model) {
  if (!make && !model) return null;
  const m = String(make || "").toLowerCase().trim();
  const mo = String(model || "").toLowerCase().trim();
  const canonicalMake = MAKE_ALIASES[m] || titleCase(m);
  let canonicalModel = "";
  if (mo) {
    const brandTable = MODEL_ALIASES[canonicalMake];
    canonicalModel = (brandTable && brandTable[mo]) || titleCase(mo);
  }
  return [canonicalMake, canonicalModel].filter(Boolean).join(" ") || null;
}

// ------------------------------------------------------------- brand direction
// It names no form. Not lettering, not a monogram, not a badge, not a menu of
// those — every one of which converged when it was tried, because one fixed
// direction handed to every business is one fixed outcome. It requires only that
// a logo exist and points the form decision at the brief, which is the only
// input that varies from customer to customer.
const LOGO_REQUIREMENT =
  "This business needs its own logo — decide its form from this brief alone.";

// DEPTH. #3947 ("stop dictating one composition") deleted the BUILD ORDER block,
// and it was right about the part it named: that block ended with a FIXED stack,
// which is one composition handed to every business. But it also carried the
// only instruction for DEPTH, and deleting the whole block took depth with the
// composition order — commercial renders went flat. This restores the depth and
// keeps the fixed order gone. It describes what depth IS; it does not say what
// goes where.
const COMMERCIAL_DEPTH =
  "The design is built from layered elements — background color and texture flowing across the body lines, mid-ground graphic motion, and foreground accent detail — with real dimension rather than flat shapes on bare panel.";

// TRANSLATION — the direction that turns a NAMED reference in the brief into
// actual design geometry. Without it a brief that names something concrete gets
// a generic trade wrap that ignores it. One worked example, not three: examples
// teach the translation move, but a list of them is also a list of aesthetics
// handed to every customer, which is the convergence failure this file has
// already been around twice.
const COMMERCIAL_TRANSLATION =
  "Translate anything the brief names into concrete design — color story, layout, graphic motifs, focal treatment (\"stealth bomber\" becomes angular faceted panels with sharp swept edges). What the client named should be obvious at a glance.";

/**
 * NO FORM PRESCRIBED, DELIBERATELY. Every version of this block that prescribed
 * a form converged: "the company name in custom, distinctive lettering" gave
 * three trades the same lockup, and replacing it with a menu was the same
 * convergence pressure wearing different clothes. The REQUIREMENT stays and the
 * PRESCRIPTION is gone — requiring that a logo EXIST names no form at all, and
 * hands the form decision back to the brief, the only input that differs
 * between customers.
 */
function buildLogoArchitecture() {
  return `\nSpell the business name exactly. ${LOGO_REQUIREMENT}`;
}

/**
 * Pickup trucks have an OPEN cargo bed. The recurring defect is the wrap
 * flowing INTO the bed, which then also smears the flattened 2D proof. Returns
 * a coverage clause ONLY for pickups; empty for vans/cars/box trucks so their
 * prompt is byte-for-byte unchanged.
 */
function truckBedClause(vehicle) {
  const v = String(vehicle || "").toLowerCase();
  const isPickup = /\b(f[\s-]?[1234]50|silverado|sierra|ram|tundra|tacoma|colorado|canyon|ranger|maverick|frontier|titan|ridgeline|gladiator|dakota|pickup|crew cab)\b/.test(v);
  return isPickup
    ? " On this pickup, the wrap covers the cab, bed sides, and tailgate exterior; the open bed interior stays bare factory bedliner."
    : "";
}

/**
 * Detect when the brief calls for PHOTOGRAPHIC artwork on the wrap rather than
 * a stylised/graphic wrap.
 *
 * DesignPro is a real pro designer: it ILLUSTRATES by default and only switches
 * to photo realism when the CUSTOMER EXPLICITLY ASKS for a photo. Scene words
 * alone (ranch, sunset, cabin) do NOT trigger it — a customer can absolutely
 * want a stylised ranch.
 */
function briefWantsPhoto(raw) {
  const t = String(raw || "").toLowerCase();
  if (/\b(photo|photos|photograph|photographs|photographic|photo-?realistic|photorealism|photoreal)\b/.test(t)) return true;
  if (/\b(lifelike|true[-\s]to[-\s]life)\b/.test(t)) return true;
  // "realistic" only counts when it is clearly about a photo/image, not
  // "realistic flames".
  if (/\brealistic\b/.test(t) && /\b(photo|image|render|look|looking|scene|imagery)\b/.test(t)) return true;
  return false;
}

// Appended ONLY when briefWantsPhoto() fires, and placed late so it outranks the
// earlier scene wording. POSITIVE framing on purpose: the image model
// over-indexes on negated words, so this directs a real photograph
// affirmatively rather than forbidding a cartoon.
const PHOTO_REALISM_LOCK = `PHOTOGRAPHIC IMAGERY: the scene in this brief is an actual photograph — a real camera image with natural light, true-to-life colour, real depth of field, and real surface texture — occupying its own area of the wrap. Type and logo sit over it as crisp vector art.`;

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

// The quality floor a senior designer applies to ANY brief. Two things used to
// live here and only one is load-bearing: the removed half mandated a visual
// TREATMENT for every design, which applied to every trade is a house style —
// the glossy swept-gradient look that came back three times running. What stays
// is the photographic-realism instruction for real subjects.
const PROFESSIONAL_JUDGMENT = `When the brief names a real subject (a home, building, product, landscape, or scene), render it with rich photographic realism — lifelike detail, natural light, depth, and dimension, crisp and high-resolution as if professionally photographed, then printed cleanly onto the vinyl.`;

/**
 * HOOD / ROOF / FRONT CONSISTENCY. The hood appears in the front view AND the
 * top-down hood view, and the roof in its own view; generated independently the
 * model invents a different layout each time — the "two different hoods" bug.
 *
 * RECORDED DIVERGENCE FROM THE SOURCE. In the source this lives at the bottom
 * of buildDesignIQPrompt under a comment reading "applies to EVERY path —
 * restyle, commercial, exact_reference, artboard_projection". It does not: the
 * commercial branch returns roughly a hundred lines above it, so commercial
 * briefs have never received the continuity lock. That is the path where it
 * matters most — fleet wraps are commercial, and a fleet whose hood disagrees
 * with its own front view is the defect this block was written for. The comment
 * states the intent; the control flow lost it. Hoisting it into a function both
 * branches call is the smallest correction that makes the code do what the
 * source says it does, and it removes the second-producer problem at the same
 * time.
 */
function hoodRoofContinuity(viewType) {
  if (viewType !== "hood_detail" && viewType !== "hood" && viewType !== "roof" && viewType !== "front") return "";
  const surface = viewType === "roof" ? "roof" : "hood";
  return `\nHOOD/ROOF CONTINUITY (NON-NEGOTIABLE): The ${surface} carries the SAME single continuous wrap design that flows onto it from the body in this exact wrap — identical colors, graphics, motif, and flow direction. The ${surface} is NOT a separate composition: do not invent, substitute, simplify, mirror, or redraw a different pattern for it. Across the front view and the top-down ${surface} view the ${surface} design must be one and the same — only the camera moves.`;
}

/**
 * The full DesignIQ prompt for one view.
 *
 * `viewType` is the source view key from the frozen camera contract, never a
 * caller-supplied angle: the camera is server-owned and interpolated here from
 * view-angles.cjs.
 */
function buildDesignIQPrompt(params) {
  const {
    mode, prompt, finish, substrate, companyName, mascot, bulletPoints, phone,
    industryType, brandColors, fontStyle, qrEnabled,
    vehicleYear, vehicleMake, vehicleModel,
    visionBoardImages, visionboard_intent, viewType, styleDescriptors,
  } = params;

  const wantsPhoto = briefWantsPhoto(prompt);
  const canonicalMakeModel = canonicalizeVehicle(vehicleMake, vehicleModel);
  const vehicle = [vehicleYear, canonicalMakeModel || [vehicleMake, vehicleModel].filter(Boolean).join(" ")]
    .filter(Boolean).join(" ");
  const cameraAngle = angles.cameraAngle(viewType || "side");

  const finishSpec = FINISH_SPECS[String(finish || "gloss").toLowerCase()] || FINISH_SPECS.gloss;
  const substrateContext = substrate && substrate !== "standard" ? (SUBSTRATE_CONTEXT[substrate] || "") : "";
  const studioEnvironment = STUDIO_ENVIRONMENT;

  // ── COMMERCIAL MODE ────────────────────────────────────────────────────
  if (mode === "commercial") {
    const keywords = (bulletPoints || []).filter((b) => b && String(b).trim());

    // View-specific scene framing — avoids contradicting the camera angle for
    // hood/roof/close-up.
    const commercialScene = viewType === "hood_detail"
      ? `A photorealistic studio photograph looking down at the hood of a ${vehicle} with a premium commercial vehicle wrap. The wrap is real printed vinyl — the hood design is the hero, showing company branding and graphic elements across the hood surface.`
      : viewType === "roof"
      ? `A photorealistic top-down studio photograph looking straight down at the roof of a ${vehicle} with a premium commercial vehicle wrap. Camera is DIRECTLY ABOVE the vehicle pointing straight down — orthographic flat top-down view, NOT a tilted or angled shot. The roof panel and its wrap design are the only subject. The wrap is real printed vinyl — the roof artwork shows company branding extending across the full roof surface from windshield to rear glass.`
      : viewType === "close-up"
      ? `A photorealistic close-up photograph of a ${vehicle}'s body panel from 12 inches away. The camera is close enough to see the vinyl texture grain, laminate sheen, ink depth, and how the printed design conforms to the body curve. Show a section where the wrap design has detail — pattern, color transitions, or artwork. The body line, panel edge, and surface contour provide context. This is about seeing the MATERIAL QUALITY and DESIGN DETAIL up close.`
      : wantsPhoto
      ? `A photorealistic studio photograph of a ${vehicle} with a premium commercial vehicle wrap fully installed — real printed vinyl, physically applied. Any real-world scene in the brief is a printed photograph on the vinyl, alongside the graphic elements. The company name reads clearly at a glance; how the branding is composed is your creative call.`
      : `A photorealistic studio photograph of a ${vehicle} with a premium commercial vehicle wrap fully installed — real printed vinyl, physically applied. ${COMMERCIAL_DEPTH} The company name reads clearly at a glance; how the branding is composed is your creative call.`;

    // PERSONA. A.C.E. is a sign-and-wrap-company designer, not a SEMA builder
    // (#3948) — that framing stands. What #3948 also dropped was the QUALITY BAR
    // the previous identity carried, leaving a persona with a job title and no
    // standard; the second sentence restores the bar inside the chosen identity.
    let assembled = `You are the senior graphic designer at a sign and wrap company — 20 years of $5,000-per-vehicle commercial fleet graphics, printed on vinyl and installed on real trucks and vans. You amplify each brief into an original design built for this one business — premium, readable at a glance from across a parking lot, and worth what the customer paid.

CAMERA ANGLE (LOCKED — read this FIRST):
${cameraAngle}

${commercialScene}

${studioEnvironment}

THE CONCEPT — the heart of this design; build everything around it:
Client's creative direction: "${prompt}"
${COMMERCIAL_TRANSLATION}

CLIENT BRIEF:`;

    if (companyName) {
      assembled += `\nBusiness: ${companyName}.${buildLogoArchitecture()}`;
    } else {
      // The customer typed everything in the free brief. Read the business name
      // out of the creative direction and design its logo, so a commercial brief
      // still gets a real designed logo instead of a name-less, logo-less wrap.
      // SAME INSTRUCTION AS buildLogoArchitecture, DELIBERATELY — one artifact,
      // two producers is how a fix here keeps coming undone, so both
      // interpolate the same const rather than matching prose.
      assembled += `\nIdentify the business name from the creative direction above. Spell it exactly as written in the brief. ${LOGO_REQUIREMENT}`;
    }
    if (phone) {
      assembled += `\nContact info (place in the contact bar): ${phone} — display this EXACT number, digit for digit. Never alter or invent any digits.`;
    } else {
      assembled += `\nNo phone number was provided — do NOT invent, fabricate, or display any phone number, website, email, or address anywhere on the vehicle. Show the company name only.`;
    }
    if (industryType) assembled += `\nIndustry: ${industryType}`;
    if (brandColors) assembled += `\nBrand colors: ${brandColors} — build the entire design from this palette and do not introduce unrelated colors.`;
    if (fontStyle) assembled += `\nTypography preference: ${fontStyle}.`;
    if (keywords.length) {
      assembled += `\nBrand keywords (guide tone — not literal on-vehicle text): ${keywords.map((k) => String(k).trim()).join(", ")}`;
    }

    if (mascot) {
      assembled += `\n\nBRAND MASCOT: Design an original, custom-illustrated brand character — ${mascot} — as a premium mascot logo in the spirit of a pro sports or esports emblem: clean bold shapes, a dynamic heroic pose, confident personality, on-brand colors, instantly readable at a glance. Treat it as a bespoke illustration a top studio would charge for — distinctive, polished, and memorable. Anchor the mascot as a hero graphic on the rear quarter panel, sized to complement the company name without crowding it.`;
    }

    if (qrEnabled) {
      assembled += `\n\nQR CODE ZONE: Reserve one clean, flat, evenly-lit rectangular area (roughly 10x10 inches) low on the rear quarter panel — free of graphics, text, and busy color — as space for a scannable QR code added in production. Do not draw a QR code yourself.`;
    }

    assembled += `\n\n${PROFESSIONAL_JUDGMENT}`;

    if (visionBoardImages && visionBoardImages.length > 0) {
      if (visionboard_intent === "exact_reference") {
        assembled += `\n\nEXACT REFERENCE: The provided reference is the customer's own approved wrap design for their vehicle. Recreate it faithfully on the ${vehicle} — keep the colors, patterns, typography, logos, layout, and composition true to the reference, adapting only to fit the ${vehicle}'s body lines and preserving the design's identity, proportions, and visual hierarchy.`;
      } else if (styleDescriptors) {
        assembled += `\n\nSTYLE INSPIRATION: Transform the visual style from the client's reference images into an ORIGINAL wrap design. Style DNA extracted from references:\n${styleDescriptors}\nCreate something new that captures this energy — do not reproduce the reference images directly.`;
      } else {
        assembled += `\n\nSTYLE INSPIRATION: Transform the mood, colors, and artistic style of the provided reference images into an ORIGINAL wrap design for this vehicle. Use them as style inspiration only — create something new that captures their energy.`;
      }
    }

    assembled += hoodRoofContinuity(viewType);

    if (wantsPhoto) assembled += `\n\n${PHOTO_REALISM_LOCK}`;

    assembled += `\n\nFinish: ${String(finish || "Gloss").toUpperCase()} — ${finishSpec} The vinyl finish is ${String(finish || "gloss").toLowerCase()} across ALL body panels — consistent finish on every surface.`;
    if (substrateContext) assembled += `\n${substrateContext}`;
    assembled += `\nThe wrap covers painted body panels only. Windows, lights, wheels, and trim stay factory.${truckBedClause(vehicle)}`;
    assembled += viewType === "close-up"
      ? `\nCanon EOS R5, 35mm f/4, moderate depth of field. Razor-sharp focus on vinyl surface texture showing depth, material quality, and body curves. Vibrant colors.`
      : `\nCanon EOS R5, 35mm f/8, tack-sharp. 16:9 landscape. Razor-sharp details, perfect exposure, vibrant colors.`;

    return assembled;
  }

  // ── RESTYLE MODE ───────────────────────────────────────────────────────
  // RECREATE (exact_reference) = REPRODUCE the uploaded wrap on a DIFFERENT
  // vehicle, not invent a new design. The golden restyle framing is written to
  // INVENT, and for a recreate that framing overrode the reference and produced
  // a similar-but-different design that dropped the logo and text. So when — and
  // ONLY when — the intent is exact_reference we swap in a copyist identity.
  const isExactRecreate = visionboard_intent === "exact_reference";

  const restyleScene = viewType === "hood_detail"
    ? `A photorealistic studio photograph looking down at the hood of a ${vehicle} with a premium artistic vehicle wrap. The wrap is real printed vinyl — the hood artwork is the hero, rich with layered detail and depth. No text, no logos, no branding.`
    : viewType === "roof"
    ? `A photorealistic top-down studio photograph looking straight down at the roof of a ${vehicle} with a premium artistic vehicle wrap. Camera is DIRECTLY ABOVE the vehicle pointing straight down — orthographic flat top-down view, NOT a tilted or angled shot. The roof panel and its wrap artwork are the only subject. The wrap is real printed vinyl — rich layered roof artwork extending across the full roof surface from windshield to rear glass. No text, no logos, no branding.`
    : viewType === "close-up"
    ? `A photorealistic close-up photograph of a ${vehicle}'s body panel from 12 inches away. The camera is close enough to see the vinyl texture grain, laminate sheen, ink depth, and how the printed design conforms to the body curve. Show a section where the wrap design has detail — pattern, color transitions, or artwork. The body line, panel edge, and surface contour provide context. This is about seeing the MATERIAL QUALITY and DESIGN DETAIL up close.`
    : isExactRecreate
    ? `A photorealistic studio photograph of a ${vehicle} wearing the EXACT wrap design shown in the reference image — the same colors, graphics, patterns, logos, wordmarks, and text, in the same positions and proportions — reproduced as real printed vinyl and conformed to this ${vehicle}'s body lines, fender curves, and wheel-arch contours. This is a faithful reproduction of an existing approved wrap re-fitted onto a different vehicle, NOT a new design. Keep all branding exactly as in the reference — it is part of the artwork, never a separate layer to strip, move, or reinvent.`
    : wantsPhoto
    ? `A photorealistic studio photograph of a ${vehicle} with a premium vehicle wrap fully installed — real printed vinyl, physically applied. The wrap reproduces the brief as a TRUE PHOTOGRAPHIC SCENE printed edge-to-edge across the body — real-world lighting, natural vivid color, atmospheric depth, and lifelike detail, as if a professional photograph were printed on the vinyl — conforming to the body lines, fender curves, and wheel-arch contours. Branding is added separately as its own layer.`
    : `A photorealistic studio photograph of a ${vehicle} with a premium artistic vehicle wrap fully installed — real printed vinyl, physically applied. The design elevates the brief into a bold, cohesive wrap built from multiple layered thematic elements — a hero focal point across the door panels, with supporting background atmosphere, mid-ground motion, and foreground accent detail — flowing with the body lines, fender curves, and wheel-arch contours, rich with distressed depth and texture. Branding is added separately as its own layer.`;

  const restyleIdentity = isExactRecreate
    ? `You are a vehicle wrap REPRODUCTION specialist at WePrintWraps.com. Your job is to reproduce an existing, approved wrap design EXACTLY as shown in the reference image, re-fitted onto a different vehicle. You do NOT redesign, restyle, recolor, simplify, or invent — you copy the reference faithfully, including every logo and line of text, and change only the vehicle it sits on. If the reference image contains anything besides the design itself (a browser window, app interface, dark panels, menus, thumbnails, captions), IGNORE all of that completely — reproduce ONLY the wrap design shown on the vehicle within it, at FULL fidelity. Copy EVERY design element at its true relative size and position: colored panels, swooshes, and shapes behind or around the logo are part of the design — never drop, shrink, or simplify them, and never shrink the logo lockup.`
    : `You are WePrintWraps.com Lead Vehicle Wrap Designer. You create both restyle and commercial wraps with depth and texture — your designs are seen in car shows around the world. You take a customer's order and create amazing, modern vehicle wrap designs that we sell to wrap shops who then print and install them on real vehicles. You amplify each customer's vision while staying true to their request — a chameleon who reads every brief, absorbs references, and creates something uniquely RIGHT.`;

  let assembled = `${restyleIdentity}

FINISH LOCK (LOCKED — read this FIRST, applies to every body panel):
${String(finish || "Gloss").toUpperCase()} — ${finishSpec}

CAMERA ANGLE (LOCKED — read this FIRST):
${cameraAngle}

${restyleScene}

${studioEnvironment}

Wrap request: "${prompt}"`;

  // Amplification is skipped for an exact recreate, where amplifying would fight
  // the copyist identity.
  if (!isExactRecreate) {
    assembled += `\n\nDESIGN AMPLIFICATION: Elevate and enhance the brief — fill in every decision the client left open with depth, flow, and layered thematic elements. A named subject (for example a vintage B-52 with a 1940s painted pin-up, or an anime hero) becomes a rich, multi-element composition with distressed texture, color harmony, and dimension, custom-designed at a $5,000 studio level — whether the client wrote two words or two paragraphs.

${PROFESSIONAL_JUDGMENT}`;
  }

  if (visionBoardImages && visionBoardImages.length > 0) {
    if (visionboard_intent === "artboard_projection") {
      // Map this camera view to the artboard's matching labeled panel so each
      // side reproduces ITS OWN panel, instead of guessing from the whole sheet.
      const viewToPanel = {
        side: "DRIVER SIDE", driver: "DRIVER SIDE", "driver-side": "DRIVER SIDE",
        "passenger-side": "PASSENGER SIDE", passenger: "PASSENGER SIDE",
        front: "FRONT", rear: "REAR", back: "REAR",
        roof: "ROOF/TOP", top: "ROOF/TOP", hood_detail: "HOOD", hood: "HOOD",
      };
      const panelLabel = viewToPanel[String(viewType || "side").toLowerCase()];
      assembled += `\nARTBOARD PROJECTION: The provided image is a FLAT 2D production artboard with each side drawn as a LABELED panel — the approved, locked source of truth for this wrap. Project it onto the ${vehicle}'s painted body panels exactly as drawn: conform the printed vinyl to the body lines, fenders, and wheel-arch contours. Reproduce every graphic, color, pattern, and logo EXACTLY as positioned in the artboard — do NOT redesign, reinterpret, reposition, or add elements. This is a faithful application of an existing print file onto the vehicle.`;
      if (panelLabel) {
        assembled += ` THIS VIEW = the ${panelLabel} of the vehicle: use the artboard's "${panelLabel}" panel as the exact artwork for this side — match that specific panel's design, layout, colors, logos, and text precisely.`;
      }
    } else if (visionboard_intent === "exact_reference") {
      assembled += `\nEXACT REFERENCE (REPRODUCE, DO NOT REDESIGN): The provided reference is the customer's own approved wrap design. Reproduce it faithfully on the ${vehicle} — keep the exact colors, patterns, graphics, typography, layout, and composition true to the reference, adapting ONLY to fit the ${vehicle}'s body lines while preserving the design's identity, proportions, and visual hierarchy. Reproduce EVERY logo, wordmark, and line of text exactly once, in the same place and style as the reference — branding is PART of this design, never a separate layer to strip, relocate, duplicate, or reinvent. Do NOT redesign, reinterpret, recolor, simplify, or add elements; the ONLY thing that changes is the vehicle the design is applied to. Match the reference's full coverage and texture density — if it is an all-over textured wrap, cover the entire body edge to edge; where the reference leaves the body plain, keep it plain.`;
    } else if (styleDescriptors) {
      assembled += `\nSTYLE INSPIRATION: Transform the visual style from the client's reference images into an ORIGINAL wrap design. Style DNA:\n${styleDescriptors}\nCreate something new that captures this energy — do not reproduce the references directly.`;
    } else {
      assembled += `\nSTYLE INSPIRATION: Transform the mood, colors, and artistic style of the provided reference images into an ORIGINAL wrap design for this vehicle. Use them as style inspiration only — create something new.`;
    }
  }

  assembled += hoodRoofContinuity(viewType);

  if (wantsPhoto) assembled += `\n\n${PHOTO_REALISM_LOCK}`;

  assembled += `\nFinish: ${String(finish || "Gloss").toUpperCase()} — ${finishSpec} The vinyl finish is ${String(finish || "gloss").toLowerCase()} across ALL body panels — consistent finish on every surface.`;
  if (substrateContext) assembled += `\n${substrateContext}`;
  assembled += `\nThe wrap covers painted body panels only. Windows, lights, wheels, and trim stay factory.${truckBedClause(vehicle)}`;
  assembled += viewType === "close-up"
    ? `\nCanon EOS R5, 85mm f/2.8, shallow depth of field with rich bokeh. Razor-sharp focus on vinyl surface texture showing depth, material quality, and fine detail. Vibrant colors.`
    : `\nCanon EOS R5, 35mm f/8, tack-sharp. 16:9 landscape. Razor-sharp details, perfect exposure, vibrant colors.`;

  return assembled;
}

module.exports = {
  buildDesignIQPrompt,
  canonicalizeVehicle,
  briefWantsPhoto,
  truckBedClause,
  buildLogoArchitecture,
  LOGO_REQUIREMENT,
  COMMERCIAL_DEPTH,
  COMMERCIAL_TRANSLATION,
  PHOTO_REALISM_LOCK,
  PROFESSIONAL_JUDGMENT,
  FINISH_SPECS,
  SUBSTRATE_CONTEXT,
};
