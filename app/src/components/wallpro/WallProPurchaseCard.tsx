import { ExternalLink, FileCheck2, ShoppingCart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WALL_CARD, WALL_GRADIENT } from '@/lib/wallpro-brand';
import { WALLPRO_PRINT_WIDTH } from '@/lib/wallpro-geometry';
import type { WallBilling } from '@/lib/wallpro-print-plan';
import { WALL_DESIGN_SKUS, WPW_WALL_FILM_RATE_PER_SQFT, formatMoney, type WallDesignMode } from '@/lib/wallpro-pricing';
import { wpwWallWrapBuy } from '@/lib/wpw-wall-product';

type Props = {
  showPrintOffer: boolean;
  billing: WallBilling | null;
  designMode: WallDesignMode;
  canBuyFile: boolean;
  fileUnlocked: boolean;
  busy: boolean;
  onBuyFile: () => void;
};

export function WallProPurchaseCard({ showPrintOffer, billing, designMode, canBuyFile, fileUnlocked, busy, onBuyFile }: Props) {
  const printBuy = showPrintOffer && billing ? wpwWallWrapBuy(billing.wallSqFt) : null;
  const printTotal = billing ? Math.round(billing.wallSqFt * WPW_WALL_FILM_RATE_PER_SQFT * 100) : null;

  return (
    <section className={WALL_CARD + ' p-4'} aria-label="WallPro purchase options">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-blue-500">{showPrintOffer ? 'Print + file options' : 'Production file'}</p>
          <h2 className="mt-1 text-lg font-bold wall-ink">{showPrintOffer ? 'Take the file, order the print, or both.' : 'Take this wall design to production.'}</h2>
          {showPrintOffer ? (
            <div className="mt-3 rounded-xl border wall-edge bg-[hsl(var(--wall-field))] px-3 py-2.5">
              <p className="text-sm font-bold wall-ink">Avery Dennison® HP MPI 2610 Wall Film</p>
              <p className="mt-1 text-xs wall-muted">
                Matte / Luster · 6.0 mil · permanent clear adhesive · 100% opacity · {WALLPRO_PRINT_WIDTH}″ printable panel width · ½″ perimeter bleed · dry install
              </p>
              <p className="mt-1 text-[11px] wall-muted">Smooth, finished interior walls · commercial interiors, offices, retail, gyms, lobbies and murals.</p>
            </div>
          ) : (
            <p className="mt-2 text-sm wall-muted">
              Full wall master plus production panels at {WALLPRO_PRINT_WIDTH}″ maximum print width, ½″ perimeter bleed and 150 PPI production target.
            </p>
          )}
        </div>

        <div className="flex min-w-[260px] flex-col gap-2">
          {fileUnlocked ? (
            <div className="flex items-center justify-center rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900">
              <FileCheck2 className="mr-2 h-4 w-4" />Print-ready file unlocked
            </div>
          ) : (
            <Button
              className={WALL_GRADIENT + ' min-h-11 text-white'}
              disabled={busy || !canBuyFile}
              onClick={onBuyFile}
              title={canBuyFile ? undefined : 'Generate and save this design first.'}
            >
              <FileCheck2 className="mr-2 h-4 w-4" />
              Buy print-ready file — {formatMoney(WALL_DESIGN_SKUS[designMode].cents)}
            </Button>
          )}

          {showPrintOffer && printBuy && (
            <Button asChild variant="outline" className="min-h-11">
              <a href={printBuy.url} target="_blank" rel="noopener noreferrer">
                {printBuy.mode === 'cart'
                  ? <><ShoppingCart className="mr-2 h-4 w-4" />Add this printed wrap to cart{printTotal != null ? ' · ' + formatMoney(printTotal) : ''}</>
                  : <><ExternalLink className="mr-2 h-4 w-4" />Order this printed wrap{printTotal != null ? ' · ' + formatMoney(printTotal) : ''}</>}
              </a>
            </Button>
          )}
          {showPrintOffer && printBuy?.note && <p className="max-w-[320px] text-[11px] wall-muted">{printBuy.note}</p>}
          {showPrintOffer && !billing && <p className="text-center text-[11px] wall-muted">Enter wall dimensions to price the printed wrap.</p>}
        </div>
      </div>
    </section>
  );
}
