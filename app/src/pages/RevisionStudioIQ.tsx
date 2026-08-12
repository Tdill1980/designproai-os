import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { Helmet } from "react-helmet-async";
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { renderClient } from "@/integrations/supabase/renderClient";
import { extractTransparentSlice, uploadLiftedAsset } from "@/lib/precise-erase-composite";
import { downscaleStorageImage } from "@/lib/storage-image";
import { getVersionCommits, type VersionCommit } from "@/lib/revision-commits";
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
import { ProductionPackDialog } from "@/components/designpanelpro/ProductionPackDialog";
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
import {
  getEnticeRevisionStatus,
  resumeEnticeRevision,
  saveEnticeRevision,
  submitEnticeRevision,
  type EnticeRevisionTrigger,
} from "@/lib/designpro-file-output";
import { formatDid } from "@/lib/designId";
import { ProductionPackQCCard } from "@/components/production/ProductionPackQCCard";
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
import { generatePassengerMirror, designLikelyHasText, fixMirrorText, producePassengerView } from "@/utils/passenger-mirror";
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
 * Raw fetch() call to a Supabase edge function - bypasses supabase.functions.invoke()
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
 * Checks admin_notes first, then falls back to a designiq_generations lookup
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
 * Checks admin_notes cache first, then falls back to designiq_generations lookup.
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

  // 2. Fallback: look up designiq_generations by matching render URL
  try {
    const renderUrls = render.render_urls as Record<string, string> | null;
    const heroUrl = renderUrls?.side || renderUrls?.hero;
    if (heroUrl) {
      const { data } = await supabase
        .from("designiq_generations")
        .select("visionboard_image_refs")
        .eq("panel_url", heroUrl)
        .limit(1)
        .maybeSingle();
      if (data?.visionboard_image_refs && Array.isArray(data.visionboard_image_refs) && data.visionboard_image_refs.length > 0) {
        // Extract storageUrl from each ref (object, JSON string, or plain URL).
        const urls: string[] = data.visionboard_image_refs
          .map(normalizeRefUrl)
          .filter(Boolean) as string[];
        if (urls.length > 0) {
          // Patch admin_notes for future reads
          const existingNotes = (() => {
            try { return JSON.parse(render.admin_notes || "{}"); } catch { return {}; }
          })();
          const patched = { ...existingNotes, visionboard_image_urls: urls };
          supabase.from("color_visualizations").update({
            admin_notes: JSON.stringify(patched),
          } as any).eq("id", render.id).then(() => {});
          return urls;
        }
      }
    }
  } catch {}

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
//   1. color_visualizations.admin_notes.flat_proof_url   (universal cache)
//   2. designiq_generations.flat_proof_url               (DesignIQ renders)
// ---------------------------------------------------------------------------

// InlineStoredProof — PRELOADS the saved 2D production proof for the selected
// render and shows it inline (no dialog, no click). Resolves the canonical
// proof URL the same way the dialog does: color_visualizations.admin_notes.
// flat_proof_url first, then the linked designiq_generations.flat_proof_url.
// Renders nothing until a stored proof exists, so it's always additive.
function InlineStoredProof({ render }: { render: any }) {
  const id = render?.id || null;
  const { data: proofUrl } = useQuery({
    queryKey: ["revstudio-inline-2dproof", id, render?.admin_notes],
    enabled: !!id,
    queryFn: async () => {
      let notes: Record<string, any> = {};
      try { notes = render?.admin_notes ? JSON.parse(render.admin_notes) : {}; } catch { /* not JSON */ }
      // Re-read the freshest admin_notes from the DB by id — the in-memory copy
      // can be stale (the 2D proof is saved after the render list loaded), which
      // otherwise hides an already-saved proof from this preload.
      if (id) {
        try {
          const { data: vizRow } = await supabase.from("color_visualizations").select("admin_notes").eq("id", id).maybeSingle();
          if ((vizRow as any)?.admin_notes) {
            try { notes = JSON.parse((vizRow as any).admin_notes); } catch { /* keep in-memory */ }
          }
        } catch { /* keep in-memory notes */ }
      }
      // Only preview a stored value that looks like a real 2D proof — never a
      // raw 3D render URL wrongly saved as flat_proof_url.
      const isProofUrl = (u: any) => typeof u === "string" && /proof/i.test(u);
      if (isProofUrl(notes?.flat_proof_url)) return notes.flat_proof_url as string;
      const genId: string | null = notes?.designiq_generation_id || null;
      if (genId) {
        const { data } = await supabase.from("designiq_generations" as any).select("flat_proof_url").eq("id", genId).maybeSingle();
        if (isProofUrl((data as any)?.flat_proof_url)) return (data as any).flat_proof_url as string;
      }
      return null;
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
  // render.id is not always a color_visualizations id. A card opened from the
  // QC queue carries the PANELIZER JOB id (live: bd266e70… → generation
  // 5714755c… → visualization e90e74b2…, whose activated proof this dialog
  // then failed to find, showing "No production proof yet" over a finished
  // pack and refusing the build button with "not a saved revision"). Resolve
  // the true visualization once and key everything below on it.
  const { data: resolvedVizId = null, isLoading: resolvingVizId } = useQuery({
    queryKey: ["revstudio-resolve-viz-id", render?.id],
    enabled: !!render?.id,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data: direct } = await (supabase as any)
        .from("color_visualizations")
        .select("id")
        .eq("id", render.id)
        .maybeSingle();
      if (direct?.id) return String(direct.id);
      // Not a visualization — try it as a QC job id, else as a generation id.
      let generationId = String(render.id);
      try {
        const { data: job } = await (supabase as any)
          .from("panelizer_jobs")
          .select("generation_id")
          .eq("id", render.id)
          .maybeSingle();
        if (job?.generation_id) generationId = String(job.generation_id);
      } catch { /* not a panelizer id — fall through with render.id */ }
      const { data: pack } = await (supabase as any)
        .from("designpro_entice_packs")
        .select("source_visualization_id")
        .eq("designiq_generation_id", generationId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return pack?.source_visualization_id
        ? String(pack.source_visualization_id)
        : null;
    },
  });
  const { data: enticeWorkflowStatus } = useQuery({
    queryKey: ["revstudio-entice-proof-status", resolvedVizId],
    enabled: !!resolvedVizId,
    queryFn: async () => {
      try {
        return await getEnticeRevisionStatus({
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
        return status?.activeEnticePack?.proof_artifact?.url
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

      // 1. Authoritative cache — re-fetch the freshest admin_notes for this
      // visualization straight from the DB by id, so a proof saved after the
      // list loaded is always found. Falls back to the in-memory notes if the
      // row can't be read (e.g. synthetic bridge ids that aren't real rows).
      let freshNotes: Record<string, any> = notes;
      const notesVizId = resolvedVizId || render?.id;
      if (notesVizId) {
        try {
          const { data: vizRow } = await supabase
            .from("color_visualizations")
            .select("admin_notes")
            .eq("id", notesVizId)
            .maybeSingle();
          if ((vizRow as any)?.admin_notes) {
            try { freshNotes = JSON.parse((vizRow as any).admin_notes); } catch { freshNotes = notes; }
          }
        } catch { /* keep in-memory notes */ }
      }

      // A stored value only counts as a REAL saved proof if it looks like a 2D
      // proof asset (the generator saves to ".../2d-proofs/..._2d-proof.png").
      // A raw 3D render URL wrongly saved as flat_proof_url (bad/legacy data)
      // must NOT be shown as the proof — treat it as "not there" so the sheet
      // regenerates a correct multi-view proof (with dims) and re-saves it.
      const isProofUrl = (u: any) => typeof u === "string" && /proof/i.test(u);
      const cachedUrl = isProofUrl(freshNotes.flat_proof_url)
        ? freshNotes.flat_proof_url
        : (isProofUrl(notes.flat_proof_url) ? notes.flat_proof_url : null);
      const resolvedGenId: string | null =
        freshNotes.designiq_generation_id || notes.designiq_generation_id || null;

      if (cachedUrl) {
        if (!cancelled) {
          setInitialProofUrl(cachedUrl);
          setLoading(false);
        }
        return;
      }

      // 2. DesignIQ fallback — check the linked designiq_generations row.
      if (resolvedGenId) {
        try {
          const { data } = await supabase
            .from("designiq_generations" as any)
            .select("flat_proof_url")
            .eq("id", resolvedGenId)
            .maybeSingle();

          if (!cancelled && isProofUrl((data as any)?.flat_proof_url)) {
            setInitialProofUrl((data as any).flat_proof_url);
            setLoading(false);
            return;
          }
        } catch { /* ignore — fall through to auto-generate */ }
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
      // maybeSingle, not single. `.single()` turns "no such row" into PostgREST's
      // "Cannot coerce the result to a single JSON object", which the catch below
      // then reports as "The server did not accept this revision: ..." -- naming
      // the server for a row this browser asked for and blaming a rejection that
      // never happened, because this read runs BEFORE anything is submitted.
      // That string is what sent several sessions hunting a non-existent RPC bug.
      //
      // resolvedVizId first: a QC-queue card's render.id is a panelizer job id,
      // which the resolver above has already mapped to the real visualization.
      const buildVizId = String(resolvedVizId || render.id);
      const { data: frozen, error } = await supabase
        .from("color_visualizations")
        .select("id, updated_at, admin_notes, render_urls")
        .eq("id", buildVizId)
        .maybeSingle();
      if (error) throw error;
      if (!frozen) {
        throw new Error(
          `this design (${buildVizId}) is not a saved revision, so there is nothing to build from — reopen it from the Designs list`,
        );
      }
      if (!frozen.updated_at) {
        throw new Error("the saved revision has no timestamp to freeze against");
      }
      let generationId: string | undefined;
      try {
        const notes =
          typeof frozen.admin_notes === "string"
            ? JSON.parse(frozen.admin_notes)
            : frozen.admin_notes || {};
        generationId =
          typeof notes.designiq_generation_id === "string"
            ? notes.designiq_generation_id
            : undefined;
      } catch {
        generationId = undefined;
      }
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
        ? await resumeEnticeRevision(currentRunId, currentStatus === "failed")
        : await submitEnticeRevision({
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
    const proofUrl = String(
      enticeWorkflowStatus?.previewProofUrl ||
        enticeWorkflowStatus?.activeEnticePack?.proof_artifact?.url ||
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
    enticeWorkflowStatus?.previewProofUrl ||
      enticeWorkflowStatus?.activeEnticePack?.proof_artifact?.url ||
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
  const hasActiveRun =
    ["queued", "running"].includes(workflowStatus) || packStatus === "building";

  return (
    <>
      {renderFallback({
        initialProofUrl: observedProofUrl,
        onProofGenerated: persistProofUrl,
        workflowStatus,
        workflowFailedStage,
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
  const [modeFilter, setModeFilter] = useState<string>("all");
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

      // Canonical DesignIQ row — the same back-link the panel slicer uses.
      const gid = notes.designiq_generation_id;
      if (gid) {
        try {
          const { data } = await (supabase as any)
            .from("designiq_generations")
            .select("raw_prompt")
            .eq("id", gid)
            .maybeSingle();
          const raw = String((data as any)?.raw_prompt || "").trim();
          if (raw && !cancelled) { setResolvedPrompt(raw); return; }
        } catch { /* fall through to the honest empty state */ }
      }
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
      // Assets live on designiq_generations, keyed by the canonical DesignIQ id.
      let canonical = String(render.id);
      let proofUrl: string | null = null; // the 2D PROOF — the sanctioned logo-extract source
      try {
        const { data } = await supabase.from("color_visualizations").select("admin_notes").eq("id", render.id).maybeSingle();
        const raw = (data as any)?.admin_notes;
        const n = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
        if (n?.designiq_generation_id) canonical = String(n.designiq_generation_id);
        if (typeof n?.flat_proof_url === "string" && /proof/i.test(n.flat_proof_url)) proofUrl = n.flat_proof_url;
      } catch { /* use render id */ }

      const { data: dg } = await (supabase as any)
        .from("designiq_generations")
        .select("master_artboard_clean_url, master_artboard_url, flat_proof_url")
        .eq("id", canonical).maybeSingle();
      const cleanUrl: string | null = (dg as any)?.master_artboard_clean_url || null;
      const brandedUrl: string | null = (dg as any)?.master_artboard_url || null;
      if (!proofUrl && (dg as any)?.flat_proof_url) proofUrl = String((dg as any).flat_proof_url);
      if (!cleanUrl) {
        toast.error(LAYERED_EDIT_UNAVAILABLE_MESSAGE, { id: toastId, duration: 12000 });
        return false;
      }

      // LAYER 0 — swap the canvas to the clean, logo-free artboard (no smear).
      setCleanBackgroundsByView((prev) => ({ ...prev, [viewKey]: cleanUrl }));

      // LAYER 1 — lift the REAL logo/lettering as wrap-keyed transparent overlays.
      // SOURCE = the 2D PROOF (the sanctioned logo-extract source, same as DesignPro
      // — the dimensioned proof already shows every side's design). Falls back to
      // the branded artboard, then the clean base. extractTransparentSlice alpha-keys
      // the surrounding wrap so we lift the element, not a rectangle; no heal (the
      // clean base is whole underneath).
      const src = proofUrl || brandedUrl || cleanUrl;
      const newLayers: LogoLayer[] = [];
      try {
        const { data: det } = await renderClient.functions.invoke("extract-logo-elements", {
          body: { approved_render_url: src, job_id: canonical, user_id: currentUserId },
        });
        const raw: any[] = Array.isArray((det as any)?.elements) ? (det as any).elements : [];
        const boxes = raw
          .map((e) => {
            const bb = e?.bounding_box || {};
            const x = bb.x ?? bb.x_percent, y = bb.y ?? bb.y_percent, w = bb.width ?? bb.width_percent, h = bb.height ?? bb.height_percent;
            return [x, y, w, h].every((n: any) => typeof n === "number") ? { e, box: { xPct: x, yPct: y, wPct: w, hPct: h } } : null;
          })
          .filter((o: any) => o && (o.e.confidence ?? 1) >= 0.5 && o.box.wPct * o.box.hPct <= 0.4 && o.box.wPct * o.box.hPct > 0.0003)
          .slice(0, 8) as Array<{ e: any; box: { xPct: number; yPct: number; wPct: number; hPct: number } }>;
        for (let i = 0; i < boxes.length; i++) {
          const { e, box } = boxes[i];
          try {
            const { blob } = await extractTransparentSlice(src, box);
            const url = await uploadLiftedAsset(blob, currentUserId);
            const cx = box.xPct + box.wPct / 2, cy = box.yPct + box.hPct / 2;
            newLayers.push({
              id: `lay_${Date.now().toString(36)}_${i}_${Math.random().toString(36).slice(2, 5)}`,
              kind: "extracted",
              sourceUrl: url,
              name: e.label || e.content || e.type || "Element",
              origin: { xPct: cx, yPct: cy, wPct: box.wPct, hPct: box.hPct },
              placement: { xPct: cx, yPct: cy, size: "md", sizePercent: Math.min(0.6, Math.max(0.03, box.wPct)) },
            });
          } catch { /* skip this element */ }
        }
      } catch { /* detection failed — the clean base is still loaded */ }

      if (newLayers.length > 0) {
        setLogoLayersByView((prev) => ({ ...prev, [viewKey]: [...(prev[viewKey] || []), ...newLayers] }));
        // Save the lifted elements to the order LOGO PACK — the value-add shown
        // under the panels in RevisionStudio and downloaded/resized by the design
        // team in PanelPro. Persisted onto THIS render row's admin_notes.logo_pack
        // (the buyer owns it) — the same store ProductionFlowLayersCard / PanelPro
        // read across the order family. Direct client write (the project is at the
        // edge-function cap, so no dedicated function); fire-and-forget, non-fatal.
        void (async () => {
          try {
            const { data: cur } = await supabase.from("color_visualizations").select("admin_notes").eq("id", render.id).maybeSingle();
            let notes: Record<string, any> = {};
            try { notes = typeof (cur as any)?.admin_notes === "string" ? JSON.parse((cur as any).admin_notes) : ((cur as any)?.admin_notes || {}); } catch { notes = {}; }
            const byUrl = new Map<string, any>();
            for (const e of (Array.isArray(notes.logo_pack) ? notes.logo_pack : [])) if (e?.url) byUrl.set(e.url, e);
            for (const l of newLayers) byUrl.set(l.sourceUrl, { url: l.sourceUrl, label: l.name, widthPct: l.origin?.wPct, heightPct: l.origin?.hPct });
            notes.logo_pack = Array.from(byUrl.values());
            await supabase.from("color_visualizations").update({ admin_notes: JSON.stringify(notes) }).eq("id", render.id);
          } catch { /* non-fatal — canvas edit still works */ }
        })();
      }
      toast.success(
        newLayers.length
          ? `Clean base loaded + ${newLayers.length} element(s) lifted → saved to your Logo Pack. Drag to move, delete to remove, then Revise & Clone to save.`
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
        // DB FALLBACK: sessionStorage handoff is same-tab only, so across reloads/
        // tabs (e.g. reopening the plumbing van) the Layer-2 overlays vanish. If
        // nothing is placed yet, pull the persisted overlay_pngs from
        // design_generation_assets and seed them as editable layers.
        if (!alreadyHasLayers) {
          const genId = deepLinkId || selectedRender.id;
          (async () => {
            try {
              const { data: asset } = await supabase
                .from("design_generation_assets")
                .select("overlay_pngs")
                .eq("generation_id", genId)
                .eq("is_current", true)
                .order("iteration_index", { ascending: false })
                .limit(1)
                .maybeSingle();
              const overlays = (asset?.overlay_pngs as { url?: string; text?: string; role?: string }[] | null) || [];
              const logos = overlays.filter((o) => o?.url).map((o) => ({ url: o.url as string, name: o.role || o.text }));
              if (logos.length) {
                const heroKey = getViewOrderForVehicle(selectedRender)[0] || VIEW_ORDER[0];
                setLogoLayersByView((prev) => {
                  const hasAny = Object.values(prev).some((arr) => arr.length > 0);
                  return hasAny ? prev : { ...prev, [heroKey]: seedLogoLayersFromHandoff(logos) };
                });
              }
            } catch (e) {
              console.warn("[RevisionStudio] overlay DB fallback failed (non-fatal):", e);
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

  // Auto-save logo layers + clean backgrounds to admin_notes.logo_layers
  // so extracted elements persist across sessions. Reads on hydration (above),
  // writes on every change to logoLayersByView or cleanBackgroundsByView.
  // ALSO syncs to linked panelizer_jobs.concept_json.extracted_elements
  // so QC Artboard can pick them up for redeployment edits.
  useEffect(() => {
    if (!selectedRender?.id) return;
    const hasLayers = Object.values(logoLayersByView).some(arr => arr.length > 0);
    const hasBgs = Object.keys(cleanBackgroundsByView).length > 0;
    if (!hasLayers && !hasBgs) return; // nothing to save

    const payload: RenderLogoLayers = {
      backgrounds: cleanBackgroundsByView,
      layers: logoLayersByView,
    };

    (async () => {
      try {
        // 1. Save to color_visualizations.admin_notes.logo_layers
        const existingNotes = (() => { try { return JSON.parse(selectedRender.admin_notes || "{}"); } catch { return {}; } })();
        await supabase
          .from("color_visualizations")
          .update({ admin_notes: JSON.stringify({ ...existingNotes, logo_layers: payload }) })
          .eq("id", selectedRender.id);

        // 1b. Persist the CLEAN (text/logo-free) background produced by the
        // Layer Lift tool to design_generation_assets.background_url for this
        // generation. This is what the deterministic slicer
        // (api/process-production-pack.js) consumes as Layer-1 input — without
        // it the slicer falls back to the raw 3D/baked render. Reuses the
        // existing persist path (designpro-persist-assets); MERGE-only on the
        // current iteration row. Best-effort: never block the layer save.
        const cleanBgForProduction = cleanBackgroundsByView["side"]
          || cleanBackgroundsByView["driver-side"]
          || Object.values(cleanBackgroundsByView)[0]
          || null;
        const genIdForPersist = existingNotes.designiq_generation_id || null;
        if (cleanBgForProduction && genIdForPersist) {
          try {
            const { data: { user: authedUser } } = await supabase.auth.getUser();
            // Persist the clean per-view background as the text-free Layer-1
            // (background_url = primary clean view; view_urls = all clean
            // views) and the separated layers as Layer-2 overlay PNGs.
            const overlayPngs: { id: string; kind: string; role: string; url: string }[] = [];
            for (const viewLayers of Object.values(logoLayersByView)) {
              for (const l of viewLayers) {
                if (l?.sourceUrl) {
                  overlayPngs.push({
                    // Both uploaded + extracted layers are branding (logo/text);
                    // persist them as "logo" overlays (Layer 2) so the slicer's
                    // Layer-1 text-free guard stays satisfied.
                    id: l.id,
                    kind: "logo",
                    role: l.name,
                    url: l.sourceUrl,
                  });
                }
              }
            }
            await renderClient.functions.invoke("designpro-persist-assets", {
              body: {
                generation_id: genIdForPersist,
                background_url: cleanBgForProduction,
                view_urls: cleanBackgroundsByView,
                ...(overlayPngs.length ? { overlay_pngs: overlayPngs } : {}),
                user_id: authedUser?.id || null,
                source: "revision-studio-layerlift",
              },
            });
            console.log("[RevisionIQ] Persisted clean text-free background to design_generation_assets:", genIdForPersist);
          } catch (persistErr) {
            console.warn("[RevisionIQ] persist clean background failed (non-fatal):", persistErr);
          }
        }

        // 2. Sync to linked panelizer_jobs so QC Artboard has the data
        // Flatten all layers across views for the QC extracted_elements format
        const allLayers: LogoLayer[] = [];
        for (const viewLayers of Object.values(logoLayersByView)) {
          allLayers.push(...viewLayers);
        }
        // Use the first clean background as the primary clean artboard URL
        const cleanArtboardUrl = cleanBackgroundsByView["side"]
          || cleanBackgroundsByView["driver-side"]
          || Object.values(cleanBackgroundsByView)[0]
          || null;

        if (allLayers.length > 0 || cleanArtboardUrl) {
          const extractedPayload = {
            layers: allLayers,
            cleanArtboardUrl,
            perViewBackgrounds: cleanBackgroundsByView,
            perViewLayers: logoLayersByView,
            savedAt: new Date().toISOString(),
            source: "revision-studio",
            sourceRenderId: selectedRender.id,
          };

          // Find linked panelizer_jobs by generation_id
          const { data: linkedJobs } = await supabase
            .from("panelizer_jobs" as any)
            .select("id, concept_json")
            .eq("generation_id", selectedRender.id)
            .limit(5);

          // Also check parent IDs in version chain
          const parentId = existingNotes.version?.parent_id;
          let parentJobs: any[] = [];
          if (parentId && (!linkedJobs || linkedJobs.length === 0)) {
            const { data: pJobs } = await supabase
              .from("panelizer_jobs" as any)
              .select("id, concept_json")
              .eq("generation_id", parentId)
              .limit(5);
            if (pJobs) parentJobs = pJobs;
          }

          const allJobs = [...(linkedJobs || []), ...parentJobs];
          const uniqueJobs = allJobs.filter((j, i, arr) => arr.findIndex(x => x.id === j.id) === i);

          for (const pJob of uniqueJobs) {
            const existingCj = pJob.concept_json || {};
            await supabase
              .from("panelizer_jobs" as any)
              .update({
                concept_json: {
                  ...existingCj,
                  extracted_elements: extractedPayload,
                },
              })
              .eq("id", pJob.id);
            console.log(`[RevisionIQ] Synced extracted_elements to panelizer_job ${pJob.id}`);
          }
        }
      } catch (err) {
        console.error("[RevisionIQ] Failed to save logo_layers:", err);
      }
    })();
  }, [logoLayersByView, cleanBackgroundsByView]);

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
  const [showProductionDialog, setShowProductionDialog] = useState(false);

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
    if (r.vehicle_make && r.vehicle_model) {
      try {
        const { data } = await renderClient.functions.invoke("panelizer-step-validate", {
          body: { vehicleMake: r.vehicle_make, vehicleModel: r.vehicle_model, vehicleYear: r.vehicle_year ? Number(r.vehicle_year) : null, estimateOnly: true },
        });
        const d = (data?.estimatedDimensions || {}) as Record<string, number>;
        sideW = d.bodyLengthInches;
        sideH = d.bodyHeightInches;
        sqft = typeof d.totalSqFt === "number" ? d.totalSqFt : null;
      } catch { /* fall through */ }
    }
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
    queryKey: ["revision-studio-renders", modeFilter, searchQuery, isAdmin, showTeamRenders],
    queryFn: async ({ pageParam = 0 }) => {
      const from = pageParam * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let query = supabase
        .from("color_visualizations")
        .select(GRID_COLUMNS)
        // Some legacy rows landed on "complete" instead of "completed" —
        // accept both so MyVehiclePro / RestyleLibrary renders that
        // finished on the older status string still show up.
        .in("generation_status", ["completed", "complete"])
        .not("render_urls", "is", null)
        .order("created_at", { ascending: false })
        .range(from, to);

      // Standard users only see their own renders (or team renders if toggled)
      if (!isAdmin) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.email) {
          if (showTeamRenders) {
            // Find user's organization_id from their own renders
            const { data: orgRow } = await supabase
              .from("color_visualizations")
              .select("organization_id")
              .ilike("customer_email", session.user.email)
              .not("organization_id", "is", null)
              .limit(1)
              .maybeSingle();

            if (orgRow?.organization_id) {
              // Show own renders + all renders in same org
              query = query.or(`customer_email.ilike.${session.user.email},organization_id.eq.${orgRow.organization_id}`);
            } else {
              // No org found, fall back to own renders only
              query = query.ilike("customer_email", session.user.email);
            }
          } else {
            query = query.ilike("customer_email", session.user.email);
          }
        }
      } else {
        // Admins see all renders, but hide demo-seed clones (rows duplicated
        // into another account purely for demo filming) so the admin view
        // doesn't show every design twice.
        query = query.not("admin_notes", "ilike", "%royaltywraps_demo_seed%");
      }

      if (modeFilter !== "all") {
        if (modeFilter === "myvehicle") {
          query = query.ilike("mode_type", "myvehicle\\_%");
        } else if (modeFilter.startsWith("myvehicle_")) {
          // MV × sub-filters: each tool category rolls up every saved
          // mode_type variant so paid customers see every render they
          // produced, not just the canonical name. Underscores are
          // escaped (\\_) so PostgreSQL ILIKE treats them as literals
          // instead of single-char wildcards.
          const MV_VARIANTS: Record<string, string[]> = {
            myvehicle_colorpro: ["myvehicle\\_colorpro%"],
            myvehicle_designpanelpro: [
              "myvehicle\\_designpanelpro%",
              "myvehicle\\_designpro\\_direct",
            ],
            myvehicle_fadewraps: ["myvehicle\\_fadewraps%"],
            myvehicle_graphicspro: ["myvehicle\\_graphicspro%"],
            myvehicle_wbty: ["myvehicle\\_wbty%"],
            myvehicle_wallpro: ["myvehicle\\_wallpro%"],
          };
          const patterns = MV_VARIANTS[modeFilter] ?? [modeFilter];
          query = query.or(
            patterns.map((p) => `mode_type.ilike.${p}`).join(",")
          );
        } else {
          query = query.ilike("mode_type", modeFilter);
        }
      }

      if (searchQuery) {
        const q = searchQuery.trim();
        // vehicle_year is an integer column — ilike against it makes PostgREST
        // 400 the whole request (which blanked the grid the moment anyone
        // typed in the search box). Match the year separately only when the
        // query is purely numeric.
        const orParts = [
          `vehicle_make.ilike.%${searchQuery}%`,
          `vehicle_model.ilike.%${searchQuery}%`,
          `color_name.ilike.%${searchQuery}%`,
          `design_file_name.ilike.%${searchQuery}%`,
          `custom_styling_prompt_key.ilike.%${searchQuery}%`,
          `customer_email.ilike.%${searchQuery}%`,
          `admin_notes.ilike.%${searchQuery}%`,
          `mode_type.ilike.%${searchQuery}%`,
        ];
        if (/^\d+$/.test(q)) {
          orParts.push(`vehicle_year.eq.${q}`);
          // Order-number search: color_visualizations has no order number, but
          // the WePrintWraps order's proof links to the design it was made for
          // (source_visualization_id). Resolve the order # → its proof(s) →
          // the linked render id(s) so typing a WPW order # finds the design.
          try {
            const { data: proofs } = await supabase
              .from("proof_approvals" as any)
              .select("source_visualization_id")
              .or(`metadata->>wpw_order_number.eq.${q},metadata->>woo_order_number.eq.${q},metadata->>wpw_woo_order_id.eq.${q}`)
              .not("source_visualization_id", "is", null);
            const ids = (proofs || [])
              .map((p: any) => p.source_visualization_id)
              .filter(Boolean);
            if (ids.length) orParts.push(`id.in.(${ids.join(",")})`);
          } catch { /* order lookup is best-effort */ }
        }
        query = query.or(orParts.join(","));
      }

      const { data, error } = await query;
      if (error) throw error;

      // Filter out phantom renders - records with empty render_urls objects
      const filtered = (data || []).filter((r: any) => {
        const urls = r.render_urls as Record<string, string> | null;
        if (!urls || typeof urls !== "object") return false;
        return Object.values(urls).some(
          (v) => typeof v === "string" && v.length > 0
        );
      });

      return filtered;
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

  // ── GraphicsPro renders live in a separate table (graphics_pro_jobs).
  // Pull them in their own query and union them with the color_visualizations
  // feed so RevisionStudioIQ shows GraphicsPro past renders alongside every
  // other tool. Volume is low, so a single non-paginated fetch is fine.
  const { data: graphicsProRows } = useQuery({
    queryKey: ["revision-studio-graphicspro", modeFilter, searchQuery, isAdmin, showTeamRenders],
    queryFn: async () => {
      let q = (supabase as any)
        .from("graphics_pro_jobs")
        .select(
          "id,user_id,shop_id,vehicle_year,vehicle_make,vehicle_model,vehicle_area,design_prompt,design_style,business_name,vinyl_finish,surface_type,surface_subcategory,mockup_render_url,detail_render_url,closeup_render_url,uploaded_artwork_urls,business_logo_url,surface_image_url,status,created_at",
        )
        // GraphicsPro jobs sit at "mockup_ready" right after the AI mockup
        // step and only transition to "completed"/"approved" once the user
        // pushes them through ProductionFlow. Without including these
        // statuses the customer's fresh mockup would never appear in
        // RevisionStudio until they finished the cut-file flow.
        .in("status", ["completed", "complete", "mockup_ready", "approved"])
        .order("created_at", { ascending: false })
        .limit(100);

      if (!isAdmin) {
        const { data: { session } } = await supabase.auth.getSession();
        const uid = session?.user?.id;
        if (!uid) return [];
        q = q.eq("user_id", uid);
      }

      if (searchQuery) {
        q = q.or(
          `vehicle_make.ilike.%${searchQuery}%,vehicle_model.ilike.%${searchQuery}%,design_prompt.ilike.%${searchQuery}%,business_name.ilike.%${searchQuery}%,design_style.ilike.%${searchQuery}%,surface_type.ilike.%${searchQuery}%`,
        );
      }

      const { data, error } = await q;
      if (error) {
        console.warn("[RevisionStudioIQ] graphics_pro_jobs fetch failed", error);
        return [];
      }

      // Map graphics_pro_jobs → the shape RevisionStudioIQ expects from
      // color_visualizations so the existing render cards / merge / open
      // logic all work without a special case at every render site.
      return (data ?? [])
        .map((row: any) => {
          const renderUrls: Record<string, string> = {};
          if (row.mockup_render_url) renderUrls.hero = row.mockup_render_url;
          if (row.detail_render_url) renderUrls.detail = row.detail_render_url;
          if (row.closeup_render_url) renderUrls.closeup = row.closeup_render_url;
          if (Object.keys(renderUrls).length === 0) return null;

          const designLabel =
            row.business_name ||
            row.design_style ||
            (row.design_prompt ? row.design_prompt.slice(0, 60) : "GraphicsPro Design");

          // Surface the customer's uploaded EXAMPLE/logo so RevisionStudio can
          // show it (and so an "exact_reference" revision can match it). Without
          // this the uploaded reference was invisible in the revision UI.
          const uploadedRefs: string[] = Array.isArray(row.uploaded_artwork_urls)
            ? row.uploaded_artwork_urls.filter(Boolean)
            : [];
          const referenceUrl =
            uploadedRefs[0] || row.business_logo_url || null;

          return {
            id: row.id,
            render_urls: renderUrls,
            reference_image_urls: uploadedRefs,
            vehicle_year: row.vehicle_year ? String(row.vehicle_year) : null,
            vehicle_make: row.vehicle_make,
            vehicle_model: row.vehicle_model,
            vehicle_type: row.vehicle_area || null,
            mode_type: "GraphicsPro",
            design_file_name: designLabel,
            color_name: row.business_name || null,
            color_hex: null,
            finish_type: row.vinyl_finish || null,
            created_at: row.created_at,
            custom_design_url: referenceUrl,
            custom_swatch_url: null,
            custom_styling_prompt_key: row.design_style || null,
            uses_custom_design: !!referenceUrl,
            admin_notes: null,
            customer_email: null,
            subscription_tier: null,
            organization_id: null,
            infusion_color_id: null,
            generation_status: "completed",
            // Marker so push-to-tool / lookup paths can branch back to the
            // graphics_pro_jobs route if they ever need the original row.
            __source: "graphics_pro_jobs",
          };
        })
        .filter(Boolean) as any[];
    },
    enabled:
      isRoleLoading === false &&
      (modeFilter === "all" || modeFilter === "graphicspro"),
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // ── Production / QC jobs live in panelizer_jobs (the table QC Artboard
  // reads). Historically a panelizer job's generation_id often points to a
  // color_visualizations row that no longer exists (or was never written),
  // so those jobs showed up in QC but were invisible in RevisionStudio.
  // Pull them in their own query and union them with the feed (same approach
  // as graphics_pro_jobs) so every job a shop can see in QC is also revisable
  // here. Rows whose generation_id already matches a loaded CV record are
  // dropped in the merge below so designs never appear twice.
  const { data: panelizerRows } = useQuery({
    queryKey: ["revision-studio-panelizer", modeFilter, searchQuery, isAdmin, showTeamRenders],
    queryFn: async () => {
      let q = (supabase as any)
        .from("panelizer_jobs")
        .select(
          "id,user_id,generation_id,order_number,vehicle_year,vehicle_make,vehicle_model,vehicle_trim,approved_render_url,all_view_urls,concept_json,status,created_at",
        )
        .order("created_at", { ascending: false })
        .limit(100);

      if (!isAdmin) {
        const { data: { session } } = await supabase.auth.getSession();
        const uid = session?.user?.id;
        if (!uid) return [];
        q = q.eq("user_id", uid);
      }

      if (searchQuery) {
        // No vehicle_year here — it's an integer column and ilike against it
        // would 400 the whole request.
        q = q.or(
          `vehicle_make.ilike.%${searchQuery}%,vehicle_model.ilike.%${searchQuery}%,order_number.ilike.%${searchQuery}%`,
        );
      }

      const { data, error } = await q;
      if (error) {
        console.warn("[RevisionStudioIQ] panelizer_jobs fetch failed", error);
        return [];
      }

      return (data ?? [])
        .map((row: any) => {
          const cj = (row.concept_json && typeof row.concept_json === "object") ? row.concept_json : {};

          // Prefer the multi-view render_urls kept in sync on the concept,
          // then the job's all_view_urls, then the single approved render.
          let renderUrls: Record<string, string> = {};
          const cjUrls = cj.render_urls;
          if (cjUrls && typeof cjUrls === "object" && !Array.isArray(cjUrls)) {
            renderUrls = { ...cjUrls };
          } else if (row.all_view_urls && typeof row.all_view_urls === "object" && !Array.isArray(row.all_view_urls)) {
            renderUrls = { ...row.all_view_urls };
          }
          if (Object.keys(renderUrls).length === 0 && row.approved_render_url) {
            renderUrls.hero = row.approved_render_url;
          }
          // Strip empty/non-string values so the phantom-render filter and
          // the card view never choke on a blank URL.
          renderUrls = Object.fromEntries(
            Object.entries(renderUrls).filter(([, v]) => typeof v === "string" && v.length > 0),
          ) as Record<string, string>;
          if (Object.keys(renderUrls).length === 0) return null;

          const designLabel =
            cj.design_name ||
            cj.designName ||
            (cj.prompt ? String(cj.prompt).slice(0, 60) : null) ||
            (row.order_number ? `Order ${row.order_number}` : "Production Job");

          return {
            // Use the panelizer job id as the card id. Revising clones into a
            // fresh color_visualizations row, so a non-CV id here is fine.
            id: row.id,
            // Carry the linked generation id so the merge step can drop jobs
            // whose CV row is already in the feed.
            _generationId: row.generation_id || null,
            render_urls: renderUrls,
            vehicle_year: row.vehicle_year ?? null,
            vehicle_make: row.vehicle_make,
            vehicle_model: row.vehicle_model,
            vehicle_type: row.vehicle_trim || null,
            mode_type: "designpanelpro",
            design_file_name: designLabel,
            color_name: cj.design_name || null,
            color_hex: null,
            finish_type: cj.finish || null,
            created_at: row.created_at,
            custom_design_url: null,
            custom_swatch_url: null,
            custom_styling_prompt_key: null,
            uses_custom_design: false,
            admin_notes: null,
            customer_email: null,
            subscription_tier: null,
            organization_id: null,
            infusion_color_id: null,
            generation_status: "completed",
            __source: "panelizer_jobs",
          };
        })
        .filter(Boolean) as any[];
    },
    enabled:
      isRoleLoading === false &&
      (modeFilter === "all" || modeFilter === "designpanelpro"),
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Flatten all pages and merge duplicates
  const renders = useMemo(() => {
    if (!rendersPages?.pages) return undefined;
    // Blend color_visualizations and graphics_pro_jobs records together — the
    // mergeKey below dedupes any rows that represent the same design across
    // both tables, so we don't need to suppress one or the other up front.
    // (Earlier this branch wiped CV rows whenever modeFilter === "graphicspro",
    // which silently hid every render the new GraphicsPro tool produced —
    // that tool writes to color_visualizations, not graphics_pro_jobs.)
    const cvRecords = rendersPages.pages.flat();
    const gpRecords = graphicsProRows ?? [];
    // Drop panelizer jobs whose linked color_visualizations row is already in
    // the feed so the same design never shows twice (once as a CV card, once
    // as a QC-job card). Jobs with an orphaned/missing generation_id pass
    // through — they're exactly the ones that were invisible before.
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
  }, [rendersPages, graphicsProRows, panelizerRows, modeFilter]);

  // Resolve the WePrintWraps order number for each design so the card + detail
  // header can show it. color_visualizations rows carry no order number of
  // their own — the link lives on the customer's approval
  // (proof_approvals.source_visualization_id → metadata.wpw_order_number),
  // exactly the same join the order-number SEARCH uses. Build a map keyed by
  // every render id currently in the feed (including merged sibling ids).
  const orderLookupIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of renders || []) {
      if (r?.id) ids.add(r.id);
      for (const mid of (r?._mergedIds || [])) if (mid) ids.add(mid);
    }
    return Array.from(ids).slice(0, 300);
  }, [renders]);

  const { data: orderNumberByRenderId } = useQuery({
    queryKey: ["revision-studio-order-numbers", orderLookupIds],
    enabled: orderLookupIds.length > 0,
    queryFn: async () => {
      const map: Record<string, string> = {};
      try {
        const { data } = await (supabase as any)
          .from("proof_approvals")
          .select("source_visualization_id, metadata")
          .in("source_visualization_id", orderLookupIds)
          .not("source_visualization_id", "is", null);
        for (const row of data || []) {
          const md = (row.metadata && typeof row.metadata === "object") ? row.metadata : {};
          const on = md.wpw_order_number || md.woo_order_number || md.wpw_woo_order_id;
          const sid = row.source_visualization_id;
          if (sid && on && !map[sid]) map[sid] = String(on);
        }
      } catch (e) {
        // Best-effort — the order badge is additive, never block the feed.
        console.warn("[RevisionStudioIQ] order-number resolve failed", e);
      }
      return map;
    },
  });

  // Resolve a single render's WPW order number (panelizer jobs carry it
  // directly; CV designs resolve through the approval map above).
  const orderNumberFor = (r: any): string | null => {
    if (!r) return null;
    if (r.order_number) return String(r.order_number);
    const direct = orderNumberByRenderId?.[r.id];
    if (direct) return direct;
    for (const mid of (r._mergedIds || [])) {
      if (orderNumberByRenderId?.[mid]) return orderNumberByRenderId[mid];
    }
    // Fallback: the purchase webhooks stamp the order number into the design's
    // admin_notes (wpw_order_number / order_number) at production-pack purchase
    // time, so the badge shows even before/without a proof_approvals link.
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
  // Deep link: auto-select render from ?id= param
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (deepLinkId && renders && !selectedRender) {
      // Direct ID match first, then check _mergedIds for renders that were merged
      const found = renders.find((r: any) =>
        r.id === deepLinkId || (r._mergedIds && r._mergedIds.includes(deepLinkId))
      );
      if (found) {
        setSelectedRender(found);
        setCurrentViewIndex(0);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    }
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
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("approvepro-versions", {
          body: { proof_id: bridgeProofId },
        });
        if (error) throw error;
        const versions = (data?.versions || []) as any[];
        const active = versions.find((v) => v.is_active) || versions[0];
        const urls = (active?.render_urls || {}) as Record<string, unknown>;
        // Keep only string URLs — render_urls also carries non-view keys like
        // panel_dimensions (an object) which getViews already ignores.
        const cleanUrls: Record<string, string> = {};
        for (const [k, v] of Object.entries(urls)) {
          if (typeof v === "string" && v) cleanUrls[k] = v;
        }
        if (!active || Object.keys(cleanUrls).length === 0) {
          toast.error("Couldn't load this proof's current design to edit.");
          return;
        }
        // Carry the CUSTOMER-UPLOADED reference items (logos, example photos the
        // customer submitted) into the editor. approvepro-versions returns them as
        // signed URLs in `customer_uploads` / `context_assets`; seed them onto the
        // synthetic render's admin_notes so getVisionBoardImageUrls() returns them
        // and revise-render edits WITH the customer's references instead of without.
        // Previously this bridge read only render_urls, so the uploads were dropped.
        const refUrls: string[] = [
          ...((data?.customer_uploads || []) as any[]).map((u) => u?.url),
          ...((data?.context_assets || []) as any[]).map((u) => u?.url),
        ].filter((u): u is string => typeof u === "string" && !!u);
        const synthetic = {
          id: deepLinkId || `proof-${bridgeProofId}`,
          render_urls: cleanUrls,
          vehicle_year: Number(searchParams.get("v_year")) || 0,
          vehicle_make: searchParams.get("v_make") || "",
          vehicle_model: searchParams.get("v_model") || "",
          vehicle_type: "",
          mode_type: "designpanelpro",
          color_name: searchParams.get("v_name") || active?.prompt_text || "Customer Design",
          finish_type: "gloss",
          created_at: active?.created_at || new Date().toISOString(),
          ...(refUrls.length > 0
            ? { admin_notes: JSON.stringify({ visionboard_image_urls: refUrls }) }
            : {}),
        };
        setSelectedRender(synthetic);
        setCurrentViewIndex(0);
        window.scrollTo({ top: 0, behavior: "smooth" });
      } catch (e: any) {
        console.warn("[RevisionIQ] ApprovePro bridge load failed:", e?.message || e);
        toast.error("Couldn't load this proof's design — try reopening from ApprovePro.");
      }
    })();
  }, [bridgeProofId, deepLinkId, renders, selectedRender, searchParams]);

  // When opened from an ApprovePro order (?proof_id=...), pre-fill the revision
  // box with the customer's note from that order so the shop doesn't re-type the
  // requested edits — they can tweak it and hit Regenerate. Best-effort, once,
  // and never overwrites text the shop has already typed.
  const notePrefilledRef = useRef(false);
  useEffect(() => {
    if (!bridgeProofId || notePrefilledRef.current) return;
    notePrefilledRef.current = true;
    (async () => {
      try {
        const { data } = await supabase
          .from("proof_approvals" as any)
          .select("metadata")
          .eq("id", bridgeProofId)
          .maybeSingle();
        const md = ((data as any)?.metadata || {}) as Record<string, any>;
        const note =
          (typeof md.order_customer_note === "string" && md.order_customer_note) ||
          (typeof md.customer_note === "string" && md.customer_note) ||
          (typeof md.line_item_brief === "string" && md.line_item_brief) ||
          "";
        if (note) setRevisionNotes((prev) => (prev && prev.trim() ? prev : note));
      } catch {
        /* best-effort — leave the box empty if the note can't be read */
      }
    })();
  }, [bridgeProofId]);

  // ---------------------------------------------------------------------------
  // Hydrate missing views from the linked design generation + sibling rows.
  // A design can have several color_visualizations rows (hero-only siblings,
  // "restored" rows, the full-set row). If RevisionStudio opens a row that's
  // missing angles, it would show "7/7 missing" and wastefully regenerate views
  // that already exist on a sibling. This pulls the existing angles in for
  // DISPLAY (never deletes/overwrites) so the user sees what's really there.
  useEffect(() => {
    const r = selectedRender;
    if (!r) return;
    const urls = (r.render_urls || {}) as Record<string, string>;
    if (Object.keys(urls).length >= 7) return; // already complete
    let genId: string | null = null;
    try { genId = JSON.parse(r.admin_notes || "{}")?.designiq_generation_id || null; } catch { /* not JSON */ }
    if (!genId) return;
    let cancelled = false;
    (async () => {
      const merged: Record<string, string> = { ...urls };
      // a) the linked design generation's saved angles
      const { data: g } = await supabase
        .from("designiq_generations")
        .select("render_urls")
        .eq("id", genId)
        .maybeSingle();
      const gUrls = ((g as any)?.render_urls || {}) as Record<string, string>;
      for (const [k, v] of Object.entries(gUrls)) if (!merged[k] && v) merged[k] = v as string;
      // b) sibling color_visualizations rows for the same generation
      const { data: sibs } = await supabase
        .from("color_visualizations")
        .select("render_urls, admin_notes")
        .filter("admin_notes", "ilike", `%${genId}%`)
        .limit(15);
      for (const s of sibs || []) {
        const sUrls = ((s as any)?.render_urls || {}) as Record<string, string>;
        for (const [k, v] of Object.entries(sUrls)) if (!merged[k] && v) merged[k] = v as string;
      }
      if (!cancelled && Object.keys(merged).length > Object.keys(urls).length) {
        console.log(`[RevisionStudioIQ] Hydrated ${Object.keys(merged).length - Object.keys(urls).length} missing view(s) from generation ${genId}`);
        setSelectedRender((prev: any) => (prev?.id === r.id ? { ...prev, render_urls: merged } : prev));
      }
    })();
    return () => { cancelled = true; };
  }, [selectedRender?.id]);

  // ---------------------------------------------------------------------------
  // Fetch version chain for selected render
  // ---------------------------------------------------------------------------
  const { data: versionChain } = useQuery({
    queryKey: ["version-chain", selectedRender?.id],
    queryFn: async () => {
      if (!selectedRender) return [];

      const baseName = (selectedRender.design_file_name || selectedRender.color_name || "")
        .replace(/\s*\(V\d+\)$/, "");

      // Accumulate every related render by id. Two independent signals feed it:
      //   1. NAME match (legacy behavior — kept as a base/fallback).
      //   2. STABLE-ID lineage — walk admin_notes.version.parent_id up to the
      //      root and back down through descendants. This is what makes "pull
      //      past renders" reliable: it follows the actual parent→child chain,
      //      so versions whose NAME drifted ("Cyber" vs "Cybertruck") or were
      //      saved under the order number ("Order RP-100926") still link up.
      const byId = new Map<string, any>();
      const add = (r: any) => { if (r?.id && !byId.has(r.id)) byId.set(r.id, r); };
      add(selectedRender);

      // (1) Name-matched candidates — SKIPPED when baseName is empty (an empty
      // ilike %% matches EVERY completed render of the make/model — a pure
      // same-vehicle fallback that polluted chains).
      const { data: nameData, error } = !baseName.trim()
        ? { data: [], error: null as any }
        : await supabase
        .from("color_visualizations")
        .select("*")
        .eq("vehicle_make", selectedRender.vehicle_make)
        .eq("vehicle_model", selectedRender.vehicle_model)
        // Accept BOTH status spellings — legacy rows use "complete", new ones
        // "completed". Requiring exact "completed" silently emptied the whole
        // version timeline (missing history cards/prompts/timestamps).
        .in("generation_status", ["completed", "complete"])
        .or(`design_file_name.ilike.%${baseName}%,color_name.ilike.%${baseName}%`)
        .order("created_at", { ascending: true });
      if (error && byId.size === 1) return [selectedRender];
      (nameData || []).forEach(add);

      // (2) Stable-ID lineage walk (parent_id chain) — additive, bounded.
      try {
        // a) Ancestors: follow parent_id up from the selected render, fetching
        //    any ancestor we don't already have.
        let cur: any = selectedRender;
        const seenUp = new Set<string>();
        for (let i = 0; i < 30 && cur && !seenUp.has(cur.id); i++) {
          seenUp.add(cur.id);
          const parentId = parseVersionInfo(cur).parentId;
          if (!parentId) break;
          let parent = byId.get(parentId);
          if (!parent) {
            const { data: p } = await supabase
              .from("color_visualizations").select("*").eq("id", parentId).maybeSingle();
            if (!p) break;
            add(p);
            parent = p;
          }
          cur = parent;
        }
        // b) Descendants: rows whose admin_notes reference a KNOWN lineage id.
        //    The ilike can match other fields, so we only keep rows whose actual
        //    parent_id resolves into the lineage. Loop a few rounds for
        //    grandchildren; stop as soon as a round adds nothing.
        for (let round = 0; round < 6; round++) {
          const ids = Array.from(byId.keys()).slice(-25); // cap OR length
          const orFilter = ids.map((id) => `admin_notes.ilike.%${id}%`).join(",");
          if (!orFilter) break;
          const { data: kids } = await supabase
            .from("color_visualizations").select("*")
            .in("generation_status", ["completed", "complete"])
            .or(orFilter)
            .limit(100);
          const before = byId.size;
          (kids || []).forEach((k: any) => {
            const pid = parseVersionInfo(k).parentId;
            if (pid && byId.has(pid)) add(k);
          });
          if (byId.size === before) break;
        }
      } catch { /* non-fatal — keep whatever the name match + ancestors found */ }

      // (3) Stable lineage_root_id — the authoritative grouping. Every version of
      // a design shares it (DB trigger + backfill), so this pulls the WHOLE
      // lineage by one id regardless of name drift or order-number naming. The
      // root resolves from the selected render, or from the topmost ancestor the
      // parent-walk reached. Additive — unioned into the same id map.
      try {
        const rootId =
          selectedRender.lineage_root_id ||
          Array.from(byId.values()).map((r: any) => r.lineage_root_id).find(Boolean) ||
          null;
        if (rootId) {
          const { data: byRoot } = await supabase
            .from("color_visualizations")
            .select("*")
            .in("generation_status", ["completed", "complete"])
            .or(`lineage_root_id.eq.${rootId},id.eq.${rootId}`)
            .limit(100);
          (byRoot || []).forEach(add);
        }
      } catch { /* non-fatal */ }

      const all = Array.from(byId.values())
        .sort((a: any, b: any) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime());

      // When the selected design has a durable root, it is authoritative.
      // Do not keep additive same-name matches from another customer's design.
      const selectedRootId = selectedRender.lineage_root_id || null;
      if (selectedRootId) {
        const exactLineage = all.filter(
          (row: any) => row.id === selectedRootId || row.lineage_root_id === selectedRootId,
        );
        return exactLineage.length > 0 ? exactLineage : [selectedRender];
      }

      // Legacy rows without lineage_root_id still have parent_id. Keep only
      // the selected row's connected parent tree for every product; a shared
      // vehicle/name is presentation text, never evidence of version lineage.
      const lineageMap = new Map(all.map((row: any) => [row.id, row]));
      const parentRootOf = (row: any): string => {
        let current = row;
        const seen = new Set<string>();
        while (current && !seen.has(current.id)) {
          seen.add(current.id);
          const parentId = parseVersionInfo(current).parentId;
          if (parentId && lineageMap.has(parentId)) current = lineageMap.get(parentId);
          else break;
        }
        return current?.id ?? row.id;
      };
      const selectedParentRoot = parentRootOf(selectedRender);
      const exactLegacyLineage = all.filter(
        (row: any) => parentRootOf(row) === selectedParentRoot,
      );
      return exactLegacyLineage.length > 0 ? exactLegacyLineage : [selectedRender];
    },
    enabled: !!selectedRender,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Revision Studio (Option B) shared timeline. design_version_commits is the
  // linear source-of-truth timeline, keyed by the DesignIQ generation id — the
  // SAME job_id production_flow_assets and the /design-assets admin page use.
  // We resolve each lineage render's generation id from its admin_notes and read
  // every commit across the chain, so this page surfaces the SAME version data
  // any other surface records/reads via @/lib/revision-commits. RevisionStudioIQ
  // stays its own page but shares the versions rather than owning a private copy.
  const genIdOf = useCallback((row: any): string | null => {
    if (!row) return null;
    try { return JSON.parse(row.admin_notes || "{}").designiq_generation_id || null; }
    catch { return null; }
  }, []);

  const submitSavedRevision = useCallback(async ({
    render,
    trigger,
    change,
  }: {
    render: any;
    trigger: EnticeRevisionTrigger;
    change: {
      type: "generate" | "edit" | "revision";
      prompt?: string | null;
      viewKeys?: string[];
    };
  }) => {
    if (!render?.id) throw new Error("No saved design is selected");
    const { data: frozen, error } = await supabase
      .from("color_visualizations")
      .select("id, updated_at, admin_notes")
      .eq("id", render.id)
      .single();
    if (error || !frozen?.updated_at) {
      throw error || new Error("The saved revision could not be frozen");
    }
    let generationId: string | undefined;
    try {
      const notes =
        typeof frozen.admin_notes === "string"
          ? JSON.parse(frozen.admin_notes)
          : frozen.admin_notes || {};
      generationId =
        typeof notes.designiq_generation_id === "string"
          ? notes.designiq_generation_id
          : undefined;
    } catch {
      generationId = undefined;
    }
    return await submitEnticeRevision({
      visualizationId: frozen.id,
      expectedUpdatedAt: frozen.updated_at,
      generationId,
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
    trigger: EnticeRevisionTrigger;
    change: {
      type: "generate" | "edit" | "revision";
      prompt?: string | null;
      viewKeys?: string[];
    };
    patch?: Record<string, unknown>;
  }) => {
    if (!render?.id) throw new Error("No saved design is selected");
    // ALWAYS re-read updated_at, never trust the caller's copy (2026-07-30).
    //
    // This used to re-read ONLY when render.updated_at was blank. Every other
    // call passed the render object held in React state / the query cache,
    // whose updated_at was captured when the job was opened — before the hero
    // and the six view renders each rewrote that same color_visualizations row.
    // save_and_enqueue_designpro_revision locks FOR UPDATE and compares, so the
    // stale value raised revision_source_changed and the ENTIRE commit rolled
    // back.
    //
    // That is why "it had all 7 angles" became "6 of 7 views missing" on
    // reopen: generateMissingViews accumulates every rendered view in React
    // state (mergedRenderUrls) and persists them in exactly ONE commit here.
    // When this commit is refused, all six views are lost with the tab — the
    // pixels were rendered and paid for, and nothing was written. Live
    // 2026-07-30: color_visualizations 80560ba1 held 1 view ("side") while two
    // uninterrupted jobs from the same day held all 7.
    //
    // Re-reading does not weaken the guard: the RPC still locks FOR UPDATE and
    // re-checks. It only stops us submitting a value we can already see is out
    // of date.
    let source = render;
    {
      const { data: current, error } = await supabase
        .from("color_visualizations")
        .select("id, updated_at, admin_notes, render_urls")
        .eq("id", render.id)
        .single();
      if (error || !current?.updated_at) {
        throw error || new Error("The edited revision could not be resolved");
      }
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
    const accepted = await saveEnticeRevision({
      visualizationId: source.id,
      expectedUpdatedAt: source.updated_at,
      renderUrls,
      adminNotesPatch,
      vehicleType:
        patch.vehicle_type === undefined
          ? undefined
          : String(patch.vehicle_type || ""),
      finishType:
        patch.finish_type === undefined
          ? undefined
          : String(patch.finish_type || ""),
      generationId,
      trigger,
      change,
    });
    const mergedNotes = { ...existingNotes, ...adminNotesPatch };
    const saved = {
      id: source.id,
      updated_at: accepted.updatedAt,
      render_urls: renderUrls,
      admin_notes: JSON.stringify(mergedNotes),
    };
    setSelectedRender((previous: any) =>
      previous?.id === source.id
        ? {
            ...previous,
            render_urls: renderUrls,
            updated_at: accepted.updatedAt,
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
  // the color_visualizations row can miss (RecreatePro clones), and then Build
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
  const lineageCommitIds = useMemo(
    () => Array.from(new Set([
      ...(versionChain || []).map(genIdOf),
      ...(versionChain || []).map((row: any) => row?.id),
    ].filter(Boolean))) as string[],
    [versionChain, genIdOf]
  );
  const { data: versionCommits } = useQuery<VersionCommit[]>({
    queryKey: ["version-commits", lineageCommitIds],
    queryFn: () => getVersionCommits(lineageCommitIds),
    enabled: lineageCommitIds.length > 0,
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
      // a/b. Resolve the target proof: most-recent row matching the order # under
      // any of the metadata keys ApprovePro uses, tried in order.
      const metaKeys = ["wpw_order_number", "wpw_woo_order_id", "order_number"];
      let foundProof: { id: string; mode: string; status: string } | null = null;
      for (const key of metaKeys) {
        const { data, error } = await supabase
          .from("proof_approvals" as any)
          .select("id, mode, status")
          .ilike(`metadata->>${key}`, `%${digits}%`)
          .order("created_at", { ascending: false })
          .limit(1);
        if (!error && data && data.length) {
          foundProof = data[0] as any;
          break;
        }
      }
      if (!foundProof) {
        toast.error(`No ApprovePro order found for #${digits}`);
        return;
      }

      // c. Clone the current design's render set.
      const render_urls: Record<string, string> = { ...((selectedRender.render_urls as Record<string, string>) || {}) };
      if (!render_urls || Object.keys(render_urls).length === 0) {
        toast.error("This design has no renders to push");
        return;
      }

      // Resolve this design's 2D proof URL the SAME way InlineStoredProof does:
      // admin_notes.flat_proof_url first (re-read fresh from the DB), then the
      // linked designiq_generations.flat_proof_url. Only accept a real proof URL.
      const isProofUrl = (u: any) => typeof u === "string" && /proof/i.test(u);
      let proofUrl: string | null = null;
      try {
        let notes: Record<string, any> = {};
        try { notes = selectedRender.admin_notes ? JSON.parse(selectedRender.admin_notes) : {}; } catch { /* not JSON */ }
        if (selectedRender.id) {
          const { data: vizRow } = await supabase
            .from("color_visualizations")
            .select("admin_notes")
            .eq("id", selectedRender.id)
            .maybeSingle();
          if ((vizRow as any)?.admin_notes) {
            try { notes = JSON.parse((vizRow as any).admin_notes); } catch { /* keep in-memory */ }
          }
        }
        if (isProofUrl(notes?.flat_proof_url)) {
          proofUrl = notes.flat_proof_url as string;
        } else {
          const genId: string | null = notes?.designiq_generation_id || null;
          if (genId) {
            const { data } = await supabase
              .from("designiq_generations" as any)
              .select("flat_proof_url")
              .eq("id", genId)
              .maybeSingle();
            if (isProofUrl((data as any)?.flat_proof_url)) proofUrl = (data as any).flat_proof_url as string;
          }
        }
      } catch { /* proof resolution is best-effort; fall back to existing key */ }

      // Prefer a freshly resolved proof; else keep any production_proof already
      // on the render set.
      if (proofUrl) render_urls.production_proof = proofUrl;
      // Mirror a hero from the side view if the set has no hero.
      if (!render_urls.hero && render_urls.side) render_urls.hero = render_urls.side;

      // d. Source visualization id for this design.
      const vizId = genIdOf(selectedRender) || selectedRender.id;

      // e. Set it as the proof's active version.
      const { error: saveErr } = await supabase.functions.invoke("proof-save-version", {
        body: {
          proof_id: foundProof.id,
          render_urls,
          shop_message: "Pushed from Revision Studio",
        },
        headers: { "Idempotency-Key": `rspush-${foundProof.id}-${Date.now()}` },
      });
      if (saveErr) {
        let msg = (saveErr as any)?.message || "Failed to save version";
        try {
          const body = await (saveErr as any)?.context?.json?.();
          if (body?.error) msg = body.error;
        } catch { /* keep generic message */ }
        toast.error(msg);
        return;
      }

      // f. Point the proof's source visualization at this design.
      await supabase
        .from("proof_approvals" as any)
        .update({ source_visualization_id: vizId })
        .eq("id", foundProof.id);

      // g. Done.
      toast.success(`Pushed design to ApprovePro order #${digits}`);
      setPushOrderNo("");
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

      // Pre-validate: ensure source has render URLs before cloning
      const isMyVehicle = isMyVehicleRender(sourceRender);
      const sourceUrls = (sourceRender.render_urls || {}) as Record<string, string>;
      const revisionViewKey = currentViewKey || "side";
      const sourceOriginalUrl = (currentViewKey && sourceUrls[currentViewKey]) || sourceUrls.side || sourceUrls.hero || sourceUrls["driver-side"] || Object.values(sourceUrls)[0] || null;

      if (!sourceOriginalUrl && !isMyVehicle) {
        throw new Error("No render image found for this design - cannot revise. Try generating a fresh render first.");
      }

      // Step 1: Clone the record.
      // color_visualizations has several NOT NULL columns (customer_email,
      // color_hex, color_name, finish_type, vehicle_year/make/model). Synthesized
      // rows (GraphicsPro / designiq jobs surfaced in the grid) and pre-fix
      // recreates can have nulls there, which made the clone insert fail with
      // "null value ... violates not-null constraint". Fall back to safe values
      // (and the logged-in user's email) so any design can be revised.
      const { data: { user: cloneUser } } = await supabase.auth.getUser();
      const safeCloneYear = parseInt(resolvedVehicle.year) || sourceRender.vehicle_year || 2024;
      const { data: clonedRecord, error } = await supabase
        .from("color_visualizations")
        .insert({
          customer_email: sourceRender.customer_email || cloneUser?.email || null,
          vehicle_year: safeCloneYear,
          vehicle_make: resolvedVehicle.make || sourceRender.vehicle_make || "",
          vehicle_model: resolvedVehicle.model || sourceRender.vehicle_model || "",
          vehicle_type: sourceRender.vehicle_type,
          color_hex: sourceRender.color_hex || "#000000",
          color_name: sourceRender.color_name || sourceRender.design_file_name || "Custom",
          finish_type: sourceRender.finish_type || "Gloss",
          mode_type: sourceRender.mode_type,
          render_urls: sourceRender.render_urls,
          custom_design_url: sourceRender.custom_design_url,
          custom_swatch_url: sourceRender.custom_swatch_url,
          custom_styling_prompt_key: sourceRender.custom_styling_prompt_key,
          uses_custom_design: sourceRender.uses_custom_design,
          design_file_name: `${baseName} (V${newVersion})`,
          // Keep this browser-created shell out of completed galleries until
          // the atomic save+enqueue transaction accepts the final frozen
          // pixels. A closed tab can leave only a hidden processing shell,
          // never a visible completed revision without its workflow.
          generation_status: "processing",
          subscription_tier: sourceRender.subscription_tier,
          organization_id: sourceRender.organization_id,
          admin_notes: JSON.stringify(versionMeta),
        } as any)
        .select()
        .single();

      if (error) {
        console.error("[RevisionIQ] Clone insert failed:", error.message, error);
        throw error;
      }
      console.log(`[RevisionIQ] Clone created: ${clonedRecord.id} as V${newVersion}`);

      // Step 2: Re-render with the effective prompt
      // Determine the effective prompt for the render:
      // - If user typed revision notes, use those
      // - If Restyle on New Vehicle (vehicleOverride + empty notes), use originalPrompt
      const isRestyleOnNewVehicle = !!vehicleOverride && !notes.trim();
      const panelPrefix = panelTargets && panelTargets.length > 0
        ? `Apply ONLY to ${panelTargets.map(k => PANEL_TARGETS.find(p => p.key === k)?.label || k).join(", ")}. `
        : "";
      const effectivePrompt = notes.trim()
        ? panelPrefix + notes
        : (isRestyleOnNewVehicle ? (originalPrompt || `Restyle this wrap design on a ${resolvedVehicle.year} ${resolvedVehicle.make} ${resolvedVehicle.model}`) : "");

      // A pure logo/element reposition (Canva-style drag, no typed note) has an
      // EMPTY effectivePrompt. Without this it skipped the whole composite+save
      // block below, so moving the logo "didn't save" — the #1 edit complaint.
      // The non-MyVehicle branch already composites the placed layers and falls
      // back to revisionPrompt "Place logos as marked", so entering the block
      // with no text but placed layers correctly renders and versions the move.
      // MyVehicle edits go through edit-vehicle-photo (needs a text prompt), not
      // the layer-compositing path — so only treat placed layers as a saveable
      // edit on the standard render path.
      const hasPlacedLayersForView = !isMyVehicle && (logoLayersArg?.[revisionViewKey] || []).some((l) => l.placement);

      console.log(`[RevisionIQ] cloneAndRevise step 2 - notes: "${notes.substring(0, 40)}" | isRestyle: ${isRestyleOnNewVehicle} | layerOnly: ${!effectivePrompt && hasPlacedLayersForView} | effectivePrompt: "${effectivePrompt.substring(0, 80)}..." | originalPrompt: "${(originalPrompt || "").substring(0, 40)}..."`);

      if (effectivePrompt || hasPlacedLayersForView) {
        let newRenderUrl: string | null = null;
        let revisionError: string | null = null;
        // Plain-English "here's what I changed" the AI reports back (designer
        // work-order readback). Captured from revise-render and shown to the user.
        let aiEditSummary: string | null = null;

        try {
          if (isMyVehicle) {
            // MyVehicle: Re-edit the previous render image via edit-vehicle-photo
            const { data: { user: currentUser } } = await supabase.auth.getUser();
            const email = currentUser?.email || sourceRender.customer_email;
            const previousUrl = sourceUrls.myvehicle_edit || null;
            const colorData = buildColorDataFromRender(sourceRender);
            colorData.revisionPrompt = effectivePrompt;

            const { data: renderData, error: renderError } = await invokeWithFreshAuth("edit-vehicle-photo", {
              userEmail: email,
              uploadedPhotoUrl: previousUrl,
              colorData,
              vehicleInfo: {
                year: resolvedVehicle.year,
                make: resolvedVehicle.make,
                model: resolvedVehicle.model,
              },
              // The clone row below is the versioned record — don't let the
              // edge function insert a second, un-versioned duplicate.
              persistRender: false,
            });
            if (renderError) {
              revisionError = renderError.message || "edit-vehicle-photo failed";
            } else {
              newRenderUrl = renderData?.renderUrl || null;
            }
          } else if (isRestyleOnNewVehicle) {
            // Restyle on New Vehicle: Re-generate using the original tool (not revise-render)
            // This produces a fresh render of the same design on the new vehicle
            const isDesignPro = sourceRender.mode_type === "designpanelpro" || sourceRender.mode_type === "designpro";
            console.log(`[RevisionIQ] Restyle on New Vehicle: ${resolvedVehicle.year} ${resolvedVehicle.make} ${resolvedVehicle.model} | isDesignPro: ${isDesignPro} | prompt: "${effectivePrompt.substring(0, 80)}..."`);
            if (isDesignPro) {
              const designIQ = await getDesignIQModeAndDetails(sourceRender);
              const { data: renderData, error: renderError } = await invokeWithFreshAuth("design-panel-ai-generate", {
                mode: designIQ.mode,
                prompt: effectivePrompt,
                finish: sourceRender.finish_type || "Gloss",
                viewType: revisionViewKey,
                vehicleYear: resolvedVehicle.year,
                vehicleMake: resolvedVehicle.make,
                vehicleModel: resolvedVehicle.model,
                ...(designIQ.mode === "commercial" ? {
                  companyName: designIQ.companyName,
                  phone: designIQ.phone,
                  mascot: designIQ.mascot,
                  industryType: designIQ.industryType,
                  bulletPoints: designIQ.bulletPoints,
                } : {}),
              });
              console.log(`[RevisionIQ] design-panel-ai-generate response:`, { hasData: !!renderData, renderUrl: renderData?.renderUrl?.substring(0, 60), panelUrl: renderData?.panel?.media_url?.substring(0, 60), error: renderError?.message });
              if (renderError) {
                revisionError = renderError.message || "design-panel-ai-generate failed";
              } else {
                newRenderUrl = renderData?.renderUrl || renderData?.panel?.media_url || null;
              }
            } else {
              // ColorPro, FadeWraps, WBTY, etc. - use generate-color-render
              const { data: { user: currentUser2 } } = await supabase.auth.getUser();
              const email = currentUser2?.email || sourceRender.customer_email || "";
              const colorData = buildColorDataFromRender(sourceRender);
              const { data: renderData, error: renderError } = await invokeWithFreshAuth("generate-color-render", {
                vehicleYear: resolvedVehicle.year,
                vehicleMake: resolvedVehicle.make,
                vehicleModel: resolvedVehicle.model,
                modeType: sourceRender.mode_type || "colorpro",
                viewType: revisionViewKey,
                userEmail: email,
                customStylingPrompt: effectivePrompt,
                colorData,
              });
              console.log(`[RevisionIQ] generate-color-render response:`, { hasData: !!renderData, renderUrl: renderData?.renderUrl?.substring(0, 60), error: renderError?.message });
              if (renderError) {
                revisionError = renderError.message || "generate-color-render failed";
              } else {
                newRenderUrl = renderData?.renderUrl || null;
              }
            }
          } else {
            // All non-MyVehicle modes: Use dedicated revise-render function.
            //
            // IMPORTANT: We do NOT pass previousRevisions. Gemini has the
            // current image attached and can see the current state. Sending
            // prior-version prompts as text causes cross-view token pollution
            // (a text edit made on the front view was bleeding onto rear-view
            // revisions because "OPTIMIZE HUMANS" appeared in the history
            // string). The SCOPE LOCK in buildCondensedRevisionPrompt handles
            // preservation visually, not textually.
            const storedVbUrls = await getVisionBoardImageUrls(sourceRender);
            // Freshly-uploaded "example / supporting edit" images (from the
            // inline upload at the revision box) take priority — the customer
            // attached them FOR this specific revision. Put them first and
            // flag the revision so the AI matches them even if the typed words
            // don't explicitly say "like this picture".
            const uploadedVbUrls = (visionBoardImages || []).map((v) => v.storageUrl).filter(Boolean);
            const vbImageUrls = [...uploadedVbUrls, ...storedVbUrls.filter((u) => !uploadedVbUrls.includes(u))];
            const hasUploadedExample = uploadedVbUrls.length > 0;
            // Collect sibling view URLs so Gemini can see AI-generated assets from other angles
            const siblingViewUrls: string[] = Object.entries(sourceUrls)
              .filter(([key, url]) => key !== revisionViewKey && url)
              .slice(0, 2) // Max 2 siblings to avoid payload bloat
              .map(([, url]) => url);

            // ── Logo placement branch ────────────────────────────────
            // If the user placed any logo layers on the current view (uploaded
            // or extracted), composite the (clean background or original) +
            // every placed layer into a single PNG and use logo-placement mode.
            const placedLayersForView = (logoLayersArg?.[revisionViewKey] || [])
              .filter((l) => l.placement)
              .map<PlacedLayer>((l) => ({
                id: l.id,
                cleanedUrl: l.sourceUrl,
                xPct: l.placement!.xPct,
                yPct: l.placement!.yPct,
                size: l.placement!.size,
                sizePercent: l.placement!.sizePercent,
                rotationDeg: l.placement!.rotationDeg,
              }));
            const baseRenderUrl = cleanBgsArg?.[revisionViewKey] || sourceOriginalUrl;
            const useLogoPlacement = placedLayersForView.length > 0;

            let compositeUrl: string | null = null;
            if (useLogoPlacement) {
              if (!currentUserId || !baseRenderUrl) {
                throw new Error(
                  "The exact layer composite could not be prepared. Reopen the design and retry. No AI redesign was started.",
                );
              }
              try {
                const blob = await composeRenderWithLayers(baseRenderUrl, placedLayersForView);
                compositeUrl = await uploadCompositeRender(blob, currentUserId);
                console.log(`[RevisionIQ] Logo composite uploaded: ${compositeUrl?.substring(0, 80)}...`);
              } catch (compErr) {
                console.error("[RevisionIQ] Exact logo composite failed:", compErr);
                throw new Error(
                  "The exact layer composite could not be saved. Your design was left unchanged and no AI redesign was started.",
                );
              }
              if (!compositeUrl) {
                throw new Error(
                  "The exact layer composite returned no image. Your design was left unchanged and no AI redesign was started.",
                );
              }
            }

            // A pure Move/Delete layer save is already complete once the exact
            // clean-base + overlay composite is uploaded. Never send those
            // customer-approved pixels through the full-image revise-render
            // producer. Text-driven design revisions retain their existing AI
            // path, but a missing exact composite always fails closed above.
            const isExactLayerOnlyEdit = useLogoPlacement && !effectivePrompt;
            if (isExactLayerOnlyEdit) {
              newRenderUrl = compositeUrl;
              aiEditSummary = "Applied the exact layer placement without an AI redesign.";
            } else {
              const reviseSourceUrl = compositeUrl || baseRenderUrl;
              console.log(`[RevisionIQ] Calling revise-render for ${revisionViewKey} | mode: ${useLogoPlacement && compositeUrl ? "logo-placement" : "standard"} | layers: ${placedLayersForView.length} | sourceUrl: ${reviseSourceUrl?.substring(0, 60)}...`);
              const { data: renderData, error: renderError } = await invokeWithFreshAuth("revise-render", {
                originalRenderUrl: reviseSourceUrl,
                revisionPrompt: effectivePrompt,
                toolType: sourceRender.mode_type || "colorpro",
                viewType: revisionViewKey,
                vehicleYear: resolvedVehicle.year,
                vehicleMake: resolvedVehicle.make,
                vehicleModel: resolvedVehicle.model,
                originalPrompt: originalPrompt || undefined,
                visionBoardImageUrls: vbImageUrls.length > 0 ? vbImageUrls : undefined,
                siblingViewUrls: siblingViewUrls.length > 0 ? siblingViewUrls : undefined,
                // The customer explicitly uploaded an example for this edit →
                // attach it as the reference to match, regardless of wording.
                ...(hasUploadedExample ? { forceReferenceMatch: true } : {}),
                ...(useLogoPlacement && compositeUrl
                  ? { mode: "logo-placement", logoLayerCount: placedLayersForView.length }
                  : {}),
              }, VIEW_RENDER_TIMEOUT_MS);
              console.log(`[RevisionIQ] revise-render response:`, { hasData: !!renderData, renderUrl: renderData?.renderUrl?.substring(0, 60), error: renderError?.message });
              if (renderError) {
                revisionError = renderError.message || "revise-render revision failed";
              } else {
                newRenderUrl = renderData?.renderUrl || null;
                aiEditSummary = renderData?.editSummary || null;
                if (!newRenderUrl) {
                  revisionError = "Edge function returned success but no renderUrl in response";
                  console.error("[RevisionIQ] Response data missing renderUrl:", JSON.stringify(renderData)?.substring(0, 200));
                }
              }
            }
          }
        } catch (renderErr) {
          revisionError = renderErr instanceof Error ? renderErr.message : String(renderErr);
          console.error("Revision re-render failed:", revisionError);
        }

        // Update the cloned record with the new render
        if (newRenderUrl) {
          const existingUrls = (clonedRecord.render_urls || {}) as Record<string, any>;
          const updatedUrls = isMyVehicle
            ? { ...existingUrls, myvehicle_edit: newRenderUrl }
            : { ...existingUrls, [revisionViewKey]: newRenderUrl };

          const updatedNotes = { ...versionMeta, revised: true, revision_render_date: new Date().toISOString(), ...(aiEditSummary ? { ai_edit_summary: aiEditSummary } : {}) };
          let finalRevisionUrls = { ...updatedUrls };
          let finalRevisionNotes = { ...updatedNotes };

          // Apply revision to remaining views if "Apply to All Views" is on
          if (applyToAll && !isMyVehicle) {
            // When the caller hand-picks a scope (targetViewKeys), only the
            // chosen angles get revised — so a hood edit can reach hood_detail +
            // front WITHOUT dragging the rear along. With no explicit scope we
            // fall back to every view (legacy "All Views" behavior).
            const explicitTargets = Array.isArray(targetViewKeys) && targetViewKeys.length > 0
              ? targetViewKeys
              : null;
            const otherViewKeys = Object.keys(existingUrls).filter(
              (k) => k !== revisionViewKey && existingUrls[k] && VIEW_ORDER.includes(k)
                && (explicitTargets ? explicitTargets.includes(k) : true)
            // Driver first, so the passenger mirror below reads the REVISED driver.
            ).sort((a, b) => (a === "side" ? -1 : b === "side" ? 1 : 0));
            if (otherViewKeys.length > 0) {
              console.log(`[RevisionIQ] Apply to All Views: revising ${otherViewKeys.length} additional views`);
              toast.info(`Applying revision to ${otherViewKeys.length} more view${otherViewKeys.length > 1 ? "s" : ""}...`);
              let allViewUrls = { ...updatedUrls };
              for (const viewKey of otherViewKeys) {
                try {
                  // PASSENGER SIDE has exactly ONE producer — producePassengerView,
                  // a deterministic flip of the (just-revised) driver. It NEVER goes
                  // through revise-render: that AI pass keeps returning the driver
                  // orientation ("two driver sides"), and there is no check that can
                  // catch it (a wrong-facing result always comes back under a fresh
                  // URL). A failed mirror is an HONEST GAP — the passenger key is
                  // left untouched for the mirror button / missing-views pass to
                  // recover. Never substitute a generative passenger render here.
                  if (viewKey === "passenger-side") {
                    // Driver is the coupled-pair owner. Its passenger is built
                    // once, after the AI loop, from the final approved Driver.
                    if (revisionViewKey === "side") continue;
                    const driverUrl = allViewUrls["side"] || allViewUrls["hero"] || allViewUrls["driver-side"];
                    const mirrorUrl = driverUrl
                      ? await producePassengerView({
                          driverUrl,
                          uploadDataUrl: uploadDataUrlToStorage,
                          textDetection: {
                            modeType: sourceRender.mode_type || "",
                            prompt: `${originalPrompt || ""} ${effectivePrompt || ""}`,
                          },
                          vehicleYear: resolvedVehicle.year,
                          vehicleMake: resolvedVehicle.make,
                          vehicleModel: resolvedVehicle.model,
                          toolType: sourceRender.mode_type || "designpanelpro",
                          invokeEdgeFunction: invokeWithFreshAuth,
                          logLabel: "RevisionIQ Apply-all",
                        })
                      : null;
                    if (mirrorUrl) {
                      allViewUrls[viewKey] = mirrorUrl;
                      console.log(`[RevisionIQ] Apply-all: passenger-side mirrored from revised driver`);
                    }
                    continue;
                  }
                  const viewSourceUrl = existingUrls[viewKey];
                  const siblingUrls: string[] = Object.entries(allViewUrls)
                    .filter(([k, url]) => k !== viewKey && url)
                    .slice(0, 2)
                    .map(([, url]) => url as string);
                  // See note above — previousRevisions intentionally omitted
                  // to prevent cross-view token pollution in Apply-to-All mode.
                  const { data: viewRenderData, error: viewRenderError } = await invokeWithFreshAuth("revise-render", {
                    originalRenderUrl: viewSourceUrl,
                    revisionPrompt: effectivePrompt,
                    toolType: sourceRender.mode_type || "colorpro",
                    viewType: viewKey,
                    vehicleYear: resolvedVehicle.year,
                    vehicleMake: resolvedVehicle.make,
                    vehicleModel: resolvedVehicle.model,
                    originalPrompt: originalPrompt || undefined,
                    visionBoardImageUrls: (await getVisionBoardImageUrls(sourceRender)).length > 0 ? await getVisionBoardImageUrls(sourceRender) : undefined,
                    siblingViewUrls: siblingUrls.length > 0 ? siblingUrls : undefined,
                  });
                  if (viewRenderError) {
                    console.warn(`[RevisionIQ] Apply-all: ${viewKey} failed:`, viewRenderError.message);
                  } else if (viewRenderData?.renderUrl) {
                    allViewUrls[viewKey] = viewRenderData.renderUrl;
                    console.log(`[RevisionIQ] Apply-all: ${viewKey} revised successfully`);
                  }
                } catch (e) {
                  console.warn(`[RevisionIQ] Apply-all: ${viewKey} error:`, e);
                }
              }
              finalRevisionUrls = allViewUrls;
              finalRevisionNotes = {
                ...updatedNotes,
                revised_view_key: "all",
              };
            }
          }

          // DRIVER + PASSENGER ARE A COUPLED APPROVAL PAIR. A driver revision
          // cannot leave the prior passenger image behind under "This view
          // only"; that stale image may carry the old artwork or even face the
          // driver direction. Rebuild it from the newly approved driver through
          // the one passenger producer. A failure removes the passenger key so
          // the durable workflow sees an honest gap and Build Assets fails
          // closed instead of substituting Driver pixels.
          if (revisionViewKey === "side" && !isMyVehicle) {
            const rebuiltPassenger = await producePassengerView({
              driverUrl: newRenderUrl,
              uploadDataUrl: uploadDataUrlToStorage,
              textDetection: {
                modeType: sourceRender.mode_type || "",
                prompt: `${originalPrompt || ""} ${effectivePrompt || ""}`,
              },
              vehicleYear: resolvedVehicle.year,
              vehicleMake: resolvedVehicle.make,
              vehicleModel: resolvedVehicle.model,
              toolType: sourceRender.mode_type || "designpanelpro",
              invokeEdgeFunction: invokeWithFreshAuth,
              logLabel: "RevisionIQ Driver-pair",
            });
            if (rebuiltPassenger) {
              finalRevisionUrls["passenger-side"] = rebuiltPassenger;
              finalRevisionNotes = {
                ...finalRevisionNotes,
                passenger_rebuilt_from_driver_revision: true,
              };
            } else {
              delete finalRevisionUrls["passenger-side"];
              finalRevisionNotes = {
                ...finalRevisionNotes,
                passenger_honest_gap: true,
              };
            }
          }

          // Freeze what ACTUALLY changed, not every URL present on the row and
          // not the view tab the browser happened to remember. Driver revisions
          // include the coupled Passenger output; unchanged Hood/Roof/etc. are
          // excluded. The server independently recomputes this diff before it
          // hashes and records the immutable revision snapshot.
          const changedViewKeys = changedRevisionSurfaceKeys(sourceUrls, finalRevisionUrls);
          const primaryChangedViewKey = changedViewKeys.includes(revisionViewKey as any)
            ? revisionViewKey
            : changedViewKeys[0] || revisionViewKey;
          finalRevisionNotes = {
            ...finalRevisionNotes,
            revised_view_key: primaryChangedViewKey,
            primary_changed_view_key: primaryChangedViewKey,
            changed_view_keys: changedViewKeys,
            version: {
              ...(finalRevisionNotes.version || {}),
              revised_view_key: primaryChangedViewKey,
              primary_changed_view_key: primaryChangedViewKey,
              changed_view_keys: changedViewKeys,
            },
          };

          // The server workflow now owns every downstream proof, panel, logo,
          // and active-pack transition. Paid jobs are pinned only after that
          // revision verifies, so Revision Studio must not mutate them here.
          // Commit the final view set, metadata, and durable workflow in one
          // authenticated facade call. No intermediate browser update can
          // leave a revised clone saved without its matching workflow.
          const revisionRecord = {
            ...clonedRecord,
            generation_status: "completed",
            render_urls: finalRevisionUrls,
            admin_notes: JSON.stringify(finalRevisionNotes),
          };
          const { saved } = await persistViewRevision({
            render: revisionRecord,
            renderUrls: finalRevisionUrls,
            trigger: "revision_saved",
            change: {
              type: notes.trim() ? "revision" : "edit",
              prompt: effectivePrompt || null,
              viewKeys: changedViewKeys,
            },
            patch: {
              admin_notes: JSON.stringify(finalRevisionNotes),
            },
          });
          return {
            ...revisionRecord,
            render_urls: saved.render_urls,
            admin_notes: saved.admin_notes,
            updated_at: saved.updated_at,
          };
        } else {
          // Revision render failed - delete the clone and throw so onError fires
          await supabase.from("color_visualizations").delete().eq("id", clonedRecord.id);
          const failMsg = revisionError || "Revision render returned no image";
          throw new Error(`Revision failed: ${failMsg}. No clone was created - please try again.`);
        }
      } else {
        // No effectivePrompt - this is a clone-only (no revision or restyle)
        // For restyle, this should NEVER happen
        if (isRestyleOnNewVehicle) {
          console.error("[RevisionIQ] BUG: Restyle on New Vehicle reached clone-only path - effectivePrompt was empty");
          // Still try to render even if effectivePrompt was somehow empty
          toast.warning("Restyle prompt was empty - generating with default prompt");
        }
        console.log("[RevisionIQ] Clone-only (no revision render)");
      }

      const cloneUrls = {
        ...((clonedRecord.render_urls || {}) as Record<string, string>),
      };
      const { saved } = await persistViewRevision({
        render: clonedRecord,
        renderUrls: cloneUrls,
        trigger: "revision_saved",
        change: {
          type: "edit",
          prompt: effectivePrompt || null,
          viewKeys: Object.keys(cloneUrls).sort(),
        },
      });
      return {
        ...clonedRecord,
        generation_status: "completed",
        updated_at: saved.updated_at,
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

      // Refresh session before any DB/edge-function calls to prevent Invalid JWT
      const freshToken = await getFreshAccessToken();
      if (!freshToken) {
        throw new Error("Session expired - please log in again and retry.");
      }

      const isMyVehicle = isMyVehicleRender(render);
      const isDesignPro = render.mode_type === "designpanelpro" || render.mode_type === "designpro";
      const sourceUrls = (render.render_urls || {}) as Record<string, string>;
      const revisionViewKey = currentViewKey || "side";
      const sourceOriginalUrl = (currentViewKey && sourceUrls[currentViewKey]) || sourceUrls.side || sourceUrls.hero || sourceUrls["driver-side"] || Object.values(sourceUrls)[0] || null;

      if (!sourceOriginalUrl && !isMyVehicle) {
        throw new Error("No render image found for this design - cannot revise. Try generating a fresh render first.");
      }

      const resolvedVehicle = {
        year: String(render.vehicle_year),
        make: render.vehicle_make,
        model: render.vehicle_model,
      };

      let newRenderUrl: string | null = null;

      if (isMyVehicle) {
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        const email = currentUser?.email || render.customer_email;
        const previousUrl = sourceUrls.myvehicle_edit || null;
        const colorData = buildColorDataFromRender(render);
        colorData.revisionPrompt = notes;

        const { data: renderData, error: renderError } = await invokeWithFreshAuth("edit-vehicle-photo", {
          userEmail: email,
          uploadedPhotoUrl: previousUrl,
          colorData,
          vehicleInfo: resolvedVehicle,
          // In-place revision updates the existing row — don't let the edge
          // function insert a separate duplicate.
          persistRender: false,
        });
        if (renderError) throw new Error(renderError.message || "edit-vehicle-photo failed");
        newRenderUrl = renderData?.renderUrl || null;
      } else {
        // All non-MyVehicle modes: Use dedicated revise-render function.
        // previousRevisions intentionally omitted — see note in the clone path
        // above for the cross-view token pollution rationale.
        const existingNotesParsed = (() => {
          try { return JSON.parse(render.admin_notes || "{}"); } catch { return {}; }
        })();
        const origPrompt = existingNotesParsed.original_prompt || render.custom_styling_prompt_key || "";

        // Fetch VisionBoard image URLs so reference images persist across revisions
        const vbImageUrls = await getVisionBoardImageUrls(render);
        // Collect sibling view URLs so Gemini can see AI-generated assets from other angles
        const siblingViewUrls: string[] = Object.entries(sourceUrls)
          .filter(([key, url]) => key !== revisionViewKey && url)
          .slice(0, 2)
          .map(([, url]) => url);
        console.log(`[RevisionIQ] Calling revise-render (in-place) for ${revisionViewKey} | prompt: "${targetedNotes.substring(0, 60)}..." | visionBoard: ${vbImageUrls.length} | siblingViews: ${siblingViewUrls.length}`);
        const { data: renderData, error: renderError } = await invokeWithFreshAuth("revise-render", {
          originalRenderUrl: sourceOriginalUrl,
          revisionPrompt: targetedNotes,
          toolType: render.mode_type || "colorpro",
          viewType: revisionViewKey,
          vehicleYear: resolvedVehicle.year,
          vehicleMake: resolvedVehicle.make,
          vehicleModel: resolvedVehicle.model,
          originalPrompt: origPrompt || undefined,
          visionBoardImageUrls: vbImageUrls.length > 0 ? vbImageUrls : undefined,
          siblingViewUrls: siblingViewUrls.length > 0 ? siblingViewUrls : undefined,
        }, VIEW_RENDER_TIMEOUT_MS);
        console.log(`[RevisionIQ] revise-render (in-place) response:`, { hasData: !!renderData, renderUrl: renderData?.renderUrl?.substring(0, 60), error: renderError?.message });
        if (renderError) throw new Error(renderError.message || "revise-render revision failed");
        newRenderUrl = renderData?.renderUrl || null;
      }

      if (!newRenderUrl) {
        throw new Error("Revision render returned no image - check browser console for details");
      }

      // Update the SAME record with the new render URL
      const existingUrls = { ...sourceUrls };
      let updatedUrls: Record<string, string> = isMyVehicle
        ? { ...existingUrls, myvehicle_edit: newRenderUrl }
        : { ...existingUrls, [revisionViewKey]: newRenderUrl };

      // Apply revision to remaining views if "Apply to All Views" is on
      if (applyToAll && !isMyVehicle) {
        const otherViewKeys = Object.keys(existingUrls).filter(
          (k) => k !== revisionViewKey && existingUrls[k] && VIEW_ORDER.includes(k)
        // Driver first, so the passenger mirror below reads the REVISED driver.
        ).sort((a, b) => (a === "side" ? -1 : b === "side" ? 1 : 0));
        if (otherViewKeys.length > 0) {
          console.log(`[RevisionIQ] Apply-all (in-place): revising ${otherViewKeys.length} additional views`);
          toast.info(`Applying revision to ${otherViewKeys.length} more view${otherViewKeys.length > 1 ? "s" : ""}...`);
          const origPrompt = (() => { try { return JSON.parse(render.admin_notes || "{}").original_prompt; } catch { return ""; } })() || render.custom_styling_prompt_key || "";
          for (const viewKey of otherViewKeys) {
            try {
              // PASSENGER SIDE has exactly ONE producer — producePassengerView, a
              // deterministic flip of the (just-revised) driver. It NEVER goes
              // through revise-render (that AI pass returns the driver orientation
              // and no check can catch it). A failed mirror is an HONEST GAP.
              if (viewKey === "passenger-side") {
                const driverUrl = updatedUrls["side"] || updatedUrls["hero"] || updatedUrls["driver-side"];
                const mirrorUrl = driverUrl
                  ? await producePassengerView({
                      driverUrl,
                      uploadDataUrl: uploadDataUrlToStorage,
                      textDetection: {
                        modeType: render.mode_type || "",
                        prompt: `${origPrompt || ""} ${targetedNotes || ""}`,
                      },
                      vehicleYear: resolvedVehicle.year,
                      vehicleMake: resolvedVehicle.make,
                      vehicleModel: resolvedVehicle.model,
                      toolType: render.mode_type || "designpanelpro",
                      invokeEdgeFunction: invokeWithFreshAuth,
                      logLabel: "RevisionIQ Apply-all in-place",
                    })
                  : null;
                if (mirrorUrl) {
                  updatedUrls[viewKey] = mirrorUrl;
                  console.log(`[RevisionIQ] Apply-all in-place: passenger-side mirrored from revised driver`);
                }
                continue;
              }
              const viewSourceUrl = existingUrls[viewKey];
              const siblingUrls: string[] = Object.entries(updatedUrls)
                .filter(([k, url]) => k !== viewKey && url)
                .slice(0, 2)
                .map(([, url]) => url);
              const { data: viewRenderData, error: viewRenderError } = await invokeWithFreshAuth("revise-render", {
                originalRenderUrl: viewSourceUrl,
                revisionPrompt: targetedNotes,
                toolType: render.mode_type || "colorpro",
                viewType: viewKey,
                vehicleYear: resolvedVehicle.year,
                vehicleMake: resolvedVehicle.make,
                vehicleModel: resolvedVehicle.model,
                originalPrompt: origPrompt || undefined,
              });
              if (viewRenderError) {
                console.warn(`[RevisionIQ] Apply-all in-place: ${viewKey} failed:`, viewRenderError.message);
              } else if (viewRenderData?.renderUrl) {
                updatedUrls[viewKey] = viewRenderData.renderUrl;
                console.log(`[RevisionIQ] Apply-all in-place: ${viewKey} revised successfully`);
              }
            } catch (e) {
              console.warn(`[RevisionIQ] Apply-all in-place: ${viewKey} error:`, e);
            }
          }
        }
      }

      // Preserve and update admin_notes with revision info + prompt history
      const existingNotes = (() => {
        try { return JSON.parse(render.admin_notes || "{}"); } catch { return {}; }
      })();
      const parentHistory: Array<{ version: number; prompt: string; timestamp: string; view_key: string; type: string }> =
        existingNotes.prompt_history || [];
      const currentVersion = parseVersionInfo(render).version;
      const inPlaceHistory = [
        ...parentHistory,
        { version: currentVersion, prompt: targetedNotes, timestamp: new Date().toISOString(), view_key: applyToAll ? "all" : revisionViewKey, type: "in-place-revision" },
      ];
      const changedViewKeys = changedRevisionSurfaceKeys(sourceUrls, updatedUrls);
      const primaryChangedViewKey = changedViewKeys.includes(revisionViewKey as any)
        ? revisionViewKey
        : changedViewKeys[0] || revisionViewKey;
      const updatedNotes = {
        ...existingNotes,
        revised: true,
        last_revision_prompt: targetedNotes,
        revised_view_key: primaryChangedViewKey,
        primary_changed_view_key: primaryChangedViewKey,
        changed_view_keys: changedViewKeys,
        revision_render_date: new Date().toISOString(),
        prompt_history: inPlaceHistory,
        // Keep version.revision_notes in sync so parseVersionInfo + filmstrip see the prompt
        version: {
          ...(existingNotes.version || {}),
          revision_notes: targetedNotes,
          revised_view_key: primaryChangedViewKey,
          primary_changed_view_key: primaryChangedViewKey,
          changed_view_keys: changedViewKeys,
        },
      };

      console.log(`[RevisionIQ] Updating record ${render.id} in-place with revised URL for ${applyToAll ? "all views" : revisionViewKey}`);
      await persistViewRevision({
        render,
        renderUrls: updatedUrls,
        trigger: "revision_saved",
        change: {
          type: "revision",
          prompt: targetedNotes,
          viewKeys: changedViewKeys,
        },
        patch: { admin_notes: JSON.stringify(updatedNotes) },
      });

      // Fetch the updated record
      const { data: refreshed } = await supabase
        .from("color_visualizations")
        .select("*")
        .eq("id", render.id)
        .single();

      return refreshed || { ...render, render_urls: updatedUrls };
    },
    onSuccess: (updatedRender) => {
      queryClient.invalidateQueries({ queryKey: ["revision-studio-renders"] });
      queryClient.invalidateQueries({ queryKey: ["version-chain"] });
      toast.success("Render revised in place - no clone created");
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
  const generateMissingViews = async (render: any) => {
    const missing = getMissingViews(render);
    if (missing.length === 0) {
      toast.success("All views already exist!");
      return;
    }

    // Get current user email
    const { data: { user } } = await supabase.auth.getUser();
    const userEmail = user?.email;
    if (!userEmail) {
      toast.error("Please log in to generate renders.");
      return;
    }

    setIsGeneratingMissing(true);
    setGeneratingViews([...missing]);
    setCompletedMissingViews([]);
    setFailedMissingViews([]);

    // GUARD: wrap the whole run so an unhandled throw (a dimension lookup, a
    // network hiccup, the proof step, the final refetch, etc.) can never strand
    // isGeneratingMissing=true — which permanently disables the button and makes
    // every later click silently do nothing. finally ALWAYS re-enables it.
    try {
    const colorData = buildColorDataFromRender(render);

    toast.info(`Generating ${missing.length} missing view${missing.length > 1 ? "s" : ""}...`, {
      description: missing.map((v) => VIEW_LABELS[v]).join(", "),
    });

    // Track results locally to avoid stale closure issues with state
    let localCompleted: string[] = [];
    let localFailed: string[] = [];
    // First real edge error from a failed view — surfaced in the toast so the
    // operator sees WHY (e.g. "print_required", "Missing required fields",
    // "Invalid JWT") instead of a generic "some views failed".
    let firstViewError = "";

    // Accumulate new render URLs to merge into the record directly
    let mergedRenderUrls: Record<string, string> = {
      ...(render.render_urls as Record<string, string> || {}),
    };
    // Adopt an existing hero/driver image into the canonical "side" key so it is
    // NOT regenerated (it's the customer's approved driver view) and so it anchors
    // every other angle. Matches the alias set in getMissingViews.
    if (!mergedRenderUrls["side"]) {
      const existingSide = mergedRenderUrls["hero"] || mergedRenderUrls["driver-side"] || mergedRenderUrls["driver_side"] || mergedRenderUrls["primary"] || mergedRenderUrls["mockup"] || null;
      if (existingSide) mergedRenderUrls["side"] = existingSide;
    }

    // Extract original prompt for DesignProAI renders (stored in admin_notes)
    // recreatepro routes through the design pipeline like designpanelpro — it
    // reproduces an artistic wrap from a reference, so its missing views must
    // be generated by design-panel-ai-generate (with the hero render as the
    // design reference), NOT generate-color-render which would paint a generic
    // colored vehicle and lose the design entirely.
    const isDesignPro = (render.mode_type === "designpanelpro" || render.mode_type === "designpro" || render.mode_type === "recreatepro");
    let originalPrompt = "";
    let recoveredAdminNotesPatch: Record<string, unknown> = {};
    let designIQInfo: { mode: "commercial" | "restyle"; companyName?: string; phone?: string; mascot?: string; industryType?: string; bulletPoints?: string[] } = { mode: "restyle" };
    if (isDesignPro) {
      try {
        const notes = JSON.parse(render.admin_notes || "{}");
        originalPrompt = notes.original_prompt || render.custom_styling_prompt_key || "";

        // Fallback 1: query designiq_generations by designiq_generation_id
        if (!originalPrompt && notes.designiq_generation_id) {
          const { data: genRow } = await supabase
            .from("designiq_generations")
            .select("raw_prompt")
            .eq("id", notes.designiq_generation_id)
            .maybeSingle();
          if (genRow?.raw_prompt) {
            originalPrompt = genRow.raw_prompt;
            recoveredAdminNotesPatch = {
              original_prompt: originalPrompt,
            };
          }
        }

        // Fallback 2: query designiq_generations by panel URL (custom_design_url)
        if (!originalPrompt && render.custom_design_url) {
          const { data: genRow } = await supabase
            .from("designiq_generations")
            .select("raw_prompt")
            .eq("panel_url", render.custom_design_url)
            .limit(1)
            .maybeSingle();
          if (genRow?.raw_prompt) {
            originalPrompt = genRow.raw_prompt;
            recoveredAdminNotesPatch = {
              original_prompt: originalPrompt,
            };
          }
        }

        // Fallback 3: query designiq_generations by matching hero render URL
        if (!originalPrompt) {
          const heroUrls = render.render_urls as Record<string, string> | null;
          const heroUrl = heroUrls?.side || heroUrls?.hero;
          if (heroUrl) {
            const { data: genRow } = await supabase
              .from("designiq_generations")
              .select("raw_prompt")
              .eq("render_url", heroUrl)
              .limit(1)
              .maybeSingle();
            if (genRow?.raw_prompt) {
              originalPrompt = genRow.raw_prompt;
              recoveredAdminNotesPatch = {
                original_prompt: originalPrompt,
              };
            }
          }
        }
      } catch {}
      // Pre-fetch DesignIQ mode + commercial details
      designIQInfo = await getDesignIQModeAndDetails(render);

      // Fallback: if no prompt found but we have a design name, reconstruct a prompt
      // so we still route through design-panel-ai-generate instead of 400-ing on generate-color-render
      if (!originalPrompt) {
        // NEVER fall back to the order-number/placeholder name here — it would
        // be sent verbatim as the render prompt and Gemini paints it onto the
        // wrap ("Order RP-100926" text on the body). Only use a REAL design name.
        const designLabel = designNameForPrompt(render.design_file_name || render.color_name);
        if (designLabel) {
          originalPrompt = designLabel;
          console.log(`[RevisionStudioIQ] No stored prompt - using design name as prompt: "${originalPrompt}"`);
        }
      }
    }

    // ── Get the hero/side render URL for design consistency across views ──
    // When re-generating a missing view (especially "side"), we need ANY existing view
    // as a visual reference so the AI maintains design consistency. Try side first,
    // then fall through to any available view.
    let heroReferenceUrl = mergedRenderUrls["side"] || mergedRenderUrls["hero"] || mergedRenderUrls["driver-side"] || mergedRenderUrls["passenger-side"] || mergedRenderUrls["front"] || mergedRenderUrls["rear"] || mergedRenderUrls["hood_detail"] || mergedRenderUrls["close-up"] || mergedRenderUrls["roof"] || null;

    // ANCHOR FIX (two-different-designs / different sky): when this row carries no
    // views — e.g. an order opened in RevisionStudio with empty render_urls — the
    // regeneration below would run UNANCHORED and the AI would invent a brand-new
    // background/sky, producing a second, different design. Resolve the original
    // hero from the LINKED design generation (admin_notes.designiq_generation_id)
    // so every regenerated view anchors to the real design. Additive: only runs
    // when no view reference exists.
    if (!heroReferenceUrl) {
      try {
        const linkedGenId = (() => {
          try { return JSON.parse(render.admin_notes || "{}")?.designiq_generation_id || null; } catch { return null; }
        })();
        if (linkedGenId) {
          const { data: g } = await supabase
            .from("designiq_generations")
            .select("hero_render_url, render_urls")
            .eq("id", linkedGenId)
            .maybeSingle();
          const gUrls = (g?.render_urls || {}) as Record<string, string>;
          heroReferenceUrl =
            g?.hero_render_url || gUrls["side"] || gUrls["driver-side"] || Object.values(gUrls)[0] || null;
          if (heroReferenceUrl) {
            console.log(`[RevisionStudioIQ] Anchored regeneration to design generation hero (${linkedGenId}) — prevents new-sky drift`);
          }
        }
      } catch { /* non-fatal — falls back to unanchored */ }
    }

    // ── Render a single view with timeout + retry ──
    // Uses invokeWithFreshAuth (raw fetch) instead of supabase.functions.invoke
    // to bypass SDK header merging bugs that cause "Invalid JWT" on parallel calls.
    const renderSingleView = async (viewType: string): Promise<{ type: string; url: string | null; error?: string }> => {
      const MAX_RETRIES = 2;
      const RETRY_DELAY_MS = 3000;
      let lastError = "";
      // DOWNSCALE the hero anchor (a ~8MB 4K JPG) to a 2048px reference. The edge
      // worker fetches originalRenderUrl RAW and base64-encodes it; fanning several
      // raw-8MB clones concurrently OOM'd the 256MB worker (HTTP 546) so the missing
      // views never generated. 2048px (~1MB) anchors the design fine and removes the
      // OOM; the rendered output is still full-res. See lib/storage-image.ts.
      const heroRefForRender = downscaleStorageImage(heroReferenceUrl);

      for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
        try {
          console.log(`[RevisionStudioIQ] View "${viewType}" attempt ${attempt}/${MAX_RETRIES + 1}`);
          let data: any, error: any;

          // GraphicsPro reproduces a FINISHED wrap from its hero render — the same
          // job as DesignPro/recreatepro. Route it through design-panel-ai-generate
          // (which PRESERVES the design + the exact vehicle) instead of
          // generate-color-render, which — per this file's own note — "would paint a
          // generic colored vehicle and lose the design entirely" (the wrong-vehicle /
          // generic-SUV bug, and why it never matched DesignPro). Needs a hero anchor.
          // RecreatePro / DesignPro reproduce a FINISHED wrap from the approved
          // hero render — never a generic color change. Route them through
          // design-panel-ai-generate whenever a hero anchor exists, even if the
          // stored prompt is empty (a neutral reproduction line is used below).
          // Falling through to generate-color-render here is the documented
          // "paint a generic colored vehicle and lose the design entirely" bug —
          // for a RecreatePro job that means the recreated wrap vanishes on the
          // extra angles (only the side + proof survive). The hero carries the
          // design, so design pipeline + hero anchor is always the right producer.
          const isGraphicsPro = (render.mode_type || "").toLowerCase().includes("graphic");
          const useDesignPipeline = (isDesignPro && (!!originalPrompt || !!heroReferenceUrl)) || (isGraphicsPro && !!heroReferenceUrl);
          if (useDesignPipeline) {
            const { mode: dpModeRaw, ...commercial } = designIQInfo;
            const dpMode = isGraphicsPro ? "restyle" : dpModeRaw;
            const vehName = [render.vehicle_year, render.vehicle_make, render.vehicle_model].filter(Boolean).join(" ") || "the vehicle";
            // The reference image carries the design — do NOT name it in the
            // prompt unless the name is a REAL design name. Embedding the raw
            // name made Gemini paint order numbers ("Order RP-100926") onto the
            // wrap. designNameForPrompt() returns "" for order numbers/generic
            // labels, so those are dropped and only the reference image is used.
            const cleanName = designNameForPrompt(render.design_file_name || render.color_name);
            const namePhrase = cleanName ? ` — "${cleanName}"` : "";
            // Neutral, print-keyword-free reproduction line. Used for GraphicsPro
            // AND as the fallback for a DesignPro/RecreatePro row whose stored
            // prompt is empty — the design comes from the hero reference image, so
            // this only tells Gemini to reproduce it at the new angle without
            // inventing artwork or baking in order numbers/filenames.
            const reproLine = `Reproduce this EXACT existing vehicle wrap${namePhrase} on ${vehName} at the requested camera angle. Match every graphic, logo, color and letter from the reference image exactly. Do NOT redesign, recolor, or change the vehicle body/type. Do NOT add any order numbers, file names, captions, labels, or text that is not already part of the wrap artwork in the reference image.`;
            const dpPrompt = isGraphicsPro
              ? reproLine
              : (originalPrompt || reproLine);
            ({ data, error } = await invokeWithFreshAuth("design-panel-ai-generate", {
              mode: dpMode,
              prompt: dpPrompt,
              finish: render.finish_type || "Gloss",
              vehicleYear: String(render.vehicle_year || ""),
              vehicleMake: render.vehicle_make || "",
              vehicleModel: render.vehicle_model || "",
              viewType,
              forceNew: true,
              ...(heroReferenceUrl ? { originalRenderUrl: heroRefForRender } : {}),
              ...(dpMode === "commercial" ? commercial : {}),
            }, VIEW_RENDER_TIMEOUT_MS));
            // Normalize - design-panel-ai-generate returns renderUrl or panel.media_url
            if (data && !data.renderUrl && data.panel?.media_url) {
              data = { ...data, renderUrl: data.panel.media_url };
            }
          } else {
            // All other modes (ColorPro, FadeWraps, DesignPro without prompt fallback)
            // ALWAYS pass heroReferenceUrl for design consistency — even for side view re-gen
            // GraphicsPro: pass the hero render as a design-consistency anchor
            // (colorData.heroReferenceUrl) so generate-color-render reproduces the
            // SAME wrap from the new angle instead of inventing a different design.
            // CRITICAL: also OVERRIDE customStylingPrompt with a print-keyword-free
            // reproduction instruction. The stored prompt (custom_styling_prompt_key)
            // for a commercial wrap routinely contains words like "graphic design",
            // "print", "photo", "logo" — every one of which makes generate-color-render
            // 400 with `print_required`, so EVERY missing view silently failed. The
            // actual design comes from the hero reference, not this text, so a neutral
            // reproduction prompt is both safe and faithful (same approach the
            // GraphicsPro tool uses for its studio angles).
            // Other modes keep their existing behavior untouched.
            const REPRO_INSTRUCTION =
              "Reproduce this exact cut vinyl wrap on the vehicle at the requested camera angle. " +
              "Match every shape, color, logo, and lettering exactly as shown in the reference — do not redesign, reinterpret, or omit any element.";
            // GraphicsPro WITHOUT a hero falls here (the design pipeline above needs
            // an anchor). Keep the print-safe color-render reproduction as a fallback.
            // isGraphicsPro is already declared above (shared with the design-pipeline route).
            // PRESERVE the original design context (business name, colors, layout)
            // when the row has it — earlier we replaced it wholesale with a generic
            // reproduction line, which threw the design away and produced "duplicates
            // of the wrong vehicle". Keep the stored prompt but STRIP only the
            // print-only keywords that trip generate-color-render's `print_required`
            // guard. Fall back to the bare reproduction line when the row truly has
            // no prompt ("original prompt missing").
            const PRINT_KW = /\b(photo|picture|image|galaxy|marble|camo|camouflage|printed|print|texture|realistic flames|photo wrap|forest|ocean|sunset|landscape|portrait|graphic design|artwork|illustration|digital print|full print)\b/gi;
            const origPrompt = String((colorData as any)?.customStylingPrompt || "")
              .replace(PRINT_KW, "").replace(/\s+/g, " ").trim();
            const graphicsProPrompt = origPrompt.length > 8 ? `${REPRO_INSTRUCTION} ${origPrompt}` : REPRO_INSTRUCTION;
            const colorDataForCall = isGraphicsPro
              ? { ...colorData, ...(heroReferenceUrl ? { heroReferenceUrl } : {}), customStylingPrompt: graphicsProPrompt, colorLibrary: "graphicspro" }
              : colorData;
            ({ data, error } = await invokeWithFreshAuth("generate-color-render", {
              // generate-color-render hard-requires year/make/model and 400s on
              // "Missing required fields" otherwise — a GraphicsPro row saved
              // without a picked vehicle would fail every view. Fall back to safe
              // placeholders (the vehicle shape is carried by the hero reference).
              vehicleYear: isGraphicsPro ? (render.vehicle_year ? String(render.vehicle_year) : "2020") : String(render.vehicle_year),
              vehicleMake: isGraphicsPro ? (render.vehicle_make || "Custom") : render.vehicle_make,
              vehicleModel: isGraphicsPro ? (render.vehicle_model || "Vehicle") : render.vehicle_model,
              colorData: colorDataForCall,
              // Normalize so generate-color-render's GraphicsPro branch (hero anchor,
              // reproduction) fires even when the row stored a different casing.
              modeType: isGraphicsPro ? "GraphicsPro" : (render.mode_type || "colorpro"),
              viewType,
              userEmail,
              skipLookups: true,
              skipCacheStorage: true,
              // Force the LIGHT studio for GraphicsPro reproductions. Without it the
              // GraphicsPro prompt falls to SOFT_DIFFUSION_STUDIO, whose "very
              // dark/black background" reads as a nighttime shot — the customer's
              // "it's forcing a nighttime view". studioMode:'light' swaps it to the
              // bright seamless-gray studio the proofs use.
              ...(isGraphicsPro ? { studioMode: "light" } : {}),
              ...(heroReferenceUrl ? { originalRenderUrl: heroRefForRender } : {}),
            }, VIEW_RENDER_TIMEOUT_MS));
          }

          if (error) throw new Error(error.message || "Edge function error");
          if (data?.renderUrl) {
            console.log(`[RevisionStudioIQ] View "${viewType}" OK on attempt ${attempt}`);
            return { type: viewType, url: data.renderUrl };
          }
          throw new Error("No renderUrl in response");
        } catch (viewError: any) {
          lastError = viewError?.message || String(viewError) || "unknown error";
          console.error(`[RevisionStudioIQ] View "${viewType}" attempt ${attempt} failed:`, lastError);
          if (attempt <= MAX_RETRIES) {
            console.log(`[RevisionStudioIQ] Retrying "${viewType}" in ${RETRY_DELAY_MS}ms...`);
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
          }
        }
      }

      // NO generate-color-render fallback for DesignPro. That renderer paints a
      // DIFFERENT wrap (it's the color-change path, not the DesignPro art), which
      // is exactly the "close-up / hood comes back a different design" regression.
      // design-panel-ai-generate already retried MAX_RETRIES times above with the
      // hero as the anchor; if it still couldn't hold the design, fail the view
      // (it shows as failed + retryable) rather than substitute a wrong design.
      return { type: viewType, url: null, error: lastError };
    };

    // ── Passenger side is NEVER an AI render ──
    // passenger-side is a scaleX(-1) flip of the driver hero, NOT an AI call
    // (per view-angles-os.ts). The old AI fallback kept returning a straight
    // DUPLICATE of the driver (same orientation) — "two driver sides" — so it
    // was removed (same fix as RecreatePro/ProductionFlow). If the driver view
    // itself is still being generated, the mirror runs AFTER the AI fan-out.
    const missingPassenger = missing.includes("passenger-side");
    const aiViews = missing.filter((v) => v !== "passenger-side");

    const mirrorPassengerFromDriver = async (): Promise<boolean> => {
      const driverSideUrl = mergedRenderUrls["side"] || mergedRenderUrls["hero"] || mergedRenderUrls["driver-side"];
      if (!driverSideUrl) return false;
      try {
        console.log("[RevisionStudioIQ] Generating passenger-side via INSTANT_MIRROR");
        const mirrorDataUrl = await generatePassengerMirror(driverSideUrl);
        let mirrorUrl = await uploadDataUrlToStorage(mirrorDataUrl);

        // Check if design has text that needs fixing after mirror
        const modeType = render.mode_type || "";
        let designPrompt = "";
        try { designPrompt = JSON.parse(render.admin_notes || "{}").original_prompt || ""; } catch {}
        const hasText = designLikelyHasText({ modeType, prompt: designPrompt });
        if (hasText) {
          console.log("[RevisionStudioIQ] Design has text - sending mirror to AI for text correction");
          mirrorUrl = await fixMirrorText(mirrorUrl, {
            vehicleYear: String(render.vehicle_year || ""),
            vehicleMake: render.vehicle_make || "",
            vehicleModel: render.vehicle_model || "",
            toolType: modeType,
            invokeEdgeFunction: invokeWithFreshAuth,
          });
        }

        mergedRenderUrls["passenger-side"] = mirrorUrl;
        setSelectedRender((prev: any) => prev?.id === render.id
          ? { ...prev, render_urls: { ...mergedRenderUrls } }
          : prev
        );
        localCompleted.push("passenger-side");
        setCompletedMissingViews((prev) => [...prev, "passenger-side"]);
        setGeneratingViews((prev) => prev.filter((v) => v !== "passenger-side"));
        console.log("[RevisionStudioIQ] passenger-side mirror OK");
        return true;
      } catch (mirrorErr) {
        console.error("[RevisionStudioIQ] passenger-side mirror failed:", mirrorErr);
        return false;
      }
    };

    // Mirror the passenger CONCURRENTLY with the AI fan-out — never block on it.
    // It used to be `await`ed here BEFORE the AI views, so a slow/hung passenger
    // mirror (its fixMirrorText → revise-render call) froze the whole run at
    // "Generating Passenger Side… 0/6" and the other 5 views never started. Now it
    // runs as its own promise alongside them (and fixMirrorText has a hard timeout),
    // so the AI views always make progress regardless of the mirror. When the driver
    // hero is itself a missing view we still defer the mirror until after the fan-out
    // produces it (handled below).
    let passengerDone = !missingPassenger;
    const passengerPromise: Promise<void> =
      (missingPassenger && !missing.includes("side"))
        ? (async () => { passengerDone = await mirrorPassengerFromDriver(); })()
        : Promise.resolve();

    // ── Fire remaining AI views in parallel with 200ms stagger ──
    console.log(`[RevisionStudioIQ] Parallel fan-out: ${aiViews.length} AI views (isDesignPro=${isDesignPro}, hasPrompt=${!!originalPrompt})`);

    const parallelPromises = aiViews.map((viewType, index) => {
      return new Promise<{ type: string; url: string | null }>((resolve) => {
        setTimeout(async () => {
          const result = await renderSingleView(viewType);
          // Update the UI progressively; the final complete map is committed
          // once with its durable workflow below.
          if (result.url) {
            mergedRenderUrls[viewType] = result.url;
            setSelectedRender((prev: any) => prev?.id === render.id
              ? { ...prev, render_urls: { ...mergedRenderUrls } }
              : prev
            );
            localCompleted.push(viewType);
            setCompletedMissingViews((prev) => [...prev, viewType]);
          } else {
            localFailed.push(viewType);
            if (result.error && !firstViewError) firstViewError = result.error;
            setFailedMissingViews((prev) => [...prev, viewType]);
          }
          setGeneratingViews((prev) => prev.filter((v) => v !== viewType));
          resolve(result);
        }, index * 200);
      });
    });

    await Promise.allSettled(parallelPromises);

    // Passenger mirror was deferred until the driver hero finished generating —
    // run it now. It is a deterministic flip, never an AI render: if the driver
    // failed (or the mirror itself fails) the passenger view is marked failed
    // and stays retryable, instead of an AI pass shipping a duplicate driver.
    if (!passengerDone) {
      passengerDone = await mirrorPassengerFromDriver();
      if (!passengerDone) {
        localFailed.push("passenger-side");
        setFailedMissingViews((prev) => [...prev, "passenger-side"]);
        setGeneratingViews((prev) => prev.filter((v) => v !== "passenger-side"));
      }
    }

    // A total rendering failure produced no new pixels and therefore is not a
    // design version. Do not append a metadata-only "Vn" card that appears to
    // be a successful Driver revision; leave every failed view retryable.
    if (localCompleted.length === 0) {
      toast.error(`All views failed: ${firstViewError || "unknown error"}`, { duration: 12000 });
      return;
    }

    // Persist one authoritative view set, then submit exactly one durable
    // revision workflow. Proof/panel/logo production is server-owned.
    await persistViewRevision({
      render,
      renderUrls: { ...mergedRenderUrls },
      trigger: "missing_views_completed",
      change: {
        type: "edit",
        prompt: originalPrompt || null,
        // Failed views produced no pixels and are not OS history.
        viewKeys: Array.from(new Set(localCompleted)).sort(),
      },
      ...(Object.keys(recoveredAdminNotesPatch).length
        ? {
            patch: {
              admin_notes: JSON.stringify(recoveredAdminNotesPatch),
            },
          }
        : {}),
    });

    // Refresh the render data to get updated render_urls.
    //
    // BUG FIX ("it says it generated the sides but I don't see them"): views are
    // NOT written per-view — they accumulate in React state (mergedRenderUrls)
    // and are persisted by the single persistViewRevision commit above, so this
    // read can lag that write (read-replica) or error. The client already
    // KNOWS what it generated (`mergedRenderUrls`), so never depend solely on the
    // re-fetch: always merge the freshly-generated views into the displayed
    // render so every completed view shows immediately. If the re-fetch lagged,
    // mergedRenderUrls backfills the rest; if it succeeded, the merge is a no-op.
    const { data: updatedRender, error: fetchError } = await supabase
      .from("color_visualizations")
      .select("*")
      .eq("id", render.id)
      .single();

    if (!fetchError && updatedRender) {
      setSelectedRender({
        ...updatedRender,
        render_urls: { ...(updatedRender.render_urls as Record<string, string> || {}), ...mergedRenderUrls },
      });
    } else {
      // Re-fetch failed — fall back to the locally-accumulated view set so the UI
      // still shows what we generated instead of staying on the stale set.
      setSelectedRender((prev: any) =>
        prev?.id === render.id ? { ...prev, render_urls: { ...mergedRenderUrls } } : prev,
      );
    }

    queryClient.invalidateQueries({ queryKey: ["revision-studio-renders"] });
    queryClient.invalidateQueries({ queryKey: ["version-chain"] });

    // Use local tracking vars instead of stale state closure
    if (localFailed.length === 0) {
      toast.success(`All ${missing.length} missing views generated!`);
    } else {
      toast.warning(`${localCompleted.length} of ${missing.length} views generated. Failed: ${firstViewError || "unknown error"}`, { duration: 10000 });
    }

    // Auto-build the Cut Production Sheet (graphics specced flat at real cut sizes,
    // off the truck) the moment the view set is ready — the customer shouldn't have
    // to hunt for the button. Only when at least one view landed (it needs a hero).
    // NOT for full-wrap classes (RecreatePro / DesignPro): those are printed wraps,
    // not plotter-cut vinyl, so auto-popping a cut-graphics proof just shows a
    // false "no cut graphics detected" (Trish 2026-07-23: RecreatePro should not
    // show this). The manual "Build Cut Sheet" button still works for any job.
    const fullWrapMode = /recreatepro|designpanelpro|designpro/i.test(String(render.mode_type || ""));
    if (!fullWrapMode && (localCompleted.length > 0 || Object.keys(mergedRenderUrls).length > 0)) {
      handleBuildCutSheet().catch(() => { /* its own toast surfaces any error */ });
    }
    } catch (fatalErr: any) {
      console.error("[RevisionStudioIQ] generateMissingViews fatal:", fatalErr?.message || fatalErr);
      toast.error("Couldn't generate the missing views — please try again.");
    } finally {
      // ALWAYS re-enable the button, even if the run threw partway through, so a
      // single failed run can never leave it stuck-disabled ("nothing happens").
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
      // RevisionStudio lists cards from THREE tables (color_visualizations,
      // graphics_pro_jobs, panelizer_jobs); each card's id is the PK of the
      // table it came from. Delete from THAT table — deleting a GraphicsPro or
      // Panelizer card from color_visualizations matched 0 rows and surfaced as
      // the bogus "Delete blocked - you may not have permission" error.
      const table =
        source === "graphics_pro_jobs" ? "graphics_pro_jobs"
        : source === "panelizer_jobs" ? "panelizer_jobs"
        : "color_visualizations";
      console.log("[RevisionIQ] Deleting render:", id, "from", table);
      // Ensure a valid auth token before an RLS-protected delete. If we can't
      // get one, bail with a clear message instead of running the delete as
      // `anon` (which the DELETE policy rejects → 0 rows → confusing
      // "permission" error).
      const token = await ensureFreshSession();
      if (!token) {
        throw new Error("Your session expired — please refresh the page (or sign in again) and try deleting.");
      }
      const { data, error, status } = await supabase
        .from(table as any)
        .delete()
        .eq("id", id)
        .select("id");
      console.log("[RevisionIQ] Delete response:", { table, data, error, status });
      if (error) throw error;
      // RLS can silently block deletes - no error but 0 rows affected.
      if (!data || data.length === 0) {
        // Distinguish a lost/anon session (the common cause) from a genuine
        // permission gap so the user gets an actionable message.
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          throw new Error("Your session expired — please refresh the page (or sign in again) and try deleting.");
        }
        throw new Error("Delete blocked - you may not have permission to delete this render");
      }
      return id;
    },
    onMutate: async ({ id }: { id: string; source?: string }) => {
      // Optimistic: immediately remove the card from EVERY feed it could live in
      // (color_visualizations + the GraphicsPro / Panelizer feeds) while the DB
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
  const regenerateSingleView = async (render: any, viewKey: string) => {
    // PASSENGER SIDE is never AI-regenerated — the AI pass keeps returning a
    // straight DUPLICATE of the driver (same orientation), i.e. "two driver
    // sides". It is always a deterministic horizontal mirror of the driver hero
    // (same fix as RecreatePro/ProductionFlow); flipPassengerSide also runs the
    // text-direction fix for lettered designs.
    const regenUrls = (render?.render_urls || {}) as Record<string, string>;
    if (viewKey === "passenger-side" && (regenUrls.side || regenUrls.hero || regenUrls["driver-side"])) {
      setRegeneratingView(viewKey);
      try {
        await flipPassengerSide(render);
      } finally {
        setRegeneratingView(null);
      }
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    const userEmail = user?.email;
    if (!userEmail) {
      toast.error("Please log in to regenerate views.");
      return;
    }

    setRegeneratingView(viewKey);
    toast.info(`Regenerating ${VIEW_LABELS[viewKey] || viewKey}...`);

    // GUARD: same reasoning as generateMissingViews — an unhandled throw here
    // would strand regeneratingView and permanently disable the regenerate
    // buttons. finally ALWAYS clears it.
    try {
    // Reuse the same rendering logic from generateMissingViews
    const colorData = buildColorDataFromRender(render);
    // recreatepro routes through the design pipeline like designpanelpro — it
    // reproduces an artistic wrap from a reference, so its missing views must
    // be generated by design-panel-ai-generate (with the hero render as the
    // design reference), NOT generate-color-render which would paint a generic
    // colored vehicle and lose the design entirely.
    const isDesignPro = (render.mode_type === "designpanelpro" || render.mode_type === "designpro" || render.mode_type === "recreatepro");
    let originalPrompt = "";
    let designIQInfo: { mode: "commercial" | "restyle"; companyName?: string; phone?: string; mascot?: string; industryType?: string; bulletPoints?: string[] } = { mode: "restyle" };

    if (isDesignPro) {
      try {
        const notes = JSON.parse(render.admin_notes || "{}");
        originalPrompt = notes.original_prompt || render.custom_styling_prompt_key || "";
        if (!originalPrompt) {
          const designLabel = render.design_file_name || render.color_name || "";
          if (designLabel) originalPrompt = designLabel;
        }
      } catch {}
      designIQInfo = await getDesignIQModeAndDetails(render);
    }

    const urls = { ...(render.render_urls as Record<string, string> || {}) };

    // Pick a reference from a DIFFERENT view — never use the same messed-up
    // view being regenerated as its own reference.  Fall through the canonical
    // order until we find an alternative.
    const heroReferenceUrl = (() => {
      const preferredOrder = ["side", "passenger-side", "front", "rear", "hood_detail", "close-up", "roof", "hero"];
      for (const k of preferredOrder) {
        if (k !== viewKey && urls[k]) return urls[k];
      }
      return null;
    })();

    // Render the single view
    const MAX_RETRIES = 2;
    const RETRY_DELAY_MS = 3000;
    let resultUrl: string | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
      try {
        let data: any, error: any;

        if (isDesignPro && originalPrompt) {
          const { mode, ...commercial } = designIQInfo;
          ({ data, error } = await invokeWithFreshAuth("design-panel-ai-generate", {
            mode,
            prompt: originalPrompt,
            finish: render.finish_type || "Gloss",
            vehicleYear: String(render.vehicle_year),
            vehicleMake: render.vehicle_make,
            vehicleModel: render.vehicle_model,
            viewType: viewKey,
            forceNew: true,
            ...(heroReferenceUrl ? { originalRenderUrl: heroReferenceUrl } : {}),
            ...(mode === "commercial" ? commercial : {}),
          }, VIEW_RENDER_TIMEOUT_MS));
          if (data && !data.renderUrl && data.panel?.media_url) {
            data = { ...data, renderUrl: data.panel.media_url };
          }
        } else {
          ({ data, error } = await invokeWithFreshAuth("generate-color-render", {
            vehicleYear: String(render.vehicle_year),
            vehicleMake: render.vehicle_make,
            vehicleModel: render.vehicle_model,
            colorData,
            modeType: render.mode_type || "colorpro",
            viewType: viewKey,
            userEmail,
            skipLookups: true,
            skipCacheStorage: true,
            ...(heroReferenceUrl ? { originalRenderUrl: heroReferenceUrl } : {}),
          }, VIEW_RENDER_TIMEOUT_MS));
        }

        if (error) throw new Error(error.message || "Edge function error");
        if (data?.renderUrl) {
          resultUrl = data.renderUrl;
          break;
        }
        throw new Error("No renderUrl in response");
      } catch (err: any) {
        if (attempt <= MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        }
      }
    }

    if (resultUrl) {
      urls[viewKey] = resultUrl;
      await persistViewRevision({
        render,
        renderUrls: urls,
        trigger: "view_regenerated",
        change: { type: "edit", viewKeys: [viewKey] },
      });

      setSelectedRender((prev: any) =>
        prev?.id === render.id ? { ...prev, render_urls: urls } : prev
      );
      queryClient.invalidateQueries({ queryKey: ["revision-studio-renders"] });
      queryClient.invalidateQueries({ queryKey: ["version-chain"] });
      toast.success(`${VIEW_LABELS[viewKey] || viewKey} regenerated!`);
    } else {
      toast.error(`Failed to regenerate ${VIEW_LABELS[viewKey] || viewKey}`);
    }
    } catch (fatalErr: any) {
      console.error("[RevisionStudioIQ] regenerateSingleView fatal:", fatalErr?.message || fatalErr);
      toast.error(`Couldn't regenerate ${VIEW_LABELS[viewKey] || viewKey} — please try again.`);
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

  const fixViewFinish = async (render: any, viewKey: string, targetFinish: string) => {
    const heroUrl = render.render_urls?.[viewKey];
    if (!heroUrl) { toast.error("No image to fix"); return; }

    setIsFixingFinish(true);
    toast.info(`Fixing ${VIEW_LABELS[viewKey]} to ${targetFinish}...`);

    try {
      const finishDesc = FINISH_DESCRIPTIONS[targetFinish] || targetFinish;
      const { data, error } = await supabase.functions.invoke("revise-render", {
        body: {
          originalRenderUrl: heroUrl,
          revisionPrompt: `Fix the vinyl wrap finish on this vehicle. The wrap MUST have a ${finishDesc}. Keep the exact same design, colors, patterns, vehicle, and camera angle. Only change the surface finish/sheen to be clearly ${targetFinish}.`,
          toolType: render.mode_type || "designpanelpro",
          viewType: viewKey,
          vehicleYear: String(render.vehicle_year || ""),
          vehicleMake: render.vehicle_make || "",
          vehicleModel: render.vehicle_model || "",
        },
      });

      if (error) throw error;
      if (data?.renderUrl) {
        const updatedUrls = { ...(render.render_urls || {}), [viewKey]: data.renderUrl };
        await persistViewRevision({
          render,
          renderUrls: updatedUrls,
          trigger: "finish_fixed",
          change: {
            type: "edit",
            prompt: `Change ${viewKey} finish to ${targetFinish}`,
            viewKeys: [viewKey],
          },
          patch: { finish_type: targetFinish },
        });

        setSelectedRender((prev: any) =>
          prev?.id === render.id ? { ...prev, render_urls: updatedUrls } : prev
        );
        queryClient.invalidateQueries({ queryKey: ["revision-studio-renders"] });
        toast.success(`${VIEW_LABELS[viewKey]} updated to ${targetFinish}`);
      } else {
        toast.error("No image returned");
      }
    } catch (err: any) {
      console.error("Fix finish error:", err);
      toast.error(`Failed: ${err.message || "Unknown error"}`);
    } finally {
      setIsFixingFinish(false);
    }
  };

  const flipPassengerSide = async (render: any) => {
    const urls = render.render_urls || {};
    const driverUrl = urls.side || urls.hero || urls["driver-side"];
    if (!driverUrl) {
      toast.error("No driver side image to mirror — generate the driver side view first");
      return;
    }

    setIsFlippingPassenger(true);
    try {
      toast.info("Mirroring driver side...");

      // ONE producer: deterministic flip + the shared text-direction repair.
      // This used to inline its own revise-render text fix, duplicating
      // fixMirrorText without its 90s timeout (a hang froze the whole flow).
      const hasText = designLikelyHasText({
        prompt: designNameForPrompt(render.design_file_name || render.color_name),
        modeType: render.mode_type || "",
      });
      if (hasText) toast.info("Fixing text direction on passenger side...");

      const finalUrl = await producePassengerView({
        driverUrl,
        uploadDataUrl: uploadDataUrlToStorage,
        textDetection: {
          prompt: designNameForPrompt(render.design_file_name || render.color_name),
          modeType: render.mode_type || "",
        },
        vehicleYear: String(render.vehicle_year || ""),
        vehicleMake: render.vehicle_make || "",
        vehicleModel: render.vehicle_model || "",
        toolType: render.mode_type || "designpanelpro",
        invokeEdgeFunction: async (fnName, body) => {
          const { data, error } = await renderClient.functions.invoke(fnName, { body });
          return { data, error };
        },
        logLabel: "RevisionIQ flipPassenger",
      });

      if (!finalUrl) {
        toast.error("Passenger mirror failed — nothing was changed");
        return;
      }

      const updatedUrls = { ...(render.render_urls || {}), "passenger-side": finalUrl };
      await persistViewRevision({
        render,
        renderUrls: updatedUrls,
        trigger: "passenger_mirrored",
        change: { type: "edit", viewKeys: ["passenger-side"] },
      });

      setSelectedRender((prev: any) =>
        prev?.id === render.id ? { ...prev, render_urls: updatedUrls } : prev
      );
      queryClient.invalidateQueries({ queryKey: ["revision-studio-renders"] });
      toast.success(hasText ? "Passenger mirrored + text corrected" : "Passenger side mirrored");
    } catch (err: any) {
      console.error("Flip error:", err);
      toast.error(`Flip failed: ${err.message || "Unknown error"}`);
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

  const submitRating = async (render: any, rating: number) => {
    setIsRating(true);
    try {
      // Always mark as saved for My Renders; 5 stars also sets is_featured_hero
      const updatePayload = { is_saved: true, ...(rating === 5 ? { is_featured_hero: true } : {}) };
      console.log("[submitRating] Updating color_visualizations id:", render.id, "payload:", updatePayload);
      const { data: updateData, error: updateErr } = await supabase
        .from("color_visualizations")
        .update(updatePayload)
        .eq("id", render.id)
        .select("id, is_featured_hero, is_saved");
      if (updateErr) {
        console.error("[5-star] color_visualizations update FAILED:", updateErr.message, updateErr.code, updateErr.details);
        toast.error(`Rating save failed: ${updateErr.message}`);
      } else {
        console.log("[5-star] color_visualizations updated OK:", updateData);
        // Verify the update actually took effect (RLS can silently return empty array)
        if (!updateData || updateData.length === 0) {
          console.error("[5-star] UPDATE returned 0 rows! RLS is likely blocking the update.");
          toast.error("Rating saved but is_featured_hero may not have been set (RLS issue). Check Supabase Dashboard.");
        } else if (rating === 5 && updateData[0] && !updateData[0].is_featured_hero) {
          console.error("[5-star] UPDATE succeeded but is_featured_hero is still false!");
          toast.error("is_featured_hero did not get set. Check RLS policies.");
        }
      }

      // Double-check: re-read the row to verify is_featured_hero
      if (rating === 5) {
        const { data: verifyData } = await supabase
          .from("color_visualizations")
          .select("id, is_featured_hero")
          .eq("id", render.id)
          .single();
        console.log("[5-star] VERIFY read-back:", verifyData);
        if (verifyData && !verifyData.is_featured_hero) {
          toast.error("CONFIRMED: is_featured_hero is NOT being saved. RLS UPDATE policy is blocking it.");
        }
      }

      // 5 stars → push hero image to the appropriate gallery carousel table
      if (rating === 5) {
        // DesignProAI: prefer side (original branded render with logos/text)
        const isDesignProRender = render.mode_type === "designpanelpro" || render.mode_type === "designpro";
        const heroUrl = isDesignProRender
          ? (render.render_urls?.side || render.render_urls?.hero || Object.values(render.render_urls || {})[0])
          : (render.render_urls?.hero || render.render_urls?.side || Object.values(render.render_urls || {})[0]);
        if (heroUrl) {
          const carouselTable = CAROUSEL_TABLE_MAP[render.mode_type] || "inkfusion_carousel";
          const title = `${render.vehicle_year} ${render.vehicle_make} ${render.vehicle_model}`;
          const insertData: any = {
            name: title,
            media_url: heroUrl,
            title,
            subtitle: `${render.color_name || render.design_file_name || ""} - ${render.finish_type || ""}`,
            vehicle_name: `${render.vehicle_make} ${render.vehicle_model}`,
            is_active: true,
            sort_order: 0,
          };
          // Add tool-specific fields
          if (carouselTable === "inkfusion_carousel") {
            insertData.color_name = render.color_name;
          }
          if (["designpanelpro_carousel", "fadewraps_carousel", "wbty_carousel"].includes(carouselTable)) {
            insertData.pattern_name = render.design_file_name || render.color_name;
          }
          if (carouselTable === "approvemode_carousel" && render.custom_design_url) {
            insertData.before_url = render.custom_design_url;
          }
          console.log(`[5-star] Inserting into ${carouselTable}:`, insertData);
          const { error: carouselErr } = await supabase.from(carouselTable as any).insert(insertData as any);
          if (carouselErr) {
            console.error(`[5-star] ${carouselTable} insert FAILED:`, carouselErr.message, carouselErr.code);
            toast.error(`Carousel insert failed: ${carouselErr.message}`);
          } else {
            console.log(`[5-star] ${carouselTable} insert OK`);
          }

          // Also push to hero_carousel (landing page) and DesignProAI showcase
          const heroInsert = {
            image_url: heroUrl,
            title: title,
            subtitle: `${render.color_name || render.design_file_name || ""} - ${render.finish_type || ""}`.trim(),
            is_active: true,
            sort_order: 0,
          };
          console.log("[5-star] Inserting into hero_carousel:", heroInsert);
          const { error: heroErr } = await supabase.from("hero_carousel" as any).insert(heroInsert as any);
          if (heroErr) {
            console.error("[5-star] hero_carousel insert FAILED:", heroErr.message, heroErr.code);
          } else {
            console.log("[5-star] hero_carousel insert OK");
          }
        }
        toast.success("5-star render pushed to Gallery, My Renders, Hero Carousel & DesignProAI!");
      } else {
        toast.success(`Rated ${rating} star${rating !== 1 ? "s" : ""} - saved to My Renders`);
      }

      setCurrentRating(rating);
      queryClient.invalidateQueries({ queryKey: ["revision-studio-renders"] });
    } catch (err: any) {
      toast.error(`Rating failed: ${err.message}`);
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

      // Fallback: query designiq_generations for prompt + visionboard
      if (!prompt || visionboardUrls.length === 0) {
        const heroUrls = render.render_urls as Record<string, string> | null;
        const heroUrl = heroUrls?.side || heroUrls?.hero;

        // Try by panel_url first
        if (render.custom_design_url) {
          const { data: genRow } = await supabase
            .from("designiq_generations")
            .select("raw_prompt, visionboard_image_refs, mode, company_name, phone, mascot, industry_type, brand_keywords")
            .eq("panel_url", render.custom_design_url)
            .limit(1)
            .maybeSingle();
          if (genRow) {
            if (!prompt && genRow.raw_prompt) prompt = genRow.raw_prompt;
            if (visionboardUrls.length === 0 && genRow.visionboard_image_refs) {
              visionboardUrls = (genRow.visionboard_image_refs as any[])
                .map((ref: any) => typeof ref === "string" ? ref : ref?.storageUrl)
                .filter(Boolean);
            }
            if (genRow.mode === "commercial" && Object.keys(commercialDetails).length === 0) {
              mode = "commercial";
              commercialDetails = {
                companyName: genRow.company_name,
                phone: genRow.phone,
                mascot: genRow.mascot,
                industryType: genRow.industry_type,
                brandKeywords: genRow.brand_keywords,
              };
            }
          }
        }

        // Try by render URL
        if (!prompt && heroUrl) {
          const { data: genRow } = await supabase
            .from("designiq_generations")
            .select("raw_prompt, visionboard_image_refs")
            .eq("render_url", heroUrl)
            .limit(1)
            .maybeSingle();
          if (genRow) {
            if (!prompt && genRow.raw_prompt) prompt = genRow.raw_prompt;
            if (visionboardUrls.length === 0 && genRow.visionboard_image_refs) {
              visionboardUrls = (genRow.visionboard_image_refs as any[])
                .map((ref: any) => typeof ref === "string" ? ref : ref?.storageUrl)
                .filter(Boolean);
            }
          }
        }
      }

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
  // color_visualizations is the mutable working row. Every immutable ledger
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
        <title>RevisionStudioIQ - AI Wrap Design Revision Tool | RestyleProAI</title>
        <meta name="description" content="Clone and revise wrap designs without starting over. Targeted changes to colors, elements, and styles. Design it. Panel it. Print it. The world's first prompt-to-production wrap platform." />
        <meta property="og:title" content="RevisionStudioIQ - AI Wrap Design Revision Tool | RestyleProAI" />
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

          <Select value={modeFilter} onValueChange={setModeFilter}>
            <SelectTrigger className="w-36 sm:w-48 bg-zinc-900 border-zinc-700">
              <SelectValue placeholder="Tool" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Tools</SelectItem>
              <SelectItem value="colorpro">ColorPro</SelectItem>
              <SelectItem value="designpanelpro">DesignProAI™</SelectItem>
              <SelectItem value="recreatepro">RecreatePro™</SelectItem>
              <SelectItem value="fadewraps">FadeWraps</SelectItem>
              <SelectItem value="graphicspro">GraphicsPro</SelectItem>
              <SelectItem value="approvemode">ApprovePro</SelectItem>
              <SelectItem value="wbty">WBTY</SelectItem>
              <SelectItem value="myvehicle">MyVehiclePro (all)</SelectItem>
              <SelectItem value="myvehicle_colorpro">↳ MV × ColorPro</SelectItem>
              <SelectItem value="myvehicle_designpanelpro">↳ MV × DesignPro</SelectItem>
              <SelectItem value="myvehicle_fadewraps">↳ MV × FadeWraps</SelectItem>
              <SelectItem value="myvehicle_graphicspro">↳ MV × GraphicsPro</SelectItem>
              <SelectItem value="myvehicle_wbty">↳ MV × WBTY</SelectItem>
              <SelectItem value="wallpro">WallPro</SelectItem>
              <SelectItem value="myvehicle_wallpro">↳ MV × WallPro</SelectItem>
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
            // MyVehiclePro renders are tagged `myvehicle_<tool>` (e.g.
            // `myvehicle_graphicspro`), so the "myvehicle" filter has to match
            // by prefix rather than equality — otherwise every MVP render gets
            // filtered out of the gallery. Other tool filters stay on
            // case-insensitive equality and explicitly exclude MVP rows so
            // they only surface under their own filter.
            if (modeFilter !== "all") {
              const mt = (r.mode_type || "").toLowerCase();
              if (modeFilter === "myvehicle") {
                if (!mt.startsWith("myvehicle_")) return false;
              } else {
                if (mt !== modeFilter.toLowerCase()) return false;
              }
            }
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
        {!selectedRender && layoutMode === "studio" && (
          <div className="w-full">
            {/* Only show the bouncer on the very first fetch — once any page
                of data is in we render the grid (with SproketTipsSlideshow
                covering the empty state) so a stalled background refetch
                can't trap users behind the loading screen. */}
            {renders === undefined && !rendersError ? (
              <div className="flex flex-col items-center justify-center py-20 gap-4">
                <img
                  src="/characters/sproket/sproket-rocket-launch.png"
                  alt="Loading"
                  className="w-14 h-14 sm:w-20 sm:h-20 md:w-32 md:h-32 object-contain animate-bounce"
                />
                <p className="text-zinc-500 text-sm font-poppins">Loading your Custom Wrap Designs...</p>
              </div>
            ) : rendersError ? (
              <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
                <img
                  src="/characters/sproket/sproket-clipboard.png"
                  alt=""
                  className="w-16 h-16 md:w-24 md:h-24 object-contain opacity-80"
                />
                <div>
                  <p className="text-white font-semibold font-poppins mb-1">We couldn't load your designs</p>
                  <p className="text-zinc-400 text-sm max-w-md">Something went wrong fetching your Custom Wrap Designs. Check your connection and try again.</p>
                </div>
                <Button
                  variant="outline"
                  className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                  onClick={() => refetchRenders()}
                >
                  <RefreshCw className="w-4 h-4 mr-1.5" />
                  Retry
                </Button>
              </div>
            ) : (
              <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {(() => {
                  // Group renders by VEHICLE (year|make|model) so all designs/revisions
                  // for the same vehicle appear inside one card with a slider.
                  // MyVehiclePro renders are the exception — each one is a distinct
                  // photo edit the shop showed a customer, so it always gets its own
                  // card (keyed by id) and never collapses into the vehicle group.
                  const grouped = new Map<string, any[]>();
                  for (const render of renders || []) {
                    const isMvp = (render.mode_type || "").startsWith("myvehicle_");
                    if (isMvp) {
                      grouped.set(render.id, [render]);
                      continue;
                    }
                    const mk = (render.vehicle_make || "").toLowerCase().trim();
                    const md = (render.vehicle_model || "").toLowerCase().trim();
                    const yr = render.vehicle_year || 0;
                    const groupKey = `${yr}|${mk}|${md}`;
                    if (!grouped.has(groupKey)) grouped.set(groupKey, []);
                    grouped.get(groupKey)!.push(render);
                  }

                  // For each group, sort by newest first
                  const cards: any[] = [];
                  for (const group of grouped.values()) {
                    group.sort((a: any, b: any) => {
                      return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
                    });
                    cards.push({ allVersions: group });
                  }

                  return cards.map(({ allVersions }) => (
                    <VehicleGroupCard
                      key={allVersions[0].id}
                      allVersions={allVersions}
                      orderNumberByRenderId={orderNumberByRenderId}
                      failedImages={failedImages}
                      setFailedImages={setFailedImages}
                      getMissingViews={getMissingViews}
                      getViews={getViews}
                      formatVehicleInfo={formatVehicleInfo}
                      formatDesignName={formatDesignName}
                      deleteRender={deleteRender}
                      onSelect={(render) => {
                        setSelectedRender(render);
                        setCurrentViewIndex(0);
                        setCompletedMissingViews([]);
                        setFailedMissingViews([]);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                      onSendProof={(render) => {
                        setSelectedRender(render);
                        setShowSendForApproval(true);
                      }}
                      onDownloadAll={handleDownloadAllRenders}
                      onBuildFiles={(render) => {
                        // Push this existing design to its Design Assets page,
                        // where the artboard + print files get built (Build Assets).
                        // Pass the row's OWN id — gallery cards are always real
                        // color_visualizations rows, so the page resolves views +
                        // stored proof + artboards with a direct lookup on any
                        // device (the DesignIQ id's row is near-empty and its
                        // reverse link misses in production). The page maps the
                        // row id to the canonical generation id internally. Stash
                        // the buildctx as a belt-and-suspenders extra.
                        const gid = render?.id || genIdOf(render);
                        stashBuildCtx(render, gid);
                        navigate(`/design-assets/${gid}`);
                      }}
                    />
                  ));
                })()}

                {renders?.length === 0 && !isFetchingNextPage && (
                  <SproketTipsSlideshow />
                )}
              </div>

              {/* Infinite scroll sentinel + manual Load More fallback */}
              <div ref={loadMoreRef} className="h-1" />
              {isFetchingNextPage && (
                <div className="flex items-center justify-center py-6 gap-2">
                  <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
                  <span className="text-zinc-500 text-sm">Loading more designs...</span>
                </div>
              )}
              {hasNextPage && !isFetchingNextPage && (
                <div className="flex justify-center mt-6">
                  <Button
                    variant="outline"
                    className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                    onClick={() => fetchNextPage()}
                  >
                    Load More
                  </Button>
                </div>
              )}
              </>
            )}
          </div>
        )}

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
                    into production_flow_assets (keyed by the DesignIQ generation id,
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

                <ProductionFlowLayersCard
                  // A panelizer-sourced card's `id` is the panelizer_jobs id —
                  // an id class NONE of the resolver's three lookups can match,
                  // by construction (it is not a color_visualizations row, no
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
                  generationId={
                    ((selectedRender as any)?.__source === "panelizer_jobs"
                      ? (selectedRender as any)?._generationId
                      : null)
                    || selectedRender?.id
                    || genIdOf(selectedRender)
                    || null
                  }
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
                      _generationId; color_visualizations rows via admin_notes
                      (genIdOf); else the render id (the page resolver handles it).
                      Passing the panelizer-job id was what opened the blank page. */}
                  <Button
                    variant="outline"
                    className="w-full border-blue-600 text-blue-400 hover:bg-blue-900/30 h-11"
                    onClick={() => {
                      // Prefer the REAL color_visualizations row id — it's the row
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
                      search resolves a UUID via panelizer_jobs.generation_id). */}
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
                      onClick={() => setShow2DProofSheet(true)}
                      disabled={selectedViews.length === 0}
                    >
                      <FileText className="w-4 h-4 mr-2" /> 2D Proof
                    </Button>
                    <Button
                      className="flex-1 bg-green-600 hover:bg-green-700 h-11"
                      onClick={() => {
                        setShowProofSheet(true);
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

                  {/* Generate Production Pack - route to ProductionFlow */}
                  <Button
                    className="w-full bg-blue-600 hover:bg-blue-700 h-11"
                    onClick={() => setShowProductionDialog(true)}
                    disabled={!selectedRender}
                  >
                    <Package className="w-4 h-4 mr-2" /> Generate Production Pack
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
                        setSavingToProof(true);
                        try {
                          const { data: { session } } = await supabase.auth.getSession();
                          const { error } = await supabase.functions.invoke("proof-save-version", {
                            body: {
                              proof_id: bridgeProofId,
                              render_urls: renderUrls,
                              prompt_text: "Shop edit via RevisionStudio",
                            },
                            headers: {
                              Authorization: `Bearer ${session?.access_token || ""}`,
                              "Idempotency-Key": (globalThis.crypto?.randomUUID?.() || `rs-${bridgeProofId}-${Date.now()}`),
                            },
                          });
                          if (error) throw error;
                          toast.success("Saved to the proof & customer notified.");
                          if (isEmbed && window.parent !== window) {
                            // Embedded in ApprovePro — tell the workbench to close
                            // this editor and refresh the version list in place.
                            window.parent.postMessage(
                              { type: "revisionstudio:saved", proofId: bridgeProofId },
                              window.location.origin,
                            );
                          } else {
                            navigate(`/approvepro?id=${bridgeProofId}`);
                          }
                        } catch (e: any) {
                          toast.error(e?.message || "Could not save to the proof.");
                        } finally {
                          setSavingToProof(false);
                        }
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
                      // Read cached prompt/visionboard synchronously from admin_notes
                      // so the click navigates instantly. The 3-level designiq_generations
                      // fallback runs in the background and writes results back to
                      // admin_notes so the next push hits the synchronous path.
                      let originalPrompt = "";
                      let visionBoardUrls: string[] = [];
                      let notes: any = {};
                      try {
                        notes = JSON.parse(selectedRender.admin_notes || "{}");
                        originalPrompt = notes.original_prompt || selectedRender.custom_styling_prompt_key || "";
                        if (notes.visionboard_image_urls && Array.isArray(notes.visionboard_image_urls)) {
                          visionBoardUrls = notes.visionboard_image_urls;
                        }
                      } catch {
                        originalPrompt = selectedRender.custom_styling_prompt_key || "";
                      }

                      // Background hydration — no await, never blocks navigation.
                      if (!originalPrompt || visionBoardUrls.length === 0) {
                        const renderId = selectedRender.id;
                        const customDesignUrl = selectedRender.custom_design_url;
                        const designiqGenerationId = notes.designiq_generation_id;
                        (async () => {
                          try {
                            let prompt = originalPrompt;
                            let urls = visionBoardUrls;
                            const apply = (genRow: any) => {
                              if (!genRow) return;
                              if (!prompt && genRow.raw_prompt) prompt = genRow.raw_prompt;
                              if (urls.length === 0 && Array.isArray(genRow.visionboard_image_refs)) {
                                urls = (genRow.visionboard_image_refs as any[])
                                  .map((ref: any) => typeof ref === "string" ? ref : ref?.storageUrl)
                                  .filter(Boolean);
                              }
                            };
                            if ((!prompt || urls.length === 0) && designiqGenerationId) {
                              const { data } = await supabase
                                .from("designiq_generations")
                                .select("raw_prompt, visionboard_image_refs")
                                .eq("id", designiqGenerationId)
                                .maybeSingle();
                              apply(data);
                            }
                            if ((!prompt || urls.length === 0) && customDesignUrl) {
                              const { data } = await supabase
                                .from("designiq_generations")
                                .select("raw_prompt, visionboard_image_refs")
                                .eq("panel_url", customDesignUrl)
                                .limit(1)
                                .maybeSingle();
                              apply(data);
                            }
                            if ((!prompt || urls.length === 0) && heroUrl) {
                              const { data } = await supabase
                                .from("designiq_generations")
                                .select("raw_prompt, visionboard_image_refs")
                                .eq("hero_render_url", heroUrl)
                                .limit(1)
                                .maybeSingle();
                              apply(data);
                            }
                            if (prompt || urls.length > 0) {
                              const patched = { ...notes };
                              if (prompt && !notes.original_prompt) patched.original_prompt = prompt;
                              if (urls.length > 0 && !notes.visionboard_image_urls) patched.visionboard_image_urls = urls;
                              await supabase.from("color_visualizations").update({
                                admin_notes: JSON.stringify(patched),
                              } as any).eq("id", renderId);
                            }
                          } catch {
                            /* best-effort cache; ignore */
                          }
                        })();
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
      {/* Production Pack Dialog */}
      <ProductionPackDialog
        open={showProductionDialog}
        onOpenChange={setShowProductionDialog}
        render={selectedRender ? {
          id: selectedRender.id,
          render_urls: selectedRender.render_urls as Record<string, string> | undefined,
          vehicle_year: selectedRender.vehicle_year,
          vehicle_make: selectedRender.vehicle_make,
          vehicle_model: selectedRender.vehicle_model,
          design_file_name: selectedRender.design_file_name,
          color_name: selectedRender.color_name,
          finish_type: selectedRender.finish_type,
        } : null}
      />

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
