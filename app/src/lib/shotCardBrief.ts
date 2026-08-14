/**
 * shotCardBrief — a Content Director shot card, read as the creative direction
 * for one cut.
 *
 * ── THE DESIGN ERROR THIS CORRECTS ─────────────────────────────────────────
 * Owner, 2026-08-07: "He actually uploaded to the exact card that described
 * what needed to be shot in Content Director, so that the AI could easily pull
 * the card and just read what it says."
 *
 * What was built instead was a SEARCH. `contentRunner.js` term-matches the
 * whole Asset Library hunting for a clip that resembles an idea — which is the
 * right shape when nobody has said which footage goes with which idea. On a
 * shot card somebody already has. The brief says what the piece is FOR; the
 * attachment says what to cut it FROM. Both halves of the question were
 * answered by a human before the pass ever woke up.
 *
 * Measured in production 2026-08-07: 102 shot cards, 98 carrying a written
 * brief, 3 carrying attached footage — and `raw_asset_ids` is referenced by
 * `ShotListTab.tsx`, `ShotCallSheet.tsx` and `shootDay.ts` and NOTHING else.
 * All three are UI. No server pass, no edge function, nothing unattended has
 * ever read the column. An admin spent two days attaching real footage to the
 * exact cards describing those shots and the system produced nothing from any
 * of it.
 *
 * ── WHAT THIS MODULE IS, AND IS NOT ────────────────────────────────────────
 * It TRANSCRIBES a card. It copies the human's own words into the shape an
 * editor is briefed with, and where a field is empty it says so. There is no
 * generation anywhere in this file, deliberately:
 *
 *   · An absent `hook` comes back `null` and is reported as a gap. A generated
 *     hook would silently overrule the person who wrote the card — and it
 *     would be indistinguishable from one they wrote, which is worse than an
 *     empty field. 18 of 102 cards carry a hook; the other 84 must not be
 *     given one by a machine.
 *   · `cta`, `platform`, `edit_type`, `on_camera_person`, `location` and
 *     `props` are treated the same way.
 *   · The ANGLE is never assembled from anything outside the card. It is the
 *     hook verbatim when there is one, otherwise the shot title verbatim, and
 *     `angleSource` records which — so a reader can tell a written hook from a
 *     title standing in for one.
 *
 * ── COMPLETENESS: BLOCKERS AND GAPS ARE DIFFERENT THINGS ───────────────────
 * A BLOCKER means this card cannot become a cut at all (no footage attached,
 * no words at all, no brand). A GAP means the cut is poorer for it but is
 * still honest — no hook, no CTA, no declared channel.
 *
 * Collapsing the two is how "the pass works" gets confused with "the pass will
 * produce something for this board". They are different claims and this
 * module keeps them apart.
 *
 * Pure by design: no database, no network, no clock, no randomness. The same
 * row always yields the same brief.
 *
 * The unattended pass `worker/video-renderer/shotCards.js` is plain node and
 * cannot import this file, so it RESTATES these rules and
 * `tests/shot-cards.test.ts` drives both copies through one shared table and
 * fails on any divergence — the same pin `tests/content-runner.test.ts` puts on
 * the STOPWORDS list, which exists because a silently drifted copy once made
 * the server match a paint-booth clip to a laminate idea, unattended.
 * Do not hand-edit one side.
 */
import { CHANNEL_KEYS, type ChannelKey } from "./contentDoctrine";

/**
 * The `shot_list_items` columns this module reads. Verified against the live
 * table 2026-08-07 — the card also carries `responsible_person`, `priority`,
 * `due_date`, `board_task_id`, `cover_asset_id`, `script_id` and `created_by`,
 * none of which describe the CUT, so none of them is read here.
 */
export interface ShotCardRow {
  id?: string | null;
  brand?: string | null;
  campaign?: string | null;
  content_type?: string | null;
  shot_title?: string | null;
  filming_instruction?: string | null;
  on_camera_person?: string | null;
  location?: string | null;
  props?: string | null;
  status?: string | null;
  hook?: string | null;
  cta?: string | null;
  platform?: string | null;
  notes?: string | null;
  edit_type?: string | null;
  raw_asset_ids?: string[] | null;
  render_job_id?: string | null;
}

/** A field the card does not carry, and what the cut loses for it. */
export interface ShotCardGap {
  field: string;
  why: string;
}

/**
 * One grounded fact the CARD asserts about this footage.
 *
 * `editor-brain` drops any fact that cannot carry its own `evidence`, so the
 * evidence names the column a human typed it into. That is real provenance —
 * a person who planned the shoot wrote it down — and it is deliberately not
 * dressed up as an observation the parser made.
 */
export interface ShotCardFact {
  text: string;
  evidence: string;
  kind: string;
}

export interface ShotCardBrief {
  cardId: string | null;
  brand: string | null;
  title: string | null;
  /** The card's own hook, verbatim. NEVER generated — null means null. */
  hook: string | null;
  /** The card's own CTA, verbatim. NEVER generated. */
  cta: string | null;
  /** The treatment the card declares, verbatim, or null. */
  editType: string | null;
  /** The card's raw platform string, exactly as typed. */
  platform: string | null;
  /** …resolved to a doctrine channel, or null with `channelGap` saying why. */
  channel: ChannelKey | null;
  channelGap: string | null;
  contentType: string | null;
  campaign: string | null;
  instruction: string | null;
  /** `notes` — the human's script / direction for this shot. */
  direction: string | null;
  onCameraPerson: string | null;
  location: string | null;
  props: string | null;
  /** What the piece is ABOUT. The card's words, never assembled from elsewhere. */
  angle: string | null;
  angleSource: "hook" | "shot_title" | null;
  /** How to shoot/cut it — the instruction and the script, joined. */
  objective: string | null;
  facts: ShotCardFact[];
  assetIds: string[];
  gaps: ShotCardGap[];
  blockers: ShotCardGap[];
  /** No blockers. Says nothing about whether the FOOTAGE is usable yet. */
  ready: boolean;
}

/** Trimmed text, or null. An empty string is an absent field, not a value. */
function text(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

/**
 * Platform strings people actually type, mapped to the doctrine's channels.
 *
 * ONLY the aliases live here. The channel list itself is imported from
 * `contentDoctrine.ts` — restating it would let this module accept a channel
 * the doctrine has never heard of, or reject one it just gained.
 *
 * Everything below is a spelling of a channel that already exists. Nothing
 * here invents a surface or decides anything about one.
 */
const PLATFORM_ALIASES: Record<string, string> = {
  ig: "instagram",
  insta: "instagram",
  instagram_reels: "instagram",
  reels: "instagram",
  fb: "facebook",
  meta: "facebook",
  yt: "youtube",
  youtube_shorts: "youtube_short",
  yt_short: "youtube_short",
  yt_shorts: "youtube_short",
  shorts: "youtube_short",
  short: "youtube_short",
  tik_tok: "tiktok",
  twitter: "x",
  li: "linkedin",
  newsletter: "email",
};

/**
 * The card's platform → a `ChannelKey`, or an honest gap.
 *
 * A platform this does not recognise is NOT coerced to instagram. The channel
 * decides the hook window, the hook move and how far a hook may push; guessing
 * it means briefing the editor to the wrong surface, which is a worse outcome
 * than briefing it to none.
 */
export function channelForPlatform(
  platform: unknown,
): { channel: ChannelKey | null; gap: string | null } {
  const raw = text(platform);
  if (!raw) {
    return {
      channel: null,
      gap: "No platform on the card, so no channel rule applies — the editor is briefed without one rather than being pointed at a surface nobody chose.",
    };
  }
  const key = raw.toLowerCase().replace(/[\s-]+/g, "_");
  const resolved = (PLATFORM_ALIASES[key] ?? key) as ChannelKey;
  if ((CHANNEL_KEYS as string[]).includes(resolved)) {
    return { channel: resolved, gap: null };
  }
  return {
    channel: null,
    gap: `The card's platform "${raw}" is not a channel this system publishes to, so no channel rule applies. It is reported rather than mapped to the nearest one.`,
  };
}

/**
 * The card, as creative direction.
 *
 * Every string on the result came off the row. Nothing is composed, softened,
 * elevated or filled in.
 */
export function buildShotCardBrief(rawRow: ShotCardRow | null | undefined): ShotCardBrief {
  const row: ShotCardRow =
    rawRow && typeof rawRow === "object" && !Array.isArray(rawRow) ? rawRow : {};

  const hook = text(row.hook);
  const cta = text(row.cta);
  const title = text(row.shot_title);
  const instruction = text(row.filming_instruction);
  const direction = text(row.notes);
  const onCameraPerson = text(row.on_camera_person);
  const location = text(row.location);
  const props = text(row.props);
  const brand = text(row.brand);
  const editType = text(row.edit_type);
  const contentType = text(row.content_type);
  const campaign = text(row.campaign);
  const platform = text(row.platform);
  const { channel, gap: channelGap } = channelForPlatform(platform);

  const assetIds = (Array.isArray(row.raw_asset_ids) ? row.raw_asset_ids : [])
    .map((id) => String(id ?? "").trim())
    .filter(Boolean);

  // THE ANGLE. The hook when a human wrote one; otherwise the shot title,
  // which is the only other place on the card that says what the piece is.
  // There is no third rung — a card with neither is a blocker, not a prompt.
  const angle = hook ?? title;
  const angleSource: ShotCardBrief["angleSource"] = hook ? "hook" : title ? "shot_title" : null;

  // THE OBJECTIVE. How the human said to shoot and cut it. Joined in the order
  // a person reads the card, never merged into the angle: a whole script
  // standing in for a one-line angle is how a cut loses its point.
  const objective = [instruction, direction].filter(Boolean).join("\n\n") || null;

  // Facts the CARD asserts. Each carries the column it came from as evidence,
  // because a fact that cannot say where it came from is dropped downstream —
  // and should be.
  const facts: ShotCardFact[] = [];
  if (onCameraPerson) {
    facts.push({
      text: `On camera: ${onCameraPerson}.`,
      evidence: "the shot card's on_camera_person field, filled in by the person who planned this shoot",
      kind: "shot_card",
    });
  }
  if (location) {
    facts.push({
      text: `Filmed at: ${location}.`,
      evidence: "the shot card's location field, filled in by the person who planned this shoot",
      kind: "shot_card",
    });
  }
  if (props) {
    facts.push({
      text: `In shot: ${props}.`,
      evidence: "the shot card's props field, filled in by the person who planned this shoot",
      kind: "shot_card",
    });
  }

  // ── BLOCKERS: this card cannot become a cut ───────────────────────────────
  const blockers: ShotCardGap[] = [];
  if (!assetIds.length) {
    blockers.push({
      field: "raw_asset_ids",
      why: "No footage is attached to this card. This is not a search — the pass cuts the clips a human put on the card and nothing else, so a card with none is left alone.",
    });
  }
  if (!angle) {
    blockers.push({
      field: "shot_title",
      why: "The card has neither a hook nor a shot title, so there is nothing on it that says what this piece is about. Nothing is invented to stand in for that.",
    });
  }
  if (!brand) {
    blockers.push({
      field: "brand",
      why: "No brand on the card — the render, the board lane and the channel rules all key on it, and picking one would be a guess about whose content this is.",
    });
  }

  // ── GAPS: the cut is poorer, and still honest ─────────────────────────────
  // Fixed field order, so the same card always reports the same list.
  const gaps: ShotCardGap[] = [];
  if (!hook) {
    gaps.push({
      field: "hook",
      why: "No hook written on the card. The shot title leads instead, and no hook is generated — a machine-written hook is indistinguishable from the human's and would silently overrule them.",
    });
  }
  if (!cta) {
    gaps.push({
      field: "cta",
      why: "No CTA written on the card, so the cut ends without one rather than with a generated ask.",
    });
  }
  if (!platform) {
    gaps.push({ field: "platform", why: channelGap! });
  } else if (!channel) {
    gaps.push({ field: "platform", why: channelGap! });
  }
  if (!editType) {
    gaps.push({
      field: "edit_type",
      why: "No treatment declared on the card, so the editor is briefed with the card's content type if it has one and falls to its own default otherwise. Nothing is written back onto the card — a machine's choice must not read as the human's.",
    });
  }
  if (!instruction) {
    gaps.push({
      field: "filming_instruction",
      why: "No filming instruction, so the editor gets the angle without the direction that was meant to go with it.",
    });
  }
  if (!direction) {
    gaps.push({
      field: "notes",
      why: "No script or shot notes on the card — the editor reasons from the beats alone.",
    });
  }
  if (!onCameraPerson) {
    gaps.push({
      field: "on_camera_person",
      why: "Nobody named on camera, so no speaker fact is asserted. It is not inferred from the footage here.",
    });
  }
  if (!location) {
    gaps.push({
      field: "location",
      why: "No location on the card, so none is asserted as a fact about the footage.",
    });
  }
  if (!props) {
    gaps.push({
      field: "props",
      why: "No props listed, so nothing is asserted about what is in shot.",
    });
  }

  return {
    cardId: text(row.id),
    brand,
    title,
    hook,
    cta,
    editType,
    platform,
    channel,
    channelGap,
    contentType,
    campaign,
    instruction,
    direction,
    onCameraPerson,
    location,
    props,
    angle,
    angleSource,
    objective,
    facts,
    assetIds,
    gaps,
    blockers,
    ready: blockers.length === 0,
  };
}

/**
 * What this card still needs before it can be cut — one readable answer.
 *
 * Blockers and gaps stay separate in the summary too. "Missing a hook" and
 * "has no footage" are not the same sentence and must never roll into one
 * number.
 */
export function shotCardCompleteness(brief: ShotCardBrief): {
  ready: boolean;
  blocking: string[];
  missing: string[];
  summary: string;
} {
  const b = brief && typeof brief === "object" ? brief : ({} as ShotCardBrief);
  const blockers = Array.isArray(b.blockers) ? b.blockers : [];
  const gaps = Array.isArray(b.gaps) ? b.gaps : [];
  const blocking = blockers.map((g) => g.field);
  const missing = gaps.map((g) => g.field);

  const summary = blockers.length
    ? `Cannot be cut yet — ${blockers.map((g) => g.why).join(" ")}`
    : gaps.length
      ? `Cuttable. ${gaps.length} field(s) empty on the card (${missing.join(", ")}) — reported, never filled in.`
      : "Cuttable, and every field the editor can use is filled in.";

  return { ready: blockers.length === 0, blocking, missing, summary };
}
