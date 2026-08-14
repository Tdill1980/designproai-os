/**
 * FootageIdeasLane — ideas proposed BY THE FOOTAGE, not by doctrine.
 *
 * Owner, 2026-08-07: "I need to do editing using ai to give us hooks based on
 * video uploads and library and drive." And: "Must edit based on viral moments,
 * and possible intrest based." And: "Dont forget to incorproate into UI."
 *
 * The 💡 Ideas lane above this one reads `content_hooks` — strategy written from
 * brand doctrine. This lane reads what people actually SAID on camera and what
 * was on SCREEN while they said it. Approving hands the card to the SAME fan-out
 * the doctrine lane uses (`idea_approve`), so it inherits per-channel hook
 * framing, one cut per shape, the narrative spine and the calendar.
 *
 * ── EVERY CARD SHOWS ITS WORKING ────────────────────────────────────────────
 * The owner's standing complaint about this system is not knowing whether what
 * it made is any good. So the card carries the verbatim line, the score, the
 * interest it matched, which passes back it, the clip, and the timestamp. A card
 * that says "score 9 · matches 'print quality and why it fails' · speech +
 * vision · viking-fleet.mp3 @ 0:14" is reviewable. A card showing only a line is
 * not — and an unreviewable card is how a bad pick ships silently.
 *
 * Admin surface, so it stays on the dark theme (the WHITE UI standard governs
 * customer-facing pages). It sits inside Content Director's white content area,
 * so it is drawn as a dark PANEL rather than a dark page.
 */

import { useState } from "react";
import { toast } from "sonner";
import { Film, Check, X, Loader2, Sparkles, Eye, Mic, Clock, AlertTriangle } from "lucide-react";
import { useFootageIdeas } from "@/hooks/useFootageIdeas";
import type { RankedMoment } from "@/lib/footageIdeas";
import { cn } from "@/lib/utils";

/** mm:ss — a timestamp somebody can scrub to. "14.44" is not that. */
function stamp(t: number | string | null | undefined): string {
  const n = Number(t);
  if (!Number.isFinite(n)) return "—";
  return `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`;
}

const SIGNAL_META: Record<string, { label: string; title: string; cls: string }> = {
  both: {
    label: "speech + vision",
    title: "Backed by BOTH passes: the transcript line and the vision description of that same instant. The strongest evidence a card can carry.",
    cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  },
  speech: {
    label: "speech only",
    title: "Backed by the transcript only — this clip was never vision-scored, so nothing is known about what was on screen.",
    cls: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  },
  vision: {
    label: "vision only",
    title: "Backed by the vision pass only — this clip has no transcript, so nothing is known about what was said.",
    cls: "border-violet-500/40 bg-violet-500/10 text-violet-300",
  },
};

function FootageCard({
  card, busy, onApprove, onDismiss,
}: {
  card: RankedMoment;
  busy: boolean;
  onApprove: () => void;
  onDismiss: () => void;
}) {
  const sig = SIGNAL_META[card.signals] || SIGNAL_META.speech;
  // The card's text is the footage's OWN words. Nothing here reframes it — the
  // per-channel framing happens at approve time, inside the shared fan-out,
  // where it is tested.
  const said = String(card.verbatim_quote || "").trim();
  const seen = String(card.visual_description || "").trim();

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-white/10 bg-neutral-900 shadow-sm transition hover:border-white/20">
      {/* The clip. A poster where one exists — 13 of 445 clips have one, so the
          usual state is the clip's NAME, which is honest, rather than a grey
          rectangle pretending to be a frame. */}
      <div className="relative flex h-24 items-end overflow-hidden bg-neutral-800">
        {card.thumbnail_url ? (
          <img src={card.thumbnail_url} alt="" className="absolute inset-0 h-full w-full object-cover opacity-70" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <Film className="h-7 w-7 text-white/15" />
          </div>
        )}
        <div className="relative flex w-full items-center gap-1.5 bg-gradient-to-t from-black/90 to-transparent px-2.5 py-1.5">
          <Clock className="h-3 w-3 shrink-0 text-white/50" />
          <span className="text-[10px] font-medium tabular-nums text-white/70">
            {stamp(card.start_time)}–{stamp(card.end_time)}
          </span>
          <span className="truncate text-[10px] text-white/50" title={card.source_title || ""}>
            {card.source_title || "untitled clip"}
          </span>
        </div>
      </div>

      {/* WHY THIS CARD IS ON SCREEN — the score and the matched interest. */}
      <div className="flex flex-wrap items-center gap-1 border-b border-white/5 px-2.5 py-1.5">
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
            card.viral >= 7 ? "bg-amber-500/20 text-amber-300"
              : card.viral > 0 ? "bg-white/10 text-white/60"
                : "bg-white/5 text-white/40",
          )}
          title={
            card.viral > 0
              ? `Viral score ${card.viral} — from the hook scorer, or soundbite/b-roll where the hook scorer never reached this moment.`
              : "Nothing scored this moment. Only 25 of the 1,530 usable moments in the library carry a score, so an unscored card is normal — it is ranked on brand interest and evidence instead."
          }
        >
          {card.viral > 0 ? `score ${card.viral}` : "unscored"}
        </span>
        <span className={cn("rounded border px-1.5 py-0.5 text-[10px] font-semibold", sig.cls)} title={sig.title}>
          {card.signals === "vision" ? <Eye className="mr-0.5 inline h-2.5 w-2.5" /> : <Mic className="mr-0.5 inline h-2.5 w-2.5" />}
          {sig.label}
        </span>
      </div>

      <div className="flex-1 space-y-2 p-2.5">
        {/* THE FOOTAGE'S OWN WORDS. Never paraphrased on this card. */}
        {said && (
          <blockquote className="border-l-2 border-white/20 pl-2 text-[13px] font-medium leading-snug text-white">
            {said}
          </blockquote>
        )}

        {/* What was on screen. Labelled as SEEN, never merged into the quote —
            reading a frame caption as something somebody said is exactly the
            fabrication this lane must not commit. */}
        {(seen || card.vision.length > 0) && (
          <p className="flex gap-1.5 text-[11px] italic leading-snug text-white/50">
            <Eye className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{seen || card.vision.map((v) => v.visual_description).filter(Boolean).join(" · ")}</span>
          </p>
        )}

        {/* The interest this matched, verbatim from the brand doctrine. This is
            the "interest-based" half: viral score finds the candidates, the
            audience's declared interests pick among them. */}
        {card.interest.matched.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {card.interest.matched.map((i) => (
              <span
                key={i}
                className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[9px] font-medium text-cyan-300"
                title="A declared interest for this brand's audience, from the content doctrine — this is why the card ranks where it does."
              >
                {i}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-1.5 border-t border-white/5 p-2">
        <button
          onClick={onApprove}
          disabled={busy}
          className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-gradient-to-r from-blue-600 to-fuchsia-600 py-1.5 text-[11px] font-bold text-white disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          Make it
        </button>
        <button
          onClick={onDismiss}
          disabled={busy}
          title="Hide this card for now. Nothing is written — no row exists until you approve."
          className="rounded-lg border border-white/15 px-2 py-1.5 text-white/40 hover:border-rose-500/50 hover:text-rose-400 disabled:opacity-50"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

export default function FootageIdeasLane({ brand }: { brand?: string }) {
  const f = useFootageIdeas(brand);
  const [showHidden, setShowHidden] = useState(false);

  const approve = (card: RankedMoment) =>
    f.approve.mutate(card, {
      onSuccess: (r) => {
        const drafts = r.drafts?.length
          ? `${r.drafts.length} drafts made — ${r.drafts.map((d) => d.platform).join(", ")}.`
          : "Nothing was made from that card.";
        // Name the clip and the second. The whole promise of a footage-first
        // lane is that the footage match is provenance rather than a guess, and
        // stating it is what makes that checkable.
        const from = r.evidence?.clip
          ? ` From ${r.evidence.clip} @ ${stamp(r.evidence.start_time)}.`
          : "";
        const cuts = r.builds?.length
          ? ` Building ${r.builds.length} cut${r.builds.length === 1 ? "" : "s"} (${r.builds.map((b) => b.aspect).join(", ")}).`
          : r.build_gaps?.length ? ` No cut queued: ${r.build_gaps[0]}` : "";
        toast.success(`${drafts}${from}${cuts}`, { duration: 9000 });
      },
      onError: (e) => toast.error(e.message || "Couldn't make content from that card"),
    });

  const generate = () =>
    f.generate.mutate(undefined, {
      onSuccess: (r) => {
        const n = r.generated?.length || 0;
        // State the REFUSALS too. "3 written, 5 skipped because the footage
        // doesn't carry that pillar" is the system working; hiding the refusals
        // would make an honest gap look like a failure.
        const skipped = r.skipped?.length ? ` ${r.skipped.length} skipped — ${r.skipped[0].why}.` : "";
        if (!n) {
          toast.warning(`No hooks written.${skipped || " Nothing the footage could honestly carry."}`, { duration: 9000 });
          return;
        }
        toast.success(
          `${n} hook${n === 1 ? "" : "s"} written from your footage, each carrying its clip and timestamp. They're in the Ideas lane above.${skipped}`,
          { duration: 9000 },
        );
      },
      onError: (e) => toast.error(e.message || "Couldn't generate hooks"),
    });

  const cards = f.lane.cards;

  return (
    <section className="mb-8 rounded-2xl border border-white/10 bg-neutral-950 p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Film className="h-4 w-4 text-cyan-400" />
            <h2 className="text-base font-bold text-white">From your footage</h2>
            {cards.length > 0 && (
              <span className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-[11px] font-bold text-cyan-300">
                {cards.length} from {f.lane.clips} clip{f.lane.clips === 1 ? "" : "s"}
              </span>
            )}
          </div>
          <p className="mt-1 max-w-2xl text-xs text-white/50">
            Ideas the footage proposed, not doctrine. Each card is what somebody actually said on camera — and, where the clip
            was vision-scored, what was on screen while they said it. Approving runs the same fan-out as the Ideas lane above:
            per-channel drafts, one cut per shape, the spine and the calendar.
          </p>
        </div>

        {/* GENERATION IS OPT-IN. Never on load, always capped, and the button
            says what it will spend before it spends it. */}
        <button
          onClick={generate}
          disabled={f.generating || !f.generateTargets || !brand || brand === "all"}
          title={
            !brand || brand === "all"
              ? "Pick a single brand first — a hook is written to one brand's audience and one brand's pillars."
              : `Writes fresh hooks from the top ${f.generateTargets} clip${f.generateTargets === 1 ? "" : "s"} against this brand's pillars. Capped at ${f.generateCap} clips a run. A clip+pillar already bought is skipped, not re-bought.`
          }
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-[11px] font-bold text-amber-300 hover:bg-amber-500/20 disabled:opacity-40"
        >
          {f.generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          Write hooks from {f.generateTargets || 0} clip{f.generateTargets === 1 ? "" : "s"}
        </button>
      </div>

      {f.isLoading ? (
        <p className="text-sm text-white/40">Reading your footage…</p>
      ) : f.error ? (
        <p className="flex items-center gap-2 text-sm text-rose-400">
          <AlertTriangle className="h-4 w-4" />
          {f.error.message}
        </p>
      ) : cards.length === 0 ? (
        /* THE HONEST EMPTY STATE. It says what is missing and why. It does NOT
           fall back to doctrine hooks — a strategy hook wearing a clip's name is
           a fabricated provenance, and the two are indistinguishable once they
           are on the same card. */
        <div className="rounded-lg border border-white/10 bg-neutral-900 px-4 py-8 text-center">
          <Film className="mx-auto mb-2 h-8 w-8 text-white/15" />
          <p className="text-sm font-semibold text-white/80">No footage-derived ideas.</p>
          <p className="mx-auto mt-2 max-w-xl text-xs leading-relaxed text-white/50">{f.emptyReason}</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {cards.map((card) => (
              <FootageCard
                key={card.id}
                card={card}
                busy={f.busyId === card.id}
                onApprove={() => approve(card)}
                onDismiss={() => f.dismiss(card)}
              />
            ))}
          </div>

          {/* WHAT WAS SUPPRESSED, on the page. A lane showing 12 of thousands
              with no reason reads as a bug; naming the reasons reads as a system
              that looked. The music and Whisper-artifact counts are the whole
              argument for why this lane is not a bare score threshold. */}
          <button
            onClick={() => setShowHidden((v) => !v)}
            className="mt-3 text-[11px] text-white/40 underline decoration-dotted underline-offset-4 hover:text-white/70"
          >
            {showHidden ? "Hide" : "What was filtered out?"}
          </button>
          {showHidden && (
            <div className="mt-2 space-y-1.5 rounded-lg border border-white/10 bg-neutral-900 p-3">
              <p className="text-[11px] leading-relaxed text-white/60">{f.suppression}</p>
              {f.musicExcluded > 0 && (
                <p className="text-[11px] leading-relaxed text-white/40">
                  {f.musicExcluded.toLocaleString()} more transcript lines come from music tracks and were dropped before
                  this lane ran — the house song catalog was transcribed and hook-scored like speech, and lyrics score
                  highest of all. They are not somebody speaking on camera.
                </p>
              )}
              <p className="text-[11px] leading-relaxed text-white/40">
                Signals backing what you can see: {f.lane.signals.both} speech + vision · {f.lane.signals.speech} speech only ·{" "}
                {f.lane.signals.vision} vision only.
                {f.lane.signals.both === 0 && " No card here has both — these clips were transcribed or vision-scored, not both."}
              </p>
              {f.dismissedCount > 0 && (
                <p className="text-[11px] text-white/40">{f.dismissedCount} hidden by you this session.</p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
