/**
 * CardSignals — WHY this piece exists, and whether it is any good.
 *
 * Owner, 2026-08-07: "Must edit based on viral moments, and possible interest
 * based… Don't forget to incorporate into UI." The standing complaint behind it
 * is older and simpler: they cannot tell whether what the system made is any
 * good. A grid of thumbnails is unreviewable — every tile looks equally
 * plausible, including the ones the pipeline itself already knows are bad.
 *
 * Three signals, all of which the database already held and none of which the
 * board showed:
 *
 * 1. THE EDITOR BRAIN'S VERDICT — and especially its REFUSALS.
 *    13 render jobs carry `editor_brain_status: "mismatch"`: the brain checked
 *    the footage against the requested angle, found it did not carry it, and
 *    refused BEFORE any model spend. The pipeline then rendered a deliberate
 *    ONE-CLIP STUB so a human could decide whether the idea or the footage was
 *    wrong — its own `edit_stub_reason` says exactly that, in English. A further
 *    20 carry `no_beats`. On the board all 33 were tiles indistinguishable from
 *    a real edit. This is the single highest-value thing on the card: it is the
 *    system telling you it failed, and it was being thrown away.
 *
 * 2. THE VIRAL SIGNAL — the best-scoring moment in the footage behind the cut.
 *    `content_moments` holds 11,675 rows, 2,758 scored, and they reach a render
 *    job through `blueprint.scenes[].clipUrl` → `media_sources.storage_url` →
 *    `content_moments.source_id`. That join resolves for 80 of the 130 jobs with
 *    scenes. It is stated as a fact about the FOOTAGE, never about the cut —
 *    whether the edit actually used the 9/10 moment is recorded nowhere, so it
 *    is not claimed. The other 50 jobs show nothing.
 *
 * 3. THE BRAND INTEREST it serves, matched deterministically against
 *    `contentDoctrine.BRANDS[*].interests` and shown WITH the words that
 *    matched, so the claim is checkable and overrulable at a glance. Same
 *    pattern as `assetContentType.ts`. No match shows nothing rather than
 *    inventing a rationale.
 *
 * Every one of these is absent-by-default. A card with no signal renders NOTHING
 * here — not a grey "unknown" chip, which would put a permanent smudge on two
 * thirds of the board and train the eye to skip the row that matters.
 */

import { cn } from "@/lib/utils";
import { AlertTriangle, Flame, Target } from "lucide-react";
import {
  type FootageSignal, type InterestMatch, brainRefused, scoreTone,
} from "./boardAttention";

const TONE: Record<string, { bg: string; border: string; text: string }> = {
  strong: { bg: "#F9731615", border: "#F9731655", text: "#C2410C" },
  ok: { bg: "#0EA5E915", border: "#0EA5E955", text: "#0369A1" },
  weak: { bg: "#94A3B815", border: "#94A3B855", text: "#475569" },
};

/** Plain-English name for a brain verdict, or null when it is not a refusal. */
export function refusalLabel(status: unknown): string | null {
  const s = String(status ?? "").trim().toLowerCase();
  if (s === "mismatch") return "Brain refused — footage doesn't carry the angle";
  if (s === "no_beats") return "Brain found no beats — one-clip stub, not an edit";
  return null;
}

// ─── The tile badge ──────────────────────────────────────────────────────────

/**
 * The compact form, drawn over the cover art.
 *
 * ONLY the two things worth interrupting a scan for: a refusal (this is not
 * really an edit) and a strong hook (this footage is worth your attention). The
 * interest match is deliberately NOT here — it is a reason, not an alarm, and
 * three badges on a 160px tile is noise.
 */
export function TileSignal({ brainStatus, hook }: {
  brainStatus?: string | null; hook?: number | null;
}) {
  const refused = brainRefused(brainStatus);
  const strong = typeof hook === "number" && hook >= 9;
  if (!refused && !strong) return null;

  return (
    <span className="absolute left-1.5 top-8 z-10 flex flex-col items-start gap-1">
      {refused && (
        <span
          className="flex items-center gap-1 rounded-full bg-red-600 px-1.5 py-0.5 text-[8px] font-bold text-white shadow-sm"
          title={refusalLabel(brainStatus) || "The editor brain refused this cut"}
        >
          <AlertTriangle className="h-2.5 w-2.5" />
          STUB
        </span>
      )}
      {strong && (
        <span
          className="flex items-center gap-1 rounded-full bg-orange-500 px-1.5 py-0.5 text-[8px] font-bold text-white shadow-sm"
          title={`The footage behind this cut carries a moment scored ${hook}/10 for hook strength`}
        >
          <Flame className="h-2.5 w-2.5" />
          HOOK {hook}
        </span>
      )}
    </span>
  );
}

// ─── The full strip, for the detail dialog ───────────────────────────────────

function Chip({ tone, icon: Icon, label, title }: {
  tone: "strong" | "ok" | "weak"; icon: React.ComponentType<{ className?: string }>;
  label: string; title?: string;
}) {
  const t = TONE[tone];
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold"
      style={{ backgroundColor: t.bg, borderColor: t.border, color: t.text }}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

export interface CardSignalsProps {
  brainStatus?: string | null;
  /** Verbatim `edit_stub_reason` from the blueprint, when the brain refused. */
  stubReason?: string | null;
  footage?: FootageSignal | null;
  interest?: InterestMatch | null;
  className?: string;
}

export default function CardSignals({
  brainStatus, stubReason, footage, interest, className,
}: CardSignalsProps) {
  const refusal = refusalLabel(brainStatus);
  const hasScores = footage && (footage.hook !== null || footage.soundbite !== null || footage.broll !== null);
  if (!refusal && !hasScores && !interest) return null;

  return (
    <div className={cn("rounded-lg border border-slate-200 bg-slate-50 p-2.5", className)}>
      <div className="mb-1.5 text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
        Why this exists
      </div>

      {/* THE REFUSAL FIRST. It is the only one of the three that changes what a
          human should DO with the piece. Its own recorded reason is printed
          verbatim rather than paraphrased — the pipeline wrote a better
          sentence than any summary of it would be. */}
      {refusal && (
        <div className="mb-2 rounded-md border border-red-200 bg-red-50 p-2">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-red-800">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {refusal}
          </div>
          {stubReason && (
            <p className="mt-1 text-[10px] leading-snug text-red-700">{stubReason}</p>
          )}
        </div>
      )}

      {hasScores && (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            {footage!.hook !== null && (
              <Chip
                tone={scoreTone(footage!.hook) === "none" ? "weak" : (scoreTone(footage!.hook) as any)}
                icon={Flame}
                label={`Hook ${footage!.hook}/10`}
                title="Best hook score among the moments in the footage this cut was built from"
              />
            )}
            {footage!.soundbite !== null && (
              <Chip tone={scoreTone(footage!.soundbite) === "none" ? "weak" : (scoreTone(footage!.soundbite) as any)}
                icon={Flame} label={`Soundbite ${footage!.soundbite}/10`}
                title="Best soundbite score in the source footage" />
            )}
            {footage!.broll !== null && (
              <Chip tone={scoreTone(footage!.broll) === "none" ? "weak" : (scoreTone(footage!.broll) as any)}
                icon={Flame} label={`B-roll ${footage!.broll}/10`}
                title="Best b-roll score in the source footage" />
            )}
          </div>
          {/* Said explicitly, every time. The score describes the RAW FOOTAGE;
              whether this edit actually used the strong moment is not recorded
              anywhere, so it is not claimed. */}
          <p className="mt-1 text-[9px] leading-snug text-slate-500">
            Scored on the source footage, not on this cut — the edit may or may not have used the strongest moment.
          </p>
          {footage!.quote && (
            <p className="mt-1 border-l-2 border-slate-300 pl-2 text-[10px] italic leading-snug text-slate-600 line-clamp-3">
              “{footage!.quote}”
            </p>
          )}
        </>
      )}

      {interest && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Chip
            tone="ok"
            icon={Target}
            label={interest.interest}
            title={`Matched deterministically on: ${interest.signal.join(", ")}`}
          />
          {/* The matched words, shown so the claim can be checked and dismissed
              rather than taken on faith. */}
          <span className="text-[9px] text-slate-400">matched on “{interest.signal.join(", ")}”</span>
        </div>
      )}
    </div>
  );
}
