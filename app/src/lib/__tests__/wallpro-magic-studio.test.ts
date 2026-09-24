import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { WallProMagic } from '../../components/wallpro/WallProMagic';
import { DEFAULT_CASE_STUDY } from '../wallpro-case-studies';
import { DEFAULT_WALL_PRINT, planWallPrint } from '../wallpro-print-plan';
const source = readFileSync(fileURLToPath(new URL('../../components/wallpro/WallProMagic.tsx', import.meta.url)), 'utf8');
const css = readFileSync(fileURLToPath(new URL('../../components/wallpro/wallpro-magic.css', import.meta.url)), 'utf8');

describe('WallPro single-stage walkthrough', () => {
  it('opens on one full floral-room image, not five competing thumbnails', () => {
    const html = renderToStaticMarkup(React.createElement(WallProMagic));
    expect((html.match(/<image /g) || []).length).toBe(1);
    expect(html).toContain('/wallpro/studio-floral-preview.jpg');
    expect(html).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(html).not.toContain('<article');
  });
  it('retains five keyboard-accessible steps and the existing upload anchor', () => {
    const html = renderToStaticMarkup(React.createElement(WallProMagic));
    expect((html.match(/aria-controls="wallpro-magic-stage"/g) || []).length).toBe(5);
    expect(html).toContain('href="#upload-wall"');
    expect(source).toContain("event.key === 'ArrowRight'");
    expect(source).toContain('aria-pressed={protectedNow}');
  });
  it('shows an explicitly labelled example with opt-in, pausable playback', () => {
    const html = renderToStaticMarkup(React.createElement(WallProMagic));
    expect(html).toContain('INTERACTIVE EXAMPLE');
    expect(html).toContain('Play the 20-second walkthrough');
    expect(source).toContain('playing: false');
    expect(source).toContain('prefers-reduced-motion: reduce');
    expect(source).toContain('componentWillUnmount');
    expect(source).toContain('document.hidden');
  });
  it('shows flat artwork and uses the real planner, not seam lines over furniture', () => {
    expect(source).toContain('planWallPrint(study.wall.widthIn, study.wall.heightIn, DEFAULT_WALL_PRINT)');
    expect(source).toContain('href={study.photos.artwork!}');
    const wall = DEFAULT_CASE_STUDY.wall!;
    const plan = planWallPrint(wall.widthIn, wall.heightIn, DEFAULT_WALL_PRINT);
    expect(plan.panels).toHaveLength(3);
    expect(plan.settings.bleed).toBe(0.5);
    expect(plan.panels.every(panel => panel.height === wall.heightIn + 1)).toBe(true);
  });
  it('has no customer-project, auth, checkout, storage, or generation calls', () => {
    expect(source).not.toMatch(/supabase|fetch\(|localStorage|startWallProCheckout|requestWallProduction/);
    expect(css).not.toMatch(/(?:^|\n)(?:\.wall-card|\.wall-field|:root|body|button|input)\s*\{/);
    expect(css).toContain('[data-wall-theme="dark"] .wallpro-magic');
  });
  it('preserves the supplied room edges instead of the old 1400×803 crops', async () => {
    const original = await sharp(fileURLToPath(new URL('../../../public/wallpro/studio-original.jpg', import.meta.url))).metadata();
    const preview = await sharp(fileURLToPath(new URL('../../../public/wallpro/studio-floral-preview.jpg', import.meta.url))).metadata();
    expect([original.width, original.height]).toEqual([1253,1122]);
    expect([preview.width, preview.height]).toEqual([1254,1254]);
  });
  it('ships the two matching high-resolution gym images', async () => {
    for (const filename of ['proof-gym-before.jpg', 'proof-gym-after.jpg']) {
      const meta = await sharp(fileURLToPath(new URL('../../../public/wallpro/' + filename, import.meta.url))).metadata();
      expect([meta.width, meta.height]).toEqual([1536,1024]);
    }
  });
});
