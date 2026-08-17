"use strict";

/**
 * A.C.E. — the DesignPro creative prompt, ported from restylepro-os
 * supabase/functions/design-panel-ai-generate/index.ts.
 *
 * Ported verbatim, by line:
 *   LOGO_REQUIREMENT        :115      COMMERCIAL_DEPTH        :135
 *   COMMERCIAL_TRANSLATION  :150      buildLogoArchitecture   :153
 *   truckBedClause          :186      briefWantsPhoto         :203
 *   PHOTO_REALISM_LOCK      :221      FINISH_SPECS            :393
 *   PROFESSIONAL_JUDGMENT   :440      commercial assembly     :447-546
 *   canonicalizeVehicle     _shared/render-events.ts:81
 *
 * WHY THIS EXISTS. The standalone runtime built its whole design prompt from
 * designBrief() — a key:value list of brief/business/industry/colors/style plus
 * a camera angle. None of the creative stack had been ported: no persona, no
 * studio contract, no coverage rule, no finish spec, no photo lock, no
 * VisionBoard, no logo direction. Camera angles were the only piece that made
 * it across, byte-identical, which is how the gap went unnoticed.
 *
 * Every comment in the source explains a live failure that produced the wording
 * ("all look like illustration slop", Ridgeline Roofing coming back logo-less,
 * the wrap smearing into a pickup bed). Those are carried over with the code,
 * because the wording IS the fix.
 *
 * Trade secret (LoopMighty Software Development LLC). Same owner, private
 * repository. The prompt text must not surface in any published artifact.
 */

const { STUDIO_ENVIRONMENT } = require("./studio-os.cjs");
const angles = require("./view-angles.cjs");

// Names no form. Every version that prescribed one converged - "custom,
// distinctive lettering" handed three trades the same lockup, and replacing it
// with a menu was the same pressure in different clothes. It requires only that
// a logo EXIST and points the form decision at the brief, the one input that
// varies between customers.
const LOGO_REQUIREMENT =
  "This business needs its own logo — decide its form from this brief alone.";

// DEPTH - restored after a sweep flattened commercial work and Ridgeline
// Roofing came back as flat panels of colour. Describes what depth IS; says
// nothing about what goes where, because a fixed stack is one composition
// handed to every business.
const COMMERCIAL_DEPTH =
  "The design is built from layered elements — background color and texture flowing across the body lines, mid-ground graphic motion, and foreground accent detail — with real dimension rather than flat shapes on bare panel.";

// TRANSLATION - turns a NAMED reference in the brief into actual geometry.
// One worked example, not three: examples teach the move, a list of them is a
// list of aesthetics handed to every customer.
const COMMERCIAL_TRANSLATION =
  "Translate anything the brief names into concrete design — color story, layout, graphic motifs, focal treatment (\"stealth bomber\" becomes angular faceted panels with sharp swept edges). What the client named should be obvious at a glance.";

const PHOTO_REALISM_LOCK = `PHOTOGRAPHIC IMAGERY: the scene in this brief is an actual photograph — a real camera image with natural light, true-to-life colour, real depth of field, and real surface texture — occupying its own area of the wrap. Type and logo sit over it as crisp vector art.`;

// The taste a senior designer applies to any brief. The treatment half was
// deliberately left out: applied to every brief it becomes a house style, and
// it is the glossy swept-gradient look that came back three times running.
const PROFESSIONAL_JUDGMENT = `When the brief names a real subject (a home, building, product, landscape, or scene), render it with rich photographic realism — lifelike detail, natural light, depth, and dimension, crisp and high-resolution as if professionally photographed, then printed cleanly onto the vinyl.`;

const FINISH_SPECS = Object.freeze({
  gloss: "GLOSS — wet-look surface, mirror-sharp specular highlights, deep saturated color, visible reflections in the body panels.",
  matte: "MATTE — flat, light-absorbing, no reflections or shine; soft diffuse shading only, chalky and velvety like a matte print.",
  satin: "SATIN — soft feathered sheen between matte and gloss; low reflection, studio lights show as soft glowing patches, never mirror-bright.",
  chrome: "CHROME — mirror-like reflections, maximum specularity, the body panel reflects the surroundings like a polished mirror.",
  brushed: "BRUSHED METAL — directional grain texture, anisotropic reflections that stretch along the brush direction.",
});

function buildLogoArchitecture() {
  return `\nSpell the business name exactly. ${LOGO_REQUIREMENT}`;
}

// Pickups have an OPEN cargo bed and the recurring defect is the wrap flowing
// INTO it, which then smears the flattened proof too. Empty for everything
// else, so a van's prompt is byte-for-byte unchanged.
function truckBedClause(vehicle) {
  const v = (vehicle || "").toLowerCase();
  const isPickup = /\b(f[\s-]?[1234]50|silverado|sierra|ram|tundra|tacoma|colorado|canyon|ranger|maverick|frontier|titan|ridgeline|gladiator|dakota|pickup|crew cab)\b/.test(v);
  return isPickup
    ? " On this pickup, the wrap covers the cab, bed sides, and tailgate exterior; the open bed interior stays bare factory bedliner."
    : "";
}

// DesignPro ILLUSTRATES by default - a real designer's call - and switches to
// photographic realism only when the customer explicitly asks. Scene words
// alone (ranch, sunset, cabin) never trigger it.
function briefWantsPhoto(raw) {
  const t = (raw || "").toLowerCase();
  if (/\b(photo|photos|photograph|photographs|photographic|photo-?realistic|photorealism|photoreal)\b/.test(t)) return true;
  if (/\b(lifelike|true[-\s]to[-\s]life)\b/.test(t)) return true;
  if (/\brealistic\b/.test(t) && /\b(photo|image|render|look|looking|scene|imagery)\b/.test(t)) return true;
  return false;
}

function titleCase(s) {
  return s.split(/\s+/).map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1))).join(" ");
}

function canonicalizeVehicle(make, model, _year) {
  if (!make && !model) return null;
  const m = (make || "").toLowerCase().trim();
  const mo = (model || "").toLowerCase().trim();

  const makeAliases = {
    "tesla": "Tesla",
    "chevy": "Chevrolet",
    "chevrolet": "Chevrolet",
    "gmc": "GMC",
    "vw": "Volkswagen",
    "volkswagen": "Volkswagen",
    "bmw": "BMW",
    "mercedes": "Mercedes-Benz",
    "mercedes-benz": "Mercedes-Benz",
    "mercedes benz": "Mercedes-Benz",
    "mb": "Mercedes-Benz",
    "ford": "Ford",
    "ram": "RAM",
    "dodge": "Dodge",
    "toyota": "Toyota",
    "honda": "Honda",
    "nissan": "Nissan",
    "porsche": "Porsche",
    "audi": "Audi",
    "lexus": "Lexus",
    "kia": "Kia",
    "hyundai": "Hyundai",
    "subaru": "Subaru",
    "jeep": "Jeep",
    "cadillac": "Cadillac",
    "buick": "Buick",
    "rivian": "Rivian",
    "lucid": "Lucid",
    "polestar": "Polestar",
  };

  // Brand-specific model normalizations — only the ones that actually
  // matter for vehicle SHAPE (so Gemini renders the correct geometry).
  const modelAliases = {
    "Tesla": {
      "cyber truck": "Cybertruck",
      "cybertruck": "Cybertruck",
      "cyber-truck": "Cybertruck",
      "ct": "Cybertruck",
      "model s": "Model S",
      "model 3": "Model 3",
      "model x": "Model X",
      "model y": "Model Y",
      "roadster": "Roadster",
      "semi": "Semi",
    },
    "Chevrolet": {
      "silverado": "Silverado 1500",
      "silverado 1500": "Silverado 1500",
      "silverado 2500": "Silverado 2500 HD",
      "silverado 3500": "Silverado 3500 HD",
      "corvette": "Corvette",
      "camaro": "Camaro",
      "tahoe": "Tahoe",
      "suburban": "Suburban",
    },
    "Ford": {
      "f150": "F-150",
      "f 150": "F-150",
      "f-150": "F-150",
      "f250": "F-250",
      "f-250": "F-250",
      "f350": "F-350",
      "f-350": "F-350",
      "mustang": "Mustang",
      "bronco": "Bronco",
    },
    "RAM": {
      "1500": "1500",
      "2500": "2500",
      "3500": "3500",
      "trx": "1500 TRX",
    },
    "GMC": {
      "sierra": "Sierra 1500",
      "sierra 1500": "Sierra 1500",
      "yukon": "Yukon",
      "hummer ev": "Hummer EV",
    },
  };

  const canonicalMake = makeAliases[m] ?? titleCase(m);

  let canonicalModel = "";
  if (mo) {
    const brandTable = modelAliases[canonicalMake];
    canonicalModel = brandTable?.[mo] ?? titleCase(mo);
  }

  const out = [canonicalMake, canonicalModel].filter(Boolean).join(" ");
  return out || null;
}

/**
 * Build the A.C.E. commercial prompt for one view.
 *
 * Assembly order is the proven one and matters: the camera angle is read FIRST
 * and locked, the scene and studio follow, then the concept, then the client
 * brief, then judgment, VisionBoard, photo lock, finish, coverage and the
 * camera spec last.
 */
function buildDesignIQPrompt({
  prompt, finish, companyName, mascot, bulletPoints, industryType, phone,
  brandColors, fontStyle, qrEnabled, vehicleYear, vehicleMake, vehicleModel,
  visionBoardImages, visionboardIntent, viewType, styleDescriptors,
}) {
  const wantsPhoto = briefWantsPhoto(prompt);
  const canonicalMakeModel = canonicalizeVehicle(vehicleMake, vehicleModel, vehicleYear);
  const vehicle = [vehicleYear, canonicalMakeModel || [vehicleMake, vehicleModel].filter(Boolean).join(" ")]
    .filter(Boolean).join(" ");
  const cameraAngle = angles.cameraAngle(viewType || "side");
  const finishSpec = FINISH_SPECS[String(finish || "gloss").toLowerCase()] || FINISH_SPECS.gloss;
  const keywords = (bulletPoints || []).filter((b) => String(b || "").trim());

  const commercialScene = viewType === "hood_detail"
    ? `A photorealistic studio photograph looking down at the hood of a ${vehicle} with a premium commercial vehicle wrap. The wrap is real printed vinyl — the hood design is the hero, showing company branding and graphic elements across the hood surface.`
    : viewType === "roof"
    ? `A photorealistic top-down studio photograph looking straight down at the roof of a ${vehicle} with a premium commercial vehicle wrap. Camera is DIRECTLY ABOVE the vehicle pointing straight down — orthographic flat top-down view, NOT a tilted or angled shot. The roof panel and its wrap design are the only subject. The wrap is real printed vinyl — the roof artwork shows company branding extending across the full roof surface from windshield to rear glass.`
    : viewType === "close-up"
    ? `A photorealistic close-up photograph of a ${vehicle}'s body panel from 12 inches away. The camera is close enough to see the vinyl texture grain, laminate sheen, ink depth, and how the printed design conforms to the body curve. Show a section where the wrap design has detail — pattern, color transitions, or artwork. The body line, panel edge, and surface contour provide context. This is about seeing the MATERIAL QUALITY and DESIGN DETAIL up close.`
    : wantsPhoto
    ? `A photorealistic studio photograph of a ${vehicle} with a premium commercial vehicle wrap fully installed — real printed vinyl, physically applied. Any real-world scene in the brief is a printed photograph on the vinyl, alongside the graphic elements. The company name reads clearly at a glance; how the branding is composed is your creative call.`
    : `A photorealistic studio photograph of a ${vehicle} with a premium commercial vehicle wrap fully installed — real printed vinyl, physically applied. ${COMMERCIAL_DEPTH} The company name reads clearly at a glance; how the branding is composed is your creative call.`;

  let assembled = `You are the senior graphic designer at a sign and wrap company — 20 years of $5,000-per-vehicle commercial fleet graphics, printed on vinyl and installed on real trucks and vans. You amplify each brief into an original design built for this one business — premium, readable at a glance from across a parking lot, and worth what the customer paid.

CAMERA ANGLE (LOCKED — read this FIRST):
${cameraAngle}

${commercialScene}

${STUDIO_ENVIRONMENT}

THE CONCEPT — the heart of this design; build everything around it:
Client's creative direction: "${prompt}"
${COMMERCIAL_TRANSLATION}

CLIENT BRIEF:`;

  if (companyName) {
    assembled += `\nBusiness: ${companyName}.${buildLogoArchitecture()}`;
  } else {
    // Second producer of the logo direction, deliberately interpolating the
    // SAME const rather than matching prose - the two copies drifted before.
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

  if (Array.isArray(visionBoardImages) && visionBoardImages.length > 0) {
    if (visionboardIntent === "exact_reference") {
      assembled += `\n\nEXACT REFERENCE: The provided reference is the customer's own approved wrap design for their vehicle. Recreate it faithfully on the ${vehicle} — keep the colors, patterns, typography, logos, layout, and composition true to the reference, adapting only to fit the ${vehicle}'s body lines and preserving the design's identity, proportions, and visual hierarchy.`;
    } else if (styleDescriptors) {
      assembled += `\n\nSTYLE INSPIRATION: Transform the visual style from the client's reference images into an ORIGINAL wrap design. Style DNA extracted from references:\n${styleDescriptors}\nCreate something new that captures this energy — do not reproduce the reference images directly.`;
    } else {
      assembled += `\n\nSTYLE INSPIRATION: Transform the mood, colors, and artistic style of the provided reference images into an ORIGINAL wrap design for this vehicle. Use them as style inspiration only — create something new that captures their energy.`;
    }
  }

  if (wantsPhoto) assembled += `\n\n${PHOTO_REALISM_LOCK}`;

  assembled += `\n\nFinish: ${String(finish || "Gloss").toUpperCase()} — ${finishSpec} The vinyl finish is ${String(finish || "gloss").toLowerCase()} across ALL body panels — consistent finish on every surface.`;
  assembled += `\nThe wrap covers painted body panels only. Windows, lights, wheels, and trim stay factory.${truckBedClause(vehicle)}`;
  assembled += viewType === "close-up"
    ? `\nCanon EOS R5, 35mm f/4, moderate depth of field. Razor-sharp focus on vinyl surface texture showing depth, material quality, and body curves. Vibrant colors.`
    : `\nCanon EOS R5, 35mm f/8, tack-sharp. 16:9 landscape. Razor-sharp details, perfect exposure, vibrant colors.`;

  return assembled;
}

module.exports = {
  COMMERCIAL_DEPTH,
  COMMERCIAL_TRANSLATION,
  FINISH_SPECS,
  LOGO_REQUIREMENT,
  PHOTO_REALISM_LOCK,
  PROFESSIONAL_JUDGMENT,
  briefWantsPhoto,
  buildDesignIQPrompt,
  buildLogoArchitecture,
  canonicalizeVehicle,
  truckBedClause,
};
