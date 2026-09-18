import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PATTERN_HERO_PROOF } from '../patternpro-brand';

const source = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/**
 * PATTERNPRO'S HERO IS A DRAGGABLE BEFORE/AFTER, ON BOTH BRANDS.
 *
 * Owner, 2026-09-17: "must have the draggable tool ... on the patternpro
 * page", and "They both wpw version and standard need the dynamic drag magic
 * before and after."
 *
 * Both brands are ONE component with a `brand` prop, so mounting the slider
 * once covers /printpro/patternpro and /pattern-wrap together — that is the
 * property worth pinning, because a second page would be the drift this
 * codebase keeps paying for.
 */
describe('the PatternPro hero', () => {
  const page = source('../../pages/PatternWrap.tsx');

  it('mounts the SAME slider WallPro uses, in its fill variant', () => {
    expect(page).toContain("import { WallProHeroProof } from '@/components/wallpro/WallProHeroProof'");
    expect(page).toMatch(/<WallProHeroProof proofs=\{heroProofs\} variant="fill" \/>/);
  });

  it('serves both brands from one component, never a copy', () => {
    // A `brand` prop and a single default export: the DesignProAI page and the
    // WePrintWraps storefront are the same file.
    expect(page).toMatch(/export default function PatternWrap\(\{ brand = 'designpro' \}/);
    expect(page.match(/export default function/g)?.length).toBe(1);
  });

  it('reads curated rows with the bundled pair as the floor', () => {
    // Without this the PatternPro tab on /admin/wallpro-proofs would be a liar
    // for this surface -- the exact defect the WallPro landing had.
    expect(page).toContain("listWallProofs('patternpro'");
    expect(page).toContain('curated ?? [PATTERN_HERO_PROOF]');
  });

  it('keeps the static render as the last resort, so the hero is never empty', () => {
    expect(page).toMatch(/heroProofs\.length > 0 \? \(/);
    expect(page).toContain('src={theme.hero.main}');
  });
});

describe('the bundled pair is one truck, twice', () => {
  it('is the stock photograph the hero render was made from', () => {
    // Same truck, same angle, same studio -- which is what makes a wipe read as
    // one vehicle changing rather than two loosely related photographs.
    expect(PATTERN_HERO_PROOF.before).toContain('white-f150-side.jpg');
    expect(PATTERN_HERO_PROOF.after).toContain('Ford_Raptor_side.jpg');
  });

  it('carries words, because the slider prints them over the image', () => {
    expect(PATTERN_HERO_PROOF.alt.length).toBeGreaterThan(20);
    expect(PATTERN_HERO_PROOF.headline).toBeTruthy();
    expect(PATTERN_HERO_PROOF.caption).toBeTruthy();
  });
});

describe('the curator can swap the pair without a deploy', () => {
  it('has a PatternPro tab on the proofs admin', () => {
    const admin = source('../../pages/AdminWallProProofs.tsx');
    expect(admin).toContain("key: 'patternpro'");
    // PatternPro has a partner skin, like WallPro -- so it must curate against
    // the WePrintWraps brand rather than the plain DesignProAI one.
    expect(admin).toMatch(/toolKey === 'wallpro' \|\| toolKey === 'patternpro' \? 'weprintwraps'/);
  });

  it('is admitted by the database, not just by the UI', () => {
    // A tool key the CHECK constraint refuses would let a curator fill in the
    // form and fail on save.
    const migration = source('../../../../supabase/migrations/20260917234500_wallpro_proofs_patternpro.sql');
    expect(migration).toMatch(/CHECK \(tool_key IN \('vehiclepro', 'wallpro', 'cutpro', 'patternpro'\)\)/);
    // The inline constraint's name is generated, so it is dropped by INSPECTION
    // and replaced by a named one -- which is also what makes this idempotent.
    expect(migration).toContain('pg_catalog.pg_get_constraintdef');
    expect(migration).toContain('wallpro_proofs_tool_key_check');
  });
});
