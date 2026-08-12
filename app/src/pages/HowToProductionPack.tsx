/**
 * /help/production-pack — Customer-facing how-to: turning a finished design
 * into print-ready files via a Production Pack ($299).
 *
 * Answers the #1 post-panelization question ("it panelized all the sides —
 * what do I do now?"). White UI, public/indexable, linkable from the
 * ProductionFlow next-step banner and from support emails.
 */
import { Link, useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { Button } from "@/components/ui/button";
import {
  Sparkles,
  Layers,
  Package,
  Download,
  ArrowRight,
  Check,
  HelpCircle,
} from "lucide-react";
import { PRODUCTION_PACK_PRICE_CENTS } from "@/lib/panelizer-config";

const PRICE = `$${(PRODUCTION_PACK_PRICE_CENTS / 100).toFixed(0)}`;

const STEPS = [
  {
    icon: Sparkles,
    title: "1. Create your design",
    body: "Use DesignPro (or ColorPro) to generate your wrap on your exact vehicle. Revise until the look is right — revisions don't cost a production pack.",
  },
  {
    icon: Layers,
    title: "2. Panelize it",
    body: "When you're happy, panelize the design. The GENIE panelizer splits your wrap into installer-ready panels sized for 59.5\" vinyl rolls across all 7 views.",
  },
  {
    icon: Package,
    title: `3. Order your Production Pack (${PRICE})`,
    body: "This is the step that unlocks your files. Click “Order Production Pack” on your design. It flattens every panel into print-ready artwork, adds bleed, and packages the EPS/print files for your shop.",
  },
  {
    icon: Download,
    title: "4. Download your print-ready files",
    body: "Once the pack is built, your flattened panel files appear in your WrapBox / Production view, ready to hand to any printer or RIP. That's it — design to production.",
  },
];

const WHATS_INCLUDED = [
  "Flattened, print-ready panel artwork (not 3D renders)",
  "Panels sized for 59.5\" wholesale vinyl roll widths",
  "Correct bleed + panel dimensions for install",
  "All views packaged together for your printer",
];

export default function HowToProductionPack() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <Helmet>
        <title>How to Get Your Print-Ready Files — Production Pack | RestyleProAI</title>
        <meta
          name="description"
          content="Your design panelized — now what? Here's how to order a Production Pack and get flattened, print-ready vehicle wrap files for your shop."
        />
      </Helmet>

      <div className="max-w-3xl mx-auto px-6 py-12">
        {/* Hero */}
        <div className="text-center mb-12">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-blue-50 to-pink-50 border border-pink-200 px-3 py-1 text-xs font-semibold text-pink-700 mb-4">
            <Package className="w-3.5 h-3.5" /> Production Pack
          </span>
          <h1 className="text-3xl sm:text-4xl font-bold mb-3">
            Your design panelized — <span className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] bg-clip-text text-transparent">here's how to get your files</span>
          </h1>
          <p className="text-gray-600 text-lg">
            A finished design and panel preview are free. To get the flattened,
            print-ready files your shop can actually print, you order a Production Pack.
          </p>
        </div>

        {/* Steps */}
        <div className="space-y-4 mb-12">
          {STEPS.map((s) => (
            <div key={s.title} className="flex gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <span className="flex items-center justify-center w-11 h-11 shrink-0 rounded-lg bg-gradient-to-br from-[#3b82f6] to-[#ec4899] text-white">
                <s.icon className="w-5 h-5" />
              </span>
              <div>
                <h2 className="font-bold text-gray-900 mb-1">{s.title}</h2>
                <p className="text-sm text-gray-600 leading-relaxed">{s.body}</p>
              </div>
            </div>
          ))}
        </div>

        {/* What's included */}
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-6 mb-12">
          <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
            <Check className="w-4 h-4 text-pink-600" /> What's in a Production Pack
          </h3>
          <ul className="space-y-2">
            {WHATS_INCLUDED.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-gray-700">
                <Check className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* CTA — white card with gradient hairline + gradient accent button */}
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden text-center">
          <div className="h-1 bg-gradient-to-r from-[#3b82f6] to-[#ec4899]" />
          <div className="p-8">
            <h3 className="text-2xl font-bold text-gray-900 mb-2">Ready to get your print files?</h3>
            <p className="text-gray-600 mb-5">
              Open your design and click <strong className="text-gray-900">Order Production Pack</strong> — {PRICE} for the full print-ready set.
            </p>
            <Button
              onClick={() => navigate("/designpro")}
              className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white hover:opacity-90 font-semibold border-0"
              size="lg"
            >
              Go to my design <ArrowRight className="w-4 h-4 ml-1.5" />
            </Button>
          </div>
        </div>

        {/* Help footer */}
        <p className="text-center text-sm text-gray-500 mt-8 flex items-center justify-center gap-1.5">
          <HelpCircle className="w-4 h-4" />
          Still stuck? Use the <Link to="#" className="text-pink-700 font-medium">Help &amp; Feedback</Link> button on any page and our dev team will jump in.
        </p>
      </div>
    </div>
  );
}
