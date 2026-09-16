// THE FAQ SHOWS THE GLASS THE EDITOR DRAWS — enforced, not hoped for.
//
// Owner, 2026-09-16: "I need to also show the geometry on the FAQ page where it
// shows the glass morphism on the corners."
//
// The moment two files draw those overlays, a restyle in the editor leaves the
// FAQ teaching customers to look for a violet handle that is no longer violet.
// That is not a hypothetical in this repository: the print card said 51" while
// the press said 53", which is the same defect in a different unit.
//
// So the colours live in components/wallpro/wall-glass.tsx and BOTH renderers
// read them. These tests convict the two ways that can quietly come undone:
// a literal creeping back into the editor, and the FAQ drawing its own.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { WALL_GLASS, WALL_AREA_FILL, WALL_PROTECTED_FILL } from '../../components/wallpro/wall-glass';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const EDITOR = read('../../components/wallpro/WallPhotoEditor.tsx');
const FAQ = read('../../pages/WallProFaq.tsx');
const GLASS = read('../../components/wallpro/wall-glass.tsx');

/** Every colour the overlays are drawn with, flattened out of the table. */
const HEXES = [
  ...Object.values(WALL_GLASS.area), ...Object.values(WALL_GLASS.protected), WALL_GLASS.seam,
].filter(v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) as string[];

describe('the wall overlay colours have exactly one home', () => {
  it('names a distinct colour for each meaning', () => {
    // The violet/cyan split IS the information: one region will be painted,
    // the other will not. A palette collapse would make them indistinguishable
    // on a photograph, which is where a customer reads them.
    // Not every value is unique, deliberately: a gradient's end stop is the
    // same colour as its stroke, which is what makes the fill and the outline
    // read as one object. What must never collide is the two FAMILIES.
    expect(HEXES.length).toBeGreaterThanOrEqual(8);
    const area = new Set<string>(Object.values(WALL_GLASS.area).filter(v => /^#/.test(String(v))) as string[]);
    const shield = new Set<string>(Object.values(WALL_GLASS.protected).filter(v => /^#/.test(String(v))) as string[]);
    for (const hex of area) expect(shield.has(hex), `${hex} is in both families`).toBe(false);
    expect(WALL_GLASS.area.stroke).not.toBe(WALL_GLASS.protected.stroke);
    expect(WALL_GLASS.area.handle).not.toBe(WALL_GLASS.protected.vertex);
  });

  it('defines every one of them in wall-glass.tsx', () => {
    for (const hex of HEXES) expect(GLASS.toLowerCase()).toContain(hex.toLowerCase());
  });

  it('leaves no overlay colour hard-coded in the editor', () => {
    // The editor is the interactive surface and the one most likely to be
    // restyled. A literal here is the drift this module exists to prevent.
    for (const hex of HEXES) {
      expect(EDITOR.toLowerCase(), `WallPhotoEditor hard-codes ${hex}`).not.toContain(hex.toLowerCase());
    }
  });

  it('leaves no overlay colour hard-coded in the FAQ', () => {
    for (const hex of HEXES) {
      expect(FAQ.toLowerCase(), `WallProFaq hard-codes ${hex}`).not.toContain(hex.toLowerCase());
    }
  });

  it('has both surfaces render the shared <defs> rather than their own', () => {
    // Two copies of a gradient with one id is worse than two colours: whichever
    // paints last wins, silently, and only on the page that renders both.
    for (const [name, source] of [['editor', EDITOR], ['faq', FAQ]] as const) {
      expect(source, `${name} should render WallGlassDefs`).toContain('<WallGlassDefs');
      expect(source, `${name} should not declare its own gradient`).not.toContain('<linearGradient');
      expect(source).toContain('WALL_AREA_FILL');
      expect(source).toContain('WALL_PROTECTED_FILL');
    }
  });

  it('exports fill strings that point at the shared gradient ids', () => {
    expect(WALL_AREA_FILL).toBe(`url(#${WALL_GLASS.area.gradientId})`);
    expect(WALL_PROTECTED_FILL).toBe(`url(#${WALL_GLASS.protected.gradientId})`);
  });
});

describe('the FAQ quotes the product, never a retyped number', () => {
  it('reads its prices, geometry and pipeline from the code that owns them', () => {
    // Each of these is a number a marketing page would normally re-type and
    // then be wrong about forever.
    for (const source of [
      'WALL_DESIGN_SKUS',            // the five entry paths and their prices
      'WPW_WALL_FILM_RATE_PER_SQFT', // the printed-film rate
      'planWallPrint',               // the panel plan
      'wallBilling',                 // the press arithmetic
      'WALLPRO_PRINT_WIDTH',         // the roll
      'WALL_TARGET_PPI',             // the print resolution
      'WALL_VALIDATION_HOURS',       // the human QC window
      'wallPanelizerRun',            // the pipeline rail, stage copy included
    ]) {
      expect(FAQ, `WallProFaq should read ${source}`).toContain(source);
    }
  });

  it('gates every printing claim on the brand flag', () => {
    // The DesignProAI page sells files; the partner's page sells film. One
    // component, one flag — a hard-coded printer name here is how a
    // DesignProAI customer ends up reading someone else's price.
    const printing = FAQ.split('\n').filter(line =>
      /WePrintWraps|sq ft|WPW_WALL_FILM_RATE/.test(line) && !line.trim().startsWith('*') && !line.trim().startsWith('//'));
    expect(printing.length).toBeGreaterThan(0);
    expect(FAQ).toContain('theme.showPrintOffer');
  });
});
