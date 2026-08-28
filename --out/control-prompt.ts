import { STUDIO_ENVIRONMENT } from "./studio-os.ts";
import { getCameraAngle, getAspectRatio, getResolution } from "./view-angles-os.ts";
import { canonicalizeVehicle } from "./render-events-slice.ts";
/**
 * ═══════════════════════════════════════════════════════════════
 *  TRADE SECRET — CONFIDENTIAL & PROPRIETARY
 *  © 2026 RestylePro / LoopMighty Software Development LLC. All rights reserved.
 *
 *  Contains proprietary prompt-engineering / render configuration
 *  that is a TRADE SECRET of RestylePro / LoopMighty Software Development LLC, and
 *  part of the DesignIQ™ / LiftIQ Engine™ architecture
 *  (patent-pending system & methods).
 *
 *  Do NOT copy, publish, distribute, disclose, or reproduce — in
 *  whole or in part — without express written permission. The prompt
 *  text itself must NOT appear in any published patent filing.
 *  See /NOTICE and docs/TRADEMARKS.md. Not legal advice.
 * ═══════════════════════════════════════════════════════════════
 */
/**
 * design-panel-ai-generate
 *
 * DesignIQ Phase 1 edge function.
 * Accepts a DesignIQ prompt payload, enhances it with the wrap intelligence
 * layer, and generates a DIRECT 3D vehicle render via Gemini (NOT a flat panel).
 * Gemini outputs a photorealistic render of the vehicle with the wrap already
 * installed. The render is uploaded to wrap-files bucket and tracked in
 * designiq_generations. Returns { renderUrl, directRender: true }.
 */







// Studio reference removed — using shared STUDIO_ENVIRONMENT from studio-os.ts



// LayerLiftIQ Layer-1: text-free "clean background" prompt builder. Used ONLY when
// the request opts in with layer1Clean:true — the golden hero path is untouched.

// FLAT-FIRST (UNVERIFIED, flag-gated default OFF — see docs/FLAT_FIRST_ARCHITECTURE.md).
// Only used when the caller passes flatMaster:true; the default golden path never
// touches it. Must be render-tested before enabling.



// ATLAS-ARTBOARD (owner directive 2026-08-27): Call 1 executes THIS file's own
// buildDesignIQPrompt — the real DPAG commercial/restyle creative assembly —
// with atlasFlatMaster:true. No separate creative module, no string-replacement
// path: the reconstructed persona bridge is deleted.
const ATLAS_ARTBOARD_AUTHORING_MODEL = "gemini-3-pro-image";
const ATLAS_ARTBOARD_PROMPT_VERSION = "atlas-artboard-designiq.20260828.v6";
const ATLAS_ARTBOARD_SOURCE_COMMIT = "113d137dbe8813ca3bf70c8d7265ad081ebd4524";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-designpro-owner-id",
};

// ---------------------------------------------------------------------------
// DesignIQ NeuralNetwork v3.3 — Wrap Designer Identity + RAG BASE + VisionBoardIQ Intent Gating
//
// Identity: Elite vehicle wrap designer ($5K/design, 20yr experience).
//           NOT a photographer, NOT a graphic designer.
//           Elevates client prompts to pro-level wrap designs.
// RAG BASE: Studio environments imported from _shared/studio-environments.ts
//           (single source of truth). Auto-selects hard light vs soft diffusion
//           based on finish type. Same studio system every render function uses.
// VisionBoardIQ: Multimodal — user images flow to Gemini natively.
//                Intent-aware: exact_reference vs style_inspiration.
// Design DNA: Every render saves its complete genetic record.
// ---------------------------------------------------------------------------

const DESIGNIQ_ENGINE_VERSION = "4.0.0"; // Two-call architecture: Flash naming + Pro image

// ── LayerLiftIQ: Conditional per-industry logo architecture ──────────────
// Lean orchestration: classify the business from name + industry, then inject
// ONLY the matching industry's stylistic codes (not all of them) so the prompt
// stays razor-thin and well under the ~4K quality ceiling. This forces a true
// LOGO ARCHITECTURE — give the model a trade-appropriate TONE but never a fixed
// shape. The previous version appended a fixed "emblem + bordered logo" clause
// to every brief and forced "shield or badge" on every trade, which made every
// logo the same bordered crest. Per product direction (less direction = more
// unique results), set only the mood and let the form be fresh each time.
// THE LOGO IS A DESIGNED MARK, NOT THE NAME IN FANCY LETTERING.
//
// This used to require "the company name in custom, distinctive lettering and
// its own typeface" — a wordmark, mandated. Every logo therefore came out as a
// lettering lockup, and dropped into an emblem it produced the same centred
// badge for three unrelated trades on 2026-07-31 (Iron Horse, Quick Clean,
// Harbor Line). The owner's own reference work does the opposite: Flamingo Pools
// is a pictorial flamingo mark with the name set in plain clean type beside it;
// Evergreen Outdoor Living is a leaf mark with plain type. Neither is custom
// lettering.
//
// The keyword table it carried is gone too. It contributed exactly one adjective
// and classified by regex over the company name, so of the three designs above
// only Iron Horse matched anything — the other two received a byte-identical
// instruction. Asking the model to use what it knows about the trade is both
// shorter and better classification than a hand-maintained word list.
//
// Removed with it: "never generic script" (negative instruction, which Gemini
// over-indexes on) and "two businesses never receive look-alike logos" (the
// model has no knowledge of other customers' logos and cannot act on it).

// THE LOGO REQUIREMENT — ONE literal, shared by BOTH producers.
//
// The commercial path has always had two: buildLogoArchitecture (when the
// companyName FIELD is set) and an inline string (when the customer typed the
// business name into the free brief instead). They drifted apart before — #3950
// found the inline one still mandating the wordmark a full deploy after that
// wording was removed from the other, and the comment there says it plainly:
// "one artifact, two producers, which is how a fix here keeps coming undone.
// Change both or neither." A shared const is the structural version of that
// instruction — there is no longer a second copy TO drift.
//
// It names no form. Not lettering, not a monogram, not a badge, not a menu of
// those — every one of which converged when it was tried, because one fixed
// direction handed to every business is one fixed outcome. It requires only that
// a logo exist and points the form decision at the brief, which is the only
// input that varies from customer to customer.
const LOGO_REQUIREMENT =
  "This business needs its own logo — decide its form from this brief alone.";

// DEPTH — restored 2026-08-03 after the 07-31 sweep flattened commercial work.
//
// #3947 ("stop dictating one composition") deleted the BUILD ORDER block, and it
// was right about the part it named: that block ended with a FIXED stack —
// "Priority: company name, then contact bar, then mascot, then the layered
// design" — which is one composition handed to every business. But it also
// carried the only instruction for DEPTH ("rich custom background… layer
// graphics on top with real depth: a hero focal point, mid-ground motion,
// foreground accents. No flat clipart"), and deleting the whole block took
// depth with the composition order. Commercial renders went flat; live
// 2026-08-03, Ridgeline Roofing & Exteriors came back as flat panels of color.
//
// This restores the depth and keeps the fixed order gone. It is deliberately
// worded as the RESTYLE path words it — that path kept its layered-depth
// framing through the same sweep and still renders correctly, so this is proven
// live text rather than a new invention. It describes what depth IS; it does not
// say what goes where.
const COMMERCIAL_DEPTH =
  "The design is built from layered elements — background color and texture flowing across the body lines, mid-ground graphic motion, and foreground accent detail — with real dimension rather than flat shapes on bare panel.";

// TRANSLATION — restored 2026-08-03, same sweep.
//
// #3952 removed the design instruction from the commercial path entirely, and
// this went with it: the direction that turns a NAMED reference in the brief
// into actual design geometry. Without it a brief that names something concrete
// gets a generic trade wrap that ignores it. The restyle path kept its
// equivalent (DESIGN AMPLIFICATION) and is unaffected — this mirrors it.
//
// The old version carried three worked examples (Ecto-1, stealth bomber,
// samurai armor). One is kept, not three: examples teach the TRANSLATION move,
// but a list of them is also a list of aesthetics handed to every customer,
// which is the convergence failure this file has already been around twice.
const COMMERCIAL_TRANSLATION =
  "Translate anything the brief names into concrete design — color story, layout, graphic motifs, focal treatment (\"stealth bomber\" becomes angular faceted panels with sharp swept edges). What the client named should be obvious at a glance.";

function buildLogoArchitecture(companyName: string, industryType?: string): string {
  // NO FORM PRESCRIBED, DELIBERATELY (owner, 2026-08-01: "remove all word mark
  // or any mention of brand logo — they all look the same").
  //
  // Every version of this block prescribed a form and every version converged.
  // "The company name in custom, distinctive lettering" gave three trades the
  // same lettering lockup. Replacing it with a menu — "pictorial, monogram,
  // abstract symbol or badge" — was still one fixed list handed to every
  // business, which is the same convergence pressure wearing different clothes.
  //
  // The comment here used to claim "The BRAND line already requires the logo to
  // be integrated and legible, so a design cannot come back logo-less." That was
  // FALSE for the path that matters: the BRAND line lives in the ARTBOARD branch,
  // and the COMMERCIAL branch never sees it. #3952 removed the design instruction
  // from commercial entirely, so a commercial brief's only brand direction became
  // "Business: <name>." + "Spell the business name exactly." — nothing asked for a
  // logo, and none came back (live 2026-08-03, Ridgeline Roofing & Exteriors:
  // company name set in a typeface, no logo mark anywhere on the vehicle).
  //
  // So the REQUIREMENT returns and the PRESCRIPTION stays gone. Those are
  // different things, and only the second one caused the convergence: naming a
  // form ("custom, distinctive lettering with its own typeface") handed every
  // trade the same lockup. Requiring that a logo EXIST names no form at all, and
  // the sentence hands the form decision back to the brief — which is the only
  // input that differs between customers.
  return `\nSpell the business name exactly. ${LOGO_REQUIREMENT}`;
}

// Pickup trucks have an OPEN cargo bed. The recurring design defect is the wrap
// flowing INTO the bed (graphics/reflections smeared across the bed floor + inner
// walls), which then also smears the flattened 2D proof. Returns a short coverage
// clause ONLY for pickups; empty for vans/cars/box-trucks so their prompt is
// byte-for-byte unchanged (no token cost on non-pickups).
function truckBedClause(vehicle: string): string {
  const v = (vehicle || "").toLowerCase();
  const isPickup = /\b(f[\s-]?[1234]50|silverado|sierra|ram|tundra|tacoma|colorado|canyon|ranger|maverick|frontier|titan|ridgeline|gladiator|dakota|pickup|crew cab)\b/.test(v);
  return isPickup
    ? " On this pickup, the wrap covers the cab, bed sides, and tailgate exterior; the open bed interior stays bare factory bedliner."
    : "";
}

// ---------------------------------------------------------------------------
// briefWantsPhoto — detect when the brief calls for PHOTOGRAPHIC artwork on the
// wrap (a real photo scene — landscapes, buildings, sunsets, wildlife) rather
// than a stylized/graphic wrap (camo, geometric, abstract linework). This is
// the #1 "why is my wrap a cartoon" complaint: for real-world subjects Gemini
// defaults to illustration/clip-art, so when this fires we inject a hard
// PHOTOGRAPHIC REALISM LOCK. For abstract/graphic briefs it never fires, so the
// golden prompt stays byte-for-byte unchanged and prompt length is untouched.
// ---------------------------------------------------------------------------
function briefWantsPhoto(raw: string): boolean {
  const t = (raw || "").toLowerCase();
  // PHILOSOPHY: DesignPro is a real pro designer — it ILLUSTRATES by default and
  // only switches to photo realism when the CUSTOMER EXPLICITLY ASKS for a photo /
  // photographic / photorealistic result. Scene words alone (ranch, sunset, cabin)
  // do NOT trigger it — a customer can absolutely want a stylized/illustrated ranch.
  if (/\b(photo|photos|photograph|photographs|photographic|photo-?realistic|photorealism|photoreal)\b/.test(t)) return true;
  if (/\b(lifelike|true[-\s]to[-\s]life)\b/.test(t)) return true;
  // "realistic" only counts when it's clearly about a photo/image, not "realistic flames".
  if (/\brealistic\b/.test(t) && /\b(photo|image|render|look|looking|scene|imagery)\b/.test(t)) return true;
  return false;
}

// PHOTOGRAPHIC REALISM — appended ONLY when briefWantsPhoto() fires. Placed late
// so it outranks the earlier scene wording. POSITIVE framing on purpose: Gemini 3
// Pro over-indexes on negated words (saying "not a cartoon" pushes it toward
// cartoon), so we direct a real photograph affirmatively and keep the logo as
// designed vector art.
const PHOTO_REALISM_LOCK = `PHOTOGRAPHIC IMAGERY: the scene in this brief is an actual photograph — a real camera image with natural light, true-to-life colour, real depth of field, and real surface texture — occupying its own area of the wrap. Type and logo sit over it as crisp vector art.`;

// VisionBoardIQ image reference type
interface VisionBoardImage {
  slotLabel: string;
  storageUrl: string;
}

interface DesignIQParams {
  mode: "restyle" | "commercial";
  prompt: string;
  finish: string;
  substrate?: "standard" | "color_change_film" | "chrome_film" | "satin_film";
  companyName?: string;
  mascot?: string;
  bulletPoints?: string[];
  industryType?: string;
  phone?: string;
  website?: string;
  textLayerPrompt?: string;
  brandColors?: string;
  fontStyle?: string;
  qrEnabled?: boolean;
  vehicleYear?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  visionBoardImages?: VisionBoardImage[];
  visionboard_intent?: "style_inspiration" | "exact_reference" | "artboard_projection";
  viewType?: string;
  styleDescriptors?: string;
  layer1Clean?: boolean;
}

// ---------------------------------------------------------------------------
// splitStyleAndText — separate the VISUAL/style portion of a brief (camo,
// rivets, textures, color story) from the BRANDING/text portion (company name,
// logos, slogans, phone, URLs). The CLEAN artboard (Layer 1) is generated from
// the STYLE portion ONLY so the image model never sees a "create a logo / add
// the name" instruction it would otherwise bake in — a "no text" negative alone
// is not reliable. The text portion feeds the Layer-2 overlay engine.
// ---------------------------------------------------------------------------
function splitStyleAndText(raw: string, companyName?: string): { stylePrompt: string; textPrompt: string } {
  const text: string[] = [];
  let style = (raw || "").trim();
  // Quoted strings are almost always brand names / slogans → text layer.
  style = style.replace(/["“”']([^"“”']{2,}?)["“”']/g, (_m, g) => { text.push(String(g).trim()); return " "; });
  // Strip the known company name everywhere it appears.
  if (companyName && companyName.trim()) {
    const re = new RegExp(companyName.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig");
    if (re.test(style)) text.push(companyName.trim());
    style = style.replace(re, " ");
  }
  // Any clause that is a branding/text instruction goes to the text layer;
  // everything else stays as visual style.
  const TEXT_CUE = /\b(logo|text|letter|lettering|font|typeface|wordmark|word|name|brand|branding|slogan|tagline|phone|number|call|website|url|\.com|email|address|24\s*\/?\s*7|hours|service)\b/i;
  const clauses = style.split(/[,;.\n]+|\s+(?:and|with|plus|also|then|featuring|including)\s+/i);
  const styleClauses: string[] = [];
  for (const c of clauses) {
    const t = c.trim();
    if (!t) continue;
    (TEXT_CUE.test(t) ? text : styleClauses).push(t);
  }
  const stylePrompt = styleClauses.join(", ").replace(/\s{2,}/g, " ").trim();
  const textPrompt = text.join(" · ").replace(/\s{2,}/g, " ").trim();
  // Never return an empty style prompt — if the brief was ALL branding, fall
  // back to the raw brief so we still produce a background.
  return { stylePrompt: stylePrompt || (raw || "").trim(), textPrompt };
}

// ---------------------------------------------------------------------------
// buildDesignIQPrompt — Elite vehicle wrap designer. $5K wraps. RAG BASE
// connected via studio-environments.ts (single source of truth).
// ---------------------------------------------------------------------------

// ═══ ATLAS FLAT-MASTER MODE (owner directive, Trish 2026-08-27) ═══
// When `atlasFlatMaster` is true this SAME assembly — the real commercial /
// restyle creative branch, with LOGO_REQUIREMENT, buildLogoArchitecture,
// COMMERCIAL_DEPTH, COMMERCIAL_TRANSLATION, PROFESSIONAL_JUDGMENT, the
// VisionBoard branches, brand colours, finish/substrate, exact customer text
// and the photo-intent lock all firing exactly as they do for a 3D view —
// emits the A.T.L.A.S. flattened-master OUTPUT CONTRACT in place of the
// on-vehicle camera/studio/photograph presentation. Nothing is stripped by a
// later string replacement and there is no second creative implementation:
// the presentation half is a branch inside the authority itself.
const ATLAS_PLACEMENT_WORDS: Record<string, string> = {
  "left-flank": "tall column down the LEFT edge",
  "right-flank": "tall column down the RIGHT edge",
  "center-column": "in the CENTRE column, stacked ROOF then HOOD then FRONT then REAR from the top",
};

function atlasFlatMasterContract(
  panels: Array<{ label: string; surfaceId?: string; placement?: string; widthInches?: number; heightInches?: number }>,
): string {
  const panelLines = (panels || [])
    .map((p) => {
      const id = p.surfaceId ? `${p.surfaceId} \u2014 ` : "";
      const where = p.placement && ATLAS_PLACEMENT_WORDS[p.placement] ? ` \u2014 ${ATLAS_PLACEMENT_WORDS[p.placement]}` : "";
      const size = p.widthInches && p.heightInches ? ` \u2014 ${p.widthInches}" x ${p.heightInches}"` : "";
      return `\u2022 ${id}${p.label}${where}${size}`;
    })
    .join("\n");
  return `OUTPUT FORMAT \u2014 ONE FLAT PRODUCTION MASTER on a single square 4K canvas:
The attached layout guide is the ARTBOARD: a flattened TOP-DOWN TOPOLOGY of the vehicle \u2014 passenger flank as a tall column down the left, the centre column stacked ROOF then HOOD then FRONT then REAR from the top, driver flank as a tall column down the right. Its labeled rectangles are fixed containers at true GENIE panel dimensions with a 5" bleed already included. Paint inside each labeled rectangle; outside the rectangles the canvas stays blank.
Each container shows a DASHED BLUE outline \u2014 that is the printable area, the exact panel crop. Fill it corner to corner and run the artwork past it to the container edge, which is the bleed.
Every container is CAPTIONED beside it with its name, its Surface ID and its pixel size, and the sheet carries a title band, a footer, a faint vehicle silhouette and a grid. All of that is STRUCTURE, not artwork: it lives outside the containers and is cropped away, so paint only inside the rectangles and reproduce none of that lettering.
${panelLines}
FILL EVERY CONTAINER EDGE TO EDGE. Each panel is ONE SOLID RECTANGLE of continuous wrap artwork, opaque corner to corner, with the design running off all four sides of its rectangle. No blank margin, no white gap, no letterboxing, no rounded corner, no frame or border around a panel.
NO BODY LINES. Do not draw door seams, panel gaps, rocker or hood contours, wheel arches, windows, glass, lights, handles, bumpers, a vehicle silhouette, or any cut-out shape. The artwork paints straight THROUGH every place one of those would sit \u2014 the installer cuts the openings from the printed vinyl afterwards, and a line drawn here prints as a line on the wrap.
Paint the FULL rectangle even where the finished vehicle is not wrapped \u2014 a pickup bed opening, for example. Those regions are masked out of the panel by code after you finish, from the vehicle's own geometry. Do not leave a gap, a hole, a dark shape or a soft edge for one, and do not try to draw where it goes.
PASSENGER SIDE is DRIVER SIDE's mirror twin \u2014 the same artwork reversed \u2014 with every word and logo forward-reading on both.
ONE cohesive wrap: the same design flows across all panels as a single artwork laid flat.
Any attached flattened-top-view reference teaches LAYOUT ONLY \u2014 take no artwork, wording, logo, colour or style from it.`;
}

function buildDesignIQPrompt(params: DesignIQParams): string {
  const {
    mode,
    prompt,
    finish,
    substrate,
    companyName,
    mascot,
    bulletPoints,
    phone,
    website,
    textLayerPrompt,
    industryType,
    brandColors,
    fontStyle,
    qrEnabled,
    vehicleYear,
    vehicleMake,
    vehicleModel,
    visionBoardImages,
    visionboard_intent,
    viewType,
    styleDescriptors,
  } = params;

  // Does this brief call for a REAL photographic scene (ranch, sunset, cabins,
  // wildlife, "photo/realistic")? If so the scene sentence and the closing lock
  // both switch to photographic wording so the wrap is a printed PHOTO, not the
  // illustrated/poster default. Non-photo briefs keep the golden wording exactly.
  const wantsPhoto = briefWantsPhoto(prompt);

  // Canonicalize make/model so Gemini sees the proper-noun model name
  // ("Tesla Cybertruck", not "tesla cyber truck") and locks geometry correctly.
  const canonicalMakeModel = canonicalizeVehicle(vehicleMake, vehicleModel, vehicleYear);
  const atlasFlatMaster = (params as any).atlasFlatMaster === true;
  const atlasPanels = Array.isArray((params as any).atlasPanels) ? (params as any).atlasPanels : [];
  const vehicle = [vehicleYear, canonicalMakeModel || [vehicleMake, vehicleModel].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(' ');
  const cameraAngle = getCameraAngle(viewType || 'side');

  // ── ARTBOARD MODE (surgical, additive) ───────────────────────────────
  // When the request is mode === 'artboard', this engine NO LONGER builds a 3D
  // proof — it designs a FLAT PRINT-READY ARTBOARD (all sides as labeled panels)
  // from the natural-language prompt + year/make/model. The 3D proof is produced
  // separately by RecreatePro projecting this artboard (artboard_projection).
  // All other modes (commercial/restyle/projection/view-clone) are untouched.
  // ARTBOARD GENERATOR — fires ONLY for the explicit artboard request
  // (mode === 'artboard'). Every other request (commercial, restyle, view-clone
  // via originalRenderUrl, exact_reference, artboard_projection) does its normal
  // 3D render — so RecreateProAI and the multi-view paths are unaffected.
  if (mode === 'artboard') {
    const sides: Array<{ label: string; widthInches?: number; heightInches?: number }> =
      Array.isArray((params as any).panels) && (params as any).panels.length
        ? (params as any).panels
        : [
            { label: 'DRIVER SIDE' }, { label: 'PASSENGER SIDE' }, { label: 'HOOD' },
            { label: 'ROOF' }, { label: 'FRONT' }, { label: 'REAR' },
          ];
    const panelList = sides
      .map((p) => `• ${p.label}${p.widthInches ? ` — ${p.widthInches}" x ${p.heightInches}"` : ''}`)
      .join('\n');
    // MULTI-LEVEL: artboardClean === true → the WITHOUT-text background version
    // (no logo/text); otherwise the WITH-text branded version.
    const abClean = (params as any).artboardClean === true;
    // CLEAN ARTBOARD = STYLE ONLY. Strip every branding/text instruction out of
    // the brief BEFORE it reaches the image model, so Layer-1 is genuinely
    // text-free (the "no text" negative alone was being ignored). The stripped
    // text feeds the Layer-2 overlay engine as transparent PNGs.
    const { stylePrompt: abStylePrompt } = splitStyleAndText(prompt, companyName);
    const briefForArtboard = abClean ? abStylePrompt : prompt;
    let ab = `You are a Custom Vehicle Wrap Designer at WePrintWraps.com. Design ONE flat, print-ready vehicle-wrap ARTBOARD for a ${vehicle} — the full wrap laid out FLAT as labeled rectangular PANELS on a neutral artboard sheet, one panel per vehicle side, exactly in the format of the EXAMPLE ARTBOARDS provided (a clean-background version and a branded version). The output is flat print artwork on a 2D sheet.

Lay out these panels, each labeled with its name, the wrap artwork filling each panel edge-to-edge, and the SAME cohesive design flowing across every panel as one connected wrap unwrapped flat:
${panelList}

DESIGN BRIEF: "${briefForArtboard}"`;
    // PASS 2: when a clean artboard is attached, recreate it exactly and ADD the
    // branding elements integrated into that same background (the WITH-elements
    // combined version that gets fed to RecreatePro).
    const abAddBranding = (params as any).artboardAddBranding === true;
    if (abAddBranding) ab += `\n\nThe ATTACHED image is the approved CLEAN background artboard for this exact vehicle. RECREATE it EXACTLY — identical panels, layout, colors, and background design — and ADD the branding elements integrated into it. Do not redesign the background.`;
    if (brandColors) ab += `\nBRAND COLORS: ${brandColors} — build the design from this palette.`;
    if (abClean) {
      ab += `\n\nCLEAN BACKGROUND VERSION — design the wrap BACKGROUND only: colors, textures, patterns, and graphic elements filling every panel edge-to-edge. ABSOLUTELY NO text, letters, numbers, words, logos, company names, phone numbers, websites, taglines, or signage of any kind — output ZERO glyphs anywhere on any panel. Leave clean, uncluttered focal zones where the branding will be layered on separately.`;
    } else {
      if (companyName) ab += `\nBRAND: ${companyName} — integrate the company name + logo + a clean contact bar into the design, legible at a glance.${buildLogoArchitecture(companyName, industryType)}`;
      if (phone) ab += `\nCONTACT: ${phone}`;
      if (industryType) ab += `\nINDUSTRY: ${industryType}`;
      if (fontStyle) ab += `\nTYPOGRAPHY: ${fontStyle}`;
      const abKeywords = bulletPoints?.filter((b: string) => b?.trim());
      if (abKeywords?.length) ab += `\nBRAND KEYWORDS (tone, not literal text): ${abKeywords.map((k: string) => k.trim()).join(', ')}`;
    }
    ab += `\nFINISH: ${(finish || 'Gloss')}`;
    // PHOTOGRAPHIC REALISM — when the brief names a real photo scene, the flat
    // artboard artwork itself must be photographic, so the projected 3D wrap is a
    // real photo on the truck (not an illustrated western poster). Only fires on
    // photo briefs; graphic/abstract artboards are unchanged.
    if (wantsPhoto) ab += `\n\n${PHOTO_REALISM_LOCK}`;
    ab += `\n\nGallery-grade custom artwork with real depth, movement, and a wow factor — never generic AI filler, never a template. Match the layout, labeling, and production quality of the example artboards. Output ONE flat 2D artboard sheet showing the labeled rectangular print panels ${abClean ? 'filled with the BACKGROUND DESIGN ONLY — no text, no logos' : 'filled with the branded wrap design'}, drawn straight-on and flat for printing.`;
    return ab;
  }


  const FINISH_SPECS: Record<string, string> = {
    gloss: 'GLOSS — wet-look surface, mirror-sharp specular highlights, deep saturated color, visible reflections in the body panels.',
    matte: 'MATTE — flat, light-absorbing, no reflections or shine; soft diffuse shading only, chalky and velvety like a matte print.',
    satin: 'SATIN — soft feathered sheen between matte and gloss; low reflection, studio lights show as soft glowing patches, never mirror-bright.',
    chrome: 'CHROME — mirror-like reflections, maximum specularity, the body panel reflects the surroundings like a polished mirror.',
    brushed: 'BRUSHED METAL — directional grain texture, anisotropic reflections that stretch along the brush direction.',
  };
  const finishSpec = FINISH_SPECS[(finish || 'gloss').toLowerCase()] || FINISH_SPECS.gloss;

  // Substrate context — tells the AI what base film the design is printed on
  const SUBSTRATE_CONTEXT: Record<string, string> = {
    color_change_film: 'SPECIALTY SUBSTRATE: This design is printed on a color-change specialty base film (metallic, pearl, or color-shift vinyl). The metallic/pearl base film shows through the printed ink layer, creating a luminous, color-shifting effect. Lighter print areas reveal more of the pearl/metallic base. Dark print areas remain opaque. This is printed vinyl with a specialty base layer — NOT chrome paint or automotive metallic paint.',
    chrome_film: 'SPECIALTY SUBSTRATE: This design is printed on a mirror chrome base film. The chrome substrate shows through lighter and transparent areas of the printed design, creating a chrome-through-ink effect. Dark printed areas remain opaque over the chrome. This is printed vinyl on chrome film — NOT chrome paint.',
    satin_film: 'SPECIALTY SUBSTRATE: This design is printed on a satin base film. The satin substrate provides a soft, silk-like sheen underneath the printed design, giving the artwork depth and luminosity. This is printed vinyl on satin film — NOT satin automotive paint.',
  };
  const substrateContext = substrate && substrate !== 'standard' ? SUBSTRATE_CONTEXT[substrate] || '' : '';

  // Studio environment from shared studio-os.ts — same studio as RecreatePro/ColorPro
  const studioEnvironment = STUDIO_ENVIRONMENT;

  // Quality floor — the taste/judgment a senior designer applies to ANY brief,
  // commercial or freestyle. RESTORED 2026-07-27: PR #3677 ("whitepaper") deleted
  // this block from both modes, and every design since converged on the same
  // safe fleet template ("the designs all look the same"). Short and
  // judgment-level so it raises the baseline without bloating the prompt.
  // 2026-07-28 (owner: "all look like illustration slop"): dimensional rendering
  // is now the UNCONDITIONAL default register — the photographic-richness demand
  // previously applied only "when the brief names a real subject", so clean
  // commercial briefs sampled toward flat uniform vector fills.
  // TWO THINGS LIVED IN HERE, AND ONLY ONE OF THEM IS LOAD-BEARING.
  //
  // It used to also mandate a visual TREATMENT for every design — "Render EVERY
  // design's artwork with dimensional, printed-production richness: gradients,
  // lighting, surface texture, and material depth in every graphic element
  // (metallic sheens, atmospheric haze, painterly grain)". Applied to every
  // brief regardless of trade, that is a house style, and it is the glossy
  // swept-gradient look that came back three times running.
  //
  // The 17:35 session on 2026-07-31 deleted this whole block chasing that
  // sameness and lost the PHOTOGRAPHY with it — "cartoon trees, icon mountains,
  // and NO photograph" — so the entire day was reverted, sameness included.
  // Removing only the treatment half is the surgery nobody had tried.
  //
  // What stays: the quality floor, the photographic-realism instruction for real
  // subjects (the reference trucks' pool and patio scenes depend on it), and the
  // anti-clipart line.
  const PROFESSIONAL_JUDGMENT = `When the brief names a real subject (a home, building, product, landscape, or scene), render it with rich photographic realism — lifelike detail, natural light, depth, and dimension, crisp and high-resolution as if professionally photographed, then printed cleanly onto the vinyl.`;

  // ── COMMERCIAL MODE ──────────────────────────────────────────
  // Identity: Elite vehicle wrap designer (NOT photographer, NOT
  // graphic designer). Produces $5K high-end wraps for real
  // customers. Elevates user prompts to professional quality.
  // Uses VisionBoardIQ references like a real wrap designer would.
  if (mode === 'commercial') {
    const keywords = bulletPoints?.filter((b: string) => b?.trim());

    // View-specific scene framing — avoids contradicting camera angle for hood/roof/close-up
    const commercialScene = viewType === 'hood_detail'
      ? `A photorealistic studio photograph looking down at the hood of a ${vehicle} with a premium commercial vehicle wrap. The wrap is real printed vinyl — the hood design is the hero, showing company branding and graphic elements across the hood surface.`
      : viewType === 'roof'
      ? `A photorealistic top-down studio photograph looking straight down at the roof of a ${vehicle} with a premium commercial vehicle wrap. Camera is DIRECTLY ABOVE the vehicle pointing straight down — orthographic flat top-down view, NOT a tilted or angled shot. The roof panel and its wrap design are the only subject. The wrap is real printed vinyl — the roof artwork shows company branding extending across the full roof surface from windshield to rear glass.`
      : viewType === 'close-up'
      ? `A photorealistic close-up photograph of a ${vehicle}'s body panel from 12 inches away. The camera is close enough to see the vinyl texture grain, laminate sheen, ink depth, and how the printed design conforms to the body curve. Show a section where the wrap design has detail — pattern, color transitions, or artwork. The body line, panel edge, and surface contour provide context. This is about seeing the MATERIAL QUALITY and DESIGN DETAIL up close.`
      : wantsPhoto
      ? `A photorealistic studio photograph of a ${vehicle} with a premium commercial vehicle wrap fully installed — real printed vinyl, physically applied. Any real-world scene in the brief is a printed photograph on the vinyl, alongside the graphic elements. The company name reads clearly at a glance; how the branding is composed is your creative call.`
      : `A photorealistic studio photograph of a ${vehicle} with a premium commercial vehicle wrap fully installed — real printed vinyl, physically applied. ${COMMERCIAL_DEPTH} The company name reads clearly at a glance; how the branding is composed is your creative call.`;

    // ATLAS FLAT-MASTER: same creative brief, flat print-production output. The
    // depth requirement and the branding-composition call survive verbatim;
    // only the on-vehicle photograph framing changes.
    const atlasScene = `Design the printed wrap artwork for a ${vehicle} as ONE FLAT print-production master — flat orthographic panels of pure printed vinyl artwork, never an on-vehicle photograph. ${COMMERCIAL_DEPTH} The company name reads clearly at a glance; how the branding is composed is your creative call.`;

    // PERSONA — #3948 ("A.C.E. is a sign-and-wrap-company designer, not a SEMA
    // builder") replaced an "elite… SEMA-caliber" identity, and that call stands:
    // the sign-and-wrap-company framing below is unchanged and the SEMA wording
    // is not coming back. What #3948 also dropped was the QUALITY BAR that
    // identity carried ("You ELEVATE every brief into an original, premium,
    // instantly-readable design"), leaving a persona with a job title and no
    // standard. The second sentence restores the bar inside the identity Trish
    // chose, in the same terms the restyle persona still uses ("amplify each
    // customer's vision… creates something uniquely RIGHT").
    const commercialPresentation = atlasFlatMaster
      ? atlasScene
      : `CAMERA ANGLE (LOCKED — read this FIRST):
${cameraAngle}

${commercialScene}

${studioEnvironment}`;

    let assembled = `You are the senior graphic designer at a sign and wrap company — 20 years of $5,000-per-vehicle commercial fleet graphics, printed on vinyl and installed on real trucks and vans. You amplify each brief into an original design built for this one business — premium, readable at a glance from across a parking lot, and worth what the customer paid.

${commercialPresentation}

THE CONCEPT — the heart of this design; build everything around it:
Client's creative direction: "${prompt}"
${COMMERCIAL_TRANSLATION}

CLIENT BRIEF:`;

    if (companyName) {
      assembled += `\nBusiness: ${companyName}.${buildLogoArchitecture(companyName, industryType)}`;
    } else {
      // Company name wasn't supplied as a field (the customer typed everything in
      // the free brief). Read the business name straight out of the creative
      // direction above and design its logo — so a commercial brief still gets a
      // real designed logo instead of falling back to a name-less, logo-less wrap.
      // SAME INSTRUCTION AS buildLogoArchitecture, DELIBERATELY. This branch is
      // the second producer of the logo direction, and it carried the mandated
      // wordmark ("the company name in custom, distinctive lettering with its
      // own typeface") for a full deploy after that wording was removed from
      // the other path — one artifact, two producers, which is how a fix here
      // keeps coming undone. Change both or neither — now enforced by both
      // interpolating the SAME const rather than by matching prose.
      assembled += `\nIdentify the business name from the creative direction above. Spell it exactly as written in the brief. ${LOGO_REQUIREMENT}`;
    }
    if (phone) {
      assembled += `\nContact info (place in the contact bar): ${phone} — display this EXACT number, digit for digit. Never alter or invent any digits.`;
    } else {
      assembled += `\nNo phone number was provided — do NOT invent, fabricate, or display any phone number, website, email, or address anywhere on the vehicle. Show the company name only.`;
    }
    // EXACT CUSTOMER TEXT, PAIRED PER FIELD. Ported verbatim from
    // runtime/designiq-prompt.cjs's supplementalBrandDirection (owner contract:
    // "keep exact supplied text/contact data; never invent customer
    // information") so the website half and the customer-authored tagline
    // cannot be dropped by a branch that only guards the phone.
    if (website) {
      assembled += `\nWebsite (place in the contact bar): ${website} — display this EXACT URL, character for character. Never alter or invent it.`;
    } else {
      assembled += `\nNo website was supplied — invent no website, email address or street address, and display none anywhere on the design.`;
    }
    if (textLayerPrompt) {
      assembled += `\nTEXT LAYER DIRECTION (customer-authored): ${textLayerPrompt} Preserve every supplied name, slogan, service and contact string exactly; do not invent replacement copy.`;
    }
    if (industryType) assembled += `\nIndustry: ${industryType}`;
    if (brandColors) assembled += `\nBrand colors: ${brandColors} — build the entire design from this palette and do not introduce unrelated colors.`;
    if (fontStyle) assembled += `\nTypography preference: ${fontStyle}.`;
    if (keywords?.length) {
      assembled += `\nBrand keywords (guide tone — not literal on-vehicle text): ${keywords.map((k: string) => k.trim()).join(', ')}`;
    }

    if (mascot) {
      assembled += `\n\nBRAND MASCOT: Design an original, custom-illustrated brand character — ${mascot} — as a premium mascot logo in the spirit of a pro sports or esports emblem: clean bold shapes, a dynamic heroic pose, confident personality, on-brand colors, instantly readable at a glance. Treat it as a bespoke illustration a top studio would charge for — distinctive, polished, and memorable. Anchor the mascot as a hero graphic on the rear quarter panel, sized to complement the company name without crowding it.`;
    }

    if (qrEnabled) {
      assembled += `\n\nQR CODE ZONE: Reserve one clean, flat, evenly-lit rectangular area (roughly 10x10 inches) low on the rear quarter panel — free of graphics, text, and busy color — as space for a scannable QR code added in production. Do not draw a QR code yourself.`;
    }


    assembled += `\n\n${PROFESSIONAL_JUDGMENT}`;

    // VisionBoardIQ — follows Gemini's "high-fidelity detail preservation" and "style transfer" patterns
    if (visionBoardImages && visionBoardImages.length > 0) {
      if (visionboard_intent === 'exact_reference') {
        assembled += `\n\nEXACT REFERENCE: The provided reference is the customer's own approved wrap design for their vehicle. Recreate it faithfully on the ${vehicle} — keep the colors, patterns, typography, logos, layout, and composition true to the reference, adapting only to fit the ${vehicle}'s body lines and preserving the design's identity, proportions, and visual hierarchy.`;
      } else if (styleDescriptors) {
        assembled += `\n\nSTYLE INSPIRATION: Transform the visual style from the client's reference images into an ORIGINAL wrap design. Style DNA extracted from references:\n${styleDescriptors}\nCreate something new that captures this energy — do not reproduce the reference images directly.`;
      } else {
        assembled += `\n\nSTYLE INSPIRATION: Transform the mood, colors, and artistic style of the provided reference images into an ORIGINAL wrap design for this vehicle. Use them as style inspiration only — create something new that captures their energy.`;
      }
    }

    // PHOTOGRAPHIC REALISM LOCK — only when the brief names a real photo scene.
    if (wantsPhoto) assembled += `\n\n${PHOTO_REALISM_LOCK}`;

    assembled += `\n\nFinish: ${(finish || 'Gloss').toUpperCase()} — ${finishSpec} The vinyl finish is ${(finish || 'gloss').toLowerCase()} across ALL body panels — consistent finish on every surface.`;
    if (substrateContext) assembled += `\n${substrateContext}`;
    if (atlasFlatMaster) {
      assembled += `\nThe artwork fills every rectangle edge to edge — solid printed vinyl, corner to corner.`;
      assembled += `\n\n${atlasFlatMasterContract(atlasPanels)}`;
      return assembled;
    }
    assembled += `\nThe wrap covers painted body panels only. Windows, lights, wheels, and trim stay factory.${truckBedClause(vehicle)}`;
    assembled += viewType === 'close-up'
      ? `\nCanon EOS R5, 35mm f/4, moderate depth of field. Razor-sharp focus on vinyl surface texture showing depth, material quality, and body curves. Vibrant colors.`
      : `\nCanon EOS R5, 35mm f/8, tack-sharp. 16:9 landscape. Razor-sharp details, perfect exposure, vibrant colors.`;

    return assembled;
  }

  // ── RESTYLE MODE ─────────────────────────────────────────────
  // Golden prompt structure: ~3,300 chars. Shorter = better for Gemini.
  // Removed per golden baseline: "print production", "AMPLIFY", "car magazine",
  // "DUB or Super Street", "5504x3072", "indistinguishable from a real photograph".

  // RECREATE (exact_reference) = REPRODUCE the uploaded wrap on a DIFFERENT vehicle,
  // not invent a new design. The golden restyle framing ("You are the lead designer…
  // You DESIGN custom wraps" + "Branding is added separately as its own layer") is
  // written to INVENT — for a recreate that framing overrode the reference and
  // produced a similar-but-different design that dropped/altered the logo & text
  // (the "it created a diff design" bug). So when — and ONLY when — the intent is
  // exact_reference do we swap in a copyist identity + reproduction scene. Every
  // non-recreate path (typed briefs, style_inspiration, no visionboard) is byte-for-
  // byte the golden prompt below, untouched.
  const isExactRecreate = visionboard_intent === 'exact_reference';

  // View-specific scene framing — avoids contradicting camera angle for hood/roof/close-up
  const restyleScene = viewType === 'hood_detail'
    ? `A photorealistic studio photograph looking down at the hood of a ${vehicle} with a premium artistic vehicle wrap. The wrap is real printed vinyl — the hood artwork is the hero, rich with layered detail and depth. No text, no logos, no branding.`
    : viewType === 'roof'
    ? `A photorealistic top-down studio photograph looking straight down at the roof of a ${vehicle} with a premium artistic vehicle wrap. Camera is DIRECTLY ABOVE the vehicle pointing straight down — orthographic flat top-down view, NOT a tilted or angled shot. The roof panel and its wrap artwork are the only subject. The wrap is real printed vinyl — rich layered roof artwork extending across the full roof surface from windshield to rear glass. No text, no logos, no branding.`
    : viewType === 'close-up'
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

  // ATLAS FLAT-MASTER: same restyle creative brief and layered-depth
  // requirement, flat print-production output. Camera + studio are 3D-proof
  // presentation and belong to Calls 2-7, never to the flat master.
  const atlasRestyleScene = `Design the printed wrap artwork for a ${vehicle} as ONE FLAT print-production master — flat orthographic panels of pure printed vinyl artwork, never an on-vehicle photograph. The design elevates the brief into a bold, cohesive wrap built from multiple layered thematic elements — a hero focal point across the door panels, with supporting background atmosphere, mid-ground motion, and foreground accent detail — rich with distressed depth and texture.`;
  const restylePresentation = atlasFlatMaster
    ? atlasRestyleScene
    : `CAMERA ANGLE (LOCKED — read this FIRST):
${cameraAngle}

${restyleScene}

${studioEnvironment}`;

  let assembled = `${restyleIdentity}

FINISH LOCK (LOCKED — read this FIRST, applies to every body panel):
${(finish || 'Gloss').toUpperCase()} — ${finishSpec}

${restylePresentation}

Wrap request: "${prompt}"`;

  // DESIGN AMPLIFICATION + the quality floor — RESTORED 2026-07-27 (deleted by
  // PR #3677); skipped for exact recreate, where amplifying would fight the
  // copyist identity.
  if (!isExactRecreate) {
    assembled += `\n\nDESIGN AMPLIFICATION: Elevate and enhance the brief — fill in every decision the client left open with depth, flow, and layered thematic elements. A named subject (for example a vintage B-52 with a 1940s painted pin-up, or an anime hero) becomes a rich, multi-element composition with distressed texture, color harmony, and dimension, custom-designed at a $5,000 studio level — whether the client wrote two words or two paragraphs.

${PROFESSIONAL_JUDGMENT}`;
  }

  // VisionBoardIQ — follows Gemini's "high-fidelity detail preservation" and "style transfer" patterns
  if (visionBoardImages && visionBoardImages.length > 0) {
    if (visionboard_intent === 'artboard_projection') {
      // Map this camera view to the artboard's matching labeled panel so each
      // side reproduces ITS OWN panel (driver→DRIVER SIDE, rear→REAR…), instead
      // of guessing from the whole sheet. This is what keeps the recreated sides
      // matching the artboard sides.
      const viewToPanel: Record<string, string> = {
        side: 'DRIVER SIDE', driver: 'DRIVER SIDE', 'driver-side': 'DRIVER SIDE',
        'passenger-side': 'PASSENGER SIDE', passenger: 'PASSENGER SIDE',
        front: 'FRONT', rear: 'REAR', back: 'REAR',
        roof: 'ROOF/TOP', top: 'ROOF/TOP', hood_detail: 'HOOD', hood: 'HOOD',
      };
      const panelLabel = viewToPanel[(viewType || 'side').toLowerCase()];
      assembled += `\nARTBOARD PROJECTION: The provided image is a FLAT 2D production artboard with each side drawn as a LABELED panel — the approved, locked source of truth for this wrap. Project it onto the ${vehicle}'s painted body panels exactly as drawn: conform the printed vinyl to the body lines, fenders, and wheel-arch contours. Reproduce every graphic, color, pattern, and logo EXACTLY as positioned in the artboard — do NOT redesign, reinterpret, reposition, or add elements. This is a faithful application of an existing print file onto the vehicle.`;
      if (panelLabel) {
        assembled += ` THIS VIEW = the ${panelLabel} of the vehicle: use the artboard's "${panelLabel}" panel as the exact artwork for this side — match that specific panel's design, layout, colors, logos, and text precisely.`;
      }
    } else if (visionboard_intent === 'exact_reference') {
      assembled += `\nEXACT REFERENCE (REPRODUCE, DO NOT REDESIGN): The provided reference is the customer's own approved wrap design. Reproduce it faithfully on the ${vehicle} — keep the exact colors, patterns, graphics, typography, layout, and composition true to the reference, adapting ONLY to fit the ${vehicle}'s body lines while preserving the design's identity, proportions, and visual hierarchy. Reproduce EVERY logo, wordmark, and line of text exactly once, in the same place and style as the reference — branding is PART of this design, never a separate layer to strip, relocate, duplicate, or reinvent. Do NOT redesign, reinterpret, recolor, simplify, or add elements; the ONLY thing that changes is the vehicle the design is applied to. Match the reference's full coverage and texture density — if it is an all-over textured wrap, cover the entire body edge to edge; where the reference leaves the body plain, keep it plain.`;
    } else if (styleDescriptors) {
      assembled += `\nSTYLE INSPIRATION: Transform the visual style from the client's reference images into an ORIGINAL wrap design. Style DNA:\n${styleDescriptors}\nCreate something new that captures this energy — do not reproduce the references directly.`;
    } else {
      assembled += `\nSTYLE INSPIRATION: Transform the mood, colors, and artistic style of the provided reference images into an ORIGINAL wrap design for this vehicle. Use them as style inspiration only — create something new.`;
    }
  }

  // HOOD / ROOF / FRONT CONSISTENCY (applies to EVERY path — restyle, commercial,
  // exact_reference, artboard_projection). The hood shows up in the front view AND
  // the top-down hood view, and the roof in its own view; rendered independently,
  // the AI invents a different layout each time — the "two different hoods" bug.
  // Lock them all to the ONE design so they read as the same wrap.
  if (viewType === 'hood_detail' || viewType === 'hood' || viewType === 'roof' || viewType === 'front') {
    const surface = viewType === 'roof' ? 'roof' : 'hood';
    assembled += `\nHOOD/ROOF CONTINUITY (NON-NEGOTIABLE): The ${surface} carries the SAME single continuous wrap design that flows onto it from the body in this exact wrap — identical colors, graphics, motif, and flow direction. The ${surface} is NOT a separate composition: do not invent, substitute, simplify, mirror, or redraw a different pattern for it. Across the front view and the top-down ${surface} view the ${surface} design must be one and the same — only the camera moves.`;
  }

  // PHOTOGRAPHIC REALISM LOCK — only when the brief names a real photo scene.
  if (wantsPhoto) assembled += `\n\n${PHOTO_REALISM_LOCK}`;

  assembled += `\nFinish: ${(finish || 'Gloss').toUpperCase()} — ${finishSpec} The vinyl finish is ${(finish || 'gloss').toLowerCase()} across ALL body panels — consistent finish on every surface.`;
  if (substrateContext) assembled += `\n${substrateContext}`;
  if (atlasFlatMaster) {
    assembled += `\nThe artwork fills every rectangle edge to edge — solid printed vinyl, corner to corner.`;
    assembled += `\n\n${atlasFlatMasterContract(atlasPanels)}`;
    return assembled;
  }
  assembled += `\nThe wrap covers painted body panels only. Windows, lights, wheels, and trim stay factory.${truckBedClause(vehicle)}`;
  assembled += viewType === 'close-up'
    ? `\nCanon EOS R5, 85mm f/2.8, shallow depth of field with rich bokeh. Razor-sharp focus on vinyl surface texture showing depth, material quality, and fine detail. Vibrant colors.`
    : `\nCanon EOS R5, 35mm f/8, tack-sharp. 16:9 landscape. Razor-sharp details, perfect exposure, vibrant colors.`;

  return assembled;
}

// ---------------------------------------------------------------------------
// analyzeVisionBoardStyles — Extract style descriptors from reference images
// Uses gemini-2.5-flash (analysis model, NOT the render model) to pull
// color palette, art style, mood, composition, texture, and visual weight
// from VisionBoard images. Returns structured text (~400 chars) or null.
// ---------------------------------------------------------------------------

async function analyzeVisionBoardStyles(
  imageParts: Array<{ inlineData: { mimeType: string; data: string } }>
): Promise<string | null> {
  if (imageParts.length === 0) return null;

  try {
    console.log(`[VisionBoardIQ] Analyzing ${imageParts.length} reference image(s) for style descriptors...`);

    const analysisPrompt = `Analyze these reference images and extract their visual style DNA in a concise format. Output ONLY the following categories, one per line:

COLOR PALETTE: List the 3-5 dominant colors with approximate hex values
ART STYLE: The overall artistic style (e.g. cyberpunk, minimalist, graffiti, photorealistic, abstract geometric)
MOOD: The emotional energy (e.g. aggressive, elegant, playful, dark, futuristic)
COMPOSITION: How visual elements are arranged (e.g. flowing curves, sharp angular cuts, radial burst, layered depth)
TEXTURE: Surface quality (e.g. smooth gradients, gritty distressed, metallic sheen, organic splatter)
VISUAL WEIGHT: Where the eye is drawn (e.g. center-heavy, bottom-anchored, diagonal flow left-to-right)

Be specific and concise. No introductions or explanations. Just the six categories.`;

    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
      { text: analysisPrompt },
      ...imageParts,
    ];

    const analysisResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${getGeminiKey()}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            responseMimeType: "text/plain",
            maxOutputTokens: 512,
            // Zero thinking: short descriptive text output, latency-critical
            // (blocks the hero). Documented low-latency setting for 2.5-flash.
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
        signal: AbortSignal.timeout(20_000),
      }
    );

    if (!analysisResponse.ok) {
      console.warn(`[VisionBoardIQ] Style analysis HTTP ${analysisResponse.status} — falling back`);
      return null;
    }

    const analysisData = await analysisResponse.json();
    const analysisParts = analysisData?.candidates?.[0]?.content?.parts;
    if (analysisParts) {
      for (const part of analysisParts) {
        if (part.text) {
          const descriptors = part.text.trim();
          console.log(`[VisionBoardIQ] Style analysis complete (${descriptors.length} chars)`);
          return descriptors;
        }
      }
    }

    console.warn('[VisionBoardIQ] Style analysis returned no text — falling back');
    return null;
  } catch (err) {
    console.warn('[VisionBoardIQ] Style analysis error — falling back:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Edge function handler
// ---------------------------------------------------------------------------

export { buildDesignIQPrompt, briefWantsPhoto, splitStyleAndText };
