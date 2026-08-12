/**
 * QuickQuoteSidePanel — non-modal panel hosting the dashboard
 * QuickQuoteCard alongside the active design.
 *
 * Layout:
 *   <md (mobile):  draggable bottom sheet defaulting to 55vh so the
 *     render above stays meaningfully visible. Drag the grab handle
 *     up to snap to 90vh (full quote form) or down to dismiss
 *     (<25vh). Snap points: 55vh / 90vh.
 *   md+ (desktop): left side panel sized to roughly match the
 *     dashboard QuickQuoteCard column (~half the screen on lg/xl)
 *     so the render + thumbnails on the right stay visible and
 *     interactive.
 *
 * Why not shadcn Sheet?
 *   The Sheet primitive renders a full-screen `bg-black/80` overlay
 *   that dims and click-blocks the rest of the screen. The user
 *   asked for the QuickQuote alongside the render with the render
 *   still interactive, which is the opposite of modal.
 *
 * Esc still closes (matches Sheet's keyboard affordance), but
 * clicks on the rest of the page do NOT close it — the panel only
 * closes via the explicit X button or Esc, so a misplaced tap on
 * the render doesn't trash a half-built quote.
 */

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const MOBILE_DEFAULT_VH = 55;
const MOBILE_SNAP_POINTS = [55, 90] as const;
const MOBILE_DISMISS_VH = 25;

/**
 * Viewport-tracking hook initialised from `window.innerWidth` so the
 * very first render already knows whether it's on desktop. Avoids the
 * SSR `undefined → false` flicker that previously routed desktop
 * users into the full-width mobile bottom-sheet branch.
 */
const useViewportWidth = () => {
  const [vw, setVw] = useState(() =>
    typeof window === "undefined" ? 1024 : window.innerWidth,
  );
  useEffect(() => {
    const handler = () => setVw(window.innerWidth);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return vw;
};

/**
 * Inline desktop sizing. Hard-coded pixel widths so a stale CSS bundle
 * or unexpected cascade can't widen the panel — inline styles always
 * win. Picks a width that matches the dashboard QuickQuoteCard column
 * footprint at each breakpoint.
 */
const desktopWidthFor = (vw: number) => {
  if (vw >= 1536) return 672; // 2xl
  if (vw >= 1280) return 576; // xl
  if (vw >= 1024) return 512; // lg
  return 448; // md
};

interface QuickQuoteSidePanelProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  /**
   * Tool the panel is mounted in — drives the branded header so the
   * rep sees "QuickQuote for DesignPro", "QuickQuote for ColorPro",
   * etc. Defaults to "Designer" if a tool isn't specified.
   */
  toolName?: string;
  /**
   * Visual theme. Defaults to "dark" so existing tools (ColorPro, DesignPro,
   * which all live on dark backgrounds) keep their look. GraphicsPro is a
   * white-page tool and was rendering this panel as a too-dark slab on a
   * bright background — pass theme="light" there for a card that blends in.
   */
  theme?: "dark" | "light";
}

export function QuickQuoteSidePanel({
  open,
  onClose,
  children,
  className,
  toolName,
  theme = "dark",
}: QuickQuoteSidePanelProps) {
  const isLight = theme === "light";
  const vw = useViewportWidth();
  const isDesktop = vw >= 768;

  // Mobile bottom-sheet height tracked in vh so the sheet can be dragged
  // between snap points (55vh default, 90vh expanded). Drag below the
  // dismiss threshold closes. Desktop ignores this entirely.
  const [sheetVh, setSheetVh] = useState<number>(MOBILE_DEFAULT_VH);
  const [dragging, setDragging] = useState(false);
  const dragStateRef = useRef<{ startY: number; startVh: number } | null>(null);

  // Reset to default snap each time the panel reopens so a previous
  // expanded state doesn't leak into the next quote session.
  useEffect(() => {
    if (open) setSheetVh(MOBILE_DEFAULT_VH);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const onGrabPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStateRef.current = { startY: e.clientY, startVh: sheetVh };
    setDragging(true);
  };

  const onGrabPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStateRef.current) return;
    const deltaPx = dragStateRef.current.startY - e.clientY;
    const deltaVh = (deltaPx / window.innerHeight) * 100;
    const next = Math.max(15, Math.min(95, dragStateRef.current.startVh + deltaVh));
    setSheetVh(next);
  };

  const onGrabPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStateRef.current) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    dragStateRef.current = null;
    setDragging(false);
    if (sheetVh < MOBILE_DISMISS_VH) {
      onClose();
      return;
    }
    const closest = MOBILE_SNAP_POINTS.reduce<number>(
      (best, p) => (Math.abs(p - sheetVh) < Math.abs(best - sheetVh) ? p : best),
      MOBILE_SNAP_POINTS[0],
    );
    setSheetVh(closest);
  };

  // Inline layout — explicit pixel/percent values so the panel never
  // accidentally spans the full screen no matter what the cascade
  // does. Mobile = draggable bottom sheet (55vh default, snaps to
  // 90vh on drag); desktop = left panel sized to roughly match the
  // dashboard QuickQuoteCard column.
  const inlineStyle: React.CSSProperties = isDesktop
    ? {
        position: "fixed",
        left: 0,
        top: 0,
        bottom: 0,
        right: "auto",
        width: `${desktopWidthFor(vw)}px`,
        maxWidth: "95vw",
        height: "auto",
        maxHeight: "none",
        zIndex: 50,
      }
    : {
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        height: `${sheetVh}vh`,
        maxHeight: "95vh",
        width: "100%",
        zIndex: 50,
        transition: dragging ? "none" : "height 200ms ease-out",
      };

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-label="QuickQuote"
      style={inlineStyle}
      className={cn(
        "shadow-2xl overflow-y-auto overscroll-contain animate-in duration-300",
        isLight ? "bg-white text-gray-900" : "bg-rp-elevated",
        isDesktop
          ? cn(
              "pt-4 px-4 pb-4 slide-in-from-left border-r",
              isLight ? "border-gray-200" : "border-[#48484a]",
            )
          : cn(
              "rounded-t-2xl pt-2 px-4 pb-[env(safe-area-inset-bottom)] slide-in-from-bottom border-t",
              isLight ? "border-gray-200" : "border-[#48484a]",
            ),
        className,
      )}
    >
      {/* Mobile grab handle — drag to expand to ~90vh (full quote) or
          collapse back to 55vh (default, render visible above). Drag
          below ~25vh dismisses. The padded wrapper enlarges the touch
          target so the handle is reachable without precision tapping;
          `touch-none` blocks the browser from hijacking the gesture
          for page scroll. */}
      {!isDesktop && (
        <div
          role="slider"
          aria-label="Drag to resize QuickQuote"
          aria-valuemin={MOBILE_DISMISS_VH}
          aria-valuemax={95}
          aria-valuenow={Math.round(sheetVh)}
          onPointerDown={onGrabPointerDown}
          onPointerMove={onGrabPointerMove}
          onPointerUp={onGrabPointerUp}
          onPointerCancel={onGrabPointerUp}
          className="-mx-4 -mt-2 mb-1 flex h-7 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
        >
          <div className={cn("h-1.5 w-12 rounded-full", isLight ? "bg-gray-300" : "bg-white/30")} />
        </div>
      )}

      {/* Branded header — Sproket Rocket mascot anchors the quote tool to
          the rest of the suite (matches the global Header logo) and frames
          QuickQuote as the design-and-quote game-changer. Sticky on mobile
          so the brand + close button stay reachable while scrolling the
          form. Title wraps on narrow phones (no `whitespace-nowrap`) to
          avoid the close button colliding with "QuickQuote × DesignPro™". */}
      <div
        className={cn(
          "relative -mx-4 mb-4 px-4 border-b sticky top-0 z-20",
          isLight
            ? "border-gray-200 bg-white"
            : "border-[#2a2a2c] bg-gradient-to-r from-[#0a0a0a] via-[#0f1020] to-[#0a0a0a]",
          isDesktop ? "-mt-4 pt-4 pb-4" : "-mt-2 pt-3 pb-3",
        )}
      >
        <div className="flex items-center gap-3 pr-10">
          <img
            src="/sproket-rocket-logo.png"
            alt="Sproket Rocket"
            className="h-9 sm:h-10 w-auto object-contain drop-shadow-[0_0_12px_rgba(168,85,247,0.45)] flex-shrink-0"
          />
          <div className="flex flex-col leading-tight min-w-0">
            <span className="text-base sm:text-lg font-bold tracking-tight">
              <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">QuickQuote</span>
              <span className="text-cyan-300 mx-1.5 font-black">×</span>
              <span className="bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">{toolName || "Designer"}</span>
              <span className={isLight ? "text-gray-900" : "text-white"}>™</span>
            </span>
            <span
              className={cn(
                "text-[10px] sm:text-[11px] uppercase tracking-wider font-semibold truncate",
                isLight ? "text-blue-600" : "text-cyan-300/80",
              )}
            >
              Design &amp; Quote · Powered by Sproket Rocket
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close QuickQuote"
          className={cn(
            "absolute right-3 top-3 z-10 rounded-md p-2 sm:p-1.5 transition",
            isLight
              ? "bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900"
              : "bg-black/40 text-white/70 hover:bg-black/70 hover:text-white",
          )}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {children}
    </aside>
  );
}
