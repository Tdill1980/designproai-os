/**
 * narrativeEngine — one topic, every channel, one message, all linked.
 *
 * Marketing Hub manages content. This is the layer above it: a NARRATIVE is a
 * topic tied to a business goal, and its ARTIFACTS are the pieces that carry
 * that topic onto each channel — each one a real row in the table that already
 * owns it, each one knowing which siblings it points at.
 *
 * ── WHAT THIS IS NOT ───────────────────────────────────────────────────────
 * Not a second content store, and not a new producer. An artifact POINTS AT
 * the row that already exists (agent_blog_posts, agent_email_campaigns,
 * seo_blog_posts, agent_social_posts, video_render_jobs…). Publishing stays
 * exactly where it is. What did not exist before is the record of what came
 * from what, what it is for, and what links to what.
 *
 * ── EVERY PLATFORM HAS A ROLE ──────────────────────────────────────────────
 * `ARTIFACT_KINDS` below states each channel's JOB, not just its format. That
 * is the difference between repurposing and reposting: the X thread argues,
 * the SEO page answers a search, the AEO answer is quotable by a model, the
 * reel stops the scroll. Same message, different work.
 *
 * ── HONESTY RULES ──────────────────────────────────────────────────────────
 * A planned artifact is EMPTY and says so. Nothing here fabricates a body, a
 * headline, or a link to a piece that does not exist yet — a narrative board
 * showing eleven green ticks that are really eleven blanks is worse than one
 * showing two ticks and nine honest gaps. Locked by
 * `tests/narrative-engine.test.ts`.
 */

export type ArtifactStatus = "planned" | "drafted" | "approved" | "published";

/** Where a produced artifact really lives. Null = no home table yet. */
export interface ArtifactHome {
  table: string | null;
  /** Human label for the surface that owns it. */
  owner: string;
}

/**
 * How a piece leaves the building — and whether the machine can actually send
 * it.
 *
 * `content-deploy` publishes exactly four platforms today: instagram,
 * facebook, wraptv_site, wrapfeed. Everything else is a draft a human copies
 * out and posts by hand. That distinction has to be VISIBLE, because a board
 * that renders X and LinkedIn identically to Instagram implies an autopilot
 * that does not exist for them — the same class of lie as a green tick over an
 * empty artifact.
 */
export interface ArtifactPublish {
  /** `agent_social_posts.platform` when this materialises there. Null = it doesn't. */
  platform: string | null;
  /** `agent_social_posts.post_type`, where the platform distinguishes one. */
  postType?: string;
  /** TRUE only when content-deploy has a real publisher for it. */
  auto: boolean;
}

export interface ArtifactKind {
  key: string;
  label: string;
  /** The JOB this channel does in the narrative — its defined role. */
  role: string;
  home: ArtifactHome;
  /** Rough order the chain flows in: anchor pieces first, amplifiers after. */
  tier: 1 | 2 | 3;
  publish: ArtifactPublish;
}

/**
 * The eleven-plus channels, each with its role.
 *
 * `home.table` null means the artifact has NO owning table yet (AEO answers,
 * sales collateral). Those store their body on the artifact itself until a
 * real home exists — recorded as an honest interim, not pretended away.
 */
export const ARTIFACT_KINDS: ArtifactKind[] = [
  {
    key: "youtube", label: "YouTube", tier: 1,
    role: "The long-form anchor. The full argument, once, properly — everything else is cut from or points back to this.",
    home: { table: "video_render_jobs", owner: "BrandCast / Cut Editor" },
    publish: { platform: null, auto: false },
  },
  {
    key: "seo_page", label: "SEO page", tier: 1,
    role: "Answers the search someone types months later. The durable asset — it earns traffic while everything else decays.",
    home: { table: "seo_blog_posts", owner: "SEO Blog Editor" },
    publish: { platform: null, auto: false },
  },
  {
    key: "aeo_answer", label: "AEO answer", tier: 1,
    role: "The short, quotable, self-contained answer an AI model can lift verbatim. Cited, not clicked.",
    home: { table: null, owner: "Narrative Engine (no home table yet)" },
    publish: { platform: null, auto: false },
  },
  {
    key: "blog", label: "Blog", tier: 1,
    role: "The readable version of the argument on our own site, and the hub the social pieces link back to.",
    home: { table: "agent_blog_posts", owner: "Blog Manager" },
    publish: { platform: null, auto: false },
  },
  {
    key: "reel", label: "Reel / Short", tier: 2,
    role: "Stops the scroll. One idea, the sharpest one, in the first second.",
    home: { table: "agent_social_posts", owner: "Content Director" },
    publish: { platform: "instagram", postType: "reel", auto: true },
  },
  {
    key: "youtube_short", label: "YouTube Short", tier: 2,
    // NOT a duplicate of `reel`. Same vertical file, different surface and a
    // different job: a Reel works the Instagram feed, a Short works YouTube's
    // discovery, where search and the feed overlap. They are one artifact each
    // because the unique index is (narrative_id, kind) — collapsing them would
    // mean one of the two silently overwrote the other.
    role: "Works YouTube's discovery surface — the vertical cut, where search and the feed overlap.",
    home: { table: "video_render_jobs", owner: "BrandCast / Cut Editor" },
    // Publishing a Short goes the same way as any YouTube upload: a caption
    // draft on agent_social_posts that content-deploy sends. The artifact is
    // the FILE, so it claims no autopilot of its own.
    publish: { platform: null, auto: false },
  },
  {
    key: "linkedin", label: "LinkedIn article", tier: 2,
    role: "Talks to shop owners as operators — the business case, margins and process, not the visual.",
    home: { table: "agent_social_posts", owner: "Content Director" },
    publish: { platform: "linkedin", postType: "post", auto: false },
  },
  {
    key: "x_thread", label: "X thread", tier: 2,
    role: "Makes the argument in public, in the open, one beat per post — the format that invites disagreement.",
    home: { table: "agent_social_posts", owner: "Content Director" },
    publish: { platform: "x", postType: "thread", auto: false },
  },
  {
    key: "threads", label: "Threads post", tier: 2,
    role: "The conversational take — a shorter, warmer read of the same point, built for replies.",
    home: { table: "agent_social_posts", owner: "Content Director" },
    publish: { platform: "threads", postType: "post", auto: false },
  },
  {
    key: "instagram", label: "Instagram", tier: 2,
    role: "Shows the proof. The work itself, where the wrap audience already lives.",
    home: { table: "agent_social_posts", owner: "Content Director" },
    publish: { platform: "instagram", postType: "feed", auto: true },
  },
  {
    key: "facebook", label: "Facebook", tier: 2,
    role: "The same proof for the older, local, referral-driven half of the wrap market — where shop owners actually are.",
    home: { table: "agent_social_posts", owner: "Content Director" },
    publish: { platform: "facebook", postType: "feed", auto: true },
  },
  {
    key: "substack", label: "Substack newsletter", tier: 2,
    role: "The considered version for people who chose to hear from us — context and opinion, not announcements.",
    home: { table: "agent_email_campaigns", owner: "MightyMail / Klaviyo" },
    publish: { platform: null, auto: false },
  },
  {
    key: "email", label: "Email", tier: 3,
    role: "Goes to the list with one job and one action. The only channel we own outright.",
    home: { table: "agent_email_campaigns", owner: "MightyMail / Klaviyo" },
    publish: { platform: null, auto: false },
  },
  {
    key: "meta_ad", label: "Meta ad", tier: 3,
    role: "Buys reach for the piece that already earned it organically — never a cold idea.",
    home: { table: "agent_social_posts", owner: "Content Director / BrandCast" },
    publish: { platform: "ad", postType: "ad", auto: false },
  },
  {
    key: "collateral", label: "Sales collateral", tier: 3,
    role: "What a human sends a prospect after a call. The same message, in a form that closes.",
    home: { table: null, owner: "Narrative Engine (no home table yet)" },
    publish: { platform: null, auto: false },
  },
];

export const ARTIFACT_KIND_KEYS = ARTIFACT_KINDS.map((a) => a.key);

export function artifactKind(key: string): ArtifactKind | null {
  return ARTIFACT_KINDS.find((a) => a.key === key) || null;
}

/** Business goals — the same vocabulary content_hooks already uses. */
export const OBJECTIVES = [
  { key: "awareness", label: "Awareness", hint: "They don't know the problem exists" },
  { key: "consideration", label: "Consideration", hint: "They know, and are weighing options" },
  { key: "conversion", label: "Conversion", hint: "They're deciding whether to buy" },
  { key: "retention", label: "Retention", hint: "They already bought — keep them" },
] as const;

export type ObjectiveKey = (typeof OBJECTIVES)[number]["key"];
export const OBJECTIVE_KEYS = OBJECTIVES.map((o) => o.key) as ObjectiveKey[];

export function isObjective(v: unknown): v is ObjectiveKey {
  return OBJECTIVE_KEYS.includes(String(v) as ObjectiveKey);
}

export interface NarrativeRow {
  id: string;
  brand: string;
  topic: string;
  objective: string;
  status?: string;
  source_table?: string | null;
  source_id?: string | null;
}

export interface ArtifactRow {
  id: string;
  narrative_id: string;
  kind: string;
  target_table?: string | null;
  target_id?: string | null;
  title?: string | null;
  body?: string | null;
  status: ArtifactStatus;
  links_to?: string[] | null;
  produced_by?: string | null;
}

/**
 * The artifact set a narrative is expected to produce.
 *
 * Returns PLANNED placeholders — empty, honestly. This is the checklist the
 * board renders as "2 of 13 made", never as content that exists.
 */
export function planArtifacts(narrativeId: string): Array<Pick<ArtifactRow, "narrative_id" | "kind" | "status">> {
  return ARTIFACT_KINDS.map((k) => ({
    narrative_id: narrativeId,
    kind: k.key,
    status: "planned" as const,
  }));
}

/**
 * THE CHAIN — which artifact points at which.
 *
 * Not a ring and not everything-to-everything. Tier 1 pieces are anchors: the
 * amplifiers (tier 2/3) all point back at an anchor, and the anchors point at
 * each other. That is what actually compounds — a reel driving to the blog,
 * the blog to the video, the SEO page to both — rather than a chain that
 * breaks the moment one piece is missing.
 *
 * Only EXISTING artifacts are linked. Never a link to something unmade.
 */
export function buildLinkPlan(artifacts: ArtifactRow[]): Record<string, string[]> {
  const made = (artifacts || []).filter((a) => a.status !== "planned");
  const tierOf = (a: ArtifactRow) => artifactKind(a.kind)?.tier ?? 3;
  const anchors = made.filter((a) => tierOf(a) === 1);

  const plan: Record<string, string[]> = {};
  for (const a of made) {
    const targets = anchors.filter((t) => t.id !== a.id).map((t) => t.id);
    // An anchor with no other anchor yet, or an amplifier with no anchor at
    // all, links to nothing. An empty list is the honest answer.
    plan[a.id] = targets;
  }
  return plan;
}

export interface NarrativeCoverage {
  total: number;
  made: number;
  published: number;
  /** Kinds with nothing made yet — the honest gaps. */
  missing: string[];
  /** Made but with no chain — they exist and lead nowhere. */
  orphans: string[];
  percent: number;
}

/** How complete a narrative actually is. Counts nothing it cannot see. */
export function coverage(artifacts: ArtifactRow[]): NarrativeCoverage {
  const byKind = new Map<string, ArtifactRow>();
  for (const a of artifacts || []) byKind.set(a.kind, a);

  const made = (artifacts || []).filter((a) => a.status !== "planned");
  const missing = ARTIFACT_KIND_KEYS.filter((k) => {
    const a = byKind.get(k);
    return !a || a.status === "planned";
  });
  const orphans = made.filter((a) => !(a.links_to?.length)).map((a) => a.id);

  return {
    total: ARTIFACT_KINDS.length,
    made: made.length,
    published: made.filter((a) => a.status === "published").length,
    missing,
    orphans,
    percent: Math.round((made.length / ARTIFACT_KINDS.length) * 100),
  };
}

/**
 * Map a BrandCast content pack onto artifact kinds.
 *
 * This is the un-burying: the pack currently writes seven real pieces and then
 * concatenates six of them into one task description. Each entry here says
 * which artifact kind that piece IS and which table should own it, so it can
 * become a row instead of a substring.
 *
 * Only keys with actual text produce an artifact — an empty pack field stays a
 * planned gap rather than an empty draft nobody can tell apart from real work.
 */
export interface PackLike {
  blog?: { title?: string; body_markdown?: string } | null;
  x?: string | null;
  substack?: { subject?: string; body_markdown?: string } | null;
  linkedin?: string | null;
  instagram?: string | null;
  facebook?: string | null;
  youtube?: { title?: string; description?: string } | null;
}

export interface PackArtifact {
  kind: string;
  title: string | null;
  body: string;
}

export function artifactsFromPack(pack: PackLike | null | undefined): PackArtifact[] {
  if (!pack) return [];
  const out: PackArtifact[] = [];
  const push = (kind: string, title: string | null, body: string | null | undefined) => {
    const text = String(body || "").trim();
    if (!text) return; // nothing real → stays a planned gap
    out.push({ kind, title: title?.trim() || null, body: text });
  };

  push("blog", pack.blog?.title ?? null, pack.blog?.body_markdown);
  push("x_thread", null, pack.x);
  push("substack", pack.substack?.subject ?? null, pack.substack?.body_markdown);
  push("linkedin", null, pack.linkedin);
  push("instagram", null, pack.instagram);
  push("facebook", null, pack.facebook);
  push("youtube", pack.youtube?.title ?? null, pack.youtube?.description);
  return out;
}

/**
 * The pieces a pack wrote that the spine has NO artifact kind for.
 *
 * There is no third option here: a pack field either maps to a kind or it is
 * silently discarded, and silent discarding is exactly how six of seven pieces
 * ended up as a substring. If `video-captions` grows a new field, this makes it
 * loud instead of invisible.
 */
export function unmappedPackFields(pack: PackLike | null | undefined): string[] {
  if (!pack) return [];
  const MAPPED = new Set(["blog", "x", "substack", "linkedin", "instagram", "facebook", "youtube"]);
  return Object.entries(pack as Record<string, unknown>)
    .filter(([k, v]) => !MAPPED.has(k) && v != null && String(v).trim() !== "")
    .map(([k]) => k);
}
