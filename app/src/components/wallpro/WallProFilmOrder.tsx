/**
 * BUY THE FILM — with or without a design.
 *
 * Owner, 2026-09-14: "Must have buttons so they can directly buy printed wrap
 * film if they don't need a new design", then "also provide print price when
 * they enter sq ft / size of wall — so they can get both design and print."
 *
 * This page replaces the wall PRODUCT page, so it has to serve the customer who
 * arrives with artwork already finished — on a wrap printer's site, a large
 * share of them. Before this, the only cart button appeared after a wall had
 * been measured AND a design approved, so that buyer had nothing to click.
 *
 * THE FOOTAGE IS THE WALL'S, NOT A SECOND THING TO TYPE. The page already asks
 * for width and height in step 1 and computes the area; this reads it. Someone
 * ordering film for a job that is not the wall on screen can override it, and
 * the override is remembered only while they are here — it never writes back to
 * the wall, because the wall drives the print plan and the design.
 *
 * It is NOT an either/or. A customer can buy the design and the film; the two
 * are separate lines with separate payees (see payeeForLine in
 * wallpro-pricing.ts), which is exactly why they can be bought separately.
 */
import { useState } from 'react';
import { ShoppingCart, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WPW_PRINTED_FILMS, filmOrder, money } from '@/lib/wpw-printed-films';
import { WALL_GRADIENT, WALL_CARD } from '@/lib/wallpro-brand';

export function WallProFilmOrder({ wallSqFt }: { wallSqFt: number | null }) {
  const [override, setOverride] = useState('');
  const typed = Number(override);
  const usingOverride = override.trim() !== '' && Number.isFinite(typed) && typed > 0;
  const sqFt = usingOverride ? typed : (wallSqFt ?? 0);
  const haveFootage = sqFt > 0;

  if (!WPW_PRINTED_FILMS.length) return null;

  return (
    <section id="order-printed-film" className={WALL_CARD} aria-label="Order printed film">
      <h2 className="text-lg font-semibold">Just need film printed?</h2>
      <p className="mt-2 text-sm wall-muted">
        If your artwork is already print-ready, skip the design and order the film.
        Priced by the square foot, printed and shipped ready to install.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          Square feet
          <input
            id="film-order-sqft"
            type="number" min="1" step="1" inputMode="numeric"
            className="mt-1 w-36 rounded-lg border wall-edge bg-[hsl(var(--wall-card))] px-3 py-2 text-sm wall-ink"
            placeholder={wallSqFt ? String(Math.ceil(wallSqFt)) : 'Enter sq ft'}
            value={override}
            onChange={e => setOverride(e.target.value)}
          />
        </label>
        {!usingOverride && wallSqFt
          ? <p className="pb-2 text-xs wall-muted">Using your wall: {wallSqFt.toFixed(1)} sq ft. Type above to order a different size.</p>
          : usingOverride && wallSqFt
            ? <p className="pb-2 text-xs wall-muted">Ordering {Math.ceil(typed)} sq ft — your wall is {wallSqFt.toFixed(1)} sq ft.</p>
            : <p className="pb-2 text-xs wall-muted">Enter your wall size in step 1, or type a square footage here.</p>}
      </div>

      <div className="mt-4 divide-y divide-slate-200 rounded-xl border wall-edge">
        {WPW_PRINTED_FILMS.map((film, i) => {
          const order = haveFootage ? filmOrder(film, sqFt) : null;
          return (
            <div key={film.wooProductId} className={`flex flex-wrap items-center justify-between gap-3 p-3 ${i === 0 ? 'bg-blue-50/50' : ''}`}>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold wall-ink">{film.name}</p>
                <p className="text-xs wall-muted">
                  {film.use}
                  {typeof film.price === 'number' && film.unit === 'sqft' && <> · ${film.price.toFixed(2)}/sq ft</>}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {/* The total, so the number on the button is never a surprise. */}
                {order?.cents != null && (
                  <span className="text-sm font-bold tabular-nums wall-ink">{money(order.cents)}</span>
                )}
                {/* The wall film leads with the page's own action gradient -- the
                    same one the Generate buttons carry -- so "buy the film" reads
                    as a primary action rather than a footnote. Stated explicitly
                    because the button variant's own styling wins over a bare
                    colour class. */}
                {order ? (
                  <Button asChild size="sm" variant={i === 0 ? 'default' : 'outline'} className={i === 0 ? `${WALL_GRADIENT} text-white` : ''}>
                    <a href={order.url} target="_blank" rel="noopener noreferrer">
                      {order.mode === 'cart'
                        ? <><ShoppingCart className="mr-2 h-4 w-4" />{order.label}</>
                        : <><ExternalLink className="mr-2 h-4 w-4" />{order.label}</>}
                    </a>
                  </Button>
                ) : (
                  <span className="text-xs text-slate-400">Enter a size</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-xs wall-muted">
        Adds to your WePrintWraps cart. Need the artwork as well? Design it above —
        the design and the film are separate, so you can buy either or both.
      </p>
    </section>
  );
}
