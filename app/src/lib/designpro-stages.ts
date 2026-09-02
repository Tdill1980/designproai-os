/**
 * Operator-readable names for the automatic workflow stages the server owns.
 *
 * The keys are the stage keys the gateway reports. An unmapped key is shown
 * verbatim rather than hidden — a stage the browser does not recognise is
 * information, not something to swallow.
 */
export const STAGE_LABEL: Record<string, string> = {
  "revision.freeze": "Accepted A.T.L.A.S. revision locked",
  "manifest.resolve": "GENIE dimensions and square footage",
  "proof.build": "Call 8 · Flat 2D proof",
  "panels.build": "Call 9 · Promote exact Call-1 A.T.L.A.S. panels",
  "logos.extract": "Call 10 · Exact logo inventory",
  "pack.verify": "Production preview verification",
  "pack.activate": "Production preview active",
  "source.verify": "Production source verification",
  await_panelpro_preflight_qc: "PanelPro preflight",
  "enhance.upscale": "Call 12 · Topaz print enhancement",
  "output.build": "Production output",
  "output.verify": "Output file verification",
  await_final_human_qc: "Final production QC",
  "stamp.build": "Approval stamp",
  "zip.build": "Production ZIP",
  "wrapbox.deliver": "WrapBox delivery",
};

/**
 * The two human release gates. Approval is refused by the database unless every
 * check is explicitly confirmed, so the browser lists them rather than
 * summarising them.
 */
export const PREFLIGHT_CHECKS: Array<[string, string]> = [
  ["dimensionsVerified", "GENIE trim dimensions and total square footage match the approved vehicle record"],
  ["sourceRegionsVerified", "Driver, passenger, hood, roof, front and rear each match their frozen Call-1 A.T.L.A.S. panel and accepted master lineage"],
  ["fiveInchBleed", "Every production surface contains exactly 5 inches of bleed on all four edges"],
  ["panelHashesVerified", "Every promoted production panel hash matches its frozen Call-1 A.T.L.A.S. source panel"],
  ["logoInventoryVerified", "Call 10 logo count, identity and surface assignment exactly match the frozen inventory"],
  ["textLockVerified", "Every required body-text character matches the frozen revision text lock"],
  ["panelDataSlugVerified", "The panel data slug on every QC panel was read and every field matches the panel map (surface, vehicle, trim, print, bleed, DID, revision, hashes)"],
];

/**
 * IS EVERYTHING ACTUALLY THERE — the design team's presence sweep.
 *
 * Owner, 2026-08-28: "All the checks must be visible in UI on PanelProStudio
 * ... it was just missing the written checkboxes for QC the design team needs
 * to use", followed by the list itself.
 *
 * PREFLIGHT_CHECKS below asks whether the pack is CORRECT. This asks the
 * question that comes first and had no written form: is every artifact the
 * pack is supposed to contain actually present. A designer could see a board
 * full of tiles and still not be able to state, on the record, that the seven
 * proofs and eighteen production files exist.
 *
 * Each row is rendered beside EVIDENCE the board computes from the server's own
 * artifacts -- the counts, the formats, the identities. The evidence is
 * computed; the box is only ever ticked by a person. That split is RULE 0.22's:
 * PanelPro QC is human design-team QC, and a machine may show what it found but
 * never sign for it.
 */
export const PACK_PRESENCE_CHECKS: Array<[string, string]> = [
  ["atlasPresent", "A.T.L.A.S. master present, with its Generation ID"],
  ["designIdPresent", "Design ID present"],
  ["sevenProofsPresent", "All 7 3D proofs present and descended from this A.T.L.A.S. revision"],
  ["proofsIndividuallyPresent", "Each 3D proof is its own file, individually downloadable"],
  ["resolutionPresent", "Resolution stated on every panel"],
  ["dimensionsPresent", "Trim, print and bleed dimensions stated on every panel"],
  ["panelQtyPresent", "All 6 deterministic print panels present"],
  ["assetsSeparate", "Logos / branding separated as their own assets"],
  ["tiffPresent", "TIFF production files present"],
  ["pngPresent", "PNG production files present"],
  ["productionProofPresent", "2D Production Proof present"],
];

export const FINAL_CHECKS: Array<[string, string]> = [
  ["outputHashesVerified", "Every PNG, TIFF and EPS output hash matches the verified output receipt"],
  ["printDimensionsVerified", "Final print dimensions, resolution and bleed match GENIE"],
  ["colorModeVerified", "Final production color-mode requirements are verified"],
  ["productionSlugVerified", "Every production PNG, TIFF and EPS carries the panel data slug on its bottom edge (1.5\" outside the bleed) and its fields match the panel map"],
];

/**
 * Production output is three formats per printed surface — six surfaces times
 * PNG, TIFF and EPS is the eighteen verified files the final gate signs off.
 */
export const OUTPUT_FORMATS = ["png", "tiff", "eps"] as const;
export const EXPECTED_OUTPUT_FILES = 18;

export function outputFormatOf(storagePath: string): (typeof OUTPUT_FORMATS)[number] | null {
  const lower = storagePath.toLowerCase();
  if (lower.endsWith(".png")) return "png";
  if (lower.endsWith(".tiff")) return "tiff";
  if (lower.endsWith(".eps")) return "eps";
  return null;
}
