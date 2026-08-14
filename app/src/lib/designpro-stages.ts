/**
 * Operator-readable names for the automatic workflow stages the server owns.
 *
 * The keys are the stage keys the gateway reports. An unmapped key is shown
 * verbatim rather than hidden — a stage the browser does not recognise is
 * information, not something to swallow.
 */
export const STAGE_LABEL: Record<string, string> = {
  "revision.freeze": "Seven source views locked",
  "manifest.resolve": "GENIE dimensions and square footage",
  "proof.build": "Call 8 · Flat 2D proof",
  "panels.build": "Call 9 · Exact per-surface panels",
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
  ["sourceRegionsVerified", "Driver, passenger, hood, roof, front and rear each come from their own Call 8 proof region"],
  ["fiveInchBleed", "Every production surface contains exactly 5 inches of bleed on all four edges"],
  ["panelHashesVerified", "Every panel hash matches its frozen Call 9 artifact"],
  ["logoInventoryVerified", "Call 10 logo count, identity and surface assignment exactly match the frozen inventory"],
  ["textLockVerified", "Every required body-text character matches the frozen revision text lock"],
];

export const FINAL_CHECKS: Array<[string, string]> = [
  ["outputHashesVerified", "Every PNG, TIFF and EPS output hash matches the verified output receipt"],
  ["printDimensionsVerified", "Final print dimensions, resolution and bleed match GENIE"],
  ["colorModeVerified", "Final production color-mode requirements are verified"],
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
