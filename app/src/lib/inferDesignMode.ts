/**
 * ONE INFERENCE, ONE PLACE. THE CUSTOMER IS NOT ASKED.
 *
 * Owner, 2026-08-28: "Do not restore a customer-facing Commercial/ReStyle
 * selector. Mode is inferred once from the prepared intake. Company identity /
 * phone / website / logo / industry or clear business-service intent →
 * commercial. Otherwise use the existing deterministic keyword inference, then
 * restyle."
 *
 * ⚠️ THIS REVERSES A SELECTOR THAT WAS RESTORED EARLIER THE SAME DAY, and the
 * two instructions are not actually in conflict once read together. What the
 * owner objected to was removing the commercial/restyle CAPABILITY — the two
 * creative assemblies inside `design-panel-ai-generate` (COMMERCIAL_DEPTH,
 * COMMERCIAL_TRANSLATION, buildLogoArchitecture versus the restyle style
 * presets). Both assemblies stay, and `mode` still reaches the edge function.
 * What goes away is the CONTROL that made the customer choose between them.
 *
 * WHY IT IS DETERMINISTIC AND LOCAL. No LLM classification stage: that is
 * latency on the critical path before the customer sees anything, and the
 * medium-awareness rule in CLAUDE.md forbids adding one.
 *
 * WHY IT LIVES HERE. The same decision was made in four places with three
 * different rules — the studio hook (company name only), the home page
 * (company/phone/website), the brief keyword upgrade, and the operator page.
 * A customer could get a different design brain depending on which door they
 * came through. This is the only rule now.
 *
 * ⚠️ INFERRING THE MODE NEVER SUPPRESSES A FIELD. Nine values used to travel as
 * `mode === "commercial" ? x : undefined`, so a phone number typed on the wrong
 * side of a toggle was silently discarded on the way to the wrap — and that was
 * circular, because the mode is inferred FROM those same values. Everything the
 * customer entered is sent regardless of what this returns.
 */
export type DesignMode = "restyle" | "commercial";

export interface DesignModeSignals {
  companyName?: string | null;
  phone?: string | null;
  website?: string | null;
  industry?: string | null;
  /** A logo the customer uploaded, or one already injected by LogoPro. */
  hasLogo?: boolean;
  /** The customer's own words. Only consulted when no identity signal exists. */
  brief?: string | null;
}

/**
 * Clear business-service intent, from the brief alone.
 *
 * Ported verbatim from the auto-commercial routing in DesignPanelProPremium,
 * which existed because the restyle path has NO logo architecture: it bakes
 * text into the render and the 2D-proof flatten smears it into a ghosted
 * duplicate wordmark. A customer typing "commercial wrap for Acme, create a
 * logo" must not land there.
 */
const COMMERCIAL_INTENT =
  /\b(commercial|fleet|logo|business|compan|brand|est\.?\s*\d{4}|since\s*\d{4}|llc|\binc\b|\.com|\d{3}[-.\s]?\d{3}[-.\s]?\d{4})\b/;
const WRAP_FOR_SOMEONE = /\bwrap\s+for\s+\w/;

const filled = (value?: string | null) => Boolean(value && String(value).trim());

export function inferDesignMode(signals: DesignModeSignals): DesignMode {
  // 1. A business identity is decisive, and it is decisive on its own: a wrap
  //    carrying a company name, a number to call, a domain or a trade is a
  //    commercial job whatever else the brief says.
  if (
    filled(signals.companyName)
    || filled(signals.phone)
    || filled(signals.website)
    || filled(signals.industry)
    || signals.hasLogo === true
  ) {
    return "commercial";
  }
  // 2. Otherwise the customer's own words, by the existing deterministic test.
  const brief = String(signals.brief || "").toLowerCase();
  if (COMMERCIAL_INTENT.test(brief) || WRAP_FOR_SOMEONE.test(brief)) return "commercial";
  // 3. Otherwise it is a styling job.
  return "restyle";
}

export default inferDesignMode;
