import { describe, expect, it } from 'vitest';
import { isDesignProMarketingHost, isWallProPartnerHost } from '../designpro-host-routing';

describe('the WallPro partner host', () => {
  // The whole point of the subdomain: a customer who clicked "Wall Wrap" on
  // weprintwraps.com stays on weprintwraps.com. Its ROOT is the wall wrap page.
  it('recognises wallpro.weprintwraps.com', () => {
    expect(isWallProPartnerHost('wallpro.weprintwraps.com')).toBe(true);
    expect(isWallProPartnerHost('WallPro.WePrintWraps.com')).toBe(true);
    // Browsers can hand over the DNS root dot.
    expect(isWallProPartnerHost('wallpro.weprintwraps.com.')).toBe(true);
  });

  // A partner host must be EXACT. Matching weprintwraps.com itself would take
  // over their storefront root, and a suffix match would hand any lookalike
  // domain the partner experience.
  it('claims nothing it was not given', () => {
    expect(isWallProPartnerHost('weprintwraps.com')).toBe(false);
    expect(isWallProPartnerHost('quote.weprintwraps.com')).toBe(false);
    expect(isWallProPartnerHost('wallpro.weprintwraps.com.evil.example')).toBe(false);
    expect(isWallProPartnerHost('notwallpro.weprintwraps.com')).toBe(false);
    expect(isWallProPartnerHost('os.designproai.com')).toBe(false);
  });

  // The two host checks must stay disjoint, or the root render is ambiguous.
  it('never overlaps the DesignProAI marketing hosts', () => {
    for (const host of ['designproai.com', 'www.designproai.com']) {
      expect(isDesignProMarketingHost(host)).toBe(true);
      expect(isWallProPartnerHost(host)).toBe(false);
    }
    expect(isDesignProMarketingHost('wallpro.weprintwraps.com')).toBe(false);
  });
});
