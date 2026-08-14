import { SEOFAQPage } from "@/components/SEOFAQPage";
import { faqDesignProData } from "@/data/faqDesignPro";
import { getRelatedPages } from "@/data/faqRelatedPages";

const FAQDesignPro = () => (
  <SEOFAQPage
    title="DesignProAI™ & VisionBoardIQ™ FAQ - AI Wrap Design | DesignProAI™"
    headline="DesignProAI™ & VisionBoardIQ™ FAQ"
    description="Learn how DesignProAI™ creates custom AI-generated vehicle wrap designs from text prompts and VisionBoardIQ™ reference images. From concept to print-ready panels with Universal Panelizer."
    canonicalPath="/faq/designpro"
    badgeText="DesignProAI™ FAQ"
    faqs={faqDesignProData}
    relatedPages={getRelatedPages("/faq/designpro")}
  />
);

export default FAQDesignPro;
