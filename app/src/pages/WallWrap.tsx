/**
 * WALL WRAP — the WePrintWraps × WallPro page.
 *
 * Owner, 2026-09-14: "Weprintwraps.com we are going to add to jumbo menu by
 * #1 replacing the current WallWrap Page, #2 adding WallWrap Design to Design
 * area on Jumbo Menu that will also route to new wallwrap page."
 *
 * So this is ONE page with TWO doors into it: it replaces the existing WPW wall
 * wrap product page, and the Design section of the jumbo menu points at it too.
 * A customer arriving from "Wall Wrap" wants it printed; one arriving from
 * "WallWrap Design" wants it designed. Both want the same thing in the end, and
 * the page is built so neither has to hunt for their half.
 *
 * WHY A PAGE AND NOT AN EMBED. Owner, 2026-09-13: "I don't want embeds on
 * wallpro / That's a generic way to do it and is not good ui." An iframe of one
 * site inside another gets the worst of both -- two scrollbars, a header that
 * cannot span, a tool that cannot deep-link. This is a real page that carries
 * WePrintWraps' authority and hands off to the designer as a navigation, not as
 * a frame.
 *
 * PRICES ARE IMPORTED, NEVER TYPED. WALL_DESIGN_SKUS and
 * WPW_WALL_FILM_RATE_PER_SQFT are the same constants the quote and the Stripe
 * checkout read, and a test compares them to the gateway's own table. A selling
 * page that hardcodes a price is a selling page that eventually lies.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import {
  ArrowRight, CheckCircle2, Clock, FileCheck2, Layers, Ruler, ShieldCheck, ShoppingCart, Wand2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  WALL_DESIGN_SKUS, WPW_WALL_FILM_RATE_PER_SQFT, formatMoney, wallQuote, type WallDesignMode,
} from '@/lib/wallpro-pricing';
import { DEFAULT_WALL_PRINT, wallBilling } from '@/lib/wallpro-print-plan';
import { WALLPRO_PRINT_WIDTH } from '@/lib/wallpro-geometry';
import { WALL_FILM } from '@/lib/quick-quote';
import { WPW_WALL_WRAP_PRODUCT, storeMatchesLaunchPricing, wpwWallWrapBuy } from '@/lib/wpw-wall-product';
import { useStickyOffset } from '@/lib/use-sticky-offset';

/** The designer, with the entry path preselected from the card they clicked. */
const DESIGNER = '/printpro/wallpro';

/**
 * The five design paths, in the order a customer decides.
 *
 * Cheapest first is deliberate: the ladder reads as "how much original work am
 * I asking for", which is exactly what the prices encode. `upload` sits last
 * because it is not a design at all -- it is prep for artwork they already own.
 */
const PATHS: Array<{ mode: WallDesignMode; blurb: string; badge?: string }> = [
  { mode: 'library', blurb: 'Choose from our ready-to-sell wall designs. Scaled to your wall and panelized the same day.' },
  { mode: 'ai', blurb: 'Describe the wall you want in a sentence. Our designer builds it at print resolution.', badge: 'Most popular' },
  { mode: 'match', blurb: 'Send us a design you love. We recreate it print-ready at the right scale for your wall.' },
  { mode: 'wall', blurb: 'Send a photo of the room. A designer reads the space and designs specifically for it.' },
  { mode: 'upload', blurb: 'Already have artwork? We scale it, bleed it and panelize it to the roll.' },
];

function Price({ cents }: { cents: number }) {
  return <span className="text-2xl font-bold text-slate-900">{formatMoney(cents)}</span>;
}

export default function WallWrap() {
  const stickyTop = useStickyOffset('wallwrap-header');
  const printRate = formatMoney(Math.round(WPW_WALL_FILM_RATE_PER_SQFT * 100));

  // BUY IT HERE, not on a catalog page the customer has to go find. The wall
  // size drives both the price and the cart quantity, and it is the same
  // wallBilling() -> wallQuote() pair the designer prices with, so this page
  // and the tool can never quote different numbers for the same wall.
  const [width, setWidth] = useState(142);
  const [height, setHeight] = useState(96);
  const billing = wallBilling(width, height, DEFAULT_WALL_PRINT, WALLPRO_PRINT_WIDTH);
  const printQuote = wallQuote({ path: 'print-only', designMode: 'upload', billing });
  const buy = billing ? wpwWallWrapBuy(billing.wallSqFt) : null;

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <Helmet>
        <title>Wall Wrap — Custom Printed Wall Graphics | WePrintWraps</title>
        <meta
          name="description"
          content={`Custom wall wraps printed on Avery HP MPI 2610. Design it with WallPro from $${(WALL_DESIGN_SKUS.library.cents / 100).toFixed(0)}, printed at ${printRate} a square foot, every file checked by a person before it goes to press.`}
        />
      </Helmet>

      {/* THE PERSISTENT HEADER, on this page too (owner, repeatedly).
          The offset is MEASURED off the app shell's own sticky header, never
          set to 0: two stickies at the same offset overlap rather than stack,
          and the shell wins on z-index, so `top-0` puts this underneath it and
          the wordmark vanishes. The first build of this page did exactly that,
          which is why useStickyOffset is now shared with WallPro instead of the
          logic being re-typed per page. */}
      <header
        id="wallwrap-header"
        style={{ top: stickyTop }}
        className="sticky z-30 border-b border-slate-200 bg-slate-50/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-slate-50/80 md:px-8 md:py-4"
      >
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-600 md:text-xs">
              WePrintWraps
            </p>
            <h1 className="mt-0.5 text-2xl font-bold leading-tight md:text-3xl">
              Wall<span className="bg-gradient-to-r from-sky-500 via-violet-500 to-fuchsia-500 bg-clip-text text-transparent">Pro</span>
            </h1>
            {/* THE OWNER'S OWN LINE, verbatim (2026-09-14): "WallPro Custom on
                Demand WallWrap Design and Output files delivered FAST". FAST
                stays capitalised because it is the promise the 24-hour QC
                window has to be measured against, not a decoration. */}
            <p className="mt-0.5 text-xs text-slate-600 md:text-sm">
              Custom on-demand WallWrap design and output files delivered <span className="font-bold text-slate-900">FAST</span>
            </p>
          </div>
          <Button asChild className="bg-gradient-to-r from-sky-600 via-violet-600 to-fuchsia-600 text-white">
            <Link to={DESIGNER}><Wand2 className="mr-2 h-4 w-4" />Start designing</Link>
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-10 md:px-8">
        {/* ── Hero ───────────────────────────────────────────────────────── */}
        <section className="max-w-3xl">
          <h2 className="text-3xl font-bold leading-tight md:text-5xl">
            A wall wrap you can actually print.
          </h2>
          {/* THE AUTHORITY LINE. Owner, 2026-09-13: "we come from authority the
              customer is paying for the design that includes print ready
              files." Most tools sell a picture. The deliverable here is the
              file a press can run -- said plainly, first. */}
          <p className="mt-4 text-lg text-slate-700">
            You are not buying a picture of a wall. You are buying the
            production file — measured to your wall, panelized to the roll,
            seam-matched, and checked by a person before it reaches the press.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button asChild size="lg" className="bg-gradient-to-r from-sky-600 via-violet-600 to-fuchsia-600 text-white">
              <Link to={DESIGNER}>Design my wall wrap<ArrowRight className="ml-2 h-4 w-4" /></Link>
            </Button>
            <p className="text-sm text-slate-600">
              Design from <strong className="text-slate-900">{formatMoney(WALL_DESIGN_SKUS.library.cents)}</strong> ·
              printing <strong className="text-slate-900">{printRate}/sq ft</strong>
            </p>
          </div>
        </section>

        {/* ── The five ways in ───────────────────────────────────────────── */}
        <section className="mt-14">
          <h3 className="text-xl font-bold">Pick how you want it designed</h3>
          <p className="mt-1 text-sm text-slate-600">
            Every one of these includes print-ready panelized files. Printing is
            separate and optional — take the files to any printer you like.
          </p>
          <ul className="mt-5 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {PATHS.map(({ mode, blurb, badge }) => {
              const sku = WALL_DESIGN_SKUS[mode];
              return (
                <li key={mode} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-semibold text-slate-900">{sku.label}</p>
                    {badge && (
                      <span className="shrink-0 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-700">
                        {badge}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 flex-1 text-sm text-slate-600">{blurb}</p>
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <Price cents={sku.cents} />
                    <Button asChild size="sm" variant="outline">
                      <Link to={DESIGNER}>Start<ArrowRight className="ml-1 h-3 w-3" /></Link>
                    </Button>
                  </div>
                </li>
              );
            })}
            {/* Print is its own card because it is its own purchase: a customer
                with finished artwork should not have to read five design
                options to find out they can just buy printing. */}
            <li className="flex flex-col rounded-2xl border-2 border-violet-200 bg-violet-50/40 p-5 shadow-sm">
              <p className="font-semibold text-slate-900">Printing</p>
              <p className="mt-2 flex-1 text-sm text-slate-600">
                {WALL_FILM.name}, {WALL_FILM.finish.toLowerCase()}. Printed,
                panelized to {WALLPRO_PRINT_WIDTH}″ and ready to hang.
              </p>
              <div className="mt-4">
                <span className="text-2xl font-bold text-slate-900">{printRate}</span>
                <span className="text-sm text-slate-600"> / sq ft</span>
                <p className="mt-1 text-xs text-slate-500">
                  Priced on your wall’s own square footage — the number you get
                  with a tape measure.
                </p>
              </div>
            </li>
          </ul>
        </section>

        {/* ── Buy the printing, right here ───────────────────────────────── */}
        {/* Owner, 2026-09-14: "Buy wall wrap on the same page from x
            WePrintWraps.com." A customer who already has artwork should be able
            to measure, see the price and order without touching the designer at
            all. Same geometry as the tool, so the two cannot disagree. */}
        <section className="mt-14 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
          <h3 className="text-xl font-bold">Buy the printed wrap</h3>
          <p className="mt-1 text-sm text-slate-600">
            Already have print-ready artwork? Measure the wall and order the film. Printed and panelized by WePrintWraps.
          </p>
          <div className="mt-5 grid gap-5 md:grid-cols-[auto_1fr] md:items-end">
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm">
                Wall width (in)
                <input
                  type="number" min="1" max="2400" step="0.25" value={width || ''}
                  onChange={e => setWidth(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="text-sm">
                Wall height (in)
                <input
                  type="number" min="1" max="2400" step="0.25" value={height || ''}
                  onChange={e => setHeight(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
            </div>
            {billing && printQuote && buy ? (
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-sm text-slate-700">
                  <strong className="text-slate-900">{billing.wallSqFt} sq ft</strong> × {printRate}/sq ft
                </p>
                <p className="mt-1 text-3xl font-bold text-slate-900">{formatMoney(printQuote.totalCents)}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {billing.panels} {billing.panels === 1 ? 'panel' : 'panels'} × {billing.panelLengthIn}″ on the {billing.billedWidthIn}″ roll,
                  ½″ overlap at every seam. Priced on the wall’s own square footage.
                </p>
                <Button asChild className="mt-3 w-full bg-slate-900 text-white hover:bg-slate-800">
                  <a href={buy.url} target="_blank" rel="noopener noreferrer">
                    <ShoppingCart className="mr-2 h-4 w-4" />{buy.label}
                  </a>
                </Button>
                {/* Say what the button will actually do. A control that quietly
                    does something smaller than it looks is how trust is lost. */}
                {buy.note && <p className="mt-2 text-[11px] text-slate-500">{buy.note}</p>}
                {/* AND SAY WHY, where the reason is a store-configuration
                    mismatch a person can fix. This is deliberately visible
                    rather than a code comment: the WooCommerce product is still
                    priced per LINEAR FOOT at $3.25 while this page prices per
                    SQUARE FOOT at $3.50, so a one-click cart would charge a
                    different number than the one quoted above. Fix the Woo
                    product and re-sync the catalog and the button becomes a
                    direct cart add with no code change. */}
                {!storeMatchesLaunchPricing() && WPW_WALL_WRAP_PRODUCT && (
                  <p className="mt-2 rounded-lg bg-amber-50 p-2 text-[11px] text-amber-900">
                    Store listing is {formatMoney(Math.round((WPW_WALL_WRAP_PRODUCT.price ?? 0) * 100))}/{WPW_WALL_WRAP_PRODUCT.unit === 'linear_foot' ? 'linear ft' : WPW_WALL_WRAP_PRODUCT.unit}.
                    The price above is the current {printRate}/sq ft rate — confirm on checkout.
                  </p>
                )}
              </div>
            ) : (
              <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                Enter a wall width and height to see the price.
              </p>
            )}
          </div>
          <p className="mt-4 text-sm text-slate-600">
            Need the artwork too?{' '}
            <Link to={DESIGNER} className="font-semibold text-violet-700 underline">
              Design it in WallPro
            </Link>{' '}
            from {formatMoney(WALL_DESIGN_SKUS.library.cents)} — you will see it on your own wall photo before you pay.
          </p>
        </section>

        {/* ── The trust signal ───────────────────────────────────────────── */}
        {/* Owner, 2026-09-12, rejecting a hedge: "What benefit is there at
            dating artist impression? Why wouldn't anyone buy it? There is no
            trust signal." So this section CLAIMS rather than disclaims. Every
            line is something the pipeline actually does. */}
        <section className="mt-14 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
          <h3 className="text-xl font-bold">What happens after you approve it</h3>
          <ol className="mt-5 grid gap-5 md:grid-cols-3">
            <li>
              <Layers className="h-5 w-5 text-violet-600" />
              <p className="mt-2 font-semibold">Panelized to your wall</p>
              <p className="mt-1 text-sm text-slate-600">
                Split into {WALLPRO_PRINT_WIDTH}″ panels with a ½″ overlap at every seam and
                bleed on every edge, at 150 PPI on the real printed inches. You
                watch each panel appear as it is built.
              </p>
            </li>
            <li>
              <Clock className="h-5 w-5 text-sky-600" />
              <p className="mt-2 font-semibold">A person checks it — within 24 hours</p>
              <p className="mt-1 text-sm text-slate-600">
                Our design team reviews the seams, the scale and the resolution
                on the real panels before anything is released. Nothing goes to
                press on a machine’s say-so.
              </p>
            </li>
            <li>
              <FileCheck2 className="h-5 w-5 text-emerald-600" />
              <p className="mt-2 font-semibold">You get the actual files</p>
              <p className="mt-1 text-sm text-slate-600">
                The whole wall as one print file, plus every panel as TIFF, PDF
                and PNG. Yours to keep, whether we print it or you do.
              </p>
            </li>
          </ol>
          <p className="mt-6 flex items-start gap-2 rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <span>
              <strong className="text-slate-900">That 24-hour window is the point, not a delay.</strong>{' '}
              A design tool that finishes in ninety seconds hands you whatever
              came out of it. We would rather find the problem than let you
              print it.
            </span>
          </p>
        </section>

        {/* ── Specs ──────────────────────────────────────────────────────── */}
        <section className="mt-14">
          <h3 className="text-xl font-bold">The material</h3>
          <dl className="mt-4 grid gap-x-8 gap-y-3 rounded-2xl border border-slate-200 bg-white p-6 text-sm sm:grid-cols-2">
            {[
              ['Film', WALL_FILM.name],
              ['Finish', WALL_FILM.finish],
              ['Thickness', WALL_FILM.thickness],
              ['Adhesive', WALL_FILM.adhesive],
              ['Opacity', WALL_FILM.opacity],
              ['Panel width', `${WALLPRO_PRINT_WIDTH}″, ½″ overlap at each seam`],
              ['Install', WALL_FILM.installType],
              ['Good for', WALL_FILM.useCase],
            ].map(([label, value]) => (
              <div key={label} className="flex flex-wrap justify-between gap-x-4 border-b border-slate-100 pb-2 last:border-0">
                <dt className="text-slate-500">{label}</dt>
                <dd className="font-medium text-slate-900">{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* ── Close ──────────────────────────────────────────────────────── */}
        <section className="mt-14 rounded-2xl bg-gradient-to-r from-sky-600 via-violet-600 to-fuchsia-600 p-8 text-white md:p-10">
          <h3 className="text-2xl font-bold md:text-3xl">Measure your wall. We’ll do the rest.</h3>
          <p className="mt-2 max-w-2xl text-white/90">
            Width and height in inches is all we need to start. You will see the
            design flat and on your own wall photo before you pay for anything.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <Button asChild size="lg" variant="secondary" className="bg-white text-slate-900 hover:bg-white/90">
              <Link to={DESIGNER}><Ruler className="mr-2 h-4 w-4" />Start with my wall size</Link>
            </Button>
            <p className="flex items-center gap-2 text-sm text-white/90">
              <CheckCircle2 className="h-4 w-4" />No account needed to try it
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
