import { Check, CornerDownRight, Eye, FileCheck2, MousePointerClick, Upload, Wand2 } from 'lucide-react';
import { WALL_CARD, WALL_GRADIENT } from '@/lib/wallpro-brand';

const before = '/wallpro/proof-spa-before.jpg';
const after = '/wallpro/proof-spa-after.jpg';

function Frame({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="relative aspect-[4/3] overflow-hidden rounded-xl border wall-edge bg-slate-950 shadow-sm">
      {children}
      <span className="absolute left-2 top-2 rounded-full bg-slate-950/80 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-white backdrop-blur">{label}</span>
    </div>
  );
}

function Room({ src, alt }: { src: string; alt: string }) {
  return <img src={src} alt={alt} className="h-full w-full object-cover" draggable={false} />;
}

export function WallProMagic() {
  return (
    <section aria-labelledby="wallpro-magic-heading" className="mx-auto max-w-7xl">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-blue-500">The WallPro magic</p>
          <h2 id="wallpro-magic-heading" className="mt-1 text-xl font-extrabold tracking-tight wall-ink sm:text-2xl">From one room photo to print-ready wall panels.</h2>
        </div>
        <p className="text-xs font-semibold wall-muted">Touch the wall. Protect what stays. See it installed. Print it.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <article className={WALL_CARD + ' p-3'}>
          <div className="mb-2 flex items-start gap-2"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-black text-white">1</span><div><h3 className="text-sm font-bold wall-ink">Upload your photo</h3><p className="text-[11px] wall-muted">Start with the room you actually want to wrap.</p></div></div>
          <Frame label="Your room"><Room src={before} alt="Room before a wall wrap is designed" /></Frame>
        </article>

        <article className={WALL_CARD + ' p-3'}>
          <div className="mb-2 flex items-start gap-2"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-black text-white">2</span><div><h3 className="text-sm font-bold wall-ink">Touch 4 corners</h3><p className="text-[11px] wall-muted">Four touches define the exact wall geometry.</p></div></div>
          <Frame label="Corner geometry">
            <Room src={before} alt="Room photo with the wall boundary marked" />
            <div className="pointer-events-none absolute left-[18%] right-[18%] top-[9%] bottom-[14%] border-2 border-dashed border-blue-400 bg-blue-500/5">
              {['-left-2 -top-2','-right-2 -top-2','-left-2 -bottom-2','-right-2 -bottom-2'].map((c,i)=><span key={i} className={'absolute h-4 w-4 rounded-full border-2 border-white bg-blue-600 shadow '+c} />)}
            </div>
            <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-blue-600 px-2.5 py-1 text-[10px] font-bold text-white shadow"><CornerDownRight className="mr-1 inline h-3 w-3" />4 corners mapped</span>
          </Frame>
        </article>

        <article className={WALL_CARD + ' p-3'}>
          <div className="mb-2 flex items-start gap-2"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-black text-white">3</span><div><h3 className="text-sm font-bold wall-ink">1-touch masking</h3><p className="text-[11px] wall-muted">Tap curtains, windows or objects once to protect them.</p></div></div>
          <Frame label="Protected">
            <Room src={before} alt="Room photo showing curtains protected by one-touch masking" />
            <div className="absolute left-[29%] top-[8%] h-[54%] w-[17%] rounded border-2 border-cyan-300 bg-cyan-400/25 shadow-[0_0_0_1px_rgba(255,255,255,.7)]" />
            <div className="absolute right-[29%] top-[8%] h-[54%] w-[17%] rounded border-2 border-cyan-300 bg-cyan-400/25 shadow-[0_0_0_1px_rgba(255,255,255,.7)]" />
            <div className="absolute left-[45%] top-[16%] h-[45%] w-[10%] rounded border-2 border-cyan-300 bg-cyan-400/20" />
            <span className="absolute left-[28%] top-[30%] rounded bg-cyan-500 px-2 py-1 text-[9px] font-bold text-white shadow">Protected curtain</span>
            <span className="absolute right-[27%] top-[46%] rounded bg-cyan-500 px-2 py-1 text-[9px] font-bold text-white shadow">Protected curtain</span>
            <span className="absolute left-1/2 top-[12%] -translate-x-1/2 rounded-full bg-white/95 px-2 py-1 text-[9px] font-bold text-slate-900 shadow"><MousePointerClick className="mr-1 inline h-3 w-3 text-blue-600" />one touch</span>
          </Frame>
        </article>

        <article className={WALL_CARD + ' p-3'}>
          <div className="mb-2 flex items-start gap-2"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-black text-white">4</span><div><h3 className="text-sm font-bold wall-ink">Preview on your wall</h3><p className="text-[11px] wall-muted">The design is imposed into the geometry you marked.</p></div></div>
          <Frame label="On your wall">
            <Room src={after} alt="The same room with the exotic floral wall design installed" />
            <span className="absolute bottom-2 right-2 rounded-full bg-emerald-500 px-2 py-1 text-[9px] font-bold text-white shadow"><Eye className="mr-1 inline h-3 w-3" />exact placement</span>
          </Frame>
        </article>

        <article className={WALL_CARD + ' p-3'}>
          <div className="mb-2 flex items-start gap-2"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-black text-white">5</span><div><h3 className="text-sm font-bold wall-ink">Print-ready panels</h3><p className="text-[11px] wall-muted">Panelized at the press width with ½″ perimeter bleed.</p></div></div>
          <Frame label="Production">
            <Room src={after} alt="Exotic floral wall design divided into three print panels" />
            <div className="absolute inset-y-0 left-1/3 border-l-2 border-dashed border-white/90" />
            <div className="absolute inset-y-0 left-2/3 border-l-2 border-dashed border-white/90" />
            <div className="absolute inset-x-0 top-2 flex justify-around px-4">{[1,2,3].map(n=><span key={n} className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-[10px] font-black text-slate-900 shadow">{n}</span>)}</div>
            <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-emerald-500 px-2 py-1 text-[9px] font-bold text-white shadow"><FileCheck2 className="mr-1 inline h-3 w-3" />3 panels · ½″ bleed</span>
          </Frame>
        </article>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border wall-edge bg-[hsl(var(--wall-field))] px-4 py-3">
        <div className="flex items-center gap-3">
          <span className={"flex h-10 w-10 items-center justify-center rounded-xl text-white " + WALL_GRADIENT}><Wand2 className="h-5 w-5" /></span>
          <div><p className="text-sm font-bold wall-ink">Ready to try it on your wall?</p><p className="text-xs wall-muted">Start with dimensions and a photo. The geometry and masking happen on the same workspace.</p></div>
        </div>
        <a href="#upload-wall" className={"inline-flex items-center rounded-lg px-4 py-2 text-sm font-bold text-white " + WALL_GRADIENT}><Upload className="mr-2 h-4 w-4" />Start your wall wrap</a>
      </div>
    </section>
  );
}
