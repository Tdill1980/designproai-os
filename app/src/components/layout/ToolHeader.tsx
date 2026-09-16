/**
 * THE ONE STICKY BAR EVERY TOOL OWNS — WallPro's pattern, generalized.
 *
 * WallPro built the shape every mature SaaS converges on (owner, 2026-09-16):
 * a left rail for product navigation (AppSidebar), and ONE slim bar the tool
 * itself owns, carrying its name, its own primary actions, and the account
 * control at the far right (`ToolAccountMenu.tsx`). It was written once,
 * inline, in `WallPro.tsx`. VehiclePro and CutPro never got it — they still
 * showed the marketing `<Header>` (Home/Design/Output/Profit mega-nav) ON TOP
 * of the same sidebar, which is the double-navigation the WallPro fix was
 * written to remove. This is that same bar, extracted so all three tools
 * share one implementation instead of three copies drifting apart.
 *
 * Reuses `WallProLockup`/`WallProHeaderRule` as-is — their own doc comment
 * already says the lockup is meant to be worn by more than one page.
 *
 * The marketing `<Header>` must be suppressed on any route that mounts this
 * (see `SELF_HEADERED_ROUTE_PREFIXES` in App.tsx) — two sticky top bars is
 * the exact bug this component exists to remove.
 */
import type { ReactNode } from 'react';
import { useStickyOffset } from '@/lib/use-sticky-offset';
import { WallProLockup, WallProHeaderRule, type LockupBrand } from '@/components/wallpro/WallProLockup';
import { ToolAccountMenu } from '@/components/layout/ToolAccountMenu';
import { cn } from '@/lib/utils';

interface ToolHeaderProps {
  /** A stable, unique id — required so `useStickyOffset` can exclude this bar
   *  from its own measurement of "the shell header above me". */
  id: string;
  theme: LockupBrand;
  /** The tool's own primary actions (buttons, links) — left of the account menu. */
  actions?: ReactNode;
  className?: string;
}

export function ToolHeader({ id, theme, actions, className }: ToolHeaderProps) {
  const stickyTop = useStickyOffset(id);
  return (
    <header
      id={id}
      style={{ top: stickyTop }}
      className={cn('sticky z-30 bg-black px-4 py-3 text-white md:px-8 md:py-4', className)}
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
        <WallProLockup theme={theme} />
        <div className="flex shrink-0 items-center gap-2">
          {actions}
          <ToolAccountMenu />
        </div>
      </div>
      <WallProHeaderRule />
    </header>
  );
}
