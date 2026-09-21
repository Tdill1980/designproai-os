/**
 * A case study may not quote a measurement it does not have.
 *
 * The page's own guarantee is that every number on it is produced by the same
 * functions the tool runs — so it "cannot lie about the product because it is
 * running the product". That holds only while the WALL INCHES are real. A study
 * with no measured wall is therefore unpublished rather than estimated.
 */
import { describe, it, expect } from 'vitest';
import {
  ALL_CASE_STUDIES, publishedCaseStudies, caseStudyForSlug, caseStudyPath, DEFAULT_CASE_STUDY,
} from '../wallpro-case-studies';

describe('publication requires a measured wall', () => {
  it('never publishes a study without wall inches', () => {
    for (const study of publishedCaseStudies()) {
      expect(study.wall, study.key).not.toBeNull();
      expect(study.wall!.widthIn).toBeGreaterThan(0);
      expect(study.wall!.heightIn).toBeGreaterThan(0);
    }
  });

  it('keeps the gym out until somebody measures it', () => {
    const gym = ALL_CASE_STUDIES.find(s => s.key === 'gym')!;
    expect(gym.wall).toBeNull();
    expect(publishedCaseStudies().map(s => s.key)).not.toContain('gym');
  });

  it('still ships the studio, which is measured', () => {
    expect(publishedCaseStudies().map(s => s.key)).toContain('studio');
    expect(DEFAULT_CASE_STUDY.wall).toEqual({ widthIn: 142, heightIn: 96 });
  });
});

describe('slug resolution is total', () => {
  it('falls back to the default rather than 404ing', () => {
    for (const slug of [undefined, '', 'nope', 'gym']) {
      expect(caseStudyForSlug(slug).key).toBe(DEFAULT_CASE_STUDY.key);
    }
  });

  it('resolves a published slug to its own study once one exists', () => {
    // Guards the mechanism without waiting on the gym's tape measure.
    const published = publishedCaseStudies();
    for (const study of published) expect(caseStudyForSlug(study.slug).key).toBe(study.key);
  });
});

describe('paths stay on the right brand', () => {
  it('sends the partner to /wall-wrap and DesignProAI to /printpro/wallpro', () => {
    expect(caseStudyPath(DEFAULT_CASE_STUDY, 'weprintwraps')).toBe('/wall-wrap/how-it-works');
    expect(caseStudyPath(DEFAULT_CASE_STUDY, 'designpro')).toBe('/printpro/wallpro/how-it-works');
  });

  it('appends the slug for a non-default study', () => {
    const gym = ALL_CASE_STUDIES.find(s => s.key === 'gym')!;
    expect(caseStudyPath(gym, 'weprintwraps')).toBe('/wall-wrap/how-it-works/gym');
  });
});

describe('every study is renderable', () => {
  it('has photographs and alt text for each figure', () => {
    for (const s of ALL_CASE_STUDIES) {
      expect(s.photos.before, s.key).toMatch(/^\/wallpro\/.+\.(jpg|png|webp)$/);
      expect(s.photos.after, s.key).toMatch(/^\/wallpro\/.+\.(jpg|png|webp)$/);
      for (const key of ['before', 'after', 'mask', 'artwork', 'installed'] as const) {
        expect(s.alt[key].length, `${s.key}.${key}`).toBeGreaterThan(10);
      }
      expect(s.brief.length).toBeGreaterThan(10);
      expect(s.tab.length).toBeGreaterThan(0);
    }
  });

  it('gives every study a distinct key and slug', () => {
    expect(new Set(ALL_CASE_STUDIES.map(s => s.key)).size).toBe(ALL_CASE_STUDIES.length);
    expect(new Set(ALL_CASE_STUDIES.map(s => s.slug)).size).toBe(ALL_CASE_STUDIES.length);
  });
});
