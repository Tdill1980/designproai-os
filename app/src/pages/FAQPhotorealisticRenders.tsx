import { SEOFAQPage } from "@/components/SEOFAQPage";
import { faqPhotorealisticRendersData } from "@/data/faqPhotorealisticRenders";
import { getRelatedPages } from "@/data/faqRelatedPages";

const FAQPhotorealisticRenders = () => (
  <SEOFAQPage
    title="Photorealistic Vehicle Wrap Renders FAQ - AI Rendering Quality | DesignProAI™"
    headline="Photorealistic Renders FAQ"
    description="Learn how DesignProAI™ generates studio-quality photorealistic vehicle wrap renders using AI. Covers resolution, lighting, finishes, camera angles, VisionBoardIQ™, and render accuracy."
    canonicalPath="/faq/photorealistic-renders"
    badgeText="Photorealistic Renders FAQ"
    faqs={faqPhotorealisticRendersData}
    relatedPages={getRelatedPages("/faq/photorealistic-renders")}
  />
);

export default FAQPhotorealisticRenders;
