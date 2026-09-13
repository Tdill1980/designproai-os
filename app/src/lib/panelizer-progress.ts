// GENIE Universal Panelizer — the progress model every product shares.
//
// Owner, 2026-09-13: "use the current DP Genie universal Panelizer progress as
// a template and create for wallpro and graphicspro to use."
//
// The vehicle page (pages/designpro/GenieProgress.tsx) is the template and it
// earns that: "when all panels glow, it's a go" is the surface the customer
// already watches while the server works. But it is 754 lines welded to vehicle
// facts — driver-side and passenger-side groupings, vehicle-template stage copy,
// six named surfaces, dpApi readers. None of that survives contact with a wall
// (N vertical panels, no sides) or a graphic (cut pieces on a nested sheet).
//
// WHAT ACTUALLY GENERALISES is not the diagram, it is the MODEL underneath:
//
//   stages   an ordered rail the customer reads top to bottom
//   pieces   the things that glow, one per file the press will receive
//   outcome  what is true right now, in a sentence they can act on
//
// So the model lives here, pure and product-free, and each product supplies its
// own stages and pieces from ITS OWN job row. Nothing here reads a table, so a
// product can be added without touching this file and without a second reader
// of anyone's schema.
//
// THE 24-HOUR HUMAN CHECK IS A STAGE, NOT A SPINNER. Owner, 2026-09-12: "these
// are our real customers of wpw we can't risk going 100% ai" — and 2026-09-13:
// "the custom Wallpro genie universal panelizer progress page gives 24 hours
// for our design team to qc and prep files for print". The wait is the product,
// so it appears in the rail with the same weight as the machine steps. A
// competitor's tool finishes in ninety seconds and hands over whatever came
// out; this one says a person is looking.

export type PanelizerStageState =
  | 'pending'    // not started
  | 'running'    // the server is working on it
  | 'waiting'    // blocked on something outside the machine (a person, a payment)
  | 'complete'
  | 'failed'
  | 'skipped';   // legitimately not part of this job

export type PanelizerStage = {
  key: string;
  label: string;
  /** Why this step exists, in the customer's terms. Never jargon. */
  explanation: string;
  state: PanelizerStageState;
};

export type PanelizerPieceState = 'pending' | 'active' | 'done' | 'failed';

/** One thing that glows: a wall panel, a cut graphic, a vehicle surface. */
export type PanelizerPiece = {
  id: string;
  label: string;
  /** Its real measurements, once they exist. The glow means a FILE exists. */
  detail?: string;
  state: PanelizerPieceState;
};

export type PanelizerOutcome = 'building' | 'validating' | 'ready' | 'failed';

export type PanelizerRun = {
  product: string;
  /** What is being panelized, named the way the customer named it. */
  title: string;
  /** The DesignID or job reference they can quote at you. */
  reference: string | null;
  stages: PanelizerStage[];
  pieces: PanelizerPiece[];
  outcome: PanelizerOutcome;
  headline: string;
  detail: string;
};

/**
 * How far along, counted from the PIECES rather than the stages.
 *
 * Deliberate: a stage rail can be three-quarters ticked while nothing printable
 * exists yet. A piece glows only when its file is real, so counting pieces is
 * the honest progress bar — it is the vehicle page's own rule ("a side glows
 * when its Call 9 print panel actually exists. It does not glow for a view that
 * merely rendered") applied to every product.
 */
export function panelizerProgress(run: Pick<PanelizerRun, 'pieces'>) {
  const total = run.pieces.length;
  const done = run.pieces.filter(p => p.state === 'done').length;
  const failed = run.pieces.filter(p => p.state === 'failed').length;
  return {
    done,
    total,
    failed,
    percent: total > 0 ? Math.round((done / total) * 100) : 0,
    /** "When all panels glow, it's a go." */
    allGlowing: total > 0 && done === total,
  };
}

/** The rail's own tally, for the step counter above it. */
export function stageProgress(run: Pick<PanelizerRun, 'stages'>) {
  const countable = run.stages.filter(s => s.state !== 'skipped');
  return {
    done: countable.filter(s => s.state === 'complete').length,
    total: countable.length,
    current: run.stages.find(s => s.state === 'running' || s.state === 'waiting') ?? null,
  };
}

/**
 * Whether the page should keep polling.
 *
 * `validating` keeps polling too: a human release can land at any moment and
 * the customer should see it without reloading. A failed or fully-released run
 * has nothing left to watch.
 */
export const panelizerIsLive = (run: Pick<PanelizerRun, 'outcome'>) =>
  run.outcome === 'building' || run.outcome === 'validating';

/** Rail styling, shared so two products cannot drift into different colours. */
export const STAGE_TONE: Record<PanelizerStageState, string> = {
  pending: 'text-slate-400',
  running: 'text-violet-700',
  waiting: 'text-sky-700',
  complete: 'text-emerald-700',
  failed: 'text-red-700',
  skipped: 'text-slate-300',
};
