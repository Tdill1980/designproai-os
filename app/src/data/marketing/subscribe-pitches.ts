/**
 * Subscribe pitch library — reusable, multi-channel marketing copy
 * for driving DesignProAI tier subscriptions.
 *
 * Each pitch hits a specific angle (cost, time, equity, speed, toolkit,
 * urgency) and ships ready-to-use copy for FIVE channels:
 *
 *   1. Email — subject + preview text
 *   2. SMS — single-segment body (≤160 chars after merge tags)
 *   3. Meta Ads — headline (≤40 char), primary text (≤125), description (≤30)
 *   4. Landing page — hero h1 + sub
 *   5. In-app callout — short sentence + CTA label
 *
 * Use the angle id (e.g. PITCH_BY_ID.cost) to pull a pitch programmatically.
 * Use ALL_PITCHES to render a Campaign Studio dashboard (every angle at
 * a glance for A/B test or rotation).
 *
 * Adding a new angle: append a new entry to ALL_PITCHES. Keep one angle
 * per id — they're meant to be sharply differentiated, not duplicates.
 */

export type PitchAngle =
  | "cost"
  | "time"
  | "equity"
  | "speed"
  | "toolkit"
  | "urgency";

export interface ChannelCopy {
  /** Email subject line. Keep under 60 chars for inbox display. */
  emailSubject: string;
  /** Email pre-header / preview text. 60–100 chars optimal. */
  emailPreview: string;
  /** SMS body. Single-segment safe (≤160 chars after merge-tag substitution). */
  sms: string;
  /** Meta ad headline. Hard cap 40 chars per Meta spec. */
  adHeadline: string;
  /** Meta ad primary text. Hard cap 125 chars per Meta spec. */
  adPrimary: string;
  /** Meta ad description. Hard cap 30 chars per Meta spec. */
  adDescription: string;
  /** Landing page hero H1. */
  heroH1: string;
  /** Landing page hero subhead. 1 sentence. */
  heroSub: string;
  /** Short in-app callout (e.g. dropdown CTA). */
  inApp: string;
  /** Suggested CTA button label. */
  ctaLabel: string;
}

export interface SubscribePitch {
  id: PitchAngle;
  /** Display name for the Campaign Studio admin. */
  label: string;
  /** Internal one-liner explaining the angle. */
  thesis: string;
  /** Where this pitch performs best (audience targeting hint). */
  bestFor: string;
  copy: ChannelCopy;
}

// Shared landing URL — points at the live pricing page now that the
// /wpw-offer campaign page has been retired. Each pitch can still
// override per-channel if a tighter URL helps tracking.
const OFFER_URL = "https://designproai.com/pricing";

export const ALL_PITCHES: SubscribePitch[] = [
  // ── COST ──────────────────────────────────────────────────────────
  {
    id: "cost",
    label: "Cost — $50/mo less, locked for life",
    thesis: "Lead with the savings number. Concrete, specific, math-friendly.",
    bestFor: "Price-sensitive shop owners; warm WPW customers comparing value.",
    copy: {
      emailSubject: "{{customer_name}}, save $50/mo on DesignProAI — for life",
      emailPreview:
        "WPW Customer pricing locks $50/mo less than standard. Forever. From $349/mo.",
      sms: `{{customer_name}} — DesignProAI WPW pricing $349/mo, $50 less than standard, locked for life: ${OFFER_URL}#tiers  STOP to opt out.`,
      adHeadline: "Save $50/mo. Locked for life.",
      adPrimary:
        "WPW Customer pricing on DesignProAI: $50/mo less than standard, on every tier, forever. From $349/mo.",
      adDescription: "WPW Customer pricing",
      heroH1: "Save $50/mo on DesignProAI — locked for life.",
      heroSub:
        "WPW Customer pricing is $50/mo less than standard on every tier. Subscribe today and your rate stays — even after public launch.",
      inApp: "Save $50/mo for life — see WPW Customer pricing →",
      ctaLabel: "Lock in WPW pricing",
    },
  },

  // ── TIME ──────────────────────────────────────────────────────────
  {
    id: "time",
    label: "Time — print-ready files in 48 hours",
    thesis: "Speed-of-delivery angle. Targets shops drowning in turnaround.",
    bestFor: "Busy production shops; fleet jobs; anyone losing money on TAT.",
    copy: {
      emailSubject: "{{customer_name}}, print-ready files in 48 hours",
      emailPreview:
        "Visualizer → DesignPro → ApprovePro → $299 Production Pack → files in your WrapBox in 48hrs.",
      sms: `{{customer_name}} — design + approve + buy the $299 Production Pack. Print-ready files in your WrapBox 48hrs later: ${OFFER_URL}`,
      adHeadline: "Files in your WrapBox in 48hrs",
      adPrimary:
        "Approve the AI design, buy the $299 Production Pack, and print-ready files land in your WrapBox 48 hours later. Yours forever.",
      adDescription: "48hr turnaround",
      heroH1: "Print-ready wrap files in 48 hours.",
      heroSub:
        "Approve a design, buy the $299 Production Pack, and a real human design team delivers print-ready files into your WrapBox in 48 hours.",
      inApp: "Production Pack → 48hrs to your WrapBox →",
      ctaLabel: "See the 48hr flow",
    },
  },

  // ── EQUITY ────────────────────────────────────────────────────────
  {
    id: "equity",
    label: "Equity — files you own forever",
    thesis:
      "Ownership angle. Print once, reprint, or resell — these aren't rentals.",
    bestFor: "Shops thinking long-term; design-driven brands; reprint-heavy.",
    copy: {
      emailSubject:
        "{{customer_name}}, the wrap files are yours — forever",
      emailPreview:
        "Print once, reprint, or resell. The $299 Production Pack delivers files you own outright. Your design equity.",
      sms: `{{customer_name}} — design + $299 Production Pack = print-ready files YOU OWN. Print, reprint, or resell. Forever: ${OFFER_URL}`,
      adHeadline: "Print files. Yours forever.",
      adPrimary:
        "Buy the $299 Production Pack and walk away with print-ready files you own outright. Print once, reprint, or resell — your design equity.",
      adDescription: "Files you own",
      heroH1: "Wrap files you own — forever.",
      heroSub:
        "Print once, reprint a hundred times, or resell. The $299 Production Pack delivers print-ready files outright. They're your design equity.",
      inApp: "Own the files. Forever. →",
      ctaLabel: "Own your design equity",
    },
  },

  // ── SPEED ─────────────────────────────────────────────────────────
  {
    id: "speed",
    label: "Speed — type a prompt, get a wrap design",
    thesis: "Magic-moment angle. AI does the heavy lifting; close the deal.",
    bestFor: "Solo wrappers; shops without a designer; cold leads who can't draw.",
    copy: {
      emailSubject:
        "{{customer_name}}, type a prompt → get a wrap design",
      emailPreview:
        "DesignPro generates a photoreal wrap mock on the customer's vehicle in seconds. Built for shops who can't draw but can sell.",
      sms: `{{customer_name}} — type "matte black with cyan flames" and DesignPro generates a photoreal wrap on the customer's vehicle in seconds: ${OFFER_URL}`,
      adHeadline: "Type a prompt. Sell the wrap.",
      adPrimary:
        "DesignPro generates photoreal AI wrap mockups on the customer's exact vehicle in seconds. No drawing skills required.",
      adDescription: "AI wrap designer",
      heroH1: "Type a prompt. Get a wrap.",
      heroSub:
        "DesignPro generates a photoreal AI mock of the wrap on the customer's vehicle in seconds. Built for shops who can't draw but can sell.",
      inApp: "Type a prompt → photoreal wrap →",
      ctaLabel: "Try DesignPro",
    },
  },

  // ── TOOLKIT ───────────────────────────────────────────────────────
  {
    id: "toolkit",
    label: "Toolkit — the whole engine, one price",
    thesis: "Bundle angle. No upsells, no add-ons, no opt-out discounts.",
    bestFor: "Comparison shoppers; anyone evaluating a stack of point tools.",
    copy: {
      emailSubject:
        "{{customer_name}}, the full toolkit (no upcharges, no add-ons)",
      emailPreview:
        "Shop CMS + branded quote builder + DesignIQ + ProductionFlow + MarketingHub. Every tier. From $349/mo.",
      sms: `{{customer_name}} — full toolkit at one price: Shop CMS, quote builder, DesignIQ, ProductionFlow, MarketingHub. From $349/mo: ${OFFER_URL}#tiers`,
      adHeadline: "The whole engine. One price.",
      adPrimary:
        "Shop CMS, quote builder with your pricing, DesignIQ, ProductionFlow, MarketingHub — every tier ships with the full toolkit. From $349/mo.",
      adDescription: "Full toolkit",
      heroH1: "Three engines. One platform. One price.",
      heroSub:
        "Every tier includes the full toolkit — Shop CMS, branded quote builder, DesignIQ, ProductionFlow, MarketingHub. You can't opt out for a discount; the price is the price.",
      inApp: "Whole engine, one price — see tiers →",
      ctaLabel: "See the full toolkit",
    },
  },

  // ── URGENCY ───────────────────────────────────────────────────────
  {
    id: "urgency",
    label: "Urgency — lock it in before public launch",
    thesis:
      "Deadline angle. Public launch resets standard pricing. Subscribe-or-lose.",
    bestFor: "Late-funnel; people who've seen the offer twice; cart abandons.",
    copy: {
      emailSubject:
        "{{customer_name}}, last call — lock in $349/mo before public launch",
      emailPreview:
        "After launch the Starter tier rolls back to $399/mo. Your WPW Customer rate is for life if you subscribe today.",
      sms: `Last call {{customer_name}} — WPW Customer rate $349/mo before public launch resets pricing to $399/mo. Lock it in: ${OFFER_URL}#tiers`,
      adHeadline: "Last call — $349/mo locked",
      adPrimary:
        "Public launch resets DesignProAI Starter to $399/mo. Subscribe at WPW Customer pricing today and your rate stays at $349/mo — for life.",
      adDescription: "Pricing locks soon",
      heroH1: "Last call — lock in $349/mo for life.",
      heroSub:
        "After public launch the Starter tier rolls back to $399/mo. Subscribe today and your WPW Customer rate stays — every renewal, forever.",
      inApp: "Lock $349/mo before public launch →",
      ctaLabel: "Lock it in now",
    },
  },
];

/** O(1) lookup by angle id. */
export const PITCH_BY_ID: Record<PitchAngle, SubscribePitch> = ALL_PITCHES.reduce(
  (acc, p) => {
    acc[p.id] = p;
    return acc;
  },
  {} as Record<PitchAngle, SubscribePitch>,
);

/** Channel keys for iteration in admin UIs. */
export const CHANNEL_KEYS: Array<keyof ChannelCopy> = [
  "emailSubject",
  "emailPreview",
  "sms",
  "adHeadline",
  "adPrimary",
  "adDescription",
  "heroH1",
  "heroSub",
  "inApp",
  "ctaLabel",
];

/** Soft-validate channel-specific char limits. Returns issues for the
 *  Campaign Studio admin to flag (doesn't throw — just reports). */
export function checkPitchLimits(p: SubscribePitch): string[] {
  const issues: string[] = [];
  const c = p.copy;
  if (c.emailSubject.length > 60)
    issues.push(`Subject ${c.emailSubject.length}/60 chars (Gmail truncates)`);
  if (c.emailPreview.length > 120)
    issues.push(`Preview ${c.emailPreview.length}/120 chars`);
  if (c.sms.length > 160)
    issues.push(`SMS ${c.sms.length}/160 (will split into multiple segments)`);
  if (c.adHeadline.length > 40)
    issues.push(`Ad headline ${c.adHeadline.length}/40 (Meta truncates)`);
  if (c.adPrimary.length > 125)
    issues.push(`Ad primary ${c.adPrimary.length}/125 (Meta truncates)`);
  if (c.adDescription.length > 30)
    issues.push(`Ad description ${c.adDescription.length}/30 (Meta truncates)`);
  return issues;
}
