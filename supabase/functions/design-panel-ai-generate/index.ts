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

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encode as encodeBase64, decode as decodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { tokenGate } from "../_shared/token-gate.ts";
import { captureDesignDNA } from "../_shared/design-dna-capture.ts";
import { STUDIO_ENVIRONMENT } from "../_shared/studio-os.ts";
// Studio reference removed — using shared STUDIO_ENVIRONMENT from studio-os.ts
import { getCameraAngle, getAspectRatio, getResolution, WRAP_COVERAGE_RULES } from "../_shared/view-angles-os.ts";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";
import { emitRenderEvent, canonicalizeVehicle } from "../_shared/render-events.ts";
// LayerLiftIQ Layer-1: text-free "clean background" prompt builder. Used ONLY when
// the request opts in with layer1Clean:true — the golden hero path is untouched.
import { buildLayer1CleanPrompt } from "../_shared/layer1-clean-prompt.ts";
// FLAT-FIRST (UNVERIFIED, flag-gated default OFF — see docs/FLAT_FIRST_ARCHITECTURE.md).
// Only used when the caller passes flatMaster:true; the default golden path never
// touches it. Must be render-tested before enabling.
import { buildFlatMasterPrompt } from "../_shared/flat-master-prompt.ts";
import { resolveArtboardPanels, loadArtboardExamples } from "../_shared/artboard-template-os.ts";
import { resolveDesignProInternalCaller } from "../_shared/designpro-internal-call.ts";
// ATLAS-ARTBOARD (owner directive 2026-08-27): Call 1 executes THIS file's own
// buildDesignIQPrompt — the real DPAG commercial/restyle creative assembly —
// with atlasFlatMaster:true. No separate creative module, no string-replacement
// path: the reconstructed persona bridge is deleted.
const ATLAS_ARTBOARD_AUTHORING_MODEL = "gemini-3-pro-image";
const ATLAS_ARTBOARD_PROMPT_VERSION = "atlas-artboard-designiq.20260901.v23-orthographic-restored";
const ATLAS_ARTBOARD_SOURCE_COMMIT = "113d137dbe8813ca3bf70c8d7265ad081ebd4524";
const ATLAS_ARTBOARD_MODEL_REQUEST_MAX_BYTES = 20 * 1024 * 1024 - 256 * 1024;
// NO EXPLICIT TEMPERATURE (owner ruling, 2026-09-01). DID-2D918868 -- the
// last master that came back near-working -- sent no temperature field at all,
// so Gemini applied its own default. `7ee1f868` pinned 1.0 on the same commit
// that changed six other things, and it has never been isolated. A parity
// recovery does not introduce even a plausible config difference: the field
// stays absent until an A/B proves it earns its place.
// THE MANDATORY OWNER-APPROVED LABELED FLAMINGO A.T.L.A.S. TEACHING PROOF
// (exact owner bytes, 2026-09-01). Its labels establish panel identity; its
// physical arrangement is NOT target-vehicle geometry authority — the
// GENIE-derived normalized [0,1] topology in the request is. The labels are
// instructional annotations only and must never appear in a generated master.
const ATLAS_TEACHING_PROOF_MAX_BYTES = 6 * 1024 * 1024;
const ATLAS_TEACHING_PROOF_CONTRACT = "designpro.atlas-labeled-teaching-proof.v3";
const ATLAS_TEACHING_PROOF_PURPOSE = "atlas-object-model-and-panel-identity";
const ATLAS_TEACHING_PROOF_VERSION = 3;
const ATLAS_TEACHING_PROOF_HASH = "684534d27f8e7d70771f4931d9d1119ec73d2a28db774abcc4e343eb6e5e3ded";
const ATLAS_TEACHING_PROOF_BYTES = 3430273;
// The normalized mathematical topology contract folded into provenance.
const ATLAS_TOPOLOGY_CONTRACT = "designpro.atlas-normalized-topology.v1";

/**
 * The Edge function is an independent deployment, so it must enforce the same
 * immutable teaching identity as the runtime instead of trusting a caller to
 * describe whichever Storage object it supplied.
 */
export function validateAtlasTeachingProofIdentity(value: unknown): Record<string, unknown> {
  const identity = value && typeof value === "object"
    ? value as Record<string, unknown>
    : null;
  if (!identity
    || identity.contract !== ATLAS_TEACHING_PROOF_CONTRACT
    || identity.purpose !== ATLAS_TEACHING_PROOF_PURPOSE
    || identity.version !== ATLAS_TEACHING_PROOF_VERSION
    || identity.flattenedTopViewContentHash !== ATLAS_TEACHING_PROOF_HASH
    || identity.flattenedTopViewByteSize !== ATLAS_TEACHING_PROOF_BYTES
    || ATLAS_TEACHING_PROOF_BYTES > ATLAS_TEACHING_PROOF_MAX_BYTES) {
    throw new Error("atlas_artboard_teaching_proof_identity_invalid");
  }
  return identity;
}

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
  vehicleType?: string;
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
/** Strings only, capped, or nothing. A malformed topology is simply absent. */
function atlasPanelTopology(value: unknown): AtlasPanelTopology | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const names = (input: unknown) => (Array.isArray(input) ? input : [])
    .map((item) => String(item || "").trim().toUpperCase())
    .filter((item) => item.length > 0 && item.length <= 40)
    .slice(0, 8);
  const frontToRear = names(raw.frontToRear);
  if (!frontToRear.length) return undefined;
  return {
    bodyStyle: String(raw.bodyStyle || "").trim().slice(0, 24) || undefined,
    frontToRear,
    fullLengthBands: names(raw.fullLengthBands),
    paintThrough: true,
  };
}

type AtlasPanelTopology = {
  bodyStyle?: string;
  frontToRear?: string[];
  fullLengthBands?: string[];
  paintThrough?: boolean;
};

/**
 * Resolve the body class from server-supplied identity only. This is prompt
 * context, never geometry: GENIE remains the sole dimensional authority and no
 * second model call is allowed to classify the vehicle.
 */
function atlasVehicleBodyClass(declaredType?: string): string {
  const normalized = String(declaredType || "").trim().toLowerCase().replace(/[ -]+/g, "_");
  const canonical = new Set([
    "car", "truck", "suv", "van", "motorcycle", "boat", "bus", "rv",
    "trailer", "aircraft", "heavy_equipment",
  ]);
  if (normalized === "pickup") return "truck";
  return canonical.has(normalized) ? normalized : "vehicle";
}

// THE PICKUP COVERAGE PARAGRAPH IS GONE FROM CALL 1. (2026-08-31)
//
// `atlasIsPickup` and the PICKUP COVERAGE block it gated were removed from the
// authoring contract, not relocated. The block named "exterior cab", "exterior
// bed sides", "tailgate exterior", "open bed floor", "inner bed walls" and
// "bare factory bedliner" -- six pieces of physical vehicle anatomy -- and
// attached them BY NAME to Driver Side and Passenger Side. Those are the exact
// two surfaces that come back as a vehicle side elevation while the centre four
// stay clean, the flank regression CLAUDE.md measured across eleven runs from
// v4 onward. Live on Desert Ridge (c3a8ff40): both flanks returned a van body
// with window and wheel-arch shapes; hood, roof, front and rear were correct.
//
// It also contradicted itself -- it described a bed exclusion and then told the
// model not to draw one. RULE 0.28 §5 and RULE 0.0 both already place that
// exclusion downstream: "that physical exclusion belongs to downstream vehicle
// application/proof mapping, not Call 1". It is carried there, in the A.T.L.A.S.
// proof producer, sliced from the pinned WRAP_COVERAGE_RULES. Call 1 does not
// need it and was harmed by it.
//
// `truckBedClause` is untouched and still serves the 3D render path below.

/**
 * CALL-1 FINISH, FROM THE CUSTOMER'S OWN SELECTION.
 *
 * The selected Gloss / Matte / Satin / Chrome / Brushed value arrives on the
 * request and picks its spec out of the shared FINISH_SPECS table exactly as it
 * always has -- no finish is invented or pinned here, and that table is not
 * edited. Two adjustments apply to the FLAT master only. The entries already
 * open with the finish name, so the caller must not prefix it a second time
 * ("Finish: GLOSS - GLOSS - ..."). And two of them describe the sheen landing
 * on physical BODY PANELS, which is vehicle anatomy Call 1 must never be
 * taught; Calls 2-8 keep the pinned wording verbatim, because a body panel is
 * exactly what the photographer is photographing.
 */
function atlasFinishSpec(finishSpec: string): string {
  return finishSpec
    .replace("visible reflections in the body panels.", "visible reflections in the printed graphic elements.")
    .replace("the body panel reflects the surroundings like a polished mirror.", "the artwork reflects the surroundings like a polished mirror.");
}

function atlasFlatMasterContract(
  panels: Array<{
    label: string;
    surfaceId?: string;
    placement?: string;
  }>,
  vehicle: string,
  bodyClass: string,
): string {
  const expected = new Map([
    ["DRIVER SIDE", { surfaceId: "DS", placement: "right-flank" }],
    ["PASSENGER SIDE", { surfaceId: "PS", placement: "left-flank" }],
    ["HOOD", { surfaceId: "HD", placement: "center-column" }],
    ["ROOF", { surfaceId: "RF", placement: "center-column" }],
    ["FRONT", { surfaceId: "FR", placement: "center-column" }],
    ["REAR", { surfaceId: "RR", placement: "center-column" }],
  ]);
  const supplied = new Map((panels || []).map((panel) => [
    String(panel.label || "").trim().toUpperCase(), panel,
  ]));
  const missing = [...expected.keys()].filter((label) => !supplied.has(label));
  if (missing.length) {
    throw new Error(`ATLAS panel identity incomplete: ${missing.join(", ")}`);
  }
  for (const [label, identity] of expected) {
    const panel = supplied.get(label)!;
    if (String(panel.surfaceId || "").trim().toUpperCase() !== identity.surfaceId
      || String(panel.placement || "").trim() !== identity.placement) {
      throw new Error(`ATLAS panel identity mismatch: ${label}`);
    }
  }
  // THE PANEL LIST IS PLACEMENT, NOT A CONTAINER ASSIGNMENT TABLE.
  //
  // It used to read "left tall rectangle maps to Passenger Side (internal ID
  // PS)" six times over -- 6 "maps to", 7 "internal ID" -- which hands the
  // model six addressed containers and six separate creative problems. The
  // proven RestylePro artboard prompt (design-panel-ai-generate mode:'artboard',
  // restylepro-os) lists the sides as plain bullets and spends its words on the
  // opposite idea: "the SAME cohesive design flowing across every panel as one
  // connected wrap unwrapped flat".
  //
  // Surface identity, coordinates, rotations and the cut stay in the OS, on
  // manifest.zones, exactly as before. The model gets only the left/right/centre
  // relationship it needs for the composition to land in the right places.
  const panelLines = [
    "• PASSENGER SIDE — the tall panel down the left",
    "• DRIVER SIDE — the tall panel down the right",
    "• REAR, then ROOF, then HOOD, then FRONT — the centre column, top to bottom",
  ].join("\n");
  return `OUTPUT FORMAT — ONE FLAT A.T.L.A.S. ARTBOARD on one square 4K canvas.
Design ONE flat vehicle-wrap A.T.L.A.S. ARTBOARD for this exact ${vehicle || "customer vehicle"} (${bodyClass}) — the full wrap laid out FLAT as rectangular print panels on one sheet — the complete flattened panel layout of the vehicle. The output is flat print artwork on a 2D sheet.

Lay out these panels, the wrap artwork filling each panel edge to edge, and the SAME cohesive design flowing across every panel as ONE CONNECTED WRAP UNWRAPPED FLAT:
${panelLines}

Fill every panel corner to corner; the space between panels is sheet separation. Set no panel names, surface IDs, legends or captions anywhere in the artwork — those words are for the server, never for the sheet.

One wrap, unwrapped. The left and right flanks are the two sides of the SAME vehicle carrying the SAME design — the palette, the imagery, the motion and the branding continue from one to the other, and a person walking around the finished truck sees one design, not two. The centre panels carry that same composition across the ${bodyClass}'s top and ends. Customer-facing wording reads normally on every panel.

Every panel is opaque, unbroken and full-bleed to all four edges: flat printed graphic art, the same kind of image as a printed poster or a roll of printed vinyl laid flat on a table. It is the artwork by itself, before anything is cut or applied. Customer-requested photographic imagery is a photograph printed INTO that flat art. Vehicle appearance, installed boundaries and presentation lighting are produced downstream by the seven proof projections and are absent here.

Gallery-grade custom artwork with real depth, movement and a wow factor — never generic AI filler, never a template. Output ONE flat 2D artboard sheet, drawn straight-on and flat for printing.`;
}

// ── GENIE-DERIVED NORMALIZED [0,1] MATHEMATICAL TOPOLOGY ────────────────────
// The OS owns the math; the AI owns only the creative pixels. Each region
// arrives as x/y/width/height already divided by the canvas (computed by the
// runtime from `manifest.zones`), serialized to exactly four decimals. The
// edge re-validates every value so a malformed caller cannot hand Gemini a
// topology the manifest never produced. Only
// `surface | x | y | width | height | orientation` reaches the model — no
// IDs, hashes, storage paths, gutters or production metadata.
type AtlasNormalizedRect = { x: string; y: string; width: string; height: string; orientation: string };

function atlasNormalizedRect(value: unknown, label: string): AtlasNormalizedRect {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  if (!raw) throw new Error(`atlas_artboard_topology_invalid:${label}`);
  const dim = (key: string) => {
    const n = Number(raw[key]);
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      throw new Error(`atlas_artboard_topology_invalid:${label}:${key}`);
    }
    return n.toFixed(4);
  };
  const orientation = String(raw.orientation || "").trim();
  if (!/^(upright|rotated [+-]\d{1,3}°)$/.test(orientation)) {
    throw new Error(`atlas_artboard_topology_invalid:${label}:orientation`);
  }
  return { x: dim("x"), y: dim("y"), width: dim("width"), height: dim("height"), orientation };
}

/**
 * The model-facing A.T.L.A.S. TARGET TOPOLOGY text part. The rule paragraph is
 * the owner boundary contract's model-facing topology rule, verbatim in
 * substance: placement and relative proportion only, ONE cohesive design,
 * ONE CONNECTED WRAP UNWRAPPED FLAT.
 */
function atlasTopologyText(
  panels: Array<{ label: string; normalized?: AtlasNormalizedRect }>,
  vehicle: string,
  bodyClass: string,
): string {
  const rows = panels.map((panel) => {
    const n = panel.normalized;
    if (!n) throw new Error(`atlas_artboard_topology_invalid:${panel.label}`);
    return `${panel.label} | ${n.x} | ${n.y} | ${n.width} | ${n.height} | ${n.orientation}`;
  });
  return `A.T.L.A.S. TARGET TOPOLOGY — ${vehicle || "customer vehicle"} (${bodyClass}).

These coordinates describe the panel layout of ONE complete vehicle wrap unwrapped flat. They define placement and relative proportion only. All regions belong to ONE cohesive design. Passenger and Driver are the two sides of the SAME vehicle and must clearly carry the SAME design system. Rear, Roof, Hood, and Front continue that same composition. Create ONE CONNECTED WRAP UNWRAPPED FLAT across the complete A.T.L.A.S. topology.

surface | x | y | width | height | orientation
${rows.join("\n")}`;
}

/**
 * Preserve the customer's vehicle-wrap language. Only whitespace is
 * normalized; physical placement words are design intent and must reach the
 * one Call-1 creative authority unchanged.
 */
function atlasCreativeDirection(value: string): string {
  return String(value || "")
    .replace(/\s{2,}/g, " ")
    .trim();
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
    vehicleType,
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
  const atlasBodyClass = atlasVehicleBodyClass(vehicleType);

  const creativeDirection = atlasFlatMaster ? atlasCreativeDirection(prompt) : prompt;
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
    const atlasScene = `Design the printed wrap artwork for a ${vehicle} (${atlasBodyClass}) as ONE FLAT print-production master — flat orthographic panels of pure printed vinyl artwork, never an on-vehicle photograph. This is the single design authority for the complete vehicle, not six independent graphics. The design is built from layered elements — background color and texture flowing across the panels, mid-ground graphic motion, and foreground accent detail — with real dimension rather than flat shapes on bare panel. The company name reads clearly at a glance; how the branding is composed is your creative call.`;

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

    const commercialIdentity = atlasFlatMaster
      ? `You are the senior vehicle-wrap designer at a sign and wrap company — 20 years of $5,000-per-vehicle commercial fleet graphics, printed on vinyl and installed on real trucks and vans. You amplify each brief into an original design built for this one business — premium, readable at a glance from across a parking lot, and worth what the customer paid.`
      : `You are the senior graphic designer at a sign and wrap company — 20 years of $5,000-per-vehicle commercial fleet graphics, printed on vinyl and installed on real trucks and vans. You amplify each brief into an original design built for this one business — premium, readable at a glance from across a parking lot, and worth what the customer paid.`;

    let assembled = `${commercialIdentity}

${commercialPresentation}

THE CONCEPT — the heart of this design; build everything around it:
Client's creative direction: "${creativeDirection}"
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
      assembled += atlasFlatMaster
        ? `\nNo phone number was provided — show the company name only and add no contact information.`
        : `\nNo phone number was provided — do NOT invent, fabricate, or display any phone number, website, email, or address anywhere on the vehicle. Show the company name only.`;
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
      assembled += atlasFlatMaster
        ? `\n\nBRAND MASCOT: Design an original, custom-illustrated brand character — ${mascot} — as a premium mascot logo in the spirit of a pro sports or esports emblem: clean bold shapes, a dynamic heroic pose, confident personality, on-brand colors, instantly readable at a glance. Treat it as a bespoke illustration a top studio would charge for — distinctive, polished, and memorable. Integrate it as a coordinated hero graphic in both flank fields, sized to complement the company name without crowding it.`
        : `\n\nBRAND MASCOT: Design an original, custom-illustrated brand character — ${mascot} — as a premium mascot logo in the spirit of a pro sports or esports emblem: clean bold shapes, a dynamic heroic pose, confident personality, on-brand colors, instantly readable at a glance. Treat it as a bespoke illustration a top studio would charge for — distinctive, polished, and memorable. Anchor the mascot as a hero graphic on the rear quarter panel, sized to complement the company name without crowding it.`;
    }

    if (qrEnabled) {
      assembled += atlasFlatMaster
        ? `\n\nQR CODE ZONE: Reserve one clean, flat rectangular area in the coordinated lower portion of each flank field as space for a scannable QR code added in production.`
        : `\n\nQR CODE ZONE: Reserve one clean, flat, evenly-lit rectangular area (roughly 10x10 inches) low on the rear quarter panel — free of graphics, text, and busy color — as space for a scannable QR code added in production. Do not draw a QR code yourself.`;
    }


    assembled += `\n\n${PROFESSIONAL_JUDGMENT}`;

    // VisionBoardIQ — follows Gemini's "high-fidelity detail preservation" and "style transfer" patterns
    if (visionBoardImages && visionBoardImages.length > 0) {
      if (visionboard_intent === 'exact_reference') {
        assembled += atlasFlatMaster
          ? `\n\nEXACT REFERENCE: The provided reference is the customer's approved artwork authority. Recreate its colors, patterns, typography, logos, layout, composition, proportions and visual hierarchy faithfully across the six mapped livery fields.`
          : `\n\nEXACT REFERENCE: The provided reference is the customer's own approved wrap design for their vehicle. Recreate it faithfully on the ${vehicle} — keep the colors, patterns, typography, logos, layout, and composition true to the reference, adapting only to fit the ${vehicle}'s body lines and preserving the design's identity, proportions, and visual hierarchy.`;
      } else if (styleDescriptors) {
        assembled += `\n\nSTYLE INSPIRATION: Transform the visual style from the client's reference images into an ORIGINAL wrap design. Style DNA extracted from references:\n${styleDescriptors}\nCreate something new that captures this energy — do not reproduce the reference images directly.`;
      } else {
        assembled += atlasFlatMaster
          ? `\n\nSTYLE INSPIRATION: Transform the mood, colors, and artistic style of the provided reference images into an ORIGINAL six-field livery. Use them as style inspiration only — create something new that captures their energy.`
          : `\n\nSTYLE INSPIRATION: Transform the mood, colors, and artistic style of the provided reference images into an ORIGINAL wrap design for this vehicle. Use them as style inspiration only — create something new that captures their energy.`;
      }
    }

    // PHOTOGRAPHIC REALISM LOCK — only when the brief names a real photo scene.
    if (wantsPhoto) assembled += `\n\n${PHOTO_REALISM_LOCK}`;

    if (atlasFlatMaster) {
      assembled += `\nFinish: ${atlasFinishSpec(finishSpec)} The vinyl finish is ${(finish || 'gloss').toLowerCase()} across every panel — consistent finish on every surface.\nThe artwork fills every rectangle edge to edge — solid printed vinyl, corner to corner.`;
      assembled += `\n\n${atlasFlatMasterContract(atlasPanels, vehicle, atlasBodyClass)}`;
      return assembled;
    }
    assembled += `\n\nFinish: ${(finish || 'Gloss').toUpperCase()} — ${finishSpec} The vinyl finish is ${(finish || 'gloss').toLowerCase()} across ALL body panels — consistent finish on every surface.`;
    if (substrateContext) assembled += `\n${substrateContext}`;
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
  const restyleIdentity = atlasFlatMaster
    ? isExactRecreate
      ? `You are a vehicle wrap REPRODUCTION specialist at WePrintWraps.com. Reproduce the customer's approved wrap faithfully as one cohesive flattened A.T.L.A.S. for the exact target vehicle, including every supplied color, graphic, pattern, logo, wordmark and line of text at its true relative scale and position.`
      : `You are WePrintWraps.com Lead Vehicle Wrap Designer. You create premium vehicle wraps with depth and texture that are printed and installed on real vehicles. You amplify each customer's vision while staying true to their request — a chameleon who reads every brief, absorbs references, and creates something uniquely RIGHT.`
    : isExactRecreate
      ? `You are a vehicle wrap REPRODUCTION specialist at WePrintWraps.com. Your job is to reproduce an existing, approved wrap design EXACTLY as shown in the reference image, re-fitted onto a different vehicle. You do NOT redesign, restyle, recolor, simplify, or invent — you copy the reference faithfully, including every logo and line of text, and change only the vehicle it sits on. If the reference image contains anything besides the design itself (a browser window, app interface, dark panels, menus, thumbnails, captions), IGNORE all of that completely — reproduce ONLY the wrap design shown on the vehicle within it, at FULL fidelity. Copy EVERY design element at its true relative size and position: colored panels, swooshes, and shapes behind or around the logo are part of the design — never drop, shrink, or simplify them, and never shrink the logo lockup.`
      : `You are WePrintWraps.com Lead Vehicle Wrap Designer. You create both restyle and commercial wraps with depth and texture — your designs are seen in car shows around the world. You take a customer's order and create amazing, modern vehicle wrap designs that we sell to wrap shops who then print and install them on real vehicles. You amplify each customer's vision while staying true to their request — a chameleon who reads every brief, absorbs references, and creates something uniquely RIGHT.`;

  // ATLAS FLAT-MASTER: same restyle creative brief and layered-depth
  // requirement, flat print-production output. Camera + studio are 3D-proof
  // presentation and belong to Calls 2-7, never to the flat master.
  const atlasRestyleScene = `Design the printed wrap artwork for a ${vehicle} (${atlasBodyClass}) as ONE FLAT print-production master — flat orthographic panels of pure printed vinyl artwork, never an on-vehicle photograph. This is the single design authority for the complete vehicle, not six independent graphics. Elevate the brief into a bold composition built from layered thematic elements — background atmosphere, mid-ground motion, foreground accent detail and a strong focal treatment — rich with depth and texture, with real dimension rather than flat shapes on bare panel.`;
  const restylePresentation = atlasFlatMaster
    ? atlasRestyleScene
    : `CAMERA ANGLE (LOCKED — read this FIRST):
${cameraAngle}

${restyleScene}

${studioEnvironment}`;

  const restyleFinish = atlasFlatMaster
    ? `PRINT COLOR: uniform artwork color across all six fields. Physical finish is applied only in downstream proof projections.`
    : `FINISH LOCK (LOCKED — read this FIRST, applies to every body panel):
${(finish || 'Gloss').toUpperCase()} — ${finishSpec}`;

  let assembled = `${restyleIdentity}

${restyleFinish}

${restylePresentation}

Wrap request: "${creativeDirection}"`;

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
      assembled += atlasFlatMaster
        ? `\nEXACT REFERENCE (REPRODUCE, DO NOT REDESIGN): The provided reference is the customer's approved artwork authority. Reproduce its exact colors, patterns, graphics, typography, layout, composition, logos, wordmarks and supplied text faithfully across the six mapped livery fields. Preserve its proportions, hierarchy, coverage and texture density.`
        : `\nEXACT REFERENCE (REPRODUCE, DO NOT REDESIGN): The provided reference is the customer's own approved wrap design. Reproduce it faithfully on the ${vehicle} — keep the exact colors, patterns, graphics, typography, layout, and composition true to the reference, adapting ONLY to fit the ${vehicle}'s body lines while preserving the design's identity, proportions, and visual hierarchy. Reproduce EVERY logo, wordmark, and line of text exactly once, in the same place and style as the reference — branding is PART of this design, never a separate layer to strip, relocate, duplicate, or reinvent. Do NOT redesign, reinterpret, recolor, simplify, or add elements; the ONLY thing that changes is the vehicle the design is applied to. Match the reference's full coverage and texture density — if it is an all-over textured wrap, cover the entire body edge to edge; where the reference leaves the body plain, keep it plain.`;
    } else if (styleDescriptors) {
      assembled += `\nSTYLE INSPIRATION: Transform the visual style from the client's reference images into an ORIGINAL wrap design. Style DNA:\n${styleDescriptors}\nCreate something new that captures this energy — do not reproduce the references directly.`;
    } else {
      assembled += atlasFlatMaster
        ? `\nSTYLE INSPIRATION: Transform the mood, colors, and artistic style of the provided reference images into an ORIGINAL six-field livery. Use them as style inspiration only — create something new.`
        : `\nSTYLE INSPIRATION: Transform the mood, colors, and artistic style of the provided reference images into an ORIGINAL wrap design for this vehicle. Use them as style inspiration only — create something new.`;
    }
  }

  // HOOD / ROOF / FRONT CONSISTENCY (applies to EVERY path — restyle, commercial,
  // exact_reference, artboard_projection). The hood shows up in the front view AND
  // the top-down hood view, and the roof in its own view; rendered independently,
  // the AI invents a different layout each time — the "two different hoods" bug.
  // Lock them all to the ONE design so they read as the same wrap.
  if (!atlasFlatMaster && (viewType === 'hood_detail' || viewType === 'hood' || viewType === 'roof' || viewType === 'front')) {
    const surface = viewType === 'roof' ? 'roof' : 'hood';
    assembled += `\nHOOD/ROOF CONTINUITY (NON-NEGOTIABLE): The ${surface} carries the SAME single continuous wrap design that flows onto it from the body in this exact wrap — identical colors, graphics, motif, and flow direction. The ${surface} is NOT a separate composition: do not invent, substitute, simplify, mirror, or redraw a different pattern for it. Across the front view and the top-down ${surface} view the ${surface} design must be one and the same — only the camera moves.`;
  }

  // PHOTOGRAPHIC REALISM LOCK — only when the brief names a real photo scene.
  if (wantsPhoto) assembled += `\n\n${PHOTO_REALISM_LOCK}`;

  if (atlasFlatMaster) {
    assembled += `\nFinish: ${atlasFinishSpec(finishSpec)} The vinyl finish is ${(finish || 'gloss').toLowerCase()} across every panel — consistent finish on every surface.\nThe artwork fills every rectangle edge to edge — solid printed vinyl, corner to corner.`;
    assembled += `\n\n${atlasFlatMasterContract(atlasPanels, vehicle, atlasBodyClass)}`;
    return assembled;
  }
  assembled += `\nFinish: ${(finish || 'Gloss').toUpperCase()} — ${finishSpec} The vinyl finish is ${(finish || 'gloss').toLowerCase()} across ALL body panels — consistent finish on every surface.`;
  if (substrateContext) assembled += `\n${substrateContext}`;
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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Token gate — 1 token per DesignProAI panel generation. Inserted
  // BEFORE the locked prompt pipeline runs; if the user is out of
  // quota we 402 before spending any Gemini cost. Trish's tokens
  // decision (predates this file), gate-only insertion respects the
  // CLAUDE.md prompt lock.
  const internalCaller = await resolveDesignProInternalCaller(req);
  if (internalCaller.rejection) return internalCaller.rejection;
  const gate = await tokenGate(req, {
    reason: "design_panel_ai_generate",
    // The authenticated standalone request spends at request admission. Calls
    // 1-7 must not hit the legacy browser token tables once per camera angle.
    skip: internalCaller.internal,
  });
  if (!gate.ok) return gate.response!;

  const WALL_CLOCK_START = Date.now();
  const WALL_CLOCK_BUDGET_MS = 140_000; // 140s — leave 10s headroom before Supabase kills at ~150s

  try {
    const body = await req.json();

    // ═══ ATLAS-ARTBOARD — THE CANONICAL DESIGNPROAI CALL 1 (owner directive
    // 2026-08-26/27). This deployed function is the SOLE Call-1 network
    // endpoint; the handler executes the REAL Persona-2 designer brain and
    // makes exactly ONE Gemini image request. See handleAtlasArtboard below.
    if (body?.mode === "atlas-artboard") {
      // Call 1 belongs to the server OS. A browser JWT may still use every
      // established non-Atlas DesignPanel mode below, but it cannot bypass the
      // runtime's canonical identity, authoring fence or release-pinned inputs.
      if (!internalCaller.internal) {
        return new Response(
          JSON.stringify({ success: false, error: "atlas_artboard_internal_only" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      return await handleAtlasArtboard(body);
    }
    const {
      mode,
      prompt,
      style,
      finish = "Gloss",
      companyName,
      mascot,
      bulletPoints,
      industryType,
      phone,
      brandColors,
      fontStyle,
      qrEnabled,
      // Vehicle info (from MyVehiclePro selection)
      vehicleYear,
      vehicleMake,
      vehicleModel,
      // VisionBoardIQ reference images
      visionBoardImages,
      // VisionBoardIQ intent: how AI should use reference images
      visionboard_intent,
      // Camera angle for multi-view rendering
      viewType,
      // REVISION: Original render image URL for modifying existing design
      originalRenderUrl,
      // LayerLiftIQ: opt-in text-free Layer-1 "clean background" render. When true,
      // the prompt strips ALL baked branding (company name, phone, typography,
      // logos, QR) and produces the pristine art canvas the manufacturing slicer
      // consumes as background_url. Default false → golden hero path unchanged.
      layer1Clean,
      // FLAT-FIRST (opt-in, UNVERIFIED): when true, generate a flat per-panel
      // production master instead of an on-vehicle render. Default undefined →
      // golden path unchanged. Gated by the FLAT_FIRST_PANELS client flag (OFF).
      flatMaster,
      // forceNew: accepted for parity with generate-color-render's cache-bypass
      // contract. design-panel-ai-generate always mints a fresh hero (it has no
      // render cache), so this is already the effective behavior — we accept the
      // flag so callers can pass it uniformly without erroring.
      forceNew = false,
    } = body as DesignIQParams & Record<string, unknown>;
    if (forceNew) console.log('🚫 forceNew=true — fresh hero generation (design-panel has no render cache; already fresh)');

    // Single switch: flat-master builder (opt-in flat-first) → clean-background
    // builder (opt-in Layer-1) → the golden DesignIQ hero builder (default). All
    // accept the same params object. The default path is reached unless a caller
    // explicitly opts in, so the locked golden render is unchanged.
    const buildPrompt = flatMaster === true
      ? buildFlatMasterPrompt
      : layer1Clean === true ? buildLayer1CleanPrompt : buildDesignIQPrompt;

    // --- Validate required fields ---
    if (!mode || !prompt) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: mode, prompt" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // --- Authenticate user via Supabase auth header ---
    const authHeader = req.headers.get("authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    let userId: string | null = internalCaller.userId;
    let userEmailFromAuth: string | null = internalCaller.userEmail;

    if (!internalCaller.internal && authHeader) {
      const authClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const {
        data: { user },
      } = await authClient.auth.getUser();
      userId = user?.id || null;
      userEmailFromAuth = user?.email ?? null;
    }

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // --- Gemini API key (shared key pool) ---
    if (!hasGeminiKey()) {
      return new Response(
        JSON.stringify({
          code: "SYSTEM_ERROR",
          message: "API key not configured",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // --- Build the DesignIQ prompt ---
    const vbImages = Array.isArray(visionBoardImages) ? visionBoardImages as VisionBoardImage[] : [];

    // ARTBOARD MODE: resolve the flat panel set + real per-side inches from the
    // vehicle-dimensions (PVO) DB, and load the gold-standard example artboards.
    let artboardPanels: Array<{ label: string; widthInches?: number; heightInches?: number }> | undefined;
    let artboardExampleParts: Array<{ inlineData: { mimeType: string; data: string } }> = [];
    if (mode === 'artboard') {
      const svcAb = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      // Specialty vehicles (trailer/boat/bus/rv/motorcycle) aren't in the PVO car
      // table and have a different side set (e.g. a trailer has no hood/roof). The
      // caller passes an explicit `panels` array for those; cars/trucks pass none
      // and we resolve real per-side inches from vehicle_dimensions (PVO).
      artboardPanels = (Array.isArray((body as any).panels) && (body as any).panels.length)
        ? (body as any).panels
        : await resolveArtboardPanels(svcAb, vehicleYear, vehicleMake, vehicleModel);
      artboardExampleParts = await loadArtboardExamples(svcAb);
      console.log(`[ARTBOARD] ${artboardPanels.length} PVO panels, ${artboardExampleParts.length} example(s)`);
    }

    let aiPrompt = buildPrompt({
      mode,
      prompt,
      finish,
      companyName,
      mascot,
      bulletPoints,
      industryType,
      phone,
      brandColors,
      fontStyle,
      qrEnabled,
      vehicleYear,
      vehicleMake,
      vehicleModel,
      visionBoardImages: vbImages,
      visionboard_intent: visionboard_intent || 'style_inspiration',
      viewType,
      panels: artboardPanels,
      artboardClean: (body as any).artboardClean === true,
      artboardAddBranding: (body as any).artboardAddBranding === true,
    } as any);

    // ── FULL PROMPT LOG — verify nothing extra is being appended ──
    console.log("=== DESIGNIQ v3.3 FULL PROMPT START ===");
    console.log(aiPrompt);
    console.log("=== DESIGNIQ v3.3 FULL PROMPT END ===");

    console.log("DesignIQ v3.3 generation starting:", {
      mode,
      finish,
      vehicleYear,
      vehicleMake,
      vehicleModel,
      visionBoardCount: vbImages.length,
      visionBoardIntent: visionboard_intent || 'style_inspiration',
      userId,
    });

    // ── RENDER DEDUP: Prompt fingerprinting ──────────────────────
    // Catches ACCIDENTAL duplicates (double-clicks, page refreshes, tab re-submits)
    // Does NOT block intentional re-generations (user wants a fresh variation).
    //
    // Rules:
    //   1. Only catches renders created in the LAST 90 SECONDS (accidental dupes)
    //   2. Skipped entirely for revision mode (user is modifying existing design)
    //   3. Frontend can pass forceNew=true to bypass (intentional regeneration)
    //   4. Single indexed DB query — adds <50ms latency, zero API cost
    //   5. 2-second timeout on the check — if DB is slow, skip and generate
    //
    // Reference signature — the customer's uploaded reference images ARE part of
    // the design. Without them in the hash, re-submitting the same prompt text
    // with DIFFERENT references (e.g. new panel refs) collided with the prior
    // render and returned a STALE design ("it remembered past design data"). Now
    // any change to the references forces a fresh render; dedup only ever collapses
    // a genuine double-fire of the IDENTICAL request (prompt + refs) within 90s.
    const refSig = Array.isArray(visionBoardImages)
      ? visionBoardImages.map((v: any) => v?.storageUrl || v?.url || '').filter(Boolean).sort().join(',')
      : '';
    const conceptNorm = [
      vehicleYear || '', (vehicleMake || '').toLowerCase().trim(),
      (vehicleModel || '').toLowerCase().trim(), mode,
      (prompt || '').toLowerCase().replace(/\s+/g, ' ').trim().substring(0, 200),
      (finish || '').toLowerCase(),
      // Keep the clean Layer-1 render distinct from the hero so dedup never
      // returns the text-baked hero in place of the requested clean canvas.
      layer1Clean === true ? 'layer1' : '',
      // References are part of the design identity — new refs = new design.
      refSig,
      (visionboard_intent || ''),
    ].join('|');

    const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(conceptNorm));
    const promptHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    const conceptFingerprint = `${vehicleYear || ''}:${(vehicleMake || '').toLowerCase().trim()}:${(vehicleModel || '').toLowerCase().trim()}:${mode}:${promptHash.substring(0, 16)}`;

    // Only run dedup for non-revision, non-forced requests
    const skipDedup = !!originalRenderUrl || body.forceNew === true;

    if (!skipDedup) {
      try {
        const supabaseService = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
        const ninetySecondsAgo = new Date(Date.now() - 90_000).toISOString();

        // Race: dedup check vs 2-second timeout (never delays the render)
        const dedupResult = await Promise.race([
          supabaseService
            .from('designiq_generations')
            .select('id, hero_render_url, panel_url, design_name, created_at')
            .eq('prompt_hash', promptHash)
            .eq('user_id', userId)
            .eq('generation_status', 'render_complete')
            .gte('created_at', ninetySecondsAgo)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          new Promise(resolve => setTimeout(() => resolve({ data: null }), 2000)),
        ]) as any;

        if (dedupResult?.data?.hero_render_url || dedupResult?.data?.panel_url) {
          const existing = dedupResult.data;
          console.log(`[DEDUP] Caught accidental duplicate (${((Date.now() - new Date(existing.created_at).getTime()) / 1000).toFixed(0)}s ago) → returning cached`);
          return new Response(
            JSON.stringify({
              renderUrl: existing.hero_render_url || existing.panel_url,
              directRender: true,
              cached: true,
              dedupMatch: true,
              generationId: existing.id,
              designName: existing.design_name,
              message: 'Duplicate request detected — returning render from moments ago.',
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      } catch {
        // Non-fatal: if dedup fails, just generate normally
      }
    }
    // ── END DEDUP ────────────────────────────────────────────────

    // --- REFERENCE IMAGE: Fetch original render for 360-view consistency or revision ---
    const originalRenderParts: Array<{ inlineData: { mimeType: string; data: string } }> = [];
    const isMultiView = originalRenderUrl && viewType && viewType !== 'side';
    if (originalRenderUrl && typeof originalRenderUrl === 'string' && originalRenderUrl.startsWith('http')) {
      try {
        console.log(isMultiView
          ? `📸 360-VIEW: Fetching driver side render as design reference for ${viewType}`
          : '📸 REVISION MODE: Fetching original render image as reference for modification');
        // 546 GUARD: never fetch/encode the full-res hero. A 4K hero is a
        // 5504×3072 ~8.7MB JPEG, and std encodeBase64 (0.168 AND 0.224) is a
        // per-character `result +=` rope loop — ~4 string appends per 3 input
        // bytes, each allocating a ConsString that stays live until the final
        // flatten. 8.7MB in → ~450MB transient → the 256MB worker dies in ~2s
        // (HTTP 546 WORKER_RESOURCE_LIMIT). Cap the reference through the
        // storage image transform (same pattern as the VisionBoard refs below);
        // 2048px is above the 1280px bar already deemed sufficient for
        // exact-reference recreation, so clone fidelity is unchanged.
        let origFetchUrl = originalRenderUrl;
        if (origFetchUrl.includes('/storage/v1/object/public/')) {
          origFetchUrl = origFetchUrl.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/')
            + (origFetchUrl.includes('?') ? '&' : '?') + 'width=2048&height=2048&resize=contain&quality=90';
        }
        let origResponse = await fetch(origFetchUrl, {
          headers: { 'User-Agent': 'Deno/1.0' },
          signal: AbortSignal.timeout(15_000),
        });
        if (!origResponse.ok && origFetchUrl !== originalRenderUrl) {
          console.warn(`⚠️ Transform fetch failed (${origResponse.status}), falling back to original URL`);
          origResponse = await fetch(originalRenderUrl, {
            headers: { 'User-Agent': 'Deno/1.0' },
            signal: AbortSignal.timeout(15_000),
          });
        }
        if (origResponse.ok) {
          const contentType = origResponse.headers.get('content-type') || 'image/png';
          const imgBuffer = await origResponse.arrayBuffer();
          // Hard byte-cap on whatever arrived (e.g. non-storage URLs that skip
          // the transform): encoding >5MB risks the same rope-encode OOM, and a
          // skipped reference degrades gracefully while a 546 kills the call.
          if (imgBuffer.byteLength > 5_000_000) {
            console.warn(`⚠️ Reference too large to encode safely (${(imgBuffer.byteLength / 1048576).toFixed(1)}MB) — skipping attach`);
          } else {
          originalRenderParts.push({
            inlineData: { mimeType: contentType, data: encodeBase64(imgBuffer) }
          });

          if (isMultiView) {
            // 360-VIEW CONSISTENCY: Clone the same design from the camera angle defined above
            // The camera angle from view-angles-os.ts is already in the prompt — this reinforces it
            const viewLabel = viewType.replace(/[_-]/g, ' ');
            const viewReinforce = viewType === 'close-up'
              ? ' This is a CLOSE-UP beauty shot from 3-5 feet away at knee height — show the rear quarter panel with door handle, rear fender, and tail. Dramatic low angle along the bodyline. This is NOT a full vehicle shot and NOT a macro shot.'
              : viewType === 'passenger-side'
              ? ' This is the PASSENGER SIDE of the vehicle — the opposite side from the driver. The vehicle faces RIGHT in frame (nose pointing right). All text and lettering reads correctly left-to-right, NEVER mirrored. Show the passenger-side wheels.'
              : viewType === 'roof'
              ? ' This is a TOP-DOWN ROOF view — camera is DIRECTLY ABOVE the vehicle pointing straight down at 90 degrees. Orthographic flat top-down, NOT tilted, NOT angled. Show ONLY the roof/cab-top panel between the windshield and the rear glass, and crop tightly so it fills the frame. This is the CAB ROOF ONLY — the hood and the entire front end forward of the windshield, the cargo/truck bed and tailgate behind the cab, the wheels, and the side mirrors must NOT appear in frame. The vehicle sides, wheels, and floor must NOT be visible. The roof carries the SAME continuous artwork that flows up onto it from the body in the reference — the identical colors, graphics, and flow direction. Continue that exact design across the roof; do NOT invent, substitute, or redraw a different pattern for the top surface. CRITICAL: the reference image is a SIDE-angle shot — copy ONLY its wrap colors, graphics, and flow, NEVER its camera angle or composition. The "match the reference composition" rule below applies to the ARTWORK only; the camera for THIS view is a brand-new true overhead frame looking straight down, not the reference\'s side angle.'
              : viewType === 'hood_detail'
              ? ' This is a TOP-DOWN HOOD view — camera is DIRECTLY ABOVE the hood pointing straight down. Orthographic flat overhead, NOT a 3/4 glamour shot. Show ONLY the hood panel. The hood carries the SAME continuous artwork that flows up onto it from the body in the reference — the identical colors, graphics, and flow direction (the design seen on the hood and front of the reference continues here). Do NOT invent, substitute, or redraw a different pattern for the hood; it is the same wrap, only the camera moved. The hood MUST include the company\'s FULL brand lockup from the reference — the complete logo AND the company name/wordmark and lettering, reproduced exactly as approved — not only the emblem or icon.'
              : viewType === 'front'
              ? ' This is a STRAIGHT-ON FRONT view — camera is DIRECTLY in front of the vehicle at grille/bumper height, exactly perpendicular to the front fascia and perfectly symmetrical left-to-right. NOT a 3/4 angle, NOT rotated, NOT tilted. Show the front end head-on: grille, both headlights, hood edge, front bumper, and windshield, with the front filling the frame. The front carries the SAME continuous wrap artwork that flows onto it from the body in the reference — identical colors, graphics, and flow direction; do NOT invent or redraw a different pattern. CRITICAL: the reference image is a SIDE-angle shot — copy ONLY its wrap colors, graphics, and flow, NEVER its camera angle or composition. The "match the reference composition" rule below applies to the ARTWORK only; the camera for THIS view is a brand-new true head-on front frame, not the reference\'s side angle.'
              : viewType === 'rear'
              ? ' This is a STRAIGHT-ON REAR view — camera is DIRECTLY behind the vehicle at tailgate/bumper height, exactly perpendicular to the rear and perfectly symmetrical left-to-right. NOT a 3/4 angle, NOT rotated, NOT tilted. Show the rear end head-on: rear glass/tailgate, both tail lights, and rear bumper, with the rear filling the frame. The rear carries the SAME continuous wrap artwork that flows onto it from the body in the reference — identical colors, graphics, and flow direction; do NOT invent or redraw a different pattern. CRITICAL: the reference image is a SIDE-angle shot — copy ONLY its wrap colors, graphics, and flow, NEVER its camera angle or composition. The "match the reference composition" rule below applies to the ARTWORK only; the camera for THIS view is a brand-new true head-on rear frame, not the reference\'s side angle.'
              : '';
            aiPrompt += `\n\nDESIGN FIDELITY — NON-NEGOTIABLE:\nThe attached reference image is the APPROVED driver-side render of this exact wrap design. Reproduce this IDENTICAL design on the same vehicle from the ${viewLabel} camera angle defined above.${viewReinforce}\nEvery design element must match the reference image pixel-for-pixel: same characters, same graphics, same colors, same placement, same composition, same style. The wrap artwork is LOCKED — do not reinterpret, reimagine, or generate a new variation. Treat the reference image as a photograph of a real wrapped vehicle — you are simply moving the camera to a new angle. The design does not change between angles.`;
            console.log(`✅ 360-view reference image loaded (${(imgBuffer.byteLength / 1024).toFixed(0)}KB)`);
          } else {
            // REVISION MODE: Modify an existing design — intensity scales to the
            // request so logo/color/redesign asks actually take effect instead of
            // being suppressed by a blanket "keep everything identical".
            const rev = (prompt || "").toLowerCase();
            const wantsLogo = /\b(logo|emblem|crest|monogram|icon|mascot|lettering|brand mark|brandmark|typography)\b/.test(rev);
            const wantsColor = /\b(colou?r|palette|hue|recolou?r|copper|bronze|blue|red|green|gold|silver|black|white|teal|orange|purple|pink|scheme|tone)\b/.test(rev);
            const wantsRedesign = /\b(redesign|different|new design|fresh|start over|completely|totally different|reimagine|another)\b/.test(rev);

            if (wantsRedesign) {
              aiPrompt += `\n\nORIGINAL RENDER ATTACHED for reference only. The customer wants a genuinely DIFFERENT direction. Keep the same vehicle, company name, and contact info — but create a NEW design: new layout, new color palette, new graphic treatment. Do NOT echo the previous design's colors or composition.`;
            } else {
              const keep: string[] = ["the vehicle", "the company name and contact info"];
              if (!wantsColor) keep.push("the existing color palette");
              if (!wantsLogo) keep.push("the existing logo/lettering treatment");
              keep.push("the overall layout");
              const change: string[] = [];
              if (wantsLogo) change.push("redesign the LOGO/lettering as a polished, custom, distinctive brand mark");
              if (wantsColor) change.push("change the COLOR palette as requested");
              aiPrompt += `\n\nORIGINAL RENDER ATTACHED: The provided image is the current design. Keep ${keep.join(", ")} consistent.` +
                (change.length
                  ? ` But you MUST ${change.join(" and ")} — make this change clearly visible and intentional, not a subtle tweak.`
                  : ` Apply only the specific change requested in the prompt.`);
            }
            console.log(`✅ Revision mode (logo:${wantsLogo} color:${wantsColor} redesign:${wantsRedesign}) — image loaded (${(imgBuffer.byteLength / 1024).toFixed(0)}KB)`);
          }
          } // end size-guard else
        } else {
          console.warn(`⚠️ Failed to fetch original render image: ${origResponse.status}`);
        }
      } catch (err) {
        console.warn('⚠️ Error fetching original render image:', err);
      }
    }

    // --- Fetch VisionBoardIQ images as base64 for multimodal Gemini input ---
    // COMPRESSION: Resize large images via Supabase Storage transforms to reduce payload
    // Gemini image generation has payload limits — large images cause text-only fallback
    const visionBoardParts: Array<{ inlineData: { mimeType: string; data: string } }> = [];
    let totalVisionBoardBytes = 0;

    // Gemini 3 Pro supports up to 6 high-fidelity object images per render
    const MAX_VISIONBOARD_IMAGES = 6;
    const cappedVbImages = vbImages.slice(0, MAX_VISIONBOARD_IMAGES);
    if (vbImages.length > MAX_VISIONBOARD_IMAGES) {
      console.log(`⚠️ VisionBoard images capped from ${vbImages.length} to ${MAX_VISIONBOARD_IMAGES} to stay under Gemini payload limit`);
    }

    if (cappedVbImages.length > 0) {
      console.log(`Fetching ${cappedVbImages.length} VisionBoardIQ reference images...`);
      // PARALLEL FETCH: download + base64-encode all VisionBoard references
      // concurrently (was a sequential await loop). Each task returns its part
      // or null; results are pushed back in the original slot order afterward.
      const vbFetchResults = await Promise.all(cappedVbImages.map(async (vbImg) => {
        try {
          // Use Supabase Storage transforms to resize references before sending
          // to Gemini. RECREATE intents need HIGH fidelity — the reference is a
          // detailed wrap (master artboard OR the customer's uploaded wrap photo),
          // and a soft reference destroys the fine design detail (soft logos/text,
          // the "recreated wrap is a little different" gap). So both
          // artboard_projection and exact_reference go at 2048px/q90 — matching the
          // originalRenderUrl clone path (proven safe under the 546 OOM guard: a
          // single 2048 q90 contain JPEG is ~1MB, well under the 5MB per-image cap),
          // because 1280 still softened commercial logos/lettering on the recreate.
          // Style-inspiration references stay 512/q75 (small is fine there and keeps
          // the payload light) — the golden design path is unchanged.
          const isProjectionRef = visionboard_intent === 'artboard_projection' || visionboard_intent === 'exact_reference';
          const txParams = isProjectionRef
            ? '?width=2048&height=2048&resize=contain&quality=90'
            : '?width=512&height=512&resize=contain&quality=75';
          let fetchUrl = vbImg.storageUrl;
          const supabaseStorageHost = Deno.env.get("SUPABASE_URL") || '';
          if (fetchUrl.includes(supabaseStorageHost) && fetchUrl.includes('/storage/v1/object/public/')) {
            // Convert public URL to render/transform URL for resizing
            fetchUrl = fetchUrl.replace(
              '/storage/v1/object/public/',
              '/storage/v1/render/image/public/'
            ) + txParams;
            console.log(`📐 Resizing VisionBoard image via Storage transform (${isProjectionRef ? 'projection 2048' : 'ref 512'}): ${vbImg.slotLabel}`);
          }

          const imgResponse = await fetch(fetchUrl, {
            headers: { 'User-Agent': 'Deno/1.0' },
            signal: AbortSignal.timeout(15_000), // 15s timeout for image fetch
          });
          if (!imgResponse.ok) {
            // Fallback: try original URL if transform fails
            console.warn(`Transform fetch failed for ${vbImg.slotLabel} (${imgResponse.status}), trying original...`);
            const fallbackResponse = await fetch(vbImg.storageUrl, {
              headers: { 'User-Agent': 'Deno/1.0' },
              signal: AbortSignal.timeout(15_000),
            });
            if (!fallbackResponse.ok) {
              console.warn(`Failed to fetch VisionBoard image (${vbImg.slotLabel}): ${fallbackResponse.status}`);
              return null;
            }
            // Use fallback response
            const contentType = fallbackResponse.headers.get('content-type') || 'image/png';
            const imgBuffer = await fallbackResponse.arrayBuffer();
            // MEMORY (546 guard): single-pass base64 — see originalRender note.
            const base64Data = encodeBase64(imgBuffer);
            console.log(`VisionBoard image loaded (original): ${vbImg.slotLabel} (${(imgBuffer.byteLength / 1024).toFixed(0)}KB)`);
            return { mimeType: contentType, data: base64Data, bytes: imgBuffer.byteLength };
          }

          const contentType = imgResponse.headers.get('content-type') || 'image/jpeg';
          const imgBuffer = await imgResponse.arrayBuffer();
          // MEMORY (546 guard): single-pass base64 — see originalRender note.
          const base64Data = encodeBase64(imgBuffer);
          console.log(`VisionBoard image loaded: ${vbImg.slotLabel} (${(imgBuffer.byteLength / 1024).toFixed(0)}KB)`);
          return { mimeType: contentType, data: base64Data, bytes: imgBuffer.byteLength };
        } catch (err) {
          console.warn(`Error fetching VisionBoard image (${vbImg.slotLabel}):`, err);
          return null;
        }
      }));

      for (const r of vbFetchResults) {
        if (r) {
          totalVisionBoardBytes += r.bytes;
          visionBoardParts.push({ inlineData: { mimeType: r.mimeType, data: r.data } });
        }
      }
    }

    // ── VISIONBOARDIQ INTENT GATING ──────────────────────────────
    // Style Inspiration: analyze images for style DNA via Flash, then keep
    //   images in render payload — Gemini 3 Pro supports up to 6 reference images.
    //   Flash style descriptors add supplementary text context alongside images.
    // Exact Reference: images pass through to render as-is.
    // ─────────────────────────────────────────────────────────────
    let visionBoardStyleAnalyzed = false;
    const effectiveIntent = (visionboard_intent as string) || 'style_inspiration';

    if (visionBoardParts.length > 0 && effectiveIntent === 'style_inspiration') {
      console.log(`[VisionBoardIQ] Intent: style_inspiration — analyzing ${visionBoardParts.length} image(s) for style descriptors`);
      const descriptors = await analyzeVisionBoardStyles(visionBoardParts);

      if (descriptors) {
        visionBoardStyleAnalyzed = true;
        // Rebuild prompt with style descriptors injected as text
        aiPrompt = buildPrompt({
          mode,
          prompt,
          finish,
          companyName,
          mascot,
          bulletPoints,
          industryType,
          phone,
          brandColors,
          fontStyle,
          qrEnabled,
          vehicleYear,
          vehicleMake,
          vehicleModel,
          visionBoardImages: vbImages,
          visionboard_intent: visionboard_intent || 'style_inspiration',
          viewType,
          styleDescriptors: descriptors,
        });
        console.log(`[VisionBoardIQ] Style descriptors injected into prompt — images KEPT in render payload`);
      } else {
        console.log(`[VisionBoardIQ] Style analysis failed — images still kept in render payload`);
      }
    } else if (visionBoardParts.length > 0 && effectiveIntent === 'exact_reference') {
      console.log(`[VisionBoardIQ] Intent: exact_reference — ${visionBoardParts.length} image(s) pass through to render`);
    } else if (visionBoardParts.length > 0 && effectiveIntent === 'artboard_projection') {
      console.log(`[VisionBoardIQ] Intent: artboard_projection — master artboard passes through to render for on-vehicle projection`);
    }
    // ── END VISIONBOARDIQ INTENT GATING ──────────────────────────

    // ============= PAYLOAD SIZE LOGGING =============
    const promptCharCount = aiPrompt.length;
    const estimatedTokens = Math.ceil(promptCharCount / 4);
    console.log(`📊 DESIGNIQ PAYLOAD METRICS:`);
    console.log(`   Prompt: ${promptCharCount.toLocaleString()} chars (~${estimatedTokens.toLocaleString()} tokens)`);
    console.log(`   VisionBoard images: ${visionBoardParts.length} (${(totalVisionBoardBytes / 1024).toFixed(0)}KB total)`);
    console.log(`   Total payload estimate: ${((promptCharCount + totalVisionBoardBytes * 1.37) / 1024).toFixed(0)}KB`);

    // ============= TWO-CALL ARCHITECTURE =============
    // Call 1: Design Name (gemini-2.5-flash, TEXT only, fast)
    // Call 2: Image Generation (gemini-3-pro-image-preview, IMAGE only, up to 3 retries)
    // ==================================================
    const GEMINI_FETCH_TIMEOUT_MS = 60_000; // 60s — successful renders avg 40-60s; client retries handle the rest
    let imageBase64: string | null = null;
    let imageMimeType = "image/png";
    // Gemini 3 native thought signature — captured on generation so the revision
    // loop can pass it back with the reference image for state-locked edits
    // (Google's multi-turn image-editing golden rule). Null if the model/endpoint
    // doesn't surface one — harmless.
    let thoughtSignature: string | null = null;
    let designName: string | null = null;
    let visionBoardDropped = false;
    let result: any = null;
    let successAttempt = 0;

    // --- Design name: simple deterministic naming (no AI call) ---
    if (mode === 'commercial' && companyName) {
      designName = companyName.trim();
    } else {
      const fillerWords = new Set([
        "a", "an", "the", "with", "that", "has", "have", "and", "or", "of", "for",
        "on", "in", "is", "it", "its", "my", "this", "which", "also", "very", "really",
        "actually", "looks", "like", "about", "down", "from", "make", "want", "some",
        "should", "would", "could", "there", "where", "what", "when", "how", "but",
        "wrap", "wraps", "style", "theme", "design", "vehicle", "car", "truck",
        "color", "colors", "side", "front", "rear", "back", "center", "split",
        "painted", "vinyl", "custom", "mode", "type", "panel", "body",
      ]);
      const thematicWords = prompt.trim().split(/\s+/)
        .filter(w => !fillerWords.has(w.toLowerCase()) && w.length > 2)
        .slice(0, 3);
      if (thematicWords.length > 0) {
        designName = thematicWords
          .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join(' ');
      } else {
        designName = 'Custom Wrap';
      }
    }
    console.log("🏷️ Design name:", designName);

    // --- CALL 2: Image generation (gemini-3-pro-image-preview, IMAGE only, up to 3 retries) ---
    // ── STUDIO ANCHOR — DISABLED ──
    // Re-enabling the studio anchor image (PR #1264) caused Gemini to copy the
    // anchor's lighting, perspective, and wrap design into new renders, drifting
    // the studio look and tilting locked camera angles. Studio environment is
    // text-only via studio-os.ts (already in the prompt). DO NOT re-enable
    // without an EMPTY (no vehicle, no wrap) studio image AND Trish approval.
    const studioAnchorParts: Array<{ inlineData: { mimeType: string; data: string } }> = [];
    console.log('🏛️ Studio Anchor: text-only mode (image anchor disabled to prevent design/angle drift)');

    const MAX_IMAGE_ATTEMPTS = 2; // 2 server-side attempts; client has its own 3-attempt retry layer
    const resolvedViewType = viewType || 'side';
    // Artboard mode is a flat wide print sheet, not a camera view.
    // Artboard = flat 16:9 sheet; artboard_projection (RecreatePro 3D) keeps the view aspect.
    const viewAspectRatio = mode === 'artboard' ? '16:9' : getAspectRatio(resolvedViewType);
    const viewResolution = mode === 'artboard' ? '4K' : getResolution(resolvedViewType);
    const imageParts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
      { text: aiPrompt },
      ...artboardExampleParts,
      ...studioAnchorParts,
      ...originalRenderParts,
      ...visionBoardParts,
    ];

    // Wall clock budget helper — returns ms remaining before Supabase kills the function
    const remainingMs = () => WALL_CLOCK_BUDGET_MS - (Date.now() - WALL_CLOCK_START);

    for (let attempt = 1; attempt <= MAX_IMAGE_ATTEMPTS; attempt++) {
      // Check wall clock before starting a new attempt (need at least 15s for a meaningful try)
      if (attempt > 1 && remainingMs() < 15_000) {
        console.warn(`⏱️ Wall clock budget exhausted (${(remainingMs() / 1000).toFixed(1)}s left) — skipping attempt ${attempt}`);
        break;
      }
      console.log(`🎯 Call 2: Image attempt ${attempt}/${MAX_IMAGE_ATTEMPTS} — gemini-3-pro-image-preview (${aiPrompt.length} chars, ${visionBoardParts.length} VB images, ${viewAspectRatio} ${viewResolution})`);

      let response: Response;
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${getGeminiKey()}`;
      // Cap fetch timeout to wall clock remaining minus 5s headroom
      const effectiveTimeout = Math.min(GEMINI_FETCH_TIMEOUT_MS, remainingMs() - 5_000);
      try {
        response = await fetch(geminiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: imageParts }],
            generationConfig: {
              // Google spec: keep image-gen temperature at the default 1.0 — lowering
              // it (or over-constraining the prompt, which acts like lowering it)
              // degrades quality and causes repetitive/homogeneous output. Explicit
              // so nothing downstream can starve the model's variance.
              temperature: 1.0,
              responseModalities: ["TEXT", "IMAGE"],
              imageConfig: {
                aspectRatio: viewAspectRatio,
                imageSize: viewResolution,
              },
            },
          }),
          signal: AbortSignal.timeout(effectiveTimeout > 0 ? effectiveTimeout : 10_000),
        });
      } catch (fetchErr: any) {
        const isTimeout = fetchErr?.name === 'TimeoutError' || fetchErr?.name === 'AbortError';
        console.error(`Gemini fetch ${isTimeout ? 'timed out' : 'failed'} (attempt ${attempt}/${MAX_IMAGE_ATTEMPTS}):`, fetchErr?.message);
        if (attempt < MAX_IMAGE_ATTEMPTS) {
          const backoffMs = 2000 * Math.pow(2, attempt - 1);
          console.log(`Retrying in ${backoffMs / 1000}s...`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          continue;
        }
        return new Response(
          JSON.stringify({ code: "SYSTEM_ERROR", message: isTimeout ? "AI generation timed out — try again" : "Network error reaching AI service" }),
          { status: 504, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Gemini API HTTP error (attempt ${attempt}):`, response.status, errorText);

        if (response.status === 429) {
          if (attempt < MAX_IMAGE_ATTEMPTS) {
            console.log(`Rate limited — retrying with next pool key in 2s...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            continue;
          }
          return new Response(
            JSON.stringify({ error: "All API keys rate limited. Please try again in a moment." }),
            { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        if (response.status === 402 || response.status === 403) {
          return new Response(
            JSON.stringify({ error: "API quota exceeded or key invalid." }),
            { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (attempt < MAX_IMAGE_ATTEMPTS && response.status >= 500) {
          const backoffMs = 2000 * Math.pow(2, attempt - 1);
          console.log(`Retrying after server error in ${backoffMs / 1000}s...`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          continue;
        }

        return new Response(
          JSON.stringify({ code: "SYSTEM_ERROR", message: `Image generation failed (HTTP ${response.status})` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      result = await response.json();
      const finishReason = result.candidates?.[0]?.finishReason;
      const hasContent = result.candidates?.[0]?.content?.parts?.length > 0;

      // Content safety refusal
      if (finishReason && finishReason !== 'STOP' && finishReason !== 'NO_IMAGE' && !hasContent) {
        if (attempt < MAX_IMAGE_ATTEMPTS) {
          console.warn(`Content filter hit (finishReason=${finishReason}, attempt ${attempt}) — retrying`);
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
        let userMsg: string;
        if (finishReason === 'RECITATION') {
          userMsg = 'DesignIQ can create a stylized interpretation but cannot use logos or identical images due to copyright infringement. Describe the style, colors, and energy you want instead.';
        } else {
          userMsg = 'This design was filtered. Try describing the visual elements you want instead of character names — for example, say "green fist smashing through the door" instead of "Hulk". DesignIQ renders amazing character-inspired wraps when you describe the look.';
        }
        console.error(`Gemini refused generation after all retries: finishReason=${finishReason}`);
        return new Response(
          JSON.stringify({ code: 'CONTENT_FILTERED', message: userMsg, finishReason }),
          { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // NO_IMAGE — RETRY ANCHORED, NOT IDENTICAL.
      //
      // NO_IMAGE means Gemini answered with TEXT instead of an image, and an
      // over-long prompt is a leading cause. This used to resend the IDENTICAL
      // prompt, so a length-induced refusal simply happened again — and with two
      // server attempts under the client's own three-attempt layer, one view
      // could cost SIX full image generations at 25-42s each (measured on the
      // live Cascade run). Retrying a deterministic refusal unchanged is the same
      // anti-pattern that burned the panel stage's ladder.
      //
      // CLAUDE.md's golden config specifies "NO_IMAGE → retry with reduced
      // prompt" on a Full → Anchored ladder. This is that anchored rung: drop the
      // two ELEVATION blocks (BUILD ORDER, PROFESSIONAL JUDGMENT) and keep
      // everything load-bearing — camera, scene, studio, the customer's own
      // creative direction, finish, coverage and camera spec. Order is otherwise
      // untouched. If neither marker is present the prompt is unchanged, so this
      // fails safe to the previous behavior.
      if (finishReason === 'NO_IMAGE' || (finishReason === 'STOP' && !hasContent)) {
        if (attempt < MAX_IMAGE_ATTEMPTS) {
          const anchored = aiPrompt
            .replace(/\n\nBUILD ORDER:[\s\S]*?(?=\n\n|$)/, '')
            .replace(/\n\nPROFESSIONAL JUDGMENT:[\s\S]*?(?=\n\n|$)/, '');
          if (anchored.length < aiPrompt.length) {
            console.warn(`Gemini returned NO_IMAGE (attempt ${attempt}/${MAX_IMAGE_ATTEMPTS}) — retrying ANCHORED (${aiPrompt.length} → ${anchored.length} chars)`);
            aiPrompt = anchored;
          } else {
            console.warn(`Gemini returned NO_IMAGE (attempt ${attempt}/${MAX_IMAGE_ATTEMPTS}) — no elevation blocks to drop, retrying as-is`);
          }
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
      }

      // Gemini error in response body
      if (result.error) {
        console.error(`Gemini API error (attempt ${attempt}):`, result.error);
        if (attempt < MAX_IMAGE_ATTEMPTS) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
        return new Response(
          JSON.stringify({ code: "SYSTEM_ERROR", message: `Gemini: ${result.error.message || "Unknown error"}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Extract image from response
      const candidates = result.candidates;
      if (!candidates || candidates.length === 0) {
        console.error("No candidates in Gemini response:", JSON.stringify(result).slice(0, 500));
        if (attempt < MAX_IMAGE_ATTEMPTS) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
        return new Response(
          JSON.stringify({ code: "SYSTEM_ERROR", message: "No response from AI — try again" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const responseParts = candidates[0]?.content?.parts;
      if (responseParts && Array.isArray(responseParts)) {
        for (const part of responseParts) {
          if (part.inlineData) {
            imageBase64 = part.inlineData.data;
            imageMimeType = part.inlineData.mimeType || "image/png";
          }
          // Capture the native thought signature for the revision/edit loop
          if ((part as any).thoughtSignature) thoughtSignature = (part as any).thoughtSignature;
        }
      }

      if (imageBase64) {
        successAttempt = attempt;
        console.log(`✅ IMAGE GEN SUCCESS — Attempt ${attempt}`);
        break;
      }

      // No image extracted — retry
      console.error(`🚨 No image in response (attempt ${attempt}/${MAX_IMAGE_ATTEMPTS})`);
      if (attempt < MAX_IMAGE_ATTEMPTS) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    if (!imageBase64) {
      console.error("No image in Gemini response after all retry attempts");
      console.error(`Final payload: ${promptCharCount} chars prompt, ${visionBoardParts.length} VisionBoard images (${(totalVisionBoardBytes / 1024).toFixed(0)}KB)`);
      return new Response(
        JSON.stringify({
          code: "SYSTEM_ERROR",
          message: "No image returned from AI — the design prompt may be too complex. Try with fewer VisionBoard images or a shorter prompt.",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Warn user if VisionBoard images were dropped during retry
    const visionBoardWarning = visionBoardDropped && vbImages.length > 0
      ? "VisionBoard reference images couldn't be processed due to payload limits. Design was generated without reference images."
      : null;

    // --- Upload to storage ---
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const timestamp = Date.now();
    const modeTag =
      (mode === "restyle" ? style || "restyle" : industryType || "commercial") +
      (layer1Clean === true ? "-layer1" : "");
    // Derive file extension from actual mime type to avoid mismatch
    const mimeExtMap: Record<string, string> = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/webp": "webp",
      "image/gif": "gif",
    };
    const fileExt = mimeExtMap[imageMimeType] || "png";
    // User-scoped storage path: renders/{userId}/DesignPanelPro/...
    const fileName = `renders/${userId}/DesignPanelPro/ai-generated/${timestamp}_${modeTag}.${fileExt}`;

    // MEMORY (546 guard): single-pass base64 decode of Gemini's 4K response
    // (~10-20MB) — the old atob + char loop held the base64 string, the binary
    // string, AND the byte array simultaneously, which is what OOM-killed
    // concurrent invocations sharing the 256MB worker.
    const imageData = decodeBase64(imageBase64);

    const { error: uploadError } = await supabase.storage
      .from("wrap-files")
      .upload(fileName, imageData, {
        contentType: imageMimeType,
        upsert: true,
      });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      return new Response(
        JSON.stringify({
          code: "SYSTEM_ERROR",
          message: "Failed to save generated panel",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from("wrap-files").getPublicUrl(fileName);

    // --- Build TrueSpec metadata ---
    const trueSpec = {
      creatorId: userId,
      generatedAt: new Date().toISOString(),
      engineVersion: DESIGNIQ_ENGINE_VERSION,
      mode,
      preset: mode === "restyle" ? style || "" : industryType || "",
      finish,
      vehicleYear: vehicleYear || null,
      vehicleMake: vehicleMake || null,
      vehicleModel: vehicleModel || null,
      visionBoardCount: vbImages.length,
      designName: designName || null,
      layer1Clean: layer1Clean === true,
    };

    // NOTE: AI-generated renders are DIRECT vehicle renders (not flat 2D panels).
    // They must NOT be inserted into designpanelpro_patterns — that table feeds the
    // Curated Library / RestyleLibrary. Inserting vehicle renders there causes them
    // to appear as "panel designs" and degrades quality when re-rendered.
    // All AI renders are tracked in designiq_generations below instead.

    // --- Track full generation metadata in designiq_generations ---
    // This table may not exist yet — insert is best-effort (non-blocking).
    const userEmail = (() => {
      try {
        const authClient = createClient(supabaseUrl, supabaseAnonKey, {
          global: { headers: { Authorization: authHeader! } },
        });
        // Already fetched user above; grab email from the token if possible
        return null; // Will be populated by frontend if needed
      } catch {
        return null;
      }
    })();

    // --- DesignID: Prompt Thumbprint (PT) ---
    // Minted BEFORE render is stored — hash of prompt + user_id + timestamp for tamper-proof lineage.
    const ptSource = `${prompt || ''}|${userId}|${Date.now()}`;
    const ptBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ptSource));
    const ptHex = Array.from(new Uint8Array(ptBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    const promptThumbprint = `PT-${ptHex.substring(0, 12).toUpperCase()}`;

    const generationRecord = {
      user_id: userId,
      mode,
      raw_prompt: prompt,
      enhanced_prompt: aiPrompt,
      style_preset: mode === "restyle" ? style || null : null,
      finish,
      company_name: mode === "commercial" ? companyName || null : null,
      mascot: mode === "commercial" ? mascot || null : null,
      industry_type: mode === "commercial" ? industryType || null : null,
      brand_keywords:
        mode === "commercial" && bulletPoints?.filter(Boolean).length
          ? bulletPoints.filter(Boolean)
          : null,
      vehicle_year: vehicleYear || null,
      vehicle_make: vehicleMake || null,
      vehicle_model: vehicleModel || null,
      panel_url: publicUrl,
      // ── Deterministic admin-visibility (server-side; NOT browser fire-and-forget) ──
      // The admin /design-assets page surfaces a generation through hero_render_url
      // or master_artboard_url. Until now ONLY the browser set these (racing the
      // proof return and usually dropping them), so DesignProAI generations never
      // landed on the admin side. Set them here, on the render that just succeeded,
      // so every generation persists deterministically. DB-only — no prompt or
      // render-pipeline change.
      //   • hero_render_url — the customer-facing 3D proof. Set on the MAIN render
      //     only: skip view-clones / revisions (they pass originalRenderUrl) and the
      //     flat artboard pass. Without this guard every camera-angle clone would
      //     masquerade as a separate "hero" and the admin would land on the wrong row.
      //   • master_artboard_url — the flat artboard. For mode:'artboard' that IS this
      //     render; for the on-vehicle projection render it's the artboard handed in
      //     as the artboard_projection reference image.
      hero_render_url:
        mode === "artboard" || originalRenderUrl ? null : publicUrl,
      master_artboard_url:
        mode === "artboard"
          ? publicUrl
          : !originalRenderUrl &&
              effectiveIntent === "artboard_projection" &&
              vbImages.length > 0
            ? vbImages[0].storageUrl
            : null,
      panel_id: null,
      engine_version: DESIGNIQ_ENGINE_VERSION,
      truespec_metadata: trueSpec,
      generation_status: "render_complete",
      panel_mime_type: imageMimeType,
      visionboard_image_refs: vbImages.length > 0 ? vbImages : null,
      // Dedup fingerprinting
      prompt_hash: promptHash,
      concept_fingerprint: conceptFingerprint,
      // DesignID identity
      pt: promptThumbprint,
    };

    const { data: genRecord, error: genError } = await supabase
      .from("designiq_generations")
      .insert(generationRecord)
      .select("id")
      .single();

    if (genError) {
      // Non-fatal: table may not exist yet. Log and continue.
      console.warn("designiq_generations insert skipped:", genError.message);
    }

    // --- DNA Capture (non-blocking, best-effort) ---
    const designDnaId = await captureDesignDNA({
      userId,
      promptText: prompt,
      enhancedPrompt: aiPrompt,
      vehicle: { year: vehicleYear, make: vehicleMake, model: vehicleModel },
      designConfig: {
        mode,
        finish,
        style,
        companyName,
        industryType,
        visionBoardCount: vbImages.length,
      },
      renderUrl: publicUrl,
      designName: designName || undefined,
      generationId: genRecord?.id || undefined,
    });

    // --- Design Anchor Generation (non-blocking, best-effort) ---
    // Analyze the hero render to create a structured text description that
    // enforces visual continuity when generate-color-render produces Views 2-6.
    // Uses Gemini Flash for fast analysis (~2-5s). If it fails, views still render
    // but without semantic design continuity — only the hero image as panelUrl.
    // HERO-ONLY (2026-07-27 latency pass): clone-view calls (isMultiView) paid
    // this awaited pass on every one of the 6 views, but the client captures
    // designAnchorText from the HERO response only — the clones' anchors were
    // computed and thrown away (~2-30s wasted per view).
    let generatedDesignAnchorText: string | null = null;
    if (!isMultiView) try {
      console.log('🔗 DesignIQ: Generating Design Anchor from hero render...');

      const anchorPrompt = `Analyze this vehicle wrap render in precise detail. Your analysis will be used to ensure visual continuity when rendering the same wrap from different angles.

Describe:
1. COLORS: Every color present with approximate hex values and where each color appears on the vehicle
2. DESIGN ELEMENTS: All stripes, curves, gradients, shapes, geometric patterns — their exact position, size, direction of flow, and relationship to vehicle body lines
3. TYPOGRAPHY: Any text, fonts, and their exact placement (or state "No typography present" if text-free)
4. COMPOSITION: Overall flow direction (front-to-back, top-to-bottom), symmetry type, focal points
5. SCALE & COVERAGE: How the design maps to specific vehicle panels (doors, fenders, hood, roof)

Output a single structured paragraph that another AI could use to recreate this EXACT design on the same vehicle from any angle. Be specific about spatial relationships and color placement.`;

      const anchorGeminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${getGeminiKey()}`;
      const anchorResponse = await fetch(anchorGeminiEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: anchorPrompt },
              { inlineData: { mimeType: imageMimeType, data: imageBase64 } }
            ]
          }],
          generationConfig: {
            responseMimeType: "text/plain",
            maxOutputTokens: 1024,
            // Zero thinking: structured description only — same latency
            // setting as the style-analysis call above.
            thinkingConfig: { thinkingBudget: 0 }
          }
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (anchorResponse.ok) {
        const anchorData = await anchorResponse.json();
        const anchorParts = anchorData?.candidates?.[0]?.content?.parts;
        if (anchorParts) {
          for (const part of anchorParts) {
            if (part.text) {
              generatedDesignAnchorText = part.text.trim();
              console.log(`✅ DesignIQ: Design Anchor generated (${generatedDesignAnchorText.length} chars)`);
              break;
            }
          }
        }
      } else {
        console.warn('⚠️ Design Anchor generation failed (non-critical):', anchorResponse.status);
      }
    } catch (anchorError) {
      console.warn('⚠️ Design Anchor generation error (non-critical):', anchorError);
    }

    console.log("DesignIQ direct render complete:", {
      designName, publicUrl, designDnaId,
      hasAnchor: !!generatedDesignAnchorText,
      visionBoardIntent: effectiveIntent,
      visionBoardStyleAnalyzed,
    });

    // Provenance ledger — one row per successful render. Never throws.
    await emitRenderEvent({
      userId,
      email: userEmailFromAuth,
      tool: "designpanelpro",
      mode,
      engineVersion: DESIGNIQ_ENGINE_VERSION,
      geminiModel: "gemini-3-pro-image-preview",
      geminiFinishReason: "STOP",
      vehicleYear: vehicleYear || null,
      vehicleMake: vehicleMake || null,
      vehicleModel: vehicleModel || null,
      viewType: viewType || null,
      finish,
      rawPrompt: prompt,
      enhancedPrompt: aiPrompt,
      renderUrl: publicUrl,
      success: true,
      latencyMs: Date.now() - WALL_CLOCK_START,
      sourceTable: "designiq_generations",
      sourceId: genRecord?.id || null,
    });

    return new Response(
      JSON.stringify({
        renderUrl: publicUrl,
        // Private object identity is returned only to the authenticated
        // standalone runtime. Browser callers retain the historical response.
        ...(internalCaller.internal
          ? { storagePath: fileName, contentType: imageMimeType }
          : {}),
        panel: null,
        directRender: true,
        layer1Clean: layer1Clean === true,
        trueSpec,
        generationId: genRecord?.id || null,
        designName: designName || null,
        designDnaId: designDnaId || null,
        designAnchorText: generatedDesignAnchorText,
        did: genRecord?.id ? `DID-${genRecord.id.substring(0, 8).toUpperCase()}` : null,
        pt: promptThumbprint,
        visionBoardIntent: vbImages.length > 0 ? effectiveIntent : null,
        visionBoardStyleAnalyzed: vbImages.length > 0 ? visionBoardStyleAnalyzed : null,
        // Gemini 3 thought signature — store this with the design; pass it back
        // (with the rendered image as reference) on a revision for a state-locked edit.
        thoughtSignature: thoughtSignature || null,
        success: true,
        ...(visionBoardWarning ? { visionBoardWarning } : {}),
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("design-panel-ai-generate error:", err);
    return new Response(
      JSON.stringify({ code: "SYSTEM_ERROR", message: "Unexpected failure" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ATLAS-ARTBOARD MODE — THE CANONICAL DESIGNPROAI CALL 1
//
// Owner directive (Trish 2026-08-27): this deployed function is the SOLE Call-1
// network endpoint AND the sole creative implementation. The handler calls THIS
// FILE's own buildDesignIQPrompt with atlasFlatMaster:true — the real DPAG
// commercial/restyle assembly — so LOGO_REQUIREMENT, buildLogoArchitecture,
// COMMERCIAL_DEPTH, COMMERCIAL_TRANSLATION, PROFESSIONAL_JUDGMENT, the
// VisionBoard/styleDescriptors branches, exact contact handling, brand colours,
// industry, finish/substrate and the photo-intent lock all fire in the one
// call. The flat-master output contract is a BRANCH INSIDE that assembly, never
// a post-hoc string replacement, and the reconstructed persona bridge
// is deleted so it cannot come back.
//
// Exactly ONE Gemini image request. No banner, no vehicle hero, no separate
// logo stage — when no logo is supplied the designer creates the brand mark
// inside this same master.
// ═══════════════════════════════════════════════════════════════════════════

async function handleAtlasArtboard(body: Record<string, unknown>): Promise<Response> {
  const requestId = crypto.randomUUID();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const svc = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const vehicleYear = String(body.vehicleYear || "").trim();
    const vehicleMake = String(body.vehicleMake || "").trim();
    const vehicleModel = String(body.vehicleModel || "").trim();
    const vehicleType = String(body.vehicleType || "").trim();
    const authoringMode = String(body.authoringMode || "commercial") === "restyle" ? "restyle" : "commercial";

    // The six labeled panels WITH their GENIE-derived normalized [0,1] target
    // topology. Under the owner boundary contract (2026-09-01) the topology is
    // MANDATORY — there is no blank target-guide image and therefore no
    // PVO-table fallback for this mode: a request without all six normalized
    // regions is refused before any creative work.
    type PanelIn = { label?: unknown; surfaceId?: unknown; placement?: unknown; widthInches?: unknown; heightInches?: unknown; topology?: unknown; normalized?: unknown };
    const suppliedPanels = Array.isArray(body.panels) ? (body.panels as PanelIn[]) : [];
    if (suppliedPanels.length !== 6) {
      throw new Error(`atlas_artboard_topology_required:${suppliedPanels.length}`);
    }
    const panels = suppliedPanels.map((p) => ({
      label: String(p.label || "").toUpperCase(),
      surfaceId: String((p as Record<string, unknown>).surfaceId || "").toUpperCase() || undefined,
      placement: String((p as Record<string, unknown>).placement || "") || undefined,
      widthInches: Number(p.widthInches) || undefined,
      heightInches: Number(p.heightInches) || undefined,
      // Guidance only, and only on the two flanks. Read as strings and
      // nothing else: it names structure, it never becomes a surface, a
      // panel record, an output or a ZIP entry.
      topology: atlasPanelTopology(p.topology),
      normalized: atlasNormalizedRect(p.normalized, String(p.label || "")),
    }));

    // THE REAL DPAG CREATIVE ASSEMBLY. buildDesignIQPrompt is this file's own
    // commercial/restyle branch — LOGO_REQUIREMENT, buildLogoArchitecture,
    // COMMERCIAL_DEPTH, COMMERCIAL_TRANSLATION, PROFESSIONAL_JUDGMENT, the
    // VisionBoard/styleDescriptors branches, exact contact handling, brand
    // colours, industry, finish/substrate and the photo-intent lock — invoked
    // with atlasFlatMaster:true so the SAME assembly emits the A.T.L.A.S.
    // flattened-master output contract instead of camera/studio presentation.
    const references = Array.isArray(body.referenceImagesBase64) ? (body.referenceImagesBase64 as string[]) : [];
    const prompt = buildDesignIQPrompt({
      mode: authoringMode,
      prompt: String(body.enrichedBrief || body.prompt || "").trim(),
      finish: String(body.finish || "Gloss"),
      substrate: String(body.substrate || "standard"),
      companyName: String(body.companyName || "").trim() || undefined,
      mascot: String(body.mascot || "").trim() || undefined,
      bulletPoints: Array.isArray(body.bulletPoints) ? (body.bulletPoints as string[]) : undefined,
      industryType: String(body.industryType || "").trim() || undefined,
      phone: String(body.phone || "").trim() || undefined,
      website: String(body.website || "").trim() || undefined,
      textLayerPrompt: String(body.textLayerPrompt || "").trim() || undefined,
      brandColors: String(body.brandColors || "").trim() || undefined,
      fontStyle: String(body.fontStyle || "").trim() || undefined,
      qrEnabled: body.qrEnabled === true,
      vehicleYear,
      vehicleMake,
      vehicleModel,
      vehicleType,
      viewType: "side",
      visionBoardImages: references.map((_, i) => ({ slotLabel: `reference-${i + 1}` })),
      visionboard_intent: body.visionboard_intent === "exact_reference" ? "exact_reference" : "style_inspiration",
      styleDescriptors: String(body.styleDescriptors || "").trim() || undefined,
      atlasFlatMaster: true,
      atlasPanels: panels,
    } as any);

    // 3 — parts, in v14's proven order. 083d2a70 (edge v14, 2026-08-31) is the
    // last configuration that reached print panels 6/6, and it sent the neutral
    // target guide as the FINAL image:
    //   PROMPT / DESIGN CONTEXT
    //   → LABELED A.T.L.A.S. TEACHING REFERENCE
    //   → CUSTOMER REFERENCES, IF ANY
    //   → the neutral target guide, LAST
    // `7ee1f868` deleted the guide and substituted a normalized [0,1]
    // coordinate table; no run since has matched v14, and three releases came
    // back as vehicle depictions. The table is gone from the model request
    // (GENIE still owns the math) and the guide is back in its proven final
    // position. The installed Flamingo 3D proof stays out of this test, so the
    // guide is the ONLY variable moving against the deployed v19 prompt, which
    // is unchanged byte for byte. No corrective note in this contract. A finished vehicle proof remains excluded: it is a stronger
    // anatomy/camera instruction than prose and previously induced vehicle
    // pixels inside source rectangles (canary 33389124918). The Houdini/
    // template inputs remain excluded for the same reason.
    const parts: Array<Record<string, unknown>> = [{ text: prompt }];
    const pushImage = (b64: unknown, mime = "image/png") => {
      if (typeof b64 === "string" && b64.length > 0) {
        parts.push({ inlineData: { mimeType: mime, data: b64 } });
      }
    };
    // THE BIG INPUTS TRAVEL BY STORAGE PATH, NOT INSIDE THE JSON BODY.
    //
    // Live 2026-08-27: a 2.2MB request (guide + structural reference as inline
    // base64) killed the worker 25s in — it booted, shut down, and the gateway
    // hung to its 160s ceiling with a bodiless 504, twice. Downloading the same
    // bytes here with the service client keeps the request a few KB and the
    // peak memory to one copy of each image.
    const sha256Hex = async (bytes: Uint8Array) => {
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
    };
    const downloadPart = async (
      path: unknown,
      mime: string,
      expectedHash?: string,
      expectedByteSize?: number,
    ) => {
      const key = String(path || "").trim();
      if (!key) return null;
      const pathMatch = key.match(/^atlas-call1-inputs\/([0-9a-f]{64})\.(?:png|jpg)$/);
      if (!pathMatch) {
        throw new Error(`atlas_artboard_input_path_invalid:${key.slice(0, 160)}`);
      }
      const { data, error } = await svc.storage.from("wrap-files").download(key);
      if (error || !data) throw new Error(`atlas_artboard_input_download_failed:${key}:${error?.message || "missing"}`);
      const bytes = new Uint8Array(await data.arrayBuffer());
      const actualHash = await sha256Hex(bytes);
      if (actualHash !== pathMatch[1] || (expectedHash && actualHash !== expectedHash)) {
        throw new Error(`atlas_artboard_input_hash_mismatch:${key}`);
      }
      if (expectedByteSize != null && bytes.length !== expectedByteSize) {
        throw new Error(`atlas_artboard_input_size_mismatch:${key}`);
      }
      let binary = "";
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
      }
      parts.push({ inlineData: { mimeType: mime, data: btoa(binary) } });
      return { contentHash: actualHash, byteSize: bytes.length };
    };
    const teachingProofPath = String(body.teachingProofStoragePath || "").trim();
    if (!teachingProofPath) {
      throw new Error("atlas_artboard_teaching_proof_incomplete");
    }
    let verifiedTeachingProof: Record<string, unknown> | null = null;
    {
      const identity = validateAtlasTeachingProofIdentity(body.teachingProofIdentity);
      parts.push({
        text: "LABELED A.T.L.A.S. TEACHING REFERENCE. This example shows ONE cohesive vehicle-wrap design represented as six flat A.T.L.A.S. surfaces: DRIVER SIDE, PASSENGER SIDE, HOOD, ROOF, FRONT and REAR. The printed labels identify the surface roles and sit in the separation space between artwork regions. Learn the A.T.L.A.S. format, surface identities and relationship of the six surfaces as one connected wrap. Create an original design for the current customer; do not copy the example's branding or artwork.",
      });
      const proofVerified = await downloadPart(
        teachingProofPath,
        "image/png",
        ATLAS_TEACHING_PROOF_HASH,
        ATLAS_TEACHING_PROOF_BYTES,
      );
      verifiedTeachingProof = {
        ...identity,
        contract: ATLAS_TEACHING_PROOF_CONTRACT,
        purpose: ATLAS_TEACHING_PROOF_PURPOSE,
        version: ATLAS_TEACHING_PROOF_VERSION,
        flattenedTopViewContentHash: proofVerified?.contentHash,
        flattenedTopViewByteSize: proofVerified?.byteSize,
      };
    }
    for (const ref of references) pushImage(ref);
    // THE NEUTRAL TARGET GUIDE, LAST — v14's proven position.
    //
    // It is an unlabelled, unstroked six-rectangle mask (renderAtlasAuthoringGuide
    // fail-closes on any text, stroke or path), and `normalizeAtlasMaster` masks
    // the delivered sheet to those same zones, so it cannot contribute a pixel
    // to a panel. It conditions layout only.
    parts.push({
      text: "CURRENT TARGET GUIDE — this final neutral mask alone controls the requested output layout. Fill its six regions with the NEW customer design from the canonical target vehicle and brief above. Return flat printable rectangles only; never return a vehicle image.",
    });
    await downloadPart(body.guideStoragePath, "image/png");
    // Legacy inline path for callers that still send bytes (harness/tests);
    // production sends the storage path.
    pushImage(body.guideImageBase64);

    // 4 — exactly ONE Gemini image request. No retries, no second asset.
    //
    // The platform kills an Edge Function at ~150s with a bare 504 and no body
    // (live 2026-08-27, execution_time_ms 160015). An explicit deadline turns
    // that into a readable JSON error the caller can act on, and the phase
    // timings below say which half was slow.
    const model = ATLAS_ARTBOARD_AUTHORING_MODEL;
    const t0 = Date.now();
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${getGeminiKey()}`;
    const modelRequest = JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: { aspectRatio: "1:1", imageSize: "4K" },
      },
    });
    const modelRequestByteSize = new TextEncoder().encode(modelRequest).byteLength;
    if (modelRequestByteSize > ATLAS_ARTBOARD_MODEL_REQUEST_MAX_BYTES) {
      throw new Error(`atlas_artboard_model_request_too_large:${modelRequestByteSize}`);
    }
    const modelInputImageCount = parts.filter((part) => Boolean((part as Record<string, any>)?.inlineData?.data)).length;
    const geminiRes = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(115_000),
      body: modelRequest,
    });
    console.log(`atlas-artboard ${requestId}: gemini responded in ${Date.now() - t0}ms (${model}, ${parts.length} parts, prompt ${prompt.length} chars)`);
    if (!geminiRes.ok) {
      throw new Error(`atlas_artboard_gemini_http_${geminiRes.status}: ${(await geminiRes.text()).slice(0, 300)}`);
    }
    const payload = await geminiRes.json();
    const candidateParts: Array<Record<string, any>> = payload?.candidates?.[0]?.content?.parts || [];
    const imagePart = candidateParts.find((p) => p?.inlineData?.data);
    const textOut = candidateParts.filter((p) => typeof p?.text === "string").map((p) => p.text).join("\n").trim();
    if (!imagePart) {
      throw new Error(`atlas_artboard_no_image: finishReason=${payload?.candidates?.[0]?.finishReason || "unknown"} text=${textOut.slice(0, 200)}`);
    }

    // 5 — persist + provenance.
    // Decode without a per-byte JS callback: a 4K master is ~5MB, and
    // Uint8Array.from(binaryString, cb) walks it one closure call at a time.
    const tDecode = Date.now();
    const binary = atob(imagePart.inlineData.data);
    const masterBytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) masterBytes[i] = binary.charCodeAt(i);
    const digest = await crypto.subtle.digest("SHA-256", masterBytes);
    const masterSha256 = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
    const storagePath = `atlas-call1/${requestId}.png`;
    const { error: upErr } = await svc.storage.from("wrap-files").upload(storagePath, masterBytes, {
      contentType: "image/png",
      upsert: false,
    });
    if (upErr) throw new Error(`atlas_artboard_upload_failed: ${upErr.message}`);
    // wrap-files is PRIVATE: a public URL 400s (live 2026-08-27, run
    // 33028608748 — the master was written, the caller could not read it).
    // The path is the contract; the signed URL is a convenience for humans.
    const { data: signed } = await svc.storage.from("wrap-files").createSignedUrl(storagePath, 60 * 60 * 24 * 7);
    console.log(`atlas-artboard ${requestId}: decode+upload ${Date.now() - tDecode}ms, total ${Date.now() - t0}ms, master ${masterBytes.length} bytes`);

    return new Response(
      JSON.stringify({
        success: true,
        requestId,
        functionName: "design-panel-ai-generate",
        sourceCommit: ATLAS_ARTBOARD_SOURCE_COMMIT,
        promptVersion: ATLAS_ARTBOARD_PROMPT_VERSION,
        model,
        imageRequestCount: 1,
        modelRequestByteSize,
        modelRequestMaxBytes: ATLAS_ARTBOARD_MODEL_REQUEST_MAX_BYTES,
        modelInputImageCount,
        teachingProofIdentity: verifiedTeachingProof,
        topologyContract: ATLAS_TOPOLOGY_CONTRACT,
        promptChars: prompt.length,
        masterUrl: signed?.signedUrl || null,
        masterStoragePath: storagePath,
        masterSha256,
        masterBytes: masterBytes.length,
        designText: textOut.slice(0, 2000),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        success: false,
        requestId,
        functionName: "design-panel-ai-generate",
        promptVersion: ATLAS_ARTBOARD_PROMPT_VERSION,
        imageRequestCount: 0,
        error: String((err as Error)?.message || err).slice(0, 500),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
}
