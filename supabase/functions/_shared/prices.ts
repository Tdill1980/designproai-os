export const PRICE_IDS = {
  // Legacy prices (kept for existing subscribers)
  starter_legacy: "price_1SWJgDH1V6OhfCAPSCR5VbT2",   // $24
  advanced_legacy: "price_1SWNNuH1V6OhfCAPDChwyuAX",   // $59
  complete_legacy: "price_1SWO9QH1V6OhfCAPjqYLT7Ko",   // $129
  // New presale tiers
  starter: "price_1TEFVwH1V6OhfCAPeKAF34NH",           // $349/mo
  professional: "price_1TEFVxH1V6OhfCAPPATuqoGZ",       // $699/mo
  proshop: "price_1TEFVxH1V6OhfCAPDdkZaoCP",           // $1,499/mo
  enterprise: "price_1TEFVyH1V6OhfCAPiptL1RKW",         // $2,999/mo
  extraRender: "price_1SWNl3H1V6OhfCAPas1HJF05"         // $5 metered
};

export const PRICE_TO_TIER: Record<string, string> = {
  // Legacy
  "price_1SWJgDH1V6OhfCAPSCR5VbT2": "starter",
  "price_1SWNNuH1V6OhfCAPDChwyuAX": "advanced",
  "price_1SWO9QH1V6OhfCAPjqYLT7Ko": "complete",
  // New tiers
  "price_1TEFVwH1V6OhfCAPeKAF34NH": "starter",
  "price_1TEFVxH1V6OhfCAPPATuqoGZ": "professional",
  "price_1TEFVxH1V6OhfCAPDdkZaoCP": "proshop",
  "price_1TEFVyH1V6OhfCAPiptL1RKW": "enterprise",
};

export const RENDER_LIMITS: Record<string, number> = {
  starter: 50,
  professional: 100,
  proshop: 200,
  enterprise: 999999,
  // Legacy
  advanced: 50,
  complete: 200,
};
