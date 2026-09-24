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
 *
 * ── AND THEN IT LOOKED NOTHING LIKE THE ROW SHE APPROVED (2026-09-24) ─────
 *
 * Owner, holding a screenshot of this board beside the landing row: "Fix my UI
 * Look what happened" → "Its supposed to look like this."
 *
 * Both screenshots are the SAME page. `WallProMagic` — the polished four-step
 * row with the white numeral badges, the 4:3 pictures and the arrows between —
 * renders before a project is open; open one and it was swapped for this board,
 * built two days earlier from a different ruling: dashed empty boxes where a
 * picture belongs, a ghost "Open" button, a snap-scrolling carousel. Two
 * components drawing the same four steps in two visual languages, and which one
 * you got depended on whether a project was loaded.
 *
 * So the chrome is no longer written here at all. `WallProMagic` EXPORTS
 * `MagicStep` / `MagicFrame` / `MagicArrow` / `MAGIC_GRID` and this file fills
 * them with the customer's own artifacts and its own live state. Copying the
 * card would rebuild the drift that caused this; one producer of the look means
 * a change to it lands on both places at once.
 *
 * Two things the board keeps that the landing row does not have, because it is
 * the working page and not a brochure: the ACTION button under each picture,
 * and a ring on the step the customer is on. Both are additive props on
 * `MagicStep`, so the landing row renders byte-identically without them.
 *
 * ⚠️ THE PHONE LAYOUT CHANGED WITH IT, AND THAT IS THE OWNER'S NEWER CHOICE.
 * The 09-22 ruling made this a one-row snap carousel on a phone, reasoning that
 * a grid which re-stacks rebuilds the scroll the board exists to remove. The
 * row she approved on 09-24 is two-up on a phone — two rows, not four — and
 * "supposed to look like this" is about that row. Half the scroll, and the two
 * surfaces match. Do not reintroduce the carousel here alone: it would put the
 * drift straight back.
 */
import { Fragment } from 'react';
import { Check } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MAGIC_GRID, MagicArrow, MagicFrame, MagicStep } from '@/components/wallpro/WallProMagic';

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
      {/* The landing row's own heading scale, so the two surfaces read as one
          product rather than two pages that happen to list four steps. */}
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <h2 className="text-xl font-extrabold tracking-tight wall-ink sm:text-2xl">Start designing your wall</h2>
        <p className="text-sm wall-muted">It only takes a few minutes to go from photo to print-ready files.</p>
      </div>
      <div className={MAGIC_GRID}>
        {steps.map((step, index) => {
          const isActive = step.id === active;
          const Icon = step.icon;
          return (
            <Fragment key={step.id}>
              {index > 0 && <MagicArrow />}
              <MagicStep
                n={step.n}
                title={step.label}
                copy={step.detail}
                active={isActive}
                badge={step.done ? <Check className="h-5 w-5 text-emerald-600" aria-label="done" /> : undefined}
                footer={step.action
                  ? <Button
                      size="sm"
                      variant={isActive ? 'default' : 'outline'}
                      className="w-full"
                      disabled={busy || step.action.disabled}
                      onClick={step.action.onClick}
                    >
                      {step.action.label}
                    </Button>
                  : <Button size="sm" variant="outline" className="w-full" disabled={busy} onClick={() => onOpen(step.id)}>
                      Open
                    </Button>}
              >
                <MagicFrame>
                  {step.preview
                    ? <img src={step.preview} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" draggable={false} />
                    /* NOT A DASHED BOX. An empty step in the middle of a row of
                       photographs read as a broken image rather than as work
                       still to do, which is half of "look what happened". The
                       step's own icon, centred and faint, says "this is step
                       three and it is waiting for you". */
                    : <span className="absolute inset-0 flex items-center justify-center">
                        <Icon className="h-8 w-8 text-blue-400/60" aria-hidden="true" />
                      </span>}
                </MagicFrame>
              </MagicStep>
            </Fragment>
          );
        })}
      </div>
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
