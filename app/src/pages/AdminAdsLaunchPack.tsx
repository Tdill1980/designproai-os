/**
 * AdminAdsLaunchPack — generate the 10 DesignProAI Meta ad creatives.
 *
 * No edge function calls, no new tables, no migrations. Pulls existing
 * ColorPro / MyVehiclePro renders from color_visualizations, slots them
 * into 10 hardcoded ad layouts (4:5 1080×1350), rasterises each via
 * Konva → PNG → JSZip download.
 *
 * Designed for tomorrow-morning launch: load the page, pick which
 * renders to use as heroes, click Generate, paste the zip into Meta
 * Ads Manager. The ad COPY is baked in (matches the 10-ad campaign
 * brief Trish was given in chat).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Stage, Layer, Rect, Text, Image as KonvaImage } from "react-konva";
import Konva from "konva";
import JSZip from "jszip";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ArrowLeft, Download, Loader2 } from "lucide-react";

// ── Brand assets ──────────────────────────────────────────────────────
const BRAND = {
  white: "#FFFFFF",
  cream: "#F5F1E8",
  black: "#0A0A0A",
  ink: "#1A1A1A",
  body: "#3D3D3D",
};

const BRAND_FONTS = ["Poppins", "Oswald", "Inter", "Montserrat", "Bebas Neue"];

async function ensureFontsLoaded(): Promise<void> {
  if (typeof document === "undefined" || !(document as any).fonts) return;
  const fonts = (document as any).fonts;
  await Promise.allSettled(
    BRAND_FONTS.flatMap((f) => [
      fonts.load(`400 16px "${f}"`),
      fonts.load(`700 16px "${f}"`),
    ]),
  );
  await fonts.ready;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Image load failed: ${url}`));
    img.src = url;
  });
}

function pickFirstUrl(jsonish: unknown): string | null {
  if (!jsonish) return null;
  if (typeof jsonish === "string") return jsonish;
  if (Array.isArray(jsonish)) return jsonish.find((v) => typeof v === "string") || null;
  if (typeof jsonish === "object") {
    const obj = jsonish as Record<string, unknown>;
    // Driver-side 3/4 is the money angle for vehicle ads. Front is the
    // LEAST flattering view (no body lines, just bumper/grille). Order
    // preference accordingly: 3/4 angles + side > hero/primary > rear > front.
    const preferred = [
      "driver_side", "driverSide", "driver", "side_driver",
      "passenger_side", "passengerSide", "passenger",
      "hood", "hood_detail", "hoodDetail",
      "hero", "primary", "main",
      "side", "three_quarter", "threeQuarter",
      "close_up", "closeUp",
      "rear", "rear_quarter",
      "front", // LAST — only if nothing else is available
    ];
    for (const k of preferred) if (typeof obj[k] === "string") return obj[k] as string;
    for (const v of Object.values(obj)) if (typeof v === "string") return v;
  }
  return null;
}

// ── The 10 ads ────────────────────────────────────────────────────────
// Each ad: a hook category, the on-image headline (short, punchy — the
// big black words), an on-image subhead (smaller body line), and the
// CTA pill text. The Meta primary text + description live in the brief
// document we hand over alongside this page; what's BAKED into the PNG
// is just what's visually on the creative.
// Four layouts that mirror the user's Canva references:
//   yoga          — top text, bottom render. White minimal. (Awaken Your Body / Quiet Your Mind)
//   style         — full-bleed render + dark scrim. Massive Bebas word
//                    overlapping image. Italic side caption. Tiny 3-col labels. (LICERIA & CO STYLE)
//   feeling-stuck — full-bleed render + dark scrim. Centered Poppins italic
//                    headline. Tiny corner labels + page indicator. (Feeling stuck / restless)
//   strategy      — full-bleed render + cream-tinted overlay. Centered serif
//                    italic headline + black pill CTA word. @handle pill at bottom. (Brown aesthetic strategy)
type AdLayout = "yoga" | "style" | "feeling-stuck" | "strategy";

type Ad = {
  id: string;
  category: "Pain-Aware" | "Us vs Them" | "Education" | "Feature";
  headline: string;       // big headline (rendered per-layout)
  subhead: string;        // small body line
  cta: string;            // CTA pill text
  bigWord?: string;       // for "style" layout — the oversized Bebas word
  recommendedTool: "ColorPro" | "MyVehiclePro" | "either";
  layout: AdLayout;
};

// Hardened copy — conversion-level execution. Pain → money → mechanism in
// every hook. The system sell ("one closed-loop revenue system, not duct-
// taped tools") is the core differentiator. CTAs name the outcome, not
// the feature ("Show My First Wrap" beats "Try Free").
const ADS: Ad[] = [
  // ── Pain-aware (4) — where you lose the job ───────────────────────
  {
    id: "01-pain-not-price",
    category: "Pain-Aware",
    headline: "You’re not\nlosing wrap jobs\non price.",
    subhead: "You’re losing them right after you send the proof.",
    cta: "fix this",
    recommendedTool: "either",
    layout: "strategy",
  },
  {
    id: "02-pain-proofs-dont-close",
    category: "Pain-Aware",
    headline: "YOUR PROOFS\nAREN’T\nCLOSING DEALS.",
    subhead: "Photorealistic proofs. Real materials. Real vehicles. The job is won before the print.",
    cta: "TURN THIS INTO A PROOF",
    recommendedTool: "ColorPro",
    layout: "yoga",
  },
  {
    id: "03-pain-designs-dont-sell",
    category: "Pain-Aware",
    headline: "Stop sending\ndesigns\nthat don’t sell.",
    subhead: "If they can see it — they’ll buy it. Show. Don’t explain.",
    cta: "SHOW MY FIRST WRAP",
    recommendedTool: "either",
    layout: "feeling-stuck",
  },
  {
    id: "04-pain-lose-before-print",
    category: "Pain-Aware",
    headline: "Most wrap shops lose the job\nbefore the print.",
    subhead: "Photoreal proofs. Real-film previews. Yardage + quote baked in.",
    bigWord: "LOSE",
    cta: "START CLOSING",
    recommendedTool: "either",
    layout: "style",
  },
  // ── Us vs Them (2) — the system sell ──────────────────────────────
  {
    id: "05-uvt-duct-tape",
    category: "Us vs Them",
    headline: "MOST SHOPS\nDUCT-TAPE\nTOOLS.",
    subhead: "This is one system. Design → Show → Quote → Close.",
    cta: "SEE THE SYSTEM",
    recommendedTool: "either",
    layout: "yoga",
  },
  {
    id: "06-uvt-skills-vs-proofs",
    category: "Us vs Them",
    headline: "You don’t need better sales skills.\nYou need better proofs.",
    subhead: "Photoreal on their actual vehicle. The proof closes itself.",
    bigWord: "PROOFS",
    cta: "SEE THIS LIVE",
    recommendedTool: "MyVehiclePro",
    layout: "style",
  },
  // ── Education (2) — the shift ─────────────────────────────────────
  {
    id: "07-edu-quote-vs-sale",
    category: "Education",
    headline: "The difference\nbetween a quote\nand a sale\nis this.",
    subhead: "Whether the customer can see it. Show. Don’t explain.",
    cta: "see it",
    recommendedTool: "either",
    layout: "strategy",
  },
  {
    id: "08-edu-buy-what-they-see",
    category: "Education",
    headline: "Customers don’t\nbuy wraps.\nThey buy what\nthey can SEE.",
    subhead: "Photoreal proofs on real vehicles, with real wrap films.",
    cta: "SHOW MY FIRST WRAP",
    recommendedTool: "ColorPro",
    layout: "feeling-stuck",
  },
  // ── Feature / outcome (2) ─────────────────────────────────────────
  {
    id: "09-feat-hesitate-lose",
    category: "Feature",
    headline: "If they hesitate, you lose.",
    subhead: "Turn “let me think about it” into “let’s do it.”",
    bigWord: "HESITATE",
    cta: "CLOSE FASTER",
    recommendedTool: "either",
    layout: "style",
  },
  {
    id: "10-feat-design-show-close",
    category: "Feature",
    headline: "Design.\nShow.\nClose.",
    subhead: "The revenue engine for wrap shops.",
    cta: "START DEMO",
    recommendedTool: "either",
    layout: "feeling-stuck",
  },
];

// ── 8-slide carousel ─────────────────────────────────────────────────
// Hardened pain → shift → USP → system → money → authority → CTA flow.
// Each slide = one 1080×1350 PNG. Slides without a render slot use a
// solid background; slides 4 + 7 + 8 use a render to anchor the message.
// Carousel slides reuse the same Ad shape + layouts so visuals match the
// 10-ad pack. Each slide is just an Ad with a slide-specific eyebrow
// (e.g. "01 · HOOK") that goes through the buildElements pipeline.
// useRender=false slides still get a render in slot but fully behind the
// scrim — pure type plays where the image is texture, not subject.
type Slide = Ad & { eyebrow: string };

const CAROUSEL: Slide[] = [
  {
    id: "c1-hook",
    eyebrow: "01 · HOOK",
    category: "Pain-Aware",
    headline: "You’re not\nlosing wrap jobs\non price.",
    subhead: "You’re losing them right after you send the proof.",
    cta: "swipe →",
    recommendedTool: "either",
    layout: "strategy",
  },
  {
    id: "c2-problem",
    eyebrow: "02 · PROBLEM",
    category: "Pain-Aware",
    headline: "FLAT PROOFS.\nCONFUSING\nMOCKUPS.\nCUSTOMERS\nUNSURE.",
    subhead: "Hesitation = lost revenue.",
    cta: "SWIPE →",
    recommendedTool: "either",
    layout: "yoga",
  },
  {
    id: "c3-shift",
    eyebrow: "03 · SHIFT",
    category: "Education",
    headline: "Customers don’t\nbuy wraps.\nThey buy what\nthey can SEE.",
    subhead: "Make it real before it exists.",
    cta: "SWIPE →",
    recommendedTool: "either",
    layout: "feeling-stuck",
  },
  {
    id: "c4-usp",
    eyebrow: "04 · USP",
    category: "Feature",
    headline: "Photoreal proofs. Real vehicles. Real films.",
    subhead: "3M · Avery · KPMF · Inozetek · Hexis · TeckWrap.",
    bigWord: "REAL",
    cta: "SWIPE →",
    recommendedTool: "either",
    layout: "style",
  },
  {
    id: "c5-system",
    eyebrow: "05 · SYSTEM",
    category: "Us vs Them",
    headline: "Design →\nShow →\nQuote →\nClose.",
    subhead: "Most shops duct-tape tools. This is one system.",
    cta: "swipe →",
    recommendedTool: "either",
    layout: "strategy",
  },
  {
    id: "c6-money",
    eyebrow: "06 · MONEY",
    category: "Feature",
    headline: "FASTER APPROVALS.\nFEWER REVISIONS.\nMORE CLOSED JOBS.",
    subhead: "Proofs close jobs. Not designs.",
    cta: "SWIPE →",
    recommendedTool: "either",
    layout: "yoga",
  },
  {
    id: "c7-authority",
    eyebrow: "07 · AUTHORITY",
    category: "Us vs Them",
    headline: "Stop explaining wraps.\nStart showing them.",
    subhead: "If they can see it — they’ll buy it.",
    bigWord: "SHOW",
    cta: "SWIPE →",
    recommendedTool: "either",
    layout: "style",
  },
  {
    id: "c8-cta",
    eyebrow: "08 · CTA",
    category: "Feature",
    headline: "Design.\nShow.\nClose.",
    subhead: "The revenue engine for wrap shops.",
    cta: "START DEMO",
    recommendedTool: "either",
    layout: "feeling-stuck",
  },
];

// ── Layout builders (pure functions returning Konva element specs) ────
// Three layouts. Same canvas (1080×1350). White background, black ink,
// matches the cream/white/black aesthetic the user specified.
type EI = {
  type: "rect" | "text" | "image";
  x: number; y: number; width: number; height: number;
  fill?: string; opacity?: number; cornerRadius?: number;
  text?: string; fontSize?: number; fontFamily?: string; fontStyle?: string;
  align?: string; verticalAlign?: string;
};

function buildElements(ad: Ad): EI[] {
  const els: EI[] = [];

  if (ad.layout === "yoga") {
    // White background. Tiny brand mark top-left. Big serif-ish bold
    // headline. Bullet line. Body. Black pill CTA. URL/handle line.
    // Bottom 40% = render image (slot drawn separately by stage).
    els.push(
      { type: "rect", x: 0, y: 0, width: 1080, height: 1350, fill: BRAND.white },
      { type: "text", x: 60, y: 60, width: 960, height: 22, text: "RESTYLEPROAI", fontSize: 14, fontFamily: "Inter", fontStyle: "bold", fill: BRAND.black, align: "left" },
      { type: "text", x: 60, y: 130, width: 960, height: 360, text: ad.headline, fontSize: 78, fontFamily: "Oswald", fontStyle: "bold", fill: BRAND.black, align: "left" },
      { type: "text", x: 60, y: 530, width: 960, height: 22, text: "•  PROOFS CLOSE JOBS. NOT DESIGNS.", fontSize: 14, fontFamily: "Inter", fontStyle: "bold", fill: BRAND.black, align: "left" },
      { type: "text", x: 60, y: 580, width: 960, height: 100, text: ad.subhead, fontSize: 20, fontFamily: "Inter", fill: BRAND.body, align: "left" },
      // Black pill CTA + URL/handle line
      { type: "rect", x: 60, y: 700, width: 240, height: 56, fill: BRAND.black, cornerRadius: 4 },
      { type: "text", x: 60, y: 700, width: 240, height: 56, text: ad.cta, fontSize: 14, fontFamily: "Inter", fontStyle: "bold", fill: BRAND.white, align: "center", verticalAlign: "middle" },
      { type: "text", x: 60, y: 776, width: 960, height: 20, text: "www.restyleproai.com    |    @restyleproai", fontSize: 13, fontFamily: "Inter", fill: BRAND.body, align: "left" },
      // (Render image slotted in by the stage at y >= 820)
    );
  } else if (ad.layout === "style") {
    // Full-bleed render. Dark scrim. Tiny 3-col labels at top.
    // Massive Bebas word (bigWord) overlapping image. Italic side caption left.
    // Footer URLs/handle small at bottom.
    const big = (ad.bigWord || ad.headline.split(/\s+/).pop() || "STOP").toUpperCase();
    els.push(
      { type: "rect", x: 0, y: 0, width: 1080, height: 1350, fill: BRAND.black },
      // (Render slot drawn here by the stage — full-bleed)
      // Dark scrim for legibility
      { type: "rect", x: 0, y: 0, width: 1080, height: 1350, fill: BRAND.black, opacity: 0.42 },
      // Top labels (3 columns)
      { type: "text", x: 60,  y: 60, width: 320, height: 20, text: "RESTYLEPROAI",          fontSize: 14, fontFamily: "Inter", fontStyle: "bold", fill: BRAND.white, align: "left" },
      { type: "text", x: 380, y: 60, width: 320, height: 20, text: ad.category.toUpperCase(), fontSize: 14, fontFamily: "Inter", fontStyle: "bold", fill: BRAND.white, align: "center" },
      { type: "text", x: 700, y: 60, width: 320, height: 20, text: "VOL. 01",                 fontSize: 14, fontFamily: "Inter", fontStyle: "bold", fill: BRAND.white, align: "right" },
      // Massive Bebas word — center-aligned, ~340pt
      { type: "text", x: 0,   y: 200, width: 1080, height: 380, text: big, fontSize: 340, fontFamily: "Bebas Neue", fontStyle: "bold", fill: BRAND.white, align: "center" },
      // Italic side caption left side, mid-canvas
      { type: "text", x: 60,  y: 640, width: 540, height: 360, text: ad.headline, fontSize: 38, fontFamily: "Poppins", fontStyle: "italic", fill: BRAND.white, align: "left" },
      // Subhead lower-left
      { type: "text", x: 60,  y: 1020, width: 960, height: 80, text: ad.subhead, fontSize: 18, fontFamily: "Inter", fill: BRAND.white, align: "left" },
      // White pill CTA bottom
      { type: "rect", x: 60,  y: 1130, width: 280, height: 56, fill: BRAND.white, cornerRadius: 28 },
      { type: "text", x: 60,  y: 1130, width: 280, height: 56, text: ad.cta, fontSize: 14, fontFamily: "Inter", fontStyle: "bold", fill: BRAND.black, align: "center", verticalAlign: "middle" },
      // Footer URLs
      { type: "text", x: 60,  y: 1280, width: 480, height: 20, text: "WWW.RESTYLEPROAI.COM", fontSize: 12, fontFamily: "Inter", fontStyle: "bold", fill: BRAND.white, align: "left" },
      { type: "text", x: 540, y: 1280, width: 480, height: 20, text: "@RESTYLEPROAI",        fontSize: 12, fontFamily: "Inter", fontStyle: "bold", fill: BRAND.white, align: "right" },
    );
  } else if (ad.layout === "feeling-stuck") {
    // Full-bleed render. Dark scrim. Centered serif-italic headline mid-canvas.
    // Tiny corner labels (brand + page indicator). Subhead + footer.
    els.push(
      { type: "rect", x: 0, y: 0, width: 1080, height: 1350, fill: BRAND.black },
      // (Render slot drawn here by the stage — full-bleed)
      { type: "rect", x: 0, y: 0, width: 1080, height: 1350, fill: BRAND.black, opacity: 0.5 },
      // Top corner labels
      { type: "text", x: 60,  y: 60,  width: 480, height: 20, text: "REALSHOPS · WRAP",         fontSize: 13, fontFamily: "Inter", fontStyle: "bold", fill: BRAND.white, align: "left" },
      { type: "text", x: 540, y: 60,  width: 480, height: 20, text: ad.category.toUpperCase(),  fontSize: 13, fontFamily: "Inter", fontStyle: "bold", fill: BRAND.white, align: "right" },
      // Big italic serif headline — vertically centered region
      { type: "text", x: 80,  y: 480, width: 920, height: 460, text: ad.headline, fontSize: 70, fontFamily: "Poppins", fontStyle: "bold italic", fill: BRAND.white, align: "center" },
      // Subhead beneath
      { type: "text", x: 80,  y: 980, width: 920, height: 70,  text: ad.subhead, fontSize: 22, fontFamily: "Poppins", fontStyle: "italic", fill: BRAND.white, align: "center" },
      // White pill CTA centered
      { type: "rect", x: 360, y: 1080, width: 360, height: 60, fill: BRAND.white, cornerRadius: 30 },
      { type: "text", x: 360, y: 1080, width: 360, height: 60, text: ad.cta, fontSize: 15, fontFamily: "Inter", fontStyle: "bold", fill: BRAND.black, align: "center", verticalAlign: "middle" },
      // Bottom labels
      { type: "text", x: 60,  y: 1290, width: 480, height: 20, text: "RESTYLEPROAI.COM", fontSize: 13, fontFamily: "Inter", fontStyle: "bold", fill: BRAND.white, align: "left" },
      { type: "text", x: 540, y: 1290, width: 480, height: 20, text: new Date().getFullYear().toString(), fontSize: 13, fontFamily: "Inter", fontStyle: "bold", fill: BRAND.white, align: "right" },
    );
  } else {
    // strategy — full-bleed render with cream-tinted overlay (warm + premium).
    // Sans eyebrow + serif italic main headline + black pill CTA word +
    // @handle pill at bottom. Mirrors the "Brown aesthetic strategy" Canva ref.
    els.push(
      { type: "rect", x: 0, y: 0, width: 1080, height: 1350, fill: BRAND.cream },
      // (Render slot drawn here by stage — full-bleed)
      // Cream-tinted overlay for warmth + legibility
      { type: "rect", x: 0, y: 0, width: 1080, height: 1350, fill: BRAND.cream, opacity: 0.62 },
      // Tiny brand mark top-center
      { type: "text", x: 60, y: 90, width: 960, height: 22, text: "RESTYLEPROAI", fontSize: 14, fontFamily: "Inter", fontStyle: "bold", fill: BRAND.black, align: "center" },
      // Sub eyebrow (small italic line above headline)
      { type: "text", x: 80, y: 360, width: 920, height: 26, text: ad.category, fontSize: 16, fontFamily: "Poppins", fontStyle: "italic", fill: BRAND.body, align: "center" },
      // Big serif italic headline
      { type: "text", x: 80, y: 410, width: 920, height: 460, text: ad.headline, fontSize: 78, fontFamily: "Poppins", fontStyle: "italic", fill: BRAND.black, align: "center" },
      // Subhead
      { type: "text", x: 80, y: 880, width: 920, height: 50, text: ad.subhead, fontSize: 19, fontFamily: "Inter", fill: BRAND.body, align: "center" },
      // Black pill CTA word in center
      { type: "rect", x: 380, y: 980, width: 320, height: 78, fill: BRAND.black, cornerRadius: 39 },
      { type: "text", x: 380, y: 980, width: 320, height: 78, text: ad.cta, fontSize: 26, fontFamily: "Poppins", fontStyle: "italic", fill: BRAND.white, align: "center", verticalAlign: "middle" },
      // @handle pill near bottom
      { type: "rect", x: 360, y: 1230, width: 360, height: 56, fill: BRAND.black, cornerRadius: 28 },
      { type: "text", x: 360, y: 1230, width: 360, height: 56, text: "@RESTYLEPROAI", fontSize: 16, fontFamily: "Inter", fontStyle: "bold", fill: BRAND.white, align: "center", verticalAlign: "middle" },
      // Swipe arrow bottom-right
      { type: "text", x: 60,  y: 1290, width: 960, height: 18, text: "→", fontSize: 18, fontFamily: "Inter", fontStyle: "bold", fill: BRAND.black, align: "right" },
    );
  }
  return els;
}

// Where on the canvas does the render image go for each layout?
// `feeling-stuck` and `style` and `strategy` are full-bleed — render fills
// entire canvas, and the dark/cream scrim drawn AFTER the image (in
// buildElements) provides legibility for the text on top.
// `yoga` puts the render in the bottom region only.
function getRenderRect(layout: AdLayout) {
  if (layout === "yoga")          return { x: 0, y: 820, width: 1080, height: 530 };
  if (layout === "style")         return { x: 0, y: 0,   width: 1080, height: 1350 };
  if (layout === "feeling-stuck") return { x: 0, y: 0,   width: 1080, height: 1350 };
  /* strategy */                  return { x: 0, y: 0,   width: 1080, height: 1350 };
}

// Slides reuse buildElements + getRenderRect — they're just Ads with an
// eyebrow string. No separate slide-layout builders needed.

// ── Page ──────────────────────────────────────────────────────────────
type RenderRow = { id: string; url: string; vehicle: string; tool_source: string | null; mode_type: string | null };

export default function AdminAdsLaunchPack() {
  const [colorProRenders, setColorProRenders] = useState<RenderRow[]>([]);
  const [myVehicleRenders, setMyVehicleRenders] = useState<RenderRow[]>([]);
  const [picks, setPicks] = useState<Record<string, string>>({}); // ad.id → render url
  const [generating, setGenerating] = useState(false);
  const [zipUrl, setZipUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: ADS.length });

  const stageRef = useRef<Konva.Stage | null>(null);
  const [activeAd, setActiveAd] = useState<Ad | null>(null);
  const [activeSlide, setActiveSlide] = useState<Slide | null>(null);
  const [activeImage, setActiveImage] = useState<HTMLImageElement | null>(null);

  // Load renders on mount.
  //
  // Strategy: cast a wide net so the gallery actually populates even when
  // tool_source is null (legacy rows) or RLS scopes the query to user-owned
  // rows only. Pull from THREE sources in parallel and merge:
  //   1. color_visualizations  — ColorPro + MyVehiclePro tool_source rows
  //   2. color_visualizations  — ANY rows with render_urls (legacy fallback)
  //   3. marketplace_listings  — public marketplace renders (admin-visible)
  //   4. vehicle_renders       — canonical demo renders (always present)
  //
  // We tag each row with its inferred bucket ("ColorPro" / "MyVehiclePro" /
  // "Other") so the per-ad render picker can still prefer the right tool
  // when it can, and fall back to the broader pool when it can't.
  useEffect(() => {
    ensureFontsLoaded().catch(() => { /* non-fatal */ });

    (async () => {
      const sources: { name: string; rows: RenderRow[]; bucket: "ColorPro" | "MyVehiclePro" | "Other" }[] = [];

      const mapColorViz = (data: any[], bucket: "ColorPro" | "MyVehiclePro" | "Other"): RenderRow[] =>
        (data || [])
          .map((r: any) => ({
            id: r.id,
            url: pickFirstUrl(r.render_urls) || "",
            vehicle: [r.vehicle_year, r.vehicle_make, r.vehicle_model].filter(Boolean).join(" "),
            tool_source: r.tool_source ?? null,
            mode_type: r.mode_type ?? null,
          }))
          .filter((r: RenderRow) => r.url)
          .map((r: RenderRow) => ({ ...r, tool_source: r.tool_source || bucket }));

      // 1) Tagged ColorPro
      const cp = await (supabase as any)
        .from("color_visualizations")
        .select("id,render_urls,vehicle_make,vehicle_model,vehicle_year,tool_source,mode_type")
        .eq("tool_source", "ColorPro")
        .not("render_urls", "is", null)
        .order("created_at", { ascending: false })
        .limit(40);
      sources.push({ name: "ColorPro (tagged)", rows: mapColorViz(cp.data, "ColorPro"), bucket: "ColorPro" });

      // 2) Tagged MyVehiclePro
      const mv = await (supabase as any)
        .from("color_visualizations")
        .select("id,render_urls,vehicle_make,vehicle_model,vehicle_year,tool_source,mode_type")
        .eq("tool_source", "MyVehiclePro")
        .not("render_urls", "is", null)
        .order("created_at", { ascending: false })
        .limit(40);
      sources.push({ name: "MyVehiclePro (tagged)", rows: mapColorViz(mv.data, "MyVehiclePro"), bucket: "MyVehiclePro" });

      // 3) Untagged color_visualizations fallback (ANY rows with render_urls)
      const anyCV = await (supabase as any)
        .from("color_visualizations")
        .select("id,render_urls,vehicle_make,vehicle_model,vehicle_year,tool_source,mode_type")
        .not("render_urls", "is", null)
        .order("created_at", { ascending: false })
        .limit(80);
      // Skip rows already in the tagged sets so we don't dupe
      const taggedIds = new Set([...(cp.data || []), ...(mv.data || [])].map((r: any) => r.id));
      const otherCV = (anyCV.data || []).filter((r: any) => !taggedIds.has(r.id));
      sources.push({ name: "color_visualizations (any)", rows: mapColorViz(otherCV, "Other"), bucket: "Other" });

      // 4) marketplace_listings (admin-visible public renders)
      const ml = await (supabase as any)
        .from("marketplace_listings")
        .select("id,render_urls,thumbnail_url,vehicle_make,vehicle_model,vehicle_year,title")
        .not("render_urls", "is", null)
        .order("created_at", { ascending: false })
        .limit(40);
      const mlRows: RenderRow[] = (ml.data || [])
        .map((r: any) => ({
          id: r.id,
          url: pickFirstUrl(r.render_urls) || r.thumbnail_url || "",
          vehicle: [r.vehicle_year, r.vehicle_make, r.vehicle_model].filter(Boolean).join(" ") || r.title || "",
          tool_source: "Marketplace",
          mode_type: null,
        }))
        .filter((r: RenderRow) => r.url);
      sources.push({ name: "marketplace_listings", rows: mlRows, bucket: "Other" });

      // 5) vehicle_renders (canonical demo renders — always there)
      const vr = await (supabase as any)
        .from("vehicle_renders")
        .select("id,render_url,vehicle_make,vehicle_model,vehicle_year,mode_type")
        .not("render_url", "is", null)
        .order("created_at", { ascending: false })
        .limit(40);
      const vrRows: RenderRow[] = (vr.data || [])
        .map((r: any) => ({
          id: r.id,
          url: r.render_url || "",
          vehicle: [r.vehicle_year, r.vehicle_make, r.vehicle_model].filter(Boolean).join(" "),
          tool_source: "vehicle_renders",
          mode_type: r.mode_type ?? null,
        }))
        .filter((r: RenderRow) => r.url);
      sources.push({ name: "vehicle_renders", rows: vrRows, bucket: "Other" });

      // Distribute by bucket
      const cpRows = sources.find((s) => s.bucket === "ColorPro")?.rows || [];
      const mvRows = sources.find((s) => s.bucket === "MyVehiclePro")?.rows || [];
      const otherRows = sources.filter((s) => s.bucket === "Other").flatMap((s) => s.rows);

      // If a tool bucket is empty, lend it the otherRows so the picker isn't blank
      const finalCp = cpRows.length > 0 ? cpRows : otherRows;
      const finalMv = mvRows.length > 0 ? mvRows : otherRows;
      setColorProRenders(finalCp);
      setMyVehicleRenders(finalMv);

      // Auto-pick: rotate through the pool so every ad gets a DIFFERENT
      // render. Previously every ad picked pool[0] which meant 18 identical
      // creatives — same vehicle, same angle, no variety. Now ad i picks
      // pool[i % pool.length], so 10 ads get 10 unique renders (or as
      // many as the pool has, looping if fewer).
      const auto: Record<string, string> = {};
      ADS.forEach((ad, i) => {
        const pool = ad.recommendedTool === "MyVehiclePro" ? finalMv : finalCp;
        if (pool.length > 0) auto[ad.id] = pool[i % pool.length].url;
      });
      setPicks(auto);

      const totalLoaded = cpRows.length + mvRows.length + otherRows.length;
      if (totalLoaded === 0) {
        toast.error("No renders found in any source. Generate one in ColorPro or MyVehiclePro first, or check Supabase RLS.");
      } else {
        const summary = sources
          .filter((s) => s.rows.length > 0)
          .map((s) => `${s.rows.length} ${s.name}`)
          .join(" · ");
        console.log(`[ads-launch-pack] Loaded renders: ${summary}`);
      }
    })();
  }, []);

  // Update active image when activeAd changes
  useEffect(() => {
    if (!activeAd) { setActiveImage(null); return; }
    const url = picks[activeAd.id];
    if (!url) { setActiveImage(null); return; }
    loadImage(url).then(setActiveImage).catch(() => setActiveImage(null));
  }, [activeAd, picks]);

  const allRenders = useMemo(() => [...colorProRenders, ...myVehicleRenders], [colorProRenders, myVehicleRenders]);

  async function generateAll() {
    if (allRenders.length === 0) {
      toast.error("No renders available — generate one in ColorPro or MyVehiclePro first.");
      return;
    }
    setGenerating(true);
    setZipUrl(null);
    const totalSteps = ADS.length + CAROUSEL.length;
    setProgress({ done: 0, total: totalSteps });
    await ensureFontsLoaded();

    const zip = new JSZip();
    let stepIdx = 0;

    // ── Pass 1: 10 single ads ────────────────────────────────────────
    for (let i = 0; i < ADS.length; i++) {
      const ad = ADS[i];
      const renderUrl = picks[ad.id] || allRenders[0]?.url;
      if (!renderUrl) {
        console.warn(`[ads-pack] no render for ad ${ad.id}, skipping`);
        stepIdx++;
        setProgress({ done: stepIdx, total: totalSteps });
        continue;
      }

      try {
        setActiveSlide(null);
        setActiveAd(ad);
        const img = await loadImage(renderUrl);
        setActiveImage(img);
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        await new Promise((r) => setTimeout(r, 250));

        if (!stageRef.current) throw new Error("Konva stage not mounted");
        const dataUrl = stageRef.current.toDataURL({ mimeType: "image/png", pixelRatio: 1 });
        const res = await fetch(dataUrl);
        const blob = await res.blob();

        const fileName = `ads/${ad.id}-${ad.category.toLowerCase().replace(/\s+/g, "-")}.png`;
        zip.file(fileName, blob);
        stepIdx++;
        setProgress({ done: stepIdx, total: totalSteps });
      } catch (err: any) {
        console.error(`[ads-pack] failed ${ad.id}:`, err);
        toast.error(`Ad ${ad.id} failed: ${err?.message || "unknown"}`);
        stepIdx++;
        setProgress({ done: stepIdx, total: totalSteps });
      }
    }

    // ── Pass 2: 8-slide carousel ─────────────────────────────────────
    // Use the most recent ColorPro/MyVehiclePro render as the visual
    // anchor for slides that need one (4, 7, 8). Text-only slides get
    // a solid background.
    const carouselRenderUrl = colorProRenders[0]?.url || myVehicleRenders[0]?.url || allRenders[0]?.url;
    let carouselImg: HTMLImageElement | null = null;
    if (carouselRenderUrl) {
      try { carouselImg = await loadImage(carouselRenderUrl); } catch (_) { /* skip */ }
    }

    for (let i = 0; i < CAROUSEL.length; i++) {
      const slide = CAROUSEL[i];
      try {
        setActiveAd(null);
        setActiveSlide(slide);
        setActiveImage(slide.useRender ? carouselImg : null);
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        await new Promise((r) => setTimeout(r, 250));

        if (!stageRef.current) throw new Error("Konva stage not mounted");
        const dataUrl = stageRef.current.toDataURL({ mimeType: "image/png", pixelRatio: 1 });
        const res = await fetch(dataUrl);
        const blob = await res.blob();

        zip.file(`carousel/${slide.id}.png`, blob);
        stepIdx++;
        setProgress({ done: stepIdx, total: totalSteps });
      } catch (err: any) {
        console.error(`[ads-pack] failed slide ${slide.id}:`, err);
        toast.error(`Slide ${slide.id} failed: ${err?.message || "unknown"}`);
        stepIdx++;
        setProgress({ done: stepIdx, total: totalSteps });
      }
    }

    const blob = await zip.generateAsync({ type: "blob" });
    setZipUrl(URL.createObjectURL(blob));
    setActiveAd(null);
    setActiveSlide(null);
    setGenerating(false);
    toast.success(`Generated ${ADS.length} ads + ${CAROUSEL.length}-slide carousel — zip ready.`);
  }

  // Active stage state — either an Ad or a Slide is selected, not both.
  // Slides are Ads with an eyebrow string; both go through buildElements.
  const active: Ad | null = activeAd || activeSlide;
  const renderRect = active ? getRenderRect(active.layout) : null;
  const elements = active ? buildElements(active) : [];

  return (
    <div style={{ minHeight: "100vh", background: "#FAFAF7", padding: "24px 20px" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <Link to="/admin/content-studio" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#555", textDecoration: "none", marginBottom: 16 }}>
          <ArrowLeft size={14} /> Back to Content Studio
        </Link>

        <h1 style={{ fontSize: 32, fontWeight: 800, color: "#0A0A0A", marginBottom: 4 }}>
          Ads Launch Pack — Design. Show. Close.
        </h1>
        <p style={{ fontSize: 14, color: "#555", marginBottom: 24, maxWidth: 720 }}>
          The revenue engine for wrap shops. <strong>10 hardened pain-money-mechanism ads</strong> + an <strong>8-slide carousel</strong> (hook → problem → shift → USP → system → money → authority → CTA), all baked from your ColorPro + MyVehiclePro renders. One click, one zip, drop into Meta Ads Manager.
        </p>

        {/* Render gallery snapshot */}
        <Card style={{ padding: 16, marginBottom: 18, background: "#fff", border: "1px solid #ececec" }}>
          <p style={{ fontSize: 13, color: "#0A0A0A", margin: 0, marginBottom: 4, fontWeight: 700 }}>
            Available renders: {colorProRenders.length} for ColorPro slots · {myVehicleRenders.length} for MyVehiclePro slots
          </p>
          <p style={{ fontSize: 12, color: "#666", margin: 0 }}>
            Pulled from color_visualizations, marketplace_listings, and vehicle_renders. Auto-picked the most recent; click any thumb in an ad row to swap.
            {colorProRenders.length === 0 && myVehicleRenders.length === 0 && (
              <span style={{ color: "#c00", fontWeight: 700 }}> · No renders loaded — generate one in ColorPro or MyVehiclePro first.</span>
            )}
          </p>
        </Card>

        {/* The 10 ads — pick a render per ad */}
        <Card style={{ padding: 0, background: "#fff", border: "1px solid #ececec", marginBottom: 18, overflow: "hidden" }}>
          {ADS.map((ad, i) => {
            const pickedUrl = picks[ad.id];
            const pool = ad.recommendedTool === "MyVehiclePro" ? myVehicleRenders : colorProRenders;
            const fallbackPool = ad.recommendedTool === "MyVehiclePro" ? colorProRenders : myVehicleRenders;
            const fullPool = [...pool, ...fallbackPool];
            return (
              <div key={ad.id} style={{ padding: 14, borderTop: i === 0 ? "none" : "1px solid #f0f0f0", display: "grid", gridTemplateColumns: "120px 1fr", gap: 14, alignItems: "center" }}>
                {pickedUrl ? (
                  <img src={pickedUrl} alt="" style={{ width: 120, height: 150, objectFit: "cover", borderRadius: 4, background: "#eee" }} />
                ) : (
                  <div style={{ width: 120, height: 150, background: "#eee", borderRadius: 4 }} />
                )}
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: "#0080dd", margin: 0, textTransform: "uppercase", letterSpacing: 1 }}>
                      {ad.id} · {ad.category} · {ad.recommendedTool === "either" ? "Any tool" : ad.recommendedTool}
                    </p>
                  </div>
                  <p style={{ fontSize: 14, fontWeight: 800, color: "#0A0A0A", margin: 0, marginBottom: 4, whiteSpace: "pre-line" }}>{ad.headline}</p>
                  <p style={{ fontSize: 12, color: "#555", margin: 0, marginBottom: 8 }}>{ad.subhead}</p>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {fullPool.slice(0, 12).map((r) => (
                      <button
                        key={r.id}
                        onClick={() => setPicks((p) => ({ ...p, [ad.id]: r.url }))}
                        title={r.vehicle}
                        style={{
                          width: 50, height: 60, borderRadius: 3, padding: 0, cursor: "pointer", overflow: "hidden",
                          border: pickedUrl === r.url ? "2px solid #0A0A0A" : "1px solid #ddd",
                          background: "#fff",
                        }}
                      >
                        <img src={r.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </Card>

        {/* Generate */}
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Button onClick={generateAll} disabled={generating || allRenders.length === 0} size="lg" style={{ background: "#0A0A0A", color: "#fff" }}>
            {generating
              ? <><Loader2 size={16} style={{ marginRight: 6 }} className="animate-spin" /> Generating {progress.done}/{progress.total}…</>
              : <>Generate {ADS.length} ads + {CAROUSEL.length}-slide carousel</>}
          </Button>
          {zipUrl && (
            <Button asChild size="lg" variant="outline">
              <a href={zipUrl} download="restylepro-ads-launch-pack.zip">
                <Download size={16} style={{ marginRight: 6 }} /> Download zip ({ADS.length + CAROUSEL.length} PNGs)
              </a>
            </Button>
          )}
        </div>

        {/* Off-screen Konva stage — used for both single ads and carousel slides.
            Layer order matters:
              1. Background rect (always element[0] in the spec — bg color)
              2. Render image (KonvaImage) if a slot exists for this layout
              3. All other elements (text + overlay rects, drawn ON TOP of render) */}
        {(activeAd || activeSlide) && (
          <div style={{ position: "fixed", left: -100000, top: 0, pointerEvents: "none" }} aria-hidden>
            <Stage ref={(node) => { stageRef.current = node; }} width={1080} height={1350}>
              <Layer>
                {/* 1. Background — element[0] from the spec */}
                {elements[0] && elements[0].type === "rect" && (
                  <Rect x={elements[0].x} y={elements[0].y} width={elements[0].width} height={elements[0].height} fill={elements[0].fill || BRAND.white} opacity={elements[0].opacity ?? 1} />
                )}
                {/* 2. Render slot */}
                {renderRect && activeImage && (
                  <KonvaImage x={renderRect.x} y={renderRect.y} width={renderRect.width} height={renderRect.height} image={activeImage} />
                )}
                {/* 3. Everything else (text + overlay rects, on top of render) */}
                {elements.slice(1).map((el, idx) => {
                  if (el.type === "rect") {
                    return <Rect key={idx} x={el.x} y={el.y} width={el.width} height={el.height} fill={el.fill || "#000"} opacity={el.opacity ?? 1} cornerRadius={el.cornerRadius} />;
                  }
                  if (el.type === "text") {
                    return <Text key={idx} x={el.x} y={el.y} width={el.width} height={el.height} text={el.text || ""} fontSize={el.fontSize || 32} fontFamily={el.fontFamily || "Poppins"} fontStyle={el.fontStyle} fill={el.fill || "#000"} align={el.align as any} verticalAlign={el.verticalAlign as any} />;
                  }
                  return null;
                })}
              </Layer>
            </Stage>
          </div>
        )}
      </div>
    </div>
  );
}
