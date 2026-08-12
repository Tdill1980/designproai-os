/**
 * WrapTVWorld programming slate — mirrors the SHOWS block in
 * supabase/functions/_shared/brand-os.ts (WRAPTV_BRAND_BLOCK). If the slate
 * changes there, update it here too.
 *
 * heroImage points at /public — drop the real show-page art at these paths
 * (until then the pages render the gradient fallback).
 */

export interface WrapTVShow {
  slug: string;
  title: string;
  kicker: string;
  host?: string;
  description: string;
  heroImage: string;
  accent: string; // per-show accent color
}

export const WRAPTV_SHOWS: WrapTVShow[] = [
  {
    slug: "behind-the-install",
    title: "Behind the Install",
    kicker: "Music-driven install videos",
    description:
      "Fuel-style channel energy — clean cuts, no talking, the install and the track carry it. Installers worldwide submit footage; we cut it network-style with full credit to the shop.",
    heroImage: "/wraptv/shows/behind-the-install.jpg",
    accent: "#17A5BE",
  },
  {
    slug: "behind-shop-doors",
    title: "Behind Shop Doors",
    kicker: "Inside real wrap shops",
    description:
      "The people and the hustle inside real wrap shops — documentary, master-first. Real shop life, real installs.",
    heroImage: "/wraptv/shows/behind-shop-doors.jpg",
    accent: "#f68d63",
  },
  {
    slug: "building-a-brand",
    title: "Building a Brand",
    kicker: "From installer to business",
    description:
      "How installers and shops grow into businesses — the moves, the mistakes, and the come-ups.",
    heroImage: "/wraptv/shows/building-a-brand.jpg",
    accent: "#C2D832",
  },
  {
    slug: "print-my-ride",
    title: "Print My Ride",
    kicker: "The makeover show",
    description:
      "Setup, transformation, THE REVEAL — the channel's makeover format, printed. As seen in \"The McRide Makeover!\" on the WrapTVWorld channel.",
    heroImage: "/wraptv/shows/print-my-ride.jpg",
    accent: "#f6c443",
  },
  {
    slug: "wrap-of-the-week",
    title: "Wrap of the Week",
    kicker: "Featured build episode",
    description:
      "One build, one episode, every week — the wrap blowing up the feed, credited to the shop that made it.",
    heroImage: "/wraptv/shows/wrap-of-the-week.jpg",
    accent: "#f9038c",
  },
  // Added 2026-08-04 (owner). Written to match the slate's voice — Fuse/MTV
  // energy, concrete, no filler — but the owner should still confirm the
  // format, since this copy is what the AI frames episodes against.
  {
    slug: "wrap-life",
    title: "Wrap Life",
    kicker: "The culture, not the job",
    description:
      "The life around the trade — the crews, the meets, the road, the community that grew up around wrapping. Culture-first: these people when they're not holding a squeegee.",
    heroImage: "/wraptv/shows/wrap-life.jpg",
    accent: "#35D0A5",
  },
  {
    slug: "designpro",
    title: "DesignPro",
    kicker: "One brief, one finished wrap",
    description:
      "A real customer brief becomes a print-ready wrap on camera — the brief, the design calls, the revisions, the files. The decisions shown, not just the reveal.",
    heroImage: "/wraptv/shows/designpro.jpg",
    accent: "#7C3AED",
  },
];

/** Real people from real shops — never fabricate quotes (brand-os rule). */
export const WRAPTV_TALENT: { name: string; show: string }[] = [
  { name: "Amanda", show: "Primary host" },
  { name: "Xavier", show: "Install walkthroughs" },
  { name: "Trish", show: "Making a Monster" },
  { name: "RJ", show: "Flying Solo" },
  { name: "Jess", show: "Designed in the DMs" },
  { name: "Carley", show: "Gnarley by Design" },
  { name: "Houdini", show: "Wrap Tricks" },
  { name: "Jackson", show: "Wrap TV World" },
];

export function getWrapTVShow(slug: string): WrapTVShow | undefined {
  return WRAPTV_SHOWS.find((s) => s.slug === slug);
}
