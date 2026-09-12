/**
 * Drag-to-reveal before and after, plus the shareable export.
 *
 * Owner, 2026-09-12: "before and after ... a side by side on desktop and slider
 * on mobile?" — one slider does both, for the reasons in wallpro-compare.ts.
 *
 * The "after" handed in here must be the DETERMINISTIC composite. A before and
 * after is the most persuasive thing WallPro makes and the most likely to be
 * screenshotted and sent to someone; built from the AI view it would spread the
 * exact problem that view was just taken off the customer path for.
 */
import { useCallback, useRef, useState } from 'react';
import { Download, MoveHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { clampReveal, compareAriaLabel, compareExportSize, COMPARE_STEP, revealFromPointer } from '@/lib/wallpro-compare';

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The picture could not be opened for export.'));
    image.src = url;
  });
}

export function BeforeAfter({ before, after, alt, name }: { before: string; after: string; alt: string; name: string }) {
  const [reveal, setReveal] = useState(50);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const box = useRef<HTMLDivElement | null>(null);

  const track = useCallback((clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (rect) setReveal(revealFromPointer(clientX, rect));
  }, []);

  /**
   * One PNG of the two side by side, labelled, for the customer to send on and
   * for WPW to post. This is the asset; the slider is how it is chosen.
   */
  const exportPair = async () => {
    setExporting(true); setError('');
    try {
      const [b, a] = await Promise.all([loadImage(before), loadImage(after)]);
      const size = compareExportSize(
        { width: b.naturalWidth, height: b.naturalHeight },
        { width: a.naturalWidth, height: a.naturalHeight },
      );
      if (!size) throw new Error('The pictures are not ready yet.');
      const canvas = document.createElement('canvas');
      canvas.width = size.width; canvas.height = size.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('This browser cannot build the image.');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(b, 0, 0, size.paneWidth, size.height);
      ctx.drawImage(a, size.paneWidth + size.divider, 0, size.paneWidth, size.height);
      // Labels sized off the picture, so they read the same on a phone photo
      // and on a 4K composite.
      const pad = Math.round(size.height * 0.025);
      const fontPx = Math.max(14, Math.round(size.height * 0.045));
      ctx.font = `700 ${fontPx}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
      ctx.textBaseline = 'top';
      for (const [label, x] of [['BEFORE', pad], ['AFTER', size.paneWidth + size.divider + pad]] as const) {
        const metrics = ctx.measureText(label);
        ctx.fillStyle = 'rgba(15,23,42,0.72)';
        ctx.fillRect(x, pad, metrics.width + pad * 1.5, fontPx + pad);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(label, x + pad * 0.75, pad + pad * 0.5);
      }
      const url = canvas.toDataURL('image/jpeg', 0.92);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'wall'}-before-after.jpg`;
      document.body.appendChild(link); link.click(); link.remove();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The before and after could not be saved.');
    } finally { setExporting(false); }
  };

  return <div className="space-y-2">
    <div
      ref={box}
      className="relative select-none overflow-hidden rounded-xl bg-slate-100"
      style={{ touchAction: 'none' }}
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); track(e.clientX); }}
      onPointerMove={e => { if (e.buttons === 1 || e.pointerType === 'touch') track(e.clientX); }}
    >
      {/* AFTER is the base layer, BEFORE is clipped over it, so dragging left
          wipes the original away and reveals the design. */}
      <img src={after} alt={alt} className="block w-full object-contain" draggable={false} />
      <div className="absolute inset-0 overflow-hidden" style={{ width: `${reveal}%` }}>
        {/* Width is pinned to the BOX, not to this clipped wrapper, so the two
            photographs stay in register as the handle moves. */}
        <img src={before} alt="Your original wall" className="block h-full max-w-none object-contain"
          style={{ width: box.current?.clientWidth ? `${box.current.clientWidth}px` : '100%' }} draggable={false} />
      </div>

      <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-slate-900/70 px-2.5 py-1 text-xs font-bold text-white">BEFORE</span>
      <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-violet-600/85 px-2.5 py-1 text-xs font-bold text-white">AFTER</span>

      {/* The handle. A real slider input would be simpler, but it cannot be
          dragged from anywhere on the picture, which is the gesture people
          reach for. Keyboard support is kept explicitly instead. */}
      <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_0_1px_rgba(15,23,42,0.35)]" style={{ left: `${reveal}%` }} />
      <button
        type="button"
        role="slider"
        aria-label={compareAriaLabel(reveal)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(reveal)}
        className="absolute top-1/2 grid h-10 w-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white bg-slate-900/80 text-white shadow-lg"
        style={{ left: `${reveal}%` }}
        onKeyDown={e => {
          if (e.key === 'ArrowLeft') { e.preventDefault(); setReveal(r => clampReveal(r - COMPARE_STEP)); }
          if (e.key === 'ArrowRight') { e.preventDefault(); setReveal(r => clampReveal(r + COMPARE_STEP)); }
          if (e.key === 'Home') { e.preventDefault(); setReveal(0); }
          if (e.key === 'End') { e.preventDefault(); setReveal(100); }
        }}
      >
        <MoveHorizontal className="h-5 w-5" />
      </button>
    </div>

    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" disabled={exporting} onClick={() => void exportPair()}>
        <Download className="mr-1 h-4 w-4" />{exporting ? 'Building…' : 'Save before & after'}
      </Button>
      <span className="text-xs text-slate-500">Drag the handle. The after is your real print file on your wall, not an impression.</span>
    </div>
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-800">{error}</p>}
  </div>;
}
