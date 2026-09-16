// GRAPHICSPRO'S SHARED PIECES ARE ACTUALLY WIRED — enforced, not assumed.
//
// Owner, 2026-09-16: "wire the entire set."
//
// Every defect this file locks was found by LOOKING, not by a failing test,
// which is the point: each one is invisible to a type-checker and to every
// other suite, because "built but never rendered" and "typed twice" both
// compile perfectly.
//
//   graphicsPanelizerRun existed, was unit-tested, and was imported by NOTHING.
//   It was written to the owner instruction "create for wallpro and
//   graphicspro to use" — WallPro wired its half, GraphicsPro did not, and the
//   tool page ran a second product-local progress tracker instead.
//
//   Two of the three GraphicsPro pages had a NON-STICKY hero banner in place of
//   the sticky brand header, so they lost their branding on the first scroll.
//
//   The material rates lived as a literal inside PricingEstimator, so the FAQ
//   could not quote them without typing them a second time.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { graphicsPanelizerRun } from '../graphicspro-panelizer';
import { GRAPHICS_MATERIALS, GRAPHICS_LAMINATION_PER_SQFT } from '../graphicspro-pricing';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const PRODUCTION_OUTPUT = read('../../components/graphicspro-v1/ProductionOutput.tsx');
const ESTIMATOR = read('../../components/graphicspro-v1/PricingEstimator.tsx');
const FAQ = read('../../pages/GraphicsProFaq.tsx');
const PAGES = {
  all: read('../../pages/GraphicsProV1.tsx'),
  wall: read('../../pages/GraphicsProWall.tsx'),
  window: read('../../pages/GraphicsProWindow.tsx'),
};

describe('the GENIE panelizer is on screen, not just in the library', () => {
  it('is rendered by the production output', () => {
    expect(PRODUCTION_OUTPUT).toContain('graphicsPanelizerRun');
    expect(PRODUCTION_OUTPUT).toContain('UniversalPanelizerProgress');
  });

  it('does not keep a second, product-local progress tracker beside it', () => {
    // The bespoke rail this replaced was `const STAGES = [...]` with its own
    // icons and its own idea of done — and it had already drifted: it went
    // green on "Complete" whether or not the plotter files existed.
    expect(PRODUCTION_OUTPUT).not.toMatch(/const STAGES\s*=/);
    expect(PRODUCTION_OUTPUT).not.toContain('Production Pipeline');
  });

  it('glows a file only when that file really exists', () => {
    const none = graphicsPanelizerRun({ id: 'a', status: 'processing', mode: 'production' });
    expect(none.pieces.every(p => p.state !== 'done')).toBe(true);

    const some = graphicsPanelizerRun({
      id: 'a', status: 'complete', mode: 'production',
      files: [{ format: 'pdf', path: 'x' }, { format: 'svg', error: 'failed' }],
    });
    expect(some.pieces.find(p => p.id === 'pdf')?.state).toBe('done');
    // The SVG errored, so it must not glow even though the job says complete.
    expect(some.pieces.find(p => p.id === 'svg')?.state).not.toBe('done');
  });

  it('names the live sub-stage while the cut step runs', () => {
    // A rail driven by `status` alone sits on one step for minutes and reads as
    // frozen. The seven fine-grained stage labels the bespoke tracker showed
    // survive here rather than being dropped in the consolidation.
    const run = graphicsPanelizerRun({
      id: 'a', status: 'processing', mode: 'production', stage: 'cut_paths',
    });
    const cut = run.stages.find(s => s.key === 'cut');
    expect(cut?.state).toBe('running');
    expect(cut?.explanation).toContain('cut line');

    const generic = graphicsPanelizerRun({ id: 'a', status: 'processing', mode: 'production' });
    // No stage column, and an unknown stage, both fall back to the step's own
    // words rather than printing a raw database value at a customer.
    expect(generic.stages.find(s => s.key === 'cut')?.explanation).toContain('deterministically');
    const unknown = graphicsPanelizerRun({
      id: 'a', status: 'processing', mode: 'production', stage: 'some_new_stage',
    });
    expect(unknown.stages.find(s => s.key === 'cut')?.explanation).toContain('deterministically');
  });
});

describe('all four CutPro surfaces wear the ONE shared ToolHeader', () => {
  // REBASED ONTO MAIN, 2026-09-17. This session built a CutPro-specific
  // `GraphicsProHeader` to fix the non-sticky hero banners on the wall and
  // window pages. In parallel, main extracted WallPro's bar into
  // `components/layout/ToolHeader` and put VehiclePro, WallPro and all three
  // CutPro surfaces on it. That is the same fix at a better altitude -- one bar
  // for every tool rather than one per product -- so the local component was
  // dropped rather than merged, and this lock now guards the shared one.
  it('renders ToolHeader and no per-product header survives', () => {
    for (const [name, source] of Object.entries({ ...PAGES, faq: FAQ })) {
      expect(source, `${name} should render ToolHeader`).toContain('<ToolHeader');
      expect(source, `${name} must not reintroduce a per-product header`)
        .not.toContain('GraphicsProHeader');
      // The banner that stood on the wall and window pages was NOT sticky, so
      // the brand vanished on the first scroll into the tool.
      expect(source, `${name} should not keep its own hero banner`)
        .not.toContain('from-slate-900 via-purple-900');
    }
  });

  it('takes its wordmark from the OS brand table, not a literal', () => {
    for (const [name, source] of Object.entries({ ...PAGES, faq: FAQ })) {
      expect(source, `${name} should read OS_TOOLS`).toContain('OS_TOOLS.cutpro');
    }
  });
});

describe('the FAQ quotes the product, never a retyped number', () => {
  it('reads the rates the estimator charges', () => {
    expect(FAQ).toContain('GRAPHICS_MATERIALS');
    expect(FAQ).toContain('GRAPHICS_LAMINATION_PER_SQFT');
    expect(ESTIMATOR).toContain('GRAPHICS_MATERIALS');
  });

  it('hard-codes no material rate in either surface', () => {
    // MATCHED AS A NUMBER, NOT A SUBSTRING. A plain `toContain` on the
    // lamination rate convicts `gap-1.5` and `h-1.5` in the Tailwind classes,
    // which is a false positive that would make this lock useless the moment
    // someone "fixed" it by deleting the assertion. The boundary rules out a
    // rate preceded by a hyphen or a digit, which is exactly the class case.
    const rates = [
      ...Object.values(GRAPHICS_MATERIALS).map(m => m.rate),
      GRAPHICS_LAMINATION_PER_SQFT,
    ];
    for (const rate of rates) {
      const literal = new RegExp(`(^|[^\\w.-])${String(rate).replace('.', '\\.')}(?![\\w.])`);
      expect(FAQ, `the FAQ hard-codes ${rate}`).not.toMatch(literal);
      expect(ESTIMATOR, `the estimator hard-codes ${rate}`).not.toMatch(literal);
    }
  });

  it('shows the production pipeline with the product\'s own stage builder', () => {
    expect(FAQ).toContain('graphicsPanelizerRun');
    expect(FAQ).toContain('UniversalPanelizerProgress');
  });
});
