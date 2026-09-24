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

/**
 * THE INK FOLLOWS THE BAR. The lockup was born on a black bar and painted its
 * words white by hand. A partner page on the light surface (owner, 2026-09-17:
 * "I need the white ui just add the WPW colored logo in corner") carries the
 * same lockup on a WHITE bar, where white ink is invisible. `tone` names the
 * bar it sits on; the default keeps every existing black header byte-for-byte.
 */
export type LockupTone = 'dark' | 'light';

const INK: Record<LockupTone, { lead: string; accent: string; eyebrow: string; cross: string; tagline: string }> = {
  dark: { lead: 'text-white', accent: 'text-blue-400', eyebrow: 'text-blue-400', cross: 'text-white/50', tagline: 'text-white/70' },
  light: { lead: 'text-gray-900', accent: 'text-blue-600', eyebrow: 'text-blue-600', cross: 'text-gray-400', tagline: 'text-gray-600' },
};

export function WallProLockup({ theme, compact = false, tone = 'dark', inline = false }: { theme: LockupBrand; compact?: boolean; tone?: LockupTone; inline?: boolean }) {
  const ink = INK[tone];
  return (
    <div className={'min-w-0' + (inline ? ' md:flex md:items-center md:gap-4' : '')}>
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
        {!theme.logo && theme.eyebrow && <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${ink.eyebrow} md:text-xs`}>{theme.eyebrow}</p>}
        {(theme.logo || theme.eyebrow) && <span aria-hidden="true" className={`text-lg font-light ${ink.cross} md:text-xl`}>&times;</span>}
        {/* THE ONE BRAND GRADIENT, HERE TOO (Trish 2026-09-17: "Pro should be
            gradient blue"). Every other "Pro" in the product -- sidebar nav,
            dashboard cards, the hero -- runs ToolWordmark's blue-to-fuchsia
            gradient. This lockup was the one place still painting a flat
            `text-blue-400`, which is exactly the kind of per-page drift RULE
            0 keeps naming: the persistent header is the FIRST thing a visitor
            sees, so it is the last place that should look like a different
            product. Against a real partner mark (theme.logo set) the original
            reasoning still holds -- a gradient competing with someone else's
            logo reads as noise, not a name -- so only that one case keeps the
            solid tone. */}
        <h1 className={compact ? 'text-xl font-bold leading-tight md:text-2xl' : 'text-2xl font-bold leading-tight md:text-3xl'}>
          <span className={ink.lead}>{theme.wordmarkLead}</span>
          <span className={theme.logo ? ink.accent : 'bg-gradient-to-r from-blue-500 to-fuchsia-500 bg-clip-text text-transparent'}>{theme.wordmarkAccent}</span>{inline && <sup className={`ml-0.5 text-[0.45em] font-semibold ${ink.cross}`}>™</sup>}
        </h1>
      </div>
      {/* `inline`: the tagline sits beside the wordmark behind a hairline, as
          in the owner's 2026-09-24 mockup; stacked below it on a phone. */}
      <p className={`mt-0.5 text-xs ${ink.tagline} md:text-sm` + (inline ? ` md:mt-0 md:border-l md:pl-4 ${tone === 'light' ? 'md:border-gray-300' : 'md:border-white/25'}` : '')}>{theme.tagline}</p>
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
