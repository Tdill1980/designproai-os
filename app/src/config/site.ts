/**
 * DesignProAI Site Configuration
 * Central configuration for branding, domains, and contact information
 */

export const SITE_CONFIG = {
  // Primary branding
  siteName: 'DesignProAI',
  siteNameFormatted: 'DesignProAI™',
  platformLabel: 'DesignProAI Visualizer Suite™',
  
  // Domain configuration
  primaryDomain: 'www.restyleproai.com',
  legacyDomain: 'weprintwraps.com',
  
  // Contact information
  supportEmail: 'support@restyleproai.com',
  salesEmail: 'sales@restyleproai.com',
  
  // Commerce
  enableStripeCheckout: true,
  wooCommerceEnabled: true, // Physical product fulfillment still via WePrintWraps
  wooCommerceBaseUrl: 'https://weprintwraps.com',
  
  // Copyright
  copyrightHolder: 'DesignProAI.com',
  copyrightYear: 2025,
} as const;

export type SiteConfig = typeof SITE_CONFIG;
