/**
 * Asset slots for the /mightymail-info public landing page.
 *
 * Each slot maps to a `homepage_showcase` row whose `name` follows the
 * convention `mightymail:<slot-key>`. The admin uploader at
 * /admin/mightymail-landing writes URLs into these rows; the public
 * landing page reads them via useMightyMailLandingAssets().
 *
 * Slots are intentionally optional — every section on the landing page
 * still has a default Lucide icon + gradient, so an empty slot simply
 * collapses gracefully.
 */

export interface MightyMailLandingSlot {
  key: string;
  rowName: string; // homepage_showcase.name
  label: string;
  helper: string;
  ratio: string; // tailwind aspect class
  recommendedSize: string;
}

export const MIGHTYMAIL_LANDING_SLOTS: MightyMailLandingSlot[] = [
  {
    key: "hero",
    rowName: "mightymail:hero",
    label: "Hero — full-bleed background",
    helper:
      "Optional hero image rendered behind the headline. A retarget-email screenshot with the customer's render works best.",
    ratio: "aspect-[16/9]",
    recommendedSize: "1920 × 1080 (16:9)",
  },
  {
    key: "usp-screenshot",
    rowName: "mightymail:usp-screenshot",
    label: "USP 1 — Screenshot Tool demo",
    helper:
      "Screenshot of a retarget email with the customer's render embedded above the headline.",
    ratio: "aspect-[4/3]",
    recommendedSize: "1200 × 900 (4:3)",
  },
  {
    key: "usp-autoretarget",
    rowName: "mightymail:usp-autoretarget",
    label: "USP 2 — Auto Retargeting demo",
    helper:
      "Screenshot of the scheduled_emails queue or the Quote Manager retarget dropdown showing the 7-email cadence.",
    ratio: "aspect-[4/3]",
    recommendedSize: "1200 × 900 (4:3)",
  },
  {
    key: "usp-analytics",
    rowName: "mightymail:usp-analytics",
    label: "USP 3 — Analytics dashboard",
    helper:
      "Screenshot of CampaignAnalytics showing open rate, click rate, top URLs, per-recipient timeline.",
    ratio: "aspect-[4/3]",
    recommendedSize: "1200 × 900 (4:3)",
  },
  {
    key: "social-proof-1",
    rowName: "mightymail:social-proof-1",
    label: "Social proof 1 (optional)",
    helper:
      "Customer wrap photo or testimonial card. Surfaces below the booster packs if set.",
    ratio: "aspect-[1/1]",
    recommendedSize: "1080 × 1080 (1:1)",
  },
  {
    key: "social-proof-2",
    rowName: "mightymail:social-proof-2",
    label: "Social proof 2 (optional)",
    helper:
      "Second testimonial / wrap photo card. Paired with social-proof-1.",
    ratio: "aspect-[1/1]",
    recommendedSize: "1080 × 1080 (1:1)",
  },
];

export const slotByKey = (key: string): MightyMailLandingSlot | undefined =>
  MIGHTYMAIL_LANDING_SLOTS.find((s) => s.key === key);
