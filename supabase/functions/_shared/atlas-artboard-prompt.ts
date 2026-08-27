/**
 * atlas-artboard-prompt.ts — THE CANONICAL CALL-1 PROMPT ASSEMBLY.
 *
 * Owner directive (Trish 2026-08-26/27, PASTE_TO_CLAUDE.md): Call 1 executes
 * the REAL Persona-2 designer brain (buildDesignerPrompt, pinned restylepro-os
 * 113d137) and combines it with the DPAG artboard mechanics and the
 * flat-master output contract. This module is that one canonical assembly —
 * the deployed design-panel-ai-generate imports it, and the test suite
 * transpiles and EXECUTES this exact file, so what is locked is what ships.
 *
 * THE PERSONA PROMPT IS EXECUTED, NOT RE-TYPED. Its creative core passes
 * through verbatim; only its PRESENTATION tail (studio scene, side camera,
 * on-vehicle photograph lines — which the owner's authority split sends
 * downstream to the proofs) is swapped for the flat-master output contract.
 * Every swap is an EXACT-MATCH replacement that throws if the persona source
 * drifts, so this module can never silently rewrite the designer's words.
 */

import { buildDesignerPrompt } from "./persona-designer-prompt.ts";
import { STUDIO_ENVIRONMENT } from "./studio-os.ts";
import { getCameraAngle } from "./view-angles-os.ts";

export const ATLAS_ARTBOARD_PROMPT_VERSION = "atlas-artboard-persona.20260827.v1";
export const ATLAS_ARTBOARD_SOURCE_COMMIT = "113d137dbe8813ca3bf70c8d7265ad081ebd4524";

// THE AUTHORING MODEL IS PINNED BY NAME, AND THE NAME IS THE GA ID.
// Byte-identical to runtime/designiq-prompt.cjs's DESIGNPANEL_AUTHORING_MODEL —
// the eleven-run fleet measurement (CLAUDE.md RULE 0.16) chose the GA id over
// -preview, and the Flamingo master this product is judged against was authored
// on it. Never an env lookup: the projections may follow GOOGLE_IMAGE_MODEL,
// the design authority may not.
export const ATLAS_ARTBOARD_AUTHORING_MODEL = "gemini-3-pro-image";

// THE OWNER LOGO CONTRACT (PASTE_TO_CLAUDE.md: "plain company-name typography
// alone does not satisfy the logo requirement; the Call-1 designer must create
// the logo inside the same accepted master when none is supplied"). The three
// literals below are byte-for-byte the canonical DPAG/A.C.E. values —
// LOGO_REQUIREMENT and buildLogoArchitecture from
// design-panel-ai-generate/index.ts at 113d137, LOGO_AUTHORING_RULE from the
// owner persona contract — and tests/designpro-persona-contract.test.mjs
// asserts byte-equality against runtime/designiq-prompt.cjs so the two homes
// can never drift apart.
export const LOGO_REQUIREMENT =
  "This business needs its own logo — decide its form from this brief alone.";

export function buildLogoArchitecture(_companyName: string, _industryType?: string): string {
  // NO FORM PRESCRIBED, DELIBERATELY — byte-for-byte the canonical DPAG
  // behaviour (index.ts, same file's own history: the requirement returns,
  // the prescription stays gone).
  return `\nSpell the business name exactly. ${LOGO_REQUIREMENT}`;
}

export const ATLAS_LOGO_AUTHORING_RULE =
  "Design an actual brand mark for it — the company name set in a typeface is not a logo, "
  + "however well it is set. The name may lock up with the mark, sit beside it or be built "
  + "into it; the mark's form, register and construction are your call and the brief's.";

// THE OWNER CONTACT CONTRACT (PASTE_TO_CLAUDE.md: "keep exact supplied
// text/contact data; never invent customer information"). Byte-for-byte the
// runtime/designiq-prompt.cjs literals; tests/designpro-reference-authority
// asserts equality so the two homes cannot drift.
export function contactLock(phone?: string, website?: string): string {
  let text = "";
  if (phone) {
    text += `\nContact info (place in the contact bar): ${phone} — display this EXACT number, digit for digit. Never alter or invent any digits.`;
  } else {
    text += `\nNo phone number was provided — do NOT invent, fabricate, or display any phone number anywhere on the vehicle.`;
  }
  if (website) {
    text += `\nWebsite (place in the contact bar): ${website} — display this EXACT URL, character for character. Never alter or invent it.`;
  } else {
    text += `\nNo website was supplied — invent no website, email address or street address, and display none anywhere on the design.`;
  }
  return text;
}

export interface AtlasPanel {
  label: string;
  widthInches?: number;
  heightInches?: number;
}

export interface AtlasArtboardPromptInput {
  brief: string;
  authoringMode: "commercial" | "restyle";
  vehicleYear?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  finish?: string;
  companyName?: string;
  phone?: string;
  website?: string;
  mascot?: string;
  industryType?: string;
  bulletPoints?: string[];
  logoSupplied?: boolean;
  hasVisionBoardImages?: boolean;
  visionboardIntent?: "style_inspiration" | "exact_reference";
  panels: AtlasPanel[];
}

function atlasSwap(prompt: string, target: string, replacement: string): string {
  if (!prompt.includes(target)) {
    throw new Error(`atlas_artboard_persona_drift: expected persona text not found: ${target.slice(0, 60)}`);
  }
  return prompt.replace(target, replacement);
}

export function buildAtlasArtboardPrompt(input: AtlasArtboardPromptInput): string {
  const brief = String(input.brief || "").trim();
  if (!brief) throw new Error("atlas_artboard_brief_missing");
  const authoringMode = input.authoringMode === "restyle" ? "restyle" : "commercial";
  const panelLines = (input.panels || [])
    .map((p) => `• ${p.label}${p.widthInches && p.heightInches ? ` — ${p.widthInches}" x ${p.heightInches}"` : ""}`)
    .join("\n");

  // 1 — EXECUTE the real Persona-2 designer brain.
  let prompt = buildDesignerPrompt({
    enrichedBrief: brief,
    mode: authoringMode,
    vehicleYear: input.vehicleYear,
    vehicleMake: input.vehicleMake,
    vehicleModel: input.vehicleModel,
    finish: input.finish || "Gloss",
    companyName: input.companyName || undefined,
    phone: input.phone || undefined,
    mascot: input.mascot || undefined,
    industryType: input.industryType || undefined,
    bulletPoints: input.bulletPoints,
    hasVisionBoardImages: input.hasVisionBoardImages === true,
    visionboard_intent: input.visionboardIntent === "exact_reference" ? "exact_reference" : "style_inspiration",
  });

  // 2 — swap ONLY the presentation tail for the flat-master output contract.
  const flatContract = `OUTPUT FORMAT — ONE FLAT PRODUCTION MASTER on a single square 4K canvas:
Follow the attached layout guide exactly — paint each labeled panel inside its outlined rectangle; outside the rectangles the canvas stays blank.
${panelLines}
Each panel is ONE SOLID RECTANGLE of continuous wrap artwork, opaque corner to corner — paint straight through wherever a window, wheel arch, light or trim piece would sit; the installer cuts those openings from the printed vinyl later. Never draw the vehicle, its silhouette, or any cut-out shape.
PASSENGER SIDE is DRIVER SIDE's mirror twin — the same artwork reversed — with every word and logo forward-reading on both.
ONE cohesive wrap: the same design flows across all panels as a single artwork laid flat.
Any attached flattened-top-view reference teaches LAYOUT ONLY — take no artwork, wording, logo, colour or style from it.`;

  prompt = atlasSwap(
    prompt,
    authoringMode === "commercial"
      ? "Render it ON the vehicle in a studio — photorealistic, not a flat panel."
      : "Render it ON the vehicle in a studio.",
    "Deliver it as ONE FLAT print-production master — flat orthographic panels of pure wrap artwork, never an on-vehicle photograph.",
  );
  prompt = atlasSwap(prompt, `\n\n${STUDIO_ENVIRONMENT}`, "");
  prompt = atlasSwap(prompt, `\n${getCameraAngle("side")}`, "");
  prompt = atlasSwap(
    prompt,
    "Wrap covers painted body panels only. Windows, lights, wheels, trim stay factory.",
    "The artwork fills every rectangle edge to edge — solid printed vinyl, corner to corner.",
  );
  prompt = atlasSwap(
    prompt,
    "16:9 landscape, 4K. REAL PRINTED VINYL on the vehicle. Canon EOS R5 at 35mm f/8. INDISTINGUISHABLE from a real photograph.",
    flatContract,
  );

  // THE DESIGN-ANCHOR TEXT REQUEST IS A 3D-PROOF INSTRUCTION, AND IT MUST GO.
  //
  // The persona closes by asking for a design name and a DESIGN ANCHOR whose
  // stated purpose is "consistency across all camera angles" — the cross-view
  // contract for the seven proofs, not for a flat print master. Left in, it is
  // also the reason this call returned no image: measured twice on the
  // deployed function (2026-08-27, runs 33028387845 and 33028475640), Gemini
  // answered with finishReason STOP and the anchor text alone — it did the
  // writing it was asked for and drew nothing. The anchor belongs to the proof
  // stage, which has its own authority; here the last instruction must be the
  // output contract.
  prompt = atlasSwap(
    prompt,
    "\nBefore the image, output: 1) A creative design name (2-4 words, no trademarked names) 2) DESIGN ANCHOR: A detailed 3-sentence description of the design — colors with hex values, element positions relative to vehicle panels, flow direction, and key design features. This anchor ensures consistency across all camera angles.",
    "",
  );

  // 3 — the owner logo contract: commercial briefs with no supplied logo get a
  // DESIGNED mark, and set type never satisfies it. A supplied logo is the
  // authority and gets no competing demand; restyle carries no logo demand at
  // all (the persona's own NO TEXT OR BRANDING line survives the swaps).
  if (authoringMode === "commercial") {
    prompt += contactLock(input.phone, input.website);
  }
  if (authoringMode === "commercial" && input.logoSupplied !== true) {
    prompt += input.companyName
      ? `${buildLogoArchitecture(input.companyName, input.industryType)} ${ATLAS_LOGO_AUTHORING_RULE}`
      : `\nIdentify the business name from the brief and spell it exactly as written. ${LOGO_REQUIREMENT} ${ATLAS_LOGO_AUTHORING_RULE}`;
  }

  return prompt;
}
