/**
 * AdminContentStudio — Content Studio™
 * Redesigned to match ProductionFlow UI — dark brand bar, gradient buttons, left tool panel, big canvas view
 * Features: ContentFlow AI Generate, Canva template upload, Konva canvas editor, templates, hooks, export
 */
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Stage, Layer, Rect, Text, Image as KonvaImage, Group, Transformer } from "react-konva";
import type Konva from "konva";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ArrowLeft, Download, Type, ImageIcon, Palette, LayoutGrid,
  Sparkles, Copy, Trash2, MoveUp, MoveDown, Plus, RotateCcw,
  AlignCenter, AlignLeft, AlignRight, Bold, Italic, Layers,
  Upload, Zap, BookOpen, ChevronRight, Wand2, FileImage,
  Save, FolderOpen, FilePlus,
} from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { RenderBrowser } from "@/components/RenderBrowser";
import AutonomousBuildPanel from "@/components/admin/AutonomousBuildPanel";
import { readEdgeError, isCanvaNotConnected } from "@/lib/edgeError";
import MarketingSuiteGuide from "@/components/admin/MarketingSuiteGuide";
import TemplateGeneratorPanel from "@/components/admin/TemplateGeneratorPanel";
import { UploadedAssetsBrowser } from "@/components/UploadedAssetsBrowser";
import { supabase } from "@/integrations/supabase/client";
import { useIsMobile } from "@/hooks/use-mobile";
import { brandMeta, productMeta, tint } from "@/lib/content-tags";

// Content Studio brand-selector value → ecosystem brand slug (for canonical colors).
const CS_BRAND_SLUG: Record<string, string> = {
  DesignProAI: "restylepro", WePrintWraps: "weprintwraps", DesignProAI: "designproai", WrapTV: "wraptvworld", InkAndEdge: "inkandedge",
};
const csBrandColor = (v: string) => brandMeta(CS_BRAND_SLUG[v] || v).color;

// ── Format presets ──────────────────────────────────────────────────
interface FormatPreset {
  label: string;
  width: number;
  height: number;
  category: string;
}

// Order requested by product: 4:5 first → Reels → Carousels → 1:1 → everything else
const FORMAT_PRESETS: FormatPreset[] = [
  // 1. Portrait Post (4:5) — default + first shown
  { label: "Portrait Post (4:5)", width: 1080, height: 1350, category: "Posts" },
  // 2. Reels & Stories
  { label: "IG Reel (9:16)", width: 1080, height: 1920, category: "Reels & Stories" },
  { label: "IG Story (9:16)", width: 1080, height: 1920, category: "Reels & Stories" },
  { label: "TikTok (9:16)", width: 1080, height: 1920, category: "Reels & Stories" },
  { label: "Reels Cover (9:16)", width: 1080, height: 1920, category: "Reels & Stories" },
  // 3. Carousel slides
  { label: "Carousel Slide (4:5)", width: 1080, height: 1350, category: "Carousels" },
  { label: "Carousel Slide (1:1)", width: 1080, height: 1080, category: "Carousels" },
  // 4. Square Post (1:1) — last of the majors
  { label: "Square Post (1:1)", width: 1080, height: 1080, category: "Posts" },
  // Everything else
  { label: "Twitter/X Post", width: 1200, height: 675, category: "Posts" },
  { label: "Pinterest Pin (2:3)", width: 1000, height: 1500, category: "Posts" },
  { label: "FB Ad Landscape (16:9)", width: 1200, height: 628, category: "Ads & Video" },
  { label: "YouTube Thumbnail (16:9)", width: 1280, height: 720, category: "Ads & Video" },
  { label: "FB Cover (820x312)", width: 820, height: 312, category: "Ads & Video" },
];

// ── Brand kit ───────────────────────────────────────────────────────
const BRAND = {
  cyan: "#00C7FF",
  black: "#000000",
  white: "#FFFFFF",
  darkGray: "#1A1A1A",
  midGray: "#2A2A2A",
  gradient1: "#3B82F6",
  gradient2: "#9b87f5",
  gradient3: "#D946EF",
  accent: "#F59E0B",
};

const BRAND_FONTS = ["Archivo Black", "Archivo", "Poppins", "Oswald", "Inter", "Montserrat", "Bebas Neue"];

// WePrintWraps Brand Standard 01 (2026) — the canonical WPW design tokens.
const WPW = {
  carbon: "#07090B",
  shopWhite: "#F5F5F2",
  blue: "#0F9BD8",     // WPW Blue (mid of #12B8E8 → #0874B9)
  blueLight: "#12B8E8",
  blueDark: "#0874B9",
  gold: "#FBB318",     // WPW Gold (mid of #FFD51A → #F58220)
  magenta: "#DA0C7A",  // WPW Magenta (mid of #F20A83 → #C20B72)
};

// ── ContentFlow AI Content Generator ────────────────────────────────
interface GeneratedContent {
  hook: string;
  headline: string;
  body: string;
  cta: string;
}

// ── TYPOGRAPHIC CONSTRAINT PROFILES ────────────────────────────────
// Each text zone has constraints that match how text visually fits
// on social media templates: character density, line count, weight.
interface TypographicConstraints {
  maxLines: number;
  wordsPerLine: [number, number]; // [min, max] words per line
  charRange: [number, number];   // [min, max] non-space characters
  density: "tight" | "balanced" | "loose";
  weight: "bold" | "medium" | "light";
  style: "punchy" | "descriptive" | "conversational";
}

const TEXT_ZONE_CONSTRAINTS: Record<string, TypographicConstraints> = {
  hook: {
    maxLines: 2,
    wordsPerLine: [2, 5],
    charRange: [15, 38],
    density: "balanced",
    weight: "bold",
    style: "punchy",
  },
  headline: {
    maxLines: 2,
    wordsPerLine: [2, 6],
    charRange: [18, 50],
    density: "balanced",
    weight: "bold",
    style: "punchy",
  },
  body: {
    maxLines: 4,
    wordsPerLine: [4, 10],
    charRange: [40, 160],
    density: "loose",
    weight: "medium",
    style: "descriptive",
  },
  cta: {
    maxLines: 1,
    wordsPerLine: [2, 5],
    charRange: [10, 26],
    density: "tight",
    weight: "bold",
    style: "punchy",
  },
};

// ── VISUAL BALANCE CHECK ───────────────────────────────────────────
function isVisuallyBalanced(text: string, constraints: TypographicConstraints): boolean {
  const charCount = text.replace(/\s/g, "").length;
  const lines = text.split("\n").filter(l => l.trim());
  if (charCount < constraints.charRange[0] || charCount > constraints.charRange[1]) return false;
  if (lines.length > constraints.maxLines) return false;
  for (const line of lines) {
    const wordCount = line.trim().split(/\s+/).length;
    if (wordCount < constraints.wordsPerLine[0] || wordCount > constraints.wordsPerLine[1]) return false;
  }
  return true;
}

// ── SAFETY FILTER ──────────────────────────────────────────────────
const BANNED_PHRASES = [
  "guaranteed", "instant results", "no risk", "get rich", "100% free",
  "act now or", "limited time only", "you won't believe", "doctors hate",
  "one weird trick", "miracle", "secret they don't want",
];

function safetyCheck(text: string): boolean {
  const lower = text.toLowerCase();
  return !BANNED_PHRASES.some(phrase => lower.includes(phrase));
}

// ── TEXT REFINEMENT PIPELINE ───────────────────────────────────────
// Trims, rebalances, and enforces constraints on generated text
function refineText(text: string, zone: string): string {
  const constraints = TEXT_ZONE_CONSTRAINTS[zone];
  if (!constraints) return text.trim();

  let refined = text.trim();

  // Safety: strip banned phrases
  if (!safetyCheck(refined)) {
    for (const phrase of BANNED_PHRASES) {
      const re = new RegExp(phrase, "gi");
      refined = refined.replace(re, "").replace(/\s{2,}/g, " ").trim();
    }
  }

  // Enforce character range (non-space chars)
  const charCount = refined.replace(/\s/g, "").length;
  if (charCount > constraints.charRange[1]) {
    // Trim words from the end until within range
    const words = refined.split(/\s+/);
    while (words.length > 1 && words.join(" ").replace(/\s/g, "").length > constraints.charRange[1]) {
      words.pop();
    }
    refined = words.join(" ");
    // Add ellipsis if we had to trim significantly
    if (refined.replace(/\s/g, "").length < charCount * 0.7) {
      refined = refined.trimEnd().replace(/[.,;:!?]*$/, "") + "…";
    }
  }

  // Enforce max lines
  const lines = refined.split("\n");
  if (lines.length > constraints.maxLines) {
    refined = lines.slice(0, constraints.maxLines).join("\n");
  }

  // Rebalance: if single long line exceeds word density, split into 2 lines
  if (constraints.maxLines >= 2 && !refined.includes("\n")) {
    const words = refined.split(/\s+/);
    if (words.length > constraints.wordsPerLine[1]) {
      const mid = Math.ceil(words.length / 2);
      refined = words.slice(0, mid).join(" ") + "\n" + words.slice(mid).join(" ");
    }
  }

  return refined;
}

const BRAND_LABEL: Record<string, string> = {
  DesignProAI: "DesignProAI\u2122",
  WePrintWraps: "WePrintWraps.com",
  WrapTV: "WrapTV World",
  InkAndEdge: "Ink & Edge Magazine",
};

// Template content-type → Gemini output aspect — the image editor MUST be
// told the shape or it defaults everything to 16:9.
const TEMPLATE_ASPECT: Record<string, string> = {
  "static-4x5": "4:5", carousel: "1:1", "static-1x1": "1:1",
  story: "9:16", reel: "9:16", "static-9x16": "9:16", "static-16x9": "16:9",
};

// ── Hooks brain — lives ONLY in content_hooks (Hooks Manager /admin/hooks) ──
// The old hardcoded HOOKS_LIBRARY / TOOL_CONTENT / CONTENT_* copy arrays were
// seeded into that table (20260803000000_seed_content_hooks_from_studio.sql)
// and deleted from this file — Content OS execution priority 1: one hook
// library in the DB, nothing competing with it in code.
const BRAND_HOOK_SLUGS: Record<string, string[]> = {
  DesignProAI: ["restylepro", "designproai"],
  DesignProAI: ["designproai"],
  WePrintWraps: ["weprintwraps"],
  WrapTV: ["wraptvworld"],
  WrapTVWorld: ["wraptvworld"],
  InkAndEdge: ["inkandedge"],
  TheWrap: ["thewrap"],
};
const brandHooksCache = new Map<string, string[]>();
// Brand-relevant sample of the saved hook library — sent with every template
// rewrite so the AI writes in OUR proven voice, not generic ad copy.
// Spread-sampled so the whole library is represented, not just the newest.
async function hooksLibraryForBrand(brand: string, max = 40): Promise<string[] | undefined> {
  const slugs = BRAND_HOOK_SLUGS[brand] || [brand.toLowerCase()];
  const key = slugs.join("|");
  if (!brandHooksCache.has(key)) {
    const { data } = await (supabase as any)
      .from("content_hooks")
      .select("text")
      .in("brand", slugs)
      .eq("active", true)
      .order("score", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(400);
    brandHooksCache.set(key, ((data || []) as { text: string }[]).map(h => h.text).filter(Boolean));
  }
  const all = brandHooksCache.get(key)!;
  if (!all.length) return undefined;
  const step = Math.max(1, Math.floor(all.length / max));
  const out: string[] = [];
  for (let i = 0; i < all.length && out.length < max; i += step) out.push(all[i]);
  return out;
}

// ── Pre-written Content Packs — complete sets matched to template styles ───
// Each pack is a full headline + body + CTA designed together.
// User picks a pack → all fields fill at once → apply to template.

interface ContentPack {
  id: string;
  style: string;       // Template style it matches
  headline: string;
  body: string;
  cta: string;
  tool?: string;       // Which RP tool it spotlights
}

const CONTENT_PACKS: ContentPack[] = [
  // SET 1 — Hero style ("Find Your Balance")
  { id: "hero-1", style: "Hero / Balance", headline: "FIND YOUR FLOW", body: "Design faster.\nOutput cleaner.\nClose with confidence.", cta: "From concept → production → profit" },
  { id: "hero-1-alt", style: "Hero / Balance", headline: "CONTROL YOUR WORKFLOW", body: "No delays.\nNo disconnect.\nNo guesswork.", cta: "Start your next design" },

  // SET 2 — Bold Block ("Awaken Your Body")
  { id: "bold-1", style: "Bold Block", headline: "STOP WAITING ON DESIGNS", body: "• High-end wrap design\n• Photorealistic previews\n• Production-ready output\n\nMove from idea → approval → production faster.", cta: "See it before you print it" },
  { id: "bold-1-alt", style: "Bold Block", headline: "DESIGN SHOULDN'T SLOW YOU DOWN", body: "If your design process is taking days...\n\nThat's where your jobs are getting stuck.", cta: "Build your workflow" },

  // SET 3 — Educational Card ("Yoga Exercises")
  { id: "edu-1", style: "Educational Card", headline: "3 REASONS SHOPS GET STUCK", body: "Design delays\nBroken output\nNo follow-up\n\nMost shops lose time before production even starts.\nFix the system — everything moves faster.", cta: "Start with design. Fix everything downstream." },

  // SET 4 — Aspirational ("Stretch Beyond Limits")
  { id: "aspire-1", style: "Aspirational", headline: "GO BEYOND BASIC MOCKUPS", body: "Flat proofs don't close deals.\n\nPhotorealistic design shows your customer exactly what they're getting —\n\nBefore you ever print.", cta: "Stop guessing. Start showing." },
  { id: "aspire-1-alt", style: "Aspirational", headline: "SHOW IT BEFORE YOU MAKE IT", body: "Your customers want to see it first.\n\n7 camera angles. Photorealistic quality.\nProduction-ready files included.", cta: "See it in action" },

  // SET 5 — Minimal ("Stop & Breathe")
  { id: "minimal-1", style: "Minimal / Calm", headline: "STOP & SIMPLIFY", body: "Too many tools\nToo many steps\nToo much friction\n\nWe built one system.", cta: "Design. Output. Profit." },

  // SET 6 — Feature Spotlight (Product style)
  { id: "feature-design", style: "Feature Spotlight", headline: "NEW DESIGN FLOW", body: "Photorealistic previews\nMulti-angle renders\nReal vehicle scale", cta: "DesignPro™", tool: "DesignProAI" },
  { id: "feature-output", style: "Feature Spotlight", headline: "PRODUCTION READY", body: "Panel layouts\nClean files\nPrint-ready output", cta: "ProductionFlow™", tool: "ProductionFlow" },
  { id: "feature-profit", style: "Feature Spotlight", headline: "TURN WORK INTO REVENUE", body: "Retarget customers\nStay top of mind\nDrive repeat business", cta: "MightyMail™", tool: "MightyMail" },

  // SET 7 — Feature Grid ("Design. Output. Profit.")
  { id: "grid-1", style: "Feature Grid", headline: "DESIGN. OUTPUT. PROFIT.", body: "Design — High-end wrap creation\nOutput — Production-ready files\nProfit — Built-in retargeting", cta: "Build your workflow" },

  // SET 8 — Stacked Overlays (feature + outcome pairs)
  { id: "stack-design", style: "Stacked Overlay", headline: "Photoreal previews", body: "Close faster", cta: "DesignPro™", tool: "DesignProAI" },
  { id: "stack-quote", style: "Stacked Overlay", headline: "Quotes in seconds", body: "Win the job", cta: "QuickQuote™", tool: "QuickQuote" },
  { id: "stack-system", style: "Stacked Overlay", headline: "One system", body: "Everything connected", cta: "Design. Output. Profit." },
  { id: "stack-fomo", style: "Stacked Overlay", headline: "Still waiting on designs?", body: "They already booked", cta: "Stop guessing — start showing" },
  { id: "stack-premium", style: "Stacked Overlay", headline: "Enterprise-level design", body: "Without the delay", cta: "See it in action" },
  { id: "stack-output", style: "Stacked Overlay", headline: "Ready for print", body: "No broken files", cta: "ProductionFlow™", tool: "ProductionFlow" },
  { id: "stack-retarget", style: "Stacked Overlay", headline: "They forgot you", body: "Someone else followed up", cta: "MightyMail™", tool: "MightyMail" },

  // SET 9 — Scroll-Stop Ads (LINE 1 BIG + LINE 2 SMALL — if it doesn't stop scroll in 1 sec, too soft)
  { id: "ad-1", style: "Scroll-Stop Ad", headline: "YOUR CAR. YOUR WRAP.", body: "See it before you print it", cta: "MyVehiclePro™" },
  { id: "ad-2", style: "Scroll-Stop Ad", headline: "STOP SENDING MOCKUPS", body: "Show them the real vehicle", cta: "See it in action" },
  { id: "ad-3", style: "Scroll-Stop Ad", headline: "THIS CLOSES THE DEAL", body: "Photoreal on their car", cta: "Start your next design" },
  { id: "ad-4", style: "Scroll-Stop Ad", headline: "SEE IT. SELL IT.", body: "Real previews. Faster approvals.", cta: "DesignProAI.com" },
  { id: "ad-5", style: "Scroll-Stop Ad", headline: "NOT A MOCKUP", body: "Their actual vehicle", cta: "Show it before you sell it" },
  { id: "ad-6", style: "Scroll-Stop Ad", headline: "STILL USING MOCKUPS?", body: "This is why you lose", cta: "Fix your workflow today" },
  { id: "ad-7", style: "Scroll-Stop Ad", headline: "UPLOAD → RENDER → CLOSE", body: "Minutes, not days", cta: "Stop waiting on design" },
  { id: "ad-8", style: "Scroll-Stop Ad", headline: "ENTERPRISE-LEVEL PREVIEWS", body: "On real vehicles", cta: "See it in action" },
  { id: "ad-9", style: "Scroll-Stop Ad", headline: "PHOTOSHOP — BUT SMARTER", body: "Designer built in", cta: "MyVehiclePro™" },
  { id: "ad-10", style: "Scroll-Stop Ad", headline: "SHOW THEM THIS", body: "Close more wrap jobs", cta: "Start your next design" },
  { id: "ad-11", style: "Scroll-Stop Ad", headline: "NO MORE \"IMAGINE THIS\"", body: "Show them exactly", cta: "Stop guessing — start showing" },
  { id: "ad-12", style: "Scroll-Stop Ad", headline: "REAL CAR. REAL RESULT.", body: "No guesswork", cta: "See your wrap before print" },
  { id: "ad-13", style: "Scroll-Stop Ad", headline: "THIS IS WHAT THEY'RE BUYING", body: "Before you print", cta: "Close faster with clarity" },

  // SET 10 — MyVehiclePro™
  { id: "mvp-1", style: "MyVehiclePro™", headline: "YOUR CAR. YOUR WRAP.", body: "Not a mockup. Yours.\n\nUpload their actual vehicle.\nSee the real wrap.\nClose the deal.", cta: "MyVehiclePro™", tool: "MyVehiclePro" },
  { id: "mvp-2", style: "MyVehiclePro™", headline: "LIKE PHOTOSHOP\nBUT FASTER", body: "Photoshop gives you tools.\nMyVehiclePro gives you results.\n\nThe designer is already built in.", cta: "Upload. See it. Done." },
  { id: "mvp-3", style: "MyVehiclePro™", headline: "STILL USING MOCKUPS?", body: "Your competitor is showing THIS.\n\nReal vehicle. Real preview.\nNo more \"imagine this.\"", cta: "Show it before you sell it" },
  { id: "mvp-4", style: "MyVehiclePro™", headline: "PUT THE WRAP ON THEIR CAR", body: "This closes the deal.\n\nPhotoreal on real vehicles.\nPresentation = perception.", cta: "Stop sending mockups" },

  // SET 11 — Tool-Specific One-Screen Killers (BIG + small, highest clarity)
  { id: "kill-qq-1", style: "One-Screen Killer", headline: "QUOTE IT. CLOSE IT.", body: "Instant pricing.", cta: "QuickQuote™", tool: "QuickQuote" },
  { id: "kill-qq-2", style: "One-Screen Killer", headline: "PRICING WHILE THEY WAIT", body: "No delays. No lost deals.", cta: "QuickQuote™", tool: "QuickQuote" },
  { id: "kill-pf-1", style: "One-Screen Killer", headline: "READY FOR PRINT", body: "No breakdown.", cta: "ProductionFlow™", tool: "ProductionFlow" },
  { id: "kill-pf-2", style: "One-Screen Killer", headline: "FROM DESIGN TO DONE", body: "Seamless output.", cta: "ProductionFlow™", tool: "ProductionFlow" },
  { id: "kill-mvp-1", style: "One-Screen Killer", headline: "PUT IT ON THEIR CAR", body: "Real preview. No guesswork.", cta: "MyVehiclePro™", tool: "MyVehiclePro" },
  { id: "kill-dp-1", style: "One-Screen Killer", headline: "DESIGN WITHOUT DELAYS", body: "High-end. On demand.", cta: "DesignPro™", tool: "DesignProAI" },
  { id: "kill-dp-2", style: "One-Screen Killer", headline: "FROM IDEA TO APPROVAL", body: "Without the wait.", cta: "DesignPro™", tool: "DesignProAI" },
  { id: "kill-dp-3", style: "One-Screen Killer", headline: "CREATE. SHOW. APPROVE.", body: "All in one flow.", cta: "DesignPro™", tool: "DesignProAI" },
  { id: "kill-rev-1", style: "One-Screen Killer", headline: "NO MORE WAITING ON REVISIONS", body: "Edit. Approve. Done.", cta: "RevisionStudioIQ™", tool: "RevisionStudio" },
  { id: "kill-rev-2", style: "One-Screen Killer", headline: "REVISIONS IN YOUR HANDS", body: "No back and forth.", cta: "RevisionStudioIQ™", tool: "RevisionStudio" },
  { id: "kill-rev-3", style: "One-Screen Killer", headline: "STOP CHASING DESIGN CHANGES", body: "Control it yourself.", cta: "RevisionStudioIQ™", tool: "RevisionStudio" },
  { id: "kill-rev-4", style: "One-Screen Killer", headline: "EDIT IT. APPROVE IT. MOVE ON.", body: "Faster jobs.", cta: "RevisionStudioIQ™", tool: "RevisionStudio" },
  { id: "kill-sys-1", style: "One-Screen Killer", headline: "SEE EVERY JOB. LIVE.", body: "Total visibility.", cta: "Design. Output. Profit." },
  { id: "kill-sys-2", style: "One-Screen Killer", headline: "JUST TELL IT WHAT YOU WANT", body: "It builds the rest.", cta: "DesignProAI.com" },

  // SET 12 — Bottom Bar / Tool Strip
  { id: "bar-pf-1", style: "Tool Strip", headline: "ProductionFlow™", body: "Design → Output → Profit", cta: "" },
  { id: "bar-pf-2", style: "Tool Strip", headline: "ProductionFlow™", body: "From Design to Profit", cta: "" },
  { id: "bar-pf-3", style: "Tool Strip", headline: "ProductionFlow™", body: "Output That Makes You Money", cta: "" },
  { id: "bar-pf-4", style: "Tool Strip", headline: "ProductionFlow™", body: "Where Design Becomes Profit", cta: "" },
  { id: "bar-pf-5", style: "Tool Strip", headline: "ProductionFlow™", body: "Output. Aligned.", cta: "" },

  // SET 13 — Targeted Buyer Callouts (BIG callout + small solution)
  { id: "buyer-1", style: "Targeted Buyer", headline: "BURNING YOUR DESIGNER OUT?", body: "DesignPro™ takes the load off.", cta: "DesignPro™", tool: "DesignProAI" },
  { id: "buyer-2", style: "Targeted Buyer", headline: "TIRED OF COMPLICATED CMS?", body: "One system. Everything connected.", cta: "Design. Output. Profit." },
  { id: "buyer-3", style: "Targeted Buyer", headline: "STILL WAITING ON DESIGNS?", body: "30 seconds. 7 angles. Done.", cta: "Start your next design" },
  { id: "buyer-4", style: "Targeted Buyer", headline: "IF YOU'RE LOSING JOBS TO DELAYS", body: "Speed wins. Every time.", cta: "Fix your workflow today" },
  { id: "buyer-5", style: "Targeted Buyer", headline: "YOU DON'T NEED MORE TOOLS", body: "You need one system.", cta: "Design. Output. Profit." },
  { id: "buyer-6", style: "Targeted Buyer", headline: "STILL OUTSOURCING DESIGNS?", body: "Or ready to take control?", cta: "Bring it in-house" },

  // SET 14 — In-House Designer Angle (split audience)
  { id: "inhouse-1", style: "In-House Designer", headline: "READY TO HAVE YOUR OWN IN-HOUSE DESIGNER?", body: "No hiring. No delays.", cta: "DesignPro™", tool: "DesignProAI" },
  { id: "inhouse-2", style: "In-House Designer", headline: "YOUR OWN IN-HOUSE DESIGNER", body: "Built into your workflow.", cta: "Start designing in 60 seconds" },
  { id: "inhouse-3", style: "In-House Designer", headline: "ADD A DESIGNER — WITHOUT HIRING", body: "Scale instantly.", cta: "See it in action" },
  { id: "inhouse-4", style: "In-House Designer", headline: "STOP OUTSOURCING DESIGN", body: "Bring it in-house.", cta: "DesignProAI.com" },

  // SET 15 — Scale / 20X angle
  { id: "scale-1", style: "Scale / 20X", headline: "20X YOUR DESIGN OUTPUT", body: "Or stop outsourcing altogether.", cta: "DesignPro™", tool: "DesignProAI" },
  { id: "scale-2", style: "Scale / 20X", headline: "ALREADY HAVE A DESIGNER?", body: "20X their output.", cta: "Same designer. 10x the output." },
  { id: "scale-3", style: "Scale / 20X", headline: "DON'T HAVE ONE?", body: "Stop outsourcing.", cta: "Bring it in-house" },
  { id: "scale-4", style: "Scale / 20X", headline: "SCALE YOUR DESIGN TEAM", body: "Or bring it in-house.", cta: "No trade-offs. One platform." },
  { id: "scale-5", style: "Scale / 20X", headline: "MORE DESIGNS. LESS DEPENDENCE.", body: "That's the shift.", cta: "Design. Output. Profit." },

  // SET 16 — Witty / Smart Alec (confident, know-it-all energy)
  { id: "witty-1", style: "Witty / Smart Alec", headline: "YEAH, WE KNOW.", body: "Meet your new shop designer.", cta: "DesignPro™", tool: "DesignProAI" },
  { id: "witty-2", style: "Witty / Smart Alec", headline: "YOUR DESIGNER CALLED IN SICK?", body: "Good thing ours doesn't sleep.", cta: "Start your next design" },
  { id: "witty-3", style: "Witty / Smart Alec", headline: "OH, YOU'RE STILL OUTSOURCING?", body: "That's cute.", cta: "Bring it in-house" },
  { id: "witty-4", style: "Witty / Smart Alec", headline: "WE DIDN'T REPLACE YOUR DESIGNER", body: "We gave them superpowers.", cta: "20X their output" },
  { id: "witty-5", style: "Witty / Smart Alec", headline: "FLAT PROOFS IN 2026?", body: "Bold move.", cta: "See photoreal previews" },
  { id: "witty-6", style: "Witty / Smart Alec", headline: "7 ANGLES. 30 SECONDS.", body: "Your move.", cta: "Design. Output. Profit." },
  { id: "witty-7", style: "Witty / Smart Alec", headline: "YOUR COMPETITOR JUST SAW THIS", body: "Sleep tight.", cta: "DesignProAI.com" },
  { id: "witty-8", style: "Witty / Smart Alec", headline: "SORRY, FREELANCERS", body: "The AI showed up.", cta: "Start designing in 60 seconds" },
];

const PACK_STYLES = [...new Set(CONTENT_PACKS.map(p => p.style))];

// ── Template definitions ─────────────────────────────────────────────
interface TemplateLayer {
  type: "rect" | "text" | "imagePlaceholder";
  x: number;
  y: number;
  width: number;
  height: number;
  fill?: string;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  fontStyle?: string;
  fill2?: string;
  align?: string;
  verticalAlign?: string;
  opacity?: number;
  cornerRadius?: number;
  id?: string;
  imageUrl?: string;
}

interface TemplatePreset {
  name: string;
  description: string;
  format: string;
  layers: TemplateLayer[];
}

function buildTemplates(): TemplatePreset[] {
  return [
    {
      // WePrintWraps Brand Standard 01: framed hero, cyan-square eyebrow,
      // ARCHIVO BLACK headline with a WPW-Blue period, white footer bar with the
      // weprintwraps.com wordmark (.com in WPW Blue) + spec line. Drop a render
      // into the "hero" slot → finished, on-standard WePrintWraps installer ad.
      name: "WePrintWraps — Order It Online (Installer Ad)",
      description: "Framed hero + Archivo Black headline + weprintwraps.com wordmark + spec bar. Brand Standard 01.",
      format: "Portrait Post (4:5)",
      layers: [
        // shop-white page + carbon-framed hero photo
        { type: "rect", x: 0, y: 0, width: 1080, height: 1350, fill: WPW.shopWhite },
        { type: "rect", x: 30, y: 30, width: 1020, height: 1015, fill: WPW.carbon },
        { type: "imagePlaceholder", x: 42, y: 42, width: 996, height: 991, id: "hero" },
        // eyebrow — WPW-Blue square + wholesale line
        { type: "rect", x: 74, y: 96, width: 22, height: 22, fill: WPW.blue },
        { type: "text", x: 112, y: 92, width: 760, height: 34, text: "WHOLESALE WRAP PRINTING", fontSize: 24, fontFamily: "Archivo Black", fill2: "#FFFFFF" },
        { type: "text", x: 112, y: 128, width: 760, height: 28, text: "ONLINE  •  BUILT FOR INSTALLERS", fontSize: 17, fontFamily: "Inter", fill2: "#C9D2D8" },
        // headline block (over the dark left of the photo)
        { type: "text", x: 72, y: 594, width: 620, height: 46, text: "SOLD THE WRAP?", fontSize: 32, fontFamily: "Archivo", fill2: "#FFFFFF", fontStyle: "bold" },
        { type: "text", x: 66, y: 646, width: 940, height: 320, text: "ORDER IT\nONLINE", fontSize: 122, fontFamily: "Archivo Black", fill2: "#FFFFFF" },
        { type: "rect", x: 452, y: 872, width: 34, height: 34, fill: WPW.blue },
        // white footer bar — wordmark with .com in WPW Blue
        { type: "text", x: 74, y: 1082, width: 700, height: 30, text: "YOU INSTALL.  WE PRINT.", fontSize: 21, fontFamily: "Archivo", fill2: WPW.carbon, fontStyle: "bold" },
        { type: "text", x: 66, y: 1122, width: 640, height: 100, text: "weprintwraps", fontSize: 78, fontFamily: "Archivo Black", fill2: WPW.carbon },
        { type: "text", x: 628, y: 1122, width: 300, height: 100, text: ".com", fontSize: 78, fontFamily: "Archivo Black", fill2: WPW.blue },
        { type: "rect", x: 74, y: 1258, width: 932, height: 2, fill: "#111111" },
        { type: "text", x: 74, y: 1286, width: 932, height: 30, text: "PRE-FLIGHTED  /  LAMINATED  /  LABELED  /  SHIPPED", fontSize: 18, fontFamily: "Inter", fill2: "#3A3A3A" },
      ],
    },
    {
      name: "Product Showcase — Dark",
      description: "Dark bg, centered vehicle, feature tags, CTA bar",
      format: "Square Post (1:1)",
      layers: [
        { type: "rect", x: 0, y: 0, width: 1080, height: 1080, fill: BRAND.white },
        { type: "imagePlaceholder", x: 90, y: 180, width: 900, height: 500, id: "hero" },
        { type: "text", x: 60, y: 40, width: 960, height: 120, text: "AI-POWERED WRAP VISUALIZATION", fontSize: 48, fontFamily: "Oswald", fill2: BRAND.cyan, align: "center", fontStyle: "bold" },
        { type: "rect", x: 60, y: 720, width: 960, height: 4, fill: BRAND.cyan, opacity: 0.5 },
        { type: "text", x: 60, y: 740, width: 960, height: 60, text: "Photorealistic • 7 Views • Instant Preview", fontSize: 28, fontFamily: "Poppins", fill2: "#AAAAAA", align: "center" },
        { type: "rect", x: 200, y: 840, width: 680, height: 70, fill: BRAND.cyan, cornerRadius: 12 },
        { type: "text", x: 200, y: 840, width: 680, height: 70, text: "TRY IT FREE → RESTYLEPROAI.COM", fontSize: 26, fontFamily: "Poppins", fill2: BRAND.black, align: "center", verticalAlign: "middle", fontStyle: "bold" },
        { type: "text", x: 60, y: 940, width: 960, height: 40, text: "DesignProAI™", fontSize: 22, fontFamily: "Poppins", fill2: "#555555", align: "center" },
      ],
    },
    {
      name: "Bold Hook Quote",
      description: "Big bold hook text with dark overlay, great for engagement",
      format: "Square Post (1:1)",
      layers: [
        { type: "rect", x: 0, y: 0, width: 1080, height: 1080, fill: BRAND.darkGray },
        { type: "imagePlaceholder", x: 0, y: 0, width: 1080, height: 1080, opacity: 0.3, id: "bg" },
        { type: "rect", x: 0, y: 0, width: 1080, height: 1080, fill: BRAND.black, opacity: 0.55 },
        { type: "text", x: 80, y: 200, width: 920, height: 400, text: "YOUR COMPETITORS\nARE ALREADY\nUSING THIS", fontSize: 72, fontFamily: "Oswald", fill2: BRAND.white, align: "center", fontStyle: "bold" },
        { type: "rect", x: 390, y: 640, width: 300, height: 4, fill: BRAND.cyan },
        { type: "text", x: 80, y: 680, width: 920, height: 80, text: "AI Vehicle Wrap Visualization", fontSize: 32, fontFamily: "Poppins", fill2: BRAND.cyan, align: "center" },
        { type: "text", x: 80, y: 800, width: 920, height: 60, text: "DesignProAI.com", fontSize: 28, fontFamily: "Poppins", fill2: "#888888", align: "center" },
      ],
    },
    {
      name: "Portrait Post — Feature",
      description: "4:5 portrait post with hero image and feature callout",
      format: "Portrait Post (4:5)",
      layers: [
        { type: "rect", x: 0, y: 0, width: 1080, height: 1350, fill: BRAND.white },
        { type: "imagePlaceholder", x: 0, y: 0, width: 1080, height: 800, opacity: 0.7, id: "hero" },
        { type: "rect", x: 0, y: 700, width: 1080, height: 650, fill: BRAND.black, opacity: 0.85 },
        { type: "text", x: 60, y: 750, width: 960, height: 120, text: "VISUALIZE BEFORE\nYOU WRAP", fontSize: 56, fontFamily: "Oswald", fill2: BRAND.white, align: "center", fontStyle: "bold" },
        { type: "rect", x: 390, y: 890, width: 300, height: 4, fill: BRAND.cyan },
        { type: "text", x: 60, y: 920, width: 960, height: 80, text: "AI-powered previews for any color,\nfinish, or design panel", fontSize: 24, fontFamily: "Poppins", fill2: "#BBBBBB", align: "center" },
        { type: "rect", x: 200, y: 1050, width: 680, height: 70, fill: BRAND.cyan, cornerRadius: 12 },
        { type: "text", x: 200, y: 1050, width: 680, height: 70, text: "TRY IT FREE", fontSize: 28, fontFamily: "Poppins", fill2: BRAND.black, align: "center", verticalAlign: "middle", fontStyle: "bold" },
        { type: "text", x: 60, y: 1160, width: 960, height: 40, text: "DesignProAI™ — DesignProAI.com", fontSize: 18, fontFamily: "Inter", fill2: "#666666", align: "center" },
      ],
    },
    {
      name: "Portrait Post — Before/After",
      description: "4:5 portrait split before/after comparison",
      format: "Portrait Post (4:5)",
      layers: [
        { type: "rect", x: 0, y: 0, width: 1080, height: 1350, fill: BRAND.darkGray },
        { type: "text", x: 60, y: 40, width: 960, height: 80, text: "THE TRANSFORMATION", fontSize: 52, fontFamily: "Oswald", fill2: BRAND.white, align: "center", fontStyle: "bold" },
        { type: "rect", x: 60, y: 130, width: 960, height: 4, fill: BRAND.cyan },
        { type: "imagePlaceholder", x: 40, y: 160, width: 1000, height: 420, id: "before" },
        { type: "text", x: 40, y: 160, width: 200, height: 40, text: "BEFORE", fontSize: 22, fontFamily: "Oswald", fill2: BRAND.white, fontStyle: "bold" },
        { type: "imagePlaceholder", x: 40, y: 610, width: 1000, height: 420, id: "after" },
        { type: "text", x: 40, y: 610, width: 200, height: 40, text: "AFTER", fontSize: 22, fontFamily: "Oswald", fill2: BRAND.cyan, fontStyle: "bold" },
        { type: "text", x: 60, y: 1070, width: 960, height: 60, text: "See any wrap before you commit.", fontSize: 28, fontFamily: "Poppins", fill2: BRAND.white, align: "center" },
        { type: "rect", x: 240, y: 1160, width: 600, height: 65, fill: BRAND.cyan, cornerRadius: 12 },
        { type: "text", x: 240, y: 1160, width: 600, height: 65, text: "TRY IT FREE", fontSize: 26, fontFamily: "Poppins", fill2: BRAND.black, align: "center", verticalAlign: "middle", fontStyle: "bold" },
        { type: "text", x: 60, y: 1260, width: 960, height: 40, text: "DesignProAI™", fontSize: 20, fontFamily: "Poppins", fill2: "#555555", align: "center" },
      ],
    },
    {
      name: "Story / Reel Cover",
      description: "Portrait 9:16, full bleed hero, text overlay, bottom bar",
      format: "IG Story (9:16)",
      layers: [
        { type: "rect", x: 0, y: 0, width: 1080, height: 1920, fill: BRAND.white },
        { type: "imagePlaceholder", x: 0, y: 0, width: 1080, height: 1920, opacity: 0.6, id: "hero" },
        { type: "rect", x: 0, y: 1400, width: 1080, height: 520, fill: BRAND.black, opacity: 0.75 },
        { type: "text", x: 60, y: 200, width: 960, height: 200, text: "SEE YOUR\nDREAM WRAP", fontSize: 80, fontFamily: "Oswald", fill2: BRAND.white, align: "left", fontStyle: "bold" },
        { type: "rect", x: 60, y: 420, width: 200, height: 6, fill: BRAND.cyan },
        { type: "text", x: 60, y: 450, width: 700, height: 80, text: "Before you commit.", fontSize: 36, fontFamily: "Poppins", fill2: BRAND.cyan },
        { type: "text", x: 60, y: 1480, width: 960, height: 60, text: "SWIPE UP TO TRY FREE", fontSize: 32, fontFamily: "Poppins", fill2: BRAND.white, align: "center", fontStyle: "bold" },
        { type: "rect", x: 200, y: 1580, width: 680, height: 70, fill: BRAND.cyan, cornerRadius: 35 },
        { type: "text", x: 200, y: 1580, width: 680, height: 70, text: "DesignProAI.com", fontSize: 28, fontFamily: "Poppins", fill2: BRAND.black, align: "center", verticalAlign: "middle", fontStyle: "bold" },
        { type: "text", x: 60, y: 1700, width: 960, height: 40, text: "DesignProAI™ Vehicle Wrap Design Suite", fontSize: 18, fontFamily: "Inter", fill2: "#666666", align: "center" },
      ],
    },
    {
      name: "Automotive Showcase",
      description: "Dark bg, bold headline, vehicle photo, service features, contact bar",
      format: "FB Ad Landscape (16:9)",
      layers: [
        { type: "rect", x: 0, y: 0, width: 1200, height: 628, fill: BRAND.white },
        { type: "imagePlaceholder", x: 500, y: 20, width: 680, height: 588, id: "hero" },
        { type: "rect", x: 0, y: 0, width: 520, height: 628, fill: BRAND.darkGray, opacity: 0.9 },
        { type: "text", x: 40, y: 40, width: 440, height: 160, text: "VISUALIZE\nBEFORE YOU\nWRAP", fontSize: 52, fontFamily: "Oswald", fill2: BRAND.white, fontStyle: "bold" },
        { type: "rect", x: 40, y: 220, width: 120, height: 5, fill: BRAND.cyan },
        { type: "text", x: 40, y: 250, width: 440, height: 120, text: "AI-powered previews\nfor any color, finish\nor design panel", fontSize: 22, fontFamily: "Poppins", fill2: "#BBBBBB" },
        { type: "rect", x: 40, y: 420, width: 380, height: 60, fill: BRAND.cyan, cornerRadius: 8 },
        { type: "text", x: 40, y: 420, width: 380, height: 60, text: "START FREE TRIAL", fontSize: 22, fontFamily: "Poppins", fill2: BRAND.black, align: "center", verticalAlign: "middle", fontStyle: "bold" },
        { type: "text", x: 40, y: 520, width: 440, height: 80, text: "DesignProAI.com\n@RestyleProAI", fontSize: 18, fontFamily: "Inter", fill2: "#666666" },
      ],
    },
    {
      name: "Carousel Slide — Feature (1:1)",
      description: "Clean 1:1 slide for IG carousel, feature highlight",
      format: "Carousel Slide (1:1)",
      layers: [
        { type: "rect", x: 0, y: 0, width: 1080, height: 1080, fill: BRAND.darkGray },
        { type: "rect", x: 0, y: 0, width: 1080, height: 6, fill: BRAND.cyan },
        { type: "text", x: 80, y: 120, width: 920, height: 120, text: "7 STUDIO-QUALITY\nVIEWS", fontSize: 56, fontFamily: "Oswald", fill2: BRAND.white, align: "center", fontStyle: "bold" },
        { type: "imagePlaceholder", x: 140, y: 300, width: 800, height: 440, id: "feature" },
        { type: "text", x: 80, y: 780, width: 920, height: 100, text: "Side • Front • Rear • Hood Detail\nPassenger • Close-Up • Roof", fontSize: 24, fontFamily: "Poppins", fill2: "#AAAAAA", align: "center" },
        { type: "text", x: 80, y: 940, width: 920, height: 40, text: "DesignProAI™ — Swipe →", fontSize: 20, fontFamily: "Poppins", fill2: BRAND.cyan, align: "center" },
      ],
    },
    {
      name: "Carousel Slide — Showcase (4:5)",
      description: "4:5 carousel slide, hero image with headline + swipe CTA",
      format: "Carousel Slide (4:5)",
      layers: [
        { type: "rect", x: 0, y: 0, width: 1080, height: 1350, fill: BRAND.darkGray },
        { type: "rect", x: 0, y: 0, width: 1080, height: 6, fill: BRAND.cyan },
        { type: "imagePlaceholder", x: 40, y: 60, width: 1000, height: 700, id: "hero" },
        { type: "rect", x: 0, y: 720, width: 1080, height: 630, fill: BRAND.black, opacity: 0.85 },
        { type: "text", x: 60, y: 780, width: 960, height: 120, text: "YOUR HEADLINE\nGOES HERE", fontSize: 52, fontFamily: "Oswald", fill2: BRAND.white, align: "center", fontStyle: "bold" },
        { type: "rect", x: 390, y: 920, width: 300, height: 4, fill: BRAND.cyan },
        { type: "text", x: 60, y: 950, width: 960, height: 80, text: "Supporting copy for this carousel slide", fontSize: 24, fontFamily: "Poppins", fill2: "#AAAAAA", align: "center" },
        { type: "text", x: 60, y: 1100, width: 960, height: 40, text: "Swipe → for more", fontSize: 22, fontFamily: "Poppins", fill2: BRAND.cyan, align: "center" },
        { type: "text", x: 60, y: 1260, width: 960, height: 40, text: "DesignProAI™", fontSize: 18, fontFamily: "Inter", fill2: "#555555", align: "center" },
      ],
    },
    {
      name: "IG Story — CTA Swipe Up",
      description: "9:16 story with big hero, text overlay, swipe up CTA",
      format: "IG Story (9:16)",
      layers: [
        { type: "rect", x: 0, y: 0, width: 1080, height: 1920, fill: BRAND.black },
        { type: "imagePlaceholder", x: 0, y: 0, width: 1080, height: 1920, opacity: 0.5, id: "hero" },
        { type: "rect", x: 0, y: 0, width: 1080, height: 1920, fill: BRAND.black, opacity: 0.35 },
        { type: "text", x: 80, y: 400, width: 920, height: 200, text: "TAP TO SEE\nYOUR WRAP", fontSize: 72, fontFamily: "Oswald", fill2: BRAND.white, align: "center", fontStyle: "bold" },
        { type: "rect", x: 390, y: 640, width: 300, height: 5, fill: BRAND.cyan },
        { type: "text", x: 80, y: 680, width: 920, height: 60, text: "Preview any color or design", fontSize: 28, fontFamily: "Poppins", fill2: BRAND.cyan, align: "center" },
        { type: "rect", x: 300, y: 1580, width: 480, height: 70, fill: BRAND.cyan, cornerRadius: 35 },
        { type: "text", x: 300, y: 1580, width: 480, height: 70, text: "SWIPE UP", fontSize: 28, fontFamily: "Poppins", fill2: BRAND.black, align: "center", verticalAlign: "middle", fontStyle: "bold" },
        { type: "text", x: 60, y: 1700, width: 960, height: 40, text: "DesignProAI.com", fontSize: 20, fontFamily: "Inter", fill2: "#888888", align: "center" },
      ],
    },
    {
      name: "TikTok — Product Demo",
      description: "9:16 TikTok cover, bold hook text, dark overlay",
      format: "TikTok (9:16)",
      layers: [
        { type: "rect", x: 0, y: 0, width: 1080, height: 1920, fill: BRAND.black },
        { type: "imagePlaceholder", x: 0, y: 0, width: 1080, height: 1920, opacity: 0.4, id: "hero" },
        { type: "rect", x: 0, y: 0, width: 1080, height: 1920, fill: BRAND.black, opacity: 0.3 },
        { type: "text", x: 60, y: 350, width: 960, height: 280, text: "WAIT FOR IT...\nAI DESIGNS\nYOUR WRAP", fontSize: 72, fontFamily: "Oswald", fill2: BRAND.white, align: "center", fontStyle: "bold" },
        { type: "rect", x: 390, y: 660, width: 300, height: 5, fill: BRAND.cyan },
        { type: "text", x: 80, y: 700, width: 920, height: 60, text: "30 seconds. 7 views. Zero guesswork.", fontSize: 26, fontFamily: "Poppins", fill2: BRAND.cyan, align: "center" },
        { type: "text", x: 80, y: 1600, width: 920, height: 50, text: "Follow for more", fontSize: 26, fontFamily: "Poppins", fill2: BRAND.white, align: "center", fontStyle: "bold" },
        { type: "text", x: 80, y: 1680, width: 920, height: 40, text: "@RestyleProAI", fontSize: 22, fontFamily: "Inter", fill2: "#888888", align: "center" },
      ],
    },
    {
      name: "Minimal Magazine",
      description: "Full bleed photo, massive typography, editorial feel",
      format: "Square Post (1:1)",
      layers: [
        { type: "rect", x: 0, y: 0, width: 1080, height: 1080, fill: BRAND.white },
        { type: "imagePlaceholder", x: 0, y: 0, width: 1080, height: 1080, opacity: 0.5, id: "hero" },
        { type: "text", x: 60, y: 60, width: 960, height: 200, text: "RESTYLE", fontSize: 120, fontFamily: "Oswald", fill2: BRAND.white, fontStyle: "bold" },
        { type: "text", x: 60, y: 230, width: 960, height: 60, text: "PRO AI™", fontSize: 48, fontFamily: "Poppins", fill2: BRAND.cyan },
        { type: "text", x: 60, y: 860, width: 600, height: 80, text: "The future of vehicle\nwrap visualization.", fontSize: 28, fontFamily: "Poppins", fill2: BRAND.white },
        { type: "text", x: 60, y: 980, width: 400, height: 40, text: "DesignProAI.com", fontSize: 22, fontFamily: "Inter", fill2: "#888888" },
      ],
    },
    {
      name: "Reels — Hook + Reveal",
      description: "9:16 reel cover: big hook text, blurred bg, CTA",
      format: "IG Reel (9:16)",
      layers: [
        { type: "rect", x: 0, y: 0, width: 1080, height: 1920, fill: BRAND.white },
        { type: "imagePlaceholder", x: 0, y: 0, width: 1080, height: 1920, opacity: 0.35, id: "hero" },
        { type: "rect", x: 0, y: 0, width: 1080, height: 1920, fill: BRAND.black, opacity: 0.4 },
        { type: "text", x: 60, y: 300, width: 960, height: 300, text: "THIS CHANGES\nEVERYTHING\nFOR WRAP SHOPS", fontSize: 76, fontFamily: "Oswald", fill2: BRAND.white, align: "center", fontStyle: "bold" },
        { type: "rect", x: 390, y: 640, width: 300, height: 5, fill: BRAND.cyan },
        { type: "text", x: 80, y: 680, width: 920, height: 80, text: "AI-Powered Vehicle Wrap Visualization", fontSize: 30, fontFamily: "Poppins", fill2: BRAND.cyan, align: "center" },
        { type: "text", x: 80, y: 1500, width: 920, height: 70, text: "WATCH TO SEE HOW", fontSize: 36, fontFamily: "Poppins", fill2: BRAND.white, align: "center", fontStyle: "bold" },
        { type: "rect", x: 240, y: 1600, width: 600, height: 70, fill: BRAND.cyan, cornerRadius: 35 },
        { type: "text", x: 240, y: 1600, width: 600, height: 70, text: "DesignProAI.com", fontSize: 28, fontFamily: "Poppins", fill2: BRAND.black, align: "center", verticalAlign: "middle", fontStyle: "bold" },
        { type: "text", x: 60, y: 1720, width: 960, height: 40, text: "@RestyleProAI", fontSize: 20, fontFamily: "Inter", fill2: "#666666", align: "center" },
      ],
    },
    {
      name: "Reels — Before / After",
      description: "Split-screen style for before/after transformation reels",
      format: "IG Reel (9:16)",
      layers: [
        { type: "rect", x: 0, y: 0, width: 1080, height: 1920, fill: BRAND.darkGray },
        { type: "text", x: 60, y: 80, width: 960, height: 100, text: "THE TRANSFORMATION", fontSize: 64, fontFamily: "Oswald", fill2: BRAND.white, align: "center", fontStyle: "bold" },
        { type: "rect", x: 60, y: 200, width: 960, height: 5, fill: BRAND.cyan },
        { type: "imagePlaceholder", x: 60, y: 240, width: 960, height: 540, id: "before" },
        { type: "text", x: 60, y: 240, width: 200, height: 50, text: "BEFORE", fontSize: 24, fontFamily: "Oswald", fill2: BRAND.white, fontStyle: "bold" },
        { type: "imagePlaceholder", x: 60, y: 820, width: 960, height: 540, id: "after" },
        { type: "text", x: 60, y: 820, width: 200, height: 50, text: "AFTER", fontSize: 24, fontFamily: "Oswald", fill2: BRAND.cyan, fontStyle: "bold" },
        { type: "text", x: 80, y: 1420, width: 920, height: 100, text: "See any wrap before\nyou commit.", fontSize: 36, fontFamily: "Poppins", fill2: BRAND.white, align: "center" },
        { type: "rect", x: 240, y: 1560, width: 600, height: 70, fill: BRAND.cyan, cornerRadius: 35 },
        { type: "text", x: 240, y: 1560, width: 600, height: 70, text: "TRY IT FREE", fontSize: 28, fontFamily: "Poppins", fill2: BRAND.black, align: "center", verticalAlign: "middle", fontStyle: "bold" },
        { type: "text", x: 60, y: 1680, width: 960, height: 40, text: "DesignProAI™ — Swipe Up", fontSize: 20, fontFamily: "Poppins", fill2: "#888888", align: "center" },
      ],
    },
    {
      name: "YouTube Thumbnail — Bold",
      description: "16:9 YouTube thumbnail with big text and hero",
      format: "YouTube Thumbnail (16:9)",
      layers: [
        { type: "rect", x: 0, y: 0, width: 1280, height: 720, fill: BRAND.white },
        { type: "imagePlaceholder", x: 480, y: 0, width: 800, height: 720, opacity: 0.7, id: "hero" },
        { type: "rect", x: 0, y: 0, width: 560, height: 720, fill: BRAND.black, opacity: 0.85 },
        { type: "text", x: 40, y: 60, width: 500, height: 250, text: "AI WRAPS\nIN 30\nSECONDS", fontSize: 72, fontFamily: "Oswald", fill2: BRAND.white, fontStyle: "bold" },
        { type: "rect", x: 40, y: 330, width: 120, height: 5, fill: BRAND.cyan },
        { type: "text", x: 40, y: 360, width: 500, height: 80, text: "Photorealistic Vehicle\nWrap Design System", fontSize: 28, fontFamily: "Poppins", fill2: BRAND.cyan },
        { type: "text", x: 40, y: 480, width: 500, height: 50, text: "WATCH THE FULL DEMO", fontSize: 24, fontFamily: "Poppins", fill2: "#AAAAAA" },
        { type: "rect", x: 40, y: 560, width: 300, height: 50, fill: BRAND.cyan, cornerRadius: 8 },
        { type: "text", x: 40, y: 560, width: 300, height: 50, text: "DesignProAI™", fontSize: 22, fontFamily: "Poppins", fill2: BRAND.black, align: "center", verticalAlign: "middle", fontStyle: "bold" },
      ],
    },
    {
      name: "Reels — Countdown / Listicle",
      description: "Numbered slide for multi-part reels (Top 5, 3 Reasons, etc.)",
      format: "IG Reel (9:16)",
      layers: [
        { type: "rect", x: 0, y: 0, width: 1080, height: 1920, fill: BRAND.white },
        { type: "imagePlaceholder", x: 0, y: 0, width: 1080, height: 1920, opacity: 0.2, id: "bg" },
        { type: "text", x: 60, y: 200, width: 960, height: 200, text: "01", fontSize: 180, fontFamily: "Oswald", fill2: BRAND.cyan, align: "center", fontStyle: "bold" },
        { type: "rect", x: 340, y: 420, width: 400, height: 5, fill: BRAND.white, opacity: 0.3 },
        { type: "text", x: 80, y: 480, width: 920, height: 250, text: "PREVIEW ANY\nWRAP IN\n60 SECONDS", fontSize: 68, fontFamily: "Oswald", fill2: BRAND.white, align: "center", fontStyle: "bold" },
        { type: "text", x: 80, y: 780, width: 920, height: 80, text: "No more guessing. See it first.", fontSize: 28, fontFamily: "Poppins", fill2: "#AAAAAA", align: "center" },
        { type: "text", x: 80, y: 1600, width: 920, height: 50, text: "Follow for more wrap tips", fontSize: 24, fontFamily: "Poppins", fill2: BRAND.cyan, align: "center" },
        { type: "text", x: 80, y: 1680, width: 920, height: 40, text: "@RestyleProAI", fontSize: 22, fontFamily: "Inter", fill2: "#666666", align: "center" },
      ],
    },
  ];
}

// ── Canva Template Library types (must be outside component) ─────────
type CanvaTemplateType = "static-4x5" | "reel" | "carousel" | "static-1x1" | "story" | "static-9x16" | "static-16x9";
interface CanvaTemplate {
  name: string;
  url: string;
  path: string;
  brand: string;
  contentType: CanvaTemplateType;
  // Video templates (reels) — file extension drives renderer
  isVideo?: boolean;
  mimeType?: string;
}
// Order matches the canvas preset order: 4:5 first, then reels, carousels, 1:1, etc.
const CONTENT_TYPES: { value: CanvaTemplateType; label: string }[] = [
  { value: "static-4x5", label: "Static (4:5)" },
  { value: "reel", label: "Reel (9:16)" },
  { value: "carousel", label: "Carousel (1:1)" },
  { value: "static-1x1", label: "Static (1:1)" },
  { value: "story", label: "Story (9:16)" },
  { value: "static-9x16", label: "Static (9:16)" },
  { value: "static-16x9", label: "Static (16:9)" },
];

// Auto-create memory — which starred Canva designs were already built, per
// brand, so re-opening the panel never re-burns AI credits on the same
// template. Failures are NOT marked, so they retry on the next open.
const starredDoneKey = (brand: string) => `cs_starred_done::${brand}`;
const getStarredDone = (brand: string): Set<string> => {
  try { return new Set<string>(JSON.parse(localStorage.getItem(starredDoneKey(brand)) || "[]")); } catch { return new Set<string>(); }
};
const markStarredDone = (brand: string, id: string) => {
  try {
    const s = getStarredDone(brand);
    s.add(id);
    localStorage.setItem(starredDoneKey(brand), JSON.stringify([...s]));
  } catch { /* storage full/blocked — worst case we re-ask next open */ }
};

// Turn a stored filename (e.g. "1785277547656-white-and-brown-photo-collage-rewritten.png")
// into a clean display name ("White And Brown Photo Collage (rewritten)").
// Every upload/export path prefixes Date.now() to avoid collisions — without
// this, that timestamp leaked straight into the template card title.
function prettyTemplateName(filename: string): string {
  let base = filename.replace(/\.[^.]+$/, "");
  base = base.replace(/^\d{6,}-/, ""); // strip leading Date.now() prefix
  const isRewritten = /-rewritten$/i.test(base);
  base = base.replace(/-rewritten$/i, "");
  const words = base.replace(/-/g, " ").trim();
  const titled = words.replace(/\b\w/g, (c) => c.toUpperCase());
  return isRewritten ? `${titled} (rewritten)` : titled;
}

// File extensions permitted in each content type.
// Reels accept video + image (video plays on canvas; image is the cover).
const VIDEO_EXT_RE = /\.(mp4|mov|webm|m4v)$/i;
const IMAGE_EXT_RE = /\.(png|jpg|jpeg|webp|gif)$/i;
const CANVA_EXT_RE = /\.(png|jpg|jpeg|webp|gif|mp4|mov|webm|m4v)$/i;

const TOOL_OPTIONS = [
  { value: "ColorPro", label: "ColorPro™" },
  { value: "MyVehiclePro", label: "MyVehiclePro™" },
  { value: "DesignProAI", label: "DesignProAI™" },
  { value: "GraphicsPro", label: "GraphicsPro™" },
  { value: "FadeWraps", label: "FadeWraps™" },
  { value: "PatternPro", label: "PatternPro™" },
  { value: "QuickQuote", label: "QuickQuote™" },
  { value: "ProductionFlow", label: "ProductionFlow™" },
  { value: "ApprovePro", label: "ApprovePro™" },
  { value: "RevisionStudio", label: "RevisionStudioIQ™" },
];

// Auto-compress large IMAGES before upload so big files (30MB+ photos) succeed
// instead of hitting the storage size limit. Downscales past maxDim and re-encodes
// to JPEG, stepping quality down until under maxBytes. Small images and files with
// transparency worth keeping (already under the limit) pass through untouched.
// Videos are returned as-is (handled by the resumable/video path, not compressed).
async function compressImageIfLarge(
  file: File,
  opts: { maxBytes?: number; maxDim?: number } = {},
): Promise<File> {
  const maxBytes = opts.maxBytes ?? 9 * 1024 * 1024; // ~9MB — safely under storage cap
  const maxDim = opts.maxDim ?? 2400;
  if (!file.type.startsWith("image/")) return file;
  if (file.size <= maxBytes) return file; // already small enough — keep original (incl. PNG alpha)
  try {
    const dataUrl: string = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result as string);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = dataUrl;
    });
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    if (Math.max(w, h) > maxDim) {
      const s = maxDim / Math.max(w, h);
      w = Math.round(w * s);
      h = Math.round(h * s);
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, w, h);
    let quality = 0.9;
    let blob: Blob | null = null;
    for (let i = 0; i < 6; i++) {
      blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", quality));
      if (blob && blob.size <= maxBytes) break;
      quality -= 0.12;
    }
    if (!blob) return file;
    const newName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], newName, { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return file; // on any failure, fall back to the original file
  }
}

// Hook discipline — controls how Claude opens the copy. Pain-aware is the
// default because it's what closes jobs in this industry; the others exist
// so a single tool/render can be remixed across multiple post angles.
const HOOK_TYPE_OPTIONS = [
  { value: "pain_aware", label: "Pain-Aware (default)" },
  { value: "education_first", label: "Education-First" },
  { value: "us_vs_them", label: "Us vs Them" },
  { value: "feature_callout", label: "Feature Callout" },
];

// ── Canvas element types ─────────────────────────────────────────────
interface CanvasElement {
  id: string;
  type: "rect" | "text" | "image";
  x: number;
  y: number;
  width: number;
  height: number;
  fill?: string;
  opacity?: number;
  cornerRadius?: number;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  fontStyle?: string;
  align?: string;
  verticalAlign?: string;
  imageData?: HTMLImageElement;
  imageSrc?: string;
}

let _nextId = 1;
function uid() { return `el_${_nextId++}_${Date.now()}`; }

// Z-order band: image/video sit in the background (0); text, rects and every
// other element render on top (1). Used to sort the canvas at render/export so
// AI-generated text overlays are never hidden behind a pushed image/render.
function zBand(el: CanvasElement): number {
  return el.type === "image" || el.type === "video" ? 0 : 1;
}

// WrapTV logo "bug" for the music-video stamp. Swappable: re-upload the real
// transparent WrapTV mark to this storage path and update this URL.
const WRAPTV_BUG_URL = "https://kfapjdyythzyvnpdeghu.supabase.co/storage/v1/object/public/wrap-files/brand-logos/1784237894028-wraptv-bug.png";

// Encode an AudioBuffer to a 16-bit PCM WAV Blob (used by the song trim tool).
function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const numCh = buffer.numberOfChannels;
  const sr = buffer.sampleRate;
  const total = buffer.length * numCh * 2 + 44;
  const ab = new ArrayBuffer(total);
  const view = new DataView(ab);
  const writeStr = (o: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  writeStr(0, "RIFF"); view.setUint32(4, total - 8, true); writeStr(8, "WAVE");
  writeStr(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true); view.setUint32(24, sr, true);
  view.setUint32(28, sr * numCh * 2, true); view.setUint16(32, numCh * 2, true); view.setUint16(34, 16, true);
  writeStr(36, "data"); view.setUint32(40, total - 44, true);
  const chans: Float32Array[] = [];
  for (let c = 0; c < numCh; c++) chans.push(buffer.getChannelData(c));
  let off = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([ab], { type: "audio/wav" });
}

// ── Main component ───────────────────────────────────────────────────
const AdminContentStudio = () => {
  const navigate = useNavigate();

  // Canvas state — default to 4:5 Portrait Post (product order)
  const [canvasWidth, setCanvasWidth] = useState(1080);
  const [canvasHeight, setCanvasHeight] = useState(1350);
  const [formatLabel, setFormatLabel] = useState("Portrait Post (4:5)");
  const [elements, setElements] = useState<CanvasElement[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bgColor, setBgColor] = useState(BRAND.white);

  // ── Eager font preload ────────────────────────────────────────────
  // Google Fonts uses font-display:swap which lets the page render before
  // fonts arrive — that's good for first paint, but it means Konva can
  // render text with Arial/serif fallback if the user clicks Export before
  // the font swap completes. We explicitly trigger a load for every
  // BRAND_FONT at common weights so document.fonts.ready (used by
  // handleExport / thumbnail save) resolves with the real fonts in place.
  useEffect(() => {
    if (typeof document === "undefined" || !(document as any).fonts) return;
    const weights = ["400", "700"];
    const requests: Promise<unknown>[] = [];
    for (const family of BRAND_FONTS) {
      for (const weight of weights) {
        try {
          requests.push(
            (document as any).fonts.load(`${weight} 16px "${family}"`),
          );
        } catch (_) { /* font not present — fall through */ }
      }
    }
    Promise.allSettled(requests);
  }, []);

  // ContentFlow AI state
  const [cfBrand, setCfBrand] = useState("DesignProAI");
  const [cfTopic, setCfTopic] = useState("");
  const [cfFormat, setCfFormat] = useState("post");
  const [cfTone, setCfTone] = useState("Hype/Launch");
  const [cfHookType, setCfHookType] = useState("pain_aware");
  // Saved hooks from the Hooks Manager (content_hooks) for the current brand.
  // Picking one feeds it into generation as the exact opening hook.
  const [cfSavedHook, setCfSavedHook] = useState("");
  const [brandHooks, setBrandHooks] = useState<{ id: string; text: string; hook_type: string | null }[]>([]);
  const [cfFocusTools, setCfFocusTools] = useState<string[]>([]);
  const toggleTool = (val: string) => {
    setCfFocusTools(prev => prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]);
  };

  // Load the brand's saved hooks (Hooks Manager → content_hooks) whenever the
  // brand changes, so the picker below is always in that brand's voice.
  useEffect(() => {
    const slug = ({
      DesignProAI: "restylepro", WePrintWraps: "weprintwraps",
      WrapTV: "wraptvworld", WrapTVWorld: "wraptvworld",
      InkAndEdge: "inkandedge", DesignProAI: "designproai", TheWrap: "thewrap",
    } as Record<string, string>)[cfBrand] || cfBrand.toLowerCase();
    let cancelled = false;
    (async () => {
      const { data } = await (supabase as any)
        .from("content_hooks")
        .select("id, text, hook_type")
        .eq("brand", slug)
        .eq("active", true)
        .order("created_at", { ascending: false })
        .limit(400);
      if (!cancelled) { setBrandHooks((data || []) as { id: string; text: string; hook_type: string | null }[]); setCfSavedHook(""); }
    })();
    return () => { cancelled = true; };
  }, [cfBrand]);

  // The Hooks Library panels render the SAME saved library, grouped by
  // hook_type (the old hardcoded HOOKS_LIBRARY categories were seeded in as
  // hook_type values, so the familiar groupings survive the move to the DB).
  const brandHookGroups = useMemo(() => {
    const g = new Map<string, string[]>();
    for (const h of brandHooks) {
      const k = h.hook_type || "Saved hooks";
      if (!g.has(k)) g.set(k, []);
      g.get(k)!.push(h.text);
    }
    return Array.from(g.entries());
  }, [brandHooks]);

  // Generation context = the topic + (optional) the exact saved hook the team
  // picked, so the AI copy opens with that hook verbatim.
  const cfGenContext = () =>
    [cfTopic, cfSavedHook ? `Open with this exact hook: "${cfSavedHook}"` : ""]
      .filter(Boolean).join("\n\n") || undefined;
  const [cfResult, setCfResult] = useState<GeneratedContent | null>(null);
  const [cfGenerating, setCfGenerating] = useState(false);
  const [buildingCanva, setBuildingCanva] = useState(false);
  const [cfImageUrl, setCfImageUrl] = useState<string | null>(null);
  const [cfImageMode, setCfImageMode] = useState<"none" | "render" | "upload">("none");
  const [showLibPicker, setShowLibPicker] = useState(false);
  // Music video export (WrapTV) — WPW Originals soundtrack + in-browser render
  const [musicGenre, setMusicGenre] = useState("");
  const [musicList, setMusicList] = useState<{ name: string; url: string }[]>([]);
  const [musicUrl, setMusicUrl] = useState<string | null>(null);
  const [exportingVideo, setExportingVideo] = useState(false);
  const [musicRefresh, setMusicRefresh] = useState(0);
  const [uploadingSong, setUploadingSong] = useState(false);
  const musicUploadRef = useRef<HTMLInputElement>(null);
  // Trim tool
  const [trackDur, setTrackDur] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [trimming, setTrimming] = useState(false);
  const trimPreviewRef = useRef<HTMLAudioElement | null>(null);
  const cfImageUploadRef = useRef<HTMLInputElement>(null);
  const [cfImageBase64, setCfImageBase64] = useState<string | null>(null);

  // ── Deep-link prefill ──
  // When opened from the Content Review page, URL params carry the
  // approved copy + format + tool + render so Carley can start
  // composing without re-entering anything.
  // Supported params: topic, format, tone, tool, render, postId
  const [searchParams] = useSearchParams();
  useEffect(() => {
    const topic = searchParams.get("topic");
    const format = searchParams.get("format");
    const tone = searchParams.get("tone");
    const tool = searchParams.get("tool");
    const hookTypeParam = searchParams.get("hookType");
    const render = searchParams.get("render");
    if (topic) setCfTopic(topic);
    if (tone) setCfTone(tone);
    if (tool) setCfFocusTools([tool]);
    if (hookTypeParam && HOOK_TYPE_OPTIONS.some((h) => h.value === hookTypeParam)) {
      setCfHookType(hookTypeParam);
    }
    if (format) {
      const preset = FORMAT_PRESETS.find((p) => p.label === format);
      if (preset) {
        setCanvasWidth(preset.width);
        setCanvasHeight(preset.height);
        setFormatLabel(preset.label);
      }
    }
    if (render) {
      setCfImageUrl(render);
      setCfImageMode("render");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pending render preview — lets user choose how to use the selected render
  const [pendingRender, setPendingRender] = useState<{ url: string; meta: { designName?: string; vehicle?: string; view?: string } } | null>(null);

  // Video state for Reels/Stories/TikTok
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  // Saved works (canvas drafts) — persisted to content_studio_works table.
  // HTMLImageElement references cannot be serialized, so we store the
  // imageSrc URL and rehydrate on load.
  type StoredWork = {
    id: string;
    title: string;
    brand: string | null;
    format_label: string | null;
    canvas_state: {
      canvasWidth: number;
      canvasHeight: number;
      formatLabel: string;
      bgColor: string;
      videoUrl: string | null;
      elements: Array<Omit<CanvasElement, "imageData">>;
    };
    thumbnail_url: string | null;
    video_url: string | null;
    updated_at: string;
  };
  const [works, setWorks] = useState<StoredWork[]>([]);
  const [worksLoading, setWorksLoading] = useState(false);
  const [currentWorkId, setCurrentWorkId] = useState<string | null>(null);
  const [workTitle, setWorkTitle] = useState("Untitled Work");
  const [savingWork, setSavingWork] = useState(false);

  // Mobile detection
  const isMobile = useIsMobile();

  // Canva Template Library state
  const [canvaTemplates, setCanvaTemplates] = useState<CanvaTemplate[]>([]);
  const [canvaUploading, setCanvaUploading] = useState(false);
  const [canvaBrandTab, setCanvaBrandTab] = useState<"DesignProAI" | "WePrintWraps" | "DesignProAI" | "WrapTV" | "InkAndEdge">("DesignProAI");
  const [canvaUploadType, setCanvaUploadType] = useState<CanvaTemplateType>("static-1x1");
  const [rewriteResult, setRewriteResult] = useState<{ replacements: { original: string; replacement: string; position: string }[]; templateDescription?: string } | null>(null);
  const [rewritingTemplate, setRewritingTemplate] = useState<string | null>(null);

  // From YOUR Canva account — the REAL template pull. Lists the operator's
  // actual Canva designs (marketing-agent action:"canva_designs") and imports
  // one as a PNG into the template library (action:"canva_export" exports via
  // the Canva Connect API + re-hosts into wrap-files/canva-templates/...).
  const [canvaAcct, setCanvaAcct] = useState<{ connected: boolean; name?: string } | null>(null);
  const [canvaDesigns, setCanvaDesigns] = useState<Array<{ id: string; title: string; thumbnail: string | null }>>([]);
  const [canvaDesignsLoading, setCanvaDesignsLoading] = useState(false);
  const [canvaDesignSearch, setCanvaDesignSearch] = useState("");
  const [canvaImportingId, setCanvaImportingId] = useState<string | null>(null);

  // ⭐ STARRED BATCH AGENT — pull every starred Canva design, AI-rewrite all
  // its text into relevant brand copy (design/fonts/layout untouched), and
  // optionally drop a relevant wrap render into the photo slot. Reel videos
  // import as-is into the reel library. Everything lands in the template
  // library, ready for the content maker.
  const [canvaListMode, setCanvaListMode] = useState<"all" | "starred">("starred");
  const [canvaStarred, setCanvaStarred] = useState<Array<{ id: string; title: string; thumbnail: string | null }>>([]);
  const [starredSource, setStarredSource] = useState<string>("");
  const [starredLoading, setStarredLoading] = useState(false);
  // TEMPLATE SOURCE FOLDERS — Canva does NOT expose the ⭐ Starred list to
  // apps (live-confirmed folder_not_found), so the operator ticks which of
  // their EXISTING Canva folders hold templates — no new folder habit needed.
  // Multi-select, persisted across sessions (migrates the old single pick).
  const [canvaSrcFolders, setCanvaSrcFoldersState] = useState<Array<{ id: string; name: string }>>(() => {
    try {
      const multi = JSON.parse(localStorage.getItem("cs_canva_src_folders") || "null");
      if (Array.isArray(multi) && multi.length) return multi;
      const single = JSON.parse(localStorage.getItem("cs_canva_src_folder") || "null");
      return single ? [single] : [];
    } catch { return []; }
  });
  const setCanvaSrcFolders = (fs: Array<{ id: string; name: string }>) => {
    setCanvaSrcFoldersState(fs);
    try { localStorage.setItem("cs_canva_src_folders", JSON.stringify(fs)); } catch { /* ignore */ }
  };
  const [canvaFolders, setCanvaFolders] = useState<Array<{ id: string; name: string }>>([]);
  const [canvaFoldersLoading, setCanvaFoldersLoading] = useState(false);
  const [canvaFolderPicks, setCanvaFolderPicks] = useState<Record<string, boolean>>({});
  // OFF by default — owner rule: the AI only rewrites TEXT (hooks + brand
  // copy); humans swap images/video themselves on the canvas.
  const [batchAutoMedia, setBatchAutoMedia] = useState(false);
  // AUTO-CREATE (owner ask: "it should auto create so templates are done") —
  // when the panel opens, any starred design not yet built for this brand
  // starts building automatically. Persisted so it can be switched off.
  const [autoCreateStarred, setAutoCreateStarred] = useState(() => {
    try { return localStorage.getItem("cs_auto_create_starred") !== "off"; } catch { return true; }
  });
  const setAutoCreate = (on: boolean) => {
    setAutoCreateStarred(on);
    try { localStorage.setItem("cs_auto_create_starred", on ? "on" : "off"); } catch { /* ignore */ }
  };
  const [starredBatch, setStarredBatch] = useState<{ running: boolean; done: number; total: number; ok: number; failed: number; current: string } | null>(null);
  const batchCancelRef = useRef(false);

  // ColorPro Swatch Library state — click a manufacturer swatch to drop
  // it onto the canvas as an editable image element.
  type ColorSwatch = {
    id: string;
    manufacturer: string;
    name: string;
    code: string | null;
    finish: string | null;
    hex: string;
    imageUrl: string | null;
  };
  const [swatches, setSwatches] = useState<ColorSwatch[]>([]);
  const [swatchesLoading, setSwatchesLoading] = useState(false);
  const [swatchManufacturer, setSwatchManufacturer] = useState<string>("all");
  const [swatchSearch, setSwatchSearch] = useState("");

  // Read the whole template library from Storage. Callable (not just an
  // on-mount effect) so anything that ADDS a template — the AI generator, an
  // upload — can refresh the list without a page reload.
  const reloadCanvaLibrary = useCallback(async () => {
    const brands = ["DesignProAI", "WePrintWraps", "DesignProAI", "WrapTV", "InkAndEdge"];
    const allTemplates: CanvaTemplate[] = [];
    for (const b of brands) {
      for (const ct of CONTENT_TYPES) {
        const folder = `canva-templates/${b}/${ct.value}`;
        const { data } = await supabase.storage.from("wrap-files").list(folder, { limit: 100, sortBy: { column: "created_at", order: "desc" } });
        if (data) {
          for (const f of data.filter(f => CANVA_EXT_RE.test(f.name))) {
            const { data: urlData } = supabase.storage.from("wrap-files").getPublicUrl(`${folder}/${f.name}`);
            const isVideo = VIDEO_EXT_RE.test(f.name);
            const ext = f.name.split(".").pop()?.toLowerCase() || "";
            allTemplates.push({
              name: prettyTemplateName(f.name),
              url: urlData.publicUrl,
              path: `${folder}/${f.name}`,
              brand: b,
              contentType: ct.value,
              isVideo,
              mimeType: isVideo ? `video/${ext === "mov" ? "quicktime" : ext}` : `image/${ext}`,
            });
          }
        }
      }
    }
    setCanvaTemplates(allTemplates);
  }, []);

  // Load saved Canva templates from Supabase Storage on mount
  useEffect(() => { void reloadCanvaLibrary(); }, [reloadCanvaLibrary]);

  // Upload Canva templates to Supabase Storage library (supports bulk / multi-file)
  // Accepts both images (static templates) and video (reels / stories)
  const uploadCanvaToLibrary = useCallback(async (files: File | File[]) => {
    const fileList = Array.isArray(files) ? files : [files];
    if (fileList.length === 0) return;
    setCanvaUploading(true);
    let successCount = 0;
    let failCount = 0;
    for (const rawFile of fileList) {
      if (!CANVA_EXT_RE.test(rawFile.name)) {
        failCount++;
        console.warn("Skipped unsupported file type:", rawFile.name);
        continue;
      }
      // Auto-compress oversize images so big uploads (30MB+ photos) don't fail.
      const file = await compressImageIfLarge(rawFile);
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase();
      const path = `canva-templates/${canvaBrandTab}/${canvaUploadType}/${Date.now()}-${safeName}`;
      const { error } = await supabase.storage.from("wrap-files").upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
      if (error) {
        failCount++;
        console.error("Upload failed:", file.name, error.message);
        continue;
      }
      const { data: urlData } = supabase.storage.from("wrap-files").getPublicUrl(path);
      const isVideo = VIDEO_EXT_RE.test(file.name);
      const newTemplate: CanvaTemplate = {
        name: safeName.replace(/\.[^.]+$/, "").replace(/-/g, " "),
        url: urlData.publicUrl,
        path,
        brand: canvaBrandTab,
        contentType: canvaUploadType,
        isVideo,
        mimeType: file.type || (isVideo ? "video/mp4" : "image/png"),
      };
      setCanvaTemplates(prev => [newTemplate, ...prev]);
      successCount++;
    }
    if (failCount > 0) {
      toast.error(`${failCount} upload(s) failed`);
    }
    if (successCount > 0) {
      toast.success(`${successCount} template${successCount > 1 ? "s" : ""} saved to ${canvaBrandTab} → ${canvaUploadType}!`);
    }
    setCanvaUploading(false);
  }, [canvaBrandTab, canvaUploadType]);

  // Load a Canva template from library onto canvas
  // Images go onto the canvas as a base layer; videos go into the video player.
  const loadCanvaTemplate = useCallback((tplOrUrl: CanvaTemplate | string) => {
    const tpl: CanvaTemplate | null = typeof tplOrUrl === "string" ? null : tplOrUrl;
    const url = typeof tplOrUrl === "string" ? tplOrUrl : tplOrUrl.url;

    // Video template → load into the reel video player + switch canvas to 9:16
    if (tpl?.isVideo) {
      const reelFormat = FORMAT_PRESETS.find(f => f.label === "IG Reel (9:16)") || FORMAT_PRESETS[1];
      setCanvasWidth(reelFormat.width);
      setCanvasHeight(reelFormat.height);
      setFormatLabel(reelFormat.label);
      setVideoUrl(url);
      setVideoFile(null);
      setBgColor(BRAND.black);
      toast.success(`Reel template loaded — ${tpl.name}`);
      return;
    }

    // Image template → place as canvas background
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onerror = () => {
      // Retry without crossOrigin — some CDNs reject anon preflight
      const retry = new window.Image();
      retry.onload = () => placeTemplateImage(retry, url);
      retry.onerror = () => toast.error("Failed to load template image");
      retry.src = url;
    };
    img.onload = () => placeTemplateImage(img, url);
    img.src = url;

    function placeTemplateImage(image: HTMLImageElement, srcUrl: string) {
      const aspect = image.width / image.height;
      let bestFormat = FORMAT_PRESETS[0];
      let bestDiff = 999;
      for (const f of FORMAT_PRESETS) {
        const diff = Math.abs((f.width / f.height) - aspect);
        if (diff < bestDiff) { bestDiff = diff; bestFormat = f; }
      }
      setCanvasWidth(bestFormat.width);
      setCanvasHeight(bestFormat.height);
      setFormatLabel(bestFormat.label);
      // COVER-fit the template into the chosen preset, preserving the
      // template's own aspect ratio — stretching it to the preset (the old
      // behavior) distorted any template whose aspect didn't exactly match.
      const cover = Math.max(bestFormat.width / image.width, bestFormat.height / image.height);
      const w = image.width * cover;
      const h = image.height * cover;
      setElements([{
        id: uid(), type: "image",
        x: (bestFormat.width - w) / 2, y: (bestFormat.height - h) / 2,
        width: w, height: h,
        imageData: image, imageSrc: srcUrl,
      }]);
      setSelectedId(null);
      setBgColor(BRAND.white);
      toast.success(`Template loaded — ${bestFormat.label}`);
    }
  }, []);

  // ── ⭐ TEMPLATE-FOLDER BATCH AGENT ───────────────────────────────────
  // Load designs from the operator's chosen Canva source folder(s). Canva's
  // Connect API has NO "starred" special folder (live-confirmed 404
  // folder_not_found) — the folder picker below (canvaSrcFolders) is the
  // real mechanism; "starred" naming here is legacy/internal only.
  // Returns the list so the batch can chain off it.
  // List the operator's Canva folders for the source picker.
  const loadCanvaFolders = async () => {
    setCanvaFoldersLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("marketing-agent", { body: { action: "canva_folders" } });
      if (data?.error === "canva_not_connected") { setCanvaAcct({ connected: false }); return; }
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setCanvaFolders((data?.folders || []).filter((f: { name: string }) => f.id !== "uploads"));
      setCanvaAcct(prev => prev?.connected ? prev : { connected: true });
    } catch (e: unknown) {
      // "not connected" arrives as a 404, so supabase-js reports it as an
      // error with an empty body — the check above can never catch it. Read
      // the real reason before deciding this is a failure at all.
      const info = await readEdgeError(e);
      if (isCanvaNotConnected(info)) { setCanvaAcct({ connected: false }); return; }
      toast.error("Couldn't load Canva folders: " + info.reason);
    } finally {
      setCanvaFoldersLoading(false);
    }
  };

  const loadCanvaStarredList = async (opts?: { autoRun?: boolean; folders?: Array<{ id: string; name: string }> }): Promise<Array<{ id: string; title: string; thumbnail: string | null }>> => {
    setStarredLoading(true);
    const src = opts?.folders !== undefined ? opts.folders : canvaSrcFolders;
    try {
      const { data, error } = await supabase.functions.invoke("marketing-agent", {
        body: { action: "canva_starred", folder_ids: src.length ? src : undefined },
      });
      if (data?.error === "canva_not_connected") { setCanvaAcct({ connected: false }); return []; }
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const list = data?.designs || [];
      setCanvaStarred(list);
      setStarredSource(data?.source || "");
      // No source folders picked and nothing found → surface the folder picker.
      if (!list.length && !src.length && !canvaFolders.length) loadCanvaFolders();
      // AUTO-CREATE: anything starred that isn't built yet starts building
      // right now — no extra pushes. Built ones are remembered per brand.
      if (opts?.autoRun && autoCreateStarred && list.length && !starredBatch?.running) {
        const done = getStarredDone(canvaBrandTab);
        const pending = list.filter((d: { id: string }) => !done.has(d.id));
        if (pending.length) {
          toast.success(`Auto-creating ${pending.length} starred template${pending.length === 1 ? "" : "s"} for ${BRAND_LABEL[canvaBrandTab] || canvaBrandTab}…`);
          // fire-and-forget — progress shows in the panel
          rewriteAllStarred(pending);
        }
      }
      return list;
    } catch (e: unknown) {
      const info = await readEdgeError(e);
      if (isCanvaNotConnected(info)) { setCanvaAcct({ connected: false }); return []; }
      toast.error("Couldn't load starred designs: " + info.reason);
      return [];
    } finally {
      setStarredLoading(false);
    }
  };

  // Pool of recent library renders for the batch — each template gets its own
  // render (cycled) so the batch doesn't stamp one photo on everything.
  const fetchHeroPool = async (limit = 24): Promise<string[]> => {
    try {
      const { data } = await (supabase as any)
        .from("color_visualizations")
        .select("render_urls, created_at")
        .not("render_urls", "is", null)
        .order("created_at", { ascending: false })
        .limit(60);
      const urls: string[] = [];
      for (const r of (data || [])) {
        const ru = r?.render_urls;
        const list = Array.isArray(ru) ? ru : (ru && typeof ru === "object" ? Object.values(ru) : []);
        for (const u of list) {
          const s = typeof u === "string" ? u : (u && typeof u === "object" ? ((u as any).url || (u as any).src) : null);
          if (typeof s === "string" && /^https?:\/\//.test(s)) { urls.push(s); break; }
        }
        if (urls.length >= limit) break;
      }
      return urls;
    } catch { return []; }
  };

  // THE BATCH: for every starred design — export from Canva, auto-file it by
  // aspect (4:5 / 1:1 / 9:16 / 16:9 / carousel-by-title), then AI-rewrite all
  // its text into relevant brand copy (same design, same fonts). With
  // auto-media ON, a relevant wrap render is baked into each static's photo
  // slot; OFF leaves photo slots untouched for manual images. Reel VIDEOS
  // import as-is into the reel library (text bake doesn't apply to video —
  // copy goes on as canvas overlays in the reel player). Runs 2 at a time.
  const rewriteAllStarred = async (designsOverride?: Array<{ id: string; title: string; thumbnail: string | null }>) => {
    if (starredBatch?.running) return;
    batchCancelRef.current = false;
    let designs = designsOverride || canvaStarred;
    if (!designs.length) designs = await loadCanvaStarredList();
    if (!designs.length) {
      toast.error(canvaSrcFolders.length
        ? `No designs found in ${canvaSrcFolders.map(f => `“${f.name}”`).join(", ")} — add templates to that folder in Canva, then push ↻ Refresh.`
        : "No template folder picked yet — push “change” above and tick the Canva folders that hold your templates.");
      return;
    }
    // Skip templates already built for this brand (auto-create memory) —
    // the button and the auto-run both only spend credits on NEW ones.
    if (!designsOverride) {
      const done = getStarredDone(canvaBrandTab);
      const pending = designs.filter(d => !done.has(d.id));
      if (!pending.length) {
        toast.success(`All ${designs.length} template${designs.length === 1 ? "" : "s"} are already created for ${BRAND_LABEL[canvaBrandTab] || canvaBrandTab} — they're in the library below. Add new designs to your watched Canva folder(s) to build more.`);
        return;
      }
      designs = pending;
    }
    const heroPool = batchAutoMedia ? await fetchHeroPool() : [];
    if (batchAutoMedia && heroPool.length === 0) {
      toast.warning("No wrap renders found in the library — running text-only rewrites.");
    }
    setStarredBatch({ running: true, done: 0, total: designs.length, ok: 0, failed: 0, current: "" });
    let done = 0, ok = 0, failed = 0;
    const bump = (current: string) =>
      setStarredBatch({ running: true, done, total: designs.length, ok, failed, current });
    const CONCURRENCY = 2;
    let next = 0;
    const worker = async () => {
      while (!batchCancelRef.current) {
        const i = next++;
        if (i >= designs.length) return;
        const d = designs[i];
        bump(d.title);
        try {
          const { data, error } = await supabase.functions.invoke("marketing-agent", {
            body: { action: "canva_export", design_id: d.id, title: d.title, brand: canvaBrandTab, content_type: "auto", kind: "auto" },
          });
          if (error) throw error;
          if (!data?.ok || !data?.url) throw new Error(data?.error || "export failed");
          const tpl: CanvaTemplate = {
            name: d.title, url: data.url, path: data.path, brand: canvaBrandTab,
            contentType: (data.contentType || "static-1x1") as CanvaTemplateType,
            isVideo: !!data.isVideo, mimeType: data.isVideo ? "video/mp4" : "image/png",
          };
          setCanvaTemplates(prev => [tpl, ...prev]);
          if (data.isVideo) {
            ok++; // reel video imported, ready for the reel player
            markStarredDone(canvaBrandTab, d.id);
          } else {
            const hero = batchAutoMedia && heroPool.length ? heroPool[i % heroPool.length] : null;
            const res = await rewriteTemplateToLibrary(tpl, { loadOnCanvas: false, heroUrl: hero, silent: true });
            if (res.ok) { ok++; markStarredDone(canvaBrandTab, d.id); }
            else { failed++; console.warn(`[starred-batch] ${d.title}: ${res.error}`); }
          }
        } catch (e: any) {
          failed++;
          console.warn(`[starred-batch] ${d.title}:`, e?.message || e);
        }
        done++;
        bump(d.title);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, designs.length) }, () => worker()));
    setStarredBatch({ running: false, done, total: designs.length, ok, failed, current: "" });
    if (batchCancelRef.current) {
      toast.warning(`Batch stopped — ${ok} ready, ${failed} failed, ${designs.length - done} skipped.`);
    } else {
      (failed ? toast.warning : toast.success)(
        `Starred batch done — ${ok} template${ok === 1 ? "" : "s"} ready in the library${failed ? `, ${failed} failed` : ""}.`,
      );
    }
  };

  // ── From YOUR Canva account — check connection, list designs, import ──
  const loadCanvaDesigns = useCallback(async (query?: string) => {
    setCanvaDesignsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("marketing-agent", {
        body: { action: "canva_designs", query: query || undefined },
      });
      if (data?.error === "canva_not_connected") { setCanvaAcct({ connected: false }); return; }
      if (error) throw error;
      setCanvaDesigns(data?.designs || []);
      setCanvaAcct(prev => prev?.connected ? prev : { connected: true });
    } catch (e: unknown) {
      const info = await readEdgeError(e);
      if (isCanvaNotConnected(info)) { setCanvaAcct({ connected: false }); return; }
      toast.error("Couldn't load Canva designs: " + info.reason);
    } finally {
      setCanvaDesignsLoading(false);
    }
  }, []);

  // On mount: is Canva connected? If yes, pull the watched-folder template
  // list immediately and auto-create anything new — the owner's flow is
  // "drop it in the watched Canva folder, open Content Studio, it's done."
  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.functions.invoke("canva-status", { body: {} });
        const connected = !!data?.connected;
        setCanvaAcct({ connected, name: data?.display_name || undefined });
        if (connected) loadCanvaStarredList({ autoRun: true });
      } catch {
        setCanvaAcct({ connected: false });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connectCanva = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke("canva-oauth-init", {
        body: { redirect_to: "/admin/content-studio" },
      });
      if (error || !data?.authorize_url) throw error || new Error("no authorize URL returned");
      window.location.href = data.authorize_url;
    } catch (e: any) {
      toast.error("Canva connect failed: " + (e?.message || String(e)));
    }
  }, []);

  // Import one Canva design: export it as PNG server-side, land it in this
  // brand's template library, then load it straight onto the canvas.
  const importCanvaDesign = useCallback(async (d: { id: string; title: string }) => {
    setCanvaImportingId(d.id);
    try {
      const { data, error } = await supabase.functions.invoke("marketing-agent", {
        body: {
          action: "canva_export", design_id: d.id, title: d.title,
          brand: canvaBrandTab, content_type: canvaUploadType,
          // Reel/story slots ask Canva for the MP4; everything else exports a
          // PNG with an MP4 fallback for video designs.
          kind: (canvaUploadType === "reel" || canvaUploadType === "story") ? "video" : "auto",
        },
      });
      if (error) throw error;
      if (!data?.ok || !data?.url) throw new Error(data?.error || "export failed");
      const newTpl: CanvaTemplate = {
        name: d.title, url: data.url, path: data.path,
        brand: canvaBrandTab, contentType: (data.contentType || canvaUploadType) as CanvaTemplateType,
        isVideo: !!data.isVideo, mimeType: data.isVideo ? "video/mp4" : "image/png",
      };
      setCanvaTemplates(prev => [newTpl, ...prev]);
      loadCanvaTemplate(newTpl);
      toast.success(`"${d.title}" pulled from Canva — saved to ${canvaBrandTab} → ${canvaUploadType} and loaded on canvas`);
    } catch (e: unknown) {
      const info = await readEdgeError(e);
      if (isCanvaNotConnected(info)) { setCanvaAcct({ connected: false }); return; }
      toast.error("Canva import failed: " + info.reason);
    } finally {
      setCanvaImportingId(null);
    }
  }, [canvaBrandTab, canvaUploadType, loadCanvaTemplate]);

  // Delete a Canva template from library
  const deleteCanvaTemplate = useCallback(async (path: string) => {
    await supabase.storage.from("wrap-files").remove([path]);
    setCanvaTemplates(prev => prev.filter(t => t.path !== path));
    toast.success("Template removed");
  }, []);

  // Rewrite Canva template text for brand
  // Core: rewrite ONE template image's text into brand copy (design, fonts and
  // layout untouched) and optionally bake a hero render into its photo slot,
  // then save the result as a new library variant. Used by the single-click
  // "Rewrite" button AND the ⭐ Starred batch agent.
  //   heroUrl: undefined = use the Image-panel selection (single-click default)
  //            null      = force text-only (batch "I'll add my own images")
  //            string    = bake this specific render (batch auto-media)
  const rewriteTemplateToLibrary = async (
    tpl: CanvaTemplate,
    opts?: { loadOnCanvas?: boolean; heroUrl?: string | null; silent?: boolean },
  ): Promise<{ ok: boolean; newTpl?: CanvaTemplate; error?: string }> => {
    const loadOnCanvas = opts?.loadOnCanvas ?? true;
    const heroUrl = opts?.heroUrl === undefined ? (cfImageUrl || undefined) : (opts.heroUrl || undefined);
    const heroData = opts?.heroUrl === undefined ? (cfImageBase64 || undefined) : undefined;
    try {
      const formatMap: Record<string, string> = {
        post: "Post", reel: "Reel", carousel: "Carousel",
        story: "Story", youtube: "YouTube Thumbnail", ad: "Ad",
      };
      const { data, error } = await supabase.functions.invoke("content-studio-ai-copy", {
        body: {
          imageUrl: tpl.url,
          heroImageUrl: heroUrl,
          heroImageData: heroData,
          brand: tpl.brand,
          format: formatMap[cfFormat] || "Post",
          tone: cfTone,
          mode: "rewrite_template_image",
          context: cfGenContext(),
          focusTools: tpl.brand === "DesignProAI" && cfFocusTools.length > 0 ? cfFocusTools : undefined,
          hookType: tpl.brand === "DesignProAI" ? cfHookType : undefined,
          templateConstraints: TEXT_ZONE_CONSTRAINTS,
          // The hooks brain — the brand's own tested hook patterns steer every rewrite.
          hooksLibrary: await hooksLibraryForBrand(tpl.brand),
          // Keep the output the template's own shape (no more everything-16:9).
          templateAspect: TEMPLATE_ASPECT[tpl.contentType] || undefined,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (!opts?.silent) setRewriteResult(data);
      if (!data?.editedImageBase64) {
        return { ok: false, error: data?.imageEditError || "image editor returned no image" };
      }
      const mime = data.editedImageMimeType || "image/png";
      const byteString = atob(data.editedImageBase64);
      const bytes = new Uint8Array(byteString.length);
      for (let i = 0; i < byteString.length; i++) bytes[i] = byteString.charCodeAt(i);
      const blob = new Blob([bytes], { type: mime });
      const ext = mime.split("/")[1] || "png";
      const baseName = tpl.name.replace(/\s+/g, "-").toLowerCase();
      const newPath = `canva-templates/${tpl.brand}/${tpl.contentType}/${Date.now()}-${baseName}-rewritten.${ext}`;
      const { error: upErr } = await supabase.storage.from("wrap-files").upload(newPath, blob, { contentType: mime, upsert: false });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from("wrap-files").getPublicUrl(newPath);
      const newTpl: CanvaTemplate = {
        name: `${tpl.name} (rewritten)`,
        url: urlData.publicUrl,
        path: newPath,
        brand: tpl.brand,
        contentType: tpl.contentType,
        isVideo: false,
        mimeType: mime,
      };
      setCanvaTemplates(prev => [newTpl, ...prev]);
      // Auto-load the rewritten result onto the canvas so the operator doesn't
      // have to hunt for the new variant (single-click mode only — the batch
      // leaves the canvas alone).
      if (loadOnCanvas) loadCanvaTemplate(newTpl);
      return { ok: true, newTpl };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  };

  // Rewrite Canva template text for brand — single-click button
  const rewriteTemplate = async (tpl: CanvaTemplate) => {
    setRewritingTemplate(tpl.url);
    setRewriteResult(null);
    const hasHero = !!(cfImageUrl || cfImageBase64);
    const res = await rewriteTemplateToLibrary(tpl, { loadOnCanvas: true });
    if (res.ok) {
      toast.success(hasHero ? "Template rewritten with your render baked in — loaded onto canvas" : "Template rewritten — loaded onto canvas");
    } else {
      toast.error("Rewrite failed: " + (res.error || "Unknown error"));
    }
    setRewritingTemplate(null);
  };

  // ── ColorPro Swatches: fetch + drop onto canvas ──────────────────
  // Seeds the Swatches tab from manufacturer_colors (primary) with a
  // vinyl_swatches fallback, matching how ColorPro's own browser loads.
  // A click adds the swatch image onto the canvas as an editable image
  // element — useful for dropping a color swatch into a template photo slot.
  useEffect(() => {
    (async () => {
      setSwatchesLoading(true);
      try {
        const { data: mfcData, error: mfcErr } = await supabase
          .from("manufacturer_colors")
          .select("id, manufacturer, series, product_code, official_name, official_hex, official_swatch_url, finish, is_ppf, is_verified")
          .or("is_verified.eq.true,is_verified.is.null")
          .order("manufacturer", { ascending: true })
          .order("official_name", { ascending: true })
          .limit(1000);

        if (!mfcErr && mfcData && mfcData.length > 0) {
          setSwatches(
            (mfcData as any[]).map((s) => ({
              id: s.id,
              manufacturer: s.manufacturer,
              name: s.official_name,
              code: s.product_code,
              finish: s.finish,
              hex: s.official_hex,
              imageUrl: s.official_swatch_url,
            })),
          );
        } else {
          // Fallback to vinyl_swatches
          const { data: vsData } = await supabase
            .from("vinyl_swatches")
            .select("id, manufacturer, name, code, finish, hex, media_url")
            .eq("verified", true)
            .order("manufacturer", { ascending: true })
            .limit(1000);
          setSwatches(
            ((vsData || []) as any[]).map((s) => ({
              id: s.id,
              manufacturer: s.manufacturer,
              name: s.name,
              code: s.code,
              finish: s.finish,
              hex: s.hex,
              imageUrl: s.media_url,
            })),
          );
        }
      } catch (err: any) {
        console.warn("Swatch fetch error:", err.message);
      } finally {
        setSwatchesLoading(false);
      }
    })();
  }, []);

  const swatchManufacturers = useMemo(() => {
    const set = new Set<string>();
    for (const s of swatches) if (s.manufacturer) set.add(s.manufacturer);
    return Array.from(set).sort();
  }, [swatches]);

  const filteredSwatches = useMemo(() => {
    const q = swatchSearch.trim().toLowerCase();
    return swatches.filter((s) => {
      if (swatchManufacturer !== "all" && s.manufacturer !== swatchManufacturer) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        (s.code || "").toLowerCase().includes(q) ||
        s.manufacturer.toLowerCase().includes(q) ||
        (s.finish || "").toLowerCase().includes(q)
      );
    });
  }, [swatches, swatchManufacturer, swatchSearch]);

  // Drop a swatch onto the canvas. If it has an image URL, load it as an
  // image element; otherwise fall back to a solid color rect at the hex.
  const addSwatchToCanvas = useCallback((swatch: ColorSwatch) => {
    const size = Math.min(canvasWidth, canvasHeight) * 0.3;
    const x = (canvasWidth - size) / 2;
    const y = (canvasHeight - size) / 2;

    if (swatch.imageUrl) {
      const img = new window.Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        addElement({
          id: uid(),
          type: "image",
          x,
          y,
          width: size,
          height: size,
          imageData: img,
          imageSrc: swatch.imageUrl!,
        });
        toast.success(`Added ${swatch.name}`);
      };
      img.onerror = () => {
        // CORS retry without crossOrigin, then fall back to color rect
        const retry = new window.Image();
        retry.onload = () => {
          addElement({
            id: uid(),
            type: "image",
            x,
            y,
            width: size,
            height: size,
            imageData: retry,
            imageSrc: swatch.imageUrl!,
          });
          toast.success(`Added ${swatch.name}`);
        };
        retry.onerror = () => {
          addElement({
            id: uid(),
            type: "rect",
            x,
            y,
            width: size,
            height: size,
            fill: swatch.hex,
            cornerRadius: 12,
          });
          toast.success(`Added ${swatch.name} (color swatch)`);
        };
        retry.src = swatch.imageUrl!;
      };
      img.src = swatch.imageUrl;
    } else {
      addElement({
        id: uid(),
        type: "rect",
        x,
        y,
        width: size,
        height: size,
        fill: swatch.hex,
        cornerRadius: 12,
      });
      toast.success(`Added ${swatch.name} (color swatch)`);
    }
  }, [canvasWidth, canvasHeight]);

  // Refs
  const stageRef = useRef<Konva.Stage>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bgFileInputRef = useRef<HTMLInputElement>(null);
  const canvaUploadRef = useRef<HTMLInputElement>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const layerRef = useRef<Konva.Layer>(null);

  // Attach the Konva Transformer to the selected node so users can drag
  // resize/rotate handles directly on canvas (no need to type W/H numbers).
  useEffect(() => {
    const tr = transformerRef.current;
    const layer = layerRef.current;
    if (!tr || !layer) return;
    if (!selectedId) {
      tr.nodes([]);
      layer.batchDraw();
      return;
    }
    const node = layer.findOne(`#${selectedId}`);
    if (node) {
      tr.nodes([node]);
      layer.batchDraw();
    } else {
      tr.nodes([]);
      layer.batchDraw();
    }
  }, [selectedId, elements]);

  // Scale canvas to fit preview area
  const PREVIEW_MAX = 560;
  const scale = Math.min(PREVIEW_MAX / canvasWidth, PREVIEW_MAX / canvasHeight);

  // ── Saved Works: fetch / save / load / delete ─────────────────────
  // Works live in the `content_studio_works` table. We store the canvas
  // state as JSONB (elements without imageData), plus a thumbnail PNG
  // and (for reels) a video URL.
  const fetchWorks = useCallback(async () => {
    setWorksLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setWorks([]);
        return;
      }
      const { data, error } = await supabase
        .from("content_studio_works" as any)
        .select("id, title, brand, format_label, canvas_state, thumbnail_url, video_url, updated_at")
        .order("updated_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      setWorks((data || []) as unknown as StoredWork[]);
    } catch (err: any) {
      console.error("fetchWorks error:", err);
    } finally {
      setWorksLoading(false);
    }
  }, []);

  // Load works on mount
  useEffect(() => {
    fetchWorks();
  }, [fetchWorks]);

  const serializeElements = useCallback((): StoredWork["canvas_state"]["elements"] => {
    return elements.map(el => {
      // Drop the HTMLImageElement reference — it can't be serialized.
      // imageSrc stays so the client can rehydrate on load.
      const { imageData: _drop, ...rest } = el;
      return rest;
    });
  }, [elements]);

  const saveWork = useCallback(async () => {
    if (savingWork) return;
    setSavingWork(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("You must be logged in to save a work");
        return;
      }

      // Generate thumbnail from the current stage
      let thumbnailUrl: string | null = null;
      if (stageRef.current) {
        try {
          const prevSelected = selectedId;
          setSelectedId(null);
          // Wait for ALL Google Fonts (Bebas Neue, Oswald 700, Poppins 700,
          // etc.) to actually finish loading before exporting. Without this,
          // toDataURL captures the canvas while Konva is still using the
          // browser's fallback font (Arial/serif), which is the root cause
          // of the "fonts never look the same" bug — exports were inconsistent
          // because the race between font-load and export was unpredictable.
          await document.fonts.ready;
          // Let Konva repaint before toDataURL so the transformer border
          // doesn't end up baked into the thumbnail.
          await new Promise(r => setTimeout(r, 30));
          const dataUrl = stageRef.current.toDataURL({
            mimeType: "image/jpeg",
            quality: 0.7,
            pixelRatio: 0.5 / scale,
          });
          setSelectedId(prevSelected);

          // Convert data URL → Blob → upload to storage
          const res = await fetch(dataUrl);
          const blob = await res.blob();
          const path = `content-studio-works/${user.id}/${Date.now()}-thumb.jpg`;
          const { error: upErr } = await supabase.storage
            .from("wrap-files")
            .upload(path, blob, { contentType: "image/jpeg", upsert: false });
          if (!upErr) {
            const { data: urlData } = supabase.storage.from("wrap-files").getPublicUrl(path);
            thumbnailUrl = urlData.publicUrl;
          }
        } catch (thumbErr) {
          console.warn("Thumbnail generation failed:", thumbErr);
        }
      }

      const canvasState = {
        canvasWidth,
        canvasHeight,
        formatLabel,
        bgColor,
        videoUrl,
        elements: serializeElements(),
      };

      const payload = {
        user_id: user.id,
        user_email: user.email,
        title: workTitle || "Untitled Work",
        brand: cfBrand,
        format_label: formatLabel,
        canvas_state: canvasState,
        thumbnail_url: thumbnailUrl,
        video_url: videoUrl,
      };

      if (currentWorkId) {
        const { error } = await supabase
          .from("content_studio_works" as any)
          .update(payload)
          .eq("id", currentWorkId);
        if (error) throw error;
        toast.success("Work updated");
      } else {
        const { data, error } = await supabase
          .from("content_studio_works" as any)
          .insert(payload)
          .select("id")
          .single();
        if (error) throw error;
        if (data && (data as any).id) setCurrentWorkId((data as any).id);
        toast.success("Work saved");
      }
      await fetchWorks();
    } catch (err: any) {
      console.error("saveWork error:", err);
      toast.error("Save failed: " + (err.message || "unknown"));
    } finally {
      setSavingWork(false);
    }
  }, [savingWork, currentWorkId, workTitle, cfBrand, canvasWidth, canvasHeight, formatLabel, bgColor, videoUrl, serializeElements, fetchWorks, selectedId, scale]);

  const loadWork = useCallback((work: StoredWork) => {
    try {
      const state = work.canvas_state;
      if (!state) {
        toast.error("Work has no canvas state");
        return;
      }
      setCanvasWidth(state.canvasWidth || 1080);
      setCanvasHeight(state.canvasHeight || 1350);
      setFormatLabel(state.formatLabel || "Portrait Post (4:5)");
      setBgColor(state.bgColor || BRAND.white);
      setVideoUrl(state.videoUrl || null);
      setVideoFile(null);
      setCurrentWorkId(work.id);
      setWorkTitle(work.title || "Untitled Work");

      // Rehydrate elements — image elements need a new HTMLImageElement
      // loaded from imageSrc before Konva can render them.
      const rehydrated: CanvasElement[] = (state.elements || []).map(el => ({ ...el }));
      setElements(rehydrated);
      setSelectedId(null);

      // Kick off async image loads; update each element when its image loads.
      for (const el of rehydrated) {
        if (el.type === "image" && el.imageSrc) {
          const img = new window.Image();
          img.crossOrigin = "anonymous";
          img.onload = () => {
            setElements(prev => prev.map(e => e.id === el.id ? { ...e, imageData: img } : e));
          };
          img.onerror = () => {
            const retry = new window.Image();
            retry.onload = () => {
              setElements(prev => prev.map(e => e.id === el.id ? { ...e, imageData: retry } : e));
            };
            retry.src = el.imageSrc!;
          };
          img.src = el.imageSrc;
        }
      }

      toast.success(`Loaded: ${work.title}`);
    } catch (err: any) {
      console.error("loadWork error:", err);
      toast.error("Load failed: " + (err.message || "unknown"));
    }
  }, []);

  const deleteWork = useCallback(async (work: StoredWork) => {
    if (!confirm(`Delete "${work.title}"? This cannot be undone.`)) return;
    try {
      const { error } = await supabase
        .from("content_studio_works" as any)
        .delete()
        .eq("id", work.id);
      if (error) throw error;
      if (work.thumbnail_url) {
        // Best-effort cleanup of the thumbnail blob
        const match = work.thumbnail_url.match(/wrap-files\/(.+)$/);
        if (match?.[1]) {
          await supabase.storage.from("wrap-files").remove([match[1]]).catch(() => {});
        }
      }
      if (currentWorkId === work.id) {
        setCurrentWorkId(null);
        setWorkTitle("Untitled Work");
      }
      await fetchWorks();
      toast.success("Work deleted");
    } catch (err: any) {
      console.error("deleteWork error:", err);
      toast.error("Delete failed: " + (err.message || "unknown"));
    }
  }, [currentWorkId, fetchWorks]);

  const newWork = useCallback(() => {
    setCurrentWorkId(null);
    setWorkTitle("Untitled Work");
    setElements([]);
    setSelectedId(null);
    setVideoUrl(null);
    setVideoFile(null);
    toast.success("New work started");
  }, []);

  // ── Render selection: preview first, then user decides ──────────
  const handleRenderPicked = useCallback((url: string, meta: { designName?: string; vehicle?: string; view?: string }) => {
    setPendingRender({ url, meta });
  }, []);

  // Option 1: Auto Create — place on canvas + set as AI context
  const confirmAutoCreate = useCallback(() => {
    if (!pendingRender) return;
    const { url, meta } = pendingRender;
    setCfImageUrl(url);
    setCfImageBase64(null);
    setCfImageMode("render");
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const aspect = img.width / img.height;
      let w = canvasWidth;
      let h = canvasWidth / aspect;
      if (h < canvasHeight) { h = canvasHeight; w = h * aspect; }
      setElements(prev => [{
        id: uid(), type: "image" as const,
        x: (canvasWidth - w) / 2, y: (canvasHeight - h) / 2,
        width: w, height: h, imageData: img, imageSrc: url,
      }, ...prev]);
      const label = meta?.vehicle || meta?.designName || "render";
      toast.success(`${label} placed on canvas + set as AI context`);
    };
    img.src = url;
    setPendingRender(null);
  }, [pendingRender, canvasWidth, canvasHeight]);

  // Option 2: AI Context Only — set as AI image but don't touch canvas
  const confirmAiContextOnly = useCallback(() => {
    if (!pendingRender) return;
    setCfImageUrl(pendingRender.url);
    setCfImageBase64(null);
    setCfImageMode("render");
    toast.success("Image set as AI context — canvas unchanged");
    setPendingRender(null);
  }, [pendingRender]);

  // Option 3: Canvas Only — place on canvas but don't set as AI context
  const confirmCanvasOnly = useCallback(() => {
    if (!pendingRender) return;
    const { url, meta } = pendingRender;
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const aspect = img.width / img.height;
      let w = canvasWidth * 0.7;
      let h = w / aspect;
      if (h > canvasHeight * 0.6) { h = canvasHeight * 0.6; w = h * aspect; }
      addElement({ id: uid(), type: "image", x: (canvasWidth - w) / 2, y: (canvasHeight - h) / 2, width: w, height: h, imageData: img, imageSrc: url });
    };
    img.src = url;
    const label = meta?.vehicle || meta?.designName || "render";
    toast.success(`${label} added to canvas`);
    setPendingRender(null);
  }, [pendingRender, canvasWidth, canvasHeight]);

  // Option 4: Download PNG — save the render locally, canvas + AI context unchanged
  const downloadPendingRender = useCallback(() => {
    if (!pendingRender) return;
    const { url, meta } = pendingRender;
    const slug = (meta?.vehicle || meta?.designName || "render")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^\w.-]/g, "")
      .toLowerCase() || "render";
    const view = meta?.view ? `-${meta.view.replace(/\s+/g, "-")}` : "";
    const filename = `${slug}${view}.png`;
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) { toast.error("Download failed"); return; }
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((blob) => {
        if (!blob) { toast.error("Download failed"); return; }
        const href = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = href;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(href);
        toast.success(`Downloaded ${filename}`);
      }, "image/png");
    };
    img.onerror = () => toast.error("Failed to load render for download");
    img.src = url;
  }, [pendingRender]);

  // Helper: is current format a vertical/video-compatible format?
  const isVideoFormat = ["IG Story (9:16)", "IG Reel (9:16)", "TikTok (9:16)", "Reels Cover (9:16)"].includes(formatLabel);

  // ── Video upload handler ──────────────────────────────────────────
  const handleVideoUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      toast.error("Please select a video file");
      return;
    }
    if (file.size > 500 * 1024 * 1024) {
      toast.error("Video must be under 500MB");
      return;
    }
    const url = URL.createObjectURL(file);
    setVideoUrl(url);
    setVideoFile(file);
    toast.success(`Video loaded: ${file.name}`);
    e.target.value = "";
  }, []);

  // ── ContentFlow AI image upload handler ─────────────────────────
  const handleCfImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Video → load it into the reel video player (this Upload accepts both now).
    if (file.type.startsWith("video/")) {
      if (file.size > 500 * 1024 * 1024) { toast.error("Video must be under 500MB"); e.target.value = ""; return; }
      const url = URL.createObjectURL(file);
      setVideoUrl(url);
      setVideoFile(file);
      const reel = FORMAT_PRESETS.find(f => f.label === "IG Reel (9:16)") || FORMAT_PRESETS[1];
      setCanvasWidth(reel.width);
      setCanvasHeight(reel.height);
      toast.success(`Video loaded: ${file.name}`);
      e.target.value = "";
      return;
    }
    (async () => {
      const img = await compressImageIfLarge(file);
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        setCfImageBase64(dataUrl);
        setCfImageUrl(null);
        setCfImageMode("upload");
        toast.success("Image loaded for AI copy generation");
      };
      reader.readAsDataURL(img);
    })();
    e.target.value = "";
  }, []);

  // ── Apply typographic refinement pipeline to generated content ──
  const applyTypographicPipeline = (raw: GeneratedContent): GeneratedContent => {
    return {
      hook: refineText(raw.hook, "hook"),
      headline: refineText(raw.headline, "headline"),
      body: refineText(raw.body, "body"),
      cta: refineText(raw.cta, "cta"),
    };
  };

  // ── ContentFlow AI Generate ─────────────────────────────────────
  // Bake-by-default: if a Canva template is on the canvas, Generate ALWAYS
  // requests rewrite_template_image so the finished PNG comes back with the
  // TEXT replaced (owner rule: text-only — photos/graphics stay put for
  // manual swap). A picked render additionally swaps the photo subject.
  // Previously baking required a picked render, so template-on-canvas
  // generates only wrote sidebar copy and never touched the template —
  // "it's not replacing text" (live 2026-07-28).
  const handleGenerate = async () => {
    setCfGenerating(true);

    const hasTemplateOnCanvas = elements.some(e => e.type === "image");
    const hasRender = !!(cfImageUrl || cfImageBase64);
    const shouldBake = hasTemplateOnCanvas;

    // The edge function now handles text-only mode (no image), so we always
    // route through Claude. The previous "no image → local generateContent"
    // path was the source of generic boilerplate that ignored tool selection
    // (it shipped "New AI Launch / DesignProAI / 7 camera angles" no matter
    // what the user typed). Local generation is now last-resort only when
    // the edge call truly fails.
    {
      try {
        const formatMap: Record<string, string> = {
          post: "Post", reel: "Reel", carousel: "Carousel",
          story: "Story", youtube: "YouTube Thumbnail", ad: "Ad",
        };

        // Resolve the template image (style reference) when on canvas.
        let templateUrl: string | undefined;
        let templateData: string | undefined;
        let templateElId: string | undefined;
        if (hasTemplateOnCanvas) {
          const templateEl = elements.find(e => e.type === "image" && e.imageSrc);
          templateElId = templateEl?.id;
          if (templateEl?.imageSrc) {
            templateUrl = templateEl.imageSrc;
          } else {
            const stageNode = document.querySelector(".konvajs-content canvas") as HTMLCanvasElement;
            if (stageNode) {
              try { templateData = stageNode.toDataURL("image/png"); } catch (_) { /* CORS */ }
            }
          }
        }

        // Pick the image to send for Claude to read text zones / generate copy.
        // With a template: template IS the style reference image.
        // Without a template: the user's render is the context image (if any).
        // Without either: text-only mode — Claude still generates tool/hook-aware copy.
        const imageToSend = hasTemplateOnCanvas ? templateUrl : (cfImageUrl || undefined);
        const imageDataToSend = hasTemplateOnCanvas ? templateData : (cfImageBase64 || undefined);

        // Hero render — only sent when the user explicitly picked one (that's
        // the opt-in photo swap). Without it the bake is text-only.
        const heroImageUrl = hasRender ? (cfImageUrl || undefined) : undefined;
        const heroImageData = hasRender ? (cfImageBase64 || undefined) : undefined;

        // Lock the baked output to the canvas's own shape (Gemini defaults to
        // 16:9 without this).
        const cwRatio = canvasWidth / canvasHeight;
        const cwAspects: [string, number][] = [["1:1", 1], ["4:5", 0.8], ["9:16", 9 / 16], ["16:9", 16 / 9], ["3:4", 0.75], ["4:3", 4 / 3], ["2:3", 2 / 3]];
        let cwAspect = "1:1", cwBest = Infinity;
        for (const [nm, r] of cwAspects) { const d = Math.abs(cwRatio - r); if (d < cwBest) { cwBest = d; cwAspect = nm; } }

        const { data, error } = await supabase.functions.invoke("content-studio-ai-copy", {
          body: {
            imageUrl: imageToSend,
            imageData: imageDataToSend,
            heroImageUrl,
            heroImageData,
            brand: cfBrand,
            format: formatMap[cfFormat] || "Post",
            tone: cfTone,
            context: cfGenContext(),
            focusTools: cfBrand === "DesignProAI" && cfFocusTools.length > 0 ? cfFocusTools : undefined,
            hookType: cfBrand === "DesignProAI" ? cfHookType : undefined,
            templateConstraints: TEXT_ZONE_CONSTRAINTS,
            hooksLibrary: await hooksLibraryForBrand(cfBrand),
            templateAspect: shouldBake ? cwAspect : undefined,
            mode: shouldBake ? "rewrite_template_image" : undefined,
          },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);

        // If we baked, swap the finished PNG onto the canvas right away so
        // the user sees a publish-ready design without a second click.
        if (shouldBake && data?.editedImageBase64 && templateElId) {
          const newSrc = `data:${data.editedImageMimeType || "image/png"};base64,${data.editedImageBase64}`;
          const img = new window.Image();
          img.crossOrigin = "anonymous";
          img.onload = () => {
            setElements(prev => prev.map(el =>
              el.id === templateElId
                ? { ...el, imageData: img, imageSrc: newSrc }
                : el
            ));
            toast.success(hasRender
              ? "Template rebuilt — text replaced + your render dropped in."
              : "Template rebuilt — text replaced. Swap in your image/video when ready.");
          };
          img.src = newSrc;
        } else if (shouldBake && data?.imageEditError) {
          // Bake failed — surface the reason but keep going with copy-only
          toast.error(`Image bake failed: ${data.imageEditError}. Copy was still generated — push Render to Template to retry.`);
        }

        let rawResult: { hook: string; headline: string; body: string; cta: string };

        if (hasTemplateOnCanvas && data?.replacements) {
          // Template rewrite mode — map replacements to hook/headline/body/cta
          const replacements = data.replacements as Array<{ replacement: string; zone: string; position: string }>;
          rawResult = { hook: "", headline: "", body: "", cta: "" };
          for (const r of replacements) {
            if (r.zone === "headline" && !rawResult.hook) {
              // First headline becomes hook, second becomes headline
              if (r.position === "top") rawResult.hook = r.replacement;
              else rawResult.headline = r.replacement;
            }
            if (r.zone === "headline" && rawResult.hook && !rawResult.headline) rawResult.headline = r.replacement;
            if (r.zone === "body") rawResult.body = rawResult.body ? `${rawResult.body} ${r.replacement}` : r.replacement;
            if (r.zone === "cta") rawResult.cta = r.replacement;
            if (r.zone === "tagline" && !rawResult.headline) rawResult.headline = r.replacement;
          }
          // Fill any gaps
          if (!rawResult.hook && replacements.length > 0) rawResult.hook = replacements[0].replacement;
          if (!rawResult.headline && replacements.length > 1) rawResult.headline = replacements[1].replacement;
          if (!rawResult.cta) rawResult.cta = cfBrand === "WePrintWraps" ? "GET A FREE QUOTE → WEPRINTWRAPS.COM" : cfBrand === "WrapTV" ? "FOLLOW FOR MORE → WRAPTVWORLD.COM" : cfBrand === "InkAndEdge" ? "READ THE FEATURE → INKANDEDGE.COM" : "DESIGN YOUR WRAP";
          // Only announce a text-only rewrite when no baked image came back —
          // otherwise the bake toast above already told the story.
          if (!data?.editedImageBase64) toast.success("Template copy written for " + cfBrand + " — baking failed, push Render to Template to retry.");
        } else {
          // Standard image-to-copy mode
          rawResult = {
            hook: data.hook || "",
            headline: data.headline || "",
            body: data.body || "",
            cta: data.cta || "",
          };
          toast.success("AI copy generated from your image!");
        }

        // Run through typographic refinement pipeline
        setCfResult(applyTypographicPipeline(rawResult));
      } catch (err: any) {
        console.error("ContentFlow AI error:", err);
        // supabase-js throws FunctionsHttpError with a generic message and the
        // real reason in err.context (the raw Response). Read the body so the
        // user sees WHY (e.g. "Sign in required", "OPENAI_API_KEY is not
        // configured") instead of the useless "returned a non-2xx status code".
        let reason = err?.message || "Unknown error";
        try {
          if (err?.context && typeof err.context.json === "function") {
            const body = await err.context.json();
            if (body?.error) reason = body.error;
          }
        } catch { /* keep err.message */ }
        // Make the actual failure visible instead of pretending it worked.
        const hint = /sign in required|jwt|unauthor|401/i.test(reason)
          ? "Your session expired — refresh the page (or sign out and back in), then try again."
          : /openai_api_key|not configured|api key/i.test(reason)
            ? "Server AI key isn't set — this needs a fix on our side, not you. Tell Claude."
            : /abort|timeout|timed out/i.test(reason)
              ? "The AI timed out. Retry, or check your network."
              : /stack size|maximum call/i.test(reason)
                ? "Image too large to encode. Pick a smaller render."
                : reason;
        toast.error(`AI generation failed: ${hint}`);
        // No local fallback — the hardcoded generator shipped generic
        // boilerplate that ignored what the user typed. The honest failure
        // above beats fake copy; the user retries when the edge is back.
      }
    }
    setCfGenerating(false);
  };

  // Clamp helper — uses typographic constraint profiles for character budgets
  // instead of arbitrary hardcoded limits. Falls back to max param if no
  // constraint profile exists.
  const clampText = (text: string, max: number) => {
    const clean = (text || "").trim();
    if (clean.length <= max) return clean;
    return clean.slice(0, max - 1).trimEnd() + "…";
  };

  // ── 🧠 Copy variants — three marketing-brain options, tap to choose ──
  type CopyVariant = { angle?: string; hook: string; headline: string; body: string; cta: string };
  const [copyVariants, setCopyVariants] = useState<CopyVariant[]>([]);
  const [variantsLoading, setVariantsLoading] = useState(false);

  const generateCopyVariants = async () => {
    setVariantsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("content-studio-ai-copy", {
        body: {
          mode: "copy_variants",
          brand: cfBrand,
          format: cfFormat,
          tone: cfTone,
          context: cfGenContext(),
          focusTools: cfBrand === "DesignProAI" && cfFocusTools.length > 0 ? cfFocusTools : undefined,
          hookType: cfBrand === "DesignProAI" ? cfHookType : undefined,
          templateConstraints: TEXT_ZONE_CONSTRAINTS,
          hooksLibrary: await hooksLibraryForBrand(cfBrand),
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const variants = (data?.variants || []).filter((v: CopyVariant) => v.hook || v.headline);
      if (!variants.length) throw new Error("no variants returned — try again");
      setCopyVariants(variants);
      toast.success("3 copy angles ready — tap one to use it.");
    } catch (err: any) {
      let reason = err?.message || String(err);
      try {
        if (err?.context && typeof err.context.json === "function") {
          const body = await err.context.json();
          if (body?.error) reason = body.error;
        }
      } catch { /* keep message */ }
      toast.error("Couldn't generate options: " + reason);
    } finally {
      setVariantsLoading(false);
    }
  };

  // ── Render to Template — Gemini bakes new text into template image ──
  const [isRendering, setIsRendering] = useState(false);

  const renderToTemplate = async () => {
    if (!cfResult) return;
    const templateEl = elements.find(e => e.type === "image" && e.imageSrc);
    if (!templateEl?.imageSrc) {
      toast.error("No template image on canvas");
      return;
    }

    // Hero image = the render/design placed into the template's style. Use the
    // one picked in the Image panel, else AUTO-PULL a real wrap render from the
    // library so "match style + switch image + update text" works without the
    // user hunting for a render first.
    let heroImageUrl = cfImageUrl || undefined;
    const heroImageBase64 = cfImageBase64 || undefined;
    if (!heroImageUrl && !heroImageBase64) {
      const wrap = await fetchAutoHeroRender(cfTopic);
      if (wrap) { heroImageUrl = wrap; setCfImageUrl(wrap); }
      else { toast.error("No wrap render in your library to place — generate/approve a design first."); return; }
    }

    setIsRendering(true);
    try {
      // Send the user's refined sidebar copy as freshCopy so the edge function
      // can map it onto the template's actual text zones (read via vision).
      const freshCopy = {
        hook: (cfResult.hook || "").trim(),
        headline: (cfResult.headline || "").trim(),
        body: (cfResult.body || "").trim(),
        cta: (cfResult.cta || "").trim(),
      };

      // If the template is a data URL (local upload), send as imageData
      // so the edge function doesn't try to fetch a data: URL.
      const templateSrc = templateEl.imageSrc!;
      const isDataUrl = templateSrc.startsWith("data:");
      const formatMap: Record<string, string> = {
        post: "Post", reel: "Reel", carousel: "Carousel",
        story: "Story", youtube: "YouTube Thumbnail", ad: "Ad",
      };

      // Match the canvas's shape so the edited image comes back the same
      // aspect instead of Gemini's 16:9 default.
      const ratio = canvasWidth / canvasHeight;
      const aspects: [string, number][] = [["1:1", 1], ["4:5", 0.8], ["9:16", 9 / 16], ["16:9", 16 / 9], ["3:4", 0.75], ["4:3", 4 / 3], ["2:3", 2 / 3]];
      let templateAspect = "1:1", bestDiff = Infinity;
      for (const [name, r] of aspects) { const d = Math.abs(ratio - r); if (d < bestDiff) { bestDiff = d; templateAspect = name; } }

      const { data, error } = await supabase.functions.invoke("content-studio-ai-copy", {
        body: {
          // Style reference — the Canva template loaded on canvas
          ...(isDataUrl ? { imageData: templateSrc } : { imageUrl: templateSrc }),
          // Hero subject — the user's render/design from DesignProAI tools
          heroImageUrl,
          heroImageData: heroImageBase64,
          brand: cfBrand,
          format: formatMap[cfFormat] || "Post",
          tone: cfTone,
          mode: "rewrite_template_image",
          templateConstraints: TEXT_ZONE_CONSTRAINTS,
          freshCopy,
          context: cfGenContext(),
          focusTools: cfBrand === "DesignProAI" && cfFocusTools.length > 0 ? cfFocusTools : undefined,
          hookType: cfBrand === "DesignProAI" ? cfHookType : undefined,
          hooksLibrary: await hooksLibraryForBrand(cfBrand),
          templateAspect,
        },
      });

      if (error) throw error;

      if (data?.editedImageBase64) {
        // Replace the template image on canvas with the rendered version
        const newSrc = `data:${data.editedImageMimeType || "image/png"};base64,${data.editedImageBase64}`;
        const img = new window.Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          setElements(prev => prev.map(el =>
            el.id === templateEl.id
              ? { ...el, imageData: img, imageSrc: newSrc }
              : el
          ));
          toast.success("Template rendered with new text!");
        };
        img.src = newSrc;
      } else {
        toast.error(data?.imageEditError || "Render failed — try Apply to Canvas instead");
      }
    } catch (err: any) {
      console.error("Render to template error:", err);
      // supabase-js throws FunctionsHttpError with a generic message; the
      // real reason (e.g. "Sign in required", the AI's error) lives in
      // err.context (the raw Response). Read it so the toast says WHY
      // instead of the useless "returned a non-2xx status code".
      let reason = err?.message || "Unknown error";
      try {
        if (err?.context && typeof err.context.json === "function") {
          const body = await err.context.json();
          if (body?.error) reason = body.error;
          if (body?.raw) console.warn("AI raw (non-JSON) response:", String(body.raw).slice(0, 400));
        }
      } catch { /* keep err.message */ }
      const hint = /abort|timeout|timed out/i.test(reason)
        ? "Gemini image edit timed out — try again or use Apply to Canvas"
        : /sign in required|jwt|unauthor|401/i.test(reason)
          ? "Your session expired — refresh the page (or sign out and back in), then try again."
          : reason;
      toast.error("Render failed: " + hint);
    } finally {
      setIsRendering(false);
    }
  };

  // Pull a real render from the library to use as the hero background when the
  // team generated copy WITHOUT picking a render — so the design is never just
  // text on a white canvas ("real AI creator", not an empty card). Reads the
  // same source as the RenderBrowser (color_visualizations.render_urls),
  // newest first, with a light relevance nudge toward the topic. Degrades to
  // null (→ old text-only behavior) so it can never break a generate.
  const fetchAutoHeroRender = async (topic?: string): Promise<string | null> => {
    try {
      const { data } = await (supabase as any)
        .from("color_visualizations")
        .select("render_urls, vehicle_make, vehicle_model, color_name, created_at")
        .not("render_urls", "is", null)
        .order("created_at", { ascending: false })
        .limit(30);
      const rows = (data || []) as any[];
      const urlOf = (r: any): string | null => {
        const ru = r?.render_urls;
        const list = Array.isArray(ru) ? ru : (ru && typeof ru === "object" ? Object.values(ru) : []);
        for (const u of list) {
          const s = typeof u === "string" ? u : (u && typeof u === "object" ? ((u as any).url || (u as any).src) : null);
          if (typeof s === "string" && /^https?:\/\//.test(s)) return s;
        }
        return null;
      };
      const t = (topic || "").toLowerCase();
      if (t) {
        for (const r of rows) {
          const hay = `${r.vehicle_make || ""} ${r.vehicle_model || ""} ${r.color_name || ""}`.toLowerCase();
          if (hay.trim() && hay.split(/\s+/).some((w: string) => w.length > 2 && t.includes(w))) {
            const u = urlOf(r); if (u) return u;
          }
        }
      }
      for (const r of rows) { const u = urlOf(r); if (u) return u; }
      return null;
    } catch { return null; }
  };

  const applyContentToCanvas = async () => {
    if (!cfResult) return;

    const hasTemplateImage = elements.some(e => e.type === "image");

    // Resolve a hero background: the picked render, or — when nothing is picked
    // and the canvas is bare — an AUTO-PULLED render from the library, so the
    // result is a real design instead of text on white ("real AI creator").
    let heroUrl: string | null = cfImageUrl || null;
    if (!heroUrl && !hasTemplateImage) {
      heroUrl = await fetchAutoHeroRender(cfTopic);
      if (heroUrl) setCfImageUrl(heroUrl);
    }

    // Text sits on imagery when there's a template OR an auto hero → white text
    // (+ a dark scrim under it for the hero case, so copy stays readable on any
    // photo). A truly bare white canvas keeps dark text.
    const onImagery = hasTemplateImage || !!heroUrl;
    const textOnLight = !onImagery;
    const primaryTextColor = textOnLight ? BRAND.black : BRAND.white;
    const secondaryTextColor = textOnLight ? "#0066CC" : BRAND.cyan;
    const bodyTextColor = textOnLight ? "#333333" : "#EEEEEE";

    // Character budgets from typographic constraint profiles
    const HOOK_MAX = TEXT_ZONE_CONSTRAINTS.hook.charRange[1];
    const HEADLINE_MAX = TEXT_ZONE_CONSTRAINTS.headline.charRange[1];
    const BODY_MAX = TEXT_ZONE_CONSTRAINTS.body.charRange[1];
    const CTA_MAX = TEXT_ZONE_CONSTRAINTS.cta.charRange[1];

    // Font sizes scale with canvas width so 4:5 / 9:16 / 1:1 all look right
    const hookSize = Math.round(canvasWidth * 0.055);
    const headlineSize = Math.round(canvasWidth * 0.032);
    const bodySize = Math.round(canvasWidth * 0.023);
    const ctaSize = Math.round(canvasWidth * 0.024);

    const textEls: CanvasElement[] = [
      { id: uid(), type: "text",
        x: 60, y: 60, width: canvasWidth - 120, height: hookSize * 2.2,
        text: clampText(cfResult.hook.toUpperCase(), HOOK_MAX),
        fontSize: hookSize, fontFamily: "Oswald", fontStyle: "bold",
        fill: primaryTextColor, align: "center" },
      { id: uid(), type: "text",
        x: 60, y: 60 + hookSize * 2.4, width: canvasWidth - 120, height: headlineSize * 2.5,
        text: clampText(cfResult.headline, HEADLINE_MAX),
        fontSize: headlineSize, fontFamily: "Poppins", fontStyle: "bold",
        fill: secondaryTextColor, align: "center" },
      { id: uid(), type: "text",
        x: 80, y: canvasHeight * 0.42, width: canvasWidth - 160, height: bodySize * 6,
        text: clampText(cfResult.body, BODY_MAX),
        fontSize: bodySize, fontFamily: "Poppins",
        fill: bodyTextColor, align: "center" },
      { id: uid(), type: "rect",
        x: canvasWidth * 0.15, y: canvasHeight - Math.round(canvasHeight * 0.12),
        width: canvasWidth * 0.7, height: Math.round(canvasHeight * 0.065),
        fill: BRAND.cyan, cornerRadius: 12 },
      { id: uid(), type: "text",
        x: canvasWidth * 0.15, y: canvasHeight - Math.round(canvasHeight * 0.12),
        width: canvasWidth * 0.7, height: Math.round(canvasHeight * 0.065),
        text: clampText(cfResult.cta.toUpperCase(), CTA_MAX),
        fontSize: ctaSize, fontFamily: "Poppins", fontStyle: "bold",
        fill: BRAND.black, align: "center", verticalAlign: "middle" },
    ];

    // Auto hero (bare canvas): load it, then compose image → scrim → text in
    // ONE update so z-order is correct (photo at the bottom, copy on top).
    if (heroUrl && !hasTemplateImage) {
      const url = heroUrl;
      const img = new window.Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const aspect = img.width / img.height;
        let w = canvasWidth;
        let h = canvasWidth / aspect;
        if (h < canvasHeight) { h = canvasHeight; w = h * aspect; }
        const bgImg: CanvasElement = {
          id: uid(), type: "image",
          x: (canvasWidth - w) / 2, y: (canvasHeight - h) / 2,
          width: w, height: h, imageData: img, imageSrc: url,
        };
        const scrim: CanvasElement = {
          id: uid(), type: "rect", x: 0, y: 0,
          width: canvasWidth, height: canvasHeight, fill: "rgba(0,0,0,0.45)",
        };
        setElements(prev => [bgImg, scrim, ...prev, ...textEls]);
        toast.success("Design built — library render + AI copy on the canvas.");
      };
      img.onerror = () => {
        setElements(prev => [...prev, ...textEls]);
        toast.success("Content applied (auto image failed to load).");
      };
      img.src = url;
    } else {
      // Picked render / template already on canvas, or nothing to auto-place.
      if (cfImageUrl) {
        const url = cfImageUrl;
        const img = new window.Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          const aspect = img.width / img.height;
          let w = canvasWidth;
          let h = canvasWidth / aspect;
          if (h < canvasHeight) { h = canvasHeight; w = h * aspect; }
          setElements(prev => prev.some(e => e.type === "image" && e.imageSrc === url)
            ? prev
            : [{ id: uid(), type: "image" as const,
                 x: (canvasWidth - w) / 2, y: (canvasHeight - h) / 2,
                 width: w, height: h, imageData: img, imageSrc: url }, ...prev]);
        };
        img.src = url;
      }
      setElements(prev => [...prev, ...textEls]);
      toast.success("Content applied to canvas!");
    }
  };

  // Build a REAL Canva design: autofill this brand's mapped Canva Brand
  // Template (set at /admin/marketing-agent) with the generated copy via the
  // marketing-agent "design" action, then drop the returned image on canvas.
  // Falls back to a library image (engine:"library") when no template is mapped
  // or Canva isn't connected — the toast says which happened.
  const buildCanvaDesign = async () => {
    if (!cfResult) return;
    const brandSlug = ({
      DesignProAI: "restylepro", WePrintWraps: "weprintwraps",
      WrapTV: "wraptvworld", WrapTVWorld: "wraptvworld",
      InkAndEdge: "inkandedge", DesignProAI: "designproai", TheWrap: "thewrap",
    } as Record<string, string>)[cfBrand] || cfBrand.toLowerCase();
    setBuildingCanva(true);
    try {
      const { data, error } = await supabase.functions.invoke("marketing-agent", {
        body: {
          action: "design",
          brand: brandSlug,
          headline: cfResult.hook || cfResult.headline || "",
          subhead: (cfResult.hook && cfResult.headline) ? cfResult.headline : (cfResult.body || undefined),
          cta: cfResult.cta || undefined,
          format: cfFormat,
        },
      });
      if (error) throw new Error(error.message);
      // With a mapped template, data.url is the real autofilled Canva design.
      // WITHOUT one, marketing-agent falls back to a generic library image that
      // can be off-topic stock (e.g. a fashion mood board) — so prefer a REAL
      // wrap render from the design library instead.
      let url = data?.url as string | undefined;
      if (data?.engine !== "canva") {
        const wrap = await fetchAutoHeroRender(cfTopic);
        if (wrap) url = wrap;
      }
      if (data?.ok === false && !url) throw new Error(data?.error || "no design returned");
      if (!url) throw new Error("No Canva template mapped and no wrap render in your library to fall back on.");
      const finalUrl = url;
      const img = new window.Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const aspect = img.width / img.height;
        let w = canvasWidth;
        let h = canvasWidth / aspect;
        if (h < canvasHeight) { h = canvasHeight; w = h * aspect; }
        // Replace any prior background image with the built design.
        setElements(prev => [
          { id: uid(), type: "image" as const, x: (canvasWidth - w) / 2, y: (canvasHeight - h) / 2, width: w, height: h, imageData: img, imageSrc: finalUrl },
          ...prev.filter(e => e.type !== "image"),
        ]);
        setCfImageUrl(finalUrl);
      };
      img.src = finalUrl;
      toast.success(data?.engine === "canva"
        ? "Built from your Canva template!"
        : "No Canva template mapped — used one of your wrap renders. Map a template at /admin/marketing-agent for branded output.");
    } catch (e: any) {
      const raw = String(e?.message || e);
      const msg = /canva_not_connected/.test(raw)
        ? "Canva isn't connected — connect + map a template at /admin/marketing-agent."
        : (raw || "Canva build failed");
      toast.error(msg);
    } finally {
      setBuildingCanva(false);
    }
  };

  // ── ContentFlow format → canvas preset map ─────────────────────
  const cfFormatToCanvasLabel: Record<string, string> = {
    post: "Square Post (1:1)",
    reel: "IG Reel (9:16)",
    story: "IG Story (9:16)",
    carousel: "Carousel Slide (4:5)",
    youtube: "YouTube Thumbnail (16:9)",
    ad: "FB Ad Landscape (16:9)",
  };

  // Called by ContentFlow AI "Format" select — updates AI format AND resizes canvas
  const handleCfFormatChange = (value: string) => {
    setCfFormat(value);
    const targetLabel = cfFormatToCanvasLabel[value];
    if (!targetLabel) return;
    const preset =
      FORMAT_PRESETS.find(f => f.label === targetLabel) ||
      FORMAT_PRESETS.find(f => f.label.startsWith(targetLabel.split(" (")[0]));
    if (!preset) return;
    setCanvasWidth(preset.width);
    setCanvasHeight(preset.height);
    setFormatLabel(preset.label);
  };

  // ── Format change ───────────────────────────────────────────────
  const handleFormatChange = (label: string) => {
    const preset = FORMAT_PRESETS.find(f => f.label === label);
    if (!preset) return;
    setCanvasWidth(preset.width);
    setCanvasHeight(preset.height);
    setFormatLabel(label);
    setElements([]);
    setSelectedId(null);
    // Clear video if switching away from a video-compatible format
    const videoFormats = ["IG Story (9:16)", "IG Reel (9:16)", "TikTok (9:16)", "Reels Cover (9:16)"];
    if (!videoFormats.includes(label) && videoUrl) {
      setVideoUrl(null);
      setVideoFile(null);
    }
  };

  // ── Element CRUD ────────────────────────────────────────────────
  const addElement = (el: CanvasElement) => {
    setElements(prev => [...prev, el]);
    setSelectedId(el.id);
  };

  const updateElement = (id: string, updates: Partial<CanvasElement>) => {
    setElements(prev => prev.map(e => e.id === id ? { ...e, ...updates } : e));
  };

  const removeElement = (id: string) => {
    setElements(prev => prev.filter(e => e.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const moveElement = (id: string, direction: "up" | "down") => {
    setElements(prev => {
      const idx = prev.findIndex(e => e.id === id);
      if (idx < 0) return prev;
      const newArr = [...prev];
      const swapIdx = direction === "up" ? idx + 1 : idx - 1;
      if (swapIdx < 0 || swapIdx >= newArr.length) return prev;
      [newArr[idx], newArr[swapIdx]] = [newArr[swapIdx], newArr[idx]];
      return newArr;
    });
  };

  const selectedEl = elements.find(e => e.id === selectedId) || null;

  // ── Add text ────────────────────────────────────────────────────
  const addText = (text = "Your text here", opts: Partial<CanvasElement> = {}) => {
    addElement({
      id: uid(), type: "text",
      x: 80, y: canvasHeight / 2 - 40, width: canvasWidth - 160, height: 80,
      text, fontSize: 48, fontFamily: "Oswald", fontStyle: "bold",
      fill: BRAND.white, align: "center", verticalAlign: "middle",
      ...opts,
    });
  };

  // ── Add rectangle ──────────────────────────────────────────────
  const addRect = (opts: Partial<CanvasElement> = {}) => {
    addElement({
      id: uid(), type: "rect",
      x: canvasWidth / 2 - 200, y: canvasHeight / 2 - 30,
      width: 400, height: 60, fill: BRAND.cyan, cornerRadius: 8,
      ...opts,
    });
  };

  // ── WrapTV Stamp — the "back-in-the-day music video" branding: a logo
  //    bug top-left + an MTV-style lower-third (song title + shop credit).
  //    Drops editable canvas elements over the loaded video/image; the song
  //    and shop text are placeholders you edit. Logo is swappable at the URL.
  const addWrapTVStamp = () => {
    const W = canvasWidth, H = canvasHeight;
    const bug = Math.round(W * 0.2);
    const stamp: CanvasElement[] = [
      // lower-third background bar
      { id: uid(), type: "rect", x: 0, y: Math.round(H * 0.72), width: W, height: Math.round(H * 0.17), fill: "#05070a", opacity: 0.6 },
      // WrapTV cyan accent tick
      { id: uid(), type: "rect", x: Math.round(W * 0.06), y: Math.round(H * 0.735), width: Math.round(W * 0.018), height: Math.round(H * 0.135), fill: "#17A5BE", cornerRadius: 4 },
      // song title
      { id: uid(), type: "text", x: Math.round(W * 0.1), y: Math.round(H * 0.735), width: Math.round(W * 0.82), height: Math.round(H * 0.08), text: "SONG TITLE", fontSize: Math.round(W * 0.062), fontFamily: "Anton", fontStyle: "normal", fill: "#ffffff", align: "left", verticalAlign: "top" },
      // shop / show credit
      { id: uid(), type: "text", x: Math.round(W * 0.1), y: Math.round(H * 0.815), width: Math.round(W * 0.82), height: Math.round(H * 0.05), text: "SHOP NAME · BEHIND THE INSTALL", fontSize: Math.round(W * 0.03), fontFamily: "League Spartan", fontStyle: "bold", fill: "#7fd6e5", align: "left", verticalAlign: "top" },
      // logo bug top-left
      { id: uid(), type: "image", x: Math.round(W * 0.04), y: Math.round(H * 0.035), width: bug, height: bug, imageSrc: WRAPTV_BUG_URL },
    ];
    setElements(prev => [...prev, ...stamp]);
    setSelectedId(stamp[2].id);
    toast.success("WrapTV stamp added — edit the song + shop text");
  };

  // ── Add image ──────────────────────────────────────────────────
  const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>, asBg = false) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new window.Image();
      img.onload = () => {
        if (asBg) {
          addElement({
            id: uid(), type: "image",
            x: 0, y: 0, width: canvasWidth, height: canvasHeight,
            imageData: img, imageSrc: reader.result as string, opacity: 0.6,
          });
        } else {
          const aspect = img.width / img.height;
          let w = canvasWidth * 0.7;
          let h = w / aspect;
          if (h > canvasHeight * 0.6) { h = canvasHeight * 0.6; w = h * aspect; }
          addElement({
            id: uid(), type: "image",
            x: (canvasWidth - w) / 2, y: (canvasHeight - h) / 2,
            width: w, height: h, imageData: img, imageSrc: reader.result as string,
          });
        }
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }, [canvasWidth, canvasHeight]);

  // ── Canva template upload ──────────────────────────────────────
  const handleCanvaUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new window.Image();
      img.onload = () => {
        // Set canvas to match image aspect ratio (pick closest format)
        const aspect = img.width / img.height;
        let bestFormat = FORMAT_PRESETS[0];
        let bestDiff = 999;
        for (const f of FORMAT_PRESETS) {
          const diff = Math.abs((f.width / f.height) - aspect);
          if (diff < bestDiff) { bestDiff = diff; bestFormat = f; }
        }
        setCanvasWidth(bestFormat.width);
        setCanvasHeight(bestFormat.height);
        setFormatLabel(bestFormat.label);
        // Add as full-canvas background
        setElements([{
          id: uid(), type: "image",
          x: 0, y: 0, width: bestFormat.width, height: bestFormat.height,
          imageData: img, imageSrc: reader.result as string, opacity: 1,
        }]);
        setSelectedId(null);
        toast.success(`Canva template loaded — matched to ${bestFormat.label}`);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }, []);

  // ── Load template ──────────────────────────────────────────────
  const loadTemplate = (template: TemplatePreset) => {
    const preset = FORMAT_PRESETS.find(f => f.label === template.format);
    if (preset) {
      setCanvasWidth(preset.width);
      setCanvasHeight(preset.height);
      setFormatLabel(template.format);
    }
    setBgColor(BRAND.white);

    const newElements: CanvasElement[] = [];
    for (const layer of template.layers) {
      if (layer.type === "imagePlaceholder") {
        const elId = uid();
        if (layer.imageUrl) {
          const img = new window.Image();
          img.crossOrigin = "anonymous";
          img.onload = () => {
            setElements(prev => prev.map(e => e.id === elId ? {
              ...e, type: "image" as const, imageData: img, imageSrc: layer.imageUrl,
            } : e));
          };
          img.src = layer.imageUrl;
          newElements.push({
            id: elId, type: "image",
            x: layer.x, y: layer.y, width: layer.width, height: layer.height,
            opacity: layer.opacity ?? 1, imageSrc: layer.imageUrl,
          });
        } else {
          newElements.push({
            id: elId, type: "rect",
            x: layer.x, y: layer.y, width: layer.width, height: layer.height,
            fill: "#222222", opacity: layer.opacity ?? 1, cornerRadius: layer.cornerRadius,
          });
        }
      } else if (layer.type === "rect") {
        newElements.push({
          id: uid(), type: "rect",
          x: layer.x, y: layer.y, width: layer.width, height: layer.height,
          fill: layer.fill || BRAND.midGray, opacity: layer.opacity ?? 1, cornerRadius: layer.cornerRadius,
        });
      } else if (layer.type === "text") {
        newElements.push({
          id: uid(), type: "text",
          x: layer.x, y: layer.y, width: layer.width, height: layer.height,
          text: layer.text || "", fontSize: layer.fontSize || 32,
          fontFamily: layer.fontFamily || "Poppins", fontStyle: layer.fontStyle,
          fill: layer.fill2 || BRAND.white, align: layer.align || "left",
          verticalAlign: layer.verticalAlign,
        });
      }
    }
    setElements(newElements);
    setSelectedId(null);
    toast.success(`Loaded template: ${template.name}`);
  };

  // ── Export ──────────────────────────────────────────────────────
  const handleExport = async (exportScale = 1) => {
    if (!stageRef.current) return;
    setSelectedId(null);
    // Wait for ALL Google Fonts (Bebas Neue, Oswald 700, Poppins 700, etc.)
    // to actually finish loading before exporting. Without this, the export
    // can capture the canvas while Konva is still rendering with the browser's
    // fallback font (Arial/serif). That race is why exported PNGs used to
    // come out with inconsistent typography between runs.
    await document.fonts.ready;
    // Let Konva repaint after the selection clear so the transformer border
    // isn't baked into the export.
    await new Promise(r => setTimeout(r, 50));
    const uri = stageRef.current.toDataURL({
      pixelRatio: exportScale / (Math.min(PREVIEW_MAX / canvasWidth, PREVIEW_MAX / canvasHeight)),
      mimeType: "image/png",
    });
    const a = document.createElement("a");
    a.href = uri;
    a.download = `restyleproai-content-${canvasWidth}x${canvasHeight}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast.success(`Exported at ${canvasWidth}×${canvasHeight}`);
  };

  // Load WPW Originals for the chosen music genre (wrap-files/wtw-music/{genre}).
  useEffect(() => {
    const folder = ({ Rap: "rap", Rock: "rock", Alternative: "alternative" } as Record<string, string>)[musicGenre];
    if (!folder) { setMusicList([]); return; }
    supabase.storage.from("wrap-files").list(`wtw-music/${folder}`, { limit: 50, sortBy: { column: "created_at", order: "desc" } })
      .then(({ data }) => {
        setMusicList((data || [])
          .filter((f) => /\.(mp3|wav|m4a|ogg|aac)$/i.test(f.name))
          .map((f) => ({
            name: f.name.replace(/^\d+-/, "").replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "),
            url: supabase.storage.from("wrap-files").getPublicUrl(`wtw-music/${folder}/${f.name}`).data.publicUrl,
          })));
      })
      .catch(() => setMusicList([]));
  }, [musicGenre, musicRefresh]);

  // Add a song to the WPW Originals library for the chosen genre (self-serve).
  const handleMusicUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const folder = ({ Rap: "rap", Rock: "rock", Alternative: "alternative" } as Record<string, string>)[musicGenre];
    if (!folder) { toast.error("Pick a genre first (Rap / Rock / Alternative)"); return; }
    if (!/\.(mp3|wav|m4a|ogg|aac)$/i.test(file.name)) { toast.error("Audio files only (mp3, wav, m4a…)"); return; }
    setUploadingSong(true);
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase();
      const path = `wtw-music/${folder}/${Date.now()}-${safeName}`;
      const { error } = await supabase.storage.from("wrap-files").upload(path, file, { contentType: file.type || "audio/mpeg", upsert: false });
      if (error) { toast.error(`Upload failed: ${error.message}`); return; }
      toast.success(`Added to ${musicGenre} originals`);
      setMusicRefresh((n) => n + 1);
    } finally {
      setUploadingSong(false);
    }
  }, [musicGenre]);

  // When a track is picked, load its duration and reset the trim range.
  useEffect(() => {
    trimPreviewRef.current?.pause();
    if (!musicUrl) { setTrackDur(0); setTrimStart(0); setTrimEnd(0); return; }
    const a = new Audio(musicUrl);
    a.onloadedmetadata = () => {
      const d = Number.isFinite(a.duration) ? a.duration : 0;
      setTrackDur(d); setTrimStart(0); setTrimEnd(d);
    };
  }, [musicUrl]);

  // Preview the trimmed range (plays from trimStart, stops at trimEnd).
  const previewTrim = () => {
    if (!musicUrl) return;
    let a = trimPreviewRef.current;
    if (!a || a.src !== musicUrl) { a = new Audio(musicUrl); trimPreviewRef.current = a; }
    if (!a.paused) { a.pause(); return; }
    a.currentTime = trimStart;
    a.play().catch(() => undefined);
    const stopAt = () => { if (a && a.currentTime >= trimEnd) { a.pause(); a.removeEventListener("timeupdate", stopAt); } };
    a.addEventListener("timeupdate", stopAt);
  };

  // Trim & Save — decode the track, keep [trimStart, trimEnd], re-encode to WAV
  // and upload it as a NEW track in the same genre. Gives you a reusable
  // shortened song (e.g. drop a long intro). Runs entirely in your browser.
  const trimAndSaveTrack = async () => {
    if (!musicUrl) { toast.error("Pick a track first"); return; }
    const folder = ({ Rap: "rap", Rock: "rock", Alternative: "alternative" } as Record<string, string>)[musicGenre];
    if (!folder) { toast.error("Pick a genre first"); return; }
    const start = Math.max(0, trimStart);
    const end = Math.min(trackDur || trimEnd, trimEnd);
    if (end - start < 0.5) { toast.error("Trim range is too short"); return; }
    setTrimming(true);
    try {
      const AC = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
      const ac = new AC();
      const raw = await (await fetch(musicUrl)).arrayBuffer();
      const decoded = await ac.decodeAudioData(raw);
      const sr = decoded.sampleRate;
      const startFrame = Math.floor(start * sr);
      const frames = Math.floor((end - start) * sr);
      const out = ac.createBuffer(decoded.numberOfChannels, frames, sr);
      for (let c = 0; c < decoded.numberOfChannels; c++) {
        out.getChannelData(c).set(decoded.getChannelData(c).subarray(startFrame, startFrame + frames));
      }
      const wav = audioBufferToWavBlob(out);
      const base = (musicList.find((t) => t.url === musicUrl)?.name || "track").replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 40);
      const path = `wtw-music/${folder}/${Date.now()}-${base}-trim.wav`;
      const { error } = await supabase.storage.from("wrap-files").upload(path, wav, { contentType: "audio/wav", upsert: false });
      if (error) { toast.error(`Save failed: ${error.message}`); return; }
      toast.success(`Trimmed track saved (${Math.round(end - start)}s)`);
      setMusicRefresh((n) => n + 1);
    } catch (e) {
      toast.error("Trim failed: " + ((e as Error).message || "unknown"));
    } finally {
      setTrimming(false);
    }
  };

  // ── Export Music Video (BETA) — composite the loaded clip + the WrapTV stamp
  //    (Konva overlay) + the chosen WPW Originals track into a .webm, in-browser
  //    via MediaRecorder. Chrome recommended. Server-side MP4 burn-in is a
  //    separate build. ────────────────────────────────────────────────────────
  const exportMusicVideo = async () => {
    if (!videoUrl) { toast.error("Load a video first — From Library or Upload"); return; }
    if (typeof MediaRecorder === "undefined") { toast.error("Your browser can't record video. Use Chrome."); return; }
    setExportingVideo(true);
    try {
      await document.fonts.ready;
      setSelectedId(null);
      await new Promise((r) => setTimeout(r, 80));
      const W = canvasWidth, H = canvasHeight;

      const vid = document.createElement("video");
      vid.src = videoUrl; vid.crossOrigin = "anonymous"; vid.muted = true; (vid as HTMLVideoElement).playsInline = true;
      await new Promise((res, rej) => { vid.onloadedmetadata = () => res(null); vid.onerror = () => rej(new Error("video load failed")); });

      // Static overlay snapshot of the WrapTV stamp / canvas elements at full res.
      let overlayImg: HTMLImageElement | null = null;
      const ov = stageRef.current?.toDataURL({ pixelRatio: 1 / Math.min(PREVIEW_MAX / W, PREVIEW_MAX / H), mimeType: "image/png" });
      if (ov) overlayImg = await new Promise<HTMLImageElement>((res) => { const i = new Image(); i.onload = () => res(i); i.src = ov; });

      const cnv = document.createElement("canvas"); cnv.width = W; cnv.height = H;
      const ctx = cnv.getContext("2d");
      if (!ctx) throw new Error("no canvas context");

      // Audio: chosen WPW Originals track. Capture the track straight off the
      // <audio> element (its own clock) — NOT via an AudioContext
      // MediaStreamDestination, which resampled and sped it up ("chipmunks").
      let audioEl: HTMLAudioElement | null = null;
      let audioStream: MediaStream | null = null;
      if (musicUrl) {
        try {
          audioEl = new Audio(musicUrl); audioEl.crossOrigin = "anonymous"; audioEl.loop = true;
          const cap = audioEl as unknown as { captureStream?: () => MediaStream; mozCaptureStream?: () => MediaStream };
          if (cap.captureStream) audioStream = cap.captureStream();
          else if (cap.mozCaptureStream) audioStream = cap.mozCaptureStream();
        } catch { audioStream = null; }
      }

      const stream = cnv.captureStream(30);
      if (audioStream) audioStream.getAudioTracks().forEach((t) => stream.addTrack(t));
      const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") ? "video/webm;codecs=vp9,opus"
        : MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus") ? "video/webm;codecs=vp8,opus" : "video/webm";
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      const finished = new Promise<Blob>((res) => { rec.onstop = () => res(new Blob(chunks, { type: "video/webm" })); });

      let raf = 0;
      const draw = () => {
        const va = (vid.videoWidth || W) / (vid.videoHeight || H), ca = W / H;
        let dw = W, dh = H, dx = 0, dy = 0;
        if (va > ca) { dh = H; dw = H * va; dx = (W - dw) / 2; } else { dw = W; dh = W / va; dy = (H - dh) / 2; }
        ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
        try { ctx.drawImage(vid, dx, dy, dw, dh); } catch { /* frame not ready */ }
        if (overlayImg) ctx.drawImage(overlayImg, 0, 0, W, H);
        raf = requestAnimationFrame(draw);
      };

      vid.currentTime = 0;
      await vid.play();
      if (audioEl) { try { await audioEl.play(); } catch { /* autoplay */ } }
      draw();
      rec.start();
      const durMs = Math.min(Number.isFinite(vid.duration) ? vid.duration : 15, 30) * 1000;
      await new Promise((r) => setTimeout(r, durMs));
      rec.stop();
      cancelAnimationFrame(raf);
      vid.pause();
      if (audioEl) audioEl.pause();

      const blob = await finished;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `wraptv-music-video-${W}x${H}.webm`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast.success("Music video exported (.webm)");
    } catch (e) {
      toast.error("Export failed: " + ((e as Error).message || "unknown"));
    } finally {
      setExportingVideo(false);
    }
  };

  // ── Deploy: the hybrid handoff — human-refined canvas → AI deploys it ──
  // One button: the finished canvas is uploaded, a caption is written (AI if
  // the human hasn't), and the post lands in agent_social_posts as
  // 'scheduled' — the content-deploy cron publishes it to Instagram/Facebook
  // at the chosen time. Content Studio = control + refinement; the pipeline
  // does the deploying.
  const [deployOpen, setDeployOpen] = useState(false);
  const [deployPlatform, setDeployPlatform] = useState<"instagram" | "facebook">("instagram");
  const [deployBrand, setDeployBrand] = useState<"restylepro" | "weprintwraps">("restylepro");
  const [deployCaption, setDeployCaption] = useState("");
  const [deployWhen, setDeployWhen] = useState("");
  const [deploying, setDeploying] = useState(false);
  const [writingCaption, setWritingCaption] = useState(false);

  const openDeploy = () => {
    setDeployBrand(cfBrand === "WePrintWraps" ? "weprintwraps" : "restylepro");
    const d = new Date(Date.now() + 24 * 3600_000);
    d.setHours(10, 0, 0, 0);
    // datetime-local wants local time without seconds
    const pad = (n: number) => String(n).padStart(2, "0");
    setDeployWhen(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
    setDeployOpen(true);
  };

  const aiWriteCaption = async () => {
    setWritingCaption(true);
    try {
      const { data, error } = await supabase.functions.invoke("content-studio-ai-copy", {
        body: {
          brand: cfBrand, format: "Post", tone: cfTone,
          context: cfTopic || workTitle || "social post for the design currently on the canvas",
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const caption = [data.hook, data.body, data.cta].filter(Boolean).join("\n\n");
      if (!caption) throw new Error("no caption returned");
      setDeployCaption(caption);
    } catch (e: any) {
      toast.error("AI caption failed: " + (e?.message || e));
    } finally {
      setWritingCaption(false);
    }
  };

  const deployNow = async () => {
    if (!stageRef.current) { toast.error("Canvas not ready"); return; }
    if (!deployCaption.trim()) { toast.error("Add a caption (or let AI write one)"); return; }
    if (!deployWhen) { toast.error("Pick a publish time"); return; }
    setDeploying(true);
    try {
      // Render the finished canvas at 2× (same path as Export 2×).
      setSelectedId(null);
      await document.fonts.ready;
      await new Promise(r => setTimeout(r, 50));
      const uri = stageRef.current.toDataURL({
        pixelRatio: 2 / (Math.min(PREVIEW_MAX / canvasWidth, PREVIEW_MAX / canvasHeight)),
        mimeType: "image/png",
      });
      const blob = await (await fetch(uri)).blob();
      const path = `content-studio-deploys/${Date.now()}-${canvasWidth}x${canvasHeight}.png`;
      const { error: upErr } = await supabase.storage.from("wrap-files")
        .upload(path, blob, { contentType: "image/png", upsert: false });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from("wrap-files").getPublicUrl(path);
      const mediaUrl = urlData.publicUrl;

      const scheduledIso = new Date(deployWhen).toISOString();
      // Content Director is the gate: Studio deploys queue for approval with
      // the chosen datetime as the proposed slot. Approve = scheduled = published.
      const { data: post, error: postErr } = await (supabase as any).from("agent_social_posts").insert({
        brand: deployBrand, platform: deployPlatform, post_type: "static",
        caption: deployCaption.trim(), hashtags: [],
        media_urls: [mediaUrl], status: "needs_review", scheduled_date: scheduledIso,
        created_by: "content-studio",
      }).select("id").single();
      if (postErr) throw postErr;

      // Engine Room card so the team sees it on the board + calendar.
      await (supabase as any).from("slack_agent_tasks").insert({
        brand: deployBrand, task_type: "social_post", status: "completed", priority: "medium",
        title: `Sent to Director from Content Studio: ${(workTitle || deployCaption).slice(0, 60)}`,
        description:
          `Built in Content Studio — awaiting Content Director approval. Proposed ${deployPlatform} slot: ` +
          `${new Date(scheduledIso).toLocaleString()}.\nMedia: ${mediaUrl}\n\n${deployCaption}`,
        created_by: "content-studio",
        metadata: { source: "content-studio", social_post_id: post.id, media_url: mediaUrl },
      });
      await (supabase as any).from("agent_content_calendar").insert({
        brand: deployBrand, content_type: "social_post", date: scheduledIso.slice(0, 10),
        title: `IG/FB: ${(workTitle || deployCaption).slice(0, 50)}`, status: "planned",
        pipeline_table: "agent_social_posts", pipeline_id: post.id,
      });

      toast.success(`Sent to Content Director for approval — proposed ${deployPlatform} slot ${new Date(scheduledIso).toLocaleString()}`);
      setDeployOpen(false);
    } catch (e: any) {
      toast.error("Deploy failed: " + (e?.message || e));
    } finally {
      setDeploying(false);
    }
  };

  // ── Drag handling ──────────────────────────────────────────────
  const handleDragEnd = (id: string, e: Konva.KonvaEventObject<DragEvent>) => {
    updateElement(id, { x: e.target.x(), y: e.target.y() });
  };

  // ── Render ─────────────────────────────────────────────────────
  const templates = buildTemplates();

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied!");
  };

  // ── MOBILE VIEW ──────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div className="light" style={{ minHeight: "100vh", background: "#fafafa", fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif", color: "#111" }}>
        {/* Brand bar */}
        <div style={{ background: "#0A0A0F", borderBottom: "1px solid rgba(56,189,248,0.15)", padding: "8px 12px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1.5, color: "#38BDF8" }}>DesignProAI™</span>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>→</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.6)" }}>Content Studio™</span>
          </div>
          <button onClick={() => navigate("/admin")} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 14px", borderRadius: 6, background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.2)", color: "#38BDF8", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>
            <ArrowLeft size={12} /> Admin
          </button>
        </div>

        {/* Header */}
        <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "12px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#fff", background: "linear-gradient(135deg, #0ea5e9, #3b82f6)", padding: "3px 8px", borderRadius: 6 }}>
                Restyle<span style={{ color: "#bae6fd" }}>ProAI</span>™
              </span>
              <span style={{ fontSize: 16, fontWeight: 800, color: "#111", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Content Studio™</span>
            </div>
            <button
              onClick={saveWork}
              disabled={savingWork}
              style={{
                padding: "6px 12px", borderRadius: 6, fontSize: 11, fontWeight: 700,
                background: savingWork ? "#9ca3af" : "linear-gradient(135deg, #0066cc, #00aaff)",
                border: "none", color: "#fff", cursor: savingWork ? "wait" : "pointer",
                display: "flex", alignItems: "center", gap: 4, flexShrink: 0,
              }}
            >
              <Save size={12} /> {savingWork ? "..." : currentWorkId ? "Update" : "Save"}
            </button>
          </div>
          <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>
            {currentWorkId ? `Editing: ${workTitle}` : "Create + Publish — Mobile"}
          </p>
        </div>

        {/* Mobile tabs: ContentFlow AI + Hooks */}
        <div style={{ padding: "12px" }}>
          <Tabs defaultValue="contentflow" className="w-full">
            <TabsList className="w-full grid grid-cols-5 bg-[#f3f4f6] rounded-lg h-10 mb-3">
              <TabsTrigger value="contentflow" className="text-[10px] px-0 data-[state=active]:bg-white data-[state=active]:text-[#0080dd] rounded-lg">
                <Wand2 className="h-3 w-3 mr-0.5" /> AI
              </TabsTrigger>
              <TabsTrigger value="templates" className="text-[10px] px-0 data-[state=active]:bg-white data-[state=active]:text-[#0080dd] rounded-lg">
                <ImageIcon className="h-3 w-3 mr-0.5" /> Temp
              </TabsTrigger>
              <TabsTrigger value="swatches" className="text-[10px] px-0 data-[state=active]:bg-white data-[state=active]:text-[#0080dd] rounded-lg">
                <Palette className="h-3 w-3 mr-0.5" /> Swat
              </TabsTrigger>
              <TabsTrigger value="works" className="text-[10px] px-0 data-[state=active]:bg-white data-[state=active]:text-[#0080dd] rounded-lg">
                <FolderOpen className="h-3 w-3 mr-0.5" /> Works
              </TabsTrigger>
              <TabsTrigger value="hooks" className="text-[10px] px-0 data-[state=active]:bg-white data-[state=active]:text-[#0080dd] rounded-lg">
                <Zap className="h-3 w-3 mr-0.5" /> Hooks
              </TabsTrigger>
            </TabsList>

            {/* ContentFlow AI */}
            <TabsContent value="contentflow" className="m-0">
              {/* Where this page sits in the suite, then the unattended lane. */}
              <div style={{ marginBottom: 12 }}>
                <MarketingSuiteGuide />
              </div>
              {/* Unattended lane: build what the Content Director asked for. */}
              <div style={{ marginBottom: 12 }}>
                <AutonomousBuildPanel />
              </div>
              <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", padding: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
                  <Wand2 size={16} style={{ color: "#0080dd" }} />
                  <span style={{ fontSize: 15, fontWeight: 700, color: "#111" }}>ContentFlow AI</span>
                </div>
                <p style={{ fontSize: 12, color: "#9ca3af", margin: "0 0 12px 0" }}>Pick an image + generate copy that matches what's in it</p>

                {/* Image picker */}
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 6 }}>Image</label>
                  <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                    <RenderBrowser
                      onSelect={(url, meta) => handleRenderPicked(url, meta)}
                      triggerLabel="From Renders"
                      triggerVariant="outline"
                      triggerSize="sm"
                      triggerClassName="flex-1 text-xs"
                    />
                    <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => cfImageUploadRef.current?.click()}>
                      <Upload className="h-3 w-3 mr-1" /> Upload
                    </Button>
                    <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => setShowLibPicker(v => !v)}>
                      <ImageIcon className="h-3 w-3 mr-1" /> From Library
                    </Button>
                  </div>

                  {/* WrapTV music-video stamp: logo bug + MTV lower-third over the clip */}
                  <button
                    onClick={addWrapTVStamp}
                    style={{ width: "100%", marginBottom: 8, padding: "9px 0", borderRadius: 8, fontSize: 12, fontWeight: 800, letterSpacing: 0.5, background: "linear-gradient(90deg,#17A5BE,#f68d63)", border: "none", color: "#fff", cursor: "pointer" }}
                  >
                    ★ Add WrapTV Stamp (bug + lower-third)
                  </button>

                  {/* WrapTV music-video export: pick a WPW Originals track + render */}
                  {videoUrl && (
                    <div style={{ background: "#05070a", border: "1px solid #17A5BE", borderRadius: 8, padding: 10, marginBottom: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase", color: "#7fd6e5", marginBottom: 6 }}>🎬 Music Video (beta)</div>
                      <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
                        {["Rap", "Rock", "Alternative"].map((g) => (
                          <button key={g} onClick={() => { setMusicGenre(g); setMusicUrl(null); }}
                            style={{ flex: 1, padding: "5px 0", borderRadius: 6, fontSize: 10, fontWeight: 700, border: "none", cursor: "pointer", background: musicGenre === g ? "#17A5BE" : "#1c2329", color: musicGenre === g ? "#fff" : "#8b97a1" }}>{g}</button>
                        ))}
                      </div>
                      {musicGenre && (
                        <>
                          {musicList.length > 0 && (
                            <select value={musicUrl || ""} onChange={(e) => setMusicUrl(e.target.value || null)}
                              style={{ width: "100%", background: "#0c1014", color: "#fff", border: "1px solid #1c2329", borderRadius: 6, padding: "6px 8px", fontSize: 12, marginBottom: 6 }}>
                              <option value="">— pick a track —</option>
                              {musicList.map((t) => <option key={t.url} value={t.url}>{t.name}</option>)}
                            </select>
                          )}
                          <input ref={musicUploadRef} type="file" accept="audio/*,.mp3,.wav,.m4a,.ogg,.aac" className="hidden" onChange={handleMusicUpload} />
                          <button onClick={() => musicUploadRef.current?.click()} disabled={uploadingSong}
                            style={{ width: "100%", padding: "6px 0", borderRadius: 6, fontSize: 11, fontWeight: 700, border: "1px dashed #17A5BE", background: "transparent", color: "#7fd6e5", cursor: uploadingSong ? "wait" : "pointer", marginBottom: 6 }}>
                            {uploadingSong ? "Uploading…" : `＋ Add a song to ${musicGenre}`}
                          </button>
                        </>
                      )}

                      {/* Trim tool — cut the intro / shorten the track, save a new copy */}
                      {musicUrl && trackDur > 0 && (
                        <div style={{ background: "#0c1014", border: "1px solid #1c2329", borderRadius: 6, padding: 8, marginBottom: 6 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#8b97a1", marginBottom: 2 }}>
                            <span>Start {trimStart.toFixed(1)}s</span><span>✂ Trim</span><span>End {trimEnd.toFixed(1)}s</span>
                          </div>
                          <input type="range" min={0} max={trackDur} step={0.1} value={trimStart}
                            onChange={(e) => setTrimStart(Math.min(Number(e.target.value), trimEnd - 0.5))}
                            style={{ width: "100%", accentColor: "#17A5BE" }} />
                          <input type="range" min={0} max={trackDur} step={0.1} value={trimEnd}
                            onChange={(e) => setTrimEnd(Math.max(Number(e.target.value), trimStart + 0.5))}
                            style={{ width: "100%", accentColor: "#f68d63" }} />
                          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                            <button onClick={previewTrim} style={{ flex: 1, padding: "5px 0", borderRadius: 6, fontSize: 11, fontWeight: 700, border: "1px solid #1c2329", background: "#0c1014", color: "#7fd6e5", cursor: "pointer" }}>▶ Preview</button>
                            <button onClick={trimAndSaveTrack} disabled={trimming} style={{ flex: 1, padding: "5px 0", borderRadius: 6, fontSize: 11, fontWeight: 700, border: "none", background: trimming ? "#334155" : "#17A5BE", color: "#fff", cursor: trimming ? "wait" : "pointer" }}>
                              {trimming ? "Saving…" : "✂ Trim & Save"}
                            </button>
                          </div>
                          <div style={{ fontSize: 9, color: "#5b6670", marginTop: 4 }}>Saves a trimmed copy into {musicGenre} originals — then pick it above.</div>
                        </div>
                      )}
                      <button onClick={exportMusicVideo} disabled={exportingVideo}
                        style={{ width: "100%", padding: "9px 0", borderRadius: 8, fontSize: 12, fontWeight: 800, border: "none", cursor: exportingVideo ? "wait" : "pointer", background: exportingVideo ? "#334155" : "linear-gradient(90deg,#f68d63,#e06336)", color: "#fff" }}>
                        {exportingVideo ? "Rendering… (stay on this tab)" : "⬇ Export Music Video (.webm)"}
                      </button>
                      <div style={{ fontSize: 9, color: "#5b6670", marginTop: 5, lineHeight: 1.4 }}>Renders clip + stamp + music in your browser. Use Chrome. Add the WrapTV Stamp first for the bug + lower-third.</div>
                    </div>
                  )}

                  {/* From Library — pick a video or image from THIS brand's library
                      (wrap-files/canva-templates/{brand}); videos load into the reel
                      player, images onto the canvas. */}
                  {showLibPicker && (
                    <div style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 10, padding: 10, marginBottom: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#374151" }}>{BRAND_LABEL[canvaBrandTab] || canvaBrandTab} library</span>
                        <button onClick={() => setShowLibPicker(false)} style={{ border: "none", background: "transparent", cursor: "pointer", color: "#9ca3af", fontSize: 12, fontWeight: 700 }}>✕</button>
                      </div>
                      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                        {(["DesignProAI", "WePrintWraps", "DesignProAI", "WrapTV", "InkAndEdge"] as const).map(b => {
                          const c = canvaTemplates.filter(t => t.brand === b).length;
                          return (
                            <button key={b} onClick={() => setCanvaBrandTab(b)} style={{ flex: 1, padding: "4px 0", borderRadius: 6, fontSize: 10, fontWeight: 700, background: canvaBrandTab === b ? "#0080dd" : "#eef2f7", color: canvaBrandTab === b ? "#fff" : "#6b7280", border: "none", cursor: "pointer" }}>
                              {(BRAND_LABEL[b] || b).replace("™", "")}{c ? ` ${c}` : ""}
                            </button>
                          );
                        })}
                      </div>
                      {(() => {
                        const items = canvaTemplates.filter(t => t.brand === canvaBrandTab);
                        if (!items.length) return <p style={{ fontSize: 11, color: "#9ca3af", textAlign: "center", padding: "10px 0" }}>Nothing in this brand's library yet.</p>;
                        // videos first so a "library of videos" is front and center
                        const sorted = [...items].sort((a, b) => Number(b.isVideo) - Number(a.isVideo));
                        return (
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, maxHeight: 260, overflowY: "auto" }}>
                            {sorted.map(t => (
                              <button key={t.path} onClick={() => { loadCanvaTemplate(t); setShowLibPicker(false); toast.success(t.isVideo ? "Video loaded from library" : "Image loaded from library"); }}
                                style={{ position: "relative", borderRadius: 8, overflow: "hidden", border: "1px solid #e5e7eb", padding: 0, background: "#000", cursor: "pointer", height: 80 }}>
                                {t.isVideo
                                  ? <video src={t.url} muted playsInline preload="metadata" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                  : <img src={t.url} alt={t.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                                {t.isVideo && <span style={{ position: "absolute", bottom: 3, right: 3, background: "rgba(0,0,0,0.75)", color: "#fff", fontSize: 8, fontWeight: 700, padding: "1px 4px", borderRadius: 3 }}>▶ VIDEO</span>}
                              </button>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {/* Pending render preview — choose how to use it */}
                  {pendingRender && (
                    <div style={{ background: "#f0f9ff", border: "2px solid #0080dd", borderRadius: 10, padding: 12, marginBottom: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                        <ImageIcon size={14} style={{ color: "#0080dd" }} />
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#0080dd" }}>How do you want to use this?</span>
                      </div>
                      <img src={pendingRender.url} alt="Preview" style={{ width: "100%", height: 140, objectFit: "cover", borderRadius: 8, border: "1px solid #bae6fd", marginBottom: 8 }} />
                      {pendingRender.meta?.vehicle && (
                        <p style={{ fontSize: 11, color: "#374151", margin: "0 0 8px 0", fontWeight: 600 }}>
                          {pendingRender.meta.vehicle} {pendingRender.meta.view ? `— ${pendingRender.meta.view}` : ""}
                        </p>
                      )}
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <button onClick={confirmAutoCreate} style={{ width: "100%", padding: "10px 0", borderRadius: 8, fontSize: 12, fontWeight: 700, background: "linear-gradient(135deg, #0066cc, #00aaff)", border: "none", color: "#fff", cursor: "pointer" }}>
                          Auto Create — Canvas + AI Copy
                        </button>
                        <button onClick={confirmAiContextOnly} style={{ width: "100%", padding: "10px 0", borderRadius: 8, fontSize: 12, fontWeight: 700, background: "#fff", border: "1px solid #0080dd", color: "#0080dd", cursor: "pointer" }}>
                          AI Context Only — Generate Copy
                        </button>
                        <button onClick={confirmCanvasOnly} style={{ width: "100%", padding: "10px 0", borderRadius: 8, fontSize: 12, fontWeight: 700, background: "#fff", border: "1px solid #6b7280", color: "#374151", cursor: "pointer" }}>
                          Canvas Only — Add Image, No AI
                        </button>
                        <button onClick={downloadPendingRender} style={{ width: "100%", padding: "10px 0", borderRadius: 8, fontSize: 12, fontWeight: 700, background: "#fff", border: "1px solid #10b981", color: "#059669", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                          <Download size={12} /> Download PNG
                        </button>
                        <button onClick={() => setPendingRender(null)} style={{ width: "100%", padding: "6px 0", borderRadius: 8, fontSize: 11, fontWeight: 600, background: "transparent", border: "none", color: "#9ca3af", cursor: "pointer" }}>
                          Skip
                        </button>
                      </div>
                    </div>
                  )}

                  {!pendingRender && (cfImageUrl || cfImageBase64) && (
                    <div style={{ position: "relative", marginBottom: 8 }}>
                      <img src={cfImageUrl || cfImageBase64 || ""} alt="Selected" style={{ width: "100%", height: 160, objectFit: "cover", borderRadius: 8, border: "1px solid #e5e7eb" }} />
                      <button onClick={() => { setCfImageUrl(null); setCfImageBase64(null); setCfImageMode("none"); }} style={{ position: "absolute", top: 6, right: 6, background: "rgba(0,0,0,0.7)", border: "none", borderRadius: 4, padding: "4px 8px", cursor: "pointer", color: "#fff", fontSize: 11, fontWeight: 700 }}>✕</button>
                    </div>
                  )}
                </div>

                {/* Brand / Topic / Format / Tone */}
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 4 }}>Brand</label>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {[["DesignProAI", "DesignProAI™"], ["WePrintWraps", "WePrintWraps.com"], ["DesignProAI", "DesignProAI™"], ["WrapTV", "WrapTV World"], ["InkAndEdge", "Ink & Edge"]].map(([v, label]) => {
                        const c = csBrandColor(v);
                        const on = cfBrand === v;
                        return (
                          <button
                            key={v}
                            onClick={() => setCfBrand(v)}
                            style={{
                              display: "inline-flex", alignItems: "center", gap: 6,
                              padding: "6px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700,
                              background: on ? c : tint(c),
                              color: on ? "#fff" : c,
                              border: on ? `1px solid ${c}` : `1px solid ${tint(c)}`,
                              cursor: "pointer", transition: "all .12s",
                            }}
                          >
                            <span style={{ width: 8, height: 8, borderRadius: 999, background: on ? "#fff" : c, display: "inline-block" }} />
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {cfBrand === "DesignProAI" && (
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 4 }}>
                        Focus on tools {cfFocusTools.length > 0 ? `(${cfFocusTools.length})` : "(all)"}
                      </label>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {TOOL_OPTIONS.map(t => {
                          const c = productMeta(t.value).color;
                          const on = cfFocusTools.includes(t.value);
                          return (
                            <button
                              key={t.value}
                              onClick={() => toggleTool(t.value)}
                              style={{
                                padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                                background: on ? c : tint(c),
                                color: on ? "#fff" : c,
                                border: "none", cursor: "pointer",
                              }}
                            >
                              {t.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 4 }}>What's the post about?</label>
                    <Input className="h-9 text-sm" placeholder="fleet wrap, before & after..." value={cfTopic} onChange={e => setCfTopic(e.target.value)} />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 4 }}>Format</label>
                      <Select value={cfFormat} onValueChange={handleCfFormatChange}>
                        <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="post">Post</SelectItem>
                          <SelectItem value="reel">Reel</SelectItem>
                          <SelectItem value="carousel">Carousel</SelectItem>
                          <SelectItem value="story">Story</SelectItem>
                          <SelectItem value="youtube">YouTube</SelectItem>
                          <SelectItem value="ad">Ad</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 4 }}>Tone</label>
                      <Select value={cfTone} onValueChange={setCfTone}>
                        <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Hype/Launch">Hype / Launch</SelectItem>
                          <SelectItem value="Educational">Educational</SelectItem>
                          <SelectItem value="Social Proof">Social Proof</SelectItem>
                          <SelectItem value="Behind The Scenes">BTS</SelectItem>
                          <SelectItem value="Promo/Sale">Promo / Sale</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {cfBrand === "DesignProAI" && (
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 4 }}>Hook</label>
                      <Select value={cfHookType} onValueChange={setCfHookType}>
                        <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {HOOK_TYPE_OPTIONS.map(h => (
                            <SelectItem key={h.value} value={h.value} className="text-sm">{h.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {brandHooks.length > 0 && (
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 4 }}>Saved hook (Hooks Manager)</label>
                      <select value={cfSavedHook} onChange={(e) => setCfSavedHook(e.target.value)}
                        style={{ width: "100%", height: 36, borderRadius: 6, border: "1px solid #e5e7eb", padding: "0 8px", fontSize: 13, color: "#111", background: "#fff" }}>
                        <option value="">— none (AI writes the hook) —</option>
                        {brandHooks.map(h => (<option key={h.id} value={h.text}>{h.text.length > 64 ? h.text.slice(0, 64) + "…" : h.text}</option>))}
                      </select>
                    </div>
                  )}
                </div>

                <button
                  onClick={handleGenerate}
                  disabled={cfGenerating}
                  style={{
                    width: "100%", padding: "12px 0", borderRadius: 8, fontSize: 14, fontWeight: 700,
                    background: "linear-gradient(135deg, #0066cc, #00aaff, #0080dd)",
                    border: "none", color: "#fff", cursor: cfGenerating ? "wait" : "pointer",
                    marginTop: 12, opacity: cfGenerating ? 0.7 : 1,
                  }}
                >
                  {cfGenerating ? "Generating..." : (cfImageUrl || cfImageBase64) ? "Generate AI Copy from Image" : "Generate Content"}
                </button>

                {/* Results */}
                {cfResult && (
                  <div style={{ background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0", padding: 14, marginTop: 12 }}>
                    {(["hook", "headline", "body", "cta"] as const).map(field => (
                      <div key={field} style={{ marginBottom: field === "cta" ? 0 : 14 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#0080dd", textTransform: "uppercase", letterSpacing: 1 }}>{field}</span>
                          <button onClick={() => copyToClipboard(cfResult[field])} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
                            <Copy size={14} style={{ color: "#9ca3af" }} />
                          </button>
                        </div>
                        <p style={{ fontSize: 13, color: "#374151", margin: 0, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{cfResult[field]}</p>
                      </div>
                    ))}
                    <p style={{ fontSize: 11, color: "#9ca3af", textAlign: "center", marginTop: 12 }}>
                      Tap any field to copy. Switch to the Templates tab to upload Canva templates and tap Rewrite for Brand.
                    </p>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Templates (mobile) — upload, view, rewrite */}
            <TabsContent value="templates" className="m-0">
              <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", padding: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
                  <ImageIcon size={16} style={{ color: "#0080dd" }} />
                  <span style={{ fontSize: 15, fontWeight: 700, color: "#111" }}>Canva Templates</span>
                </div>
                <p style={{ fontSize: 12, color: "#9ca3af", margin: "0 0 12px 0" }}>Upload a template, then tap Rewrite to swap the text for your brand + tool focus. The AI saves a new variant.</p>

                {/* Brand tabs — with a live asset count so you can see which
                    brand has library assets (e.g. "WePrintWraps (33)"). */}
                <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                  {(["DesignProAI", "WePrintWraps", "DesignProAI", "WrapTV", "InkAndEdge"] as const).map(b => {
                    const count = canvaTemplates.filter(t => t.brand === b).length;
                    return (
                    <button
                      key={b}
                      onClick={() => setCanvaBrandTab(b)}
                      style={{
                        flex: 1, padding: "6px 0", borderRadius: 6, fontSize: 11, fontWeight: 700,
                        background: canvaBrandTab === b ? "#0080dd" : "#f3f4f6",
                        color: canvaBrandTab === b ? "#fff" : "#6b7280",
                        border: "none", cursor: "pointer",
                      }}
                    >
                      {BRAND_LABEL[b] || b}{count > 0 ? ` (${count})` : ""}
                    </button>
                  ); })}
                </div>

                {/* Content type + upload */}
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", display: "block", marginBottom: 4 }}>Upload as</label>
                  <Select value={canvaUploadType} onValueChange={(v) => setCanvaUploadType(v as CanvaTemplateType)}>
                    <SelectTrigger className="h-9 text-sm mb-2"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CONTENT_TYPES.map(ct => (
                        <SelectItem key={ct.value} value={ct.value} className="text-sm">{ct.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <button
                    onClick={() => canvaUploadRef.current?.click()}
                    disabled={canvaUploading}
                    style={{
                      width: "100%", padding: "10px 0", borderRadius: 8, fontSize: 13, fontWeight: 700,
                      background: canvaUploading ? "#9ca3af" : "linear-gradient(135deg, #0066cc, #00aaff)",
                      border: "none", color: "#fff", cursor: canvaUploading ? "wait" : "pointer",
                    }}
                  >
                    {canvaUploading ? "Uploading..." : "Upload Template(s) — Multi OK"}
                  </button>
                  <input
                    ref={canvaUploadRef}
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      const files = Array.from(e.target.files || []);
                      if (files.length > 0) uploadCanvaToLibrary(files);
                      e.target.value = "";
                    }}
                  />
                  <p style={{ fontSize: 10, color: "#9ca3af", marginTop: 4, textAlign: "center" }}>Images (PNG, JPG) or video (MP4, MOV, WebM)</p>
                </div>

                {/* Focus tool reminder */}
                {cfBrand === "DesignProAI" && cfFocusTools.length === 0 && (
                  <p style={{ fontSize: 10, color: "#f59e0b", textAlign: "center", padding: "6px 0", background: "#fffbeb", borderRadius: 6, marginBottom: 10 }}>
                    Tip: pick a focus tool in the AI tab first (ColorPro / GraphicsPro / PatternPro)
                  </p>
                )}

                {/* Past templates */}
                {(() => {
                  const brandTemplates = canvaTemplates.filter(t => t.brand === canvaBrandTab);
                  if (brandTemplates.length === 0) {
                    return (
                      <p style={{ fontSize: 12, color: "#9ca3af", textAlign: "center", padding: "16px 0" }}>
                        No {BRAND_LABEL[canvaBrandTab] || canvaBrandTab} templates yet. Upload one above.
                      </p>
                    );
                  }
                  const grouped: Record<string, CanvaTemplate[]> = {};
                  for (const t of brandTemplates) {
                    if (!grouped[t.contentType]) grouped[t.contentType] = [];
                    grouped[t.contentType].push(t);
                  }
                  // Honor product order: 4:5 → reel → carousel → 1:1 → story → 9:16 → 16:9
                  const orderedTypes = CONTENT_TYPES.map(ct => ct.value).filter(v => grouped[v]?.length);
                  return orderedTypes.map((type) => {
                    const tpls = grouped[type];
                    const typeLabel = CONTENT_TYPES.find(ct => ct.value === type)?.label || type;
                    return (
                      <div key={type} style={{ marginBottom: 14 }}>
                        <p style={{ fontSize: 11, fontWeight: 700, color: "#0080dd", marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>
                          {typeLabel} ({tpls.length})
                        </p>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                          {tpls.map(t => (
                            <div key={t.path} style={{ position: "relative", borderRadius: 8, overflow: "hidden", border: "1px solid #e5e7eb", background: "#fff" }}>
                              {/* Tap the preview to load the template onto the canvas */}
                              <button
                                onClick={() => loadCanvaTemplate(t)}
                                style={{ display: "block", width: "100%", padding: 0, border: "none", background: "transparent", cursor: "pointer" }}
                                aria-label={`Load template ${t.name}`}
                              >
                                {t.isVideo ? (
                                  <div style={{ position: "relative", width: "100%", height: 120, background: "#000" }}>
                                    <video
                                      src={t.url}
                                      muted
                                      playsInline
                                      preload="metadata"
                                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                    />
                                    <span style={{ position: "absolute", bottom: 4, right: 4, background: "rgba(0,0,0,0.75)", color: "#fff", fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 3 }}>VIDEO</span>
                                  </div>
                                ) : (
                                  <img src={t.url} alt={t.name} style={{ width: "100%", height: 120, objectFit: "cover" }} />
                                )}
                              </button>
                              <div style={{ padding: "4px 6px" }}>
                                <p style={{ fontSize: 10, fontWeight: 600, color: "#374151", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</p>
                              </div>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
                                <button
                                  onClick={() => loadCanvaTemplate(t)}
                                  style={{
                                    padding: "7px 0", borderRadius: 0, border: "none",
                                    background: "linear-gradient(135deg, #0066cc, #00aaff)",
                                    color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer",
                                  }}
                                >
                                  Load
                                </button>
                                <button
                                  onClick={() => rewriteTemplate(t)}
                                  disabled={!!rewritingTemplate || t.isVideo}
                                  style={{
                                    padding: "7px 0", borderRadius: 0, border: "none",
                                    background: (rewritingTemplate === t.url || t.isVideo) ? "#9ca3af" : "#0a0a0f",
                                    color: "#fff", fontSize: 11, fontWeight: 700, cursor: (rewritingTemplate || t.isVideo) ? "not-allowed" : "pointer",
                                  }}
                                  title={t.isVideo ? "Rewrite only works on static images" : "AI rewrite for your brand"}
                                >
                                  {rewritingTemplate === t.url ? "..." : "Rewrite"}
                                </button>
                              </div>
                              <button
                                onClick={() => deleteCanvaTemplate(t.path)}
                                style={{ position: "absolute", top: 4, right: 4, background: "rgba(0,0,0,0.6)", border: "none", borderRadius: 4, padding: "2px 6px", cursor: "pointer", color: "#fff", fontSize: 10, fontWeight: 700 }}
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  });
                })()}

                {/* Rewrite result (text replacements) */}
                {rewriteResult && Array.isArray(rewriteResult.replacements) && rewriteResult.replacements.length > 0 && (
                  <div style={{ background: "#f0fdf4", borderRadius: 10, border: "1px solid #bbf7d0", padding: 12, marginTop: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                      <Sparkles size={14} style={{ color: "#16a34a" }} />
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#16a34a" }}>Replacement Copy</span>
                    </div>
                    {rewriteResult.replacements.map((r: any, i: number) => (
                      <div key={i} style={{ marginBottom: 10, paddingBottom: 8, borderBottom: i < rewriteResult.replacements.length - 1 ? "1px solid #dcfce7" : "none" }}>
                        <p style={{ fontSize: 10, color: "#9ca3af", margin: 0 }}>Was: {r.original}</p>
                        <p style={{ fontSize: 13, color: "#111", fontWeight: 600, margin: "2px 0 0 0" }}>{r.replacement}</p>
                        <button
                          onClick={() => copyToClipboard(r.replacement)}
                          style={{ marginTop: 4, padding: "3px 8px", fontSize: 10, fontWeight: 700, background: "#16a34a", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}
                        >
                          Copy
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>

            {/* ColorPro Swatches — drop onto canvas (mobile) */}
            <TabsContent value="swatches" className="m-0">
              <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", padding: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <Palette size={16} style={{ color: "#0080dd" }} />
                  <span style={{ fontSize: 15, fontWeight: 700, color: "#111" }}>ColorPro Swatches</span>
                </div>
                <p style={{ fontSize: 11, color: "#9ca3af", margin: "0 0 10px 0" }}>
                  Tap any swatch to drop it on the canvas, then drag to position.
                </p>
                <Input
                  value={swatchSearch}
                  onChange={(e) => setSwatchSearch(e.target.value)}
                  placeholder="Search swatches..."
                  className="h-9 text-sm mb-2"
                />
                <Select value={swatchManufacturer} onValueChange={setSwatchManufacturer}>
                  <SelectTrigger className="h-9 text-sm mb-2"><SelectValue placeholder="All manufacturers" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-sm">All manufacturers ({swatches.length})</SelectItem>
                    {swatchManufacturers.map((m) => (
                      <SelectItem key={m} value={m} className="text-sm">{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {swatchesLoading ? (
                  <p style={{ fontSize: 12, color: "#9ca3af", textAlign: "center", padding: "16px 0" }}>Loading swatches...</p>
                ) : filteredSwatches.length === 0 ? (
                  <p style={{ fontSize: 12, color: "#9ca3af", textAlign: "center", padding: "16px 0" }}>
                    No swatches match your filter.
                  </p>
                ) : (
                  // ColorPro-style white cards: image on top, bold uppercase name + code below
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                    {filteredSwatches.slice(0, 200).map((s) => (
                      <button
                        key={s.id}
                        onClick={() => addSwatchToCanvas(s)}
                        title={`${s.manufacturer} — ${s.name}`}
                        style={{
                          display: "block",
                          width: "100%",
                          padding: 0,
                          borderRadius: 10,
                          overflow: "hidden",
                          border: "1px solid #d4d4d8",
                          background: "#fff",
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        <div style={{
                          width: "100%",
                          aspectRatio: "4 / 3",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          overflow: "hidden",
                          background: "#e4e4e7",
                        }}>
                          {s.imageUrl ? (
                            <img
                              src={s.imageUrl}
                              alt={s.name}
                              style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scale(1.05)" }}
                              loading="lazy"
                              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                            />
                          ) : (
                            <div style={{
                              width: "80%",
                              height: "80%",
                              borderRadius: 6,
                              background: s.hex || "#e4e4e7",
                              backgroundImage: "linear-gradient(135deg, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0.15) 25%, transparent 50%, rgba(0,0,0,0.1) 75%, rgba(0,0,0,0.2) 100%)",
                            }} />
                          )}
                        </div>
                        <div style={{ padding: "6px 8px", background: "#fff" }}>
                          <p style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color: "#000",
                            textTransform: "uppercase",
                            letterSpacing: 0.3,
                            lineHeight: 1.2,
                            margin: 0,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            minHeight: "1.25rem",
                          }}>
                            {s.name}
                          </p>
                          <p style={{
                            fontSize: 9,
                            fontWeight: 500,
                            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                            color: "#71717a",
                            margin: "2px 0 0 0",
                          }}>
                            {s.code || s.finish || s.manufacturer}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {filteredSwatches.length > 200 && (
                  <p style={{ fontSize: 10, color: "#9ca3af", textAlign: "center", marginTop: 6 }}>
                    Showing first 200 of {filteredSwatches.length} — filter to see more
                  </p>
                )}
              </div>
            </TabsContent>

            {/* My Works — saved canvas drafts */}
            <TabsContent value="works" className="m-0">
              <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", padding: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <FolderOpen size={16} style={{ color: "#0080dd" }} />
                  <span style={{ fontSize: 15, fontWeight: 700, color: "#111" }}>My Works</span>
                </div>
                <p style={{ fontSize: 12, color: "#9ca3af", margin: "0 0 10px 0" }}>Saved canvas drafts — tap to reopen</p>

                {/* Title + Save + New */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
                  <Input
                    value={workTitle}
                    onChange={e => setWorkTitle(e.target.value)}
                    placeholder="Work title"
                    className="h-9 text-sm"
                  />
                  <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 6 }}>
                    <button
                      onClick={saveWork}
                      disabled={savingWork}
                      style={{
                        padding: "9px 0", borderRadius: 8, fontSize: 12, fontWeight: 700,
                        background: savingWork ? "#9ca3af" : "linear-gradient(135deg, #0066cc, #00aaff)",
                        border: "none", color: "#fff", cursor: savingWork ? "wait" : "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                      }}
                    >
                      <Save size={13} /> {savingWork ? "Saving..." : currentWorkId ? "Update" : "Save Work"}
                    </button>
                    <button
                      onClick={newWork}
                      style={{
                        padding: "9px 0", borderRadius: 8, fontSize: 12, fontWeight: 700,
                        background: "#fff", border: "1px solid #d1d5db", color: "#374151", cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                      }}
                    >
                      <FilePlus size={13} /> New
                    </button>
                  </div>
                </div>

                {worksLoading ? (
                  <p style={{ fontSize: 12, color: "#9ca3af", textAlign: "center", padding: "16px 0" }}>Loading...</p>
                ) : works.length === 0 ? (
                  <p style={{ fontSize: 12, color: "#9ca3af", textAlign: "center", padding: "16px 0" }}>
                    No saved works yet. Create a composition and tap Save Work.
                  </p>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {works.map(w => (
                      <div key={w.id} style={{ position: "relative", borderRadius: 8, overflow: "hidden", border: currentWorkId === w.id ? "2px solid #0080dd" : "1px solid #e5e7eb", background: "#fff" }}>
                        <button
                          onClick={() => loadWork(w)}
                          style={{ display: "block", width: "100%", padding: 0, border: "none", background: "transparent", cursor: "pointer" }}
                        >
                          {w.thumbnail_url ? (
                            <img src={w.thumbnail_url} alt={w.title} style={{ width: "100%", height: 120, objectFit: "cover", background: "#f3f4f6" }} />
                          ) : (
                            <div style={{ width: "100%", height: 120, background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center", color: "#9ca3af", fontSize: 11 }}>No preview</div>
                          )}
                        </button>
                        <div style={{ padding: "6px 8px" }}>
                          <p style={{ fontSize: 11, fontWeight: 600, color: "#111", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.title}</p>
                          <p style={{ fontSize: 9, color: "#9ca3af", margin: "2px 0 0 0" }}>{w.format_label || ""}</p>
                        </div>
                        <button
                          onClick={() => deleteWork(w)}
                          style={{ position: "absolute", top: 4, right: 4, background: "rgba(0,0,0,0.6)", border: "none", borderRadius: 4, padding: "2px 6px", cursor: "pointer", color: "#fff", fontSize: 10, fontWeight: 700 }}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Hooks Library + Content Packs */}
            <TabsContent value="hooks" className="m-0">
              {/* Content Packs — complete sets, one-click apply */}
              <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", padding: 16, marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <Zap size={16} style={{ color: "#0080dd" }} />
                  <span style={{ fontSize: 15, fontWeight: 700, color: "#111" }}>Content Packs</span>
                </div>
                <p style={{ fontSize: 11, color: "#9ca3af", margin: "0 0 10px 0" }}>Pre-written sets — tap to fill all fields at once</p>
                {PACK_STYLES.map(style => (
                  <div key={style} style={{ marginBottom: 12 }}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: "#0080dd", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>{style}</p>
                    {CONTENT_PACKS.filter(p => p.style === style).map(pack => (
                      <button
                        key={pack.id}
                        onClick={() => {
                          setCfResult({ hook: pack.headline, headline: pack.body.split("\n")[0], body: pack.body, cta: pack.cta });
                          toast.success(`"${pack.headline}" loaded — tap Apply to Canvas`);
                        }}
                        style={{
                          width: "100%", textAlign: "left", padding: "8px 10px", borderRadius: 8,
                          background: "#f7f8fa", border: "1px solid #e5e7eb", cursor: "pointer",
                          marginBottom: 4, transition: "border-color 0.15s",
                        }}
                      >
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#111" }}>{pack.headline}</div>
                        <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2, lineHeight: 1.4, whiteSpace: "pre-line" }}>{pack.body.split("\n").slice(0, 2).join("\n")}{pack.body.split("\n").length > 2 ? "..." : ""}</div>
                        {pack.tool && <span style={{ fontSize: 9, color: "#0080dd", fontWeight: 700, marginTop: 2, display: "inline-block" }}>{pack.tool}</span>}
                      </button>
                    ))}
                  </div>
                ))}
              </div>

              {/* Hooks Library */}
              <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", padding: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
                  <BookOpen size={16} style={{ color: "#0080dd" }} />
                  <span style={{ fontSize: 15, fontWeight: 700, color: "#111" }}>Hooks Library</span>
                </div>
                <p style={{ fontSize: 12, color: "#9ca3af", margin: "0 0 12px 0" }}>
                  {cfBrand}'s saved hooks (Hooks Manager · /admin/hooks) — tap any hook to copy it
                </p>
                {brandHookGroups.length === 0 && (
                  <p style={{ fontSize: 12, color: "#6b7280" }}>
                    No hooks saved for {cfBrand} yet — add them in the Hooks Manager.
                  </p>
                )}
                {brandHookGroups.map(([category, hooks]) => (
                  <div key={category} style={{ marginBottom: 16 }}>
                    <p style={{ fontSize: 12, fontWeight: 700, color: "#0080dd", marginBottom: 6 }}>{category}</p>
                    {hooks.map(hook => (
                      <button
                        key={hook}
                        onClick={() => { copyToClipboard(hook); toast.success("Copied!"); }}
                        style={{
                          width: "100%", textAlign: "left", padding: "8px 10px", borderRadius: 6,
                          background: "transparent", border: "none", cursor: "pointer",
                          fontSize: 13, color: "#374151", transition: "background 0.15s",
                        }}
                      >
                        {hook}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <input ref={cfImageUploadRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleCfImageUpload} />
      </div>
    );
  }

  // ── DESKTOP VIEW ──────────────────────────────────────────────────
  return (
    <div className="light" style={{ minHeight: "100vh", background: "#fafafa", fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif", color: "#111" }}>
      {/* ── BRAND BAR ──────────────────────────────────────── */}
      <div style={{
        background: "#0A0A0F",
        borderBottom: "1px solid rgba(56,189,248,0.15)",
        padding: "8px 12px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1.5, color: "#38BDF8" }}>DesignProAI™</span>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>→</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.6)" }}>Content Studio™</span>
        </div>
        <button
          onClick={() => navigate("/admin")}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "5px 14px", borderRadius: 6,
            background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.2)",
            color: "#38BDF8", cursor: "pointer", fontSize: 11, fontWeight: 600,
            transition: "all 0.2s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(56,189,248,0.2)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(56,189,248,0.1)"; }}
        >
          ← Admin Panel
        </button>
      </div>

      {/* ── HEADER ──────────────────────────────────────────── */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "12px" }}>
        <div style={{ maxWidth: 1400, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#fff", background: "linear-gradient(135deg, #0ea5e9, #3b82f6)", padding: "3px 10px", borderRadius: 6, letterSpacing: 0.5 }}>
                Restyle<span style={{ color: "#bae6fd" }}>ProAI</span>™
              </span>
              <span style={{ fontSize: 13, color: "#d1d5db" }}>|</span>
              <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: 0.5, color: "#111" }}>Content Studio™</span>
            </div>
            <p style={{ fontSize: 13, color: "#9ca3af", marginTop: 2 }}>Create + Publish</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Link
              to="/admin/social-batch"
              style={{ fontSize: 12, fontWeight: 700, color: "#fff", background: "#0A0A0A", padding: "6px 12px", borderRadius: 6, textDecoration: "none", letterSpacing: 0.3 }}
              title="Generate 20 publish-ready posts at once from a template"
            >
              ⚡ Batch 20
            </Link>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", background: "#f3f4f6", padding: "4px 10px", borderRadius: 6, border: "1px solid #e5e7eb" }}>
              {canvasWidth}×{canvasHeight}
            </span>
            {currentWorkId && (
              <span style={{ fontSize: 11, fontWeight: 600, color: "#0080dd", background: "rgba(0,128,221,0.08)", padding: "4px 8px", borderRadius: 6, border: "1px solid rgba(0,128,221,0.2)" }}>
                Editing: {workTitle}
              </span>
            )}
            <button
              onClick={saveWork}
              disabled={savingWork}
              title={currentWorkId ? "Update this work" : "Save as new work"}
              style={{
                padding: "6px 16px", borderRadius: 6, fontSize: 12, fontWeight: 600,
                background: savingWork ? "#9ca3af" : "#fff", border: "1px solid #0080dd",
                color: "#0080dd", cursor: savingWork ? "wait" : "pointer",
                display: "flex", alignItems: "center", gap: 4, transition: "all 0.2s",
              }}
              onMouseEnter={(e) => { if (!savingWork) e.currentTarget.style.background = "rgba(0,128,221,0.05)"; }}
              onMouseLeave={(e) => { if (!savingWork) e.currentTarget.style.background = "#fff"; }}
            >
              <Save size={14} /> {savingWork ? "Saving..." : currentWorkId ? "Update" : "Save Work"}
            </button>
            <button
              onClick={() => handleExport(1)}
              style={{
                padding: "6px 16px", borderRadius: 6, fontSize: 12, fontWeight: 600,
                background: "#fff", border: "1px solid #e5e7eb", color: "#374151",
                cursor: "pointer", display: "flex", alignItems: "center", gap: 4, transition: "all 0.2s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#38BDF8"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#e5e7eb"; }}
            >
              <Download size={14} /> Export PNG
            </button>
            <button
              onClick={() => handleExport(2)}
              style={{
                padding: "6px 16px", borderRadius: 6, fontSize: 12, fontWeight: 600,
                background: "linear-gradient(135deg, #0066cc, #00aaff, #0080dd)",
                border: "none", color: "#fff", cursor: "pointer",
                display: "flex", alignItems: "center", gap: 4, transition: "all 0.2s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.boxShadow = "0 0 20px rgba(0,140,255,0.5)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "none"; }}
            >
              <Download size={14} /> Export 2×
            </button>
            <button
              onClick={openDeploy}
              style={{
                padding: "6px 16px", borderRadius: 6, fontSize: 12, fontWeight: 700,
                background: "linear-gradient(135deg, #3b82f6, #ec4899)",
                border: "none", color: "#fff", cursor: "pointer",
                display: "flex", alignItems: "center", gap: 4, transition: "all 0.2s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.boxShadow = "0 0 20px rgba(236,72,153,0.5)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "none"; }}
            >
              🚀 Deploy
            </button>
          </div>
        </div>

        {/* Deploy dialog — the hybrid handoff to the AI pipeline */}
        {deployOpen && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}
            onClick={() => !deploying && setDeployOpen(false)}>
            <div style={{ background: "#fff", borderRadius: 12, padding: 20, width: 440, maxWidth: "92vw" }} onClick={(e) => e.stopPropagation()}>
              <h3 style={{ fontSize: 15, fontWeight: 800, color: "#111", marginBottom: 4 }}>🚀 Deploy this design</h3>
              <p style={{ fontSize: 11, color: "#6b7280", marginBottom: 12 }}>
                The canvas is uploaded as the post image and publishes automatically at the time you pick. It also lands on the Engine Room board + calendar.
              </p>
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <select value={deployBrand} onChange={(e) => setDeployBrand(e.target.value as any)}
                  style={{ flex: 1, fontSize: 12, padding: "8px", borderRadius: 6, border: "1px solid #e5e7eb" }}>
                  <option value="restylepro">DesignProAI account</option>
                  <option value="weprintwraps">WePrintWraps account</option>
                </select>
                <select value={deployPlatform} onChange={(e) => setDeployPlatform(e.target.value as any)}
                  style={{ flex: 1, fontSize: 12, padding: "8px", borderRadius: 6, border: "1px solid #e5e7eb" }}>
                  <option value="instagram">Instagram</option>
                  <option value="facebook">Facebook</option>
                </select>
              </div>
              <input type="datetime-local" value={deployWhen} onChange={(e) => setDeployWhen(e.target.value)}
                style={{ width: "100%", fontSize: 12, padding: "8px", borderRadius: 6, border: "1px solid #e5e7eb", marginBottom: 10 }} />
              <textarea value={deployCaption} onChange={(e) => setDeployCaption(e.target.value)}
                placeholder="Caption — write your own or let AI draft it, then edit"
                rows={5}
                style={{ width: "100%", fontSize: 12, padding: "8px", borderRadius: 6, border: "1px solid #e5e7eb", marginBottom: 10, resize: "vertical" }} />
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={aiWriteCaption} disabled={writingCaption}
                  style={{ padding: "8px 14px", borderRadius: 6, fontSize: 12, fontWeight: 600, background: "#fff", border: "1px solid #e5e7eb", color: "#374151", cursor: "pointer" }}>
                  {writingCaption ? "Writing…" : "✨ AI write caption"}
                </button>
                <button onClick={deployNow} disabled={deploying}
                  style={{ padding: "8px 18px", borderRadius: 6, fontSize: 12, fontWeight: 700, background: deploying ? "#9ca3af" : "linear-gradient(135deg, #3b82f6, #ec4899)", border: "none", color: "#fff", cursor: deploying ? "wait" : "pointer" }}>
                  {deploying ? "Deploying…" : "Deploy"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── MAIN CONTENT ──────────────────────────────────── */}
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "16px", display: "flex", gap: 16, minHeight: "calc(100vh - 120px)" }}>

        {/* ── LEFT PANEL ──────────────────────────────────── */}
        <div style={{ width: 300, flexShrink: 0 }}>
          <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", overflow: "hidden" }}>
            <Tabs defaultValue="contentflow" className="w-full" onValueChange={(v) => {
              // Canva thumbnail links are short-lived signed URLs — refetch the
              // design list every time the Canva Templates panel is opened so
              // the grid always shows live thumbnails, never expired ones.
              if (v === "canva" && canvaAcct?.connected) {
                if (canvaListMode === "starred") loadCanvaStarredList({ autoRun: true });
                else loadCanvaDesigns(canvaDesignSearch);
              }
            }}>
              <TabsList className="w-full grid grid-cols-8 bg-[#f3f4f6] rounded-none border-b border-[#e5e7eb] h-10">
                <TabsTrigger value="contentflow" className="text-[10px] px-0 data-[state=active]:bg-white data-[state=active]:text-[#0080dd] data-[state=active]:shadow-sm rounded-none" title="ContentFlow AI"><Wand2 className="h-3.5 w-3.5" /></TabsTrigger>
                <TabsTrigger value="templates" className="text-[10px] px-0 data-[state=active]:bg-white data-[state=active]:text-[#0080dd] data-[state=active]:shadow-sm rounded-none" title="Layout Templates"><LayoutGrid className="h-3.5 w-3.5" /></TabsTrigger>
                <TabsTrigger value="elements" className="text-[10px] px-0 data-[state=active]:bg-white data-[state=active]:text-[#0080dd] data-[state=active]:shadow-sm rounded-none" title="Elements"><Type className="h-3.5 w-3.5" /></TabsTrigger>
                <TabsTrigger value="swatches" className="text-[10px] px-0 data-[state=active]:bg-white data-[state=active]:text-[#0080dd] data-[state=active]:shadow-sm rounded-none" title="ColorPro Swatches"><Palette className="h-3.5 w-3.5" /></TabsTrigger>
                <TabsTrigger value="works" className="text-[10px] px-0 data-[state=active]:bg-white data-[state=active]:text-[#0080dd] data-[state=active]:shadow-sm rounded-none" title="My Works"><FolderOpen className="h-3.5 w-3.5" /></TabsTrigger>
                <TabsTrigger value="hooks" className="text-[10px] px-0 data-[state=active]:bg-white data-[state=active]:text-[#0080dd] data-[state=active]:shadow-sm rounded-none" title="Hooks Library"><Zap className="h-3.5 w-3.5" /></TabsTrigger>
                <TabsTrigger value="brand" className="text-[10px] px-0 data-[state=active]:bg-white data-[state=active]:text-[#0080dd] data-[state=active]:shadow-sm rounded-none" title="Brand"><FileImage className="h-3.5 w-3.5" /></TabsTrigger>
                <TabsTrigger value="canva" className="text-[10px] px-0 data-[state=active]:bg-white data-[state=active]:text-[#0080dd] data-[state=active]:shadow-sm rounded-none" title="Canva Templates"><BookOpen className="h-3.5 w-3.5" /></TabsTrigger>
              </TabsList>

              {/* ── ContentFlow AI Generate ────────────────── */}
              <TabsContent value="contentflow" className="m-0">
                <ScrollArea className="h-[calc(100vh-220px)]">
                  <div className="p-3 space-y-3">
                    {/* Unattended lane: build what the Content Director asked for. */}
                    <AutonomousBuildPanel />
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <Wand2 size={14} style={{ color: "#0080dd" }} />
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#111" }}>ContentFlow AI</span>
                    </div>
                    <p style={{ fontSize: 11, color: "#9ca3af", margin: 0 }}>Pick an image + generate copy that matches what's in it</p>

                    {/* Image picker */}
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 4 }}>Image</label>
                      <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
                        <RenderBrowser
                          onSelect={(url, meta) => handleRenderPicked(url, meta)}
                          triggerLabel="From Renders"
                          triggerVariant="outline"
                          triggerSize="sm"
                          triggerClassName="flex-1 text-xs h-7"
                        />
                        <Button size="sm" variant="outline" className="flex-1 text-xs h-7" onClick={() => cfImageUploadRef.current?.click()}>
                          <Upload className="h-3 w-3 mr-1" /> Upload
                        </Button>
                        <input ref={cfImageUploadRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleCfImageUpload} />
                      </div>
                      <Button size="sm" variant="outline" className="w-full text-xs h-7" style={{ marginBottom: 8 }} onClick={() => setShowLibPicker(v => !v)}>
                        <ImageIcon className="h-3 w-3 mr-1" /> From Library
                      </Button>

                      {/* WrapTV music-video stamp: logo bug + MTV lower-third over the clip */}
                      <button
                        onClick={addWrapTVStamp}
                        style={{ width: "100%", marginBottom: 8, padding: "9px 0", borderRadius: 8, fontSize: 12, fontWeight: 800, letterSpacing: 0.5, background: "linear-gradient(90deg,#17A5BE,#f68d63)", border: "none", color: "#fff", cursor: "pointer" }}
                      >
                        ★ Add WrapTV Stamp (bug + lower-third)
                      </button>

                      {/* WrapTV music-video export: pick a WPW Originals track + render */}
                      {videoUrl && (
                        <div style={{ background: "#05070a", border: "1px solid #17A5BE", borderRadius: 8, padding: 10, marginBottom: 10 }}>
                          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase", color: "#7fd6e5", marginBottom: 6 }}>🎬 Music Video (beta)</div>
                          <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
                            {["Rap", "Rock", "Alternative"].map((g) => (
                              <button key={g} onClick={() => { setMusicGenre(g); setMusicUrl(null); }}
                                style={{ flex: 1, padding: "5px 0", borderRadius: 6, fontSize: 10, fontWeight: 700, border: "none", cursor: "pointer", background: musicGenre === g ? "#17A5BE" : "#1c2329", color: musicGenre === g ? "#fff" : "#8b97a1" }}>{g}</button>
                            ))}
                          </div>
                          {musicGenre && (
                            <>
                              {musicList.length > 0 && (
                                <select value={musicUrl || ""} onChange={(e) => setMusicUrl(e.target.value || null)}
                                  style={{ width: "100%", background: "#0c1014", color: "#fff", border: "1px solid #1c2329", borderRadius: 6, padding: "6px 8px", fontSize: 12, marginBottom: 6 }}>
                                  <option value="">— pick a track —</option>
                                  {musicList.map((t) => <option key={t.url} value={t.url}>{t.name}</option>)}
                                </select>
                              )}
                              <input ref={musicUploadRef} type="file" accept="audio/*,.mp3,.wav,.m4a,.ogg,.aac" className="hidden" onChange={handleMusicUpload} />
                              <button onClick={() => musicUploadRef.current?.click()} disabled={uploadingSong}
                                style={{ width: "100%", padding: "6px 0", borderRadius: 6, fontSize: 11, fontWeight: 700, border: "1px dashed #17A5BE", background: "transparent", color: "#7fd6e5", cursor: uploadingSong ? "wait" : "pointer", marginBottom: 6 }}>
                                {uploadingSong ? "Uploading…" : `＋ Add a song to ${musicGenre}`}
                              </button>
                            </>
                          )}

                          {/* Trim tool — cut the intro / shorten the track, save a new copy */}
                          {musicUrl && trackDur > 0 && (
                            <div style={{ background: "#0c1014", border: "1px solid #1c2329", borderRadius: 6, padding: 8, marginBottom: 6 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#8b97a1", marginBottom: 2 }}>
                                <span>Start {trimStart.toFixed(1)}s</span><span>✂ Trim</span><span>End {trimEnd.toFixed(1)}s</span>
                              </div>
                              <input type="range" min={0} max={trackDur} step={0.1} value={trimStart}
                                onChange={(e) => setTrimStart(Math.min(Number(e.target.value), trimEnd - 0.5))}
                                style={{ width: "100%", accentColor: "#17A5BE" }} />
                              <input type="range" min={0} max={trackDur} step={0.1} value={trimEnd}
                                onChange={(e) => setTrimEnd(Math.max(Number(e.target.value), trimStart + 0.5))}
                                style={{ width: "100%", accentColor: "#f68d63" }} />
                              <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                                <button onClick={previewTrim} style={{ flex: 1, padding: "5px 0", borderRadius: 6, fontSize: 11, fontWeight: 700, border: "1px solid #1c2329", background: "#0c1014", color: "#7fd6e5", cursor: "pointer" }}>▶ Preview</button>
                                <button onClick={trimAndSaveTrack} disabled={trimming} style={{ flex: 1, padding: "5px 0", borderRadius: 6, fontSize: 11, fontWeight: 700, border: "none", background: trimming ? "#334155" : "#17A5BE", color: "#fff", cursor: trimming ? "wait" : "pointer" }}>
                                  {trimming ? "Saving…" : "✂ Trim & Save"}
                                </button>
                              </div>
                              <div style={{ fontSize: 9, color: "#5b6670", marginTop: 4 }}>Saves a trimmed copy into {musicGenre} originals — then pick it above.</div>
                            </div>
                          )}
                          <button onClick={exportMusicVideo} disabled={exportingVideo}
                            style={{ width: "100%", padding: "9px 0", borderRadius: 8, fontSize: 12, fontWeight: 800, border: "none", cursor: exportingVideo ? "wait" : "pointer", background: exportingVideo ? "#334155" : "linear-gradient(90deg,#f68d63,#e06336)", color: "#fff" }}>
                            {exportingVideo ? "Rendering… (stay on this tab)" : "⬇ Export Music Video (.webm)"}
                          </button>
                          <div style={{ fontSize: 9, color: "#5b6670", marginTop: 5, lineHeight: 1.4 }}>Renders clip + stamp + music in your browser. Use Chrome. Add the WrapTV Stamp first for the bug + lower-third.</div>
                        </div>
                      )}

                      {/* From Library — pick a video or image from THIS brand's library
                          (wrap-files/canva-templates/{brand}); videos load into the reel
                          player, images onto the canvas. */}
                      {showLibPicker && (
                        <div style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 10, padding: 10, marginBottom: 10 }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: "#374151" }}>{BRAND_LABEL[canvaBrandTab] || canvaBrandTab} library</span>
                            <button onClick={() => setShowLibPicker(false)} style={{ border: "none", background: "transparent", cursor: "pointer", color: "#9ca3af", fontSize: 12, fontWeight: 700 }}>✕</button>
                          </div>
                          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                            {(["DesignProAI", "WePrintWraps", "DesignProAI", "WrapTV", "InkAndEdge"] as const).map(b => {
                              const c = canvaTemplates.filter(t => t.brand === b).length;
                              return (
                                <button key={b} onClick={() => setCanvaBrandTab(b)} style={{ flex: 1, padding: "4px 0", borderRadius: 6, fontSize: 10, fontWeight: 700, background: canvaBrandTab === b ? "#0080dd" : "#eef2f7", color: canvaBrandTab === b ? "#fff" : "#6b7280", border: "none", cursor: "pointer" }}>
                                  {(BRAND_LABEL[b] || b).replace("™", "")}{c ? ` ${c}` : ""}
                                </button>
                              );
                            })}
                          </div>
                          {(() => {
                            const items = canvaTemplates.filter(t => t.brand === canvaBrandTab);
                            if (!items.length) return <p style={{ fontSize: 11, color: "#9ca3af", textAlign: "center", padding: "10px 0" }}>Nothing in this brand's library yet.</p>;
                            // videos first so a "library of videos" is front and center
                            const sorted = [...items].sort((a, b) => Number(b.isVideo) - Number(a.isVideo));
                            return (
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, maxHeight: 260, overflowY: "auto" }}>
                                {sorted.map(t => (
                                  <button key={t.path} onClick={() => { loadCanvaTemplate(t); setShowLibPicker(false); toast.success(t.isVideo ? "Video loaded from library" : "Image loaded from library"); }}
                                    style={{ position: "relative", borderRadius: 8, overflow: "hidden", border: "1px solid #e5e7eb", padding: 0, background: "#000", cursor: "pointer", height: 80 }}>
                                    {t.isVideo
                                      ? <video src={t.url} muted playsInline preload="metadata" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                      : <img src={t.url} alt={t.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                                    {t.isVideo && <span style={{ position: "absolute", bottom: 3, right: 3, background: "rgba(0,0,0,0.75)", color: "#fff", fontSize: 8, fontWeight: 700, padding: "1px 4px", borderRadius: 3 }}>▶ VIDEO</span>}
                                  </button>
                                ))}
                              </div>
                            );
                          })()}
                        </div>
                      )}

                      {/* ── Pending render preview — choose how to use it ── */}
                      {pendingRender && (
                        <div style={{ background: "#f0f9ff", border: "2px solid #0080dd", borderRadius: 10, padding: 10, marginBottom: 8 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                            <ImageIcon size={12} style={{ color: "#0080dd" }} />
                            <span style={{ fontSize: 11, fontWeight: 700, color: "#0080dd" }}>Preview — How do you want to use this?</span>
                          </div>
                          <img
                            src={pendingRender.url}
                            alt="Preview"
                            style={{ width: "100%", height: 100, objectFit: "cover", borderRadius: 6, border: "1px solid #bae6fd", marginBottom: 8 }}
                          />
                          {pendingRender.meta?.vehicle && (
                            <p style={{ fontSize: 10, color: "#374151", margin: "0 0 6px 0", fontWeight: 600 }}>
                              {pendingRender.meta.vehicle} {pendingRender.meta.view ? `— ${pendingRender.meta.view}` : ""}
                            </p>
                          )}
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            <button onClick={confirmAutoCreate} style={{ width: "100%", padding: "6px 0", borderRadius: 6, fontSize: 10, fontWeight: 700, background: "linear-gradient(135deg, #0066cc, #00aaff)", border: "none", color: "#fff", cursor: "pointer" }}>
                              Auto Create — Place on Canvas + AI Context
                            </button>
                            <button onClick={confirmAiContextOnly} style={{ width: "100%", padding: "6px 0", borderRadius: 6, fontSize: 10, fontWeight: 700, background: "#fff", border: "1px solid #0080dd", color: "#0080dd", cursor: "pointer" }}>
                              AI Context Only — Generate Copy to Match
                            </button>
                            <button onClick={confirmCanvasOnly} style={{ width: "100%", padding: "6px 0", borderRadius: 6, fontSize: 10, fontWeight: 700, background: "#fff", border: "1px solid #6b7280", color: "#374151", cursor: "pointer" }}>
                              Canvas Only — Add Image, No AI
                            </button>
                            <button onClick={downloadPendingRender} style={{ width: "100%", padding: "6px 0", borderRadius: 6, fontSize: 10, fontWeight: 700, background: "#fff", border: "1px solid #10b981", color: "#059669", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                              <Download size={10} /> Download PNG
                            </button>
                            <button onClick={() => setPendingRender(null)} style={{ width: "100%", padding: "4px 0", borderRadius: 6, fontSize: 10, fontWeight: 600, background: "transparent", border: "none", color: "#9ca3af", cursor: "pointer" }}>
                              Skip
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Currently selected image */}
                      {!pendingRender && (cfImageUrl || cfImageBase64) && (
                        <div style={{ position: "relative", marginBottom: 6 }}>
                          <img
                            src={cfImageUrl || cfImageBase64 || ""}
                            alt="Selected"
                            style={{ width: "100%", height: 120, objectFit: "cover", borderRadius: 8, border: "1px solid #e5e7eb" }}
                          />
                          <button
                            onClick={() => { setCfImageUrl(null); setCfImageBase64(null); setCfImageMode("none"); }}
                            style={{
                              position: "absolute", top: 4, right: 4, background: "rgba(0,0,0,0.7)",
                              border: "none", borderRadius: 4, padding: "2px 6px", cursor: "pointer",
                              color: "#fff", fontSize: 10, fontWeight: 700,
                            }}
                          >
                            ✕
                          </button>
                          <span style={{
                            position: "absolute", bottom: 4, left: 4, background: "rgba(0,128,221,0.9)",
                            color: "#fff", fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
                          }}>
                            {cfImageMode === "render" ? "FROM RENDERS" : "UPLOADED"}
                          </span>
                        </div>
                      )}
                    </div>

                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 4 }}>Brand</label>
                      <Select value={cfBrand} onValueChange={setCfBrand}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="DesignProAI" className="text-xs">DesignProAI™</SelectItem>
                          <SelectItem value="WePrintWraps" className="text-xs">WePrintWraps.com</SelectItem>
                          <SelectItem value="DesignProAI" className="text-xs">DesignProAI™</SelectItem>
                          <SelectItem value="WrapTV" className="text-xs">WrapTV World</SelectItem>
                          <SelectItem value="InkAndEdge" className="text-xs">Ink & Edge Magazine</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {cfBrand === "DesignProAI" && (
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 4 }}>
                          Focus on tools {cfFocusTools.length > 0 ? `(${cfFocusTools.length})` : "(all)"}
                        </label>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                          {TOOL_OPTIONS.map(t => (
                            <button
                              key={t.value}
                              onClick={() => toggleTool(t.value)}
                              style={{
                                padding: "3px 7px", borderRadius: 4, fontSize: 9, fontWeight: 600,
                                background: cfFocusTools.includes(t.value) ? "#0080dd" : "#f3f4f6",
                                color: cfFocusTools.includes(t.value) ? "#fff" : "#6b7280",
                                border: "none", cursor: "pointer", transition: "all 0.15s",
                              }}
                            >
                              {t.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 4 }}>What's the post about?</label>
                      <Input
                        className="h-8 text-xs"
                        placeholder="fleet wrap we just finished, before & after..."
                        value={cfTopic}
                        onChange={e => setCfTopic(e.target.value)}
                      />
                    </div>

                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 4 }}>Format</label>
                      <Select value={cfFormat} onValueChange={handleCfFormatChange}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="post" className="text-xs">Post</SelectItem>
                          <SelectItem value="reel" className="text-xs">Reel</SelectItem>
                          <SelectItem value="carousel" className="text-xs">Carousel</SelectItem>
                          <SelectItem value="story" className="text-xs">Story</SelectItem>
                          <SelectItem value="youtube" className="text-xs">YouTube</SelectItem>
                          <SelectItem value="ad" className="text-xs">Ad</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 4 }}>Tone</label>
                      <Select value={cfTone} onValueChange={setCfTone}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Hype/Launch" className="text-xs">Hype / Launch</SelectItem>
                          <SelectItem value="Educational" className="text-xs">Educational</SelectItem>
                          <SelectItem value="Social Proof" className="text-xs">Social Proof</SelectItem>
                          <SelectItem value="Behind The Scenes" className="text-xs">Behind The Scenes</SelectItem>
                          <SelectItem value="Promo/Sale" className="text-xs">Promo / Sale</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {cfBrand === "DesignProAI" && (
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 4 }}>Hook</label>
                        <Select value={cfHookType} onValueChange={setCfHookType}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {HOOK_TYPE_OPTIONS.map(h => (
                              <SelectItem key={h.value} value={h.value} className="text-xs">{h.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    {brandHooks.length > 0 && (
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 4 }}>Saved hook (Hooks Manager)</label>
                        <select value={cfSavedHook} onChange={(e) => setCfSavedHook(e.target.value)}
                          style={{ width: "100%", height: 32, borderRadius: 6, border: "1px solid #e5e7eb", padding: "0 8px", fontSize: 12, color: "#111", background: "#fff" }}>
                          <option value="">— none (AI writes the hook) —</option>
                          {brandHooks.map(h => (<option key={h.id} value={h.text}>{h.text.length > 64 ? h.text.slice(0, 64) + "…" : h.text}</option>))}
                        </select>
                      </div>
                    )}

                    <button
                      onClick={handleGenerate}
                      disabled={cfGenerating}
                      style={{
                        width: "100%", padding: "10px 0", borderRadius: 8, fontSize: 13, fontWeight: 700,
                        background: "linear-gradient(135deg, #0066cc, #00aaff, #0080dd)",
                        border: "none", color: "#fff", cursor: cfGenerating ? "wait" : "pointer",
                        transition: "all 0.2s", opacity: cfGenerating ? 0.7 : 1,
                      }}
                      onMouseEnter={(e) => { if (!cfGenerating) e.currentTarget.style.boxShadow = "0 0 20px rgba(0,140,255,0.5)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "none"; }}
                    >
                      {cfGenerating ? "Generating..." : (cfImageUrl || cfImageBase64) ? "Generate AI Copy from Image" : "Generate Content"}
                    </button>

                    {/* 🧠 Marketing brain — three copy angles, tap to choose */}
                    <button
                      onClick={generateCopyVariants}
                      disabled={variantsLoading}
                      style={{
                        width: "100%", padding: "9px 0", borderRadius: 8, fontSize: 12, fontWeight: 800,
                        background: variantsLoading ? "#374151" : "linear-gradient(135deg, #7c3aed, #ec4899)",
                        border: "none", color: "#fff", cursor: variantsLoading ? "wait" : "pointer", marginTop: 6,
                      }}
                    >
                      {variantsLoading ? "Thinking…" : "🧠 Show 3 Copy Options"}
                    </button>
                    {copyVariants.length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                        {copyVariants.map((v, i) => (
                          <button
                            key={i}
                            onClick={() => {
                              setCfResult(applyTypographicPipeline({ hook: v.hook, headline: v.headline, body: v.body, cta: v.cta } as any));
                              toast.success(`"${v.angle || `Option ${i + 1}`}" loaded — Render to Template to bake it in.`);
                            }}
                            style={{
                              textAlign: "left", background: "#faf5ff", border: "1px solid #ddd6fe", borderRadius: 8,
                              padding: "8px 10px", cursor: "pointer",
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#7c3aed"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#ddd6fe"; }}
                          >
                            <span style={{ fontSize: 9, fontWeight: 800, color: "#7c3aed", textTransform: "uppercase", letterSpacing: 1 }}>
                              {v.angle || `Option ${i + 1}`}
                            </span>
                            <p style={{ fontSize: 12, fontWeight: 700, color: "#111", margin: "3px 0 1px" }}>{v.hook}</p>
                            <p style={{ fontSize: 10.5, color: "#6b7280", margin: 0 }}>{v.headline}</p>
                          </button>
                        ))}
                        <p style={{ fontSize: 9, color: "#9ca3af", margin: 0 }}>
                          Tap an option to load it below, then push Render to Template. 🧠 again = 3 fresh angles.
                        </p>
                      </div>
                    )}

                    {cfResult && (
                      <div style={{ background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0", padding: 12, marginTop: 8 }}>
                        {(["hook", "headline", "body", "cta"] as const).map(field => (
                          <div key={field} style={{ marginBottom: field === "cta" ? 0 : 12 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                              <span style={{ fontSize: 10, fontWeight: 700, color: "#0080dd", textTransform: "uppercase", letterSpacing: 1 }}>{field}</span>
                              <button onClick={() => copyToClipboard(cfResult[field])} style={{ background: "none", border: "none", cursor: "pointer", padding: 2 }}>
                                <Copy size={12} style={{ color: "#9ca3af" }} />
                              </button>
                            </div>
                            <p style={{ fontSize: 12, color: "#374151", margin: 0, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{cfResult[field]}</p>
                          </div>
                        ))}
                        {/* Render to Template — bakes text into image with matching fonts */}
                        {elements.some(e => e.type === "image") && (
                          <button
                            onClick={renderToTemplate}
                            disabled={isRendering}
                            style={{
                              width: "100%", marginTop: 12, padding: "10px 0", borderRadius: 6,
                              fontSize: 12, fontWeight: 700,
                              background: isRendering ? "#374151" : "linear-gradient(135deg, #0066cc, #8B5CF6)",
                              border: "none", color: "#fff",
                              cursor: isRendering ? "wait" : "pointer", transition: "all 0.2s",
                            }}
                          >
                            {isRendering ? "Rendering..." : "Render to Template — Match Fonts"}
                          </button>
                        )}
                        <button
                          onClick={applyContentToCanvas}
                          style={{
                            width: "100%", marginTop: 6, padding: "8px 0", borderRadius: 6,
                            fontSize: 12, fontWeight: 700, background: "#0A0A0F",
                            border: "1px solid rgba(56,189,248,0.3)", color: "#38BDF8",
                            cursor: "pointer", transition: "all 0.2s",
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(56,189,248,0.1)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = "#0A0A0F"; }}
                        >
                          Apply to Canvas (Overlay)
                        </button>
                        <button
                          onClick={buildCanvaDesign}
                          disabled={buildingCanva}
                          title="Autofill this brand's mapped Canva Brand Template with the copy above (set templates at /admin/marketing-agent)"
                          style={{
                            width: "100%", marginTop: 6, padding: "8px 0", borderRadius: 6,
                            fontSize: 12, fontWeight: 700,
                            background: buildingCanva ? "#374151" : "linear-gradient(135deg, #7c3aed, #ec4899)",
                            border: "none", color: "#fff",
                            cursor: buildingCanva ? "wait" : "pointer", transition: "all 0.2s",
                          }}
                        >
                          {buildingCanva ? "Building in Canva…" : "🎨 Build real Canva design"}
                        </button>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>

              {/* ── Templates ────────────────────────────────── */}
              <TabsContent value="templates" className="m-0">
                <ScrollArea className="h-[calc(100vh-220px)]">
                  <div className="p-3 space-y-2">
                    <p style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 4 }}>Format</p>
                    <Select value={formatLabel} onValueChange={handleFormatChange}>
                      <SelectTrigger className="text-xs h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["Posts", "Reels & Stories", "Carousels", "Ads & Video"].map(cat => (
                          <div key={cat}>
                            <div style={{ padding: "4px 8px", fontSize: 9, fontWeight: 800, color: "#0080dd", textTransform: "uppercase", letterSpacing: 1.5, borderTop: "1px solid #f0f0f0", marginTop: 2 }}>{cat}</div>
                            {FORMAT_PRESETS.filter(f => f.category === cat).map(f => (
                              <SelectItem key={f.label} value={f.label} className="text-xs">{f.label}</SelectItem>
                            ))}
                          </div>
                        ))}
                      </SelectContent>
                    </Select>

                    {/* Current canvas size indicator */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 0" }}>
                      <span style={{ fontSize: 10, color: "#9ca3af" }}>{canvasWidth} x {canvasHeight}px</span>
                      <span style={{ fontSize: 9, fontWeight: 600, color: "#0080dd", background: "rgba(0,128,221,0.08)", padding: "1px 6px", borderRadius: 4 }}>
                        {FORMAT_PRESETS.find(f => f.label === formatLabel)?.category || "Custom"}
                      </span>
                    </div>

                    <p style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", marginTop: 8, marginBottom: 4 }}>Templates for {formatLabel}</p>
                    {templates.filter(t => t.format === formatLabel).length === 0 && (
                      <p style={{ fontSize: 11, color: "#9ca3af", fontStyle: "italic" }}>No templates for this format yet. Choose a different format or start from scratch.</p>
                    )}
                    {templates.filter(t => t.format === formatLabel).map((t, i) => (
                      <button
                        key={i}
                        onClick={() => loadTemplate(t)}
                        style={{
                          width: "100%", textAlign: "left", padding: "8px 10px", borderRadius: 8,
                          border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer",
                          transition: "all 0.2s", display: "block", marginBottom: 4,
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#38BDF8"; e.currentTarget.style.background = "rgba(56,189,248,0.03)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#e5e7eb"; e.currentTarget.style.background = "#fff"; }}
                      >
                        <p style={{ fontSize: 13, fontWeight: 600, color: "#111", margin: 0 }}>{t.name}</p>
                        <p style={{ fontSize: 11, color: "#9ca3af", margin: "2px 0 0 0" }}>{t.description}</p>
                        <span style={{ fontSize: 10, fontWeight: 600, color: "#0080dd", background: "rgba(0,128,221,0.08)", padding: "2px 6px", borderRadius: 4, marginTop: 4, display: "inline-block" }}>{t.format}</span>
                      </button>
                    ))}

                    {/* Show other templates below */}
                    {templates.filter(t => t.format !== formatLabel).length > 0 && (
                      <>
                        <p style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", marginTop: 16, marginBottom: 4, borderTop: "1px solid #e5e7eb", paddingTop: 8 }}>Other Formats</p>
                        {templates.filter(t => t.format !== formatLabel).map((t, i) => (
                          <button
                            key={`other-${i}`}
                            onClick={() => loadTemplate(t)}
                            style={{
                              width: "100%", textAlign: "left", padding: "8px 10px", borderRadius: 8,
                              border: "1px solid #f0f0f0", background: "#fafafa", cursor: "pointer",
                              transition: "all 0.2s", display: "block", marginBottom: 4, opacity: 0.7,
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#38BDF8"; e.currentTarget.style.opacity = "1"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#f0f0f0"; e.currentTarget.style.opacity = "0.7"; }}
                          >
                            <p style={{ fontSize: 12, fontWeight: 600, color: "#374151", margin: 0 }}>{t.name}</p>
                            <p style={{ fontSize: 10, color: "#9ca3af", margin: "2px 0 0 0" }}>{t.description}</p>
                            <span style={{ fontSize: 9, fontWeight: 600, color: "#6b7280", background: "#e5e7eb", padding: "2px 6px", borderRadius: 4, marginTop: 4, display: "inline-block" }}>{t.format}</span>
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>

              {/* ── Elements ─────────────────────────────────── */}
              <TabsContent value="elements" className="m-0">
                <ScrollArea className="h-[calc(100vh-220px)]">
                  <div className="p-3 space-y-2">
                    <p style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 4 }}>Add Elements</p>
                    <Button size="sm" variant="outline" className="w-full justify-start gap-2 text-xs h-8" onClick={() => addText()}>
                      <Type className="h-3.5 w-3.5" /> Add Text
                    </Button>
                    <Button size="sm" variant="outline" className="w-full justify-start gap-2 text-xs h-8" onClick={() => addRect()}>
                      <Layers className="h-3.5 w-3.5" /> Add Rectangle
                    </Button>
                    <Button size="sm" variant="outline" className="w-full justify-start gap-2 text-xs h-8" onClick={() => fileInputRef.current?.click()}>
                      <ImageIcon className="h-3.5 w-3.5" /> Upload Image
                    </Button>
                    <Button size="sm" variant="outline" className="w-full justify-start gap-2 text-xs h-8" onClick={() => bgFileInputRef.current?.click()}>
                      <Upload className="h-3.5 w-3.5" /> Add Background Image
                    </Button>
                    <RenderBrowser
                      onSelect={(url) => {
                        const img = new window.Image();
                        img.crossOrigin = "anonymous";
                        img.onload = () => {
                          const aspect = img.width / img.height;
                          let w = canvasWidth * 0.7;
                          let h = w / aspect;
                          if (h > canvasHeight * 0.6) { h = canvasHeight * 0.6; w = h * aspect; }
                          addElement({ id: uid(), type: "image", x: (canvasWidth - w) / 2, y: (canvasHeight - h) / 2, width: w, height: h, imageData: img, imageSrc: url });
                        };
                        img.src = url;
                      }}
                      triggerLabel="From Renders"
                      triggerVariant="outline"
                      triggerSize="sm"
                      triggerClassName="w-full justify-start gap-2 text-xs h-8"
                    />
                    <UploadedAssetsBrowser
                      onSelect={(url) => {
                        const img = new window.Image();
                        img.crossOrigin = "anonymous";
                        img.onload = () => {
                          const aspect = img.width / img.height;
                          let w = canvasWidth * 0.7;
                          let h = w / aspect;
                          if (h > canvasHeight * 0.6) { h = canvasHeight * 0.6; w = h * aspect; }
                          addElement({ id: uid(), type: "image", x: (canvasWidth - w) / 2, y: (canvasHeight - h) / 2, width: w, height: h, imageData: img, imageSrc: url });
                        };
                        img.src = url;
                      }}
                      triggerLabel="From Uploads"
                      triggerVariant="outline"
                      triggerSize="sm"
                      triggerClassName="w-full justify-start gap-2 text-xs h-8"
                    />
                    <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleImageUpload(e, false)} />
                    <input ref={bgFileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleImageUpload(e, true)} />

                    <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 8, marginTop: 8 }} />
                    <p style={{ fontSize: 11, fontWeight: 700, color: "#6b7280" }}>Quick Text Presets</p>
                    <Button size="sm" variant="ghost" className="w-full justify-start text-xs h-7" onClick={() => addText("DesignProAI™", { fontSize: 36, fontFamily: "Poppins", fill: BRAND.cyan })}>Brand Name (Cyan)</Button>
                    <Button size="sm" variant="ghost" className="w-full justify-start text-xs h-7" onClick={() => addText("TRY IT FREE →", { fontSize: 28, fontFamily: "Poppins", fill: BRAND.black, y: canvasHeight - 120 })}>CTA Button Text</Button>
                    <Button size="sm" variant="ghost" className="w-full justify-start text-xs h-7" onClick={() => addText("DesignProAI.com", { fontSize: 20, fontFamily: "Inter", fill: "#888888", y: canvasHeight - 60 })}>Website URL</Button>
                    <Button size="sm" variant="ghost" className="w-full justify-start text-xs h-7" onClick={() => addText("@RestyleProAI", { fontSize: 18, fontFamily: "Inter", fill: "#666666", y: canvasHeight - 50 })}>Social Handle</Button>

                    <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 8, marginTop: 8 }} />
                    <p style={{ fontSize: 11, fontWeight: 700, color: "#6b7280" }}>Quick Shapes</p>
                    <Button size="sm" variant="ghost" className="w-full justify-start text-xs h-7" onClick={() => addRect({ width: canvasWidth, height: 70, x: 0, y: canvasHeight - 70, fill: BRAND.cyan, cornerRadius: 0 })}>CTA Bar (Bottom)</Button>
                    <Button size="sm" variant="ghost" className="w-full justify-start text-xs h-7" onClick={() => addRect({ width: canvasWidth, height: 6, x: 0, y: canvasHeight / 2, fill: BRAND.cyan, cornerRadius: 0 })}>Divider Line</Button>
                    <Button size="sm" variant="ghost" className="w-full justify-start text-xs h-7" onClick={() => addRect({ width: canvasWidth, height: canvasHeight, x: 0, y: 0, fill: BRAND.black, opacity: 0.5 })}>Dark Overlay</Button>
                  </div>
                </ScrollArea>
              </TabsContent>

              {/* ── ColorPro Swatches — drop onto canvas ──────── */}
              <TabsContent value="swatches" className="m-0">
                <ScrollArea className="h-[calc(100vh-220px)]">
                  <div className="p-3 space-y-3">
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <Palette size={14} style={{ color: "#0080dd" }} />
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#111" }}>ColorPro Swatches</span>
                    </div>
                    <p style={{ fontSize: 10, color: "#9ca3af" }}>
                      Click any swatch to drop it onto the canvas. Drag to reposition, resize with corner handles.
                    </p>

                    <Input
                      value={swatchSearch}
                      onChange={(e) => setSwatchSearch(e.target.value)}
                      placeholder="Search by name, code, manufacturer..."
                      className="h-8 text-xs"
                    />

                    <Select value={swatchManufacturer} onValueChange={setSwatchManufacturer}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="All manufacturers" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all" className="text-xs">All manufacturers ({swatches.length})</SelectItem>
                        {swatchManufacturers.map((m) => (
                          <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {swatchesLoading ? (
                      <p style={{ fontSize: 11, color: "#9ca3af", textAlign: "center", padding: "16px 0" }}>Loading swatches...</p>
                    ) : filteredSwatches.length === 0 ? (
                      <p style={{ fontSize: 11, color: "#9ca3af", textAlign: "center", padding: "16px 0" }}>
                        No swatches match your filter.
                      </p>
                    ) : (
                      // ColorPro-style white swatch cards: image on top, bold name + code below
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        {filteredSwatches.slice(0, 300).map((s) => (
                          <button
                            key={s.id}
                            onClick={() => addSwatchToCanvas(s)}
                            title={`${s.manufacturer} — ${s.name}${s.code ? ` (${s.code})` : ""}${s.finish ? ` — ${s.finish}` : ""}`}
                            style={{
                              display: "block",
                              width: "100%",
                              padding: 0,
                              borderRadius: 10,
                              overflow: "hidden",
                              border: "1px solid #d4d4d8",
                              background: "#fff",
                              cursor: "pointer",
                              textAlign: "left",
                              transition: "all 0.15s",
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#00C7FF"; e.currentTarget.style.boxShadow = "0 0 0 2px rgba(0,199,255,0.25)"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#d4d4d8"; e.currentTarget.style.boxShadow = "none"; }}
                          >
                            {/* Top: swatch image (or hex fallback) — 4:3 aspect */}
                            <div style={{
                              width: "100%",
                              aspectRatio: "4 / 3",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              overflow: "hidden",
                              background: "#e4e4e7",
                            }}>
                              {s.imageUrl ? (
                                <img
                                  src={s.imageUrl}
                                  alt={s.name}
                                  style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scale(1.05)" }}
                                  loading="lazy"
                                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                                />
                              ) : (
                                <div style={{
                                  width: "80%",
                                  height: "80%",
                                  borderRadius: 6,
                                  background: s.hex || "#e4e4e7",
                                  backgroundImage: "linear-gradient(135deg, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0.15) 25%, transparent 50%, rgba(0,0,0,0.1) 75%, rgba(0,0,0,0.2) 100%)",
                                }} />
                              )}
                            </div>
                            {/* Bottom: white info strip */}
                            <div style={{ padding: "6px 8px", background: "#fff" }}>
                              <p style={{
                                fontSize: 10,
                                fontWeight: 700,
                                color: "#000",
                                textTransform: "uppercase",
                                letterSpacing: 0.3,
                                lineHeight: 1.2,
                                margin: 0,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                display: "-webkit-box",
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: "vertical",
                                minHeight: "1.25rem",
                              }}>
                                {s.name}
                              </p>
                              <p style={{
                                fontSize: 9,
                                fontWeight: 500,
                                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                                color: "#71717a",
                                margin: "2px 0 0 0",
                              }}>
                                {s.code || s.finish || s.manufacturer}
                              </p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    {filteredSwatches.length > 300 && (
                      <p style={{ fontSize: 10, color: "#9ca3af", textAlign: "center" }}>
                        Showing first 300 of {filteredSwatches.length} — narrow by manufacturer or search to see more
                      </p>
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>

              {/* ── My Works (saved canvas drafts) ────────────── */}
              <TabsContent value="works" className="m-0">
                <ScrollArea className="h-[calc(100vh-220px)]">
                  <div className="p-3 space-y-3">
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <FolderOpen size={14} style={{ color: "#0080dd" }} />
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#111" }}>My Works</span>
                    </div>
                    <p style={{ fontSize: 10, color: "#9ca3af" }}>Saved canvas drafts — click to reopen</p>

                    {/* Title + Save + New */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <Input
                        value={workTitle}
                        onChange={e => setWorkTitle(e.target.value)}
                        placeholder="Work title"
                        className="h-8 text-xs"
                      />
                      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 6 }}>
                        <button
                          onClick={saveWork}
                          disabled={savingWork}
                          style={{
                            padding: "7px 0", borderRadius: 6, fontSize: 11, fontWeight: 700,
                            background: savingWork ? "#9ca3af" : "linear-gradient(135deg, #0066cc, #00aaff)",
                            border: "none", color: "#fff", cursor: savingWork ? "wait" : "pointer",
                            display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                          }}
                        >
                          <Save size={12} /> {savingWork ? "Saving..." : currentWorkId ? "Update" : "Save"}
                        </button>
                        <button
                          onClick={newWork}
                          style={{
                            padding: "7px 0", borderRadius: 6, fontSize: 11, fontWeight: 700,
                            background: "#fff", border: "1px solid #d1d5db", color: "#374151", cursor: "pointer",
                            display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                          }}
                        >
                          <FilePlus size={12} /> New
                        </button>
                      </div>
                    </div>

                    {worksLoading ? (
                      <p style={{ fontSize: 11, color: "#9ca3af", textAlign: "center", padding: "16px 0" }}>Loading...</p>
                    ) : works.length === 0 ? (
                      <p style={{ fontSize: 11, color: "#9ca3af", textAlign: "center", padding: "16px 0" }}>
                        No saved works yet. Compose a canvas and click Save.
                      </p>
                    ) : (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                        {works.map(w => (
                          <div
                            key={w.id}
                            style={{
                              position: "relative", borderRadius: 8, overflow: "hidden",
                              border: currentWorkId === w.id ? "2px solid #0080dd" : "1px solid #e5e7eb",
                              background: "#fff", cursor: "pointer",
                            }}
                            onClick={() => loadWork(w)}
                          >
                            {w.thumbnail_url ? (
                              <img src={w.thumbnail_url} alt={w.title} style={{ width: "100%", height: 90, objectFit: "cover", background: "#f3f4f6" }} />
                            ) : (
                              <div style={{ width: "100%", height: 90, background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center", color: "#9ca3af", fontSize: 10 }}>No preview</div>
                            )}
                            <div style={{ padding: "4px 6px", background: "#fff" }}>
                              <p style={{ fontSize: 10, fontWeight: 600, color: "#111", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.title}</p>
                              <p style={{ fontSize: 9, color: "#9ca3af", margin: "1px 0 0 0" }}>{w.format_label || ""}</p>
                            </div>
                            <button
                              onClick={(e) => { e.stopPropagation(); deleteWork(w); }}
                              style={{ position: "absolute", top: 3, right: 3, background: "rgba(0,0,0,0.6)", border: "none", borderRadius: 3, padding: "1px 5px", cursor: "pointer", color: "#fff", fontSize: 9, fontWeight: 700 }}
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>

              {/* ── Hooks Library + Content Packs ────────────── */}
              <TabsContent value="hooks" className="m-0">
                <ScrollArea className="h-[calc(100vh-220px)]">
                  <div className="p-3 space-y-3">
                    {/* Content Packs */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <Zap size={14} style={{ color: "#0080dd" }} />
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#111" }}>Content Packs</span>
                    </div>
                    <p style={{ fontSize: 10, color: "#9ca3af" }}>Click a pack to fill all text fields at once</p>
                    {PACK_STYLES.map(style => (
                      <div key={style}>
                        <p style={{ fontSize: 10, fontWeight: 700, color: "#0080dd", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.05em" }}>{style}</p>
                        {CONTENT_PACKS.filter(p => p.style === style).map(pack => (
                          <button
                            key={pack.id}
                            onClick={() => {
                              setCfResult({ hook: pack.headline, headline: pack.body.split("\n")[0], body: pack.body, cta: pack.cta });
                              toast.success(`"${pack.headline}" loaded`);
                            }}
                            style={{
                              width: "100%", textAlign: "left", padding: "6px 8px", borderRadius: 6,
                              background: "#f7f8fa", border: "1px solid #e5e7eb", cursor: "pointer",
                              marginBottom: 3, transition: "border-color 0.15s",
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#0080dd"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#e5e7eb"; }}
                          >
                            <div style={{ fontSize: 12, fontWeight: 700, color: "#111" }}>{pack.headline}</div>
                            <div style={{ fontSize: 10, color: "#6b7280", marginTop: 1 }}>{pack.body.split("\n")[0]}</div>
                          </button>
                        ))}
                      </div>
                    ))}

                    <div style={{ height: 1, background: "#e5e7eb", margin: "8px 0" }} />

                    {/* Hooks Library */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <BookOpen size={14} style={{ color: "#0080dd" }} />
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#111" }}>Hooks Library</span>
                    </div>
                    <p style={{ fontSize: 10, color: "#9ca3af" }}>
                      {cfBrand}'s saved hooks (Hooks Manager · /admin/hooks) — click any hook to add it as text on canvas
                    </p>
                    {brandHookGroups.length === 0 && (
                      <p style={{ fontSize: 11, color: "#6b7280" }}>
                        No hooks saved for {cfBrand} yet — add them in the Hooks Manager.
                      </p>
                    )}
                    {brandHookGroups.map(([category, hooks]) => (
                      <div key={category}>
                        <p style={{ fontSize: 12, fontWeight: 600, color: "#0080dd", marginBottom: 4 }}>{category}</p>
                        {hooks.map(hook => (
                          <button
                            key={hook}
                            onClick={() => addText(hook.toUpperCase(), { fontSize: 56, fontFamily: "Oswald" })}
                            style={{
                              width: "100%", textAlign: "left", padding: "4px 8px", borderRadius: 4,
                              fontSize: 12, color: "#374151", background: "transparent", border: "none",
                              cursor: "pointer", transition: "background 0.15s",
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = "#f3f4f6"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                          >
                            {hook}
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </TabsContent>

              {/* ── Brand Kit ─────────────────────────────────── */}
              <TabsContent value="brand" className="m-0">
                <ScrollArea className="h-[calc(100vh-220px)]">
                  <div className="p-3 space-y-3">
                    <p style={{ fontSize: 11, fontWeight: 700, color: "#6b7280" }}>Brand Colors</p>
                    <div className="grid grid-cols-4 gap-1.5">
                      {Object.entries(BRAND).map(([name, color]) => (
                        <button
                          key={name}
                          onClick={() => { if (selectedEl) updateElement(selectedEl.id, { fill: color }); else setBgColor(color); }}
                          className="flex flex-col items-center gap-0.5"
                          title={`${name}: ${color}`}
                        >
                          <div className="w-10 h-10 rounded-md" style={{ backgroundColor: color, border: "1px solid #e5e7eb" }} />
                          <span style={{ fontSize: 9, color: "#9ca3af" }}>{name}</span>
                        </button>
                      ))}
                    </div>

                    <p style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", marginTop: 12 }}>Background Color</p>
                    <div className="flex items-center gap-2">
                      <input type="color" value={bgColor} onChange={e => setBgColor(e.target.value)} className="w-8 h-8 rounded cursor-pointer" />
                      <Input value={bgColor} onChange={e => setBgColor(e.target.value)} className="h-8 text-xs font-mono" />
                    </div>

                    <p style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", marginTop: 12 }}>Brand Fonts</p>
                    <div className="space-y-1">
                      {BRAND_FONTS.map(font => (
                        <button
                          key={font}
                          onClick={() => { if (selectedEl?.type === "text") updateElement(selectedEl.id, { fontFamily: font }); }}
                          className={cn("w-full text-left px-2 py-1 text-sm rounded transition-colors", selectedEl?.fontFamily === font ? "bg-blue-50 text-blue-600" : "hover:bg-gray-50")}
                          style={{ fontFamily: font }}
                        >
                          {font}
                        </button>
                      ))}
                    </div>
                  </div>
                </ScrollArea>
              </TabsContent>

              {/* ── Canva Template Library ────────────────────── */}
              <TabsContent value="canva" className="m-0">
                <ScrollArea className="h-[calc(100vh-220px)]">
                  <div className="p-3 space-y-3">
                    {/* Build a template with AI — the library is no longer
                        upload-only, so a brand with nothing isn't stuck. */}
                    <TemplateGeneratorPanel
                      onCreated={() => { void reloadCanvaLibrary(); }}
                    />
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <FileImage size={14} style={{ color: "#0080dd" }} />
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#111" }}>Canva Template Library</span>
                    </div>

                    {/* Brand tabs */}
                    <div style={{ display: "flex", gap: 0, background: "#f3f4f6", borderRadius: 6, padding: 2 }}>
                      {(["DesignProAI", "WePrintWraps", "DesignProAI", "WrapTV", "InkAndEdge"] as const).map(b => (
                        <button
                          key={b}
                          onClick={() => { setCanvaBrandTab(b); setRewriteResult(null); }}
                          style={{
                            flex: 1, padding: "5px 0", borderRadius: 4, fontSize: 11, fontWeight: 700,
                            background: canvaBrandTab === b ? "#fff" : "transparent",
                            color: canvaBrandTab === b ? "#0080dd" : "#6b7280",
                            border: "none", cursor: "pointer",
                            boxShadow: canvaBrandTab === b ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
                          }}
                        >
                          {BRAND_LABEL[b] || b}
                        </button>
                      ))}
                    </div>

                    {/* Content type selector for upload */}
                    <div>
                      <label style={{ fontSize: 10, fontWeight: 700, color: "#6b7280", display: "block", marginBottom: 3 }}>Upload as type:</label>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                        {CONTENT_TYPES.map(ct => (
                          <button
                            key={ct.value}
                            onClick={() => setCanvaUploadType(ct.value)}
                            style={{
                              padding: "3px 8px", borderRadius: 4, fontSize: 9, fontWeight: 600,
                              background: canvaUploadType === ct.value ? "#0080dd" : "#f3f4f6",
                              color: canvaUploadType === ct.value ? "#fff" : "#6b7280",
                              border: "none", cursor: "pointer",
                            }}
                          >
                            {ct.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Upload zone */}
                    <div
                      onClick={() => canvaUploadRef.current?.click()}
                      style={{
                        border: "2px dashed #d1d5db", borderRadius: 10, padding: 16,
                        textAlign: "center", cursor: canvaUploading ? "wait" : "pointer",
                        transition: "all 0.2s", background: "#fafafa", opacity: canvaUploading ? 0.6 : 1,
                      }}
                      onMouseEnter={(e) => { if (!canvaUploading) { e.currentTarget.style.borderColor = "#38BDF8"; e.currentTarget.style.background = "rgba(56,189,248,0.03)"; } }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#d1d5db"; e.currentTarget.style.background = "#fafafa"; }}
                      onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = "#38BDF8"; }}
                      onDragLeave={(e) => { e.currentTarget.style.borderColor = "#d1d5db"; }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.currentTarget.style.borderColor = "#d1d5db";
                        const dropped = Array.from(e.dataTransfer.files).filter(f => CANVA_EXT_RE.test(f.name));
                        if (dropped.length > 0) uploadCanvaToLibrary(dropped);
                      }}
                    >
                      <Upload size={18} style={{ color: "#9ca3af", margin: "0 auto 4px auto" }} />
                      <p style={{ fontSize: 11, fontWeight: 600, color: "#374151", margin: 0 }}>
                        {canvaUploading ? "Uploading..." : `Add to ${BRAND_LABEL[canvaBrandTab] || canvaBrandTab}`}
                      </p>
                      <p style={{ fontSize: 9, color: "#9ca3af", margin: "2px 0 0 0" }}>Drop or click — PNG, JPG, MP4, MOV, WebM — select multiple</p>
                    </div>
                    <input
                      ref={canvaUploadRef}
                      type="file"
                      accept="image/*,video/*"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        const files = Array.from(e.target.files || []);
                        if (files.length > 0) uploadCanvaToLibrary(files);
                        e.target.value = "";
                      }}
                    />

                    {/* From YOUR Canva account — the real template pull */}
                    <div style={{ background: "#f5f3ff", border: "1px solid #ddd6fe", borderRadius: 10, padding: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "#6d28d9" }}>
                          🎨 From your Canva account{canvaAcct?.name ? ` — ${canvaAcct.name}` : ""}
                        </span>
                        {canvaAcct?.connected && (
                          <button
                            onClick={() => loadCanvaDesigns(canvaDesignSearch)}
                            disabled={canvaDesignsLoading}
                            style={{ border: "none", background: "transparent", cursor: canvaDesignsLoading ? "wait" : "pointer", color: "#7c3aed", fontSize: 10, fontWeight: 700 }}
                          >
                            {canvaDesignsLoading ? "Loading…" : "↻ Refresh"}
                          </button>
                        )}
                      </div>
                      {canvaAcct === null ? (
                        <p style={{ fontSize: 10, color: "#8b5cf6", margin: 0 }}>Checking Canva connection…</p>
                      ) : !canvaAcct.connected ? (
                        <>
                          <p style={{ fontSize: 10, color: "#6b7280", margin: "0 0 6px 0" }}>
                            Connect Canva to pull your real templates straight into this library.
                          </p>
                          <button
                            onClick={connectCanva}
                            style={{ width: "100%", padding: "7px 0", borderRadius: 8, fontSize: 11, fontWeight: 800, border: "none", background: "linear-gradient(135deg, #7c3aed, #ec4899)", color: "#fff", cursor: "pointer" }}
                          >
                            Connect Canva
                          </button>
                        </>
                      ) : (
                        <>
                          {/* All designs vs ⭐ Starred (the batch agent's source) */}
                          <div style={{ display: "flex", gap: 0, background: "#ede9fe", borderRadius: 6, padding: 2, marginBottom: 6 }}>
                            {([["all", "All designs"], ["starred", "⭐ Starred"]] as const).map(([m, label]) => (
                              <button
                                key={m}
                                onClick={() => {
                                  setCanvaListMode(m);
                                  // Always refetch on switch — Canva thumbnail URLs
                                  // expire, so a cached list renders imageless cards.
                                  if (m === "starred" && !starredLoading) loadCanvaStarredList({ autoRun: true });
                                  if (m === "all" && !canvaDesignsLoading) loadCanvaDesigns(canvaDesignSearch);
                                }}
                                style={{
                                  flex: 1, padding: "4px 0", borderRadius: 4, fontSize: 10, fontWeight: 700,
                                  background: canvaListMode === m ? "#fff" : "transparent",
                                  color: canvaListMode === m ? "#6d28d9" : "#8b5cf6",
                                  border: "none", cursor: "pointer",
                                }}
                              >
                                {label}
                              </button>
                            ))}
                          </div>

                          {canvaListMode === "all" ? (
                            <>
                              <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                                <input
                                  value={canvaDesignSearch}
                                  onChange={(e) => setCanvaDesignSearch(e.target.value)}
                                  onKeyDown={(e) => { if (e.key === "Enter") loadCanvaDesigns(canvaDesignSearch); }}
                                  placeholder="Search your Canva designs…"
                                  style={{ flex: 1, background: "#fff", border: "1px solid #ddd6fe", borderRadius: 6, padding: "5px 8px", fontSize: 11, color: "#111" }}
                                />
                                <button
                                  onClick={() => loadCanvaDesigns(canvaDesignSearch)}
                                  disabled={canvaDesignsLoading}
                                  style={{ padding: "5px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700, border: "none", background: "#7c3aed", color: "#fff", cursor: canvaDesignsLoading ? "wait" : "pointer" }}
                                >
                                  Search
                                </button>
                              </div>
                              {canvaDesigns.length === 0 && !canvaDesignsLoading ? (
                                <p style={{ fontSize: 10, color: "#9ca3af", textAlign: "center", margin: "8px 0" }}>
                                  No designs found — hit Refresh or search by name.
                                </p>
                              ) : (
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, maxHeight: 240, overflowY: "auto" }}>
                                  {canvaDesigns.map((d) => (
                                    <button
                                      key={d.id}
                                      onClick={() => importCanvaDesign(d)}
                                      disabled={!!canvaImportingId}
                                      title={`Pull "${d.title}" into ${BRAND_LABEL[canvaBrandTab] || canvaBrandTab} → ${canvaUploadType}`}
                                      style={{
                                        position: "relative", borderRadius: 8, overflow: "hidden", padding: 0,
                                        border: "1px solid #ddd6fe", background: "#fff", textAlign: "left",
                                        cursor: canvaImportingId ? "wait" : "pointer",
                                        opacity: canvaImportingId && canvaImportingId !== d.id ? 0.5 : 1,
                                      }}
                                    >
                                      {d.thumbnail
                                        ? <img src={d.thumbnail} alt={d.title}
                                            onError={(e) => {
                                              // Expired Canva thumbnail — show a branded placeholder
                                              // instead of a broken image; the card still works (the
                                              // export runs server-side with fresh auth).
                                              const el = e.currentTarget;
                                              el.style.display = "none";
                                              const ph = el.nextElementSibling as HTMLElement | null;
                                              if (ph) ph.style.display = "flex";
                                            }}
                                            style={{ width: "100%", height: 72, objectFit: "cover", display: "block" }} />
                                        : null}
                                      <div style={{ width: "100%", height: 72, background: "linear-gradient(135deg,#ede9fe,#fce7f3)", display: d.thumbnail ? "none" : "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🎨</div>
                                      <div style={{ padding: "3px 6px" }}>
                                        <p style={{ fontSize: 9, fontWeight: 600, color: "#374151", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                          {canvaImportingId === d.id ? "Pulling from Canva…" : d.title}
                                        </p>
                                      </div>
                                    </button>
                                  ))}
                                </div>
                              )}
                              <p style={{ fontSize: 9, color: "#8b5cf6", margin: "6px 0 0 0" }}>
                                Click a design to export it from Canva and save it into {BRAND_LABEL[canvaBrandTab] || canvaBrandTab} → {CONTENT_TYPES.find(ct => ct.value === canvaUploadType)?.label || canvaUploadType}.
                              </p>
                            </>
                          ) : (
                            <>
                              {/* ⭐ STARRED BATCH AGENT */}
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                                <span style={{ fontSize: 10, fontWeight: 700, color: "#6d28d9" }}>
                                  {starredLoading ? "Loading templates…" : `${canvaStarred.length} template${canvaStarred.length === 1 ? "" : "s"}${canvaSrcFolders.length ? ` from your Canva folders` : (starredSource.startsWith("folder:") ? ` (from “${starredSource.slice(7)}”)` : "")}`}
                                </span>
                                <span style={{ display: "flex", gap: 8 }}>
                                  <button
                                    onClick={() => loadCanvaStarredList({ autoRun: true })}
                                    disabled={starredLoading}
                                    style={{ border: "none", background: "transparent", cursor: starredLoading ? "wait" : "pointer", color: "#7c3aed", fontSize: 10, fontWeight: 700 }}
                                  >
                                    ↻ Refresh
                                  </button>
                                  <button
                                    onClick={() => {
                                      // Forget what's been built for this brand and redo the
                                      // whole watched set (e.g. after changing settings).
                                      try { localStorage.removeItem(starredDoneKey(canvaBrandTab)); } catch { /* ignore */ }
                                      toast.success("Rebuilding all templates with current settings…");
                                      rewriteAllStarred();
                                    }}
                                    disabled={starredLoading || !!starredBatch?.running}
                                    title="Forget what's built and redo every template with the current settings"
                                    style={{ border: "none", background: "transparent", cursor: starredLoading || starredBatch?.running ? "wait" : "pointer", color: "#ec4899", fontSize: 10, fontWeight: 700 }}
                                  >
                                    ↺ Rebuild all
                                  </button>
                                </span>
                              </div>
                              {/* Source folders — Canva hides the ⭐ Starred list from apps,
                                  so the operator ticks which of their EXISTING Canva folders
                                  hold templates. One-time setup; anything they make in those
                                  folders flows in automatically from then on. */}
                              {canvaSrcFolders.length ? (
                                <p style={{ fontSize: 10, color: "#6b7280", margin: "0 0 6px", lineHeight: 1.5 }}>
                                  Watching: <b style={{ color: "#6d28d9" }}>{canvaSrcFolders.map(f => `📁 ${f.name}`).join("  ")}</b>{" "}
                                  <button
                                    onClick={() => {
                                      const picks: Record<string, boolean> = {};
                                      for (const f of canvaSrcFolders) picks[f.id] = true;
                                      setCanvaFolderPicks(picks);
                                      setCanvaSrcFolders([]);
                                      setCanvaStarred([]);
                                      loadCanvaFolders();
                                    }}
                                    style={{ border: "none", background: "transparent", cursor: "pointer", color: "#7c3aed", fontSize: 10, fontWeight: 700, padding: 0 }}
                                  >
                                    change
                                  </button>
                                </p>
                              ) : (
                                <div style={{ background: "#fff", border: "1px solid #ddd6fe", borderRadius: 8, padding: 8, marginBottom: 6 }}>
                                  <p style={{ fontSize: 10, fontWeight: 700, color: "#6d28d9", margin: "0 0 4px" }}>
                                    Which Canva folders hold your templates?
                                  </p>
                                  <p style={{ fontSize: 9, color: "#9ca3af", margin: "0 0 6px" }}>
                                    Tick the folders you ALREADY use — anything you make in them auto-creates here from then on. (Canva doesn't share the ⭐ Starred list with apps.)
                                  </p>
                                  {canvaFoldersLoading ? (
                                    <p style={{ fontSize: 10, color: "#8b5cf6", margin: 0 }}>Loading your folders…</p>
                                  ) : canvaFolders.length === 0 ? (
                                    <button
                                      onClick={loadCanvaFolders}
                                      style={{ width: "100%", padding: "6px 0", borderRadius: 6, fontSize: 10, fontWeight: 700, border: "1px solid #ddd6fe", background: "#f5f3ff", color: "#6d28d9", cursor: "pointer" }}
                                    >
                                      Load my Canva folders
                                    </button>
                                  ) : (
                                    <>
                                      <div style={{ maxHeight: 150, overflowY: "auto", border: "1px solid #ede9fe", borderRadius: 6, padding: 6, marginBottom: 6 }}>
                                        {canvaFolders.map(f => (
                                          <label key={f.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, color: "#374151", padding: "3px 2px", cursor: "pointer" }}>
                                            <input
                                              type="checkbox"
                                              checked={!!canvaFolderPicks[f.id]}
                                              onChange={(e) => setCanvaFolderPicks(prev => ({ ...prev, [f.id]: e.target.checked }))}
                                              style={{ accentColor: "#7c3aed" }}
                                            />
                                            📁 {f.name}
                                          </label>
                                        ))}
                                      </div>
                                      <button
                                        onClick={() => {
                                          const chosen = canvaFolders.filter(f => canvaFolderPicks[f.id]);
                                          if (!chosen.length) { toast.error("Tick at least one folder."); return; }
                                          setCanvaSrcFolders(chosen);
                                          toast.success(`Watching ${chosen.length} Canva folder${chosen.length === 1 ? "" : "s"} — loading templates…`);
                                          loadCanvaStarredList({ autoRun: true, folders: chosen });
                                        }}
                                        style={{ width: "100%", padding: "7px 0", borderRadius: 6, fontSize: 11, fontWeight: 800, border: "none", background: "linear-gradient(135deg, #7c3aed, #ec4899)", color: "#fff", cursor: "pointer" }}
                                      >
                                        Watch these folders
                                      </button>
                                    </>
                                  )}
                                </div>
                              )}
                              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "#374151", marginBottom: 4, cursor: "pointer" }}>
                                <input
                                  type="checkbox"
                                  checked={autoCreateStarred}
                                  onChange={(e) => setAutoCreate(e.target.checked)}
                                  style={{ accentColor: "#7c3aed" }}
                                />
                                <b>Auto-create</b>&nbsp;— new starred templates build themselves when this panel opens
                              </label>
                              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "#374151", marginBottom: 6, cursor: "pointer" }}>
                                <input
                                  type="checkbox"
                                  checked={batchAutoMedia}
                                  onChange={(e) => setBatchAutoMedia(e.target.checked)}
                                  style={{ accentColor: "#7c3aed" }}
                                />
                                Also swap photos to a wrap render (OFF = text-only rewrite; you swap images/video on the canvas)
                              </label>
                              <button
                                onClick={() => rewriteAllStarred()}
                                disabled={!!starredBatch?.running || starredLoading}
                                style={{
                                  width: "100%", padding: "9px 0", borderRadius: 8, fontSize: 12, fontWeight: 800, border: "none",
                                  background: starredBatch?.running ? "#374151" : "linear-gradient(135deg, #7c3aed, #ec4899)",
                                  color: "#fff", cursor: starredBatch?.running ? "wait" : "pointer", marginBottom: 6,
                                }}
                              >
                                {starredBatch?.running ? "Rewriting starred templates…" : `⭐ Rewrite ALL starred → ${(BRAND_LABEL[canvaBrandTab] || canvaBrandTab).replace("™", "")} library`}
                              </button>
                              {starredBatch && (
                                <div style={{ background: "#fff", border: "1px solid #ddd6fe", borderRadius: 8, padding: 8, marginBottom: 6 }}>
                                  <div style={{ height: 6, background: "#ede9fe", borderRadius: 999, overflow: "hidden", marginBottom: 4 }}>
                                    <div style={{ height: "100%", width: `${starredBatch.total ? Math.round((starredBatch.done / starredBatch.total) * 100) : 0}%`, background: "linear-gradient(90deg, #7c3aed, #ec4899)", transition: "width .3s" }} />
                                  </div>
                                  <p style={{ fontSize: 10, color: "#374151", margin: 0 }}>
                                    {starredBatch.running
                                      ? `${starredBatch.done}/${starredBatch.total} — ${starredBatch.current || "starting…"}`
                                      : `Done: ${starredBatch.ok} ready · ${starredBatch.failed} failed`}
                                  </p>
                                  {starredBatch.running && (
                                    <button
                                      onClick={() => { batchCancelRef.current = true; }}
                                      style={{ marginTop: 4, padding: "3px 10px", borderRadius: 6, fontSize: 10, fontWeight: 700, border: "1px solid #ef4444", background: "#fff", color: "#ef4444", cursor: "pointer" }}
                                    >
                                      Stop after current
                                    </button>
                                  )}
                                </div>
                              )}
                              {canvaStarred.length === 0 && !starredLoading ? (
                                canvaSrcFolders.length ? (
                                  <p style={{ fontSize: 10, color: "#9ca3af", textAlign: "center", margin: "8px 0" }}>
                                    No designs in the watched folders yet — make templates in them in Canva, or push <b>change</b> above to pick different folders.
                                  </p>
                                ) : null
                              ) : (
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, maxHeight: 200, overflowY: "auto" }}>
                                  {canvaStarred.map((d) => (
                                    <button
                                      key={d.id}
                                      onClick={() => importCanvaDesign(d)}
                                      disabled={!!canvaImportingId || !!starredBatch?.running}
                                      title={`Pull just "${d.title}" into the library`}
                                      style={{
                                        position: "relative", borderRadius: 8, overflow: "hidden", padding: 0,
                                        border: "1px solid #ddd6fe", background: "#fff", textAlign: "left",
                                        cursor: canvaImportingId || starredBatch?.running ? "wait" : "pointer",
                                        opacity: canvaImportingId && canvaImportingId !== d.id ? 0.5 : 1,
                                      }}
                                    >
                                      {d.thumbnail
                                        ? <img src={d.thumbnail} alt={d.title}
                                            onError={(e) => {
                                              const el = e.currentTarget;
                                              el.style.display = "none";
                                              const ph = el.nextElementSibling as HTMLElement | null;
                                              if (ph) ph.style.display = "flex";
                                            }}
                                            style={{ width: "100%", height: 72, objectFit: "cover", display: "block" }} />
                                        : null}
                                      <div style={{ width: "100%", height: 72, background: "linear-gradient(135deg,#ede9fe,#fce7f3)", display: d.thumbnail ? "none" : "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>⭐</div>
                                      <div style={{ padding: "3px 6px" }}>
                                        <p style={{ fontSize: 9, fontWeight: 600, color: "#374151", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                          {canvaImportingId === d.id ? "Pulling from Canva…" : d.title}
                                        </p>
                                      </div>
                                    </button>
                                  ))}
                                </div>
                              )}
                              <p style={{ fontSize: 9, color: "#8b5cf6", margin: "6px 0 0 0" }}>
                                Statics + carousels: text rewritten into {(BRAND_LABEL[canvaBrandTab] || canvaBrandTab).replace("™", "")} copy, design untouched, auto-filed by aspect. Reel videos: imported ready for the reel player. Keep this tab open while it runs.
                              </p>
                            </>
                          )}
                        </>
                      )}
                    </div>

                    {/* Templates grouped by content type */}
                    {(() => {
                      const brandTemplates = canvaTemplates.filter(t => t.brand === canvaBrandTab);
                      if (brandTemplates.length === 0) return (
                        <p style={{ fontSize: 11, color: "#9ca3af", textAlign: "center", padding: "12px 0" }}>
                          No {BRAND_LABEL[canvaBrandTab] || canvaBrandTab} templates yet.
                        </p>
                      );
                      const grouped: Record<string, CanvaTemplate[]> = {};
                      for (const t of brandTemplates) {
                        if (!grouped[t.contentType]) grouped[t.contentType] = [];
                        grouped[t.contentType].push(t);
                      }
                      // Sort groups so the product-requested order is honored:
                      // 4:5 → reel → carousel → 1:1 → story → 9:16 → 16:9
                      const orderedTypes = CONTENT_TYPES.map(ct => ct.value).filter(v => grouped[v]?.length);
                      return orderedTypes.map((type) => {
                        const templates = grouped[type];
                        const typeLabel = CONTENT_TYPES.find(ct => ct.value === type)?.label || type;
                        return (
                          <div key={type}>
                            <p style={{ fontSize: 10, fontWeight: 700, color: "#0080dd", marginBottom: 4, textTransform: "uppercase", letterSpacing: 1 }}>
                              {typeLabel} ({templates.length})
                            </p>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10 }}>
                              {templates.map((t) => (
                                <div
                                  key={t.path}
                                  style={{
                                    position: "relative", borderRadius: 8, overflow: "hidden",
                                    border: "1px solid #e5e7eb", cursor: "pointer", transition: "all 0.2s",
                                  }}
                                  onClick={() => loadCanvaTemplate(t)}
                                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#38BDF8"; e.currentTarget.style.boxShadow = "0 0 0 2px rgba(56,189,248,0.2)"; }}
                                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#e5e7eb"; e.currentTarget.style.boxShadow = "none"; }}
                                >
                                  {t.isVideo ? (
                                    <div style={{ position: "relative", width: "100%", height: 90, background: "#000" }}>
                                      <video
                                        src={t.url}
                                        muted
                                        playsInline
                                        preload="metadata"
                                        onMouseEnter={(e) => { (e.currentTarget as HTMLVideoElement).play().catch(() => {}); }}
                                        onMouseLeave={(e) => { (e.currentTarget as HTMLVideoElement).pause(); (e.currentTarget as HTMLVideoElement).currentTime = 0; }}
                                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                      />
                                      <span style={{ position: "absolute", bottom: 4, right: 4, background: "rgba(0,0,0,0.75)", color: "#fff", fontSize: 8, fontWeight: 700, padding: "1px 5px", borderRadius: 3, letterSpacing: 0.5 }}>VIDEO</span>
                                    </div>
                                  ) : (
                                    <img src={t.url} alt={t.name} style={{ width: "100%", height: 90, objectFit: "cover" }} />
                                  )}
                                  <div style={{ padding: "4px 6px", background: "#fff" }}>
                                    <p style={{ fontSize: 9, fontWeight: 600, color: "#374151", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                      {t.name}
                                    </p>
                                  </div>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); rewriteTemplate(t); }}
                                    style={{
                                      position: "absolute", top: 3, left: 3, background: "linear-gradient(135deg, #0066cc, #00aaff)",
                                      border: "none", borderRadius: 3, padding: "2px 6px", cursor: rewritingTemplate ? "wait" : "pointer",
                                      color: "#fff", fontSize: 8, fontWeight: 700, lineHeight: "14px",
                                      opacity: rewritingTemplate === t.url ? 0.6 : 1,
                                    }}
                                    title="AI rewrite text for your brand"
                                  >
                                    {rewritingTemplate === t.url ? "..." : "Rewrite"}
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); deleteCanvaTemplate(t.path); }}
                                    style={{
                                      position: "absolute", top: 3, right: 3, background: "rgba(0,0,0,0.6)",
                                      border: "none", borderRadius: 3, padding: "1px 5px", cursor: "pointer",
                                      color: "#fff", fontSize: 9, fontWeight: 700, lineHeight: "14px",
                                    }}
                                    title="Remove"
                                  >
                                    ✕
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      });
                    })()}

                    {/* Rewrite results */}
                    {rewriteResult && (
                      <div style={{ background: "#f0fdf4", borderRadius: 10, border: "1px solid #bbf7d0", padding: 12 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                          <Sparkles size={14} style={{ color: "#16a34a" }} />
                          <span style={{ fontSize: 12, fontWeight: 700, color: "#16a34a" }}>Replacement Copy — Copy into Canva</span>
                        </div>
                        {rewriteResult.replacements.map((r, i) => (
                          <div key={i} style={{ marginBottom: i < rewriteResult.replacements.length - 1 ? 10 : 0, padding: "8px 0", borderBottom: i < rewriteResult.replacements.length - 1 ? "1px solid #dcfce7" : "none" }}>
                            <span style={{ fontSize: 9, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1 }}>Original ({r.position})</span>
                            <p style={{ fontSize: 11, color: "#6b7280", margin: "2px 0 6px 0", textDecoration: "line-through" }}>{r.original}</p>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <span style={{ fontSize: 9, fontWeight: 700, color: "#0080dd", textTransform: "uppercase", letterSpacing: 1 }}>Replace with</span>
                              <button onClick={() => { navigator.clipboard.writeText(r.replacement); toast.success("Copied!"); }} style={{ background: "none", border: "none", cursor: "pointer", padding: 2 }}>
                                <Copy size={11} style={{ color: "#0080dd" }} />
                              </button>
                            </div>
                            <p style={{ fontSize: 12, fontWeight: 600, color: "#111", margin: "2px 0 0 0" }}>{r.replacement}</p>
                          </div>
                        ))}
                        <button
                          onClick={() => {
                            const all = rewriteResult.replacements.map(r => r.replacement).join("\n\n");
                            navigator.clipboard.writeText(all);
                            toast.success("All copied!");
                          }}
                          style={{
                            width: "100%", marginTop: 8, padding: "8px 0", borderRadius: 6,
                            fontSize: 11, fontWeight: 700, background: "#0A0A0F",
                            border: "1px solid rgba(56,189,248,0.3)", color: "#38BDF8",
                            cursor: "pointer",
                          }}
                        >
                          Copy All Replacements
                        </button>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </div>
        </div>

        {/* ── CENTER: Canvas ──────────────────────────────── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", overflowY: "auto", maxHeight: "calc(100vh - 140px)" }}>
          {/* Format indicator above canvas */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexShrink: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#374151" }}>{formatLabel}</span>
            <span style={{ fontSize: 11, color: "#9ca3af" }}>{canvasWidth} x {canvasHeight}px</span>
          </div>
          <div
            style={{
              border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden",
              background: "#fff", boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
              width: canvasWidth * scale, height: canvasHeight * scale,
              flexShrink: 0,
            }}
          >
            <Stage
              ref={stageRef}
              width={canvasWidth * scale}
              height={canvasHeight * scale}
              scaleX={scale}
              scaleY={scale}
              onClick={(e) => { if (e.target === e.target.getStage()) setSelectedId(null); }}
              onTap={(e) => { if (e.target === e.target.getStage()) setSelectedId(null); }}
            >
              <Layer ref={layerRef}>
                <Rect x={0} y={0} width={canvasWidth} height={canvasHeight} fill={bgColor} listening={false} />
                {/* Z-ORDER: image/video are the background, text/shapes always
                    render on top — so AI text overlays are never hidden behind a
                    pushed render, no matter what order things were added. Stable
                    sort keeps relative order within each layer band. */}
                {[...elements]
                  .sort((a, b) => zBand(a) - zBand(b))
                  .map(el => {
                  const commonProps = {
                    id: el.id,
                    x: el.x,
                    y: el.y,
                    draggable: true,
                    onClick: () => setSelectedId(el.id),
                    onTap: () => setSelectedId(el.id),
                    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => handleDragEnd(el.id, e),
                    onTransformEnd: (e: Konva.KonvaEventObject<Event>) => {
                      // Bake the scale back into width/height/fontSize and reset scale
                      // so follow-up edits stay predictable.
                      const node = e.target as Konva.Node;
                      const scaleX = node.scaleX();
                      const scaleY = node.scaleY();
                      node.scaleX(1);
                      node.scaleY(1);
                      const newX = node.x();
                      const newY = node.y();
                      const newRotation = node.rotation();
                      if (el.type === "text") {
                        updateElement(el.id, {
                          x: newX,
                          y: newY,
                          width: Math.max(20, (el.width || 100) * scaleX),
                          fontSize: Math.max(8, Math.round((el.fontSize || 32) * scaleY)),
                        });
                      } else {
                        updateElement(el.id, {
                          x: newX,
                          y: newY,
                          width: Math.max(5, (el.width || 100) * scaleX),
                          height: Math.max(5, (el.height || 100) * scaleY),
                        });
                      }
                    },
                  };
                  if (el.type === "rect") {
                    return (
                      <Rect
                        key={el.id}
                        {...commonProps}
                        width={el.width} height={el.height}
                        fill={el.fill} opacity={el.opacity ?? 1} cornerRadius={el.cornerRadius || 0}
                      />
                    );
                  }
                  if (el.type === "text") {
                    return (
                      <Text
                        key={el.id}
                        {...commonProps}
                        width={el.width} height={el.height}
                        text={el.text || ""} fontSize={el.fontSize || 32}
                        fontFamily={el.fontFamily || "Poppins"} fontStyle={el.fontStyle || "normal"}
                        fill={el.fill || "#FFFFFF"} align={el.align || "left"}
                        verticalAlign={el.verticalAlign || "top"} padding={4}
                      />
                    );
                  }
                  if (el.type === "image" && el.imageData) {
                    return (
                      <KonvaImage
                        key={el.id}
                        {...commonProps}
                        width={el.width} height={el.height}
                        image={el.imageData} opacity={el.opacity ?? 1}
                      />
                    );
                  }
                  return null;
                })}
                <Transformer
                  ref={transformerRef}
                  rotateEnabled
                  keepRatio={false}
                  anchorSize={10}
                  borderStroke="#00C7FF"
                  anchorStroke="#00C7FF"
                  anchorFill="#ffffff"
                  boundBoxFunc={(oldBox, newBox) => {
                    // Prevent collapsing a node to 0
                    if (newBox.width < 10 || newBox.height < 10) return oldBox;
                    return newBox;
                  }}
                />
              </Layer>
            </Stage>
          </div>

          {/* Video section — shows for Reels/Stories/TikTok formats */}
          {isVideoFormat && (
            <div style={{ marginTop: 12, width: "100%", maxWidth: 500, background: "#fff", borderRadius: 10, border: "1px solid #e5e7eb", padding: 12, flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#374151" }}>Video</span>
                  <span style={{ fontSize: 9, fontWeight: 600, color: "#0080dd", background: "rgba(0,128,221,0.08)", padding: "1px 6px", borderRadius: 4 }}>
                    Reels / Stories / TikTok
                  </span>
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  <button
                    onClick={() => videoInputRef.current?.click()}
                    style={{ padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: "linear-gradient(135deg, #0066cc, #00aaff)", border: "none", color: "#fff", cursor: "pointer" }}
                  >
                    {videoUrl ? "Replace Video" : "Upload Video"}
                  </button>
                  {videoUrl && (
                    <button
                      onClick={() => { setVideoUrl(null); setVideoFile(null); }}
                      style={{ padding: "4px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: "#fee2e2", border: "none", color: "#dc2626", cursor: "pointer" }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
              <input ref={videoInputRef} type="file" accept="video/*" className="hidden" onChange={handleVideoUpload} />
              {videoUrl ? (
                <div style={{ position: "relative" }}>
                  <video
                    src={videoUrl}
                    controls
                    playsInline
                    style={{ width: "100%", maxHeight: 320, borderRadius: 8, background: "#000" }}
                  />
                  {videoFile && (
                    <p style={{ fontSize: 10, color: "#9ca3af", marginTop: 4, textAlign: "center" }}>
                      {videoFile.name} ({(videoFile.size / 1024 / 1024).toFixed(1)} MB)
                    </p>
                  )}
                </div>
              ) : (
                <div
                  onClick={() => videoInputRef.current?.click()}
                  style={{
                    border: "2px dashed #d1d5db", borderRadius: 8, padding: "24px 16px",
                    textAlign: "center", cursor: "pointer", transition: "all 0.2s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#0080dd"; e.currentTarget.style.background = "rgba(0,128,221,0.02)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#d1d5db"; e.currentTarget.style.background = "transparent"; }}
                >
                  <Upload size={20} style={{ color: "#9ca3af", margin: "0 auto 6px" }} />
                  <p style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", margin: 0 }}>Drop or click to upload video</p>
                  <p style={{ fontSize: 10, color: "#9ca3af", margin: "4px 0 0 0" }}>MP4, MOV, WebM — max 500MB</p>
                </div>
              )}
              <p style={{ fontSize: 10, color: "#9ca3af", marginTop: 6, lineHeight: 1.4 }}>
                Use the canvas above for your cover image / thumbnail. Upload your video here for pairing with the generated copy.
              </p>
            </div>
          )}

          {/* Layer list */}
          <div style={{ marginTop: 12, width: "100%", maxWidth: 500, background: "#fff", borderRadius: 10, border: "1px solid #e5e7eb", padding: 10, flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 6 }}>
              <Layers size={12} style={{ color: "#9ca3af" }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: "#6b7280" }}>Layers ({elements.length})</span>
            </div>
            <div style={{ maxHeight: 140, overflowY: "auto" }}>
              {[...elements].reverse().map(el => (
                <button
                  key={el.id}
                  onClick={() => setSelectedId(el.id)}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", gap: 8,
                    padding: "4px 8px", borderRadius: 4, fontSize: 12, cursor: "pointer",
                    background: el.id === selectedId ? "#eff6ff" : "transparent",
                    border: "none", textAlign: "left", transition: "background 0.15s",
                  }}
                  onMouseEnter={(e) => { if (el.id !== selectedId) e.currentTarget.style.background = "#f9fafb"; }}
                  onMouseLeave={(e) => { if (el.id !== selectedId) e.currentTarget.style.background = "transparent"; }}
                >
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#374151" }}>
                    {el.type === "text" ? `T: ${(el.text || "").substring(0, 30)}` :
                     el.type === "image" ? "Image" : `Rect ${el.width}×${el.height}`}
                  </span>
                  <span style={{ fontSize: 10, color: "#9ca3af" }}>{el.type}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── RIGHT PANEL: Properties ────────────────────── */}
        <div style={{ width: 280, flexShrink: 0 }}>
          <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", padding: 14, position: "sticky", top: 100 }}>
            {selectedEl ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p style={{ fontSize: 13, fontWeight: 700, color: "#111", margin: 0 }}>
                    {selectedEl.type === "text" ? "Text" : selectedEl.type === "image" ? "Image" : "Shape"} Properties
                  </p>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeElement(selectedEl.id)}>
                    <Trash2 className="h-3.5 w-3.5 text-red-400" />
                  </Button>
                </div>

                {/* Position */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label style={{ fontSize: 10, color: "#9ca3af" }}>X</label>
                    <Input className="h-7 text-xs" type="number" value={Math.round(selectedEl.x)} onChange={e => updateElement(selectedEl.id, { x: +e.target.value })} />
                  </div>
                  <div>
                    <label style={{ fontSize: 10, color: "#9ca3af" }}>Y</label>
                    <Input className="h-7 text-xs" type="number" value={Math.round(selectedEl.y)} onChange={e => updateElement(selectedEl.id, { y: +e.target.value })} />
                  </div>
                  <div>
                    <label style={{ fontSize: 10, color: "#9ca3af" }}>W</label>
                    <Input className="h-7 text-xs" type="number" value={Math.round(selectedEl.width)} onChange={e => updateElement(selectedEl.id, { width: +e.target.value })} />
                  </div>
                  <div>
                    <label style={{ fontSize: 10, color: "#9ca3af" }}>H</label>
                    <Input className="h-7 text-xs" type="number" value={Math.round(selectedEl.height)} onChange={e => updateElement(selectedEl.id, { height: +e.target.value })} />
                  </div>
                </div>

                {/* Opacity */}
                <div>
                  <label style={{ fontSize: 10, color: "#9ca3af" }}>Opacity</label>
                  <Slider
                    value={[(selectedEl.opacity ?? 1) * 100]} min={0} max={100} step={5}
                    onValueChange={([v]) => updateElement(selectedEl.id, { opacity: v / 100 })}
                    className="mt-1"
                  />
                </div>

                {/* Color */}
                {(selectedEl.type === "rect" || selectedEl.type === "text") && (
                  <div>
                    <label style={{ fontSize: 10, color: "#9ca3af" }}>Color</label>
                    <div className="flex items-center gap-2 mt-1">
                      <input type="color" value={selectedEl.fill || "#ffffff"} onChange={e => updateElement(selectedEl.id, { fill: e.target.value })} className="w-7 h-7 rounded cursor-pointer" />
                      <Input className="h-7 text-xs font-mono flex-1" value={selectedEl.fill || ""} onChange={e => updateElement(selectedEl.id, { fill: e.target.value })} />
                    </div>
                  </div>
                )}

                {/* Corner radius */}
                {selectedEl.type === "rect" && (
                  <div>
                    <label style={{ fontSize: 10, color: "#9ca3af" }}>Corner Radius</label>
                    <Slider value={[selectedEl.cornerRadius || 0]} min={0} max={60} step={2} onValueChange={([v]) => updateElement(selectedEl.id, { cornerRadius: v })} className="mt-1" />
                  </div>
                )}

                {/* Text-specific */}
                {selectedEl.type === "text" && (
                  <>
                    <div>
                      <label style={{ fontSize: 10, color: "#9ca3af" }}>Text</label>
                      <Textarea className="text-xs mt-1 min-h-[60px]" value={selectedEl.text || ""} onChange={e => updateElement(selectedEl.id, { text: e.target.value })} />
                    </div>
                    <div>
                      <label style={{ fontSize: 10, color: "#9ca3af" }}>Font</label>
                      <Select value={selectedEl.fontFamily || "Poppins"} onValueChange={v => updateElement(selectedEl.id, { fontFamily: v })}>
                        <SelectTrigger className="h-7 text-xs mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {BRAND_FONTS.map(f => (
                            <SelectItem key={f} value={f} className="text-xs" style={{ fontFamily: f }}>{f}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label style={{ fontSize: 10, color: "#9ca3af" }}>Size</label>
                        <Input className="h-7 text-xs" type="number" value={selectedEl.fontSize || 32} onChange={e => updateElement(selectedEl.id, { fontSize: +e.target.value })} />
                      </div>
                      <div>
                        <label style={{ fontSize: 10, color: "#9ca3af" }}>Style</label>
                        <Select value={selectedEl.fontStyle || "normal"} onValueChange={v => updateElement(selectedEl.id, { fontStyle: v })}>
                          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="normal" className="text-xs">Normal</SelectItem>
                            <SelectItem value="bold" className="text-xs">Bold</SelectItem>
                            <SelectItem value="italic" className="text-xs">Italic</SelectItem>
                            <SelectItem value="bold italic" className="text-xs">Bold Italic</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div>
                      <label style={{ fontSize: 10, color: "#9ca3af" }}>Align</label>
                      <div className="flex gap-1 mt-1">
                        {(["left", "center", "right"] as const).map(a => (
                          <Button
                            key={a} size="icon"
                            variant={selectedEl.align === a ? "default" : "outline"}
                            className="h-7 w-7"
                            onClick={() => updateElement(selectedEl.id, { align: a })}
                          >
                            {a === "left" && <AlignLeft className="h-3 w-3" />}
                            {a === "center" && <AlignCenter className="h-3 w-3" />}
                            {a === "right" && <AlignRight className="h-3 w-3" />}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {/* Layer order */}
                <div className="flex gap-1 pt-2" style={{ borderTop: "1px solid #e5e7eb" }}>
                  <Button size="sm" variant="ghost" className="flex-1 h-7 text-xs" onClick={() => moveElement(selectedEl.id, "up")}>
                    <MoveUp className="h-3 w-3 mr-1" /> Up
                  </Button>
                  <Button size="sm" variant="ghost" className="flex-1 h-7 text-xs" onClick={() => moveElement(selectedEl.id, "down")}>
                    <MoveDown className="h-3 w-3 mr-1" /> Down
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-red-400" onClick={() => removeElement(selectedEl.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: "center", padding: "32px 0", color: "#9ca3af" }}>
                <Type size={32} style={{ margin: "0 auto 8px auto", opacity: 0.4 }} />
                <p style={{ fontSize: 12, margin: 0 }}>Select an element on the canvas<br />or add one from the left panel</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminContentStudio;
