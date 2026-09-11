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

// Ported from design-panel-ai-generate. Finish describes the laminate/surface;
// substrate describes the film beneath the ink. Dropping the latter made
// color-shift and chrome-through-ink selections render like ordinary paint.
const SUBSTRATE_CONTEXT = Object.freeze({
  color_change_film: "SPECIALTY SUBSTRATE: This design is printed on a color-change specialty base film (metallic, pearl, or color-shift vinyl). The metallic/pearl base film shows through the printed ink layer, creating a luminous, color-shifting effect. Lighter print areas reveal more of the pearl/metallic base. Dark print areas remain opaque. This is printed vinyl with a specialty base layer — NOT chrome paint or automotive metallic paint.",
  chrome_film: "SPECIALTY SUBSTRATE: This design is printed on a mirror chrome base film. The chrome substrate shows through lighter and transparent areas of the printed design, creating a chrome-through-ink effect. Dark printed areas remain opaque over the chrome. This is printed vinyl on chrome film — NOT chrome paint.",
  satin_film: "SPECIALTY SUBSTRATE: This design is printed on a satin base film. The satin substrate provides a soft, silk-like sheen underneath the printed design, giving the artwork depth and luminosity. This is printed vinyl on satin film — NOT satin automotive paint.",
});

function substrateContext(substrate) {
  const key = String(substrate || "standard").toLowerCase();
  return key === "standard" ? "" : SUBSTRATE_CONTEXT[key] || "";
}

function supplementalBrandDirection({ website, qrEnabled, qrUrl, textLayerPrompt }) {
  let text = "";
  if (website) {
    text += `\nWebsite (place in the contact bar): ${website} — display this EXACT URL, character for character. Never alter or invent it.`;
  }
  if (textLayerPrompt) {
    text += `\nTEXT LAYER DIRECTION (customer-authored): ${textLayerPrompt} Preserve every supplied name, slogan, service and contact string exactly; do not invent replacement copy.`;
  }
  if (qrEnabled) {
    text += `\n\nQR CODE ZONE: Reserve one clean, flat, evenly-lit rectangular area (roughly 10x10 inches) low on the rear quarter panel — free of graphics, text, and busy color — as space for a scannable QR code added in production. Do not draw a QR code yourself.`;
    if (qrUrl) text += ` The production QR destination is ${qrUrl}; this is placement identity only, not permission to print or rewrite the URL.`;
  }
  return text;
}

/**
 * The proven DesignIQ creative brain for the one flat A.T.L.A.S. authoring
 * call. It deliberately contains no camera, studio or 3D-vehicle scene: those
 * belong only to downstream proof projection. Everything that decides what the
 * design IS remains here, so "flat first" does not become "generic first".
 */
function buildFlatDesignIQDirection(input = {}) {
  const prompt = String(input.brief || "").trim();
  const mode = String(input.mode || "commercial").toLowerCase();
  const companyName = String(input.companyName || input.businessName || "").trim();
  const phone = String(input.phone || "").trim();
  const website = String(input.website || "").trim();
  const brandColors = String(input.brandColors || "").trim()
    || (Array.isArray(input.colors) ? input.colors.map(String).join(", ") : String(input.colors || "").trim());
  const keywords = Array.isArray(input.bulletPoints)
    ? input.bulletPoints.map((value) => String(value || "").trim()).filter(Boolean) : [];
  const references = Array.isArray(input.visionBoardImages) ? input.visionBoardImages : [];
  const exactReference = references.length > 0
    && ["exact_reference", "artboard_projection"].includes(String(input.visionboardIntent || ""));
  const finish = String(input.finish || "Gloss");
  const finishSpec = FINISH_SPECS[finish.toLowerCase()] || FINISH_SPECS.gloss;

  const identity = exactReference
    ? "You are a vehicle-wrap REPRODUCTION specialist. Reproduce the customer's verified approved artwork faithfully in one continuous FLAT unwrapped atlas. Do not redesign, restyle, recolor, simplify, correct, or invent; adapt only to the locked atlas zones."
    : mode === "restyle"
    ? "You are WePrintWraps.com Lead Vehicle Wrap Designer. Create an original, gallery-grade artistic wrap as one continuous FLAT unwrapped atlas. Amplify the customer's vision while staying true to it; make every open design decision with the judgment of a senior custom-wrap designer."
    : "You are the senior graphic designer at a sign and wrap company with 20 years of premium commercial fleet-graphics experience. Create one original, readable-at-a-glance commercial design as a continuous FLAT unwrapped atlas, worth a professional custom-wrap budget.";

  let assembled = `${identity}

THE CONCEPT — the heart of this design; build every connected atlas zone around it:
Customer creative direction: "${prompt}"`;

  if (!exactReference) {
    assembled += mode === "restyle"
      ? `\n\nDESIGN AMPLIFICATION: Elevate and enhance the brief. Fill decisions the customer left open with depth, flow, layered thematic elements, texture, color harmony and dimension. The result must feel custom-designed, never like generic filler or a reusable template.\n${PROFESSIONAL_JUDGMENT}`
      : `\n${COMMERCIAL_TRANSLATION}\n${COMMERCIAL_DEPTH}\n${PROFESSIONAL_JUDGMENT}`;
  }

  assembled += "\n\nCUSTOMER IDENTITY AND DESIGN LOCKS:";
  if (companyName) {
    assembled += `\nBusiness: ${companyName}. Spell it exactly.`;
    assembled += input.logoAsset
      ? " The attached verified customer-owned logo is the logo authority; preserve its form, spelling, proportions and palette exactly and never invent a substitute."
      : buildLogoArchitecture();
  } else if (mode === "commercial") {
    assembled += `\nIdentify the business name only from the customer's creative direction and spell it exactly. ${LOGO_REQUIREMENT}`;
  }
  if (phone) assembled += `\nPhone: ${phone} — preserve every digit exactly.`;
  if (!phone && !website) assembled += "\nNo contact information was supplied; invent no phone number, website, email or address.";
  assembled += supplementalBrandDirection({
    website,
    qrEnabled: input.qrEnabled === true,
    qrUrl: input.qrUrl,
    textLayerPrompt: input.textLayerPrompt,
  });
  if (input.industry) assembled += `\nIndustry: ${String(input.industry)}.`;
  if (brandColors) assembled += `\nBrand colors: ${brandColors}. Build the design from this palette and introduce no unrelated colors.`;
  if (input.fontStyle) assembled += `\nTypography preference: ${String(input.fontStyle)}.`;
  if (keywords.length) assembled += `\nBrand keywords (tone, not automatic literal copy): ${keywords.join(", ")}.`;
  if (input.mascot) assembled += `\nBrand mascot: ${String(input.mascot)}. Render one distinctive, polished character identity consistently wherever it crosses related atlas zones.`;

  if (references.length) {
    if (exactReference) {
      assembled += "\n\nEXACT CUSTOMER REFERENCE: The verified customer reference images attached after the topology examples are the artwork authority. Reproduce their graphics, palette, typography, logos, composition, coverage density and visual hierarchy faithfully across the flat atlas. Installer-map examples remain topology-only and must never influence style.";
    } else if (input.styleDescriptors) {
      assembled += `\n\nSTYLE INSPIRATION: Create original artwork using this verified reference style DNA: ${String(input.styleDescriptors)}. Do not copy the reference composition or branding.`;
    } else {
      assembled += "\n\nSTYLE INSPIRATION: Use the verified customer references only for mood, palette and artistic language; create an original wrap composition and do not copy their branding.";
    }
  }

  if (briefWantsPhoto(prompt)) assembled += `\n\n${PHOTO_REALISM_LOCK}`;
  assembled += `\n\nFINISH LOCK: ${finish.toUpperCase()} — ${finishSpec} Keep this finish intent consistent across every connected atlas zone.`;
  const substrateSpec = substrateContext(input.substrate);
  if (substrateSpec) assembled += `\n${substrateSpec}`;
  assembled += "\nThe atlas is flat wrap artwork only: no camera, no studio, no vehicle photograph, no wheels, windows, lights, shadows, mockup, annotations or template graphics.";
  return assembled;
}

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
 * Build the A.C.E. RESTYLE prompt for one view.
 *
 * Ported verbatim from restylepro-os design-panel-ai-generate index.ts:553-651
 * — the golden restyle assembly. This half of A.C.E. had no port at all: the
 * standalone runtime ran every brief, restyle or not, through the commercial
 * trade-wrap persona. A Martini livery has no company name, phone or industry,
 * so the commercial assembly had nothing to build from.
 *
 * Every prompt string here is byte-identical to the source. The wording IS the
 * fix, exactly as it is in the commercial half below.
 *
 * The substrate context is also shared with the commercial persona now that
 * the standalone request carries that existing DesignIQ control.
 */
function buildRestylePrompt({
  prompt, finish, finishSpec, vehicle, cameraAngle, viewType, wantsPhoto,
  visionBoardImages, visionboardIntent, styleDescriptors, substrate,
  website, qrEnabled, qrUrl, textLayerPrompt,
}) {
  // The golden restyle framing is written to INVENT. For an exact recreate that
  // framing overrode the reference and produced a similar-but-different design
  // that dropped or altered the logo and text. So when — and ONLY when — the
  // intent is exact_reference do we swap in a copyist identity and reproduction
  // scene. Every other path is byte-for-byte the golden prompt.
  const isExactRecreate = visionboardIntent === "exact_reference";

  // View-specific scene framing — avoids contradicting the camera angle for
  // hood/roof/close-up.
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

  // Copyist identity for recreate; the golden designer identity for every other path.
  const restyleIdentity = isExactRecreate
    ? `You are a vehicle wrap REPRODUCTION specialist at WePrintWraps.com. Your job is to reproduce an existing, approved wrap design EXACTLY as shown in the reference image, re-fitted onto a different vehicle. You do NOT redesign, restyle, recolor, simplify, or invent — you copy the reference faithfully, including every logo and line of text, and change only the vehicle it sits on. If the reference image contains anything besides the design itself (a browser window, app interface, dark panels, menus, thumbnails, captions), IGNORE all of that completely — reproduce ONLY the wrap design shown on the vehicle within it, at FULL fidelity. Copy EVERY design element at its true relative size and position: colored panels, swooshes, and shapes behind or around the logo are part of the design — never drop, shrink, or simplify them, and never shrink the logo lockup.`
    : `You are WePrintWraps.com Lead Vehicle Wrap Designer. You create both restyle and commercial wraps with depth and texture — your designs are seen in car shows around the world. You take a customer's order and create amazing, modern vehicle wrap designs that we sell to wrap shops who then print and install them on real vehicles. You amplify each customer's vision while staying true to their request — a chameleon who reads every brief, absorbs references, and creates something uniquely RIGHT.`;

  let assembled = `${restyleIdentity}

FINISH LOCK (LOCKED — read this FIRST, applies to every body panel):
${String(finish || "Gloss").toUpperCase()} — ${finishSpec}

CAMERA ANGLE (LOCKED — read this FIRST):
${cameraAngle}

${restyleScene}

${STUDIO_ENVIRONMENT}

Wrap request: "${prompt}"`;

  // DESIGN AMPLIFICATION + the quality floor. Skipped for exact recreate, where
  // amplifying would fight the copyist identity.
  if (!isExactRecreate) {
    assembled += `\n\nDESIGN AMPLIFICATION: Elevate and enhance the brief — fill in every decision the client left open with depth, flow, and layered thematic elements. A named subject (for example a vintage B-52 with a 1940s painted pin-up, or an anime hero) becomes a rich, multi-element composition with distressed texture, color harmony, and dimension, custom-designed at a $5,000 studio level — whether the client wrote two words or two paragraphs.

${PROFESSIONAL_JUDGMENT}`;
  }

  // VisionBoardIQ — Gemini's high-fidelity detail preservation / style transfer
  // patterns. artboard_projection is carried across for port fidelity; it fires
  // only if a caller sets that intent, and nothing in this runtime does.
  if (Array.isArray(visionBoardImages) && visionBoardImages.length > 0) {
    if (visionboardIntent === "artboard_projection") {
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
    } else if (visionboardIntent === "exact_reference") {
      assembled += `\nEXACT REFERENCE (REPRODUCE, DO NOT REDESIGN): The provided reference is the customer's own approved wrap design. Reproduce it faithfully on the ${vehicle} — keep the exact colors, patterns, graphics, typography, layout, and composition true to the reference, adapting ONLY to fit the ${vehicle}'s body lines while preserving the design's identity, proportions, and visual hierarchy. Reproduce EVERY logo, wordmark, and line of text exactly once, in the same place and style as the reference — branding is PART of this design, never a separate layer to strip, relocate, duplicate, or reinvent. Do NOT redesign, reinterpret, recolor, simplify, or add elements; the ONLY thing that changes is the vehicle the design is applied to. Match the reference's full coverage and texture density — if it is an all-over textured wrap, cover the entire body edge to edge; where the reference leaves the body plain, keep it plain.`;
    } else if (styleDescriptors) {
      assembled += `\nSTYLE INSPIRATION: Transform the visual style from the client's reference images into an ORIGINAL wrap design. Style DNA:\n${styleDescriptors}\nCreate something new that captures this energy — do not reproduce the references directly.`;
    } else {
      assembled += `\nSTYLE INSPIRATION: Transform the mood, colors, and artistic style of the provided reference images into an ORIGINAL wrap design for this vehicle. Use them as style inspiration only — create something new.`;
    }
  }

  // HOOD / ROOF / FRONT CONSISTENCY. The hood shows up in the front view AND the
  // top-down hood view, and the roof in its own view; rendered independently the
  // model invents a different layout each time — the "two different hoods" bug.
  if (viewType === "hood_detail" || viewType === "hood" || viewType === "roof" || viewType === "front") {
    const surface = viewType === "roof" ? "roof" : "hood";
    assembled += `\nHOOD/ROOF CONTINUITY (NON-NEGOTIABLE): The ${surface} carries the SAME single continuous wrap design that flows onto it from the body in this exact wrap — identical colors, graphics, motif, and flow direction. The ${surface} is NOT a separate composition: do not invent, substitute, simplify, mirror, or redraw a different pattern for it. Across the front view and the top-down ${surface} view the ${surface} design must be one and the same — only the camera moves.`;
  }

  // PHOTOGRAPHIC REALISM LOCK — only when the brief names a real photo scene.
  if (wantsPhoto) assembled += `\n\n${PHOTO_REALISM_LOCK}`;

  assembled += `\nFinish: ${String(finish || "Gloss").toUpperCase()} — ${finishSpec} The vinyl finish is ${String(finish || "gloss").toLowerCase()} across ALL body panels — consistent finish on every surface.`;
  const substrateSpec = substrateContext(substrate);
  if (substrateSpec) assembled += `\n${substrateSpec}`;
  assembled += supplementalBrandDirection({ website, qrEnabled, qrUrl, textLayerPrompt });
  assembled += `\nThe wrap covers painted body panels only. Windows, lights, wheels, and trim stay factory.${truckBedClause(vehicle)}`;
  assembled += viewType === "close-up"
    ? `\nCanon EOS R5, 85mm f/2.8, shallow depth of field with rich bokeh. Razor-sharp focus on vinyl surface texture showing depth, material quality, and fine detail. Vibrant colors.`
    : `\nCanon EOS R5, 35mm f/8, tack-sharp. 16:9 landscape. Razor-sharp details, perfect exposure, vibrant colors.`;

  return assembled;
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
  prompt, finish, substrate, companyName, mascot, bulletPoints, industryType,
  phone, website, brandColors, fontStyle, qrEnabled, qrUrl, textLayerPrompt,
  vehicleYear, vehicleMake, vehicleModel, visionBoardImages, visionboardIntent,
  viewType, styleDescriptors, mode, logoAsset,
}) {
  const wantsPhoto = briefWantsPhoto(prompt);
  const canonicalMakeModel = canonicalizeVehicle(vehicleMake, vehicleModel, vehicleYear);
  const vehicle = [vehicleYear, canonicalMakeModel || [vehicleMake, vehicleModel].filter(Boolean).join(" ")]
    .filter(Boolean).join(" ");
  const cameraAngle = angles.cameraAngle(viewType || "side");
  const finishSpec = FINISH_SPECS[String(finish || "gloss").toLowerCase()] || FINISH_SPECS.gloss;
  const keywords = (bulletPoints || []).filter((b) => String(b || "").trim());

  // The mode the customer's design was created under decides the persona, the
  // same way index.ts:446 does. Commercial stays the default so an unset mode
  // behaves exactly as it did before the restyle half was ported.
  if (String(mode || "").toLowerCase() === "restyle") {
    return buildRestylePrompt({
      prompt, finish, finishSpec, vehicle, cameraAngle, viewType, wantsPhoto,
      visionBoardImages, visionboardIntent, styleDescriptors, substrate,
      website, qrEnabled, qrUrl, textLayerPrompt,
    });
  }

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
    assembled += `\nBusiness: ${companyName}.`;
    assembled += logoAsset
      ? " The attached verified customer-owned logo is the sole logo authority. Preserve its exact form, spelling, proportions, and palette; do not invent, redraw, simplify, or substitute it."
      : buildLogoArchitecture();
  } else {
    // Second producer of the logo direction, deliberately interpolating the
    // SAME const rather than matching prose - the two copies drifted before.
    assembled += `\nIdentify the business name from the creative direction above. Spell it exactly as written in the brief. ${LOGO_REQUIREMENT}`;
  }
  if (phone) {
    assembled += `\nContact info (place in the contact bar): ${phone} — display this EXACT number, digit for digit. Never alter or invent any digits.`;
  }
  if (!phone && !website) {
    assembled += `\nNo phone number was provided — do NOT invent, fabricate, or display any phone number, website, email, or address anywhere on the vehicle. Show the company name only.`;
  }
  assembled += supplementalBrandDirection({ website, qrEnabled, qrUrl, textLayerPrompt });
  if (industryType) assembled += `\nIndustry: ${industryType}`;
  if (brandColors) assembled += `\nBrand colors: ${brandColors} — build the entire design from this palette and do not introduce unrelated colors.`;
  if (fontStyle) assembled += `\nTypography preference: ${fontStyle}.`;
  if (keywords.length) {
    assembled += `\nBrand keywords (guide tone — not literal on-vehicle text): ${keywords.map((k) => String(k).trim()).join(", ")}`;
  }
  if (mascot) {
    assembled += `\n\nBRAND MASCOT: Design an original, custom-illustrated brand character — ${mascot} — as a premium mascot logo in the spirit of a pro sports or esports emblem: clean bold shapes, a dynamic heroic pose, confident personality, on-brand colors, instantly readable at a glance. Treat it as a bespoke illustration a top studio would charge for — distinctive, polished, and memorable. Anchor the mascot as a hero graphic on the rear quarter panel, sized to complement the company name without crowding it.`;
  }
  assembled += `\n\n${PROFESSIONAL_JUDGMENT}`;

  if (Array.isArray(visionBoardImages) && visionBoardImages.length > 0) {
    if (visionboardIntent === "artboard_projection") {
      const viewToPanel = {
        side: "DRIVER SIDE", driver: "DRIVER SIDE", "driver-side": "DRIVER SIDE",
        "passenger-side": "PASSENGER SIDE", passenger: "PASSENGER SIDE",
        front: "FRONT", rear: "REAR", back: "REAR",
        roof: "ROOF/TOP", top: "ROOF/TOP", hood_detail: "HOOD", hood: "HOOD",
      };
      const panelLabel = viewToPanel[String(viewType || "side").toLowerCase()];
      assembled += `\n\nARTBOARD PROJECTION: The provided customer-owned image is the approved flat wrap artboard. Project its graphics onto the ${vehicle} without redesigning, recoloring, repositioning, or adding elements.`;
      if (panelLabel) {
        assembled += ` This camera view must use the artboard's ${panelLabel} region as its exact artwork source.`;
      }
    } else if (visionboardIntent === "exact_reference") {
      assembled += `\n\nEXACT REFERENCE: The provided reference is the customer's own approved wrap design for their vehicle. Recreate it faithfully on the ${vehicle} — keep the colors, patterns, typography, logos, layout, and composition true to the reference, adapting only to fit the ${vehicle}'s body lines and preserving the design's identity, proportions, and visual hierarchy.`;
    } else if (styleDescriptors) {
      assembled += `\n\nSTYLE INSPIRATION: Transform the visual style from the client's reference images into an ORIGINAL wrap design. Style DNA extracted from references:\n${styleDescriptors}\nCreate something new that captures this energy — do not reproduce the reference images directly.`;
    } else {
      assembled += `\n\nSTYLE INSPIRATION: Transform the mood, colors, and artistic style of the provided reference images into an ORIGINAL wrap design for this vehicle. Use them as style inspiration only — create something new that captures their energy.`;
    }
  }

  if (wantsPhoto) assembled += `\n\n${PHOTO_REALISM_LOCK}`;

  assembled += `\n\nFinish: ${String(finish || "Gloss").toUpperCase()} — ${finishSpec} The vinyl finish is ${String(finish || "gloss").toLowerCase()} across ALL body panels — consistent finish on every surface.`;
  const substrateSpec = substrateContext(substrate);
  if (substrateSpec) assembled += `\n${substrateSpec}`;
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
  SUBSTRATE_CONTEXT,
  briefWantsPhoto,
  buildDesignIQPrompt,
  buildFlatDesignIQDirection,
  buildLogoArchitecture,
  buildRestylePrompt,
  canonicalizeVehicle,
  substrateContext,
  truckBedClause,
};
