/**
 * ChannelAngleCard — the Content Director card, per the owner's spec.
 *
 * Owner, 2026-08-06, describing it directly:
 *
 *   "I'm gonna see a card with whatever the content director's ideas are for
 *    that card. It'll have buttons per social channel that I can click on to
 *    read what the angle is and what type of content it's going to produce, and
 *    then it's gonna ask me to upload or I can choose for the AI to source from
 *    Google Drive or source from past content or source from library. I would
 *    then click source from library and the AI gets to work finding the video
 *    that'll fit the narrative. If it doesn't find it, it comes back within
 *    seconds and says, upload a video."
 *
 * So: one idea → a channel row → the angle for that channel → source or upload.
 *
 * ── WHY THE ANGLE IS SHOWN BEFORE ANYTHING IS MADE ─────────────────────────
 * The angle is the thing being approved. A card that jumps straight to "find me
 * a video" hides the decision that actually matters — whether the reveal on
 * TikTok and the margin lesson on LinkedIn are the right two stories to pull
 * out of this idea. Reading the angle first is the whole point of the screen.
 *
 * ── EVERY OUTCOME IS A SENTENCE ────────────────────────────────────────────
 * Sourcing returns found-with-reasons or not-found-with-a-next-step, in
 * seconds. There is no spinner that resolves into nothing: "Searched 214 clips
 * and none is about this. Upload a video." is the failure state, and it names
 * its own denominator so it can be argued with.
 */

import { useState, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, Upload, Search, Ban, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { channelMeta, tint } from "@/lib/content-tags";
import { cn } from "@/lib/utils";
import { planAngles, type PlannedAngle } from "@/lib/videoAngles";
import { CHANNELS, type ChannelKey } from "@/lib/contentDoctrine";
import {
  sourceFootageFor, SOURCE_LABEL, SOURCE_BLURB,
  type FootageSource, type SourceResult,
} from "@/lib/sourceFootage";

/** The channels offered on a card, in the order they are worth thinking about. */
const OFFERED: ChannelKey[] = [
  "tiktok", "instagram", "youtube_short", "youtube",
  "linkedin", "x", "facebook", "pinterest",
  "email", "blog", "substack",
];

const SOURCES: FootageSource[] = ["library", "past_content", "drive"];

export interface ChannelAngleCardProps {
  /** The Director's idea — the copy this card is about. */
  idea: string;
  brand: string;
  /** Called with the clip the operator accepted for a channel. */
  onFootageChosen?: (channel: ChannelKey, url: string, angle: PlannedAngle) => void;
  /** Called when they choose to upload instead. */
  onUploadRequested?: (channel: ChannelKey, angle: PlannedAngle) => void;
}

export default function ChannelAngleCard({
  idea, brand, onFootageChosen, onUploadRequested,
}: ChannelAngleCardProps) {
  const [openChannel, setOpenChannel] = useState<ChannelKey | null>(null);
  const [sourcing, setSourcing] = useState<FootageSource | null>(null);
  const [result, setResult] = useState<SourceResult | null>(null);
  /**
   * Clips already taken by other channels on THIS idea.
   *
   * `pickFootage` is deterministic — it returns the single best match — so
   * without this every channel here would be handed the identical clip, and
   * "one shoot, a different story per platform" would ship as one video posted
   * eleven times. Each accepted clip is claimed, so the next channel reaches
   * for the next-best.
   */
  const [taken, setTaken] = useState<Record<string, string>>({});

  // The angles are computed from the idea + brand — no network, so the channel
  // row renders instantly and reading an angle costs nothing.
  const angles = planAngles({ brand, topic: idea });
  const byChannel = new Map(angles.map((a) => [a.channel, a]));
  const angle = openChannel ? byChannel.get(openChannel) : null;

  const pickChannel = useCallback((c: ChannelKey) => {
    setOpenChannel((prev) => (prev === c ? null : c));
    setResult(null);
  }, []);

  const runSource = useCallback(async (src: FootageSource) => {
    if (!openChannel) return;
    setSourcing(src);
    setResult(null);
    try {
      // Exclude what other channels on this idea already took — but never the
      // clip this channel itself picked, so re-running a search on the same
      // channel can legitimately return it again.
      const others = Object.entries(taken)
        .filter(([c]) => c !== openChannel)
        .map(([, url]) => url);
      const r = await sourceFootageFor(idea, brand, src, others);
      setResult(r);
      // A miss is a real answer, not an error — it gets an ordinary toast, not
      // a red one, because "we have nothing about this" is useful information.
      if (r.status === "found") toast.success(r.message);
      else toast(r.message);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSourcing(null);
    }
  }, [openChannel, idea, brand, taken]);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">
        Angles for this idea
      </p>

      {/* THE CHANNEL ROW. One button per channel; the label carries whether it
          can actually post, so the operator is never surprised later. */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {OFFERED.map((c) => {
          const a = byChannel.get(c);
          const on = openChannel === c;
          // THE ECOSYSTEM COLOUR FORMULA, not a new one. Same rule as
          // `ColorPill` on the Brand Board: tinted when idle, SOLID in the
          // channel's own colour with white text once clicked. This card first
          // shipped with a blue→pink gradient, which looked fine and was wrong
          // — it made TikTok and LinkedIn indistinguishable at a glance and
          // broke the one visual language the rest of the hub speaks.
          const color = channelMeta(c === "youtube_short" ? "youtube" : c).color;
          return (
            <button
              key={c}
              onClick={() => pickChannel(c)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-all flex items-center gap-1",
                on ? "text-white shadow-md border-transparent" : "hover:shadow-sm",
              )}
              style={
                on
                  ? { backgroundColor: color }
                  : { backgroundColor: tint(color), borderColor: tint(color, 0.4), color }
              }
              title={a?.angle}
            >
              {CHANNELS[c].label}
              {!CHANNELS[c].canAutoPublish && (
                <span className={on ? "text-[9px] text-white/70" : "text-[9px] opacity-60"}>· no publisher</span>
              )}
            </button>
          );
        })}
      </div>

      {/* THE ANGLE — read it before anything is made. */}
      {angle && (
        <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded bg-blue-600 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">
              {angle.pillar}
            </span>
            <span className="text-sm font-bold text-gray-900">{angle.angle}</span>
          </div>
          <p className="mt-1 text-[11px] leading-snug text-gray-700">{angle.job}</p>
          <p className="mt-1 text-[11px] leading-snug text-gray-500">
            <span className="font-semibold">Open on:</span> {angle.openOn}
          </p>
          <p className="mt-1 text-[11px] leading-snug text-gray-500">
            <span className="font-semibold">Why this channel:</span> {angle.because}
          </p>
          {angle.blocked && (
            <p className="mt-1.5 flex gap-1 text-[11px] font-medium text-amber-800">
              <Ban className="mt-0.5 h-3 w-3 shrink-0" />
              {angle.blocked}
            </p>
          )}

          {/* SOURCE, OR UPLOAD. */}
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {SOURCES.map((s) => (
              <button
                key={s}
                onClick={() => runSource(s)}
                disabled={!!sourcing}
                title={SOURCE_BLURB[s]}
                className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-[11px] font-semibold text-gray-700 hover:border-blue-400 disabled:opacity-50"
              >
                {sourcing === s
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <Search className="h-3 w-3" />}
                {SOURCE_LABEL[s]}
              </button>
            ))}
            <button
              onClick={() => onUploadRequested?.(openChannel!, angle)}
              className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-[11px] font-semibold text-gray-700 hover:border-pink-400"
            >
              <Upload className="h-3 w-3" />
              Upload a video
            </button>
          </div>

          {/* THE ANSWER — always a sentence, never a silent nothing. */}
          {result && (
            <div
              className={`mt-2 rounded-lg p-2 text-[11px] leading-snug ${
                result.status === "found"
                  ? "bg-emerald-50 text-emerald-900"
                  : "bg-amber-50 text-amber-900"
              }`}
            >
              <p className="flex gap-1">
                {result.status === "found"
                  ? <Check className="mt-0.5 h-3 w-3 shrink-0" />
                  : <Ban className="mt-0.5 h-3 w-3 shrink-0" />}
                {result.message}
              </p>
              {result.status === "found" && result.match && (
                <div className="mt-1.5 flex items-center gap-2">
                  <a
                    href={result.match.url}
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold underline"
                  >
                    Watch it first
                  </a>
                  <Button
                    size="sm"
                    className="h-6 border-0 bg-emerald-600 px-2 text-[11px] text-white hover:bg-emerald-700"
                    onClick={() => {
                      // Claim it, so the next channel on this idea reaches for
                      // a different clip rather than being handed this one.
                      setTaken((t) => ({ ...t, [openChannel!]: result.match!.url }));
                      onFootageChosen?.(openChannel!, result.match!.url, angle);
                      toast.success(`Attached to the ${CHANNELS[openChannel!].label} angle.`);
                    }}
                  >
                    Use this
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
