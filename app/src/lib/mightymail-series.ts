// ─────────────────────────────────────────────────────────────────────────
// MightyMail Automation Map
//
// Single source of truth for which templates belong to which series, when
// each email fires, and which event triggers the series. Used by:
//   - MightyMailLibrary UI (Asana-style grouping + timeline)
//   - send-templated-email orchestration (future)
//   - admin reporting (future)
//
// To add a new series: add an entry to MIGHTYMAIL_SERIES. Slugs must match
// rows in the email_templates table.
// ─────────────────────────────────────────────────────────────────────────

export type SeriesAudience =
  | 'rp-to-shop' // RestylePro -> wrap / tint / sign shops (sales side)
  | 'shop-to-customer' // Shop -> their end customer (drip / retarget)
  | 'shop-internal'; // Internal shop / admin notifications

export type TriggerType =
  | 'manual' // sender picks when to send
  | 'event' // fires immediately on app event
  | 'scheduled' // fires N days after event
  | 'campaign'; // bulk send to a list

export type SeriesPhase = 'acquisition' | 'activation' | 'expansion' | 'lifecycle' | 'transactional';

export interface SeriesEmail {
  slug: string;
  delayDays?: number;
  delayLabel: string;
  description: string;
  /** When true, this email is excluded from auto-fire by the orchestrator —
   *  it must be triggered by a separate event (e.g. ap-05-approved fires
   *  on customer approval, not when the proof is initially sent). */
  manualOnly?: boolean;
}

export interface MightyMailSeries {
  id: string;
  name: string;
  description: string;
  audience: SeriesAudience;
  phase: SeriesPhase;
  trigger: {
    type: TriggerType;
    event?: string;
    label: string;
  };
  accent: string; // tailwind color name e.g. 'cyan', 'fuchsia'
  emails: SeriesEmail[];
}

export const MIGHTYMAIL_SERIES: MightyMailSeries[] = [
  // ───── RP → Shop ───────────────────────────────────────────────────
  {
    id: 'rp-activation-retarget',
    name: 'Activation Retarget — First Render',
    description: 'Shop signed up but never generated a render. Drive the first render — the moment that predicts conversion.',
    audience: 'rp-to-shop',
    phase: 'activation',
    trigger: { type: 'event', event: 'signup_no_first_render', label: 'Signup, no render after ~1h' },
    accent: 'cyan',
    emails: [
      { slug: 'rp-act-01-first-render', delayDays: 0, delayLabel: 'Hour 1', description: '3-step nudge to the first render' },
      { slug: 'rp-act-02-see-it-real', delayDays: 1, delayLabel: 'Day 1', description: 'Real platform render as proof it works' },
      { slug: 'rp-act-03-founder-note', delayDays: 3, delayLabel: 'Day 3', description: 'Plain founder note from Trish — reply bait' },
      { slug: 'rp-act-04-ready-when-you-are', delayDays: 7, delayLabel: 'Day 7', description: 'Low-pressure close, open door' },
    ],
  },
  {
    id: 'rp-upgrade-retarget',
    name: 'Upgrade Retarget — Pricing Abandoned',
    description: 'Viewed pricing or hit the render cap without subscribing. Convert to a paid plan.',
    audience: 'rp-to-shop',
    phase: 'expansion',
    trigger: { type: 'event', event: 'pricing_viewed_no_subscribe', label: 'Pricing view / quota hit, no plan' },
    accent: 'fuchsia',
    emails: [
      { slug: 'rp-upg-01-plan-recap', delayDays: 0, delayLabel: 'Same day', description: 'Plans decoded — every plan has every tool' },
      { slug: 'rp-upg-02-design-math', delayDays: 1, delayLabel: 'Day 1', description: 'ROI: one $975 outsourced design vs a plan' },
      { slug: 'rp-upg-03-three-questions', delayDays: 3, delayLabel: 'Day 3', description: 'Objection handling — quality, print files, no contract' },
      { slug: 'rp-upg-04-rate-lock', delayDays: 5, delayLabel: 'Day 5', description: 'Honest urgency — rate locks at signup, series ends' },
    ],
  },
  {
    id: 'rp-winback',
    name: 'Win-Back — Dormant Shops',
    description: 'Active shop went quiet for 30+ days. Lead with their own work, end with an honest sunset email.',
    audience: 'rp-to-shop',
    phase: 'lifecycle',
    trigger: { type: 'event', event: 'dormant_30_days', label: 'No activity for 30 days' },
    accent: 'violet',
    emails: [
      { slug: 'rp-wb-01-your-design-waits', delayDays: 0, delayLabel: 'Day 30', description: 'Their own last render as the hero ({{hero_render_block}})' },
      { slug: 'rp-wb-02-what-shipped', delayDays: 4, delayLabel: '+4 days', description: 'What shipped while they were away' },
      { slug: 'rp-wb-03-before-we-go-quiet', delayDays: 10, delayLabel: '+10 days', description: 'Sunset email — feedback ask, then go quiet' },
    ],
  },

  // ───── Shop → Customer · Drip series ───────────────────────────────
  {
    id: 'mvp-12month',
    name: 'MyVehiclePro 12-Month Drip',
    description: 'Customer used MyVehiclePro to visualize their car. Nurture toward a wrap booking.',
    audience: 'shop-to-customer',
    phase: 'lifecycle',
    trigger: { type: 'event', event: 'myvehiclepro_visualized', label: 'After MyVehiclePro use' },
    accent: 'indigo',
    emails: [
      { slug: 'mvp-m01-welcome', delayDays: 0, delayLabel: 'Day 0', description: 'Welcome + book a consult' },
      { slug: 'mvp-m02-color-guide', delayDays: 30, delayLabel: 'Month 2', description: 'How to pick a color that ages well' },
      { slug: 'mvp-m03-vinyl-vs-paint', delayDays: 60, delayLabel: 'Month 3', description: 'Vinyl vs repaint cost breakdown' },
      { slug: 'mvp-m04-why-wraps-fail', delayDays: 90, delayLabel: 'Month 4', description: '3 reasons most wraps fail (not ours)' },
      { slug: 'mvp-m05-success-story', delayDays: 120, delayLabel: 'Month 5', description: '$12K-in-30-days success story' },
      { slug: 'mvp-m06-checkin', delayDays: 150, delayLabel: 'Month 6', description: 'Mid-year re-engagement' },
      { slug: 'mvp-m07-summer-prep', delayDays: 180, delayLabel: 'Month 7', description: 'Why summer is the wrong time to wrap' },
      { slug: 'mvp-m08-wrap-care', delayDays: 210, delayLabel: 'Month 8', description: 'Make your wrap last a decade' },
      { slug: 'mvp-m09-cost-real', delayDays: 240, delayLabel: 'Month 9', description: 'Real-money cost breakdown' },
      { slug: 'mvp-m10-trends', delayDays: 270, delayLabel: 'Month 10', description: '5 trends defining 2026' },
      { slug: 'mvp-m11-holiday', delayDays: 300, delayLabel: 'Month 11', description: 'Holiday gift card promo' },
      { slug: 'mvp-m12-anniversary', delayDays: 365, delayLabel: 'Month 12', description: 'Anniversary: design still waiting' },
    ],
  },
  {
    id: 'approvepro',
    name: 'ApprovePro Close-Rate',
    description: 'Photoreal proof sent → push to approval / revision.',
    audience: 'shop-to-customer',
    phase: 'transactional',
    trigger: { type: 'event', event: 'proof_sent', label: 'Proof delivered' },
    accent: 'sky',
    emails: [
      { slug: 'ap-01-proof-sent', delayDays: 0, delayLabel: 'Day 0', description: 'Proof ready — review and approve', manualOnly: true },
      { slug: 'ap-02-24h-reminder', delayDays: 1, delayLabel: '24h', description: 'Quick check — did it come through?' },
      { slug: 'ap-03-48h-revisions', delayDays: 2, delayLabel: '48h', description: 'Want to tweak the design?' },
      { slug: 'ap-04-72h-decision', delayDays: 3, delayLabel: '72h', description: 'Production slot held until tomorrow' },
      { slug: 'ap-05-approved', delayDays: 0, delayLabel: 'On approve', description: 'Approved — confirms install date', manualOnly: true },
    ],
  },
  {
    id: 'productionflow-upsell',
    name: 'ProductionFlow Upsell',
    description: 'Post-install. Drive UGC, reviews, add-on sales, referrals.',
    audience: 'shop-to-customer',
    phase: 'lifecycle',
    trigger: { type: 'event', event: 'install_complete', label: 'After install' },
    accent: 'rose',
    emails: [
      { slug: 'pf-01-7day-photos', delayDays: 7, delayLabel: 'Day 7', description: 'Send us a photo (UGC)' },
      { slug: 'pf-02-30day-review', delayDays: 30, delayLabel: 'Day 30', description: 'Leave a review for $50 off' },
      { slug: 'pf-03-tint-addon', delayDays: 60, delayLabel: 'Day 60', description: 'Tints / chrome delete / accents upsell' },
      { slug: 'pf-04-annual-refresh', delayDays: 365, delayLabel: 'Year 1', description: 'Time for a refresh' },
      { slug: 'pf-05-referral', delayDays: 90, delayLabel: 'Day 90', description: 'Referral ask + $200 credit' },
    ],
  },
  {
    id: 'retargeting',
    name: 'Retargeting Engine',
    description: 'Customer saw a preview / got a quote and went silent. Bring them back.',
    audience: 'shop-to-customer',
    phase: 'lifecycle',
    trigger: { type: 'event', event: 'preview_or_quote_no_decision', label: 'Preview/quote, no decision' },
    accent: 'violet',
    emails: [
      { slug: 'rt-01-same-day', delayDays: 0, delayLabel: 'Same day', description: 'What did you think?' },
      { slug: 'rt-02-reframe', delayDays: 2, delayLabel: 'Day 2', description: 'Still thinking about the color?' },
      { slug: 'rt-03-variation', delayDays: 4, delayLabel: 'Day 3-4', description: 'We made another option' },
      { slug: 'rt-04-confidence', delayDays: 5, delayLabel: 'Day 5', description: 'Most people decide right here' },
      { slug: 'rt-05-social-proof', delayDays: 7, delayLabel: 'Day 7', description: 'Quick note (no pressure)' },
      { slug: 'rt-06-soft-close', delayDays: 10, delayLabel: 'Day 10', description: 'Soft close — want to lock it in?' },
      { slug: 'rt-07-final-nudge', delayDays: 14, delayLabel: 'Day 14', description: 'Final nudge — door stays open' },
    ],
  },

  // ───── Shop → Customer · Standalones ───────────────────────────────
  {
    id: 'lifecycle-standards',
    name: 'Lifecycle Standards',
    description: 'Thank-you and review-request emails for any post-install moment.',
    audience: 'shop-to-customer',
    phase: 'transactional',
    trigger: { type: 'manual', label: 'Manual / campaign' },
    accent: 'emerald',
    emails: [
      { slug: 'shop-thank-you-formal', delayLabel: 'Manual', description: 'Thank-you (formal) — sincere post-install note' },
      { slug: 'shop-thank-you-witty', delayLabel: 'Manual', description: 'Thank-you (witty) — playful post-install note' },
      { slug: 'shop-review-request', delayLabel: 'Manual', description: 'Review request — clean ask, no discount hook' },
    ],
  },
  {
    id: 'educational',
    name: 'Educational',
    description: 'Authority pieces shops can send to prospects or past customers anytime.',
    audience: 'shop-to-customer',
    phase: 'lifecycle',
    trigger: { type: 'manual', label: 'Manual / campaign' },
    accent: 'sky',
    emails: [
      { slug: 'edu-color-guide', delayLabel: 'Manual', description: '3 rules for picking a wrap color you will love in year 5' },
      { slug: 'edu-wrap-care', delayLabel: 'Manual', description: 'Wrap care 101 — make yours last a decade' },
      { slug: 'edu-vinyl-vs-paint', delayLabel: 'Manual', description: 'Honest cost / time breakdown: wrap vs repaint' },
      { slug: 'shop-wrap-design-101', delayLabel: 'Manual', description: '5 wrap design rules for trade clients' },
    ],
  },
  {
    id: 'seasonal',
    name: 'Seasonal',
    description: 'Quarterly campaigns — wrap-season urgency through every season.',
    audience: 'shop-to-customer',
    phase: 'acquisition',
    trigger: { type: 'campaign', label: 'Manual / campaign' },
    accent: 'amber',
    emails: [
      { slug: 'seasonal-spring', delayLabel: 'Spring', description: 'Spring — best install weather, lock slots before heat' },
      { slug: 'seasonal-summer', delayLabel: 'Summer', description: 'Summer — UV protection angle' },
      { slug: 'seasonal-fall', delayLabel: 'Fall', description: 'Fall — pre-winter / pre-salt urgency' },
      { slug: 'seasonal-winter', delayLabel: 'Winter', description: 'Winter — salt + road grime defense' },
      { slug: 'seasonal-holiday', delayLabel: 'Holiday', description: 'Holiday — gift card promotion' },
    ],
  },
  {
    id: 'shop-marketing',
    name: 'Shop Marketing — Standalones',
    description: 'Single-shot marketing emails the shop sends to their customer list.',
    audience: 'shop-to-customer',
    phase: 'acquisition',
    trigger: { type: 'campaign', label: 'Manual / campaign' },
    accent: 'teal',
    emails: [
      { slug: 'whats-new-formal', delayLabel: 'Manual', description: "What's new at the shop (formal)" },
      { slug: 'whats-new-witty', delayLabel: 'Manual', description: "What's new at the shop (witty)" },
      { slug: 'five-reasons-wrap-formal', delayLabel: 'Manual', description: '5 reasons to design with us (formal)' },
      { slug: 'five-reasons-wrap-witty', delayLabel: 'Manual', description: '5 reasons to design with us (witty)' },
      { slug: 'shop-paid-render-formal', delayLabel: 'Manual', description: 'Paid $99 photoreal preview pitch (formal)' },
      { slug: 'shop-paid-render-witty', delayLabel: 'Manual', description: 'Paid $99 photoreal preview pitch (witty)' },
      { slug: 'shop-bookingpro-promo', delayLabel: 'Manual', description: 'BookingPro promo — book a slot' },
    ],
  },

  // ───── RP → WPW Customer Drip ──────────────────────────────────────
  // 5-email subscribe campaign for WePrintWraps customers. Two landing
  // variants (16:9 + 9:16); the variant chosen at enrollment is encoded
  // in mergeData.landingUrl. Bodies live in src/data/wpwOfferCampaign.ts
  // (WPW_OFFER_EMAIL_SERIES_HORIZONTAL / _VERTICAL); admin pastes each
  // rendered HTML into email_templates with the slugs below.
  {
    id: 'wpw-offer',
    name: 'WPW Customer Subscribe Drip',
    description:
      'WePrintWraps customers — 5-email drip that converts shop owners to paid RestylePro tiers ($349/mo Starter, locked for life).',
    audience: 'rp-to-shop',
    phase: 'acquisition',
    trigger: {
      type: 'campaign',
      event: 'wpw_offer_enroll',
      label: 'Manual enroll from /admin/mightymail or Campaign Studio',
    },
    accent: 'sky',
    emails: [
      { slug: 'wpw-offer-intro',       delayDays: 0,  delayLabel: 'Day 0',  description: 'Intro: try a design tool free + WPW Customer pricing from $349/mo' },
      { slug: 'wpw-offer-walkthrough', delayDays: 2,  delayLabel: 'Day 2',  description: 'Walkthrough: see the engine in 2 minutes' },
      { slug: 'wpw-offer-features',    delayDays: 5,  delayLabel: 'Day 5',  description: 'Features: full toolkit (Shop CMS, quote builder, MarketingHub) — no upcharges' },
      { slug: 'wpw-offer-pricing',     delayDays: 8,  delayLabel: 'Day 8',  description: 'Pricing: $50/mo less than standard, locked for life' },
      { slug: 'wpw-offer-lastcall',    delayDays: 12, delayLabel: 'Day 12', description: 'Last call: lock in $349/mo before public launch' },
    ],
  },
];

// ───── Helpers ──────────────────────────────────────────────────────
export function findSeriesForTemplate(slug: string): MightyMailSeries | null {
  for (const series of MIGHTYMAIL_SERIES) {
    if (series.emails.some((e) => e.slug === slug)) return series;
  }
  return null;
}

export function findEmailInSeries(slug: string): { series: MightyMailSeries; email: SeriesEmail } | null {
  for (const series of MIGHTYMAIL_SERIES) {
    const email = series.emails.find((e) => e.slug === slug);
    if (email) return { series, email };
  }
  return null;
}

export function getAllSeriesSlugs(): Set<string> {
  const set = new Set<string>();
  for (const series of MIGHTYMAIL_SERIES) {
    for (const email of series.emails) set.add(email.slug);
  }
  return set;
}

export const AUDIENCE_LABELS: Record<SeriesAudience, string> = {
  'rp-to-shop': 'RP → Shop',
  'shop-to-customer': 'Shop → Customer',
  'shop-internal': 'Internal',
};

export const PHASE_LABELS: Record<SeriesPhase, string> = {
  acquisition: 'Acquisition',
  activation: 'Activation',
  expansion: 'Expansion',
  lifecycle: 'Lifecycle',
  transactional: 'Transactional',
};

export const ACCENT_CLASSES: Record<
  string,
  { bg: string; text: string; border: string; dot: string; bgSoft: string }
> = {
  cyan: { bg: 'bg-cyan-500', text: 'text-cyan-600', border: 'border-cyan-500/40', dot: 'bg-cyan-500', bgSoft: 'bg-cyan-50' },
  fuchsia: { bg: 'bg-fuchsia-500', text: 'text-fuchsia-600', border: 'border-fuchsia-500/40', dot: 'bg-fuchsia-500', bgSoft: 'bg-fuchsia-50' },
  emerald: { bg: 'bg-emerald-500', text: 'text-emerald-600', border: 'border-emerald-500/40', dot: 'bg-emerald-500', bgSoft: 'bg-emerald-50' },
  amber: { bg: 'bg-amber-500', text: 'text-amber-600', border: 'border-amber-500/40', dot: 'bg-amber-500', bgSoft: 'bg-amber-50' },
  indigo: { bg: 'bg-indigo-500', text: 'text-indigo-600', border: 'border-indigo-500/40', dot: 'bg-indigo-500', bgSoft: 'bg-indigo-50' },
  sky: { bg: 'bg-sky-500', text: 'text-sky-600', border: 'border-sky-500/40', dot: 'bg-sky-500', bgSoft: 'bg-sky-50' },
  rose: { bg: 'bg-rose-500', text: 'text-rose-600', border: 'border-rose-500/40', dot: 'bg-rose-500', bgSoft: 'bg-rose-50' },
  violet: { bg: 'bg-violet-500', text: 'text-violet-600', border: 'border-violet-500/40', dot: 'bg-violet-500', bgSoft: 'bg-violet-50' },
  teal: { bg: 'bg-teal-500', text: 'text-teal-600', border: 'border-teal-500/40', dot: 'bg-teal-500', bgSoft: 'bg-teal-50' },
};
