import type { ReactNode } from 'react';
import { CornerDownRight, Eye, FileCheck2, MousePointerClick, Upload, Wand2 } from 'lucide-react';
import { WALL_GRADIENT } from '@/lib/wallpro-brand';

const before = '/wallpro/proof-spa-before.jpg';
const after = '/wallpro/proof-spa-after.jpg';

function Frame({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="relative overflow-hidden border wall-edge bg-[hsl(var(--wall-field))]">
      {children}
      <span className="absolute left-2 top-2 bg-slate-950/88 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-white">{label}</span>
    </div>
  );
}

function Room({ src, alt }: { src: string; alt: string }) {
  return <img src={src} alt={alt} className="block h-auto w-full" draggable={false} />;
}

function Step({ n, title, copy, children }: { n: number; title: string; copy: string; children: ReactNode }) {
  return (
    <article className={"bg-[hsl(var(--wall-card))] " + (n <= 3 ? "md:col-span-2" : "md:col-span-3")}>
      <div className="flex min-h-[76px] items-start gap-3 border-b wall-edge px-4 py-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center border border-[hsl(var(--wall-card-edge))] bg-[hsl(var(--wall-field))] text-xs font-black wall-ink">{n}</span>
        <div><h3 className="text-sm font-bold wall-ink">{title}</h3><p className="mt-0.5 text-[11px] wall-muted">{copy}</p></div>
      </div>
      <div className="p-3">{children}</div>
    </article>
  );
}

export function WallProMagic() {
  return (
    <section aria-labelledby="wallpro-magic-heading" className="mx-auto max-w-7xl border-y wall-edge py-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] wall-muted">The WallPro magic</p>
          <h2 id="wallpro-magic-heading" className="mt-1 text-xl font-extrabold tracking-tight wall-ink sm:text-2xl">See the wall. Touch it. Protect it. Print it.</h2>
        </div>
        <p className="text-xs font-semibold wall-muted">The room stays visible through every step.</p>
      </div>

      <div className="grid grid-cols-1 gap-px border wall-edge bg-[hsl(var(--wall-card-edge))] md:grid-cols-6">
        <Step n={1} title="Upload your photo" copy="See the entire room — never a cropped thumbnail.">
          <Frame label="Your room"><Room src={before} alt="Full room before a wall wrap is designed" /></Frame>
        </Step>

        <Step n={2} title="Touch 4 corners" copy="Four touches define the exact wall geometry.">
          <Frame label="Corner geometry">
            <Room src={before} alt="Full room photo with the wall boundary marked" />
            <div className="pointer-events-none absolute left-[18%] right-[18%] top-[9%] bottom-[14%] border-2 border-dashed border-violet-300/90 bg-violet-400/5">
              {['-left-2 -top-2','-right-2 -top-2','-left-2 -bottom-2','-right-2 -bottom-2'].map((c,i)=><span key={i} className={'absolute h-4 w-4 rounded-full border-2 border-white bg-violet-500 shadow '+c} />)}
            </div>
            <span className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-violet-500 px-2.5 py-1 text-[10px] font-bold text-white shadow"><CornerDownRight className="mr-1 inline h-3 w-3" />4 corners mapped</span>
          </Frame>
        </Step>

        <Step n={3} title="1-touch masking" copy="Tap curtains, windows or objects once to protect them.">
          <Frame label="Protected">
            <Room src={before} alt="Full room showing curtains protected by one-touch masking" />
            <div className="absolute left-[29%] top-[8%] h-[54%] w-[17%] border-2 border-violet-200/90 bg-violet-300/20 shadow-[0_0_0_1px_rgba(255,255,255,.7)]" />
            <div className="absolute right-[29%] top-[8%] h-[54%] w-[17%] border-2 border-violet-200/90 bg-violet-300/20 shadow-[0_0_0_1px_rgba(255,255,255,.7)]" />
            <div className="absolute left-[45%] top-[16%] h-[45%] w-[10%] border-2 border-violet-200/90 bg-violet-300/15" />
            <span className="absolute left-[28%] top-[30%] bg-slate-900/90 px-2 py-1 text-[9px] font-bold text-white shadow">Protected curtain</span>
            <span className="absolute right-[27%] top-[46%] bg-slate-900/90 px-2 py-1 text-[9px] font-bold text-white shadow">Protected curtain</span>
            <span className="absolute left-1/2 top-[12%] -translate-x-1/2 bg-white px-2 py-1 text-[9px] font-bold text-slate-900 shadow"><MousePointerClick className="mr-1 inline h-3 w-3 text-violet-500" />one touch</span>
          </Frame>
        </Step>

        <Step n={4} title="Preview on your wall" copy="Your design lands inside the geometry you marked.">
          <Frame label="On your wall">
            <Room src={after} alt="The full room with the exotic floral wall design installed" />
            <span className="absolute bottom-2 right-2 bg-slate-900/90 px-2 py-1 text-[9px] font-bold text-white shadow"><Eye className="mr-1 inline h-3 w-3" />exact placement</span>
          </Frame>
        </Step>

        <Step n={5} title="Print-ready panels" copy="Panelized at press width with ½″ perimeter bleed.">
          <Frame label="Production">
            <Room src={after} alt="Full exotic floral wall design divided into three print panels" />
            <div className="absolute inset-y-0 left-1/3 border-l-2 border-dashed border-white/90" />
            <div className="absolute inset-y-0 left-2/3 border-l-2 border-dashed border-white/90" />
            <div className="absolute inset-x-0 top-2 flex justify-around px-4">{[1,2,3].map(n=><span key={n} className="flex h-6 w-6 items-center justify-center bg-white text-[10px] font-black text-slate-900 shadow">{n}</span>)}</div>
            <span className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-slate-900/90 px-2 py-1 text-[9px] font-bold text-white shadow"><FileCheck2 className="mr-1 inline h-3 w-3" />3 panels · ½″ bleed</span>
          </Frame>
        </Step>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border wall-edge bg-[hsl(var(--wall-card))] px-4 py-3">
        <div className="flex items-center gap-3">
          <span className={"flex h-10 w-10 items-center justify-center text-white " + WALL_GRADIENT}><Wand2 className="h-5 w-5" /></span>
          <div><p className="text-sm font-bold wall-ink">Ready to try it on your wall?</p><p className="text-xs wall-muted">Enter dimensions, upload the photo, then touch the wall and protect what stays.</p></div>
        </div>
        <a href="#upload-wall" className={"inline-flex items-center px-4 py-2 text-sm font-bold text-white " + WALL_GRADIENT}><Upload className="mr-2 h-4 w-4" />Start your wall wrap</a>
      </div>
    </section>
  );
}
