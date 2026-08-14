import type { SEOFAQItem } from "@/components/SEOFAQPage";

export const faqVehicleTypesData: SEOFAQItem[] = [
  {
    question: "What types of vehicles can I render wraps on with RestyleProAI™?",
    answer: "RestyleProAI™ now supports every major vehicle class. Pick a vehicle type with one tap: Car, Truck, SUV, Van, Motorcycle, Boat, Bus, or RV. Cars, trucks, SUVs, and vans use our 1,668-vehicle curated measurement database. Motorcycles, boats, buses, and RVs use Google-grounded AI dimension lookups that pull real specs from manufacturer sheets, dealer brochures, and OEM tech drawings — then cache the result for instant future renders. Any year, any make, any model — including vintage.",
  },
  {
    question: "What car brands are available in RestyleProAI™?",
    answer: "Our library includes vehicles from BMW, Mercedes-Benz, Audi, Porsche, Tesla, Ford, Chevrolet, GMC, Ram, Toyota, Honda, Lexus, Lamborghini, Ferrari, Dodge, Jeep, Nissan, Hyundai, Kia, Volkswagen, Subaru, Mazda, and many more. We continuously add new makes and models based on wrap industry demand.",
  },
  {
    question: "Can I render wraps on trucks and SUVs?",
    answer: "Yes. RestyleProAI™ fully supports trucks and SUVs - some of the most popular vehicles in the wrap industry. This includes Ford F-150, Ram 1500, Chevrolet Silverado, GMC Sierra, Toyota Tacoma, Ford Bronco, Jeep Wrangler, Chevrolet Tahoe, and many other truck and SUV models.",
  },
  {
    question: "Are sports cars and supercars available for renders?",
    answer: "Yes. Our vehicle library includes popular sports cars and supercars like Porsche 911, Chevrolet Corvette, Ford Mustang, Dodge Challenger, Lamborghini Huracán, BMW M4, Mercedes-AMG GT, Nissan GT-R, and more. These high-value vehicles are frequently wrapped by shops, so accurate visualization is essential.",
  },
  {
    question: "Can I render wraps on Tesla and other electric vehicles?",
    answer: "Absolutely. Tesla is one of the most frequently wrapped vehicle brands, and RestyleProAI™ includes Tesla Model 3, Model Y, Model S, Model X, and Cybertruck. We also support other EVs like the Rivian R1T, Ford Mustang Mach-E, Hyundai Ioniq, and BMW iX as they become popular in wrap shops.",
  },
  {
    question: "Does RestyleProAI™ support vans and commercial vehicles?",
    answer: "Yes. Commercial and fleet vehicles are a core part of the wrap industry. RestyleProAI™ supports cargo vans (Ford Transit, Mercedes Sprinter, Ram ProMaster), passenger vans, and commercial vehicles. Fleet managers use our tools to visualize branding and livery designs across their entire vehicle fleet.",
  },
  {
    question: "Can I request a vehicle that isn't in the library?",
    answer: "Yes. If a specific vehicle model isn't available, you can submit a request through the platform. We prioritize additions based on user demand and wrap industry trends. Popular requests are typically added within a few weeks.",
  },
  {
    question: "Do renders show accurate body lines for each vehicle?",
    answer: "Yes. Each vehicle in our library is rendered with accurate proportions, body lines, panel gaps, trim details, and characteristic design elements. This means a render of a BMW M4 looks distinctly different from a Mercedes C-Class - the body lines, grille, headlights, and overall silhouette are vehicle-specific.",
  },
  {
    question: "Can I render wraps on modified or aftermarket vehicles?",
    answer: "RestyleProAI™ renders vehicles in their stock configuration. For modified vehicles (widebody kits, aftermarket bumpers, lifted trucks), you can upload photos of the actual vehicle through VisionBoardIQ™ in DesignProAI™ to provide visual context for the AI. The standard vehicle library uses factory body styles.",
  },
  {
    question: "Are vehicle models updated with new model years?",
    answer: "Yes. We update our vehicle library to include new model years and redesigns as they become relevant to the wrap industry. When a manufacturer releases a new generation of a popular model (like a redesigned Ford Mustang or Toyota Camry), we prioritize adding the updated body style.",
  },
  {
    question: "Can I render wraps on motorcycles, boats, buses, or RVs?",
    answer: "Yes — all four are now supported as push-button vehicle types. Just tap Motorcycle, Boat, Bus, or RV in the Vehicle Type selector, then enter year/make/model. The system uses Google-grounded AI to look up real exterior dimensions (from OEM spec sheets, dealer brochures, or manufacturer tech drawings) and renders the wrap with class-appropriate camera angles — side profile for motorcycles, port/starboard for boats, full body-length for buses and RVs. Important: because these are outside our curated car database, a validation banner appears on the proof screen asking you to verify the dimensions against the actual vehicle before sending any panels to print. This ensures production accuracy.",
  },
  {
    question: "What about vintage vehicles?",
    answer: "Vintage vehicles from any era work — a 1957 Chevrolet Bel Air, a 1969 Camaro, a 1962 Chris-Craft runabout, a 1974 Airstream trailer. For cars in our database, we use the curated measurements. For vehicles outside the database or older than 1982, the system uses Google-grounded AI to pull dimensions from classic-car reference sites, restoration guides, and OEM archives. As with all non-standard vehicles, you'll be asked to verify the dimensions before printing.",
  },
  {
    question: "How does the proof-stage validation work for non-standard vehicles?",
    answer: "When you render a motorcycle, boat, bus, RV, or any vehicle outside our curated car database, the proof screen shows a warning banner with the exact dimensions our AI found, the confidence level, and the source URLs Google grounded on. Before you can send panels to the print production pipeline, you must click 'I Verified These Dimensions' to confirm they match the actual vehicle. This one-time validation unlocks production for that vehicle permanently — future renders of the same year/make/model are instant.",
  },
];
