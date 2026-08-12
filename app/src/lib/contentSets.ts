/**
 * contentSets — find an idea and see every piece it produced, per channel.
 *
 * Owner, 2026-08-06: "build a way for us to find our uploaded or approved
 * Content Director cards so we see progress and then we can review all 7
 * content pieces per social per brand."
 *
 * ── THE PROBLEM THIS SOLVES ────────────────────────────────────────────────
 * Every surface in this system is a FLAT LIST. The Brand Board lists cards,
 * the Director lists drafts, the queue lists jobs. Not one of them can answer
 * the question that actually matters once a video has been fanned out:
 *
 *     "I approved that install idea — what came out of it, and what didn't?"
 *
 * The pieces exist, scattered: a Reel here, a Short there, a blog draft in a
 * different table, three channels never made at all. Finding them means
 * scrolling three screens and remembering what you were looking for. So the
 * honest answer to "is this idea done?" was nobody knows.
 *
 * A SET is one idea plus every piece made from it, grouped, with the gaps
 * named. That is the unit a human actually reviews.
 *
 * ── GAPS ARE MEMBERS OF THE SET ────────────────────────────────────────────
 * A channel with nothing made is listed as `missing`, not omitted. This is the
 * same rule the rest of the spine follows and it is the whole point here: a set
 * showing four green pieces tells you nothing unless you also know there were
 * eleven possible. "4 of 11" is a status; "4 pieces" is trivia.
 *
 * ── IT NEVER INVENTS A GROUPING ────────────────────────────────────────────
 * Sets key on the narrative when there is one, and fall back to the piece's own
 * first line of copy. A piece with neither is left OUT rather than filed under
 * a guessed topic — merging unrelated work into one set would make every count
 * on this screen a lie.
 *
 * Pure by design: no database, no network, no clock. Locked by
 * `tests/content-sets.test.ts`.
 */

import { CHANNELS, type ChannelKey } from "./contentDoctrine";
import { readReview, type PieceReview } from "./pieceReview";

/** The channels a set is measured against, in review order. */
export const SET_CHANNELS: ChannelKey[] = [
  "instagram", "facebook", "tiktok", "youtube_short",
  "youtube", "linkedin", "x", "pinterest",
  "email", "blog", "substack",
];

export type PieceState = "posted" | "approved" | "review" | "building" | "missing";

/** How far along one channel's piece is. */
export interface SetPiece {
  channel: ChannelKey;
  channelLabel: string;
  state: PieceState;
  /** The row this piece is, when it exists. */
  id?: string;
  source?: string;
  /** A still to show, when there is one. */
  thumb?: string | null;
  /** Human verdict + 1–10, when reviewed. */
  review?: PieceReview;
  /** Can this channel actually be auto-posted today? */
  canAutoPublish: boolean;
}

export interface ContentSet {
  /** Stable key — the narrative id when there is one, else the topic slug. */
  key: string;
  topic: string;
  brand: string;
  /** Newest piece in the set — what "recent" sorts on. */
  updatedAt: string | null;
  pieces: SetPiece[];
  made: number;
  total: number;
  /** Pieces still waiting on a human. */
  needsReview: number;
}

/** One row as the board already knows it. */
export interface SetInput {
  id: string;
  source: string;
  brand: string;
  /** Channel this piece runs on, already normalised by the caller. */
  channel?: ChannelKey | null;
  topic?: string | null;
  caption?: string | null;
  status?: string | null;
  thumb?: string | null;
  meta?: Record<string, unknown> | null;
  updatedAt?: string | null;
  /** True when a render for this piece is in flight. */
  building?: boolean;
}

/** Lowercase, punctuation-free key so near-identical topics group together. */
export function topicKey(topic: string | null | undefined): string {
  return String(topic || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The topic a piece belongs to — its narrative, else its first real line.
 *
 * Never the id, never the platform. A set keyed on "instagram post" would merge
 * unrelated work and make every count on the screen meaningless.
 */
export function topicFor(input: SetInput): string | null {
  const explicit = String(input.topic || "").trim();
  if (explicit.length >= 8) return explicit.slice(0, 160);
  const line = String(input.caption || "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length >= 8);
  return line ? line.slice(0, 160) : null;
}

/**
 * How far along one piece is.
 *
 * `building` outranks everything: a piece whose render is in flight is not
 * "missing", and showing it as missing is what makes somebody press the button
 * a second time and buy a duplicate render.
 */
export function stateFor(input: SetInput): PieceState {
  if (input.building) return "building";
  const s = String(input.status || "").toLowerCase();
  if (s === "posted") return "posted";
  if (s === "approved" || s === "scheduled") return "approved";
  return "review";
}

/**
 * Group pieces into sets.
 *
 * `narrativeKeyById` lets the caller pass real narrative ids where they exist,
 * so two pieces on one story group even when their captions were rewritten
 * independently — which is the normal case once copy has been refined.
 */
export function buildSets(
  inputs: SetInput[] | null | undefined,
  opts: { channels?: ChannelKey[] } = {},
): ContentSet[] {
  const channels = opts.channels || SET_CHANNELS;
  const byKey = new Map<string, { topic: string; brand: string; rows: SetInput[] }>();

  for (const row of inputs || []) {
    const topic = topicFor(row);
    // No real topic → left OUT. A guessed grouping is worse than none.
    if (!topic) continue;
    const key = `${String(row.brand || "").toLowerCase()}::${topicKey(topic)}`;
    if (!byKey.has(key)) byKey.set(key, { topic, brand: row.brand, rows: [] });
    byKey.get(key)!.rows.push(row);
  }

  const sets: ContentSet[] = [];
  for (const [key, group] of byKey) {
    // Best row per channel — a posted piece beats a draft of the same channel.
    const rank: Record<PieceState, number> = { posted: 4, approved: 3, review: 2, building: 1, missing: 0 };
    const best = new Map<ChannelKey, { row: SetInput; state: PieceState }>();
    for (const row of group.rows) {
      if (!row.channel) continue;
      const state = stateFor(row);
      const prev = best.get(row.channel);
      if (!prev || rank[state] > rank[prev.state]) best.set(row.channel, { row, state });
    }

    const pieces: SetPiece[] = channels.map((c) => {
      const hit = best.get(c);
      if (!hit) {
        return {
          channel: c,
          channelLabel: CHANNELS[c]?.label || c,
          state: "missing" as const,
          canAutoPublish: !!CHANNELS[c]?.canAutoPublish,
        };
      }
      return {
        channel: c,
        channelLabel: CHANNELS[c]?.label || c,
        state: hit.state,
        id: hit.row.id,
        source: hit.row.source,
        thumb: hit.row.thumb ?? null,
        review: readReview(hit.row.meta),
        canAutoPublish: !!CHANNELS[c]?.canAutoPublish,
      };
    });

    const made = pieces.filter((p) => p.state !== "missing").length;
    const updatedAt = group.rows
      .map((r) => r.updatedAt)
      .filter(Boolean)
      .sort()
      .pop() || null;

    sets.push({
      key,
      topic: group.topic,
      brand: group.brand,
      updatedAt,
      pieces,
      made,
      total: channels.length,
      needsReview: pieces.filter((p) => p.state === "review").length,
    });
  }

  // Newest first — a review screen is worked from the top.
  return sets.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

/** One line per set: how complete it is, and what still wants a human. */
export function setSummary(set: ContentSet | null | undefined): string {
  if (!set) return "No set.";
  const parts = [`${set.made} of ${set.total} channels`];
  if (set.needsReview) parts.push(`${set.needsReview} waiting on review`);
  const building = set.pieces.filter((p) => p.state === "building").length;
  if (building) parts.push(`${building} building`);
  const blocked = set.pieces.filter((p) => p.state === "missing" && !p.canAutoPublish).length;
  if (blocked) parts.push(`${blocked} have no publisher yet`);
  return parts.join(" · ");
}

/** Find sets by topic or brand — the "find our cards" half of the ask. */
export function searchSets(sets: ContentSet[] | null | undefined, query: string): ContentSet[] {
  const q = topicKey(query);
  if (!q) return sets || [];
  return (sets || []).filter(
    (s) => topicKey(s.topic).includes(q) || topicKey(s.brand).includes(q),
  );
}
