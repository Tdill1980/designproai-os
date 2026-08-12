/**
 * VideoFanOutButton — "Make all formats" on a finished cut.
 *
 * Owner, 2026-08-06: "Canva templates, reels, longform, shorts."
 *
 * One finished render becomes four pieces, all hung off ONE narrative. The
 * planning is in `videoFanOut.ts`, the writes are in `videoFanOutRun.ts`; this
 * is only the surface.
 *
 * ── IT SHOWS THE BILL BEFORE THE PRESS ─────────────────────────────────────
 * Every piece states how it will be made and what it costs, and the expensive
 * ones can be unticked. That is deliberate: three of the four are usually the
 * SAME finished file sent to a different destination, and a fan-out that
 * quietly re-rendered all four would multiply render spend for byte-identical
 * output. After a $500 bill nobody could account for, "2 new renders" has to
 * be visible before, not discoverable after.
 *
 * Crop warnings sit on the piece they belong to. The worker centre-crops, so
 * 16:9 → 9:16 cuts the sides off; on a two-shot that removes a person from the
 * frame, and there is no subject tracking to save it.
 */

import { useCallback, useState } from "react";
import { Loader2, Wand2, AlertTriangle, Ban, Check } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { planFanOutForJob, fanOutFinishedVideo } from "@/lib/videoFanOutRun";
import { fanOutSummary, renderCost, type PlannedPiece } from "@/lib/videoFanOut";
import { planAngles, anglesSummary, type PlannedAngle } from "@/lib/videoAngles";

const METHOD_LABEL: Record<string, string> = {
  reuse: "Uses the finished file — free",
  render: "New render — costs one",
  canva: "Autofilled from the brand's Canva template",
  blocked: "Can't be made",
};

export default function VideoFanOutButton({ renderJobId }: { renderJobId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [pieces, setPieces] = useState<PlannedPiece[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [angles, setAngles] = useState<PlannedAngle[]>([]);
  const [showAngles, setShowAngles] = useState(false);

  const openPlan = useCallback(async () => {
    setOpen(true);
    setLoading(true);
    try {
      const plan = await planFanOutForJob(renderJobId);
      if (plan.error) { toast.error(plan.error); setOpen(false); return; }
      setPieces(plan.pieces);
      // Everything makeable is ticked, because the default should be the whole
      // fan-out — but the cost is on screen and the reformats can come off.
      setChosen(new Set(plan.pieces.filter((p) => p.method !== "blocked").map((p) => p.key)));
      // The angles this cut supports. `hasSpeech` is unknown from the plan, so
      // it is left undefined rather than asserted — an angle is only blocked
      // when we KNOW there is no speech, never on a guess.
      setAngles(planAngles({ brand: plan.cut.brand, topic: plan.cut.title }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setOpen(false);
    } finally { setLoading(false); }
  }, [renderJobId]);

  const selected = pieces.filter((p) => chosen.has(p.key));

  const run = useCallback(async () => {
    setRunning(true);
    try {
      const res = await fanOutFinishedVideo(renderJobId, {
        only: Array.from(chosen),
        producedBy: "brand_board",
      });
      // Report what really happened — made, blocked and failed, separately.
      // A single "Done" over three failures is the shape of every silent
      // pipeline in this codebase.
      if (res.made.length) {
        toast.success(
          `${res.made.length} piece${res.made.length === 1 ? "" : "s"} made` +
          (res.rendersQueued ? ` · ${res.rendersQueued} render${res.rendersQueued === 1 ? "" : "s"} queued` : " · no new renders"),
          { duration: 8000 },
        );
      }
      for (const b of res.blocked) toast.warning(b.reason, { duration: 9000 });
      for (const e of res.errors) toast.error(e, { duration: 9000 });
      if (!res.made.length && !res.errors.length && !res.blocked.length) {
        toast.info("Nothing selected.");
      }
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally { setRunning(false); }
  }, [renderJobId, chosen]);

  return (
    <>
      <button
        onClick={openPlan}
        className="rounded-lg border border-blue-300 px-2.5 py-1 text-[11px] font-bold text-blue-700 hover:border-pink-400 hover:text-pink-700"
        title="Longform, Reel, YouTube Short and a Canva graphic — from this one cut"
      >
        <Wand2 className="mr-1 inline h-3 w-3" />
        Make all formats
      </button>

      <Dialog open={open} onOpenChange={(v) => { if (!running) setOpen(v); }}>
        <DialogContent className="max-w-lg bg-white text-gray-900">
          <DialogHeader>
            <DialogTitle className="text-gray-900">One cut, four pieces</DialogTitle>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Working out what this cut can become…
            </div>
          ) : (
            <>
              <p className="text-xs text-gray-500">
                {fanOutSummary(selected)}. All of it lands as drafts on one narrative — nothing publishes
                and nothing is scheduled.
              </p>

              <div className="space-y-2">
                {pieces.map((p) => {
                  const isBlocked = p.method === "blocked";
                  const ticked = chosen.has(p.key);
                  return (
                    <label
                      key={p.key}
                      className={`flex gap-3 rounded-xl border p-3 ${
                        isBlocked ? "border-gray-200 bg-gray-50 opacity-70" : "cursor-pointer border-gray-200 hover:border-blue-300"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4"
                        disabled={isBlocked}
                        checked={ticked && !isBlocked}
                        onChange={() => {
                          const next = new Set(chosen);
                          if (next.has(p.key)) next.delete(p.key); else next.add(p.key);
                          setChosen(next);
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-gray-900">{p.label}</span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              p.method === "render" ? "bg-amber-100 text-amber-800"
                              : p.method === "blocked" ? "bg-gray-200 text-gray-600"
                              : "bg-emerald-100 text-emerald-800"
                            }`}
                          >
                            {METHOD_LABEL[p.method]}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-gray-500">{p.role}</p>
                        {p.warning && (
                          <p className="mt-1 flex gap-1 text-[11px] font-medium text-amber-700">
                            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                            {p.warning}
                          </p>
                        )}
                        {p.blocked && (
                          <p className="mt-1 flex gap-1 text-[11px] text-gray-600">
                            <Ban className="mt-0.5 h-3 w-3 shrink-0" />
                            {p.blocked}
                          </p>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>

              {/* ONE CUT, A DIFFERENT STORY PER PLATFORM.
                  The four pieces above are DISTRIBUTION — the same file on four
                  surfaces. This is the angling: the same footage carrying a
                  different reason to care on each channel, which is what makes
                  it a media brand rather than a marketing account. Shown here
                  because the angle has to be visible BEFORE the press — that is
                  the thing being approved. */}
              {angles.length > 0 && (
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                  <button
                    type="button"
                    onClick={() => setShowAngles((v) => !v)}
                    className="flex w-full items-center justify-between text-left"
                  >
                    <span className="text-[11px] font-bold text-gray-700">
                      Angles — {anglesSummary(angles)}
                    </span>
                    <span className="text-[11px] text-blue-600">{showAngles ? "Hide" : "Show"}</span>
                  </button>
                  {showAngles && (
                    <div className="mt-2 space-y-1.5">
                      {angles.map((a) => (
                        <div key={a.channel} className="rounded-lg bg-white p-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[11px] font-bold text-gray-900">{a.channelLabel}</span>
                            <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-blue-800">
                              {a.pillar}
                            </span>
                            <span className="text-[11px] font-semibold text-gray-700">{a.angle}</span>
                            {!a.canAutoPublish && (
                              <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[9px] font-bold text-gray-600">
                                no publisher
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 text-[10px] leading-snug text-gray-600">{a.job}</p>
                          {a.blocked && (
                            <p className="mt-1 flex gap-1 text-[10px] text-amber-700">
                              <Ban className="mt-0.5 h-3 w-3 shrink-0" />
                              {a.blocked}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] font-bold text-gray-500">
                  {renderCost(selected) === 0
                    ? "No new renders — nothing extra to pay for."
                    : `${renderCost(selected)} new render${renderCost(selected) === 1 ? "" : "s"} will be queued.`}
                </span>
                <Button
                  size="sm"
                  onClick={run}
                  disabled={running || !selected.length}
                  className="border-0 bg-gradient-to-r from-blue-600 to-pink-600 text-white"
                >
                  {running ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Making…</>
                           : <><Check className="mr-1 h-3 w-3" /> Make {selected.length}</>}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
