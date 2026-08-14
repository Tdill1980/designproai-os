import { useCallback, useEffect, useState } from "react";

/**
 * Collapse state for the floating tool rail, shared by the desktop and the
 * mobile bar (only one of the two is mounted at a time).
 *
 * The rail is `position: fixed`, so it used to sit ON TOP of the last ~100px
 * of every page — the tail of a long page, a page's own sticky footer, and the
 * Sprocket Agent chip all ended up underneath it. Two things fix that here:
 *
 *   1. SMALL BY DEFAULT — the rail always starts as the small pill and the
 *      expanded state is deliberately NOT persisted. Opening it is a
 *      momentary action (open → pick a tool → it folds itself back), so a
 *      full-width rail is never the resting state of a page. It used to
 *      default to open and remember an expanded choice in localStorage,
 *      which is exactly what left it sitting across the bottom of every page.
 *   2. Space reservation — whatever height the rail currently occupies is
 *      applied as `padding-bottom` on <body>, so the page can always scroll
 *      clear of it. This is why the rail can never cover content in either
 *      state, rather than only when collapsed.
 *
 * @param expandedReserve CSS length to reserve while the rail is open
 * @param collapsedReserve CSS length to reserve while it is folded away
 * @param active Whether THIS rail is the one actually on screen. Both the
 *   desktop and the mobile bar mount and call this hook, but only one of them
 *   renders — without this flag they both write `body.paddingBottom` and the
 *   loser's value wins at random (mobile was getting the desktop's 100px).
 */
export function useToolNavCollapse(expandedReserve: string, collapsedReserve: string, active: boolean) {
  const [collapsed, setCollapsed] = useState(true);

  const toggle = useCallback(() => setCollapsed((c) => !c), []);

  const reserve = collapsed ? collapsedReserve : expandedReserve;

  useEffect(() => {
    if (!active) return;
    const previous = document.body.style.paddingBottom;
    document.body.style.paddingBottom = reserve;
    return () => {
      document.body.style.paddingBottom = previous;
    };
  }, [reserve, active]);

  return { collapsed, setCollapsed, toggle };
}
