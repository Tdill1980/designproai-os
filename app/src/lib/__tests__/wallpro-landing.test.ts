import { describe, expect, it } from 'vitest';
import { resolveLandingMedia, validLandingUrl, validateLandingMedia } from '../wallpro-landing-content';

describe('WallPro public media boundaries', () => {
  it('rejects executable, insecure, credential-bearing and traversal URLs', () => {
    for (const url of ['javascript:alert(1)', 'data:image/svg+xml,evil', 'http://example.com/a.jpg', 'https://user:secret@example.com/a.jpg', '/wallpro/../private', '//example.com/a.jpg']) expect(validLandingUrl(url)).toBe(false);
    expect(validLandingUrl('https://cdn.example.com/a.mp4?version=2')).toBe(true);
    expect(validLandingUrl('/wallpro/proof-spa-after.jpg')).toBe(true);
  });
  it('preserves explicitly hidden media instead of putting the default back', () => {
    const defaults = resolveLandingMedia();
    const media = resolveLandingMedia([{ ...defaults.residential, enabled: false, src: '' }]);
    expect(media.residential.enabled).toBe(false);
    expect(media.residential.src).toBe('');
    expect(media.commercial).toEqual(defaults.commercial);
  });
  it('reserves both video spaces without inventing footage', () => {
    const media = resolveLandingMedia();
    expect(media.process.src).toBe(''); expect(media.install.src).toBe('');
    expect(validateLandingMedia(media.process)).toBeNull();
    expect(validateLandingMedia({ ...media.residential, src: '' })).toMatch(/Choose an image/);
    expect(validateLandingMedia({ ...media.residential, alt: '' })).toMatch(/description/);
  });
});
