import { SEOFAQPage } from "@/components/SEOFAQPage";
import { faqVehicleTypesData } from "@/data/faqVehicleTypes";
import { getRelatedPages } from "@/data/faqRelatedPages";

const FAQVehicleTypes = () => (
  <SEOFAQPage
    title="Supported Vehicles FAQ - Cars, Trucks, SUVs & More | RestyleProAI™"
    headline="Supported Vehicles FAQ"
    description="See what vehicles you can render wraps on with RestyleProAI™. Covers cars, trucks, SUVs, vans, EVs, sports cars, and commercial vehicles from all major makes and models."
    canonicalPath="/faq/vehicles"
    badgeText="Supported Vehicles FAQ"
    faqs={faqVehicleTypesData}
    relatedPages={getRelatedPages("/faq/vehicles")}
  />
);

export default FAQVehicleTypes;
