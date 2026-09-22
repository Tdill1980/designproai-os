/**
 * THE WHOLE JOB, IN ONE ROW (owner, Trish 2026-09-22).
 *
 * She sent a tool-page mockup of WallPro and said "It should be like this."
 * The centrepiece is a four-card row — Upload your wall · Select wall area ·
 * Describe your design · Generate & preview — with every step visible at once.
 *
 * ── WHY IT IS THE RIGHT FIX AND NOT A RESTYLE ─────────────────────────────
 *
 * The four steps are four full-width panels stacked down a page this repo's
 * own comments measure at four thousand pixels. So the customer can never see
 * the SHAPE of the job, and the step she keeps failing to find — marking the
 * wall — was not a step at all: it lived inside step 1's photo block, below
 * the fold, on a phone. "It's currently confusing and has bad ux" and "it's
 * still making me scroll down" are both that.
 *
 * Making "Select wall area" its own numbered card is the owner answering her
 * own complaint, and it is why the numbering here is HERS and not the page's
 * old one.
 *
 * ── THE BOARD OPENS THE STEP; IT IS NOT THE STEP ──────────────────────────
 *
 * Owner's ruling, asked directly: the cards stay compact and always visible,
 * and tapping one expands that step to full width below. Corner tapping and
 * the preview need real width — a photo editor at a quarter of the screen is
 * untappable on a phone, which is the exact failure being fixed. So a card
 * carries its live STATE and its one action, never the tool itself.
 *
 * ── ON A PHONE IT STAYS A ROW ─────────────────────────────────────────────
 *
 * A four-across grid that re-stacks at narrow widths rebuilds the scroll it
 * exists to remove, so below `sm` this is a snap-scrolling carousel: one row,
 * swiped. `WallProStepStrip` is the thin always-there version that rides under
 * the header; this is the board at the top of the page. Two different objects
 * with one steps source, per the "feeds the rail and the strip from ONE steps
 * array" rule the UX pass already set.
 */
import { Check } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type BoardStep = {
  id: string;
  n: number;
  label: string;
  icon: LucideIcon;
  /** The fact about this step right now — never an adjective. */
  detail: string;
  done: boolean;
  /** The one thing to do here. Omitted when the step has nothing to offer yet. */
  action?: { label: string; onClick: () => void; disabled?: boolean };
  /** A thumbnail of this step's own artifact, when one exists. */
  preview?: string | null;
};

/** The step the customer is on: the first one not done. */
export function activeStepId(steps: BoardStep[]): string | null {
  return steps.find(s => !s.done)?.id ?? null;
}

export function WallProStepBoard({ steps, active, onOpen, busy }: {
  steps: BoardStep[];
  active: string | null;
  onOpen: (id: string) => void;
  busy: boolean;
}) {
  return (
    <section aria-label="Start designing your wall" className="mb-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold wall-ink">Start designing your wall</h2>
        <p className="text-xs wall-muted">It only takes a few minutes to go from photo to print-ready files.</p>
      </div>
      {/* Snap-scroll below sm so four steps stay ONE row on a phone; a plain
          grid from sm up. `-mx-4 px-4` lets the row bleed to the screen edge so
          the fourth card peeks and reads as scrollable. */}
      <ol className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-4">
        {steps.map(step => {
          const isActive = step.id === active;
          const Icon = step.icon;
          return (
            <li
              key={step.id}
              className={
                'min-w-[78%] shrink-0 snap-start rounded-xl border p-3 sm:min-w-0 ' +
                (isActive ? 'border-blue-500 ring-1 ring-blue-400/60 wall-card' : 'wall-edge wall-card')
              }
              aria-current={isActive ? 'step' : undefined}
            >
              <div className="flex items-center gap-2">
                <span
                  className={
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ' +
                    (step.done ? 'bg-emerald-600' : 'bg-gradient-to-br from-blue-600 to-fuchsia-600')
                  }
                >
                  {step.done ? <Check className="h-3.5 w-3.5" aria-label="done" /> : step.n}
                </span>
                <Icon className="h-4 w-4 shrink-0 text-blue-500" aria-hidden="true" />
                <h3 className="truncate text-sm font-semibold wall-ink">{step.label}</h3>
              </div>
              {step.preview
                ? <img src={step.preview} alt="" aria-hidden className="mt-2 h-20 w-full rounded-lg object-cover" />
                : <div className="mt-2 h-20 rounded-lg border border-dashed wall-edge" aria-hidden />}
              <p className="mt-2 line-clamp-2 min-h-[2.5rem] text-xs wall-muted">{step.detail}</p>
              {step.action
                ? <Button
                    size="sm"
                    variant={isActive ? 'default' : 'outline'}
                    className="mt-1 w-full"
                    disabled={busy || step.action.disabled}
                    onClick={step.action.onClick}
                  >
                    {step.action.label}
                  </Button>
                : <Button size="sm" variant="ghost" className="mt-1 w-full" disabled={busy} onClick={() => onOpen(step.id)}>
                    Open
                  </Button>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * What the customer gets whichever path they take. The mockup's closing strip,
 * and every line of it is a fact this repo can point at rather than a claim:
 * the scale brain, the 54-inch roll, the bleed/overlap plan and the TIFF/PDF/PNG
 * output set.
 */
export const WALL_OUTCOMES = [
  'Auto-scaled to your wall',
  'Panelized to the press width',
  'Bleed & overlap included',
  'Download print-ready files',
] as const;

export function WallProOutcomes() {
  return (
    <ul className="mt-4 grid gap-2 rounded-xl border wall-edge wall-card p-3 text-xs wall-muted sm:grid-cols-2 lg:grid-cols-4">
      {WALL_OUTCOMES.map(line => (
        <li key={line} className="flex items-center gap-2">
          <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
          {line}
        </li>
      ))}
    </ul>
  );
}
