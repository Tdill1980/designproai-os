/**
 * GENIE Universal Panelizer — the one progress surface every product renders.
 *
 * Owner, 2026-09-13: "use the current DP Genie universal Panelizer progress as
 * a template and create for wallpro and graphicspro to use."
 *
 * The vehicle page is the template. What is NOT reused is its diagram: that one
 * groups driver-side beside passenger-side because a vehicle has sides, and a
 * wall (N vertical panels) or a cut graphic (a nested sheet of shapes) has
 * none. Forcing one drawing to serve all three is how a shared component
 * becomes a pile of product `if`s.
 *
 * What IS reused is everything that actually generalises — the step rail, the
 * glowing pieces, the terminal sentence — driven by the product-free model in
 * lib/panelizer-progress.ts. A product supplies a PanelizerRun from its own job
 * row; this file knows about no product at all.
 *
 * "When all panels glow, it's a go" is kept verbatim. It is the owner's line
 * and customers already read it on the vehicle page.
 */
import { CheckCircle2, Circle, Clock, Loader2, XCircle } from 'lucide-react';
import {
  STAGE_TONE, panelizerProgress, stageProgress,
  type PanelizerRun, type PanelizerStage, type PanelizerPiece,
} from '@/lib/panelizer-progress';

function StageIcon({ state }: { state: PanelizerStage['state'] }) {
  const cls = 'h-4 w-4 shrink-0 ' + STAGE_TONE[state];
  if (state === 'complete') return <CheckCircle2 className={cls} />;
  if (state === 'running') return <Loader2 className={cls + ' animate-spin'} />;
  // A human step is WAITING, not spinning: nothing is churning, a person has it.
  if (state === 'waiting') return <Clock className={cls} />;
  if (state === 'failed') return <XCircle className={cls} />;
  return <Circle className={cls} />;
}

function Piece({ piece }: { piece: PanelizerPiece }) {
  const done = piece.state === 'done';
  const active = piece.state === 'active';
  const failed = piece.state === 'failed';
  return (
    <li
      className={
        'rounded-xl border p-3 transition-all ' +
        (failed ? 'border-red-300 bg-red-50'
          : done ? 'border-emerald-400 bg-emerald-50 shadow-[0_0_14px_-2px_rgba(16,185,129,0.55)]'
            : active ? 'border-violet-400 bg-violet-50 animate-pulse'
              : 'border-dashed border-slate-300 bg-slate-50')
      }
    >
      <p className={'text-sm font-semibold ' + (done ? 'text-emerald-900' : failed ? 'text-red-900' : 'text-slate-700')}>
        {piece.label}
      </p>
      {piece.detail && <p className="mt-0.5 text-[11px] text-slate-600">{piece.detail}</p>}
      {!piece.detail && !done && <p className="mt-0.5 text-[11px] text-slate-500">{active ? 'building…' : 'queued'}</p>}
    </li>
  );
}

export function UniversalPanelizerProgress({ run }: { run: PanelizerRun }) {
  const pieces = panelizerProgress(run);
  const stages = stageProgress(run);

  return (
    <section className="space-y-5" aria-label="GENIE Universal Panelizer progress">
      <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-violet-600">
          GENIE Universal Panelizer
        </p>
        <h2 className="mt-1 text-xl font-bold">{run.headline}</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">{run.detail}</p>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
          {run.reference && <span className="rounded bg-slate-900 px-2 py-0.5 font-mono text-white">{run.reference}</span>}
          <span className="truncate font-semibold text-slate-700">{run.title}</span>
          <span>Step {stages.done}/{stages.total}</span>
          {pieces.total > 0 && <span>{pieces.done}/{pieces.total} files</span>}
        </p>
        {/* Counted from FILES, not steps: a rail can be nearly ticked while
            nothing printable exists. */}
        {pieces.total > 0 && (
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200">
            <div
              className={'h-full rounded-full transition-all duration-500 ' + (run.outcome === 'failed' ? 'bg-red-500' : 'bg-gradient-to-r from-sky-500 via-violet-500 to-fuchsia-500')}
              style={{ width: `${pieces.percent}%` }}
            />
          </div>
        )}
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <ol className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          {run.stages.filter(s => s.state !== 'skipped').map(stage => (
            <li key={stage.key} className="flex gap-3">
              <StageIcon state={stage.state} />
              <div className="min-w-0">
                <p className={'text-sm font-semibold ' + STAGE_TONE[stage.state]}>{stage.label}</p>
                <p className="text-xs leading-snug text-slate-600">{stage.explanation}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
              Your print files
            </p>
            {pieces.allGlowing
              ? <p className="text-xs font-bold text-emerald-700">When all panels glow, it’s a go.</p>
              : <p className="text-xs text-slate-500">{pieces.done} of {pieces.total} ready</p>}
          </div>
          {pieces.total === 0
            ? <p className="mt-3 rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">
                Your files appear here as they are produced.
              </p>
            : <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {run.pieces.map(piece => <Piece key={piece.id} piece={piece} />)}
              </ul>}
        </div>
      </div>
    </section>
  );
}
