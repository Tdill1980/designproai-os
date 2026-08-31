import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { Helmet } from "react-helmet-async";
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  listRevisionStudioDesigns,
  listRevisionStudioVersions,
  loadDriverPanelGeometry,
  revisionStudioVersionCommits,
  loadLayeredEditSources,
  readRevisionStudioDesign,
} from "@/lib/revisionstudio-source";
import { renderClient } from "@/integrations/supabase/renderClient";
import { downscaleStorageImage } from "@/lib/storage-image";
import { type VersionCommit } from "@/lib/revision-commits";
import { isAllowlistedAdmin } from "@/lib/admin-allowlist";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { confirmDialog, ConfirmDialogHost } from "@/components/ui/confirm-dialog";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Play, Copy, GitBranch, ChevronLeft, ChevronRight, ChevronUp, ChevronDown,
  Search, Clock, Loader2, Video, Download,
  Edit3, History, Sparkles, Shield, Zap,
  Calendar, DollarSign, Layers, Eye, ImagePlus, X,
  ArrowRight, Palette, ClipboardList, AlertTriangle, CheckCircle2, ImageIcon,
  Star, Flag, Trash2, FileText, Scissors, Package, ImageOff, RefreshCw, FlipHorizontal2, Users, User, Maximize2, Crosshair, Wand2,
  Mic, Paperclip, Spline, SlidersHorizontal, Send, Ruler,
} from "lucide-react";
import { useCutFiles } from "@/hooks/useCutFiles";
import { useSpeechToText } from "@/hooks/useSpeechToText";
import { useCutGraphicsProof } from "@/hooks/useCutGraphicsProof";
import { CutGraphicsProofSheet } from "@/components/graphicspro/CutGraphicsProofSheet";
import { MobileZoomImageModal } from "@/components/visualize/MobileZoomImageModal";
import { LogoUploader } from "@/components/revisioniq/LogoUploader";
import { LayerLift } from "@/components/revisioniq/LayerLift";
import { LayerStrip } from "@/components/revisioniq/LayerStrip";
import { AlternateElementsCard } from "@/components/revisioniq/AlternateElementsCard";
import { LogoPlacementOverlay } from "@/components/revisioniq/LogoPlacementOverlay";
import { RemovalBoxCanvas } from "@/components/revisioniq/RemovalBoxCanvas";
import { PreciseEditCanvas } from "@/components/revisioniq/PreciseEditCanvas";
import { PreciseEditDialog } from "@/components/revisioniq/PreciseEditDialog";
import { SidePanelBoxes } from "@/components/revisioniq/SidePanelBoxes";
import { getLayer2Handoff, clearLayer2Handoff } from "@/lib/designLayer2Handoff";
import {
  RenderElementSeparator,
  type RenderElementSeparatorHandle,
} from "@/components/revisioniq/RenderElementSeparator";
import { ProductionFlowLayersCard } from "@/components/revisioniq/ProductionFlowLayersCard";
import { JobWorkflowHeader } from "@/components/designpro/JobWorkflowHeader";
// DesignVersionRecordCard is intentionally not mounted: production identity lives in PanelPro.
import { DesignLibrary } from "@/components/revisioniq/DesignLibrary";
import { useStandaloneProductionLayers } from "@/hooks/useStandaloneProductionLayers";
import { dpApi } from "@/lib/designpro-api";
import {
  getDesignBuildStatus,
  resumeDesignBuild,
  readDesignAfterEdit,
  submitDesignRevision,
  requestDesignBuild,
  type DesignBuildTrigger,
} from "@/lib/revisionstudio-flow";
import { formatDid } from "@/lib/designId";
import {
  composeRenderWithLayers,
  uploadCompositeRender,
  type PlacedLayer,
} from "@/lib/logo-composite";
import { parseVersionInfo, getVersionLabel, type VersionInfo } from "@/lib/asset-version";
import {
  buildRevisionVersionTimeline,
  changedRevisionSurfaceKeys,
  REVISION_SURFACE_ORDER,
  type RevisionRenderUrls,
} from "@/lib/revision-version-surfaces";
import type {
  LogoLayer,
  LogoSize,
  RenderLogoLayers,
} from "@/types/revision-logo";
import { toast } from "sonner";
import { withTimeout, VIEW_RENDER_TIMEOUT_MS } from "@/lib/invokeWithTimeout";
import { GenerationWizard, REVISION_TIPS } from "@/components/tools/GenerationWizard";
import { RenderQualityRating } from "@/components/RenderQualityRating";
import { downloadWithOverlay, downloadAllWithOverlay } from "@/lib/download-with-overlay";
import { stampOverlayOnImage, type OverlaySpec } from "@/lib/overlay-stamper";
import { format, formatDistanceToNow } from "date-fns";
import {
  PROMPT_PRESETS,
  getPresetsByCategory,
  getSubcategories,
  searchPresets,
  type PromptPreset,
} from "@/data/prompt-presets";
import type { VisionBoardImage, VisionBoardIntent } from "@/lib/designiq-engine";
import { cn } from "@/lib/utils";
import type { ToolKey } from "@/lib/tool-registry";
import { ProfessionalProofSheet } from "@/components/tools/ProfessionalProofSheet";
import { MobileProofSheet } from "@/components/tools/MobileProofSheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { TwoDProofSheet } from "@/components/tools/TwoDProofSheet";
import { PrintProCTAButton } from "@/components/PrintProCTAButton";
import { SendForApprovalDialog } from "@/components/proof/SendForApprovalDialog";
import { ApproveProContextPanel } from "@/components/proof/ApproveProContextPanel";
import { ClipboardSignature as ClipboardSignatureIcon } from "lucide-react";
import { MyVehicleProInline } from "@/components/tools/MyVehicleProInline";
// useStudioToggle removed - dark studio only

// ApprovePro remains intentionally offline until its DesignProAI-owned OS
// contract is ready. Backend gates remain authoritative; this default-off UI
// gate prevents dead bridge actions and proof readers from mounting meanwhile.
const APPROVEPRO_UI_LIVE = import.meta.env.VITE_APPROVEPRO_LIVE === "on";

// ---------------------------------------------------------------------------
// SPROKET Tips Slideshow for empty state
// ---------------------------------------------------------------------------
const REVISION_SPROKET_TIPS = [
  { image: "/characters/sproket/sproket-presenting.png", headline: "Welcome to RevisionStudioIQ", text: "Select a render from your gallery to start revising. Clone it, tweak colors, swap finishes — all without starting over." },
  { image: "/characters/sproket/sproket-revision.png", headline: "Revise Without Restarting", text: "Every revision is a new version. Your original stays untouched. Compare side-by-side to see the evolution." },
  { image: "/characters/sproket/sproket-clipboard.png", headline: "Pro Tip: Be Specific", text: "Instead of 'make it cooler,' try 'add metallic blue accents on the hood with a matte black base.' Ace loves detail." },
  { image: "/characters/sproket/sproket-starred.png", headline: "Star Your Best Work", text: "5-star renders get featured in the gallery and Hero Carousel. Rate every render to build your Brightest Stars collection." },
  { image: "/characters/sproket/sproket-tips.png", headline: "Try Prompt Presets", text: "Use the preset library to jumpstart your revision. Categories like 'Racing,' 'Luxury,' and 'Fleet' give Ace a head start." },
  { image: "/characters/sproket/sproket-launch.png", headline: "Generate Missing Views", text: "Only got a front and side? Generate the remaining 5 camera angles with one click. 7 views = complete wrap coverage." },
  { image: "/characters/sproket/sproket-milestone.png", headline: "Send to ProductionFlow", text: "When your design is dialed in, send it straight to GENIE for panelizing. From screen to printer in minutes." },
  { image: "/characters/sproket/sproket-loves-it.png", headline: "VisionBoardIQ", text: "Upload mood boards, brand assets, or competitor wraps. Ace studies your references and weaves them into the design." },
];

function SproketTipsSlideshow() {
  const [tipIdx, setTipIdx] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTipIdx(prev => (prev + 1) % REVISION_SPROKET_TIPS.length), 5000);
    return () => clearInterval(timer);
  }, []);
  const tip = REVISION_SPROKET_TIPS[tipIdx];
  return (
    <div className="col-span-full flex flex-col items-center justify-center py-16 px-4">
      <div className="flex items-center gap-6 max-w-lg">
        <img
          key={tipIdx}
          src={tip.image}
          alt="SPROKET"
          className="w-14 h-14 sm:w-20 sm:h-20 md:w-36 md:h-36 object-contain shrink-0 animate-sproket-fade-up"
        />
        <div className="flex-1 min-w-0">
          <p className="text-white font-bold text-lg md:text-xl font-poppins mb-1">{tip.headline}</p>
          <p className="text-zinc-400 text-sm md:text-base leading-relaxed">{tip.text}</p>
        </div>
      </div>
      {/* Dot indicators */}
      <div className="flex gap-1.5 mt-6">
        {REVISION_SPROKET_TIPS.map((_, i) => (
          <button
            key={i}
            onClick={() => setTipIdx(i)}
            className={`slide-dot h-1.5 rounded-full transition-all duration-300 ${i === tipIdx ? "bg-cyan-400 w-5" : "bg-zinc-700 w-1.5"}`}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helper: Ensure session is fresh before mutations.
// Always forces a refresh so the SDK internal state is up-to-date.
// ---------------------------------------------------------------------------
// Coalesce concurrent token refreshes into ONE in-flight call. RevisionStudio
// fires up to 7 view renders in parallel, each calling ensureFreshSession(). When
// the access token dips under the 60s threshold, those 7 callers each hit
// supabase.auth.refreshSession() at once — they race on the same (single-use)
// refresh token, the losers get "refresh token already used", and supabase-js
// emits SIGNED_OUT. That popped the "session expired" modal and forced a sign-in
// loop mid-generation. Sharing one refresh promise removes the race (same fix
// client.ts uses for the render path).
let _rsRefreshInFlight: ReturnType<typeof supabase.auth.refreshSession> | null = null;
function coalescedRefresh() {
  if (!_rsRefreshInFlight) {
    _rsRefreshInFlight = supabase.auth.refreshSession();
    _rsRefreshInFlight.finally(() => { _rsRefreshInFlight = null; });
  }
  return _rsRefreshInFlight;
}

async function ensureFreshSession(): Promise<string | null> {
  try {
    // Step 1: Use the CURRENT session if its token is still healthy.
    //
    // We must NOT force a refresh on every call. supabase-js rotates the
    // refresh token on each refreshSession(); when an unconditional refresh
    // here races a concurrent one (render-queue poll, edge-function preflight,
    // another tab) the loser gets "refresh token already used" and supabase-js
    // emits SIGNED_OUT — which CLEARS the session. The very next RLS-protected
    // request (e.g. the delete below) then runs as `anon`, matches no
    // DELETE policy, and silently affects 0 rows — surfacing as the bogus
    // "Delete blocked - you may not have permission" error. (The render path
    // already solved this with a coalesced refresh; see client.ts.)
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      const expiresAt = (session.expires_at ?? 0) * 1000;
      const remaining = expiresAt - Date.now();
      if (remaining > 60_000) {
        // Token comfortably valid — use it as-is, no refresh (no rotation race).
        return session.access_token;
      }
      console.log(`[RevisionIQ] Token near expiry (${Math.round(remaining / 1000)}s) - refreshing`);
    }

    // Step 2: No session, or token near/after expiry → refresh once (coalesced
    // so concurrent view renders don't race on the single-use refresh token).
    const { data: refreshData, error: refreshErr } = await coalescedRefresh();
    if (refreshData?.session?.access_token) {
      const expiresAt = (refreshData.session.expires_at ?? 0) * 1000;
      console.log("[RevisionIQ] Token refreshed OK, expires:", new Date(expiresAt).toISOString());
      return refreshData.session.access_token;
    }
    if (refreshErr) {
      console.warn("[RevisionIQ] refreshSession failed:", refreshErr.message);
    }

    // Step 3: Refresh failed but a cached session may still be usable.
    const { data: { session: cached } } = await supabase.auth.getSession();
    if (cached?.access_token) return cached.access_token;
  } catch (err) {
    console.error("[RevisionIQ] ensureFreshSession error:", err);
  }
  return null;
}

const getFreshAccessToken = ensureFreshSession;

/**
 * Detect GENUINE auth/session errors from Supabase edge function responses.
 *
 * This gate must be PRECISE. It used to match the bare substrings "auth" and
 * "token", which caught ordinary revision failures whose messages happen to
 * contain the word "token" — "Out of tokens" (the 402 paywall) and "…your
 * token was refunded" (the Gemini render-failure message). Those got
 * misclassified as expired sessions, so a user who was simply out of tokens
 * (or hit a transient AI failure) was told "Session expired" and bounced to
 * /login instead of seeing the paywall / retry hint. Match only real auth
 * signals — and the actual messages the backend returns (token-gate emits
 * "Invalid or expired session" / "Missing Authorization bearer token";
 * revise-render emits "Not authenticated" / "No authorization token provided").
 */
function isAuthError(errorMsg: string): boolean {
  const lower = (errorMsg || "").toLowerCase();
  // Explicitly NOT auth: out-of-tokens paywall + AI-failure refund messages
  // legitimately contain the word "token" but are not session problems.
  if (
    lower.includes("out of tokens") ||
    lower.includes("no_tokens") ||
    lower.includes("token was refunded") ||
    lower.includes("token refunded")
  ) {
    return false;
  }
  return (
    lower.includes("jwt") ||
    lower.includes("not authenticated") ||
    lower.includes("no authorization token") ||
    lower.includes("missing authorization") ||
    lower.includes("invalid or expired session") ||
    lower.includes("session expired") ||
    lower.includes("bad_auth") ||
    lower.includes("no_auth") ||
    /\b401\b/.test(lower)
  );
}

/**
 * Pull the underlying "why" out of a revise-render RENDER_FAILED message so the
 * toast can show the actual reason instead of a generic "AI couldn't generate".
 * The edge fn appends "Detail: <lastError>" where lastError is the concrete tier
 * failure — e.g. "Pro HTTP 429: quota exceeded", "Flash-4K: NO_IMAGE — Gemini
 * chose text over image", a content-filter finishReason, or a timeout. Surfacing
 * it is the difference between the user guessing and knowing whether it's a
 * quota/rate-limit, a safety block, or a prompt the model keeps refusing.
 */
function extractFailureDetail(errorMsg: string): string {
  const m = /Detail:\s*(.+)$/i.exec(errorMsg || "");
  const detail = m?.[1]?.trim();
  if (!detail) return "";
  return ` (Reason: ${detail.slice(0, 160)})`;
}

/**
 * Get the Supabase functions base URL from the project URL.
 * supabase URL: https://xxx.supabase.co → functions URL: https://xxx.supabase.co/functions/v1
 */
function getEdgeFunctionUrl(fnName: string): string {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
  return `${supabaseUrl}/functions/v1/${fnName}`;
}

/**
 * Invoke an edge function using raw fetch() - bypasses the Supabase SDK entirely.
 * This eliminates SDK header merging issues that can cause "Invalid JWT" errors
 * when the SDK's internal session state is stale but our refreshed token is valid.
 *
 *  1. Force session refresh before every call
 *  2. Use raw fetch() with ONLY our explicit Authorization header
 *  3. On auth failure: force another refresh and retry once
 *  4. Apply timeout to prevent indefinite hangs
 */
async function invokeWithFreshAuth(
  fnName: string,
  body: Record<string, any>,
  timeoutMs = 120_000,
): Promise<{ data: any; error: any }> {
  // Step 1: Get a fresh token
  const token = await ensureFreshSession();
  if (!token) {
    return { data: null, error: { message: "Session expired - please log in again." } };
  }

  // Step 2: Invoke with the fresh token via raw fetch
  console.log(`[RevisionIQ] Invoking ${fnName} via raw fetch with fresh JWT (prefix: ${token.substring(0, 20)}...)...`);
  const result = await _doInvoke(fnName, body, token, timeoutMs);

  // Step 3: If auth error, force refresh and retry once
  if (result.error && isAuthError(result.error.message)) {
    console.warn(`[RevisionIQ] Auth error on ${fnName}: "${result.error.message}" - forcing refresh and retrying...`);
    const retryToken = await ensureFreshSession();
    if (retryToken && retryToken !== token) {
      console.log(`[RevisionIQ] Retrying ${fnName} with NEW JWT (prefix: ${retryToken.substring(0, 20)}...)...`);
      return _doInvoke(fnName, body, retryToken, timeoutMs);
    }
    // Refresh gave same token or failed - return original error
    console.error(`[RevisionIQ] Retry failed - refresh returned ${retryToken ? "same token" : "no token"}`);
  }

  return result;
}

/**
 * Raw fetch() call to a Supabase edge function - bypasses the SDK's invoke()
 * to avoid SDK header merging issues. We control EXACTLY what headers are sent.
 */
async function _doInvoke(
  fnName: string,
  body: Record<string, any>,
  token: string,
  timeoutMs = 120_000,
): Promise<{ data: any; error: any }> {
  const url = getEdgeFunctionUrl(fnName);
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
        "apikey": anonKey, // Required by Supabase gateway
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      let errorMsg = `Edge function ${fnName} returned ${response.status}`;
      try {
        const errorBody = await response.json();
        errorMsg = errorBody?.message || errorBody?.error || errorMsg;
      } catch {
        try {
          const errorText = await response.text();
          if (errorText) errorMsg = errorText.substring(0, 200);
        } catch { /* ignore */ }
      }
      console.error(`[RevisionIQ] ${fnName} HTTP ${response.status}:`, errorMsg);
      return { data: null, error: { message: errorMsg } };
    }

    const data = await response.json();
    console.log(`[RevisionIQ] ${fnName} succeeded - renderUrl: ${data?.renderUrl?.substring(0, 60) || "(none)"}...`);
    return { data, error: null };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      const msg = `${fnName} timed out after ${Math.round(timeoutMs / 1000)}s`;
      console.error(`[RevisionIQ] ${msg}`);
      return { data: null, error: { message: msg } };
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[RevisionIQ] ${fnName} error:`, msg);
    return { data: null, error: { message: msg } };
  }
}

// ---------------------------------------------------------------------------
// Version tracking via design_file_name field
// Format: "Design Name" or "Design Name (V2)" or "Design Name (V3)"
// Parent tracking via admin_notes JSON: {"version":{"parent_id":"uuid","version":2}}
// ---------------------------------------------------------------------------

// Version helpers (parseVersionInfo / getVersionLabel / VersionInfo) now live in
// @/lib/asset-version — the single source of truth shared with QC production so
// both surfaces track design versions (V1, V2, …) by the exact same code.

// A design's "name" is often just an order number ("Order RP-100926") or a
// generic placeholder ("Production Job", "Auto Design") — production jobs with
// no concept name are labelled by their order number on purpose. That label is
// fine for UI, but it must NEVER reach a generative render prompt: Gemini will
// paint the literal text ("Order RP-100926") onto the wrap. This strips the
// order number, the (V2) version suffix, and generic placeholders, returning ""
// when nothing meaningful is left — callers then rely on the reference image
// alone instead of feeding a junk name into the render.
const designNameForPrompt = (rawName: string | null | undefined): string => {
  let name = (rawName || "").replace(/\s*\(V\d+\)\s*$/i, "").trim();
  // "Order RP-100926", "Order #100926", bare "RP-100926" / order codes
  if (/^order\b/i.test(name) || /\bRP[-\s]?\d{4,}\b/i.test(name)) return "";
  // Generic placeholders that carry no design intent
  if (/^(production job|auto design|custom(\s+graphics?)?|customer design|revised design|design|untitled|new design)$/i.test(name)) return "";
  return name;
};

/**
 * Extract DesignIQ mode and commercial details from a render record.
 * Checks admin_notes first, then used to fall back to a legacy design-row lookup
 * (for records created before the mode was stored in admin_notes).
 * Patches admin_notes in the DB if a lookup succeeds, so future reads are fast.
 */
async function getDesignIQModeAndDetails(render: any): Promise<{
  mode: "commercial" | "restyle";
  companyName?: string;
  phone?: string;
  mascot?: string;
  industryType?: string;
  bulletPoints?: string[];
}> {
  // GENERATION MODES REMOVED. There is ONE unified path: restyle (clone the hero
  // faithfully). The old commercial/restyle/recreatepro branching injected company
  // branding (name/website/phone) into regenerated views — the engine then BAKED a
  // logo/URL (e.g. "WePrintWraps.com") onto the wrap that was never part of the
  // design, and garbled it. Whatever branding a design legitimately has lives in
  // the hero render and is preserved by cloning it — never re-injected. So this
  // always returns restyle with NO branding fields, killing the injection class of
  // bugs across every caller (missing views, retry, restyle-on-new-vehicle).
  return { mode: "restyle" };
}

/**
 * Fetch VisionBoard image URLs for a render.
 * Checks the admin_notes cache; the legacy design-row fallback behind it is gone.
 * Patches admin_notes so future reads are instant.
 */
/**
 * Coerce a reference entry into a plain image URL string.
 *
 * VisionBoard refs are stored as `{ slotLabel, storageUrl }` objects, but they
 * leak into the admin_notes `visionboard_image_urls` cache in three shapes:
 * a plain URL string, the object itself, or — the bug seen in prod — the object
 * JSON-stringified (`'{"slotLabel":"Master Artboard","storageUrl":"https://…"}'`).
 * The last one is a "string" so it passed the old `typeof === "string"` filter
 * and reached `new URL()` in revise-render, which threw "Invalid URL" and
 * SILENTLY DROPPED the reference (logs showed `refs: 0` on a reference-match
 * edit). Unwrap all three shapes to the underlying URL.
 */
function normalizeRefUrl(entry: any): string | null {
  if (!entry) return null;
  if (typeof entry === "object") return entry.storageUrl || entry.url || null;
  if (typeof entry === "string") {
    const s = entry.trim();
    if (s.startsWith("{") && (s.includes("storageUrl") || s.includes("url"))) {
      try {
        const o = JSON.parse(s);
        return o?.storageUrl || o?.url || null;
      } catch { return null; }
    }
    return /^https?:\/\//i.test(s) ? s : null;
  }
  return null;
}

async function getVisionBoardImageUrls(render: any): Promise<string[]> {
  // 1. Check admin_notes cache — normalize because older writes cached ref
  //    OBJECTS (or their JSON string) here, not plain URLs. See normalizeRefUrl.
  try {
    const notes = JSON.parse(render.admin_notes || "{}");
    if (notes.visionboard_image_urls && Array.isArray(notes.visionboard_image_urls) && notes.visionboard_image_urls.length > 0) {
      const urls = notes.visionboard_image_urls.map(normalizeRefUrl).filter(Boolean) as string[];
      if (urls.length > 0) return urls;
    }
  } catch {}

  // No second lookup, and nothing to patch. The reference-URL cache above was a
  // cache OF a legacy design row, and the fallback behind it matched that row by
  // hero URL because the two stores had no shared key. Here the run tables are
  // the design, `readRevisionStudioDesign` projects them, and a reference the
  // server did not record is honestly absent rather than searched for.
  return [];
}

// Synchronous version for non-async contexts (reads admin_notes only)
function getDesignIQMode(render: any): "commercial" | "restyle" {
  try {
    const notes = JSON.parse(render.admin_notes || "{}");
    if (notes.designiq_mode === "commercial") return "commercial";
  } catch {}
  return "restyle";
}

function getCommercialDetails(render: any): Record<string, unknown> {
  try {
    const notes = JSON.parse(render.admin_notes || "{}");
    if (notes.designiq_mode === "commercial") {
      return {
        companyName: notes.company_name,
        phone: notes.phone,
        mascot: notes.mascot,
        industryType: notes.industry_type,
        bulletPoints: notes.brand_keywords,
      };
    }
  } catch {}
  return {};
}

const VIEW_ORDER = ["side", "passenger-side", "hood_detail", "front", "rear", "close-up", "roof"];

/**
 * Stable empties for the feeds and lookups DesignProAI does not have.
 *
 * Module constants rather than inline `[]` / `{}` literals: several of these
 * are dependencies of the grid's `useMemo`, and a fresh literal on every render
 * would re-run the whole merge every time anything else changed.
 */
const EMPTY_LEGACY_FEED: any[] = [];
const EMPTY_ORDER_NUMBERS: Record<string, string> = {};

/**
 * The `__source` tag a card from the retired production-job feed carried.
 *
 * Nothing sets it any more -- that feed is empty -- but the checks against it
 * stay so a card from an older cached query is still routed the way it was.
 */
const LEGACY_PANELIZER_SOURCE = "panelizer-job";

/**
 * The camera a view is named by -> the production surface it shows.
 *
 * Exact, never fuzzy: this is how a page keyed on cameras asks the server for
 * assets keyed on surfaces. Close-up is deliberately absent -- it is a framing
 * of the driver side, not a seventh surface, and offering the driver's panel
 * under it would be the driver-substitution the client contract forbids.
 */
const SURFACE_KEY_FOR_VIEW: Record<string, string> = {
  side: "driver",
  "passenger-side": "passenger",
  hood_detail: "hood",
  front: "front",
  rear: "rear",
  roof: "roof",
};

/**
 * Camera distance/framing is geometry, not a design revision. Sending one of
 * these requests through revise-render lets the image model rotate the vehicle,
 * crop a bumper, or invent a new perspective while claiming it only reframed
 * the approved view. Until the source-bound reframe control supplies an exact
 * crop receipt, fail closed and preserve the approved pixels.
 */
export function isCameraFramingOnlyRevision(notes: string): boolean {
  const request = String(notes || "").trim();
  if (!request) return false;
  return (
    /\b(zoom\s*(?:in|out)|reframe|reframing|framing|field\s+of\s+view)\b/i.test(request) ||
    /\b(?:camera|vehicle|car)\b[\s\S]{0,40}\b(?:closer|farther|further|nearer|larger|smaller)\b/i.test(request) ||
    /\b(?:closer|farther|further|nearer)\b[\s\S]{0,40}\b(?:camera|vehicle|car|frame)\b/i.test(request) ||
    /\b(?:fill|take\s+up)\s+more\s+of\s+the\s+frame\b/i.test(request) ||
    /\b(?:more|less)\s+(?:space|room|background)\s+around\s+(?:the\s+)?(?:vehicle|car)\b/i.test(request)
  );
}

/**
 * Turn uploaded Layer-2 logos (from the DesignPro two-box entry) into placed,
 * editable LogoLayers. They are stacked down the door area at a sensible
 * default size so the user immediately sees them and can drag/scale/rotate.
 */
function seedLogoLayersFromHandoff(logos: { url: string; name?: string }[]): LogoLayer[] {
  return logos.map((logo, i) => ({
    id: `upl_seed_${Date.now().toString(36)}_${i}`,
    kind: "uploaded" as const,
    sourceUrl: logo.url,
    name: logo.name || `Logo ${i + 1}`,
    placement: {
      // Centered horizontally, stacked vertically around the door.
      xPct: 0.5,
      yPct: 0.42 + i * 0.16,
      size: "md" as const,
      sizePercent: 0.22,
      rotationDeg: 0,
    },
  }));
}

// A trailer has no hood and no roof glamour shot, so the canonical car view
// set produces nonsense angles for it. This filtered set is used to decide
// WHICH views to request/generate per vehicle type. The camera-angle
// definitions in view-angles-os.ts are untouched.
const TRAILER_VIEW_ORDER = ["side", "passenger-side", "front", "rear", "close-up"];

function getViewOrderForVehicle(render: any): string[] {
  const t = String(render?.vehicle_type || "").toLowerCase();
  const blob = `${t} ${render?.vehicle_make || ""} ${render?.vehicle_model || ""}`.toLowerCase();
  const isTrailer = t === "trailer" || /\btrailer\b|enclosed|cargo|gooseneck|flatbed/.test(blob);
  return isTrailer ? [...TRAILER_VIEW_ORDER] : [...VIEW_ORDER];
}
const VIEW_LABELS: Record<string, string> = {
  roof: "Roof",
  side: "Driver Side",
  "passenger-side": "Passenger Side",
  hood_detail: "Hood Detail",
  front: "Front",
  rear: "Rear",
  "close-up": "Close-Up",
  hero: "Hero",
  myvehicle_edit: "MyVehicle Edit",
};

const PANEL_TARGETS = [
  { key: "hood", label: "Hood" },
  { key: "roof", label: "Roof" },
  { key: "doors", label: "Doors" },
  { key: "fenders", label: "Fenders" },
  { key: "front-bumper", label: "Front Bumper" },
  { key: "rear-bumper", label: "Rear Bumper" },
  { key: "trunk", label: "Trunk/Tailgate" },
  { key: "quarter-panels", label: "Quarter Panels" },
];

// Which view angles actually SHOW a given panel. Used to detect when a revision
// names a panel that lives on a DIFFERENT angle than the one being edited.
const PANEL_KEY_VIEWS: Record<string, string[]> = {
  hood: ["hood_detail", "front"],
  roof: ["roof"],
  doors: ["side", "passenger-side"],
  fenders: ["side", "passenger-side", "front"],
  "front-bumper": ["front"],
  "rear-bumper": ["rear"],
  trunk: ["rear"],
  "quarter-panels": ["side", "passenger-side", "rear"],
};

// Free-text panel words → the view keys that show them. Kept narrow (strong,
// unambiguous panel nouns only) so we don't over-trigger on generic spatial
// language like "front" or "rear" used as a direction.
const PANEL_WORD_VIEWS: Array<[RegExp, string[]]> = [
  [/\bhood\b/i, ["hood_detail", "front"]],
  [/\b(tailgate|trunk|lift ?gate|rear gate)\b/i, ["rear"]],
  [/\broof\b/i, ["roof"]],
  [/\b(rear|back)\s+bumper\b/i, ["rear"]],
  [/\b(front\s+bumper|grille|grill)\b/i, ["front"]],
];

/**
 * A revision needs to run across ALL views when it names a panel that is NOT
 * visible on the angle currently being edited. Example: editing the Driver Side
 * but the request says "make the hood and tailgate solid" — the side image has
 * no hood/tailgate to change, so editing only that view silently does nothing.
 * Returns true when the request (typed notes or selected panel chips) targets a
 * panel that lives on a different angle, so the caller can promote the edit to
 * "All Views" and the right angles actually update.
 */
function revisionNeedsAllViews(
  notes: string,
  panelTargets: string[] | undefined,
  currentViewKey: string | undefined,
): boolean {
  const cur = currentViewKey || "side";
  for (const [re, views] of PANEL_WORD_VIEWS) {
    if (re.test(notes || "") && !views.includes(cur)) return true;
  }
  for (const key of panelTargets || []) {
    const views = PANEL_KEY_VIEWS[key];
    if (views && !views.includes(cur)) return true;
  }
  return false;
}

/**
 * Resolve the SPECIFIC view angles a revision should touch based on the panels
 * it names. Editing "the hood" should reach ONLY the angles that actually show
 * the hood (hood_detail + front) — not every angle, which used to drag the rear
 * along for the ride and silently change panels the customer never mentioned.
 * Returns the de-duplicated list of view keys for every panel named in the typed
 * notes or the selected panel chips. Empty when no specific panel is named.
 */
function panelViewsForRevision(
  notes: string,
  panelTargets: string[] | undefined,
): string[] {
  const out = new Set<string>();
  for (const [re, views] of PANEL_WORD_VIEWS) {
    if (re.test(notes || "")) views.forEach((v) => out.add(v));
  }
  for (const key of panelTargets || []) {
    (PANEL_KEY_VIEWS[key] || []).forEach((v) => out.add(v));
  }
  return Array.from(out);
}

const MODE_LABELS: Record<string, string> = {
  colorpro: "ColorPro\u2122",
  ColorPro: "ColorPro\u2122",
  designpanelpro: "DesignProAI\u2122",
  fadewraps: "FadeWraps",
  wbty: "WBTY",
  approvemode: "ApproveMode",
  graphicspro: "GraphicsPro",
  GraphicsPro: "GraphicsPro",
  CustomStyling: "CustomStyling",
  ColorProEnhanced: "ColorPro Enhanced",
  inkfusion: "ColorPro\u2122",
  myvehicle_colorpro: "MyVehiclePro",
  myvehicle_designpanelpro: "MyVehiclePro",
  myvehicle_fadewraps: "MyVehiclePro",
  myvehicle_graphicspro: "MyVehiclePro",
  myvehicle_deploy: "MyVehiclePro",
  wallpro: "WallPro",
  recreatepro: "RecreatePro\u2122",
};

function isMyVehicleRender(render: any): boolean {
  return (render.mode_type || "").startsWith("myvehicle_");
}

/** Format vehicle year/make/model, handling "Unknown" placeholders gracefully. */
function formatVehicleInfo(render: any): string {
  const year = render.vehicle_year ?? "";
  const make = render.vehicle_make ?? "";
  const model = render.vehicle_model ?? "";
  const isUnknownMake = !make || make === "Unknown";
  const isUnknownModel = !model || model === "Unknown";

  if (isUnknownMake && isUnknownModel) {
    return year ? `${year} Vehicle` : "Unknown Vehicle";
  }
  if (isUnknownMake) return `${year} ${model}`.trim();
  if (isUnknownModel) return `${year} ${make}`.trim();
  return `${year} ${make} ${model}`.trim() || "Unknown Vehicle";
}

/** Clean up design name, especially for recovered records. */
function formatDesignName(render: any): string {
  const name = render.design_file_name || render.color_name || "";
  // "Recovered - Unknown Unknown [designpanelpro]" → "Recovered Design (DesignProAI™)"
  if (/^Recovered\b/.test(name)) {
    const modeLabel = MODE_LABELS[render.mode_type] || render.mode_type || "";
    return `Recovered Design${modeLabel ? ` (${modeLabel})` : ""}`;
  }
  // Prepend manufacturer if available and not already in the name
  const mfr = render.infusion_color_id || "";
  if (mfr && name && !name.toLowerCase().startsWith(mfr.toLowerCase())) {
    return `${mfr} ${name}`;
  }
  return name;
}

/**
 * Get the list of missing views for a render by comparing render_urls keys
 * against the canonical VIEW_ORDER.
 */
function getMissingViews(render: any): string[] {
  const order = getViewOrderForVehicle(render);
  const urls = render?.render_urls as Record<string, string> | null;
  if (!urls) return [...order];
  // The driver/"side" slot is the hero render — but different tools save it under
  // different keys (GraphicsPro/DesignPro persist it as "hero" or "driver-side",
  // not "side"). Without aliasing, getMissingViews thinks "side" is missing and
  // REGENERATES the customer's existing driver view into a worse one. Treat the
  // slot as present if any equivalent key already holds an image.
  const SIDE_ALIASES = ["side", "hero", "driver-side", "driver_side", "primary", "mockup"];
  return order.filter((k) => {
    if (k === "side") return !SIDE_ALIASES.some((a) => urls[a]);
    return !urls[k];
  });
}

/**
 * Upload a data URL (e.g., from canvas) to Supabase storage and return a public URL.
 * Used for passenger-side mirror images.
 */
async function uploadDataUrlToStorage(dataUrl: string): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  const userId = user?.id || "anonymous";
  const timestamp = Date.now();
  const mimeMatch = dataUrl.match(/^data:(image\/\w+);base64,/);
  const mimeType = mimeMatch?.[1] || "image/png";
  const ext = mimeType.includes("png") ? "png" : "jpg";
  const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, "");
  const binaryStr = atob(base64Data);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  const filePath = `renders/${userId}/mirrors/passenger_${timestamp}.${ext}`;
  const { error } = await supabase.storage
    .from("wrap-files")
    .upload(filePath, bytes, { contentType: mimeType, upsert: true });
  if (error) throw new Error(`Mirror upload failed: ${error.message}`);
  const { data: { publicUrl } } = supabase.storage.from("wrap-files").getPublicUrl(filePath);
  return publicUrl;
}

/**
 * Reconstruct colorData for re-generation from an existing visualization record.
 * The edge function uses colorData + vehicle + modeType to match and merge views.
 */
function buildColorDataFromRender(render: any): Record<string, any> {
  const modeType = render.mode_type || "";
  const base: Record<string, any> = {
    colorName: render.color_name || "Custom",
    hex: render.color_hex || "#000000",
    finish: render.finish_type || "Gloss",
  };

  if (modeType === "approvemode" && render.custom_design_url) {
    const urls = render.render_urls as Record<string, string> | null;
    const heroUrl = urls?.side || urls?.hero || urls?.["driver-side"];
    return {
      ...base,
      designUrl: render.custom_design_url,
      ...(heroUrl ? { heroReferenceUrl: heroUrl } : {}),
    };
  }
  if ((modeType === "CustomStyling" || modeType === "ColorProEnhanced") && render.custom_styling_prompt_key) {
    return { ...base, customStylingPrompt: render.custom_styling_prompt_key };
  }
  if (modeType === "GraphicsPro" && render.custom_styling_prompt_key) {
    return { ...base, customStylingPrompt: render.custom_styling_prompt_key, colorLibrary: "graphicspro" };
  }
  if ((modeType === "fadewraps" || modeType === "wbty") && render.custom_swatch_url) {
    return { ...base, patternUrl: render.custom_swatch_url };
  }
  if ((modeType === "designpanelpro" || modeType === "recreatepro") && render.custom_design_url) {
    const urls = render.render_urls as Record<string, string> | null;
    const heroUrl = urls?.side || urls?.hero || urls?.["driver-side"];
    // Parse design anchor text from admin_notes if available
    let anchorText: string | null = null;
    try {
      const notes = JSON.parse(render.admin_notes || "{}");
      anchorText = notes.design_anchor_text || null;
    } catch {}
    return {
      ...base,
      panelUrl: render.custom_design_url,
      panelName: render.design_file_name || render.color_name || "Custom Panel Design",
      ...(heroUrl ? { heroReferenceUrl: heroUrl } : {}),
      ...(anchorText ? { designAnchorText: anchorText } : {}),
    };
  }
  if (modeType === "inkfusion") {
    return { ...base };
  }

  // MyVehicle renders - extract the underlying tool source from mode_type suffix
  if (modeType.startsWith("myvehicle_")) {
    const toolSuffix = modeType.replace("myvehicle_", "");
    const toolSource = toolSuffix || "colorpro";
    if (toolSuffix === "designpanelpro" && render.custom_design_url) {
      return {
        ...base,
        toolSource,
        panelUrl: render.custom_design_url,
        panelName: render.design_file_name || render.color_name || "Custom Panel Design",
      };
    }
    if ((toolSuffix === "fadewraps" || toolSuffix === "wbty") && render.custom_swatch_url) {
      return { ...base, toolSource, patternUrl: render.custom_swatch_url };
    }
    return { ...base, toolSource };
  }

  // Default (colorpro and others)
  return base;
}

// ---------------------------------------------------------------------------
// VisionBoard Inline Uploader (simplified for RevisionStudioIQ)
// ---------------------------------------------------------------------------

function InlineVisionBoard({
  images,
  onChange,
  intent,
  onIntentChange,
  disabled = false,
  onEnlarge,
}: {
  images: VisionBoardImage[];
  onChange: (imgs: VisionBoardImage[]) => void;
  intent: VisionBoardIntent;
  onIntentChange: (i: VisionBoardIntent) => void;
  disabled?: boolean;
  onEnlarge?: (img: VisionBoardImage) => void;
}) {
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file (JPG, PNG, WebP)");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Please upload an image smaller than 10MB");
      return;
    }
    setIsUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id || "anonymous";
      const timestamp = Date.now();
      const ext = file.name.split(".").pop();
      const filePath = `vision-board-refs/${userId}/${timestamp}.${ext}`;

      const { error } = await supabase.storage
        .from("patterns")
        .upload(filePath, file, { cacheControl: "3600", upsert: false });
      if (error) throw error;

      const { data: { publicUrl } } = supabase.storage.from("patterns").getPublicUrl(filePath);
      onChange([...images, { slotLabel: `Reference ${images.length + 1}`, storageUrl: publicUrl }]);
      toast.success("Reference uploaded");
    } catch (error: any) {
      toast.error(error.message || "Upload failed");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Palette className="w-4 h-4 text-blue-magenta" />
        <span className="text-xs font-bold text-gradient-blue-magenta">VisionBoardIQ</span>
        <Badge className="bg-blue-magenta-subtle text-blue-magenta border-0 text-[9px] px-1.5 py-0">AI</Badge>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {images.map((img, i) => (
          <div
            key={img.storageUrl}
            className="relative aspect-square rounded-lg overflow-hidden border border-zinc-700 group cursor-pointer"
            onClick={() => onEnlarge?.(img)}
          >
            <img src={img.storageUrl} alt={img.slotLabel} className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
              <Maximize2 className="w-4 h-4 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" />
            </div>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onChange(images.filter((_, idx) => idx !== i)); }}
              className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/90"
              disabled={disabled}
            >
              <X className="w-3 h-3 text-white" />
            </button>
            <div className="absolute bottom-0.5 left-0.5 right-0.5">
              <span className="text-[8px] text-white/70 bg-black/50 px-1 py-0.5 rounded">
                {img.slotLabel} — tap to enlarge
              </span>
            </div>
          </div>
        ))}
        {images.length < 4 && (
          <div
            onClick={() => !disabled && !isUploading && fileInputRef.current?.click()}
            className={cn(
              "aspect-square rounded-lg border-2 border-dashed border-zinc-700 cursor-pointer",
              "hover:border-blue-magenta hover:bg-blue-magenta-subtle transition-all",
              "flex flex-col items-center justify-center gap-1",
              (disabled || isUploading) && "pointer-events-none opacity-50"
            )}
          >
            {isUploading ? (
              <Loader2 className="w-4 h-4 text-blue-magenta animate-spin" />
            ) : (
              <>
                <ImagePlus className="w-4 h-4 text-zinc-500" />
                <span className="text-[9px] text-zinc-500">Add</span>
              </>
            )}
          </div>
        )}
      </div>

      {images.length > 0 && (
        <div className="flex gap-2">
          <button
            onClick={() => onIntentChange("style_inspiration")}
            className={cn(
              "flex-1 text-[10px] py-1.5 px-2 rounded border transition-all",
              intent === "style_inspiration"
                ? "border-blue-magenta bg-blue-magenta-subtle text-blue-magenta"
                : "border-zinc-700 text-zinc-500 hover:border-zinc-500"
            )}
          >
            Style Inspiration
          </button>
          <button
            onClick={() => onIntentChange("exact_reference")}
            className={cn(
              "flex-1 text-[10px] py-1.5 px-2 rounded border transition-all",
              intent === "exact_reference"
                ? "border-blue-magenta bg-blue-magenta-subtle text-blue-magenta"
                : "border-zinc-700 text-zinc-500 hover:border-zinc-500"
            )}
          >
            Exact Reference
          </button>
        </div>
      )}

      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelect} className="hidden" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// StoredOrGenerated2DProof — loads the canonical flat_proof_url (if any) for
// the selected render and hands it to TwoDProofSheet as `initialProofUrl` so
// re-opens display instantly without triggering another AI generation. Only
// the user clicking Regenerate/Revise inside TwoDProofSheet kicks off a new
// Gemini call; when that succeeds, `onProofGenerated` persists the new URL
// back to the DB so future opens stay instant.
//
// Lookup order:
// The proof comes from the design's own projection, which carries the Call-8
// customer artifact the server selected by role.
// ---------------------------------------------------------------------------

// InlineStoredProof — PRELOADS the saved 2D production proof for the selected
// render and shows it inline (no dialog, no click). Resolves the canonical
// proof URL the same way the dialog does, from the design's own projection.
// Renders nothing until a stored proof exists, so it's always additive.
function InlineStoredProof({ render }: { render: any }) {
  const id = render?.id || null;
  const { data: proofUrl } = useQuery({
    queryKey: ["revstudio-inline-2dproof", id, render?.admin_notes],
    enabled: !!id,
    queryFn: async () => {
      let notes: Record<string, any> = {};
      try { notes = render?.admin_notes ? JSON.parse(render.admin_notes) : {}; } catch { /* not JSON */ }
      // Re-read the freshest row from the server by id — the in-memory copy can
      // be stale (Call 8 publishes the proof after the design list loaded),
      // which otherwise hides an already-built proof from this preload.
      if (id) {
        const fresh = await readRevisionStudioDesign(String(id)).catch(() => null);
        if (fresh?.admin_notes) {
          try { notes = JSON.parse(fresh.admin_notes); } catch { /* keep in-memory */ }
        }
      }
      // The projected proof is the Call-8 customer artifact the server selected
      // by role, so there is no longer a class of wrong value to screen out --
      // a 3D render can never arrive under this key. Absent means Call 8 has not
      // published one yet.
      return typeof notes?.flat_proof_url === "string" ? notes.flat_proof_url : null;
    },
  });
  if (!proofUrl) return null;
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold text-zinc-200">2D Production Proof</span>
        <span className="ml-auto text-[10px] text-zinc-500">preloaded</span>
      </div>
      <a href={proofUrl} target="_blank" rel="noreferrer" className="block rounded-md overflow-hidden border border-zinc-800 bg-white">
        <img src={proofUrl} alt="2D Production Proof" className="w-full object-contain" loading="eager" />
      </a>
    </div>
  );
}

function StoredOrGenerated2DProof({
  render,
  renderFallback,
}: {
  render: any;
  renderFallback: (opts: {
    initialProofUrl: string | null;
    onProofGenerated: (proofUrl: string) => void | Promise<void>;
    workflowStatus?: string;
    workflowFailedStage?: { stage_key?: string; error_message?: string } | null;
    hasActiveRun?: boolean;
    onRetryBuild?: () => void | Promise<void>;
  }) => React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const autoProofRunRef = useRef<string | null>(null);
  const [initialProofUrl, setInitialProofUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // ONE IDENTITY. In RestylePro this resolver walked a card's id through three
  // stores -- visualization, panelizer job, entice pack -- because a design had
  // three ids and a QC-queue card carried the wrong one for this dialog. The
  // run tables give a design exactly one id, and it is the id the card carries,
  // so the resolution is identity. The variable stays so the code below reads
  // unchanged, and the loading flag stays false because nothing is fetched.
  const resolvedVizId = render?.id ? String(render.id) : null;
  const resolvingVizId = false;
  const { data: enticeWorkflowStatus } = useQuery({
    queryKey: ["revstudio-entice-proof-status", resolvedVizId],
    enabled: !!resolvedVizId,
    queryFn: async () => {
      try {
        return await getDesignBuildStatus({
          visualizationId: String(resolvedVizId),
        });
      } catch (error: any) {
        if (/not found/i.test(String(error?.message || ""))) return null;
        throw error;
      }
    },
    retry: false,
    refetchInterval: (query) => {
      const status = query.state.data;
      const workflowStatus = String(
        status?.workflowRun?.workflow_status || "",
      );
      if (!workflowStatus) {
        return status?.activePack?.proof_artifact?.url
          ? false
          : 3_000;
      }
      return ["completed", "cancelled", "failed"].includes(workflowStatus)
        ? false
        : 3_000;
    },
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setInitialProofUrl(null);

      // Parse the IN-MEMORY admin_notes once — used as an optimistic source and
      // for the designiq_generation_id lookup. This copy can be STALE: the 8th-
      // call 2D proof (and any in-studio Generate) saves flat_proof_url to the
      // DB AFTER the RevisionStudio render list was loaded, so trusting only the
      // in-memory notes made the 2D button miss an already-saved proof and
      // needlessly regenerate. So we ALWAYS re-read the latest from the DB below.
      let notes: Record<string, any> = {};
      if (render?.admin_notes) {
        try { notes = JSON.parse(render.admin_notes); } catch { /* not JSON */ }
      }

      // Re-read the freshest projection for this design from the server, so a
      // proof Call 8 published after the list loaded is always found. Falls back
      // to the in-memory notes when the run can't be read.
      let freshNotes: Record<string, any> = notes;
      const notesVizId = resolvedVizId || render?.id;
      if (notesVizId) {
        const fresh = await readRevisionStudioDesign(String(notesVizId)).catch(() => null);
        if (fresh?.admin_notes) {
          try { freshNotes = JSON.parse(fresh.admin_notes); } catch { freshNotes = notes; }
        }
      }

      // The projected proof is the Call-8 customer artifact the server selected
      // by role. There is no second store to fall back to, and no class of wrong
      // value to screen out: absent means Call 8 has not published one yet, and
      // the sheet's own build action is what produces it.
      const cachedUrl =
        (typeof freshNotes.flat_proof_url === "string" && freshNotes.flat_proof_url)
        || (typeof notes.flat_proof_url === "string" && notes.flat_proof_url)
        || null;

      if (cachedUrl) {
        if (!cancelled) {
          setInitialProofUrl(cachedUrl);
          setLoading(false);
        }
        return;
      }

      if (!cancelled) {
        setInitialProofUrl(null);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [render?.id, render?.admin_notes, resolvedVizId]);

  // Submit (or retry) the durable proof build for the CURRENTLY saved revision.
  // Always re-reads updated_at immediately before submitting, so it can never
  // trip revision_source_changed on a stale cached timestamp (the #1 cause of a
  // run that never gets created and leaves the proof spinner hanging forever).
  // Exposed as onRetryBuild so the sheet can recover a failed / never-started
  // run with one click instead of the user waiting on nothing.
  const startOrRetryBuild = useCallback(async () => {
    if (!render?.id) {
      toast.error("Could not request a 2D proof — no design is selected.");
      return;
    }
    try {
      // Re-read the design from the server before submitting anything. A run
      // the gateway does not own answers null, which is the honest "there is
      // nothing to build from" -- and saying so here, before the submit, is
      // what stops the catch below reporting a server rejection that never
      // happened. That wrong string is what sent several sessions hunting a
      // non-existent RPC bug.
      const buildVizId = String(resolvedVizId || render.id);
      const frozen = await readRevisionStudioDesign(buildVizId);
      if (!frozen) {
        throw new Error(
          `this design (${buildVizId}) is not a saved revision, so there is nothing to build from — reopen it from the Designs list`,
        );
      }
      const generationId = frozen.id;
      const currentRunId = String(
        enticeWorkflowStatus?.workflowRun?.id || "",
      ).trim();
      const currentStatus = String(
        enticeWorkflowStatus?.workflowRun?.workflow_status || "",
      );
      // A finished run has nothing to resume. `resume_designpro_entice_pack`
      // returns `{resumedStages: 0}` for 'completed' and 'cancelled' by design,
      // so resuming one reported success to the user and did nothing at all --
      // which is what this button did on every click once a run had finished.
      // The user reaches this button only when there is no stored proof and no
      // active run, so the honest action there is to START one.
      const resumable =
        Boolean(currentRunId) &&
        currentStatus !== "completed" &&
        currentStatus !== "cancelled";
      const accepted = resumable
        ? await resumeDesignBuild(currentRunId, currentStatus === "failed")
        : await requestDesignBuild({
            visualizationId: frozen.id,
            expectedUpdatedAt: frozen.updated_at,
            generationId,
            trigger: "proof_requested",
            change: {
              // 'edit' is what the database stores for this either way: the
              // enqueue RPC maps any change type outside generate/revision to
              // 'edit'. Saying so here keeps the call site honest instead of
              // sending a value the contract does not define.
              type: "edit",
              viewKeys: Object.keys(frozen.render_urls || {}).sort(),
            },
          });
      toast.success(
        accepted.idempotent
          ? "The saved revision is already being processed on the server."
          : "Production previews are updating on the server. You can close this page safely.",
      );
      // Force the status poll to pick the new/again-running run up immediately.
      queryClient.invalidateQueries({ queryKey: ["revstudio-entice-proof-status", resolvedVizId] });
    } catch (error: any) {
      toast.error(
        `The server did not accept this revision: ${error?.message || error}`,
      );
    }
  }, [render?.id, resolvedVizId, queryClient, enticeWorkflowStatus?.workflowRun]);

  const persistProofUrl = useCallback(async (proofUrl: string) => {
    if (!render?.id || !proofUrl) {
      toast.error("Could not request a 2D proof — no design is selected.");
      return;
    }
    await startOrRetryBuild();
  }, [render?.id, startOrRetryBuild]);

  // Opening 2D Proof is Call 7's durable trigger. It must not depend on a
  // previous browser save, a manual retry button, or a 58-minute sweep. Start
  // a missing run, retry a failed run, or poke a queued/running run exactly
  // once for each observed durable state. The server resume path never steals
  // an unexpired running lease; it only makes pending/retryable work available.
  useEffect(() => {
    if (loading || initialProofUrl || !render?.id) return;
    // Wait for the id resolver: while it runs, the status query is disabled and
    // every card reads as "missing", which would auto-submit against an id that
    // is about to resolve to a different design. A card that resolves to
    // NOTHING never auto-fires -- the manual button still explains why.
    if (resolvingVizId || !resolvedVizId) return;
    const runId = String(enticeWorkflowStatus?.workflowRun?.id || "none");
    const status = String(
      enticeWorkflowStatus?.workflowRun?.workflow_status || "missing",
    );
    if (["completed", "cancelled"].includes(status)) return;
    // ⛔ NEVER AUTO-REBUILD A RUN THAT DEFERRED THE PROOF.
    //
    // Call 8 defers on a condition of the design -- a dimension total that will
    // not reconcile, a font the run cannot load -- and a fresh run reproduces
    // it exactly. So auto-submitting on "no proof yet" turned into a loop:
    // submit, defer, still no proof, the run id changed so the attempt key
    // changed, submit again. A run really was always in flight, which is why
    // the sheet showed "Building Production Proof on Server" indefinitely
    // instead of the deferral -- the honest state could never be reached
    // because this effect kept manufacturing an active run in front of it.
    //
    // The manual retry stays: a human who has read the reason may still want to
    // try, and a fix deployed in between makes that the right call.
    if ((enticeWorkflowStatus as any)?.stages?.some(
      (s: any) => s?.key === "proof.build" && s?.deferred === true,
    )) return;
    const proofUrl = String(
      enticeWorkflowStatus?.proofUrl ||
        enticeWorkflowStatus?.activePack?.proof_artifact?.url ||
        "",
    ).trim();
    if (proofUrl) return;
    const attemptKey = `${render.id}:${runId}:${status}`;
    if (autoProofRunRef.current === attemptKey) return;
    autoProofRunRef.current = attemptKey;
    void startOrRetryBuild();
  }, [
    loading,
    initialProofUrl,
    render?.id,
    resolvingVizId,
    resolvedVizId,
    enticeWorkflowStatus,
    startOrRetryBuild,
  ]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
        <span className="text-sm text-zinc-400">Loading 2D proof...</span>
      </div>
    );
  }

  const workflowStatus = String(
    enticeWorkflowStatus?.workflowRun?.workflow_status || "",
  );
  const workflowProofUrl = String(
    enticeWorkflowStatus?.proofUrl ||
      enticeWorkflowStatus?.activePack?.proof_artifact?.url ||
      "",
  ).trim();
  // A rebuilding workflow must not hide a previously verified proof. The new
  // run replaces it only after proof.build publishes a verified URL.
  const observedProofUrl = workflowProofUrl || initialProofUrl;

  // Surface the failed stage + reason (and whether a run is actually in flight)
  // so the sheet stops showing an eternal spinner for a failed / never-created
  // run. The status payload carries stages[] with per-stage status/error.
  const stages = Array.isArray((enticeWorkflowStatus as any)?.stages)
    ? (enticeWorkflowStatus as any).stages
    : [];
  const workflowFailedStage = [...stages].reverse().find((s: any) => s?.status === "failed") || null;
  const packStatus = String((enticeWorkflowStatus as any)?.enticePack?.status || "");
  // A DEFERRED CALL 8 IS AN OUTCOME, NOT A BUILD IN PROGRESS.
  //
  // proof.build defers rather than fails so a proof the tool cannot draw does
  // not hold manufacturing hostage -- it completes with `deferred: true` and no
  // artifact. Every signal this component had said "fine": the run is
  // completed, nothing failed, nothing is queued. So the sheet fell through to
  // its spinner and told the customer the server was "creating and verifying
  // this proof" about work that finished minutes ago and will never resume.
  //
  // `workflowFailedStage` cannot catch it, because a deferral is a SUCCESS row.
  // This reads the deferral the gateway now projects and reports it as what it
  // is, with the reason the stage recorded.
  const deferredProofStage = stages.find(
    (s: any) => s?.key === "proof.build" && s?.deferred === true,
  ) || null;
  const hasActiveRun =
    ["queued", "running"].includes(workflowStatus) || packStatus === "building";

  return (
    <>
      {renderFallback({
        initialProofUrl: observedProofUrl,
        onProofGenerated: persistProofUrl,
        workflowStatus,
        // The sheet already renders exactly the right thing for this -- "the
        // durable workflow stopped at proof.build, so no 2D proof was
        // produced", the reason, and a retry. It just never received it,
        // because a deferral is not a failed stage. Reported through the
        // existing surface rather than a new one: the sheet is the migrated
        // component and does not need another branch.
        workflowFailedStage: workflowFailedStage
          || (deferredProofStage && !observedProofUrl
            ? {
              stage_key: "proof.build",
              error_message: `${(deferredProofStage as any).deferredReason}: ${(deferredProofStage as any).deferredMessage || "the stage recorded no message"}`,
            }
            : null),
        hasActiveRun,
        onRetryBuild: startOrRetryBuild,
      })}
    </>
  );
}

// Vehicle Group Card — collapses all designs for same vehicle into one card
// with left/right arrows to browse designs
// ---------------------------------------------------------------------------

function VehicleGroupCard({
  allVersions,
  failedImages,
  setFailedImages,
  getMissingViews,
  getViews,
  formatVehicleInfo,
  formatDesignName,
  deleteRender,
  onSelect,
  onSendProof,
  onDownloadAll,
  onBuildFiles,
  orderNumberByRenderId,
}: {
  allVersions: any[];
  failedImages: Set<string>;
  setFailedImages: React.Dispatch<React.SetStateAction<Set<string>>>;
  getMissingViews: (r: any) => string[];
  getViews: (r: any) => { key: string; url: string }[];
  formatVehicleInfo: (r: any) => string;
  formatDesignName: (r: any) => string;
  deleteRender: any;
  onSelect: (r: any) => void;
  onBuildFiles?: (r: any) => void;
  onSendProof?: (r: any) => void;
  onDownloadAll?: (r: any) => Promise<void> | void;
  orderNumberByRenderId?: Record<string, string>;
}) {
  const [slideIndex, setSlideIndex] = useState(0);
  const [dlAll, setDlAll] = useState(false);
  const count = allVersions.length;
  const render = allVersions[slideIndex] || allVersions[0];
  const views = getViews(render);
  const heroUrl =
    views.find((v) => v.key === "side")?.url ||
    views.find((v) => v.key === "front")?.url ||
    views[0]?.url;
  const heroFailed = failedImages.has(render.id);
  const renderMissing = getMissingViews(render);
  const hasAllViews = renderMissing.length === 0;
  const versionLabel = getVersionLabel(render);
  // WPW order number for this design group: a panelizer job carries it
  // directly, a CV design resolves through the approval map (any version /
  // merged sibling that has a linked order wins).
  const groupOrderNumber: string | null =
    (render?.order_number && String(render.order_number)) ||
    allVersions
      .flatMap((v: any) => [v.id, ...((v._mergedIds as string[]) || [])])
      .map((rid: string) => orderNumberByRenderId?.[rid])
      .find(Boolean) ||
    null;

  return (
    <Card
      className={cn(
        "bg-zinc-900 overflow-hidden transition-colors cursor-pointer group",
        !hasAllViews
          ? "border-amber-500/30 hover:border-amber-500/60"
          : "border-zinc-800 hover:border-blue-600"
      )}
      onClick={() => onSelect(render)}
    >
      <div
        className="relative aspect-video bg-zinc-800"
>
        {heroUrl && !heroFailed ? (
          <img
            src={heroUrl}
            alt="Driver Side"
            className="w-full h-full object-cover"
            loading="lazy"
            onError={() => setFailedImages((prev) => new Set([...prev, render.id]))}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-zinc-600 gap-1">
            <ImageOff className="w-6 h-6 opacity-40" />
            <span className="text-[10px] opacity-60">Image unavailable</span>
          </div>
        )}

        {/* Slider arrows — only when multiple designs exist */}
        {count > 1 && (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setSlideIndex((i) => (i - 1 + count) % count);
              }}
              className="absolute left-1 top-1/2 -translate-y-1/2 z-20 p-2 sm:p-1 rounded-full bg-black/60 hover:bg-black/80 text-white transition-all touch-manipulation"
              title="Previous design"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setSlideIndex((i) => (i + 1) % count);
              }}
              className="absolute right-1 top-1/2 -translate-y-1/2 z-20 p-2 sm:p-1 rounded-full bg-black/60 hover:bg-black/80 text-white transition-all touch-manipulation"
              title="Next design"
            >
              <ChevronRight className="w-4 h-4" />
            </button>

            {/* Slide indicator dots */}
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-20 flex gap-1">
              {allVersions.map((_, i) => (
                <button
                  key={i}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSlideIndex(i);
                  }}
                  className={cn(
                    "w-2.5 h-2.5 sm:w-1.5 sm:h-1.5 rounded-full transition-all touch-manipulation",
                    i === slideIndex ? "bg-white scale-125" : "bg-white/40"
                  )}
                />
              ))}
            </div>
          </>
        )}

        {/* Delete X button */}
        <button
          onClick={async (e) => {
            e.stopPropagation();
            if (await confirmDialog({ title: "Delete this render permanently?", confirmText: "Delete", destructive: true })) {
              deleteRender.mutate({ id: render.id, source: render.__source });
            }
          }}
          className="absolute bottom-2 right-2 z-30 p-1.5 rounded-full bg-red-600/60 hover:bg-red-600/90 text-white transition-all duration-200 active:scale-90 sm:opacity-0 sm:group-hover:opacity-100 touch-manipulation"
          title="Delete render"
        >
          <X className="h-3.5 w-3.5" />
        </button>

        {/* Version / design count badge */}
        {count > 1 ? (
          <Badge className="absolute top-2 right-2 bg-purple-600">
            <GitBranch className="w-3 h-3 mr-1" />
            {slideIndex + 1}/{count} designs
          </Badge>
        ) : (
          <Badge className="absolute top-2 right-2 bg-zinc-700">{versionLabel}</Badge>
        )}

        {render.custom_design_url && (
          <div className="absolute top-2 left-2 bg-gradient-blue-magenta/80 p-1 rounded">
            <Sparkles className="w-3 h-3" />
          </div>
        )}

        {/* Missing views indicator */}
        {!hasAllViews && (
          <div className="absolute bottom-2 left-2 flex items-center gap-1 bg-amber-600/90 px-2 py-0.5 rounded text-[10px] font-bold">
            <AlertTriangle className="w-3 h-3" />
            {views.length}/{VIEW_ORDER.length} views
          </div>
        )}
      </div>

      <CardContent className="p-3">
        <p className="font-semibold text-sm truncate">
          {formatVehicleInfo(render)}
        </p>
        <p className="text-xs text-zinc-400 truncate">
          {formatDesignName(render)} &bull; {render.finish_type}
        </p>
        {groupOrderNumber && (
          <p className="text-[11px] font-semibold text-cyan-400 truncate mt-0.5">
            Order #{groupOrderNumber}
          </p>
        )}
        <div className="flex items-center justify-between mt-2">
          <Badge
            variant="outline"
            className={cn(
              "text-[10px]",
              (render.mode_type === 'inkfusion' || render.mode_type === 'colorpro' || render.mode_type === 'ColorPro') && "border-cyan-500/50 text-cyan-400"
            )}
          >
            {MODE_LABELS[render.mode_type] || render.mode_type}
          </Badge>
          <span className="text-[10px] text-zinc-500">
            {render.created_at ? formatDistanceToNow(new Date(render.created_at), { addSuffix: true }) : ""}
          </span>
        </div>
        {onDownloadAll && (
          <Button
            variant="outline"
            size="sm"
            disabled={dlAll}
            className="w-full mt-2 h-6 text-[10px] border-cyan-500/50 text-cyan-400 hover:bg-cyan-900/30"
            onClick={async (e) => {
              e.stopPropagation();
              setDlAll(true);
              try {
                await onDownloadAll(render);
              } finally {
                setDlAll(false);
              }
            }}
          >
            {dlAll ? (
              <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Downloading...</>
            ) : (
              <><Download className="w-3 h-3 mr-1" /> Download All</>
            )}
          </Button>
        )}
        {onSendProof && (
          <Button
            variant="outline"
            size="sm"
            className="w-full mt-2 h-6 text-[10px] border-purple-500/50 text-purple-400 hover:bg-purple-900/30"
            onClick={(e) => { e.stopPropagation(); onSendProof(render); }}
          >
            <ClipboardSignatureIcon className="w-3 h-3 mr-1" />
            Send Proof
          </Button>
        )}
        {onBuildFiles && (
          <Button
            variant="outline"
            size="sm"
            className="w-full mt-2 h-6 text-[10px] border-emerald-500/50 text-emerald-400 hover:bg-emerald-900/30"
            onClick={(e) => { e.stopPropagation(); onBuildFiles(render); }}
            title="Open Design Assets to build the artboard + print files (same as the rail's Build Assets)"
          >
            <Download className="w-3 h-3 mr-1" />
            Build Assets
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function RevisionStudioIQ() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const deepLinkId = searchParams.get("id");
  // ApprovePro bridge: when present, the shop opened a specific proof's design
  // here to edit it; "Save to this proof" pushes the edit back as a new
  // version onto that proof and returns to the ApprovePro workbench.
  const bridgeProofId = APPROVEPRO_UI_LIVE ? searchParams.get("proof_id") : null;
  // embed=1 → RevisionStudio is running INSIDE the ApprovePro workbench (iframe).
  // On save we postMessage back to the parent instead of a full-page navigate.
  const isEmbed = APPROVEPRO_UI_LIVE && searchParams.get("embed") === "1";
  const [savingToProof, setSavingToProof] = useState(false);

  // UI state
  // ⛔ THIS WAS A FIFTEEN-OPTION TOOL FILTER, AND FOURTEEN OF THEM WERE EMPTY.
  //
  // It came over from RestylePro, where one grid served ColorPro, FadeWraps,
  // GraphicsPro, ApprovePro, WBTY, MyVehiclePro and WallPro. DesignPro OS has
  // exactly one tool: every row this page can load is projected with
  // `mode_type: "designpanelpro"`, so picking any of the other options emptied
  // GalleryMode and picking DesignProAI did the same thing as "All Tools".
  //
  // The real distinction between two designs here is which pipeline authored
  // them, which is also what the brief asked to be able to filter on. So the
  // control keeps its place and answers a question that has two real answers.
  const [pipelineFilter, setPipelineFilter] = useState<"all" | "atlas" | "standard">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showTeamRenders, setShowTeamRenders] = useState(false);
  const [selectedRender, setSelectedRender] = useState<any | null>(null);
  // A durable commit is a read-only historical snapshot, not another mutable
  // render row. Keep its selection separate so browsing history can never make
  // an edit/delete action target the immutable ledger entry.
  const [selectedVersionTimelineKey, setSelectedVersionTimelineKey] = useState<string | null>(null);

  useEffect(() => {
    setSelectedVersionTimelineKey(null);
  }, [selectedRender?.id]);

  // ── ORIGINAL PROMPT RESOLUTION ──────────────────────────────────────────
  // The prompt panel used to read exactly two places — admin_notes.original_prompt
  // then custom_styling_prompt_key — and render NOTHING when both were empty, so
  // "no prompt recorded" was visually identical to "this job has no prompt panel."
  // Only useDesignPanelProLogic writes original_prompt; every other product
  // (ColorPro, FadeWraps, GraphicsPro, WBTY, MyVehicle) and the server-side
  // generate-color-render insert do not, and they use different admin_notes keys.
  // Measured 2026-07-30: 27 renders in 90 days resolved to nothing.
  //
  // This widens the chain to the keys that are actually written, then falls back
  // to the canonical DesignIQ row's raw_prompt via the admin_notes back-link
  // (which recovers DesignPro/RecreatePro jobs whose prompt lives there), and
  // finally reports the gap honestly instead of hiding the card.
  const [resolvedPrompt, setResolvedPrompt] = useState<string>("");
  useEffect(() => {
    let cancelled = false;
    const resolve = async () => {
      if (!selectedRender?.id) { setResolvedPrompt(""); return; }
      let notes: any = {};
      try {
        notes = typeof selectedRender.admin_notes === "string"
          ? JSON.parse(selectedRender.admin_notes || "{}")
          : (selectedRender.admin_notes || {});
      } catch { notes = {}; }

      // Keys observed across the writers, most-specific first.
      const direct = [
        notes.original_prompt,
        notes.v1_original_prompt,
        notes.prompt,
        notes.design_prompt,
        notes.brief,
        selectedRender.custom_styling_prompt_key,
      ].map((v) => (typeof v === "string" ? v.trim() : "")).find(Boolean);
      if (direct) { if (!cancelled) setResolvedPrompt(direct); return; }

      // No second lookup. The brief a design was authored from lives on the run
      // the server owns, and the projection above already carries whatever it
      // recorded. A design whose brief the server did not keep shows the honest
      // empty state rather than a prompt reconstructed from somewhere else.
      if (!cancelled) setResolvedPrompt("");
    };
    resolve();
    return () => { cancelled = true; };
  }, [selectedRender?.id, selectedRender?.admin_notes, selectedRender?.custom_styling_prompt_key]);

  const [showSendForApproval, setShowSendForApproval] = useState(false);
  // Push-to-ApprovePro: enter an ApprovePro order # and push the currently-open
  // Revision Studio design (its angle renders + 2D proof) onto that order's proof
  // as the active version, so it shows in the ApprovePro command center.
  const [pushOrderNo, setPushOrderNo] = useState("");
  const [pushing, setPushing] = useState(false);
  const [currentViewIndex, setCurrentViewIndex] = useState(0);
  const [isStudioMode, setIsStudioMode] = useState(false);
  const [layoutMode, setLayoutMode] = useState<"studio" | "gallery">("studio");
  const [galleryLightboxRender, setGalleryLightboxRender] = useState<any | null>(null);
  const [galleryLightboxIdx, setGalleryLightboxIdx] = useState(0);
  const [studioDisplayRender, setStudioDisplayRender] = useState<any | null>(null);
  const [studioDisplayFullscreenIdx, setStudioDisplayFullscreenIdx] = useState<number | null>(null);
  const [showReviseDialog, setShowReviseDialog] = useState(false);
  const [revisionNotes, setRevisionNotes] = useState("");
  const [applyToAllViews, setApplyToAllViews] = useState(false);
  // Explicit per-view scope for the next revision. null = follow the smart
  // default (current view + the views that show any panel named in the notes).
  // A non-empty array = the user hand-picked exactly which angles to edit, so a
  // hood edit can be isolated to the hood/front and leave the rear untouched.
  const [scopeViewKeys, setScopeViewKeys] = useState<string[] | null>(null);
  const [revisionPanelTargets, setRevisionPanelTargets] = useState<string[]>([]);
  const [overrideYear, setOverrideYear] = useState("");
  const [overrideMake, setOverrideMake] = useState("");
  const [overrideModel, setOverrideModel] = useState("");

  // Admin batch mode
  const [showBatchDialog, setShowBatchDialog] = useState(false);
  const [batchPromptCategory, setBatchPromptCategory] = useState<"commercial" | "restyle">("commercial");
  const [batchSubcategory, setBatchSubcategory] = useState<string>("all");
  const [batchSearch, setBatchSearch] = useState("");
  const [selectedPreset, setSelectedPreset] = useState<PromptPreset | null>(null);

  // Studio background - always dark (white studio removed)

  // Star rating state
  const [ratingHover, setRatingHover] = useState(0);
  const [currentRating, setCurrentRating] = useState(0);
  const [isRating, setIsRating] = useState(false);

  // VisionBoard state
  const [visionImages, setVisionImages] = useState<VisionBoardImage[]>([]);
  const [visionIntent, setVisionIntent] = useState<VisionBoardIntent>("style_inspiration");

  // ── Voice-to-text: customers can TALK detailed multi-layered edits instead
  //    of typing. Final phrases append to the revision box.
  const { supported: voiceSupported, listening: voiceListening, toggle: toggleVoice } =
    useSpeechToText((text) => {
      setRevisionNotes((prev) => (prev.trim() ? prev.trimEnd() + " " : "") + text);
    });

  // ── Inline "Upload example / supporting edit": drop a reference image right
  //    at the revision box. It feeds the SAME visionImages the AI now honors
  //    (as an exact reference), so the revision matches what the customer
  //    pointed at. Uploads to the same bucket/path as the VisionBoard uploader.
  const exampleUploadRef = useRef<HTMLInputElement>(null);
  const [uploadingExample, setUploadingExample] = useState(false);
  const handleExampleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file (JPG, PNG, WebP)");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Please upload an image smaller than 10MB");
      return;
    }
    setUploadingExample(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id || "anonymous";
      const ext = file.name.split(".").pop();
      const filePath = `vision-board-refs/${userId}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from("patterns")
        .upload(filePath, file, { cacheControl: "3600", upsert: false });
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from("patterns").getPublicUrl(filePath);
      setVisionImages((prev) => [...prev, { slotLabel: `Reference ${prev.length + 1}`, storageUrl: publicUrl }]);
      // The user explicitly attached this FOR the edit → treat it as an exact
      // reference so the AI matches it rather than loosely riffing on it.
      setVisionIntent("exact_reference");
      toast.success("Example added — the AI will match it on the next revision");
    } catch (err: any) {
      toast.error(err.message || "Upload failed");
    } finally {
      setUploadingExample(false);
      if (exampleUploadRef.current) exampleUploadRef.current.value = "";
    }
  };

  // ── Logo layers (Feature 1: upload, Feature 2: separate from render) ──
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  // Report-a-bug side sheet (reuses the Engine Room issue reporter)
  // Per-view layer arrays — keyed by VIEW_ORDER keys ("side", "rear", ...)
  const [logoLayersByView, setLogoLayersByView] = useState<Record<string, LogoLayer[]>>({});
  // Per-view clean background URLs (set after wand-extracting elements off the render)
  const [cleanBackgroundsByView, setCleanBackgroundsByView] = useState<Record<string, string>>({});
  // The layer the user has clicked to "arm" for placement on the next render click
  const [armedLayerId, setArmedLayerId] = useState<string | null>(null);
  // Production method drives LayerStrip behavior — Print & Cut
  // (printed) is the permissive default; Manufacture Film Cut (cut) flips
  // downstream vectorize into plotter-friendly silhouette mode. Local-only
  // here — RevisionStudio is a creative surface; QC persists per job.
  const [productionMethod, setProductionMethod] = useState<"cut" | "printed">("printed");
  // Mirror of wandActive inside RenderElementSeparator so the overlay re-renders on toggle
  const [wandActive, setWandActive] = useState(false);
  const separatorRef = useRef<RenderElementSeparatorHandle>(null);
  // LayerLift modal — single-gesture drag-box lift + Gemini heal. Same tool
  // as on the QC artboard; lifted element + healed background land in the same
  // Layers strip / cleanBackgroundsByView that Separate Elements feeds.
  const [layerLiftOpen, setLayerLiftOpen] = useState(false);

  // Clear any hand-picked revision scope when the design or the displayed angle
  // changes, so the smart per-view default re-applies for the new context.
  useEffect(() => {
    setScopeViewKeys(null);
  }, [selectedRender?.id, currentViewIndex]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // getSession() reads from localStorage — instant, no network. getUser()
      // makes a /auth/v1/user call that fails (or hangs through retries) on
      // stale JWTs, which was leaving the page stuck behind isRoleLoading.
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!cancelled) {
          setCurrentUserId(session?.user?.id ?? null);
          setCurrentUserEmail(session?.user?.email ?? null);
        }
      } catch {
        if (!cancelled) {
          setCurrentUserId(null);
          setCurrentUserEmail(null);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Logo layer helpers ─────────────────────────────────────────────
  function getCurrentViewKey(): string | null {
    if (!selectedRender) return null;
    const views = getViews(selectedRender);
    return views[currentViewIndex]?.key ?? null;
  }

  function getCurrentViewUrl(): string | null {
    if (!selectedRender) return null;
    const viewKey = getCurrentViewKey();
    if (!viewKey) return null;
    return cleanBackgroundsByView[viewKey]
      || (selectedRender.render_urls?.[viewKey] as string | undefined)
      || null;
  }

  function addLogoLayerToCurrentView(layer: LogoLayer) {
    const viewKey = getCurrentViewKey();
    if (!viewKey) {
      toast.error("Open a render first.");
      return;
    }
    setLogoLayersByView((prev) => ({
      ...prev,
      [viewKey]: [...(prev[viewKey] || []), layer],
    }));
  }

  function handleLayerExtracted(viewKey: string, layer: LogoLayer, patchedBgUrl: string) {
    setLogoLayersByView((prev) => ({
      ...prev,
      [viewKey]: [...(prev[viewKey] || []), layer],
    }));
    setCleanBackgroundsByView((prev) => ({ ...prev, [viewKey]: patchedBgUrl }));
  }

  // ── MOVE / REMOVE LOGO → LAYERED (Canva-style, no smear) ────────────────────
  // The 2D-proof step now persists a real logo-free CLEAN artboard (Layer 0,
  // master_artboard_clean_url) alongside the branded one — the base with NO logo
  // baked in. So the edit becomes a pure layer operation, exactly like Canva:
  //   • REMOVE the logo = the clean base already shows through (delete the overlay).
  //   • MOVE the logo    = drag the overlay on the clean base.
  // Nothing is healed (the base was authored logo-free) → ZERO smear. The overlay
  // is the REAL logo, wrap-color alpha-keyed off the BRANDED artboard (actual
  // pixels, not an AI redesign). If the design has no clean artboard yet, fail
  // closed: a layered edit must never fall through to a full AI revision.
  const MOVE_LOGO_INTENT =
    /\b(move|moved|moving|reposition\w*|relocat\w*|shift\w*|nudge\w*|slide|scoot|bump|raise|raised|lower|lift\w*|put|place|center|centre|remove|delete|take\s+off|get\s+rid)\b[\s\S]{0,48}\b(logo|logos|text|lettering|wordmark|emblem|badge|graphic|graphics|name|branding|brand|phone|website|url|contact)\b/i;
  const LAYERED_EDIT_UNAVAILABLE_MESSAGE =
    "This revision has no verified clean base yet. Build its production assets, then retry this logo edit. No AI redesign was started.";
  function wantsLogoMove(notes: string): boolean {
    return !!notes && MOVE_LOGO_INTENT.test(notes);
  }

  // Returns true only when it loaded the layered clean-base + logo overlay.
  // False is a fail-closed result: the caller must preserve the user's edit and
  // must not substitute a full AI revision.
  async function layeredMoveLogo(render: any, viewKey: string): Promise<boolean> {
    if (!render?.id || !viewKey || !currentUserId) {
      toast.error(
        "The layered editor is not ready for this revision. Reopen the design and try again. No AI redesign was started.",
        { duration: 12000 },
      );
      return false;
    }
    const toastId = toast.loading("Loading the clean base + your logo…", { duration: Infinity });
    try {
      // THE SERVER ALREADY SEPARATED THESE. This used to send the 2D proof to
      // `extract-logo-elements`, have an AI guess bounding boxes, alpha-key a
      // slice out of each guess, upload the slices, and write them back into a
      // design row as the logo pack -- a second producer of production assets,
      // running in a tab, on boxes nobody verified.
      //
      // Call 10 separates the logo inventory server-side and Call 11 publishes
      // the de-logoed duplicate of each panel. The clean base and the liftable
      // elements both already exist, hashed and bound to the accepted master.
      // So this reads them. Nothing is uploaded, nothing is written back, and
      // the editing experience is identical: a clean floor plus draggable
      // elements.
      const surfaceKey = SURFACE_KEY_FOR_VIEW[viewKey] || null;
      const sources = surfaceKey
        ? await loadLayeredEditSources(String(render.id), surfaceKey)
        : { cleanUrl: null, logos: [] };
      if (!sources.cleanUrl) {
        toast.error(LAYERED_EDIT_UNAVAILABLE_MESSAGE, { id: toastId, duration: 12000 });
        return false;
      }

      // LAYER 0 — floor the canvas on the de-logoed panel the server published.
      setCleanBackgroundsByView((prev) => ({ ...prev, [viewKey]: sources.cleanUrl! }));

      // LAYER 1 — the separated logos, dropped in centred and resizable. They
      // arrive with true alpha because the server cut them, so there is no
      // keying step and no heal anywhere.
      const newLayers: LogoLayer[] = sources.logos.map((logo, index) => ({
        id: `lay_${index}_${logo.label.replace(/\W+/g, "-").toLowerCase()}`,
        kind: "extracted",
        sourceUrl: logo.url,
        name: logo.label,
        origin: { xPct: 0.5, yPct: 0.5, wPct: 0.25, hPct: 0.25 },
        placement: { xPct: 0.5, yPct: 0.5, size: "md", sizePercent: 0.25 },
      }));

      if (newLayers.length > 0) {
        setLogoLayersByView((prev) => ({ ...prev, [viewKey]: [...(prev[viewKey] || []), ...newLayers] }));
      }
      toast.success(
        newLayers.length
          ? `Clean base loaded + ${newLayers.length} separated element(s) from your Logo Pack. Drag to move, delete to remove, then Revise & Clone to save.`
          : `Clean base loaded (logo removed). Revise & Clone to save.`,
        { id: toastId, duration: 10000 },
      );
      return true;
    } catch (error) {
      console.error("[RevisionIQ] Layered logo edit could not load its clean base:", error);
      toast.error(
        "The clean base could not be loaded. Retry after the production assets finish building. No AI redesign was started.",
        { id: toastId, duration: 12000 },
      );
      return false;
    }
  }

  function deleteLogoLayer(layerId: string) {
    const viewKey = getCurrentViewKey();
    if (!viewKey) return;
    setLogoLayersByView((prev) => ({
      ...prev,
      [viewKey]: (prev[viewKey] || []).filter((l) => l.id !== layerId),
    }));
    if (armedLayerId === layerId) setArmedLayerId(null);
  }

  // Arming a logo layer and removal "Drawing Mode" both capture clicks on the
  // render, so they must be mutually exclusive. Arming a layer force-disables
  // removal mode; otherwise the click draws a removal box instead of dropping
  // the logo and it looks like placement "does nothing".
  function armLayer(id: string | null) {
    if (id) {
      separatorRef.current?.deactivate();
      setWandActive(false);
    }
    setArmedLayerId(id);
  }

  function dropArmedLayerAt(xPct: number, yPct: number) {
    const viewKey = getCurrentViewKey();
    if (!viewKey || !armedLayerId) return;
    setLogoLayersByView((prev) => {
      const list = prev[viewKey] || [];
      return {
        ...prev,
        [viewKey]: list.map((l) =>
          l.id === armedLayerId
            ? { ...l, placement: { xPct, yPct, size: l.placement?.size || "md" } }
            : l,
        ),
      };
    });
    setArmedLayerId(null);
  }

  // Make a layer in the strip movable/resizable in one tap. Drops a not-yet-
  // placed layer onto the render at the CENTER — a clear NEW position — and arms
  // it so the existing touch-enabled drag/resize/rotate handles take over.
  // CRITICAL: we place at center (0.5, 0.5), NEVER at the element's origin — a
  // removed element re-dropped on its old spot looked like the Remove undid
  // itself (the prior regression). At center it's unmistakably a new placement
  // the user then drags. Keeps its natural size (origin width) when known.
  function placeAndArmLayer(layerId: string) {
    const viewKey = getCurrentViewKey();
    if (!viewKey) return;
    setLogoLayersByView((prev) => ({
      ...prev,
      [viewKey]: (prev[viewKey] || []).map((l) => {
        if (l.id !== layerId || l.placement) return l;
        const sizePercent =
          typeof l.origin?.wPct === "number"
            ? Math.max(0.05, Math.min(0.5, l.origin.wPct))
            : 0.18;
        return { ...l, placement: { xPct: 0.5, yPct: 0.5, size: "md" as LogoSize, sizePercent } };
      }),
    }));
    separatorRef.current?.deactivate();
    setWandActive(false);
    setArmedLayerId(layerId);
  }

  function resizePlacement(layerId: string, size: LogoSize) {
    const viewKey = getCurrentViewKey();
    if (!viewKey) return;
    setLogoLayersByView((prev) => ({
      ...prev,
      [viewKey]: (prev[viewKey] || []).map((l) =>
        l.id === layerId && l.placement ? { ...l, placement: { ...l.placement, size } } : l,
      ),
    }));
  }

  function resizePlacementPercent(layerId: string, sizePercent: number) {
    const viewKey = getCurrentViewKey();
    if (!viewKey) return;
    setLogoLayersByView((prev) => ({
      ...prev,
      [viewKey]: (prev[viewKey] || []).map((l) =>
        l.id === layerId && l.placement
          ? { ...l, placement: { ...l.placement, sizePercent } }
          : l,
      ),
    }));
  }

  function movePlacement(layerId: string, xPct: number, yPct: number) {
    const viewKey = getCurrentViewKey();
    if (!viewKey) return;
    setLogoLayersByView((prev) => ({
      ...prev,
      [viewKey]: (prev[viewKey] || []).map((l) =>
        l.id === layerId && l.placement
          ? { ...l, placement: { ...l.placement, xPct, yPct } }
          : l,
      ),
    }));
  }

  function rotatePlacement(layerId: string, rotationDeg: number) {
    const viewKey = getCurrentViewKey();
    if (!viewKey) return;
    // Normalize to 0–359 so persisted values stay tidy.
    const deg = ((Math.round(rotationDeg) % 360) + 360) % 360;
    setLogoLayersByView((prev) => ({
      ...prev,
      [viewKey]: (prev[viewKey] || []).map((l) =>
        l.id === layerId && l.placement
          ? { ...l, placement: { ...l.placement, rotationDeg: deg } }
          : l,
      ),
    }));
  }

  function clearPlacement(layerId: string) {
    const viewKey = getCurrentViewKey();
    if (!viewKey) return;
    setLogoLayersByView((prev) => ({
      ...prev,
      [viewKey]: (prev[viewKey] || []).map((l) =>
        l.id === layerId ? { ...l, placement: null } : l,
      ),
    }));
  }

  function handleBoxSelect(x1Pct: number, y1Pct: number, x2Pct: number, y2Pct: number) {
    if (separatorRef.current?.isWandActive()) {
      separatorRef.current.handleBoxSelect(x1Pct, y1Pct, x2Pct, y2Pct);
    }
  }

  // ── Hydrate logo_layers from admin_notes when selection changes ────
  useEffect(() => {
    if (!selectedRender) {
      setLogoLayersByView({});
      setCleanBackgroundsByView({});
      setArmedLayerId(null);
      return;
    }
    try {
      const notes = JSON.parse(selectedRender.admin_notes || "{}");
      const stored: RenderLogoLayers | undefined = notes.logo_layers;
      const existingLayers = stored?.layers || {};
      setCleanBackgroundsByView(stored?.backgrounds || {});

      // Two-layer flow: if this design arrived from the DesignPro entry page
      // with uploaded Layer-2 logos, and nothing has been placed yet, seed them
      // as auto-placed editable objects on the hero view. Seed once, then clear.
      const handoff = getLayer2Handoff(deepLinkId || selectedRender.id);
      const alreadyHasLayers = Object.values(existingLayers).some((arr) => arr.length > 0);
      if (handoff?.logos?.length && !alreadyHasLayers) {
        const heroKey = getViewOrderForVehicle(selectedRender)[0] || VIEW_ORDER[0];
        const seeded = seedLogoLayersFromHandoff(handoff.logos);
        setLogoLayersByView({ ...existingLayers, [heroKey]: seeded });
        clearLayer2Handoff(deepLinkId || selectedRender.id);
        if (handoff.textPrompt?.trim()) {
          toast.message("Layer 2 text ready", {
            description: "Use the Text tool to add your typed text & logos as movable objects.",
          });
        }
      } else {
        setLogoLayersByView(existingLayers);
        if (handoff) clearLayer2Handoff(deepLinkId || selectedRender.id);
        // SERVER FALLBACK: the sessionStorage handoff is same-tab only, so
        // across reloads and tabs the Layer-2 overlays vanish. If nothing is
        // placed yet, seed from the logo inventory Call 10 separated for this
        // design -- the same assets the Logo Pack and PanelPro are served,
        // rather than a browser-written copy of them.
        if (!alreadyHasLayers) {
          const genId = deepLinkId || selectedRender.id;
          (async () => {
            try {
              const heroKey = getViewOrderForVehicle(selectedRender)[0] || VIEW_ORDER[0];
              const surfaceKey = SURFACE_KEY_FOR_VIEW[heroKey];
              if (!surfaceKey) return;
              const { logos } = await loadLayeredEditSources(String(genId), surfaceKey);
              if (!logos.length) return;
              setLogoLayersByView((prev) => {
                const hasAny = Object.values(prev).some((arr) => arr.length > 0);
                return hasAny
                  ? prev
                  : {
                      ...prev,
                      [heroKey]: seedLogoLayersFromHandoff(
                        logos.map((logo) => ({ url: logo.url, name: logo.label })),
                      ),
                    };
              });
            } catch (e) {
              console.warn("[RevisionStudio] logo inventory seed failed (non-fatal):", e);
            }
          })();
        }
      }
    } catch {
      setLogoLayersByView({});
      setCleanBackgroundsByView({});
    }
    setArmedLayerId(null);
  }, [selectedRender?.id]);

  // THE BROWSER DOES NOT WRITE PRODUCTION ASSETS.
  //
  // This effect used to persist the canvas state three ways at once: into a
  // design row's admin_notes, into the legacy asset table via the legacy
  // persist function as the deterministic slicer's Layer-1 input, and into
  // every linked panelizer job's concept for the QC page to pick up. The middle
  // one is the serious part -- it made a tab's canvas the source the production
  // slicer cut from, which is exactly the second producer the one sanctioned
  // chain forbids.
  //
  // Here the clean base and the separated logos are server artifacts (Calls 10
  // and 11), published from the accepted master, and the six panels are cut
  // deterministically from that same master. There is nothing for a browser to
  // contribute to production, so the canvas is what it always should have been:
  // a working surface for composing a revision instruction. It survives within
  // the session and is submitted with the revision, not written behind it.
  useEffect(() => {
    if (!selectedRender?.id) return;
    const hasLayers = Object.values(logoLayersByView).some((arr) => arr.length > 0);
    const hasBgs = Object.keys(cleanBackgroundsByView).length > 0;
    if (!hasLayers && !hasBgs) return;
    const payload: RenderLogoLayers = {
      backgrounds: cleanBackgroundsByView,
      layers: logoLayersByView,
    };
    try {
      window.sessionStorage.setItem(
        `revstudio:layers:${selectedRender.id}`,
        JSON.stringify(payload),
      );
    } catch {
      /* storage unavailable (private mode / quota) -- the canvas still works */
    }
  }, [logoLayersByView, cleanBackgroundsByView, selectedRender?.id]);

  // Missing renders generation state
  const [isGeneratingMissing, setIsGeneratingMissing] = useState(false);
  const [generatingViews, setGeneratingViews] = useState<string[]>([]);
  const [completedMissingViews, setCompletedMissingViews] = useState<string[]>([]);
  const [failedMissingViews, setFailedMissingViews] = useState<string[]>([]);
  const [regeneratingView, setRegeneratingView] = useState<string | null>(null);

  // Broken image tracking - renders whose hero image failed to load
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());

  // Zoom modal state
  const [expandedImage, setExpandedImage] = useState<{ url: string; title: string } | null>(null);

  // Precise Edit dialog state (click-to-mask + Flux Fill)
  const [preciseEditOpen, setPreciseEditOpen] = useState(false);
  // Precision Editor now opens in a full-screen modal so the box is drawn on
  // the large render, not the cramped right-rail thumbnail.
  const [precisionModalOpen, setPrecisionModalOpen] = useState(false);
  // Which sub-tool the Precise modal opens on: "box" (Precise button) or
  // "markup" (the dedicated MarkupIQ button → CutLine / Delete / Move / Pen).
  const [precisionInitialMode, setPrecisionInitialMode] = useState<"box" | "markup">("box");
  const [sideBoxesOpen, setSideBoxesOpen] = useState(false);

  // Show Original Render dialog state
  const [showOriginalDialog, setShowOriginalDialog] = useState(false);
  const [originalDialogData, setOriginalDialogData] = useState<{
    prompt: string;
    visionboardUrls: string[];
    designPanelUrl: string | null;
    swatchUrl: string | null;
    promptHistory: Array<{ version: number; prompt: string; timestamp: string; type: string }>;
    commercialDetails: Record<string, unknown>;
    mode: string;
  } | null>(null);
  const [isLoadingOriginal, setIsLoadingOriginal] = useState(false);

  // Proof generation state
  const isMobile = useIsMobile();
  const [showProofSheet, setShowProofSheet] = useState(false);
  const [show2DProofSheet, setShow2DProofSheet] = useState(false);
  const { isGeneratingCutFiles, handleGenerateCutFiles } = useCutFiles();
  // Ordering the production pack. The price, the product and the entitlement
  // live on the server; this sends WHICH product and follows the checkout URL
  // it returns. Buying the Production Pack authorizes production fulfilment and
  // nothing else -- the Logo Pack is its own purchase, on its own card.
  const [orderingPack, setOrderingPack] = useState(false);
  const orderProductionPack = useCallback(async () => {
    if (!selectedRender?.id) { toast.error("Open a design first."); return; }
    setOrderingPack(true);
    try {
      const session = await dpApi.createCheckoutSession({
        generationId: String(selectedRender.id),
        product: "print_pack_entitlement",
        returnPath: "/revision-studio",
      });
      window.location.href = session.url;
    } catch (error: any) {
      toast.error(`Checkout could not be opened: ${error?.message || error}`);
      setOrderingPack(false);
    }
  }, [selectedRender?.id]);

  // ── Cut Production Sheet ──────────────────────────────────────────────────
  // The dimensioned cut sheet: every graphic specced FLAT at its real cut size
  // (W×H + letter height), NOT shown on the truck — these are the actual plotter
  // cut sizes. Same cut-graphics-proof engine the GraphicsPro tool uses; surfaced
  // here so a render opened in RevisionStudio can produce the production cut sheet
  // without bouncing out to the tool.
  const { proof: cutProof, isGenerating: isCutProofGenerating, generateProof: generateCutProof } = useCutGraphicsProof();
  const [cutProofOpen, setCutProofOpen] = useState(false);
  const [cutProofSqFt, setCutProofSqFt] = useState<number | null>(null);
  const handleBuildCutSheet = useCallback(async () => {
    const r = selectedRender as any;
    if (!r) return;
    const urls = (r.render_urls || {}) as Record<string, string>;
    const renderUrl = urls.side || urls.hero || urls["driver-side"] || Object.values(urls)[0] || "";
    if (!renderUrl) {
      toast.error("No render image yet — generate the design/views first, then build the cut sheet.");
      return;
    }
    setCutProofOpen(true);
    let sideW: number | undefined;
    let sideH: number | undefined;
    let sqft: number | null = null;
    // GENIE GEOMETRY IS THE SERVER'S. The dimensions this sheet specs against
    // are the ones Call 1 already resolved and stamped on the design's own
    // panels, so they are read from the panel the customer will actually print
    // rather than re-estimated in the browser from a make and model. That is
    // also what makes the sheet agree with the panel by construction instead of
    // by coincidence -- two independent estimates of one vehicle are two
    // numbers waiting to disagree.
    try {
      const geometry = await loadDriverPanelGeometry(String(r.id));
      if (geometry) {
        sideW = geometry.trimWidthIn;
        sideH = geometry.trimHeightIn;
        sqft = geometry.surfaceSqFt;
      }
    } catch { /* fall through to the honest refusal below */ }
    if (!sideW || !sideH) {
      toast.error("Couldn't resolve vehicle dimensions — set a real year/make/model on this design so graphics can be specced to scale.");
      setCutProofOpen(false);
      return;
    }
    setCutProofSqFt(sqft);
    await generateCutProof({
      renderUrl,
      sideWidthInches: sideW,
      sideHeightInches: sideH,
      designName: r.design_file_name || r.color_name || "Custom Graphics",
      vehicleYear: r.vehicle_year ? String(r.vehicle_year) : undefined,
      vehicleMake: r.vehicle_make || undefined,
      vehicleModel: r.vehicle_model || undefined,
    });
  }, [selectedRender, generateCutProof]);

  // Studio toggle removed - dark-only mode

  // ---------------------------------------------------------------------------
  // Role check: admin vs standard user
  // ---------------------------------------------------------------------------
  const { data: isAdmin, isLoading: isRoleLoading } = useQuery({
    queryKey: ["revision-studio-role"],
    queryFn: async () => {
      // getSession() reads cached session from localStorage — instant. The
      // previous getUser() call hit /auth/v1/user, which on stale JWTs threw
      // and burned ~7s of React Query retries before resolving — long enough
      // that users gave up while the SPROKET bouncer kept spinning.
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) return false;

      // Email allowlist fallback (centralized in src/lib/admin-allowlist.ts).
      // Checked first so operators get access immediately, even before their
      // user_roles row has been created.
      if (isAllowlistedAdmin(user.email)) return true;

      const { data: roleData, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .in("role", ["admin", "tester"])
        .limit(1)
        .maybeSingle();

      if (error) {
        console.warn("[RevisionStudioIQ] user_roles lookup failed", error);
        return false;
      }
      return !!roleData;
    },
    staleTime: 5 * 60 * 1000,
    // The role check is best-effort — if it errors, treat as non-admin and
    // stop blocking the renders query rather than retrying for ~7s.
    retry: false,
  });

  // ---------------------------------------------------------------------------
  // Fetch renders — infinite scroll, 20 records per page
  // ---------------------------------------------------------------------------
  const PAGE_SIZE = 20;
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const GRID_COLUMNS = "id,render_urls,vehicle_year,vehicle_make,vehicle_model,vehicle_type,mode_type,design_file_name,color_name,color_hex,finish_type,created_at,updated_at,custom_design_url,custom_swatch_url,custom_styling_prompt_key,uses_custom_design,admin_notes,customer_email,subscription_tier,organization_id,infusion_color_id,lineage_root_id";

  const {
    data: rendersPages,
    isLoading,
    error: rendersError,
    refetch: refetchRenders,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["revision-studio-renders", pipelineFilter, searchQuery, isAdmin, showTeamRenders],
    queryFn: async ({ pageParam = 0 }) => {
      // SERVER-OWNED SOURCE. This used to select a legacy design table -- a
      // RestylePro table that holds zero rows in DesignProAI, and a name the
      // customer-path seam gate forbids precisely because it is a second door
      // onto a design. The designs live in the run tables the gateway owns, so
      // the rows come from dpApi and arrive in exactly the shape the cards
      // below already read. Nothing about the grid, the cards or GalleryMode
      // changes -- only where a row comes from.
      const all = await listRevisionStudioDesigns();

      // Mode and search narrow the list in memory. The gateway already returns
      // only the caller's own runs, so the ownership branches the old query
      // carried are gone rather than reimplemented weakly in the browser, and
      // one operator's designs are not a volume worth a round trip per
      // keystroke.
      const needle = searchQuery.trim().toLowerCase();
      const matches = all.filter((row) => {
        // A row whose pipeline the server could not report passes both
        // filters: "unknown" is not "the other one".
        if (pipelineFilter !== "all" && row.pipeline && row.pipeline !== pipelineFilter) return false;
        if (!needle) return true;
        return [
          row.vehicle_year, row.vehicle_make, row.vehicle_model, row.vehicle_type,
          row.design_file_name, row.color_name, row.finish_type,
          row.design_id, row.order_number, row.mode_type,
        ].some((field) => String(field || "").toLowerCase().includes(needle));
      });

      // Same phantom-row rule the old query applied: a card needs an image.
      const filtered = matches.filter((row) =>
        Object.values(row.render_urls || {}).some((v) => typeof v === "string" && v.length > 0),
      );

      const from = pageParam * PAGE_SIZE;
      return filtered.slice(from, from + PAGE_SIZE);
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      // If last page returned fewer than PAGE_SIZE, no more pages
      if (lastPage.length < PAGE_SIZE) return undefined;
      return allPages.length; // next page number
    },
    enabled: isRoleLoading === false,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
    // Always pull the newest renders when the user lands on RevisionStudio.
    // Without this, a render the customer JUST generated in DesignPro wouldn't
    // appear here (the 2-min cache served a stale list), so it looked like a
    // fresh design "couldn't be edited" until a manual refresh. Refetching on
    // mount surfaces the just-made render immediately so it can be revised.
    refetchOnMount: "always",
  });

  // ONE TOOL, ONE FEED.
  //
  // In RestylePro this page unioned three tables: the design rows, a separate
  // GraphicsPro job table, and the panelizer job table -- because a design
  // could exist in any of them and a job's link back to its design was often
  // missing, so a job visible in QC was invisible here. DesignProAI has one
  // tool and one design identity: a run IS the design, and the gateway returns
  // every run the caller owns. There is nothing to union and nothing that can
  // go missing between stores, so the two extra feeds are gone rather than
  // reimplemented against tables this system does not have.
  //
  // They are kept as empty constants so the merge below reads unchanged.
  const graphicsProRows: any[] = EMPTY_LEGACY_FEED;
  const panelizerRows: any[] = EMPTY_LEGACY_FEED;

  // Flatten all pages and merge duplicates
  const renders = useMemo(() => {
    if (!rendersPages?.pages) return undefined;
    // The design feed, plus the two legacy feeds that are now empty. The merge
    // and its dedupe stay exactly as written: with one feed there is nothing to
    // blend, and leaving the shape intact is what keeps this a data-seam change
    // rather than a rewrite of the grid.
    const cvRecords = rendersPages.pages.flat();
    const gpRecords = graphicsProRows ?? [];
    const cvIds = new Set(cvRecords.map((r: any) => r.id));
    const pzRecords = (panelizerRows ?? []).filter(
      (r: any) => !(r._generationId && cvIds.has(r._generationId)),
    );
    const allRecords = [...cvRecords, ...gpRecords, ...pzRecords].sort((a, b) => {
      const ta = a?.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b?.created_at ? new Date(b.created_at).getTime() : 0;
      return tb - ta;
    });

    // ── Merge duplicate records for the same design ──
    const mergeKey = (r: any) => {
      // A lineage id is the OS identity. Vehicle/name fields are presentation
      // data and may legitimately repeat across unrelated customer designs.
      if (r.lineage_root_id) return `lineage:${r.lineage_root_id}`;
      const mk = (r.vehicle_make || "").toLowerCase().trim();
      const md = (r.vehicle_model || "").toLowerCase().trim();
      const yr = r.vehicle_year || 0;
      const mode = r.mode_type || "";
      const baseName = (r.design_file_name || r.color_name || "").replace(/\s*\(V\d+\)$/, "").toLowerCase().trim();
      const vInfo = parseVersionInfo(r);
      if (vInfo.version > 1) return r.id;
      // MyVehiclePro renders all share the single `myvehicle_edit` URL
      // key, so the multi-view merge below would silently drop every
      // subsequent render that maps to the same vehicle + color + mode.
      // Keep each MV render as its own card by giving it a unique key.
      if (mode.startsWith("myvehicle_")) return r.id;
      return `${yr}|${mk}|${md}|${mode}|${baseName}`;
    };

    const groups = new Map<string, any[]>();
    for (const r of allRecords) {
      const key = mergeKey(r);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }

    const merged: any[] = [];
    for (const group of groups.values()) {
      if (group.length === 1) {
        merged.push(group[0]);
        continue;
      }
      group.sort((a: any, b: any) => {
        const aCount = Object.keys(a.render_urls || {}).length;
        const bCount = Object.keys(b.render_urls || {}).length;
        return bCount - aCount;
      });
      const primary = { ...group[0] };
      const combinedUrls = { ...(primary.render_urls as Record<string, string>) };
      for (let i = 1; i < group.length; i++) {
        const otherUrls = (group[i].render_urls || {}) as Record<string, string>;
        for (const [viewKey, url] of Object.entries(otherUrls)) {
          if (!combinedUrls[viewKey] && url) {
            combinedUrls[viewKey] = url;
          }
        }
      }
      primary.render_urls = combinedUrls;
      primary._mergedIds = group.map((r: any) => r.id);
      merged.push(primary);
    }

    return merged;
  }, [rendersPages, graphicsProRows, panelizerRows, pipelineFilter]);

  // THE ORDER NUMBER IS ON THE DESIGN.
  //
  // A legacy design row carried no order number of its own, so this resolved it
  // by joining the customer's approval row and reading a metadata key off it --
  // three spellings of that key, best-effort, for every card in the feed. Here
  // the run mints and owns the order number, `businessIdentityForRun` projects
  // it from the same frozen snapshot as the design id, and the adapter puts it
  // on the row. So there is no lookup: the map is empty and every card reads
  // its own value below.
  const orderNumberByRenderId: Record<string, string> = EMPTY_ORDER_NUMBERS;

  const orderNumberFor = (r: any): string | null => {
    if (!r) return null;
    if (r.order_number) return String(r.order_number);
    const direct = orderNumberByRenderId?.[r.id];
    if (direct) return direct;
    for (const mid of (r._mergedIds || [])) {
      if (orderNumberByRenderId?.[mid]) return orderNumberByRenderId[mid];
    }
    try {
      const notes = JSON.parse(r.admin_notes || "{}");
      const on = notes.wpw_order_number || notes.order_number;
      if (on) return String(on);
    } catch { /* admin_notes not JSON — ignore */ }
    return null;
  };

  // Intersection Observer — auto-load next page as user scrolls down
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: "400px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // ---------------------------------------------------------------------------
  // DEEP LINK: /revision-studio?id=<generationId> OPENS THAT DESIGN.
  //
  // This used to resolve only against `renders` -- the caller's own feed, one
  // page at a time, already filtered by the grid's "a card needs an image"
  // rule. Three ordinary situations therefore opened a blank studio on a design
  // that plainly exists:
  //
  //   * a design-team member following a link to a customer's job, which is
  //     never in their own feed at all;
  //   * a design past the first page, whose row had not been fetched yet;
  //   * a design whose proofs are still rendering or were withheld, which the
  //     phantom-row rule drops from the feed by design.
  //
  // The feed match stays first, because when the row is already in hand it is
  // the same object the grid is rendering and reusing it keeps selection and
  // list in sync. Only when the feed genuinely cannot answer does this ask the
  // server for that one design -- the same read the grid uses, addressed by id.
  // ---------------------------------------------------------------------------
  const deepLinkFetchedRef = useRef<string | null>(null);
  const [deepLinkMissing, setDeepLinkMissing] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);

  /**
   * OPEN ONE DESIGN, BY ITS GENERATION ID.
   *
   * The library hands this a generation id and the workspace fills in: master,
   * proofs, panels, revisions and assets all key off the selected design, so
   * selecting it is the whole action. The feed is consulted first when the row
   * is already in hand -- that keeps the grid's own selection in sync -- and
   * the server answers for everything else, which is most of the library: a
   * design still in Calls 1-7, one that failed there, or one belonging to a
   * customer whose work this operator is reviewing was never in the feed.
   */
  const openDesignById = useCallback(async (generationId: string) => {
    const id = String(generationId || "").trim();
    if (!id) return;
    const found = (renders || []).find((r: any) =>
      r.id === id || (r._mergedIds && r._mergedIds.includes(id))
    );
    if (found) {
      setSelectedRender(found);
      setCurrentViewIndex(0);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setOpeningId(id);
    try {
      const row = await readRevisionStudioDesign(id);
      if (!row) {
        toast.error("That design could not be opened from this account.");
        return;
      }
      setSelectedRender(row as any);
      setCurrentViewIndex(0);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      toast.error("That design could not be opened.");
    } finally {
      setOpeningId(null);
    }
  }, [renders]);
  useEffect(() => {
    if (!deepLinkId || selectedRender) return;
    if (renders) {
      // Direct ID match first, then check _mergedIds for renders that were merged
      const found = renders.find((r: any) =>
        r.id === deepLinkId || (r._mergedIds && r._mergedIds.includes(deepLinkId))
      );
      if (found) {
        setSelectedRender(found);
        setCurrentViewIndex(0);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
    }
    // Wait for the first page before deciding the feed cannot answer, so an
    // in-feed design is never fetched twice.
    if (!renders) return;
    if (deepLinkFetchedRef.current === deepLinkId) return;
    deepLinkFetchedRef.current = deepLinkId;
    let live = true;
    readRevisionStudioDesign(deepLinkId)
      .then((row) => {
        if (!live) return;
        if (!row) {
          // The honest answer: this account cannot open that design, or it does
          // not exist. Never a spinner that never resolves.
          setDeepLinkMissing(true);
          return;
        }
        setSelectedRender(row as any);
        setCurrentViewIndex(0);
        window.scrollTo({ top: 0, behavior: "smooth" });
      })
      .catch(() => { if (live) setDeepLinkMissing(true); });
    return () => { live = false; };
  }, [deepLinkId, renders, selectedRender]);

  // ---------------------------------------------------------------------------
  // ApprovePro bridge: ALWAYS load the proof's CURRENT design.
  //
  // When the shop arrives from ApprovePro (?proof_id=...) to edit a customer's
  // job, the editor must open on that customer's ACTIVE design — never blank.
  // The deep-link effect above only resolves when ?id= matches a row in the
  // shop's own render library. WPW / uploaded orders often have no
  // source_visualization_id (or a viz that isn't in this shop's library), so the
  // editor used to open empty and the shop would regenerate from scratch — which
  // swapped the vehicle (the reported "trailer wrap → red car" bug) and wiped the
  // approved artwork. Here we fetch the proof's active version's render set
  // (service-role via approvepro-versions, RLS-bypassing) and synthesize a
  // selectable render so the surgical revise-render editor edits the REAL
  // customer design. revise-render is image-to-image, so a small request ("remove
  // the S in New London Wildcats") changes only that — the trailer stays intact.
  const proofBridgeTriedRef = useRef(false);
  useEffect(() => {
    if (!bridgeProofId || selectedRender || proofBridgeTriedRef.current) return;
    // Give the ?id= deep-link match a chance first; only synthesize when it
    // cannot resolve from this shop's render library.
    if (
      deepLinkId &&
      renders &&
      renders.some(
        (r: any) => r.id === deepLinkId || (r._mergedIds && r._mergedIds.includes(deepLinkId)),
      )
    ) {
      return;
    }
    // Wait until the first page of renders has loaded so we don't synthesize
    // before the deep-link match had a chance.
    if (deepLinkId && !renders) return;
    proofBridgeTriedRef.current = true;
    // APPROVEPRO IS NOT A DESIGNPROAI SURFACE. This bridge synthesized a design
    // from an ApprovePro proof's active version so a shop could open a customer
    // order here. That product is not part of DesignProAI -- /approvemode says
    // so directly -- and the function it called is on the customer-path seam
    // gate's forbidden list. A deep link that names a proof this system has
    // never had is told the truth rather than left spinning.
    toast.error(
      "This link points at an ApprovePro order, which DesignProAI does not serve. Open the design from your Designs list.",
    );
  }, [bridgeProofId, deepLinkId, renders, selectedRender, searchParams]);

  // When opened from an ApprovePro order (?proof_id=...), pre-fill the revision
  // box with the customer's note from that order so the shop doesn't re-type the
  // requested edits — they can tweak it and hit Regenerate. Best-effort, once,
  // and never overwrites text the shop has already typed.
  const notePrefilledRef = useRef(false);
  useEffect(() => {
    if (!bridgeProofId || notePrefilledRef.current) return;
    notePrefilledRef.current = true;
    // Nothing to pre-fill: the customer note lived on the ApprovePro approval
    // row this system does not have. The revision box stays empty, which is the
    // honest state -- a box pre-filled from nowhere would read as the
    // customer's words.
  }, [bridgeProofId]);

  // ---------------------------------------------------------------------------
  // Re-read the selected design's views from the server when it looks short.
  //
  // In RestylePro a design could be spread across several rows -- a hero-only
  // sibling, a "restored" row, the full-set row -- so an incomplete card meant
  // hunting the missing angles across siblings and a linked generation row. A
  // run holds its own seven views, so there is nothing to hunt: a short set
  // means the remaining views have not been accepted yet, and the fix is to ask
  // the server again. Display only; nothing is written, and a view already in
  // hand is never replaced.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const r = selectedRender;
    if (!r?.id) return;
    const urls = (r.render_urls || {}) as Record<string, string>;
    if (Object.keys(urls).length >= 7) return; // already complete
    let cancelled = false;
    (async () => {
      const fresh = await readRevisionStudioDesign(String(r.id)).catch(() => null);
      if (!fresh || cancelled) return;
      const merged: Record<string, string> = { ...urls };
      for (const [key, value] of Object.entries(fresh.render_urls)) {
        if (!merged[key] && value) merged[key] = value;
      }
      if (Object.keys(merged).length > Object.keys(urls).length) {
        setSelectedRender((prev: any) => (prev?.id === r.id ? { ...prev, render_urls: merged } : prev));
      }
    })();
    return () => { cancelled = true; };
  }, [selectedRender?.id]);

  // ---------------------------------------------------------------------------
  // RE-SIGN THE VIEWS BEFORE OPENING A PROOF. (Trish 2026-08-31: "show 3d proof
  // button but when clicked it's blank.")
  //
  // Every artifact URL the gateway issues is a SIGNED url into the private
  // `wrap-files` bucket with `expiresIn: 300` -- five minutes. `render_urls` is
  // built from those signed urls when the grid loads, the query's `staleTime`
  // is two minutes, and `refetchOnWindowFocus` is false. So a customer who
  // lands on RevisionStudio, looks at their design, and then opens a proof is
  // past the expiry on nearly every real visit: the sheet renders with every
  // `<img>` pointing at a dead signature, which paints as broken-image glyphs
  // beside floating labels. Nothing in the client reads `expiresIn` -- it is
  // typed in five places and acted on in none.
  //
  // The effect above only fills GAPS ("a view already in hand is never
  // replaced"), which is right for an incomplete set and useless here: the
  // urls are all present and all dead. So this replaces them outright, and only
  // at the moment a proof is opened -- a sheet is printed, PDF'd and emailed,
  // which are the longest-lived actions in the product and the worst possible
  // place for a five-minute url.
  //
  // Re-signing rather than lengthening the TTL is deliberate: the bucket is
  // private, and a short signature is the reason a leaked proof url stops
  // working. This costs one read at open time and changes no security posture.
  // ---------------------------------------------------------------------------
  const openWithFreshViews = useCallback(async (open: (value: boolean) => void) => {
    const id = selectedRender?.id ? String(selectedRender.id) : null;
    // Open first. A slow or failed re-read must never swallow the click -- the
    // stale sheet is still better than a button that does nothing, and it is
    // exactly what the customer sees today.
    open(true);
    if (!id) return;
    const fresh = await readRevisionStudioDesign(id).catch(() => null);
    if (!fresh?.render_urls) return;
    setSelectedRender((prev: any) => {
      if (prev?.id !== id) return prev;
      // Replace every url the server re-signed; keep any key it no longer
      // reports rather than blanking a tile the sheet was already showing.
      return { ...prev, render_urls: { ...prev.render_urls, ...fresh.render_urls } };
    });
  }, [selectedRender?.id]);

  // ---------------------------------------------------------------------------
  // Fetch version chain for selected render
  // ---------------------------------------------------------------------------
  // FOUR HEURISTICS, REPLACED BY THE RECORD.
  //
  // This used to assemble a design's version history by guessing: rows with a
  // similar name on the same make and model, a parent_id chain walked thirty
  // levels up, six rounds of an admin_notes ilike sweep looking for children,
  // and finally a lineage_root_id union -- four overlapping searches for a
  // relationship nobody had written down, over a table that holds no rows here.
  //
  // The server writes it down. A revision is a revision OF this generation, so
  // the history is the run's own revisions and there is nothing to infer. Today
  // that is commonly one entry, which is the truthful shape and the one the
  // timeline below already renders.
  const { data: versionChain } = useQuery({
    queryKey: ["version-chain", selectedRender?.id],
    queryFn: async () => {
      if (!selectedRender?.id) return [];
      const versions = await listRevisionStudioVersions(String(selectedRender.id));
      return versions.length ? versions : [selectedRender];
    },
    enabled: !!selectedRender,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Revision Studio (Option B) shared timeline. design_version_commits is the
  // linear source-of-truth timeline, keyed by the DesignIQ generation id — the
  // SAME job id the legacy production asset store and admin page used.
  // We resolve each lineage render's generation id from its admin_notes and read
  // every commit across the chain, so this page surfaces the SAME version data
  // any other surface records/reads via @/lib/revision-commits. RevisionStudioIQ
  // stays its own page but shares the versions rather than owning a private copy.
  const genIdOf = useCallback((row: any): string | null => {
    if (!row) return null;
    try { return JSON.parse(row.admin_notes || "{}").designiq_generation_id || null; }
    catch { return null; }
  }, []);

  /**
   * The id Production Layers is about. A panelizer-sourced row's own `id` is a
   * job id, which no resolver can match, so the linked design id is handed over
   * instead -- exactly the id class both the legacy resolver and the standalone
   * gateway understand.
   */
  const productionLayersId = useMemo(() => (
    ((selectedRender as any)?.__source === LEGACY_PANELIZER_SOURCE
      ? (selectedRender as any)?._generationId
      : null)
    || selectedRender?.id
    || genIdOf(selectedRender)
    || null
  ), [selectedRender, genIdOf]);

  // Null unless this design is a standalone run, which is what lets the card
  // keep its existing behaviour for every design that is not.
  const standaloneProductionLayers = useStandaloneProductionLayers(productionLayersId, {
    returnPath: typeof window !== "undefined" ? window.location.pathname : undefined,
  });

  const submitSavedRevision = useCallback(async ({
    render,
    trigger,
    change,
  }: {
    render: any;
    trigger: DesignBuildTrigger;
    change: {
      type: "generate" | "edit" | "revision";
      prompt?: string | null;
      viewKeys?: string[];
    };
  }) => {
    if (!render?.id) throw new Error("No saved design is selected");
    // Re-read the design from the server before submitting. There is no
    // optimistic-lock timestamp to freeze against any more: the run's state is
    // the truth and the server refuses work that does not fit it, so this read
    // exists to fail early and honestly on a design the gateway does not own.
    const frozen = await readRevisionStudioDesign(String(render.id));
    if (!frozen) throw new Error("The saved revision could not be frozen");
    return await requestDesignBuild({
      visualizationId: frozen.id,
      generationId: frozen.id,
      expectedUpdatedAt: frozen.updated_at,
      trigger,
      change,
    });
  }, []);

  const persistViewRevision = useCallback(async ({
    render,
    renderUrls,
    trigger,
    change,
    patch = {},
  }: {
    render: any;
    renderUrls: Record<string, string>;
    trigger: DesignBuildTrigger;
    change: {
      type: "generate" | "edit" | "revision";
      prompt?: string | null;
      viewKeys?: string[];
    };
    patch?: Record<string, unknown>;
  }) => {
    if (!render?.id) throw new Error("No saved design is selected");
    // Re-read the design from the server before persisting anything.
    //
    // This mattered enormously in the old world: the caller passed a render
    // object held in React state whose updated_at was captured when the job was
    // opened, before the hero and six view renders each rewrote the same row,
    // and the enqueue RPC compared timestamps under a FOR UPDATE lock. A stale
    // value rolled the entire commit back, which is how "it had all 7 angles"
    // became "6 of 7 views missing" on reopen -- six rendered images lost with
    // the tab because one timestamp was old.
    //
    // The views are server-owned now, so that failure mode is gone with the
    // write it protected. The re-read stays because the rest of this function
    // needs the design's current state, and because a design the gateway does
    // not own should fail here rather than three steps later.
    let source = render;
    {
      const current = await readRevisionStudioDesign(String(render.id));
      if (!current) throw new Error("The edited revision could not be resolved");
      source = { ...render, ...current };
    }

    const allowedPatchKeys = new Set([
      "admin_notes",
      "vehicle_type",
      "finish_type",
    ]);
    const unsupportedPatchKeys = Object.keys(patch).filter(
      (key) => !allowedPatchKeys.has(key),
    );
    if (unsupportedPatchKeys.length) {
      throw new Error(
        `Unsupported atomic revision patch: ${unsupportedPatchKeys.join(", ")}`,
      );
    }
    let adminNotesPatch: Record<string, unknown> = {};
    if (patch.admin_notes !== undefined) {
      try {
        const parsed =
          typeof patch.admin_notes === "string"
            ? JSON.parse(patch.admin_notes)
            : patch.admin_notes;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("admin_notes must be an object");
        }
        adminNotesPatch = parsed as Record<string, unknown>;
      } catch (error) {
        throw new Error(
          `The revision metadata is invalid: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    let generationId: string | undefined;
    let existingNotes: Record<string, unknown> = {};
    try {
      const notes =
        typeof source.admin_notes === "string"
          ? JSON.parse(source.admin_notes)
          : source.admin_notes || {};
      existingNotes = notes;
      generationId =
        typeof adminNotesPatch.designiq_generation_id === "string"
          ? adminNotesPatch.designiq_generation_id
          : typeof notes.designiq_generation_id === "string"
            ? notes.designiq_generation_id
            : undefined;
    } catch {
      generationId = undefined;
    }
    const accepted = await readDesignAfterEdit({
      render: source,
      renderUrls,
      trigger,
      change,
      patch,
    });
    const mergedNotes = { ...existingNotes, ...adminNotesPatch };
    // The server's answer wins on the views, because it owns them. The notes
    // are the page's own working metadata for this session, so the local merge
    // stands -- it is what the revision instruction is composed from, not
    // something the pipeline reads.
    const saved = {
      id: source.id,
      updated_at: accepted.updated_at,
      render_urls: accepted.render_urls,
      admin_notes: JSON.stringify(mergedNotes),
    };
    setSelectedRender((previous: any) =>
      previous?.id === source.id
        ? {
            ...previous,
            render_urls: renderUrls,
            updated_at: accepted.updated_at,
            admin_notes: saved.admin_notes,
            ...(patch.finish_type !== undefined
              ? { finish_type: patch.finish_type }
              : {}),
            ...(patch.vehicle_type !== undefined
              ? { vehicle_type: patch.vehicle_type }
              : {}),
          }
        : previous,
    );
    // Every successful atomic save appends an immutable ledger commit. Refresh
    // the OS timeline immediately; its 60-second cache must never make a new
    // precise edit, mirror, or in-place revision look like it disappeared.
    queryClient.invalidateQueries({ queryKey: ["version-commits"] });
    return { saved, accepted };
  }, [queryClient]);

  const savePreciseEditRevision = useCallback(async (
    render: any,
    viewKey: string,
    newRenderUrl: string,
  ) => {
    const updatedUrls = {
      ...(render.render_urls || {}),
      [viewKey]: newRenderUrl,
    };
    await persistViewRevision({
      render,
      renderUrls: updatedUrls,
      trigger: "precise_edit",
      change: { type: "edit", viewKeys: [viewKey] },
    });
    setSelectedRender((previous: any) =>
      previous?.id === render.id
        ? { ...previous, render_urls: updatedUrls }
        : previous,
    );
    queryClient.invalidateQueries({
      queryKey: ["revision-studio-renders"],
    });
  }, [persistViewRevision, queryClient]);

  // Hand the Design Assets page everything THIS page is already displaying —
  // views, the stored 2D proof, and the saved clean/branded artboards — via the
  // sessionStorage `buildctx` stash (the same mechanism ApprovePro's "Build print
  // panels" uses). The Design Assets page is often opened on the DesignIQ
  // generation id, whose DB row is near-empty; its reverse admin_notes link to
  // the legacy design row can miss (RecreatePro clones), and then Build
  // Assets reports "no continuous clean artboard to slice / generate the 2D
  // proof first" even though the proof is sitting right here. The stash makes
  // the handoff carry the assets instead of hoping the DB linkage resolves.
  const stashBuildCtx = useCallback((row: any, assetsId: string) => {
    if (!row || !assetsId) return;
    try {
      const ru = (row.render_urls || {}) as Record<string, unknown>;
      const viewsMap: Record<string, string> = {};
      for (const [k, v] of Object.entries(ru)) {
        if (typeof v === "string" && v && !["production_proof", "proof_2d", "master_artboard", "artboard"].includes(k)) {
          viewsMap[k] = v;
        }
      }
      let notes: any = {};
      try { notes = JSON.parse(row.admin_notes || "{}"); } catch { /* not JSON */ }
      sessionStorage.setItem(`buildctx:${assetsId}`, JSON.stringify({
        render_urls: viewsMap,
        flat_proof_url: (ru.production_proof as string) || (ru.proof_2d as string) || notes.flat_proof_url || null,
        artboard_clean_url: notes.artboard_clean_url || null,
        artboard_branded_url: notes.artboard_branded_url || null,
        make: row.vehicle_make || null,
        model: row.vehicle_model || null,
        year: row.vehicle_year || null,
      }));
    } catch { /* storage disabled — the page's DB resolvers still apply */ }
  }, []);
  /**
   * ONE VERSION HISTORY, SHARED WITH PANELPRO.
   *
   * This read `design_version_commits` -- a separate table with its OWN
   * version_number, its own prompt column and a browser-side writer. PanelPro
   * read the server's A.T.L.A.S. revision lineage. Two histories of one job,
   * numbered independently: V2 here was not necessarily V2 there, and a
   * revision made on this page had no reason to appear in PanelPro at all.
   *
   * The fix is not a sync job -- it is deleting one of the two answers. The
   * server's revision sequence is the version number now, its stored
   * instruction is the prompt verbatim, and its stamp is the timestamp. Both
   * surfaces call the same reader, so a revision created here shows up in
   * PanelPro with the same number, the same words and the same master, because
   * it is the same record and not a copy of one.
   *
   * The timeline below is untouched: the canonical history is projected into
   * the exact shape it already draws.
   */
  const { data: versionCommits } = useQuery<VersionCommit[]>({
    queryKey: ["design-version-history", selectedRender?.id],
    queryFn: async () =>
      (await revisionStudioVersionCommits(String(selectedRender?.id || ""))) as unknown as VersionCommit[],
    enabled: !!selectedRender?.id,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });
  // ---------------------------------------------------------------------------
  // Push to ApprovePro — take the CURRENTLY-OPEN Revision Studio design (its
  // angle renders + 2D proof) and push it onto an ApprovePro order's proof as
  // the active version, so it surfaces in the ApprovePro command center.
  //   - Resolve the proof by order # across the metadata keys ApprovePro stamps.
  //   - Clone the design's render_urls, fold in its resolved 2D proof, mirror a
  //     hero from `side` if missing.
  //   - proof-save-version sets it as the proof's active version (it requires the
  //     proof mode === "revision_loop" and that the caller owns the shop — if it
  //     409s on ownership/mode, we surface that message verbatim).
  //   - Then point source_visualization_id at this design's generation id.
  // ---------------------------------------------------------------------------
  const pushToApprovePro = async () => {
    const raw = pushOrderNo.trim();
    if (!raw) {
      toast.error("Enter an ApprovePro order number");
      return;
    }
    const digits = raw.replace(/\D/g, "") || raw;

    if (!selectedRender) {
      toast.error("Open a design first");
      return;
    }

    setPushing(true);
    try {
      // APPROVEPRO IS NOT A DESIGNPROAI SURFACE. This pushed the open design's
      // render set and 2D proof onto an ApprovePro order's proof as its active
      // version. That product is not part of DesignProAI -- /approvemode says
      // so directly -- and both the approval table and the save function it
      // used are on the customer-path seam gate's forbidden list. The button is
      // only rendered behind the APPROVEPRO_UI_LIVE flag, which is off, so this
      // says why rather than silently doing nothing.
      toast.error(
        "ApprovePro is not part of DesignProAI, so there is no order to push this design onto.",
      );
      return;
    } catch (e: any) {
      toast.error(e?.message || "Failed to push to ApprovePro");
    } finally {
      setPushing(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Download with official stamp overlay
  // ---------------------------------------------------------------------------
  const buildRenderOverlay = (render: any): OverlaySpec => {
    const modeType = render.mode_type || "";
    const toolKey = modeType === "designpanelpro" ? "designpanelpro"
      : modeType === "recreatepro" || modeType === "designpro" ? "designpanelpro"
      : modeType === "colorpro" ? "colorpro"
      : modeType === "fadewraps" ? "fadewraps"
      : modeType === "wbty" ? "wbty"
      : modeType === "approvemode" ? "approvepro"
      : undefined;
    // Parse manufacturer from admin_notes or color_name
    let manufacturer = "";
    let colorOrDesignName = render.color_name || render.design_file_name || "";
    try {
      const notes = JSON.parse(render.admin_notes || "{}");
      if (notes.manufacturer) manufacturer = notes.manufacturer;
      if (notes.product_code) colorOrDesignName = `${render.color_name || ""} ${notes.product_code}`.trim();
    } catch {}
    return { toolKey: toolKey as any, manufacturer, colorOrDesignName };
  };

  const handleDownloadRender = async (render: any) => {
    if (!render) return;
    const urls = render.render_urls as Record<string, string> | null;
    const heroUrl = urls?.side || urls?.hero || Object.values(urls || {})[0];
    if (!heroUrl) { toast.error("No render image found"); return; }
    const overlay = buildRenderOverlay(render);
    const filename = `${render.color_name || "render"} - ${render.vehicle_year || ""} ${render.vehicle_make || ""} ${render.vehicle_model || ""}`.trim();
    try {
      await downloadWithOverlay(heroUrl, filename, overlay);
      toast.success("Downloaded with stamp overlay");
    } catch (err) {
      toast.error("Download failed");
    }
  };

  const [downloadingAll, setDownloadingAll] = useState(false);

  const handleDownloadAllRenders = async (render: any) => {
    if (!render) return;
    const urls = render.render_urls as Record<string, string> | null;
    const entries = Object.entries(urls || {}).filter(
      ([key, url]) => typeof url === "string" && url && !key.includes("spin")
    ) as Array<[string, string]>;
    if (entries.length === 0) { toast.error("No render images found"); return; }

    const overlay = buildRenderOverlay(render);
    const baseName = `${render.color_name || "render"} - ${render.vehicle_year || ""} ${render.vehicle_make || ""} ${render.vehicle_model || ""}`
      .replace(/\s+/g, " ")
      .trim();
    const sanitize = (s: string) => s.replace(/[^a-z0-9-_ ]/gi, "").trim();
    const images = entries.map(([viewKey, url]) => ({
      url,
      filename: `${sanitize(baseName)} - ${VIEW_LABELS[viewKey] || viewKey}`,
    }));

    setDownloadingAll(true);
    toast.info(`Preparing ${images.length} views...`);
    try {
      await downloadAllWithOverlay(images, overlay);
      toast.success(`Downloaded ${images.length} views with stamp overlay`);
    } catch (err) {
      toast.error("Download all failed");
    } finally {
      setDownloadingAll(false);
    }
  };

  const [reStamping, setReStamping] = useState(false);

  const handleReStampRender = async (render: any) => {
    if (!render) return;
    setReStamping(true);
    try {
      const urls = render.render_urls as Record<string, string> | null;
      if (!urls) throw new Error("No render URLs");
      const overlay = buildRenderOverlay(render);
      const stampedUrls: Record<string, string> = {};

      for (const [key, url] of Object.entries(urls)) {
        if (!url || typeof url !== "string") continue;
        try {
          const blob = await stampOverlayOnImage(url, overlay);
          const fileName = `stamped/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
          const { error } = await supabase.storage.from("color-renders").upload(fileName, blob, { contentType: "image/png" });
          if (error) throw error;
          const { data: urlData } = supabase.storage.from("color-renders").getPublicUrl(fileName);
          stampedUrls[key] = urlData.publicUrl;
        } catch {
          stampedUrls[key] = url; // keep original on failure
        }
      }

      // Stamps are display/download derivatives. Never replace the immutable
      // production source views with watermarked copies.
      sessionStorage.setItem(
        `revision-stamped-views:${render.id}`,
        JSON.stringify(stampedUrls),
      );
      toast.success("Stamped display copies prepared; source views preserved");
    } catch (err) {
      toast.error("Re-stamp failed");
    } finally {
      setReStamping(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Clone & Revise mutation
  // ---------------------------------------------------------------------------
  const cloneAndRevise = useMutation({
    mutationFn: async ({ sourceRender, notes, vehicleOverride, visionBoardImages, visionBoardIntent, currentViewKey, applyToAll, targetViewKeys, panelTargets, logoLayersByView: logoLayersArg, cleanBackgroundsByView: cleanBgsArg }: { sourceRender: any; notes: string; vehicleOverride?: { year: string; make: string; model: string }; visionBoardImages?: VisionBoardImage[]; visionBoardIntent?: VisionBoardIntent; currentViewKey?: string; applyToAll?: boolean; targetViewKeys?: string[]; panelTargets?: string[]; logoLayersByView?: Record<string, LogoLayer[]>; cleanBackgroundsByView?: Record<string, string> }) => {
      // Refresh session before any DB/edge-function calls to prevent Invalid JWT
      const freshToken = await getFreshAccessToken();
      if (!freshToken) {
        throw new Error("Session expired - please log in again and retry.");
      }

      // Never route camera distance/framing through a generative image edit.
      // It must be performed by the source-bound geometry control so the
      // approved design, vehicle angle and complete silhouette are preserved.
      if (isCameraFramingOnlyRevision(notes)) {
        throw new Error(
          "Camera distance changes are temporarily locked because they require an exact source-bound reframe. The approved view was left unchanged; no AI regeneration was started.",
        );
      }

      // Detect view-change requests (close-up, zoom in, different angle, etc.)
      // These should generate the requested view, NOT revise the current image.
      //
      // IMPORTANT: these patterns must NOT fire on ordinary design edits that
      // merely name a panel or use "want/give/show". Phrases like "I want the
      // front to be silver", "give the hood a matte finish", or "show more grey
      // on the roof" are REVISIONS, not requests for a new camera angle — the
      // old `(show|give|want) ... (front|hood|roof|...)` rule hijacked them and
      // silently generated a view instead of applying the change (the #1
      // "RevisionIQ ignored what I asked" complaint). We now only redirect when
      // the request explicitly asks to SEE a view: a close-up/zoom, an explicit
      // "X view/shot/angle/photo", or a bare "different/another angle|view".
      const viewChangePatterns = [
        /\b(close[\s-]?up|closeup|macro|zoom\s*in|zoomed\s*in)\b/i,
        /\b(show|give|need|want)\s+(me\s+)?(a\s+|the\s+|another\s+)?(close[\s-]?up|(?:front|rear|back|hood|roof|top|side|overhead)\s+(?:view|shot|angle|photo|image|picture))\b/i,
        /\b(different|another|change)\s+(angle|view|perspective)\b/i,
        /\b(front|rear|back|hood|roof|top|overhead)\s+(view|shot|angle)\b/i,
      ];
      const viewChangeMatch = viewChangePatterns.some(p => p.test(notes));
      if (viewChangeMatch) {
        // Map the user's request to a view key
        const lowerNotes = notes.toLowerCase();
        let targetView: string | null = null;
        if (/close[\s-]?up|closeup|macro|zoom/i.test(lowerNotes)) targetView = "close-up";
        else if (/front/i.test(lowerNotes)) targetView = "front";
        else if (/rear|back/i.test(lowerNotes)) targetView = "rear";
        else if (/hood/i.test(lowerNotes)) targetView = "hood_detail";
        else if (/roof|top|overhead/i.test(lowerNotes)) targetView = "roof";

        if (targetView) {
          const existingUrls = (sourceRender.render_urls || {}) as Record<string, string>;
          // Only redirect when the requested view is MISSING — then the user is
          // asking to SEE a new angle, so generate it. If the view already
          // exists, the prompt is a revision of that view (e.g. "fix the front
          // view"); blocking it with "view already exists" forced users to
          // delete the view just to revise it. Fall through to a normal
          // revision instead.
          if (!existingUrls[targetView]) {
            toast.info(`Generating ${VIEW_LABELS[targetView] || targetView} view - this is a new angle, not a revision.`);
            generateMissingViews(sourceRender);
            throw new Error("Redirected to view generation");
          }
        }
      }

      // Block ONLY whole-design "throw it all away and start over" requests —
      // the Master Editor is explicitly built to execute big, multi-zone changes
      // (recolor a zone, strip the wrap off a panel, change coverage, swap a
      // pattern on the doors). The old guard over-reached: bare "new look",
      // "different style", or "different pattern" matched legitimate PARTIAL
      // redesigns and blocked them, contradicting the North Star ("master
      // designer, not pixel-cloner"). We now only stop a request when it asks to
      // discard the ENTIRE design — those genuinely need a fresh generation.
      const majorChangePatterns = [
        /\bcompletely\s+(change|redesign|redo|replace|different|new)\b/i,
        /\b(totally|entirely)\s+(change|different|new|redesign|redo|replace)\b/i,
        /\bmake\s+it\s+(completely|totally|entirely)\s+different\b/i,
        /\b(start\s+over|start\s+from\s+scratch|from\s+scratch)\b/i,
        /\b(redesign|redo|change|replace|swap)\s+(everything|the\s+entire|the\s+whole)\b/i,
        /\bscrap\s+(this|it|the\s+(whole\s+)?design)\b/i,
        /\b(remove|strip|delete)\s+(everything|all|the\s+entire|the\s+whole)\b/i,
      ];
      if (majorChangePatterns.some(p => p.test(notes))) {
        toast.error("Whole-design redo detected — revisions adjust the existing design. To start over from scratch, generate a new render.");
        throw new Error("Major redesign blocked");
      }

      const currentVersion = parseVersionInfo(sourceRender);
      // Editing a PAST version must create a NEW highest version, not collide.
      // sourceVersion+1 meant editing V2 (when V4 already exists) produced a
      // SECOND "(V3)" — two rows with the same version number, which broke the
      // filmstrip selection and made past-version edits look like they "didn't
      // take". Base the new number on the max across the whole lineage so every
      // edit — from any version — lands as the next clean version.
      const lineageMaxVersion = Math.max(
        currentVersion.version,
        ...((versionChain || []).map((r: any) => parseVersionInfo(r).version)),
      );
      const newVersion = lineageMaxVersion + 1;
      const baseName = (sourceRender.design_file_name || sourceRender.color_name || "Design")
        .replace(/\s*\(V\d+\)$/, "");

      const existingNotes = (() => {
        try { return JSON.parse(sourceRender.admin_notes || "{}"); } catch { return {}; }
      })();

      // Resolve vehicle - use override if provided, otherwise keep source
      const resolvedVehicle = {
        year: vehicleOverride?.year || String(sourceRender.vehicle_year),
        make: vehicleOverride?.make || sourceRender.vehicle_make,
        model: vehicleOverride?.model || sourceRender.vehicle_model,
      };

      // Extract the original creative prompt from admin_notes
      const originalPrompt = existingNotes.original_prompt
        || sourceRender.custom_styling_prompt_key
        || "";

      // Preserve designiq_mode + commercial details across revisions
      // Async lookup handles legacy records that don't have mode in admin_notes
      const isDesignPro = sourceRender.mode_type === "designpanelpro" || sourceRender.mode_type === "designpro";
      const designIQInfo = isDesignPro
        ? await getDesignIQModeAndDetails(sourceRender)
        : { mode: "restyle" as const };

      // Build prompt history chain - carry forward from parent + append current revision
      const parentHistory: Array<{ version: number; prompt: string; timestamp: string; view_key: string; type: string }> =
        existingNotes.prompt_history || [];
      const seededHistory = parentHistory.length === 0 && originalPrompt
        ? [{ version: 1, prompt: originalPrompt, timestamp: sourceRender.created_at || new Date().toISOString(), view_key: "side", type: "original" }]
        : [...parentHistory];
      // For Restyle on New Vehicle, store the vehicle change as the prompt entry
      const promptEntry = notes.trim()
        ? notes
        : (vehicleOverride ? `Restyled on ${vehicleOverride.year} ${vehicleOverride.make} ${vehicleOverride.model}` : "Clone");
      const promptType = notes.trim() ? "revision" : (vehicleOverride ? "restyle" : "clone");
      const promptHistory = [
        ...seededHistory,
        { version: newVersion, prompt: promptEntry, timestamp: new Date().toISOString(), view_key: currentViewKey || "side", type: promptType },
      ];

      // Ensure VisionBoard image URLs are cached in admin_notes for this and future revisions
      if (!existingNotes.visionboard_image_urls) {
        const vbUrls = await getVisionBoardImageUrls(sourceRender);
        if (vbUrls.length > 0) {
          existingNotes.visionboard_image_urls = vbUrls;
        }
      }

      // The revised view gets a brand-new AI render, so any logo layer or
      // "lifted" clean background captured against the OLD render no longer
      // applies. Carrying it over makes the viewer show that stale background
      // instead of the fresh render (the "V2 won't show in the big window" bug).
      // Drop the revised view's entries; keep other views' layers intact.
      const mergedBackgrounds: Record<string, string> = { ...(existingNotes.logo_layers?.backgrounds || {}), ...(cleanBgsArg || {}) };
      const mergedLayers: Record<string, LogoLayer[]> = { ...(existingNotes.logo_layers?.layers || {}), ...(logoLayersArg || {}) };
      if (notes.trim()) {
        const revisedKey = currentViewKey || "side";
        delete mergedBackgrounds[revisedKey];
        delete mergedLayers[revisedKey];
      }
      const hasLayerData = Object.keys(mergedBackgrounds).length > 0 || Object.keys(mergedLayers).length > 0;

      const versionMeta = {
        ...existingNotes,
        original_prompt: originalPrompt, // Preserve for future revisions
        prompt_history: promptHistory, // Living chain of all prompts
        designiq_mode: existingNotes.designiq_mode || designIQInfo.mode,
        ...(designIQInfo.mode === "commercial" ? {
          company_name: existingNotes.company_name || designIQInfo.companyName,
          phone: existingNotes.phone || designIQInfo.phone,
          mascot: existingNotes.mascot || designIQInfo.mascot,
          industry_type: existingNotes.industry_type || designIQInfo.industryType,
          brand_keywords: existingNotes.brand_keywords || designIQInfo.bulletPoints,
        } : {}),
        version: {
          parent_id: sourceRender.id,
          version: newVersion,
          revision_notes: promptEntry,
          revised_view_key: currentViewKey || "side",
          primary_changed_view_key: currentViewKey || "side",
          changed_view_keys: [currentViewKey || "side"],
          vehicle_override: vehicleOverride || null,
          cloned_at: new Date().toISOString(),
        },
        // Persist logo layers + clean backgrounds so QC artboard and the
        // print pipeline can re-composite them at exact coordinates. The
        // revised view's stale entries were dropped above so the new render shows.
        logo_layers: hasLayerData
          ? ({ backgrounds: mergedBackgrounds, layers: mergedLayers } satisfies RenderLogoLayers)
          : undefined,
      };

      // Determine the effective prompt for the revision:
      // - typed revision notes win, prefixed with any panel targeting;
      // - a Restyle on New Vehicle with no notes re-uses the original brief.
      const isRestyleOnNewVehicle = !!vehicleOverride && !notes.trim();
      const panelPrefix = panelTargets && panelTargets.length > 0
        ? `Apply ONLY to ${panelTargets.map(k => PANEL_TARGETS.find(p => p.key === k)?.label || k).join(", ")}. `
        : "";
      const effectivePrompt = notes.trim()
        ? panelPrefix + notes
        : (isRestyleOnNewVehicle
            ? (originalPrompt || `Restyle this wrap design on a ${resolvedVehicle.year} ${resolvedVehicle.make} ${resolvedVehicle.model}`)
            : "");
      if (!effectivePrompt.trim()) {
        throw new Error(
          "Type what you want changed. A revision is authored from the brief, so an empty note has nothing to act on.",
        );
      }

      // THE SERVER AUTHORS THE REVISION. A.T.L.A.S. AUTHORS THE DESIGN.
      //
      // This used to clone the design row in the browser, then repaint the
      // CURRENT VIEW'S IMAGE: `revise-render` for a normal edit,
      // `edit-vehicle-photo` for a MyVehicle shot, `design-panel-ai-generate`
      // or `generate-color-render` for a restyle -- four generative producers
      // driven from a tab, each editing a 3D proof as though the proof were the
      // design, and then writing the result back as the new version.
      //
      // A.T.L.A.S. authors one flattened master and every one of the seven
      // views is a projection of it. Repainting a projection cannot change the
      // design; it can only make one view disagree with the master the panels
      // are cut from. The gateway already refuses the browser's version of this
      // outright -- a per-view regenerate against a flat-first request comes
      // back as "a new run is required".
      //
      // So a revision is submitted as what it actually is: a new A.T.L.A.S.
      // design authored from this design's own brief plus the change the
      // customer asked for, on the same vehicle. The original design, its
      // master, its proofs and its panels are untouched -- which is exactly
      // what "original preserved" has always meant on this button.
      const designName = `${baseName} (V${newVersion})`;
      const revised = await submitDesignRevision({
        source: sourceRender,
        instruction: effectivePrompt,
        vehicle: resolvedVehicle,
        designName,
      });

      // The card the page selects while the server works. Its views are empty
      // because none exist yet -- the seven proofs arrive as the run accepts
      // them, and the page's own re-read fills them in. An optimistic copy of
      // the old design's renders here would show the customer the PREVIOUS
      // design labelled as the new version.
      return {
        ...sourceRender,
        id: revised.generationId,
        design_file_name: designName,
        color_name: designName,
        render_urls: {},
        admin_notes: JSON.stringify(versionMeta),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        generation_status: "processing",
      };
    },
    onSuccess: (newRender) => {
      queryClient.invalidateQueries({ queryKey: ["revision-studio-renders"] });
      queryClient.invalidateQueries({ queryKey: ["version-chain"] });
      const version = parseVersionInfo(newRender);
      const isRestyle = version.revisionNotes?.startsWith("Restyled on ");
      toast.success(isRestyle
        ? `V${version.version} restyled on new vehicle - generating all views...`
        : `V${version.version} created with revision - original preserved`);
      // "Here's what I changed" — designer-style readback of the edits the AI
      // applied, so the user can confirm it understood the request.
      try {
        const an = JSON.parse(newRender?.admin_notes || "{}");
        if (an.ai_edit_summary) {
          toast.message("Here's what I changed", { description: an.ai_edit_summary, duration: 12000 });
        }
      } catch { /* non-fatal */ }
      setSelectedRender(newRender);
      // Stay on the revised view so user sees the edit (don't reset to 0)
      const newViews = getViews(newRender);
      const revisedKey = version.revisedViewKey || "side";
      const revisedIdx = newViews.findIndex((v) => v.key === revisedKey);
      setCurrentViewIndex(revisedIdx >= 0 ? revisedIdx : 0);
      setShowReviseDialog(false);
      setRevisionNotes("");
      setApplyToAllViews(false);
      setScopeViewKeys(null);
      setRevisionPanelTargets([]);
      setOverrideYear("");
      setOverrideMake("");
      setOverrideModel("");

      // Auto-generate all missing views for Restyle on New Vehicle
      if (isRestyle) {
        const missing = getMissingViews(newRender);
        if (missing.length > 0) {
          console.log(`[RevisionIQ] Restyle complete - auto-generating ${missing.length} remaining views`);
          generateMissingViews(newRender);
        }
      }
    },
    onError: (err: any) => {
      const msg = String(err?.message || "");
      // Check the concrete, non-auth failure modes FIRST so a message that
      // merely mentions "token" (out-of-tokens paywall, AI-failure refund) is
      // never mistaken for an expired session and used to bounce the user to
      // /login. Auth is the last-resort classification.
      // Token gate 402 — show paywall hint, not the raw "Out of tokens" text.
      if (/out of tokens|no_tokens|402/i.test(msg)) {
        toast.error("You're out of revision tokens. Buy more on /pricing or upgrade your plan.", { duration: 8000 });
        return;
      }
      // Honesty guard — the AI produced an image but it didn't visibly change.
      // The edge message is already customer-friendly; show it as-is (NOT a
      // success, NOT a generic failure). Must be checked before the AI-failure
      // branch because its message also contains "token was refunded".
      if (/no_visible_change|didn't visibly change/i.test(msg)) {
        toast.error(msg, { duration: 12000 });
        return;
      }
      // Gemini failed — token was refunded by the edge fn, tell the user.
      if (/all tiers failed|AI couldn't|gemini_no_image|RENDER_FAILED|token was refunded|token refunded/i.test(msg)) {
        toast.error(`The AI couldn't generate this revision — try a shorter or different prompt.${extractFailureDetail(msg)}`, { duration: 10000 });
        return;
      }
      if (isAuthError(msg)) {
        toast.error("Session expired - redirecting to login...");
        setTimeout(() => { window.location.href = "/login"; }, 1500);
        return;
      }
      toast.error(`Revision failed: ${msg || "Unknown error"}`);
    },
  });

  // ---------------------------------------------------------------------------
  // Revise In Place - edit the EXISTING render without cloning
  // ---------------------------------------------------------------------------
  const reviseInPlace = useMutation({
    mutationFn: async ({ render, notes, visionBoardImages, visionBoardIntent, currentViewKey, applyToAll, panelTargets }: { render: any; notes: string; visionBoardImages?: VisionBoardImage[]; visionBoardIntent?: VisionBoardIntent; currentViewKey?: string; applyToAll?: boolean; panelTargets?: string[] }) => {
      if (!notes.trim()) throw new Error("Revision notes are required");

      // Prepend panel targeting if specific panels are selected
      const panelPrefix = panelTargets && panelTargets.length > 0
        ? `Apply ONLY to ${panelTargets.map(k => PANEL_TARGETS.find(p => p.key === k)?.label || k).join(", ")}. `
        : "";
      const targetedNotes = panelPrefix + notes;

      // THERE IS NO IN-PLACE REVISION OF AN A.T.L.A.S. DESIGN.
      //
      // "Revise in place" repainted the current view's image and wrote it back
      // onto the same design, so the customer kept one row and one version. That
      // is coherent when a design IS its renders. It is not coherent here: the
      // seven views are projections of one accepted master, the six print panels
      // are cut from that same master, and a repainted view would leave the
      // design saying one thing and the panels printing another -- silently,
      // because nothing downstream re-reads a proof.
      //
      // So this does what the button has always meant -- apply my change to this
      // design -- through the only mechanism that keeps proofs and panels
      // agreeing: A.T.L.A.S. authors the change, and the previous version is
      // preserved rather than overwritten. The version history is the record of
      // that, and it is the reason nothing is lost.
      const version = parseVersionInfo(render);
      const lineageMaxVersion = Math.max(
        version.version,
        ...((versionChain || []).map((r: any) => parseVersionInfo(r).version)),
      );
      const baseName = (render.design_file_name || render.color_name || "Design")
        .replace(/\s*\(V\d+\)$/, "");
      const designName = `${baseName} (V${lineageMaxVersion + 1})`;
      const revised = await submitDesignRevision({
        source: render,
        instruction: targetedNotes,
        vehicle: {
          year: String(render.vehicle_year || ""),
          make: String(render.vehicle_make || ""),
          model: String(render.vehicle_model || ""),
        },
        designName,
      });
      return {
        ...render,
        id: revised.generationId,
        design_file_name: designName,
        color_name: designName,
        render_urls: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        generation_status: "processing",
      };
    },
    onSuccess: (updatedRender) => {
      queryClient.invalidateQueries({ queryKey: ["revision-studio-renders"] });
      queryClient.invalidateQueries({ queryKey: ["version-chain"] });
      toast.success("Revision submitted — your new version is being designed. The previous version is preserved.");
      setSelectedRender(updatedRender);
      // Stay on the revised view so user sees the edit (don't reset to 0)
      const newViews = getViews(updatedRender);
      const existingNotesP = (() => { try { return JSON.parse(updatedRender.admin_notes || "{}"); } catch { return {}; } })();
      const revisedKey = existingNotesP.revised_view_key || "side";
      const revisedIdx = newViews.findIndex((v) => v.key === revisedKey);
      setCurrentViewIndex(revisedIdx >= 0 ? revisedIdx : 0);
      setRevisionNotes("");
      setApplyToAllViews(false);
      setScopeViewKeys(null);
      setRevisionPanelTargets([]);
    },
    onError: (err: any) => {
      const msg = String(err?.message || "");
      // Non-auth failure modes first — a message mentioning "token" (out of
      // tokens, AI-failure refund) must not be mistaken for an expired session.
      if (/out of tokens|no_tokens|402/i.test(msg)) {
        toast.error("You're out of revision tokens. Buy more on /pricing or upgrade your plan.", { duration: 8000 });
        return;
      }
      // Honesty guard — AI returned an image but nothing visibly changed.
      // Edge message is already customer-friendly; checked before the AI-failure
      // branch (its message also contains "token was refunded").
      if (/no_visible_change|didn't visibly change/i.test(msg)) {
        toast.error(msg, { duration: 12000 });
        return;
      }
      if (/all tiers failed|AI couldn't|gemini_no_image|RENDER_FAILED|token was refunded|token refunded/i.test(msg)) {
        toast.error(`The AI couldn't generate this revision — try a shorter or different prompt.${extractFailureDetail(msg)}`, { duration: 10000 });
        return;
      }
      if (isAuthError(msg)) {
        toast.error("Session expired - redirecting to login...");
        setTimeout(() => { window.location.href = "/login"; }, 1500);
        return;
      }
      toast.error(`Revision failed: ${msg}`);
    },
  });

  // ---------------------------------------------------------------------------
  // Generate Missing Views
  // ---------------------------------------------------------------------------
  // MISSING VIEWS ARE THE SERVER'S WORK, NOT THE TAB'S.
  //
  // This used to fan the missing angles out from the browser: resolve GENIE
  // dimensions, downscale a hero anchor, call the render function once per view
  // with its own retry ladder, accumulate the results in React state, then
  // persist all six in a single commit at the end. Backgrounding the tab on a
  // phone suspended it mid-run, and a refused final commit threw away every
  // image it had already paid for.
  //
  // The runtime owns this now. A.T.L.A.S. renders Driver first, hash-verifies
  // it, then projects the remaining six from the same accepted master
  // concurrently -- so the views cannot drift apart, nothing is lost to a
  // closed tab, and there is no per-view budget for a browser to spend. All a
  // click here can honestly do is ask the server to pick pending work back up.
  const generateMissingViews = async (render: any) => {
    const missing = getMissingViews(render);
    if (missing.length === 0) {
      toast.success("All views already exist!");
      return;
    }
    if (!render?.id) {
      toast.error("Open a design first.");
      return;
    }
    setIsGeneratingMissing(true);
    setGeneratingViews([...missing]);
    setCompletedMissingViews([]);
    setFailedMissingViews([]);
    try {
      await requestDesignBuild({
        generationId: String(render.id),
        trigger: "missing_views_completed",
        change: { type: "generate", viewKeys: missing },
      });
      toast.success(
        `${missing.length} view(s) queued on the server. They appear here as each one is accepted — you can close this page safely.`,
        { duration: 10000 },
      );
      queryClient.invalidateQueries({ queryKey: ["revision-studio-renders"] });
    } catch (error: any) {
      setFailedMissingViews([...missing]);
      toast.error(`The server did not accept the request: ${error?.message || error}`);
    } finally {
      setIsGeneratingMissing(false);
      setGeneratingViews([]);
    }
  };

  // AUTO-BACKFILL missing views for RecreatePro jobs — "wire it to land in
  // Revision Studio" (Trish 2026-07-23). A RecreatePro design arrives here with
  // the approved driver "side" + its 2D proof, but the other 6 angles are
  // produced asynchronously by ProductionFlow; if that pass didn't finish (an old
  // job, a backgrounded mobile tab that suspended the client-orchestrated run, or
  // a transient render failure) the row shows "6 of 7 Views Missing". The card
  // already tells the customer these are auto-generated — make that real: the
  // moment a RecreatePro render that has a hero but is missing views is opened,
  // fan them out ONCE. Guards: fire once per design id (Set-tracked, survives
  // toggling between renders), never while a run is already in flight, and only
  // for mode_type "recreatepro" so opening any OTHER tool's design just to view
  // it never kicks off render spend. The manual "Generate Missing Views" button
  // stays for re-runs / retrying failed angles.
  const autoBackfilledIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const r = selectedRender;
    if (!r?.id || isGeneratingMissing) return;
    if (String(r.mode_type || "").toLowerCase() !== "recreatepro") return;
    const urls = (r.render_urls || {}) as Record<string, string>;
    const hasHero = !!(urls.side || urls.hero || urls["driver-side"] || urls["driver_side"] || urls.primary || urls.mockup);
    if (!hasHero) return;                              // need the driver hero to anchor every angle
    if (getMissingViews(r).length === 0) return;       // already complete
    if (autoBackfilledIdsRef.current.has(r.id)) return; // already auto-fired for this design
    autoBackfilledIdsRef.current.add(r.id);
    console.log(`[RevisionStudioIQ] Auto-backfilling missing RecreatePro views for ${r.id}`);
    generateMissingViews(r);
    // generateMissingViews closes over refs/state; intentionally omitted from deps
    // to avoid re-fire loops — the id Set guards single execution per design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRender, isGeneratingMissing]);

  // ---------------------------------------------------------------------------
  // Delete render mutation
  // ---------------------------------------------------------------------------
  const deleteRender = useMutation({
    mutationFn: async ({ id, source }: { id: string; source?: string }) => {
      // A DESIGN IS AN IMMUTABLE RUN, AND A RUN IS NOT DELETABLE FROM A TAB.
      //
      // This deleted the card's own row from whichever of three tables it came
      // from. Here a design is a workflow run whose proofs and panels are
      // content-addressed and referenced by receipts, purchases and delivered
      // packs -- deleting it from the browser would break bindings the server
      // is still asserting. The gateway exposes no delete for that reason, so
      // the honest answer is to say so rather than fail with a permission
      // message that implies the right role would work.
      throw new Error(
        "A design cannot be deleted here. Its proofs, panels and receipts are immutable server records — ask support to retire it.",
      );
    },
    onMutate: async ({ id }: { id: string; source?: string }) => {
      // Optimistic: immediately remove the card from EVERY feed it could live in
      // (the design feed plus the two retired legacy feeds) while the
      // delete happens. Snapshot all three so onError can roll back.
      const feedKeys = [
        "revision-studio-renders",
        "revision-studio-graphicspro",
        "revision-studio-panelizer",
      ];
      await Promise.all(
        feedKeys.map((k) => queryClient.cancelQueries({ queryKey: [k] }))
      );
      const previousRenders = feedKeys.flatMap((k) =>
        queryClient.getQueriesData({ queryKey: [k] })
      );
      const removeById = (old: any) => {
        if (!old) return old;
        // useInfiniteQuery stores data as { pages: [...], pageParams: [...] }
        if (old.pages) {
          return {
            ...old,
            pages: old.pages.map((page: any[]) =>
              page.filter((r: any) => r.id !== id)
            ),
          };
        }
        // Fallback for flat arrays
        if (Array.isArray(old)) return old.filter((r: any) => r.id !== id);
        return old;
      };
      feedKeys.forEach((k) =>
        queryClient.setQueriesData({ queryKey: [k] }, removeById)
      );
      return { previousRenders };
    },
    onSuccess: (deletedId) => {
      queryClient.invalidateQueries({ queryKey: ["revision-studio-renders"] });
      queryClient.invalidateQueries({ queryKey: ["revision-studio-graphicspro"] });
      queryClient.invalidateQueries({ queryKey: ["revision-studio-panelizer"] });
      queryClient.invalidateQueries({ queryKey: ["version-chain"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-recent-renders"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-hero-carousel"] });
      queryClient.invalidateQueries({ queryKey: ["gallery-items"] });
      toast.success("Version deleted");

      // If the deleted render was selected, navigate to another version in
      // the chain (or back to grid if it was the last one)
      if (selectedRender?.id === deletedId) {
        const remaining = versionChain?.filter((v: any) => v.id !== deletedId) || [];
        if (remaining.length > 0) {
          setSelectedRender(remaining[remaining.length - 1]);
          setCurrentViewIndex(0);
        } else {
          setSelectedRender(null);
        }
      }
    },
    onError: (err: any, _renderId, context: any) => {
      // Rollback optimistic update on failure
      if (context?.previousRenders) {
        for (const [key, data] of context.previousRenders) {
          queryClient.setQueryData(key, data);
        }
      }
      console.error("[RevisionIQ] Delete failed:", err);
      toast.error(`Delete failed: ${err.message}`);
    },
  });

  // ---------------------------------------------------------------------------
  // Delete a single view from a render (removes key from render_urls)
  // ---------------------------------------------------------------------------
  const deleteSingleView = async (render: any, viewKey: string) => {
    const urls = { ...(render.render_urls as Record<string, string> || {}) };
    delete urls[viewKey];

    try {
      await persistViewRevision({
        render,
        renderUrls: urls,
        trigger: "view_deleted",
        change: { type: "edit", viewKeys: [viewKey] },
      });
    } catch (error: any) {
      toast.error(`Failed to delete view: ${error?.message || error}`);
      return;
    }

    // Update local state
    setSelectedRender((prev: any) =>
      prev?.id === render.id ? { ...prev, render_urls: urls } : prev
    );
    queryClient.invalidateQueries({ queryKey: ["revision-studio-renders"] });
    queryClient.invalidateQueries({ queryKey: ["version-chain"] });

    // Adjust view index if needed
    const remainingViews = VIEW_ORDER.filter((k) => urls[k]);
    if (currentViewIndex >= remainingViews.length) {
      setCurrentViewIndex(Math.max(0, remainingViews.length - 1));
    }

    toast.success(`${VIEW_LABELS[viewKey] || viewKey} view deleted`);
  };

  // ---------------------------------------------------------------------------
  // Regenerate a single view (delete it, then re-render just that one view)
  // ---------------------------------------------------------------------------
  // ONE MASTER OWNS THE WHOLE PROOF SET.
  //
  // Regenerating a single angle in the browser made sense when each view was
  // its own design decision. Under A.T.L.A.S. every view is a projection of one
  // accepted master, so replacing one of them cannot improve the design -- it
  // can only leave that view disagreeing with the master the six print panels
  // were cut from. The gateway refuses the browser's version of this outright:
  // a per-view regenerate against a flat-first request comes back as "a new run
  // is required".
  //
  // So this asks the server to finish or retry the run, which is what a missing
  // or failed angle actually needs, and says plainly that changing what a view
  // shows is a revision.
  const regenerateSingleView = async (render: any, viewKey: string) => {
    if (!render?.id) {
      toast.error("Open a design first.");
      return;
    }
    setRegeneratingView(viewKey);
    try {
      await requestDesignBuild({
        generationId: String(render.id),
        trigger: "view_regenerated",
        change: { type: "generate", viewKeys: [viewKey] },
      });
      toast.success(
        `${VIEW_LABELS[viewKey] || viewKey} re-queued on the server. To change what this view SHOWS, use Revise — one master owns all seven angles.`,
        { duration: 10000 },
      );
      queryClient.invalidateQueries({ queryKey: ["revision-studio-renders"] });
    } catch (error: any) {
      toast.error(`Couldn't re-queue ${VIEW_LABELS[viewKey] || viewKey}: ${error?.message || error}`);
    } finally {
      setRegeneratingView(null);
    }
  };

  // ---------------------------------------------------------------------------
  // Flip passenger side — mirror driver side, auto-fix text for commercial
  // ---------------------------------------------------------------------------
  const [isFlippingPassenger, setIsFlippingPassenger] = useState(false);
  const [isFixingFinish, setIsFixingFinish] = useState(false);

  // ── Fix Finish — re-render a single view with correct finish ──
  const FINISH_DESCRIPTIONS: Record<string, string> = {
    "Gloss": "high-gloss mirror-like reflective finish with deep wet shine and sharp reflections",
    "Matte": "completely flat matte finish with zero shine, zero reflections, soft diffused light",
    "Satin": "satin semi-gloss finish with subtle soft sheen, muted reflections, silk-like surface",
  };

  // FINISH IS PART OF THE DESIGN, SO IT IS A REVISION.
  //
  // This used to send the current view's image to `revise-render` with a
  // finish-only instruction and write the returned image back over that one
  // angle. Under A.T.L.A.S. that repaints a projection: the master keeps the
  // old finish, the other six views keep the old finish, and the panels print
  // the old finish. Routing it through A.T.L.A.S. changes the design once, for
  // every view and every panel at the same time.
  const fixViewFinish = async (render: any, viewKey: string, targetFinish: string) => {
    if (!render?.id) { toast.error("Open a design first."); return; }
    const finishDesc = FINISH_DESCRIPTIONS[targetFinish] || targetFinish;
    setIsFixingFinish(true);
    try {
      const version = parseVersionInfo(render);
      const lineageMaxVersion = Math.max(
        version.version,
        ...((versionChain || []).map((r: any) => parseVersionInfo(r).version)),
      );
      const baseName = (render.design_file_name || render.color_name || "Design")
        .replace(/\s*\(V\d+\)$/, "");
      await submitDesignRevision({
        source: render,
        instruction: `Change the vinyl wrap finish to a ${finishDesc}. Keep the design, colours and artwork exactly as they are; change only the surface finish.`,
        vehicle: {
          year: String(render.vehicle_year || ""),
          make: String(render.vehicle_make || ""),
          model: String(render.vehicle_model || ""),
        },
        designName: `${baseName} (V${lineageMaxVersion + 1})`,
      });
      toast.success(
        `${targetFinish} finish submitted as a revision — it applies to all seven views and every panel, not just this angle.`,
        { duration: 10000 },
      );
      queryClient.invalidateQueries({ queryKey: ["revision-studio-renders"] });
      queryClient.invalidateQueries({ queryKey: ["version-chain"] });
    } catch (error: any) {
      toast.error(`Couldn't submit the finish change: ${error?.message || error}`);
    } finally {
      setIsFixingFinish(false);
    }
  };

  // THE PASSENGER SIDE IS ALREADY THE DRIVER'S TWIN, CUT BY THE SERVER.
  //
  // This mirrored the driver render in the browser and ran an AI text-direction
  // repair over the result, because the passenger view used to be a separate
  // generation that kept coming back as a second driver side. A.T.L.A.S. cuts
  // the passenger surface from the same master as the driver and renders its
  // proof from that surface, so the twin relationship is structural and the
  // lettering reads forward without a repair pass. A browser mirror on top of
  // that would replace a hash-bound proof with an unverified image.
  const flipPassengerSide = async (render: any) => {
    if (!render?.id) { toast.error("Open a design first."); return; }
    setIsFlippingPassenger(true);
    try {
      await requestDesignBuild({
        generationId: String(render.id),
        trigger: "passenger_mirrored",
        change: { type: "generate", viewKeys: ["passenger-side"] },
      });
      toast.success(
        "Passenger side re-queued on the server. It is cut from the same design source as the driver, so it is the driver's twin by construction.",
        { duration: 10000 },
      );
      queryClient.invalidateQueries({ queryKey: ["revision-studio-renders"] });
    } catch (error: any) {
      toast.error(`Couldn't re-queue the passenger side: ${error?.message || error}`);
    } finally {
      setIsFlippingPassenger(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Star rating → 5-star pushes to Gallery carousel + marks is_saved for My Renders
  // ---------------------------------------------------------------------------
  const CAROUSEL_TABLE_MAP: Record<string, string> = {
    colorpro: "inkfusion_carousel",
    designpanelpro: "designpanelpro_carousel",
    fadewraps: "fadewraps_carousel",
    approvemode: "approvemode_carousel",
    wbty: "wbty_carousel",
  };

  // RATING IS A GALLERY FEATURE, AND THE GALLERY IS NOT THIS SYSTEM'S.
  //
  // A five-star rating used to flag the design row as saved and featured, then
  // insert the hero image into one of five per-tool carousel tables and the
  // landing page's hero carousel. Those are RestylePro marketing surfaces; the
  // run tables carry no rating and DesignProAI publishes no carousel, so there
  // is nowhere for this to land. It records the rating for the session, which
  // is what the stars in the UI reflect, and claims nothing further.
  const submitRating = async (render: any, rating: number) => {
    setIsRating(true);
    try {
      setCurrentRating(rating);
      toast.success(`Rated ${rating} star${rating !== 1 ? "s" : ""}`);
    } finally {
      setIsRating(false);
    }
  };

  // Reset rating when selected render changes
  useEffect(() => {
    setCurrentRating(0);
    setRatingHover(0);
  }, [selectedRender?.id]);



  // ---------------------------------------------------------------------------
  // Show Original Render - load prompt, uploads, and metadata
  // ---------------------------------------------------------------------------
  const handleShowOriginal = async (render: any) => {
    setIsLoadingOriginal(true);
    setShowOriginalDialog(true);

    try {
      let prompt = "";
      let visionboardUrls: string[] = [];
      let promptHistory: Array<{ version: number; prompt: string; timestamp: string; type: string }> = [];
      let commercialDetails: Record<string, unknown> = {};
      let mode = "restyle";

      // Parse admin_notes
      try {
        const notes = JSON.parse(render.admin_notes || "{}");
        prompt = notes.original_prompt || "";
        mode = notes.designiq_mode || "restyle";
        if (notes.prompt_history && Array.isArray(notes.prompt_history)) {
          promptHistory = notes.prompt_history;
        }
        if (notes.visionboard_image_urls && Array.isArray(notes.visionboard_image_urls)) {
          visionboardUrls = notes.visionboard_image_urls;
        }
        if (notes.designiq_mode === "commercial") {
          commercialDetails = {
            companyName: notes.company_name,
            phone: notes.phone,
            mascot: notes.mascot,
            industryType: notes.industry_type,
            brandKeywords: notes.brand_keywords,
          };
        }
      } catch {}

      // Fallback for prompt
      if (!prompt) {
        prompt = render.custom_styling_prompt_key || "";
      }

      // No second lookup. The brief and any references a design was authored
      // from live on the run the server owns, and the projection above already
      // carries whatever it recorded. Matching a design row by its hero image
      // URL was how two stores with no shared key found each other; there is
      // one store now, so an absent brief is honestly absent.

      // If still no prompt, use design name as fallback — but only a REAL design
      // name, never the order-number/placeholder label (it would otherwise be
      // re-rendered as literal text on the wrap).
      if (!prompt) {
        prompt = designNameForPrompt(render.design_file_name || render.color_name);
      }

      setOriginalDialogData({
        prompt,
        visionboardUrls,
        designPanelUrl: render.custom_design_url || null,
        swatchUrl: render.custom_swatch_url || null,
        promptHistory,
        commercialDetails,
        mode,
      });
    } catch (err) {
      console.error("[ShowOriginal] Error loading original data:", err);
      setOriginalDialogData({
        prompt: render.custom_styling_prompt_key || render.design_file_name || "",
        visionboardUrls: [],
        designPanelUrl: render.custom_design_url || null,
        swatchUrl: render.custom_swatch_url || null,
        promptHistory: [],
        commercialDetails: {},
        mode: "restyle",
      });
    } finally {
      setIsLoadingOriginal(false);
    }
  };

  // Studio toggle removed - always dark studio

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  const getViews = (render: any): Array<{ key: string; url: string }> => {
    const urls = render.render_urls as Record<string, string> | null;
    if (!urls) return [];
    // MyVehicle renders store image under "myvehicle_edit". The early
    // design-on-vehicle-photo path briefly wrote `myvehicle_design`
    // instead — keep reading both so legacy rows still resolve.
    if (urls.myvehicle_edit) {
      return [{ key: "myvehicle_edit", url: urls.myvehicle_edit }];
    }
    if (urls.myvehicle_design) {
      return [{ key: "myvehicle_edit", url: urls.myvehicle_design }];
    }
    const standard = VIEW_ORDER.filter((k) => urls[k]).map((k) => ({ key: k, url: urls[k] }));
    // WallPro and GraphicsPro renders use non-canonical url keys
    // (hero / detail / closeup) and have NO canonical views — include them so
    // their cards still get a thumbnail. But when canonical views exist (a
    // normal DesignProAI 7-view set), "hero" is just a duplicate of the driver
    // side and shows up as an invalid extra "Hero" tab — suppress it there.
    const NON_CANONICAL = ["hero", "detail", "closeup"];
    const extra = standard.length === 0
      ? NON_CANONICAL.filter((k) => urls[k]).map((k) => ({ key: k, url: urls[k] }))
      : [];
    return [...standard, ...extra];
  };

  const selectedViews = selectedRender ? getViews(selectedRender) : [];
  const missingViews = selectedRender ? getMissingViews(selectedRender) : [];

  // ── Immutable OS version projection ──────────────────────────────────────
  // The design row is the mutable working row. Every immutable ledger
  // commit is its own version-history entry—even when several commits point to
  // the same visualization row. Legacy rows are used only when the lineage has
  // no durable commits at all.
  const orderedVersionChain = useMemo(
    () => [...(versionChain || [])].sort(
      (a: any, b: any) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime(),
    ),
    [versionChain],
  );
  const versionTimeline = useMemo(
    () => buildRevisionVersionTimeline({
      commits: versionCommits || [],
      legacyRows: orderedVersionChain,
    }),
    [orderedVersionChain, versionCommits],
  );
  const selectedVersionPresentation = useMemo(() => {
    if (versionTimeline.length === 0) return null;
    if (selectedVersionTimelineKey) {
      const explicitlySelected = versionTimeline.find(
        (entry) => entry.key === selectedVersionTimelineKey,
      );
      if (explicitlySelected) return explicitlySelected;
    }
    const entriesForWorkingRow = versionTimeline.filter(
      (entry) => entry.row?.id === selectedRender?.id,
    );
    return entriesForWorkingRow[entriesForWorkingRow.length - 1] ||
      versionTimeline[versionTimeline.length - 1];
  }, [selectedRender?.id, selectedVersionTimelineKey, versionTimeline]);
  const previousVersionPresentation = useMemo(
    () => selectedVersionPresentation?.previousKey
      ? versionTimeline.find((entry) => entry.key === selectedVersionPresentation.previousKey) || null
      : null,
    [selectedVersionPresentation, versionTimeline],
  );
  const activeCommit = selectedVersionPresentation?.commit || null;
  const isViewingImmutableVersion = Boolean(
    selectedVersionTimelineKey && selectedVersionPresentation?.immutable,
  );
  const immutableHistoryHero = useMemo(() => {
    if (!isViewingImmutableVersion || !selectedVersionPresentation) return null;
    // If the commit removed its only changed surface, do not silently show an
    // unchanged Driver image. A deletion has no "after" pixels and the empty
    // state below says that explicitly. For a no-op/import commit, a canonical
    // frozen overview remains a truthful snapshot preview.
    const key = selectedVersionPresentation.primaryKey ||
      (selectedVersionPresentation.changedKeys.length === 0
        ? REVISION_SURFACE_ORDER.find((candidate) => !!selectedVersionPresentation.currentUrls[candidate]) || null
        : null);
    const url = key
      ? selectedVersionPresentation.currentUrls[key] || null
      : selectedVersionPresentation.thumbnailUrl;
    return key && url ? { key, url } : null;
  }, [isViewingImmutableVersion, selectedVersionPresentation]);
  const displayedHeroView = isViewingImmutableVersion
    ? immutableHistoryHero
    : selectedViews[currentViewIndex] || null;

  useEffect(() => {
    if (!isViewingImmutableVersion) return;
    // A tool can already be armed before the user opens history. Tear down all
    // mutation surfaces so no invisible canvas, modal, or keyboard-focused
    // control can edit the working row while the hero shows frozen pixels.
    setArmedLayerId(null);
    setWandActive(false);
    setLayerLiftOpen(false);
    setPreciseEditOpen(false);
    setPrecisionModalOpen(false);
    setSideBoxesOpen(false);
  }, [isViewingImmutableVersion]);

  // ── Per-view revision scope ────────────────────────────────────────────────
  // Which angles the next "Revise & Clone" will touch. The displayed view is the
  // anchor (always edited); the smart default ALSO adds any angle that shows a
  // panel named in the notes (e.g. "hood" → hood_detail + front) but nothing
  // else — so the rear is never changed unless the user explicitly picks it.
  const availableViewKeys = selectedViews.map((v) => v.key);
  const currentScopeAnchorKey = selectedViews[currentViewIndex]?.key;
  const autoScopeViews = (() => {
    const set = new Set<string>();
    if (currentScopeAnchorKey) set.add(currentScopeAnchorKey);
    for (const v of panelViewsForRevision(revisionNotes, revisionPanelTargets)) {
      if (availableViewKeys.includes(v)) set.add(v);
    }
    return Array.from(set);
  })();
  // Effective scope: the user's explicit pick wins; otherwise the smart default.
  const effectiveScopeViews = (scopeViewKeys && scopeViewKeys.length > 0)
    ? scopeViewKeys.filter((k) => availableViewKeys.includes(k))
    : autoScopeViews;
  // Toggle one view in/out of the scope. Always keep at least the anchor view so
  // the Revise button never resolves to "edit nothing".
  const toggleScopeView = (key: string) => {
    // The anchor (current view) is always edited by the main revision path, so
    // it can't be toggled off — clicking it is a no-op.
    if (key === currentScopeAnchorKey) return;
    const base = effectiveScopeViews;
    const next = base.includes(key) ? base.filter((k) => k !== key) : [...base, key];
    setScopeViewKeys(next.length > 0 ? next : (currentScopeAnchorKey ? [currentScopeAnchorKey] : []));
  };

  // Batch prompt filtering
  const filteredPresets = useMemo(() => {
    let pool = getPresetsByCategory(batchPromptCategory);
    if (batchSubcategory !== "all") {
      pool = pool.filter((p) => p.subcategory === batchSubcategory);
    }
    if (batchSearch) {
      const q = batchSearch.toLowerCase();
      pool = pool.filter(
        (p) =>
          p.prompt.toLowerCase().includes(q) ||
          p.tags.some((t) => t.includes(q))
      );
    }
    return pool;
  }, [batchPromptCategory, batchSubcategory, batchSearch]);

  const subcategories = useMemo(
    () => getSubcategories(batchPromptCategory),
    [batchPromptCategory]
  );

  // Stats
  const totalVersions = versionTimeline.length;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-black text-white pb-28 overflow-x-hidden">
      {/* THE JOB CARRIES ITSELF BETWEEN SCREENS. (Trish 2026-08-29.)
          DESIGN → REVISE → PANELS → QC → WRAPBOX, for the design that is open.
          It renders nothing when no design is selected, because the library
          view is not a job and a header for one would be inventing an identity
          rather than carrying it. */}
      <JobWorkflowHeader generationId={productionLayersId} current="revise" />
      {/* In-app confirm dialog host — replaces window.confirm(), which is
          blocked inside sandboxed iframes / mobile webviews and silently
          broke every Delete/Regenerate action. */}
      <ConfirmDialogHost />
      {/* ApprovePro job context: customer uploads + every prompt/version, loadable
          into the editor. Shown only when opened from a proof (?proof_id=...). */}
      {APPROVEPRO_UI_LIVE && bridgeProofId && (
        <ApproveProContextPanel
          proofId={bridgeProofId}
          onLoadVersion={(v) => {
            const urls = (v?.render_urls || {}) as Record<string, unknown>;
            const cleanUrls: Record<string, string> = {};
            for (const [k, val] of Object.entries(urls)) {
              if (typeof val === "string" && val) cleanUrls[k] = val;
            }
            if (Object.keys(cleanUrls).length === 0) return;
            setSelectedRender({
              id: `proof-${bridgeProofId}-v${v.version_number}`,
              render_urls: cleanUrls,
              vehicle_year: Number(searchParams.get("v_year")) || 0,
              vehicle_make: searchParams.get("v_make") || "",
              vehicle_model: searchParams.get("v_model") || "",
              vehicle_type: "",
              mode_type: "designpanelpro",
              color_name: searchParams.get("v_name") || v.prompt_text || "Customer Design",
              finish_type: "gloss",
              created_at: v.created_at || new Date().toISOString(),
            } as any);
            setCurrentViewIndex(0);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />
      )}
      <Helmet>
        <title>RevisionStudioIQ - AI Wrap Design Revision Tool | DesignProAI</title>
        <meta name="description" content="Clone and revise wrap designs without starting over. Targeted changes to colors, elements, and styles. Design it. Panel it. Print it. The world's first prompt-to-production wrap platform." />
        <meta property="og:title" content="RevisionStudioIQ - AI Wrap Design Revision Tool | DesignProAI" />
        <meta property="og:description" content="Clone and revise custom wrap designs without starting over. Make targeted changes while keeping what works." />
      </Helmet>
      {/* ================================================================== */}
      {/* STUDIO MODE - Full Screen Presentation                             */}
      {/* ================================================================== */}
      {isStudioMode && selectedRender && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
          {/* Studio Header */}
          <div className="flex items-center justify-between px-6 py-3 bg-zinc-950 border-b border-zinc-800">
            <div className="flex items-center gap-4">
              <Button size="sm" variant="ghost" onClick={() => setIsStudioMode(false)}>
                <ChevronLeft className="w-4 h-4 mr-1" /> Exit Studio
              </Button>
              <Badge variant="outline" className="border-blue-magenta text-blue-magenta">
                <Video className="w-3 h-3 mr-1" /> STUDIO MODE
              </Badge>
            </div>

            <div className="text-center">
              <p className="font-bold text-lg">
                {formatVehicleInfo(selectedRender)}
              </p>
              <p className="text-sm text-zinc-400">
                {selectedRender.color_name} &bull; {selectedRender.finish_type}
                {selectedRender.design_file_name ? ` \u2022 ${selectedRender.design_file_name}` : ""}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Badge className="bg-gradient-blue-magenta">{getVersionLabel(selectedRender)}</Badge>
              <Badge variant="outline" className="border-zinc-600">{MODE_LABELS[selectedRender.mode_type] || selectedRender.mode_type}</Badge>
            </div>
          </div>

          {/* Main View */}
          <div className="flex-1 flex items-center justify-center relative bg-black">
            {selectedViews[currentViewIndex] ? (
              <img
                src={selectedViews[currentViewIndex].url}
                alt={VIEW_LABELS[selectedViews[currentViewIndex].key]}
                className="max-w-full max-h-full object-contain cursor-pointer"
                onClick={() => setExpandedImage({ url: selectedViews[currentViewIndex].url, title: `${formatVehicleInfo(selectedRender)} - ${VIEW_LABELS[selectedViews[currentViewIndex].key]}` })}
                onError={(e) => {
                  const target = e.currentTarget;
                  target.style.display = "none";
                  const fallback = target.parentElement?.querySelector("[data-img-fallback]") as HTMLElement;
                  if (fallback) fallback.style.display = "flex";
                }}
              />
            ) : (
              <div className="text-zinc-600">No views</div>
            )}
            <div data-img-fallback className="hidden items-center justify-center flex-col gap-2 text-zinc-500 absolute inset-0">
              <ImageOff className="w-12 h-12" />
              <span className="text-sm">Image unavailable</span>
            </div>

            <div className="absolute top-6 left-6 bg-black/80 px-4 py-2 rounded-lg">
              <p className="text-lg font-bold text-gradient-blue-magenta">
                {selectedViews[currentViewIndex] ? VIEW_LABELS[selectedViews[currentViewIndex].key] : ""}
              </p>
            </div>

            <Button
              size="lg"
              variant="ghost"
              className="absolute left-4 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/80 h-16 w-12"
              onClick={() => setCurrentViewIndex((i) => Math.max(0, i - 1))}
              disabled={currentViewIndex === 0}
            >
              <ChevronLeft className="w-8 h-8" />
            </Button>
            <Button
              size="lg"
              variant="ghost"
              className="absolute right-4 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/80 h-16 w-12"
              onClick={() => setCurrentViewIndex((i) => Math.min(selectedViews.length - 1, i + 1))}
              disabled={currentViewIndex === selectedViews.length - 1}
            >
              <ChevronRight className="w-8 h-8" />
            </Button>
          </div>

          {/* Studio Info Bar */}
          <div className="bg-zinc-950 border-t border-zinc-800">
            {selectedRender.custom_design_url && (
              <div className="flex items-center gap-4 px-6 py-2 border-b border-zinc-800">
                <span className="text-xs text-zinc-500 uppercase font-bold">VisionBoard Upload:</span>
                <img
                  src={selectedRender.custom_design_url}
                  alt="Original"
                  className="h-12 rounded border border-zinc-700 cursor-pointer hover:border-cyan-500 transition-colors"
                  onClick={() => setExpandedImage({ url: selectedRender.custom_design_url, title: "VisionBoard Upload" })}
                />
                <span className="text-xs text-zinc-400">Tap to enlarge &middot; Original customer reference</span>
              </div>
            )}

            <div className="flex gap-3 px-6 py-3 overflow-x-auto">
              {selectedViews.map((v, i) => (
                <button
                  key={v.key}
                  onClick={() => setCurrentViewIndex(i)}
                  className={`flex-shrink-0 relative rounded-lg overflow-hidden border-2 transition-all ${
                    i === currentViewIndex ? "border-blue-magenta scale-105" : "border-zinc-700 hover:border-zinc-500"
                  }`}
                >
                  <img
                    src={v.url}
                    alt={VIEW_LABELS[v.key]}
                    className="w-32 h-20 object-cover"
                    onError={(e) => { e.currentTarget.style.display = "none"; }}
                    loading="lazy"
                  />
                  <span className="absolute bottom-0 left-0 right-0 bg-black/80 text-[10px] text-center py-0.5">
                    {VIEW_LABELS[v.key]}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* MAIN PAGE LAYOUT                                                   */}
      {/* ================================================================== */}
      <div className="p-3 sm:p-6 max-w-[1800px] mx-auto overflow-x-hidden">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <img
              src="/sprocket/sprocket-dj.png"
              alt="ACE - RevisionStudioIQ"
              className="w-16 h-16 sm:w-20 sm:h-20 object-contain drop-shadow-[0_0_12px_rgba(168,85,247,0.3)]"
              style={{ animation: 'float 3s ease-in-out infinite' }}
            />
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <img src="/characters/sproket/planet-purple.png" alt="" className="w-10 h-10 md:w-12 md:h-12 object-contain" />
                <h1 className="text-3xl font-semibold tracking-tight flex items-baseline gap-2 flex-wrap">
                  <span className="flex items-baseline">
                    <span className="text-white">Revision</span>
                    <span className="text-gradient-blue-subtle">StudioIQ</span>
                    <sup className="text-zinc-500 text-sm ml-0.5">™</sup>
                  </span>
                </h1>
              </div>
              <p className="text-zinc-400 mt-1">
                Revise your designs, track versions, and manage design variations
              </p>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 sm:gap-4 mb-6">
          <div className="relative flex-1 min-w-0 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <Input
              placeholder="Search by order #, vehicle make/model, tool, color, or design..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-zinc-900 border-zinc-700"
            />
          </div>

          <Select value={pipelineFilter} onValueChange={(v) => setPipelineFilter(v as typeof pipelineFilter)}>
            <SelectTrigger className="w-36 sm:w-48 bg-zinc-900 border-zinc-700">
              <SelectValue placeholder="Pipeline" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Designs</SelectItem>
              {/* Neutral customer wording. The values stay the internal
                  pipeline keys; the engine's name stays in PanelPro. */}
              <SelectItem value="atlas">Current designs</SelectItem>
              <SelectItem value="standard">Classic designs</SelectItem>
            </SelectContent>
          </Select>

          {/* Team Renders toggle */}
          {!isAdmin && (
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "gap-1.5 border-zinc-700 shrink-0",
                showTeamRenders ? "bg-cyan-500/20 text-cyan-400 border-cyan-500/30" : "text-zinc-400",
              )}
              onClick={() => setShowTeamRenders(!showTeamRenders)}
            >
              <Users className="w-4 h-4" />
              <span className="hidden sm:inline">{showTeamRenders ? "Team" : "Mine"}</span>
            </Button>
          )}

          {/* Gallery / Studio toggle */}
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "gap-1.5 border-zinc-700 shrink-0",
              layoutMode === "gallery" ? "bg-violet-500/20 text-violet-400 border-violet-500/30" : "text-zinc-400",
            )}
            onClick={() => {
              if (layoutMode === "studio") {
                setSelectedRender(null);
                setLayoutMode("gallery");
              } else {
                setLayoutMode("studio");
              }
            }}
          >
            {layoutMode === "gallery" ? (
              <><Eye className="h-3.5 w-3.5" /> StudioMode</>
            ) : (
              <><Layers className="h-3.5 w-3.5" /> GalleryMode</>
            )}
          </Button>
        </div>

        {/* ================================================================ */}
        {/* GALLERY VIEW — all renders in rows with 7-view grids            */}
        {/* ================================================================ */}
        {layoutMode === "gallery" && !selectedRender && (() => {
          const galleryRenders = (renders || []).filter((r: any) => {
            // The same pipeline filter the header control drives, so
            // GalleryMode and the library never disagree about what is on
            // screen. A row with no reported pipeline is shown either way.
            if (pipelineFilter !== "all" && r.pipeline && r.pipeline !== pipelineFilter) return false;
            if (searchQuery) {
              const q = searchQuery.toLowerCase();
              const label = `${r.vehicle_year || ""} ${r.vehicle_make || ""} ${r.vehicle_model || ""} ${r.color_name || ""} ${r.design_file_name || ""} ${r.admin_notes || ""} ${r.mode_type || ""} ${r.id || ""}`.toLowerCase();
              if (!label.includes(q)) return false;
            }
            return true;
          });
          return (
          <div className="space-y-4 mb-8">
            {galleryRenders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20">
                <ImageIcon className="h-12 w-12 text-zinc-700 mb-4" />
                <p className="text-lg font-semibold text-foreground">No renders found</p>
              </div>
            ) : (
              galleryRenders.map((render: any) => {
                const vehicleInfo = formatVehicleInfo(render);
                const designLabel = render.design_file_name || render.color_name || "Design";
                const viewOrder = ["side", "passenger-side", "hood_detail", "front", "rear", "close-up", "roof"];
                const viewLabels: Record<string, string> = { side: "Driver", "passenger-side": "Passenger", hood_detail: "Hood", front: "Front 3/4", rear: "Rear 3/4", "close-up": "Close-Up", roof: "Roof" };
                const urls = (render.render_urls || {}) as Record<string, string>;
                const viewCount = viewOrder.filter((v) => urls[v]).length;

                return (
                  <div
                    key={render.id}
                    className={cn(
                      "rounded-xl border bg-zinc-900/50 overflow-hidden transition-all hover:border-violet-500/30",
                      render.is_featured_hero ? "border-amber-500/30" : "border-zinc-800",
                    )}
                  >
                    {/* Header */}
                    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-zinc-800/50">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-foreground text-sm truncate capitalize">{vehicleInfo}</p>
                        <p className="text-[10px] text-zinc-500 truncate">{designLabel} | {render.finish_type} | {render.mode_type}</p>
                      </div>
                      {render.is_featured_hero && (
                        <Star className="h-4 w-4 text-amber-400 fill-amber-400 shrink-0" />
                      )}
                      <span className={cn("text-[10px] font-bold", viewCount === 7 ? "text-emerald-400" : "text-red-400")}>
                        {viewCount}/7
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[10px] gap-1 border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
                        onClick={() => setStudioDisplayRender(render)}
                      >
                        <Eye className="h-3 w-3" /> Studio Display
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[10px] gap-1 border-violet-500/30 text-violet-400 hover:bg-violet-500/10"
                        onClick={() => {
                          setSelectedRender(render);
                          setCurrentViewIndex(0);
                          setLayoutMode("studio");
                        }}
                      >
                        <Edit3 className="h-3 w-3" /> Revise
                      </Button>
                    </div>

                    {/* 7-View Grid */}
                    <div className="grid grid-cols-7 gap-1 p-2 bg-black/20">
                      {viewOrder.map((viewType) => {
                        const url = urls[viewType];
                        return (
                          <div
                            key={viewType}
                            className={cn(
                              "relative aspect-video rounded-lg overflow-hidden",
                              url ? "bg-zinc-800 cursor-pointer hover:ring-2 hover:ring-violet-500/50" : "bg-zinc-900 border border-dashed border-zinc-700",
                            )}
                            onClick={() => {
                              if (url) {
                                const availableViews = viewOrder.filter((v) => urls[v]);
                                setGalleryLightboxRender(render);
                                setGalleryLightboxIdx(availableViews.indexOf(viewType));
                              }
                            }}
                          >
                            {url ? (
                              <img src={url} alt={viewLabels[viewType]} className="w-full h-full object-cover" loading="lazy" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <ImageOff className="h-3 w-3 text-zinc-700" />
                              </div>
                            )}
                            <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5">
                              <span className={cn("text-[7px] font-medium", url ? "text-white/80" : "text-red-400/60")}>
                                {viewLabels[viewType]}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>
          );
        })()}

        {/* ================================================================ */}
        {/* RENDER GRID (hidden when a render is selected OR gallery mode)   */}
        {/* ================================================================ */}
        {/* A deep link this account cannot open is answered, not left spinning.
            The two reasons are indistinguishable from the browser and the
            server deliberately keeps them that way, so the message names both
            rather than guessing which one applies. */}
        {!selectedRender && deepLinkId && deepLinkMissing && (
          <div className="w-full mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
            <p className="text-sm font-semibold text-amber-300 font-poppins">
              That design could not be opened
            </p>
            <p className="text-xs text-amber-200/80 mt-1">
              Design <span className="font-mono">{formatDid(deepLinkId)}</span> either does not
              exist or is not one this account can open. Your own designs are below.
            </p>
          </div>
        )}

        {!selectedRender && deepLinkId && !deepLinkMissing && renders === undefined && (
          <div className="w-full mb-4 text-xs text-zinc-500 font-poppins">
            Opening design <span className="font-mono">{formatDid(deepLinkId)}</span>…
          </div>
        )}

        {/* THE DESIGN LIBRARY — the last four months of real DesignPro work.
            It is above the legacy card grid rather than replacing it, because
            the two answer different questions: the library lists every
            generation the server has a record of, and the grid below groups the
            subset that already carries imagery by vehicle. The library is the
            one that can show a design still in Calls 1-7, one that failed
            there, or one whose proofs are withheld -- which between them are
            most of the work, and all of it was unreachable before. */}
        {!selectedRender && layoutMode === "studio" && (
          <div className="mb-6 w-full">
            {/* THE one browse surface. The search box above drives it, so there
                is a single field over a single list. */}
            <DesignLibrary
              onOpen={openDesignById}
              query={searchQuery}
              pipeline={pipelineFilter}
              emptySlot={<SproketTipsSlideshow />}
            />
            {openingId && (
              <p className="mt-2 text-[11px] text-zinc-500">Opening {formatDid(openingId)}…</p>
            )}
          </div>
        )}

        {/* ⛔ THE DUPLICATE VEHICLE-GROUPED GRID IS GONE. ONE LIBRARY.

            This surface rendered two grids over the same designs: the Design
            Library above, and a vehicle-grouped card feed here. Two answers to
            "what designs exist" is worse than either -- and this was the weaker
            answer, because it dropped every design that had no image yet and
            grouped the rest by vehicle, which hid exactly the failures a
            designer most needs to find.

            Nothing it did uniquely was lost. Its search box, its tool filter,
            its Team/Mine toggle and GalleryMode are the page chrome above and
            drive the library now; its per-design actions live in the design
            workspace, which is where they always acted. The feed query itself
            stays -- `renders` is what the workspace, the deep link and the
            version chain resolve against -- it simply no longer draws a second
            grid of its own. */}

        {/* ================================================================ */}
        {/* DETAIL VIEW - takes over when a render is selected               */}
        {/* Large center image + filmstrip below + revision panel right      */}
        {/* ================================================================ */}
        {selectedRender && (
          <div className="w-full">
            {/* Back button + vehicle title bar */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-4">
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-zinc-400 hover:text-white"
                  onClick={() => setSelectedRender(null)}
                >
                  <ChevronLeft className="w-4 h-4 mr-1" /> Back to Gallery
                </Button>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-bold text-xl">
                      {formatVehicleInfo(selectedRender)}
                    </p>
                    {orderNumberFor(selectedRender) && (
                      <Badge variant="outline" className="border-cyan-500/50 text-cyan-400 text-xs font-semibold">
                        Order #{orderNumberFor(selectedRender)}
                      </Badge>
                    )}
                    {/* Design ID — ALWAYS visible so every job is identifiable even
                        when it has no order number. Click to copy the full id to
                        paste into the PanelPro Studio Board search. */}
                    {(genIdOf(selectedRender) || selectedRender?.id) && (
                      <Badge
                        variant="outline"
                        className="border-fuchsia-500/50 text-fuchsia-400 text-xs font-mono font-semibold cursor-pointer hover:bg-fuchsia-500/10"
                        title="Design ID — click to copy the full ID (paste into the Studio Board search)"
                        onClick={() => {
                          const fullId = String(genIdOf(selectedRender) || selectedRender?.id || "");
                          if (fullId) {
                            navigator.clipboard?.writeText(fullId).catch(() => {});
                            toast.success("Design ID copied", { description: fullId });
                          }
                        }}
                      >
                        {formatDid(genIdOf(selectedRender) || selectedRender?.id) || "DID-————"}
                      </Badge>
                    )}
                    {/* THE A.T.L.A.S. GENERATION ID ITSELF, NOT ONLY ITS DID.
                        (Trish 2026-08-28: "I need the actual ATLAS Generation
                        ID # viewable.") The DID is a formatted eight-character
                        prefix — good for recognising a job at a glance, useless
                        for pasting into PanelPro, a query or a support thread.
                        PanelPro Studio prints the full id at the top of its
                        board; RevisionStudio showed only the short form, so the
                        two studios named the same design differently. */}
                    {(genIdOf(selectedRender) || selectedRender?.id) && (
                      <Badge
                        variant="outline"
                        className="border-zinc-600 text-zinc-300 text-[11px] font-mono cursor-pointer hover:bg-zinc-700/40"
                        title="A.T.L.A.S. Generation ID — click to copy"
                        onClick={() => {
                          const fullId = String(genIdOf(selectedRender) || selectedRender?.id || "");
                          if (fullId) {
                            navigator.clipboard?.writeText(fullId).catch(() => {});
                            toast.success("Generation ID copied", { description: fullId });
                          }
                        }}
                      >
                        GEN {String(genIdOf(selectedRender) || selectedRender?.id || "")}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-zinc-400">
                    {selectedRender.color_hex && (
                      <div
                        className="w-4 h-4 rounded-sm border border-zinc-600 shrink-0"
                        style={{ backgroundColor: selectedRender.color_hex }}
                      />
                    )}
                    <span>{formatDesignName(selectedRender)} &bull; {selectedRender.finish_type}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge className={`${parseVersionInfo(selectedRender).version > 1 ? "bg-purple-600" : "bg-zinc-700"}`}>
                  {getVersionLabel(selectedRender)}
                </Badge>
                <Badge variant="outline" className="border-zinc-600">{MODE_LABELS[selectedRender.mode_type] || selectedRender.mode_type}</Badge>
              </div>
            </div>

            {/* ============================================================ */}
            {/* MISSING RENDERS ALERT                                       */}
            {/* ============================================================ */}
            {!isViewingImmutableVersion && missingViews.length > 0 && !isMyVehicleRender(selectedRender) && (
              <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-950/20 overflow-hidden">
                <div className="flex items-start gap-4 p-4">
                  <div className="flex-shrink-0 mt-0.5">
                    <div className="w-10 h-10 rounded-full bg-amber-500/15 flex items-center justify-center">
                      <AlertTriangle className="w-5 h-5 text-amber-400" />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-bold text-amber-300 text-sm">
                        {missingViews.length} of {VIEW_ORDER.length} Views Missing
                      </p>
                      <Badge className="bg-amber-500/15 text-amber-400 border-0 text-[9px] px-1.5 py-0">
                        Incomplete
                      </Badge>
                    </div>
                    <p className="text-xs text-zinc-400 mb-3">
                      This design needs all {VIEW_ORDER.length} angles to be sell-ready. Missing views will be auto-generated
                      using the same vehicle, color, and design settings.
                    </p>

                    {/* Missing view chips */}
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {VIEW_ORDER.map((view) => {
                        const isMissing = missingViews.includes(view);
                        const isGenerating = generatingViews.includes(view);
                        const isCompleted = completedMissingViews.includes(view);
                        const isFailed = failedMissingViews.includes(view);

                        return (
                          <span
                            key={view}
                            className={cn(
                              "inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-full border transition-all",
                              isGenerating
                                ? "border-blue-magenta bg-blue-magenta-subtle text-blue-magenta"
                                : isCompleted
                                  ? "border-green-500/50 bg-green-500/10 text-green-400"
                                  : isFailed
                                    ? "border-red-500/50 bg-red-500/10 text-red-400"
                                    : isMissing
                                      ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                                      : "border-zinc-700 bg-zinc-800 text-zinc-400"
                            )}
                          >
                            {isGenerating ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : isCompleted ? (
                              <CheckCircle2 className="w-3 h-3" />
                            ) : isFailed ? (
                              <X className="w-3 h-3" />
                            ) : isMissing ? (
                              <ImageIcon className="w-3 h-3 opacity-50" />
                            ) : (
                              <CheckCircle2 className="w-3 h-3" />
                            )}
                            {VIEW_LABELS[view]}
                          </span>
                        );
                      })}
                    </div>

                    {/* Progress bar during generation */}
                    {isGeneratingMissing && (
                      <div className="mb-3">
                        <div className="flex items-center justify-between text-[10px] text-zinc-500 mb-1">
                          <span>Generating views...</span>
                          <span>{completedMissingViews.length + failedMissingViews.length} / {missingViews.length}</span>
                        </div>
                        <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-blue-magenta-bar rounded-full transition-all duration-500"
                            style={{
                              width: `${((completedMissingViews.length + failedMissingViews.length) / missingViews.length) * 100}%`,
                            }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Generate button */}
                    <Button
                      size="sm"
                      className="bg-gradient-blue-magenta hover:brightness-110 text-white h-9"
                      onClick={() => generateMissingViews(selectedRender)}
                      disabled={isGeneratingMissing}
                    >
                      {isGeneratingMissing ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          {/* Show a view that is ACTUALLY rendering. passenger-side
                              is a deterministic mirror generated LAST, so it sits at
                              the front of generatingViews the whole run and made the
                              label read "Generating Passenger Side…" (frozen-looking)
                              while the AI angles were really the ones working. Prefer
                              the first non-passenger view so progress is visible. */}
                          Generating {VIEW_LABELS[generatingViews.find((v) => v !== "passenger-side") || generatingViews[0]] || ""}...
                        </>
                      ) : (
                        <>
                          <Zap className="w-4 h-4 mr-2" />
                          Generate {missingViews.length} Missing View{missingViews.length > 1 ? "s" : ""}
                        </>
                      )}
                    </Button>

                    {/* Flip Passenger — always visible if driver side exists */}
                    {selectedRender?.render_urls?.side && (
                      <Button
                        size="sm"
                        className="bg-amber-600 hover:bg-amber-700 text-white h-9 gap-1.5"
                        disabled={isFlippingPassenger || isGeneratingMissing}
                        onClick={() => flipPassengerSide(selectedRender)}
                      >
                        {isFlippingPassenger ? (
                          <><Loader2 className="w-4 h-4 animate-spin" /> Flipping...</>
                        ) : (
                          <><FlipHorizontal2 className="w-4 h-4" /> Flip Passenger</>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Two-column: large image left/center + edit tools panel right */}
            <div className="flex flex-col lg:flex-row gap-6">
              {/* LEFT/CENTER: Large hero image + filmstrips below */}
              <div className="flex-1 min-w-0 space-y-4">
                {/* Large Hero Image */}
                <div className="relative rounded-xl overflow-hidden border border-zinc-800 bg-zinc-900">
                  {displayedHeroView ? (() => {
                    // Use the locally-cleaned background if the user has wand-extracted
                    // elements off this view — otherwise use the original render URL.
                    // This is what makes "Separate Elements" actually remove the element
                    // from the displayed image.
                    const viewKey = displayedHeroView.key;
                    const displayUrl = isViewingImmutableVersion
                      ? displayedHeroView.url
                      : cleanBackgroundsByView[viewKey] || displayedHeroView.url;
                    return (
                      <img
                        src={displayUrl}
                        alt={VIEW_LABELS[displayedHeroView.key]}
                        className="w-full aspect-[16/10] object-contain bg-black cursor-pointer"
                        onClick={() => setExpandedImage({ url: displayUrl, title: `${formatVehicleInfo(selectedRender)} - ${VIEW_LABELS[displayedHeroView.key]}` })}
                        onError={(e) => { (e.target as HTMLImageElement).style.opacity = "0"; }}
                      />
                    );
                  })() : (
                    <div className="w-full aspect-[16/10] flex items-center justify-center text-zinc-600 bg-black">
                      <div className="flex flex-col items-center gap-2">
                        <ImageIcon className="w-10 h-10 opacity-30" />
                        <span className="text-sm opacity-60">
                          {isViewingImmutableVersion && selectedVersionPresentation?.changedKeys.length
                            ? "Changed surface was removed in this immutable version"
                            : isViewingImmutableVersion
                              ? "This immutable version has no canonical preview"
                              : "No views available"}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* View label overlay */}
                  <div className="absolute top-4 left-4 px-3 py-1.5 rounded-lg backdrop-blur-sm bg-black/70 text-blue-400">
                    <p className="text-sm font-bold">
                      {displayedHeroView ? VIEW_LABELS[displayedHeroView.key] : ""}
                    </p>
                    {isViewingImmutableVersion && selectedVersionPresentation && (
                      <p className="text-[9px] text-cyan-200">
                        Read-only OS snapshot · V{selectedVersionPresentation.versionNumber}
                      </p>
                    )}
                  </div>

                  {isViewingImmutableVersion && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="absolute top-4 right-4 z-40 h-8 backdrop-blur-sm bg-cyan-950/90 border border-cyan-500/50 text-cyan-100 hover:bg-cyan-900"
                      onClick={() => setSelectedVersionTimelineKey(null)}
                    >
                      Return to editable version
                    </Button>
                  )}

                  {/* Per-view actions: Regenerate + Delete */}
                  {!isViewingImmutableVersion && selectedViews[currentViewIndex] && (
                    <div className="absolute top-4 right-4 left-4 z-30 flex flex-wrap justify-end gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 px-2 backdrop-blur-sm bg-black/60 hover:bg-cyan-900/80 text-zinc-300 hover:text-cyan-300"
                        title="Precise Edit — click a panel or box-select, describe the change"
                        disabled={!!regeneratingView || isGeneratingMissing || !selectedRender}
                        onClick={() => { setPrecisionInitialMode("box"); setPrecisionModalOpen(true); }}
                      >
                        <Crosshair className="w-4 h-4" />
                        <span className="hidden sm:inline ml-1 text-xs">Precise</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 px-2 backdrop-blur-sm bg-teal-500/20 border border-teal-400/50 text-teal-200 hover:bg-teal-500/35 hover:text-teal-100"
                        title="MarkupIQ — draw the cut line / X / circle directly on the render"
                        disabled={!!regeneratingView || isGeneratingMissing || !selectedRender}
                        onClick={() => { setPrecisionInitialMode("markup"); setPrecisionModalOpen(true); }}
                      >
                        <Spline className="w-4 h-4" />
                        <span className="hidden sm:inline ml-1 text-xs font-semibold">MarkupIQ</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 px-2 backdrop-blur-sm bg-black/60 hover:bg-black/80 text-zinc-300 hover:text-white"
                        title={`Regenerate ${VIEW_LABELS[selectedViews[currentViewIndex].key]}`}
                        disabled={!!regeneratingView || isGeneratingMissing}
                        onClick={async () => {
                          if (selectedRender && await confirmDialog({ title: `Regenerate the ${VIEW_LABELS[selectedViews[currentViewIndex].key]} view?`, description: "This will replace the current image.", confirmText: "Regenerate" })) {
                            regenerateSingleView(selectedRender, selectedViews[currentViewIndex].key);
                          }
                        }}
                      >
                        {regeneratingView === selectedViews[currentViewIndex].key
                          ? <Loader2 className="w-4 h-4 animate-spin" />
                          : <RefreshCw className="w-4 h-4" />}
                      </Button>
                      {selectedViews[currentViewIndex].key === "passenger-side" && selectedRender?.render_urls?.side && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 px-2 backdrop-blur-sm bg-black/60 hover:bg-amber-900/80 text-zinc-300 hover:text-amber-300"
                          title="Flip from driver side (auto-fixes text on commercial)"
                          disabled={isFlippingPassenger || !!regeneratingView || isGeneratingMissing}
                          onClick={() => {
                            if (selectedRender) flipPassengerSide(selectedRender);
                          }}
                        >
                          {isFlippingPassenger
                            ? <Loader2 className="w-4 h-4 animate-spin" />
                            : <FlipHorizontal2 className="w-4 h-4" />}
                        </Button>
                      )}
                      {/* Fix Finish dropdown */}
                      {!isFixingFinish ? (
                        <Select
                          value=""
                          onValueChange={(finish) => {
                            if (selectedRender && selectedViews[currentViewIndex]) {
                              fixViewFinish(selectedRender, selectedViews[currentViewIndex].key, finish);
                            }
                          }}
                        >
                          <SelectTrigger className="h-8 w-auto border-0 backdrop-blur-sm bg-black/60 hover:bg-black/80 text-zinc-300 px-2 gap-1 text-xs focus:ring-0">
                            <Palette className="h-3.5 w-3.5" />
                            <span className="hidden sm:inline">Fix Finish</span>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Gloss">Gloss — mirror-like shine</SelectItem>
                            <SelectItem value="Matte">Matte — flat, no shine</SelectItem>
                            <SelectItem value="Satin">Satin — soft sheen</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <div className="h-8 px-2 flex items-center backdrop-blur-sm bg-black/60 rounded-md">
                          <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />
                        </div>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 px-2 backdrop-blur-sm bg-black/60 hover:bg-red-900/80 text-zinc-300 hover:text-red-300"
                        title={`Delete ${VIEW_LABELS[selectedViews[currentViewIndex].key]}`}
                        disabled={!!regeneratingView || isGeneratingMissing || selectedViews.length <= 1}
                        onClick={async () => {
                          if (selectedRender && await confirmDialog({ title: `Delete the ${VIEW_LABELS[selectedViews[currentViewIndex].key]} view?`, description: 'You can regenerate it later from "Generate Missing Views".', confirmText: "Delete", destructive: true })) {
                            deleteSingleView(selectedRender, selectedViews[currentViewIndex].key);
                          }
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  )}

                  {/* Armed-layer hint — when a layer is armed, tell the user the
                      exact next action so placement is never a guessing game. */}
                  {!isViewingImmutableVersion && armedLayerId && (() => {
                    const viewKey = selectedViews[currentViewIndex]?.key || "";
                    const armed = (logoLayersByView[viewKey] || []).find((l) => l.id === armedLayerId);
                    return (
                      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 pointer-events-none px-3 py-1.5 rounded-full bg-cyan-500 text-black text-xs font-bold shadow-lg flex items-center gap-1.5 whitespace-nowrap">
                        Click the render to place {armed?.name || "logo"} — drag to move, corner to resize
                      </div>
                    );
                  })()}

                  {/* Logo placement overlay — captures clicks when a layer is armed */}
                  {!isViewingImmutableVersion && selectedViews[currentViewIndex] && (() => {
                    const viewKey = selectedViews[currentViewIndex].key;
                    const layers = logoLayersByView[viewKey] || [];
                    const placedLayers = layers.filter((l) => l.placement);
                    return (
                      <LogoPlacementOverlay
                        placedLayers={placedLayers}
                        armedLayerId={armedLayerId}
                        wandMode={wandActive}
                        onBoxSelect={handleBoxSelect}
                        onDropArmed={dropArmedLayerAt}
                        onResizePlacement={resizePlacement}
                        onResizePlacementPercent={resizePlacementPercent}
                        onMovePlacement={movePlacement}
                        onRotatePlacement={rotatePlacement}
                        onClearPlacement={clearPlacement}
                      />
                    );
                  })()}

                  {/* Removal-mode hint — names the exact gesture so it's never a
                      guessing game when the draw-box overlay is armed. */}
                  {!isViewingImmutableVersion && wandActive && !armedLayerId && (
                    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 pointer-events-none px-3 py-1.5 rounded-full bg-red-500 text-white text-xs font-bold shadow-lg flex items-center gap-1.5 whitespace-nowrap">
                      Draw a box over the elements you want to remove
                    </div>
                  )}

                  {/* Konva canvas overlay for clean box drawing (removal mode).
                      Yields to logo placement: when a layer is armed, the
                      placement overlay owns the click so dropping a logo isn't
                      swallowed by the removal box canvas. */}
                  {!isViewingImmutableVersion && (
                    <RemovalBoxCanvas
                      active={wandActive && !armedLayerId}
                      onBoxSelect={handleBoxSelect}
                    />
                  )}

                  {/* Arrows */}
                  <Button
                    size="lg"
                    variant="ghost"
                    className="absolute left-3 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/80 h-14 w-10 z-30"
                    onClick={() => setCurrentViewIndex((i) => Math.max(0, i - 1))}
                    disabled={currentViewIndex === 0}
                  >
                    <ChevronLeft className="w-7 h-7" />
                  </Button>
                  <Button
                    size="lg"
                    variant="ghost"
                    className="absolute right-3 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/80 h-14 w-10 z-30"
                    onClick={() => setCurrentViewIndex((i) => Math.min(selectedViews.length - 1, i + 1))}
                    disabled={currentViewIndex === selectedViews.length - 1}
                  >
                    <ChevronRight className="w-7 h-7" />
                  </Button>
                </div>

                {/* Inline Precise Edit — box-select on the render, then describe
                    the change. Toggled by the "Precise" toolbar button. */}
                {!isViewingImmutableVersion && preciseEditOpen && selectedViews[currentViewIndex] && (
                  <Card className="bg-zinc-900 border-cyan-500/30">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <Crosshair className="w-4 h-4 text-cyan-400" />
                          <span className="text-sm font-bold text-white">Precise Edit</span>
                          <span className="text-xs text-zinc-500">
                            — {VIEW_LABELS[selectedViews[currentViewIndex].key]}
                          </span>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-zinc-400 hover:text-white"
                          onClick={() => setPreciseEditOpen(false)}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                      <div className="h-[460px]">
                        <PreciseEditCanvas
                          imageUrl={selectedViews[currentViewIndex].url}
                          defaultMode="box"
                          hideCancel
                          finish={selectedRender?.finish_type}
                          colorName={selectedRender?.color_name}
                          vehicleMake={selectedRender?.vehicle_make}
                          vehicleModel={selectedRender?.vehicle_model}
                          userId={currentUserId}
                          onElementLifted={(layer, bg) => {
                            const vk = selectedViews[currentViewIndex]?.key;
                            if (vk) handleLayerExtracted(vk, layer, bg);
                          }}
                          onClose={() => setPreciseEditOpen(false)}
                          onSave={async (newRenderUrl) => {
                            if (!selectedRender || !selectedViews[currentViewIndex]) return;
                            const viewKey = selectedViews[currentViewIndex].key;
                            try {
                              await savePreciseEditRevision(
                                selectedRender,
                                viewKey,
                                newRenderUrl,
                              );
                            } catch (error: any) {
                              toast.error(`Could not save: ${error?.message || error}`);
                              return;
                            }
                          }}
                        />
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* View Angle Thumbnails */}
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {selectedViews.map((v, i) => (
                    <button
                      key={v.key}
                      onClick={() => setCurrentViewIndex(i)}
                      className={cn(
                        "flex-shrink-0 rounded-lg overflow-hidden border-2 transition-all",
                        i === currentViewIndex ? "border-blue-magenta scale-105" : "border-zinc-700 hover:border-zinc-500"
                      )}
                    >
                      {/* object-CONTAIN (not cover) + 16:9 tile so the thumbnail shows
                          the WHOLE render — object-cover cropped the sides of the 16:9
                          render into a non-16:9 tile, which made a front view read as a
                          different, cropped vehicle and falsely looked like the old
                          view-drift bug. */}
                      <img
                        src={v.url}
                        alt={VIEW_LABELS[v.key]}
                        className="w-32 h-[72px] object-contain bg-zinc-800"
                        loading="lazy"
                        onError={(e) => { (e.target as HTMLImageElement).style.opacity = "0"; }}
                      />
                      <span className="block bg-zinc-900 text-[10px] text-center py-0.5 text-zinc-400">
                        {VIEW_LABELS[v.key]}
                      </span>
                    </button>
                  ))}
                </div>

                {/* VERSION FILMSTRIP */}
                {versionTimeline.length > 0 && (
                  <Card className="bg-zinc-900 border-zinc-800">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <History className="w-4 h-4 text-blue-magenta" />
                          <span className="text-sm font-bold">Version History</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {versionCommits && versionCommits.length > 0 && (
                            <Badge className="bg-blue-magenta/20 text-blue-magenta border-0 text-[9px]">
                              {versionCommits.length} commit{versionCommits.length !== 1 ? "s" : ""}
                            </Badge>
                          )}
                          <Badge className="bg-green-600/20 text-green-400 border-0 text-[9px]">
                            {totalVersions} version{totalVersions !== 1 ? "s" : ""}
                          </Badge>
                        </div>
                      </div>

                      {/* Revision Studio shared timeline (design_version_commits) — the
                          source-of-truth artboard for the active version, if recorded. */}
                      {activeCommit?.master_artboard_url && (
                        <div className="mb-3 flex items-center gap-2 text-[10px] text-zinc-400">
                          <span>
                            v{activeCommit.version_number} · {activeCommit.change_type}
                          </span>
                          <a
                            href={activeCommit.master_artboard_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-magenta hover:underline"
                          >
                            View master artboard ↗
                          </a>
                        </div>
                      )}

                      {/* Every durable commit is a distinct read-only card. */}
                      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-blue">
                        {versionTimeline.map((presentation) => {
                          const isActive = presentation.key === selectedVersionPresentation?.key;
                          const heroUrl = presentation.thumbnailUrl;
                          const versionDate = presentation.createdAt ? new Date(presentation.createdAt) : null;

                          return (
                            <div key={presentation.key} className="flex-shrink-0 flex flex-col items-center gap-1 group/version">
                              <div className="relative">
                                <button
                                  onClick={() => {
                                    // History browsing is read-only. Do not swap
                                    // the editor's mutable selectedRender for an
                                    // old snapshot or a later edit could overwrite
                                    // the working row with historical pixels.
                                    if (presentation.immutable) {
                                      setSelectedVersionTimelineKey(presentation.key);
                                    } else if (presentation.row) {
                                      setSelectedRender(presentation.row);
                                      const legacyViews = getViews(presentation.row);
                                      const exactIndex = legacyViews.findIndex(
                                        (view) => view.key === presentation.primaryKey,
                                      );
                                      setCurrentViewIndex(exactIndex >= 0 ? exactIndex : 0);
                                    }
                                  }}
                                  aria-label={`Inspect version ${presentation.versionNumber}`}
                                  className={cn(
                                    "relative rounded-lg overflow-hidden transition-all",
                                    isActive
                                      ? "border-2 border-blue-magenta-glow scale-105"
                                      : "border-2 border-zinc-700 hover:border-zinc-500 opacity-70 hover:opacity-100"
                                  )}
                                >
                                  {heroUrl && !failedImages.has(presentation.key) ? (
                                    <img
                                      src={heroUrl}
                                      alt={`V${presentation.versionNumber} ${presentation.primaryKey ? VIEW_LABELS[presentation.primaryKey] : "version"}`}
                                      className="w-36 h-[90px] object-contain bg-zinc-800"
                                      loading="lazy"
                                      onError={() => setFailedImages((prev) => new Set([...prev, presentation.key]))}
                                    />
                                  ) : (
                                    <div className="w-36 h-[90px] bg-zinc-800 flex items-center justify-center">
                                      <Layers className="w-4 h-4 text-zinc-600" />
                                    </div>
                                  )}

                                  {/* Version badge */}
                                  <div className="absolute top-1 left-1">
                                    <span
                                      className={cn(
                                        "text-[10px] font-bold px-1.5 py-0.5 rounded",
                                        isActive
                                          ? "bg-gradient-blue-magenta text-white"
                                          : presentation.versionNumber > 1
                                            ? "bg-purple-600/80 text-white"
                                            : "bg-zinc-800/80 text-zinc-300"
                                      )}
                                    >
                                      V{presentation.versionNumber}
                                    </span>
                                  </div>

                                  {presentation.immutable && (
                                    <div
                                      className="absolute top-1 right-1 rounded bg-zinc-950/80 p-1"
                                      title="Immutable OS snapshot"
                                    >
                                      <Shield className="w-2.5 h-2.5 text-cyan-300" />
                                    </div>
                                  )}

                                  {/* Sprocket holes (filmstrip effect) */}
                                  <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-zinc-900/80 flex items-center justify-center gap-1.5 px-1">
                                    {[...Array(6)].map((_, i) => (
                                      <div key={i} className="w-1 h-0.5 rounded-full bg-zinc-600" />
                                    ))}
                                  </div>

                                  {/* Active glow */}
                                  {isActive && (
                                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-blue-magenta" />
                                  )}
                                </button>

                                {/* Immutable commits are append-only. Only the
                                    legacy mutable-row fallback may be deleted. */}
                                {!presentation.immutable && presentation.row && (
                                  <button
                                    type="button"
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      if (await confirmDialog({ title: `Delete V${presentation.versionNumber}?`, description: "This cannot be undone.", confirmText: "Delete", destructive: true })) {
                                        deleteRender.mutate({ id: presentation.row!.id, source: presentation.row!.__source as string | undefined });
                                      }
                                    }}
                                    className="absolute -top-1.5 -right-1.5 z-10 w-5 h-5 rounded-full bg-red-600/80 hover:bg-red-600 flex items-center justify-center opacity-0 group-hover/version:opacity-100 transition-opacity"
                                    title={`Delete V${presentation.versionNumber}`}
                                  >
                                    <X className="w-3 h-3 text-white" />
                                  </button>
                                )}
                              </div>
                              {/* WHAT WAS ASKED FOR, VERBATIM. A version is
                                  identified by the words that produced it, not
                                  only by its thumbnail -- and it is the same
                                  text PanelPro shows for the same version,
                                  because both read one record. */}
                              {presentation.revisionNotes && (
                                <span
                                  className="w-36 truncate text-[9px] leading-snug text-zinc-400"
                                  title={presentation.revisionNotes}
                                >
                                  {presentation.revisionNotes}
                                </span>
                              )}
                              {/* Per-version timestamp */}
                              {versionDate && (
                                <span className="text-[9px] text-zinc-500 whitespace-nowrap">
                                  {format(versionDate, "MMM d, h:mm a")}
                                </span>
                              )}
                              {/* Per-version revision prompt snippet */}
                              {presentation.revisionNotes && (
                                <p className="text-[9px] text-purple-400/80 w-36 truncate" title={presentation.revisionNotes}>
                                  {presentation.revisionNotes}
                                </p>
                              )}
                              {presentation.changedKeys.length > 0 && (
                                <p className="text-[8px] text-cyan-300/80 w-36 truncate" title={presentation.changedKeys.map((key) => VIEW_LABELS[key]).join(", ")}>
                                  {presentation.changedKeys.map((key) => VIEW_LABELS[key]).join(" + ")}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* Selected version info */}
                      {(() => {
                        const createdDate = selectedVersionPresentation?.createdAt
                          ? new Date(selectedVersionPresentation.createdAt)
                          : null;
                        return (
                          <div className="mt-3 flex items-center justify-between text-[10px] text-zinc-500">
                            <div className="flex items-center gap-2">
                              {createdDate && (
                                <>
                                  <Calendar className="w-3 h-3" />
                                  <span>{format(createdDate, "MMM d, yyyy")}</span>
                                  <Clock className="w-3 h-3 ml-1" />
                                  <span>{format(createdDate, "h:mm a")}</span>
                                </>
                              )}
                            </div>
                            {selectedVersionPresentation?.revisionNotes && (
                              <span className="text-purple-300 truncate max-w-[300px]">
                                <Edit3 className="w-3 h-3 inline mr-0.5" />
                                {selectedVersionPresentation.revisionNotes}
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </CardContent>
                  </Card>
                )}

                {/* Immutable version comparison — adjacent frozen snapshots,
                    same exact surface on both sides. */}
                {previousVersionPresentation &&
                  selectedVersionPresentation.primaryKey &&
                  selectedVersionPresentation.previousUrl &&
                  selectedVersionPresentation.currentUrl && (
                  <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-3">
                    <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider mb-3">
                      Version Comparison · {VIEW_LABELS[selectedVersionPresentation.primaryKey]}
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-[10px] text-zinc-500 font-semibold mb-1.5">
                          Before · V{previousVersionPresentation.versionNumber}
                        </p>
                        <div className="rounded overflow-hidden border border-zinc-700">
                          <img
                            src={selectedVersionPresentation.previousUrl}
                            alt={`Before ${VIEW_LABELS[selectedVersionPresentation.primaryKey]}`}
                            className="w-full aspect-video object-contain bg-zinc-950 cursor-pointer"
                            onClick={() => setExpandedImage({
                              url: selectedVersionPresentation.previousUrl!,
                              title: `Before · ${VIEW_LABELS[selectedVersionPresentation.primaryKey!]}`,
                            })}
                          />
                        </div>
                      </div>
                      <div>
                        <p className="text-[10px] text-zinc-500 font-semibold mb-1.5">
                          After · V{selectedVersionPresentation.versionNumber}
                        </p>
                        <div className="rounded overflow-hidden border border-zinc-700">
                          <img
                            src={selectedVersionPresentation.currentUrl}
                            alt={`After ${VIEW_LABELS[selectedVersionPresentation.primaryKey]}`}
                            className="w-full aspect-video object-contain bg-zinc-950 cursor-pointer"
                            onClick={() => setExpandedImage({
                              url: selectedVersionPresentation.currentUrl!,
                              title: `After · ${VIEW_LABELS[selectedVersionPresentation.primaryKey!]}`,
                            })}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* RIGHT: Edit tools panel (scrolls independently on desktop) */}
              <div
                className={cn(
                  "w-full lg:w-80 xl:w-96 flex-shrink-0 space-y-4 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:pr-1",
                  isViewingImmutableVersion && "pointer-events-none opacity-50",
                )}
                aria-disabled={isViewingImmutableVersion}
                inert={isViewingImmutableVersion ? true : undefined}
              >
                {/* LayerLift — HIDDEN: it is a DUPLICATE of "Remove Elements"
                    (RenderElementSeparator, Card 2 below). Both box-extract an
                    element into the Layers strip; Remove Elements is the canonical
                    working tool, so the redundant LayerLift modal is hidden to
                    de-clutter. Code kept intact — remove the `false &&` to restore. */}
                {false && (
                <Card className="bg-zinc-900 border-zinc-800">
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <Wand2 className="w-4 h-4 text-cyan-400" />
                      <span className="text-sm font-bold">LayerLift</span>
                    </div>
                    <p className="text-[11px] text-zinc-500">
                      Drag a box over a logo/text → lift it out + heal the background
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full bg-zinc-800 border-zinc-700 hover:bg-zinc-700"
                      onClick={() => setLayerLiftOpen(true)}
                    >
                      <Wand2 className="w-3.5 h-3.5 mr-1.5" /> Open LayerLift
                    </Button>
                  </CardContent>
                </Card>
                )}

                {/* Precision Remove Elements — HIDDEN per request (broken AI tool).
                    Code kept intact for later restore — remove the `false &&` to
                    re-enable. */}
                {false && selectedViews[currentViewIndex] && (
                  <Card className="bg-zinc-900 border-cyan-500/30 bg-gradient-to-br from-cyan-950/30 to-zinc-900">
                    <CardContent className="p-4 space-y-3">
                      {!preciseEditOpen ? (
                        <Button
                          className="w-full bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-semibold"
                          disabled={!selectedRender}
                          onClick={() => setPrecisionModalOpen(true)}
                        >
                          <Crosshair className="w-4 h-4 mr-2" />
                          Precision Remove Elements
                        </Button>
                      ) : (
                        <>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Crosshair className="w-4 h-4 text-cyan-400" />
                          <span className="text-sm font-bold text-white">Precision Remove Elements</span>
                          <span className="ml-auto text-[9px] uppercase tracking-wide text-cyan-300/80 font-semibold">Box → Edit</span>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-zinc-400 hover:text-white"
                          onClick={() => setPreciseEditOpen(false)}
                          title="Collapse"
                        >
                          <ChevronUp className="w-4 h-4" />
                        </Button>
                      </div>
                        <div className="h-[420px]">
                          <PreciseEditCanvas
                            imageUrl={selectedViews[currentViewIndex].url}
                            defaultMode="box"
                            hideCancel
                            finish={selectedRender?.finish_type}
                            colorName={selectedRender?.color_name}
                            vehicleMake={selectedRender?.vehicle_make}
                            vehicleModel={selectedRender?.vehicle_model}
                            userId={currentUserId}
                            onElementLifted={(layer, bg) => {
                              const vk = selectedViews[currentViewIndex]?.key;
                              if (vk) handleLayerExtracted(vk, layer, bg);
                            }}
                            onClose={() => setPreciseEditOpen(false)}
                            onSave={async (newRenderUrl) => {
                              if (!selectedRender || !selectedViews[currentViewIndex]) return;
                              const viewKey = selectedViews[currentViewIndex].key;
                              try {
                                await savePreciseEditRevision(
                                  selectedRender,
                                  viewKey,
                                  newRenderUrl,
                                );
                              } catch (error: any) {
                                toast.error(`Could not save: ${error?.message || error}`);
                                return;
                              }
                            }}
                          />
                        </div>
                        </>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Revision Changes — the prompt revision box, directly under the editor */}
                <Card className="bg-zinc-900 border-zinc-800">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <Edit3 className="w-4 h-4 text-purple-400" />
                      <span className="text-sm font-bold">Revision Changes</span>
                    </div>
                    <p className="text-[11px] text-zinc-500">
                      Tell RevisionIQ what to change in plain English — exactly like you'd text your designer.
                    </p>
                    {/* New-abilities callout (additive — reflects the Master Editor upgrade) */}
                    <div className="rounded-md border border-cyan-500/20 bg-cyan-500/5 px-3 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-cyan-400">
                        RevisionIQ now understands
                      </p>
                      <ul className="mt-1 space-y-0.5 text-[11px] text-zinc-300 leading-snug">
                        <li>• Full multi-part requests — it does <span className="text-white">every</span> part, not just the first</li>
                        <li>• Vehicle &amp; coverage terms — quarter panel, rocker, beltline, “three-quarter wrap,” “no wrap on the hood”</li>
                        <li>• Your reference photos — including <span className="text-white">hand-drawn lines</span> showing where the wrap cuts off</li>
                        <li>• It reports back “here’s what I changed” so you can confirm it understood</li>
                      </ul>
                    </div>
                    {/* Last revision prompt context + AI "here's what I changed" readback */}
                    {(() => {
                      let lastPrompt = "";
                      let aiSummary = "";
                      try {
                        const notes = JSON.parse(selectedRender?.admin_notes || "{}");
                        const history = notes.prompt_history || [];
                        if (history.length > 0) {
                          lastPrompt = history[history.length - 1].prompt || "";
                        } else {
                          lastPrompt = notes.last_revision_prompt || notes.version?.revision_notes || "";
                        }
                        aiSummary = notes.ai_edit_summary || "";
                      } catch {}
                      if (!lastPrompt && !aiSummary) return null;
                      return (
                        <div className="space-y-2">
                          {lastPrompt && (
                            <div className="bg-purple-500/10 border border-purple-500/20 rounded-md px-3 py-2">
                              <span className="text-[10px] text-purple-400 font-semibold uppercase tracking-wide">Last edit:</span>
                              <p className="text-[11px] text-purple-200 mt-0.5 leading-snug whitespace-pre-wrap">
                                {lastPrompt}
                              </p>
                            </div>
                          )}
                          {aiSummary && (
                            <div className="bg-cyan-500/10 border border-cyan-500/20 rounded-md px-3 py-2">
                              <span className="text-[10px] text-cyan-400 font-semibold uppercase tracking-wide">RevisionIQ — here's what I changed:</span>
                              <p className="text-[11px] text-cyan-100 mt-0.5 leading-snug whitespace-pre-wrap">
                                {aiSummary}
                              </p>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    {/* Revision Tier Label */}
                    {(() => {
                      const count = versionChain?.length || 1;
                      const tier = selectedRender?.subscription_tier || "starter";
                      const tierLimits: Record<string, { limit: number | null; label: string }> = {
                        starter: { limit: 3, label: "Starter" },
                        advanced: { limit: 10, label: "Advanced" },
                        complete: { limit: 25, label: "Complete" },
                        agency: { limit: null, label: "Agency" },
                        admin: { limit: null, label: "Admin" },
                      };
                      const tierInfo = tierLimits[(tier || "").toLowerCase()] || tierLimits.starter;
                      return (
                        <Badge variant="outline" className="border-purple-500/40 text-purple-300 text-[10px]">
                          Revision {count} of {tierInfo.limit ?? "∞"} ({tierInfo.label})
                        </Badge>
                      );
                    })()}
                    <Textarea
                      value={revisionNotes}
                      onChange={(e) => setRevisionNotes(e.target.value)}
                      placeholder="Write it like a work order — e.g. 'More silver and grey toward the top of the cab, no light blue on the front, no wrap on the hood. End the wrap at the headlight and slant it up toward the mirror. Move the logo to the lower door — smaller and shifted left.'"
                      className="bg-zinc-800 border-zinc-700 h-28 text-sm"
                    />
                    {/* Type OR talk the edit, and drop in an example to match.
                        Detailed multi-layered edits — the AI parses the panels
                        and layers from natural language, no manual isolation. */}
                    <div className="flex items-center gap-2">
                      {voiceSupported && (
                        <button
                          type="button"
                          onClick={toggleVoice}
                          className={cn(
                            "flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-md border transition-colors",
                            voiceListening
                              ? "bg-red-500/20 border-red-500/50 text-red-300 font-semibold animate-pulse"
                              : "bg-zinc-800 border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500"
                          )}
                          title="Speak your revision"
                        >
                          <Mic className="w-3.5 h-3.5" />
                          {voiceListening ? "Listening… tap to stop" : "Speak"}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => exampleUploadRef.current?.click()}
                        disabled={uploadingExample}
                        className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-md border bg-zinc-800 border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 transition-colors disabled:opacity-50"
                        title="Upload an example or supporting image to match"
                      >
                        {uploadingExample ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Paperclip className="w-3.5 h-3.5" />}
                        Upload example / supporting edit
                      </button>
                      <input
                        ref={exampleUploadRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleExampleUpload}
                      />
                    </div>
                    {/* Revise & Clone — primary action, sits directly under the
                        prompt box so it never requires scrolling to the bottom. */}
                    <Button
                      className="w-full bg-gradient-blue-magenta hover:brightness-110 text-white h-11"
                      onClick={async () => {
                        // Allow revise when there are placed logo layers even with empty notes
                        const anchorKey = selectedViews[currentViewIndex]?.key;
                        // HONOR THE PANEL NAMED IN THE PROMPT. The PRIMARY revision
                        // target (the view whose image is edited AND where the
                        // uploaded reference lands) used to always be the anchored
                        // view. So "make the ROOF match this" while parked on the
                        // hood wrote the roof design onto the HOOD (the #1 "it
                        // edited the wrong panel" bug). When the request explicitly
                        // names a view/panel that isn't the one you're parked on —
                        // and you haven't hand-picked a scope — edit the NAMED view
                        // as PRIMARY instead of the incidental anchor.
                        const userPickedScope = !!(scopeViewKeys && scopeViewKeys.length > 0);
                        const namedViews = panelViewsForRevision(revisionNotes, revisionPanelTargets)
                          .filter((v) => availableViewKeys.includes(v));
                        const promptNamesOtherPanel = !userPickedScope
                          && namedViews.length > 0
                          && !!anchorKey
                          && !namedViews.includes(anchorKey);
                        const currentViewKey = promptNamesOtherPanel ? namedViews[0] : anchorKey;
                        const hasPlacedLayers = !!currentViewKey && (logoLayersByView[currentViewKey] || []).some((l) => l.placement);
                        // The scope picker is the single source of truth for which
                        // angles get edited. effectiveScopeViews = the user's
                        // hand-picked set, or the smart default (current view + the
                        // angles that show any panel named in the notes). A hood
                        // edit therefore reaches hood_detail + front and leaves the
                        // rear untouched unless the user adds it. When the prompt
                        // names a different panel, edit EXACTLY the named angles.
                        const targetViews = promptNamesOtherPanel
                          ? Array.from(new Set(namedViews)) as string[]
                          : Array.from(new Set(
                              [currentViewKey, ...effectiveScopeViews].filter(Boolean)
                            )) as string[];
                        const applyToAll = targetViews.length > 1;
                        if (promptNamesOtherPanel) {
                          toast.info(`Editing ${targetViews.map((k) => VIEW_LABELS[k] || k).join(", ")} — matched to the panel you named, not the ${VIEW_LABELS[anchorKey] || anchorKey} view you're on.`);
                        } else if (applyToAll && !userPickedScope) {
                          // If the smart default reached past the current angle and
                          // the user didn't override, tell them which angles update.
                          const extras = targetViews
                            .filter((k) => k !== currentViewKey)
                            .map((k) => VIEW_LABELS[k] || k);
                          if (extras.length > 0) {
                            toast.info(`Also updating ${extras.join(", ")} — those angles show the panel(s) you named. Use the scope buttons to change which sides are edited.`);
                          }
                        }
                        // MOVE / REMOVE LOGO → LAYERED edit on the clean artboard
                        // (Canva-style, zero smear). Swap to the logo-free clean base
                        // (Layer 0) and lift the real logo as a draggable overlay
                        // (Layer 1) — no heal, nothing baked. Missing layered assets
                        // fail closed and never become a full AI redesign.
                        if (selectedRender && wantsLogoMove(revisionNotes) && currentViewKey) {
                          if (hasPlacedLayers) {
                            toast.error(
                              "Move or remove the existing layer directly on the canvas, then save with the notes empty. No AI redesign was started.",
                              { duration: 12000 },
                            );
                            return;
                          }
                          const layered = await layeredMoveLogo(selectedRender, currentViewKey);
                          if (layered) {
                            setShowReviseDialog(false);
                            setRevisionNotes("");
                            return;
                          }
                          // Preserve the dialog + notes so the user can retry after
                          // the verified clean base exists. Never substitute
                          // cloneAndRevise/revise-render for a recognized layer edit.
                          return;
                        }
                        if ((revisionNotes.trim() || hasPlacedLayers) && selectedRender) {
                          cloneAndRevise.mutate({
                            sourceRender: selectedRender,
                            notes: revisionNotes,
                            visionBoardImages: visionImages.length > 0 ? visionImages : undefined,
                            visionBoardIntent: visionImages.length > 0 ? visionIntent : undefined,
                            currentViewKey,
                            applyToAll,
                            targetViewKeys: targetViews,
                            panelTargets: revisionPanelTargets.length > 0 ? revisionPanelTargets : undefined,
                            logoLayersByView,
                            cleanBackgroundsByView,
                          });
                        }
                      }}
                      disabled={cloneAndRevise.isPending || (!revisionNotes.trim() && !((logoLayersByView[selectedViews[currentViewIndex]?.key || ""] || []).some((l) => l.placement)))}
                    >
                      {cloneAndRevise.isPending ? (
                        <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Cloning & Revising...</>
                      ) : (
                        <><GitBranch className="w-4 h-4 mr-2" /> Revise & Clone as V{selectedRender ? parseVersionInfo(selectedRender).version + 1 : ""}</>
                      )}
                    </Button>
                    {/* Apply scope: pick EXACTLY which angles this edit touches.
                        The current view is the anchor (always edited); per-side
                        buttons isolate the rest — so "change the hood" can update
                        the hood + front without dragging the rear along. */}
                    <div className="pt-1 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-zinc-400 font-semibold">Apply this edit to</span>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => setScopeViewKeys(currentScopeAnchorKey ? [currentScopeAnchorKey] : [])}
                            className={cn(
                              "text-[10px] px-2 py-0.5 rounded border transition-colors",
                              effectiveScopeViews.length <= 1
                                ? "bg-cyan-500/20 border-cyan-500/50 text-cyan-300 font-semibold"
                                : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-300"
                            )}
                          >
                            This view only
                          </button>
                          <button
                            onClick={() => setScopeViewKeys([...availableViewKeys])}
                            className={cn(
                              "text-[10px] px-2 py-0.5 rounded border transition-colors",
                              effectiveScopeViews.length >= availableViewKeys.length && availableViewKeys.length > 1
                                ? "bg-purple-500/20 border-purple-500/50 text-purple-300 font-semibold"
                                : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-300"
                            )}
                          >
                            All views
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedViews.map((v) => {
                          const on = effectiveScopeViews.includes(v.key);
                          const isAnchor = v.key === currentScopeAnchorKey;
                          return (
                            <button
                              key={v.key}
                              onClick={() => toggleScopeView(v.key)}
                              title={isAnchor ? "Current view (anchor)" : on ? "Click to exclude this side" : "Click to include this side"}
                              className={cn(
                                "text-[11px] px-2.5 py-1 rounded-md border transition-colors",
                                on
                                  ? "bg-cyan-500/20 border-cyan-500/50 text-cyan-200 font-semibold"
                                  : "bg-zinc-800 border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-500"
                              )}
                            >
                              {isAnchor && <span className="text-cyan-400 mr-0.5">●</span>}
                              {VIEW_LABELS[v.key] || v.key}
                            </button>
                          );
                        })}
                      </div>
                      <span className="text-[10px] text-zinc-500">
                        {effectiveScopeViews.length <= 1
                          ? `Editing ${currentScopeAnchorKey ? (VIEW_LABELS[currentScopeAnchorKey] || currentScopeAnchorKey) : "current view"} only — the rest stay untouched.`
                          : `Editing ${effectiveScopeViews.map((k) => VIEW_LABELS[k] || k).join(", ")} — every other angle stays untouched.`}
                      </span>
                    </div>
                  </CardContent>
                </Card>

                {/* Remove Elements — HIDDEN per request (broken AI tool): the
                    Gemini "heal" pass that fills the boxed area just SMEARS the
                    render instead of cleanly removing the element. Code kept
                    intact for later restore — remove the `false &&` to re-enable. */}
                {false && (
                <Card className="bg-zinc-900 border-zinc-800">
                  <CardContent className="p-4">
                    <RenderElementSeparator
                      ref={separatorRef}
                      userId={currentUserId}
                      currentViewKey={selectedViews[currentViewIndex]?.key || null}
                      currentViewUrl={(() => {
                        const k = selectedViews[currentViewIndex]?.key;
                        if (!k) return null;
                        return cleanBackgroundsByView[k] || selectedViews[currentViewIndex]?.url || null;
                      })()}
                      onLayerExtracted={handleLayerExtracted}
                      onWandActiveChange={setWandActive}
                    />
                  </CardContent>
                </Card>
                )}

                {/* Prompt History Timeline - living chain of all revisions */}
                {(() => {
                  let history: Array<{ version: number; prompt: string; timestamp: string; view_key: string; type: string }> = [];
                  try {
                    const notes = JSON.parse(selectedRender?.admin_notes || "{}");
                    history = notes.prompt_history || [];
                  } catch {}
                  if (history.length === 0 && selectedRender) {
                    const vInfo = parseVersionInfo(selectedRender);
                    if (vInfo.revisionNotes) {
                      history = [{ version: vInfo.version, prompt: vInfo.revisionNotes, timestamp: vInfo.clonedAt || "", view_key: vInfo.revisedViewKey || "side", type: "revision" }];
                    }
                  }
                  if (history.length === 0) return null;
                  return (
                    <Card className="bg-zinc-900 border-purple-500/30">
                      <CardContent className="p-4 space-y-2">
                        <div className="flex items-center gap-2 mb-1">
                          <History className="w-4 h-4 text-purple-400" />
                          <span className="text-sm font-bold text-purple-300">Prompt History</span>
                          <Badge variant="outline" className="border-purple-500/30 text-purple-400 text-[10px] ml-auto">
                            {history.length} edit{history.length !== 1 ? "s" : ""}
                          </Badge>
                        </div>
                        <div className="space-y-1.5 max-h-72 overflow-y-auto">
                          {history.map((entry, idx) => (
                            <div key={idx} className="flex gap-2 items-start">
                              <div className="flex flex-col items-center mt-1">
                                <div className={cn(
                                  "w-2 h-2 rounded-full shrink-0",
                                  entry.type === "original" ? "bg-blue-400" : "bg-purple-400"
                                )} />
                                {idx < history.length - 1 && <div className="w-px h-full bg-zinc-700 min-h-[12px]" />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <Badge variant="outline" className={cn(
                                    "text-[9px] px-1 py-0",
                                    entry.type === "original" ? "border-blue-500/40 text-blue-300" : "border-purple-500/40 text-purple-300"
                                  )}>
                                    V{entry.version}
                                  </Badge>
                                  {entry.view_key && entry.view_key !== "side" && (
                                    <span className="text-[9px] text-zinc-500">{entry.view_key}</span>
                                  )}
                                  {entry.timestamp && (
                                    <span className="text-[9px] text-zinc-600 ml-auto shrink-0">
                                      {(() => { try { return formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true }); } catch { return ""; } })()}
                                    </span>
                                  )}
                                </div>
                                <p className="text-[11px] text-zinc-300 leading-snug mt-0.5 break-words whitespace-pre-wrap">
                                  {entry.prompt}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })()}

                {/* VisionBoardIQ Upload */}
                <Card className="bg-zinc-900 border-zinc-800">
                  <CardContent className="p-4">
                    <InlineVisionBoard
                      images={visionImages}
                      onChange={setVisionImages}
                      intent={visionIntent}
                      onIntentChange={setVisionIntent}
                      onEnlarge={(img) => setExpandedImage({ url: img.storageUrl, title: img.slotLabel })}
                    />
                  </CardContent>
                </Card>

                {/* Layers (shared bin — Remove Elements feeds extracted layers here) */}
                <Card className="bg-zinc-900 border-zinc-800">
                  <CardContent className="p-4">
                    {/* Repositioning is the only LayerStrip action users need
                        on this surface — arm a layer, click the render to drop
                        it, drag handles to move, slider to resize. Vectorize
                        is a production concern (cut-ready SVG) so it stays in
                        QC Artboard's element panel only. */}
                    <LayerStrip
                      layers={logoLayersByView[selectedViews[currentViewIndex]?.key || ""] || []}
                      armedLayerId={armedLayerId}
                      onArm={armLayer}
                      onPlace={placeAndArmLayer}
                      onDelete={deleteLogoLayer}
                      productionMethod={productionMethod}
                      onProductionMethodChange={setProductionMethod}
                    />
                  </CardContent>
                </Card>

                {/* Production Layers — the SEPARATED background + transparent
                    design overlay PNGs that production-flow-engine already authored
                    into the legacy production asset store (keyed by generation id,
                    the SAME job_id the QC / ProductionFlow pages read). Surfaced
                    here for FAST edits: drop the transparent overlay onto the canvas
                    as an editable layer instead of regenerating the whole render.
                    Renders nothing until separated layers exist. */}
                {/* PRELOADED 2D production proof for this (past) job — shown
                    inline so the customer sees it without opening the dialog. */}
                <InlineStoredProof render={selectedRender} />

                {/* ProductionPackQCCard removed from RevisionStudio per owner
                    (Trish 2026-07-24): the production-pack QC surface does not
                    belong in the customer-facing revision view. It still lives on
                    the PanelPro Studio Board; this only unmounts it here. */}

                {/* THE DESIGN'S VERSION RECORD — versions, the customer's own
                    words for each, timestamps, and the identity trio that also
                    appears in PanelPro.

                    ⛔ NOT THE A.T.L.A.S. MASTER. The flattened sheet is never
                    shown to a client; it lives in PanelPro Studio under the
                    A.T.L.A.S. generation id, because that is the internal
                    control room where the authority everything descends from is
                    inspected. This surface is review / revise / approve / buy. */}
                {/* The version record card (Generation ID / Design ID / order number)
                    was unmounted by owner directive (2026-08-26): those are
                    production identities, and they live in PanelPro Studio
                    with the rest of the technical record. RestylePro's studio
                    -- the spec -- never showed them to the customer. */}

                {/* APPROVE DESIGN & BUILD PRINT PANELS — the stage 2 → 3 door.
                    (Trish 2026-08-29.)

                    It is a NAVIGATION, deliberately, and it does not pretend to
                    trigger a build. The freeze is already the server's: the
                    handoff fires on master acceptance (RULE 0.5 amendment), the
                    entice workflow runs `revision.freeze` and `panels.build`
                    without being asked, and Call 1 cut the six panels before any
                    proof rendered. A button here that POSTed something would be
                    a second trigger for work already in flight.

                    What it does provide is the thing that was missing: the
                    owner's explicit "this design is the one", carrying the job
                    identity to PanelPro so no id is ever retyped. The breadcrumb
                    above reports whether the server has actually frozen. */}
                {productionLayersId && (
                  <div className="rounded-lg border border-emerald-500/30 bg-gradient-to-br from-emerald-950/40 to-zinc-900 p-4">
                    <p className="text-sm font-bold text-zinc-100">Happy with this design?</p>
                    <p className="mt-1 text-xs text-zinc-400">
                      Approving freezes this revision as the production authority. Every print
                      panel below is a deterministic crop of its accepted master — nothing is
                      redesigned downstream.
                    </p>
                    <Button
                      onClick={() => navigate(
                        `/designpro/jobs/${encodeURIComponent(productionLayersId)}/panelpro/surfaces`,
                      )}
                      className="mt-3 w-full gap-2 bg-emerald-600 text-white hover:bg-emerald-500"
                    >
                      <Package className="w-4 h-4" />
                      Approve Design &amp; Build Print Panels
                    </Button>
                  </div>
                )}

                <ProductionFlowLayersCard
                  // A panelizer-sourced card's `id` was a job id —
                  // an id class NONE of the resolver's three lookups can match,
                  // by construction (it is not a design row, no
                  // admin_notes back-link ever names a job id, and no entice
                  // pack is keyed by one). Live 2026-08-04 15:44:51Z: the
                  // resolver's direct + back-link queries both ran against
                  // panelizer job id 16c06372 and both correctly returned
                  // nothing, so the identity guard refused the click — on a
                  // design whose real back-link (viz 0f5b7e62 → designiq
                  // 74f809fe) existed the whole time. The job row already
                  // carries the linked design id as `_generationId`; hand the
                  // resolver THAT, which is exactly the id class it resolves.
                  // Orphaned jobs (null _generationId) fall through to today's
                  // behavior and the guard still fails closed — honestly.
                  generationId={productionLayersId}
                  // The standalone runtime's rows when this design is one of its
                  // runs, null otherwise -- and null is what makes the card fall
                  // back to its own resolution, so a legacy design is untouched.
                  source={standaloneProductionLayers}
                  onAddOverlayLayer={(url, name) =>
                    addLogoLayerToCurrentView({
                      id: `pfa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
                      kind: "uploaded",
                      sourceUrl: url,
                      name,
                      placement: null,
                    })
                  }
                />

                {/* CUT GRAPHICS PACK — upsell enticement under the print panels.
                    A DesignPro / RecreatePro PRINTED wrap doesn't produce cut vinyl
                    graphics; if the buyer wants their logos + lettering as plotter-cut
                    solid vinyl too, that's a paid add-on. Show BOTH cut deliverables
                    as a teaser and drive the sale with an "Order Cut Graphics Pack"
                    CTA. Hidden for GraphicsPro designs (which build cut graphics
                    natively — they keep the real cut actions in the panel above). */}
                {selectedRender && !((selectedRender?.mode_type || "").toLowerCase().includes("graphic")) && (
                  <div className="rounded-lg border border-purple-500/30 bg-gradient-to-br from-purple-950/40 to-zinc-900 p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <Scissors className="w-4 h-4 text-purple-400" />
                      <span className="text-sm font-bold text-zinc-100">Cut Contour Pack</span>
                      <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide text-purple-300 bg-purple-500/15 rounded px-1.5 py-0.5">Optional add-on</span>
                    </div>
                    <p className="text-[11px] text-zinc-400 leading-snug">
                      Your printed panels above are complete and ready to print. Want your logos &amp; lettering as separated plotter-cut vinyl too? Add the cut-contour files — the Cut Contour Logo Pack plus a dimensioned Cut Production Sheet.
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-950/50 px-2 py-1.5 text-[10px] text-zinc-400">
                        <Scissors className="w-3 h-3 text-purple-400 shrink-0" /> Cut Contour Logo Pack
                      </div>
                      <div className="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-950/50 px-2 py-1.5 text-[10px] text-zinc-400">
                        <Ruler className="w-3 h-3 text-purple-400 shrink-0" /> Cut Production Sheet
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => navigate(`/graphicspro?renderId=${selectedRender.id}&quickQuote=1`)}
                      className="w-full h-10 inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white text-sm font-semibold hover:brightness-110"
                    >
                      <Scissors className="w-4 h-4" /> Get Cut Graphics Quote
                    </button>
                  </div>
                )}

                {/* Design Elements — Alternates (Step B): the 2nd-choice element
                    styles the design also generated. Tap one to add it as an
                    editable layer (renders nothing when there are no alternates). */}
                <AlternateElementsCard
                  generationId={deepLinkId || selectedRender?.id || null}
                  onPick={(url, name) =>
                    addLogoLayerToCurrentView({
                      id: `alt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
                      kind: "uploaded",
                      sourceUrl: url,
                      name,
                      placement: null,
                    })
                  }
                />

                {/* Action Buttons */}
                <div className="space-y-2">
                  {/* Push to ApprovePro — enter an ApprovePro order # and push this
                      open design (angle renders + 2D proof) onto that order's proof
                      as the active version, so it shows in the ApprovePro command
                      center. Only rendered when a design is selected. */}
                  {APPROVEPRO_UI_LIVE && selectedRender && (
                    <div className="flex gap-2">
                      <Input
                        value={pushOrderNo}
                        onChange={(e) => setPushOrderNo(e.target.value)}
                        placeholder="ApprovePro order # (e.g. 34934)"
                        className="h-11 bg-zinc-900 border-zinc-700 text-zinc-100"
                        disabled={pushing}
                        onKeyDown={(e) => { if (e.key === "Enter" && !pushing && pushOrderNo.trim()) pushToApprovePro(); }}
                      />
                      <Button
                        className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] hover:brightness-110 text-white h-11 whitespace-nowrap"
                        onClick={pushToApprovePro}
                        disabled={pushing || !pushOrderNo.trim()}
                        title="Push this design (renders + 2D proof) onto the ApprovePro order's proof as the active version"
                      >
                        {pushing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                        {pushing ? "Pushing..." : "Push to Existing Order"}
                      </Button>
                    </div>
                  )}

                  {/* Build Assets — open this design's Design Assets page, which
                      observes and can explicitly retry the durable server workflow.
                      Resolve the CANONICAL generation id so it never lands on a
                      blank "No assets" page: panelizer-job rows carry it as
                      _generationId; design rows via admin_notes
                      (genIdOf); else the render id (the page resolver handles it).
                      Passing the panelizer-job id was what opened the blank page. */}
                  <Button
                    variant="outline"
                    className="w-full border-blue-600 text-blue-400 hover:bg-blue-900/30 h-11"
                    onClick={() => {
                      // Prefer the REAL design row id — it's the row
                      // this page is displaying (views + stored proof + artboards),
                      // so the Design Assets page resolves it with a DIRECT lookup
                      // on ANY device and maps it to the canonical generation id
                      // internally. Opening on the DesignIQ id was the "no 2D
                      // proof / 0 views" bug: that id's own row is near-empty and
                      // the page's reverse admin_notes link misses in production.
                      // Pseudo rows (proof-bridge "proof-…" ids) fall back to the
                      // canonical ids as before.
                      const cvId = selectedRender?.id && !String(selectedRender.id).startsWith("proof-") ? selectedRender.id : null;
                      const assetsId = (selectedRender as any)?._generationId || cvId || genIdOf(selectedRender);
                      if (assetsId) {
                        // Stash the open design's views + stored proof/artboards so
                        // the page can build even if its DB lookups come up empty.
                        stashBuildCtx(selectedRender, assetsId);
                        window.open(`/design-assets/${assetsId}`, "_blank", "noopener");
                      }
                    }}
                    disabled={!selectedRender}
                    title="Open the durable proof, panel, and logo workflow status"
                  >
                    <Layers className="w-4 h-4 mr-2" /> Build Assets
                  </Button>

                  {/* Refine in Studio Board — push this design to the Studio Board
                      page (/admin/studio-board) where the shop slides each uploaded
                      Gemini side over the real 2D proof to compare + approve before
                      the GENIE panelizer runs. Deep-links by order number when we
                      have it, else the canonical generation id (Studio Board's
                      search resolves a UUID via the job's generation id). */}
                  <Button
                    variant="outline"
                    className="w-full border-fuchsia-600 text-fuchsia-400 hover:bg-fuchsia-900/30 h-11"
                    onClick={() => {
                      const ref = (selectedRender as any)?.order_number
                        || (selectedRender as any)?._generationId
                        || genIdOf(selectedRender)
                        || selectedRender?.id;
                      if (ref) navigate(`/admin/studio-board?order=${encodeURIComponent(ref)}`);
                    }}
                    disabled={!selectedRender}
                    title="Open this design in PanelProStudio to slide each PanelPro Extract side over the real proof, refine, and approve"
                  >
                    <SlidersHorizontal className="w-4 h-4 mr-2" /> Refine in PanelProStudio
                  </Button>

                  {/* "Run Panel Pro Extract" removed (2026-07-24 audit): duplicate
                      of Refine in PanelProStudio — the board owns the extract/pull. */}

                  {/* Restyle on New Vehicle - secondary, opens vehicle dialog */}
                  <Button
                    variant="outline"
                    className="w-full border-zinc-600 text-zinc-300 hover:bg-zinc-800 hover:text-white h-11"
                    onClick={() => setShowReviseDialog(true)}
                    disabled={cloneAndRevise.isPending}
                  >
                    <Sparkles className="w-4 h-4 mr-2" /> Restyle on New Vehicle
                    <Badge className="ml-2 bg-amber-600/20 text-amber-400 border-0 text-[9px] px-1.5 py-0">Paid</Badge>
                  </Button>

                  {isAdmin && (
                  <Button
                    className="w-full bg-gradient-blue-magenta hover:brightness-110 text-white h-11"
                    onClick={() => navigate("/admin/studio-showcase")}
                  >
                    <Play className="w-4 h-4 mr-2" /> Studio Showcase
                  </Button>
                  )}

                  {/* Download with stamp */}
                  <Button
                    variant="outline"
                    className="w-full border-emerald-600 text-emerald-400 hover:bg-emerald-900/30 h-11"
                    onClick={() => selectedRender && handleDownloadRender(selectedRender)}
                    disabled={!selectedRender || downloadingAll}
                  >
                    <Download className="w-4 h-4 mr-2" /> Download with Stamp
                  </Button>

                  {/* Download all views with stamp */}
                  <Button
                    variant="outline"
                    className="w-full border-emerald-600 text-emerald-400 hover:bg-emerald-900/30 h-11"
                    onClick={() => selectedRender && handleDownloadAllRenders(selectedRender)}
                    disabled={!selectedRender || selectedViews.length <= 1 || downloadingAll}
                  >
                    {downloadingAll ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Preparing {selectedViews.length} Views...</>
                    ) : (
                      <><Download className="w-4 h-4 mr-2" /> Download All {selectedViews.length} Views</>
                    )}
                  </Button>

                  {/* "Re-Stamp All Views" removed (2026-07-24 audit): it baked the
                      marketing watermark INTO render_urls permanently, poisoning every
                      downstream 2D proof / panel build. Stamped downloads remain via
                      Download with Stamp (export-only, never overwrites the render). */}

                  {/* Show Original Render - admin only, shows prompt, uploads, and all views used to create this render */}
                  {isAdmin && (
                  <Button
                    variant="outline"
                    className="w-full border-cyan-600 text-cyan-400 hover:bg-cyan-900/30 hover:text-cyan-300 h-11"
                    onClick={() => selectedRender && handleShowOriginal(selectedRender)}
                    disabled={!selectedRender || isLoadingOriginal}
                  >
                    {isLoadingOriginal ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading...</>
                    ) : (
                      <><Eye className="w-4 h-4 mr-2" /> Show Original Render</>
                    )}
                  </Button>
                  )}

                  <div className="flex gap-2">
                    <Button
                      className="flex-1 h-11"
                      variant="outline"
                      onClick={() => { void openWithFreshViews(setShow2DProofSheet); }}
                      disabled={selectedViews.length === 0}
                    >
                      <FileText className="w-4 h-4 mr-2" /> 2D Proof
                    </Button>
                    <Button
                      className="flex-1 bg-green-600 hover:bg-green-700 h-11"
                      onClick={() => {
                        void openWithFreshViews(setShowProofSheet);
                        // 3D Proof is the approval-view completeness trigger:
                        // preserve every existing approved view and generate
                        // only the missing canonical angles through the existing
                        // view producer. Never regenerate the complete set.
                        if (missingViews.length > 0 && selectedRender) {
                          void generateMissingViews(selectedRender);
                        }
                      }}
                      disabled={selectedViews.length === 0}
                    >
                      <FileText className="w-4 h-4 mr-2" /> 3D Proof
                    </Button>
                  </div>

                  {/* ORDER THE PRODUCTION PACK, THROUGH THE SERVER'S CHECKOUT.
                      This opened a dialog that detected the vehicle's panel
                      dimensions in the browser and kicked its own pack build.
                      The price and the entitlement are the server's, and the
                      panels are already cut from the accepted master, so the
                      only thing left for a click to do is open the purchase.
                      Disabled until the run is one the gateway owns. */}
                  <Button
                    className="w-full bg-blue-600 hover:bg-blue-700 h-11"
                    onClick={() => { void orderProductionPack(); }}
                    disabled={!selectedRender || orderingPack}
                  >
                    {orderingPack
                      ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Opening checkout…</>
                      : <><Package className="w-4 h-4 mr-2" /> Order Production Pack</>}
                  </Button>

                  {/* Build Files — flatten each side OFF THE APPROVED 2D PROOF
                      (the source with per-side dimensions), full-bleed, all sides
                      in parallel, then land on Production Files. Replaces the old
                      per-view 3D flatten that cut panels off and stalled mid-chain. */}
                  <Button
                    variant="outline"
                    className="w-full h-11 gap-2 border-emerald-500/50 text-emerald-400 hover:bg-emerald-900/20"
                    onClick={async () => {
                      const r = selectedRender as any;
                      if (!r) return;
                      const tId = toast.loading(
                        "Submitting this saved revision to the production server…",
                      );
                      try {
                        const accepted = await submitSavedRevision({
                          render: r,
                          trigger: "revision_saved",
                          change: {
                            type: "edit",
                            viewKeys: Object.keys(r.render_urls || {}).sort(),
                          },
                        });
                        toast.success(
                          `Server workflow accepted (${accepted.idempotent ? "already running" : "new run"}). You can close this page safely.`,
                          { id: tId },
                        );
                      } catch (e: any) {
                        toast.error("Server workflow was not accepted", {
                          id: tId,
                          description: e?.message || String(e),
                        });
                      }
                    }}
                    disabled={!selectedRender}
                    title="Build flat panels from the approved 2D proof (per-side, full-bleed)"
                  >
                    <Download className="w-4 h-4" /> Build Files
                  </Button>

                  {/* ApprovePro bridge — "Save to this proof". Shown only when
                      the shop arrived here from ApprovePro (proof_id in the
                      URL). Pushes the current edited render set back onto that
                      proof as a new version (proof-save-version emails the
                      customer the updated version + flips it to Sent), then
                      returns to ApprovePro. RevisionStudio stays the editor;
                      ApprovePro stays the workbench. */}
                  {APPROVEPRO_UI_LIVE && bridgeProofId && (
                    <Button
                      onClick={async () => {
                        if (!selectedRender) { toast.error("Open or pick a design to edit first."); return; }
                        const renderUrls = (selectedRender.render_urls || {}) as Record<string, string>;
                        if (!renderUrls || Object.keys(renderUrls).length === 0) {
                          toast.error("This design has no render images to save.");
                          return;
                        }
                        // ApprovePro is not a DesignProAI surface, so there is
                        // no proof to save a version onto. This button only
                        // renders behind the APPROVEPRO_UI_LIVE flag, which is
                        // off; it says why rather than appearing to work.
                        toast.error(
                          "ApprovePro is not part of DesignProAI, so there is no proof to save this design onto.",
                        );
                      }}
                      disabled={!selectedRender || savingToProof}
                      className="w-full h-11 gap-2 bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white hover:brightness-110 disabled:opacity-50"
                    >
                      <ClipboardSignatureIcon className="w-4 h-4" />
                      {savingToProof ? "Saving to proof…" : "Save to this proof → back to ApprovePro"}
                    </Button>
                  )}

                  {/* ApprovePro — Send New Proof to Client (Phase 8A) */}
                  {APPROVEPRO_UI_LIVE && (
                    <Button
                      onClick={() => setShowSendForApproval(true)}
                      disabled={!selectedRender}
                      variant="outline"
                      className="w-full h-11 gap-2 border-blue-500/40 hover:border-blue-500 hover:bg-blue-500/5"
                    >
                      <ClipboardSignatureIcon className="w-4 h-4" />
                      Send New Proof to Client
                    </Button>
                  )}

                  {/* PrintPro — WPW-priced quote + order */}
                  <PrintProCTAButton
                    width="full"
                    className="h-11"
                    disabled={!selectedRender}
                    context={{
                      toolSource: "revisionstudio",
                      renderUrl: (selectedRender?.render_urls as Record<string, string> | undefined)?.side
                        ?? (selectedRender as any)?.custom_design_url
                        ?? null,
                      renderUrls: (selectedRender?.render_urls as Record<string, string> | undefined) ?? undefined,
                      vehicleYear: selectedRender?.vehicle_year ? String(selectedRender.vehicle_year) : "",
                      vehicleMake: selectedRender?.vehicle_make || "",
                      vehicleModel: selectedRender?.vehicle_model || "",
                      designName: (selectedRender as any)?.design_file_name || selectedRender?.color_name || "Revision Design",
                      finish: selectedRender?.finish_type || undefined,
                      colorName: selectedRender?.color_name || undefined,
                      colorHex: selectedRender?.color_hex || undefined,
                      designId: selectedRender?.id || null,
                    }}
                  />

                  {/* CUT GRAPHICS = a GraphicsPro concept (plotter-cut solid vinyl
                      lettering/logos). On a DesignPro / RecreatePro PRINTED wrap it is
                      NOT part of the job — surfacing it here just misfired ("no cut
                      graphics detected" on an obviously branded printed wrap). So the
                      cut actions show ONLY for GraphicsPro designs; every other design
                      gets a low-key UPSELL to GraphicsPro instead of the prominent
                      orange/purple cut buttons. */}
                  {((selectedRender?.mode_type || "").toLowerCase().includes("graphic")) ? (
                    <>
                      {/* Generate Cut Contour Logo Pack - route to ProductionFlow CutMap */}
                      <Button
                        className="w-full bg-purple-600 hover:bg-purple-700 h-11"
                        onClick={() => selectedRender && navigate("/productionflow", {
                          state: {
                            action: "run_cut_map",
                            renderData: {
                              render_urls: selectedRender.render_urls || {},
                              vehicle_year: selectedRender.vehicle_year,
                              vehicle_make: selectedRender.vehicle_make,
                              vehicle_model: selectedRender.vehicle_model,
                              design_name: selectedRender.design_file_name || selectedRender.color_name || "Revision Design",
                            },
                          },
                        })}
                        disabled={!selectedRender}
                      >
                        <Scissors className="w-4 h-4 mr-2" /> Generate Cut Contour Logo Pack
                      </Button>

                      {/* Cut Production Sheet — designs FLAT at real cut sizes (W×H +
                          letter height), NOT on the truck. The dimensioned plotter sheet. */}
                      <Button
                        className="w-full bg-orange-600 hover:bg-orange-700 h-11"
                        onClick={handleBuildCutSheet}
                        disabled={!selectedRender || isCutProofGenerating}
                      >
                        {isCutProofGenerating ? (
                          <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Building cut sheet…</>
                        ) : (
                          <><Ruler className="w-4 h-4 mr-2" /> Cut Production Sheet (dims)</>
                        )}
                      </Button>
                    </>
                  ) : null /* non-GraphicsPro: cut-graphics upsell lives UNDER the
                     Production Layers panels instead (see the Cut Graphics Pack
                     enticement card) */}


                  {/* Push View to source tool - routes by mode_type, opens QuickQuote on left */}
                  <Button
                    className="w-full bg-cyan-600 hover:bg-cyan-700 h-11"
                    onClick={async () => {
                      if (!selectedRender) return;
                      const renderUrls = (selectedRender.render_urls || {}) as Record<string, string>;
                      const heroUrl = renderUrls.side || renderUrls.hero || Object.values(renderUrls)[0] || "";
                      const mt = (selectedRender.mode_type || "").toLowerCase();

                      // Non-DesignPro renders: use URL-based hydration (?renderId=X&quickQuote=1)
                      // — same proven path as the inline "Open in [Tool]" card button.
                      if (mt.includes("graphic")) {
                        window.location.href = `/graphicspro?renderId=${selectedRender.id}&quickQuote=1`;
                        return;
                      }
                      if (mt === "wallpro" || mt.includes("wall")) {
                        window.location.href = `/printpro/wallpro?renderId=${selectedRender.id}&quickQuote=1`;
                        return;
                      }
                      if (mt.includes("colorpro") || mt === "inkfusion" || mt === "colorproenhanced" || mt === "customstyling") {
                        window.location.href = `/colorpro?renderId=${selectedRender.id}&quickQuote=1`;
                        return;
                      }
                      if (mt.includes("fadewrap")) {
                        window.location.href = `/fadewraps?renderId=${selectedRender.id}&quickQuote=1`;
                        return;
                      }
                      if (mt.includes("wbty") || mt.includes("pattern")) {
                        window.location.href = `/wbty?renderId=${selectedRender.id}&quickQuote=1`;
                        return;
                      }
                      if (mt.includes("approve")) {
                        window.location.href = `/approvemode?renderId=${selectedRender.id}&quickQuote=1`;
                        return;
                      }

                      // --- DesignPro / DesignPanelPro path ---
                      // The brief and any references come off the design's own
                      // projection. The three background lookups that used to
                      // follow -- by generation id, by panel URL, by hero render
                      // URL, each writing its result back as a cache -- existed
                      // because two stores had no shared key. One store now, so
                      // what is here is what there is.
                      let originalPrompt = "";
                      let visionBoardUrls: string[] = [];
                      try {
                        const notes = JSON.parse(selectedRender.admin_notes || "{}");
                        originalPrompt = notes.original_prompt || selectedRender.custom_styling_prompt_key || "";
                        if (Array.isArray(notes.visionboard_image_urls)) {
                          visionBoardUrls = notes.visionboard_image_urls;
                        }
                      } catch {
                        originalPrompt = selectedRender.custom_styling_prompt_key || "";
                      }

                      navigate(`/designpro?quickQuote=1`, {
                        state: {
                          previewRender: {
                            heroUrl,
                            renderUrls,
                            vehicleYear: selectedRender.vehicle_year || "",
                            vehicleMake: selectedRender.vehicle_make || "",
                            vehicleModel: selectedRender.vehicle_model || "",
                            designName: selectedRender.design_file_name || selectedRender.color_name || "",
                            finishType: selectedRender.finish_type || "Gloss",
                            modeType: selectedRender.mode_type || "designpanelpro",
                            visualizationId: selectedRender.id,
                            originalPrompt,
                            visionBoardUrls,
                          },
                        },
                      });
                    }}
                    disabled={!selectedRender}
                  >
                    <Eye className="w-4 h-4 mr-2" />
                    {(() => {
                      const mt = (selectedRender?.mode_type || "").toLowerCase();
                      if (mt.includes("graphic")) return "Push View to GraphicsPro";
                      if (mt === "wallpro" || mt.includes("wall")) return "Push View to WallPro";
                      if (mt.includes("colorpro") || mt === "inkfusion" || mt === "colorproenhanced" || mt === "customstyling") return "Push View to ColorPro";
                      if (mt.includes("fadewrap")) return "Push View to FadeWraps";
                      if (mt.includes("wbty") || mt.includes("pattern")) return "Push View to PatternPro";
                      if (mt.includes("approve")) return "Push View to ApprovePro";
                      return "Push View to DesignPro";
                    })()}
                  </Button>

                  {/* Delete Render */}
                  <Button
                    variant="outline"
                    className="w-full border-red-800 text-red-400 hover:bg-red-900/30 hover:text-red-300 h-11"
                    onClick={async () => {
                      if (selectedRender && await confirmDialog({ title: "Delete this render permanently?", description: "This cannot be undone.", confirmText: "Delete", destructive: true })) {
                        deleteRender.mutate({ id: selectedRender.id, source: selectedRender.__source });
                      }
                    }}
                    disabled={deleteRender.isPending}
                  >
                    {deleteRender.isPending ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Deleting...</>
                    ) : (
                      <><Trash2 className="w-4 h-4 mr-2" /> Delete Render</>
                    )}
                  </Button>
                </div>

                {/* Original Prompt + render date/time — moved to the bottom */}
                {/* Always rendered. A job with no recorded prompt says so — it no
                    longer silently drops the whole card, which read as "this job
                    has no prompt panel" instead of "the prompt wasn't saved." */}
                <Card className="bg-zinc-900 border-blue-500/30">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <FileText className="w-4 h-4 text-blue-400" />
                      <span className="text-sm font-bold text-blue-300">Original Prompt</span>
                    </div>
                    {resolvedPrompt ? (
                      <p className="text-sm text-zinc-100 leading-relaxed max-h-40 overflow-y-auto whitespace-pre-wrap">{resolvedPrompt}</p>
                    ) : (
                      <p className="text-sm text-zinc-500 italic leading-relaxed">
                        No prompt was recorded for this job. Renders created outside DesignPro,
                        or before prompt capture, may not have one stored.
                      </p>
                    )}
                  </CardContent>
                </Card>

                <Card className="bg-zinc-900 border-zinc-800">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center gap-2 text-xs text-zinc-500">
                      <Calendar className="w-3 h-3" />
                      <span>
                        Created {selectedRender.created_at ? format(new Date(selectedRender.created_at), "MMM d, yyyy 'at' h:mm a") : ""}
                      </span>
                    </div>

                    {selectedRender.color_hex && (
                      <div className="flex items-center gap-2">
                        <div
                          className="w-5 h-5 rounded border border-zinc-600"
                          style={{ backgroundColor: selectedRender.color_hex }}
                        />
                        <span className="text-xs text-zinc-400">{selectedRender.color_name}</span>
                      </div>
                    )}

                    {/* Rendered by - admin only */}
                    {isAdmin && selectedRender.customer_email && (
                      <div className="flex items-center gap-2 text-xs text-zinc-500">
                        <User className="w-3 h-3" />
                        <span>Rendered by: <span className="text-zinc-300">{selectedRender.customer_email}</span></span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ================================================================== */}
      {/* CLONE & REVISE DIALOG                                              */}
      {/* ================================================================== */}
      {/* Cut Production Sheet — dimensioned flat cut sizes (designs off the truck) */}
      <Dialog open={cutProofOpen} onOpenChange={setCutProofOpen}>
        <DialogContent className="max-w-[95vw] md:max-w-4xl max-h-[92vh] overflow-y-auto p-0">
          <CutGraphicsProofSheet
            proof={cutProof}
            isGenerating={isCutProofGenerating}
            onRegenerate={handleBuildCutSheet}
            totalSqFt={cutProofSqFt}
          />
        </DialogContent>
      </Dialog>

      {/* 16:9 Landscape Proof Sheet Dialog */}
      <Dialog open={showProofSheet} onOpenChange={setShowProofSheet}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] overflow-y-auto p-0">
          {selectedRender && (
            isMobile ? (
              <MobileProofSheet
                views={(() => {
                  const viewLabelsMap: Record<string, string> = { side: 'Driver Side', 'passenger-side': 'Passenger Side', hood_detail: 'Hood', front: 'Front', rear: 'Rear', 'close-up': 'Close-Up', roof: 'Roof' };
                  const order = ['side', 'passenger-side', 'hood_detail', 'front', 'rear', 'close-up', 'roof'];
                  const urls = selectedRender.render_urls as Record<string, string> | null;
                  if (!urls) return [];
                  return order
                    .filter(t => urls[t])
                    .map(t => ({ type: t, url: urls[t], label: viewLabelsMap[t] || t }));
                })()}
                vehicleYear={String(selectedRender.vehicle_year || '')}
                vehicleMake={selectedRender.vehicle_make || ''}
                vehicleModel={selectedRender.vehicle_model || ''}
                toolKey={((): ToolKey => {
                  const modeToToolKey: Record<string, ToolKey> = {
                    colorpro: 'colorpro', ColorPro: 'colorpro', inkfusion: 'colorpro',
                    ColorProEnhanced: 'colorpro', CustomStyling: 'colorpro',
                    GraphicsPro: 'graphicspro', designpanelpro: 'designpanelpro',
                    // RecreatePro / DesignPro reproduce a finished wrap through the
                    // DesignPro pipeline, so the proof brands as DesignProAI™ — not
                    // ColorPro (the default that mislabeled the Punisher Urus proof).
                    recreatepro: 'designpanelpro', designpro: 'designpanelpro',
                    fadewraps: 'fadewraps', approvemode: 'approvepro', wbty: 'wbty',
                  };
                  return modeToToolKey[selectedRender.mode_type] || 'colorpro';
                })()}
                colorName={selectedRender.color_name || undefined}
                finish={selectedRender.finish_type || undefined}
                manufacturer={(() => {
                  try {
                    const notes = JSON.parse(selectedRender.admin_notes || '{}');
                    return notes.manufacturer || '';
                  } catch { return ''; }
                })()}
                designName={selectedRender.design_file_name || selectedRender.color_name || undefined}
              />
            ) : (
              <ProfessionalProofSheet
                views={(() => {
                  const viewLabelsMap: Record<string, string> = { side: 'Driver Side', 'passenger-side': 'Passenger Side', hood_detail: 'Hood', front: 'Front', rear: 'Rear', 'close-up': 'Close-Up', roof: 'Roof' };
                  const order = ['side', 'passenger-side', 'hood_detail', 'front', 'rear', 'close-up', 'roof'];
                  const urls = selectedRender.render_urls as Record<string, string> | null;
                  if (!urls) return [];
                  return order
                    .filter(t => urls[t])
                    .map(t => ({ type: t, url: urls[t], label: viewLabelsMap[t] || t }));
                })()}
                vehicleYear={String(selectedRender.vehicle_year || '')}
                vehicleMake={selectedRender.vehicle_make || ''}
                vehicleModel={selectedRender.vehicle_model || ''}
                toolKey={((): ToolKey => {
                  const modeToToolKey: Record<string, ToolKey> = {
                    colorpro: 'colorpro', ColorPro: 'colorpro', inkfusion: 'colorpro',
                    ColorProEnhanced: 'colorpro', CustomStyling: 'colorpro',
                    GraphicsPro: 'graphicspro', designpanelpro: 'designpanelpro',
                    // RecreatePro / DesignPro reproduce a finished wrap through the
                    // DesignPro pipeline, so the proof brands as DesignProAI™ — not
                    // ColorPro (the default that mislabeled the Punisher Urus proof).
                    recreatepro: 'designpanelpro', designpro: 'designpanelpro',
                    fadewraps: 'fadewraps', approvemode: 'approvepro', wbty: 'wbty',
                  };
                  return modeToToolKey[selectedRender.mode_type] || 'colorpro';
                })()}
                designName={selectedRender.design_file_name || selectedRender.color_name || undefined}
                finish={selectedRender.finish_type || undefined}
              />
            )
          )}
        </DialogContent>
      </Dialog>

      {/* 2D Proof Sheet Dialog — shows stored flat_proof_url instantly if available */}
      <Dialog open={show2DProofSheet} onOpenChange={setShow2DProofSheet}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] overflow-auto p-0">
          {selectedRender && (
            <StoredOrGenerated2DProof
              render={selectedRender}
              renderFallback={({ initialProofUrl, onProofGenerated, workflowStatus, workflowFailedStage, hasActiveRun, onRetryBuild }) => (
                <TwoDProofSheet
                  views={(() => {
                    const viewLabelsMap: Record<string, string> = { side: 'Driver Side', 'passenger-side': 'Passenger Side', hood_detail: 'Hood', front: 'Front', rear: 'Rear', roof: 'Roof' };
                    // Include hood_detail — omitting it made the AI proof invent the
                    // hood from the side view (RJ's "old hood" bug). The latest
                    // render_urls carry the corrected hood.
                    const order = ['side', 'passenger-side', 'hood_detail', 'front', 'rear', 'roof'];
                    const urls = selectedRender.render_urls as Record<string, string> | null;
                    if (!urls) return [];
                    return order
                      .filter(t => urls[t])
                      .map(t => ({ type: t, url: urls[t], label: viewLabelsMap[t] || t }));
                  })()}
                  generationId={selectedRender.id}
                  vehicleYear={String(selectedRender.vehicle_year || '')}
                  vehicleMake={selectedRender.vehicle_make || ''}
                  vehicleModel={selectedRender.vehicle_model || ''}
                  toolKey={((): ToolKey => {
                    const modeToToolKey: Record<string, ToolKey> = {
                      colorpro: 'colorpro', ColorPro: 'colorpro', inkfusion: 'colorpro',
                      ColorProEnhanced: 'colorpro', CustomStyling: 'colorpro',
                      GraphicsPro: 'graphicspro', designpanelpro: 'designpanelpro',
                      fadewraps: 'fadewraps', approvemode: 'approvepro', wbty: 'wbty',
                    };
                    return modeToToolKey[selectedRender.mode_type] || 'colorpro';
                  })()}
                  designName={selectedRender.design_file_name || selectedRender.color_name || undefined}
                  finish={selectedRender.finish_type || undefined}
                  initialProofUrl={initialProofUrl}
                  onProofGenerated={onProofGenerated}
                  serverOrchestrated
                  workflowStatus={workflowStatus}
                  workflowFailedStage={workflowFailedStage}
                  hasActiveRun={hasActiveRun}
                  onRetryBuild={onRetryBuild}
                />
              )}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showReviseDialog} onOpenChange={setShowReviseDialog}>
        <DialogContent className="bg-zinc-900 border-zinc-700 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-amber-400" />
              Restyle on New Vehicle
              <Badge className="ml-2 bg-amber-600/20 text-amber-400 border-0 text-[10px] px-1.5 py-0">Paid &mdash; $X per restyle</Badge>
            </DialogTitle>
          </DialogHeader>

          {selectedRender && (
            <div className="space-y-4">
              <div className="p-3 bg-zinc-800 rounded-lg text-sm">
                <p className="text-zinc-400 mb-1">Restyling from:</p>
                <p className="font-semibold">
                  {formatVehicleInfo(selectedRender)}
                </p>
                <p className="text-zinc-400">
                  {formatDesignName(selectedRender)} ({getVersionLabel(selectedRender)})
                </p>
              </div>

              {/* Original Prompt Display (read-only, prominent) */}
              {(() => {
                let origPrompt = "";
                try {
                  const notes = JSON.parse(selectedRender.admin_notes || "{}");
                  origPrompt = notes.original_prompt || "";
                } catch {}
                if (!origPrompt) origPrompt = selectedRender.custom_styling_prompt_key || "";
                return origPrompt ? (
                  <div className="p-3 bg-zinc-800/50 rounded-lg border border-blue-500/30">
                    <p className="text-[10px] text-blue-400 uppercase font-bold mb-1">Original Prompt (will be applied to new vehicle)</p>
                    <p className="text-sm text-zinc-100 leading-relaxed max-h-28 overflow-y-auto">{origPrompt}</p>
                  </div>
                ) : null;
              })()}

              {/* New Vehicle - required */}
              <div className="p-3 bg-zinc-800/50 rounded-lg border border-zinc-700">
                <p className="text-xs text-zinc-300 font-semibold mb-2">New Vehicle (required)</p>
                <div className="grid grid-cols-3 gap-2">
                  <Input
                    placeholder="Year"
                    value={overrideYear}
                    onChange={(e) => setOverrideYear(e.target.value)}
                    className="bg-zinc-800 border-zinc-700 text-xs h-8"
                  />
                  <Input
                    placeholder="Make"
                    value={overrideMake}
                    onChange={(e) => setOverrideMake(e.target.value)}
                    className="bg-zinc-800 border-zinc-700 text-xs h-8"
                  />
                  <Input
                    placeholder="Model"
                    value={overrideModel}
                    onChange={(e) => setOverrideModel(e.target.value)}
                    className="bg-zinc-800 border-zinc-700 text-xs h-8"
                  />
                </div>
                <p className="text-[10px] text-zinc-500 mt-1">Enter the vehicle you want to restyle this design onto</p>
              </div>
            </div>
          )}

          {cloneAndRevise.isPending && (
            <GenerationWizard
              isGenerating={cloneAndRevise.isPending}
              tips={REVISION_TIPS}
              currentTipIndex={0}
              toolName="Restyle"
              gradientFrom="from-amber-500"
              gradientTo="to-orange-500"
              expectedDuration={15}
            />
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowReviseDialog(false)}>Cancel</Button>
            <Button
              className="bg-gradient-blue-magenta hover:brightness-110 text-white"
              onClick={() => {
                if (selectedRender && overrideYear.trim() && overrideMake.trim() && overrideModel.trim()) {
                  const vehicleOverride = {
                    year: overrideYear.trim(),
                    make: overrideMake.trim(),
                    model: overrideModel.trim(),
                  };
                  cloneAndRevise.mutate({
                    sourceRender: selectedRender,
                    notes: "",
                    vehicleOverride,
                    currentViewKey: selectedViews[currentViewIndex]?.key,
                  });
                } else {
                  toast.info("Please enter Year, Make, and Model for the new vehicle");
                }
              }}
              disabled={cloneAndRevise.isPending || !overrideYear.trim() || !overrideMake.trim() || !overrideModel.trim()}
            >
              {cloneAndRevise.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Restyling...</>
              ) : (
                <><Sparkles className="w-4 h-4 mr-2" /> Restyle</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================================================================== */}
      {/* ADMIN: BATCH PROMPT LIBRARY DIALOG                                 */}
      {/* ================================================================== */}
      <Dialog open={showBatchDialog} onOpenChange={setShowBatchDialog}>
        <DialogContent className="bg-zinc-900 border-zinc-700 text-white max-w-4xl max-h-[85vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-purple-400" />
              Batch Prompt Library
              <Badge className="bg-purple-600/20 text-purple-400 border border-purple-500/30 text-[10px] ml-2">
                <Shield className="w-3 h-3 mr-1" /> ADMIN
              </Badge>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Category Tabs */}
            <Tabs
              value={batchPromptCategory}
              onValueChange={(v) => {
                setBatchPromptCategory(v as "commercial" | "restyle");
                setBatchSubcategory("all");
              }}
            >
              <TabsList className="bg-zinc-800">
                <TabsTrigger value="commercial" className="data-[state=active]:bg-gradient-blue-magenta">
                  Commercial ({getPresetsByCategory("commercial").length})
                </TabsTrigger>
                <TabsTrigger value="restyle" className="data-[state=active]:bg-gradient-blue-magenta">
                  ReStyle ({getPresetsByCategory("restyle").length})
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {/* Filters */}
            <div className="flex gap-3">
              <Select value={batchSubcategory} onValueChange={setBatchSubcategory}>
                <SelectTrigger className="w-48 bg-zinc-800 border-zinc-700">
                  <SelectValue placeholder="Subcategory" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Subcategories</SelectItem>
                  {subcategories.map((sub) => (
                    <SelectItem key={sub} value={sub}>{sub}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <Input
                  placeholder="Search prompts..."
                  value={batchSearch}
                  onChange={(e) => setBatchSearch(e.target.value)}
                  className="pl-10 bg-zinc-800 border-zinc-700"
                />
              </div>

              <Badge variant="outline" className="self-center border-zinc-600 text-zinc-400">
                {filteredPresets.length} prompts
              </Badge>
            </div>

            {/* Prompt List */}
            <ScrollArea className="h-[400px]">
              <div className="space-y-2 pr-4">
                {filteredPresets.map((preset) => (
                  <div
                    key={preset.id}
                    className={cn(
                      "p-3 rounded-lg border cursor-pointer transition-all",
                      selectedPreset?.id === preset.id
                        ? "border-blue-magenta bg-blue-magenta-subtle"
                        : "border-zinc-800 bg-zinc-800/50 hover:border-zinc-600"
                    )}
                    onClick={() => setSelectedPreset(preset)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="border-zinc-600 text-[9px]">
                            {preset.subcategory}
                          </Badge>
                          {preset.tags.slice(0, 3).map((tag) => (
                            <span key={tag} className="text-[9px] text-zinc-500">#{tag}</span>
                          ))}
                        </div>
                        <p className="text-xs text-zinc-300 leading-relaxed">
                          {preset.prompt}
                        </p>
                      </div>

                      {selectedPreset?.id === preset.id && (
                        <Badge className="bg-gradient-blue-magenta text-[9px] flex-shrink-0">Selected</Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>

            {/* Selected prompt action */}
            {selectedPreset && (
              <div className="p-3 bg-blue-magenta-subtle border border-blue-magenta rounded-lg">
                <p className="text-xs text-blue-magenta font-bold mb-1">Selected Prompt:</p>
                <p className="text-xs text-zinc-300">{selectedPreset.prompt}</p>
                <div className="flex gap-2 mt-3">
                  <Button
                    size="sm"
                    className="bg-gradient-blue-magenta hover:brightness-110 text-white"
                    onClick={() => {
                      navigator.clipboard.writeText(selectedPreset.prompt);
                      toast.success("Prompt copied to clipboard");
                    }}
                  >
                    <Copy className="w-3 h-3 mr-1" /> Copy Prompt
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-blue-magenta text-blue-magenta"
                    onClick={() => {
                      setShowBatchDialog(false);
                      toast.success("Use this prompt in your next render");
                    }}
                  >
                    <ArrowRight className="w-3 h-3 mr-1" /> Use in Render
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ================================================================== */}
      {/* SHOW ORIGINAL RENDER DIALOG                                       */}
      {/* ================================================================== */}
      <Dialog open={showOriginalDialog} onOpenChange={(open) => { setShowOriginalDialog(open); if (!open) setOriginalDialogData(null); }}>
        <DialogContent className="bg-zinc-900 border-zinc-700 text-white max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="w-5 h-5 text-cyan-400" />
              Original Render Breakdown
              {selectedRender && (
                <Badge variant="outline" className="ml-2 border-zinc-600 text-zinc-400 text-[10px]">
                  {MODE_LABELS[selectedRender.mode_type] || selectedRender.mode_type}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          {isLoadingOriginal ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
              <p className="text-sm text-zinc-400">Loading original render data...</p>
            </div>
          ) : selectedRender && originalDialogData ? (
            <div className="space-y-6">
              {/* Vehicle Info Header */}
              <div className="p-4 bg-zinc-800 rounded-xl border border-zinc-700">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-bold text-lg">{formatVehicleInfo(selectedRender)}</p>
                    <p className="text-sm text-zinc-400">
                      {formatDesignName(selectedRender)} &bull; {selectedRender.finish_type}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={`${parseVersionInfo(selectedRender).version > 1 ? "bg-purple-600" : "bg-zinc-700"}`}>
                      {getVersionLabel(selectedRender)}
                    </Badge>
                    {selectedRender.created_at && (
                      <span className="text-[10px] text-zinc-500">
                        {format(new Date(selectedRender.created_at), "MMM d, yyyy 'at' h:mm a")}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Original Prompt */}
              {originalDialogData.prompt && (
                <div className="p-4 bg-zinc-800/50 rounded-xl border border-cyan-500/30">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-cyan-400 uppercase font-bold tracking-wider">Original Creative Prompt</p>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-zinc-400 hover:text-white"
                      onClick={() => {
                        navigator.clipboard.writeText(originalDialogData.prompt);
                        toast.success("Prompt copied to clipboard");
                      }}
                    >
                      <Copy className="w-3 h-3 mr-1" /> Copy
                    </Button>
                  </div>
                  <p className="text-sm text-zinc-100 leading-relaxed whitespace-pre-wrap">{originalDialogData.prompt}</p>
                  {originalDialogData.mode === "commercial" && Object.keys(originalDialogData.commercialDetails).length > 0 && (
                    <div className="mt-3 pt-3 border-t border-zinc-700 grid grid-cols-2 gap-2">
                      {originalDialogData.commercialDetails.companyName && (
                        <div>
                          <span className="text-[10px] text-zinc-500 uppercase">Company</span>
                          <p className="text-xs text-zinc-300">{String(originalDialogData.commercialDetails.companyName)}</p>
                        </div>
                      )}
                      {originalDialogData.commercialDetails.industryType && (
                        <div>
                          <span className="text-[10px] text-zinc-500 uppercase">Industry</span>
                          <p className="text-xs text-zinc-300">{String(originalDialogData.commercialDetails.industryType)}</p>
                        </div>
                      )}
                      {originalDialogData.commercialDetails.mascot && (
                        <div>
                          <span className="text-[10px] text-zinc-500 uppercase">Mascot</span>
                          <p className="text-xs text-zinc-300">{String(originalDialogData.commercialDetails.mascot)}</p>
                        </div>
                      )}
                      {originalDialogData.commercialDetails.phone && (
                        <div>
                          <span className="text-[10px] text-zinc-500 uppercase">Phone</span>
                          <p className="text-xs text-zinc-300">{String(originalDialogData.commercialDetails.phone)}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Uploaded Assets - Design Panel + VisionBoard + Swatch */}
              {(originalDialogData.designPanelUrl || originalDialogData.visionboardUrls.length > 0 || originalDialogData.swatchUrl) && (
                <div>
                  <p className="text-xs text-zinc-500 uppercase font-bold tracking-wider mb-3">Uploaded Assets Used</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {originalDialogData.designPanelUrl && (
                      <div className="space-y-1.5">
                        <div
                          className="relative aspect-video rounded-lg overflow-hidden border border-zinc-700 cursor-pointer hover:border-cyan-500 transition-colors"
                          onClick={() => setExpandedImage({ url: originalDialogData.designPanelUrl!, title: "Design Panel Reference" })}
                        >
                          <img src={originalDialogData.designPanelUrl} alt="Design Panel" className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                          <Badge className="absolute bottom-1.5 left-1.5 bg-cyan-600/80 text-[9px]">Design Panel</Badge>
                        </div>
                      </div>
                    )}
                    {originalDialogData.swatchUrl && (
                      <div className="space-y-1.5">
                        <div
                          className="relative aspect-video rounded-lg overflow-hidden border border-zinc-700 cursor-pointer hover:border-cyan-500 transition-colors"
                          onClick={() => setExpandedImage({ url: originalDialogData.swatchUrl!, title: "Fade/Swatch Pattern" })}
                        >
                          <img src={originalDialogData.swatchUrl} alt="Swatch" className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                          <Badge className="absolute bottom-1.5 left-1.5 bg-purple-600/80 text-[9px]">Fade Swatch</Badge>
                        </div>
                      </div>
                    )}
                    {originalDialogData.visionboardUrls.map((url, i) => (
                      <div key={url} className="space-y-1.5">
                        <div
                          className="relative aspect-video rounded-lg overflow-hidden border border-zinc-700 cursor-pointer hover:border-cyan-500 transition-colors"
                          onClick={() => setExpandedImage({ url, title: `VisionBoard Reference ${i + 1}` })}
                        >
                          <img src={url} alt={`VisionBoard ${i + 1}`} className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                          <Badge className="absolute bottom-1.5 left-1.5 bg-blue-600/80 text-[9px]">VisionBoard {i + 1}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* All Render Views */}
              <div>
                <p className="text-xs text-zinc-500 uppercase font-bold tracking-wider mb-3">
                  All Rendered Views ({selectedViews.length} of {VIEW_ORDER.length})
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {selectedViews.map((v) => (
                    <div key={v.key} className="space-y-1.5">
                      <div
                        className="relative aspect-video rounded-lg overflow-hidden border border-zinc-700 cursor-pointer hover:border-cyan-500 transition-colors"
                        onClick={() => setExpandedImage({ url: v.url, title: `${formatVehicleInfo(selectedRender)} - ${VIEW_LABELS[v.key]}` })}
                      >
                        <img src={v.url} alt={VIEW_LABELS[v.key]} className="w-full h-full object-cover" loading="lazy" />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                        <span className="absolute bottom-1.5 left-1.5 text-[10px] font-bold text-white drop-shadow-md">
                          {VIEW_LABELS[v.key]}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Prompt History (if revisions exist) */}
              {originalDialogData.promptHistory.length > 1 && (
                <div>
                  <p className="text-xs text-zinc-500 uppercase font-bold tracking-wider mb-3">Revision History</p>
                  <div className="space-y-2">
                    {originalDialogData.promptHistory.map((entry, i) => (
                      <div key={i} className="p-3 bg-zinc-800/50 rounded-lg border border-zinc-700">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge className={i === 0 ? "bg-zinc-700 text-[9px]" : "bg-purple-600 text-[9px]"}>
                            V{entry.version}
                          </Badge>
                          <span className="text-[10px] text-zinc-500 uppercase">{entry.type}</span>
                          {entry.timestamp && (
                            <span className="text-[10px] text-zinc-600">
                              {format(new Date(entry.timestamp), "MMM d, yyyy h:mm a")}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-zinc-300 leading-relaxed">{entry.prompt}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Render Specs */}
              <div className="p-3 bg-zinc-800/30 rounded-lg border border-zinc-700/50">
                <p className="text-[10px] text-zinc-500 uppercase font-bold mb-2">Render Specs</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div>
                    <span className="text-zinc-500">Color</span>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {selectedRender.color_hex && (
                        <div className="w-3 h-3 rounded-full border border-zinc-600" style={{ backgroundColor: selectedRender.color_hex }} />
                      )}
                      <span className="text-zinc-300">{selectedRender.color_name || "N/A"}</span>
                    </div>
                  </div>
                  <div>
                    <span className="text-zinc-500">Finish</span>
                    <p className="text-zinc-300 mt-0.5">{selectedRender.finish_type || "N/A"}</p>
                  </div>
                  <div>
                    <span className="text-zinc-500">Tool</span>
                    <p className="text-zinc-300 mt-0.5">{MODE_LABELS[selectedRender.mode_type] || selectedRender.mode_type}</p>
                  </div>
                  <div>
                    <span className="text-zinc-500">Views</span>
                    <p className="text-zinc-300 mt-0.5">{selectedViews.length} / {VIEW_ORDER.length}</p>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Precision Editor — full-screen so the box is drawn on the large
          render (not the tiny right-rail thumbnail). Heal + lift route the
          removed element into the LayerStrip via handleLayerExtracted. */}
      <PreciseEditDialog
        open={precisionModalOpen && !isViewingImmutableVersion}
        onOpenChange={setPrecisionModalOpen}
        defaultMode={precisionInitialMode}
        imageUrl={selectedViews[currentViewIndex]?.url || null}
        viewLabel={selectedViews[currentViewIndex] ? VIEW_LABELS[selectedViews[currentViewIndex].key] : undefined}
        userId={currentUserId}
        finish={selectedRender?.finish_type}
        colorName={selectedRender?.color_name}
        vehicleMake={selectedRender?.vehicle_make}
        vehicleModel={selectedRender?.vehicle_model}
        onElementLifted={(layer, bg) => {
          const vk = selectedViews[currentViewIndex]?.key;
          if (vk) handleLayerExtracted(vk, layer, bg);
        }}
        onSave={async (newRenderUrl) => {
          if (!selectedRender || !selectedViews[currentViewIndex]) return;
          const viewKey = selectedViews[currentViewIndex].key;
          try {
            await savePreciseEditRevision(
              selectedRender,
              viewKey,
              newRenderUrl,
            );
          } catch (error: any) {
            toast.error(`Could not save: ${error?.message || error}`);
            return;
          }
        }}
      />

      {/* LayerLift — single-gesture drag-box lift + Gemini heal. Same tool as
          the QC artboard. The lifted layer + healed background land in the same
          place Separate Elements puts them (handleLayerExtracted →
          logoLayersByView + cleanBackgroundsByView), keyed to the current view. */}
      <LayerLift
        open={layerLiftOpen && !isViewingImmutableVersion}
        onOpenChange={setLayerLiftOpen}
        imageUrl={(() => {
          const k = selectedViews[currentViewIndex]?.key;
          if (!k) return null;
          return cleanBackgroundsByView[k] || selectedViews[currentViewIndex]?.url || null;
        })()}
        viewLabel={`${selectedRender?.vehicle_year ?? ""} ${selectedRender?.vehicle_make ?? ""} ${selectedRender?.vehicle_model ?? ""}`.trim() || "Render"}
        userId={currentUserId}
        finish={selectedRender?.finish_type}
        colorName={selectedRender?.color_name}
        vehicleYear={selectedRender?.vehicle_year}
        vehicleMake={selectedRender?.vehicle_make}
        vehicleModel={selectedRender?.vehicle_model}
        productionMethod={productionMethod}
        onProductionMethodChange={setProductionMethod}
        onLifted={(layer, healedBackgroundUrl) => {
          const vk = selectedViews[currentViewIndex]?.key;
          if (vk) handleLayerExtracted(vk, layer, healedBackgroundUrl);
        }}
      />

      {/* Side Panel Boxes — draw a glass box per side; crop the exact shape and
          have flat-panel-openai fill it into a flat panel at the side's real
          size (wheels/tires excluded). */}
      <SidePanelBoxes
        open={sideBoxesOpen && !isViewingImmutableVersion}
        onOpenChange={setSideBoxesOpen}
        imageUrl={selectedViews[currentViewIndex]?.url || null}
        userId={currentUserId}
        finish={selectedRender?.finish_type}
      />

      {/* Zoom Image Modal - matches DesignPro zoom behavior */}
      <MobileZoomImageModal
        imageUrl={expandedImage?.url || ''}
        title={expandedImage?.title}
        isOpen={!!expandedImage}
        onClose={() => setExpandedImage(null)}
        showNavigation={selectedViews.length > 1 && expandedImage?.title !== "Uploaded Reference" && expandedImage?.title !== "Custom Design"}
        onPrev={() => {
          const newIdx = Math.max(0, currentViewIndex - 1);
          setCurrentViewIndex(newIdx);
          if (selectedViews[newIdx]) {
            setExpandedImage({ url: selectedViews[newIdx].url, title: `${selectedRender ? formatVehicleInfo(selectedRender) : ""} - ${VIEW_LABELS[selectedViews[newIdx].key]}` });
          }
        }}
        onNext={() => {
          const newIdx = Math.min(selectedViews.length - 1, currentViewIndex + 1);
          setCurrentViewIndex(newIdx);
          if (selectedViews[newIdx]) {
            setExpandedImage({ url: selectedViews[newIdx].url, title: `${selectedRender ? formatVehicleInfo(selectedRender) : ""} - ${VIEW_LABELS[selectedViews[newIdx].key]}` });
          }
        }}
        currentIndex={currentViewIndex}
        totalCount={selectedViews.length}
      />

      {/* ── Studio Display Modal (like CreatorMarket detail viewer) ── */}
      {studioDisplayRender && (() => {
        const viewOrder = ["side", "passenger-side", "hood_detail", "front", "rear", "close-up", "roof"];
        const viewLabelsSD: Record<string, string> = { side: "Driver Side", "passenger-side": "Passenger Side", hood_detail: "Hood Detail", front: "Front 3/4", rear: "Rear 3/4", "close-up": "Close-Up", roof: "Roof" };
        const sdUrls = studioDisplayRender.render_urls || {};
        const sdViews = viewOrder.filter((v) => sdUrls[v]).map((v) => ({ type: v, url: sdUrls[v], label: viewLabelsSD[v] || v }));
        const heroUrl = sdUrls.side || sdUrls["driver-side"] || sdUrls.hero || (sdViews[0]?.url);
        const vehicleInfo = formatVehicleInfo(studioDisplayRender);
        const designLabel = studioDisplayRender.design_file_name || studioDisplayRender.color_name || "Design";

        return (
          <div className="fixed inset-0 z-[90] bg-black/95 overflow-y-auto" onClick={() => setStudioDisplayRender(null)}>
            <div className="max-w-5xl mx-auto p-4 sm:p-8" onClick={(e) => e.stopPropagation()}>
              {/* Close button */}
              <button className="fixed top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 z-10" onClick={() => setStudioDisplayRender(null)}>
                <X className="h-6 w-6 text-white" />
              </button>

              {/* Hero Image */}
              <div className="relative aspect-video bg-zinc-900 rounded-xl overflow-hidden mb-6 cursor-pointer" onClick={() => { setStudioDisplayFullscreenIdx(0); }}>
                {heroUrl ? (
                  <img src={heroUrl} alt={vehicleInfo} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <ImageOff className="h-16 w-16 text-zinc-700" />
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                <div className="absolute bottom-4 left-4">
                  <p className="text-2xl font-bold text-white capitalize">{vehicleInfo}</p>
                  <p className="text-sm text-zinc-300">{designLabel}</p>
                  {studioDisplayRender.finish_type && (
                    <p className="text-xs text-zinc-400 mt-0.5">{studioDisplayRender.finish_type}</p>
                  )}
                </div>
                {studioDisplayRender.is_featured_hero && (
                  <div className="absolute top-4 left-4 flex items-center gap-1.5 bg-amber-500/90 px-2.5 py-1 rounded-full">
                    <Star className="h-3 w-3 text-white fill-white" />
                    <span className="text-[10px] text-white font-bold">STARRED</span>
                  </div>
                )}
              </div>

              {/* 7-View Grid */}
              {sdViews.length > 1 && (
                <div className="mb-6">
                  <h3 className="text-sm font-semibold text-foreground mb-3">All Views ({sdViews.length})</h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                    {sdViews.map((view, idx) => (
                      <div
                        key={view.type}
                        className="relative aspect-video bg-zinc-800 rounded-lg overflow-hidden cursor-pointer group hover:ring-2 hover:ring-violet-500/50 transition-all"
                        onClick={() => setStudioDisplayFullscreenIdx(idx)}
                      >
                        <img src={view.url} alt={view.label} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
                        <Badge className="absolute bottom-1.5 left-1.5 bg-black/60 text-white/80 border-0 text-[9px]">
                          {view.label}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Production Pack Spec */}
              <div className="p-4 rounded-xl bg-zinc-800/50 border border-zinc-700 mb-6">
                <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                  <Package className="h-4 w-4 text-emerald-400" />
                  Production Pack
                </h3>
                <ul className="grid grid-cols-2 gap-1.5 text-xs text-zinc-400">
                  <li>7 photorealistic vehicle renders</li>
                  <li>Print-ready panel files (8K)</li>
                  <li>PDF proof sheet</li>
                  <li>Panel layout templates</li>
                  <li>Material specifications</li>
                  <li>Installation reference guide</li>
                </ul>
              </div>

              {/* Action buttons */}
              <div className="flex flex-col sm:flex-row gap-3">
                <Button
                  className="flex-1 gap-2 bg-gradient-to-r from-violet-600 to-indigo-500 hover:from-violet-700 hover:to-indigo-600 text-white min-h-[48px] text-base"
                  onClick={() => {
                    setStudioDisplayRender(null);
                    setSelectedRender(studioDisplayRender);
                    setCurrentViewIndex(0);
                    setLayoutMode("studio");
                  }}
                >
                  <Edit3 className="h-4 w-4" />
                  Open in Revision Studio
                </Button>
                <Button
                  variant="outline"
                  className="flex-1 gap-2 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 min-h-[48px]"
                  onClick={() => {
                    setStudioDisplayRender(null);
                    navigate("/printpro/shop");
                  }}
                >
                  <Package className="h-4 w-4" />
                  Print via WePrintWraps
                </Button>
              </div>
            </div>

            {/* Fullscreen viewer within studio display */}
            {studioDisplayFullscreenIdx !== null && sdViews[studioDisplayFullscreenIdx] && (
              <div className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center" onClick={() => setStudioDisplayFullscreenIdx(null)}>
                <button className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 z-10" onClick={() => setStudioDisplayFullscreenIdx(null)}>
                  <X className="h-6 w-6 text-white" />
                </button>
                {studioDisplayFullscreenIdx > 0 && (
                  <button className="absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/20 z-10" onClick={(e) => { e.stopPropagation(); setStudioDisplayFullscreenIdx(studioDisplayFullscreenIdx - 1); }}>
                    <ChevronLeft className="h-6 w-6 text-white" />
                  </button>
                )}
                {studioDisplayFullscreenIdx < sdViews.length - 1 && (
                  <button className="absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/20 z-10" onClick={(e) => { e.stopPropagation(); setStudioDisplayFullscreenIdx(studioDisplayFullscreenIdx + 1); }}>
                    <ChevronRight className="h-6 w-6 text-white" />
                  </button>
                )}
                <img src={sdViews[studioDisplayFullscreenIdx].url} alt={sdViews[studioDisplayFullscreenIdx].label} className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg" onClick={(e) => e.stopPropagation()} />
                <p className="absolute bottom-6 left-1/2 -translate-x-1/2 text-sm text-white/70 bg-black/50 px-4 py-1.5 rounded-full">
                  {sdViews[studioDisplayFullscreenIdx].label} ({studioDisplayFullscreenIdx + 1}/{sdViews.length})
                </p>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Gallery Lightbox ── */}
      {galleryLightboxRender && (() => {
        const viewOrder = ["side", "passenger-side", "hood_detail", "front", "rear", "close-up", "roof"];
        const viewLabelsLB: Record<string, string> = { side: "Driver Side", "passenger-side": "Passenger", hood_detail: "Hood", front: "Front 3/4", rear: "Rear 3/4", "close-up": "Close-Up", roof: "Roof" };
        const lbUrls = galleryLightboxRender.render_urls || {};
        const lbViews = viewOrder.filter((v) => lbUrls[v]).map((v) => ({ type: v, url: lbUrls[v], label: viewLabelsLB[v] || v }));
        const cur = lbViews[galleryLightboxIdx];
        if (!cur) return null;
        return (
          <div className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center" onClick={() => setGalleryLightboxRender(null)}>
            <button className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 z-10" onClick={() => setGalleryLightboxRender(null)}>
              <X className="h-6 w-6 text-white" />
            </button>
            <div className="absolute top-4 left-4 text-white z-10">
              <p className="text-sm font-bold capitalize">{formatVehicleInfo(galleryLightboxRender)}</p>
              <p className="text-xs text-zinc-400">{galleryLightboxRender.design_file_name || galleryLightboxRender.color_name}</p>
            </div>
            {galleryLightboxIdx > 0 && (
              <button className="absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/20 z-10" onClick={(e) => { e.stopPropagation(); setGalleryLightboxIdx(galleryLightboxIdx - 1); }}>
                <ChevronLeft className="h-6 w-6 text-white" />
              </button>
            )}
            {galleryLightboxIdx < lbViews.length - 1 && (
              <button className="absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/20 z-10" onClick={(e) => { e.stopPropagation(); setGalleryLightboxIdx(galleryLightboxIdx + 1); }}>
                <ChevronRight className="h-6 w-6 text-white" />
              </button>
            )}
            <img src={cur.url} alt={cur.label} className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg" onClick={(e) => e.stopPropagation()} />
            <p className="absolute bottom-6 left-1/2 -translate-x-1/2 text-sm text-white/70 bg-black/50 px-4 py-1.5 rounded-full">
              {cur.label} ({galleryLightboxIdx + 1}/{lbViews.length})
            </p>
          </div>
        );
      })()}

      {/* ApprovePro — Phase 8A */}
      {APPROVEPRO_UI_LIVE && (
        <SendForApprovalDialog
          open={showSendForApproval}
          onOpenChange={setShowSendForApproval}
          context={{
          visualizationId: selectedRender?.id || undefined,
          renderUrls: (selectedRender?.render_urls as Record<string, string> | undefined) || {},
          vehicleYear: selectedRender?.vehicle_year ? String(selectedRender.vehicle_year) : "",
          vehicleMake: selectedRender?.vehicle_make || "",
          vehicleModel: selectedRender?.vehicle_model || "",
          designName: (selectedRender as any)?.design_file_name || selectedRender?.color_name || "Revision Design",
          finishType: selectedRender?.finish_type || undefined,
          defaultMode: "revision_loop",
          flatPanelUrl: selectedRender?.custom_design_url || undefined,
          sourceDesignVersion: selectedRender ? getVersionLabel(selectedRender) : undefined,
          sourceIsLatest: true,
          }}
        />
      )}
    </div>
  );
}
