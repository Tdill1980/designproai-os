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
   flat artwork itself split into the three production panels required for the
   120-inch example wall. Each panel may use up to 53.5 inches of print width;
   the third panel is the remainder. A glassmorphism proof layer sits over the
   artwork so the customer can read the panel plan without hiding the design. */
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
        <Step n={4} title="Print-Ready Panels" copy="120″ wall · 3 production panels · up to 53.5″ each.">
          <Frame>
            <Room src={artwork} alt="The flat floral wall artwork divided into three production panels for a 120 inch wall" />
            <div className="absolute inset-0 flex">
              {[53.5, 53.5, 13].map((panelWidth, index) => (
                <div
                  key={index}
                  className={'relative h-full border-white/85 ' + (index > 0 ? 'border-l-2 border-dashed' : '')}
                  style={{ width: `${(panelWidth / 120) * 100}%` }}
                >
                  <div className="absolute inset-x-1 top-2 border border-white/45 bg-slate-950/28 px-1.5 py-1 text-center text-white shadow-lg backdrop-blur-md">
                    <span className="block text-[9px] font-black tracking-wide">PANEL {index + 1}</span>
                    <span className="block text-[8px] font-semibold text-white/90">{panelWidth}″ wide</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="absolute inset-x-2 bottom-2 flex items-center justify-between border border-white/35 bg-white/14 px-2 py-1.5 text-[8px] font-semibold text-white shadow-xl backdrop-blur-md">
              <span>120″ WALL</span>
              <span>53.5″ MAX PANEL WIDTH</span>
              <span>3 PANELS</span>
            </div>
          </Frame>
        </Step>
      </div>
    </section>
  );
}
