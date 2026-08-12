/**
 * videoAngles — one shoot, a DIFFERENT STORY per platform.
 *
 * Owner, 2026-08-06: "Essentially one video will be parsed into multiple pieces
 * with a different angle based on platform."
 *
 * ── WHAT I HAD BUILT, AND WHY IT WAS NOT THIS ──────────────────────────────
 * `videoFanOut.ts` turns one finished cut into four deliverables — longform,
 * Reel, Short, Canva graphic. Every one of them carries the SAME title and the
 * SAME copy; three of the four are literally the same file sent somewhere else.
 * That is DISTRIBUTION. It is the right answer to "get this on four surfaces"
 * and the wrong answer to what was actually asked.
 *
 * A media brand does not repost one thing four times. It takes one shoot and
 * finds a different story in it for each audience. The same install is:
 *
 *   TikTok    — the satisfying reveal. No lesson. Being worth watching IS it.
 *   LinkedIn  — what that job taught us about margin, said plainly.
 *   Blog      — the material spec, answering what somebody typed into Google.
 *   Email     — the one useful thing, delivered above the fold.
 *
 * Same footage. Four different reasons to care. That is the difference between
 * a marketing account and a media brand, and it is the thing that makes
 * interest-based marketing actually work: the audience on each surface gets
 * something aimed at THEM, not a cross-post aimed at nobody.
 *
 * ── WHAT THIS MODULE DOES AND DOES NOT DO ──────────────────────────────────
 * It produces the ANGLE BRIEF per channel — the pillar, the job that piece
 * does, what to open on, and why this channel gets this treatment. It does NOT
 * write the hook.
 *
 * That line is deliberate. Pure code cannot know what happened in the footage,
 * so a "hook" invented here would be a template with the brand name dropped in
 * — which is exactly the canned-template slop the GENIE pre-pass was removed
 * for (see CLAUDE.md). The brief goes to the copy step, which HAS the
 * transcript, and the doctrine gate then judges what comes back. Code decides
 * the strategy; the model writes the words; the gate holds the line.
 *
 * Pure by design: no database, no network, no clock. Locked by
 * `tests/video-angles.test.ts`.
 */

import {
  CHANNELS, BRANDS, PILLAR_BRIEF, hookBriefFor,
  type ChannelKey, type Pillar,
} from "./contentDoctrine";

/** What one cut is, as far as angling is concerned. */
export interface AngleSource {
  brand?: string | null;
  /** The topic — the narrative's, not `shotlist_<uuid>`. */
  topic?: string | null;
  /** Whether there is speech to build an educational angle on. */
  hasSpeech?: boolean;
  durationSeconds?: number | null;
  aspectRatio?: string | null;
}

export interface PlannedAngle {
  channel: ChannelKey;
  channelLabel: string;
  /** The pillar THIS channel's version leads with. */
  pillar: Pillar;
  /** Short name for the angle — what this cut becomes here. */
  angle: string;
  /** The job this version does that no other version does. */
  job: string;
  /** What the opening frame/line must do on this surface. */
  openOn: string;
  /** Why this channel gets this angle — the reasoning, kept visible. */
  because: string;
  /** The full brief handed to the copy generator. */
  brief: string;
  /** False when there is no publisher — planned, drafted, not auto-posted. */
  canAutoPublish: boolean;
  /** Set when this angle cannot honestly be made from this source. */
  blocked?: string;
}

/**
 * The angle each channel takes on the same footage.
 *
 * Keyed by channel because the CHANNEL is what changes the story — the same
 * brand tells a different one on TikTok than on LinkedIn. The brand then
 * decides the subject matter (via `BRANDS[].interests`), which is why the brief
 * combines both.
 */
const ANGLE_BY_CHANNEL: Record<ChannelKey, { pillar: Pillar; angle: string; job: string; because: string }> = {
  tiktok: {
    pillar: "entertain", angle: "The reveal",
    job: "Stop the scroll with the payoff. No lesson, no context, no branding — the moment itself.",
    because: "TikTok rewards the thing being worth watching. A repurposed ad reads as an ad here and dies.",
  },
  instagram: {
    pillar: "entertain", angle: "The satisfying cut",
    job: "The craft as spectacle — process, texture, the reveal — tight enough to rewatch.",
    because: "IG is a taste surface. It sells the standard of the work without ever mentioning price.",
  },
  youtube_short: {
    pillar: "educate", angle: "The one thing",
    job: "One usable fact from this job, front-loaded, phrased the way someone would search it.",
    because: "Shorts sit where the feed and search overlap — the same vertical doing a discovery job.",
  },
  youtube: {
    pillar: "educate", angle: "The full walkthrough",
    job: "The whole job start to finish, with the decisions explained as they are made.",
    because: "The anchor everything else is cut from. Depth is the point; nothing else on the list can carry it.",
  },
  facebook: {
    pillar: "inspire", angle: "The human story",
    job: "Who this was for and what it meant to them. Longer copy, real account.",
    because: "FB rewards the story over the product, and its audience skews owner rather than installer.",
  },
  linkedin: {
    pillar: "educate", angle: "The business lesson",
    job: "What this job taught us commercially — pricing, scope, a mistake and its cost.",
    because: "A trade audience on LinkedIn is there as operators. Craft alone does not travel; the P&L does.",
  },
  x: {
    pillar: "educate", angle: "The flat claim",
    job: "One opinion from this job, stated plainly enough to be argued with.",
    because: "X rewards a position, not a highlight reel. The argument IS the content.",
  },
  threads: {
    pillar: "entertain", angle: "The open question",
    job: "The unfinished thought this job raised, put to the room.",
    because: "Threads is conversational — a broadcast dies, a genuine question gets replies.",
  },
  pinterest: {
    pillar: "inspire", angle: "The finished result",
    job: "The end state, shot clean, labelled with what it is.",
    because: "Pinterest is planning intent — people save the thing they want to end up with.",
  },
  blog: {
    pillar: "educate", angle: "The answer to the search",
    job: "The question this job answers, answered in the first paragraph, then the depth.",
    because: "The durable asset. It earns traffic for months while every social post decays in a day.",
  },
  email: {
    pillar: "educate", angle: "The one useful thing",
    job: "A single takeaway, delivered above the fold, worth the open on its own.",
    because: "An inbox is a permission, not a channel. Spend it on something usable or lose it.",
  },
  substack: {
    pillar: "inspire", angle: "The argument",
    job: "The point of view this job proves, argued properly at length.",
    because: "The long-form voice of the ecosystem — worth reading by someone who will never buy.",
  },
  wrapfeed: {
    pillar: "entertain", angle: "The full story, unrented",
    job: "The same week's story told without an algorithm to please. Depth allowed.",
    because: "We own it. Nothing is optimised away, and it is the only surface that cannot be taken from us.",
  },
  wraptv_site: {
    pillar: "entertain", angle: "The episode",
    job: "Framed as a show entry — title names the story, poster shows the moment.",
    because: "The media brand's home. This is where the trade comes to watch, not to be sold to.",
  },
};

/** Channels that need speech in the source to be honest. */
const NEEDS_SPEECH = new Set<ChannelKey>(["youtube", "linkedin", "substack", "blog"]);

/**
 * Plan the per-channel angles for one cut.
 *
 * Returns every requested channel, including ones that cannot be made — a
 * missing entry would read as "not applicable", where a present-and-blocked one
 * says what is stopping it. Same honest-gap rule as the rest of the spine.
 */
export function planAngles(
  source: AngleSource,
  channels: ChannelKey[] = (Object.keys(ANGLE_BY_CHANNEL) as ChannelKey[]),
): PlannedAngle[] {
  const brand = String(source.brand || "").trim();
  const topic = String(source.topic || "").trim();

  return channels.map((channel) => {
    const spec = ANGLE_BY_CHANNEL[channel];
    const rule = CHANNELS[channel];
    const brandInfo = BRANDS[brand];

    const briefParts = [
      hookBriefFor(channel, brand, spec.pillar),
      "",
      `THIS PIECE'S ANGLE — ${spec.angle}.`,
      spec.job,
      `Why this channel gets this treatment: ${spec.because}`,
      `Pillar: ${spec.pillar}. ${PILLAR_BRIEF[spec.pillar]}`,
    ];
    if (topic) {
      briefParts.push(
        "",
        `SOURCE — this is cut from: "${topic}".`,
        "Use what is actually in the footage. Do not invent a detail, a number, or a customer quote that is not there.",
      );
    }
    if (brandInfo) {
      briefParts.push(
        `Aim it at: ${brandInfo.audience}`,
      );
    }

    // An educational or argued angle needs somebody to have SAID something.
    // Writing a "business lesson" over silent b-roll means inventing the
    // lesson, which is the one thing the doctrine cannot allow.
    const blocked = NEEDS_SPEECH.has(channel) && source.hasSpeech === false
      ? `${spec.angle} needs speech in the source — there is none in this cut, and writing the lesson anyway would mean inventing it. Use a cut with an interview or a voiceover.`
      : undefined;

    return {
      channel,
      channelLabel: rule?.label || channel,
      pillar: spec.pillar,
      angle: spec.angle,
      job: spec.job,
      openOn: rule?.hookRule || "",
      because: spec.because,
      brief: briefParts.join("\n"),
      canAutoPublish: !!rule?.canAutoPublish,
      ...(blocked ? { blocked } : {}),
    };
  });
}

/** The angles that can be made from this source right now. */
export function makeableAngles(angles: PlannedAngle[]): PlannedAngle[] {
  return (angles || []).filter((a) => !a.blocked);
}

/**
 * One line for the UI: how many stories this one cut becomes, and how many of
 * them can actually be posted today.
 */
export function anglesSummary(angles: PlannedAngle[]): string {
  const list = angles || [];
  const makeable = makeableAngles(list);
  const postable = makeable.filter((a) => a.canAutoPublish).length;
  const blocked = list.length - makeable.length;

  const parts = [`${makeable.length} angle${makeable.length === 1 ? "" : "s"} from this one cut`];
  parts.push(postable ? `${postable} can auto-post` : "none can auto-post yet");
  if (blocked) parts.push(`${blocked} blocked`);
  return parts.join(" · ");
}
