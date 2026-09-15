/**
 * BUY THE PRINTED WRAP — shown beneath the designer on a partner's own page.
 *
 * Owner, 2026-09-14: "Buy wall wrap on the same page from x WePrintWraps.com",
 * and the page "should BE the tool". So this is not a separate landing page: it
 * is the print offer, the trust statement and the material spec sitting under
 * the working designer, on the same wall dimensions the customer already typed.
 *
 * It reads the SAME billing the designer prices with, passed in rather than
 * recomputed, so the number here and the number in the tool cannot disagree.
 *
 * On the DesignProAI route this does not render at all: that customer came for
 * the design tool, and the printing is a partner's business.
 */
import { Clock, FileCheck2, Layers, ShieldCheck, ShoppingCart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WPW_WALL_FILM_RATE_PER_SQFT, formatMoney, wallQuote } from '@/lib/wallpro-pricing';
import { WPW_WALL_WRAP_PRODUCT, storeMatchesLaunchPricing, wpwWallWrapBuy } from '@/lib/wpw-wall-product';
import { WALLPRO_PRINT_WIDTH } from '@/lib/wallpro-geometry';
import { WALL_FILM } from '@/lib/quick-quote';
import type { WallBilling } from '@/lib/wallpro-print-plan';
import { WALL_CARD } from '@/lib/wallpro-brand';

const SPECS: Array<[string, string]> = [
  ['Film', WALL_FILM.name],
  ['Finish', WALL_FILM.finish],
  ['Thickness', WALL_FILM.thickness],
  ['Adhesive', WALL_FILM.adhesive],
  ['Opacity', WALL_FILM.opacity],
  ['Panel width', `${WALLPRO_PRINT_WIDTH}″, ½″ overlap at each seam`],
  ['Resolution', '150 PPI at printed size'],
  ['Install', WALL_FILM.installType],
  // The three the live product page lists and this table did not. "Pricing
  // unit" earns its row twice over: the store nav still prints "per linear
  // foot" on this product, so the page it replaces has to state the truth.
  ['Lamination', 'Not required or compatible'],
  ['Pricing unit', 'Sold by the square foot'],
  ['Use case', WALL_FILM.useCase],
];

export function WallProPrintOffer({ billing }: { billing: WallBilling | null }) {
  const printRate = formatMoney(Math.round(WPW_WALL_FILM_RATE_PER_SQFT * 100));
  const quote = wallQuote({ path: 'print-only', designMode: 'upload', billing });
  const buy = billing ? wpwWallWrapBuy(billing.wallSqFt) : null;

  return (
    <section className="mt-8 space-y-6">
      {/* ── The printing, priced on the wall they already measured ──────── */}
      <div className={`overflow-hidden ${WALL_CARD} p-0`}>
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 bg-gradient-to-r from-sky-50 via-violet-50 to-fuchsia-50 p-5 md:p-6">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-700">
              Printed by WePrintWraps
            </p>
            <h2 className="mt-1 text-xl font-bold text-slate-900 md:text-2xl">Add the printed wrap</h2>
            <p className="mt-1 max-w-md text-sm text-slate-600">
              Your design on {WALL_FILM.name.replace('Avery Dennison® ', '')}, panelized and ready to hang.
            </p>
          </div>
          {quote && billing ? (
            <div className="text-right">
              <p className="text-3xl font-bold tabular-nums text-slate-900 md:text-4xl">
                {formatMoney(quote.totalCents)}
              </p>
              <p className="text-xs text-slate-600">
                {billing.wallSqFt} sq ft × {printRate}/sq ft
              </p>
            </div>
          ) : (
            <p className="text-sm text-slate-600">Enter your wall size above.</p>
          )}
        </div>

        {billing && buy && (
          <div className="space-y-3 p-5 md:p-6">
            <p className="text-xs text-slate-600">
              Produced as {billing.panels} {billing.panels === 1 ? 'panel' : 'panels'} × {billing.panelLengthIn}″ long on
              the {billing.billedWidthIn}″ roll ({billing.linearFeet} linear ft), with a half-inch overlap at every
              seam. Priced on the wall’s own square footage — the number you get with a tape measure.
            </p>
            <Button asChild size="lg" className="w-full bg-slate-900 text-white hover:bg-slate-800 sm:w-auto">
              <a href={buy.url} target="_blank" rel="noopener noreferrer">
                <ShoppingCart className="mr-2 h-4 w-4" />{buy.label}
              </a>
            </Button>
            {buy.note && <p className="text-[11px] text-slate-500">{buy.note}</p>}
            {/* Say WHY, when the reason is a store setting a person can fix.
                The Woo product is still listed per LINEAR FOOT at $3.25 while
                this page prices per SQUARE FOOT — so a one-click cart would
                charge a different number than the one quoted above. */}
            {!storeMatchesLaunchPricing() && WPW_WALL_WRAP_PRODUCT && (
              <p className="rounded-lg bg-amber-50 p-2 text-[11px] text-amber-900">
                Store listing is {formatMoney(Math.round((WPW_WALL_WRAP_PRODUCT.price ?? 0) * 100))}/
                {WPW_WALL_WRAP_PRODUCT.unit === 'linear_foot' ? 'linear ft' : WPW_WALL_WRAP_PRODUCT.unit}. The price
                above is the current {printRate}/sq ft rate — confirm at checkout.
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── What happens after approval. Claims, never disclaimers. ─────── */}
      <div className={`${WALL_CARD} md:p-6`}>
        <h3 className="text-base font-bold text-slate-900">What happens after you approve it</h3>
        <ol className="mt-4 grid gap-5 md:grid-cols-3">
          <li>
            <Layers className="h-5 w-5 text-blue-600" />
            <p className="mt-2 text-sm font-semibold text-slate-900">Panelized to your wall</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              Split into {WALLPRO_PRINT_WIDTH}″ panels with a ½″ overlap at every seam, at 150 PPI on the real printed
              inches. You watch each panel appear as it is built.
            </p>
          </li>
          <li>
            <Clock className="h-5 w-5 text-sky-600" />
            <p className="mt-2 text-sm font-semibold text-slate-900">A person checks it — within 24 hours</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              Our design team reviews the seams, the scale and the resolution on the real panels. Nothing goes to press
              on a machine’s say-so.
            </p>
          </li>
          <li>
            <FileCheck2 className="h-5 w-5 text-emerald-600" />
            <p className="mt-2 text-sm font-semibold text-slate-900">You get the actual files</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              The whole wall as one print file, plus every panel as TIFF, PDF and PNG. Yours to keep, whether we print
              it or you do.
            </p>
          </li>
        </ol>
        <p className="mt-5 flex items-start gap-2 rounded-xl bg-slate-50 p-4 text-xs leading-relaxed text-slate-700">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <span>
            <strong className="text-slate-900">That 24-hour window is the point, not a delay.</strong> A design tool
            that finishes in ninety seconds hands you whatever came out of it. We would rather find the problem than
            let you print it.
          </span>
        </p>
      </div>

      {/* ── The material. Long-tail search reads this too. ──────────────── */}
      <details open className={`${WALL_CARD} md:p-6`}>
        <summary className="cursor-pointer text-base font-bold text-slate-900">The material</summary>
        <dl className="mt-4 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          {SPECS.map(([label, value]) => (
            <div key={label} className="flex flex-wrap justify-between gap-x-4 border-b border-slate-100 pb-2">
              <dt className="text-slate-500">{label}</dt>
              <dd className="font-medium text-slate-900">{value}</dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}
