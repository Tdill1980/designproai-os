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
 *   ARTBOARD MODE           :331-390  PROFESSIONAL_JUDGMENT   :440
 *   commercial assembly     :447-546
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

// Versioned independently from the A.T.L.A.S. topology prompt so an immutable
// master authored with an older/partial DesignPanel port can never be reused
// after the proven artboard implementation changes.
const DESIGNPANEL_ARTBOARD_PORT_VERSION = "designpanel-ai-generate.artboard.20260827.v4-edge";

// THE MODEL THE AUTHORITY AUTHORS ON, BY NAME.
//
// PINNED BY NAME STAYS. THE NAME CHANGES. (Corrected 2026-08-26, same day.)
//
// The reason for naming a model at all is unchanged and still right: the
// droplet writes GOOGLE_IMAGE_MODEL=gemini-3-pro-image (ops/configure-env.sh),
// and `lockModel` alone pins THE FIRST OF WHATEVER IS CONFIGURED rather than a
// name, so the call that authors the customer's design followed config drift.
// Do not replace this with an env lookup; the projections may follow
// GOOGLE_IMAGE_MODEL, the design authority may not.
//
// The VALUE was wrong, and it was wrong on evidence I gathered myself. It was
// set to the `-preview` alias because design-panel-ai-generate builds that id
// into its endpoint (index.ts:1320), and because ONE A/B pair on the Precision
// Climate Solutions payload had the GA id return a three-quarter van and the
// `-preview` id return the guide's six-zone layout.
//
// Eleven real production runs say the opposite, and they are the stronger
// evidence because they are the actual customer payloads:
//
//   5b2eb96c  22 Aug  v2  GA       all six zones FULL BLEED, seven good proofs
//   87c481ca  23 Aug  v4  GA       centre four full bleed (flanks broken at v4)
//   9dd6d43c  26 Aug  v8  GA       centre four full bleed (flanks still broken)
//   04cc0b29  26 Aug  v8  preview  ALL SIX a picture of a van
//
// Measured as border-vs-interior luminance on the real masters pulled from
// storage: the GA runs hold a border median of 135-177 across the centre four
// on every prompt version from v2 to v8; the first `-preview` run drops it to
// 18-23 with 63-83% of each border dark. The Flamingo master the product is
// judged against was authored on the GA id.
//
// One A/B pair is not eleven production runs, and a single sample on one
// payload is exactly the kind of measurement that should lose to the fleet.
const DESIGNPANEL_AUTHORING_MODEL = "gemini-3-pro-image";

// Names no form. Every version that prescribed one converged - "custom,
// distinctive lettering" handed three trades the same lockup, and replacing it
// with a menu was the same pressure in different clothes. It requires only that
// a logo EXIST and points the form decision at the brief, the one input that
// varies between customers.
//
// RESTORED TO SOURCE PARITY (2026-08-24). The comment above described the
// proven one-sentence requirement, but the string had drifted away from it
// during the port: it re-added a form prescription ("professionally
// art-directed and distinctive", "must feel specific to this company and
// industry") and a NEGATIVE ("must not look like a generic template mark,
// stock icon, or placeholder"). Both are the exact wording the reference
// implementation deleted after live convergence - the owner's report was "they
// all look the same" - and the negative also violates the standing rule that a
// forbidden concept is the one Gemini over-indexes on. The vendored reference
// at supabase/functions/design-panel-ai-generate/index.ts:116 still carries the
// proven text, so the regression is provable inside this repository.
//
// ONE literal, shared by BOTH producers, exactly as the reference keeps it: the
// artboard/A.T.L.A.S. path and the commercial path interpolate this same const,
// so the two can no longer drift apart. Change both or neither.
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

// THE BRANDING IS THE DESIGNER'S TO COMPOSE.
//
// The commercial scene sentence in design-panel-ai-generate ends on this, and
// it is the only place in the whole reference that hands the branding LAYOUT
// decision back to the designer (index.ts:475, and again in its wantsPhoto
// twin). It states the one hard requirement — the name reads at a glance — and
// then explicitly declines to say where the name goes, how big it is, or what
// sits beside it.
//
// It did not travel. The A.T.L.A.S. branch replaced the whole scene sentence
// with "Design ONE flat vehicle-wrap ARTBOARD for a <vehicle>", which is a
// format instruction, and nothing took over the half that was creative
// direction. So the one call that authors the design was told the output
// shape, the topology, the zone geometry and every contact-field lock, and was
// never told that composing the identity is its own call to make.
//
// That is the shape of the reported regression: a technically perfect sheet
// with set type where a designed lockup belongs. RULE 0.1 is explicit that a
// design below baseline means the port is incomplete and never that A.C.E.
// needs something invented for it, so this is the reference's literal, byte
// for byte, and nothing else is added with it.
const COMMERCIAL_BRAND_COMPOSITION =
  "The company name reads clearly at a glance; how the branding is composed is your creative call.";

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
  // Paired per-field guard, the website half. Both builders call this, so the
  // supplied/absent pair for the website lives in exactly one place and cannot
  // be gated on some other field's presence.
  if (website) {
    text += `\nWebsite (place in the contact bar): ${website} — display this EXACT URL, character for character. Never alter or invent it.`;
  } else {
    text += `\nNo website was supplied — invent no website, email address or street address, and display none anywhere on the design.`;
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

// THE RECONSTRUCTED A.T.L.A.S. CREATIVE BRANCH IS DELETED (owner directive,
// Trish 2026-08-26: "stop splitting the creative system across reconstructed
// helpers"). buildAtlasArtboardDesignIQDirection was a re-typed copy of the
// design-panel-ai-generate artboard branch, and it drifted — its SIDE-TWIN
// "photographic scene / landmarks" sentence was the only flank-specific
// language in Call 1 and the prime suspect for the vehicle-silhouette flanks
// broken since v4. The ONE canonical creative implementation is the vendored
// real builder: the deployed design-panel-ai-generate edge function's
// atlas-artboard mode (supabase/functions/_shared/atlas-artboard-prompt.ts,
// supabase/functions/design-panel-ai-generate/index.ts by
// owner directive 2026-08-27), invoked over the network by
// runtime/flat-first-atlas.cjs atlasCreativeRules(). Do not re-add a port.
/**
 * The proven commercial authoring persona, copied byte for byte from
 * design-panel-ai-generate/index.ts:470 -- the branch that authored the
 * commercial designs this system is judged against. A named const so the two
 * cannot drift apart silently, and so a parity test can pin it to the source.
 */
const COMMERCIAL_AUTHORING_PERSONA =
  "You are the senior graphic designer at a sign and wrap company \u2014 20 years of "
  + "$5,000-per-vehicle commercial fleet graphics, printed on vinyl and installed on real "
  + "trucks and vans. You amplify each brief into an original design built for this one "
  + "business \u2014 premium, readable at a glance from across a parking lot, and worth what "
  + "the customer paid.";


// ═══════════════════════════════════════════════════════════════════════════
// THE ARTWORK CALL — DesignIQ craft, aimed at ONE flat banner.
//
// designpro-artboard is the proven flat-first producer on this project: one
// Gemini call makes a wide banner of pure wrap artwork, and CODE composes the
// labelled dimensioned panels from it. Nothing in that call mentions a vehicle,
// a panel, an opening or a zone, which is why it cannot return the die-cut
// silhouettes A.T.L.A.S. Call 1 still produces.
//
// But its prompt is thin — designDescription, finish, "bold cohesive graphics",
// about 450 characters. It carries no COMMERCIAL_DEPTH, no
// COMMERCIAL_TRANSLATION, no photo intent, no brand colours, no industry, no
// substrate, no reference handling. Adopting its architecture as-is would trade
// the die-cut defect for a thin creative brief, which is the other half of the
// same mistake.
//
// So this is the composition the owner asked for, in one function: the FLAT
// ARTWORK OUTPUT CONTRACT from designpro-artboard, carrying the DESIGNIQ
// CREATIVE INTELLIGENCE from design-panel-ai-generate. Every craft block below
// is the same literal the artboard direction already interpolates; what is gone
// is the topology half, because code owns geometry now and none of it needs
// saying.
//
// WHAT IS DELIBERATELY ABSENT, AND WHERE IT WENT INSTEAD:
//
//   LOGO_REQUIREMENT / buildLogoArchitecture / the BRAND composition line ask
//   the MODEL to design and place a mark. They cannot live in this call: the
//   banner is cover-cropped six ways, so any lettering painted into it would be
//   sliced across zones at arbitrary offsets. Branding is composited per zone
//   after the crop -- the `buildOverlay` layer in designpro-artboard, fed by
//   designpro-parse-brief -> designpro-text-layer-generate. Those literals move
//   to that layer rather than being dropped.
//
//   The camera, the studio contract and the coverage rule stay downstream with
//   the 3D proofs, exactly as they already do.
// ═══════════════════════════════════════════════════════════════════════════

// The persona travels as a real system instruction, which is how
// designpro-artboard delivers its own (`system_instruction` at index.ts:110)
// and which A.T.L.A.S. Call 1 has never used at all.
const ATLAS_ARTWORK_SYSTEM_INSTRUCTION = COMMERCIAL_AUTHORING_PERSONA;

function buildAtlasArtworkDirection(input = {}, options = {}) {
  const qualityExampleCount = Number(options.artboardQualityExampleCount) || 0;
  const prompt = String(input.brief || "").trim();
  const mode = String(input.mode || "commercial").toLowerCase();
  const brandColors = String(input.brandColors || "").trim()
    || (Array.isArray(input.colors) ? input.colors.map(String).join(", ") : String(input.colors || "").trim());
  const keywords = Array.isArray(input.bulletPoints)
    ? input.bulletPoints.map((value) => String(value || "").trim()).filter(Boolean) : [];
  const references = Array.isArray(input.visionBoardImages) ? input.visionBoardImages : [];
  const exactReference = references.length > 0
    && ["exact_reference", "artboard_projection"].includes(String(input.visionboardIntent || ""));
  const finish = String(input.finish || "Gloss");
  const finishSpec = FINISH_SPECS[finish.toLowerCase()] || FINISH_SPECS.gloss;

  const assignment = exactReference
    ? "Reproduce the customer's verified approved artwork faithfully as one flat wrap ARTWORK. Do not redesign, restyle, recolor, simplify, correct, or invent."
    : mode === "restyle"
    ? "Create an original artistic vehicle-wrap ARTWORK. Amplify the customer's vision while staying true to it; make every open design decision with the judgment of a senior custom-wrap designer."
    : "Create one original commercial vehicle-wrap ARTWORK worth a professional custom-wrap budget.";

  // The output contract, from designpro-artboard's own artworkPrompt: one wide
  // flat composition, edge to edge, no text and no vehicle.
  let assembled = `${assignment}

Create ONE wide flat vehicle-wrap ARTWORK — a single horizontal banner-style composition. Bold, cohesive graphics that flow left to right with depth and movement, filling the whole frame edge to edge.

THE CONCEPT — the heart of this design; build everything around it:
DESIGN BRIEF: "${prompt}"`;

  if (!exactReference) {
    assembled += mode === "restyle"
      ? `\n\nDESIGN AMPLIFICATION: Elevate and enhance the brief. Fill decisions the customer left open with depth, flow, layered thematic elements, texture, color harmony and dimension. The result must feel custom-designed, never like generic filler or a reusable template.\n${PROFESSIONAL_JUDGMENT}`
      : `\n${COMMERCIAL_TRANSLATION}\n${COMMERCIAL_DEPTH}\n${PROFESSIONAL_JUDGMENT}`;
  }

  if (brandColors) assembled += `\n\nBrand colors: ${brandColors}. Build the design from this palette and introduce no unrelated colors.`;
  if (input.industry) assembled += `\nIndustry: ${String(input.industry)}. The design should read as this trade's work at a glance.`;
  if (keywords.length) assembled += `\nBrand keywords (tone, not literal copy): ${keywords.join(", ")}.`;

  if (references.length) {
    if (exactReference) {
      assembled += "\n\nEXACT CUSTOMER REFERENCE: The verified customer reference images attached are the artwork authority. Reproduce their graphics, palette, composition, coverage density and visual hierarchy faithfully.";
    } else if (input.styleDescriptors) {
      assembled += `\n\nSTYLE INSPIRATION: Create original artwork using this verified reference style DNA: ${String(input.styleDescriptors)}. Do not copy the reference composition or branding.`;
    } else {
      assembled += "\n\nSTYLE INSPIRATION: Use the verified customer references only for mood, palette and artistic language; create an original composition and do not copy their branding.";
    }
  }

  if (briefWantsPhoto(prompt)) assembled += `\n\n${PHOTO_REALISM_LOCK}`;
  assembled += `\n\nFINISH: ${finish.toUpperCase()} — ${finishSpec}`;
  const substrateSpec = substrateContext(input.substrate);
  if (substrateSpec) assembled += `\n${substrateSpec}`;

  // THE ONE THING THIS CALL MUST NOT DRAW.
  //
  // The banner is cover-cropped into six surfaces, so lettering painted here
  // would be sliced across zones at arbitrary offsets. Branding is a composited
  // layer, which is also what makes the passenger flank a safe deterministic
  // mirror of the driver.
  assembled += "\n\nPURE ARTWORK ONLY: no text, no letters, no words, no numbers, no logos, no signage — and no vehicle, no panels, no mockup, no shadows. This is flat wrap graphics on its own, nothing else. The company name and contact details are added afterwards as a separate layer.";

  assembled += "\n\nGallery-grade custom artwork with real depth, movement, and a wow factor — never generic AI filler, never a template. "
    + (qualityExampleCount > 0
      ? "Match the production quality of the provided gold-standard DesignPanel artboards. "
      : "")
    + "Output ONE flat wide 2D artwork image.";
  return assembled;
}

// Compatibility export for the already-shipped caller. New Atlas wiring should
// use the explicit artboard name so this cannot be mistaken for a proof prompt.
// buildFlatDesignIQDirection (the compatibility alias for the reconstructed
// branch) is deleted with it — the canonical Call 1 creative path is
// runtime/flat-first-atlas.cjs atlasCreativeRules() over the vendored builder.

/**
 * THE LOGO CONDITION IS STRUCTURAL, NOT A HOPE. (Owner persona contract, 2026-08-26.)
 *
 * Three states, decided by the INPUT and nothing else:
 *
 *   supplied  a verified customer logo is attached -> it is the authority
 *   auto      a business brief with no usable logo -> DESIGN one
 *   none      not a business brief                 -> no logo demand at all
 *
 * WHY THE SECOND STATE NEEDED MORE THAN LOGO_REQUIREMENT. That literal — "This
 * business needs its own logo — decide its form from this brief alone" — is the
 * reference's own wording and stays byte-identical, because the reference
 * deleted every FORM prescription after all of them converged ("custom,
 * distinctive lettering" handed three trades the same lockup; replacing it with
 * a menu was the same pressure in different clothes).
 *
 * But requiring that a logo EXIST does not rule out the degenerate way to
 * satisfy it, and the reference's own history records that exact failure: live
 * 2026-08-03, Ridgeline Roofing & Exteriors came back with "company name set in
 * a typeface, no logo mark anywhere on the vehicle". Set type is not a mark, and
 * a brief that asks for a business wrap has not been designed until it has one.
 *
 * So this names the degenerate OUTCOME without naming a form to replace it with.
 * The mark's shape, register and construction stay the designer's call and the
 * brief's; what is refused is answering "make a logo" with the company name in a
 * font. That is the whole of the addition.
 */
const LOGO_AUTHORING_RULE =
  "Design an actual brand mark for it — the company name set in a typeface is not a logo, "
  + "however well it is set. The name may lock up with the mark, sit beside it or be built "
  + "into it; the mark's form, register and construction are your call and the brief's.";

/** supplied | auto | none — decided by the input, never by the prose. */
function logoCondition(input = {}) {
  if (input?.logoAsset) return "supplied";
  const mode = String(input?.mode || "commercial");
  const isBusiness = mode !== "restyle";
  return isBusiness ? "auto" : "none";
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
    ? " On this pickup, the wrap covers the cab, bed sides, and tailgate EXTERIOR only; the open bed interior stays bare factory bedliner. The entire cargo-bed interior—including bed floor, inner bed walls, wheel-well humps, rails, and bedliner—must remain bare factory material with zero printed artwork. Artwork visible inside the open bed is a failed result."
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
  // PER-FIELD PAIRED GUARD, the phone half. The reference makes this the `else`
  // of `if (phone)` (design-panel-ai-generate/index.ts:503). The port moved it
  // behind `!phone && !website`, which only fires when BOTH are absent — so a
  // populated website suppressed the phone guard, and a website-without-phone
  // brief reached the model with nothing forbidding an invented number.
  //
  // Coupling two independent fields into one condition is the defect. Each
  // field now decides its own instruction: supplied -> preserve exactly,
  // absent -> invent nothing for that field. The website half lives in
  // supplementalBrandDirection() so each field's pair stays in one place.
  else {
    assembled += `\nNo phone number was provided — do NOT invent, fabricate, or display any phone number anywhere on the vehicle.`;
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
  ATLAS_ARTWORK_SYSTEM_INSTRUCTION,
  buildAtlasArtworkDirection,
  COMMERCIAL_BRAND_COMPOSITION,
  DESIGNPANEL_AUTHORING_MODEL,
  COMMERCIAL_DEPTH,
  COMMERCIAL_TRANSLATION,
  FINISH_SPECS,
  LOGO_REQUIREMENT,
  LOGO_AUTHORING_RULE,
  logoCondition,
  PHOTO_REALISM_LOCK,
  PROFESSIONAL_JUDGMENT,
  SUBSTRATE_CONTEXT,
  DESIGNPANEL_ARTBOARD_PORT_VERSION,
  briefWantsPhoto,
  COMMERCIAL_AUTHORING_PERSONA,
  buildDesignIQPrompt,
  buildLogoArchitecture,
  buildRestylePrompt,
  canonicalizeVehicle,
  substrateContext,
  truckBedClause,
};
