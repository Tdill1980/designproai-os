// ╔═══════════════════════════════════════════════════════════════════════╗
// ║  GENERATED FILE — DO NOT EDIT. Run scripts/build-designiq-shared.mjs.  ║
// ╚═══════════════════════════════════════════════════════════════════════╝
//
// A.C.E., sliced byte-for-byte out of the deployed
// supabase/functions/design-panel-ai-generate/index.ts at its serve() boundary,
// so a second edge function can EXECUTE the real creative assembly instead of
// re-describing it (owner ruling, Trish 2026-09-18: "Must use our suite of
// custom design edge functions"). The only edit is the removal of the `serve`
// import, which the sliced region never calls.
//
// tests/designiq-shared-assembly.test.mjs regenerates this and fails on a
// single character of difference, so it cannot drift from the function that is
// actually deployed. Change index.ts, regenerate, commit both.

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

import { RELEASE_SOURCE_SHA } from "../_shared/release-source.ts";
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
import { captureImageTurn, replayImageTurn, selectFinalGenerateContentImage, decodeGenerateContentImage } from "../_shared/gemini-image-history.mjs";
import {
  GEMINI_PROVIDER_CACHE_CONTRACT, authorizeAtlasProviderRequest,
  providerSha256, putImmutableProviderArtifact, runDurableImageProviderRequest,
  prepareAtlasRevisionProviderContents, captureGeminiHttpExchange,
} from "../_shared/gemini-provider-cache.mjs";
// THE ONE LOGO PRODUCER, RECOVERED RATHER THAN REBUILT (RULE 1).
// `authorProofLogo` + `designpro-text-layer-prompt` + `chromaKeyToAlpha` are
// the same three pieces `designpro-text-layer-generate` and
// `production-panel-proof` already share. `mode: "atlas-logo"` gives the
// element graph a door to them; it does not add a second logo authority.
import { authorProofLogo, proofLogoRequested } from "../_shared/atlas-proof-elements.mjs";
import { buildPrompt as buildTextLayerPrompt, chromaKeyToAlpha } from "../_shared/designpro-text-layer-art.ts";
import { geminiImageUrl } from "../_shared/model-config.ts";
// ATLAS-ARTBOARD (owner directive 2026-08-27): Call 1 executes THIS file's own
// buildDesignIQPrompt — the real DPAG commercial/restyle creative assembly —
// with atlasFlatMaster:true. No separate creative module, no string-replacement
// path: the reconstructed persona bridge is deleted.
const ATLAS_ARTBOARD_AUTHORING_MODEL = "gemini-3-pro-image";
const ATLAS_ARTBOARD_PROMPT_VERSION = "atlas-artboard-designiq.20260921.v29-designpanelai-brain";
// ONE-FIELD CONTRACT (owner ruling 2026-09-02, unfrozen 2026-09-02): when the
// runtime sends this contract, Gemini authors ONE uninterrupted full-bleed
// composition and receives NO six-region guide, NO labeled teaching sheet, NO
// topology text and NO panel-object vocabulary. GENIE/runtime owns the six
// territories as code and serializes them after the one image call. The
// legacy six-container request stays callable for the harness slice and for
// history; production sends the field contract.
const ATLAS_FIELD_PROMPT_CONTRACT = "designpro.atlas-field-prompt.v2";
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
  "X-DesignPro-Source-Sha": RELEASE_SOURCE_SHA,
  "Access-Control-Expose-Headers": "X-DesignPro-Source-Sha",
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
// The one-field call keeps this sentence byte for byte except its example
// object: "panels" is production vocabulary the field contract keeps out of the
// model request (harness swap 7, run 33659500846).
const COMMERCIAL_TRANSLATION_FIELD =
  "Translate anything the brief names into concrete design — color story, layout, graphic motifs, focal treatment (\"stealth bomber\" becomes angular faceted plates with sharp swept edges). What the client named should be obvious at a glance.";

// ARCHITECTURE_DAG.md §4.1 — THE CLEAN BASE (owner ruling, 2026-09-17).
//
// Layer 0. Under the element graph the company name, the logo and the contact
// bar are produced as their OWN deterministic artifacts (typeset.produce,
// contact.produce, logo.prepare) and composited by code at a known box, so the
// authored surface must carry none of them. This is the RestylePro model: the
// clean base is AUTHORED, never stripped -- stripping smears, which is why
// `liftoverlays` was gated off over there and why every passenger defect since
// 09-07 has been a re-drop over artwork that already had type baked in.
//
// It REPLACES the brand/contact block rather than adding to it: leaving the
// logo direction in place and then asking for no lettering is the negative-
// instruction shape this file warns about in four places.
const ATLAS_CLEAN_BASE_CONTRACT =
  `\nBACKGROUND ARTWORK ONLY — NO LETTERING OF ANY KIND. This sheet is the background layer of the wrap. The company name, any logo or wordmark, the phone number, the web address and every other piece of type are added afterwards as separate print layers, so they must not appear here. Design the artwork so it stays strong underneath them: keep one calmer passage where a name and a contact line will sit, and let the colour, motion and depth carry the design on their own. No letters, no numerals, no words, no monograms, no logo marks, no badges, no signage, no lettering of any kind anywhere in the artwork.`;

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

// ── HERO-DRIVER SHEET (owner ruling, Trish 2026-09-11) ──────────────────────
// Call 1's first and only from-scratch request draws ONE sheet: the driver
// side. It is the easiest ask this model answers cleanly (one rectangle of
// printed artwork) and the one the six-surface sheet kept failing (drawing the
// vehicle into six regions of one canvas). Every later surface is a
// continuation of this sheet inside the same conversation; Passenger is
// composed from it in code. No vehicle noun appears below.
type AtlasHeroSurface = { label: string; widthInches: number; heightInches: number; orientation: string };

function atlasHeroSurfaceInput(value: unknown): AtlasHeroSurface | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const label = String(raw.label || "DRIVER SIDE").trim().toUpperCase().slice(0, 40);
  const widthInches = Number(raw.widthInches);
  const heightInches = Number(raw.heightInches);
  if (!(widthInches > 0) || !(heightInches > 0)) throw new Error("atlas_author_hero_surface_invalid");
  return { label, widthInches, heightInches, orientation: atlasSheetOrientation(widthInches / heightInches) };
}

function atlasSheetOrientation(ratio: number): string {
  return ratio > 2.2 ? "a long, wide landscape sheet" : ratio > 1.15 ? "a landscape sheet" : ratio < 0.87 ? "a tall portrait sheet" : "a near-square sheet";
}

function atlasHeroScene(vehicle: string, bodyClass: string, hero: AtlasHeroSurface, commercial: boolean): string {
  const depth = commercial
    ? "The design is built from layered elements — background color and texture flowing across the sheet, mid-ground graphic motion, and foreground accent detail — with real dimension rather than flat shapes on bare vinyl. The company name reads clearly at a glance; how the branding is composed is your creative call."
    : "Elevate the brief into a bold composition built from layered thematic elements — background atmosphere, mid-ground motion, foreground accent detail and a strong focal treatment — rich with depth and texture, with real dimension rather than flat shapes on bare vinyl.";
  return `Design the printed wrap artwork for a ${vehicle} (${bodyClass}) as ONE flat printed sheet — the ${hero.label} of the wrap, ${hero.orientation} of pure printed vinyl artwork the way it looks coming off the printer, never an on-vehicle photograph. This sheet is the single design authority for the complete vehicle: the opposite side will be composed from it, and the remaining surfaces will continue it, so it carries the whole identity of the design. ${depth}`;
}

function atlasHeroSurfaceContract(hero: AtlasHeroSurface, vehicle: string, bodyClass: string): string {
  return `OUTPUT FORMAT — ONE FLAT PRINTED SHEET: the ${hero.label}.
Design the ${hero.label} of the wrap for this exact ${vehicle || "customer vehicle"} (${bodyClass}) as one flat rectangular sheet of printed artwork, ${hero.widthInches} × ${hero.heightInches} inches, ${hero.orientation}. The output is flat print artwork on a 2D sheet, drawn straight-on.

The artwork fills the whole rectangle corner to corner and runs off all four edges — opaque, unbroken, full bleed: flat printed graphic art, the same kind of image as a printed poster or a roll of printed vinyl laid flat on a table. It is the artwork by itself, before anything is cut or applied. Customer-requested photographic imagery is a photograph printed INTO that flat art. Vehicle appearance, installed boundaries and presentation lighting are produced downstream by the proof projections and are absent here.

Customer-facing wording reads normally, left to right, upright, whole and sharp. Set no panel names, surface IDs, legends or captions anywhere in the artwork — those words are for the server, never for the sheet.

Gallery-grade custom artwork with real depth, movement and a wow factor — never generic AI filler, never a template. Output ONE flat 2D sheet, drawn straight-on and flat for printing.`;
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
  // OVER-CONSTRAINT IS THE DEFECT, AND THE REFERENCE SAYS SO IN ITS OWN WORDS
  // (owner, 2026-09-18: "it's not acting like a pro graphic designer it's not
  // using its Gemini brain to elevate the designs").
  //
  // Measured on the real assembly for a commercial F250 brief before this
  // change: 4,931 chars total, of which THIS tail was 2,532 -- 51% of Call 1 --
  // against a 330-char designer identity. 43% of the prompt sat in lines
  // carrying a prohibition, and the single idea "this is flat artwork, not a
  // picture of a vehicle" was restated SEVEN separate times.
  //
  // `design-panel-ai-generate` v631 (restylepro-os, the live design brain)
  // carries the diagnosis at its own temperature line: "keep image-gen
  // temperature at the default 1.0 -- lowering it (OR OVER-CONSTRAINING THE
  // PROMPT, WHICH ACTS LIKE LOWERING IT) degrades quality and causes
  // repetitive/homogeneous output." Seven restatements of one prohibition is
  // that, and the output was exactly what it predicts: a centred, symmetric
  // badge -- the same composition for a dental practice and a pool company.
  //
  // So the tail is cut to what v631's own `mode:'artboard'` branch keeps, and
  // nothing here is a new invention -- every surviving sentence was already in
  // this function or in that branch:
  //   - the flat-artboard statement, ONCE, in the opening line;
  //   - the panel placement list (the layout; load-bearing for the cut);
  //   - the one-cohesive-design paragraph (v631's "the SAME cohesive design
  //     flowing across every panel as one connected wrap unwrapped flat");
  //   - ONE full-bleed sentence, because `edgeHoleRatio` convicts on it;
  //   - the no-captions clause, folded into one sentence rather than a
  //     paragraph (RULE 0.28 still holds: labels never reach the artwork);
  //   - v631's gallery-grade closing, verbatim.
  //
  // Deleted, all of them restatements of what the first line already says: the
  // poster-on-a-table simile, the "downstream proof projections" disclaimer, the
  // finished-look-belongs-downstream livery paragraph, the gutter/sheet-gap
  // sentence, and the duplicated flat-sheet opening.
  //
  // Deliberately PARAPHRASED rather than quoted. Several tests extract this
  // whole function as a block and assert on it, so a comment that quoted the
  // deleted sentences verbatim would satisfy a grep for text that is no longer
  // in the returned template -- a lock passing on a comment is worse than no
  // lock. Do not paste the old wording back in here.
  //
  // What this deliberately does NOT do: it does not touch the manifest, the six
  // zones, `cutCallOnePanels`, the extraction rects, the square 4K canvas, the
  // gates, or the Call-1 node graph. v631's artboard is 16:9 and the owner is
  // explicit that it "never produced panels ... just one ai call that was not
  // producing print ready files" -- so the ask comes from RestylePro and the
  // panel production stays on this repo's DAG.
  return `OUTPUT FORMAT — ONE FLAT A.T.L.A.S. ARTBOARD on one square 4K canvas.
Design ONE flat vehicle-wrap A.T.L.A.S. ARTBOARD for this exact ${vehicle || "customer vehicle"} (${bodyClass}) — the full wrap laid out FLAT as rectangular print panels on one sheet, the way the printed vinyl looks before anything is cut or applied.

Lay out these panels, the wrap artwork filling each panel edge to edge, and the SAME cohesive design flowing across every panel as ONE CONNECTED WRAP UNWRAPPED FLAT:
${panelLines}

One wrap, unwrapped. The left and right flanks are the two sides of the SAME vehicle carrying the SAME design — the palette, the imagery, the motion and the branding continue from one to the other, and a person walking around the finished truck sees one design, not two. The centre panels carry that same composition across the ${bodyClass}'s top and ends. Customer-facing wording reads normally on every panel, and no panel names, surface IDs or captions are set anywhere in the artwork.

Every panel is opaque and full-bleed to all four edges.

Gallery-grade custom artwork with real depth, movement and a wow factor — never generic AI filler, never a template. Output ONE flat 2D artboard sheet, drawn straight-on and flat for printing.`;
}

// ── ONE-FIELD OUTPUT CONTRACT (designpro.atlas-field-prompt.v2) ─────────────
// The tail of the one-field Call 1, ported verbatim from the harness that drew
// the only clean flanks this product has produced (scripts/
// atlas-field-contract-v2.mjs, run 33659500846). It names THIRDS — the
// fractions the model draws and the fractions the code-owned territories
// occupy — and nothing else: no containers, no panel objects, no labels, no
// negatives, no vehicle-body-piece framing. The nose edges are OS data (the
// runtime's installer map) so the two hero passages sweep the way the
// installed sides do.
type AtlasNoseEdge = { driver: "left" | "right"; passenger: "left" | "right" };

function atlasNoseEdgeInput(value: unknown): AtlasNoseEdge {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const edge = (key: string, fallback: "left" | "right") => {
    const v = String(raw[key] || fallback).trim().toLowerCase();
    if (v !== "left" && v !== "right") throw new Error(`atlas_artboard_nose_edge_invalid:${key}`);
    return v as "left" | "right";
  };
  return { driver: edge("driver", "left"), passenger: edge("passenger", "right") };
}

function atlasSweepPhrase(noseEdge: "left" | "right"): string {
  return noseEdge === "left" ? "Forward energy sweeps left to right." : "Forward energy sweeps right to left.";
}

/**
 * The OS knows which normalized rectangle belongs to which production surface.
 * That knowledge stays SERVER-SIDE: it only ever produces an anonymous sweep
 * phrase, so the installed sides still sweep the right way without the model
 * ever receiving a production-object identity.
 */
function atlasFieldSweep(label: string, noseEdge: AtlasNoseEdge): string {
  const key = String(label || "").toUpperCase();
  if (key.startsWith("DRIVER")) return atlasSweepPhrase(noseEdge.driver);
  if (key.startsWith("PASSENGER")) return atlasSweepPhrase(noseEdge.passenger);
  return "";
}

/**
 * v25 — ANONYMOUS SPATIAL COORDINATES (owner ruling, Trish 2026-09-04).
 *
 * v24 told the model "three equal horizontal thirds" while the cutter took SIX
 * unequal territories out of the field. Measured on GEN 63e6629a (Arctic Air,
 * 2022 Toyota Prius): of the twelve real extraction cut lines, ELEVEN were
 * never shown to the model. The lower band alone discarded 27.81% of what was
 * painted there, and the four production surfaces cut from it had been
 * explicitly instructed to be a "supporting register ... calmer intensity,
 * secondary motifs" -- which is why the Front crop came back as background.
 * That is a coordinate-contract defect, not a model-quality defect.
 *
 * The geometry was already on the wire. `panels[].normalized` is sent by the
 * runtime, REQUIRED by this function's caller (atlas_artboard_topology_required)
 * and validated rect by rect (atlasNormalizedRect) -- and then thrown away
 * before the model was asked to compose. This emits it instead.
 *
 * The governing rule: the model may receive anonymous spatial COORDINATES
 * derived from panels[].normalized; it may not receive semantic production
 * OBJECT IDENTITIES. So the rows carry no name, no index, no heading and no
 * colon-introduced title -- there is no noun for the model to set in type.
 * Rows are ordered by the coordinates themselves, which also destroys any
 * correlation between row position and surface identity.
 *
 * Every fraction is computed. A hard-coded geometry literal in this function
 * would silently decouple the conditioning from the cutter, so there is none,
 * and `tests/atlas-clean-authoring-contract.test.mjs` fails the build if one
 * appears.
 */
function atlasFieldContract(
  vehicle: string,
  bodyClass: string,
  noseEdge: AtlasNoseEdge,
  hasBrandName: boolean,
  panels: Array<{ label?: unknown; normalized?: AtlasNormalizedRect }>,
): string {
  if (!Array.isArray(panels) || panels.length !== 6) {
    throw new Error(`atlas_field_geometry_required:${Array.isArray(panels) ? panels.length : "none"}`);
  }
  const f = (n: number) => n.toFixed(4);
  const rows = panels
    .map((panel) => {
      const n = panel.normalized;
      if (!n) throw new Error("atlas_field_geometry_required:normalized");
      const x0 = Number(n.x);
      const y0 = Number(n.y);
      return {
        x0,
        y0,
        x1: x0 + Number(n.width),
        y1: y0 + Number(n.height),
        sweep: atlasFieldSweep(String(panel.label || ""), noseEdge),
      };
    })
    .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
    .map((r) => `  ${f(r.x0)} ${f(r.y0)} ${f(r.x1)} ${f(r.y1)}${r.sweep ? `   ${r.sweep}` : ""}`);
  const lettering = hasBrandName
    ? "Lettering reads left to right throughout, and the company name appears whole and legible."
    : "Lettering reads left to right throughout, and any wording the brief calls for appears whole and legible.";
  // v26 — THE SEPTEMBER 4 FIELD TEXT IS THE PRODUCT. On 2026-09-15 these
  // paragraphs were stripped on the theory the persona needed no direction;
  // the next live run (220d569f) painted the map's own coordinate digits on
  // the vinyl, drew black blocks, went silver and pushed every mark off the
  // flanks. The Arctic Air Prius sheet of 2026-09-04 (DID-63E6629A) and the
  // Precision master of 2026-09-08 (1564c66d) both came from THIS wording.
  // It is restored verbatim; the only addition is the explicit second half
  // of the map line. Any further change to this tail is judged side by side
  // against those two sheets, not by argument.
  return [
    "OUTPUT — ONE CONTINUOUS FULL-BLEED COMPOSITION on one square 4K image.",
    `Paint the entire square, edge to edge on all four sides, as one uninterrupted field of printed vinyl artwork for this exact ${vehicle || "customer vehicle"} (${bodyClass}) — ground colour, texture and motion running continuously across the whole image, straight-on and flat.`,
    "",
    "The square is one picture. These areas of it, written as fractions of the image measured from the top-left corner — left, top, right, bottom — must each carry a complete and finished passage of that picture:",
    "",
    ...rows,
    "",
    // v26 — THE MAP IS READ, NEVER DRAWN. Live 220d569f (owner's Martini 911,
    // 2026-09-16): with the guard sentence gone the model painted the map's
    // own coordinate digits across both flanks and drew black blocks where it
    // read the areas as objects. This is a physical fact about the output
    // (RULE 0.37), not design direction.
    "Those fractions are a map for you to read; every mark on the printed vinyl is artwork. None of the map is drawn: the vinyl carries no numbers, outlines or frames of any kind.",
    "",
    "Every one of those areas has to read on its own as intentional, finished, commercially valuable artwork: real subject matter, real depth, real movement, worth what the customer paid. Not one of them may become empty backdrop, filler, or the quiet leftover of a composition that happens elsewhere.",
    "",
    "They are not separate pictures. The ground, palette, texture, lighting and motion run continuously through the whole square and straight across every join between them, so they read as passages of one design and the joins are invisible.",
    "",
    `Nothing that has to be read or recognised may run from one of those areas into another: every letter, word, mark and focal subject sits wholly inside a single area and well clear of its four edges. ${lettering}`,
    "",
    "Gallery-grade custom artwork with real depth, movement and a wow factor, drawn flat for printing.",
  ].join("\n");
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
  // ONE-FIELD CONTRACT: the same creative assembly, with the seven exact
  // presentation phrases that name panel/rectangle objects swapped for their
  // field wording (harness swaps 1-7), and the field tail instead of the
  // six-container tail. Persona, concept, brief, translation, logo, contact
  // lock, photo-realism rule, FINISH_SPECS text, style, movement and depth are
  // untouched.
  const atlasField = atlasFlatMaster && (params as any).atlasField === true;
  // PANEL PRODUCTION PROOF (owner ruling 2026-09-21): DesignIQ names the object
  // ITSELF instead of leaving a second system to name a different one.
  //
  // `panelProofCreativeHead` cuts this assembly at its OUTPUT FORMAT tail, and
  // that marker is at the END — so the presentation sentence, which sits at
  // position 2, survived the cut. The proof prompt therefore opened with "ONE
  // FLAT print-production master ... not six independent graphics" and then
  // asked, one blank line later, for a three-band proof sheet with the six
  // panels drawn three times. Two output contracts in one prompt, with the
  // wrong one first — exactly what that cut exists to prevent.
  //
  // This is a SWAP, never an addition: the branch replaces the sentence rather
  // than appending to it, and is shorter than what it replaces. It also drops
  // "never an on-vehicle photograph" — a negative instruction, the prompt shape
  // that has failed 4/4 on the field map — because `SYSTEM_JOB` already states
  // the same thing positively. The layered build order and the
  // branding-composition call survive verbatim; they are the valuable half.
  //
  // It does NOT restate the three bands, the template or the cells.
  // `SHEET_LAYOUT` and `SYSTEM_JOB` own those, and saying them twice is the
  // bloat that buys nothing and costs the design's share of the budget.
  const atlasProofSheet = atlasFlatMaster && (params as any).atlasProofSheet === true;
  // HERO-DRIVER CASCADE (owner ruling 2026-09-11): the same creative assembly,
  // asked for ONE sheet -- the driver side -- instead of six on one canvas.
  // Persona, concept, brief, translation, logo, contact lock, photo-realism
  // rule, FINISH_SPECS text, style, movement and depth are untouched; only the
  // presentation phrases that name six panels/fields switch to the one sheet.
  const atlasHero: AtlasHeroSurface | null = atlasFlatMaster && !atlasField ? atlasHeroSurfaceInput((params as any).atlasHeroSurface) : null;
  // Layer 0 (ARCHITECTURE_DAG.md §4.1). Read only from the params the atlas
  // author sets; every other caller leaves it undefined and is byte-identical.
  const atlasCleanBase = (params as any).atlasCleanBase === true;
  const atlasNoseEdge: AtlasNoseEdge = atlasNoseEdgeInput((params as any).atlasNoseEdge);
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

    // FLAT-MASTER: same creative brief, flat print-production output. The
    // depth requirement and the branding-composition call survive verbatim;
    // only the on-vehicle photograph framing changes. On the proof sheet the
    // object is named as a FILE (owner, 2026-09-22): "as they look coming off
    // the printer" read as a photograph of printed film, and the model drew
    // one — a piece of wrap film on a table. A graphic designer's PNG/TIFF
    // for the printer, in the form of the attached finished proof, is the
    // deliverable, and the sentence says so.
    const atlasScene = atlasProofSheet
      ? `Build the print file for a ${vehicle} (${atlasBodyClass}) wrap: six flat design panels, laid out the way a wrap-shop graphic designer builds the PNG or TIFF that goes to the printer — flat artwork on the sheet, in exactly the form of the attached finished proof. ONE design across all of them. It is built from layered elements — background color and texture, mid-ground graphic motion, and foreground accent detail — with real dimension rather than flat shapes. The company name reads clearly at a glance; how the branding is composed is your creative call.`
      : atlasHero
      ? atlasHeroScene(vehicle, atlasBodyClass, atlasHero, true)
      : atlasField
      ? `Design the printed wrap artwork for a ${vehicle} (${atlasBodyClass}) as ONE continuous full-bleed field of pure printed vinyl artwork — the way the vinyl looks coming off the printer before anything is cut or applied, never an on-vehicle photograph. This is the single design authority for the complete vehicle — one design, one composition. The design is built from layered elements — background color and texture flowing continuously across the whole field, mid-ground graphic motion, and foreground accent detail — with real dimension rather than flat shapes on bare vinyl. The company name reads clearly at a glance; how the branding is composed is your creative call.`
      : `Design the printed wrap artwork for a ${vehicle} (${atlasBodyClass}) as ONE FLAT print-production master — flat orthographic panels of pure printed vinyl artwork, never an on-vehicle photograph. This is the single design authority for the complete vehicle, not six independent graphics. The design is built from layered elements — background color and texture flowing across the panels, mid-ground graphic motion, and foreground accent detail — with real dimension rather than flat shapes on bare panel. The company name reads clearly at a glance; how the branding is composed is your creative call.`;

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
      ? `You are the senior graphic designer and vehicle-wrap specialist at a sign and wrap company — 20 years of $5,000-per-vehicle commercial fleet graphics, printed on vinyl and installed on real trucks and vans. You amplify each brief into an original design built for this one business — premium, readable at a glance from across a parking lot, and worth what the customer paid. Use your native Gemini 3 Pro Image design knowledge.`
      : `You are the senior graphic designer at a sign and wrap company — 20 years of $5,000-per-vehicle commercial fleet graphics, printed on vinyl and installed on real trucks and vans. You amplify each brief into an original design built for this one business — premium, readable at a glance from across a parking lot, and worth what the customer paid.`;

    let assembled = `${commercialIdentity}

${commercialPresentation}

THE CONCEPT — the heart of this design; build everything around it:
Client's creative direction: "${creativeDirection}"
${atlasField ? COMMERCIAL_TRANSLATION_FIELD : COMMERCIAL_TRANSLATION}

CLIENT BRIEF:`;

    if (atlasCleanBase) {
      // Layer 0: no name, no logo, no phone, no website, no customer copy. Those
      // are separate artifacts composited at a known box by master.composite.
      assembled += ATLAS_CLEAN_BASE_CONTRACT;
    } else if (companyName) {
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
    if (atlasCleanBase) {
      // deliberately nothing: the contact bar is contact.produce's artifact.
    } else if (phone) {
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
    if (atlasCleanBase) {
      // deliberately nothing, same reason.
    } else if (website) {
      assembled += `\nWebsite (place in the contact bar): ${website} — display this EXACT URL, character for character. Never alter or invent it.`;
    } else {
      assembled += `\nNo website was supplied — invent no website, email address or street address, and display none anywhere on the design.`;
    }
    if (atlasCleanBase) {
      // The customer's own copy is type. It belongs to the element layer.
    } else if (textLayerPrompt) {
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
    if (mascot && atlasHero) {
      assembled = assembled.replace(
        "Integrate it as a coordinated hero graphic in both flank fields, sized to complement the company name without crowding it.",
        "Integrate it as the hero graphic on this sheet, sized to complement the company name without crowding it.",
      );
    }

    if (qrEnabled) {
      assembled += atlasFlatMaster
        ? atlasHero
          ? `\n\nQR CODE ZONE: Reserve one clean, flat rectangular area in the lower portion of this sheet as space for a scannable QR code added in production.`
          : `\n\nQR CODE ZONE: Reserve one clean, flat rectangular area in the coordinated lower portion of each flank field as space for a scannable QR code added in production.`
        : `\n\nQR CODE ZONE: Reserve one clean, flat, evenly-lit rectangular area (roughly 10x10 inches) low on the rear quarter panel — free of graphics, text, and busy color — as space for a scannable QR code added in production. Do not draw a QR code yourself.`;
    }


    assembled += `\n\n${PROFESSIONAL_JUDGMENT}`;

    // VisionBoardIQ — follows Gemini's "high-fidelity detail preservation" and "style transfer" patterns
    if (visionBoardImages && visionBoardImages.length > 0) {
      if (visionboard_intent === 'exact_reference') {
        assembled += atlasFlatMaster
          ? `\n\nEXACT REFERENCE: The provided reference is the customer's approved artwork authority. Recreate its colors, patterns, typography, logos, layout, composition, proportions and visual hierarchy faithfully across ${atlasProofSheet ? "every panel" : atlasField ? "the whole continuous field" : atlasHero ? "this one sheet" : "the six mapped livery fields"}.`
          : `\n\nEXACT REFERENCE: The provided reference is the customer's own approved wrap design for their vehicle. Recreate it faithfully on the ${vehicle} — keep the colors, patterns, typography, logos, layout, and composition true to the reference, adapting only to fit the ${vehicle}'s body lines and preserving the design's identity, proportions, and visual hierarchy.`;
      } else if (styleDescriptors) {
        assembled += `\n\nSTYLE INSPIRATION: Transform the visual style from the client's reference images into an ORIGINAL wrap design. Style DNA extracted from references:\n${styleDescriptors}\nCreate something new that captures this energy — do not reproduce the reference images directly.`;
      } else {
        assembled += atlasFlatMaster
          ? `\n\nSTYLE INSPIRATION: Transform the mood, colors, and artistic style of the provided reference images into an ORIGINAL ${atlasProofSheet ? "livery across the panels" : atlasField ? "continuous livery field" : atlasHero ? "single-sheet livery" : "six-field livery"}. Use them as style inspiration only — create something new that captures their energy.`
          : `\n\nSTYLE INSPIRATION: Transform the mood, colors, and artistic style of the provided reference images into an ORIGINAL wrap design for this vehicle. Use them as style inspiration only — create something new that captures their energy.`;
      }
    }

    // PHOTOGRAPHIC REALISM LOCK — only when the brief names a real photo scene.
    if (wantsPhoto) assembled += `\n\n${PHOTO_REALISM_LOCK}`;

    if (atlasField) {
      assembled += `\nFinish: ${atlasFinishSpec(finishSpec)} The vinyl finish is ${(finish || 'gloss').toLowerCase()} across the whole field — one consistent finish throughout.\nThe artwork fills the entire field edge to edge — solid printed vinyl, corner to corner.`;
      assembled += `\n\n${atlasFieldContract(vehicle, atlasBodyClass, atlasNoseEdge, true, atlasPanels)}`;
      return assembled;
    }
    if (atlasHero) {
      assembled += `\nFinish: ${atlasFinishSpec(finishSpec)} The vinyl finish is ${(finish || 'gloss').toLowerCase()} across the whole sheet — one consistent finish throughout.\nThe artwork fills the sheet edge to edge — solid printed vinyl, corner to corner.`;
      assembled += `\n\n${atlasHeroSurfaceContract(atlasHero, vehicle, atlasBodyClass)}`;
      return assembled;
    }
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
  // The three-zone Production Panel Proof names its own object, exactly as the
  // commercial branch does above: the panels themselves, as printed, one design
  // across all of them — restyle's layered-depth brief intact.
  const atlasRestyleScene = atlasProofSheet
    ? `Build the print file for a ${vehicle} (${atlasBodyClass}) wrap: six flat design panels, laid out the way a wrap-shop graphic designer builds the PNG or TIFF that goes to the printer — flat artwork on the sheet, in exactly the form of the attached finished proof. ONE design across all of them. Elevate the brief into a bold composition built from layered thematic elements — background atmosphere, mid-ground motion, foreground accent detail and a strong focal treatment — rich with depth and texture, with real dimension rather than flat shapes.`
    : atlasHero
    ? atlasHeroScene(vehicle, atlasBodyClass, atlasHero, false)
    : atlasField
    ? `Design the printed wrap artwork for a ${vehicle} (${atlasBodyClass}) as ONE continuous full-bleed field of pure printed vinyl artwork — the way the vinyl looks coming off the printer before anything is cut or applied, never an on-vehicle photograph. This is the single design authority for the complete vehicle — one design, one composition. Elevate the brief into a bold composition built from layered thematic elements — background atmosphere, mid-ground motion, foreground accent detail and a strong focal treatment — rich with depth and texture, with real dimension rather than flat shapes on bare vinyl.`
    : `Design the printed wrap artwork for a ${vehicle} (${atlasBodyClass}) as ONE FLAT print-production master — flat orthographic panels of pure printed vinyl artwork, never an on-vehicle photograph. This is the single design authority for the complete vehicle, not six independent graphics. Elevate the brief into a bold composition built from layered thematic elements — background atmosphere, mid-ground motion, foreground accent detail and a strong focal treatment — rich with depth and texture, with real dimension rather than flat shapes on bare panel.`;
  const restylePresentation = atlasFlatMaster
    ? atlasRestyleScene
    : `CAMERA ANGLE (LOCKED — read this FIRST):
${cameraAngle}

${restyleScene}

${studioEnvironment}`;

  const restyleFinish = atlasHero
    ? `PRINT COLOR: uniform artwork color across the whole sheet. Physical finish is applied only in downstream proof projections.`
    : atlasField
    ? `PRINT COLOR: uniform artwork color across the whole field. Physical finish is applied only in downstream proof projections.`
    : atlasFlatMaster
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
        ? `\nEXACT REFERENCE (REPRODUCE, DO NOT REDESIGN): The provided reference is the customer's approved artwork authority. Reproduce its exact colors, patterns, graphics, typography, layout, composition, logos, wordmarks and supplied text faithfully across ${atlasField ? "the whole continuous field" : atlasHero ? "this one sheet" : "the six mapped livery fields"}. Preserve its proportions, hierarchy, coverage and texture density.`
        : `\nEXACT REFERENCE (REPRODUCE, DO NOT REDESIGN): The provided reference is the customer's own approved wrap design. Reproduce it faithfully on the ${vehicle} — keep the exact colors, patterns, graphics, typography, layout, and composition true to the reference, adapting ONLY to fit the ${vehicle}'s body lines while preserving the design's identity, proportions, and visual hierarchy. Reproduce EVERY logo, wordmark, and line of text exactly once, in the same place and style as the reference — branding is PART of this design, never a separate layer to strip, relocate, duplicate, or reinvent. Do NOT redesign, reinterpret, recolor, simplify, or add elements; the ONLY thing that changes is the vehicle the design is applied to. Match the reference's full coverage and texture density — if it is an all-over textured wrap, cover the entire body edge to edge; where the reference leaves the body plain, keep it plain.`;
    } else if (styleDescriptors) {
      assembled += `\nSTYLE INSPIRATION: Transform the visual style from the client's reference images into an ORIGINAL wrap design. Style DNA:\n${styleDescriptors}\nCreate something new that captures this energy — do not reproduce the references directly.`;
    } else {
      assembled += atlasFlatMaster
        ? `\nSTYLE INSPIRATION: Transform the mood, colors, and artistic style of the provided reference images into an ORIGINAL ${atlasField ? "continuous livery field" : atlasHero ? "single-sheet livery" : "six-field livery"}. Use them as style inspiration only — create something new.`
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

  if (atlasField) {
    assembled += `\nFinish: ${atlasFinishSpec(finishSpec)} The vinyl finish is ${(finish || 'gloss').toLowerCase()} across the whole field — one consistent finish throughout.\nThe artwork fills the entire field edge to edge — solid printed vinyl, corner to corner.`;
    assembled += `\n\n${atlasFieldContract(vehicle, atlasBodyClass, atlasNoseEdge, false, atlasPanels)}`;
    return assembled;
  }
  if (atlasHero) {
    assembled += `\nFinish: ${atlasFinishSpec(finishSpec)} The vinyl finish is ${(finish || 'gloss').toLowerCase()} across the whole sheet — one consistent finish throughout.\nThe artwork fills the sheet edge to edge — solid printed vinyl, corner to corner.`;
    assembled += `\n\n${atlasHeroSurfaceContract(atlasHero, vehicle, atlasBodyClass)}`;
    return assembled;
  }
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

export { buildDesignIQPrompt, briefWantsPhoto, splitStyleAndText };
