/**
 * THE WALLPRO RAIL — what the partner route was missing.
 *
 * Owner, 2026-09-14: "its not even using the real wallpro page from os.designpro
 * and its missing the sidebar wtf."
 *
 * She was right, and the cause is one line in useIsAppRoute: APP_ROUTE_PREFIXES
 * lists "/printpro", so `/printpro/wallpro` is an app route and AppShell wraps
 * it in AppSidebar — a real 260px rail. `/wall-wrap` is not in that list, so
 * AppShell returns its children untouched and the partner route has rendered the
 * BARE component all along. What the previous commit added was not a sidebar
 * either: it was the form column made sticky, which is a different object.
 *
 * WHY NOT JUST ADD /wall-wrap TO THAT LIST. Because AppSidebar is DesignProAI's
 * own chrome — dark (bg-rp-surface, #48484a), and carrying Admin Dashboard,
 * WallPro Batch Generate, WallPro QC / Production and the plan tier. Putting
 * that on a WePrintWraps product page is exactly the brand collision App.tsx
 * warns about, and half of it is staff navigation a customer must never see.
 *
 * So the partner route gets a rail of its own: the SHAPE of the app's sidebar —
 * fixed left, same width, always there — carrying the things a wall customer
 * actually needs. It is light, because WePrintWraps' system is white UI; the
 * dark app chrome belongs to DesignProAI.
 *
 * IT IS A PROGRESS RAIL, NOT A MENU. A wall job is a sequence, and the rail's
 * real job is answering "where am I and what is left" on a page that runs four
 * thousand pixels. Each step reports its own state from the page's data, so it
 * is never a decorative checklist: measured, designed, approved and printable
 * are the same facts the buttons are gated on.
 */
import { Check, FolderOpen, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { WallBrand } from '@/lib/wallpro-brand';

export type WallStep = {
  id: string;
  label: string;
  /** Short state line — the fact, not an adjective. */
  detail: string;
  done: boolean;
};

export function WallProSidebar({
  theme, steps, top, busy, onHistory, onStartFresh, freeReason,
}: {
  theme: WallBrand;
  steps: WallStep[];
  /** Measured header height, so the rail starts below it rather than under it. */
  top: number;
  busy: boolean;
  onHistory: () => void;
  onStartFresh: () => void;
  freeReason: string | null;
}) {
  const jump = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <aside
      aria-label="WallPro steps"
      className="hidden shrink-0 lg:sticky lg:block lg:w-60 lg:self-start lg:overflow-y-auto lg:overscroll-contain"
      style={{ top, maxHeight: `calc(100vh - ${top}px)` }}
    >
      <nav className="flex flex-col gap-1 py-4 pr-3">
        {theme.logo && (
          <div className="mb-3 flex items-center gap-2 px-2">
            <img src={theme.logo} alt={theme.logoAlt} className="h-6 w-auto" />
            <span className="text-sm font-bold wall-ink">
              Wall<span className="text-blue-600">Pro</span>
            </span>
          </div>
        )}

        {steps.map((step, i) => (
          <button
            key={step.id}
            type="button"
            onClick={() => jump(step.id)}
            className="group flex items-start gap-2.5 rounded-md px-2 py-2 text-left transition hover:bg-[hsl(var(--wall-card))]"
          >
            <span
              aria-hidden="true"
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-[10px] font-bold ${
                step.done ? 'border border-[hsl(var(--wall-card-edge))] bg-[hsl(var(--wall-field))] wall-ink' : 'border wall-edge bg-[hsl(var(--wall-card))] wall-muted'
              }`}
            >
              {step.done ? <Check className="h-3 w-3" /> : i + 1}
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold wall-ink">{step.label}</span>
              <span className="block truncate text-[11px] wall-muted">{step.detail}</span>
            </span>
          </button>
        ))}

        {/* The promise, where it is visible for the whole session rather than
            only beside a button two screens down. */}
        {(freeReason === 'trial' || freeReason === 'signed-out' || freeReason === 'commercialpro') && (
          <p className="mx-2 mt-3 rounded-md border wall-edge bg-[hsl(var(--wall-card))] px-2.5 py-2 text-[11px] font-semibold wall-ink">
            {freeReason === 'commercialpro' ? 'Design included with CommercialPro'
              : freeReason === 'signed-out' ? 'Your first design is free — account required'
              : 'Your first design is free'}
          </p>
        )}

        <div className="mt-4 flex flex-col gap-2 px-2">
          <Button variant="outline" size="sm" className="justify-start" disabled={busy} onClick={onHistory}>
            <FolderOpen className="mr-2 h-4 w-4" />My wall designs
          </Button>
          <Button variant="outline" size="sm" className="justify-start" disabled={busy} onClick={onStartFresh}>
            <RotateCcw className="mr-2 h-4 w-4" />Start fresh
          </Button>
        </div>
      </nav>
    </aside>
  );
}

/**
 * THE SAME STEPS, ACROSS THE TOP (owner, 2026-09-22: "it's currently confusing
 * and has bad ux").
 *
 * Measured before building: the rail is `hidden ... lg:block`, and it is
 * mounted as `{theme.showPrintOffer && <WallProSidebar/>}` -- true only for
 * WePrintWraps. So on DesignProAI there was NO progress indication at any
 * width, and on a phone there was none on either brand, on a page this file's
 * own neighbour describes as four thousand pixels long. The one thing that
 * answers "where am I and what is left" was built, correct, reading real
 * state, and switched off for the brand the owner actually uses.
 *
 * ⚠️ WHY A STRIP RATHER THAN JUST UNGATING THE RAIL. On DesignProAI this page
 * is INSIDE the OS AppShell, which already owns a 240px rail. A second one
 * beside it is the double-sidebar defect fixed on ShopFlow the same day -- and
 * is almost certainly why the mount was brand-gated in the first place. So the
 * shape follows the chrome: a horizontal strip where a rail already exists, the
 * rail where none does.
 *
 * It is the SAME `steps` array either way. Two lists of the page's progress
 * would drift the first time a step moved.
 */
export function WallProStepStrip({ steps, top, className = '' }: { steps: WallStep[]; top: number; className?: string }) {
  const jump = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return (
    <nav
      aria-label="WallPro steps"
      className={`sticky z-20 -mx-4 mb-4 border-b wall-edge bg-[hsl(var(--wall-ground))]/95 px-4 py-2 backdrop-blur md:-mx-8 md:px-8 ${className}`}
      style={{ top }}
    >
      {/* Horizontally scrollable rather than wrapped: five chips wrapping to
          three lines on a phone is a block of furniture, not a progress bar. */}
      <ol className="flex snap-x gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {steps.map((step, i) => (
          <li key={step.id} className="snap-start">
            <button
              type="button"
              onClick={() => jump(step.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-sm border px-3 py-1.5 text-xs font-semibold transition ${
                step.done
                  ? 'border-[hsl(var(--wall-card-edge))] bg-[hsl(var(--wall-card))] wall-ink'
                  : 'wall-edge bg-[hsl(var(--wall-card))] wall-muted hover:wall-ink'
              }`}
            >
              <span
                aria-hidden="true"
                className={`flex h-4 w-4 items-center justify-center rounded-sm text-[9px] font-bold ${
                  step.done ? 'border wall-edge bg-[hsl(var(--wall-field))] wall-ink' : 'border wall-edge'
                }`}
              >
                {step.done ? <Check className="h-2.5 w-2.5" /> : i + 1}
              </span>
              {step.label}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
