/**
 * ONE WALL, END TO END — the case study behind the tool.
 *
 * Owner, 2026-09-15: "We can have a info page that does the interior spa wall
 * wrap as a case study and show each step glasmorphium mask etc."
 *
 * The tool answers "can I do this?". It cannot answer "what actually happens
 * after I press the button?", and on a page taking money for print files that
 * is the question standing between a visitor and a purchase. So: one real
 * room, six steps, bare wall to installed vinyl.
 *
 * ── THE ONE ARCHITECTURAL DECISION ─────────────────────────────────────────
 *
 * THE DIAGRAMS ARE COMPUTED, NOT SCREENSHOTTED.
 *
 * The obvious build is six screenshots of the tool. That page is wrong the
 * first time anyone changes a default, and wrong silently: nobody re-shoots a
 * marketing page because the roll width moved. This repository has already
 * paid that bill twice -- the print card that said 51" while everything else
 * said 53", and the quote that multiplied a square-foot rate by linear feet.
 *
 * So every number and every diagram below is produced by the SAME functions
 * the tool runs: planWallPrint draws the panel plan, wallBilling prices it,
 * autoWallScale decides the repeat, WALLPRO_PRINT_WIDTH states the press. Move
 * the roll width and this page redraws itself. It cannot lie about the product
 * because it is running the product.
 *
 * The photographs are the only fixed assets, and they are the only things that
 * genuinely cannot be recomputed.
 *
 * ── THE WALL ───────────────────────────────────────────────────────────────
 *
 * 142" x 96" is MEASURED, not invented: it is the owner's own room, the one
 * the wall-scale rule in CLAUDE.md derives its baseline from ("against a
 * 74-inch sofa and a 26-inch shelf the anthurium blooms print about 10 inches
 * ... on a 142-inch wall"). Using a made-up wall here would put fictional
 * numbers on a page whose whole job is to be checkable.
 *
 * ── GLASS ──────────────────────────────────────────────────────────────────
 *
 * The glass treatment is not decoration, it is the mask: step two has to show
 * a region SELECTED on a photograph, and a translucent blurred pane with a lit
 * edge is what selection looks like when the thing underneath must stay
 * readable. Every other glass element on the page is the same object -- a
 * caption chip over a photograph -- for the same reason.
 */
import { Link } from 'react-router-dom';
import { ArrowRight, Check, Ruler, Frame, Sparkles, Scaling, Printer, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { wallBrand, WALL_GRADIENT } from '@/lib/wallpro-brand';
import { WallProLockup, WallProHeaderRule } from '@/components/wallpro/WallProLockup';
import { WALLPRO_PRINT_WIDTH } from '@/lib/wallpro-geometry';
import { DEFAULT_WALL_PRINT, planWallPrint, wallBilling } from '@/lib/wallpro-print-plan';
import { autoWallScale } from '@/lib/wallpro-scale';
import { WPW_PRINTED_FILMS, money } from '@/lib/wpw-printed-films';

/** The room. Measured, not invented — see the header. */
const WALL = { widthIn: 142, heightIn: 96 };
const BRIEF = 'dark tropical anthurium and bird of paradise, moody, wall to wall';
/** The roll WePrintWraps bills at, per the Avery HP MPI 2610 spec sheet. */
const ROLL_IN = 54;

/** The mask quad, as fractions of the photograph — the back wall in that shot. */
const MASK = [
  { x: 0.155, y: 0.045 }, { x: 0.862, y: 0.028 },
  { x: 0.879, y: 0.868 }, { x: 0.138, y: 0.885 },
];
const maskPolygon = MASK.map(p => `${(p.x * 100).toFixed(2)}% ${(p.y * 100).toFixed(2)}%`).join(', ');

/** A caption chip over a photograph: blurred pane, lit edge, readable ground. */
const glass = 'rounded-xl border border-white/25 bg-white/10 backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]';

function Figure({ children, caption }: { children: React.ReactNode; caption?: React.ReactNode }) {
  return (
    <figure className="relative overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl shadow-slate-950/40">
      {children}
      {caption && <figcaption className={`absolute bottom-3 left-3 right-3 ${glass} px-3 py-2 text-xs text-white`}>{caption}</figcaption>}
    </figure>
  );
}

function Step({ n, icon: Icon, title, lead, children, figure }: {
  n: number; icon: typeof Ruler; title: string; lead: string;
  children?: React.ReactNode; figure: React.ReactNode;
}) {
  return (
    <section className="grid items-center gap-6 lg:grid-cols-2" aria-label={`Step ${n}: ${title}`}>
      {/* The figure leads on even steps so the page alternates rather than
          running six identical rows, which reads as a spec sheet. */}
      <div className={n % 2 === 0 ? 'lg:order-2' : ''}>
        <div className="flex items-center gap-2.5">
          <span className={`flex h-8 w-8 items-center justify-center rounded-full ${WALL_GRADIENT} text-sm font-bold text-white`}>{n}</span>
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-300">
            <Icon className="h-3.5 w-3.5" />Step {n}
          </span>
        </div>
        <h2 className="mt-3 text-2xl font-bold tracking-tight text-white md:text-3xl">{title}</h2>
        <p className="mt-3 max-w-[46ch] text-sm leading-relaxed text-slate-300">{lead}</p>
        {children}
      </div>
      <div className={n % 2 === 0 ? 'lg:order-1' : ''}>{figure}</div>
    </section>
  );
}

/** A fact the page computed, shown with the function that produced it. */
function Fact({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-3">
      <dt className="text-[11px] uppercase tracking-wider text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-lg font-bold tabular-nums text-white">{value}</dd>
      {note && <p className="mt-0.5 text-[11px] text-slate-400">{note}</p>}
    </div>
  );
}

export default function WallProCaseStudy() {
  const theme = wallBrand('weprintwraps');

  // EVERY number below is the tool's own answer, computed now.
  const settings = DEFAULT_WALL_PRINT;
  const plan = planWallPrint(WALL.widthIn, WALL.heightIn, settings);
  const billing = wallBilling(WALL.widthIn, WALL.heightIn, settings, ROLL_IN);
  const scale = autoWallScale({ intent: 'match', prompt: BRIEF, wallWidthIn: WALL.widthIn });
  const film = WPW_PRINTED_FILMS.find(f => f.unit === 'sqft' && typeof f.price === 'number');
  const filmTotal = film && billing && typeof film.price === 'number'
    ? Math.round(billing.billedSqFt * film.price * 100)
    : null;

  // The plan drawn to scale, in the plan's own inches.
  const view = plan.bounds;

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="sticky top-0 z-30 bg-black px-4 py-3 md:px-8 md:py-4">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <WallProLockup theme={theme} compact />
          <Button asChild size="sm" className={`${WALL_GRADIENT} text-white md:h-10 md:px-4`}>
            <Link to="/wall-wrap">Design your wall<ArrowRight className="ml-2 h-4 w-4" /></Link>
          </Button>
        </div>
        <WallProHeaderRule />
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-20 md:px-8">
        <section className="grid items-center gap-8 py-10 lg:grid-cols-2 md:py-14">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-300">Case study · Interior feature wall</p>
            <h1 className="mt-3 text-4xl font-extrabold leading-[1.05] tracking-tight md:text-5xl">
              One wall,<br />bare to installed.
            </h1>
            <p className="mt-4 max-w-[48ch] text-base leading-relaxed text-slate-300">
              A {WALL.widthIn}″ × {WALL.heightIn}″ studio wall, designed in WallPro and printed
              by WePrintWraps. Every measurement, panel and price on this page is
              computed live by the same code the tool runs — so what you read here
              is what you will get, not a screenshot of what it used to do.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button asChild className={`${WALL_GRADIENT} text-white`}>
                <Link to="/wall-wrap">Start your wall<ArrowRight className="ml-2 h-4 w-4" /></Link>
              </Button>
              <Button asChild variant="outline" className="border-white/25 bg-white/5 text-white hover:bg-white/10 hover:text-white">
                <Link to="/wall-wrap#order-printed-film">I already have artwork</Link>
              </Button>
            </div>
          </div>
          <Figure caption={<><strong className="font-semibold">Finished.</strong> The same wall, wrapped in the design made below.</>}>
            <img src="/wallpro/proof-spa-after.jpg" alt="A home studio with a dark tropical anthurium mural covering the wall either side of the window" className="aspect-[4/3] w-full object-cover" />
          </Figure>
        </section>

        <div className="space-y-16 md:space-y-24">
          <Step
            n={1} icon={Ruler} title="Measure the wall"
            lead="The only thing the design needs to start is the wall's size. Not a photo, not an account — two numbers. Everything downstream is derived from them, so getting them right is the whole job at this stage."
            figure={
              <Figure caption={<><strong className="font-semibold">Before.</strong> {WALL.widthIn}″ wide × {WALL.heightIn}″ high — {billing?.wallSqFt} sq ft of wall.</>}>
                <img src="/wallpro/proof-spa-before.jpg" alt="The same studio before, with plain cream walls either side of the window" className="aspect-[4/3] w-full object-cover" />
              </Figure>
            }
          >
            <dl className="mt-5 grid gap-3 sm:grid-cols-2">
              <Fact label="Wall" value={`${WALL.widthIn}″ × ${WALL.heightIn}″`} />
              <Fact label="Area" value={`${billing?.wallSqFt} sq ft`} note="width × height ÷ 144" />
            </dl>
          </Step>

          <Step
            n={2} icon={Frame} title="Mark the wall on your photo"
            lead="A room photo is optional — it changes nothing about the print files — but it is how you see the design in your own room before paying for it. Four corners tell WallPro where the wall is; the mask is the region it will paint, and everything outside it stays your room."
            figure={
              <Figure caption={<><strong className="font-semibold">The mask.</strong> Four corners, dragged into place. Windows and furniture get marked the same way.</>}>
                <div className="relative">
                  <img src="/wallpro/proof-spa-before.jpg" alt="The bare studio wall with a translucent mask drawn over the wall area" className="aspect-[4/3] w-full object-cover" />
                  {/* THE GLASS MASK. The quad is clipped on the PARENT and the
                      blur lives on the child: put `clip-path` and
                      `backdrop-filter` on one element and the browser filters
                      the whole backdrop before clipping, which blurs the entire
                      photograph — the un-marked room has to stay sharp, because
                      "everything outside the mask stays your room" is the point
                      this figure is making. */}
                  <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ clipPath: `polygon(${maskPolygon})` }}>
                    {/* Light blur, not a defocus: enough to read as a pane laid
                        over the wall, not so much that the room behind it stops
                        being a room. The diagonal sheen is what actually says
                        "glass" — a flat tint alone reads as a colour wash. */}
                    <div className="absolute inset-0 bg-blue-400/20 backdrop-blur-[2px] backdrop-saturate-150" />
                    <div className="absolute inset-0 bg-gradient-to-br from-white/25 via-transparent to-white/10" />
                  </div>
                  <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
                    <polygon points={MASK.map(p => `${p.x * 100},${p.y * 100}`).join(' ')} fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="0.35" vectorEffect="non-scaling-stroke" />
                  </svg>
                  {MASK.map((p, i) => (
                    <span key={i} aria-hidden="true"
                      className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-blue-500 shadow-lg"
                      style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }} />
                  ))}
                </div>
              </Figure>
            }
          >
            <ul className="mt-5 space-y-2 text-sm text-slate-300">
              {['Corners are detected on upload — you only drag the ones that landed wrong.',
                'Windows, drapes and furniture are masked out of the preview, never out of the print.',
                'Print panels stay full rectangles. The installer trims on site.'].map(line => (
                <li key={line} className="flex gap-2.5"><Check className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />{line}</li>
              ))}
            </ul>
          </Step>

          <Step
            n={3} icon={Sparkles} title="Describe it, or upload what you have"
            lead="Two personas run behind the button. A consultant turns your words into a real brief — named colours, arrangement, flow, and how a space like yours is actually designed. A designer then draws it as one continuous piece of art at wall proportions, not a tile fished out of a library."
            figure={
              <Figure caption={<><strong className="font-semibold">The flat master.</strong> A print file first, a picture second.</>}>
                <img src="/wallpro/case-studio-artwork.jpg" alt="The generated artwork: pale anthurium and bird of paradise blooms across deep green tropical foliage on near-black" className="aspect-[4/3] w-full object-cover" />
              </Figure>
            }
          >
            <blockquote className={`mt-5 ${glass} px-4 py-3 text-sm text-slate-100`}>
              <p className="text-[11px] uppercase tracking-wider text-blue-300">The brief, as typed</p>
              <p className="mt-1 italic">“{BRIEF}”</p>
            </blockquote>
          </Step>

          <Step
            n={4} icon={Scaling} title="Scale is decided by code, not guessed"
            lead="This is the step that separates a wall wrap from a desktop wallpaper. A motif that looks right on screen prints three feet across on a real wall. WallPro reads the wall's inches and sets the repeat itself, then hands you a slider to taste."
            figure={
              <Figure>
                <div className="p-6 md:p-8">
                  <p className="text-[11px] uppercase tracking-wider text-blue-300">autoWallScale, run just now</p>
                  <p className="mt-3 text-xl font-semibold leading-snug text-white md:text-2xl">{scale.reason}</p>
                  <dl className="mt-6 grid gap-3 sm:grid-cols-2">
                    <Fact label="Placement" value={scale.placement === 'repeat' ? 'Repeating' : scale.placement === 'cover' ? 'Mural' : 'Fit whole'} />
                    <Fact label="Repeat width" value={`${scale.repeatWidthIn}″`} note={`about ${(WALL.widthIn / scale.repeatWidthIn).toFixed(1)}× across the wall`} />
                  </dl>
                </div>
              </Figure>
            }
          >
            <p className="mt-5 max-w-[46ch] text-sm text-slate-400">
              The baseline is measured, not assumed: photographed against a 74″ sofa,
              this design's blooms print about 10″ — which is where the {scale.repeatWidthIn}″
              repeat comes from.
            </p>
          </Step>

          <Step
            n={5} icon={Printer} title="The print files build themselves"
            lead={`Every panel comes out within the ${WALLPRO_PRINT_WIDTH}″ press width with bleed and overlap already in it, as TIFF for the RIP, PDF at exact printed size, and PNG. You get the whole wall as one file too, for a RIP that would rather tile it itself.`}
            figure={
              <Figure caption={<><strong className="font-semibold">The real plan</strong> for this wall, drawn by planWallPrint — {plan.panels.length} panels, {plan.bounds.width}″ × {plan.bounds.height}″ with bleed.</>}>
                <div className="p-6 pb-16 md:p-8 md:pb-16">
                  <svg viewBox={`${view.x - 2} ${view.y - 2} ${view.width + 4} ${view.height + 4}`} className="h-auto w-full" role="img"
                    aria-label={`Panel plan: ${plan.panels.length} panels across ${plan.bounds.width} inches`}>
                    {/* The wall itself, inside the bleed. */}
                    <rect x={0} y={0} width={WALL.widthIn} height={WALL.heightIn} fill="rgba(59,130,246,0.10)" />
                    {plan.panels.map(panel => (
                      <g key={panel.number}>
                        <rect x={panel.x} y={panel.y} width={panel.width} height={panel.height}
                          fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.55)" strokeWidth={0.4} />
                        {panel.overlapLeft > 0 && (
                          <rect x={panel.x} y={panel.y} width={panel.overlapLeft} height={panel.height} fill="rgba(217,70,239,0.45)" />
                        )}
                        <text x={panel.x + panel.width / 2} y={panel.y + panel.height / 2} textAnchor="middle" dominantBaseline="middle"
                          fill="#ffffff" fontSize={7} fontWeight="700">{panel.number}</text>
                        <text x={panel.x + panel.width / 2} y={panel.y + panel.height / 2 + 7} textAnchor="middle" dominantBaseline="middle"
                          fill="rgba(255,255,255,0.65)" fontSize={3.4}>{panel.width}″</text>
                      </g>
                    ))}
                    <rect x={view.x} y={view.y} width={view.width} height={view.height}
                      fill="none" stroke="rgba(148,163,184,0.6)" strokeWidth={0.3} strokeDasharray="1.6 1.6" />
                  </svg>
                  <p className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[11px] text-slate-400">
                    <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-blue-500/40" />the wall</span>
                    <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-fuchsia-500/70" />{settings.overlap}″ seam overlap</span>
                    <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm border border-dashed border-slate-400" />{settings.bleed}″ bleed</span>
                  </p>
                </div>
              </Figure>
            }
          >
            <dl className="mt-5 grid gap-3 sm:grid-cols-2">
              <Fact label="Panels" value={String(plan.panels.length)} note={`≤ ${WALLPRO_PRINT_WIDTH}″ each, on a ${ROLL_IN}″ roll`} />
              <Fact label="Source resolution" value={`${settings.minPpi} PPI`} note="enforced before a file is built" />
              {billing && <Fact label="Billed area" value={`${billing.billedSqFt} sq ft`} note={`${billing.panels} panels × ${ROLL_IN}″ × ${billing.panelLengthIn}″`} />}
              {filmTotal != null && film && <Fact label="Printed film" value={money(filmTotal)} note={`${film.name} at $${(film.price as number).toFixed(2)}/sq ft`} />}
            </dl>
            {/* The honest line. A quote that hides the roll-width rounding is a
                quote the invoice contradicts. */}
            {billing && <p className="mt-4 max-w-[46ch] text-xs text-slate-400">
              Panels bill at the full {ROLL_IN}″ roll width whatever they print at, so a{' '}
              {billing.wallSqFt} sq ft wall bills as {billing.billedSqFt} sq ft. That is the
              press, not a markup — and it is why the number is on this page rather than on the invoice.
            </p>}
          </Step>

          <Step
            n={6} icon={Home} title="Installed"
            lead="The panels hang in order with the overlap duplicated on both sides of every seam, so the pattern meets itself rather than being coaxed into place. Trimming at the ceiling, skirting and window happens on the wall, which is why the artwork prints straight through them."
            figure={
              <Figure caption={<><strong className="font-semibold">After.</strong> Designed in WallPro, printed by WePrintWraps.</>}>
                <img src="/wallpro/proof-spa-after.jpg" alt="The finished studio with the tropical mural installed on both walls either side of the window" className="aspect-[4/3] w-full object-cover" />
              </Figure>
            }
          />
        </div>

        <section className={`mt-20 ${WALL_GRADIENT} rounded-2xl px-6 py-10 text-center shadow-2xl shadow-blue-900/40 md:px-10 md:py-14`}>
          <h2 className="text-3xl font-extrabold tracking-tight md:text-4xl">Your wall, the same way.</h2>
          <p className="mx-auto mt-3 max-w-[46ch] text-sm text-white/85">
            Measure it, design it, and take the print-ready files — whether we print
            them or you do.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg" className="bg-white text-blue-700 hover:bg-white/90">
              <Link to="/wall-wrap">Design your wall<ArrowRight className="ml-2 h-4 w-4" /></Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="border-white/40 bg-white/10 text-white hover:bg-white/20 hover:text-white">
              <Link to="/wall-wrap#order-printed-film">Order printed film</Link>
            </Button>
          </div>
        </section>
      </main>
    </div>
  );
}
