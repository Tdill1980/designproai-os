/**
 * The narrow proof band — what this tool does, before you have done anything.
 *
 * Owner, 2026-09-14: "Show before and after example in narrow hero banner",
 * then "i have a couple of before and afters it can cycle through."
 *
 * WallPro opens on an empty preview pane that says "See the design on your
 * wall". That is the correct empty state and it is also a promise with nothing
 * behind it: a first-time visitor has to imagine the result. Real rooms, bare
 * wall to finished wrap, answer it in the time it takes to look.
 *
 * NARROW ON PURPOSE. This is a band, not a hero. The tool is the product and it
 * must stay above the fold; a full-height opener would push the thing people
 * came to use off the first screen, which is the opposite of the fix. Height is
 * capped and the band never grows with the viewport.
 *
 * REUSES the proven slider maths from wallpro-compare.ts rather than the
 * BeforeAfter component itself: that component is the CUSTOMER'S OWN result and
 * carries the shareable PNG export, which has no business on a marketing band.
 * The interaction is identical because the arithmetic is the same module.
 *
 * SHOWS NOTHING WHEN IT HAS NOTHING. A brand with no examples, or whose files
 * fail to load, renders null — so the band can never appear as broken frames.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MoveHorizontal } from 'lucide-react';
import { clampReveal, compareAriaLabel, COMPARE_STEP, revealFromPointer } from '@/lib/wallpro-compare';
import type { WallProof } from '@/lib/wallpro-brand';

/** Long enough to look at a room and drag the handle; short enough to see there
 *  is more than one job behind it before attention moves to the tool. */
const DWELL_MS = 6500;
const OPENING_REVEAL = 52;

export function WallProHeroProof({ proofs }: { proofs: WallProof[] }) {
  const [index, setIndex] = useState(0);
  const [reveal, setReveal] = useState(OPENING_REVEAL);
  const [held, setHeld] = useState(false);
  const [broken, setBroken] = useState<string[]>([]);
  const box = useRef<HTMLDivElement | null>(null);
  /**
   * THE BAND'S OWN WIDTH, MEASURED — not read off the ref during render.
   *
   * Owner, 2026-09-15: "the one u have is stretched."
   *
   * The before half is pinned to the BAND's width so the two photographs stay
   * in register as the handle moves; its parent is the clipped div, which is
   * only `reveal`% wide. That pin used to read `box.current?.clientWidth`
   * INSIDE the render, and a ref is null on the first paint — so it fell back
   * to `width: 100%`, meaning 100% of the CLIPPED box, and the before image
   * was squeezed into half the band. A ref read during render is a value that
   * does not exist yet; measuring it into state is the only version that is
   * correct on the first frame, and a ResizeObserver keeps it correct when the
   * column reflows instead of waiting for an unrelated re-render.
   */
  const [bandWidth, setBandWidth] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    setBandWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => setBandWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A pair is usable only if NEITHER photograph failed: half a comparison is
  // worse than none, because the missing half is the one making the argument.
  const usable = useMemo(
    () => proofs.filter(p => !broken.includes(p.before) && !broken.includes(p.after)),
    [proofs, broken],
  );
  const current = usable.length ? usable[index % usable.length] : null;

  // Preload every pair once, so an advance swaps to a decoded image instead of
  // flashing an empty frame mid-rotation.
  useEffect(() => {
    for (const p of proofs) for (const src of [p.before, p.after]) { const img = new Image(); img.src = src; }
  }, [proofs]);

  const reducedMotion = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // Rotate — unless there is nothing to rotate to, the visitor is busy with the
  // handle, or they have asked the platform for less movement. A carousel that
  // advances out from under a dragging finger is the classic version of this
  // control done badly.
  useEffect(() => {
    if (usable.length < 2 || held || reducedMotion) return;
    const timer = window.setInterval(() => {
      setIndex(i => (i + 1) % usable.length);
      setReveal(OPENING_REVEAL);
    }, DWELL_MS);
    return () => window.clearInterval(timer);
  }, [usable.length, held, reducedMotion]);

  const track = useCallback((clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (rect) setReveal(revealFromPointer(clientX, rect));
  }, []);

  const fail = useCallback((src: string) => setBroken(list => list.includes(src) ? list : [...list, src]), []);

  if (!current) return null;

  return (
    <section
      aria-label="Example wall wraps, before and after"
      aria-roledescription="carousel"
      className="mx-auto mt-4 max-w-6xl px-4"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocusCapture={() => setHeld(true)}
      onBlurCapture={() => setHeld(false)}
    >
      <div
        ref={box}
        /* NOTHING IS CROPPED (owner, 2026-09-15: "cropped too short", then
           "dont crop it"). The images are `contain`, not `cover`, so every
           frame is shown WHOLE whatever its shape -- a wide install shot and a
           4:3 room both fit, and neither loses its edges to a crop the band
           chose. The ground is dark so the letterbox reads as a frame rather
           than as a loading bug, and the band keeps a 4:3 box so a portrait
           frame cannot make the strip absurdly tall. The box is 1400x709
           because that is the ONE canvas every proof is normalised to, so on
           desktop `contain` shows each frame edge to edge with no letterbox at
           all -- the band and the photographs are the same shape.

           This is the deliberate trade: `cover` fills the box and eats the
           edges; `contain` keeps the photograph intact and pads instead. For a
           before/after the photograph is the argument, so it wins. Both halves
           use the same box and the same fit, so they stay in register. */
        className="relative h-52 w-full select-none overflow-hidden rounded-xl border border-slate-200 bg-slate-900 sm:h-64 lg:h-auto lg:aspect-[1400/709]"
        onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); setHeld(true); track(e.clientX); }}
        onPointerUp={() => setHeld(false)}
        onPointerMove={e => { if (e.buttons === 1) track(e.clientX); }}
      >
        {/* AFTER sits underneath, full width; BEFORE is clipped over it, so the
            handle wipes the finished wall in rather than out. Keyed on the pair
            so React swaps the elements on an advance instead of reusing them
            and briefly painting the previous room's pixels. */}
        <img
          key={current.after}
          src={current.after}
          alt={current.alt}
          onError={() => fail(current.after)}
          className="absolute inset-0 h-full w-full object-contain"
          draggable={false}
        />
        <div className="absolute inset-0 overflow-hidden" style={{ width: `${reveal}%` }}>
          <img
            key={current.before}
            src={current.before}
            alt=""
            aria-hidden="true"
            onError={() => fail(current.before)}
            /* Width is pinned to the BAND, not to this clipped box, so the two
               photographs stay in register as the handle moves. */
            className="absolute inset-y-0 left-0 h-full max-w-none object-contain"
            style={bandWidth ? { width: `${bandWidth}px` } : undefined}
            draggable={false}
          />
        </div>

        <span className="pointer-events-none absolute left-3 top-3 rounded bg-black/65 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-white">Before</span>
        <span className="pointer-events-none absolute right-3 top-3 rounded bg-blue-600/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-white">After</span>

        <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white/90 shadow" style={{ left: `${reveal}%` }}>
          <span className="absolute top-1/2 -ml-3.5 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-white text-slate-700 shadow-md">
            <MoveHorizontal size={14} />
          </span>
        </div>

        {/* The real control. Visually the handle above; for keyboard and screen
            readers a labelled range, same as the customer's own compare view. */}
        <input
          type="range" min={0} max={100} step={COMPARE_STEP} value={reveal}
          aria-label={compareAriaLabel(reveal)}
          onChange={e => setReveal(clampReveal(Number(e.target.value)))}
          className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
        />

        {/* The caption sits ON the photograph, over a scrim, rather than in a
            column beside it. A room photo beside a narrow text column gives the
            photo perhaps half the width and the text a measure too short to
            read comfortably -- both halves lose. Over the image the photo keeps
            the full width and the words land where the eye already is. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 bg-gradient-to-t from-black/75 via-black/45 to-transparent px-4 pb-3 pt-10">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white drop-shadow-sm sm:text-base">{current.headline}</p>
            <p className="mt-0.5 truncate text-xs text-white/85 sm:text-sm">{current.caption}</p>
          </div>

          {usable.length > 1 && (
            <div className="pointer-events-auto flex shrink-0 gap-1.5 pb-1" role="group" aria-label="Choose an example">
              {usable.map((proof, i) => {
                const active = i === index % usable.length;
                return (
                  <button
                    key={proof.after}
                    type="button"
                    aria-label={`Example ${i + 1} of ${usable.length}`}
                    aria-current={active}
                    onClick={() => { setIndex(i); setReveal(OPENING_REVEAL); }}
                    className={`h-1.5 rounded-full transition-all ${active ? 'w-6 bg-white' : 'w-2.5 bg-white/50 hover:bg-white/80'}`}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
