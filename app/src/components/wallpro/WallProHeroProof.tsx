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
      className="mx-auto mt-4 grid max-w-6xl gap-4 px-4 sm:grid-cols-[minmax(0,1fr)_16rem] sm:items-center"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocusCapture={() => setHeld(true)}
      onBlurCapture={() => setHeld(false)}
    >
      <div
        ref={box}
        className="relative h-44 w-full select-none overflow-hidden rounded-xl border border-slate-200 bg-slate-100 sm:h-64"
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
          className="absolute inset-0 h-full w-full object-cover [object-position:50%_34%]"
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
            className="absolute inset-y-0 left-0 h-full max-w-none object-cover [object-position:50%_34%]"
            style={{ width: box.current?.clientWidth ? `${box.current.clientWidth}px` : '100%' }}
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
      </div>

      <div className="text-sm">
        <p className="font-semibold text-slate-900">{current.headline}</p>
        <p className="mt-1 text-slate-600">{current.caption}</p>

        {usable.length > 1 && (
          <div className="mt-3 flex gap-1.5" role="group" aria-label="Choose an example">
            {usable.map((proof, i) => {
              const active = i === index % usable.length;
              return (
                <button
                  key={proof.after}
                  type="button"
                  aria-label={`Example ${i + 1} of ${usable.length}`}
                  aria-current={active}
                  onClick={() => { setIndex(i); setReveal(OPENING_REVEAL); }}
                  className={`h-1.5 rounded-full transition-all ${active ? 'w-6 bg-blue-600' : 'w-2.5 bg-slate-300 hover:bg-slate-400'}`}
                />
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
