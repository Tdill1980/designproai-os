// HOW FAR DOWN A PAGE HEADER HAS TO SIT SO THE APP SHELL DOES NOT COVER IT.
//
// Two `position: sticky` elements at the same offset do not stack -- they
// overlap, and the higher z-index simply hides the other. The app shell renders
// a sticky <header> on every route, so a page that adds its own header at
// `top-0` puts it underneath, where it looks like the header was never built.
// That has now been the reported bug twice (WallPro, then WallWrap), which is
// why this is a shared hook rather than a line of JSX copied between pages.
//
// It MEASURES the shell rather than hard-coding a number: the shell's height
// differs between breakpoints and changes when its content wraps, and a guessed
// constant is wrong on the first phone that disagrees.
//
// ⚠️ A MEASURED OFFSET IS ONLY HALF OF IT. `position: sticky` is also silently
// disabled by any ancestor with `overflow` other than `visible` -- that element
// becomes the scroll container and the sticky child resolves against it instead
// of the viewport. index.css applied `overflow-x: hidden` to `html, body, main,
// section` under 768px, which is why a correctly-offset header still scrolled
// away on a phone and only on a phone. That rule now uses `overflow-x: clip`,
// which clips without creating a scroll container. If a sticky header ever
// stops working again, check the ancestor overflow chain BEFORE the offset.

import { useEffect, useState } from 'react';

/**
 * The app shell's sticky header height in pixels, re-measured on resize.
 *
 * @param selfId the id of the calling page's own header, excluded from the
 *   search -- without it the hook can measure itself and pin the header below
 *   its own height.
 */
export function useStickyOffset(selfId: string): number {
  const [top, setTop] = useState(0);
  useEffect(() => {
    const measure = () => {
      // Any sticky header that is not this one. `header.sticky` matches the
      // shell's Tailwind class; the :not() is what keeps it from finding self.
      const bar = document.querySelector(`header.sticky:not(#${selfId})`);
      setTop(bar instanceof HTMLElement ? Math.round(bar.getBoundingClientRect().height) : 0);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [selfId]);
  return top;
}

/**
 * The measured height of one element, re-measured on resize.
 *
 * `useStickyOffset` answers "how far down does MY header go", by measuring the
 * shell's. A second sticky bar underneath that header -- WallPro's step strip --
 * needs a different number: the height of the header it stacks below. Two
 * sticky elements at the same offset overlap rather than stack, which is the
 * defect the file header above describes, so the strip cannot simply reuse the
 * same value.
 *
 * Measured rather than guessed, for the same reason: the header is one compact
 * row on a phone and two lines with a tagline on desktop, and a constant is
 * wrong on the first width that disagrees.
 */
export function useElementHeight(id: string): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const measure = () => {
      const el = document.getElementById(id);
      setHeight(el ? Math.round(el.getBoundingClientRect().height) : 0);
    };
    measure();
    window.addEventListener('resize', measure);
    // The header's own height changes when its contents wrap, which a resize
    // listener alone can miss inside a flex layout.
    const el = document.getElementById(id);
    const observer = typeof ResizeObserver !== 'undefined' && el ? new ResizeObserver(measure) : null;
    if (observer && el) observer.observe(el);
    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [id]);
  return height;
}
