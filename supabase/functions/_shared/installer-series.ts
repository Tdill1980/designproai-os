/**
 * INSTALLER SERIES — the WePrintWraps teaching lane.
 *
 * Owner, 2026-08-13, dictating the whole series: "This content is stronger
 * because the installer gets something useful even if they never buy that day…
 * installer education → authority → wholesale print sale."
 *
 * WHY THIS IS A REGISTRY AND NOT A PROMPT. Every episode's title and its
 * second overlay are the OWNER'S OWN WORDS, written out below verbatim. They
 * are not a brief for a model to interpret — a model handed "how to wrap a
 * mirror" writes plausible instructions, and plausible instructions about
 * relief cuts and heat are how an installer ruins a $900 panel. The teaching
 * content in this file was written by someone who has done it. Nothing here
 * may be regenerated, reworded or "improved" by an AI pass.
 *
 * SO THE MODEL'S JOB SHRINKS to what it is actually good at: picking which
 * clip shows the thing, and cutting to the beats. The words are already right.
 *
 * FOOTAGE IS REAL OR THE EPISODE DOES NOT GET MADE. Owner: "I'd absolutely
 * make these from real install footage, not an AI person talking for 15
 * seconds." An episode with no matching clip is an HONEST GAP that names the
 * shot to go film — the same answer this pipeline gives everywhere else when
 * the material is not there.
 *
 * Pure: no database, no network, no clock. Locked by
 * `tests/installer-series.test.ts`.
 */

export interface InstallerEpisode {
  /** Stable key. Used for dedupe, so it must never be rewritten. */
  slug: string;
  /** Beat 1, on screen 0–2s. The owner's words, verbatim. */
  title: string;
  /** Beat 2's instruction overlay. The owner's words, verbatim. */
  overlay: string;
  /**
   * What footage this episode needs. Matched against a clip's title, tags,
   * category and filename — never against a transcript alone, because an
   * installer SAYING "mirror" is not footage of a mirror being wrapped.
   */
  needs: string[];
}

/**
 * The twelve, in the order they were dictated.
 *
 * Ordered deliberately: the first five are TECHNIQUES that apply to any
 * vehicle, the last seven are named VEHICLES. Technique episodes are the ones
 * an installer saves and comes back to; vehicle episodes are the ones they
 * search for. Publishing a technique first gives the series something to be
 * before it starts chasing search terms.
 */
export const INSTALLER_SERIES: InstallerEpisode[] = [
  {
    slug: "door-handle",
    title: "HOW TO WRAP A DOOR HANDLE WITHOUT LIFTING",
    overlay: "Relief cuts + controlled heat + don't overstretch the recess.",
    needs: ["door handle", "handle", "door"],
  },
  {
    slug: "mirror",
    title: "HOW TO WRAP A MIRROR WITHOUT FIGHTING IT",
    overlay: "Anchor the center first, then work tension outward.",
    needs: ["mirror", "side mirror", "wing mirror"],
  },
  {
    slug: "bumper-corner",
    title: "HOW TO WRAP A BUMPER CORNER CLEANLY",
    overlay: "Feed the film into the curve instead of stretching across it.",
    needs: ["bumper", "corner", "fascia"],
  },
  {
    slug: "deep-recess",
    title: "HOW TO WRAP A DEEP RECESS",
    overlay: "Pre-stretch, relax the film, then post-heat the stress area.",
    needs: ["recess", "channel", "inset", "deep"],
  },
  {
    slug: "roof",
    title: "HOW TO WRAP A ROOF WITHOUT TRASHING THE FILM",
    overlay: "Use two installers, glass the panel first, then work center-out.",
    needs: ["roof", "roofline"],
  },
  {
    slug: "commercial-panel",
    title: "HOW TO LINE UP A COMMERCIAL WRAP PANEL",
    overlay: "Set your registration point before removing the full liner.",
    needs: ["panel", "commercial", "registration", "alignment", "graphic"],
  },
  {
    slug: "van-sliding-door",
    title: "HOW TO WRAP A VAN SLIDING DOOR",
    overlay: "Treat the door and body as separate install zones.",
    needs: ["sliding door", "van", "slider"],
  },
  {
    slug: "ford-transit",
    title: "HOW TO WRAP A FORD TRANSIT",
    overlay: "Start with the large flat sections before tackling recesses and hardware.",
    needs: ["transit", "ford transit", "ford"],
  },
  {
    slug: "sprinter",
    title: "HOW TO WRAP A SPRINTER VAN",
    overlay: "Control tension around the body lines before committing the panel.",
    needs: ["sprinter", "mercedes", "van"],
  },
  {
    slug: "box-truck",
    title: "HOW TO WRAP A BOX TRUCK",
    overlay: "Square the graphic first — one bad starting edge throws off the entire side.",
    needs: ["box truck", "box", "truck"],
  },
  {
    slug: "tesla-model-3-bumper",
    title: "HOW TO WRAP A TESLA MODEL 3 BUMPER",
    overlay: "Use relief strategically around the aggressive corners instead of forcing one stretch.",
    needs: ["tesla", "model 3", "bumper"],
  },
  {
    slug: "f250-bed",
    title: "HOW TO WRAP A F-250 BED",
    overlay: "Set the body line first, then work into the wheel opening and lower contour.",
    needs: ["f-250", "f250", "bed", "ford"],
  },
];

/**
 * The reel, beat by beat — the owner's structure, to the second.
 *
 * Held as DATA rather than described in a prompt so the cut is deterministic:
 * the same episode cuts the same way twice, and the EDL author is given
 * boundaries instead of being asked to invent a shape.
 */
export const REEL_BEATS = [
  { from: 0, to: 2, kind: "title", what: "The title card, full screen." },
  { from: 2, to: 8, kind: "teach", what: "Real install footage with the instruction overlays." },
  { from: 8, to: 12, kind: "result", what: "The finished result." },
  { from: 12, to: 15, kind: "cta", what: "The print CTA." },
] as const;

/**
 * The CTAs, both of them the owner's, verbatim.
 *
 * DELIBERATELY LIGHT. The whole premise is that the installer gets something
 * useful whether or not they buy today, and a hard close on a teaching reel
 * spends the goodwill the teaching just earned. These are the only two closes
 * this lane uses — it does NOT take the paid-ads close (Shop Now / Order Now),
 * which is right for a bought impression and wrong here.
 */
export const INSTALLER_CTAS = [
  "Installing it is your job. Printing it can be ours.\nWePrintWraps.com",
  "Need the print for your next install? WePrintWraps.com",
] as const;

/** Deterministic pick, so an episode's CTA does not change between previews. */
export function ctaFor(slug: string): string {
  let n = 0;
  for (const ch of slug) n = (n + ch.charCodeAt(0)) % 997;
  return INSTALLER_CTAS[n % INSTALLER_CTAS.length];
}

export interface ClipLike {
  id: string;
  url: string;
  name?: string;
  tags?: string[];
  category?: string | null;
  durationSeconds?: number | null;
}

/**
 * The clips that could carry this episode, best first.
 *
 * MATCHED ON WHAT THE CLIP IS, not what someone says in it. The library's
 * install footage is the pool; a clip earns points for naming the episode's
 * subject and for being classified as an install in the first place.
 *
 * A clip shorter than the teaching beat cannot carry it — the beat is 6
 * seconds of showing the thing, and cutting 6 seconds out of a 4-second clip
 * means either freezing or padding, both of which look like a mistake.
 */
export function matchFootage(episode: InstallerEpisode, clips: ClipLike[]): ClipLike[] {
  const teachSeconds = REEL_BEATS[1].to - REEL_BEATS[1].from;
  const scored: Array<{ clip: ClipLike; score: number }> = [];

  for (const c of clips || []) {
    if (!c?.url || !c?.id) continue;
    const cat = String(c.category || "").toLowerCase();
    // A finished render is not install footage.
    if (cat === "render" || cat === "audio_master") continue;
    if (c.durationSeconds != null && c.durationSeconds < teachSeconds) continue;

    const hay = `${c.name || ""} ${(c.tags || []).join(" ")} ${cat}`.toLowerCase();
    let score = 0;
    for (const need of episode.needs) if (hay.includes(need.toLowerCase())) score += 4;
    if (!score) continue;                 // no subject match = wrong episode
    if (cat === "install") score += 3;    // classified install beats a guess
    if (/install|wrap/.test(hay)) score += 1;

    scored.push({ clip: c, score });
  }

  return scored.sort((a, b) => b.score - a.score).map((s) => s.clip);
}

/**
 * Why this episode cannot be cut yet, or null.
 *
 * Names the SHOT TO GO FILM. "No footage" is a dead end; "film a door handle
 * being wrapped" is a shot list item, and this lane's whole value is that the
 * gaps convert into a day of filming rather than a shrug.
 */
export function episodeBlocker(episode: InstallerEpisode, clips: ClipLike[]): string | null {
  if (!matchFootage(episode, clips).length) {
    return `no install footage shows ${episode.needs[0]} — film that shot and this episode cuts itself`;
  }
  return null;
}

/** The finished plan for one episode: beats, words, and the clip that carries it. */
export function planEpisode(episode: InstallerEpisode, clips: ClipLike[]) {
  const footage = matchFootage(episode, clips);
  return {
    slug: episode.slug,
    title: episode.title,
    overlays: [episode.title, episode.overlay],
    cta: ctaFor(episode.slug),
    beats: REEL_BEATS.map((b) => ({
      ...b,
      text: b.kind === "title" ? episode.title
        : b.kind === "teach" ? episode.overlay
        : b.kind === "cta" ? ctaFor(episode.slug)
        : "",
    })),
    clip: footage[0] || null,
    alternates: footage.slice(1, 4),
    blocked: episodeBlocker(episode, clips),
  };
}
