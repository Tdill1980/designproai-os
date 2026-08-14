/**
 * Retargeting Templates — 3-day & 7-day follow-up sequences
 *
 * SMS + Email templates for automated lead follow-up.
 * Merge fields: {name}, {vehicle}, {shop}, {quote_url}, {price}
 */

// ── Template types ─────────────────────────────────────────────────

export type RetargetTier = "3day" | "7day" | "seasonal" | "sale" | "educational" | "review" | "referral";

export interface RetargetTemplate {
  id: string;
  tier: RetargetTier;
  channel: "sms" | "email";
  label: string;
  description: string;
  subject?: string; // email only
  body: string;
}

// ── 3-Day Templates (Warm follow-up) ──────────────────────────────

const DAY3_SMS_FRIENDLY: RetargetTemplate = {
  id: "3day-sms-friendly",
  tier: "3day",
  channel: "sms",
  label: "Friendly Check-in",
  description: "Casual follow-up, no pressure",
  body: `Hey {name}! {shop} here. Just checking in on your {vehicle} wrap quote. Still interested? Your estimate is ready: {quote_url}`,
};

const DAY3_SMS_VALUE: RetargetTemplate = {
  id: "3day-sms-value",
  tier: "3day",
  channel: "sms",
  label: "Value Reminder",
  description: "Highlights the quote value",
  body: `Hi {name}, your {vehicle} wrap estimate of {price} is still available. We're holding your spot — view it here: {quote_url} - {shop}`,
};

const DAY3_SMS_URGENCY: RetargetTemplate = {
  id: "3day-sms-urgency",
  tier: "3day",
  channel: "sms",
  label: "Soft Urgency",
  description: "Gentle time-sensitive nudge",
  body: `{name}, film prices update weekly. Your {vehicle} wrap quote at {price} is locked in for now. Don't miss it: {quote_url} - {shop}`,
};

const DAY3_EMAIL: RetargetTemplate = {
  id: "3day-email",
  tier: "3day",
  channel: "email",
  label: "3-Day Follow-up Email",
  description: "Professional email with quote recap",
  subject: "Your {vehicle} wrap quote is ready — {shop}",
  body: `Hi {name},

Just following up on your wrap quote for your {vehicle}.

Your estimated price: {price}
View your full quote: {quote_url}

We'd love to get your project on the schedule. If you have any questions about the wrap, materials, or timeline — just reply to this email or give us a call.

Thanks,
{shop}`,
};

// ── 7-Day Templates (Re-engagement) ──────────────────────────────

const DAY7_SMS_MISS_YOU: RetargetTemplate = {
  id: "7day-sms-missyou",
  tier: "7day",
  channel: "sms",
  label: "We Miss You",
  description: "Personal re-engagement",
  body: `Hey {name}! It's been a week since your {vehicle} wrap quote. Still thinking about it? We'd love to make it happen: {quote_url} - {shop}`,
};

const DAY7_SMS_LAST_CHANCE: RetargetTemplate = {
  id: "7day-sms-lastchance",
  tier: "7day",
  channel: "sms",
  label: "Last Chance",
  description: "Final follow-up before archive",
  body: `{name}, last check-in on your {vehicle} wrap. Your {price} quote expires soon. Lock it in: {quote_url} — Reply STOP to opt out. {shop}`,
};

const DAY7_SMS_INCENTIVE: RetargetTemplate = {
  id: "7day-sms-incentive",
  tier: "7day",
  channel: "sms",
  label: "Incentive Offer",
  description: "Offer a booking incentive",
  body: `{name}, book your {vehicle} wrap this week and we'll throw in free chrome delete. Your quote: {quote_url} - {shop}`,
};

const DAY7_EMAIL: RetargetTemplate = {
  id: "7day-email",
  tier: "7day",
  channel: "email",
  label: "7-Day Re-engagement Email",
  description: "Last touch email with incentive",
  subject: "Still thinking about wrapping your {vehicle}? — {shop}",
  body: `Hi {name},

It's been about a week since we put together your wrap quote for your {vehicle}, and we wanted to check in one last time.

Your quote: {price}
View it here: {quote_url}

We know wrapping a vehicle is a big decision. If price, timeline, or anything else is holding you back — let's talk. We're happy to work with you.

Book this week and ask about our current specials.

Talk soon,
{shop}`,
};

// ── Seasonal Templates ────────────────────────────────────────────

const SEASONAL_SMS_SUMMER: RetargetTemplate = {
  id: "seasonal-sms-summer",
  tier: "seasonal",
  channel: "sms",
  label: "Summer Ready",
  description: "Summer driving season promo",
  body: `{name}, summer's here and your {vehicle} deserves a fresh look! Get wrapped before the season heats up. See your quote: {quote_url} - {shop}`,
};

const SEASONAL_SMS_WINTER: RetargetTemplate = {
  id: "seasonal-sms-winter",
  tier: "seasonal",
  channel: "sms",
  label: "Winter Protection",
  description: "Winter protection + style angle",
  body: `Hey {name}! Protect your {vehicle} from salt, sand & winter road damage with a wrap or PPF. Quote ready: {quote_url} - {shop}`,
};

const SEASONAL_SMS_NEWYEAR: RetargetTemplate = {
  id: "seasonal-sms-newyear",
  tier: "seasonal",
  channel: "sms",
  label: "New Year New Look",
  description: "New year refresh campaign",
  body: `New year, new ride! Start the year right with a fresh wrap on your {vehicle}. Your estimate: {quote_url} - {shop}`,
};

const SEASONAL_EMAIL: RetargetTemplate = {
  id: "seasonal-email",
  tier: "seasonal",
  channel: "email",
  label: "Seasonal Campaign Email",
  description: "Seasonal promo email with imagery",
  subject: "Your {vehicle} is ready for a seasonal upgrade — {shop}",
  body: `Hi {name},

The season is changing — and it's the perfect time to give your {vehicle} a new look.

Whether you're going for head-turning color, stealth protection, or a complete transformation, we've got you covered.

Your quote: {price}
View it here: {quote_url}

Book this month and ask about our seasonal specials.

— {shop}`,
};

// ── Sale Templates ───────────────────────────────────────────────

const SALE_SMS_FLASH: RetargetTemplate = {
  id: "sale-sms-flash",
  tier: "sale",
  channel: "sms",
  label: "Flash Sale",
  description: "Limited time discount",
  body: `FLASH SALE: {name}, we're running a limited-time deal on wraps this week. Your {vehicle} quote just got better. Check it: {quote_url} - {shop}`,
};

const SALE_SMS_BUNDLE: RetargetTemplate = {
  id: "sale-sms-bundle",
  tier: "sale",
  channel: "sms",
  label: "Bundle Deal",
  description: "Wrap + PPF or tint bundle",
  body: `{name}, bundle & save! Get your {vehicle} wrap + PPF or tint at a package price. See your updated quote: {quote_url} - {shop}`,
};

const SALE_SMS_REFERRAL: RetargetTemplate = {
  id: "sale-sms-referral",
  tier: "sale",
  channel: "sms",
  label: "Referral Bonus",
  description: "Refer a friend, get a discount",
  body: `{name}, refer a friend who wraps their car and get $100 off your {vehicle} wrap! Your quote: {quote_url} - {shop}`,
};

const SALE_EMAIL: RetargetTemplate = {
  id: "sale-email",
  tier: "sale",
  channel: "email",
  label: "Sale Announcement Email",
  description: "Sale promo with pricing details",
  subject: "Special pricing on your {vehicle} wrap — {shop}",
  body: `Hi {name},

We're running a special right now and wanted to make sure you didn't miss it.

Your {vehicle} wrap estimate: {price}
View your quote: {quote_url}

This pricing is available for a limited time. If you've been on the fence, now's the time.

Reply to this email or call us to lock in your spot.

— {shop}`,
};

// ── Educational Templates ────────────────────────────────────────

const EDU_SMS_CARE: RetargetTemplate = {
  id: "edu-sms-care",
  tier: "educational",
  channel: "sms",
  label: "Wrap Care Tips",
  description: "Educate on wrap maintenance",
  body: `{name}, did you know wraps last 5-7 years with proper care? Hand wash, avoid pressure washers, and park in shade. Ready to wrap your {vehicle}? {quote_url} - {shop}`,
};

const EDU_SMS_VS_PAINT: RetargetTemplate = {
  id: "edu-sms-vspaint",
  tier: "educational",
  channel: "sms",
  label: "Wrap vs Paint",
  description: "Why wrap beats repainting",
  body: `{name}, wraps protect your {vehicle}'s factory paint and can be removed. A repaint costs $5K+ and lowers resale. Wraps start lower. Your quote: {quote_url} - {shop}`,
};

const EDU_SMS_RESALE: RetargetTemplate = {
  id: "edu-sms-resale",
  tier: "educational",
  channel: "sms",
  label: "Resale Value",
  description: "Wraps protect resale value",
  body: `Fun fact {name}: wrapping your {vehicle} protects the OEM paint underneath, keeping resale value high. It's like armor that looks amazing. Quote: {quote_url} - {shop}`,
};

const EDU_EMAIL: RetargetTemplate = {
  id: "edu-email",
  tier: "educational",
  channel: "email",
  label: "Educational Email",
  description: "Why wraps are worth it",
  subject: "3 things to know before wrapping your {vehicle} — {shop}",
  body: `Hi {name},

Thinking about wrapping your {vehicle}? Here are 3 things most people don't know:

1. Wraps protect your factory paint — when you remove it, the paint underneath is showroom fresh.

2. A quality wrap lasts 5-7 years with basic care (hand wash, no pressure washers on edges).

3. Wraps are fully reversible — unlike paint, you're not making a permanent commitment.

Your estimated price: {price}
See your full quote: {quote_url}

Have questions? Just reply — we're happy to help.

— {shop}`,
};

// ── Review Request Templates ─────────────────────────────────────

const REVIEW_SMS_GOOGLE: RetargetTemplate = {
  id: "review-sms-google",
  tier: "review",
  channel: "sms",
  label: "Google Review",
  description: "Ask for a Google review after job",
  body: `Hey {name}! Thanks for trusting {shop} with your {vehicle} wrap. If you love it, a quick Google review means the world to us: {quote_url} — Thank you!`,
};

const REVIEW_SMS_PHOTO: RetargetTemplate = {
  id: "review-sms-photo",
  tier: "review",
  channel: "sms",
  label: "Photo + Review",
  description: "Ask for photo and review",
  body: `{name}, your {vehicle} looks amazing! Snap a pic and tag us — and if you have 30 seconds, a Google or Yelp review helps us a ton: {quote_url} - {shop}`,
};

const REVIEW_SMS_FOLLOWUP: RetargetTemplate = {
  id: "review-sms-followup",
  tier: "review",
  channel: "sms",
  label: "Post-Job Check-in",
  description: "Check in + ask for review",
  body: `Hey {name}, just checking in — how's the wrap holding up on the {vehicle}? If everything looks great, we'd love a quick review: {quote_url} - {shop}`,
};

const REVIEW_EMAIL: RetargetTemplate = {
  id: "review-email",
  tier: "review",
  channel: "email",
  label: "Review Request Email",
  description: "Professional review request after completion",
  subject: "How's your {vehicle} looking? — {shop}",
  body: `Hi {name},

Thanks again for choosing {shop} for your {vehicle} wrap. We hope you're loving the new look!

If you have a moment, we'd really appreciate a quick review. It helps other car enthusiasts find us.

Leave a Google Review: {quote_url}

And if you have any photos of your wrapped {vehicle} out in the wild — we'd love to feature them on our page!

Thanks for your support,
{shop}`,
};

// ── Referral Templates ───────────────────────────────────────────

const REFERRAL_SMS_DIRECT: RetargetTemplate = {
  id: "referral-sms-direct",
  tier: "referral",
  channel: "sms",
  label: "Direct Referral",
  description: "Simple referral ask",
  body: `{name}, know someone who wants their car wrapped? Refer them to {shop} and you both get $100 off. Just have them mention your name! - {shop}`,
};

const REFERRAL_SMS_CARD: RetargetTemplate = {
  id: "referral-sms-card",
  tier: "referral",
  channel: "sms",
  label: "Referral Card",
  description: "Digital referral card",
  body: `{name}, here's your personal referral link for {shop}. Share it with friends who want a wrap — you get $100 off your next service for every booking: {quote_url}`,
};

const REFERRAL_SMS_FLEET: RetargetTemplate = {
  id: "referral-sms-fleet",
  tier: "referral",
  channel: "sms",
  label: "Fleet / Business Referral",
  description: "B2B fleet referral",
  body: `{name}, does your company or a business you know need fleet wraps or vehicle branding? We offer fleet pricing. Have them reach out to {shop}: {quote_url}`,
};

const REFERRAL_EMAIL: RetargetTemplate = {
  id: "referral-email",
  tier: "referral",
  channel: "email",
  label: "Referral Program Email",
  description: "Full referral program details",
  subject: "Get $100 off — refer a friend to {shop}",
  body: `Hi {name},

Loved your {vehicle} wrap? Help us spread the word!

For every friend you refer who books a wrap with {shop}, you both get $100 off.

How it works:
1. Share your referral link: {quote_url}
2. Your friend books a wrap and mentions your name
3. You both get $100 off your next service

There's no limit — refer 5 friends, save $500.

Thanks for being part of the {shop} family!

— {shop}`,
};

// ── All templates ──────────────────────────────────────────────────

export const RETARGET_TEMPLATES: RetargetTemplate[] = [
  DAY3_SMS_FRIENDLY,
  DAY3_SMS_VALUE,
  DAY3_SMS_URGENCY,
  DAY3_EMAIL,
  DAY7_SMS_MISS_YOU,
  DAY7_SMS_LAST_CHANCE,
  DAY7_SMS_INCENTIVE,
  DAY7_EMAIL,
  SEASONAL_SMS_SUMMER,
  SEASONAL_SMS_WINTER,
  SEASONAL_SMS_NEWYEAR,
  SEASONAL_EMAIL,
  SALE_SMS_FLASH,
  SALE_SMS_BUNDLE,
  SALE_SMS_REFERRAL,
  SALE_EMAIL,
  EDU_SMS_CARE,
  EDU_SMS_VS_PAINT,
  EDU_SMS_RESALE,
  EDU_EMAIL,
  REVIEW_SMS_GOOGLE,
  REVIEW_SMS_PHOTO,
  REVIEW_SMS_FOLLOWUP,
  REVIEW_EMAIL,
  REFERRAL_SMS_DIRECT,
  REFERRAL_SMS_CARD,
  REFERRAL_SMS_FLEET,
  REFERRAL_EMAIL,
];

export const DAY3_SMS_TEMPLATES = RETARGET_TEMPLATES.filter(t => t.tier === "3day" && t.channel === "sms");
export const DAY3_EMAIL_TEMPLATES = RETARGET_TEMPLATES.filter(t => t.tier === "3day" && t.channel === "email");
export const DAY7_SMS_TEMPLATES = RETARGET_TEMPLATES.filter(t => t.tier === "7day" && t.channel === "sms");
export const DAY7_EMAIL_TEMPLATES = RETARGET_TEMPLATES.filter(t => t.tier === "7day" && t.channel === "email");

// ── Tone / Style System ──────────────────────────────────────────

export type ToneStyle = "casual" | "professional" | "friendly" | "bold";

export interface ToneConfig {
  id: ToneStyle;
  label: string;
  description: string;
  greeting: (name: string) => string;
  signoff: (shop: string) => string;
  cta: string; // call to action style
}

export const TONE_PRESETS: Record<ToneStyle, ToneConfig> = {
  casual: {
    id: "casual",
    label: "Casual",
    description: "Relaxed, texting a friend",
    greeting: (name) => `Hey ${name}!`,
    signoff: (shop) => `- ${shop}`,
    cta: "Check it out",
  },
  professional: {
    id: "professional",
    label: "Professional",
    description: "Polished, business tone",
    greeting: (name) => `Hello ${name},`,
    signoff: (shop) => `Best regards,\n${shop}`,
    cta: "View your estimate",
  },
  friendly: {
    id: "friendly",
    label: "Friendly",
    description: "Warm, approachable, enthusiastic",
    greeting: (name) => `Hi ${name}!`,
    signoff: (shop) => `Thanks so much!\n— ${shop}`,
    cta: "Take a look",
  },
  bold: {
    id: "bold",
    label: "Bold",
    description: "High energy, confident, direct",
    greeting: (name) => `${name} —`,
    signoff: (shop) => `${shop} // LET'S GO`,
    cta: "Lock it in",
  },
};

// ── Merge helper ───────────────────────────────────────────────────

export function mergeTemplate(template: string, data: {
  name?: string;
  vehicle?: string;
  shop?: string;
  quote_url?: string;
  price?: string;
  shop_logo?: string;
  review_url?: string;
}): string {
  return template
    .replace(/\{name\}/g, data.name || "there")
    .replace(/\{vehicle\}/g, data.vehicle || "your vehicle")
    .replace(/\{shop\}/g, data.shop || "Your wrap shop")
    .replace(/\{quote_url\}/g, data.quote_url || "")
    .replace(/\{price\}/g, data.price || "")
    .replace(/\{shop_logo\}/g, data.shop_logo || "")
    .replace(/\{review_url\}/g, data.review_url || data.quote_url || "");
}

// ── Retarget tier calculator ───────────────────────────────────────

export function getRetargetTier(createdAt: string): RetargetTier | "too_early" | "expired" {
  const age = Date.now() - new Date(createdAt).getTime();
  const days = age / (1000 * 60 * 60 * 24);
  if (days < 3) return "too_early";
  if (days < 7) return "3day";
  if (days <= 14) return "7day";
  return "expired";
}

export function getRetargetLabel(tier: RetargetTier | "too_early" | "expired"): string {
  switch (tier) {
    case "too_early": return "Too early";
    case "3day": return "3-Day Follow-up";
    case "7day": return "7-Day Re-engage";
    case "seasonal": return "Seasonal Campaign";
    case "sale": return "Sale / Promo";
    case "educational": return "Educational";
    case "review": return "Review Request";
    case "referral": return "Referral Program";
    case "expired": return "Expired (14d+)";
    default: return tier;
  }
}
