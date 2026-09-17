/**
 * PatternWrap — PatternPro worn by a partner. WePrintWraps first.
 *
 * Owner, 2026-09-15, after the WPW x WallPro page: "make a white and gradient
 * blue version for WPW … PatternPro top left, show an image on right", then
 * "all these need to be in os.designpro repo".
 *
 * ONE COMPONENT, NOT A COPY. This renders the REAL PatternPro tool
 * (WBTYToolUI — the 118-pattern library, the on-vehicle 3D proof, the six
 * extra views, the full-wrap yardage, the WooCommerce cart link) under a white
 * skin, with the partner's name in the same lockup WallPro's partner page
 * wears. The brand is DATA (lib/patternpro-brand.ts); a fix to the tool lands
 * on every surface at once. The header bar is black because navigation chrome
 * is always black; everything under it is white with the blue gradient as the
 * accent.
 */
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { RotateCcw, FolderOpen, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WBTYToolUI } from '@/components/productTools/WBTYToolUI';
import { ToolContainer } from '@/components/layout/ToolContainer';
import { WallProLockup, WallProHeaderRule } from '@/components/wallpro/WallProLockup';
import { useStickyOffset } from '@/lib/use-sticky-offset';
import { patternBrand, type PatternBrandKey } from '@/lib/patternpro-brand';
import './PatternWrap.css';

export default function PatternWrap({ brand = 'designpro' }: { brand?: PatternBrandKey } = {}) {
  const theme = patternBrand(brand);
  const stickyTop = useStickyOffset('pattern-header');
  const partner = brand !== 'designpro';

  return (
    // THE THEME SCOPE, same attribute and same token set WallPro uses, so the two
    // tools are one dark rather than two (owner, 2026-09-17).
    <div data-wall-theme={theme.surface} className="pattern-wrap min-h-screen wall-ground wall-ink">
      <Helmet>
        <title>{partner ? `${theme.logoAlt} x PatternPro™ — Pattern wraps by the yard` : 'PatternPro™ — Pattern wraps by the yard | DesignProAI'}</title>
        <meta
          name="description"
          content={theme.lede}
        />
      </Helmet>

      {/* ── Persistent header — black, like every nav surface. The lockup is
          WallPro's, so the two partner pages read as one system. ────────── */}
      <header
        id="pattern-header"
        style={{ top: stickyTop }}
        className="sticky z-30 bg-black px-4 py-3 text-white md:px-8 md:py-4"
      >
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <WallProLockup theme={theme} />
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="border-blue-300/70 bg-[hsl(var(--wall-card))] text-blue-700 hover:bg-blue-50 md:h-10 md:px-4"
              title="Start over with a blank vehicle and no pattern selected."
              onClick={() => window.location.assign(window.location.pathname)}
            >
              <RotateCcw className="h-4 w-4 md:mr-2" /><span className="hidden md:inline">Start fresh</span>
            </Button>
            <Button asChild variant="outline" size="sm" className="border-blue-300/70 bg-[hsl(var(--wall-card))] text-blue-700 hover:bg-blue-50 md:h-10 md:px-4">
              <Link to="/designpro/jobs" title="My designs">
                <FolderOpen className="h-4 w-4 md:mr-2" /><span className="hidden md:inline">My designs</span>
              </Link>
            </Button>
          </div>
        </div>
        <WallProHeaderRule />
      </header>

      {/* ── Above the scroll: words left, the pattern on a truck right ────── */}
      <section className="mx-auto grid max-w-7xl items-center gap-8 px-4 py-10 sm:px-6 md:grid-cols-2 md:py-14">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-blue-700">
            {theme.eyebrowLine}
          </p>
          {/* THE HEADLINE IS THE PRODUCT (owner, 2026-09-15: "should say pick a
              pattern and see it on any vehicle"). Not who designed or printed it —
              what the visitor gets to do, in one line. */}
          <h1 className="mt-3 font-poppins text-4xl font-extrabold leading-[1.05] tracking-tight wall-ink sm:text-5xl">
            Pick a pattern.
            <br />
            See it on <span className="wpw-blue-text">any vehicle</span>.
          </h1>
          <p className="mt-4 max-w-xl text-base wall-muted sm:text-lg">{theme.lede}</p>
          <ul className="mt-5 flex flex-wrap gap-2 text-xs font-semibold">
            {theme.chips.map((chip) => (
              <li key={chip} className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-blue-700">
                {chip}
              </li>
            ))}
          </ul>
        </div>
        {theme.hero && (
          <div className="relative">
            <img
              src={theme.hero.main}
              alt={theme.hero.alt}
              className="w-full rounded-2xl border wall-edge shadow-xl"
              loading="eager"
            />
            {/* The swatch CARD the render was made from, over the truck's corner:
                this pattern, that vehicle. Its own proportions, because the
                pattern's name is printed along the card's bottom edge and a
                square crop cut it off. */}
            <img
              src={theme.hero.swatch}
              alt={theme.hero.swatchAlt}
              className="absolute -bottom-6 -left-4 hidden w-[40%] rounded-xl border-4 border-white shadow-2xl sm:block"
              loading="lazy"
            />
          </div>
        )}
      </section>

      {/* ── Already know your pattern? Straight to the printed rolls. ─────── */}
      {theme.orderFilmUrls && (
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border wall-edge bg-[hsl(var(--wall-field))] px-4 py-3 text-sm wall-muted">
            <span>
              <span className="font-bold wall-ink">Already know your pattern?</span> Skip the
              3D proof and order printed rolls by the yard:
            </span>
            <span className="flex flex-wrap gap-x-4 gap-y-1">
              {Object.entries(theme.orderFilmUrls).map(([collection, url]) => (
                <a
                  key={collection}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-semibold text-blue-700 hover:text-blue-900"
                >
                  {collection} <ArrowRight className="h-3.5 w-3.5" />
                </a>
              ))}
            </span>
          </div>
        </div>
      )}

      {/* ── The tool — the SAME PatternPro, skinned to the brand ──────────────
          `.wpw-white` is a skin that repaints the shared WBTYToolUI, which is
          natively DARK (zinc-900, bg-black), into a light storefront. It used
          to be applied unconditionally, which is why the DesignProAI page was
          light too.
          Owner, 2026-09-17: "a dark navy with charcoal ui for standard
          WallPro, and PatternPro." So the skin now rides the brand: the
          partner keeps its light storefront, and dropping the skin on the
          DesignProAI brand returns the tool to the dark it was written in --
          no second override, and nothing to keep in sync. */}
      <section className={`${theme.surface === 'light' ? 'wpw-white' : ''} pb-16`}>
        <ToolContainer>
          <WBTYToolUI />
        </ToolContainer>
      </section>
    </div>
  );
}
