/**
 * WALLPRO — THE QUESTIONS, ANSWERED, WITH THE PRODUCT'S OWN NUMBERS.
 *
 * Owner, 2026-09-16: "I need two wall pros so I can demo one with WPW
 * connection / branding / prices and must include the full wallpanelpro
 * pipeline and faq", and earlier: "I need to also show the geometry on the FAQ
 * page where it shows the glass morphism on the corners."
 *
 * The tool answers "can it do this?". The case study answers "what happens
 * after I press the button?". Neither answers the questions a buyer actually
 * stalls on — what does it cost, why does it take a day, what is that blue
 * shape on my photo, do I have to use your printer. Those are what this page is.
 *
 * ── THE SAME ARCHITECTURAL DECISION THE CASE STUDY MAKES ───────────────────
 *
 * NOTHING HERE IS TYPED TWICE.
 *
 * An FAQ is the single most drift-prone page in a product: it is written once,
 * believed forever, and nobody re-reads it when a price or a roll width moves.
 * So every number below is read from the code that owns it —
 *
 *   WALL_DESIGN_SKUS        the five entry paths and what each costs
 *   WPW_WALL_FILM_RATE      the printed-film rate, and only on the brand that prints
 *   planWallPrint           the panel plan for the worked wall
 *   wallBilling             the press arithmetic behind the film quote
 *   WALLPRO_PRINT_WIDTH     the roll
 *   WALL_TARGET_PPI         the resolution every panel is enhanced to
 *   WALL_VALIDATION_HOURS   the human QC window
 *   wallPanelizerRun        the pipeline rail, stage copy included
 *   WALL_GLASS              the exact colours the photo editor draws with
 *
 * — so this page is wrong only if the product is wrong.
 *
 * ── THE GEOMETRY FIGURE ────────────────────────────────────────────────────
 *
 * It renders WallGlassDefs, the real gradients, over a real room photograph.
 * A customer reading "drag the four corners" needs to know what a corner LOOKS
 * like before they meet one; and a customer whose auto-detected corners landed
 * wrong needs to know that dragging them is expected rather than a failure.
 *
 * The quad and the two protected regions are HAND-PLACED on that photograph and
 * the caption says so. They are an illustration of the controls, not a capture
 * of a detection run — the same honesty the case study's step two states about
 * its own stand-in mask.
 *
 * ── ONE FILE, TWO BRANDS ───────────────────────────────────────────────────
 *
 * Same `brand` prop as WallPro.tsx and WallProCaseStudy.tsx, same table, same
 * flag. Everything about printing hangs off `theme.showPrintOffer`: on
 * DesignProAI the customer buys files and takes them anywhere, on WePrintWraps
 * the film is on the page with its rate. A second file would be two FAQs
 * disagreeing about one product within a month.
 */
import { Link } from 'react-router-dom';
import { ArrowRight, Frame, HelpCircle, Layers, Ruler, ShieldCheck, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { wallBrand, WALL_GRADIENT, type WallBrandKey } from '@/lib/wallpro-brand';
import { WallProLockup, WallProHeaderRule } from '@/components/wallpro/WallProLockup';
import {
  WALL_GLASS, WallGlassDefs, WALL_AREA_FILL, WALL_PROTECTED_FILL, WALL_HALO_FILTER,
} from '@/components/wallpro/wall-glass';
import { WALLPRO_PRINT_WIDTH, type Point } from '@/lib/wallpro-geometry';
import { DEFAULT_WALL_PRINT, planWallPrint, wallBilling } from '@/lib/wallpro-print-plan';
import {
  WALL_DESIGN_SKUS, WPW_WALL_FILM_RATE_PER_SQFT, formatMoney, type WallDesignMode,
} from '@/lib/wallpro-pricing';
import {
  WALL_TARGET_PPI, WALL_VALIDATION_HOURS, wallPanelizerRun,
  type WallStudioVersionRecord,
} from '@/lib/wallpro-panelpro';
import type { WallProductionJob, WallVersion } from '@/lib/wallpro-api';
import { UniversalPanelizerProgress } from '@/components/production/UniversalPanelizerProgress';
import { PATTERN_SCALE_MIN, PATTERN_SCALE_MAX } from '@/lib/wallpro-scale';


/**
 * LIGHT FOR THE PARTNER, DARK FOR DESIGNPROAI (owner, 2026-09-17: "I need those
 * examples of the pinned corners geometry ... in the white UI version for
 * WPW x WallPro").
 *
 * The corner/mask figure is the reason this page exists on the partner's side:
 * a customer about to drag four handles needs to know what a handle looks like.
 * It was readable only on a dark page, so the partner either got a dark page in
 * a light brand or lost the figure. Neither is acceptable, and neither is a
 * second copy of the page.
 *
 * So the surfaces are a table and the brand picks a row. The GLASS ITSELF does
 * not change — it is the editor's own violet and cyan, read from WALL_GLASS —
 * because the whole point of the figure is that it shows the real tool.
 */
const SKIN = {
  designpro: {
    page: 'min-h-screen bg-slate-950 text-white',
    card: 'rounded-2xl border border-white/10 bg-white/[0.04]',
    heading: 'text-white',
    body: 'text-slate-300',
    muted: 'text-slate-400',
    figure: 'relative overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl shadow-slate-950/40',
    figcaption: 'border-t border-white/10 px-4 py-3 text-xs text-slate-400',
    swatchText: 'text-slate-300',
    tableWrap: 'mt-6 overflow-hidden rounded-2xl border border-white/10',
    tableHead: 'bg-white/[0.06] text-[11px] uppercase tracking-wider text-slate-400',
    tableRow: 'bg-white/[0.02]',
    tableDivide: 'divide-y divide-white/10',
    accent: 'text-blue-300',
  },
  weprintwraps: {
    page: 'min-h-screen bg-slate-50 text-slate-900',
    card: 'rounded-2xl border border-slate-200 bg-white shadow-sm',
    heading: 'text-slate-900',
    body: 'text-slate-600',
    muted: 'text-slate-500',
    figure: 'relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10',
    figcaption: 'border-t border-slate-200 px-4 py-3 text-xs text-slate-500',
    swatchText: 'text-slate-600',
    tableWrap: 'mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white',
    tableHead: 'bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500',
    tableRow: 'bg-white',
    tableDivide: 'divide-y divide-slate-200',
    accent: 'text-blue-700',
  },
} as const;

/** The worked wall. The owner's own room — the same one the case study uses, so
 *  the two pages cannot quote different panel counts for one example. */
const WALL = { widthIn: 142, heightIn: 96 };

/* ── The geometry figure's shapes ─────────────────────────────────────────
 * Fractions of proof-spa-before.jpg (1400 × 803), read off the photograph.
 * HAND-PLACED, and the caption says so: this illustrates the controls, it is
 * not a capture of detect-wall-openings. */
const DEMO_WALL: Point[] = [
  { x: 0.168, y: 0.012 }, { x: 0.988, y: 0.022 },
  { x: 0.988, y: 0.948 }, { x: 0.168, y: 0.918 },
];
const DEMO_PROTECTED: { points: Point[]; what: string }[] = [
  { what: 'the window and its drapes', points: [
    { x: 0.300, y: 0.000 }, { x: 0.707, y: 0.000 }, { x: 0.707, y: 0.946 }, { x: 0.300, y: 0.946 }] },
  { what: 'the shelving unit', points: [
    { x: 0.818, y: 0.174 }, { x: 0.993, y: 0.174 }, { x: 0.993, y: 0.984 }, { x: 0.818, y: 0.984 }] },
];
const svgPoints = (points: Point[]) => points.map(p => `${p.x * 100},${p.y * 100}`).join(' ');

/**
 * THE WORKED PIPELINE RUN — built by the product's own stage builder.
 *
 * `wallPanelizerRun` owns what each step is called and what it promises, and
 * that copy is read by a paying customer while they wait. Re-typing it here to
 * "explain the pipeline" would produce two descriptions of one process, and the
 * marketing one always wins the argument and loses the truth.
 *
 * So the FAQ feeds it a released job cut from the SAME plan this page quotes.
 * It is an example, labelled as one — the panel widths, the seam overlap and
 * the resolution are the real ones for this wall, and nothing else is claimed.
 */
const EXAMPLE_AT = '2026-09-16T00:00:00.000Z';

function workedRun(plan: ReturnType<typeof planWallPrint>) {
  const request = {
    wallWidthIn: WALL.widthIn, wallHeightIn: WALL.heightIn,
    bleedIn: DEFAULT_WALL_PRINT.bleed, overlapIn: DEFAULT_WALL_PRINT.overlap,
    panelWidthIn: WALLPRO_PRINT_WIDTH, targetPpi: WALL_TARGET_PPI,
  };
  const job: WallProductionJob = {
    id: 'example', owner_id: 'example', project_id: 'example', version_id: 'example',
    request, request_hash: 'example', status: 'ready', attempts: 1,
    progress: { panelsTotal: plan.panels.length, panelsDone: plan.panels.length },
    panels: plan.panels.map(panel => ({
      number: panel.number, file: `panel-${panel.number}.tif`, path: 'example',
      xIn: panel.x, yIn: panel.y, widthIn: panel.width, heightIn: panel.height,
      overlapLeftIn: panel.overlapLeft,
      widthPx: Math.round(panel.width * WALL_TARGET_PPI),
      heightPx: Math.round(panel.height * WALL_TARGET_PPI),
      ppi: WALL_TARGET_PPI, sha256: 'example', byteSize: 0,
      upscale: { engine: 'topaz' },
    })),
    manifest_path: null, error: null,
    // Fixed timestamps, not `new Date()`: this figure must render identically
    // on every visit, and a released job's copy never reads the clock anyway.
    created_at: EXAMPLE_AT, updated_at: EXAMPLE_AT, finished_at: EXAMPLE_AT,
    released_at: EXAMPLE_AT,
  };
  const version = { id: 'example', status: 'approved' } as unknown as WallVersion;
  const record = {
    version, designId: 'DID-EXAMPLE', generation: null, outcome: 'delivered',
    reviews: [], release: 'released', job, orders: [], artworkUrl: null,
  } as unknown as WallStudioVersionRecord;
  return wallPanelizerRun(record, 'Your wall', 0);
}

/** One question and its answer. Always open — a buyer should not have to click
 *  to find out what something costs, and a demo should not have to either. */
function Qa({ q, children, skin }: { q: string; children: React.ReactNode; skin: typeof SKIN['designpro'] }) {
  return (
    <div className={`${skin.card} p-5`}>
      <h3 className={`flex gap-2.5 text-[15px] font-semibold ${skin.heading}`}>
        <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />{q}
      </h3>
      <div className={`mt-2 space-y-2 pl-[26px] text-sm leading-relaxed ${skin.body}`}>{children}</div>
    </div>
  );
}

function Group({ icon: Icon, title, children, skin }: {
  icon: typeof Ruler; title: string; children: React.ReactNode; skin: typeof SKIN['designpro'];
}) {
  return (
    <section className="mt-14">
      <h2 className={`flex items-center gap-2.5 text-xl font-bold tracking-tight ${skin.heading}`}>
        <span className={`flex h-8 w-8 items-center justify-center rounded-full ${WALL_GRADIENT}`}>
          <Icon className="h-4 w-4 text-white" />
        </span>
        {title}
      </h2>
      <div className="mt-5 grid gap-4 lg:grid-cols-2">{children}</div>
    </section>
  );
}

/** A swatch beside its meaning, in the editor's own colour. */
function Swatch({ fill, stroke, label, note, skin }: {
  fill: string; stroke: string; label: string; note: string; skin: typeof SKIN['designpro'];
}) {
  return (
    <li className="flex gap-3">
      <span aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 rounded-md"
        style={{ background: fill, border: `1.5px solid ${stroke}` }} />
      <span className={`text-sm ${skin.swatchText}`}>
        <strong className={`font-semibold ${skin.heading}`}>{label}</strong> — {note}
      </span>
    </li>
  );
}

const MODE_ORDER: WallDesignMode[] = ['library', 'upload', 'ai', 'match', 'wall'];

export default function WallProFaq({ brand = 'designpro' }: { brand?: WallBrandKey } = {}) {
  const theme = wallBrand(brand);
  // /wall-wrap is the partner's LANDING; their tool is /wallwrap-design.
  const skin = SKIN[brand];
  const toolHref = brand === 'weprintwraps' ? '/wallwrap-design' : '/printpro/wallpro';
  const caseHref = brand === 'weprintwraps' ? '/wall-wrap/how-it-works' : '/printpro/wallpro/how-it-works';

  // Every number on this page, computed now, by the tool's own code.
  const settings = DEFAULT_WALL_PRINT;
  const plan = planWallPrint(WALL.widthIn, WALL.heightIn, settings);
  const billing = wallBilling(WALL.widthIn, WALL.heightIn, settings, WALLPRO_PRINT_WIDTH);
  const run = workedRun(plan);
  const filmCents = billing ? Math.round(billing.wallSqFt * WPW_WALL_FILM_RATE_PER_SQFT * 100) : null;

  return (
    <div className={skin.page}>
      <header className="sticky top-0 z-30 bg-black px-4 py-3 md:px-8 md:py-4">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <WallProLockup theme={theme} compact />
          <div className="flex items-center gap-2">
            <Button asChild size="sm" variant="outline"
              className="border-white/25 bg-white/5 text-white hover:bg-white/10 hover:text-white">
              <Link to={caseHref}>How it works</Link>
            </Button>
            <Button asChild size="sm" className={`${WALL_GRADIENT} text-white md:h-10 md:px-4`}>
              <Link to={toolHref}>Design your wall<ArrowRight className="ml-2 h-4 w-4" /></Link>
            </Button>
          </div>
        </div>
        <WallProHeaderRule />
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-20 md:px-8">
        <section className="py-10 md:py-14">
          <p className={`text-[11px] font-semibold uppercase tracking-[0.2em] ${skin.accent}`}>Questions &amp; answers</p>
          <h1 className="mt-3 max-w-[18ch] text-4xl font-extrabold leading-[1.05] tracking-tight md:text-5xl">
            Everything you&rsquo;d ask before buying a wall wrap.
          </h1>
          <p className={`mt-4 max-w-[62ch] text-base leading-relaxed ${skin.body}`}>
            Every price, measurement and panel count below is computed by the same code the
            tool runs — on a {WALL.widthIn}″ × {WALL.heightIn}″ wall, so you can check the
            arithmetic yourself. If the product changes, this page changes with it.
          </p>
        </section>

        {/* ── THE GEOMETRY ───────────────────────────────────────────────── */}
        <section className="grid items-start gap-8 lg:grid-cols-2">
          <div>
            <h2 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight md:text-3xl">
              <Frame className="h-6 w-6 text-blue-400" />The glass on your photo
            </h2>
            <p className={`mt-3 max-w-[48ch] text-sm leading-relaxed ${skin.body}`}>
              Upload a photo of the room and WallPro marks it up. The coloured panes are not
              decoration — each one is a decision you can drag, and the two colours mean
              opposite things.
            </p>
            <ul className="mt-5 space-y-3">
              <Swatch skin={skin}
                fill={`linear-gradient(135deg, ${WALL_GLASS.area.from}55, ${WALL_GLASS.area.to}22)`}
                stroke={WALL_GLASS.area.stroke}
                label="Violet — your wall"
                note="the region the design will cover. Four numbered handles, detected on upload; drag any that landed wrong."
              />
              <Swatch skin={skin}
                fill={`linear-gradient(135deg, ${WALL_GLASS.protected.from}66, ${WALL_GLASS.protected.to}44)`}
                stroke={WALL_GLASS.protected.stroke}
                label="Cyan — protected"
                note="a window, a radiator, a sofa: kept out of the preview so you see your room, never out of the print."
              />
              <Swatch skin={skin}
                fill={WALL_GLASS.seam}
                stroke={WALL_GLASS.seam}
                label="Dashed cyan — a seam"
                note={`where two printed panels meet, drawn at the real ${WALLPRO_PRINT_WIDTH}″ spacing so you can see where they land before you buy.`}
              />
            </ul>
            <p className={`mt-5 max-w-[48ch] text-sm ${skin.muted}`}>
              The photo is optional. It changes nothing about the print files — those come
              from the wall&rsquo;s measurements — it is only how you see the design in your
              own room before paying for it.
            </p>
          </div>

          <figure className={skin.figure}>
            <div className="relative">
              <img src="/wallpro/proof-spa-before.jpg" className="aspect-[1400/803] w-full object-cover"
                alt="A living room photographed with the wall area marked in violet and the window and shelving marked as protected in cyan" />
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"
                className="pointer-events-none absolute inset-0 h-full w-full">
                {/* The REAL gradients — this is the editor's own <defs>. */}
                <WallGlassDefs />
                <polygon points={svgPoints(DEMO_WALL)} fill={WALL_AREA_FILL}
                  stroke={WALL_GLASS.area.stroke} strokeWidth=".3" />
                {DEMO_PROTECTED.map((region, i) => {
                  const x = Math.min(...region.points.map(p => p.x)) * 100;
                  const y = Math.min(...region.points.map(p => p.y)) * 100;
                  return (
                    <g key={i}>
                      <polygon points={svgPoints(region.points)} fill="rgba(0,120,220,.10)"
                        stroke={WALL_GLASS.protected.halo} strokeWidth=".65" filter={WALL_HALO_FILTER} />
                      <polygon points={svgPoints(region.points)} fill={WALL_PROTECTED_FILL}
                        stroke={WALL_GLASS.protected.stroke} strokeWidth=".35" />
                      <rect x={x + .4} y={y + .4} width="19" height="3.8" rx=".65"
                        fill={WALL_GLASS.protected.chip} fillOpacity=".9" />
                      <text x={x + 1.2} y={y + 2.4} fill="white" fontSize="1.5">Protected {i + 1}</text>
                    </g>
                  );
                })}
                {DEMO_WALL.map((q, i) => (
                  <g key={i}>
                    <circle cx={q.x * 100} cy={q.y * 100} r=".85"
                      fill={WALL_GLASS.area.handle} stroke="white" strokeWidth=".2" />
                    <text x={q.x * 100 + 1.2} y={q.y * 100 - 1.2}
                      fill={WALL_GLASS.area.label} fontSize="2.5">{i + 1}</text>
                  </g>
                ))}
              </svg>
            </div>
            <figcaption className={skin.figcaption}>
              The editor&rsquo;s own overlays, drawn here with the same colours it uses. The
              shapes on this example room are placed by hand to show the controls — on your
              photo they come from detection, and you drag them.
            </figcaption>
          </figure>
        </section>

        {/* ── THE PIPELINE ───────────────────────────────────────────────── */}
        <section className="mt-16 md:mt-24">
          <h2 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight md:text-3xl">
            <Layers className="h-6 w-6 text-blue-400" />What happens after you approve
          </h2>
          <p className={`mt-3 max-w-[62ch] text-sm leading-relaxed ${skin.body}`}>
            This is the GENIE Universal Wall Panelizer — the same screen you watch while your
            files are built, shown here finished for the {WALL.widthIn}″ × {WALL.heightIn}″
            wall. Four machine steps and one human one. A panel glows when its file actually
            exists, never when a step merely ran.
          </p>
          <div className="mt-6 rounded-2xl bg-white p-4 text-slate-900 shadow-2xl shadow-slate-950/50 md:p-6">
            <UniversalPanelizerProgress run={run} />
          </div>
          <p className={`mt-3 text-xs ${skin.muted}`}>
            A worked example, not a live job: the panel widths, the {settings.overlap}″ seam
            overlap and the {WALL_TARGET_PPI} PPI target are the real ones for this wall.
          </p>
        </section>

        {/* ── PRICE ──────────────────────────────────────────────────────── */}
        <section className="mt-16 md:mt-24">
          <h2 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight md:text-3xl">
            <Wallet className="h-6 w-6 text-blue-400" />What it costs
          </h2>
          <p className={`mt-3 max-w-[62ch] text-sm leading-relaxed ${skin.body}`}>
            You pay for the way you got your design, and nothing else is bundled into it.
            Every one of these includes the print-ready files{theme.showPrintOffer ? '' : ' — yours to take to any printer'},
            panelized to your wall and checked by a person before release.
          </p>
          <div className={skin.tableWrap}>
            <table className="w-full text-left text-sm">
              <thead className={skin.tableHead}>
                <tr><th className="px-4 py-3 font-semibold">How you start</th>
                  <th className="px-4 py-3 font-semibold">What you get</th>
                  <th className="px-4 py-3 text-right font-semibold">Price</th></tr>
              </thead>
              <tbody className={skin.tableDivide}>
                {MODE_ORDER.map(mode => {
                  const sku = WALL_DESIGN_SKUS[mode];
                  return (
                    <tr key={mode} className={skin.tableRow}>
                      <td className={`px-4 py-3 font-semibold ${skin.heading}`}>{sku.label}</td>
                      <td className={`px-4 py-3 ${skin.body}`}>{sku.detail}</td>
                      <td className={`px-4 py-3 text-right font-bold tabular-nums ${skin.heading}`}>{formatMoney(sku.cents)}</td>
                    </tr>
                  );
                })}
                {/* The film is a line only on the brand that prints it. On
                    DesignProAI nobody is quoting for a press. */}
                {theme.showPrintOffer && (
                  <tr className="bg-blue-500/10">
                    <td className={`px-4 py-3 font-semibold ${skin.heading}`}>Printed wrap film</td>
                    <td className={`px-4 py-3 ${skin.body}`}>
                      Avery HP MPI 2610 wall vinyl, printed and shipped by WePrintWraps —
                      priced by the square foot and nothing else
                      {billing && filmCents != null && <>. This wall: {billing.wallSqFt} sq ft, {formatMoney(filmCents)}</>}
                    </td>
                    <td className={`px-4 py-3 text-right font-bold tabular-nums ${skin.heading}`}>
                      ${WPW_WALL_FILM_RATE_PER_SQFT.toFixed(2)}<span className="text-xs font-normal text-slate-400">/sq ft</span>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── THE QUESTIONS ──────────────────────────────────────────────── */}
        <Group skin={skin} icon={Ruler} title="The design">
          <Qa skin={skin} q="Do I need a photo of the room to start?">
            <p>
              No. The design and every print file are derived from two numbers — the wall&rsquo;s
              width and height. A photo only unlocks the on-wall preview, and you can add one
              at any point, including after the design exists.
            </p>
          </Qa>
          <Qa skin={skin} q="How does it know how big to draw the pattern?">
            <p>
              It reads the wall&rsquo;s inches and decides. A motif that looks right on a screen
              prints three feet across on a real wall, so the repeat is set from the
              measurements rather than asked of you — then a slider takes it from
              {' '}{PATTERN_SCALE_MIN}% to {PATTERN_SCALE_MAX}% if you want it bigger or
              tighter.
            </p>
            <p>
              Changing the pattern size never changes the print size. The panels, the panel
              count and the file dimensions are identical at every percentage; only how large
              the design is drawn on them changes.
            </p>
          </Qa>
          <Qa skin={skin} q="Can I change the design after I see it?">
            <p>
              Yes — refine it as many times as you like. Every refinement is a new immutable
              version (V1, V2, V3…), any earlier version can be restored, and exactly one
              version is approved. Production reads only the approved one.
            </p>
          </Qa>
          <Qa skin={skin} q="Can I use artwork I already have?">
            <p>
              Yes, two ways. <strong className="text-white">Use my print-ready file</strong> takes your
              artwork and prepares it: scaled, bled and panelized to the roll, for
              {' '}{formatMoney(WALL_DESIGN_SKUS.upload.cents)}. <strong className="text-white">Match my
              design</strong> recreates a reference at print resolution when what you have is a
              photo or a screen-sized image rather than a print file.
            </p>
          </Qa>
        </Group>

        <Group skin={skin} icon={Frame} title="Your photo and the geometry">
          <Qa skin={skin} q="What if the four corners land in the wrong place?">
            <p>
              Drag them. Detection runs the moment you choose a photo and it is a starting
              point, not a verdict — the numbered violet handles are draggable on a desktop
              and on a phone, and there is keyboard nudging for fine work.
            </p>
            <p>
              Until the wall is actually located — detected, or marked by you — the photo pane
              keeps showing your photo and the on-wall view is not offered. It will never
              paint the design across an unconfirmed frame.
            </p>
          </Qa>
          <Qa skin={skin} q="The auto-mask missed my window. Can I mark it myself?">
            <p>
              Yes, and that is the intended path. Protected areas are marked by hand: tap the
              corners of the region, or drag a rectangle over it. Each one gets a numbered
              &ldquo;Protected&rdquo; chip so you can find it again and remove it.
            </p>
            <p>
              &ldquo;Auto-mask windows &amp; furniture&rdquo; is there as a shortcut when you want it, but
              it is preview-only either way.
            </p>
          </Qa>
          <Qa skin={skin} q="Does masking a window cut a hole in my print file?">
            <p>
              No, and this is the part that matters most. Print panels stay full rectangles.
              The artwork prints straight through the place a window, a radiator or a skirting
              board sits, and the installer trims it on the wall — because if the hole were in
              the file there would be nothing to trim.
            </p>
          </Qa>
          <Qa skin={skin} q="My phone photo won't upload.">
            <p>
              It will. The picker accepts anything your phone offers, including iPhone HEIC,
              and converts it in the browser. A JPG, PNG or WebP passes through untouched so a
              print-ready upload is never re-compressed.
            </p>
          </Qa>
        </Group>

        <Group skin={skin} icon={Layers} title="The print files">
          <Qa skin={skin} q="What exactly do I get?">
            <p>
              The whole wall as one file, plus every panel on its own. Each panel is written
              three ways from the same pixels: <strong className="text-white">TIFF</strong> for the RIP,
              {' '}<strong className="text-white">PDF</strong> flattened at the exact printed size, and
              {' '}<strong className="text-white">PNG</strong>. A seam guide and the panel dimensions come with
              them.
            </p>
            {billing && <p>
              For this {WALL.widthIn}″ × {WALL.heightIn}″ wall that is {plan.panels.length} panels,
              {' '}{plan.bounds.width}″ × {plan.bounds.height}″ overall with bleed.
            </p>}
          </Qa>
          <Qa skin={skin} q="How wide are the panels, and why?">
            <p>
              {WALLPRO_PRINT_WIDTH}″ — the width of the wall vinyl itself. Every panel carries
              {' '}{settings.bleed}″ of bleed and {settings.overlap}″ of duplicated artwork at each
              seam, so the pattern meets itself on the wall instead of being coaxed into place.
            </p>
          </Qa>
          <Qa skin={skin} q="What resolution do they print at?">
            <p>
              {WALL_TARGET_PPI} PPI at final size, measured from real pixels — each panel is
              enhanced individually to get there, which is the only way a wall-sized file stays
              sharp at arm&rsquo;s length. A design that cannot reach it is not shipped claiming
              it could.
            </p>
          </Qa>
          <Qa skin={skin} q="Can I print them myself, or use my own printer?">
            <p>
              {theme.showPrintOffer
                ? <>Yes. The files are yours either way — we would like to print them, and the rate
                  is on this page, but nothing about the files depends on it.</>
                : <>Yes. The files are standard print files with no lock on them: take them to any
                  wide-format printer. There is no bundled press and no markup on one.</>}
            </p>
          </Qa>
        </Group>

        <Group skin={skin} icon={ShieldCheck} title="Buying, checking and delivery">
          <Qa skin={skin} q="Why does it take up to 24 hours?">
            <p>
              Because a person checks it. Once the panels are cut, a member of the production
              team measures every one against your wall, checks the seams and the print
              resolution, and fixes anything wrong before it reaches you. That window is
              {' '}{WALL_VALIDATION_HOURS} hours, and it is the product — not a queue.
            </p>
            <p>
              Until a human releases them, the files cannot be downloaded at all. That is
              enforced by the database, not by a button.
            </p>
          </Qa>
          <Qa skin={skin} q="What do I get to quote when I call about my job?">
            <p>
              Two identifiers. A <strong className="text-white">DesignID</strong> (DID-XXXXXXXX) names the
              design and follows every version of it. An <strong className="text-white">order number</strong>
              {' '}(WPO-000000) is issued by the database the moment your payment confirms, and the
              production team searches by it.
            </p>
          </Qa>
          <Qa skin={skin} q="When am I charged, and for what?">
            <p>
              Once, for the path you chose, before the print files are built — production
              panels are paid work and the panelizer will not queue a job without a paid
              entitlement on that exact version.
              {theme.showPrintOffer && ' Printed film is a separate line with a separate payee: the design is DesignProAI\'s work, the film is ours.'}
            </p>
          </Qa>
          <Qa skin={skin} q="Can I see the design on my wall before I pay?">
            <p>
              Yes. Design it, mark your wall, and look at it in your own room as long as you
              like. Payment unlocks the print-ready files — the {WALL_TARGET_PPI} PPI panels and
              the whole-wall file — not the picture.
            </p>
          </Qa>
        </Group>

        <section className={`mt-20 ${WALL_GRADIENT} rounded-2xl px-6 py-10 text-center shadow-2xl shadow-blue-900/40 md:px-10 md:py-14`}>
          <h2 className="text-3xl font-extrabold tracking-tight md:text-4xl">Start with two numbers.</h2>
          <p className="mx-auto mt-3 max-w-[48ch] text-sm text-white/85">
            Measure the wall, describe what you want, and look at it in your own room before
            you decide anything.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg" className="bg-white text-blue-700 hover:bg-white/90">
              <Link to={toolHref}>Design your wall<ArrowRight className="ml-2 h-4 w-4" /></Link>
            </Button>
            <Button asChild size="lg" variant="outline"
              className="border-white/40 bg-white/10 text-white hover:bg-white/20 hover:text-white">
              <Link to={caseHref}>See one wall, bare to installed</Link>
            </Button>
          </div>
        </section>
      </main>
    </div>
  );
}
