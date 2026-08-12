export const faqRelatedPages = [
  { label: "ColorPro™ FAQ", path: "/faq/colorpro" },
  { label: "DesignProAI™ & VisionBoardIQ™ FAQ", path: "/faq/designpro" },
  { label: "FadeWraps™ FAQ", path: "/faq/fadewraps" },
  { label: "Photorealistic Renders FAQ", path: "/faq/photorealistic-renders" },
  { label: "Supported Vehicles FAQ", path: "/faq/vehicles" },
  { label: "Pricing & Plans FAQ", path: "/faq/pricing" },
];

export const getRelatedPages = (currentPath: string) =>
  faqRelatedPages.filter((p) => p.path !== currentPath);
