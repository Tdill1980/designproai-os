/**
 * StuckReasons — the refusal text, read out loud.
 *
 * Moving frame grabs, one-clip stubs and refused cuts out of Finished Work is
 * only half the job. The other half is that a refusal is genuinely USEFUL: the
 * pipeline wrote a sentence naming what it could not do and what would fix it,
 * and that sentence is a shoot list. Measured in production 2026-08-07, three
 * sentences cover all 43 stub renders:
 *
 *     27 × "…this clip has never been parsed, so there are no beats to reason
 *           over. Run Parse Footage on it…"
 *     13 × "…the editor brain says this footage does not carry the angle the
 *           idea asks for… a human decides whether the idea or the footage is
 *           wrong."
 *      3 × "No parsed beats for this clip… Run Parse Footage on it and
 *           re-approve to get a real edit."
 *
 * So it is printed ONCE with a count, not stamped on forty tiles. Grouped, the
 * three lines say: parse the footage on twenty-seven clips, and re-judge
 * thirteen ideas against their footage. Stamped per tile it is the same
 * paragraph forty times and nobody reads any of them.
 *
 * VERBATIM. The pipeline's sentence is never paraphrased or shortened here — a
 * summarised error is an error you cannot search for. When a card carries no
 * sentence the panel says what the KIND means in our own words, clearly marked
 * as ours, rather than inventing an explanation on the pipeline's behalf.
 */

import { AlertTriangle } from "lucide-react";
import { FAILURE_META, type FailureReasonGroup } from "./boardProvenance";

export interface StuckReasonsProps {
  reasons: FailureReasonGroup[];
  /** How many cards in this lane are machine failures at all. */
  total: number;
}

export default function StuckReasons({ reasons, total }: StuckReasonsProps) {
  if (!reasons.length) return null;

  return (
    <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" />
        <p className="text-[11px] font-bold leading-snug text-red-900">
          {total.toLocaleString()} of these rendered but {total === 1 ? "is" : "are"} not an edit — a frame grab, a
          one-clip stub, or a cut the editor brain refused. Here is what the pipeline said, in its own words.
        </p>
      </div>

      <ul className="mt-2 space-y-1.5">
        {reasons.map((r, i) => (
          <li
            key={`${r.kind}-${i}`}
            className="rounded-lg border border-red-200 bg-white p-2"
          >
            <div className="flex items-center gap-1.5">
              <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                {FAILURE_META[r.kind].label}
              </span>
              <span className="text-[11px] font-extrabold tabular-nums text-red-900">
                ×{r.count.toLocaleString()}
              </span>
            </div>
            {r.reason ? (
              <p className="mt-1 text-[11px] leading-snug text-slate-700">{r.reason}</p>
            ) : (
              <p className="mt-1 text-[11px] leading-snug text-slate-500">
                {r.blurb} <span className="italic">The pipeline recorded no reason for these.</span>
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
