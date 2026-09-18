import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/contexts/OrganizationContext', () => ({ useOrganization: () => ({ currentShop: null }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/proof-service', () => ({ generateAndSaveProof: vi.fn(), loadShopProfile: vi.fn() }));
vi.mock('@/lib/quickquote-db', () => ({ attachAsset: vi.fn() }));
vi.mock('./ShopTermsOnboardingWizard', () => ({ ShopTermsOnboardingWizard: () => null }));
vi.mock('./TwoDProofSheet', () => ({ TwoDProofSheet: () => null }));
vi.mock('./EmailConfigurator', () => ({ EmailConfigurator: () => null }));
import { ProfessionalProofSheet } from './ProfessionalProofSheet';

describe('shared customer proof', () => {
  it.each(['designpro', 'weprintwraps'] as const)('shows PatternPro %s with actual ordered yards and original images', brand => {
    const html = renderToStaticMarkup(<ProfessionalProofSheet toolKey="wbty" views={[{ type: 'side', url: 'driver.jpg' }, { type: 'hood_detail', url: 'hood.jpg' }]}
      vehicleYear="2024" vehicleMake="Ford" vehicleModel="Transit" designName="Forest" finish="Satin" coverageUnit="yards" designProof={{ brand, yards: 22 }} />);
    expect(html).toContain(brand === 'weprintwraps' ? 'WPW × PatternPro' : '>PatternPro<');
    expect(html).toContain(brand === 'weprintwraps' ? '® DesignProAI Software for WePrintWraps' : '>® DesignProAI Software<');
    expect(html).toContain('22 linear yards');
    expect(html).toContain('selected order quantity');
    expect(html.match(/src="driver.jpg"/g)).toHaveLength(1);
    expect(html.match(/src="hood.jpg"/g)).toHaveLength(1);
    expect(html).not.toContain('scaleX(-1)');
    expect(html).toContain('Email Proof');
    expect(html).toContain('>Share<');
    expect(html).toContain('>PDF<');
  });
  it.each(['designpro', 'weprintwraps'] as const)('uses the same approval and delivery controls for WallPro %s', brand => {
    const html = renderToStaticMarkup(<ProfessionalProofSheet views={['before', 'after', 'detail'].map(type => ({ type, url: `${type}.jpg` }))}
      designName="Studio wall" finish="Matte / Luster" designProof={{ tool: 'wallpro', brand, wall: { widthInches: 120, heightInches: 96, squareFeet: 80, linearFeet: 24.5, panels: 3 } }} />);
    expect(html).toContain(brand === 'weprintwraps' ? 'WPW × WallPro' : '>WallPro<');
    expect(html.indexOf('alt="Before"')).toBeLessThan(html.indexOf('alt="After"'));
    expect(html.indexOf('alt="After"')).toBeLessThan(html.indexOf('alt="Detail close-up"'));
    expect(html).not.toContain('Driver Side');
    expect(html).not.toContain('2D Proof');
    expect(html).not.toContain('Flat wall design');
    expect(html).toContain('120″ × 96″');
    expect(html).toContain('80 sq ft');
    expect(html).toContain('Customer Approval');
    expect(html).toContain('Email Proof');
    expect(html).toContain('>Share<');
    expect(html).toContain('>PDF<');
  });
});
