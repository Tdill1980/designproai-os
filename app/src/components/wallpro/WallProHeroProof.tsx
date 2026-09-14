/**
 * The narrow proof band — what this tool does, before you have done anything.
 *
 * Owner, 2026-09-14: "Show before and after example in narrow hero banner."
 *
 * WallPro opens on an empty preview pane that says "See the design on your
 * wall". That is the correct empty state and it is also a promise with nothing
 * behind it: a first-time visitor has to imagine the result. One real room,
 * bare wall to finished wrap, answers it in the time it takes to look.
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
 * SHOWS NOTHING WHEN NOT CONFIGURED. A brand with no example renders null, so
 * the band can never appear as two broken image frames.
 */
import { useCallback, useRef, useState } from 'react';
import { MoveHorizontal } from 'lucide-react';
import { clampReveal, compareAriaLabel, COMPARE_STEP, revealFromPointer } from '@/lib/wallpro-compare';
import type { WallProof } from '@/lib/wallpro-brand';

export function WallProHeroProof({ proof }: { proof: WallProof | null }) {
  const [reveal, setReveal] = useState(52);
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);

  const track = useCallback((clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (rect) setReveal(revealFromPointer(clientX, rect));
  }, []);

  if (!proof || failed) return null;

  return (
    <section
      aria-label="Example wall wrap, before and after"
      className="mx-auto mt-4 grid max-w-6xl gap-4 px-4 sm:grid-cols-[minmax(0,1fr)_16rem] sm:items-center"
    >
      <div
        ref={box}
        className="relative h-36 w-full select-none overflow-hidden rounded-xl border border-slate-200 bg-slate-100 sm:h-44"
        onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); track(e.clientX); }}
        onPointerMove={e => { if (e.buttons === 1) track(e.clientX); }}
      >
        {/* AFTER sits underneath, full width; BEFORE is clipped over it, so the
            handle wipes the finished wall in rather than out. */}
        <img
          src={proof.after}
          alt={proof.alt}
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
          draggable={false}
        />
        <div className="absolute inset-0 overflow-hidden" style={{ width: `${reveal}%` }}>
          <img
            src={proof.before}
            alt=""
            aria-hidden="true"
            onError={() => setFailed(true)}
            /* Width is pinned to the BAND, not to this clipped box, so the two
               photographs stay in register as the handle moves. */
            className="absolute inset-y-0 left-0 h-full max-w-none object-cover"
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
        <p className="font-semibold text-slate-900">{proof.headline}</p>
        <p className="mt-1 text-slate-600">{proof.caption}</p>
      </div>
    </section>
  );
}
