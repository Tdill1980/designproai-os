import { SEOFAQPage } from "@/components/SEOFAQPage";
import { faqColorProData } from "@/data/faqColorPro";
import { getRelatedPages } from "@/data/faqRelatedPages";

const FAQColorPro = () => (
  <SEOFAQPage
    title="ColorPro™ FAQ - Vehicle Color Wrap Visualization | DesignProAI™"
    headline="ColorPro™ Frequently Asked Questions"
    description="Learn how ColorPro™ helps wrap shops visualize solid color vinyl wraps on any vehicle with photorealistic AI renders. Manufacturer-matched colors from 3M, Avery Dennison, KPMF, Inozetek, and more."
    canonicalPath="/faq/colorpro"
    badgeText="ColorPro™ FAQ"
    faqs={faqColorProData}
    relatedPages={getRelatedPages("/faq/colorpro")}
  />
);

export default FAQColorPro;
