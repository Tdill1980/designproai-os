import { SEOFAQPage } from "@/components/SEOFAQPage";
import { faqPricingData } from "@/data/faqPricing";
import { getRelatedPages } from "@/data/faqRelatedPages";

const FAQPricing = () => (
  <SEOFAQPage
    title="Pricing & Plans FAQ - Vehicle Wrap Software Pricing | DesignProAI™"
    headline="Pricing & Plans FAQ"
    description="Learn about DesignProAI™ subscription plans, render allowances, extra render pricing, and billing. Plans for every wrap shop size - no contracts, cancel anytime."
    canonicalPath="/faq/pricing"
    badgeText="Pricing & Plans FAQ"
    faqs={faqPricingData}
    relatedPages={getRelatedPages("/faq/pricing")}
  />
);

export default FAQPricing;
