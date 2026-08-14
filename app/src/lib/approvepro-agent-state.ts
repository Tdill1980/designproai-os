/**
 * approvepro-agent-state — the "christmas tree" live status engine.
 *
 * Given a design-order proof row, Ace computes ONE live state: a color-coded
 * tag + the single recommended next action. Nothing stale — it's derived fresh
 * from the order's real data (status, age, brief, intake, design) every render.
 *
 * The signature rule: a design order older than 10 days with NO proof sent goes
 * NEON RED — urgent — recommending we send a status email and get the DesignPro
 * design done by EOD.
 */

import { classifyIntake } from "./approvepro-brief";

export interface AgentState {
  key: string;
  /** Short tag text shown on the order row. */
  label: string;
  /** Tag / dot / left-border color (hex). */
  dot: string;
  /** Text color (hex) for the recommendation line. */
  text: string;
  /** Neon-red urgent: pulses to demand attention. */
  urgent: boolean;
  /** The single recommended next action, phrased for one-click. */
  recommend: string;
}

// Statuses that mean a proof has actually gone to the customer.
const SENT_STATUSES = new Set([
  "sent", "viewed", "revising", "approved", "declined",
  "delivery_failed", "escalated_support", "resent",
]);

export const URGENT_DAYS = 10;

export function computeAgentState(
  o: any,
  opts: { hasDesign: boolean; orderDate?: string | null },
): AgentState {
  const status = String(o?.status || "").toLowerCase();
  const md = o?.metadata || {};
  const dateStr = opts.orderDate || o?.created_at || o?.updated_at || null;
  const ageDays = dateStr ? (Date.now() - new Date(dateStr).getTime()) / 86_400_000 : 0;
  // A real brief means RELEVANT design instructions (or uploaded art to
  // recreate) — WooCommerce form scaffolding like "Other | Please note in box
  // below…" does NOT count. No real brief → Missing info → invite the customer.
  const { hasBrief } = classifyIntake(md);
  const intakeSent = !!(md.instructions_requested_at || md.welcome_sent_at);
  const proofSent = SENT_STATUSES.has(status);

  // 🔴 NEON RED — older than 10 days with no proof sent.
  if (!proofSent && ageDays > URGENT_DAYS) {
    return {
      key: "overdue",
      label: `${Math.floor(ageDays)}d · NO PROOF`,
      dot: "#ff1744",
      text: "#e10031",
      urgent: true,
      recommend: "Send a status email + get the DesignPro design done by EOD",
    };
  }

  if (status === "approved") {
    return { key: "approved", label: "Approved", dot: "#16a34a", text: "#15803d", urgent: false, recommend: "Move to production / order the wrap" };
  }
  if (status === "declined") {
    return { key: "declined", label: "Declined", dot: "#6b7280", text: "#4b5563", urgent: false, recommend: "Read why, revise & resend" };
  }
  if (status === "revising") {
    return { key: "revising", label: "Revision requested", dot: "#a855f7", text: "#7c3aed", urgent: false, recommend: "Revise the design with DesignPro" };
  }
  if (proofSent) {
    return { key: "awaiting", label: "Awaiting customer", dot: "#f59e0b", text: "#b45309", urgent: false, recommend: "Nudge the customer — text the link" };
  }

  // Draft / not yet sent — the design-side pipeline.
  if (opts.hasDesign) {
    return { key: "ready", label: "Ready to send", dot: "#2563eb", text: "#1d4ed8", urgent: false, recommend: "Send the proof to the customer" };
  }
  if (hasBrief) {
    return { key: "design", label: "Needs design", dot: "#0080dd", text: "#0369a1", urgent: false, recommend: "Generate the design with DesignPro" };
  }
  // No relevant design instructions found → it's all "Missing info". The only
  // difference is whether we've emailed them yet: plain "Missing info" before
  // we reach out, "Missing info · invited" once the portal invite is out.
  if (!intakeSent) {
    return { key: "intake", label: "Missing info", dot: "#eab308", text: "#a16207", urgent: false, recommend: "Send welcome email + portal invite to collect the brief" };
  }
  return { key: "waiting", label: "Missing info · invited", dot: "#eab308", text: "#a16207", urgent: false, recommend: "Invited — waiting on the customer's brief (resend invite if stale)" };
}
