/**
 * wraptvShowMatch — THE one place that decides which WrapTVWorld show a shot
 * list row (an idea, or a MASTER SCRIPT) belongs to.
 *
 * `shot_list_items` has no `show` column: the show, when it is stated at all,
 * is stated in free text ("Behind Shop Doors — funny/BTS", "Why Behind The
 * Installs matters"). So the show is DERIVED, deterministically, from that
 * text — the same shape as `src/lib/assetContentType.ts`:
 *
 *   - keyword-deterministic, checked in a fixed field order
 *     (campaign → shot_title → notes), so the earliest, most deliberate
 *     signal wins;
 *   - it returns the SIGNAL it matched on, so a human can see the reasoning
 *     rather than trusting a silent guess;
 *   - no match returns null — an honest "Unassigned", never a nearest guess.
 *     A wrong show is worse than no show, because the slate is what the AI
 *     frames episodes against.
 *
 * Do NOT add a second matcher or duplicate these rules in SQL — they will
 * drift. Locked by tests/wraptv-show-match.test.ts.
 */
import { WRAPTV_SHOWS } from "@/data/wraptvShows";

export interface ShowMatch {
  /** Slug from WRAPTV_SHOWS. */
  slug: string;
  /** Which field the match came from — shown to the human. */
  field: "campaign" | "title" | "notes";
  /** The phrase that actually matched. */
  signal: string;
}

/**
 * Extra phrasings seen in real rows, per show slug. The show's own title is
 * always matched too, so only genuine variants belong here.
 *
 * "Behind The Installs" (plural) is real live data, not a typo to fix.
 */
const ALIASES: Record<string, string[]> = {
  "behind-the-install": ["behind the installs", "behind install", "bti"],
  "behind-shop-doors": ["behind shop door", "bsd", "shop doors"],
  "building-a-brand": ["building brand"],
  "print-my-ride": ["printmyride", "mcride", "the makeover"],
  "wrap-of-the-week": ["wrap of week", "wotw"],
  "wrap-life": ["wraplife"],
  designpro: ["designproai", "design pro"],
};

/** Longest phrases first, so "behind the installs" wins over "behind install". */
function phrasesFor(slug: string, title: string): string[] {
  return [title.toLowerCase(), ...(ALIASES[slug] ?? [])].sort((a, b) => b.length - a.length);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export interface ShowMatchInput {
  campaign?: string | null;
  shot_title?: string | null;
  notes?: string | null;
}

/**
 * Resolve the show for one row, or null when nothing matches.
 * Field order is deliberate: `campaign` is the closest thing to an explicit
 * label, so it is checked before the title and the notes.
 */
export function matchWrapTVShow(row: ShowMatchInput): ShowMatch | null {
  const fields: { field: ShowMatch["field"]; value: string }[] = [
    { field: "campaign", value: norm(row.campaign || "") },
    { field: "title", value: norm(row.shot_title || "") },
    { field: "notes", value: norm(row.notes || "") },
  ];

  for (const { field, value } of fields) {
    if (!value) continue;
    for (const show of WRAPTV_SHOWS) {
      for (const phrase of phrasesFor(show.slug, show.title)) {
        if (value.includes(norm(phrase))) {
          return { slug: show.slug, field, signal: phrase };
        }
      }
    }
  }
  return null;
}

export interface ShowGroup<T> {
  slug: string;
  title: string;
  accent: string;
  /** Ideas — every row that is not a MASTER SCRIPT. */
  ideas: T[];
  /** Scripts — rows whose shot_title starts with "MASTER SCRIPT". */
  scripts: T[];
}

/** A row is a script when the Shot List titled it as one. */
export function isMasterScript(row: ShowMatchInput): boolean {
  return /^\s*master script/i.test(row.shot_title || "");
}

/**
 * Group rows into the full slate. EVERY show is returned even at zero count,
 * so an empty show reads as a gap to fill rather than vanishing (owner
 * 2026-08-04). Unmatched rows land in the trailing "Unassigned" group.
 */
export function groupByShow<T extends ShowMatchInput>(rows: T[]): ShowGroup<T>[] {
  const groups: ShowGroup<T>[] = WRAPTV_SHOWS.map((s) => ({
    slug: s.slug,
    title: s.title,
    accent: s.accent,
    ideas: [],
    scripts: [],
  }));
  const unassigned: ShowGroup<T> = {
    slug: "unassigned",
    title: "Unassigned",
    accent: "#64748b",
    ideas: [],
    scripts: [],
  };
  const bySlug = new Map(groups.map((g) => [g.slug, g]));

  for (const row of rows) {
    const hit = matchWrapTVShow(row);
    const target = (hit && bySlug.get(hit.slug)) || unassigned;
    (isMasterScript(row) ? target.scripts : target.ideas).push(row);
  }

  return [...groups, unassigned];
}
