/**
 * CarWrapProLanding — public product page for CarWrapPro™ (/carwrappro).
 *
 * Sells the prompt-to-production system to wrap shops, sign companies, fleets
 * and restylers. Built for strong SEO + AEO:
 *   - Title/description/canonical/OG/Twitter meta
 *   - JSON-LD: SoftwareApplication + HowTo + FAQPage + BreadcrumbList
 *   - Visible, direct-answer FAQ copy (answer-engine optimized — the on-page
 *     text matches the FAQPage schema so AI answer engines can quote it)
 *
 * White UI per docs/WHITE_UI_STANDARD.md.
 */

import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Boxes, Camera, FileCheck, Layers, Package, Ruler, Sparkles } from "lucide-react";

const CANONICAL = "https://designproai.com/carwrappro";

const FAQS = [
  {
    question: "How do I turn a design idea into print-ready vehicle wrap files?",
    answer:
      "With CarWrapPro you type one prompt (or upload one photo), pick the vehicle, and the system designs the wrap flat-first, then automatically outputs per-panel print files at actual size with 2-inch bleed at 150 DPI, a flat panel artboard, a 7-angle set of 3D vehicle proofs, and a dimensioned 2D production proof with an approval signature line. No Canva, no Photoshop panel-building.",
  },
  {
    question: "Can AI recreate a vehicle wrap design from a single photo?",
    answer:
      "Yes. CarWrapPro reproduces any vehicle wrap design from one image: it flattens the design into print panels, separates the background from logo and text overlay layers, and rebuilds the complete production pack — print panels, artboard, 3D proofs, and the 2D production proof — for any of 1,600+ vehicles in the dimension database.",
  },
  {
    question: "What size and resolution should vehicle wrap print files be?",
    answer:
      "Vehicle wrap print panels should be set up at the vehicle's actual panel dimensions plus bleed. CarWrapPro outputs every panel at true print size plus 2 inches of bleed on all sides at 150 DPI geometry — the standard large-format spec used by wholesale wrap printers like WePrintWraps.com.",
  },
  {
    question: "How does CarWrapPro know my vehicle's panel dimensions?",
    answer:
      "CarWrapPro uses a database of more than 1,600 vehicles with measured panel dimensions — driver and passenger sides, hood, roof, front, and rear. The flat artboard, the print panels, and the 2D production proof are all generated at those true dimensions.",
  },
  {
    question: "Why design the wrap flat-first instead of on the 3D vehicle?",
    answer:
      "Flat-first means the flat master artboard is the single source of truth. The artwork is created as real layers — a clean background plus a separate transparent logo/text overlay — so branding stays consistent across every view, slices cleanly into print panels, and the 3D proofs are projected from the same flat design the printer receives. What the customer approves is exactly what prints.",
  },
  {
    question: "How much does CarWrapPro cost and how many revisions are included?",
    answer:
      "CarWrapPro is pay-to-use: a custom vehicle wrap design is $250 and includes the full production pack with up to 4 design revisions. Additional revisions after the included 4 are a small per-revision fee, and the print-ready panel files are released once the design is paid and approved.",
  },
  {
    question: "Who is CarWrapPro for?",
    answer:
      "Wrap shops, sign companies, fleet managers, dealerships, and restyle studios across the USA and Canada. CarWrapPro is built by WePrintWraps.com, a wholesale wrap printing company — the output is real commercial and restyle production work, designed and shipped every day.",
  },
];

const OUTPUTS = [
  { icon: Ruler, title: 'Print Panels — actual size + 2" bleed', body: "Every panel (driver, passenger, hood, roof, front, rear) sliced from the flat master at true vehicle dimensions, 150 DPI geometry, ready for the RIP." },
  { icon: Layers, title: "Layered design assets", body: "Clean background and a separate transparent logo/text overlay — editable layers, no baked-in branding, no de-layering in Canva." },
  { icon: Package, title: "Flat panel artboard", body: "All panels on one dimensioned artboard with a legend — the single source of truth the whole pack is built from." },
  { icon: Boxes, title: "7-angle 3D proof set", body: "Driver, passenger, front, rear, hood, roof and close-up photorealistic renders projected from the same flat design." },
  { icon: FileCheck, title: "2D Production Proof", body: "Dimensioned multi-view approval sheet with signature and date line — the document your customer signs." },
  { icon: Camera, title: "Recreate from one photo", body: "Upload any wrap photo or old proof and the system rebuilds the full production pack for any of 1,600+ vehicles." },
];

interface ProductionExample {
  vehicle: string;
  heroUrl: string;
  artboardUrl: string | null;
  designName: string | null;
}

export default function CarWrapProLanding() {
  // Real 2D/3D production examples straight from the design assets data
  // (designiq_generations) via the public carwrappro-examples feed.
  const { data: examples } = useQuery({
    queryKey: ["carwrappro-examples"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("carwrappro-examples", { body: {} });
      if (error) throw error;
      return (data?.examples || []) as ProductionExample[];
    },
    staleTime: 5 * 60 * 1000,
  });

  const softwareLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "CarWrapPro",
    applicationCategory: "DesignApplication",
    operatingSystem: "Web",
    url: CANONICAL,
    description:
      "AI vehicle wrap design system that turns one prompt or one photo into print-ready wrap files: per-panel print files at actual size with 2-inch bleed, a flat panel artboard, a 7-angle 3D proof set, and a dimensioned 2D production proof.",
    publisher: { "@type": "Organization", name: "WePrintWraps.com", url: "https://weprintwraps.com" },
    offers: { "@type": "Offer", price: "250", priceCurrency: "USD" },
  };

  const howToLd = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: "How to get print-ready vehicle wrap files from one prompt",
    step: [
      { "@type": "HowToStep", name: "Describe the wrap (or upload a photo)", text: "Type one design brief or upload a single photo of a wrap to recreate." },
      { "@type": "HowToStep", name: "Pick the vehicle", text: "Choose from 1,600+ vehicles with measured panel dimensions." },
      { "@type": "HowToStep", name: "AI designs flat-first", text: "The system creates the layered flat design and true-dimension artboard." },
      { "@type": "HowToStep", name: "Download the production pack", text: "Print panels with 2-inch bleed at 150 DPI, 7-angle 3D proofs, and the signed-off 2D production proof." },
    ],
  };

  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
    })),
  };

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://designproai.com" },
      { "@type": "ListItem", position: 2, name: "CarWrapPro", item: CANONICAL },
    ],
  };

  return (
    <div className="min-h-screen bg-white">
      <Helmet>
        <title>CarWrapPro™ — AI Car Wrap Design to Print-Ready Files | WePrintWraps</title>
        <meta
          name="description"
          content="Turn one prompt or one photo into print-ready vehicle wrap files: panels at actual size with 2&quot; bleed (150 DPI), flat artboard, 7-angle 3D proofs, and a signed 2D production proof. 1,600+ vehicle dimensions. By WePrintWraps.com."
        />
        <link rel="canonical" href={CANONICAL} />
        <meta property="og:title" content="CarWrapPro™ — AI Car Wrap Design to Print-Ready Files" />
        <meta property="og:description" content="One prompt → complete wrap production pack: print panels, artboard, 7-angle 3D proofs, 2D production proof. Recreate any wrap from a single photo." />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={CANONICAL} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="CarWrapPro™ — AI Car Wrap Design to Print-Ready Files" />
        <meta name="twitter:description" content="One prompt or one photo → print-ready vehicle wrap production pack. 1,600+ vehicles." />
        <script type="application/ld+json">{JSON.stringify(softwareLd)}</script>
        <script type="application/ld+json">{JSON.stringify(howToLd)}</script>
        <script type="application/ld+json">{JSON.stringify(faqLd)}</script>
        <script type="application/ld+json">{JSON.stringify(breadcrumbLd)}</script>
      </Helmet>

      <div className="h-1 bg-gradient-to-r from-[#3b82f6] to-[#ec4899]" />

      {/* Hero — the DesignProAI footer treatment, promoted to the header */}
      <section className="max-w-6xl mx-auto px-5 pt-14 pb-10">
        <h1 className="text-5xl md:text-6xl font-bold leading-tight">
          <span className="text-gray-900">CarWrap</span>
          <span className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] bg-clip-text text-transparent">Pro</span>
          <span className="text-gray-400 text-2xl ml-1 align-top">™</span>
        </h1>
        <p className="mt-2 text-xl text-gray-700 font-medium">Vehicle Wrap Design System</p>
        <p className="mt-3 text-sm font-bold tracking-[0.35em] uppercase bg-gradient-to-r from-[#3b82f6] to-[#ec4899] bg-clip-text text-transparent">
          Prompt to Print Production
        </p>
        <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-600 mt-6">
          <Sparkles className="w-3.5 h-3.5" /> by WePrintWraps.com — wholesale wrap printing, USA &amp; Canada
        </div>
        <h2 className="mt-5 text-2xl md:text-3xl font-bold text-gray-900 leading-tight">
          One prompt. One photo.{" "}
          <span className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] bg-clip-text text-transparent">
            Print-ready wrap files.
          </span>
        </h2>
        <p className="mt-4 max-w-2xl text-gray-600">
          <span className="font-semibold text-gray-900">CarWrap<span className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] bg-clip-text text-transparent">Pro</span>™</span>{" "}
          designs the wrap flat-first, then automatically delivers the complete production pack — print panels at
          actual size with 2" bleed (150 DPI), a true-dimension flat artboard, a 7-angle 3D proof set, and a
          dimensioned 2D production proof your customer signs. Built on real panel dimensions for 1,600+ vehicles.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link to="/try-design">
            <Button className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white px-6">Start a Wrap Design — $250</Button>
          </Link>
          <Link to="/gallery">
            <Button variant="outline" className="border-gray-300 text-gray-700">See Real Output</Button>
          </Link>
        </div>
      </section>

      {/* Real production examples — 3D proofs + 2D artboards from design assets */}
      {!!examples?.length && (
        <section className="max-w-6xl mx-auto px-5 py-10">
          <h2 className="text-2xl font-bold text-gray-900 text-center mb-2">Real output, real vehicles</h2>
          <p className="text-center text-gray-500 text-sm mb-8">
            3D proofs and 2D print artboards generated by this system — pulled live from our production design assets.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {examples.map((ex, i) => (
              <div key={i} className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                <img src={ex.heroUrl} alt={`${ex.vehicle} wrap — 3D proof`} loading="lazy" className="w-full aspect-video object-cover bg-gray-50" />
                {ex.artboardUrl && (
                  <img src={ex.artboardUrl} alt={`${ex.vehicle} wrap — 2D print artboard`} loading="lazy" className="w-full aspect-video object-contain bg-gray-50 border-t border-gray-100" />
                )}
                <div className="px-3 py-2">
                  <p className="text-xs font-semibold text-gray-900">{ex.vehicle || "Production wrap"}</p>
                  {ex.designName && <p className="text-[11px] text-gray-500">“{ex.designName}”</p>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Outputs */}
      <section className="max-w-6xl mx-auto px-5 py-10">
        <h2 className="text-2xl font-bold text-gray-900 text-center mb-2">Everything the print shop needs, automatically</h2>
        <p className="text-center text-gray-500 text-sm mb-8">The same pack we produce daily at WePrintWraps.com for shops across the USA and Canada.</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {OUTPUTS.map((o) => (
            <div key={o.title} className="rounded-2xl border border-gray-200 bg-white shadow-sm p-5">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#3b82f6] to-[#ec4899] flex items-center justify-center shadow-sm mb-3">
                <o.icon className="w-5 h-5 text-white" />
              </div>
              <h3 className="font-bold text-gray-900 text-sm mb-1">{o.title}</h3>
              <p className="text-sm text-gray-600">{o.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works — visible HowTo content (AEO) */}
      <section className="max-w-4xl mx-auto px-5 py-10">
        <h2 className="text-2xl font-bold text-gray-900 text-center mb-8">How it works</h2>
        <ol className="space-y-4">
          {[
            ["Describe the wrap — or upload one photo", "Type a brief like “Summit Realty Group — luxury gold and charcoal skyline wrap”, or upload a photo of any wrap to recreate it exactly."],
            ["Pick the vehicle", "1,600+ vehicles with measured driver/passenger, hood, roof, front and rear panel dimensions."],
            ["AI designs flat-first, as real layers", "Clean background + separate transparent logo/text overlay → composited into the flat master artboard at true dimensions."],
            ["Download the production pack", "Per-panel print files with 2\" bleed at 150 DPI, the artboard, 7 photorealistic 3D proofs, and the 2D production proof with signature line."],
          ].map(([t, b], i) => (
            <li key={t} className="flex gap-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
              <span className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-[#3b82f6] to-[#ec4899] text-white text-sm font-bold flex items-center justify-center">{i + 1}</span>
              <div>
                <p className="font-semibold text-gray-900 text-sm">{t}</p>
                <p className="text-sm text-gray-600">{b}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* FAQ — visible answers match FAQPage JSON-LD (AEO) */}
      <section className="max-w-3xl mx-auto px-5 py-10">
        <h2 className="text-2xl font-bold text-gray-900 text-center mb-6">Vehicle wrap printing questions, answered</h2>
        <Accordion type="single" collapsible className="space-y-2">
          {FAQS.map((f, i) => (
            <AccordionItem key={i} value={`faq-${i}`} className="rounded-xl border border-gray-200 bg-white px-4">
              <AccordionTrigger className="text-left text-sm font-semibold text-gray-900 hover:no-underline">{f.question}</AccordionTrigger>
              <AccordionContent className="text-sm text-gray-600">{f.answer}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </section>

      {/* CTA */}
      <section className="max-w-4xl mx-auto px-5 pb-16 text-center">
        <div className="rounded-2xl border border-gray-200 shadow-sm p-8">
          <div className="h-1 w-24 mx-auto bg-gradient-to-r from-[#3b82f6] to-[#ec4899] rounded-full mb-5" />
          <h2 className="text-2xl font-bold text-gray-900">Ready to go from idea to install?</h2>
          <p className="text-gray-600 text-sm mt-2 mb-5">Designed and printed by WePrintWraps.com — shipped all over the USA and Canada.</p>
          <Link to="/try-design">
            <Button className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white px-8">Get Your Wrap Designed</Button>
          </Link>
        </div>
      </section>
    </div>
  );
}
