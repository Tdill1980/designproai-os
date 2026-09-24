import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';

const before = '/wallpro/studio-original.jpg';
const after = '/wallpro/studio-floral-preview.jpg';

const artwork = '/wallpro/case-studio-artwork.jpg';

function Frame({ children }: { children: ReactNode }) {
  return <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-[hsl(var(--wall-field))]">{children}</div>;
}

function Room({ src, alt }: { src: string; alt: string }) {
  return <img src={src} alt={alt} className="absolute inset-0 h-full w-full object-cover" draggable={false} />;
}

function Step({ n, title, copy, children }: { n: number; title: string; copy: string; children: ReactNode }) {
  return (
    <article className="flex min-w-0 flex-col rounded-xl border wall-edge bg-[hsl(var(--wall-card))] p-3 shadow-sm">
      <div className="mb-3 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-lg font-extrabold text-blue-600 ring-1 ring-blue-100">{n}</span>
        <div className="min-w-0"><h3 className="text-sm font-bold leading-tight wall-ink">{title}</h3><p className="mt-0.5 text-[11px] leading-snug wall-muted">{copy}</p></div>
      </div>
      {children}
    </article>
  );
}

/* ONE ROW, FOUR STEPS, ARROWS BETWEEN -- upload and corner-marking are
   ONE step (owner, 2026-09-24: "condense step 1 ... upload and mark wall"). (owner, Trish 2026-09-24, against a
   Earlier the same day: "Fix my Wallpro ui so it looks like this exactly". Step 4 shows the
   flat artwork itself cut into six numbered roll-width panels -- the print
   file, not the room -- because that is what the customer is buying. */
const Arrow = () => (
  <span aria-hidden="true" className="hidden items-center justify-center text-blue-500 lg:flex"><ArrowRight className="h-5 w-5" /></span>
);

export function WallProMagic() {
  return (
    <section aria-labelledby="wallpro-magic-heading" className="mx-auto max-w-7xl">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <h2 id="wallpro-magic-heading" className="text-xl font-extrabold tracking-tight wall-ink sm:text-2xl">The WallPro Magic — From Photo to Print-Ready Panels</h2>
        <p className="text-sm wall-muted">4 simple steps. Extraordinary results.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] lg:gap-2">
        <Step n={1} title="Upload & Mark Wall" copy="Upload a photo, then touch its 4 corners.">
          <Frame>
            <Room src={before} alt="The room photo with the wall boundary marked by four corners" />
            <div className="pointer-events-none absolute left-[16%] right-[16%] top-[8%] bottom-[12%] border-2 border-blue-500 bg-blue-500/10">
              {['-left-2 -top-2','-right-2 -top-2','-left-2 -bottom-2','-right-2 -bottom-2'].map((c,i)=><span key={i} className={'absolute h-3.5 w-3.5 rounded-full border-2 border-white bg-blue-600 shadow '+c} />)}
            </div>
          </Frame>
        </Step>
        <Arrow />
        <Step n={2} title="1-Touch Masking" copy="Automatically protect windows, curtains, and objects.">
          <Frame>
            <Room src={before} alt="The room with curtains and window protected by one-touch masking" />
            <div className="absolute left-[29%] top-[6%] h-[56%] w-[17%] rounded-sm border-2 border-blue-500 bg-blue-500/35" />
            <div className="absolute right-[29%] top-[6%] h-[56%] w-[17%] rounded-sm border-2 border-blue-500 bg-blue-500/35" />
            <div className="absolute left-[45%] top-[14%] h-[46%] w-[10%] rounded-sm border-2 border-blue-500 bg-blue-500/25" />
            <span className="absolute left-[37.5%] top-[12%] -translate-x-1/2 whitespace-nowrap rounded bg-blue-600 px-1 py-0.5 text-[8px] font-bold text-white shadow">Protected 1</span>
            <span className="absolute left-[62.5%] top-[30%] -translate-x-1/2 whitespace-nowrap rounded bg-blue-600 px-1 py-0.5 text-[8px] font-bold text-white shadow">Protected 2</span>
            <span className="absolute left-1/2 top-[50%] -translate-x-1/2 whitespace-nowrap rounded bg-blue-600 px-1 py-0.5 text-[8px] font-bold text-white shadow">Protected 3</span>
          </Frame>
        </Step>
        <Arrow />
        <Step n={3} title="Preview On Your Wall" copy="See your design in your space instantly.">
          <Frame><Room src={after} alt="The room with the tropical floral wall design installed" /></Frame>
        </Step>
        <Arrow />
        <Step n={4} title="Print-Ready Panels" copy="Get production-ready files.">
          <Frame>
            <Room src={artwork} alt="The flat floral wall artwork divided into six numbered print panels" />
            <div className="absolute inset-0 grid grid-cols-6">
              {[1,2,3,4,5,6].map(n => (
                <div key={n} className={'relative ' + (n > 1 ? 'border-l-2 border-dashed border-white/90' : '')}>
                  <span className="absolute left-1/2 top-2 flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full bg-white text-[10px] font-black text-slate-900 shadow">{n}</span>
                </div>
              ))}
            </div>
          </Frame>
        </Step>
      </div>
    </section>
  );
}
