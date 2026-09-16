/**
 * THE PARTNER LOCKUP — partner mark × WallPro, plus the tagline.
 *
 * Lifted out of WallPro.tsx when a SECOND page needed the same header (the
 * case study at /wall-wrap/how-it-works). Two pages carrying a brand lockup as
 * two copies of the same JSX is the drift this codebase keeps paying for --
 * the print-width literal, the gradient typed at four call sites, the card
 * shell typed at seven. A visitor moving between the tool and its case study
 * must not see the brand shift.
 *
 * Only the IDENTITY moved. Each page keeps its own header bar and its own
 * actions, because those are page state (Start fresh and My wall designs mean
 * nothing on a case study) and plumbing them through here would be a worse
 * coupling than the duplication it removed.
 *
 * The "×" is punctuation, not a third brand, so it stays lighter and smaller
 * than either name it joins. A brand with no logo falls back to its eyebrow.
 */
import type { WallBrand } from '@/lib/wallpro-brand';

/**
 * Only the identity fields. PatternPro's partner page (/pattern-wrap) wears the
 * same lockup with its own brand table (patternpro-brand.ts), which has no
 * proofs or print offer, so the prop is the identity, not the whole WallBrand.
 */
export type LockupBrand = Pick<WallBrand, 'logo' | 'logoAlt' | 'eyebrow' | 'wordmarkLead' | 'wordmarkAccent' | 'tagline'>;

export function WallProLockup({ theme, compact = false }: { theme: LockupBrand; compact?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2.5">
        {/* NO PREFIX, NO "×", WHEN THE SHELL ALREADY SAYS WHO WE ARE (owner,
            2026-09-16: "REMOVE THE DUAL DESIGNPRO, SHOULD SAY WALLPRO").
            On DesignProAI the app sidebar is already branded DesignProAI, so
            "DESIGNPROAI × WallPro" above it is the company introducing itself
            twice on one screen -- which is what makes a tool page read as a
            website. A partner's page still gets the lockup, because there the
            "×" is doing real work: it says whose tool this is AND who is
            serving it. */}
        {theme.logo && <img src={theme.logo} alt={theme.logoAlt} className={compact ? 'h-6 w-auto shrink-0 md:h-7' : 'h-7 w-auto shrink-0 md:h-9'} />}
        {!theme.logo && theme.eyebrow && <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-blue-400 md:text-xs">{theme.eyebrow}</p>}
        {(theme.logo || theme.eyebrow) && <span aria-hidden="true" className="text-lg font-light text-white/50 md:text-xl">&times;</span>}
        {/* Two tone, not a gradient: against the partner's own mark the wordmark
            has to read as a solid name at a glance. The gradient stays where it
            belongs, on the actions. */}
        <h1 className={compact ? 'text-xl font-bold leading-tight md:text-2xl' : 'text-2xl font-bold leading-tight md:text-3xl'}>
          <span className="text-white">{theme.wordmarkLead}</span><span className="text-blue-400">{theme.wordmarkAccent}</span>
        </h1>
      </div>
      <p className="mt-0.5 text-xs text-white/70 md:text-sm">{theme.tagline}</p>
    </div>
  );
}

/**
 * The blue rule under the header bar (owner, 2026-09-14: "Add a border blue and
 * white gradiant in between persistent header and page"). It bleeds past the
 * bar's own padding so it reads as an edge of the bar rather than a line drawn
 * inside it. Two pixels: enough to carry a gradient, not so much that it
 * becomes a band of its own. The parent must be `relative`.
 */
export function WallProHeaderRule() {
  return <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-blue-700 via-sky-400 to-blue-700" />;
}
