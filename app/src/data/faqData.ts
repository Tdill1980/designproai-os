export type FAQCategory = 'general' | 'tools' | 'pricing' | 'technical' | 'business';

export interface FAQItem {
  question: string;
  answer: string;
  category: FAQCategory;
}

export const faqCategories: { id: FAQCategory; label: string; description: string }[] = [
  { id: 'general', label: 'General', description: 'Overview & basics' },
  { id: 'tools', label: 'Tools', description: 'Design tools' },
  { id: 'pricing', label: 'Pricing & Plans', description: 'Subscriptions & billing' },
  { id: 'technical', label: 'Technical', description: 'Features & formats' },
  { id: 'business', label: 'Business', description: 'Client & shop tools' },
];

export const faqData: FAQItem[] = [
  // GENERAL - 10 questions
  {
    question: "What is DesignProAI™ Vehicle Wrap Design Suite?",
    answer: "DesignProAI is a complete Vehicle Wrap Design System — it's like having a custom vehicle wrap designer at your fingertips. From prompt to production. No designer. No outsourcing. No waiting. Built for wrap shops, sign companies, and the restyling trade.",
    category: 'general',
  },
  {
    question: "Who is DesignProAI built for?",
    answer: "DesignProAI is designed for wrap shops, PPF installers, tint shops, car dealerships, automotive designers, fleet managers, and car enthusiasts who want to visualize vehicle modifications before committing to installation.",
    category: 'general',
  },
  {
    question: "What tools are included in the suite?",
    answer: "The suite includes professional tools: ColorPro™ for solid color wraps, RestyleLibrary™ for curated panel designs, DesignProAI™ for AI-powered custom wraps, FadeWraps™ for gradient effects, PatternPro™ for pattern applications, ApprovePro™ for client approvals, and MaterialMode™ for material comparisons.",
    category: 'general',
  },
  {
    question: "How accurate are the visualizations?",
    answer: "Our AI renders real manufacturer vinyl film — not flat color overlays. The engine reproduces specular highlights (the bright reflections where light hits the surface), metallic depth (the visual layers of flake under clear coat), and material-accurate finish behavior (how gloss reflects differently than satin or matte). A 3M Gloss Hot Rod Red looks different from an Avery Gloss Cardinal Red because they're different films with different material properties. This is what closes deals — the customer sees exactly what they're buying.",
    category: 'general',
  },
  {
    question: "What is ColorPro™ and how does it work?",
    answer: "ColorPro is our manufacturer film visualizer. It renders real vinyl wrap film from 3M, Avery Dennison, KPMF, Hexis, Inozetek, and more — with studio lighting, specular highlights, and material-accurate finish depth. This isn't color-matching a hex code. The AI renders the actual film characteristics: metallic flake density, color shift angle, laminate sheen, and vinyl texture grain. Studio mode renders in a controlled lighting environment; MyVehiclePro mode renders on your customer's actual photos.",
    category: 'tools',
  },
  {
    question: "What is MyVehiclePro™?",
    answer: "MyVehiclePro lets you upload photos of your customer's actual vehicle — up to 6 angles — and see real manufacturer film applied directly to it. The AI responds to real-world lighting: a cloudy day photo shows the matte base tone, a sunny photo shows the metallic flake and specular shimmer. This is the difference between showing a customer a generic stock render vs showing them THEIR vehicle in THEIR driveway with the exact film they're considering.",
    category: 'tools',
  },
  {
    question: "Why does the wrap look different on cloudy vs sunny photos in MyVehiclePro?",
    answer: "Because real vinyl wrap film responds to real lighting — and so does our AI. On a cloudy day, diffused light shows the base color and smooth finish. On a sunny day, direct light creates specular highlights, reveals metallic flake depth, and shows how the film interacts with body curves. This is material response — the same physics that makes a satin wrap look completely different at noon vs sunset. Your customer sees what the wrap actually looks like in their conditions, not just under studio lights.",
    category: 'technical',
  },
  {
    question: "What vehicles are supported?",
    answer: "DesignProAI supports a wide range of popular vehicles including cars, trucks, SUVs, and specialty vehicles. Our library is continuously expanding with new makes and models added regularly based on user demand.",
    category: 'general',
  },
  {
    question: "How fast are renders generated?",
    answer: "Most renders are generated in seconds, allowing you to show clients multiple options quickly during consultations. Complex designs or high-resolution outputs may take slightly longer.",
    category: 'general',
  },
  {
    question: "What's included with every render?",
    answer: "Every render includes 6 professional views (front, rear, side, 3/4 angles), downloadable high-resolution images, and shareable links. Pro plans also include approval proof sheets and film documentation.",
    category: 'general',
  },
  {
    question: "Do renders include watermarks?",
    answer: "Free tier renders may include subtle watermarks. Paid plans provide watermark-free renders suitable for client presentations and marketing materials.",
    category: 'general',
  },
  {
    question: "Is there a mobile app?",
    answer: "DesignProAI is a web-based platform that works on any device with a modern browser. This means you can access all tools from your phone, tablet, or computer without downloading anything.",
    category: 'general',
  },
  {
    question: "Can I use DesignProAI offline?",
    answer: "DesignProAI requires an internet connection to generate renders and access the color library. However, you can save and download your renders for offline viewing and sharing.",
    category: 'general',
  },

  // TOOLS - 8 questions
  {
    question: "What is ColorPro™?",
    answer: "ColorPro™ is our flagship solid color visualization tool. It lets you apply any vinyl wrap color to a vehicle and see photorealistic results instantly. Features include manufacturer color matching, finish selection (gloss, matte, satin), and multi-angle previews.",
    category: 'tools',
  },
  {
    question: "What is DesignProAI™?",
    answer: "DesignProAI™ is the world's first AI Design-to-Print production system. Create custom AI-generated wrap designs with DesignIQ™, render them on any vehicle in 6 photorealistic views, then generate production-ready panel files with Universal Panelizer. RestyleLibrary™ provides curated panel designs for the same workflow.",
    category: 'tools',
  },
  {
    question: "What is FadeWraps™?",
    answer: "FadeWraps™ is our gradient and fade effect tool. Create stunning color transitions, racing stripes, and custom fade patterns that flow seamlessly across vehicle surfaces. Perfect for creating eye-catching custom designs.",
    category: 'tools',
  },
  {
    question: "What is PatternPro™?",
    answer: "PatternPro™ (also known as WBTY - Wrap Before They're Yours) lets you apply patterns like carbon fiber, brushed metal, camo, and custom graphics to vehicles. Preview how textured and patterned wraps will look before ordering materials.",
    category: 'tools',
  },
  {
    question: "What is ApprovePro™?",
    answer: "ApprovePro™ is our client approval and presentation tool. Generate professional proof sheets, create before/after comparisons, and send approval requests to clients. Streamlines the approval process and reduces miscommunication.",
    category: 'tools',
  },
  {
    question: "What is MaterialMode™?",
    answer: "MaterialMode™ helps you compare different materials and finishes side-by-side. See how the same color looks in gloss vs matte vs satin, or compare options from different manufacturers to find the perfect match for your client.",
    category: 'tools',
  },
  {
    question: "Can I switch between tools easily?",
    answer: "Yes! All tools are integrated into a seamless workflow. You can start with ColorPro™ to pick a base color, use RestyleLibrary™ or DesignProAI™ for custom designs, and finish with ApprovePro™ for client presentation-all without losing your work.",
    category: 'tools',
  },
  {
    question: "Do all tools use the same color library?",
    answer: "Yes, our comprehensive color library is shared across all tools. This ensures consistency whether you're doing solid wraps, accents, fades, or patterns. The library includes colors from major manufacturers worldwide.",
    category: 'tools',
  },

  // PRICING - 10 questions
  {
    question: "How much does DesignProAI cost?",
    answer: "Four paid tiers, all with shared render quotas across the entire suite: Starter $350/mo (50 renders), DesignPro Lite $499/mo (75 renders + MyVehiclePro + DesignProAI), DesignPro Studio $699/mo (150 renders + real human designer), and DesignPro Plus $995/mo (300 renders + 24-hr priority designer). Extra renders are $25 each on Free/Starter/Lite and $15 each on Studio/Plus. Production Packs are sold separately: $299 retail, $249 for Studio subscribers, $199 for Plus subscribers. WePrintWraps customers get $50/mo off every tier. Visit /pricing for the full breakdown.",
    category: 'pricing',
  },
  {
    question: "What's included in the Starter plan?",
    answer: "Starter ($350/mo) includes 50 renders per month — combined usage across ColorPro, PatternPro, FadeWraps, RestyleLibrary, and RevisionStudioIQ. Built for solo operators, mobile installers, and 1-2 person shops. Extra renders are $5 each. Note: Starter does NOT include MyVehiclePro — upgrade to DesignPro Lite to add the customer-photo demo tool.",
    category: 'pricing',
  },
  {
    question: "What's included in DesignPro Lite?",
    answer: "DesignPro Lite ($499/mo) includes 75 renders per month and everything in Starter, plus MyVehiclePro (apply designs to your customer's actual vehicle photo), ApprovePro, PrintPro, ProductionFlow, RevisionStudioIQ, WrapBox, and MightyMail retargeting. Built for brick-and-mortar shops doing customer demos with photos. Extra renders are $5 each.",
    category: 'pricing',
  },
  {
    question: "What's included in DesignPro Studio?",
    answer: "DesignPro Studio ($699/mo) is the Design OS — 150 renders per month with a real human graphic designer outputting your files in 48 hours. Everything in Lite plus DesignProAI, GraphicsPro, RecreatePro, and CreatorMarket publisher access (list and sell your wraps to every DesignProAI shop, keep 60% of every sale). Production Packs are sold separately at $249 each (subscriber discount, save $50 vs $299 retail). Extra renders are $15 each (top-tier discount, 40% off retail).",
    category: 'pricing',
  },
  {
    question: "What's included in DesignPro Plus?",
    answer: "DesignPro Plus ($995/mo) is for high-volume shops with priority needs. Everything in Studio plus 24-hour priority designer turnaround and 300 renders per month. Production Packs are sold separately at $199 each (best subscriber discount, save $100 vs $299 retail). Extra renders are $15 each (top-tier discount, 40% off retail).",
    category: 'pricing',
  },
  {
    question: "Do I get free renders to try?",
    answer: "Yes. Every new account starts in free try mode — explore the toolkit before committing to a plan. Share us on social to unlock bonus renders. WePrintWraps customers get 1 free render of their choice (any tool except DesignPro) on top of free CMS and free quoting.",
    category: 'pricing',
  },
  {
    question: "What happens after I use my free renders?",
    answer: "You can buy single renders à la carte at $25 each, or upgrade to any paid plan starting at $350/mo for 50 renders. Your saved designs and account data are preserved when you upgrade.",
    category: 'pricing',
  },
  {
    question: "Can I buy additional renders?",
    answer: "Yes. Every paid tier — Starter, DesignPro Lite, Studio, and Plus — bills extra renders at $5 each via Stripe metered billing once you exceed your monthly cap. Charged only when used, available instantly. Non-subscribers can buy single renders à la carte at $25 each.",
    category: 'pricing',
  },
  {
    question: "Do WePrintWraps customers get a discount?",
    answer: "Yes. WPW customers get free CMS publishing, free customer quoting, easy reorder from past WPW jobs, and a $50/mo loyalty discount on every paid tier — Starter $300/mo, DesignPro Lite $449/mo, Studio $649/mo, Plus $945/mo. Plus 1 free render of choice for sharing us on social or signing up.",
    category: 'pricing',
  },
  {
    question: "Can I upgrade or downgrade my plan?",
    answer: "Yes. You can change your plan any time. Upgrades take effect immediately with prorated billing. Downgrades apply at the start of your next billing cycle. No long-term contracts.",
    category: 'pricing',
  },
  {
    question: "Is there a contract or commitment?",
    answer: "No long-term contracts. All plans are month-to-month with the flexibility to cancel anytime. Annual plans are available at a discounted rate for shops that prefer to pay yearly.",
    category: 'pricing',
  },

  // TECHNICAL - 8 questions
  {
    question: "What is InkFusion™?",
    answer: "InkFusion™ is our exclusive color-matching system that ensures the colors you see on screen accurately represent real-world vinyl materials. It incorporates manufacturer specifications to deliver true-to-life color accuracy.",
    category: 'technical',
  },
  {
    question: "What vinyl brands are supported?",
    answer: "DesignProAI includes colors from leading manufacturers including 3M, Avery Dennison, KPMF, Inozetek, Oracal, TeckWrap, and more. Our library is continuously updated with new releases.",
    category: 'technical',
  },
  {
    question: "What are LAB color values and why do they matter?",
    answer: "LAB color values are a device-independent color space that describes colors as humans perceive them. We use LAB values to ensure accurate color representation across different screens and devices.",
    category: 'technical',
  },
  {
    question: "Can I upload my own swatches or patterns?",
    answer: "DesignPro Lite and above include the ability to upload custom swatches, patterns, and graphics. This is perfect for shops that work with specialty materials or want to preview custom printed wraps.",
    category: 'technical',
  },
  {
    question: "What image formats are supported for downloads?",
    answer: "Renders can be downloaded in high-resolution PNG and JPEG formats. Pro plans also include PDF export for proof sheets and presentation materials.",
    category: 'technical',
  },
  {
    question: "How do I download my renders?",
    answer: "After generating a render, click the download button to save high-resolution images to your device. You can also share renders via link or email directly from the platform.",
    category: 'technical',
  },
  {
    question: "What browsers are supported?",
    answer: "DesignProAI works best on modern browsers including Chrome, Firefox, Safari, and Edge. For optimal performance, we recommend keeping your browser updated to the latest version.",
    category: 'technical',
  },
  {
    question: "Is my data secure?",
    answer: "Yes, we take data security seriously. All data is encrypted in transit and at rest. Your designs and client information are private and never shared with third parties.",
    category: 'technical',
  },

  // BUSINESS - 7 questions
  {
    question: "Can I use renders for client presentations?",
    answer: "Absolutely! DesignProAI renders are designed for professional client presentations. Paid plans include high-resolution, watermark-free images perfect for showing clients exactly what their vehicle will look like.",
    category: 'business',
  },
  {
    question: "What is the Approval Proof Sheet?",
    answer: "The Approval Proof Sheet is a professional document that includes all vehicle views, color/material specifications, and a signature area for client approval. It helps prevent misunderstandings and protects both you and your client.",
    category: 'business',
  },
  {
    question: "Can I add my logo and branding to renders?",
    answer: "DesignPro Lite and above include shop branding options. Add your logo to renders and proof sheets to maintain a professional, branded experience for your clients.",
    category: 'business',
  },
  {
    question: "Can I export renders as PDFs?",
    answer: "Yes, every paid plan includes PDF export functionality for proof sheets, quotes, and presentation materials. Generate professional documents ready for client review and approval.",
    category: 'business',
  },
  {
    question: "Do you offer team or enterprise plans?",
    answer: "Yes — every paid tier includes unlimited users on the same subscription. For larger multi-location organizations or custom enterprise needs, contact our sales team for tailored solutions.",
    category: 'business',
  },
  {
    question: "What if I don't have a way to print the wrap designs?",
    answer: "Just click on PrintPro Suite — a dedicated wholesale printing service from trusted WePrintWraps.com. Ships all over the USA.",
    category: 'business',
  },
  {
    question: "What is CreatorMarket?",
    answer: "CreatorMarket is a way to generate additional revenue on your designs. Use your DesignVault design equity and get paid! Sell unlimited times in CreatorMarket — 60% to you and 40% to the platform on every sale.",
    category: 'business',
  },
  {
    question: "How can DesignProAI help me close more sales?",
    answer: "By showing clients exactly what their vehicle will look like before ordering materials, DesignProAI builds confidence, reduces hesitation, and helps close sales faster. Clients are more likely to commit when they can visualize the end result.",
    category: 'business',
  },
];
