// The 15-job acceptance batch named in the owner spec (2026-09-13, section
// 10): 6 commercial disciplines + 9 residential styles/rooms. This test
// verifies what CAN be verified without spending a real Gemini image
// request — that every job routes to the correct domain, the correct
// persona identity, a sensible space type, and (residential) the correct
// style label, and that every assembled prompt still respects the 4K
// character ceiling regardless of which persona it selects. It is NOT a
// visual-quality check: no image is generated here. See
// docs/wallpro/WALLPRO-COMMERCIAL-RESIDENTIAL-DESIGN-ENGINE.md for how to
// run these same 15 jobs for real in Admin WallPro Batch and what a human
// still has to look at before this counts as accepted.
import { describe, expect, it } from 'vitest';
import { wallDesignPrompt, type WallDesignContract } from '../../../../supabase/functions/generate-wall-design/prompt';
import { classifyWallDomain } from '../../../../supabase/functions/generate-wall-design/domain';

type AcceptanceJob = {
  label: string;
  prompt: string;
  width: number; height: number; placement: 'cover' | 'repeat';
  repeatWidthIn?: number;
  libraryIndustry?: string; libraryRoom?: string; libraryStyle?: string;
  expectDomain: 'commercial' | 'residential';
  expectSpaceType?: string;
  expectStyle?: string;
};

const COMMERCIAL_JOBS: AcceptanceJob[] = [
  { label: '1. Modern restaurant', prompt: 'A modern Italian restaurant dining room feature wall: warm ochre plaster arches, olive branches, soft evening light.', width: 240, height: 108, placement: 'cover', libraryIndustry: 'Restaurants & Dining', libraryRoom: 'Main Dining Room', expectDomain: 'commercial', expectSpaceType: 'restaurant' },
  { label: '2. Corporate office', prompt: 'A corporate office reception wall: abstract brand-forward geometric forms in navy and brushed steel, understated and professional.', width: 180, height: 108, placement: 'cover', libraryIndustry: 'Corporate Offices & Coworking', libraryRoom: 'Reception', expectDomain: 'commercial', expectSpaceType: 'corporate_office' },
  { label: '3. Apartment leasing/clubhouse', prompt: 'An apartment clubhouse feature wall: warm travertine ribbons and oversized organic arches, hospitality-grade finish.', width: 216, height: 108, placement: 'cover', libraryIndustry: 'Multifamily & Apartments', libraryRoom: 'Clubhouse', expectDomain: 'commercial', expectSpaceType: 'multifamily' },
  { label: '4. Church/worship space', prompt: 'A modern worship hall foyer backdrop: warm, intentional and reverent — soft radiating light forms, no religious clip art.', width: 300, height: 132, placement: 'cover', libraryIndustry: 'Faith, Senior Living & Community', libraryRoom: 'Worship Hall Foyer', expectDomain: 'commercial', expectSpaceType: 'worship' },
  { label: '5. Med spa', prompt: 'A med spa treatment hallway: sage green botanical leaves, soft neutral background, calm and clinical-luxury mood.', width: 96, height: 108, placement: 'cover', libraryIndustry: 'Med Spas & Beauty Clinics', libraryRoom: 'Hallway', expectDomain: 'commercial', expectSpaceType: 'medspa' },
  { label: '6. Retail boutique', prompt: 'A fashion boutique feature wall behind the cash wrap: bold graphic geometry in the brand\'s black and gold, retail-forward.', width: 144, height: 108, placement: 'cover', libraryIndustry: 'Retail & Boutiques', libraryRoom: 'Cash Wrap', expectDomain: 'commercial', expectSpaceType: 'retail' },
];

const RESIDENTIAL_JOBS: AcceptanceJob[] = [
  { label: '7. Boho living room', prompt: 'A boho living room accent wall: rust and terracotta arches, woven-texture linework, warm and relaxed.', width: 142, height: 96, placement: 'cover', libraryIndustry: 'Homeowner Residential', libraryRoom: 'Living Room', libraryStyle: 'Boho', expectDomain: 'residential', expectSpaceType: 'living_room', expectStyle: 'Boho' },
  { label: '8. Organic Modern bedroom', prompt: 'An organic modern primary bedroom wall: soft curved botanical forms in sage and warm ivory, quiet and restful.', width: 132, height: 96, placement: 'cover', libraryIndustry: 'Homeowner Residential', libraryRoom: 'Primary Bedroom', libraryStyle: 'Organic Modern', expectDomain: 'residential', expectSpaceType: 'bedroom', expectStyle: 'Organic Modern' },
  { label: '9. Quiet Luxury dining room', prompt: 'A quiet luxury dining room wall: charcoal and blackened bronze abstract escarpments, restrained and elegant.', width: 156, height: 96, placement: 'cover', libraryIndustry: 'Homeowner Residential', libraryRoom: 'Dining Room', libraryStyle: 'Quiet Luxury', expectDomain: 'residential', expectSpaceType: 'dining_room', expectStyle: 'Quiet Luxury' },
  { label: '10. Japandi home office', prompt: 'A Japandi home office wall: warm wood-grain slat lines and a single ink-wash branch, calm and minimal.', width: 96, height: 96, placement: 'repeat', repeatWidthIn: 48, libraryIndustry: 'Homeowner Residential', libraryRoom: 'Home Office', libraryStyle: 'Japandi', expectDomain: 'residential', expectSpaceType: 'home_office', expectStyle: 'Japandi' },
  { label: '11. Modern Luxe bedroom', prompt: 'A modern luxe guest bedroom wall: deep emerald and brushed brass abstract forms, dramatic but livable.', width: 132, height: 96, placement: 'cover', libraryIndustry: 'Homeowner Residential', libraryRoom: 'Guest Bedroom', libraryStyle: 'Modern Luxe', expectDomain: 'residential', expectSpaceType: 'guest_room', expectStyle: 'Modern Luxe' },
  { label: '12. Vintage Botanical powder room', prompt: 'A vintage botanical powder room wall: dense layered fern and citrus illustration, moody and romantic.', width: 60, height: 96, placement: 'cover', libraryIndustry: 'Homeowner Residential', libraryRoom: 'Powder Room', libraryStyle: 'Vintage Botanical', expectDomain: 'residential', expectSpaceType: 'powder_room', expectStyle: 'Vintage Botanical' },
  { label: '13. Contemporary Classic living room', prompt: 'A contemporary classic living room wall: fluted plaster panel motif in warm white, timeless and architectural.', width: 168, height: 96, placement: 'cover', libraryIndustry: 'Homeowner Residential', libraryRoom: 'Living Room', libraryStyle: 'Contemporary Classic', expectDomain: 'residential', expectSpaceType: 'living_room', expectStyle: 'Contemporary Classic' },
  { label: '14. Nursery', prompt: 'A gender-neutral nursery wall: soft clouds and a crescent moon in muted sage and cream, whimsical but calm.', width: 108, height: 96, placement: 'cover', libraryIndustry: 'Nursery, Kids & Teen Residential', libraryRoom: 'Nursery', expectDomain: 'residential', expectSpaceType: 'nursery' },
  { label: '15. Modern tropical residential mural', prompt: 'A modern tropical residential mural for a sunroom: oversized monstera leaves in deep forest green, editorial scale.', width: 216, height: 108, placement: 'cover', libraryIndustry: 'Homeowner Residential', libraryRoom: 'Sunroom', libraryStyle: 'Modern Tropical', expectDomain: 'residential', expectSpaceType: 'living_room', expectStyle: 'Modern Tropical' },
];

const ALL_JOBS = [...COMMERCIAL_JOBS, ...RESIDENTIAL_JOBS];

describe('WallPro acceptance batch — routing verification (owner spec, section 10)', () => {
  it('classifies all 15 jobs to their expected domain and space type from library hints alone', () => {
    for (const job of ALL_JOBS) {
      const d = classifyWallDomain({ prompt: job.prompt, libraryIndustry: job.libraryIndustry, libraryRoom: job.libraryRoom, libraryStyle: job.libraryStyle });
      expect(d.designDomain, job.label).toBe(job.expectDomain);
      if (job.expectSpaceType) expect(d.commercialSpaceType || d.residentialSpaceType, job.label).toBe(job.expectSpaceType);
      if (job.expectStyle) expect(d.designStyle, job.label).toBe(job.expectStyle);
    }
  });
  it('sends every commercial job to the environmental-graphics persona and every residential job to the interior-design persona', () => {
    for (const job of COMMERCIAL_JOBS) {
      const text = wallDesignPrompt({ prompt: job.prompt, width: job.width, height: job.height, placement: job.placement, repeatWidthIn: job.repeatWidthIn, libraryIndustry: job.libraryIndustry, libraryRoom: job.libraryRoom, libraryStyle: job.libraryStyle });
      expect(text, job.label).toMatch(/Senior Environmental Graphic Designer and Large-Format Wrap Designer/);
      expect(text, job.label).not.toMatch(/Senior Residential Interior Designer/);
      expect(text.length, job.label).toBeLessThan(4000);
    }
    for (const job of RESIDENTIAL_JOBS) {
      const text = wallDesignPrompt({ prompt: job.prompt, width: job.width, height: job.height, placement: job.placement, repeatWidthIn: job.repeatWidthIn, libraryIndustry: job.libraryIndustry, libraryRoom: job.libraryRoom, libraryStyle: job.libraryStyle });
      expect(text, job.label).toMatch(/Senior Residential Interior Designer and Wallcovering Designer/);
      expect(text, job.label).not.toMatch(/Senior Environmental Graphic Designer/);
      expect(text.length, job.label).toBeLessThan(4000);
    }
  });
  it('carries a business contract shape through the designer prompt for a job with a full Design Contract (the actual live shape after persona 1 runs)', () => {
    const contract: WallDesignContract = {
      customerIntent: 'A boho living room accent wall with rust and terracotta arches.',
      requiredSubjects: [], requiredElements: ['rust arch motif', 'terracotta arch motif'], requiredColors: ['rust', 'terracotta'],
      businessContext: '', designObjective: 'custom residential mural', compositionDirection: 'Repeating arch motifs, warm and relaxed.',
      focalHierarchy: 'Arches are the dominant form.', negativeSpaceZones: 'Open ivory ground between arches.', realismLevel: 'flat illustration',
      typography: null, logoTreatment: null, mustPreserve: ['rust arch motif', 'terracotta arch motif'], forbiddenInventions: ['unrequested text', 'random additional motifs'],
      designDomain: 'residential', commercialSpaceType: null, residentialSpaceType: 'living_room', designStyle: 'Boho',
    };
    const text = wallDesignPrompt({ prompt: '', width: 142, height: 96, placement: 'cover', contract });
    expect(text).toMatch(/Senior Residential Interior Designer/);
    expect(text).toMatch(/BINDING DESIGN REQUIREMENTS/);
    expect(text).toMatch(/rust arch motif/);
    expect(text).toMatch(/Style guidance/);
    expect(text.length).toBeLessThan(4000);
  });
});
