import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

interface FAQProps {
  productName: string;
}

export const FAQ = ({ productName }: FAQProps) => {
  const getProductFAQs = () => {
    if (productName === "GraphicsPro") {
      return [
        {
          question: "What is GraphicsPro?",
          answer: "GraphicsPro is a prompt-based cut-contour graphics designer. Describe what you want and it produces production-ready cut-vinyl graphics for vehicles, storefront and office windows, and interior or exterior walls.",
        },
        {
          question: "What surfaces does GraphicsPro support?",
          answer: "Vehicle panels (doors, hoods, tailgates, side panels, rear windows), storefront and office glass, painted and textured walls, and other commercial surfaces like floors, A-frames, banners, and awnings.",
        },
        {
          question: "Is this for printed wraps or cut vinyl?",
          answer: "Cut vinyl. GraphicsPro is built for cut-contour graphics — solid colors with clean cut paths — not full printed wraps. Designs are tuned to cut and weed cleanly on a plotter.",
        },
        {
          question: "How does the prompt-based design work?",
          answer: "Type what you want (e.g. \"bold geometric racing stripes in matte black\" or \"window graphic for a downtown coffee shop with hours and phone number\") and GraphicsPro generates a photorealistic mockup on your selected surface, then a flat production file for cutting.",
        },
        {
          question: "Can I include a business name, logo, phone, or website?",
          answer: "Yes. Add your business info and choose which zones display logo, name, phone, website, tagline, or full contact. GraphicsPro can also generate a clean cut-vinyl-friendly logo for you if you don't have one.",
        },
        {
          question: "What do I get for production?",
          answer: "An approved on-surface mockup, a flat production artwork file, vectorized cut paths with a CutContour spot color, and a print/cut-ready PDF — everything your plotter or shop needs to produce the job.",
        },
        {
          question: "Can I upload reference images or my own artwork?",
          answer: "Yes. Upload artwork, a logo, or VisionBoard reference images and choose whether GraphicsPro should match them exactly or use them as style inspiration.",
        },
        {
          question: "How do I get started?",
          answer: "Join Club DesignProAI for a free trial render, then choose a plan that fits your shop. Cancel anytime, no contracts.",
        },
      ];
    }

    if (productName === "InkFusion") {
      return [
        {
          question: "What is InkFusion™?",
          answer: "InkFusion™ Vinyl is DesignProAI™'s proprietary ink formula delivering automotive paint-quality finishes on premium vinyl wrap material (375 sq ft roll on Avery SW900 cast vinyl with DOL1360 Max Gloss laminate).",
        },
        {
          question: "What makes InkFusion™ different from standard printed wraps?",
          answer: "AI-calibrated color matching on Avery SW900, proprietary verification, paint-like depth and consistency.",
        },
        {
          question: "Why does InkFusion™ look like automotive paint instead of vinyl?",
          answer: "Proprietary color calibration system optimizing ink density, metallic particle alignment, and gloss level.",
        },
        {
          question: "Can I order less than a full roll?",
          answer: "No. Sold in complete rolls (~24 yards, 375 sq ft) to maintain consistency.",
        },
        {
          question: "What finish options are available?",
          answer: "Gloss or Luster (same price). Matte available but not recommended.",
        },
        {
          question: "How long does InkFusion™ vinyl last?",
          answer: "7-9 years outdoor durability (vertical exposure) on Avery SW900.",
        },
        {
          question: "What's the turnaround time?",
          answer: "1-2 business days from order confirmation.",
        },
        {
          question: "Do you offer color matching for custom paint codes?",
          answer: "Yes, contact for custom calibration quote.",
        },
        {
          question: "Is InkFusion™ suitable for full vehicle wraps?",
          answer: "Absolutely. 375 sq ft per roll with excellent conformability.",
        },
        {
          question: "What's included with each roll?",
          answer: "~24 yards (375 sq ft) UV-printed SW900, DOL1360 overlaminate, calibration report, installation recommendations.",
        },
        {
          question: "Can I see a physical sample?",
          answer: "Yes, samples available separately.",
        },
        {
          question: "How does InkFusion™ compare to actual automotive paint?",
          answer: "Visually indistinguishable with same depth and gloss, but reversible and lower cost.",
        },
      ];
    }
    
    // Default FAQs for other products
    return [
      {
        question: `How does ${productName} work?`,
        answer: `${productName} uses advanced visualization technology to help you preview and design car wraps before installation.`,
      },
      {
        question: "What vehicles are supported?",
        answer: "We support thousands of vehicle makes and models with regular updates to our database.",
      },
      {
        question: "Can I share designs with clients?",
        answer: "Yes! All our tools include client sharing features for easy collaboration and approval.",
      },
      {
        question: "How do I get started?",
        answer: "Join Club DesignProAI to get 1 free render emailed to you. When you're ready, choose a plan that fits your shop's needs - cancel anytime, no contracts.",
      },
    ];
  };

  const faqs = getProductFAQs();

  return (
    <section className="container mx-auto px-4 py-16">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-3xl font-bold mb-8 text-center text-gray-900">
          Frequently Asked Questions
        </h2>

        <Accordion type="single" collapsible className="space-y-3">
          {faqs.map((faq, index) => (
            <AccordionItem
              key={index}
              value={`item-${index}`}
              className="bg-white border border-gray-200 rounded-lg px-6 shadow-sm"
            >
              <AccordionTrigger className="text-left hover:no-underline text-gray-900 font-semibold">
                {faq.question}
              </AccordionTrigger>
              <AccordionContent className="text-gray-700 leading-relaxed">
                {faq.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
};