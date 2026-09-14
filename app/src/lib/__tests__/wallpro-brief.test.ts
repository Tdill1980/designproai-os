// The model-facing creative brief for a batch job (owner, 2026-09-14: "You
// need to give better prompts. I need designs like you would see on Etsy").
// Locks the measured fix: the raw library prompt is 72% production-pipeline
// text; the brief the generator receives carries NONE of it and ALL of the
// listing-quality content a boutique wallpaper studio would write.
import { describe, expect, it } from 'vitest';
import { batchCreativeBrief, engineForDesignType, type WallPromptEntry } from '../wallpro-catalog';
import { wallDesignPrompt } from '../../../../supabase/functions/generate-wall-design/prompt';
import library from '@/data/wallpro-prompt-library.json';

const LIB = library as WallPromptEntry[];
// Pipeline phrases only. A concept may legitimately say "seamless pattern";
// what must never reach the model is the seam-ENGINEERING language.
const BOILERPLATE = [/AI-regenerate/i, /effective PPI/i, /overlap/i, /paneliz/i, /canonical master/i, /seam-sensitive/i, /vertical seam/i, /cross seams/i, /tile boundar/i, /4K master/i, /54-inch media/i, /vertical slice/i, /room mockup/i, /watermark/i, /repetition clusters/i];

describe('WallPro batch creative brief', () => {
  it('sends the model zero production-pipeline text, for every one of the 500 library rows', () => {
    for (const e of LIB) {
      const brief = batchCreativeBrief(e);
      for (const re of BOILERPLATE) expect(brief, `${e.id}: ${re}`).not.toMatch(re);
    }
  });
  it('keeps the literal concept, the palette, the room and a named medium in every brief', () => {
    for (const e of LIB) {
      const brief = batchCreativeBrief(e);
      const concept = e.prompt.match(/Concept:\s*(.*?)\.\s*Visual language:/)?.[1];
      expect(concept, e.id).toBeTruthy();
      expect(brief.toLowerCase(), e.id).toContain(concept!.toLowerCase());
      expect(brief, e.id).toContain(e.palette);
      expect(brief.toLowerCase(), e.id).toContain(e.room.toLowerCase());
      expect(brief.length, e.id).toBeGreaterThan(250);
      expect(brief.length, e.id).toBeLessThan(1200);
    }
  });
  it('names a real medium/technique for all eight design types and a scale for all three intensities', () => {
    const types = new Set(LIB.map((e) => e.designType));
    expect(types.size).toBe(8);
    const expectedMediumWord: Record<string, RegExp> = {
      'Painterly Mural': /dry-brush|gouache/, 'Illustrative Mural': /block-print|linocut/, 'Panoramic Mural': /chinoiserie|woodblock/,
      'Feature Wall Art': /cut-paper|screen-print/, 'Seamless Repeat Pattern': /vector|screen-print/, 'Graphic Geometry': /geometric/,
      'Photographic Fine Art': /photographic/, 'Architectural Surface': /plaster|stone|limewash/,
    };
    for (const t of types) {
      const e = LIB.find((x) => x.designType === t)!;
      const brief = batchCreativeBrief(e);
      expect(brief, t).toMatch(expectedMediumWord[t]);
      // The owner's reference set (2026-09-14) is flat graphic print without
      // exception; only the two explicitly photoreal types are exempt.
      if (t === 'Photographic Fine Art' || t === 'Architectural Surface') expect(brief, t).not.toMatch(/flat graphic print artwork/);
      else { expect(brief, t).toMatch(/flat graphic print artwork/); expect(brief, t).toMatch(/no gradients, no soft shading, no photorealism/); }
    }
    for (const i of ['Quiet', 'Balanced', 'Statement'] as const) {
      const e = LIB.find((x) => x.intensity === i)!;
      expect(batchCreativeBrief(e)).toMatch(/Scale: .+\./);
    }
  });
  it('reads as a residential listing for B2C rows and a commercial commission for B2B rows', () => {
    const home = LIB.find((e) => e.segment === 'B2C')!, biz = LIB.find((e) => e.segment === 'B2B')!;
    expect(batchCreativeBrief(home)).toMatch(/in a home/);
    expect(batchCreativeBrief(biz)).toMatch(/business/);
  });
  it('still fits the whole assembled designer prompt under the 4K ceiling, even for the longest brief on a repeat tile', () => {
    const longest = [...LIB].sort((a, b) => batchCreativeBrief(b).length - batchCreativeBrief(a).length)[0];
    const mode = engineForDesignType(longest.designType);
    const text = wallDesignPrompt({ prompt: batchCreativeBrief(longest), width: 96, height: 96, placement: mode === 'repeat' ? 'repeat' : 'cover', repeatWidthIn: mode === 'repeat' ? 48 : undefined, libraryIndustry: longest.industry, libraryRoom: longest.room, libraryStyle: longest.style });
    expect(text.length).toBeLessThan(4000);
    // Three representative briefs, printed so a human can read what the
    // model now receives instead of trusting the assertions above.
    for (const id of ['WPB-0001', 'WPB-0007', 'WPB-0481']) { const e = LIB.find((x) => x.id === id); if (e) console.log(`\n[${id} · ${e.designType} · ${e.segment}]\n${batchCreativeBrief(e)}`); }
  });
});
